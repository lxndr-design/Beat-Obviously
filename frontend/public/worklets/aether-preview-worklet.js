class AetherPreviewProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const input = options.processorOptions || {};
    this.instrument = input.instrument || {};
    this.durationS = Math.max(0.02, Number(input.durationS) || 1.4);
    this.frequency = Math.max(20, Math.min(20000, Number(input.frequency) || 261.625565));
    this.targetFrequency = Number.isFinite(input.targetFrequency) ? Math.max(20, Math.min(20000, Number(input.targetFrequency))) : null;
    this.velocityGain = Math.max(0, Math.min(1.5, (Number(input.velocity) || 127) / 127));
    this.bpm = Math.max(1, Math.min(999, Number(input.bpm) || 120));
    this.curve = normalizeFrequencyCurve(input.curve, this.durationS, this.frequency);
    this.automation = normalizeAutomation(input.automation);
    this.startFrame = Number.isFinite(input.startTimeS)
      ? Math.max(currentFrame, Math.round(Number(input.startTimeS) * sampleRate))
      : currentFrame;
    this.sampleIndex = 0;
    this.totalSamples = Math.max(1, Math.ceil(this.durationS * sampleRate));
    this.phase = 0;
    this.leftFilter = createFilterState();
    this.rightFilter = createFilterState();
    this.noiseState = 0x12345678;
    this.tableCache = new Map();
    this.stopping = false;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "stop") this.stopping = true;
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] || output[0];
    const durationS = this.totalSamples / sampleRate;

    for (let i = 0; i < left.length; i++) {
      if (currentFrame + i < this.startFrame) {
        left[i] = 0;
        right[i] = 0;
        continue;
      }

      if (this.stopping || this.sampleIndex >= this.totalSamples) {
        left[i] = 0;
        right[i] = 0;
        continue;
      }

      const timeS = this.sampleIndex / sampleRate;
      const baseFrequency = this.curve.length > 1
        ? frequencyAtCurveTime(this.curve, timeS)
        : glideFrequencyAtTime(this.frequency, this.targetFrequency, timeS, durationS);
      const modulation = modulationAtTime(
        this.instrument,
        timeS,
        durationS,
        this.bpm,
        clamp01(this.velocityGain),
        keytrackSourceValue(baseFrequency),
      );
      applyAutomationOffsets(this.instrument, modulation, this.automation, timeS);
      const currentFrequency = baseFrequency * Math.pow(2, modulation.pitchSemitones / 12);
      const frame = renderStereoSample(this.instrument, this, currentFrequency, modulation);
      const amp = Math.min(1, timeS / 0.025, (durationS - timeS) / 0.08);
      left[i] = clamp(frame.left * amp * this.velocityGain, -1, 1);
      right[i] = clamp(frame.right * amp * this.velocityGain, -1, 1);

      this.phase += currentFrequency / sampleRate;
      this.phase -= Math.floor(this.phase);
      this.sampleIndex += 1;
    }

    if (this.stopping || this.sampleIndex >= this.totalSamples) {
      this.port.postMessage({ type: "ended" });
      return false;
    }
    return true;
  }
}

function createFilterState() {
  return { low: 0, band: 0, cutoff: -1, resonance: -1, f: 0, damping: 1 };
}

function renderStereoSample(instrument, state, frequency, modulation) {
  const raw = renderAetherStack(instrument, state, frequency, modulation);
  const cutoff = clamp01(
    (instrument.knobs?.cutoff ?? 0.6)
    + filterKeytrackOffset(instrument, frequency)
    + modulation.filterOffset
    + targetOffset(modulation, "filter.cutoff"),
  );
  const resonance = clamp01((instrument.knobs?.resonance ?? 0.1) + targetOffset(modulation, "filter.resonance"));
  const drive = clamp01((instrument.knobs?.drive ?? 0) + targetOffset(modulation, "filter.drive"));
  let left = raw.left;
  let right = raw.right;

  if (drive > 0) {
    const amount = 1 + drive * 10;
    const normalizer = Math.tanh(amount);
    left = Math.tanh(left * amount) / normalizer;
    right = Math.tanh(right * amount) / normalizer;
  }

  left = resonantFilter(left, state.leftFilter, cutoff, resonance, instrument.filterType || "lowpass");
  right = resonantFilter(right, state.rightFilter, cutoff, resonance, instrument.filterType || "lowpass");

  const level = clamp01((instrument.ampLevel ?? 1) + targetOffset(modulation, "amp.level"));
  const ampEnvelope = clamp01(modulation.ampEnvelope ?? 1);
  const pan = (instrument.ampPan ?? 0) + targetOffset(modulation, "amp.pan");
  const gains = panGains(pan);
  return {
    left: left * level * ampEnvelope * gains[0],
    right: right * level * ampEnvelope * gains[1],
  };
}

