import { evaluateAutomationCurve } from "../automation/curves";
import type { AutomationCurve, CustomWavetableDefinition, CustomWavetableFrame, EnvelopeCurve, Instrument, WavetableConfig } from "../state/types";
import { sampleZoneStableId } from "../state/sampleZones";

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
  low2: number;
  band2: number;
  filterCutoff2: number;
  filterResonance2: number;
  filterF2: number;
  filterDamping2: number;
  low3: number; band3: number; filterCutoff3: number; filterResonance3: number; filterF3: number; filterDamping3: number;
  low4: number; band4: number; filterCutoff4: number; filterResonance4: number; filterF4: number; filterDamping4: number;
}

interface RenderModulation {
  pitchSemitones: number;
  filterOffset: number;
  positionOffset: number;
  ampEnvelope: number;
  targetOffsets: Partial<Record<RuntimeModulationTarget, number>>;
}

type DirectRuntimeModulationTarget =
  | `osc.${"a" | "b"}.${"position" | "warp" | "fine" | "level" | "pan" | "phase"}`
  | "filter.cutoff"
  | "filter.resonance"
  | "filter.drive"
  | "amp.level"
  | "amp.pan"
  | "unison.detune"
  | "unison.spread";

type MacroAutomationTarget = `macro.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
type RuntimeModulationTarget = DirectRuntimeModulationTarget | MacroAutomationTarget;

export type SynthAutomationTarget = RuntimeModulationTarget;

export interface SynthAutomationLane {
  target: SynthAutomationTarget;
  points: Array<{ timeS: number; value: number; curve?: AutomationCurve }>;
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
let browserPreviewAudioContext: AudioContext | null = null;

const MAX_RENDERED_INSTRUMENT_BUFFERS = 32;
const MAX_UNISON_VOICE_PLANS = 96;
const MAX_OSCILLATOR_RATE_ENTRIES = 128;
const CUSTOM_WAVETABLE_PARTIAL_COUNT = 16;

export interface InstrumentPreviewAuditionHandle {
  stop: () => void;
}

export function startInstrumentPreviewAudition(
  instrument: Instrument,
  durationS = 1.8,
  gainValue = 0.24,
  bpm = 120,
  velocity = 104,
  onEnded?: () => void,
  sampleSelection?: SamplePlaybackSelection,
): InstrumentPreviewAuditionHandle {
  const ctx = getBrowserPreviewAudioContext();
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  const source = createInstrumentBufferSource(ctx, instrument, durationS, previewFrequency(instrument), undefined, velocity, bpm, sampleSelection);
  const gain = ctx.createGain();
  let stopped = false;

  gain.gain.value = gainValue;
  const cleanup = () => {
    try {
      source.disconnect();
      gain.disconnect();
    } catch {
      // Nodes may already be disconnected after stop/end.
    }
  };

  source.connect(gain).connect(ctx.destination);
  source.onended = () => {
    cleanup();
    onEnded?.();
  };
  source.start();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        source.stop();
      } catch {
        // Source can already be stopped.
      }
      cleanup();
    },
  };
}

export async function startInstrumentSampleZoneAudition(
  instrument: Instrument,
  sampleSelection: SamplePlaybackSelection,
  durationS = 1.1,
  gainValue = 0.24,
  bpm = 120,
  velocity = 112,
  onEnded?: () => void,
): Promise<InstrumentPreviewAuditionHandle> {
  const ctx = getBrowserPreviewAudioContext();
  if (sampleSelection.samplePath) {
    await preloadInstrumentSampleUrl(ctx, sampleSelection.samplePath);
  } else {
    await preloadInstrumentSample(ctx, instrument);
  }
  return startInstrumentPreviewAudition(instrument, durationS, gainValue, bpm, velocity, onEnded, sampleSelection);
}

function getBrowserPreviewAudioContext(): AudioContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  if (!browserPreviewAudioContext || browserPreviewAudioContext.state === "closed") browserPreviewAudioContext = new Ctor();
  return browserPreviewAudioContext;
}

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

export interface SamplePlaybackSelection {
  sampleZoneId?: string;
  samplePath?: string;
}

interface UnisonVoicePlan {
  rates: number[];
  phaseOffsets: number[];
  weights: number[];
  weightSum: number;
}

export function createSynthRenderState(): SynthRenderState {
  return {
    phase: 0, index: 0,
    low: 0, band: 0, filterCutoff: -1, filterResonance: -1, filterF: 0, filterDamping: 1,
    low2: 0, band2: 0, filterCutoff2: -1, filterResonance2: -1, filterF2: 0, filterDamping2: 1,
    low3: 0, band3: 0, filterCutoff3: -1, filterResonance3: -1, filterF3: 0, filterDamping3: 1,
    low4: 0, band4: 0, filterCutoff4: -1, filterResonance4: -1, filterF4: 0, filterDamping4: 1,
  };
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

function glideBaseFrequency(instrument: Instrument, sourceFrequency: number, targetFrequency: number | undefined, timeS: number, durationS: number) {
  if (targetFrequency == null || !Number.isFinite(targetFrequency) || Math.abs(targetFrequency - sourceFrequency) <= 0.01) {
    return sourceFrequency;
  }

  const glideMs = Math.max(0, instrument.glideMs ?? 0);
  if (glideMs <= 0) {
    return sourceFrequency;
  }

  const glideDurationS = Math.min(durationS, glideMs / 1000);
  const glideT = clamp01(timeS / Math.max(0.001, glideDurationS));
  return sourceFrequency + (targetFrequency - sourceFrequency) * smoothstep(glideT);
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
  modWheel = 0,
  pitchBendSemitones = 0,
) {
  const state = createSynthRenderState();
  const durationS = out.length / sampleRate;
  const velocity01 = clamp01(velocity / 127);
  const sortedCurve = curve?.filter((point) => Number.isFinite(point.timeS) && Number.isFinite(point.frequency))
    .sort((a, b) => a.timeS - b.timeS);

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const amp = fade ? Math.min(1, t / 0.025, (durationS - t) / 0.08) : 1;
    const baseFrequency = sortedCurve && sortedCurve.length > 1
      ? frequencyAtCurveTime(sortedCurve, t)
      : glideBaseFrequency(instrument, frequency, targetFrequency, t, durationS);
    const modulation = modulationAtTime(
      instrument,
      t,
      durationS,
      bpm,
      velocity01,
      keytrackSourceValue(baseFrequency),
      modWheel,
      automationMacroValues(instrument, automation, t),
    );
    applyAutomationOffsets(instrument, modulation, automation, t);
    const currentFrequency = baseFrequency * Math.pow(2, (pitchBendSemitones + modulation.pitchSemitones) / 12);
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
  modWheel = 0,
  pitchBendSemitones = 0,
) {
  const length = Math.min(left.length, right.length);
  if (!instrument.aether) {
    const mono = new Float32Array(length);
    renderInstrumentSamples(instrument, mono, sampleRate, frequency, mode, fade, targetFrequency, curve, automation, bpm, velocity, modWheel, pitchBendSemitones);
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
  const sortedCurve = curve?.filter((point) => Number.isFinite(point.timeS) && Number.isFinite(point.frequency))
    .sort((a, b) => a.timeS - b.timeS);

  for (let i = 0; i < length; i++) {
    const timeS = i / sampleRate;
    const amp = fade ? Math.min(1, timeS / 0.025, (durationS - timeS) / 0.08) : 1;
    const baseFrequency = sortedCurve && sortedCurve.length > 1
      ? frequencyAtCurveTime(sortedCurve, timeS)
      : glideBaseFrequency(instrument, frequency, targetFrequency, timeS, durationS);
    const modulation = modulationAtTime(
      instrument,
      timeS,
      durationS,
      bpm,
      velocity01,
      keytrackSourceValue(baseFrequency),
      modWheel,
      automationMacroValues(instrument, automation, timeS),
    );
    applyAutomationOffsets(instrument, modulation, automation, timeS);
    const currentFrequency = baseFrequency * Math.pow(2, (pitchBendSemitones + modulation.pitchSemitones) / 12);
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
  sampleSelection?: SamplePlaybackSelection,
): AudioBufferSourceNode {
  const shouldGlide = targetFrequency != null && Number.isFinite(targetFrequency) && Math.abs(targetFrequency - frequency) > 0.01;
  const sampleTarget = nextSampleTarget(instrument, frequency, velocity, durationS, sampleSelection);
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

export interface InstrumentOutputWaveformPreview {
  peaks: number[];
  peak: number;
}

export function renderInstrumentOutputWaveformPreview(
  instrument: Instrument,
  bucketCount = 96,
  durationS = 1.1,
  bpm = 120,
  velocity = 104,
): InstrumentOutputWaveformPreview {
  const safeBucketCount = Math.max(8, Math.min(256, Math.round(bucketCount)));
  const sampleRate = 48000;
  const sampleCount = Math.max(safeBucketCount, Math.ceil(sampleRate * Math.max(0.05, durationS)));
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);

  renderInstrumentStereoSamples(
    instrument,
    left,
    right,
    sampleRate,
    previewFrequency(instrument),
    "audio",
    true,
    undefined,
    undefined,
    undefined,
    bpm,
    velocity,
  );

  let peak = 0;
  const rawPeaks = Array.from({ length: safeBucketCount }, (_, bucket) => {
    const start = Math.floor((bucket / safeBucketCount) * sampleCount);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) / safeBucketCount) * sampleCount));
    let bucketPeak = 0;
    for (let sample = start; sample < end; sample += 1) {
      bucketPeak = Math.max(bucketPeak, Math.abs(left[sample] ?? 0), Math.abs(right[sample] ?? 0));
    }
    peak = Math.max(peak, bucketPeak);
    return bucketPeak;
  });

  const normalizer = peak > 0.00001 ? peak : 1;
  return {
    peaks: rawPeaks.map((value) => clamp01(value / normalizer)),
    peak,
  };
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
  scope: string = "mix",
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
          oscillators: instrument.aether.oscillators?.map((oscillator) => ({ ...oscillator, enabled: oscillator.id === scope && oscillator.enabled })),
          sub: { ...instrument.aether.sub, enabled: false },
          noise: { ...instrument.aether.noise, enabled: false },
        },
      };

  const frequency = previewFrequency(scopedInstrument);
  const sampleRate = 48000;
  const modulation: RenderModulation = { pitchSemitones: 0, filterOffset: 0, positionOffset: 0, ampEnvelope: 1, targetOffsets: {} };
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
  sampleSelection?: SamplePlaybackSelection,
): AudioBufferSourceNode {
  const sorted = normalizeFrequencyCurve(curve, durationS, frequency);
  const sampleTarget = nextSampleTarget(instrument, frequency, velocity, durationS, sampleSelection);
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
  await Promise.all(urls.map((url) => preloadInstrumentSampleUrl(ctx, url)));
}

export async function preloadInstrumentSampleUrl(ctx: AudioContext, url: string): Promise<void> {
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

function sampleZoneTarget(zone: NonNullable<Instrument["sampleMap"]>[number]): SamplePlaybackTarget {
  return {
    url: zone.path,
    rootNote: zone.rootNote,
    tuning: zone.tuning,
    gain: decibelsToGain(zone.volumeDb),
    durationSeconds: zone.durationSeconds,
    loLengthSeconds: zone.loLengthSeconds,
    hiLengthSeconds: zone.hiLengthSeconds,
    startSample: zone.startSample,
    endSample: zone.endSample,
  };
}

function nextSampleTarget(
  instrument: Instrument,
  frequency: number,
  velocity = 127,
  durationS = 0,
  sampleSelection?: SamplePlaybackSelection,
): SamplePlaybackTarget | undefined {
  const midiPitch = frequencyToMidi(frequency);
  const cachedZones = (instrument.sampleMap ?? [])
    .filter((zone) => sampleBufferCache.has(zone.path))
    .map((zone, index) => ({ ...zone, id: sampleZoneStableId(zone, index) }));
  if (sampleSelection?.sampleZoneId || sampleSelection?.samplePath) {
    const selectedZone = cachedZones.find((zone) => zone.id === sampleSelection.sampleZoneId)
      ?? cachedZones.find((zone) => zone.path === sampleSelection.samplePath);
    if (selectedZone) return sampleZoneTarget(selectedZone);
    if (sampleSelection.samplePath && sampleBufferCache.has(sampleSelection.samplePath)) {
      return {
        url: sampleSelection.samplePath,
        rootNote: 60,
        tuning: 0,
        gain: 1,
        durationSeconds: sampleBufferCache.get(sampleSelection.samplePath)?.duration,
      };
    }
  }
  const zones = cachedZones
    .filter((zone) => midiPitch >= zone.loNote && midiPitch <= zone.hiNote && velocity >= zone.loVel && velocity <= zone.hiVel);
  const targets = zones.length > 0
    ? zones.map(sampleZoneTarget)
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

function oscillatorRate(
  octave: number,
  semitone: number,
  fineCents: number,
  tuningMode: "semitone" | "harmonic" | "ratio" | "step" = "semitone",
  harmonic = 1,
  ratioNumerator = 1,
  ratioDenominator = 1,
  tuningStep = 0,
  tuningDivisions = 12,
): number {
  const safeOctave = Math.round(clamp(octave, -8, 8));
  const safeSemitone = Math.round(clamp(semitone, -48, 48));
  const safeFine = quantizeKeyNumber(clamp(fineCents, -1200, 1200), 0.01);
  const key = `${safeOctave}|${safeSemitone}|${safeFine}|${tuningMode}|${harmonic}|${ratioNumerator}|${ratioDenominator}|${tuningStep}|${tuningDivisions}`;
  const cached = oscillatorRateCache.get(key);
  if (cached != null) return cached;

  const value = tuningMode === "semitone"
    ? Math.pow(2, safeOctave + safeSemitone / 12 + safeFine / 1200)
    : Math.pow(2, safeOctave + safeFine / 1200) * (tuningMode === "harmonic"
    ? Math.max(1, Math.round(harmonic))
    : tuningMode === "ratio"
    ? Math.max(0.001, ratioNumerator) / Math.max(0.001, ratioDenominator)
    : Math.pow(2, Math.round(tuningStep) / Math.max(1, Math.round(tuningDivisions))));
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

function runtimeWarpSample(input: number, amount: number, mode: WavetableConfig["warpMode"] = "shape"): number {
  const drive = clamp01(amount);
  if (drive <= 0.0001) return input;
  const x = clamp(input, -1, 1);
  if (mode === "fold") {
    const gain = 1 + drive * 5.5;
    const folded = Math.asin(Math.sin(x * gain)) / (Math.PI / 2);
    return clamp(x + (folded - x) * (0.35 + drive * 0.65), -1, 1);
  }
  if (mode === "pinch") {
    const shaped = Math.sign(x) * Math.pow(Math.abs(x), 1 + drive * 3.2);
    return clamp(x + (shaped - x) * (0.4 + drive * 0.6), -1, 1);
  }
  if (mode === "mirror") {
    const mirrored = Math.sin(x * Math.PI * (1 + drive * 2.2)) * (1 - Math.abs(x) * drive * 0.35);
    return clamp(x + (mirrored - x) * (0.32 + drive * 0.68), -1, 1);
  }
  const gain = 1 + drive * 8;
  return clamp(Math.tanh(x * gain) / Math.tanh(gain), -1, 1);
}

function applyRuntimeWarpStereo(instrument: Instrument, left: number, right: number): { left: number; right: number } {
  const amount = clamp01(instrument.aether?.runtimeWarp ?? 0);
  const mode = instrument.aether?.runtimeWarpMode ?? "shape";
  const amount2 = clamp01(instrument.aether?.runtimeWarp2 ?? 0);
  const mode2 = instrument.aether?.runtimeWarp2Mode ?? "shape";
  return {
    left: runtimeWarpSample(runtimeWarpSample(left, amount, mode), amount2, mode2),
    right: runtimeWarpSample(runtimeWarpSample(right, amount, mode), amount2, mode2),
  };
}

function applyRuntimeWarpSerial(input: number, config: NonNullable<Instrument["aether"]>): number {
  return runtimeWarpSample(
    runtimeWarpSample(input, config.runtimeWarp ?? 0, config.runtimeWarpMode ?? "shape"),
    config.runtimeWarp2 ?? 0,
    config.runtimeWarp2Mode ?? "shape",
  );
}

function quantizeKeyNumber(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / step) * step;
}

export function midiFrequency(midiPitch: number): number {
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
  modulation: RenderModulation = { pitchSemitones: 0, filterOffset: 0, positionOffset: 0, ampEnvelope: 1, targetOffsets: {} },
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

  const aetherBuses = instrument.kind === "wavetable" && instrument.aether
    ? aetherStackBuses(instrument, state, sampleRate, frequency, mode, modulation)
    : null;
  let v = aetherBuses
    ? aetherBuses.filtered
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

  const filterInput = v;
  if (drive > 0) {
    const amount = 1 + drive * 10;
    v = Math.tanh(v * amount) / Math.tanh(amount);
  }

  let filtered = resonantFilter(v, state, sampleRate, cutoff, resonance, instrument.filterType ?? "lowpass");
  if (instrument.filter2?.enabled) {
    let branch = instrument.filterRouting === "parallel" ? filterInput : filtered;
    if (instrument.filter2.drive > 0) {
      const amount = 1 + clamp01(instrument.filter2.drive) * 10;
      branch = Math.tanh(branch * amount) / Math.tanh(amount);
    }
    const filtered2 = resonantFilter(branch, state, sampleRate,
      clamp01(instrument.filter2.cutoff), clamp01(instrument.filter2.resonance), instrument.filter2.type, 1);
    filtered = instrument.filterRouting === "parallel" ? (filtered + filtered2) * 0.5 : filtered2;
  }
  if (aetherBuses?.filter1) {
    let branch = aetherBuses.filter1;
    if (drive > 0) { const amount = 1 + drive * 10; branch = Math.tanh(branch * amount) / Math.tanh(amount); }
    filtered += resonantFilter(branch, state, sampleRate, cutoff, resonance, instrument.filterType ?? "lowpass", 2);
  }
  if (aetherBuses?.filter2) {
    let branch = aetherBuses.filter2;
    const routeDrive = clamp01(instrument.filter2?.drive ?? 0);
    if (routeDrive > 0) { const amount = 1 + routeDrive * 10; branch = Math.tanh(branch * amount) / Math.tanh(amount); }
    filtered += resonantFilter(branch, state, sampleRate, clamp01(instrument.filter2?.cutoff ?? 1),
      clamp01(instrument.filter2?.resonance ?? 0), instrument.filter2?.type ?? "lowpass", 3);
  }
  if (aetherBuses && aetherBuses.direct !== 0) filtered += aetherBuses.direct;
  const level = clamp01((instrument.ampLevel ?? 1) + modulationTargetOffset(modulation, "amp.level"));
  state.phase += frequency / sampleRate;
  state.index += 1;
  return clamp(filtered * level * clamp01(modulation.ampEnvelope ?? 1), -1, 1);
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
  const warped = applyRuntimeWarpStereo(instrument, raw.left, raw.right);
  const directWarped = applyRuntimeWarpStereo(instrument, raw.directLeft, raw.directRight);
  const filter1Warped = applyRuntimeWarpStereo(instrument, raw.filter1Left, raw.filter1Right);
  const filter2Warped = applyRuntimeWarpStereo(instrument, raw.filter2Left, raw.filter2Right);
  let left = warped.left;
  let right = warped.right;

  if (drive > 0) {
    const amount = 1 + drive * 10;
    const normalizer = Math.tanh(amount);
    left = Math.tanh(left * amount) / normalizer;
    right = Math.tanh(right * amount) / normalizer;
  }

  left = resonantFilter(left, leftFilterState, sampleRate, cutoff, resonance, instrument.filterType ?? "lowpass");
  right = resonantFilter(right, rightFilterState, sampleRate, cutoff, resonance, instrument.filterType ?? "lowpass");
  if (instrument.filter2?.enabled) {
    let branchLeft = instrument.filterRouting === "parallel" ? warped.left : left;
    let branchRight = instrument.filterRouting === "parallel" ? warped.right : right;
    if (instrument.filter2.drive > 0) {
      const amount = 1 + clamp01(instrument.filter2.drive) * 10;
      const normalizer = Math.tanh(amount);
      branchLeft = Math.tanh(branchLeft * amount) / normalizer;
      branchRight = Math.tanh(branchRight * amount) / normalizer;
    }
    const filtered2Left = resonantFilter(branchLeft, leftFilterState, sampleRate,
      clamp01(instrument.filter2.cutoff), clamp01(instrument.filter2.resonance), instrument.filter2.type, 1);
    const filtered2Right = resonantFilter(branchRight, rightFilterState, sampleRate,
      clamp01(instrument.filter2.cutoff), clamp01(instrument.filter2.resonance), instrument.filter2.type, 1);
    if (instrument.filterRouting === "parallel") {
      left = (left + filtered2Left) * 0.5;
      right = (right + filtered2Right) * 0.5;
    } else {
      left = filtered2Left;
      right = filtered2Right;
    }
  }
  if (filter1Warped.left !== 0 || filter1Warped.right !== 0) {
    left += resonantFilter(filter1Warped.left, leftFilterState, sampleRate, cutoff, resonance, instrument.filterType ?? "lowpass", 2);
    right += resonantFilter(filter1Warped.right, rightFilterState, sampleRate, cutoff, resonance, instrument.filterType ?? "lowpass", 2);
  }
  if (filter2Warped.left !== 0 || filter2Warped.right !== 0) {
    left += resonantFilter(filter2Warped.left, leftFilterState, sampleRate, clamp01(instrument.filter2?.cutoff ?? 1),
      clamp01(instrument.filter2?.resonance ?? 0), instrument.filter2?.type ?? "lowpass", 3);
    right += resonantFilter(filter2Warped.right, rightFilterState, sampleRate, clamp01(instrument.filter2?.cutoff ?? 1),
      clamp01(instrument.filter2?.resonance ?? 0), instrument.filter2?.type ?? "lowpass", 3);
  }
  if (directWarped.left !== 0 || directWarped.right !== 0) {
    left += directWarped.left;
    right += directWarped.right;
  }

  const level = clamp01((instrument.ampLevel ?? 1) + modulationTargetOffset(modulation, "amp.level"));
  const ampEnvelope = clamp01(modulation.ampEnvelope ?? 1);
  const [ampLeft, ampRight] = panGains((instrument.ampPan ?? 0) + modulationTargetOffset(modulation, "amp.pan"));
  phaseState.phase += frequency / sampleRate;
  phaseState.index += 1;
  return {
    left: clamp(left * level * ampEnvelope * ampLeft, -1, 1),
    right: clamp(right * level * ampEnvelope * ampRight, -1, 1),
  };
}

function resonantFilter(
  input: number,
  state: SynthRenderState,
  sampleRate: number,
  cutoff: number,
  resonance: number,
  type: NonNullable<Instrument["filterType"]>,
  lane: 0 | 1 | 2 | 3 = 0,
): number {
  const minHz = 50;
  const maxHz = Math.min(16000, sampleRate * 0.45);
  let cachedCutoff = lane === 1 ? state.filterCutoff2 : lane === 2 ? state.filterCutoff3 : lane === 3 ? state.filterCutoff4 : state.filterCutoff;
  let cachedResonance = lane === 1 ? state.filterResonance2 : lane === 2 ? state.filterResonance3 : lane === 3 ? state.filterResonance4 : state.filterResonance;
  let filterF = lane === 1 ? state.filterF2 : lane === 2 ? state.filterF3 : lane === 3 ? state.filterF4 : state.filterF;
  let damping = lane === 1 ? state.filterDamping2 : lane === 2 ? state.filterDamping3 : lane === 3 ? state.filterDamping4 : state.filterDamping;
  let low = lane === 1 ? state.low2 : lane === 2 ? state.low3 : lane === 3 ? state.low4 : state.low;
  let band = lane === 1 ? state.band2 : lane === 2 ? state.band3 : lane === 3 ? state.band4 : state.band;
  if (Math.abs(cutoff - cachedCutoff) > 0.0005 || Math.abs(resonance - cachedResonance) > 0.0005) {
    const cutoffHz = minHz * Math.pow(maxHz / minHz, cutoff);
    filterF = Math.min(0.98, 2 * Math.sin(Math.PI * cutoffHz / sampleRate));
    damping = 1.45 - resonance * 1.25;
    cachedCutoff = cutoff;
    cachedResonance = resonance;
  }

  low = clamp(low + filterF * band, -4, 4);
  const high = input - low - damping * band;
  band = clamp(band + filterF * high, -4, 4);
  if (lane === 1) {
    state.low2 = low; state.band2 = band; state.filterF2 = filterF; state.filterDamping2 = damping;
    state.filterCutoff2 = cachedCutoff; state.filterResonance2 = cachedResonance;
  } else if (lane === 2) {
    state.low3 = low; state.band3 = band; state.filterF3 = filterF; state.filterDamping3 = damping;
    state.filterCutoff3 = cachedCutoff; state.filterResonance3 = cachedResonance;
  } else if (lane === 3) {
    state.low4 = low; state.band4 = band; state.filterF4 = filterF; state.filterDamping4 = damping;
    state.filterCutoff4 = cachedCutoff; state.filterResonance4 = cachedResonance;
  } else {
    state.low = low; state.band = band; state.filterF = filterF; state.filterDamping = damping;
    state.filterCutoff = cachedCutoff; state.filterResonance = cachedResonance;
  }

  const emphasized = low + band * resonance * 1.6;
  if (type === "highpass") return clamp(high, -1.2, 1.2);
  if (type === "bandpass") return clamp(band * (1 + resonance), -1.2, 1.2);
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
  const buses = aetherStackBuses(instrument, state, sampleRate, frequency, mode, modulation);
  return clamp(buses.filtered + buses.filter1 + buses.filter2 + buses.direct, -1, 1);
}

function aetherStackBuses(
  instrument: Instrument,
  state: SynthRenderState,
  sampleRate: number,
  frequency: number,
  mode: SynthRenderMode,
  modulation: RenderModulation,
): { filtered: number; filter1: number; filter2: number; direct: number } {
  const config = instrument.aether;
  if (!config) return { filtered: wavetableOscillatorSample(instrument, state.phase, sampleRate, frequency), filter1: 0, filter2: 0, direct: 0 };

  let sum = 0;
  let directSum = 0;
  let filter1Sum = 0;
  let filter2Sum = 0;
  let levelSum = 0;
  const interactionA: { sample: number; level: number; route: NonNullable<Instrument["aether"]>["oscA"]["route"]; active: boolean } = { sample: 0, level: 0, route: "filter", active: false };
  const interactionB = { sample: 0, active: false };
  const addOsc = (osc: NonNullable<Instrument["aether"]>["oscA"], key: string) => {
    const level = clamp01(osc.level + modulationTargetOffset(modulation, `osc.${key}.level`));
    if (!osc.enabled || level <= 0) return;
    const fineOffset = modulationTargetOffset(modulation, `osc.${key}.fine`);
    const rate = oscillatorRate(osc.octave, osc.semitone, osc.fineCents + fineOffset,
      osc.tuningMode, osc.harmonic, osc.ratioNumerator, osc.ratioDenominator, osc.tuningStep, osc.tuningDivisions);
    const waveform = osc.waveform ?? "wavetable";
    const legacyPositionOffset = key === "a" ? modulation.positionOffset : 0;
    const wavetableOffset = legacyPositionOffset + modulationTargetOffset(modulation, `osc.${key}.position`);
    const warpOffset = modulationTargetOffset(modulation, `osc.${key}.warp`);
    const wavetable = warpOffset === 0 ? osc.wavetable : { ...osc.wavetable, warp: clamp01(osc.wavetable.warp + warpOffset) };
    const unisonDetuneOffset = modulationTargetOffset(modulation, "unison.detune")
      + modulationTargetOffset(modulation, `osc.${key}.unison.detune`);
    const unisonSpreadOffset = modulationTargetOffset(modulation, "unison.spread")
      + modulationTargetOffset(modulation, `osc.${key}.unison.spread`);
    const phaseOffset = oscillatorPhaseOffset(osc, key) + modulationTargetOffset(modulation, `osc.${key}.phase`);
    const sourceSample = waveform === "wavetable"
      ? wavetableOscillatorSample(
          instrument,
          state.phase * rate + phaseOffset,
          sampleRate,
          frequency * rate,
          wavetable,
          wavetableOffset,
          unisonDetuneOffset,
          unisonSpreadOffset,
        )
      : waveform === "noise"
      ? mode === "audio" ? Math.random() * 2 - 1 : whiteNoiseSample(state.index + Math.round(rate * 97))
      : oscillatorSample(waveform, state.phase * rate + phaseOffset, clamp01(instrument.knobs.color));
    if (key === "a") {
      interactionA.sample = sourceSample; interactionA.level = level; interactionA.route = osc.route; interactionA.active = true;
    } else if (key === "b") { interactionB.sample = sourceSample; interactionB.active = true; }
    if (osc.route === "direct") directSum += sourceSample * level;
    else if (osc.route === "filter1") filter1Sum += sourceSample * level;
    else if (osc.route === "filter2") filter2Sum += sourceSample * level;
    else sum += sourceSample * level;
    levelSum += level;
  };
  const oscillators = config.oscillators?.length ? config.oscillators : [{ ...config.oscA, id: "a" }, { ...config.oscB, id: "b" }];
  for (const oscillator of oscillators) addOsc(oscillator, oscillator.id);
  if (config.interactionMode && config.interactionMode !== "off" && interactionA.active && interactionB.active) {
    const amount = clamp01(config.interactionAmount ?? 0);
    const interacted = config.interactionMode === "am"
      ? interactionA.sample * (0.5 + 0.5 * interactionB.sample)
      : interactionA.sample * interactionB.sample;
    const delta = Number.isFinite(interacted) ? (interacted - interactionA.sample) * amount * interactionA.level : 0;
    if (interactionA.route === "direct") directSum += delta;
    else if (interactionA.route === "filter1") filter1Sum += delta;
    else if (interactionA.route === "filter2") filter2Sum += delta;
    else sum += delta;
  }

  if (config.sub.enabled && config.sub.level > 0) {
    const rate = oscillatorRate(config.sub.octave, 0, 0);
    const subSample = oscillatorSample(config.sub.waveform, state.phase * rate, 0.5) * config.sub.level;
    if (config.sub.route === "direct") directSum += subSample;
    else if (config.sub.route === "filter1") filter1Sum += subSample;
    else if (config.sub.route === "filter2") filter2Sum += subSample;
    else sum += subSample;
    levelSum += config.sub.level;
  }

  if (config.noise.enabled && config.noise.level > 0) {
    const noise = mode === "audio" ? Math.random() * 2 - 1 : whiteNoiseSample(state.index);
    const softened = noise * (0.35 + clamp01(config.noise.color) * 0.65);
    if (config.noise.route === "direct") directSum += softened * config.noise.level;
    else if (config.noise.route === "filter1") filter1Sum += softened * config.noise.level;
    else if (config.noise.route === "filter2") filter2Sum += softened * config.noise.level;
    else sum += softened * config.noise.level;
    levelSum += config.noise.level;
  }

  if (levelSum <= 0) return { filtered: 0, filter1: 0, filter2: 0, direct: 0 };
  const normalizer = Math.max(0.35, levelSum);
  return {
    filtered: applyRuntimeWarpSerial(clamp(sum / normalizer, -1, 1), config),
    filter1: applyRuntimeWarpSerial(clamp(filter1Sum / normalizer, -1, 1), config),
    filter2: applyRuntimeWarpSerial(clamp(filter2Sum / normalizer, -1, 1), config),
    direct: applyRuntimeWarpSerial(clamp(directSum / normalizer, -1, 1), config),
  };
}

function aetherStackStereoSample(
  instrument: Instrument,
  state: SynthRenderState,
  sampleRate: number,
  frequency: number,
  mode: SynthRenderMode,
  modulation: RenderModulation,
): { left: number; right: number; filter1Left: number; filter1Right: number; filter2Left: number; filter2Right: number; directLeft: number; directRight: number } {
  const config = instrument.aether;
  if (!config) {
    const sample = wavetableOscillatorSample(instrument, state.phase, sampleRate, frequency);
    return { left: sample, right: sample, filter1Left: 0, filter1Right: 0, filter2Left: 0, filter2Right: 0, directLeft: 0, directRight: 0 };
  }

  let left = 0;
  let right = 0;
  let directLeft = 0;
  let directRight = 0;
  let filter1Left = 0; let filter1Right = 0; let filter2Left = 0; let filter2Right = 0;
  let levelSum = 0;
  const interactionA: { sample: number; level: number; pan: number; route: NonNullable<Instrument["aether"]>["oscA"]["route"]; active: boolean } = { sample: 0, level: 0, pan: 0, route: "filter", active: false };
  const interactionB = { sample: 0, active: false };

  const add = (value: number, level: number, pan: number, route: "filter" | "both" | "filter1" | "filter2" | "direct" = "filter") => {
    const [leftGain, rightGain] = panGains(pan);
    if (route === "direct") {
      directLeft += value * level * leftGain;
      directRight += value * level * rightGain;
    } else if (route === "filter1") { filter1Left += value * level * leftGain; filter1Right += value * level * rightGain;
    } else if (route === "filter2") { filter2Left += value * level * leftGain; filter2Right += value * level * rightGain;
    } else {
      left += value * level * leftGain;
      right += value * level * rightGain;
    }
    levelSum += level;
  };

  const addOsc = (
    osc: NonNullable<Instrument["aether"]>["oscA"],
    key: string,
  ) => {
    const level = clamp01(osc.level + modulationTargetOffset(modulation, `osc.${key}.level`));
    if (!osc.enabled || level <= 0) return;
    const fineOffset = modulationTargetOffset(modulation, `osc.${key}.fine`);
    const rate = oscillatorRate(osc.octave, osc.semitone, osc.fineCents + fineOffset,
      osc.tuningMode, osc.harmonic, osc.ratioNumerator, osc.ratioDenominator, osc.tuningStep, osc.tuningDivisions);
    const waveform = osc.waveform ?? "wavetable";
    const legacyPositionOffset = key === "a" ? modulation.positionOffset : 0;
    const wavetableOffset = legacyPositionOffset + modulationTargetOffset(modulation, `osc.${key}.position`);
    const warpOffset = modulationTargetOffset(modulation, `osc.${key}.warp`);
    const wavetable = warpOffset === 0 ? osc.wavetable : { ...osc.wavetable, warp: clamp01(osc.wavetable.warp + warpOffset) };
    const unisonDetuneOffset = modulationTargetOffset(modulation, "unison.detune")
      + modulationTargetOffset(modulation, `osc.${key}.unison.detune`);
    const unisonSpreadOffset = modulationTargetOffset(modulation, "unison.spread")
      + modulationTargetOffset(modulation, `osc.${key}.unison.spread`);
    const phaseOffset = oscillatorPhaseOffset(osc, key) + modulationTargetOffset(modulation, `osc.${key}.phase`);
    const sourceSample = waveform === "wavetable"
      ? wavetableOscillatorSample(
          instrument,
          state.phase * rate + phaseOffset,
          sampleRate,
          frequency * rate,
          wavetable,
          wavetableOffset,
          unisonDetuneOffset,
          unisonSpreadOffset,
        )
      : waveform === "noise"
      ? mode === "audio" ? Math.random() * 2 - 1 : whiteNoiseSample(state.index + Math.round(rate * 97))
      : oscillatorSample(waveform, state.phase * rate + phaseOffset, clamp01(instrument.knobs.color));
    const pan = osc.pan + modulationTargetOffset(modulation, `osc.${key}.pan`);
    if (key === "a") {
      interactionA.sample = sourceSample; interactionA.level = level; interactionA.pan = pan; interactionA.route = osc.route; interactionA.active = true;
    } else if (key === "b") { interactionB.sample = sourceSample; interactionB.active = true; }
    add(sourceSample, level, pan, osc.route);
  };

  const oscillators = config.oscillators?.length ? config.oscillators : [{ ...config.oscA, id: "a" }, { ...config.oscB, id: "b" }];
  for (const oscillator of oscillators) addOsc(oscillator, oscillator.id);
  if (config.interactionMode && config.interactionMode !== "off" && interactionA.active && interactionB.active) {
    const amount = clamp01(config.interactionAmount ?? 0);
    const interacted = config.interactionMode === "am"
      ? interactionA.sample * (0.5 + 0.5 * interactionB.sample)
      : interactionA.sample * interactionB.sample;
    const delta = Number.isFinite(interacted) ? (interacted - interactionA.sample) * amount * interactionA.level : 0;
    const [leftGain, rightGain] = panGains(interactionA.pan);
    if (interactionA.route === "direct") { directLeft += delta * leftGain; directRight += delta * rightGain; }
    else if (interactionA.route === "filter1") { filter1Left += delta * leftGain; filter1Right += delta * rightGain; }
    else if (interactionA.route === "filter2") { filter2Left += delta * leftGain; filter2Right += delta * rightGain; }
    else { left += delta * leftGain; right += delta * rightGain; }
  }

  if (config.sub.enabled && config.sub.level > 0) {
    const rate = oscillatorRate(config.sub.octave, 0, 0);
    add(oscillatorSample(config.sub.waveform, state.phase * rate, 0.5), config.sub.level, 0, config.sub.route);
  }

  if (config.noise.enabled && config.noise.level > 0) {
    const noise = mode === "audio" ? Math.random() * 2 - 1 : whiteNoiseSample(state.index);
    const softened = noise * (0.35 + clamp01(config.noise.color) * 0.65);
    add(softened, config.noise.level, 0, config.noise.route);
  }

  if (levelSum <= 0) return { left: 0, right: 0, filter1Left: 0, filter1Right: 0, filter2Left: 0, filter2Right: 0, directLeft: 0, directRight: 0 };
  const normalizer = Math.max(0.35, levelSum);
  return {
    left: clamp(left / normalizer, -1, 1),
    right: clamp(right / normalizer, -1, 1),
    filter1Left: clamp(filter1Left / normalizer, -1, 1), filter1Right: clamp(filter1Right / normalizer, -1, 1),
    filter2Left: clamp(filter2Left / normalizer, -1, 1), filter2Right: clamp(filter2Right / normalizer, -1, 1),
    directLeft: clamp(directLeft / normalizer, -1, 1),
    directRight: clamp(directRight / normalizer, -1, 1),
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
    ? [custom.interpolation ?? "linear", clamp01(custom.morph).toFixed(3), custom.frames.map((frame) => [
        frame.brightness.toFixed(3),
        frame.even.toFixed(3),
        frame.fold.toFixed(3),
        frame.formant.toFixed(3),
        frame.notch.toFixed(3),
        frame.skew.toFixed(3),
        frame.tilt.toFixed(3),
        frame.focus.toFixed(3),
        frame.phase.toFixed(3),
        ...(frame.partials ?? []).map((partial) => partial.toFixed(3)),
      ].join(",")).join(";")].join(":")
    : "";
  const positionKey = custom
    ? custom.frames.map((frame, index) => (frame.position ?? index / Math.max(1, custom.frames.length - 1)).toFixed(3)).join(",")
    : "";
  return [
    config.bank,
    config.customId ?? "",
    harmonicLimit,
    clamp01(warp).toFixed(3),
    warpMode ?? "shape",
    positionKey,
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
  const customMorph = custom ? clamp01(custom.morph) : 0;
  const smoothCustom = custom?.interpolation === "smooth";
  const frameCount = custom ? (smoothCustom || customMorph > 0 ? WAVETABLE_FRAME_COUNT : custom.frames.length) : WAVETABLE_FRAME_COUNT;
  const frameSize = PREVIEW_WAVETABLE_FRAME_SIZE;
  const samples = new Float32Array(frameCount * frameSize);
  for (let frame = 0; frame < frameCount; frame++) {
    const normalizedFrame = frame / Math.max(1, frameCount - 1);
    const customFrame = custom ? interpolatePreviewCustomFrame(custom.frames, normalizedFrame, smoothCustom, customMorph) : null;
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

function interpolatePreviewValue(p0: number, p1: number, p2: number, p3: number, mix: number): number {
  const t = clamp01(mix);
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1)
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function morphPreviewMix(mix: number, morph: number): number {
  const t = clamp01(mix);
  const eased = t * t * t * (t * (t * 6 - 15) + 10);
  return t + (eased - t) * clamp01(morph);
}

function interpolatePreviewCustomFrame(
  frames: CustomWavetableFrame[],
  normalizedFrame: number,
  smoothInterpolation: boolean,
  morph = 0,
): CustomWavetableFrame {
  const safeFrames = frames.length >= 4 ? frames : [...frames, ...frames.slice(-1), ...frames.slice(-1), ...frames.slice(-1)].slice(0, 4);
  const anchor = previewFrameAnchor(safeFrames, normalizedFrame);
  const base = anchor.left;
  const next = anchor.right;
  const mix = morphPreviewMix(anchor.mix, morph);
  const a = safeFrames[base];
  const b = safeFrames[next];
  if (!smoothInterpolation) {
    return {
      brightness: a.brightness + (b.brightness - a.brightness) * mix,
      even: a.even + (b.even - a.even) * mix,
      fold: a.fold + (b.fold - a.fold) * mix,
      formant: a.formant + (b.formant - a.formant) * mix,
      notch: a.notch + (b.notch - a.notch) * mix,
      skew: a.skew + (b.skew - a.skew) * mix,
      tilt: a.tilt + (b.tilt - a.tilt) * mix,
      focus: a.focus + (b.focus - a.focus) * mix,
      phase: a.phase + (b.phase - a.phase) * mix,
      partials: interpolatePreviewPartials(a.partials, b.partials, mix),
    };
  }

  const p0 = safeFrames[Math.max(0, base - 1)];
  const p3 = safeFrames[Math.min(safeFrames.length - 1, next + 1)];
  return {
    brightness: clamp01(interpolatePreviewValue(p0.brightness, a.brightness, b.brightness, p3.brightness, mix)),
    even: clamp01(interpolatePreviewValue(p0.even, a.even, b.even, p3.even, mix)),
    fold: clamp01(interpolatePreviewValue(p0.fold, a.fold, b.fold, p3.fold, mix)),
    formant: clamp01(interpolatePreviewValue(p0.formant, a.formant, b.formant, p3.formant, mix)),
    notch: clamp01(interpolatePreviewValue(p0.notch, a.notch, b.notch, p3.notch, mix)),
    skew: clamp(interpolatePreviewValue(p0.skew, a.skew, b.skew, p3.skew, mix), -1, 1),
    tilt: clamp(interpolatePreviewValue(p0.tilt, a.tilt, b.tilt, p3.tilt, mix), -1, 1),
    focus: clamp01(interpolatePreviewValue(p0.focus, a.focus, b.focus, p3.focus, mix)),
    phase: clamp(interpolatePreviewValue(p0.phase, a.phase, b.phase, p3.phase, mix), -1, 1),
    partials: interpolatePreviewPartials(a.partials, b.partials, mix, p0.partials, p3.partials),
  };
}

function previewFrameAnchor(frames: CustomWavetableFrame[], normalizedFrame: number): { left: number; right: number; mix: number } {
  const count = Math.max(1, frames.length);
  const position = clamp01(normalizedFrame);
  if (count <= 1) return { left: 0, right: 0, mix: 0 };
  const anchors = frames.map((frame, index) => ({
    index,
    position: clamp01(frame.position ?? index / Math.max(1, count - 1)),
  })).sort((a, b) => a.position - b.position || a.index - b.index);
  if (position <= anchors[0].position) return { left: anchors[0].index, right: anchors[0].index, mix: 0 };
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const a = anchors[index];
    const b = anchors[index + 1];
    if (position > b.position) continue;
    const span = Math.max(0.000001, b.position - a.position);
    return { left: a.index, right: b.index, mix: clamp01((position - a.position) / span) };
  }
  const last = anchors[anchors.length - 1].index;
  return { left: last, right: last, mix: 1 };
}

function interpolatePreviewPartials(a?: number[], b?: number[], mix = 0, p0?: number[], p3?: number[]): number[] | undefined {
  if (!a && !b && !p0 && !p3) return undefined;
  return Array.from({ length: CUSTOM_WAVETABLE_PARTIAL_COUNT }, (_, index) => {
    const av = clamp01(a?.[index] ?? 0);
    const bv = clamp01(b?.[index] ?? 0);
    if (!p0 || !p3) return av + (bv - av) * mix;
    return clamp01(interpolatePreviewValue(clamp01(p0[index] ?? 0), av, bv, clamp01(p3[index] ?? 0), mix));
  });
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
    morph: Number.isFinite(table.morph) ? clamp01(table.morph) : 0,
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
    formant: Number.isFinite(frame.formant) ? clamp01(frame.formant) : 0.12,
    notch: Number.isFinite(frame.notch) ? clamp01(frame.notch) : 0.08,
    skew: Number.isFinite(frame.skew) ? clamp(frame.skew, -1, 1) : 0,
    tilt: Number.isFinite(frame.tilt) ? clamp(frame.tilt, -1, 1) : 0,
    focus: Number.isFinite(frame.focus) ? clamp01(frame.focus) : 0.35,
    phase: Number.isFinite(frame.phase) ? clamp(frame.phase, -1, 1) : 0,
    partials: Array.isArray(frame.partials)
      ? Array.from({ length: CUSTOM_WAVETABLE_PARTIAL_COUNT }, (_, index) => clamp01(frame.partials?.[index] ?? 0))
      : undefined,
  };
}

function warpModeIntensity(warp: number, warpMode: WavetableConfig["warpMode"] = "shape"): number {
  if (warpMode === "fold") return clamp01(warp) * 1.35;
  if (warpMode === "pinch") return Math.pow(clamp01(warp), 0.72);
  if (warpMode === "mirror") return Math.pow(clamp01(warp), 1.12) * 1.48;
  return clamp01(warp);
}

function customWavetableHarmonicAmplitude(frame: CustomWavetableFrame, harmonic: number, warp: number, warpMode: WavetableConfig["warpMode"] = "shape"): number {
  const brightness = clamp01(frame.brightness);
  const even = clamp01(frame.even);
  const formant = clamp01(frame.formant);
  const notch = clamp01(frame.notch);
  const skew = clampBipolar(frame.skew);
  const tilt = clampBipolar(frame.tilt);
  const focus = clamp01(frame.focus);
  const shapedWarp = warpModeIntensity(warp, warpMode);
  const fold = clamp01(frame.fold + shapedWarp * 0.35);
  const parity = harmonic % 2 === 1 ? 1 : even;
  const rolloff = Math.exp(-harmonic * (0.016 + (1 - brightness) * 0.085));
  const skewBias = Math.max(0.18, 1 + skew * ((harmonic - 8) / 18));
  const tiltBias = Math.max(0.12, Math.exp(tilt * ((harmonic - 8) / 9)));
  const foldPeak = Math.exp(-Math.pow((harmonic - (3 + brightness * 20)) / (1.6 + fold * 8), 2));
  const formantCenter = 4 + brightness * 24 + skew * 4;
  const focusNarrow = 1 - focus * 0.72;
  const formantWidth = (1.1 + fold * 4.4) * focusNarrow;
  const formantPeak = Math.exp(-Math.pow((harmonic - formantCenter) / formantWidth, 2));
  const notchCenter = 6 + (1 - brightness) * 18 - skew * 4;
  const notchWidth = (1.2 + fold * 4.8 + formant * 1.8) * focusNarrow;
  const notchPeak = Math.exp(-Math.pow((harmonic - notchCenter) / notchWidth, 2));
  const notchCut = Math.max(0.08, 1 - notchPeak * notch * (0.58 + focus * 0.28));
  const folded = warpMode === "fold" ? Math.abs(Math.sin(harmonic * 0.62 + frame.phase)) * shapedWarp * 0.24 : 0;
  const pinched = warpMode === "pinch" ? Math.exp(-Math.pow((harmonic - (2 + brightness * 8)) / 2.4, 2)) * shapedWarp * 0.28 : 0;
  const mirrored = warpMode === "mirror"
    ? (0.16 + (harmonic % 2 === 0 ? 0.18 : 0.04)) * shapedWarp * (0.75 + Math.abs(Math.sin(harmonic * 0.38 + frame.phase * Math.PI)) * 0.45) / Math.sqrt(harmonic)
    : 0;
  const drawnPartial = harmonic <= CUSTOM_WAVETABLE_PARTIAL_COUNT ? clamp01(frame.partials?.[harmonic - 1] ?? 0) : 0;
  const motion = 1 + Math.sin(harmonic * 1.7 + frame.phase * Math.PI) * fold * 0.28;
  return Math.max(0, (parity * rolloff * motion * skewBias * tiltBias / Math.sqrt(harmonic) + foldPeak * fold * 0.35 + formantPeak * formant * (0.42 + focus * 0.28) + drawnPartial * (0.08 + brightness * 0.34)) * notchCut + folded + pinched + mirrored);
}

function customWavetableHarmonicPhase(frame: CustomWavetableFrame, harmonic: number, warp: number, warpMode: WavetableConfig["warpMode"] = "shape"): number {
  const shapedWarp = warpModeIntensity(warp, warpMode);
  const skew = clampBipolar(frame.skew);
  const formant = clamp01(frame.formant);
  const notch = clamp01(frame.notch);
  const modePhase = warpMode === "fold"
    ? Math.sin(harmonic * 0.73) * shapedWarp * 0.45
    : warpMode === "pinch"
      ? Math.cos(harmonic * 0.29) * shapedWarp * 0.24
      : warpMode === "mirror"
        ? Math.sin(harmonic * 0.19 + frame.phase * Math.PI) * (harmonic % 2 === 0 ? 1 : -1) * shapedWarp * 0.38
      : 0;
  return frame.phase * harmonic * 0.28
    + Math.sin(harmonic * 0.41 + skew * 0.55) * clamp01(frame.fold + shapedWarp * 0.25) * 0.55
    + skew * Math.log2(harmonic + 1) * 0.09
    + Math.sin(harmonic * 0.23 + frame.phase) * formant * 0.12
    + Math.cos(harmonic * 0.31 + skew) * notch * 0.08
    + modePhase;
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
  const mirrored = warpMode === "mirror"
    ? (0.13 + (harmonic % 2 === 0 ? 0.21 : 0.03)) * shapedWarp * (0.7 + Math.abs(Math.sin(harmonic * 0.36 + frame * Math.PI)) * 0.5) / Math.sqrt(harmonic)
    : 0;
  switch (bank) {
    case "glass":
      return Math.exp(-harmonic * (0.045 + frame * 0.025)) * (odd ? 1 : 0.22 + shapedWarp * 0.45) * (1 + Math.sin(harmonic * 1.7 + frame * 5) * 0.18) + folded + pinched + mirrored;
    case "vocal": {
      const formantA = Math.exp(-Math.pow((harmonic - (3 + frame * 9)) / (1.4 + shapedWarp * 3), 2));
      const formantB = Math.exp(-Math.pow((harmonic - (11 + frame * 18)) / (2.5 + shapedWarp * 6), 2));
      return (formantA * 1.4 + formantB * 0.9 + (odd ? 0.08 : 0.03)) / Math.sqrt(harmonic) + folded + pinched + mirrored;
    }
    case "organ":
      return [1, 0, 0.55, 0.22, 0.38, 0, 0.18, 0.1][(harmonic - 1) % 8] * Math.exp(-frame * harmonic * 0.01) + (shapedWarp * 0.08) / harmonic + folded + pinched + mirrored;
    case "fm":
      return Math.abs(Math.sin(harmonic * (0.45 + frame * 0.9))) * Math.exp(-harmonic * (0.028 + (1 - shapedWarp) * 0.028)) / Math.sqrt(harmonic) + folded + pinched + mirrored;
    case "aether":
    default:
      return Math.exp(-harmonic * (0.022 + frame * 0.04)) * (odd ? 1 : frame * 0.8 + shapedWarp * 0.35) / Math.sqrt(harmonic) + folded + pinched + mirrored;
  }
}

function wavetableHarmonicPhase(bank: NonNullable<Instrument["wavetable"]>["bank"], harmonic: number, frame: number, warp: number, warpMode: WavetableConfig["warpMode"] = "shape"): number {
  const modePhase = warpMode === "fold"
    ? Math.sin(harmonic * 0.47 + frame * Math.PI) * warpModeIntensity(warp, warpMode) * 0.55
    : warpMode === "pinch"
      ? Math.cos(harmonic * 0.33 + frame) * warpModeIntensity(warp, warpMode) * 0.3
      : warpMode === "mirror"
        ? Math.sin(harmonic * 0.24 + frame * Math.PI) * (harmonic % 2 === 0 ? 1 : -1) * warpModeIntensity(warp, warpMode) * 0.42
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

function oscillatorPhaseOffset(osc: NonNullable<Instrument["aether"]>["oscA"], key: string): number {
  if (osc.phaseMode === "memory") return 0;
  const basePhase = clamp01(osc.phase ?? 0);
  const randomDepth = clamp01(osc.randomPhase ?? 0);
  if (randomDepth <= 0) return basePhase;
  const seed = Array.from(key).reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619), 9176);
  const jitter = (whiteNoiseSample(seed + Math.round(basePhase * 10000)) + 1) * 0.5;
  return basePhase + jitter * randomDepth;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function clampBipolar(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
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
    if (isMacroAutomationTarget(lane.target)) continue;
    const value = automationValueAtTime(lane.points, timeS);
    if (value == null) continue;
    const base = baseAutomationValue(instrument, lane.target);
    if (base == null) continue;
    modulation.targetOffsets[lane.target] = (modulation.targetOffsets[lane.target] ?? 0) + value - base;
  }
}

function automationMacroValues(
  instrument: Instrument,
  automation: SynthAutomationLane[] | undefined,
  timeS: number,
): Partial<Record<MacroAutomationTarget, number>> | undefined {
  if (!automation?.length) return undefined;
  const values: Partial<Record<MacroAutomationTarget, number>> = {};
  for (const lane of automation) {
    if (!isMacroAutomationTarget(lane.target) || lane.points.length === 0) continue;
    const value = automationValueAtTime(lane.points, timeS);
    if (value == null) continue;
    const base = baseAutomationValue(instrument, lane.target);
    if (base == null) continue;
    values[lane.target] = value;
  }
  return Object.keys(values).length > 0 ? values : undefined;
}

function automationValueAtTime(points: Array<{ timeS: number; value: number; curve?: AutomationCurve }>, timeS: number): number | null {
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
      return evaluateAutomationCurve(prev.curve, prev.value, next.value, mix);
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
    case "osc.a.warp":
      return instrument.aether?.oscA.wavetable.warp ?? instrument.wavetable?.warp ?? 0;
    case "osc.b.warp":
      return instrument.aether?.oscB.wavetable.warp ?? instrument.wavetable?.warp ?? 0;
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
    case "osc.a.phase":
      return instrument.aether?.oscA.phase ?? 0;
    case "osc.b.phase":
      return instrument.aether?.oscB.phase ?? 0;
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
    case "macro.1":
    case "macro.2":
    case "macro.3":
    case "macro.4":
    case "macro.5":
    case "macro.6":
    case "macro.7":
    case "macro.8":
      return clamp01(Number(instrument.synthPatch?.parameters?.[target] ?? 0));
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

export function modulationAtTime(
  instrument: Instrument,
  timeS: number,
  durationS: number,
  bpm = 120,
  velocity = 1,
  keytrack = keytrackSourceValue(previewFrequency(instrument)),
  modWheel = 0,
  macroOverrides?: Partial<Record<MacroAutomationTarget, number>>,
  pressure = 0,
  timbre = 0,
): RenderModulation {
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
  const rawExtraLfos = Array.from({ length: 8 }, (_, offset) => {
    const index = offset + 3;
    const prefix = `lfo.${index}`;
    const params = instrument.synthPatch?.parameters;
    if (params?.[`${prefix}.enabled`] !== true) return 0;
    const rate = params?.[`${prefix}.sync`] === true
      ? syncedLfoRateHz(params?.[`${prefix}.syncedRate`] ?? "1/4", bpm)
      : Math.max(0.01, Number(params?.[`${prefix}.rate`] ?? 1));
    const phase = Number(params?.[`${prefix}.phase`] ?? 0);
    const smoothing = clamp01(Number(params?.[`${prefix}.smoothing`] ?? 0));
    const oneShot = params?.[`${prefix}.oneShot`] === true;
    const shape = String(params?.[`${prefix}.shape`] ?? "sine") as NonNullable<Instrument["lfoWaveform"]>;
    return lfoShapeValue(shape, timeS * rate + phase, oneShot, smoothing);
  });
  const env = envelopePreviewValue(timeS, durationS, instrument);
  const env2 = modEnvelopePreviewValue(timeS, durationS, instrument, 2);
  const env3 = modEnvelopePreviewValue(timeS, durationS, instrument, 3);
  const env4 = modEnvelopePreviewValue(timeS, durationS, instrument, 4);
  const targetOffsets = routeTargetOffsets(instrument, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, keytrack, modWheel, macroOverrides, pressure, timbre);
  if (targetOffsets) {
    return { pitchSemitones: 0, filterOffset: 0, positionOffset: 0, ampEnvelope: env, targetOffsets };
  }

  const positionLfo = lfoRouteValue(rawLfo, instrument.lfoPositionBipolar ?? true);
  const pitchLfo = lfoRouteValue(rawLfo, instrument.lfoPitchBipolar ?? true);
  const filterLfo = lfoRouteValue(rawLfo, instrument.lfoFilterBipolar ?? true);
  const positionOffset = positionLfo * clamp01(instrument.lfoDepth ?? 0);
  const pitchSemitones = pitchLfo * Math.max(0, instrument.lfoToPitch ?? 0);
  const lfoFilter = filterLfo * clamp(instrument.lfoToFilter ?? 0, -1, 1) * 0.35;
  const envFilter = env * clamp(instrument.envToFilter ?? 0, -1, 1) * 0.35;
  return { pitchSemitones, filterOffset: lfoFilter + envFilter, positionOffset, ampEnvelope: env, targetOffsets: {} };
}

function routeTargetOffsets(
  instrument: Instrument,
  rawLfo: number,
  rawLfo2: number,
  rawExtraLfos: number[],
  env: number,
  env2: number,
  env3: number,
  env4: number,
  velocity: number,
  keytrack: number,
  modWheel: number,
  macroOverrides?: Partial<Record<MacroAutomationTarget, number>>,
  pressure = 0,
  timbre = 0,
): Partial<Record<DirectRuntimeModulationTarget, number>> | null {
  const routes = instrument.synthPatch?.modulation as RuntimeModulationRoute[] | undefined;
  if (!Array.isArray(routes)) return null;

  const offsets: Partial<Record<DirectRuntimeModulationTarget, number>> = {};
  for (const route of routes) {
    if (route.enabled === false || !isDirectRuntimeModulationTarget(route.target)) continue;
    const amount = Number.isFinite(route.amount) ? clamp(route.amount ?? 0, -1, 1) : 0;
    if (amount === 0) continue;

    const sourceValue = modulationSourceValue(instrument, route, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, keytrack, modWheel, macroOverrides, pressure, timbre);
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
  rawExtraLfos: number[],
  env: number,
  env2: number,
  env3: number,
  env4: number,
  velocity: number,
  keytrack: number,
  modWheel: number,
  macroOverrides?: Partial<Record<MacroAutomationTarget, number>>,
  pressure = 0,
  timbre = 0,
): number | null {
  if (route.source === "lfo.1") {
    if (instrument.synthPatch?.parameters?.["lfo.1.enabled"] === false) return 0;
    return lfoRouteValue(rawLfo, route.bipolar !== false);
  }
  if (route.source === "lfo.2") {
    if (instrument.synthPatch?.parameters?.["lfo.2.enabled"] !== true && instrument.lfo2Enabled !== true) return 0;
    return lfoRouteValue(rawLfo2, route.bipolar !== false);
  }
  const extraLfoSource = typeof route.source === "string" ? route.source : "";
  const extraLfoMatch = /^lfo\.(?:[3-9]|10)$/.exec(extraLfoSource);
  if (extraLfoMatch) {
    const index = Number(extraLfoSource.slice(4));
    return lfoRouteValue(rawExtraLfos[index - 3] ?? 0, route.bipolar !== false);
  }
  if (route.source === "env.1") {
    return route.bipolar ? env * 2 - 1 : env;
  }
  if (route.source === "env.2") {
    return route.bipolar ? env2 * 2 - 1 : env2;
  }
  if (route.source === "env.3") return route.bipolar ? env3 * 2 - 1 : env3;
  if (route.source === "env.4") return route.bipolar ? env4 * 2 - 1 : env4;
  if (route.source === "velocity") {
    return route.bipolar ? velocity * 2 - 1 : velocity;
  }
  if (route.source === "keytrack") {
    return route.bipolar ? keytrack * 2 - 1 : keytrack;
  }
  if (route.source === "modWheel") {
    const value = clamp01(modWheel);
    return route.bipolar ? value * 2 - 1 : value;
  }
  if (route.source === "pressure") {
    const value = clamp01(pressure);
    return route.bipolar ? value * 2 - 1 : value;
  }
  if (route.source === "timbre") {
    const value = clamp01(timbre);
    return route.bipolar ? value * 2 - 1 : value;
  }
  if (isMacroAutomationTarget(route.source)) {
    const value = clamp01(Number(macroOverrides?.[route.source] ?? instrument.synthPatch?.parameters?.[route.source] ?? 0));
    return route.bipolar ? value * 2 - 1 : value;
  }
  return null;
}

function modulationTargetOffset(modulation: RenderModulation, target: string): number {
  const value = (modulation.targetOffsets as Partial<Record<string, number>>)[target] ?? 0;
  return Number.isFinite(value) ? value : 0;
}

function isRuntimeModulationTarget(value: unknown): value is RuntimeModulationTarget {
  return isDirectRuntimeModulationTarget(value) || isMacroAutomationTarget(value);
}

function isDirectRuntimeModulationTarget(value: unknown): value is DirectRuntimeModulationTarget {
  return typeof value === "string" && [
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

function isMacroAutomationTarget(value: unknown): value is MacroAutomationTarget {
  return typeof value === "string" && /^macro\.[1-8]$/.test(value);
}

function modulationTargetScale(target: DirectRuntimeModulationTarget): number {
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

function keytrackSourceValue(frequency: number): number {
  if (!Number.isFinite(frequency) || frequency <= 0) return 0;
  const midi = 69 + 12 * Math.log2(frequency / 440);
  return clamp01(midi / 127);
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
  const params = instrument.synthPatch?.parameters;
  const attack = Math.max(0.001, (instrument.envelope.attackMs ?? 5) / 1000);
  const decay = Math.max(0.001, (instrument.envelope.decayMs ?? 100) / 1000);
  const sustain = clamp01(instrument.envelope.sustain ?? 0.7);
  const release = Math.max(0.001, (instrument.envelope.releaseMs ?? 200) / 1000);
  const attackCurve = envelopeCurveParam(params?.["env.1.attackCurve"] ?? instrument.envelope.attackCurve);
  const decayCurve = envelopeCurveParam(params?.["env.1.decayCurve"] ?? instrument.envelope.decayCurve);
  const releaseCurve = envelopeCurveParam(params?.["env.1.releaseCurve"] ?? instrument.envelope.releaseCurve);
  const segmentValue = (time: number) => {
    if (time < attack) {
      return applyEnvelopeCurve(time / attack, attackCurve);
    }
    const localDecay = Math.max(0, time - attack);
    const t = applyEnvelopeCurve(Math.min(1, localDecay / decay), decayCurve);
    return 1 + (sustain - 1) * t;
  };
  const releaseStart = Math.max(attack + decay, durationS - release);
  if (params?.["env.1.loop"] === true || instrument.envelope.loop === true) {
    const cycleLength = Math.max(0.001, attack + decay);
    if (timeS > releaseStart) {
      const releaseValue = segmentValue(releaseStart % cycleLength);
      const t = applyEnvelopeCurve((timeS - releaseStart) / release, releaseCurve);
      return releaseValue * Math.max(0, 1 - t);
    }
    return segmentValue(timeS % cycleLength);
  }
  if (timeS < attack) {
    return applyEnvelopeCurve(timeS / attack, attackCurve);
  }
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

function modEnvelopePreviewValue(timeS: number, durationS: number, instrument: Instrument, index: 2 | 3 | 4): number {
  const params = instrument.synthPatch?.parameters;
  const prefix = `env.${index}` as const;
  const attack = Math.max(0.001, numberParam(params?.[`${prefix}.attack`], 0.01));
  const decay = Math.max(0.001, numberParam(params?.[`${prefix}.decay`], 0.3));
  const sustain = clamp01(numberParam(params?.[`${prefix}.sustain`], 0));
  const release = Math.max(0.001, numberParam(params?.[`${prefix}.release`], 0.2));
  const attackCurve = envelopeCurveParam(params?.[`${prefix}.attackCurve`]);
  const decayCurve = envelopeCurveParam(params?.[`${prefix}.decayCurve`]);
  const releaseCurve = envelopeCurveParam(params?.[`${prefix}.releaseCurve`]);
  const segmentValue = (time: number) => {
    if (time < attack) {
      return applyEnvelopeCurve(time / attack, attackCurve);
    }
    const localDecay = Math.max(0, time - attack);
    const t = applyEnvelopeCurve(Math.min(1, localDecay / decay), decayCurve);
    return 1 + (sustain - 1) * t;
  };
  const releaseStart = Math.max(attack + decay, durationS - release);
  if (params?.[`${prefix}.loop`] === true) {
    const cycleLength = Math.max(0.001, attack + decay);
    if (timeS > releaseStart) {
      const releaseValue = segmentValue(releaseStart % cycleLength);
      const t = applyEnvelopeCurve((timeS - releaseStart) / release, releaseCurve);
      return releaseValue * Math.max(0, 1 - t);
    }
    return segmentValue(timeS % cycleLength);
  }
  if (timeS < attack) {
    return applyEnvelopeCurve(timeS / attack, attackCurve);
  }
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
