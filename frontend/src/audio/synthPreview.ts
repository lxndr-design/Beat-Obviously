import type { CustomWavetableDefinition, CustomWavetableFrame, EnvelopeCurve, Instrument, WavetableConfig } from "../state/types";

export type SynthRenderMode = "visual" | "audio";

export interface SynthRenderState {
  phase: number;
  index: number;
  low: number;
  band: number;
  filterCutoff: number;
  filterResonance: number;
  filterF: number;
  filterDamping: number;
}

interface RenderModulation {
  pitchSemitones: number;
  filterOffset: number;
  positionOffset: number;
  targetOffsets: Partial<Record<RuntimeModulationTarget, number>>;
}

type RuntimeModulationTarget =
  | "osc.a.position"
  | "osc.a.fine"
  | "osc.a.level"
  | "osc.a.pan"
  | "osc.b.position"
  | "osc.b.fine"
  | "osc.b.level"
  | "osc.b.pan"
  | "filter.cutoff"
  | "filter.resonance"
  | "filter.drive"
  | "amp.level"
  | "amp.pan"
  | "unison.detune"
  | "unison.spread";

export type SynthAutomationTarget = RuntimeModulationTarget;

export interface SynthAutomationLane {
  target: SynthAutomationTarget;
  points: Array<{ timeS: number; value: number }>;
}

interface RuntimeModulationRoute {
  source?: string;
  target?: string;
  amount?: number;
  bipolar?: boolean;
  enabled?: boolean;
}

export const SYNTH_PREVIEW_MIDI_PITCH = 60;
export const SYNTH_PREVIEW_BASE_HZ = 440 * Math.pow(2, (SYNTH_PREVIEW_MIDI_PITCH - 69) / 12);

const sampleBufferCache = new Map<string, AudioBuffer>();
const sampleLoadPromises = new Map<string, Promise<void>>();
const sampleRoundRobinIndex = new Map<string, number>();
const renderedInstrumentBufferCache = new Map<string, AudioBuffer>();
const unisonVoicePlanCache = new Map<string, UnisonVoicePlan>();
const oscillatorRateCache = new Map<string, number>();

const MAX_RENDERED_INSTRUMENT_BUFFERS = 32;
const MAX_UNISON_VOICE_PLANS = 96;
const MAX_OSCILLATOR_RATE_ENTRIES = 128;

interface SamplePlaybackTarget {
  url: string;
  rootNote: number;
  tuning: number;
  gain: number;
  durationSeconds?: number;
  loLengthSeconds?: number;
  hiLengthSeconds?: number;
  startSample?: number;
  endSample?: number;
}

interface UnisonVoicePlan {
  rates: number[];
  phaseOffsets: number[];
  weights: number[];
  weightSum: number;
}

export function createSynthRenderState(): SynthRenderState {
  return { phase: 0, index: 0, low: 0, band: 0, filterCutoff: -1, filterResonance: -1, filterF: 0, filterDamping: 1 };
}

export function noteFrequency(midiPitch: number, instrument?: Instrument): number {
  const octave = instrument?.octave ?? 0;
  const detune = instrument?.detuneCents ?? 0;
  return midiFrequency(midiPitch) * Math.pow(2, octave + detune / 1200);
}

export function previewFrequency(instrument: Instrument): number {
  const detune = instrument.detuneCents ?? 0;
  return SYNTH_PREVIEW_BASE_HZ * Math.pow(2, detune / 1200);
}

export function renderInstrumentSamples(
  instrument: Instrument,
  out: ArrayLike<number> & { [index: number]: number },
  sampleRate: number,
  frequency: number,
  mode: SynthRenderMode,
  fade = false,
  targetFrequency?: number,
  curve?: Array<{ timeS: number; frequency: number }>,
  automation?: SynthAutomationLane[],
  bpm = 120,
  velocity = 127,
) {
  const state = createSynthRenderState();
  const durationS = out.length / sampleRate;
  const velocity01 = clamp01(velocity / 127);
  const shouldGlide = targetFrequency != null && Number.isFinite(targetFrequency) && Math.abs(targetFrequency - frequency) > 0.01;
  const sortedCurve = curve?.filter((point) => Number.isFinite(point.timeS) && Number.isFinite(point.frequency))
    .sort((a, b) => a.timeS - b.timeS);

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const amp = fade ? Math.min(1, t / 0.025, (durationS - t) / 0.08) : 1;
    const glideStart = durationS * 0.45;
    const glideT = shouldGlide
      ? clamp01((t - glideStart) / Math.max(0.001, durationS - glideStart))
      : 0;
    const baseFrequency = sortedCurve && sortedCurve.length > 1
      ? frequencyAtCurveTime(sortedCurve, t)
      : shouldGlide
        ? frequency + (targetFrequency - frequency) * smoothstep(glideT)
        : frequency;
    const modulation = modulationAtTime(instrument, t, durationS, bpm, velocity01);
    applyAutomationOffsets(instrument, modulation, automation, t);
    const currentFrequency = baseFrequency * Math.pow(2, modulation.pitchSemitones / 12);
    out[i] = renderInstrumentSample(instrument, state, sampleRate, currentFrequency, mode, modulation) * amp;
  }
}

export function renderInstrumentStereoSamples(
  instrument: Instrument,
  left: ArrayLike<number> & { [index: number]: number },
  right: ArrayLike<number> & { [index: number]: number },
  sampleRate: number,
  frequency: number,
  mode: SynthRenderMode,
  fade = false,
  targetFrequency?: number,
  curve?: Array<{ timeS: number; frequency: number }>,
  automation?: SynthAutomationLane[],
  bpm = 120,
  velocity = 127,
) {
  const length = Math.min(left.length, right.length);
  if (!instrument.aether) {
    const mono = new Float32Array(length);
    renderInstrumentSamples(instrument, mono, sampleRate, frequency, mode, fade, targetFrequency, curve, automation, bpm, velocity);
    const [leftGain, rightGain] = panGains(instrument.ampPan ?? 0);
    for (let i = 0; i < length; i++) {
      left[i] = mono[i] * leftGain;
      right[i] = mono[i] * rightGain;
    }
    return;
  }

  const phaseState = createSynthRenderState();
  const leftFilterState = createSynthRenderState();
  const rightFilterState = createSynthRenderState();
  const durationS = length / sampleRate;
  const velocity01 = clamp01(velocity / 127);
  const shouldGlide = targetFrequency != null && Number.isFinite(targetFrequency) && Math.abs(targetFrequency - frequency) > 0.01;
  const sortedCurve = curve?.filter((point) => Number.isFinite(point.timeS) && Number.isFinite(point.frequency))
    .sort((a, b) => a.timeS - b.timeS);

  for (let i = 0; i < length; i++) {
    const timeS = i / sampleRate;
    const amp = fade ? Math.min(1, timeS / 0.025, (durationS - timeS) / 0.08) : 1;
    const glideStart = durationS * 0.45;
    const glideT = shouldGlide
      ? clamp01((timeS - glideStart) / Math.max(0.001, durationS - glideStart))
      : 0;
    const baseFrequency = sortedCurve && sortedCurve.length > 1
      ? frequencyAtCurveTime(sortedCurve, timeS)
      : shouldGlide
        ? frequency + (targetFrequency - frequency) * smoothstep(glideT)
        : frequency;
    const modulation = modulationAtTime(instrument, timeS, durationS, bpm, velocity01);
    applyAutomationOffsets(instrument, modulation, automation, timeS);
    const currentFrequency = baseFrequency * Math.pow(2, modulation.pitchSemitones / 12);
    const stereo = renderInstrumentStereoSample(instrument, phaseState, leftFilterState, rightFilterState, sampleRate, currentFrequency, mode, modulation);
    left[i] = stereo.left * amp;
    right[i] = stereo.right * amp;
  }
}