function renderAetherStack(instrument, state, frequency, modulation) {
  const config = instrument.aether;
  if (!config) {
    const sample = wavetableOscillatorSample(instrument, state, state.phase, frequency, instrument.wavetable, modulation.positionOffset, 0, targetOffset(modulation, "unison.detune"), targetOffset(modulation, "unison.spread"));
    return { left: sample, right: sample };
  }

  let left = 0;
  let right = 0;
  let levelSum = 0;
  const add = (value, level, pan) => {
    const gains = panGains(pan);
    left += value * level * gains[0];
    right += value * level * gains[1];
    levelSum += level;
  };

  const renderOsc = (osc, key) => {
    const level = clamp01((osc.level ?? 0) + targetOffset(modulation, `osc.${key}.level`));
    if (!osc.enabled || level <= 0) return;
    const fine = (osc.fineCents ?? 0) + targetOffset(modulation, `osc.${key}.fine`);
    const rate = oscillatorRate(osc.octave ?? 0, osc.semitone ?? 0, fine);
    const waveform = osc.waveform || "wavetable";
    const positionOffset = (key === "a" ? modulation.positionOffset : 0) + targetOffset(modulation, `osc.${key}.position`);
    const warpOffset = targetOffset(modulation, `osc.${key}.warp`);
    const phaseOffset = targetOffset(modulation, `osc.${key}.phase`);
    const value = waveform === "wavetable"
      ? wavetableOscillatorSample(instrument, state, state.phase * rate + phaseOffset, frequency * rate, osc.wavetable, positionOffset, warpOffset, targetOffset(modulation, "unison.detune"), targetOffset(modulation, "unison.spread"))
      : waveform === "noise"
        ? nextNoise(state)
        : oscillatorSample(waveform, state.phase * rate + phaseOffset, clamp01(instrument.knobs?.color ?? 0.5));
    add(value, level, (osc.pan ?? 0) + targetOffset(modulation, `osc.${key}.pan`));
  };

  renderOsc(config.oscA, "a");
  renderOsc(config.oscB, "b");

  if (config.sub?.enabled && config.sub.level > 0) {
    add(oscillatorSample(config.sub.waveform || "sine", state.phase * oscillatorRate(config.sub.octave ?? -1, 0, 0), 0.5), clamp01(config.sub.level), 0);
  }

  if (config.noise?.enabled && config.noise.level > 0) {
    add(nextNoise(state) * (0.35 + clamp01(config.noise.color ?? 0.5) * 0.65), clamp01(config.noise.level), 0);
  }

  if (levelSum <= 0) return { left: 0, right: 0 };
  const normalizer = Math.max(0.35, levelSum);
  return { left: clamp(left / normalizer, -1, 1), right: clamp(right / normalizer, -1, 1) };
}

function wavetableOscillatorSample(instrument, state, phase, frequency, config, positionOffset, warpOffset, detuneOffset, spreadOffset) {
  const tableConfig = config || instrument.wavetable || { bank: "aether", position: 0.35, warp: 0.2, warpMode: "shape", unison: 1, detuneCents: 12, blend: 0.5 };
  const unison = Math.max(1, Math.min(8, Math.round(tableConfig.unison || 1)));
  const detune = Math.max(0, Math.min(100, (tableConfig.detuneCents || 0) + (detuneOffset || 0)));
  const blend = clamp01((tableConfig.blend || 0) + (spreadOffset || 0));
  const plan = unisonVoicePlan(unison, detune, blend);
  let sum = 0;
  for (let voice = 0; voice < unison; voice++) {
    const rate = plan.rates[voice];
    sum += wavetableFrameMorph(instrument, state, tableConfig, phase * rate + plan.phaseOffsets[voice], frequency * rate, clamp01((tableConfig.position || 0) + (positionOffset || 0)), clamp01((tableConfig.warp || 0) + (warpOffset || 0)), tableConfig.warpMode || "shape") * plan.weights[voice];
  }
  return clamp(sum / Math.max(1, plan.weightSum), -1, 1);
}

function wavetableFrameMorph(instrument, state, config, phase, frequency, position, warp, warpMode) {
  const table = getWavetable(instrument, state, config, frequency, warp, warpMode);
  const pos = clamp01(position) * (table.frameCount - 1);
  const base = Math.floor(pos);
  const frac = pos - base;
  const y1 = tableSample(table, base, phase);
  const y2 = tableSample(table, base + 1, phase);
  return y1 + (y2 - y1) * frac;
}

function getWavetable(instrument, state, config, frequency, warp, warpMode) {
  const custom = config.bank === "custom" ? customWavetableForInstrument(instrument, config.customId) : null;
  const harmonicLimit = Math.min(32, Math.max(1, Math.floor((sampleRate * 0.48) / Math.max(20, frequency))));
  const key = wavetableKey(config, custom, harmonicLimit, warp, warpMode);
  const cached = state.tableCache.get(key);
  if (cached) return cached;
  const table = createWavetable(config, custom, harmonicLimit, warp, warpMode);
  state.tableCache.set(key, table);
  return table;
}

