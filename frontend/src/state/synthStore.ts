import { createStore as create } from "zustand/vanilla";
import type {
  CustomWavetableDefinition,
  CustomWavetableFrame,
  EnvelopeCurve,
  Instrument,
  SynthPatchSnapshot,
  SynthPatchMacroDefinition,
  WavemapDefinition,
  WavemapSource,
  WavetableConfig,
  WavetableWarpMode,
} from "./types";

export const SYNTH_PATCH_SCHEMA_VERSION = 1;
export const SYNTH_PARAMETER_NAMESPACE = "synth";
export const SYNTH_INSTRUMENT_TYPE = "wavetable-synth";
export const DEFAULT_CUSTOM_WAVETABLE_ID = "user.custom";

export type WavetableId =
  | "basic.sine"
  | "basic.saw"
  | "basic.square"
  | "basic.triangle"
  | "basic.pulse"
  | typeof DEFAULT_CUSTOM_WAVETABLE_ID
  | `user.${string}`;

export type OscillatorKey = "a" | "b";
export type OscillatorParamSuffix =
  | "enabled"
  | "wavetable"
  | "position"
  | "warp"
  | "warpMode"
  | "octave"
  | "semitone"
  | "fine"
  | "level"
  | "pan"
  | "phase"
  | "randomPhase";

export type SynthParameterId =
  | `osc.${OscillatorKey}.${OscillatorParamSuffix}`
  | "unison.enabled"
  | "unison.voices"
  | "unison.detune"
  | "unison.blend"
  | "unison.spread"
  | "filter.enabled"
  | "filter.type"
  | "filter.cutoff"
  | "filter.keytrack"
  | "filter.resonance"
  | "filter.drive"
  | "amp.level"
  | "amp.pan"
  | "env.1.attack"
  | "env.1.attackCurve"
  | "env.1.decay"
  | "env.1.decayCurve"
  | "env.1.sustain"
  | "env.1.release"
  | "env.1.releaseCurve"
  | "env.2.attack"
  | "env.2.decay"
  | "env.2.sustain"
  | "env.2.release"
  | "lfo.1.enabled"
  | "lfo.1.rate"
  | "lfo.1.sync"
  | "lfo.1.syncedRate"
  | "lfo.1.smoothing"
  | "lfo.1.randomPhase"
  | "lfo.1.shape"
  | "lfo.1.phase"
  | "lfo.1.retrigger"
  | "lfo.1.oneShot"
  | "lfo.1.bipolar"
  | "lfo.2.enabled"
  | "lfo.2.rate"
  | "lfo.2.sync"
  | "lfo.2.syncedRate"
  | "lfo.2.smoothing"
  | "lfo.2.randomPhase"
  | "lfo.2.shape"
  | "lfo.2.phase"
  | "lfo.2.retrigger"
  | "lfo.2.oneShot"
  | "lfo.2.bipolar"
  | "macro.1"
  | "macro.2"
  | "macro.3"
  | "macro.4";

export type SynthParameterValue = boolean | number | string;

export type ModulationSourceId =
  | "env.1"
  | "lfo.1"
  | "lfo.2"
  | "macro.1"
  | "macro.2"
  | "macro.3"
  | "macro.4";

export type MacroId = Extract<ModulationSourceId, `macro.${1 | 2 | 3 | 4}`>;
export type MacroCurve = SynthPatchMacroDefinition["curve"];
export type SynthMacroDefinition = Omit<SynthPatchMacroDefinition, "id"> & { id: MacroId };

export const MACRO_IDS = ["macro.1", "macro.2", "macro.3", "macro.4"] as const satisfies readonly MacroId[];

const DEFAULT_MACROS: Record<MacroId, SynthMacroDefinition> = {
  "macro.1": { id: "macro.1", label: "Motion", min: 0, max: 1, curve: "linear" },
  "macro.2": { id: "macro.2", label: "Color", min: 0, max: 1, curve: "linear" },
  "macro.3": { id: "macro.3", label: "Shape", min: 0, max: 1, curve: "linear" },
  "macro.4": { id: "macro.4", label: "Space", min: 0, max: 1, curve: "linear" },
};

export type ModulationTargetId =
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

export interface SynthModulationRoute {
  id: string;
  source: ModulationSourceId;
  target: ModulationTargetId;
  amount: number;
  bipolar: boolean;
  enabled: boolean;
}

export interface SynthModulationSummary {
  count: number;
  amount: number;
  label: string;
}

export interface SynthDraftPatch {
  schemaVersion: typeof SYNTH_PATCH_SCHEMA_VERSION;
  instrumentType: typeof SYNTH_INSTRUMENT_TYPE;
  namespace: typeof SYNTH_PARAMETER_NAMESPACE;
  name: string;
  parameters: Record<SynthParameterId, SynthParameterValue> & Record<string, SynthParameterValue>;
  modulation: SynthModulationRoute[];
  metadata: {
    createdBy: "Beat";
    tags: string[];
    icon?: string;
    macros: Record<MacroId, SynthMacroDefinition>;
    wavemaps?: Record<string, WavemapDefinition>;
    customWavetables?: Record<string, CustomWavetableDefinition>;
  };
}

export interface SynthFactoryPresetRecord {
  id: string;
  name: string;
  patch: SynthDraftPatch;
  tags: string[];
}

function cloneSynthPatch(draft: SynthDraftPatch): SynthPatchSnapshot {
  return structuredClone(normalizeSynthDraftPatch(draft)) as SynthPatchSnapshot;
}

interface SynthStoreState {
  draft: SynthDraftPatch;
  boundInstrumentId: string | null;
  selectedOscillator: OscillatorKey;
  bindInstrument: (instrumentId: string | null) => void;
  setSelectedOscillator: (id: OscillatorKey) => void;
  setDraft: (patch: SynthDraftPatch | SynthPatchSnapshot) => void;
  resetDraft: () => void;
  setWavemap: (definition: WavemapDefinition) => void;
  updateCustomWavetableFrame: (id: string, frameIndex: number, patch: Partial<CustomWavetableFrame>) => void;
  updateWavemapMetadata: (id: string, patch: Partial<Pick<WavemapDefinition, "name" | "interpolation" | "source">>) => void;
  updateMacroDefinition: (id: MacroId, patch: Partial<Omit<SynthMacroDefinition, "id">>) => void;
  setParameter: (id: SynthParameterId, value: SynthParameterValue) => void;
  setNumericParameter: (id: SynthParameterId, value: number) => void;
  setBooleanParameter: (id: SynthParameterId, value: boolean) => void;
  setName: (name: string) => void;
  updateModulationRoute: (id: string, patch: Partial<SynthModulationRoute>) => void;
  addModulationRoute: (route?: Partial<SynthModulationRoute>) => void;
  removeModulationRoute: (id: string) => void;
}

export const FACTORY_WAVETABLES: Array<{ id: WavetableId; label: string }> = [
  { id: "basic.sine", label: "Sine" },
  { id: "basic.saw", label: "Saw" },
  { id: "basic.square", label: "Square" },
  { id: "basic.triangle", label: "Triangle" },
  { id: "basic.pulse", label: "Pulse" },
  { id: DEFAULT_CUSTOM_WAVETABLE_ID, label: "Custom" },
];

export const CUSTOM_WAVETABLE_FRAME_LABELS = ["A", "B", "C", "D"] as const;

export function createDefaultCustomWavetable(id = DEFAULT_CUSTOM_WAVETABLE_ID): CustomWavetableDefinition {
  return {
    schemaVersion: 1,
    id,
    name: "Custom",
    kind: "harmonic-sketch",
    interpolation: "linear",
    source: {
      kind: "drawn",
      label: "Drawn wavemap",
    },
    frames: [
      { id: `${id}.frame.1`, label: "A", position: 0.0, brightness: 0.22, even: 0.08, fold: 0.05, phase: 0.0 },
      { id: `${id}.frame.2`, label: "B", position: 0.333, brightness: 0.46, even: 0.28, fold: 0.16, phase: 0.12 },
      { id: `${id}.frame.3`, label: "C", position: 0.667, brightness: 0.72, even: 0.48, fold: 0.34, phase: -0.08 },
      { id: `${id}.frame.4`, label: "D", position: 1.0, brightness: 0.94, even: 0.72, fold: 0.56, phase: 0.2 },
    ],
  };
}