export function createInstrumentBufferSource(
  ctx: AudioContext,
  instrument: Instrument,
  durationS: number,
  frequency: number,
  targetFrequency?: number,
  velocity = 127,
  bpm = 120,
): AudioBufferSourceNode {
  const shouldGlide = targetFrequency != null && Number.isFinite(targetFrequency) && Math.abs(targetFrequency - frequency) > 0.01;
  const sampleTarget = nextSampleTarget(instrument, frequency, velocity, durationS);
  if (sampleTarget && sampleBufferCache.has(sampleTarget.url)) {
    const source = ctx.createBufferSource();
    source.buffer = sampleBufferWithGain(
      ctx,
      sampleTarget.url,
      sampleTarget.gain,
      sampleTarget.startSample,
      sampleTarget.endSample,
    );
    const baseFrequency = midiFrequency(sampleTarget.rootNote);
    const tuningRate = Math.pow(2, sampleTarget.tuning / 1200);
    const rate = Math.max(0.25, Math.min(4, (frequency / baseFrequency) * tuningRate));
    source.playbackRate.value = rate;
    if (shouldGlide) {
      const targetRate = Math.max(0.25, Math.min(4, (targetFrequency / baseFrequency) * tuningRate));
      source.playbackRate.setValueAtTime(rate, ctx.currentTime);
      source.playbackRate.linearRampToValueAtTime(targetRate, ctx.currentTime + Math.max(0.001, durationS * 0.85));
    }
    return source;
  }

  const buffer = renderedInstrumentBuffer(ctx, instrument, durationS, frequency, targetFrequency, bpm, velocity);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

export function createInstrumentSampleBufferSource(
  ctx: AudioContext,
  instrument: Instrument,
  sampleUrl: string,
  frequency: number,
  velocity = 127,
): AudioBufferSourceNode | null {
  if (!sampleBufferCache.has(sampleUrl)) return null;
  const source = ctx.createBufferSource();
  const zone = (instrument.sampleMap ?? [])
    .filter((candidate) => candidate.path === sampleUrl)
    .find((candidate) => velocity >= candidate.loVel && velocity <= candidate.hiVel)
    ?? (instrument.sampleMap ?? []).find((candidate) => candidate.path === sampleUrl);
  const gain = zone ? decibelsToGain(zone.volumeDb) : 1;
  source.buffer = sampleBufferWithGain(ctx, sampleUrl, gain, zone?.startSample, zone?.endSample);
  const rootNote = zone?.rootNote ?? 60;
  const tuningRate = Math.pow(2, (zone?.tuning ?? 0) / 1200);
  const baseFrequency = midiFrequency(rootNote);
  source.playbackRate.value = Math.max(0.25, Math.min(4, (frequency / baseFrequency) * tuningRate));
  return source;
}

export function renderedInstrumentBuffer(
  ctx: AudioContext,
  instrument: Instrument,
  durationS: number,
  frequency: number,
  targetFrequency?: number,
  bpm = 120,
  velocity = 127,
): AudioBuffer {
  const sampleCount = Math.max(1, Math.ceil(ctx.sampleRate * durationS));
  const key = renderedInstrumentBufferKey(instrument, sampleCount, ctx.sampleRate, frequency, targetFrequency, bpm, velocity);
  const cached = renderedInstrumentBufferCache.get(key);
  if (cached) return cached;

  const buffer = ctx.createBuffer(2, sampleCount, ctx.sampleRate);
  renderInstrumentStereoSamples(
    instrument,
    buffer.getChannelData(0),
    buffer.getChannelData(1),
    ctx.sampleRate,
    frequency,
    "audio",
    true,
    targetFrequency,
    undefined,
    undefined,
    bpm,
    velocity,
  );
  renderedInstrumentBufferCache.set(key, buffer);
  while (renderedInstrumentBufferCache.size > MAX_RENDERED_INSTRUMENT_BUFFERS) {
    const oldest = renderedInstrumentBufferCache.keys().next().value;
    if (!oldest) break;
    renderedInstrumentBufferCache.delete(oldest);
  }
  return buffer;
}

export function renderWavetablePreviewSamples(instrument: Instrument, sampleCount = 160, oscillator: "a" | "b" = "a"): number[] {
  const config = instrument.aether
    ? oscillator === "b"
      ? instrument.aether.oscB.wavetable
      : instrument.aether.oscA.wavetable
    : instrument.wavetable;
  if (!config || sampleCount <= 0) return [];
  const frequency = previewFrequency(instrument);
  const sampleRate = 48000;
  return Array.from({ length: sampleCount }, (_, index) => wavetableFrameMorph(
    instrument,
    config,
    index / sampleCount,
    sampleRate,
    frequency,
    clamp01(config.position),
    config.warp,
    config.warpMode ?? "shape",
  ));
}

export function renderAetherOutputPreviewSamples(
  instrument: Instrument,
  sampleCount = 160,
  scope: "mix" | "a" | "b" = "mix",
): number[] {
  if (!instrument.aether || sampleCount <= 0) {
    return renderWavetablePreviewSamples(instrument, sampleCount, scope === "b" ? "b" : "a");
  }

  const scopedInstrument: Instrument = scope === "mix"
    ? instrument
    : {
        ...instrument,
        aether: {
          ...instrument.aether,
          oscA: { ...instrument.aether.oscA, enabled: scope === "a" && instrument.aether.oscA.enabled },
          oscB: { ...instrument.aether.oscB, enabled: scope === "b" && instrument.aether.oscB.enabled },
          sub: { ...instrument.aether.sub, enabled: false },
          noise: { ...instrument.aether.noise, enabled: false },
        },
      };

  const frequency = previewFrequency(scopedInstrument);
  const sampleRate = 48000;
  const modulation: RenderModulation = { pitchSemitones: 0, filterOffset: 0, positionOffset: 0, targetOffsets: {} };
  const state = createSynthRenderState();
  return Array.from({ length: sampleCount }, (_, index) => {
    state.phase = index / sampleCount;
    state.index = index;
    return aetherStackSample(scopedInstrument, state, sampleRate, frequency, "visual", modulation);
  });
}

export function createInstrumentCurveBufferSource(
  ctx: AudioContext,
  instrument: Instrument,
  durationS: number,
  frequency: number,
  curve: Array<{ timeS: number; frequency: number }>,
  atTimeS = ctx.currentTime,
  automation?: SynthAutomationLane[],
  bpm = 120,
  velocity = 127,
): AudioBufferSourceNode {
  const sorted = normalizeFrequencyCurve(curve, durationS, frequency);
  const sampleTarget = nextSampleTarget(instrument, frequency, velocity, durationS);
  if (!automation?.length && sampleTarget && sampleBufferCache.has(sampleTarget.url)) {
    const source = ctx.createBufferSource();
    source.buffer = sampleBufferWithGain(
      ctx,
      sampleTarget.url,
      sampleTarget.gain,
      sampleTarget.startSample,
      sampleTarget.endSample,
    );
    const baseFrequency = midiFrequency(sampleTarget.rootNote);
    const tuningRate = Math.pow(2, sampleTarget.tuning / 1200);
    const rates = Float32Array.from(sorted.map((point) => Math.max(0.25, Math.min(4, (point.frequency / baseFrequency) * tuningRate))));
    source.playbackRate.value = rates[0] ?? Math.max(0.25, Math.min(4, (frequency / baseFrequency) * tuningRate));
    if (rates.length > 1) {
      source.playbackRate.setValueCurveAtTime(rates, atTimeS, Math.max(0.001, durationS));
    }
    return source;
  }

  const length = Math.max(1, Math.ceil(ctx.sampleRate * durationS));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  renderInstrumentStereoSamples(
    instrument,
    buffer.getChannelData(0),
    buffer.getChannelData(1),
    ctx.sampleRate,
    frequency,
    "audio",
    true,
    undefined,
    sorted.length > 1 ? sorted : undefined,
    automation,
    bpm,
    velocity,
  );
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

export async function preloadInstrumentSample(ctx: AudioContext, instrument: Instrument): Promise<void> {
  const urls = instrumentSampleUrls(instrument);
  await Promise.all(urls.map(async (url) => {
    if (sampleBufferCache.has(url)) return;
    const pending = sampleLoadPromises.get(url);
    if (pending) {
      await pending;
      return;
    }
    const loadPromise = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load sample: ${url}`);
      const data = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(data.slice(0));
      sampleBufferCache.set(url, buffer);
    })();
    sampleLoadPromises.set(url, loadPromise);
    try {
      await loadPromise;
    } finally {
      sampleLoadPromises.delete(url);
    }
  }));
}

export function primaryInstrumentSampleUrl(instrument: Instrument): string | undefined {
  return instrument.sampleMap?.[0]?.path
    ?? instrument.sampleUrls?.[0]
    ?? instrument.sampleUrl;
}

export function cachedInstrumentSampleBuffer(url: string): AudioBuffer | undefined {
  return sampleBufferCache.get(url);
}

export function hasCachedInstrumentSample(instrument: Instrument): boolean {
  const urls = instrumentSampleUrls(instrument);
  return urls.length > 0 && urls.every((url) => sampleBufferCache.has(url));
}

export function instrumentSampleUrls(instrument: Instrument): string[] {
  return Array.from(new Set([
    ...(instrument.sampleMap ?? []).map((zone) => zone.path),
    ...(instrument.sampleUrls ?? []),
    ...(instrument.sampleUrl ? [instrument.sampleUrl] : []),
  ].filter(Boolean)));
}

function nextSampleTarget(instrument: Instrument, frequency: number, velocity = 127, durationS = 0): SamplePlaybackTarget | undefined {
  const midiPitch = frequencyToMidi(frequency);
  const zones = (instrument.sampleMap ?? [])
    .filter((zone) => sampleBufferCache.has(zone.path))
    .filter((zone) => midiPitch >= zone.loNote && midiPitch <= zone.hiNote && velocity >= zone.loVel && velocity <= zone.hiVel);
  const targets = zones.length > 0
    ? zones.map((zone) => ({
      url: zone.path,
      rootNote: zone.rootNote,
      tuning: zone.tuning,
      gain: decibelsToGain(zone.volumeDb),
      durationSeconds: zone.durationSeconds,
      loLengthSeconds: zone.loLengthSeconds,
      hiLengthSeconds: zone.hiLengthSeconds,
      startSample: zone.startSample,
      endSample: zone.endSample,
    }))
    : instrumentSampleUrls(instrument)
      .filter((url) => sampleBufferCache.has(url))
      .map((url) => ({ url, rootNote: 60, tuning: 0, gain: 1, durationSeconds: sampleBufferCache.get(url)?.duration }));
  const selectedTargets = lengthMatchedTargets(targets, durationS);
  if (selectedTargets.length === 0) return undefined;
  if (selectedTargets.length === 1) return selectedTargets[0];
  const key = instrument.id;
  const index = sampleRoundRobinIndex.get(key) ?? Math.floor(Math.random() * selectedTargets.length);
  sampleRoundRobinIndex.set(key, (index + 1) % selectedTargets.length);
  return selectedTargets[index % selectedTargets.length];
}

function lengthMatchedTargets(targets: SamplePlaybackTarget[], durationS: number): SamplePlaybackTarget[] {
  if (targets.length <= 1 || !Number.isFinite(durationS) || durationS <= 0.001) return targets;
  const bandMatches = targets.filter((target) => (
    target.loLengthSeconds != null
    && target.hiLengthSeconds != null
    && durationS >= target.loLengthSeconds
    && durationS <= target.hiLengthSeconds
  ));
  if (bandMatches.length > 0) return bandMatches;

  const durationTargets = targets.filter((target) => target.durationSeconds != null && target.durationSeconds > 0);
  if (durationTargets.length === 0) return targets;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of durationTargets) {
    bestDistance = Math.min(bestDistance, Math.abs((target.durationSeconds ?? 0) - durationS));
  }
  return durationTargets.filter((target) => Math.abs(Math.abs((target.durationSeconds ?? 0) - durationS) - bestDistance) <= 0.003);
}

const gainedSampleBufferCache = new Map<string, AudioBuffer>();

function sampleBufferWithGain(ctx: AudioContext, url: string, gain: number, startSample = 0, endSample = 0): AudioBuffer {
  const source = sampleBufferCache.get(url)!;
  const start = Math.max(0, Math.min(source.length - 1, Math.floor(startSample || 0)));
  const end = endSample > start + 1
    ? Math.max(start + 2, Math.min(source.length, Math.floor(endSample)))
    : source.length;
  if (Math.abs(gain - 1) < 0.001 && start === 0 && end === source.length) return source;
  const key = `${url}::${gain.toFixed(4)}::${start}:${end}`;
  const cached = gainedSampleBufferCache.get(key);
  if (cached) return cached;
  const buffer = ctx.createBuffer(source.numberOfChannels, Math.max(1, end - start), source.sampleRate);
  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const input = source.getChannelData(channel);
    const output = buffer.getChannelData(channel);
    for (let i = 0; i < output.length; i++) output[i] = clamp(input[start + i] * gain, -1, 1);
  }
  gainedSampleBufferCache.set(key, buffer);
  return buffer;
}

function decibelsToGain(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

function renderedInstrumentBufferKey(
  instrument: Instrument,
  sampleCount: number,
  sampleRate: number,
  frequency: number,
  targetFrequency?: number,
  bpm = 120,
  velocity = 127,
): string {
  return JSON.stringify({
    sampleCount,
    sampleRate,
    bpm: quantizeKeyNumber(bpm, 0.01),
    velocity: quantizeKeyNumber(velocity, 1),
    frequency: quantizeKeyNumber(frequency, 0.01),
    targetFrequency: targetFrequency == null ? null : quantizeKeyNumber(targetFrequency, 0.01),
    patch: renderRelevantInstrumentState(instrument),
  });
}

function oscillatorRate(octave: number, semitone: number, fineCents: number): number {
  const safeOctave = Math.round(clamp(octave, -8, 8));
  const safeSemitone = Math.round(clamp(semitone, -48, 48));
  const safeFine = quantizeKeyNumber(clamp(fineCents, -1200, 1200), 0.01);
  const key = `${safeOctave}|${safeSemitone}|${safeFine}`;
  const cached = oscillatorRateCache.get(key);
  if (cached != null) return cached;

  const value = Math.pow(2, safeOctave + safeSemitone / 12 + safeFine / 1200);
  oscillatorRateCache.set(key, value);
  trimCache(oscillatorRateCache, MAX_OSCILLATOR_RATE_ENTRIES);
  return value;
}

function unisonVoicePlan(unison: number, detuneCents: number, blend: number): UnisonVoicePlan {
  const voiceCount = Math.max(1, Math.min(8, Math.round(unison)));
  const detune = quantizeKeyNumber(clamp(detuneCents, 0, 100), 0.01);
  const spread = quantizeKeyNumber(clamp01(blend), 0.001);
  const key = `${voiceCount}|${detune}|${spread}`;
  const cached = unisonVoicePlanCache.get(key);
  if (cached) return cached;

  const rates: number[] = [];
  const phaseOffsets: number[] = [];
  const weights: number[] = [];
  let weightSum = 0;
  for (let voice = 0; voice < voiceCount; voice++) {
    const centered = voiceCount === 1 ? 0 : (voice / (voiceCount - 1)) * 2 - 1;
    const weight = voice === 0 ? 1 : 0.72;
    rates.push(Math.pow(2, (centered * detune) / 1200));
    phaseOffsets.push(voice * 0.071 * spread);
    weights.push(weight);
    weightSum += weight;
  }

  const plan = { rates, phaseOffsets, weights, weightSum };
  unisonVoicePlanCache.set(key, plan);
  trimCache(unisonVoicePlanCache, MAX_UNISON_VOICE_PLANS);
  return plan;
}

function trimCache<K, V>(cache: Map<K, V>, maxEntries: number) {
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function renderRelevantInstrumentState(instrument: Instrument) {
  const customWavetables = instrument.synthPatch?.metadata?.wavemaps ?? instrument.synthPatch?.metadata?.customWavetables;
  return {
    kind: instrument.kind,
    waveform: instrument.waveform,
    knobs: instrument.knobs,
    filterType: instrument.filterType,
    envelope: instrument.envelope,
    detuneCents: instrument.detuneCents,
    octave: instrument.octave,
    subOscLevel: instrument.subOscLevel,
    glideMs: instrument.glideMs,
    ampLevel: instrument.ampLevel,
    ampPan: instrument.ampPan,
    wavetable: instrument.wavetable,
    aether: instrument.aether,
    lfoWaveform: instrument.lfoWaveform,
    lfoRateHz: instrument.lfoRateHz,
    lfoSyncedRate: instrument.lfoSyncedRate,
    lfoSmoothing: instrument.lfoSmoothing,
    lfoRandomPhase: instrument.lfoRandomPhase,
    lfoPhase: instrument.lfoPhase,
    lfoOneShot: instrument.lfoOneShot,
    lfo2Waveform: instrument.lfo2Waveform,
    lfo2RateHz: instrument.lfo2RateHz,
    lfo2Sync: instrument.lfo2Sync,
    lfo2SyncedRate: instrument.lfo2SyncedRate,
    lfo2Smoothing: instrument.lfo2Smoothing,
    lfo2RandomPhase: instrument.lfo2RandomPhase,
    lfo2Enabled: instrument.lfo2Enabled,
    lfo2Phase: instrument.lfo2Phase,
    lfo2OneShot: instrument.lfo2OneShot,
    lfoDepth: instrument.lfoDepth,
    lfoSync: instrument.lfoSync,
    lfoRetrigger: instrument.lfoRetrigger,
    lfoPositionBipolar: instrument.lfoPositionBipolar,
    lfoPitchBipolar: instrument.lfoPitchBipolar,
    lfoFilterBipolar: instrument.lfoFilterBipolar,
    lfoToPitch: instrument.lfoToPitch,
    lfoToFilter: instrument.lfoToFilter,
    envToFilter: instrument.envToFilter,
    synthParameters: instrument.synthPatch?.parameters,
    synthModulation: instrument.synthPatch?.modulation,
    customWavetables,
  };
}

function quantizeKeyNumber(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / step) * step;
}

function midiFrequency(midiPitch: number): number {
  return 440 * Math.pow(2, (midiPitch - 69) / 12);
}

function frequencyToMidi(frequency: number): number {
  if (!Number.isFinite(frequency) || frequency <= 0) return 60;
  return Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(frequency / 440))));
}

export function renderInstrumentSample(
  instrument: Instrument,
  state: SynthRenderState,
  sampleRate: number,
  frequency: number,
  mode: SynthRenderMode,
  modulation: RenderModulation = { pitchSemitones: 0, filterOffset: 0, positionOffset: 0, targetOffsets: {} },
): number {
  const cutoff = clamp01(
    instrument.knobs.cutoff
      + filterKeytrackOffset(instrument, sampleRate, frequency)
      + modulation.filterOffset
      + modulationTargetOffset(modulation, "filter.cutoff"),
  );
  const resonance = clamp01(instrument.knobs.resonance + modulationTargetOffset(modulation, "filter.resonance"));
  const drive = clamp01(instrument.knobs.drive + modulationTargetOffset(modulation, "filter.drive"));
  const color = clamp01(instrument.knobs.color);
  const sub = instrument.aether ? 0 : clamp01(instrument.subOscLevel ?? 0);

  let v = instrument.kind === "wavetable" && instrument.aether
    ? aetherStackSample(instrument, state, sampleRate, frequency, mode, modulation)
    : instrument.kind === "wavetable" || instrument.waveform === "wavetable"
    ? wavetableOscillatorSample(
        instrument,
        state.phase,
        sampleRate,
        frequency,
        undefined,
        modulation.positionOffset + modulationTargetOffset(modulation, "osc.a.position"),
        modulationTargetOffset(modulation, "unison.detune"),
      )
    : instrument.waveform === "noise"
    ? mode === "audio" ? Math.random() * 2 - 1 : whiteNoiseSample(state.index)
    : oscillatorSample(instrument.waveform, state.phase, color);

  if (sub > 0) {
    const subWave = oscillatorSample("square", state.phase * 0.5, 0.5);
    v = v * (1 - sub * 0.45) + subWave * sub * 0.45;
  }

  if (drive > 0) {
    const amount = 1 + drive * 10;
    v = Math.tanh(v * amount) / Math.tanh(amount);
  }

  const filtered = resonantFilter(v, state, sampleRate, cutoff, resonance, instrument.filterType ?? "lowpass");
  const level = clamp01((instrument.ampLevel ?? 1) + modulationTargetOffset(modulation, "amp.level"));
  state.phase += frequency / sampleRate;
  state.index += 1;
  return clamp(filtered * level, -1, 1);
}

function renderInstrumentStereoSample(
  instrument: Instrument,
  phaseState: SynthRenderState,
  leftFilterState: SynthRenderState,
  rightFilterState: SynthRenderState,
  sampleRate: number,
  frequency: number,
  mode: SynthRenderMode,
  modulation: RenderModulation,
): { left: number; right: number } {
  const cutoff = clamp01(
    instrument.knobs.cutoff
      + filterKeytrackOffset(instrument, sampleRate, frequency)
      + modulation.filterOffset
      + modulationTargetOffset(modulation, "filter.cutoff"),
  );
  const resonance = clamp01(instrument.knobs.resonance + modulationTargetOffset(modulation, "filter.resonance"));
  const drive = clamp01(instrument.knobs.drive + modulationTargetOffset(modulation, "filter.drive"));
  const raw = aetherStackStereoSample(instrument, phaseState, sampleRate, frequency, mode, modulation);
  let left = raw.left;
  let right = raw.right;

  if (drive > 0) {
    const amount = 1 + drive * 10;
    const normalizer = Math.tanh(amount);
    left = Math.tanh(left * amount) / normalizer;
    right = Math.tanh(right * amount) / normalizer;
  }

  left = resonantFilter(left, leftFilterState, sampleRate, cutoff, resonance, instrument.filterType ?? "lowpass");
  right = resonantFilter(right, rightFilterState, sampleRate, cutoff, resonance, instrument.filterType ?? "lowpass");

  const level = clamp01((instrument.ampLevel ?? 1) + modulationTargetOffset(modulation, "amp.level"));
  const [ampLeft, ampRight] = panGains((instrument.ampPan ?? 0) + modulationTargetOffset(modulation, "amp.pan"));
  phaseState.phase += frequency / sampleRate;
  phaseState.index += 1;
  return {
    left: clamp(left * level * ampLeft, -1, 1),
    right: clamp(right * level * ampRight, -1, 1),
  };
}

function resonantFilter(
  input: number,
  state: SynthRenderState,
  sampleRate: number,
  cutoff: number,
  resonance: number,
  type: NonNullable<Instrument["filterType"]>,
): number {
  const minHz = 50;
  const maxHz = Math.min(16000, sampleRate * 0.45);
  if (Math.abs(cutoff - state.filterCutoff) > 0.0005 || Math.abs(resonance - state.filterResonance) > 0.0005) {
    const cutoffHz = minHz * Math.pow(maxHz / minHz, cutoff);
    state.filterF = Math.min(0.98, 2 * Math.sin(Math.PI * cutoffHz / sampleRate));
    state.filterDamping = 1.45 - resonance * 1.25;
    state.filterCutoff = cutoff;
    state.filterResonance = resonance;
  }

  state.low = clamp(state.low + state.filterF * state.band, -4, 4);
  const high = input - state.low - state.filterDamping * state.band;
  state.band = clamp(state.band + state.filterF * high, -4, 4);

  const emphasized = state.low + state.band * resonance * 1.6;
  if (type === "highpass") return clamp(high, -1.2, 1.2);
  if (type === "bandpass") return clamp(state.band * (1 + resonance), -1.2, 1.2);
  return clamp(emphasized, -1.2, 1.2);
}

const WAVETABLE_FRAME_COUNT = 8;
const PREVIEW_WAVETABLE_FRAME_SIZE = 512;
const MAX_WAVETABLE_CACHE_ENTRIES = 48;

interface CachedPreviewWavetable {
  frameCount: number;
  frameSize: number;
  samples: Float32Array;
}

const previewWavetableCache = new Map<string, CachedPreviewWavetable>();

function aetherStackSample(
  instrument: Instrument,
  state: SynthRenderState,
  sampleRate: number,
  frequency: number,
  mode: SynthRenderMode,
  modulation: RenderModulation,
): number {
  const config = instrument.aether;
  if (!config) return wavetableOscillatorSample(instrument, state.phase, sampleRate, frequency);

  let sum = 0;
  let levelSum = 0;
  const addOsc = (osc: NonNullable<Instrument["aether"]>["oscA"], key: "a" | "b") => {
    const level = clamp01(osc.level + modulationTargetOffset(modulation, `osc.${key}.level`));
    if (!osc.enabled || level <= 0) return;
    const fineOffset = modulationTargetOffset(modulation, `osc.${key}.fine`);
    const rate = oscillatorRate(osc.octave, osc.semitone, osc.fineCents + fineOffset);
    const waveform = osc.waveform ?? "wavetable";
    const legacyPositionOffset = key === "a" ? modulation.positionOffset : 0;
    const wavetableOffset = legacyPositionOffset + modulationTargetOffset(modulation, `osc.${key}.position`);
    const unisonDetuneOffset = modulationTargetOffset(modulation, "unison.detune");
    const unisonSpreadOffset = modulationTargetOffset(modulation, "unison.spread");
    const phaseOffset = oscillatorPhaseOffset(osc, key);
    const sourceSample = waveform === "wavetable"
      ? wavetableOscillatorSample(
          instrument,
          state.phase * rate + phaseOffset,
          sampleRate,
          frequency * rate,
          osc.wavetable,
          wavetableOffset,
          unisonDetuneOffset,
          unisonSpreadOffset,
        )
      : waveform === "noise"
      ? mode === "audio" ? Math.random() * 2 - 1 : whiteNoiseSample(state.index + Math.round(rate * 97))
      : oscillatorSample(waveform, state.phase * rate + phaseOffset, clamp01(instrument.knobs.color));
    sum += sourceSample * level;
    levelSum += level;
  };
  addOsc(config.oscA, "a");
  addOsc(config.oscB, "b");

  if (config.sub.enabled && config.sub.level > 0) {
    const rate = oscillatorRate(config.sub.octave, 0, 0);
    sum += oscillatorSample(config.sub.waveform, state.phase * rate, 0.5) * config.sub.level;
    levelSum += config.sub.level;
  }

  if (config.noise.enabled && config.noise.level > 0) {
    const noise = mode === "audio" ? Math.random() * 2 - 1 : whiteNoiseSample(state.index);
    const softened = noise * (0.35 + clamp01(config.noise.color) * 0.65);
    sum += softened * config.noise.level;
    levelSum += config.noise.level;
  }

  if (levelSum <= 0) return 0;
  return clamp(sum / Math.max(0.35, levelSum), -1, 1);
}

function aetherStackStereoSample(
  instrument: Instrument,
  state: SynthRenderState,
  sampleRate: number,
  frequency: number,
  mode: SynthRenderMode,
  modulation: RenderModulation,
): { left: number; right: number } {
  const config = instrument.aether;
  if (!config) {
    const sample = wavetableOscillatorSample(instrument, state.phase, sampleRate, frequency);
    return { left: sample, right: sample };
  }

  let left = 0;
  let right = 0;
  let levelSum = 0;

  const add = (value: number, level: number, pan: number) => {
    const [leftGain, rightGain] = panGains(pan);
    left += value * level * leftGain;
    right += value * level * rightGain;
    levelSum += level;
  };

  const addOsc = (
    osc: NonNullable<Instrument["aether"]>["oscA"],
    key: "a" | "b",
  ) => {
    const level = clamp01(osc.level + modulationTargetOffset(modulation, `osc.${key}.level`));
    if (!osc.enabled || level <= 0) return;
    const fineOffset = modulationTargetOffset(modulation, `osc.${key}.fine`);
    const rate = oscillatorRate(osc.octave, osc.semitone, osc.fineCents + fineOffset);
    const waveform = osc.waveform ?? "wavetable";
    const legacyPositionOffset = key === "a" ? modulation.positionOffset : 0;
    const wavetableOffset = legacyPositionOffset + modulationTargetOffset(modulation, `osc.${key}.position`);
    const unisonDetuneOffset = modulationTargetOffset(modulation, "unison.detune");
    const unisonSpreadOffset = modulationTargetOffset(modulation, "unison.spread");
    const phaseOffset = oscillatorPhaseOffset(osc, key);
    const sourceSample = waveform === "wavetable"
      ? wavetableOscillatorSample(
          instrument,
          state.phase * rate + phaseOffset,
          sampleRate,
          frequency * rate,
          osc.wavetable,
          wavetableOffset,
          unisonDetuneOffset,
          unisonSpreadOffset,
        )
      : waveform === "noise"
      ? mode === "audio" ? Math.random() * 2 - 1 : whiteNoiseSample(state.index + Math.round(rate * 97))
      : oscillatorSample(waveform, state.phase * rate + phaseOffset, clamp01(instrument.knobs.color));
    add(sourceSample, level, osc.pan + modulationTargetOffset(modulation, `osc.${key}.pan`));
  };

  addOsc(config.oscA, "a");
  addOsc(config.oscB, "b");

  if (config.sub.enabled && config.sub.level > 0) {
    const rate = oscillatorRate(config.sub.octave, 0, 0);
    add(oscillatorSample(config.sub.waveform, state.phase * rate, 0.5), config.sub.level, 0);
  }

  if (config.noise.enabled && config.noise.level > 0) {
    const noise = mode === "audio" ? Math.random() * 2 - 1 : whiteNoiseSample(state.index);
    const softened = noise * (0.35 + clamp01(config.noise.color) * 0.65);
    add(softened, config.noise.level, 0);
  }

  if (levelSum <= 0) return { left: 0, right: 0 };
  const normalizer = Math.max(0.35, levelSum);
  return {
    left: clamp(left / normalizer, -1, 1),
    right: clamp(right / normalizer, -1, 1),
  };
}

function wavetableOscillatorSample(
  instrument: Instrument,
  phase: number,
  sampleRate: number,
  frequency: number,
  override?: NonNullable<Instrument["wavetable"]>,
  positionOffset = 0,
  detuneCentsOffset = 0,
  spreadOffset = 0,
): number {
  const config = override ?? instrument.wavetable ?? {
    bank: "aether",
    position: 0.35,
    warp: 0.2,
    warpMode: "shape",
    unison: 1,
    detuneCents: 12,
    blend: 0.5,
  };
  const unison = Math.max(1, Math.min(8, Math.round(config.unison)));
  const detune = Math.max(0, Math.min(100, config.detuneCents + detuneCentsOffset));
  const blend = clamp01(config.blend + spreadOffset);
  const voicePlan = unisonVoicePlan(unison, detune, blend);
  let sum = 0;
  for (let voice = 0; voice < unison; voice++) {
    const rate = voicePlan.rates[voice];
    sum += wavetableFrameMorph(
      instrument,
      config,
      phase * rate + voicePlan.phaseOffsets[voice],
      sampleRate,
      frequency * rate,
      clamp01(config.position + positionOffset),
      config.warp,
      config.warpMode ?? "shape",
    ) * voicePlan.weights[voice];
  }
  return clamp(sum / Math.max(1, voicePlan.weightSum), -1, 1);
}

function wavetableFrameMorph(
  instrument: Instrument,
  config: NonNullable<Instrument["wavetable"]>,
  phase: number,
  sampleRate: number,
  frequency: number,
  position: number,
  warp: number,
  warpMode: WavetableConfig["warpMode"],
): number {
  const table = getPreviewWavetable(instrument, config, sampleRate, frequency, warp, warpMode);
  const frameCount = table.frameCount;
  const pos = clamp01(position) * (frameCount - 1);
  const base = Math.floor(pos);
  const frac = pos - base;
  const y1 = previewWavetableSample(table, base, phase);
  const y2 = previewWavetableSample(table, base + 1, phase);
  return y1 + (y2 - y1) * frac;
}

function getPreviewWavetable(
  instrument: Instrument,
  config: WavetableConfig,
  sampleRate: number,
  frequency: number,
  warp: number,
  warpMode: WavetableConfig["warpMode"],
): CachedPreviewWavetable {
  const custom = config.bank === "custom" ? customWavetableForInstrument(instrument, config.customId) : null;
  const harmonicLimit = Math.min(32, Math.max(1, Math.floor((sampleRate * 0.48) / Math.max(20, frequency))));
  const key = previewWavetableKey(config, custom, harmonicLimit, warp, warpMode);
  const cached = previewWavetableCache.get(key);
  if (cached) return cached;

  const table = createPreviewWavetable(config, custom, harmonicLimit, warp, warpMode);
  previewWavetableCache.set(key, table);
  while (previewWavetableCache.size > MAX_WAVETABLE_CACHE_ENTRIES) {
    const oldest = previewWavetableCache.keys().next().value;
    if (!oldest) break;
    previewWavetableCache.delete(oldest);
  }
  return table;
}

function previewWavetableKey(
  config: WavetableConfig,
  custom: CustomWavetableDefinition | null,
  harmonicLimit: number,
  warp: number,
  warpMode: WavetableConfig["warpMode"],
): string {
  const customKey = custom
    ? custom.frames.map((frame) => [
        frame.brightness.toFixed(3),
        frame.even.toFixed(3),
        frame.fold.toFixed(3),
        frame.phase.toFixed(3),
      ].join(",")).join(";")
    : "";
  return [
    config.bank,
    config.customId ?? "",
    harmonicLimit,
    clamp01(warp).toFixed(3),
    warpMode ?? "shape",
    customKey,
  ].join("|");
}

function createPreviewWavetable(
  config: WavetableConfig,
  custom: CustomWavetableDefinition | null,
  harmonicLimit: number,
  warp: number,
  warpMode: WavetableConfig["warpMode"],
): CachedPreviewWavetable {
  const frameCount = custom ? custom.frames.length : WAVETABLE_FRAME_COUNT;
  const frameSize = PREVIEW_WAVETABLE_FRAME_SIZE;
  const samples = new Float32Array(frameCount * frameSize);
  for (let frame = 0; frame < frameCount; frame++) {
    const normalizedFrame = frame / Math.max(1, frameCount - 1);
    const customFrame = custom?.frames[frame] ?? null;
    let peak = 0;
    const frameStart = frame * frameSize;
    for (let index = 0; index < frameSize; index++) {
      const phase = index / frameSize;
      let sample = 0;
      let normalizer = 0;
      for (let harmonic = 1; harmonic <= harmonicLimit; harmonic++) {
        const amp = customFrame
          ? customWavetableHarmonicAmplitude(customFrame, harmonic, clamp01(warp), warpMode)
          : wavetableHarmonicAmplitude(config.bank, harmonic, normalizedFrame, clamp01(warp), warpMode);
        if (amp <= 0.0001) continue;
        const harmonicPhase = customFrame
          ? customWavetableHarmonicPhase(customFrame, harmonic, clamp01(warp), warpMode)
          : wavetableHarmonicPhase(config.bank, harmonic, normalizedFrame, clamp01(warp), warpMode);
        sample += Math.sin(phase * Math.PI * 2 * harmonic + harmonicPhase) * amp;
        normalizer += amp;
      }
      const normalized = normalizer > 0 ? sample / Math.max(1, normalizer * 0.72) : 0;
      samples[frameStart + index] = normalized;
      peak = Math.max(peak, Math.abs(normalized));
    }
    if (peak > 1) {
      for (let index = 0; index < frameSize; index++) samples[frameStart + index] /= peak;
    }
  }
  return { frameCount, frameSize, samples };
}

function previewWavetableSample(
  table: CachedPreviewWavetable,
  frameIndex: number,
  phase: number,
): number {
  const frame = Math.max(0, Math.min(table.frameCount - 1, frameIndex));
  const wrappedPhase = ((phase % 1) + 1) % 1;
  const position = wrappedPhase * table.frameSize;
  const i0 = Math.floor(position) % table.frameSize;
  const i1 = (i0 + 1) % table.frameSize;
  const frac = position - Math.floor(position);
  const frameStart = frame * table.frameSize;
  const a = table.samples[frameStart + i0];
  const b = table.samples[frameStart + i1];
  return a + (b - a) * frac;
}

function customWavetableForInstrument(instrument: Instrument, id?: string): CustomWavetableDefinition | null {
  const customId = id?.startsWith("user.") ? id : "user.custom";
  const table = instrument.synthPatch?.metadata?.wavemaps?.[customId] ?? instrument.synthPatch?.metadata?.customWavetables?.[customId];
  if (!table || !Array.isArray(table.frames) || table.frames.length === 0)
    return null;
  return {
    schemaVersion: 1,
    id: table.id,
    name: table.name,
    kind: table.kind ?? "harmonic-sketch",
    interpolation: table.interpolation ?? "linear",
    source: table.source ?? { kind: "drawn", label: "Drawn wavemap" },
    frames: table.frames.slice(0, 4).map(sanitizeCustomFrame),
  };
}

function sanitizeCustomFrame(frame: CustomWavetableFrame): CustomWavetableFrame {
  return {
    id: frame.id,
    label: frame.label,
    position: frame.position == null ? undefined : clamp01(frame.position),
    brightness: clamp01(frame.brightness),
    even: clamp01(frame.even),
    fold: clamp01(frame.fold),
    phase: clamp(frame.phase, -1, 1),
  };
}

function warpModeIntensity(warp: number, warpMode: WavetableConfig["warpMode"] = "shape"): number {
  if (warpMode === "fold") return clamp01(warp) * 1.35;
  if (warpMode === "pinch") return Math.pow(clamp01(warp), 0.72);
  return clamp01(warp);
}

function customWavetableHarmonicAmplitude(frame: CustomWavetableFrame, harmonic: number, warp: number, warpMode: WavetableConfig["warpMode"] = "shape"): number {
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

function customWavetableHarmonicPhase(frame: CustomWavetableFrame, harmonic: number, warp: number, warpMode: WavetableConfig["warpMode"] = "shape"): number {
  const shapedWarp = warpModeIntensity(warp, warpMode);
  const modePhase = warpMode === "fold"
    ? Math.sin(harmonic * 0.73) * shapedWarp * 0.45
    : warpMode === "pinch"
      ? Math.cos(harmonic * 0.29) * shapedWarp * 0.24
      : 0;
  return frame.phase * harmonic * 0.28 + Math.sin(harmonic * 0.41) * clamp01(frame.fold + shapedWarp * 0.25) * 0.55 + modePhase;
}

function wavetableHarmonicAmplitude(
  bank: NonNullable<Instrument["wavetable"]>["bank"],
  harmonic: number,
  frame: number,
  warp: number,
  warpMode: WavetableConfig["warpMode"] = "shape",
): number {
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

function wavetableHarmonicPhase(bank: NonNullable<Instrument["wavetable"]>["bank"], harmonic: number, frame: number, warp: number, warpMode: WavetableConfig["warpMode"] = "shape"): number {
  const modePhase = warpMode === "fold"
    ? Math.sin(harmonic * 0.47 + frame * Math.PI) * warpModeIntensity(warp, warpMode) * 0.55
    : warpMode === "pinch"
      ? Math.cos(harmonic * 0.33 + frame) * warpModeIntensity(warp, warpMode) * 0.3
      : 0;
  if (bank === "fm" || bank === "glass") return Math.sin(harmonic * 0.37 + frame * Math.PI) * 0.8 + modePhase;
  if (bank === "vocal") return frame * harmonic * 0.08 + modePhase;
  return modePhase;
}

function oscillatorSample(waveform: Instrument["waveform"], phase: number, color: number): number {
  const p = ((phase % 1) + 1) % 1;
  switch (waveform) {
    case "sine": {
      const second = Math.sin(p * Math.PI * 4) * (color - 0.5) * 0.35;
      return Math.sin(p * Math.PI * 2) * (1 - Math.abs(color - 0.5) * 0.2) + second;
    }
    case "triangle": {
      const skew = 0.5 + (color - 0.5) * 0.7;
      return p < skew ? -1 + (p / skew) * 2 : 1 - ((p - skew) / (1 - skew)) * 2;
    }
    case "square": {
      const width = 0.5 + (color - 0.5) * 0.8;
      return p < width ? 1 : -1;
    }
    case "saw": {
      const shaped = color < 0.5
        ? Math.pow(p, 1 + (0.5 - color) * 2)
        : 1 - Math.pow(1 - p, 1 + (color - 0.5) * 2);
      return shaped * 2 - 1;
    }
    case "sample":
      return (
        Math.sin(p * Math.PI * 2) * 0.55 +
        Math.sin(p * Math.PI * 6) * (0.15 + color * 0.25) +
        Math.sin(p * Math.PI * 10) * color * 0.15
      );
    case "noise":
    default:
      return 0;
  }
}

function whiteNoiseSample(index: number): number {
  let x = (index + 1) * 0x6d2b79f5;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return (((x ^ (x >>> 14)) >>> 0) / 4294967295) * 2 - 1;
}

function oscillatorPhaseOffset(osc: NonNullable<Instrument["aether"]>["oscA"], key: "a" | "b"): number {
  const basePhase = clamp01(osc.phase ?? 0);
  const randomDepth = clamp01(osc.randomPhase ?? 0);
  if (randomDepth <= 0) return basePhase;
  const seed = key === "a" ? 9176 : 3613;
  const jitter = (whiteNoiseSample(seed + Math.round(basePhase * 10000)) + 1) * 0.5;
  return basePhase + jitter * randomDepth;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function panGains(pan: number): [number, number] {
  const normalized = (clamp(pan, -1, 1) + 1) * 0.5;
  const angle = normalized * Math.PI * 0.5;
  return [Math.cos(angle), Math.sin(angle)];
}

function smoothstep(v: number) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function normalizeFrequencyCurve(
  curve: Array<{ timeS: number; frequency: number }>,
  durationS: number,
  fallbackFrequency: number,
) {
  const clean = curve
    .filter((point) => Number.isFinite(point.timeS) && Number.isFinite(point.frequency))
    .map((point) => ({
      timeS: clamp(point.timeS, 0, durationS),
      frequency: clamp(point.frequency, 20, 20000),
    }))
    .sort((a, b) => a.timeS - b.timeS);
  if (clean.length === 0 || clean[0].timeS > 0) clean.unshift({ timeS: 0, frequency: fallbackFrequency });
  if (clean[clean.length - 1].timeS < durationS) {
    clean.push({ timeS: durationS, frequency: clean[clean.length - 1].frequency });
  }
  return clean;
}

function frequencyAtCurveTime(curve: Array<{ timeS: number; frequency: number }>, timeS: number): number {
  if (timeS <= curve[0].timeS) return curve[0].frequency;
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1];
    const next = curve[i];
    if (timeS > next.timeS) continue;
    const span = Math.max(0.001, next.timeS - prev.timeS);
    const t = smoothstep((timeS - prev.timeS) / span);
    return prev.frequency + (next.frequency - prev.frequency) * t;
  }
  return curve[curve.length - 1].frequency;
}

function applyAutomationOffsets(
  instrument: Instrument,
  modulation: RenderModulation,
  automation: SynthAutomationLane[] | undefined,
  timeS: number,
) {
  if (!automation?.length) return;
  for (const lane of automation) {
    if (!isRuntimeModulationTarget(lane.target) || lane.points.length === 0) continue;
    const value = automationValueAtTime(lane.points, timeS);
    if (value == null) continue;
    const base = baseAutomationValue(instrument, lane.target);
    if (base == null) continue;
    modulation.targetOffsets[lane.target] = (modulation.targetOffsets[lane.target] ?? 0) + value - base;
  }
}

function automationValueAtTime(points: Array<{ timeS: number; value: number }>, timeS: number): number | null {
  const clean = points
    .filter((point) => Number.isFinite(point.timeS) && Number.isFinite(point.value))
    .sort((a, b) => a.timeS - b.timeS);
  if (clean.length === 0) return null;
  if (timeS <= clean[0].timeS) return clean[0].value;
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    const next = clean[i];
    if (timeS <= next.timeS) {
      const mix = clamp01((timeS - prev.timeS) / Math.max(0.0001, next.timeS - prev.timeS));
      return prev.value + (next.value - prev.value) * smoothstep(mix);
    }
  }
  return clean[clean.length - 1].value;
}

function baseAutomationValue(instrument: Instrument, target: RuntimeModulationTarget): number | null {
  switch (target) {
    case "osc.a.position":
      return instrument.aether?.oscA.wavetable.position ?? instrument.wavetable?.position ?? 0;
    case "osc.b.position":
      return instrument.aether?.oscB.wavetable.position ?? instrument.wavetable?.position ?? 0;
    case "osc.a.fine":
      return instrument.aether?.oscA.fineCents ?? 0;
    case "osc.b.fine":
      return instrument.aether?.oscB.fineCents ?? 0;
    case "osc.a.level":
      return instrument.aether?.oscA.level ?? 0;
    case "osc.b.level":
      return instrument.aether?.oscB.level ?? 0;
    case "osc.a.pan":
      return instrument.aether?.oscA.pan ?? 0;
    case "osc.b.pan":
      return instrument.aether?.oscB.pan ?? 0;
    case "filter.cutoff":
      return instrument.knobs.cutoff ?? 1;
    case "filter.resonance":
      return instrument.knobs.resonance ?? 0;
    case "filter.drive":
      return instrument.knobs.drive ?? 0;
    case "amp.level":
      return instrument.ampLevel ?? 1;
    case "amp.pan":
      return instrument.ampPan ?? 0;
    case "unison.detune":
      return instrument.wavetable?.detuneCents ?? instrument.aether?.oscA.wavetable.detuneCents ?? 0;
    case "unison.spread":
      return instrument.wavetable?.blend ?? instrument.aether?.oscA.wavetable.blend ?? 0;
    default:
      return null;
  }
}

function syncedLfoDivisionBeats(value: unknown): number {
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

function syncedLfoRateHz(rate: unknown, bpm: number): number {
  const safeBpm = Math.max(1, Number.isFinite(bpm) ? bpm : 120);
  return clamp((safeBpm / 60) / syncedLfoDivisionBeats(rate), 0.01, 50);
}

function effectiveLfoRateHz(instrument: Instrument, lfo: 1 | 2, bpm: number): number {
  const params = instrument.synthPatch?.parameters;
  if (lfo === 1) {
    const sync = params?.["lfo.1.sync"] === true || instrument.lfoSync === true;
    if (sync) return syncedLfoRateHz(params?.["lfo.1.syncedRate"] ?? instrument.lfoSyncedRate ?? "1/4", bpm);
    return Math.max(0.01, instrument.lfoRateHz ?? 4);
  }

  const sync = params?.["lfo.2.sync"] === true || instrument.lfo2Sync === true;
  if (sync) return syncedLfoRateHz(params?.["lfo.2.syncedRate"] ?? instrument.lfo2SyncedRate ?? "1/2", bpm);
  return Math.max(0.01, instrument.lfo2RateHz ?? 0.5);
}

export function modulationAtTime(instrument: Instrument, timeS: number, durationS: number, bpm = 120, velocity = 1): RenderModulation {
  const lfo1OneShot = instrument.synthPatch?.parameters?.["lfo.1.oneShot"] === true || instrument.lfoOneShot === true;
  const lfo2OneShot = instrument.synthPatch?.parameters?.["lfo.2.oneShot"] === true || instrument.lfo2OneShot === true;
  const rawLfo = lfoShapeValue(
    instrument.lfoWaveform ?? "sine",
    timeS * effectiveLfoRateHz(instrument, 1, bpm) + (instrument.lfoPhase ?? 0) + effectiveLfoRandomPhaseOffset(instrument, 1),
    lfo1OneShot,
    effectiveLfoSmoothing(instrument, 1),
  );
  const rawLfo2 = lfoShapeValue(
    instrument.lfo2Waveform ?? "triangle",
    timeS * effectiveLfoRateHz(instrument, 2, bpm) + (instrument.lfo2Phase ?? 0) + effectiveLfoRandomPhaseOffset(instrument, 2),
    lfo2OneShot,
    effectiveLfoSmoothing(instrument, 2),
  );
  const env = envelopePreviewValue(timeS, durationS, instrument);
  const env2 = modEnvelopePreviewValue(timeS, durationS, instrument);
  const targetOffsets = routeTargetOffsets(instrument, rawLfo, rawLfo2, env, env2, velocity);
  if (targetOffsets) {
    return { pitchSemitones: 0, filterOffset: 0, positionOffset: 0, targetOffsets };
  }

  const positionLfo = lfoRouteValue(rawLfo, instrument.lfoPositionBipolar ?? true);
  const pitchLfo = lfoRouteValue(rawLfo, instrument.lfoPitchBipolar ?? true);
  const filterLfo = lfoRouteValue(rawLfo, instrument.lfoFilterBipolar ?? true);
  const positionOffset = positionLfo * clamp01(instrument.lfoDepth ?? 0);
  const pitchSemitones = pitchLfo * Math.max(0, instrument.lfoToPitch ?? 0);
  const lfoFilter = filterLfo * clamp(instrument.lfoToFilter ?? 0, -1, 1) * 0.35;
  const envFilter = env * clamp(instrument.envToFilter ?? 0, -1, 1) * 0.35;
  return { pitchSemitones, filterOffset: lfoFilter + envFilter, positionOffset, targetOffsets: {} };
}

function routeTargetOffsets(
  instrument: Instrument,
  rawLfo: number,
  rawLfo2: number,
  env: number,
  env2: number,
  velocity: number,
): Partial<Record<RuntimeModulationTarget, number>> | null {
  const routes = instrument.synthPatch?.modulation as RuntimeModulationRoute[] | undefined;
  if (!Array.isArray(routes)) return null;

  const offsets: Partial<Record<RuntimeModulationTarget, number>> = {};
  for (const route of routes) {
    if (route.enabled === false || !isRuntimeModulationTarget(route.target)) continue;
    const amount = Number.isFinite(route.amount) ? clamp(route.amount ?? 0, -1, 1) : 0;
    if (amount === 0) continue;

    const sourceValue = modulationSourceValue(instrument, route, rawLfo, rawLfo2, env, env2, velocity);
    if (sourceValue == null) continue;
    offsets[route.target] = (offsets[route.target] ?? 0) + sourceValue * amount * modulationTargetScale(route.target);
  }
  return offsets;
}

function modulationSourceValue(
  instrument: Instrument,
  route: RuntimeModulationRoute,
  rawLfo: number,
  rawLfo2: number,
  env: number,
  env2: number,
  velocity: number,
): number | null {
  if (route.source === "lfo.1") {
    if (instrument.synthPatch?.parameters?.["lfo.1.enabled"] === false) return 0;
    return lfoRouteValue(rawLfo, route.bipolar !== false);
  }
  if (route.source === "lfo.2") {
    if (instrument.synthPatch?.parameters?.["lfo.2.enabled"] !== true && instrument.lfo2Enabled !== true) return 0;
    return lfoRouteValue(rawLfo2, route.bipolar !== false);
  }
  if (route.source === "env.1") {
    return route.bipolar ? env * 2 - 1 : env;
  }
  if (route.source === "env.2") {
    return route.bipolar ? env2 * 2 - 1 : env2;
  }
  if (route.source === "velocity") {
    return route.bipolar ? velocity * 2 - 1 : velocity;
  }
  return null;
}

function modulationTargetOffset(modulation: RenderModulation, target: RuntimeModulationTarget): number {
  const value = modulation.targetOffsets[target] ?? 0;
  return Number.isFinite(value) ? value : 0;
}

function isRuntimeModulationTarget(value: unknown): value is RuntimeModulationTarget {
  return typeof value === "string" && [
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

function modulationTargetScale(target: RuntimeModulationTarget): number {
  if (target.endsWith(".fine") || target === "unison.detune") return 100;
  if (target === "filter.cutoff") return 0.35;
  return 1;
}

function effectiveLfoSmoothing(instrument: Instrument, lfo: 1 | 2): number {
  const params = instrument.synthPatch?.parameters;
  if (lfo === 1) return clamp01(Number(params?.["lfo.1.smoothing"] ?? instrument.lfoSmoothing ?? 0));
  return clamp01(Number(params?.["lfo.2.smoothing"] ?? instrument.lfo2Smoothing ?? 0));
}

function effectiveLfoRandomPhaseOffset(instrument: Instrument, lfo: 1 | 2): number {
  const params = instrument.synthPatch?.parameters;
  const amount = lfo === 1
    ? clamp01(Number(params?.["lfo.1.randomPhase"] ?? instrument.lfoRandomPhase ?? 0))
    : clamp01(Number(params?.["lfo.2.randomPhase"] ?? instrument.lfo2RandomPhase ?? 0));
  if (amount <= 0) return 0;
  const seed = `${instrument.id}|${instrument.name}|lfo.${lfo}`;
  return deterministicUnitHash(seed) * amount;
}

function deterministicUnitHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) & 0x00ffffff) / 0x01000000;
}

function filterKeytrackOffset(instrument: Instrument, sampleRate: number, frequency: number): number {
  const keytrack = clamp01(instrument.filterKeytrack ?? 0);
  if (keytrack <= 0 || !Number.isFinite(frequency) || frequency <= 0) return 0;
  const minHz = 50;
  const maxHz = Math.min(16000, sampleRate * 0.45);
  const octaveOffset = Math.log2(frequency / SYNTH_PREVIEW_BASE_HZ);
  return (octaveOffset * keytrack) / Math.log2(maxHz / minHz);
}

function lfoShapeValue(shape: NonNullable<Instrument["lfoWaveform"]>, cycles: number, oneShot = false, smoothing = 0): number {
  const phase = oneShot ? clamp(cycles, 0, 1) : cycles - Math.floor(cycles);
  const sine = Math.sin(phase * Math.PI * 2);
  let shaped: number;
  switch (shape) {
    case "square":
      shaped = phase < 0.5 ? 1 : -1;
      break;
    case "saw":
      shaped = phase * 2 - 1;
      break;
    case "triangle":
      shaped = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
      break;
    case "sine":
    default:
      return sine;
  }
  return shaped + (sine - shaped) * clamp01(smoothing);
}

function lfoRouteValue(raw: number, bipolar: boolean): number {
  return bipolar ? raw : (raw + 1) * 0.5;
}

function envelopePreviewValue(timeS: number, durationS: number, instrument: Instrument): number {
  const attack = Math.max(0.001, (instrument.envelope.attackMs ?? 5) / 1000);
  const decay = Math.max(0.001, (instrument.envelope.decayMs ?? 100) / 1000);
  const sustain = clamp01(instrument.envelope.sustain ?? 0.7);
  const release = Math.max(0.001, (instrument.envelope.releaseMs ?? 200) / 1000);
  if (timeS < attack) {
    return applyEnvelopeCurve(timeS / attack, instrument.envelope.attackCurve);
  }
  if (timeS < attack + decay) {
    const t = applyEnvelopeCurve((timeS - attack) / decay, instrument.envelope.decayCurve);
    return 1 + (sustain - 1) * t;
  }
  const releaseStart = Math.max(attack + decay, durationS - release);
  if (timeS > releaseStart) {
    const t = applyEnvelopeCurve((timeS - releaseStart) / release, instrument.envelope.releaseCurve);
    return sustain * Math.max(0, 1 - t);
  }
  return sustain;
}

function modEnvelopePreviewValue(timeS: number, durationS: number, instrument: Instrument): number {
  const params = instrument.synthPatch?.parameters;
  const attack = Math.max(0.001, numberParam(params?.["env.2.attack"], 0.01));
  const decay = Math.max(0.001, numberParam(params?.["env.2.decay"], 0.3));
  const sustain = clamp01(numberParam(params?.["env.2.sustain"], 0));
  const release = Math.max(0.001, numberParam(params?.["env.2.release"], 0.2));
  if (timeS < attack) {
    return applyEnvelopeCurve(timeS / attack, envelopeCurveParam(params?.["env.2.attackCurve"]));
  }
  if (timeS < attack + decay) {
    const t = applyEnvelopeCurve((timeS - attack) / decay, envelopeCurveParam(params?.["env.2.decayCurve"]));
    return 1 + (sustain - 1) * t;
  }
  const releaseStart = Math.max(attack + decay, durationS - release);
  if (timeS > releaseStart) {
    const t = applyEnvelopeCurve((timeS - releaseStart) / release, envelopeCurveParam(params?.["env.2.releaseCurve"]));
    return sustain * Math.max(0, 1 - t);
  }
  return sustain;
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function envelopeCurveParam(value: unknown): EnvelopeCurve {
  return value === "exp" || value === "log" || value === "s-curve" ? value : "linear";
}

function applyEnvelopeCurve(value: number, curve: EnvelopeCurve | undefined): number {
  const x = clamp01(value);
  if (curve === "exp") return x * x;
  if (curve === "log") return 1 - (1 - x) * (1 - x);
  if (curve === "s-curve") return x * x * (3 - 2 * x);
  return x;
}