function wavetableKey(config, custom, harmonicLimit, warp, warpMode) {
  const customKey = custom ? custom.frames.map((frame) => [frame.brightness, frame.even, frame.fold, frame.phase].map((value) => Number(value || 0).toFixed(3)).join(",")).join(";") : "";
  return [config.bank, config.customId || "", harmonicLimit, clamp01(warp || 0).toFixed(3), warpMode || "shape", customKey].join("|");
}

function createWavetable(config, custom, harmonicLimit, warp, warpMode) {
  const frameCount = custom ? custom.frames.length : 8;
  const frameSize = 512;
  const samples = new Float32Array(frameCount * frameSize);
  for (let frame = 0; frame < frameCount; frame++) {
    const normalizedFrame = frame / Math.max(1, frameCount - 1);
    const customFrame = custom?.frames[frame] || null;
    const frameStart = frame * frameSize;
    let peak = 0;
    for (let index = 0; index < frameSize; index++) {
      const phase = index / frameSize;
      let sample = 0;
      let normalizer = 0;
      for (let harmonic = 1; harmonic <= harmonicLimit; harmonic++) {
        const amp = customFrame ? customAmp(customFrame, harmonic, warp, warpMode) : harmonicAmp(config.bank, harmonic, normalizedFrame, warp, warpMode);
        if (amp <= 0.0001) continue;
        const harmonicPhase = customFrame ? customPhase(customFrame, harmonic, warp, warpMode) : harmonicPhaseForBank(config.bank, harmonic, normalizedFrame, warp, warpMode);
        sample += Math.sin(phase * Math.PI * 2 * harmonic + harmonicPhase) * amp;
        normalizer += amp;
      }
      const value = normalizer > 0 ? sample / Math.max(1, normalizer * 0.72) : 0;
      samples[frameStart + index] = value;
      peak = Math.max(peak, Math.abs(value));
    }
    if (peak > 1) {
      for (let index = 0; index < frameSize; index++) samples[frameStart + index] /= peak;
    }
  }
  return { frameCount, frameSize, samples };
}

function tableSample(table, frameIndex, phase) {
  const frame = Math.max(0, Math.min(table.frameCount - 1, frameIndex));
  const wrapped = ((phase % 1) + 1) % 1;
  const position = wrapped * table.frameSize;
  const i0 = Math.floor(position) % table.frameSize;
  const i1 = (i0 + 1) % table.frameSize;
  const frac = position - Math.floor(position);
  const frameStart = frame * table.frameSize;
  const a = table.samples[frameStart + i0];
  const b = table.samples[frameStart + i1];
  return a + (b - a) * frac;
}

function customWavetableForInstrument(instrument, id) {
  const customId = id && id.startsWith("user.") ? id : "user.custom";
  const table = instrument.synthPatch?.metadata?.customWavetables?.[customId];
  if (!table || !Array.isArray(table.frames) || table.frames.length === 0) return null;
  return { frames: table.frames.slice(0, 4).map((frame) => ({
    brightness: clamp01(frame.brightness || 0),
    even: clamp01(frame.even || 0),
    fold: clamp01(frame.fold || 0),
    phase: clamp(frame.phase || 0, -1, 1),
  })) };
}

function warpModeIntensity(warp, warpMode) {
  if (warpMode === "fold") return clamp01(warp) * 1.35;
  if (warpMode === "pinch") return Math.pow(clamp01(warp), 0.72);
  return clamp01(warp);
}

function customAmp(frame, harmonic, warp, warpMode) {
  const brightness = clamp01(frame.brightness);
  const even = clamp01(frame.even);
  const shapedWarp = warpModeIntensity(warp, warpMode);
  const fold = clamp01(frame.fold + shapedWarp * 0.35);
  const parity = harmonic % 2 === 1 ? 1 : even;
  const rolloff = Math.exp(-harmonic * (0.016 + (1 - brightness) * 0.085));
  const foldPeak = Math.exp(-Math.pow((harmonic - (3 + brightness * 20)) / (1.6 + fold * 8), 2));
  const folded = warpMode === "fold" ? Math.abs(Math.sin(harmonic * 0.62 + frame.phase)) * shapedWarp * 0.24 : 0;
  const pinched = warpMode === "pinch" ? Math.exp(-Math.pow((harmonic - (2 + brightness * 8)) / 2.4, 2)) * shapedWarp * 0.28 : 0;
  const motion = 1 + Math.sin(harmonic * 1.7 + frame.phase * Math.PI) * fold * 0.28;
  return Math.max(0, parity * rolloff * motion / Math.sqrt(harmonic) + foldPeak * fold * 0.35 + folded + pinched);
}

function customPhase(frame, harmonic, warp, warpMode) {
  const shapedWarp = warpModeIntensity(warp, warpMode);
  const modePhase = warpMode === "fold"
    ? Math.sin(harmonic * 0.73) * shapedWarp * 0.45
    : warpMode === "pinch"
      ? Math.cos(harmonic * 0.29) * shapedWarp * 0.24
      : 0;
  return frame.phase * harmonic * 0.28 + Math.sin(harmonic * 0.41) * clamp01(frame.fold + shapedWarp * 0.25) * 0.55 + modePhase;
}