export function createWavemapFromAudioSamples(
  id: string,
  name: string,
  samples: ArrayLike<number>,
  sampleRate: number,
  source: Partial<WavemapSource> = {},
): WavemapDefinition {
  const safeId = id.startsWith("user.") ? id : `user.${id.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "wavemap"}`;
  const frameCount = 4;
  const frameLength = Math.max(1, Math.floor(samples.length / frameCount));
  const frames: CustomWavetableFrame[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * frameLength;
    const end = frame === frameCount - 1 ? samples.length : Math.min(samples.length, start + frameLength);
    frames.push(analyzeSamplesToWavemapFrame(samples, start, end, safeId, frame));
  }
  return normalizeCustomWavetable({
    schemaVersion: 1,
    id: safeId,
    name,
    kind: "resynthesized",
    interpolation: "smooth",
    source: {
      kind: source.kind === "imported-audio" ? "imported-audio" : "resynthesized",
      label: source.label ?? "Audio resynthesis",
      audioFileId: source.audioFileId,
      path: source.path,
      sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : undefined,
      sourceStartSample: source.sourceStartSample,
      sourceEndSample: source.sourceEndSample,
      createdAt: source.createdAt ?? Date.now(),
    },
    frames,
  });
}

export function normalizeWavemapFrames(definition: WavemapDefinition): WavemapDefinition {
  const normalized = normalizeCustomWavetable(definition);
  const frames = normalized.frames.map((frame, index) => ({
    ...frame,
    id: frame.id ?? `${normalized.id}.frame.${index + 1}`,
    label: frame.label ?? CUSTOM_WAVETABLE_FRAME_LABELS[index] ?? `${index + 1}`,
    position: index / Math.max(1, normalized.frames.length - 1),
  }));
  const brightness = spreadFrameValues(frames.map((frame) => frame.brightness), 0.18, 0.94, [0.18, 0.42, 0.7, 0.94]);
  const even = spreadFrameValues(frames.map((frame) => frame.even), 0.08, 0.72, [0.08, 0.26, 0.48, 0.72]);
  const fold = spreadFrameValues(frames.map((frame) => frame.fold), 0.04, 0.62, [0.04, 0.14, 0.34, 0.62]);
  const phase = spreadBipolarFrameValues(frames.map((frame) => frame.phase), [-0.18, 0.08, -0.08, 0.18]);

  return normalizeCustomWavetable({
    ...normalized,
    source: {
      ...normalized.source,
      kind: "generated",
      label: `${normalized.source.label ?? normalized.name} normalized`,
      createdAt: Date.now(),
    },
    frames: frames.map((frame, index) => ({
      ...frame,
      brightness: brightness[index] ?? frame.brightness,
      even: even[index] ?? frame.even,
      fold: fold[index] ?? frame.fold,
      phase: phase[index] ?? frame.phase,
    })),
  });
}

export function evolveWavemapFrames(
  definition: WavemapDefinition,
  seed = Date.now(),
  amount = 0.34,
): WavemapDefinition {
  const normalized = normalizeCustomWavetable(definition);
  const rng = seededRandom(seed);
  const strength = sanitize01(amount, 0.34);
  return normalizeCustomWavetable({
    ...normalized,
    source: {
      ...normalized.source,
      kind: "generated",
      label: `${normalized.source.label ?? normalized.name} evolved`,
      createdAt: Date.now(),
    },
    frames: normalized.frames.map((frame, index) => {
      const motion = Math.sin((index + 1) * 1.87 + rng() * Math.PI) * strength;
      return {
        ...frame,
        position: index / Math.max(1, normalized.frames.length - 1),
        brightness: clamp01(frame.brightness + randomSigned(rng) * 0.24 * strength + motion * 0.12),
        even: clamp01(frame.even + randomSigned(rng) * 0.28 * strength - motion * 0.08),
        fold: clamp01(frame.fold + randomSigned(rng) * 0.34 * strength + Math.abs(motion) * 0.12),
        phase: clampBipolar(frame.phase + randomSigned(rng) * 0.72 * strength + motion * 0.2),
      };
    }),
  });
}

function spreadFrameValues(values: number[], targetMin: number, targetMax: number, fallback: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  if (!Number.isFinite(span) || span < 0.035) {
    const center = sanitize01(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), 0.5);
    return fallback.map((value) => clamp01(center + (value - 0.5) * 0.72));
  }
  return values.map((value) => clamp01(targetMin + ((value - min) / span) * (targetMax - targetMin)));
}

function spreadBipolarFrameValues(values: number[], fallback: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  if (!Number.isFinite(span) || span < 0.035) return fallback.map(clampBipolar);
  return values.map((value) => clampBipolar(-0.46 + ((value - min) / span) * 0.92));
}

function seededRandom(seed: number): () => number {
  let state = (Math.floor(seed) || 1) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSigned(rng: () => number): number {
  return rng() * 2 - 1;
}

function analyzeSamplesToWavemapFrame(
  samples: ArrayLike<number>,
  start: number,
  end: number,
  wavemapId: string,
  frameIndex: number,
): CustomWavetableFrame {
  const safeStart = Math.max(0, Math.min(samples.length, Math.floor(start)));
  const safeEnd = Math.max(safeStart + 1, Math.min(samples.length, Math.floor(end)));
  let sumSquares = 0;
  let sumAbs = 0;
  let derivative = 0;
  let zeroCrossings = 0;
  let positiveEnergy = 0;
  let negativeEnergy = 0;
  let previous = Number(samples[safeStart]) || 0;
  for (let index = safeStart; index < safeEnd; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number(samples[index]) || 0));
    sumSquares += sample * sample;
    sumAbs += Math.abs(sample);
    derivative += Math.abs(sample - previous);
    if ((sample >= 0 && previous < 0) || (sample < 0 && previous >= 0)) zeroCrossings += 1;
    if (sample >= 0) positiveEnergy += sample * sample;
    else negativeEnergy += sample * sample;
    previous = sample;
  }
  const length = Math.max(1, safeEnd - safeStart);
  const rms = Math.sqrt(sumSquares / length);
  const averageAbs = sumAbs / length;
  const normalizedDerivative = derivative / length;
  const zeroCrossRate = zeroCrossings / length;
  const asymmetry = Math.abs(positiveEnergy - negativeEnergy) / Math.max(0.0001, positiveEnergy + negativeEnergy);
  return {
    id: `${wavemapId}.frame.${frameIndex + 1}`,
    label: CUSTOM_WAVETABLE_FRAME_LABELS[frameIndex] ?? `${frameIndex + 1}`,
    position: frameIndex / 3,
    brightness: clamp01(0.16 + rms * 1.3 + zeroCrossRate * 18),
    even: clamp01(0.08 + asymmetry * 0.72 + averageAbs * 0.28),
    fold: clamp01(0.04 + normalizedDerivative * 5.2 + rms * 0.18),
    phase: sanitizeBipolar((positiveEnergy >= negativeEnergy ? 1 : -1) * clamp01(asymmetry + zeroCrossRate * 9) * 0.8, 0),
  };
}

export const DEFAULT_SYNTH_PARAMETERS: Record<SynthParameterId, SynthParameterValue> = {
  "osc.a.enabled": true,
  "osc.a.wavetable": "basic.saw",
  "osc.a.position": 0,
  "osc.a.warp": 0.2,
  "osc.a.warpMode": "shape",
  "osc.a.octave": 0,
  "osc.a.semitone": 0,
  "osc.a.fine": 0,
  "osc.a.level": 0.8,
  "osc.a.pan": 0,
  "osc.a.phase": 0,
  "osc.a.randomPhase": 0.25,
  "osc.b.enabled": false,
  "osc.b.wavetable": "basic.square",
  "osc.b.position": 0,
  "osc.b.warp": 0.2,
  "osc.b.warpMode": "shape",
  "osc.b.octave": 0,
  "osc.b.semitone": 0,
  "osc.b.fine": 0,
  "osc.b.level": 0.6,
  "osc.b.pan": 0,
  "osc.b.phase": 0,
  "osc.b.randomPhase": 0.25,
  "unison.enabled": false,
  "unison.voices": 1,
  "unison.detune": 0.12,
  "unison.blend": 0.75,
  "unison.spread": 0.5,
  "filter.enabled": true,
  "filter.type": "lowpass",
  "filter.cutoff": 18000,
  "filter.keytrack": 0,
  "filter.resonance": 0.1,
  "filter.drive": 0,
  "amp.level": 0.8,
  "amp.pan": 0,
  "env.1.attack": 0.005,
  "env.1.attackCurve": "linear",
  "env.1.decay": 0.15,
  "env.1.decayCurve": "linear",
  "env.1.sustain": 0.8,
  "env.1.release": 0.25,
  "env.1.releaseCurve": "linear",
  "env.2.attack": 0.01,
  "env.2.decay": 0.3,
  "env.2.sustain": 0,
  "env.2.release": 0.2,
  "lfo.1.enabled": true,
  "lfo.1.rate": 1,
  "lfo.1.sync": true,
  "lfo.1.syncedRate": "1/4",
  "lfo.1.smoothing": 0,
  "lfo.1.randomPhase": 0,
  "lfo.1.shape": "sine",
  "lfo.1.phase": 0,
  "lfo.1.retrigger": true,
  "lfo.1.oneShot": false,
  "lfo.1.bipolar": true,
  "lfo.2.enabled": false,
  "lfo.2.rate": 0.5,
  "lfo.2.sync": true,
  "lfo.2.syncedRate": "1/2",
  "lfo.2.smoothing": 0,
  "lfo.2.randomPhase": 0,
  "lfo.2.shape": "triangle",
  "lfo.2.phase": 0,
  "lfo.2.retrigger": true,
  "lfo.2.oneShot": false,
  "lfo.2.bipolar": true,
  "macro.1": 0,
  "macro.2": 0,
  "macro.3": 0,
  "macro.4": 0,
};

