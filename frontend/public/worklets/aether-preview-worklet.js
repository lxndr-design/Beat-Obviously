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
      const modulation = modulationAtTime(this.instrument, timeS, durationS, this.bpm);
      applyAutomationOffsets(this.instrument, modulation, this.automation, timeS);
      const baseFrequency = this.curve.length > 1
        ? frequencyAtCurveTime(this.curve, timeS)
        : glideFrequencyAtTime(this.frequency, this.targetFrequency, timeS, durationS);
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
  const cutoff = clamp01((instrument.knobs?.cutoff ?? 0.6) + modulation.filterOffset + targetOffset(modulation, "filter.cutoff"));
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
  const pan = (instrument.ampPan ?? 0) + targetOffset(modulation, "amp.pan");
  const gains = panGains(pan);
  return {
    left: left * level * gains[0],
    right: right * level * gains[1],
  };
}

function renderAetherStack(instrument, state, frequency, modulation) {
  const config = instrument.aether;
  if (!config) {
    const sample = wavetableOscillatorSample(instrument, state, state.phase, frequency, instrument.wavetable, modulation.positionOffset, targetOffset(modulation, "unison.detune"), targetOffset(modulation, "unison.spread"));
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
    const value = waveform === "wavetable"
      ? wavetableOscillatorSample(instrument, state, state.phase * rate, frequency * rate, osc.wavetable, positionOffset, targetOffset(modulation, "unison.detune"), targetOffset(modulation, "unison.spread"))
      : waveform === "noise"
        ? nextNoise(state)
        : oscillatorSample(waveform, state.phase * rate, clamp01(instrument.knobs?.color ?? 0.5));
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

function wavetableOscillatorSample(instrument, state, phase, frequency, config, positionOffset, detuneOffset, spreadOffset) {
  const tableConfig = config || instrument.wavetable || { bank: "aether", position: 0.35, warp: 0.2, unison: 1, detuneCents: 12, blend: 0.5 };
  const unison = Math.max(1, Math.min(8, Math.round(tableConfig.unison || 1)));
  const detune = Math.max(0, Math.min(100, (tableConfig.detuneCents || 0) + (detuneOffset || 0)));
  const blend = clamp01((tableConfig.blend || 0) + (spreadOffset || 0));
  const plan = unisonVoicePlan(unison, detune, blend);
  let sum = 0;
  for (let voice = 0; voice < unison; voice++) {
    const rate = plan.rates[voice];
    sum += wavetableFrameMorph(instrument, state, tableConfig, phase * rate + plan.phaseOffsets[voice], frequency * rate, clamp01((tableConfig.position || 0) + (positionOffset || 0)), tableConfig.warp || 0) * plan.weights[voice];
  }
  return clamp(sum / Math.max(1, plan.weightSum), -1, 1);
}

function wavetableFrameMorph(instrument, state, config, phase, frequency, position, warp) {
  const table = getWavetable(instrument, state, config, frequency, warp);
  const pos = clamp01(position) * (table.frameCount - 1);
  const base = Math.floor(pos);
  const frac = pos - base;
  const y1 = tableSample(table, base, phase);
  const y2 = tableSample(table, base + 1, phase);
  return y1 + (y2 - y1) * frac;
}

function getWavetable(instrument, state, config, frequency, warp) {
  const custom = config.bank === "custom" ? customWavetableForInstrument(instrument, config.customId) : null;
  const harmonicLimit = Math.min(32, Math.max(1, Math.floor((sampleRate * 0.48) / Math.max(20, frequency))));
  const key = wavetableKey(config, custom, harmonicLimit, warp);
  const cached = state.tableCache.get(key);
  if (cached) return cached;
  const table = createWavetable(config, custom, harmonicLimit, warp);
  state.tableCache.set(key, table);
  return table;
}

function wavetableKey(config, custom, harmonicLimit, warp) {
  const customKey = custom ? custom.frames.map((frame) => [frame.brightness, frame.even, frame.fold, frame.phase].map((value) => Number(value || 0).toFixed(3)).join(",")).join(";") : "";
  return [config.bank, config.customId || "", harmonicLimit, clamp01(warp || 0).toFixed(3), customKey].join("|");
}

function createWavetable(config, custom, harmonicLimit, warp) {
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
        const amp = customFrame ? customAmp(customFrame, harmonic, warp) : harmonicAmp(config.bank, harmonic, normalizedFrame, warp);
        if (amp <= 0.0001) continue;
        const harmonicPhase = customFrame ? customPhase(customFrame, harmonic, warp) : harmonicPhaseForBank(config.bank, harmonic, normalizedFrame);
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

function customAmp(frame, harmonic, warp) {
  const brightness = clamp01(frame.brightness);
  const even = clamp01(frame.even);
  const fold = clamp01(frame.fold + clamp01(warp) * 0.35);
  const parity = harmonic % 2 === 1 ? 1 : even;
  const rolloff = Math.exp(-harmonic * (0.016 + (1 - brightness) * 0.085));
  const foldPeak = Math.exp(-Math.pow((harmonic - (3 + brightness * 20)) / (1.6 + fold * 8), 2));
  const motion = 1 + Math.sin(harmonic * 1.7 + frame.phase * Math.PI) * fold * 0.28;
  return Math.max(0, parity * rolloff * motion / Math.sqrt(harmonic) + foldPeak * fold * 0.35);
}

function customPhase(frame, harmonic, warp) {
  return frame.phase * harmonic * 0.28 + Math.sin(harmonic * 0.41) * clamp01(frame.fold + clamp01(warp) * 0.25) * 0.55;
}

function harmonicAmp(bank, harmonic, frame, warp) {
  const odd = harmonic % 2 === 1;
  switch (bank) {
    case "glass":
      return Math.exp(-harmonic * (0.045 + frame * 0.025)) * (odd ? 1 : 0.22 + warp * 0.45) * (1 + Math.sin(harmonic * 1.7 + frame * 5) * 0.18);
    case "vocal": {
      const formantA = Math.exp(-Math.pow((harmonic - (3 + frame * 9)) / (1.4 + warp * 3), 2));
      const formantB = Math.exp(-Math.pow((harmonic - (11 + frame * 18)) / (2.5 + warp * 6), 2));
      return (formantA * 1.4 + formantB * 0.9 + (odd ? 0.08 : 0.03)) / Math.sqrt(harmonic);
    }
    case "organ":
      return [1, 0, 0.55, 0.22, 0.38, 0, 0.18, 0.1][(harmonic - 1) % 8] * Math.exp(-frame * harmonic * 0.01) + (warp * 0.08) / harmonic;
    case "fm":
      return Math.abs(Math.sin(harmonic * (0.45 + frame * 0.9))) * Math.exp(-harmonic * (0.028 + (1 - warp) * 0.028)) / Math.sqrt(harmonic);
    case "aether":
    default:
      return Math.exp(-harmonic * (0.022 + frame * 0.04)) * (odd ? 1 : frame * 0.8 + warp * 0.35) / Math.sqrt(harmonic);
  }
}

function harmonicPhaseForBank(bank, harmonic, frame) {
  if (bank === "fm" || bank === "glass") return Math.sin(harmonic * 0.37 + frame * Math.PI) * 0.8;
  if (bank === "vocal") return frame * harmonic * 0.08;
  return 0;
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

function modulationAtTime(instrument, timeS, durationS, bpm = 120) {
  const rawLfo = lfoShape(
    instrument.lfoWaveform || "sine",
    timeS * effectiveLfoRateHz(instrument, 1, bpm) + (Number(instrument.lfoPhase) || 0),
    instrument.synthPatch?.parameters?.["lfo.1.oneShot"] === true || instrument.lfoOneShot === true,
  );
  const rawLfo2 = lfoShape(
    instrument.lfo2Waveform || "triangle",
    timeS * effectiveLfoRateHz(instrument, 2, bpm) + (Number(instrument.lfo2Phase) || 0),
    instrument.synthPatch?.parameters?.["lfo.2.oneShot"] === true || instrument.lfo2OneShot === true,
  );
  const env = envelopeValue(timeS, durationS, instrument);
  const offsets = {};
  const routes = instrument.synthPatch?.modulation;
  if (Array.isArray(routes)) {
    for (const route of routes) {
      if (route.enabled === false || !route.target || !route.amount) continue;
      const source = route.source === "env.1"
        ? (route.bipolar ? env * 2 - 1 : env)
        : route.source === "lfo.1"
          ? lfoRoute(rawLfo, route.bipolar !== false)
          : route.source === "lfo.2"
            ? lfoRoute(rawLfo2, route.bipolar !== false)
            : null;
      if (source == null) continue;
      offsets[route.target] = (offsets[route.target] || 0) + source * clamp(route.amount, -1, 1) * targetScale(route.target);
    }
    return { pitchSemitones: 0, filterOffset: 0, positionOffset: 0, targetOffsets: offsets };
  }
  const positionLfo = lfoRoute(rawLfo, instrument.lfoPositionBipolar ?? true);
  const pitchLfo = lfoRoute(rawLfo, instrument.lfoPitchBipolar ?? true);
  const filterLfo = lfoRoute(rawLfo, instrument.lfoFilterBipolar ?? true);
  return {
    pitchSemitones: pitchLfo * Math.max(0, instrument.lfoToPitch || 0),
    filterOffset: filterLfo * clamp(instrument.lfoToFilter || 0, -1, 1) * 0.35 + env * clamp(instrument.envToFilter || 0, -1, 1) * 0.35,
    positionOffset: positionLfo * clamp01(instrument.lfoDepth || 0),
    targetOffsets: offsets,
  };
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
    case "osc.a.fine": return instrument.aether?.oscA?.fineCents ?? 0;
    case "osc.b.fine": return instrument.aether?.oscB?.fineCents ?? 0;
    case "osc.a.level": return instrument.aether?.oscA?.level ?? 0;
    case "osc.b.level": return instrument.aether?.oscB?.level ?? 0;
    case "osc.a.pan": return instrument.aether?.oscA?.pan ?? 0;
    case "osc.b.pan": return instrument.aether?.oscB?.pan ?? 0;
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
    "osc.a.fine",
    "osc.a.level",
    "osc.a.pan",
    "osc.b.position",
    "osc.b.fine",
    "osc.b.level",
    "osc.b.pan",
    "filter.cutoff",
    "filter.resonance",
    "filter.drive",
    "amp.level",
    "amp.pan",
    "unison.detune",
    "unison.spread",
  ].includes(value);
}

function targetScale(target) {
  if (target.endsWith(".fine") || target === "unison.detune") return 100;
  if (target === "filter.cutoff") return 0.35;
  return 1;
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

function lfoShape(shape, cycles, oneShot = false) {
  const phase = oneShot ? clamp(cycles, 0, 1) : cycles - Math.floor(cycles);
  switch (shape) {
    case "square": return phase < 0.5 ? 1 : -1;
    case "saw": return phase * 2 - 1;
    case "triangle": return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
    default: return Math.sin(phase * Math.PI * 2);
  }
}

function lfoRoute(raw, bipolar) {
  return bipolar ? raw : (raw + 1) * 0.5;
}

function envelopeValue(timeS, durationS, instrument) {
  const env = instrument.envelope || {};
  const attack = Math.max(0.001, (env.attackMs ?? 5) / 1000);
  const decay = Math.max(0.001, (env.decayMs ?? 100) / 1000);
  const sustain = clamp01(env.sustain ?? 0.7);
  const release = Math.max(0.001, (env.releaseMs ?? 200) / 1000);
  if (timeS < attack) return timeS / attack;
  if (timeS < attack + decay) return 1 + (sustain - 1) * ((timeS - attack) / decay);
  const releaseStart = Math.max(attack + decay, durationS - release);
  if (timeS > releaseStart) return sustain * Math.max(0, 1 - (timeS - releaseStart) / release);
  return sustain;
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