function harmonicAmp(bank, harmonic, frame, warp, warpMode) {
  const odd = harmonic % 2 === 1;
  const shapedWarp = warpModeIntensity(warp, warpMode);
  const folded = warpMode === "fold" ? Math.abs(Math.sin(harmonic * 0.58 + frame * 4)) * shapedWarp * 0.22 / Math.sqrt(harmonic) : 0;
  const pinched = warpMode === "pinch" ? Math.exp(-Math.pow((harmonic - (2 + frame * 10)) / (1.8 + shapedWarp * 3), 2)) * shapedWarp * 0.34 : 0;
  switch (bank) {
    case "glass":
      return Math.exp(-harmonic * (0.045 + frame * 0.025)) * (odd ? 1 : 0.22 + shapedWarp * 0.45) * (1 + Math.sin(harmonic * 1.7 + frame * 5) * 0.18) + folded + pinched;
    case "vocal": {
      const formantA = Math.exp(-Math.pow((harmonic - (3 + frame * 9)) / (1.4 + shapedWarp * 3), 2));
      const formantB = Math.exp(-Math.pow((harmonic - (11 + frame * 18)) / (2.5 + shapedWarp * 6), 2));
      return (formantA * 1.4 + formantB * 0.9 + (odd ? 0.08 : 0.03)) / Math.sqrt(harmonic) + folded + pinched;
    }
    case "organ":
      return [1, 0, 0.55, 0.22, 0.38, 0, 0.18, 0.1][(harmonic - 1) % 8] * Math.exp(-frame * harmonic * 0.01) + (shapedWarp * 0.08) / harmonic + folded + pinched;
    case "fm":
      return Math.abs(Math.sin(harmonic * (0.45 + frame * 0.9))) * Math.exp(-harmonic * (0.028 + (1 - shapedWarp) * 0.028)) / Math.sqrt(harmonic) + folded + pinched;
    case "aether":
    default:
      return Math.exp(-harmonic * (0.022 + frame * 0.04)) * (odd ? 1 : frame * 0.8 + shapedWarp * 0.35) / Math.sqrt(harmonic) + folded + pinched;
  }
}

function harmonicPhaseForBank(bank, harmonic, frame, warp, warpMode) {
  const modePhase = warpMode === "fold"
    ? Math.sin(harmonic * 0.47 + frame * Math.PI) * warpModeIntensity(warp, warpMode) * 0.55
    : warpMode === "pinch"
      ? Math.cos(harmonic * 0.33 + frame) * warpModeIntensity(warp, warpMode) * 0.3
      : 0;
  if (bank === "fm" || bank === "glass") return Math.sin(harmonic * 0.37 + frame * Math.PI) * 0.8 + modePhase;
  if (bank === "vocal") return frame * harmonic * 0.08 + modePhase;
  return modePhase;
}

function oscillatorSample(waveform, phase, color) {
  const p = ((phase % 1) + 1) % 1;
  switch (waveform) {
    case "sine":
      return Math.sin(p * Math.PI * 2) * (1 - Math.abs(color - 0.5) * 0.2) + Math.sin(p * Math.PI * 4) * (color - 0.5) * 0.35;
    case "triangle": {
      const skew = 0.5 + (color - 0.5) * 0.7;
      return p < skew ? -1 + (p / skew) * 2 : 1 - ((p - skew) / (1 - skew)) * 2;
    }
    case "square":
      return p < 0.5 + (color - 0.5) * 0.8 ? 1 : -1;
    case "saw": {
      const shaped = color < 0.5 ? Math.pow(p, 1 + (0.5 - color) * 2) : 1 - Math.pow(1 - p, 1 + (color - 0.5) * 2);
      return shaped * 2 - 1;
    }
    default:
      return 0;
  }
}

function resonantFilter(input, filter, cutoff, resonance, type) {
  const minHz = 50;
  const maxHz = Math.min(16000, sampleRate * 0.45);
  if (Math.abs(cutoff - filter.cutoff) > 0.0005 || Math.abs(resonance - filter.resonance) > 0.0005) {
    const cutoffHz = minHz * Math.pow(maxHz / minHz, cutoff);
    filter.f = Math.min(0.98, 2 * Math.sin(Math.PI * cutoffHz / sampleRate));
    filter.damping = 1.45 - resonance * 1.25;
    filter.cutoff = cutoff;
    filter.resonance = resonance;
  }
  filter.low = clamp(filter.low + filter.f * filter.band, -4, 4);
  const high = input - filter.low - filter.damping * filter.band;
  filter.band = clamp(filter.band + filter.f * high, -4, 4);
  if (type === "highpass") return clamp(high, -1.2, 1.2);
  if (type === "bandpass") return clamp(filter.band * (1 + resonance), -1.2, 1.2);
  return clamp(filter.low + filter.band * resonance * 1.6, -1.2, 1.2);
}