export const SYNTH_PARAMETER_LABELS: Record<SynthParameterId, string> = {
  "osc.a.enabled": "OSC A Enabled",
  "osc.a.wavetable": "OSC A Table",
  "osc.a.position": "OSC A Pos",
  "osc.a.warp": "OSC A Warp",
  "osc.a.warpMode": "OSC A Warp Mode",
  "osc.a.octave": "OSC A Oct",
  "osc.a.semitone": "OSC A Semi",
  "osc.a.fine": "OSC A Fine",
  "osc.a.level": "OSC A Level",
  "osc.a.pan": "OSC A Pan",
  "osc.a.phase": "OSC A Phase",
  "osc.a.randomPhase": "OSC A Random",
  "osc.b.enabled": "OSC B Enabled",
  "osc.b.wavetable": "OSC B Table",
  "osc.b.position": "OSC B Pos",
  "osc.b.warp": "OSC B Warp",
  "osc.b.warpMode": "OSC B Warp Mode",
  "osc.b.octave": "OSC B Oct",
  "osc.b.semitone": "OSC B Semi",
  "osc.b.fine": "OSC B Fine",
  "osc.b.level": "OSC B Level",
  "osc.b.pan": "OSC B Pan",
  "osc.b.phase": "OSC B Phase",
  "osc.b.randomPhase": "OSC B Random",
  "unison.enabled": "Unison Enabled",
  "unison.voices": "Unison Voices",
  "unison.detune": "Unison Detune",
  "unison.blend": "Unison Blend",
  "unison.spread": "Unison Spread",
  "filter.enabled": "Filter Enabled",
  "filter.type": "Filter Type",
  "filter.cutoff": "Filter Cutoff",
  "filter.keytrack": "Filter Keytrack",
  "filter.resonance": "Filter Res",
  "filter.drive": "Filter Drive",
  "amp.level": "Amp Level",
  "amp.pan": "Amp Pan",
  "env.1.attack": "Env 1 Attack",
  "env.1.attackCurve": "Env 1 Attack Curve",
  "env.1.decay": "Env 1 Decay",
  "env.1.decayCurve": "Env 1 Decay Curve",
  "env.1.sustain": "Env 1 Sustain",
  "env.1.release": "Env 1 Release",
  "env.1.releaseCurve": "Env 1 Release Curve",
  "env.2.attack": "Env 2 Attack",
  "env.2.decay": "Env 2 Decay",
  "env.2.sustain": "Env 2 Sustain",
  "env.2.release": "Env 2 Release",
  "lfo.1.enabled": "LFO 1 Enabled",
  "lfo.1.rate": "LFO 1 Rate",
  "lfo.1.sync": "LFO 1 Sync",
  "lfo.1.syncedRate": "LFO 1 Sync Rate",
  "lfo.1.smoothing": "LFO 1 Smoothing",
  "lfo.1.randomPhase": "LFO 1 Random",
  "lfo.1.shape": "LFO 1 Shape",
  "lfo.1.phase": "LFO 1 Phase",
  "lfo.1.retrigger": "LFO 1 Retrigger",
  "lfo.1.oneShot": "LFO 1 One-Shot",
  "lfo.1.bipolar": "LFO 1 Bipolar",
  "lfo.2.enabled": "LFO 2 Enabled",
  "lfo.2.rate": "LFO 2 Rate",
  "lfo.2.sync": "LFO 2 Sync",
  "lfo.2.syncedRate": "LFO 2 Sync Rate",
  "lfo.2.smoothing": "LFO 2 Smoothing",
  "lfo.2.randomPhase": "LFO 2 Random",
  "lfo.2.shape": "LFO 2 Shape",
  "lfo.2.phase": "LFO 2 Phase",
  "lfo.2.retrigger": "LFO 2 Retrigger",
  "lfo.2.oneShot": "LFO 2 One-Shot",
  "lfo.2.bipolar": "LFO 2 Bipolar",
  "macro.1": "Macro 1",
  "macro.2": "Macro 2",
  "macro.3": "Macro 3",
  "macro.4": "Macro 4",
};

export const MODULATION_SOURCE_LABELS: Record<ModulationSourceId, string> = {
  "env.1": "Amp Env",
  "lfo.1": "LFO 1",
  "lfo.2": "LFO 2",
  "macro.1": "Macro 1",
  "macro.2": "Macro 2",
  "macro.3": "Macro 3",
  "macro.4": "Macro 4",
};

export const MODULATION_TARGET_LABELS: Record<ModulationTargetId, string> = {
  "osc.a.position": "OSC A Pos",
  "osc.a.fine": "OSC A Fine",
  "osc.a.level": "OSC A Level",
  "osc.a.pan": "OSC A Pan",
  "osc.b.position": "OSC B Pos",
  "osc.b.fine": "OSC B Fine",
  "osc.b.level": "OSC B Level",
  "osc.b.pan": "OSC B Pan",
  "filter.cutoff": "Filter Cutoff",
  "filter.resonance": "Filter Res",
  "filter.drive": "Filter Drive",
  "amp.level": "Amp Level",
  "amp.pan": "Amp Pan",
  "unison.detune": "Unison Detune",
  "unison.spread": "Unison Spread",
};

export function createDefaultSynthDraft(): SynthDraftPatch {
  return {
    schemaVersion: SYNTH_PATCH_SCHEMA_VERSION,
    instrumentType: SYNTH_INSTRUMENT_TYPE,
    namespace: SYNTH_PARAMETER_NAMESPACE,
    name: "Init",
    parameters: { ...DEFAULT_SYNTH_PARAMETERS },
    modulation: [
      {
        id: "route_1",
        source: "lfo.1",
        target: "osc.a.position",
        amount: 0.35,
        bipolar: true,
        enabled: true,
      },
      {
        id: "route_2",
        source: "env.1",
        target: "filter.cutoff",
        amount: 0.3,
        bipolar: false,
        enabled: true,
      },
    ],
    metadata: {
      createdBy: "Beat",
      tags: [],
      icon: "ph:cube",
      macros: cloneDefaultMacros(),
      wavemaps: { [DEFAULT_CUSTOM_WAVETABLE_ID]: createDefaultCustomWavetable() },
      customWavetables: { [DEFAULT_CUSTOM_WAVETABLE_ID]: createDefaultCustomWavetable() },
    },
  };
}

export function normalizeSynthDraftPatch(input: Partial<SynthDraftPatch> | SynthPatchSnapshot): SynthDraftPatch {
  const base = createDefaultSynthDraft();
  const parameters: SynthDraftPatch["parameters"] = { ...DEFAULT_SYNTH_PARAMETERS };

  if (isRecord(input.parameters)) {
    for (const [id, value] of Object.entries(input.parameters)) {
      if (isSynthParameterId(id)) {
        const fallback = DEFAULT_SYNTH_PARAMETERS[id];
        if (typeof fallback === "number" && typeof value === "number") {
          parameters[id] = sanitizeNumber(value, id);
        } else if (typeof fallback === "boolean") {
          parameters[id] = value === true;
        } else if (typeof value === "string") {
          parameters[id] = value;
        } else {
          parameters[id] = fallback;
        }
      } else if (isSynthParameterValue(value)) {
        parameters[id] = value;
      }
    }
  }

  const modulation = Array.isArray(input.modulation)
    ? input.modulation
        .map(normalizeModulationRoute)
        .filter((route): route is SynthModulationRoute => route !== null)
    : base.modulation;
  const inputMetadata: Record<string, unknown> = isRecord(input.metadata) ? input.metadata : {};
  const wavemaps = normalizeCustomWavetables(inputMetadata.wavemaps ?? inputMetadata.customWavetables);

  return {
    schemaVersion: SYNTH_PATCH_SCHEMA_VERSION,
    instrumentType: SYNTH_INSTRUMENT_TYPE,
    namespace: SYNTH_PARAMETER_NAMESPACE,
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : base.name,
    parameters,
    modulation: dedupeModulationRouteIds(modulation),
    metadata: {
      createdBy: "Beat",
      tags: Array.isArray(inputMetadata.tags)
        ? inputMetadata.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 16)
        : [],
      icon: typeof inputMetadata.icon === "string" && inputMetadata.icon.startsWith("ph:")
        ? inputMetadata.icon
        : base.metadata.icon,
      macros: normalizeMacroDefinitions(inputMetadata.macros),
      wavemaps,
      customWavetables: wavemaps,
    },
  };
}