function modulationAtTime(instrument, timeS, durationS, bpm = 120, velocity = 1, keytrack = 0, modWheel = 0) {
  const rawLfo = lfoShape(
    instrument.lfoWaveform || "sine",
    timeS * effectiveLfoRateHz(instrument, 1, bpm) + (Number(instrument.lfoPhase) || 0) + effectiveLfoRandomPhaseOffset(instrument, 1),
    instrument.synthPatch?.parameters?.["lfo.1.oneShot"] === true || instrument.lfoOneShot === true,
    effectiveLfoSmoothing(instrument, 1),
  );
  const rawLfo2 = lfoShape(
    instrument.lfo2Waveform || "triangle",
    timeS * effectiveLfoRateHz(instrument, 2, bpm) + (Number(instrument.lfo2Phase) || 0) + effectiveLfoRandomPhaseOffset(instrument, 2),
    instrument.synthPatch?.parameters?.["lfo.2.oneShot"] === true || instrument.lfo2OneShot === true,
    effectiveLfoSmoothing(instrument, 2),
  );
  const env = envelopeValue(timeS, durationS, instrument);
  const env2 = modEnvelopeValue(timeS, durationS, instrument);
  const offsets = {};
  const routes = instrument.synthPatch?.modulation;
  if (Array.isArray(routes)) {
    for (const route of routes) {
      if (route.enabled === false || !isRuntimeModulationTarget(route.target) || !route.amount) continue;
      const source = modulationSourceValue(instrument, route, rawLfo, rawLfo2, env, env2, velocity, keytrack, modWheel);
      if (source == null) continue;
      offsets[route.target] = (offsets[route.target] || 0) + source * clamp(route.amount, -1, 1) * targetScale(route.target);
    }
    return { pitchSemitones: 0, filterOffset: 0, positionOffset: 0, ampEnvelope: env, targetOffsets: offsets };
  }
  const positionLfo = lfoRoute(rawLfo, instrument.lfoPositionBipolar ?? true);
  const pitchLfo = lfoRoute(rawLfo, instrument.lfoPitchBipolar ?? true);
  const filterLfo = lfoRoute(rawLfo, instrument.lfoFilterBipolar ?? true);
  return {
    pitchSemitones: pitchLfo * Math.max(0, instrument.lfoToPitch || 0),
    filterOffset: filterLfo * clamp(instrument.lfoToFilter || 0, -1, 1) * 0.35 + env * clamp(instrument.envToFilter || 0, -1, 1) * 0.35,
    positionOffset: positionLfo * clamp01(instrument.lfoDepth || 0),
    ampEnvelope: env,
    targetOffsets: offsets,
  };
}

function modulationSourceValue(instrument, route, rawLfo, rawLfo2, env, env2, velocity, keytrack, modWheel) {
  if (route.source === "lfo.1") {
    if (instrument.synthPatch?.parameters?.["lfo.1.enabled"] === false) return 0;
    return lfoRoute(rawLfo, route.bipolar !== false);
  }
  if (route.source === "lfo.2") {
    if (instrument.synthPatch?.parameters?.["lfo.2.enabled"] !== true && instrument.lfo2Enabled !== true) return 0;
    return lfoRoute(rawLfo2, route.bipolar !== false);
  }
  if (route.source === "env.1") return route.bipolar ? env * 2 - 1 : env;
  if (route.source === "env.2") return route.bipolar ? env2 * 2 - 1 : env2;
  if (route.source === "velocity") return route.bipolar ? velocity * 2 - 1 : velocity;
  if (route.source === "keytrack") return route.bipolar ? keytrack * 2 - 1 : keytrack;
  if (route.source === "modWheel") {
    const value = clamp01(modWheel);
    return route.bipolar ? value * 2 - 1 : value;
  }
  if (isMacroAutomationTarget(route.source)) {
    const value = clamp01(Number(instrument.synthPatch?.parameters?.[route.source]) || 0);
    return route.bipolar ? value * 2 - 1 : value;
  }
  return null;
}

function targetOffset(modulation, target) {
  const value = modulation.targetOffsets?.[target] || 0;
  return Number.isFinite(value) ? value : 0;
}

function applyAutomationOffsets(instrument, modulation, automation, timeS) {
  if (!Array.isArray(automation) || automation.length === 0) return;
  for (const lane of automation) {
    if (!isRuntimeModulationTarget(lane.target) || !Array.isArray(lane.points) || lane.points.length === 0) continue;
    const value = automationValueAtTime(lane.points, timeS);
    if (value == null) continue;
    const base = baseAutomationValue(instrument, lane.target);
    if (base == null) continue;
    modulation.targetOffsets[lane.target] = (modulation.targetOffsets[lane.target] || 0) + value - base;
  }
}

function baseAutomationValue(instrument, target) {
  switch (target) {
    case "osc.a.position": return instrument.aether?.oscA?.wavetable?.position ?? instrument.wavetable?.position ?? 0;
    case "osc.b.position": return instrument.aether?.oscB?.wavetable?.position ?? instrument.wavetable?.position ?? 0;
    case "osc.a.warp": return instrument.aether?.oscA?.wavetable?.warp ?? instrument.wavetable?.warp ?? 0;
    case "osc.b.warp": return instrument.aether?.oscB?.wavetable?.warp ?? instrument.wavetable?.warp ?? 0;
    case "osc.a.fine": return instrument.aether?.oscA?.fineCents ?? 0;
    case "osc.b.fine": return instrument.aether?.oscB?.fineCents ?? 0;
    case "osc.a.level": return instrument.aether?.oscA?.level ?? 0;
    case "osc.b.level": return instrument.aether?.oscB?.level ?? 0;
    case "osc.a.pan": return instrument.aether?.oscA?.pan ?? 0;
    case "osc.b.pan": return instrument.aether?.oscB?.pan ?? 0;
    case "osc.a.phase": return instrument.aether?.oscA?.phase ?? 0;
    case "osc.b.phase": return instrument.aether?.oscB?.phase ?? 0;
    case "filter.cutoff": return instrument.knobs?.cutoff ?? 1;
    case "filter.resonance": return instrument.knobs?.resonance ?? 0;
    case "filter.drive": return instrument.knobs?.drive ?? 0;
    case "amp.level": return instrument.ampLevel ?? 1;
    case "amp.pan": return instrument.ampPan ?? 0;
    case "unison.detune": return instrument.wavetable?.detuneCents ?? instrument.aether?.oscA?.wavetable?.detuneCents ?? 0;
    case "unison.spread": return instrument.wavetable?.blend ?? instrument.aether?.oscA?.wavetable?.blend ?? 0;
    default: return null;
  }
}

function automationValueAtTime(points, timeS) {
  if (timeS <= points[0].timeS) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    if (timeS > next.timeS) continue;
    const mix = clamp01((timeS - prev.timeS) / Math.max(0.0001, next.timeS - prev.timeS));
    return prev.value + (next.value - prev.value) * smoothstep(mix);
  }
  return points[points.length - 1].value;
}

function isRuntimeModulationTarget(value) {
  return [
    "osc.a.position",
    "osc.a.warp",
    "osc.a.fine",
    "osc.a.level",
    "osc.a.pan",
    "osc.a.phase",
    "osc.b.position",
    "osc.b.warp",
    "osc.b.fine",
    "osc.b.level",
    "osc.b.pan",
    "osc.b.phase",
    "filter.cutoff",
    "filter.resonance",
    "filter.drive",
    "amp.level",
    "amp.pan",
    "unison.detune",
    "unison.spread",
  ].includes(value);
}

function isMacroAutomationTarget(value) {
  return value === "macro.1" || value === "macro.2" || value === "macro.3" || value === "macro.4";
}

function targetScale(target) {
  if (target.endsWith(".fine") || target === "unison.detune") return 100;
  if (target === "filter.cutoff") return 0.35;
  return 1;
}

function filterKeytrackOffset(instrument, frequency) {
  const keytrack = clamp01(instrument.filterKeytrack ?? 0);
  if (keytrack <= 0 || !Number.isFinite(frequency) || frequency <= 0) return 0;
  const minHz = 50;
  const maxHz = Math.min(16000, sampleRate * 0.45);
  const octaveOffset = Math.log2(frequency / 261.6255653005986);
  return (octaveOffset * keytrack) / Math.log2(maxHz / minHz);
}

function keytrackSourceValue(frequency) {
  if (!Number.isFinite(frequency) || frequency <= 0) return 0;
  const midi = 69 + 12 * Math.log2(frequency / 440);
  return clamp01(midi / 127);
}

function syncedLfoDivisionBeats(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const dotted = raw.endsWith("d");
  const triplet = raw.endsWith("t");
  const core = dotted || triplet ? raw.slice(0, -1) : raw;
  const match = core.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!match) return 1;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return 1;
  let beats = (numerator / denominator) * 4;
  if (dotted) beats *= 1.5;
  if (triplet) beats *= 2 / 3;
  return clamp(beats, 1 / 64, 64);
}

function syncedLfoRateHz(value, bpm) {
  const safeBpm = Math.max(1, Number.isFinite(bpm) ? bpm : 120);
  return clamp((safeBpm / 60) / syncedLfoDivisionBeats(value), 0.01, 50);
}

function effectiveLfoRateHz(instrument, lfo, bpm) {
  const params = instrument.synthPatch?.parameters;
  if (lfo === 1) {
    const sync = params?.["lfo.1.sync"] === true || instrument.lfoSync === true;
    if (sync) return syncedLfoRateHz(params?.["lfo.1.syncedRate"] ?? instrument.lfoSyncedRate ?? "1/4", bpm);
    return Math.max(0.01, Number(instrument.lfoRateHz) || 4);
  }

  const sync = params?.["lfo.2.sync"] === true || instrument.lfo2Sync === true;
  if (sync) return syncedLfoRateHz(params?.["lfo.2.syncedRate"] ?? instrument.lfo2SyncedRate ?? "1/2", bpm);
  return Math.max(0.01, Number(instrument.lfo2RateHz) || 0.5);
}