export const FACTORY_SYNTH_PRESETS: SynthFactoryPresetRecord[] = createFactorySynthPresets();

export function getNumberParam(draft: SynthDraftPatch, id: SynthParameterId): number {
  const value = draft.parameters[id];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function getBooleanParam(draft: SynthDraftPatch, id: SynthParameterId): boolean {
  return draft.parameters[id] === true;
}

export function getStringParam(draft: SynthDraftPatch, id: SynthParameterId): string {
  const value = draft.parameters[id];
  return typeof value === "string" ? value : "";
}

export function getEnvelopeCurveParam(draft: SynthDraftPatch, id: SynthParameterId): EnvelopeCurve {
  const value = getStringParam(draft, id);
  if (value === "exp" || value === "log" || value === "s-curve") return value;
  return "linear";
}

export function macroDefinitionForId(draft: SynthDraftPatch, id: MacroId): SynthMacroDefinition {
  return normalizeMacroDefinition(id, draft.metadata.macros?.[id]);
}

export function macroOutputValue(draft: SynthDraftPatch, id: MacroId): number {
  const definition = macroDefinitionForId(draft, id);
  const raw = clamp01(getNumberParam(draft, id));
  const shaped = applyMacroCurve(raw, definition.curve);
  return clamp01(definition.min + (definition.max - definition.min) * shaped);
}

export function macroAssignmentsForId(draft: SynthDraftPatch, id: MacroId): SynthModulationRoute[] {
  return draft.modulation.filter((route) => route.enabled && route.source === id);
}

export function modulationSourceLabel(draft: SynthDraftPatch, source: ModulationSourceId): string {
  return isMacroSource(source)
    ? macroDefinitionForId(draft, source).label
    : MODULATION_SOURCE_LABELS[source] ?? source;
}

export function modulationSummaryForTarget(draft: SynthDraftPatch, target: ModulationTargetId): SynthModulationSummary {
  const routes = draft.modulation.filter((route) => route.enabled && route.target === target);
  return summarizeModulationRoutes(routes, (route) => modulationSourceLabel(draft, route.source));
}

export function modulationSummaryForSource(draft: SynthDraftPatch, source: ModulationSourceId): SynthModulationSummary {
  const routes = draft.modulation.filter((route) => route.enabled && route.source === source);
  return summarizeModulationRoutes(routes, (route) => MODULATION_TARGET_LABELS[route.target] ?? route.target);
}

export function synthDraftToInstrumentPatch(draft: SynthDraftPatch): Partial<Instrument> {
  const wavetable = wavetableFromDraft(draft, "a");
  const oscA = oscillatorFromDraft(draft, "a", wavetable);
  const oscB = oscillatorFromDraft(draft, "b", wavetableFromDraft(draft, "b"));
  const filterEnabled = getBooleanParam(draft, "filter.enabled");
  const lfoEnabled = getBooleanParam(draft, "lfo.1.enabled");
  const cutoff01 = filterEnabled
    ? clamp01(hzToNormalizedCutoff(getNumberParam(draft, "filter.cutoff")) + staticRouteAmount(draft, "filter.cutoff"))
    : 1;

  return {
    name: draft.name,
    kind: "wavetable",
    waveform: "wavetable",
    icon: draft.metadata.icon ?? "ph:cube",
    knobs: {
      cutoff: cutoff01,
      resonance: filterEnabled ? modulatedNumberParam(draft, "filter.resonance", "filter.resonance", 0, 1) : 0,
      drive: modulatedNumberParam(draft, "filter.drive", "filter.drive", 0, 1),
      color: modulatedNumberParam(draft, "osc.a.position", "osc.a.position", 0, 1),
    },
    filterType: filterTypeFromDraft(draft),
    filterKeytrack: getNumberParam(draft, "filter.keytrack"),
    envelope: {
      attackMs: getNumberParam(draft, "env.1.attack") * 1000,
      attackCurve: getEnvelopeCurveParam(draft, "env.1.attackCurve"),
      decayMs: getNumberParam(draft, "env.1.decay") * 1000,
      decayCurve: getEnvelopeCurveParam(draft, "env.1.decayCurve"),
      sustain: getNumberParam(draft, "env.1.sustain"),
      releaseMs: getNumberParam(draft, "env.1.release") * 1000,
      releaseCurve: getEnvelopeCurveParam(draft, "env.1.releaseCurve"),
    },
    wavetable,
    aether: {
      oscA,
      oscB,
      sub: {
        enabled: false,
        level: 0,
        octave: -1,
        waveform: "sine",
      },
      noise: {
        enabled: false,
        level: 0,
        color: 0.5,
      },
    },
    lfoWaveform: lfoWaveformFromDraft(draft),
    lfoRateHz: getNumberParam(draft, "lfo.1.rate"),
    lfoDepth: lfoEnabled ? Math.abs(clampBipolar(routeAmount(draft, "lfo.1", "osc.a.position"))) : 0,
    lfoSync: draft.parameters["lfo.1.sync"] === true,
    lfoSyncedRate: String(draft.parameters["lfo.1.syncedRate"] ?? "1/4"),
    lfoSmoothing: getNumberParam(draft, "lfo.1.smoothing"),
    lfoRandomPhase: getNumberParam(draft, "lfo.1.randomPhase"),
    lfoPhase: getNumberParam(draft, "lfo.1.phase"),
    lfoRetrigger: getBooleanParam(draft, "lfo.1.retrigger"),
    lfoOneShot: getBooleanParam(draft, "lfo.1.oneShot"),
    lfo2Waveform: lfoWaveformFromDraft(draft, 2),
    lfo2RateHz: getNumberParam(draft, "lfo.2.rate"),
    lfo2Sync: draft.parameters["lfo.2.sync"] === true,
    lfo2SyncedRate: String(draft.parameters["lfo.2.syncedRate"] ?? "1/2"),
    lfo2Smoothing: getNumberParam(draft, "lfo.2.smoothing"),
    lfo2RandomPhase: getNumberParam(draft, "lfo.2.randomPhase"),
    lfo2Enabled: getBooleanParam(draft, "lfo.2.enabled"),
    lfo2Phase: getNumberParam(draft, "lfo.2.phase"),
    lfo2Retrigger: getBooleanParam(draft, "lfo.2.retrigger"),
    lfo2OneShot: getBooleanParam(draft, "lfo.2.oneShot"),
    lfoPositionBipolar: routeBipolar(draft, "lfo.1", "osc.a.position", true),
    lfoPitchBipolar: routeBipolar(draft, "lfo.1", "osc.a.fine", true),
    lfoFilterBipolar: routeBipolar(draft, "lfo.1", "filter.cutoff", true),
    lfoToPitch: lfoEnabled ? Math.abs(clampBipolar(routeAmount(draft, "lfo.1", "osc.a.fine"))) * 12 : 0,
    lfoToFilter: lfoEnabled ? clampBipolar(routeAmount(draft, "lfo.1", "filter.cutoff")) : 0,
    envToFilter: clampBipolar(routeAmount(draft, "env.1", "filter.cutoff")),
    ampLevel: modulatedNumberParam(draft, "amp.level", "amp.level", 0, 1),
    ampPan: modulatedNumberParam(draft, "amp.pan", "amp.pan", -1, 1),
    synthPatch: cloneSynthPatch(draft),
  };
}

function summarizeModulationRoutes(
  routes: SynthModulationRoute[],
  labelForRoute: (route: SynthModulationRoute) => string,
): SynthModulationSummary {
  const amount = clampBipolar(routes.reduce((sum, route) => sum + route.amount, 0));
  if (routes.length === 0) return { count: 0, amount: 0, label: "" };
  if (routes.length === 1) {
    return {
      count: 1,
      amount,
      label: `${labelForRoute(routes[0])} ${formatSignedModAmount(routes[0].amount)}`,
    };
  }
  return {
    count: routes.length,
    amount,
    label: `${routes.length} routes ${formatSignedModAmount(amount)}`,
  };
}

function formatSignedModAmount(amount: number): string {
  const clamped = clampBipolar(amount);
  const sign = clamped >= 0 ? "+" : "";
  return `${sign}${Math.round(clamped * 100)}`;
}

export function synthDraftToPreviewInstrument(draft: SynthDraftPatch): Instrument {
  const patch = synthDraftToInstrumentPatch(draft);
  return {
    id: "synth-preview",
    name: draft.name || "Synth Preview",
    icon: draft.metadata.icon ?? "ph:cube",
    kind: "wavetable",
    envelope: { attackMs: 5, decayMs: 150, sustain: 0.8, releaseMs: 250 },
    knobs: { cutoff: 0.6, resonance: 0.1, drive: 0, color: 0 },
    waveform: "wavetable",
    detuneCents: 0,
    octave: 0,
    subOscLevel: 0,
    glideMs: 0,
    ampLevel: 1,
    ampPan: 0,
    lfoWaveform: "sine",
    lfoRateHz: 1,
    lfoDepth: 0,
    lfoSync: false,
    lfoSyncedRate: "1/4",
    lfoSmoothing: 0,
    lfoRandomPhase: 0,
    lfoRetrigger: true,
    lfo2Sync: false,
    lfo2SyncedRate: "1/2",
    lfo2Smoothing: 0,
    lfo2RandomPhase: 0,
    lfoPositionBipolar: true,
    lfoPitchBipolar: true,
    lfoFilterBipolar: true,
    lfoToPitch: 0,
    lfoToFilter: 0,
    envToFilter: 0,
    sampleIds: [],
    userCreated: true,
    ...patch,
  };
}

export function synthDraftFromInstrument(instrument: Instrument): SynthDraftPatch {
  if (instrument.synthPatch) {
    const draft = normalizeSynthDraftPatch(instrument.synthPatch as SynthDraftPatch);
    if (instrument.icon) draft.metadata.icon = instrument.icon;
    return draft;
  }

  const draft = createDefaultSynthDraft();
  draft.name = instrument.name;
  draft.metadata.icon = instrument.icon ?? draft.metadata.icon;
  draft.parameters["filter.cutoff"] = normalizedCutoffToHz(instrument.knobs.cutoff);
  draft.parameters["filter.keytrack"] = instrument.filterKeytrack ?? 0;
  draft.parameters["filter.resonance"] = instrument.knobs.resonance;
  draft.parameters["filter.drive"] = instrument.knobs.drive;
  draft.parameters["filter.type"] = instrument.filterType ?? "lowpass";
  draft.parameters["amp.level"] = 0.8;
  draft.parameters["env.1.attack"] = instrument.envelope.attackMs / 1000;
  draft.parameters["env.1.attackCurve"] = instrument.envelope.attackCurve ?? "linear";
  draft.parameters["env.1.decay"] = instrument.envelope.decayMs / 1000;
  draft.parameters["env.1.decayCurve"] = instrument.envelope.decayCurve ?? "linear";
  draft.parameters["env.1.sustain"] = instrument.envelope.sustain;
  draft.parameters["env.1.release"] = instrument.envelope.releaseMs / 1000;
  draft.parameters["env.1.releaseCurve"] = instrument.envelope.releaseCurve ?? "linear";
  draft.parameters["lfo.1.rate"] = instrument.lfoRateHz ?? 1;
  draft.parameters["lfo.1.sync"] = instrument.lfoSync ?? false;
  draft.parameters["lfo.1.syncedRate"] = instrument.lfoSyncedRate ?? "1/4";
  draft.parameters["lfo.1.smoothing"] = instrument.lfoSmoothing ?? 0;
  draft.parameters["lfo.1.randomPhase"] = instrument.lfoRandomPhase ?? 0;
  draft.parameters["lfo.1.shape"] = instrument.lfoWaveform ?? "sine";
  draft.parameters["lfo.1.phase"] = instrument.lfoPhase ?? 0;
  draft.parameters["lfo.1.retrigger"] = instrument.lfoRetrigger ?? true;
  draft.parameters["lfo.1.oneShot"] = instrument.lfoOneShot ?? false;
  draft.parameters["lfo.2.enabled"] = instrument.lfo2Enabled ?? false;
  draft.parameters["lfo.2.rate"] = instrument.lfo2RateHz ?? 0.5;
  draft.parameters["lfo.2.sync"] = instrument.lfo2Sync ?? false;
  draft.parameters["lfo.2.syncedRate"] = instrument.lfo2SyncedRate ?? "1/2";
  draft.parameters["lfo.2.smoothing"] = instrument.lfo2Smoothing ?? 0;
  draft.parameters["lfo.2.randomPhase"] = instrument.lfo2RandomPhase ?? 0;
  draft.parameters["lfo.2.shape"] = instrument.lfo2Waveform ?? "triangle";
  draft.parameters["lfo.2.phase"] = instrument.lfo2Phase ?? 0;
  draft.parameters["lfo.2.retrigger"] = instrument.lfo2Retrigger ?? true;
  draft.parameters["lfo.2.oneShot"] = instrument.lfo2OneShot ?? false;
  draft.parameters["amp.level"] = instrument.ampLevel ?? 0.8;
  draft.parameters["amp.pan"] = instrument.ampPan ?? 0;

  if (instrument.wavetable) {
    applyWavetableToDraft(draft, "a", instrument.wavetable, true);
  }
  if (instrument.aether?.oscA) {
    applyOscillatorToDraft(draft, "a", instrument.aether.oscA);
  }
  if (instrument.aether?.oscB) {
    applyOscillatorToDraft(draft, "b", instrument.aether.oscB);
  }

  draft.modulation = [];
  if ((instrument.lfoToFilter ?? 0) !== 0) {
    draft.modulation.push({
      id: createRouteId(draft.modulation),
      source: "lfo.1",
      target: "filter.cutoff",
      amount: instrument.lfoToFilter ?? 0,
      bipolar: instrument.lfoFilterBipolar ?? true,
      enabled: true,
    });
  }
  if ((instrument.envToFilter ?? 0) !== 0) {
    draft.modulation.push({
      id: createRouteId(draft.modulation),
      source: "env.1",
      target: "filter.cutoff",
      amount: instrument.envToFilter ?? 0,
      bipolar: false,
      enabled: true,
    });
  }
  if ((instrument.lfoDepth ?? 0) !== 0) {
    draft.modulation.push({
      id: createRouteId(draft.modulation),
      source: "lfo.1",
      target: "osc.a.position",
      amount: instrument.lfoDepth ?? 0,
      bipolar: instrument.lfoPositionBipolar ?? true,
      enabled: true,
    });
  }
  if ((instrument.lfoToPitch ?? 0) !== 0) {
    draft.modulation.push({
      id: createRouteId(draft.modulation),
      source: "lfo.1",
      target: "osc.a.fine",
      amount: Math.max(-1, Math.min(1, (instrument.lfoToPitch ?? 0) / 12)),
      bipolar: instrument.lfoPitchBipolar ?? true,
      enabled: true,
    });
  }

  return draft;
}

export const useSynthStore = create<SynthStoreState>((set) => ({
  draft: createDefaultSynthDraft(),
  boundInstrumentId: null,
  selectedOscillator: "a",
  bindInstrument: (instrumentId) => set({ boundInstrumentId: instrumentId }),
  setSelectedOscillator: (id) => set({ selectedOscillator: id }),
  setDraft: (draft) => set({ draft: normalizeSynthDraftPatch(draft) }),
  resetDraft: () => set({ draft: createDefaultSynthDraft(), selectedOscillator: "a" }),
  setWavemap: (definition) =>
    set((state) => {
      const nextDefinition = normalizeCustomWavetable(definition);
      const nextWavemaps = {
        ...(state.draft.metadata.wavemaps ?? state.draft.metadata.customWavetables ?? {}),
        [nextDefinition.id]: nextDefinition,
      };
      return {
        draft: normalizeSynthDraftPatch({
          ...state.draft,
          metadata: {
            ...state.draft.metadata,
            wavemaps: nextWavemaps,
            customWavetables: nextWavemaps,
          },
        }),
      };
    }),
  updateCustomWavetableFrame: (id, frameIndex, patch) =>
    set((state) => {
      const current = state.draft.metadata.wavemaps?.[id] ?? state.draft.metadata.customWavetables?.[id] ?? createDefaultCustomWavetable(id);
      const normalized = normalizeCustomWavetable(current);
      const frames = normalized.frames.map((frame) => ({ ...frame }));
      const safeIndex = Math.max(0, Math.min(frames.length - 1, Math.round(frameIndex)));
      frames[safeIndex] = { ...frames[safeIndex], ...sanitizeCustomWavetableFramePatch(patch) };
      const nextDefinition = normalizeCustomWavetable({ ...normalized, frames });
      const nextWavemaps = {
        ...(state.draft.metadata.wavemaps ?? state.draft.metadata.customWavetables ?? {}),
        [nextDefinition.id]: nextDefinition,
      };
      return {
        draft: normalizeSynthDraftPatch({
          ...state.draft,
          metadata: {
            ...state.draft.metadata,
            wavemaps: nextWavemaps,
            customWavetables: nextWavemaps,
          },
        }),
      };
    }),
  updateWavemapMetadata: (id, patch) =>
    set((state) => {
      const current = state.draft.metadata.wavemaps?.[id] ?? state.draft.metadata.customWavetables?.[id] ?? createDefaultCustomWavetable(id);
      const nextDefinition = normalizeCustomWavetable({
        ...current,
        ...patch,
        source: patch.source ? { ...current.source, ...patch.source } : current.source,
      });
      const nextWavemaps = {
        ...(state.draft.metadata.wavemaps ?? state.draft.metadata.customWavetables ?? {}),
        [nextDefinition.id]: nextDefinition,
      };
      return {
        draft: normalizeSynthDraftPatch({
          ...state.draft,
          metadata: {
            ...state.draft.metadata,
            wavemaps: nextWavemaps,
            customWavetables: nextWavemaps,
          },
        }),
      };
    }),
  updateMacroDefinition: (id, patch) =>
    set((state) => ({
      draft: normalizeSynthDraftPatch({
        ...state.draft,
        metadata: {
          ...state.draft.metadata,
          macros: {
            ...state.draft.metadata.macros,
            [id]: {
              ...macroDefinitionForId(state.draft, id),
              ...patch,
              id,
            },
          },
        },
      }),
    })),
  setParameter: (id, value) =>
    set((state) => ({
      draft: {
        ...state.draft,
        parameters: { ...state.draft.parameters, [id]: value },
      },
    })),
  setNumericParameter: (id, value) =>
    set((state) => ({
      draft: {
        ...state.draft,
        parameters: { ...state.draft.parameters, [id]: sanitizeNumber(value, id) },
      },
    })),
  setBooleanParameter: (id, value) =>
    set((state) => ({
      draft: {
        ...state.draft,
        parameters: { ...state.draft.parameters, [id]: value },
      },
    })),
  setName: (name) => set((state) => ({ draft: { ...state.draft, name } })),
  updateModulationRoute: (id, patch) =>
    set((state) => ({
      draft: {
        ...state.draft,
        modulation: state.draft.modulation.map((route) => (route.id === id ? { ...route, ...patch } : route)),
      },
    })),
  addModulationRoute: (route) =>
    set((state) => ({
      draft: {
        ...state.draft,
        modulation: [
          ...state.draft.modulation,
          {
            id: createRouteId(state.draft.modulation),
            source: "macro.1",
            target: "filter.cutoff",
            amount: 0.1,
            bipolar: false,
            enabled: true,
            ...route,
          },
        ],
      },
    })),
  removeModulationRoute: (id) =>
    set((state) => ({
      draft: {
        ...state.draft,
        modulation: state.draft.modulation.filter((route) => route.id !== id),
      },
    })),
}));

function sanitizeNumber(value: number, id: SynthParameterId): number {
  const fallback = DEFAULT_SYNTH_PARAMETERS[id];
  if (!Number.isFinite(value)) return typeof fallback === "number" ? fallback : 0;
  if (id.endsWith(".enabled") || id === "filter.type" || id.endsWith(".wavetable") || id.endsWith(".warpMode")) return value;
  if (id === "filter.cutoff") return Math.max(20, Math.min(20000, value));
  if (id === "lfo.1.rate" || id === "lfo.2.rate") return Math.max(0.05, Math.min(50, value));
  if (id.includes(".octave")) return Math.max(-4, Math.min(4, Math.round(value)));
  if (id.includes(".semitone")) return Math.max(-12, Math.min(12, Math.round(value)));
  if (id.includes(".fine")) return Math.max(-100, Math.min(100, value));
  if (id === "unison.voices") return Math.max(1, Math.min(16, Math.round(value)));
  if (id.includes(".pan")) return Math.max(-1, Math.min(1, value));
  if (id.includes(".attack") || id.includes(".decay") || id.includes(".release")) return Math.max(0, Math.min(30, value));
  return Math.max(0, Math.min(1, value));
}

function createRouteId(routes: SynthModulationRoute[]): string {
  const used = new Set(routes.map((route) => route.id));
  let index = routes.length + 1;
  let id = `route_${index}`;
  while (used.has(id)) {
    index += 1;
    id = `route_${index}`;
  }
  return id;
}

function normalizeModulationRoute(value: unknown): SynthModulationRoute | null {
  if (!isRecord(value)) return null;
  const source = value.source;
  const target = value.target;
  if (!isModulationSourceId(source) || !isModulationTargetId(target)) return null;
  return {
    id: typeof value.id === "string" && value.id ? value.id : "route",
    source,
    target,
    amount: clampBipolar(typeof value.amount === "number" ? value.amount : 0),
    bipolar: value.bipolar !== false,
    enabled: value.enabled !== false,
  };
}

function dedupeModulationRouteIds(routes: SynthModulationRoute[]): SynthModulationRoute[] {
  const used = new Set<string>();
  return routes.map((route, index) => {
    const base = route.id.trim() || `route_${index + 1}`;
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return id === route.id ? route : { ...route, id };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSynthParameterValue(value: unknown): value is SynthParameterValue {
  return typeof value === "boolean" || typeof value === "number" || typeof value === "string";
}

function isSynthParameterId(value: string): value is SynthParameterId {
  return value in DEFAULT_SYNTH_PARAMETERS;
}

function cloneDefaultMacros(): Record<MacroId, SynthMacroDefinition> {
  return Object.fromEntries(MACRO_IDS.map((id) => [id, { ...DEFAULT_MACROS[id] }])) as Record<MacroId, SynthMacroDefinition>;
}

function normalizeMacroDefinitions(value: unknown): Record<MacroId, SynthMacroDefinition> {
  const next = cloneDefaultMacros();
  if (!isRecord(value)) return next;
  for (const id of MACRO_IDS) {
    next[id] = normalizeMacroDefinition(id, value[id]);
  }
  return next;
}

function normalizeMacroDefinition(id: MacroId, value: unknown): SynthMacroDefinition {
  const fallback = DEFAULT_MACROS[id];
  if (!isRecord(value)) return { ...fallback };
  const rawLabel = typeof value.label === "string" ? value.label.trim() : fallback.label;
  const label = rawLabel.length > 0 ? rawLabel.slice(0, 24) : fallback.label;
  const rawMin = typeof value.min === "number" && Number.isFinite(value.min) ? value.min : fallback.min;
  const rawMax = typeof value.max === "number" && Number.isFinite(value.max) ? value.max : fallback.max;
  const min = clamp01(Math.min(rawMin, rawMax));
  const max = clamp01(Math.max(rawMin, rawMax));
  return {
    id,
    label,
    min,
    max: max <= min ? Math.min(1, min + 0.01) : max,
    curve: isMacroCurve(value.curve) ? value.curve : fallback.curve,
  };
}

function isMacroCurve(value: unknown): value is MacroCurve {
  return value === "linear" || value === "ease-in" || value === "ease-out" || value === "s-curve";
}

function applyMacroCurve(value: number, curve: MacroCurve): number {
  const x = clamp01(value);
  switch (curve) {
    case "ease-in": return x * x;
    case "ease-out": return 1 - Math.pow(1 - x, 2);
    case "s-curve": return x * x * (3 - 2 * x);
    case "linear":
    default: return x;
  }
}

function normalizeCustomWavetables(value: unknown): Record<string, CustomWavetableDefinition> {
  const defaults = { [DEFAULT_CUSTOM_WAVETABLE_ID]: createDefaultCustomWavetable() };
  if (!isRecord(value)) return defaults;
  const next: Record<string, CustomWavetableDefinition> = { ...defaults };
  for (const [id, definition] of Object.entries(value)) {
    if (!id.startsWith("user.") || !isRecord(definition)) continue;
    next[id] = normalizeCustomWavetable({ ...definition, id });
  }
  return next;
}

function createFactorySynthPresets(): SynthFactoryPresetRecord[] {
  const custom = createDefaultCustomWavetable();
  const preset = (
    id: string,
    name: string,
    tags: string[],
    parameters: Partial<Record<SynthParameterId, SynthParameterValue>>,
    modulation: SynthModulationRoute[] = createDefaultSynthDraft().modulation,
    customWavetable: CustomWavetableDefinition = custom,
  ): SynthFactoryPresetRecord => ({
    id,
    name,
    tags,
    patch: normalizeSynthDraftPatch({
      name,
      parameters,
      modulation,
      metadata: {
        createdBy: "Beat",
        tags,
        customWavetables: { [customWavetable.id]: customWavetable },
      },
    } as unknown as Partial<SynthDraftPatch>),
  });

  return [
    preset("factory.init", "Init", ["factory"], {}, []),
    preset("factory.custom-table", "Custom Wavetable", ["factory", "wavetable"], {
      "osc.a.wavetable": DEFAULT_CUSTOM_WAVETABLE_ID,
      "osc.a.position": 0.35,
      "osc.a.level": 0.82,
      "filter.cutoff": 8200,
      "filter.resonance": 0.12,
      "amp.level": 0.82,
    }, [
      { id: "lfo_custom_pos", source: "lfo.1", target: "osc.a.position", amount: 0.18, bipolar: true, enabled: true },
      { id: "env_custom_filter", source: "env.1", target: "filter.cutoff", amount: 0.18, bipolar: false, enabled: true },
    ]),
    preset("factory.wt-lead", "WT Lead", ["factory", "lead"], {
      "osc.a.wavetable": "basic.pulse",
      "osc.a.position": 0.58,
      "osc.a.level": 0.84,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.saw",
      "osc.b.position": 0.25,
      "osc.b.semitone": 7,
      "osc.b.fine": -7,
      "osc.b.level": 0.38,
      "unison.enabled": true,
      "unison.voices": 5,
      "unison.detune": 0.18,
      "unison.blend": 0.72,
      "filter.cutoff": 6200,
      "filter.resonance": 0.24,
      "filter.drive": 0.12,
      "env.1.attack": 0.004,
      "env.1.decay": 0.16,
      "env.1.sustain": 0.76,
      "env.1.release": 0.22,
      "amp.level": 0.76,
    }, [
      { id: "lead_lfo_pos", source: "lfo.1", target: "osc.a.position", amount: 0.14, bipolar: true, enabled: true },
      { id: "lead_env_filter", source: "env.1", target: "filter.cutoff", amount: 0.26, bipolar: false, enabled: true },
      { id: "lead_lfo_detune", source: "lfo.1", target: "unison.detune", amount: 0.04, bipolar: false, enabled: true },
    ]),
    preset("factory.glass-pad", "Glass Pad", ["factory", "pad"], {
      "osc.a.wavetable": "basic.sine",
      "osc.a.position": 0.64,
      "osc.a.level": 0.72,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.triangle",
      "osc.b.position": 0.82,
      "osc.b.octave": 1,
      "osc.b.level": 0.46,
      "unison.enabled": true,
      "unison.voices": 6,
      "unison.detune": 0.21,
      "unison.blend": 0.82,
      "filter.cutoff": 4300,
      "filter.resonance": 0.18,
      "env.1.attack": 0.18,
      "env.1.decay": 0.8,
      "env.1.sustain": 0.82,
      "env.1.release": 1.4,
      "lfo.1.rate": 0.35,
      "amp.level": 0.64,
    }, [
      { id: "pad_lfo_a_pos", source: "lfo.1", target: "osc.a.position", amount: 0.28, bipolar: true, enabled: true },
      { id: "pad_lfo_b_pos", source: "lfo.1", target: "osc.b.position", amount: -0.18, bipolar: true, enabled: true },
      { id: "pad_env_filter", source: "env.1", target: "filter.cutoff", amount: 0.22, bipolar: false, enabled: true },
    ]),
    preset("factory.sub-bass", "Sub Bass", ["factory", "bass"], {
      "osc.a.wavetable": "basic.square",
      "osc.a.position": 0.18,
      "osc.a.octave": -1,
      "osc.a.level": 0.88,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.sine",
      "osc.b.octave": -2,
      "osc.b.level": 0.42,
      "filter.cutoff": 1400,
      "filter.resonance": 0.16,
      "filter.drive": 0.28,
      "env.1.attack": 0.002,
      "env.1.decay": 0.2,
      "env.1.sustain": 0.7,
      "env.1.release": 0.12,
      "amp.level": 0.9,
    }, [
      { id: "bass_env_drive", source: "env.1", target: "filter.drive", amount: 0.16, bipolar: false, enabled: true },
      { id: "bass_env_filter", source: "env.1", target: "filter.cutoff", amount: 0.16, bipolar: false, enabled: true },
    ]),
    preset("factory.pluck", "Digital Pluck", ["factory", "pluck"], {
      "osc.a.wavetable": "basic.pulse",
      "osc.a.position": 0.78,
      "osc.a.level": 0.8,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.sine",
      "osc.b.position": 0.44,
      "osc.b.semitone": 12,
      "osc.b.level": 0.28,
      "filter.cutoff": 9800,
      "filter.resonance": 0.34,
      "filter.drive": 0.08,
      "env.1.attack": 0.001,
      "env.1.decay": 0.18,
      "env.1.sustain": 0.18,
      "env.1.release": 0.2,
      "amp.level": 0.74,
    }, [
      { id: "pluck_env_filter", source: "env.1", target: "filter.cutoff", amount: 0.42, bipolar: false, enabled: true },
      { id: "pluck_lfo_b_level", source: "lfo.1", target: "osc.b.level", amount: -0.12, bipolar: false, enabled: true },
    ]),
  ];
}

export function normalizeCustomWavetable(value: Partial<CustomWavetableDefinition>): CustomWavetableDefinition {
  const id = typeof value.id === "string" && value.id.startsWith("user.") ? value.id : DEFAULT_CUSTOM_WAVETABLE_ID;
  const fallback = createDefaultCustomWavetable(id);
  const frames = Array.isArray(value.frames)
    ? value.frames.slice(0, 4).map((frame, index) => sanitizeCustomWavetableFrame(frame, fallback.frames[index]))
    : [...fallback.frames];
  while (frames.length < 4)
    frames.push(fallback.frames[frames.length]);
  return {
    schemaVersion: 1,
    id,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 48) : fallback.name,
    kind: value.kind === "resynthesized" ? "resynthesized" : "harmonic-sketch",
    interpolation: value.interpolation === "smooth" ? "smooth" : "linear",
    source: sanitizeWavemapSource(value.source, fallback.source),
    frames,
  };
}

function sanitizeCustomWavetableFrame(
  value: unknown,
  fallback: CustomWavetableFrame = { brightness: 0.5, even: 0.2, fold: 0.1, phase: 0 },
): CustomWavetableFrame {
  const source = isRecord(value) ? value : {};
  return {
    id: typeof source.id === "string" && source.id.trim() ? source.id.trim().slice(0, 64) : fallback.id,
    label: typeof source.label === "string" && source.label.trim() ? source.label.trim().slice(0, 16) : fallback.label,
    position: sanitize01(source.position, fallback.position ?? 0),
    brightness: sanitize01(source.brightness, fallback.brightness),
    even: sanitize01(source.even, fallback.even),
    fold: sanitize01(source.fold, fallback.fold),
    phase: sanitizeBipolar(source.phase, fallback.phase),
  };
}

function sanitizeWavemapSource(value: unknown, fallback: WavemapSource): WavemapSource {
  const source = isRecord(value) ? value : {};
  const kind = source.kind === "generated" || source.kind === "imported-audio" || source.kind === "resynthesized"
    ? source.kind
    : source.kind === "drawn"
      ? "drawn"
      : fallback.kind;
  const next: WavemapSource = { kind };
  if (typeof source.label === "string" && source.label.trim()) next.label = source.label.trim().slice(0, 64);
  else if (fallback.label) next.label = fallback.label;
  if (typeof source.audioFileId === "string" && source.audioFileId.trim()) next.audioFileId = source.audioFileId.trim();
  else if (fallback.audioFileId) next.audioFileId = fallback.audioFileId;
  if (typeof source.path === "string" && source.path.trim()) next.path = source.path.trim();
  else if (fallback.path) next.path = fallback.path;
  if (typeof source.sampleRate === "number" && Number.isFinite(source.sampleRate) && source.sampleRate > 0) next.sampleRate = source.sampleRate;
  else if (fallback.sampleRate) next.sampleRate = fallback.sampleRate;
  if (typeof source.sourceStartSample === "number" && Number.isFinite(source.sourceStartSample)) next.sourceStartSample = Math.max(0, Math.floor(source.sourceStartSample));
  else if (fallback.sourceStartSample != null) next.sourceStartSample = fallback.sourceStartSample;
  if (typeof source.sourceEndSample === "number" && Number.isFinite(source.sourceEndSample)) next.sourceEndSample = Math.max(0, Math.floor(source.sourceEndSample));
  else if (fallback.sourceEndSample != null) next.sourceEndSample = fallback.sourceEndSample;
  if (typeof source.createdAt === "number" && Number.isFinite(source.createdAt) && source.createdAt > 0) next.createdAt = source.createdAt;
  else if (fallback.createdAt) next.createdAt = fallback.createdAt;
  return next;
}

function sanitizeCustomWavetableFramePatch(value: Partial<CustomWavetableFrame>): Partial<CustomWavetableFrame> {
  const source = isRecord(value) ? value : {};
  const next: Partial<CustomWavetableFrame> = {};
  if (Object.prototype.hasOwnProperty.call(source, "label") && typeof source.label === "string")
    next.label = source.label.trim().slice(0, 16);
  if (Object.prototype.hasOwnProperty.call(source, "position"))
    next.position = sanitize01(source.position, 0);
  if (Object.prototype.hasOwnProperty.call(source, "brightness"))
    next.brightness = sanitize01(source.brightness, 0.5);
  if (Object.prototype.hasOwnProperty.call(source, "even"))
    next.even = sanitize01(source.even, 0.2);
  if (Object.prototype.hasOwnProperty.call(source, "fold"))
    next.fold = sanitize01(source.fold, 0.1);
  if (Object.prototype.hasOwnProperty.call(source, "phase"))
    next.phase = sanitizeBipolar(source.phase, 0);
  return next;
}

function isModulationSourceId(value: unknown): value is ModulationSourceId {
  return typeof value === "string" && value in MODULATION_SOURCE_LABELS;
}

function isModulationTargetId(value: unknown): value is ModulationTargetId {
  return typeof value === "string" && value in MODULATION_TARGET_LABELS;
}

function wavetableFromDraft(draft: SynthDraftPatch, oscillator: OscillatorKey): WavetableConfig {
  const wavetableId = getStringParam(draft, `osc.${oscillator}.wavetable` as SynthParameterId) as WavetableId;
  const warpMode = getStringParam(draft, `osc.${oscillator}.warpMode` as SynthParameterId);
  const unisonEnabled = getBooleanParam(draft, "unison.enabled");
  const positionTarget = `osc.${oscillator}.position` as ModulationTargetId;
  return {
    bank: bankFromWavetableId(wavetableId),
    customId: wavetableId.startsWith("user.") ? wavetableId : undefined,
    position: modulatedNumberParam(draft, `osc.${oscillator}.position` as SynthParameterId, positionTarget, 0, 1),
    warp: getNumberParam(draft, `osc.${oscillator}.warp` as SynthParameterId),
    warpMode: isWavetableWarpMode(warpMode) ? warpMode : "shape",
    unison: unisonEnabled ? getNumberParam(draft, "unison.voices") : 1,
    detuneCents: unisonEnabled ? modulatedNumberParam(draft, "unison.detune", "unison.detune", 0, 1) * 100 : 0,
    blend: unisonEnabled ? modulatedNumberParam(draft, "unison.spread", "unison.spread", 0, 1) : 0,
  };
}

function lfoWaveformFromDraft(draft: SynthDraftPatch, lfo: 1 | 2 = 1): NonNullable<Instrument["lfoWaveform"]> {
  const shape = getStringParam(draft, `lfo.${lfo}.shape` as SynthParameterId);
  return shape === "triangle" || shape === "saw" || shape === "square" ? shape : "sine";
}

function filterTypeFromDraft(draft: SynthDraftPatch): NonNullable<Instrument["filterType"]> {
  const type = getStringParam(draft, "filter.type");
  return type === "bandpass" || type === "highpass" ? type : "lowpass";
}

function oscillatorFromDraft(draft: SynthDraftPatch, oscillator: OscillatorKey, wavetable: WavetableConfig) {
  const prefix = `osc.${oscillator}`;
  return {
    enabled: getBooleanParam(draft, `osc.${oscillator}.enabled` as SynthParameterId),
    level: modulatedNumberParam(draft, `${prefix}.level` as SynthParameterId, `${prefix}.level` as ModulationTargetId, 0, 1),
    pan: modulatedNumberParam(draft, `${prefix}.pan` as SynthParameterId, `${prefix}.pan` as ModulationTargetId, -1, 1),
    waveform: "wavetable" as const,
    octave: getNumberParam(draft, `osc.${oscillator}.octave` as SynthParameterId),
    semitone: getNumberParam(draft, `osc.${oscillator}.semitone` as SynthParameterId),
    fineCents: modulatedNumberParam(draft, `${prefix}.fine` as SynthParameterId, `${prefix}.fine` as ModulationTargetId, -100, 100),
    phase: getNumberParam(draft, `${prefix}.phase` as SynthParameterId),
    randomPhase: getNumberParam(draft, `${prefix}.randomPhase` as SynthParameterId),
    wavetable,
  };
}

function applyOscillatorToDraft(draft: SynthDraftPatch, oscillator: OscillatorKey, source: NonNullable<Instrument["aether"]>["oscA"]) {
  draft.parameters[`osc.${oscillator}.enabled` as SynthParameterId] = source.enabled;
  draft.parameters[`osc.${oscillator}.level` as SynthParameterId] = source.level;
  draft.parameters[`osc.${oscillator}.pan` as SynthParameterId] = source.pan ?? 0;
  draft.parameters[`osc.${oscillator}.octave` as SynthParameterId] = source.octave;
  draft.parameters[`osc.${oscillator}.semitone` as SynthParameterId] = source.semitone;
  draft.parameters[`osc.${oscillator}.fine` as SynthParameterId] = source.fineCents;
  draft.parameters[`osc.${oscillator}.phase` as SynthParameterId] = source.phase ?? 0;
  draft.parameters[`osc.${oscillator}.randomPhase` as SynthParameterId] = source.randomPhase ?? 0.25;
  applyWavetableToDraft(draft, oscillator, source.wavetable, oscillator === "a");
}

function applyWavetableToDraft(
  draft: SynthDraftPatch,
  oscillator: OscillatorKey,
  wavetable: WavetableConfig,
  applyGlobalUnison: boolean,
) {
  draft.parameters[`osc.${oscillator}.wavetable` as SynthParameterId] = wavetable.customId?.startsWith("user.")
    ? wavetable.customId
    : wavetableIdFromBank(wavetable.bank);
  draft.parameters[`osc.${oscillator}.position` as SynthParameterId] = wavetable.position;
  draft.parameters[`osc.${oscillator}.warp` as SynthParameterId] = wavetable.warp;
  draft.parameters[`osc.${oscillator}.warpMode` as SynthParameterId] = wavetable.warpMode ?? "shape";
  if (!applyGlobalUnison) return;
  draft.parameters["unison.enabled"] = wavetable.unison > 1;
  draft.parameters["unison.voices"] = wavetable.unison;
  draft.parameters["unison.detune"] = wavetable.detuneCents / 100;
  draft.parameters["unison.blend"] = wavetable.blend;
  draft.parameters["unison.spread"] = wavetable.blend;
}

function isWavetableWarpMode(value: unknown): value is WavetableWarpMode {
  return value === "shape" || value === "fold" || value === "pinch";
}

function routeAmount(draft: SynthDraftPatch, source: ModulationSourceId, target: ModulationTargetId): number {
  return draft.modulation
    .filter((route) => route.enabled && route.source === source && route.target === target)
    .reduce((sum, route) => sum + route.amount, 0);
}

function routeBipolar(
  draft: SynthDraftPatch,
  source: ModulationSourceId,
  target: ModulationTargetId,
  fallback: boolean,
): boolean {
  const route = draft.modulation.find((candidate) => candidate.enabled && candidate.source === source && candidate.target === target);
  return route ? route.bipolar : fallback;
}

function staticRouteAmount(draft: SynthDraftPatch, target: ModulationTargetId): number {
  const scale = staticRouteScale(target);
  return Math.max(
    -scale,
    Math.min(
      scale,
      draft.modulation
        .filter((route) => route.enabled && route.target === target && isMacroSource(route.source))
        .reduce((sum, route) => sum + (isMacroSource(route.source) ? macroOutputValue(draft, route.source) : 0) * route.amount * scale, 0),
    ),
  );
}

function modulatedNumberParam(
  draft: SynthDraftPatch,
  id: SynthParameterId,
  target: ModulationTargetId,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, getNumberParam(draft, id) + staticRouteAmount(draft, target)));
}

function isMacroSource(source: ModulationSourceId): source is MacroId {
  return source.startsWith("macro.");
}

function staticRouteScale(target: ModulationTargetId): number {
  return target.endsWith(".fine") ? 100 : 1;
}

function bankFromWavetableId(id: WavetableId): WavetableConfig["bank"] {
  if (id.startsWith("user.")) return "custom";
  if (id === "basic.sine") return "glass";
  if (id === "basic.square") return "vocal";
  if (id === "basic.triangle") return "organ";
  if (id === "basic.pulse") return "fm";
  return "aether";
}

function wavetableIdFromBank(bank: WavetableConfig["bank"]): WavetableId {
  if (bank === "custom") return DEFAULT_CUSTOM_WAVETABLE_ID;
  if (bank === "glass") return "basic.sine";
  if (bank === "vocal") return "basic.square";
  if (bank === "organ") return "basic.triangle";
  if (bank === "fm") return "basic.pulse";
  return "basic.saw";
}

function hzToNormalizedCutoff(hz: number): number {
  const min = 20;
  const max = 20000;
  const safe = Math.max(min, Math.min(max, hz));
  return Math.max(0, Math.min(1, Math.log(safe / min) / Math.log(max / min)));
}

function normalizedCutoffToHz(value: number): number {
  const min = 20;
  const max = 20000;
  const normalized = Math.max(0, Math.min(1, value));
  return min * Math.pow(max / min, normalized);
}

function clampBipolar(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sanitize01(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function sanitizeBipolar(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(-1, Math.min(1, value))
    : fallback;
}