function effectiveLfoSmoothing(instrument, lfo) {
  const params = instrument.synthPatch?.parameters;
  if (lfo === 1) return clamp01(Number(params?.["lfo.1.smoothing"] ?? instrument.lfoSmoothing ?? 0));
  return clamp01(Number(params?.["lfo.2.smoothing"] ?? instrument.lfo2Smoothing ?? 0));
}

function effectiveLfoRandomPhaseOffset(instrument, lfo) {
  const params = instrument.synthPatch?.parameters;
  const amount = lfo === 1
    ? clamp01(Number(params?.["lfo.1.randomPhase"] ?? instrument.lfoRandomPhase ?? 0))
    : clamp01(Number(params?.["lfo.2.randomPhase"] ?? instrument.lfo2RandomPhase ?? 0));
  if (amount <= 0) return 0;
  return deterministicUnitHash(`${instrument.id || ""}|${instrument.name || ""}|lfo.${lfo}`) * amount;
}

function deterministicUnitHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) & 0x00ffffff) / 0x01000000;
}

function lfoShape(shape, cycles, oneShot = false, smoothing = 0) {
  const phase = oneShot ? clamp(cycles, 0, 1) : cycles - Math.floor(cycles);
  const sine = Math.sin(phase * Math.PI * 2);
  let shaped;
  switch (shape) {
    case "square": shaped = phase < 0.5 ? 1 : -1; break;
    case "saw": shaped = phase * 2 - 1; break;
    case "triangle": shaped = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4; break;
    default: return sine;
  }
  return shaped + (sine - shaped) * clamp01(smoothing);
}

function lfoRoute(raw, bipolar) {
  return bipolar ? raw : (raw + 1) * 0.5;
}

function envelopeValue(timeS, durationS, instrument) {
  const env = instrument.envelope || {};
  const params = instrument.synthPatch?.parameters;
  const attack = Math.max(0.001, (env.attackMs ?? 5) / 1000);
  const decay = Math.max(0.001, (env.decayMs ?? 100) / 1000);
  const sustain = clamp01(env.sustain ?? 0.7);
  const release = Math.max(0.001, (env.releaseMs ?? 200) / 1000);
  const attackCurve = envelopeCurveParam(params?.["env.1.attackCurve"] ?? env.attackCurve);
  const decayCurve = envelopeCurveParam(params?.["env.1.decayCurve"] ?? env.decayCurve);
  const releaseCurve = envelopeCurveParam(params?.["env.1.releaseCurve"] ?? env.releaseCurve);
  const segmentValue = (time) => {
    if (time < attack) return applyEnvelopeCurve(time / attack, attackCurve);
    const t = applyEnvelopeCurve(Math.min(1, (time - attack) / decay), decayCurve);
    return 1 + (sustain - 1) * t;
  };
  const releaseStart = Math.max(attack + decay, durationS - release);
  if (params?.["env.1.loop"] === true || env.loop === true) {
    const cycleLength = Math.max(0.001, attack + decay);
    if (timeS > releaseStart) {
      const releaseValue = segmentValue(releaseStart % cycleLength);
      const t = applyEnvelopeCurve((timeS - releaseStart) / release, releaseCurve);
      return releaseValue * Math.max(0, 1 - t);
    }
    return segmentValue(timeS % cycleLength);
  }
  if (timeS < attack) return applyEnvelopeCurve(timeS / attack, attackCurve);
  if (timeS < attack + decay) {
    const t = applyEnvelopeCurve((timeS - attack) / decay, decayCurve);
    return 1 + (sustain - 1) * t;
  }
  if (timeS > releaseStart) {
    const t = applyEnvelopeCurve((timeS - releaseStart) / release, releaseCurve);
    return sustain * Math.max(0, 1 - t);
  }
  return sustain;
}

function modEnvelopeValue(timeS, durationS, instrument) {
  const params = instrument.synthPatch?.parameters;
  const attack = Math.max(0.001, numberParam(params?.["env.2.attack"], 0.01));
  const decay = Math.max(0.001, numberParam(params?.["env.2.decay"], 0.3));
  const sustain = clamp01(numberParam(params?.["env.2.sustain"], 0));
  const release = Math.max(0.001, numberParam(params?.["env.2.release"], 0.2));
  const attackCurve = envelopeCurveParam(params?.["env.2.attackCurve"]);
  const decayCurve = envelopeCurveParam(params?.["env.2.decayCurve"]);
  const releaseCurve = envelopeCurveParam(params?.["env.2.releaseCurve"]);
  const segmentValue = (time) => {
    if (time < attack) return applyEnvelopeCurve(time / attack, attackCurve);
    const t = applyEnvelopeCurve(Math.min(1, (time - attack) / decay), decayCurve);
    return 1 + (sustain - 1) * t;
  };
  const releaseStart = Math.max(attack + decay, durationS - release);
  if (params?.["env.2.loop"] === true) {
    const cycleLength = Math.max(0.001, attack + decay);
    if (timeS > releaseStart) {
      const releaseValue = segmentValue(releaseStart % cycleLength);
      const t = applyEnvelopeCurve((timeS - releaseStart) / release, releaseCurve);
      return releaseValue * Math.max(0, 1 - t);
    }
    return segmentValue(timeS % cycleLength);
  }
  if (timeS < attack) return applyEnvelopeCurve(timeS / attack, attackCurve);
  if (timeS < attack + decay) {
    const t = applyEnvelopeCurve((timeS - attack) / decay, decayCurve);
    return 1 + (sustain - 1) * t;
  }
  if (timeS > releaseStart) {
    const t = applyEnvelopeCurve((timeS - releaseStart) / release, releaseCurve);
    return sustain * Math.max(0, 1 - t);
  }
  return sustain;
}

function numberParam(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function envelopeCurveParam(value) {
  return value === "exp" || value === "log" || value === "s-curve" ? value : "linear";
}

function applyEnvelopeCurve(value, curve) {
  const x = clamp01(value);
  if (curve === "exp") return x * x;
  if (curve === "log") return 1 - (1 - x) * (1 - x);
  if (curve === "s-curve") return x * x * (3 - 2 * x);
  return x;
}

function oscillatorRate(octave, semitone, fineCents) {
  return Math.pow(2, octave + semitone / 12 + fineCents / 1200);
}

function unisonVoicePlan(unison, detune, blend) {
  const rates = [];
  const phaseOffsets = [];
  const weights = [];
  let weightSum = 0;
  for (let voice = 0; voice < unison; voice++) {
    const centered = unison === 1 ? 0 : (voice / (unison - 1)) * 2 - 1;
    const weight = voice === 0 ? 1 : 0.72;
    rates.push(Math.pow(2, (centered * detune) / 1200));
    phaseOffsets.push(voice * 0.071 * blend);
    weights.push(weight);
    weightSum += weight;
  }
  return { rates, phaseOffsets, weights, weightSum };
}

function nextNoise(state) {
  state.noiseState = (state.noiseState * 1664525 + 1013904223) >>> 0;
  return (((state.noiseState >>> 8) / 8388607.5) - 1);
}

function panGains(pan) {
  const normalized = (clamp(pan, -1, 1) + 1) * 0.5;
  const angle = normalized * Math.PI * 0.5;
  return [Math.cos(angle), Math.sin(angle)];
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function smoothstep(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function glideFrequencyAtTime(frequency, targetFrequency, timeS, durationS) {
  if (!targetFrequency || Math.abs(targetFrequency - frequency) <= 0.01) return frequency;
  const glideStart = durationS * 0.45;
  const mix = smoothstep((timeS - glideStart) / Math.max(0.001, durationS - glideStart));
  return frequency + (targetFrequency - frequency) * mix;
}

function normalizeFrequencyCurve(curve, durationS, fallbackFrequency) {
  if (!Array.isArray(curve)) return [];
  const clean = curve
    .filter((point) => Number.isFinite(point?.timeS) && Number.isFinite(point?.frequency))
    .map((point) => ({
      timeS: clamp(point.timeS, 0, durationS),
      frequency: clamp(point.frequency, 20, 20000),
    }))
    .sort((a, b) => a.timeS - b.timeS);
  if (clean.length === 0) return [];
  if (clean[0].timeS > 0) clean.unshift({ timeS: 0, frequency: fallbackFrequency });
  if (clean[clean.length - 1].timeS < durationS) clean.push({ timeS: durationS, frequency: clean[clean.length - 1].frequency });
  return clean;
}

function frequencyAtCurveTime(curve, timeS) {
  if (timeS <= curve[0].timeS) return curve[0].frequency;
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1];
    const next = curve[i];
    if (timeS > next.timeS) continue;
    const mix = smoothstep((timeS - prev.timeS) / Math.max(0.001, next.timeS - prev.timeS));
    return prev.frequency + (next.frequency - prev.frequency) * mix;
  }
  return curve[curve.length - 1].frequency;
}

function normalizeAutomation(automation) {
  if (!Array.isArray(automation)) return [];
  return automation
    .filter((lane) => isRuntimeModulationTarget(lane?.target) && Array.isArray(lane?.points))
    .map((lane) => ({
      target: lane.target,
      points: lane.points
        .filter((point) => Number.isFinite(point?.timeS) && Number.isFinite(point?.value))
        .map((point) => ({ timeS: Math.max(0, Number(point.timeS)), value: Number(point.value) }))
        .sort((a, b) => a.timeS - b.timeS),
    }))
    .filter((lane) => lane.points.length > 0);
}

registerProcessor("aether-preview-processor", AetherPreviewProcessor);
