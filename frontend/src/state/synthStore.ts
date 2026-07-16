import { createStore as create } from "zustand/vanilla";
import type {
  AetherSampleZoneConfig,
  CustomWavetableDefinition,
  CustomWavetableFrame,
  EnvelopeCurve,
  Instrument,
  InstrumentTaxonomyAssignment,
  ManagedSfzAssetConfig,
  ManagedGranularAssetConfig,
  ManagedSpectralAssetConfig,
  SynthPatchSnapshot,
  SynthPatchMacroDefinition,
  TrackEffect,
  TrackEffectChain,
  WavemapFrameAnalysis,
  WavemapDefinition,
  WavemapSource,
  WavetableConfig,
  WavetableWarpMode,
} from "./types";
import factoryAetherGuide from "../data/factory_demo_starter_bank_v4_acoustic_synth_guide.json";
import benchmarkAetherStrings from "../data/aether_benchmark_strings_bank.json";
import { normalizeTrackEffectChain } from "./effects";
import { taxonomyAssignmentForInstrumentId } from "./instrumentTaxonomy";

export const SYNTH_PATCH_SCHEMA_VERSION = 6;
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

export type WavemapAudioSelectionMode = "full" | "transient" | "sustain" | "manual";

export interface WavemapAudioSelectionOptions {
  mode?: WavemapAudioSelectionMode;
  startRatio?: number;
  endRatio?: number;
  windowRatio?: number;
}

export interface WavemapAudioSelection {
  mode: WavemapAudioSelectionMode;
  samples: Float32Array;
  sourceStartSample: number;
  sourceEndSample: number;
  peakSample: number;
  rms: number;
}

export interface WavemapManualRange {
  startRatio: number;
  endRatio: number;
  startPercent: number;
  endPercent: number;
}

export type OscillatorKey = string;
export interface SynthOscillatorDefinition { id: OscillatorKey; name: string }
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
  | "randomPhase"
  | "fxSend1"
  | "fxSend2";

export type OscillatorUnisonParameterId =
  | `osc.${OscillatorKey}.unison.voices`
  | `osc.${OscillatorKey}.unison.detune`
  | `osc.${OscillatorKey}.unison.spread`;

export type OscillatorTuningParameterId =
  | `osc.${OscillatorKey}.tuning.mode`
  | `osc.${OscillatorKey}.tuning.harmonic`
  | `osc.${OscillatorKey}.tuning.numerator`
  | `osc.${OscillatorKey}.tuning.denominator`
  | `osc.${OscillatorKey}.tuning.step`
  | `osc.${OscillatorKey}.tuning.divisions`;

export type SynthParameterId =
  | `osc.${OscillatorKey}.${OscillatorParamSuffix}`
  | OscillatorUnisonParameterId
  | OscillatorTuningParameterId
  | `osc.${OscillatorKey}.phaseMode`
  | `osc.${OscillatorKey}.route`
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
  | "filter.2.enabled"
  | "filter.2.type"
  | "filter.2.cutoff"
  | "filter.2.resonance"
  | "filter.2.drive"
  | "filter.routing"
  | "aether.runtimeWarp"
  | "aether.runtimeWarpMode"
  | "aether.runtimeWarp2"
  | "aether.runtimeWarp2Mode"
  | "aether.interaction.mode"
  | "aether.interaction.amount"
  | "aether.noise.enabled"
  | "aether.noise.level"
  | "aether.noise.color"
  | "aether.noise.route"
  | "aether.sub.route"
  | "aether.sub.fxSend1"
  | "aether.sub.fxSend2"
  | "aether.noise.fxSend1"
  | "aether.noise.fxSend2"
  | "aether.sample.1.enabled"
  | "aether.sample.1.audioFileId"
  | "aether.sample.1.rootNote"
  | "aether.sample.1.level"
  | "aether.sample.1.pan"
  | "aether.sample.1.route"
  | "aether.sample.1.start"
  | "aether.sample.1.end"
  | "aether.sample.1.loop.enabled"
  | "aether.sample.1.loop.start"
  | "aether.sample.1.loop.end"
  | "aether.sample.1.fxSend1"
  | "aether.sample.1.fxSend2"
  | "aether.granular.2.enabled"
  | "aether.granular.2.builtinSource"
  | "aether.granular.2.rootNote"
  | "aether.granular.2.level"
  | "aether.granular.2.route"
  | "aether.granular.2.position"
  | "aether.granular.2.positionSpread"
  | "aether.granular.2.grainMilliseconds"
  | "aether.granular.2.densityHz"
  | "aether.granular.2.pitchSemitones"
  | "aether.granular.2.stereoSpread"
  | "aether.granular.2.randomSeed"
  | "aether.granular.2.fxSend1"
  | "aether.granular.2.fxSend2"
  | "aether.spectral.3.enabled"
  | "aether.spectral.3.rootNote"
  | "aether.spectral.3.level"
  | "aether.spectral.3.pan"
  | "aether.spectral.3.stereoWidth"
  | "aether.spectral.3.position"
  | "aether.spectral.3.pitchSemitones"
  | "aether.spectral.3.freeze"
  | "aether.spectral.3.route"
  | "aether.spectral.3.fxSend1"
  | "aether.spectral.3.fxSend2"
  | "aether.fxBus1Id"
  | "aether.fxBus2Id"
  | "aether.mpe.enabled"
  | "aether.mpe.masterChannel"
  | "aether.mpe.firstMemberChannel"
  | "aether.mpe.lastMemberChannel"
  | "amp.level"
  | "amp.pan"
  | "maxVoices"
  | "mono.enabled"
  | "legato.enabled"
  | "glide.ms"
  | "env.1.attack"
  | "env.1.attackCurve"
  | "env.1.decay"
  | "env.1.decayCurve"
  | "env.1.sustain"
  | "env.1.release"
  | "env.1.releaseCurve"
  | "env.1.loop"
  | "env.2.attack"
  | "env.2.attackCurve"
  | "env.2.decay"
  | "env.2.decayCurve"
  | "env.2.sustain"
  | "env.2.release"
  | "env.2.releaseCurve"
  | "env.2.loop"
  | `env.${3 | 4}.${"attack" | "attackCurve" | "decay" | "decayCurve" | "sustain" | "release" | "releaseCurve" | "loop"}`
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
  | `lfo.${3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}.${"enabled" | "rate" | "sync" | "syncedRate" | "smoothing" | "randomPhase" | "shape" | "phase" | "retrigger" | "oneShot" | "bipolar"}`
  | "macro.1"
  | "macro.2"
  | "macro.3"
  | "macro.4"
  | "macro.5"
  | "macro.6"
  | "macro.7"
  | "macro.8";

export type SynthParameterValue = boolean | number | string;

export type ModulationSourceId =
  | "env.1"
  | "env.2"
  | "env.3"
  | "env.4"
  | "lfo.1"
  | "lfo.2"
  | `lfo.${3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}`
  | "velocity"
  | "keytrack"
  | "modWheel"
  | "pressure"
  | "timbre"
  | "macro.1"
  | "macro.2"
  | "macro.3"
  | "macro.4"
  | "macro.5"
  | "macro.6"
  | "macro.7"
  | "macro.8";

export type MacroId = Extract<ModulationSourceId, `macro.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`>;
export type MacroCurve = SynthPatchMacroDefinition["curve"];
export type SynthMacroDefinition = Omit<SynthPatchMacroDefinition, "id"> & { id: MacroId };

export const MACRO_IDS = ["macro.1", "macro.2", "macro.3", "macro.4", "macro.5", "macro.6", "macro.7", "macro.8"] as const satisfies readonly MacroId[];

const DEFAULT_MACROS: Record<MacroId, SynthMacroDefinition> = {
  "macro.1": { id: "macro.1", label: "Motion", min: 0, max: 1, curve: "linear" },
  "macro.2": { id: "macro.2", label: "Color", min: 0, max: 1, curve: "linear" },
  "macro.3": { id: "macro.3", label: "Shape", min: 0, max: 1, curve: "linear" },
  "macro.4": { id: "macro.4", label: "Space", min: 0, max: 1, curve: "linear" },
  "macro.5": { id: "macro.5", label: "Macro 5", min: 0, max: 1, curve: "linear" },
  "macro.6": { id: "macro.6", label: "Macro 6", min: 0, max: 1, curve: "linear" },
  "macro.7": { id: "macro.7", label: "Macro 7", min: 0, max: 1, curve: "linear" },
  "macro.8": { id: "macro.8", label: "Macro 8", min: 0, max: 1, curve: "linear" },
};

export type ModulationTargetId =
  | "osc.a.position"
  | "osc.a.warp"
  | "osc.a.fine"
  | "osc.a.level"
  | "osc.a.pan"
  | "osc.b.position"
  | "osc.b.warp"
  | "osc.b.fine"
  | "osc.b.level"
  | "osc.b.pan"
  | "osc.a.unison.detune"
  | "osc.a.unison.spread"
  | "osc.b.unison.detune"
  | "osc.b.unison.spread"
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

export interface SynthModulationRouteDisplay {
  sourceLabel: string;
  targetLabel: string;
  amountLabel: string;
  rangeLabel: string;
  stateLabel: "Active" | "Off";
}

export interface SynthModulationSourceAffordance {
  source: ModulationSourceId;
  label: string;
  detail: string;
  editor: "lfo" | "envelope" | "macro" | "performance";
}

export type SynthModulationSourceEditorTarget = MacroId | `lfo.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}` | "env.1" | "env.2" | "env.3" | "env.4" | "performance";

export interface SynthExpressionSummaryItem {
  id: "voices" | "legato" | "pitch-bend" | "velocity" | "keytrack" | "mod-wheel" | "pressure" | "timbre";
  label: string;
  value: string;
  detail: string;
  active: boolean;
  live?: boolean;
}

export interface SynthExpressionActivity {
  source: "preview" | "midi" | "playback";
  activeNotes?: number;
  pitchBendSemitones?: number;
  velocity?: number;
  keytrack?: number;
  modWheel?: number;
  pressure?: number;
  timbre?: number;
}

export interface SynthInstrumentExpressionActivity extends SynthExpressionActivity {
  updatedAt: number;
}

export interface SynthEnvelopeShapePoint {
  x: number;
  y: number;
}

export interface SynthEnvelopeEditorSummary {
  source: "env.1" | "env.2" | "env.3" | "env.4";
  label: string;
  mode: "Loop" | "One-shot";
  timingLabel: string;
  sustainLabel: string;
  curveLabel: string;
  assignmentLabel: string;
  assignmentCount: number;
  points: SynthEnvelopeShapePoint[];
}

export interface SynthDraftPatch {
  schemaVersion: typeof SYNTH_PATCH_SCHEMA_VERSION;
  instrumentType: typeof SYNTH_INSTRUMENT_TYPE;
  namespace: typeof SYNTH_PARAMETER_NAMESPACE;
  name: string;
  taxonomy?: InstrumentTaxonomyAssignment;
  parameters: Record<SynthParameterId, SynthParameterValue> & Record<string, SynthParameterValue>;
  modulation: SynthModulationRoute[];
  /** Instrument-owned FX inserted before track FX. */
  effects: TrackEffectChain;
  metadata: {
    createdBy: "Beat";
    tags: string[];
    icon?: string;
    macros: Record<MacroId, SynthMacroDefinition>;
    wavemaps?: Record<string, WavemapDefinition>;
    customWavetables?: Record<string, CustomWavetableDefinition>;
    oscillators: SynthOscillatorDefinition[];
    sampleSlot1Zones: AetherSampleZoneConfig[];
    managedSfz?: ManagedSfzAssetConfig;
    managedGranular?: ManagedGranularAssetConfig;
    managedSpectral?: ManagedSpectralAssetConfig;
  };
}

export interface SynthFactoryPresetRecord {
  id: string;
  name: string;
  patch: SynthDraftPatch;
  tags: string[];
  category: string;
  description: string;
  family: string;
  role: string;
  auditionNote: string;
}

function cloneSynthPatch(draft: SynthDraftPatch): SynthPatchSnapshot {
  return structuredClone(normalizeSynthDraftPatch(draft)) as SynthPatchSnapshot;
}

interface SynthStoreState {
  draft: SynthDraftPatch;
  boundInstrumentId: string | null;
  selectedOscillator: OscillatorKey;
  expressionActivityByInstrument: Record<string, SynthInstrumentExpressionActivity>;
  bindInstrument: (instrumentId: string | null) => void;
  setSelectedOscillator: (id: OscillatorKey) => void;
  addOscillator: () => void;
  removeOscillator: (id: OscillatorKey) => void;
  renameOscillator: (id: OscillatorKey, name: string) => void;
  setDraft: (patch: SynthDraftPatch | SynthPatchSnapshot) => void;
  resetDraft: () => void;
  setWavemap: (definition: WavemapDefinition) => void;
  updateCustomWavetableFrame: (id: string, frameIndex: number, patch: Partial<CustomWavetableFrame>) => void;
  updateWavemapMetadata: (id: string, patch: Partial<Pick<WavemapDefinition, "name" | "interpolation" | "morph" | "source">>) => void;
  updateMacroDefinition: (id: MacroId, patch: Partial<Omit<SynthMacroDefinition, "id">>) => void;
  setParameter: (id: SynthParameterId, value: SynthParameterValue) => void;
  setNumericParameter: (id: SynthParameterId, value: number) => void;
  setBooleanParameter: (id: SynthParameterId, value: boolean) => void;
  setName: (name: string) => void;
  updateModulationRoute: (id: string, patch: Partial<SynthModulationRoute>) => void;
  addModulationRoute: (route?: Partial<SynthModulationRoute>) => void;
  removeModulationRoute: (id: string) => void;
  setInstrumentExpressionActivity: (instrumentId: string, activity: SynthExpressionActivity) => void;
  clearInstrumentExpressionActivity: (instrumentId?: string) => void;
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

const DEFAULT_ADDED_OSCILLATOR_PARAMETERS: Record<OscillatorParamSuffix, SynthParameterValue> = {
  enabled: true, wavetable: "basic.saw", position: 0, warp: 0.2, warpMode: "shape",
  octave: 0, semitone: 0, fine: 0, level: 0.6, pan: 0, phase: 0, randomPhase: 0.25,
  fxSend1: 0, fxSend2: 0,
};

function oscillatorIdForIndex(index: number): string {
  return index < 26 ? String.fromCharCode(97 + index) : `osc-${index + 1}`;
}

function oscillatorLabelForIndex(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

function normalizeOscillatorDefinitions(value: unknown): SynthOscillatorDefinition[] {
  const definitions = Array.isArray(value) ? value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.id)) return [];
    return [{ id: entry.id, name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 48) : `Oscillator ${entry.id.toUpperCase()}` }];
  }) : [];
  if (definitions.length === 0) return [{ id: "a", name: "Oscillator A" }, { id: "b", name: "Oscillator B" }];
  const unique = definitions.filter((entry, index) => definitions.findIndex((candidate) => candidate.id === entry.id) === index);
  if (!unique.some((entry) => entry.id === "a")) unique.unshift({ id: "a", name: "Oscillator A" });
  return unique;
}

export class HybridSourceMigrationError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
    message: string,
  ) {
    super(`${code} at ${path}: ${message}`);
    this.name = "HybridSourceMigrationError";
  }
}

function hybridMigrationFailure(code: string, path: string, message: string): never {
  throw new HybridSourceMigrationError(code, path, message);
}

function normalizeAetherSampleZones(value: unknown): AetherSampleZoneConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    hybridMigrationFailure("aether.sample-slot-1.zones-shape", "metadata.sampleSlot1Zones", "Expected an array.");
  if (value.length > 8)
    hybridMigrationFailure("aether.sample-slot-1.zones-capacity", "metadata.sampleSlot1Zones", "At most 8 zones are supported.");
  const number = (entry: Record<string, unknown>, key: string, fallback: number) =>
    typeof entry[key] === "number" && Number.isFinite(entry[key]) ? Number(entry[key]) : fallback;
  const midi = (entry: Record<string, unknown>, key: string, fallback: number) =>
    Math.max(0, Math.min(127, Math.round(number(entry, key, fallback))));
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.audioFileId !== "string" || !entry.audioFileId)
      hybridMigrationFailure("aether.sample-slot-1.zone-shape", `metadata.sampleSlot1Zones[${index}]`, "Expected an object with audioFileId.");
    const loNote = midi(entry, "loNote", 0);
    const hiNote = Math.max(loNote, midi(entry, "hiNote", 127));
    const loVelocity = midi(entry, "loVelocity", 0);
    const hiVelocity = Math.max(loVelocity, midi(entry, "hiVelocity", 127));
    const startRatio = clamp01(number(entry, "startRatio", 0));
    const endRatio = Math.max(startRatio, clamp01(number(entry, "endRatio", 1)));
    const loopStartRatio = Math.max(startRatio, Math.min(endRatio, number(entry, "loopStartRatio", startRatio)));
    const loopEndRatio = Math.max(loopStartRatio, Math.min(endRatio, number(entry, "loopEndRatio", endRatio)));
    return {
      audioFileId: entry.audioFileId,
      rootNote: midi(entry, "rootNote", 60),
      loNote,
      hiNote,
      loVelocity,
      hiVelocity,
      level: clamp01(number(entry, "level", 0.8)),
      pan: clampBipolar(number(entry, "pan", 0)),
      startRatio,
      endRatio,
      loopEnabled: entry.loopEnabled === true && loopEndRatio > loopStartRatio,
      loopStartRatio,
      loopEndRatio,
    };
  });
}

function normalizeManagedSfz(value: unknown): ManagedSfzAssetConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value))
    hybridMigrationFailure("aether.sample-slot-1.managed-sfz.shape", "metadata.managedSfz", "Expected an object.");
  if (typeof value.schemaVersion !== "number" || !Number.isInteger(value.schemaVersion) || value.schemaVersion < 0)
    hybridMigrationFailure("aether.sample-slot-1.managed-sfz.schema-invalid", "metadata.managedSfz.schemaVersion", "Expected a non-negative integer.");
  if (value.schemaVersion > 1)
    hybridMigrationFailure("aether.sample-slot-1.managed-sfz.schema-future", "metadata.managedSfz.schemaVersion", "Version is newer than supported version 1.");
  if (value.schemaVersion !== 1
    || typeof value.assetId !== "string" || !value.assetId
    || typeof value.manifestPath !== "string" || !value.manifestPath
    || typeof value.sourcePath !== "string" || !value.sourcePath)
    hybridMigrationFailure("aether.sample-slot-1.managed-sfz.shape", "metadata.managedSfz", "Required managed SFZ fields are missing.");
  if (value.samplePaths !== undefined && !Array.isArray(value.samplePaths))
    hybridMigrationFailure("aether.sample-slot-1.managed-sfz.sample-paths-shape", "metadata.managedSfz.samplePaths", "Expected an array.");
  if (Array.isArray(value.samplePaths)
    && (value.samplePaths.length > 256 || value.samplePaths.some((path) => typeof path !== "string" || !path)))
    hybridMigrationFailure("aether.sample-slot-1.managed-sfz.sample-paths-invalid", "metadata.managedSfz.samplePaths", "Expected at most 256 non-empty paths.");
  return {
    schemaVersion: 1,
    assetId: value.assetId,
    displayName: typeof value.displayName === "string" ? value.displayName.slice(0, 128) : value.assetId,
    manifestPath: value.manifestPath,
    sourcePath: value.sourcePath,
    samplePaths: Array.isArray(value.samplePaths) ? value.samplePaths as string[] : [],
  };
}

function normalizeManagedGranular(value: unknown): ManagedGranularAssetConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value))
    hybridMigrationFailure("aether.granular-slot-2.managed-asset.shape", "metadata.managedGranular", "Expected an object.");
  if (typeof value.schemaVersion !== "number" || !Number.isInteger(value.schemaVersion) || value.schemaVersion < 0)
    hybridMigrationFailure("aether.granular-slot-2.managed-asset.schema-invalid", "metadata.managedGranular.schemaVersion", "Expected a non-negative integer.");
  if (value.schemaVersion > 1)
    hybridMigrationFailure("aether.granular-slot-2.managed-asset.schema-future", "metadata.managedGranular.schemaVersion", "Version is newer than supported version 1.");
  if (value.schemaVersion !== 1
    || typeof value.assetId !== "string" || !value.assetId
    || typeof value.manifestPath !== "string" || !value.manifestPath
    || typeof value.audioPath !== "string" || !value.audioPath)
    hybridMigrationFailure("aether.granular-slot-2.managed-asset.shape", "metadata.managedGranular", "Required managed granular fields are missing.");
  return {
    schemaVersion: 1,
    assetId: value.assetId,
    displayName: typeof value.displayName === "string" ? value.displayName.slice(0, 128) : value.assetId,
    manifestPath: value.manifestPath,
    audioPath: value.audioPath,
  };
}

function normalizeManagedSpectral(value: unknown): ManagedSpectralAssetConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value))
    hybridMigrationFailure("aether.spectral-slot-3.managed-asset.shape", "metadata.managedSpectral", "Expected an object.");
  if (typeof value.schemaVersion !== "number" || !Number.isInteger(value.schemaVersion) || value.schemaVersion < 0)
    hybridMigrationFailure("aether.spectral-slot-3.managed-asset.schema-invalid", "metadata.managedSpectral.schemaVersion", "Expected a non-negative integer.");
  if (value.schemaVersion > 1)
    hybridMigrationFailure("aether.spectral-slot-3.managed-asset.schema-future", "metadata.managedSpectral.schemaVersion", "Version is newer than supported version 1.");
  if (value.schemaVersion !== 1
    || typeof value.assetId !== "string" || !value.assetId
    || typeof value.manifestPath !== "string" || !value.manifestPath
    || typeof value.sourcePath !== "string" || !value.sourcePath
    || typeof value.artifactPath !== "string" || !value.artifactPath)
    hybridMigrationFailure("aether.spectral-slot-3.managed-asset.shape", "metadata.managedSpectral", "Required managed spectral fields are missing.");
  return {
    schemaVersion: 1,
    assetId: value.assetId,
    displayName: typeof value.displayName === "string" ? value.displayName.slice(0, 128) : value.assetId,
    manifestPath: value.manifestPath,
    sourcePath: value.sourcePath,
    artifactPath: value.artifactPath,
  };
}
export const CUSTOM_WAVETABLE_PARTIAL_COUNT = 16;
const WAVEMAP_SCAN_ANCHOR_MARGIN = 0.01;

export type HarmonicPartialPreset = "fundamental" | "odd" | "even";

export interface WavemapAnalysisSummary {
  frameCount: number;
  analyzedFrameCount: number;
  averageRms: number;
  peak: number;
  averageZeroCrossRate: number;
  averageRoughness: number;
  averageAsymmetry: number;
  averageSpectralCentroid: number;
  dominantHarmonic: number;
  sourceStartSample?: number;
  sourceEndSample?: number;
}

export function createDefaultCustomWavetable(id = DEFAULT_CUSTOM_WAVETABLE_ID): CustomWavetableDefinition {
  return {
    schemaVersion: 1,
    id,
    name: "Custom",
    kind: "harmonic-sketch",
    interpolation: "linear",
    morph: 0.28,
    source: {
      kind: "drawn",
      label: "Drawn wavemap",
    },
    frames: [
      { id: `${id}.frame.1`, label: "A", position: 0.0, brightness: 0.22, even: 0.08, fold: 0.05, formant: 0.08, notch: 0.04, skew: -0.18, tilt: -0.16, focus: 0.18, phase: 0.0 },
      { id: `${id}.frame.2`, label: "B", position: 0.333, brightness: 0.46, even: 0.28, fold: 0.16, formant: 0.18, notch: 0.1, skew: -0.04, tilt: -0.04, focus: 0.32, phase: 0.12 },
      { id: `${id}.frame.3`, label: "C", position: 0.667, brightness: 0.72, even: 0.48, fold: 0.34, formant: 0.32, notch: 0.16, skew: 0.08, tilt: 0.08, focus: 0.52, phase: -0.08 },
      { id: `${id}.frame.4`, label: "D", position: 1.0, brightness: 0.94, even: 0.72, fold: 0.56, formant: 0.46, notch: 0.24, skew: 0.22, tilt: 0.2, focus: 0.7, phase: 0.2 },
    ],
  };
}

export function summarizeWavemapAnalysis(definition: Pick<WavemapDefinition, "frames">): WavemapAnalysisSummary {
  const analyses = definition.frames.map((frame) => frame.analysis).filter((analysis): analysis is WavemapFrameAnalysis => Boolean(analysis));
  const analyzedFrameCount = analyses.length;
  const analyzed = Math.max(1, analyzedFrameCount);
  const peakFrame = analyses.reduce<WavemapFrameAnalysis | null>((best, analysis) => {
    if (!best) return analysis;
    return analysis.peak > best.peak ? analysis : best;
  }, null);
  const sourceStartSamples = analyses
    .map((analysis) => analysis.sourceStartSample)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const sourceEndSamples = analyses
    .map((analysis) => analysis.sourceEndSample)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    frameCount: definition.frames.length,
    analyzedFrameCount,
    averageRms: analyses.reduce((sum, analysis) => sum + analysis.rms, 0) / analyzed,
    peak: peakFrame?.peak ?? 0,
    averageZeroCrossRate: analyses.reduce((sum, analysis) => sum + analysis.zeroCrossRate, 0) / analyzed,
    averageRoughness: analyses.reduce((sum, analysis) => sum + analysis.roughness, 0) / analyzed,
    averageAsymmetry: analyses.reduce((sum, analysis) => sum + analysis.asymmetry, 0) / analyzed,
    averageSpectralCentroid: analyses.reduce((sum, analysis) => sum + analysis.spectralCentroid, 0) / analyzed,
    dominantHarmonic: peakFrame?.dominantHarmonic ?? 0,
    sourceStartSample: sourceStartSamples.length ? Math.min(...sourceStartSamples) : undefined,
    sourceEndSample: sourceEndSamples.length ? Math.max(...sourceEndSamples) : undefined,
  };
}

export function constrainWavemapFramePosition(
  definition: Pick<WavemapDefinition, "frames">,
  frameIndex: number,
  position: number,
): number {
  const frameCount = definition.frames.length;
  if (frameCount <= 1) return 0;
  const safeIndex = Math.max(0, Math.min(frameCount - 1, Math.floor(frameIndex)));
  if (safeIndex === 0) return 0;
  if (safeIndex === frameCount - 1) return 1;
  const defaultPosition = safeIndex / Math.max(1, frameCount - 1);
  const previous = definition.frames[safeIndex - 1]?.position ?? (safeIndex - 1) / Math.max(1, frameCount - 1);
  const next = definition.frames[safeIndex + 1]?.position ?? (safeIndex + 1) / Math.max(1, frameCount - 1);
  const lower = Math.min(1, Math.max(0, previous) + WAVEMAP_SCAN_ANCHOR_MARGIN);
  const upper = Math.max(0, Math.min(1, next) - WAVEMAP_SCAN_ANCHOR_MARGIN);
  if (lower > upper) return Math.max(0, Math.min(1, defaultPosition));
  const safePosition = Number.isFinite(position) ? position : defaultPosition;
  return Math.max(lower, Math.min(upper, safePosition));
}

export function createHarmonicPartialPreset(preset: HarmonicPartialPreset): number[] {
  return Array.from({ length: CUSTOM_WAVETABLE_PARTIAL_COUNT }, (_, index) => {
    const harmonic = index + 1;
    if (preset === "fundamental") return harmonic === 1 ? 1 : 0;
    if (preset === "odd") return harmonic % 2 === 1 ? Math.max(0.12, 1 / Math.sqrt(harmonic)) : 0;
    return harmonic % 2 === 0 ? Math.max(0.1, 0.8 / Math.sqrt(harmonic)) : 0;
  });
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
  const sourceOffset = typeof source.sourceStartSample === "number" && Number.isFinite(source.sourceStartSample)
    ? Math.max(0, Math.floor(source.sourceStartSample))
    : 0;
  const frames: CustomWavetableFrame[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * frameLength;
    const end = frame === frameCount - 1 ? samples.length : Math.min(samples.length, start + frameLength);
    frames.push(analyzeSamplesToWavemapFrame(samples, start, end, safeId, frame, sourceOffset));
  }
  return normalizeCustomWavetable({
    schemaVersion: 1,
    id: safeId,
    name,
    kind: "resynthesized",
    interpolation: "smooth",
    morph: 0.42,
    source: {
      kind: source.kind === "imported-audio" ? "imported-audio" : "resynthesized",
      label: source.label ?? "Audio resynthesis",
      audioFileId: source.audioFileId,
      path: source.path,
      sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : undefined,
      channelCount: source.channelCount,
      bitDepth: source.bitDepth,
      sourceSampleCount: source.sourceSampleCount ?? samples.length,
      analyzedSampleCount: samples.length,
      frameCount,
      sourceStartSample: source.sourceStartSample,
      sourceEndSample: source.sourceEndSample ?? sourceOffset + samples.length,
      createdAt: source.createdAt ?? Date.now(),
    },
    frames,
  });
}

export function selectWavemapAudioWindow(
  samples: ArrayLike<number>,
  options: WavemapAudioSelectionOptions = {},
): WavemapAudioSelection {
  const length = samples.length;
  if (length <= 0) {
    return {
      mode: options.mode ?? "full",
      samples: new Float32Array([0]),
      sourceStartSample: 0,
      sourceEndSample: 1,
      peakSample: 0,
      rms: 0,
    };
  }

  const mode = options.mode ?? "full";
  let start = 0;
  let end = length;
  if (mode === "manual") {
    const startRatio = sanitize01(options.startRatio, 0);
    const endRatio = sanitize01(options.endRatio, 1);
    start = Math.floor(Math.min(startRatio, endRatio) * length);
    end = Math.ceil(Math.max(startRatio, endRatio) * length);
  } else if (mode === "transient") {
    const window = selectionWindowSamples(length, options.windowRatio ?? 0.28, 256);
    const peak = peakSampleIndex(samples, 0, length);
    start = peak - Math.floor(window * 0.18);
    end = start + window;
  } else if (mode === "sustain") {
    const window = selectionWindowSamples(length, options.windowRatio ?? 0.5, 512);
    const searchStart = Math.min(length - 1, Math.floor(length * 0.22));
    const peak = strongestRmsWindowStart(samples, searchStart, length, window);
    start = peak;
    end = peak + window;
  }

  const bounded = clampSampleWindow(start, end, length);
  const selected = new Float32Array(bounded.end - bounded.start);
  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < selected.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number(samples[bounded.start + index]) || 0));
    selected[index] = sample;
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return {
    mode,
    samples: selected,
    sourceStartSample: bounded.start,
    sourceEndSample: bounded.end,
    peakSample: peak,
    rms: Math.sqrt(sumSquares / Math.max(1, selected.length)),
  };
}

export function normalizeWavemapManualRange(startPercent: number, endPercent: number): WavemapManualRange {
  const start = sanitize01(startPercent / 100, 0);
  const end = sanitize01(endPercent / 100, 1);
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const safeHigh = Math.min(1, Math.max(high, low + 0.01));
  const safeLow = Math.max(0, Math.min(low, safeHigh - 0.01));
  return {
    startRatio: safeLow,
    endRatio: safeHigh,
    startPercent: Math.round(safeLow * 100),
    endPercent: Math.round(safeHigh * 100),
  };
}

export function deriveWavemapFrameFromDrawnWaveform(
  frame: Partial<CustomWavetableFrame>,
  samples: ArrayLike<number>,
): CustomWavetableFrame {
  const source = sanitizeCustomWavetableFrame(frame);
  const analyzed = analyzeSamplesToWavemapFrame(samples, 0, samples.length, source.id ?? "user.drawn.frame", 0);
  return sanitizeCustomWavetableFrame({
    ...source,
    brightness: analyzed.brightness,
    even: analyzed.even,
    fold: analyzed.fold,
    formant: analyzed.formant,
    notch: analyzed.notch,
    skew: analyzed.skew,
    tilt: analyzed.tilt,
    focus: analyzed.focus,
    phase: analyzed.phase,
    partials: analyzed.partials,
    analysis: analyzed.analysis,
  }, source);
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
  const formant = spreadFrameValues(frames.map((frame) => frame.formant), 0.04, 0.58, [0.04, 0.16, 0.34, 0.58]);
  const notch = spreadFrameValues(frames.map((frame) => frame.notch), 0.02, 0.38, [0.5, 0.58, 0.72, 0.92]);
  const skew = spreadBipolarFrameValues(frames.map((frame) => frame.skew), [-0.24, -0.08, 0.1, 0.24]);
  const tilt = spreadBipolarFrameValues(frames.map((frame) => frame.tilt), [-0.2, -0.06, 0.08, 0.22]);
  const focus = spreadFrameValues(frames.map((frame) => frame.focus), 0.16, 0.74, [0.16, 0.3, 0.52, 0.74]);
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
      formant: formant[index] ?? frame.formant,
      notch: notch[index] ?? frame.notch,
      skew: skew[index] ?? frame.skew,
      tilt: tilt[index] ?? frame.tilt,
      focus: focus[index] ?? frame.focus,
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
        formant: clamp01(frame.formant + randomSigned(rng) * 0.42 * strength + Math.abs(motion) * 0.1),
        notch: clamp01(frame.notch + randomSigned(rng) * 0.36 * strength + Math.abs(motion) * 0.08),
        skew: clampBipolar(frame.skew + randomSigned(rng) * 0.64 * strength + motion * 0.18),
        tilt: clampBipolar(frame.tilt + randomSigned(rng) * 0.52 * strength + motion * 0.16),
        focus: clamp01(frame.focus + randomSigned(rng) * 0.36 * strength + Math.abs(motion) * 0.08),
        phase: clampBipolar(frame.phase + randomSigned(rng) * 0.72 * strength + motion * 0.2),
      };
    }),
  });
}

export function drawHarmonicPartialLine(
  partials: unknown,
  fromIndex: number,
  fromValue: number,
  toIndex: number,
  toValue: number,
): number[] {
  const next = sanitizeCustomWavetablePartials(partials) ?? Array.from({ length: CUSTOM_WAVETABLE_PARTIAL_COUNT }, () => 0);
  const startIndex = Math.max(0, Math.min(CUSTOM_WAVETABLE_PARTIAL_COUNT - 1, Math.round(fromIndex)));
  const endIndex = Math.max(0, Math.min(CUSTOM_WAVETABLE_PARTIAL_COUNT - 1, Math.round(toIndex)));
  const startValue = clamp01(fromValue);
  const endValue = clamp01(toValue);
  const direction = startIndex <= endIndex ? 1 : -1;
  const distance = Math.max(1, Math.abs(endIndex - startIndex));
  for (let index = startIndex; direction > 0 ? index <= endIndex : index >= endIndex; index += direction) {
    const t = Math.abs(index - startIndex) / distance;
    next[index] = clamp01(startValue + (endValue - startValue) * t);
  }
  return next;
}

export function smoothHarmonicPartials(partials: unknown, amount = 0.5): number[] {
  const source = sanitizeCustomWavetablePartials(partials) ?? Array.from({ length: CUSTOM_WAVETABLE_PARTIAL_COUNT }, () => 0);
  const mix = clamp01(amount);
  return source.map((value, index) => {
    const previous = source[Math.max(0, index - 1)] ?? value;
    const next = source[Math.min(CUSTOM_WAVETABLE_PARTIAL_COUNT - 1, index + 1)] ?? value;
    const smoothed = previous * 0.25 + value * 0.5 + next * 0.25;
    return clamp01(value + (smoothed - value) * mix);
  });
}

export function tiltHarmonicPartials(partials: unknown, tilt = 0.35): number[] {
  const source = sanitizeCustomWavetablePartials(partials) ?? Array.from({ length: CUSTOM_WAVETABLE_PARTIAL_COUNT }, () => 0);
  const amount = sanitizeBipolar(tilt, 0);
  if (Math.abs(amount) < 0.0001) return source;
  const pivot = (CUSTOM_WAVETABLE_PARTIAL_COUNT - 1) * 0.5;
  return source.map((value, index) => {
    const normalizedIndex = (index - pivot) / Math.max(1, pivot);
    const emphasis = Math.exp(amount * normalizedIndex * 1.2);
    return clamp01(value * emphasis);
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

function selectionWindowSamples(length: number, ratio: number, minimum: number): number {
  return Math.max(1, Math.min(length, Math.max(minimum, Math.floor(length * sanitize01(ratio, 0.25)))));
}

function clampSampleWindow(start: number, end: number, length: number): { start: number; end: number } {
  const width = Math.max(1, Math.floor(end) - Math.floor(start));
  let safeStart = Math.max(0, Math.min(length - 1, Math.floor(start)));
  let safeEnd = Math.min(length, safeStart + width);
  if (safeEnd - safeStart < width) {
    safeStart = Math.max(0, safeEnd - width);
    safeEnd = Math.min(length, safeStart + width);
  }
  return { start: safeStart, end: Math.max(safeStart + 1, safeEnd) };
}

function peakSampleIndex(samples: ArrayLike<number>, start: number, end: number): number {
  const safeStart = Math.max(0, Math.min(samples.length - 1, Math.floor(start)));
  const safeEnd = Math.max(safeStart + 1, Math.min(samples.length, Math.floor(end)));
  let peakIndex = safeStart;
  let peak = 0;
  for (let index = safeStart; index < safeEnd; index += 1) {
    const value = Math.abs(Number(samples[index]) || 0);
    if (value > peak) {
      peak = value;
      peakIndex = index;
    }
  }
  return peakIndex;
}

function strongestRmsWindowStart(samples: ArrayLike<number>, start: number, end: number, window: number): number {
  const safeStart = Math.max(0, Math.min(samples.length - 1, Math.floor(start)));
  const safeEnd = Math.max(safeStart + 1, Math.min(samples.length, Math.floor(end)));
  const safeWindow = Math.max(1, Math.min(window, safeEnd - safeStart));
  const step = Math.max(1, Math.floor(safeWindow / 8));
  let bestStart = safeStart;
  let bestEnergy = -1;
  for (let index = safeStart; index <= safeEnd - safeWindow; index += step) {
    let energy = 0;
    for (let sampleIndex = index; sampleIndex < index + safeWindow; sampleIndex += 1) {
      const sample = Number(samples[sampleIndex]) || 0;
      energy += sample * sample;
    }
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestStart = index;
    }
  }
  return bestStart;
}

function analyzeSamplesToWavemapFrame(
  samples: ArrayLike<number>,
  start: number,
  end: number,
  wavemapId: string,
  frameIndex: number,
  sourceOffset = 0,
): CustomWavetableFrame {
  const safeStart = Math.max(0, Math.min(samples.length, Math.floor(start)));
  const safeEnd = Math.max(safeStart + 1, Math.min(samples.length, Math.floor(end)));
  let sumSquares = 0;
  let sumAbs = 0;
  let derivative = 0;
  let zeroCrossings = 0;
  let peak = 0;
  let positiveEnergy = 0;
  let negativeEnergy = 0;
  let previous = Number(samples[safeStart]) || 0;
  for (let index = safeStart; index < safeEnd; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number(samples[index]) || 0));
    sumSquares += sample * sample;
    sumAbs += Math.abs(sample);
    derivative += Math.abs(sample - previous);
    peak = Math.max(peak, Math.abs(sample));
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
  const spectrum = analyzeSamplesToHarmonicSpectrum(samples, safeStart, safeEnd);
  const partials = spectrum.partials;
  const tilt = estimateSpectralTiltFromPartials(partials);
  const spectralCentroid = estimateSpectralCentroidFromPartials(partials);
  return {
    id: `${wavemapId}.frame.${frameIndex + 1}`,
    label: CUSTOM_WAVETABLE_FRAME_LABELS[frameIndex] ?? `${frameIndex + 1}`,
    position: frameIndex / 3,
    brightness: clamp01(0.16 + rms * 1.3 + zeroCrossRate * 18),
    even: clamp01(0.08 + asymmetry * 0.72 + averageAbs * 0.28),
    fold: clamp01(0.04 + normalizedDerivative * 5.2 + rms * 0.18),
    formant: clamp01(0.08 + rms * 0.28 + normalizedDerivative * 3.4 + zeroCrossRate * 7),
    notch: clamp01(0.04 + (1 - rms) * 0.16 + normalizedDerivative * 2.2 + asymmetry * 0.9),
    skew: sanitizeBipolar((zeroCrossRate * 10 - averageAbs) * 0.22 + (rms - 0.28) * 0.35, 0),
    tilt,
    focus: clamp01(0.18 + normalizedDerivative * 2.1 + Math.abs(tilt) * 0.24 + asymmetry * 0.18),
    phase: sanitizeBipolar(spectrum.dominantPhase / Math.PI, 0),
    partials,
    analysis: {
      sourceStartSample: sourceOffset + safeStart,
      sourceEndSample: sourceOffset + safeEnd,
      rms,
      peak,
      zeroCrossRate,
      roughness: normalizedDerivative,
      asymmetry,
      spectralCentroid,
      dominantHarmonic: spectrum.dominantHarmonic,
      dominantPhase: spectrum.dominantPhase,
    },
  };
}

function estimateSpectralTiltFromPartials(partials: number[]): number {
  const low = partials.slice(0, 4).reduce((sum, value) => sum + clamp01(value), 0);
  const high = partials.slice(8, 16).reduce((sum, value) => sum + clamp01(value), 0);
  return sanitizeBipolar((high - low) / Math.max(0.001, high + low), 0);
}

function estimateSpectralCentroidFromPartials(partials: number[]): number {
  let weighted = 0;
  let total = 0;
  for (let index = 0; index < partials.length; index += 1) {
    const value = clamp01(partials[index]);
    weighted += value * (index + 1);
    total += value;
  }
  return total > 0 ? weighted / total : 0;
}

function analyzeSamplesToHarmonicSpectrum(samples: ArrayLike<number>, start: number, end: number): {
  partials: number[];
  dominantHarmonic: number;
  dominantPhase: number;
} {
  const length = Math.max(1, end - start);
  const stride = Math.max(1, Math.floor(length / 1024));
  const count = Math.max(1, Math.ceil(length / stride));
  const phases: number[] = [];
  const magnitudes = Array.from({ length: CUSTOM_WAVETABLE_PARTIAL_COUNT }, (_, harmonicIndex) => {
    const harmonic = harmonicIndex + 1;
    let real = 0;
    let imag = 0;
    let windowSum = 0;
    let sampleIndex = 0;
    for (let index = start; index < end; index += stride) {
      const sample = Math.max(-1, Math.min(1, Number(samples[index]) || 0));
      const phase = (Math.PI * 2 * harmonic * sampleIndex) / Math.max(1, count - 1);
      const window = 0.5 - 0.5 * Math.cos((Math.PI * 2 * sampleIndex) / Math.max(1, count - 1));
      real += sample * Math.cos(phase) * window;
      imag -= sample * Math.sin(phase) * window;
      windowSum += window;
      sampleIndex += 1;
    }
    phases[harmonicIndex] = Math.atan2(real, -imag);
    return Math.sqrt(real * real + imag * imag) / Math.max(0.0001, windowSum);
  });
  const peak = Math.max(...magnitudes, 0.0001);
  let dominantIndex = 0;
  for (let index = 1; index < magnitudes.length; index += 1) {
    if (magnitudes[index] > magnitudes[dominantIndex]) dominantIndex = index;
  }
  return {
    partials: magnitudes.map((value) => clamp01(Math.sqrt(value / peak))),
    dominantHarmonic: dominantIndex + 1,
    dominantPhase: phases[dominantIndex] ?? 0,
  };
}

type ExtraLfoParameterId = Extract<SynthParameterId, `lfo.${3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}.${string}`>;

const EXTRA_LFO_DEFAULTS = (() => {
  const values = {} as Record<ExtraLfoParameterId, SynthParameterValue>;
  for (let index = 3; index <= 10; index += 1) {
    const prefix = `lfo.${index}`;
    values[`${prefix}.enabled` as ExtraLfoParameterId] = false;
    values[`${prefix}.rate` as ExtraLfoParameterId] = 1;
    values[`${prefix}.sync` as ExtraLfoParameterId] = false;
    values[`${prefix}.syncedRate` as ExtraLfoParameterId] = "1/4";
    values[`${prefix}.smoothing` as ExtraLfoParameterId] = 0;
    values[`${prefix}.randomPhase` as ExtraLfoParameterId] = 0;
    values[`${prefix}.shape` as ExtraLfoParameterId] = "sine";
    values[`${prefix}.phase` as ExtraLfoParameterId] = 0;
    values[`${prefix}.retrigger` as ExtraLfoParameterId] = true;
    values[`${prefix}.oneShot` as ExtraLfoParameterId] = false;
    values[`${prefix}.bipolar` as ExtraLfoParameterId] = true;
  }
  return values;
})();

const EXTRA_LFO_LABELS = (() => {
  const values = {} as Record<ExtraLfoParameterId, string>;
  for (let index = 3; index <= 10; index += 1) {
    const prefix = `lfo.${index}`;
    for (const [suffix, label] of [["enabled", "Enabled"], ["rate", "Rate"], ["sync", "Sync"], ["syncedRate", "Sync Rate"], ["smoothing", "Smoothing"],
      ["randomPhase", "Random"], ["shape", "Shape"], ["phase", "Phase"], ["retrigger", "Retrigger"],
      ["oneShot", "One-Shot"], ["bipolar", "Bipolar"]] as const) {
      values[`${prefix}.${suffix}` as ExtraLfoParameterId] = `LFO ${index} ${label}`;
    }
  }
  return values;
})();

export const DEFAULT_SYNTH_PARAMETERS: Record<SynthParameterId, SynthParameterValue> = {
  ...EXTRA_LFO_DEFAULTS,
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
  "osc.a.fxSend1": 0,
  "osc.a.fxSend2": 0,
  "osc.a.unison.voices": 1,
  "osc.a.unison.detune": 0.12,
  "osc.a.unison.spread": 0.5,
  "osc.a.tuning.mode": "semitone",
  "osc.a.tuning.harmonic": 1,
  "osc.a.tuning.numerator": 1,
  "osc.a.tuning.denominator": 1,
  "osc.a.tuning.step": 0,
  "osc.a.tuning.divisions": 12,
  "osc.a.phaseMode": "retrigger",
  "osc.a.route": "filter",
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
  "osc.b.fxSend1": 0,
  "osc.b.fxSend2": 0,
  "osc.b.unison.voices": 1,
  "osc.b.unison.detune": 0.12,
  "osc.b.unison.spread": 0.5,
  "osc.b.tuning.mode": "semitone",
  "osc.b.tuning.harmonic": 1,
  "osc.b.tuning.numerator": 1,
  "osc.b.tuning.denominator": 1,
  "osc.b.tuning.step": 0,
  "osc.b.tuning.divisions": 12,
  "osc.b.phaseMode": "retrigger",
  "osc.b.route": "filter",
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
  "filter.2.enabled": false,
  "filter.2.type": "lowpass",
  "filter.2.cutoff": 18000,
  "filter.2.resonance": 0.1,
  "filter.2.drive": 0,
  "filter.routing": "serial",
  "aether.runtimeWarp": 0,
  "aether.runtimeWarpMode": "shape",
  "aether.runtimeWarp2": 0,
  "aether.runtimeWarp2Mode": "shape",
  "aether.interaction.mode": "off",
  "aether.interaction.amount": 0,
  "aether.noise.enabled": false,
  "aether.noise.level": 0,
  "aether.noise.color": 0.5,
  "aether.noise.route": "filter",
  "aether.sub.route": "filter",
  "aether.sub.fxSend1": 0,
  "aether.sub.fxSend2": 0,
  "aether.noise.fxSend1": 0,
  "aether.noise.fxSend2": 0,
  "aether.sample.1.enabled": false,
  "aether.sample.1.audioFileId": "",
  "aether.sample.1.rootNote": 60,
  "aether.sample.1.level": 0.8,
  "aether.sample.1.pan": 0,
  "aether.sample.1.route": "filter",
  "aether.sample.1.start": 0,
  "aether.sample.1.end": 1,
  "aether.sample.1.loop.enabled": false,
  "aether.sample.1.loop.start": 0,
  "aether.sample.1.loop.end": 1,
  "aether.sample.1.fxSend1": 0,
  "aether.sample.1.fxSend2": 0,
  "aether.granular.2.enabled": false,
  "aether.granular.2.builtinSource": "",
  "aether.granular.2.rootNote": 60,
  "aether.granular.2.level": 0.7,
  "aether.granular.2.route": "filter",
  "aether.granular.2.position": 0.5,
  "aether.granular.2.positionSpread": 0.1,
  "aether.granular.2.grainMilliseconds": 80,
  "aether.granular.2.densityHz": 12,
  "aether.granular.2.pitchSemitones": 0,
  "aether.granular.2.stereoSpread": 0.5,
  "aether.granular.2.randomSeed": 1,
  "aether.granular.2.fxSend1": 0,
  "aether.granular.2.fxSend2": 0,
  "aether.spectral.3.enabled": false,
  "aether.spectral.3.rootNote": 60,
  "aether.spectral.3.level": 0.7,
  "aether.spectral.3.pan": 0,
  "aether.spectral.3.stereoWidth": 1,
  "aether.spectral.3.position": 0,
  "aether.spectral.3.pitchSemitones": 0,
  "aether.spectral.3.freeze": false,
  "aether.spectral.3.route": "filter",
  "aether.spectral.3.fxSend1": 0,
  "aether.spectral.3.fxSend2": 0,
  "aether.fxBus1Id": "",
  "aether.fxBus2Id": "",
  "aether.mpe.enabled": false,
  "aether.mpe.masterChannel": 1,
  "aether.mpe.firstMemberChannel": 2,
  "aether.mpe.lastMemberChannel": 16,
  "amp.level": 0.8,
  "amp.pan": 0,
  maxVoices: 16,
  "mono.enabled": false,
  "legato.enabled": false,
  "glide.ms": 0,
  "env.1.attack": 0.005,
  "env.1.attackCurve": "linear",
  "env.1.decay": 0.15,
  "env.1.decayCurve": "linear",
  "env.1.sustain": 0.8,
  "env.1.release": 0.25,
  "env.1.releaseCurve": "linear",
  "env.1.loop": false,
  "env.2.attack": 0.01,
  "env.2.attackCurve": "linear",
  "env.2.decay": 0.3,
  "env.2.decayCurve": "linear",
  "env.2.sustain": 0,
  "env.2.release": 0.2,
  "env.2.releaseCurve": "linear",
  "env.2.loop": false,
  "env.3.attack": 0.01, "env.3.attackCurve": "linear", "env.3.decay": 0.3, "env.3.decayCurve": "linear",
  "env.3.sustain": 0, "env.3.release": 0.2, "env.3.releaseCurve": "linear", "env.3.loop": false,
  "env.4.attack": 0.01, "env.4.attackCurve": "linear", "env.4.decay": 0.3, "env.4.decayCurve": "linear",
  "env.4.sustain": 0, "env.4.release": 0.2, "env.4.releaseCurve": "linear", "env.4.loop": false,
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
  "macro.5": 0,
  "macro.6": 0,
  "macro.7": 0,
  "macro.8": 0,
};

export const SYNTH_PARAMETER_LABELS: Record<SynthParameterId, string> = {
  ...EXTRA_LFO_LABELS,
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
  "osc.a.fxSend1": "OSC A FX Send 1",
  "osc.a.fxSend2": "OSC A FX Send 2",
  "osc.a.unison.voices": "OSC A Voices",
  "osc.a.unison.detune": "OSC A Detune",
  "osc.a.unison.spread": "OSC A Spread",
  "osc.a.tuning.mode": "OSC A Tuning",
  "osc.a.tuning.harmonic": "OSC A Harmonic",
  "osc.a.tuning.numerator": "OSC A Ratio Num",
  "osc.a.tuning.denominator": "OSC A Ratio Den",
  "osc.a.tuning.step": "OSC A Step",
  "osc.a.tuning.divisions": "OSC A Divisions",
  "osc.a.phaseMode": "OSC A Phase Mode",
  "osc.a.route": "OSC A Route",
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
  "osc.b.fxSend1": "OSC B FX Send 1",
  "osc.b.fxSend2": "OSC B FX Send 2",
  "osc.b.unison.voices": "OSC B Voices",
  "osc.b.unison.detune": "OSC B Detune",
  "osc.b.unison.spread": "OSC B Spread",
  "osc.b.tuning.mode": "OSC B Tuning",
  "osc.b.tuning.harmonic": "OSC B Harmonic",
  "osc.b.tuning.numerator": "OSC B Ratio Num",
  "osc.b.tuning.denominator": "OSC B Ratio Den",
  "osc.b.tuning.step": "OSC B Step",
  "osc.b.tuning.divisions": "OSC B Divisions",
  "osc.b.phaseMode": "OSC B Phase Mode",
  "osc.b.route": "OSC B Route",
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
  "filter.2.enabled": "Filter 2 Enabled",
  "filter.2.type": "Filter 2 Type",
  "filter.2.cutoff": "Filter 2 Cutoff",
  "filter.2.resonance": "Filter 2 Res",
  "filter.2.drive": "Filter 2 Drive",
  "filter.routing": "Filter Routing",
  "aether.runtimeWarp": "Aether Runtime Warp",
  "aether.runtimeWarpMode": "Aether Runtime Warp Mode",
  "aether.runtimeWarp2": "Aether Runtime Warp 2",
  "aether.runtimeWarp2Mode": "Aether Runtime Warp 2 Mode",
  "aether.interaction.mode": "A/B Interaction",
  "aether.interaction.amount": "A/B Interaction Amount",
  "aether.noise.enabled": "Aether Noise Enabled",
  "aether.noise.level": "Aether Noise Level",
  "aether.noise.color": "Aether Noise Color",
  "aether.noise.route": "Aether Noise Route",
  "aether.sub.route": "Aether Sub Route",
  "aether.sub.fxSend1": "Aether Sub FX Send 1",
  "aether.sub.fxSend2": "Aether Sub FX Send 2",
  "aether.noise.fxSend1": "Aether Noise FX Send 1",
  "aether.noise.fxSend2": "Aether Noise FX Send 2",
  "aether.sample.1.enabled": "Sample Slot 1 Enabled",
  "aether.sample.1.audioFileId": "Sample Slot 1 Audio File",
  "aether.sample.1.rootNote": "Sample Slot 1 Root Note",
  "aether.sample.1.level": "Sample Slot 1 Level",
  "aether.sample.1.pan": "Sample Slot 1 Pan",
  "aether.sample.1.route": "Sample Slot 1 Route",
  "aether.sample.1.start": "Sample Slot 1 Start",
  "aether.sample.1.end": "Sample Slot 1 End",
  "aether.sample.1.loop.enabled": "Sample Slot 1 Loop",
  "aether.sample.1.loop.start": "Sample Slot 1 Loop Start",
  "aether.sample.1.loop.end": "Sample Slot 1 Loop End",
  "aether.sample.1.fxSend1": "Sample Slot 1 FX Send 1",
  "aether.sample.1.fxSend2": "Sample Slot 1 FX Send 2",
  "aether.granular.2.enabled": "Granular Slot 2 Enabled",
  "aether.granular.2.builtinSource": "Granular Slot 2 Built-in Source",
  "aether.granular.2.rootNote": "Granular Slot 2 Root Note",
  "aether.granular.2.level": "Granular Slot 2 Level",
  "aether.granular.2.route": "Granular Slot 2 Route",
  "aether.granular.2.position": "Granular Slot 2 Position",
  "aether.granular.2.positionSpread": "Granular Slot 2 Position Spread",
  "aether.granular.2.grainMilliseconds": "Granular Slot 2 Grain Size",
  "aether.granular.2.densityHz": "Granular Slot 2 Density",
  "aether.granular.2.pitchSemitones": "Granular Slot 2 Pitch",
  "aether.granular.2.stereoSpread": "Granular Slot 2 Stereo Spread",
  "aether.granular.2.randomSeed": "Granular Slot 2 Seed",
  "aether.granular.2.fxSend1": "Granular Slot 2 FX Send 1",
  "aether.granular.2.fxSend2": "Granular Slot 2 FX Send 2",
  "aether.spectral.3.enabled": "Spectral Slot 3 Enabled",
  "aether.spectral.3.rootNote": "Spectral Slot 3 Root Note",
  "aether.spectral.3.level": "Spectral Slot 3 Level",
  "aether.spectral.3.pan": "Spectral Slot 3 Pan",
  "aether.spectral.3.stereoWidth": "Spectral Slot 3 Stereo Width",
  "aether.spectral.3.position": "Spectral Slot 3 Position",
  "aether.spectral.3.pitchSemitones": "Spectral Slot 3 Pitch",
  "aether.spectral.3.freeze": "Spectral Slot 3 Freeze",
  "aether.spectral.3.route": "Spectral Slot 3 Route",
  "aether.spectral.3.fxSend1": "Spectral Slot 3 FX Send 1",
  "aether.spectral.3.fxSend2": "Spectral Slot 3 FX Send 2",
  "aether.fxBus1Id": "Aether FX Bus 1",
  "aether.fxBus2Id": "Aether FX Bus 2",
  "aether.mpe.enabled": "MPE Zone Enabled",
  "aether.mpe.masterChannel": "MPE Master Channel",
  "aether.mpe.firstMemberChannel": "MPE First Member Channel",
  "aether.mpe.lastMemberChannel": "MPE Last Member Channel",
  "amp.level": "Amp Level",
  "amp.pan": "Amp Pan",
  maxVoices: "Max Voices",
  "mono.enabled": "Mono",
  "legato.enabled": "Legato",
  "glide.ms": "Glide",
  "env.1.attack": "Env 1 Attack",
  "env.1.attackCurve": "Env 1 Attack Curve",
  "env.1.decay": "Env 1 Decay",
  "env.1.decayCurve": "Env 1 Decay Curve",
  "env.1.sustain": "Env 1 Sustain",
  "env.1.release": "Env 1 Release",
  "env.1.releaseCurve": "Env 1 Release Curve",
  "env.1.loop": "Env 1 Loop",
  "env.2.attack": "Env 2 Attack",
  "env.2.attackCurve": "Env 2 Attack Curve",
  "env.2.decay": "Env 2 Decay",
  "env.2.decayCurve": "Env 2 Decay Curve",
  "env.2.sustain": "Env 2 Sustain",
  "env.2.release": "Env 2 Release",
  "env.2.releaseCurve": "Env 2 Release Curve",
  "env.2.loop": "Env 2 Loop",
  "env.3.attack": "Env 3 Attack", "env.3.attackCurve": "Env 3 Attack Curve", "env.3.decay": "Env 3 Decay",
  "env.3.decayCurve": "Env 3 Decay Curve", "env.3.sustain": "Env 3 Sustain", "env.3.release": "Env 3 Release",
  "env.3.releaseCurve": "Env 3 Release Curve", "env.3.loop": "Env 3 Loop",
  "env.4.attack": "Env 4 Attack", "env.4.attackCurve": "Env 4 Attack Curve", "env.4.decay": "Env 4 Decay",
  "env.4.decayCurve": "Env 4 Decay Curve", "env.4.sustain": "Env 4 Sustain", "env.4.release": "Env 4 Release",
  "env.4.releaseCurve": "Env 4 Release Curve", "env.4.loop": "Env 4 Loop",
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
  "macro.5": "Macro 5",
  "macro.6": "Macro 6",
  "macro.7": "Macro 7",
  "macro.8": "Macro 8",
};

export const MODULATION_SOURCE_LABELS: Record<ModulationSourceId, string> = {
  "env.1": "Amp Env",
  "env.2": "Mod Env",
  "env.3": "Env 3",
  "env.4": "Env 4",
  "lfo.1": "LFO 1",
  "lfo.2": "LFO 2",
  "lfo.3": "LFO 3", "lfo.4": "LFO 4", "lfo.5": "LFO 5", "lfo.6": "LFO 6",
  "lfo.7": "LFO 7", "lfo.8": "LFO 8", "lfo.9": "LFO 9", "lfo.10": "LFO 10",
  velocity: "Velocity",
  keytrack: "Keytrack",
  modWheel: "Mod Wheel",
  pressure: "Pressure",
  timbre: "Timbre",
  "macro.1": "Macro 1",
  "macro.2": "Macro 2",
  "macro.3": "Macro 3",
  "macro.4": "Macro 4",
  "macro.5": "Macro 5",
  "macro.6": "Macro 6",
  "macro.7": "Macro 7",
  "macro.8": "Macro 8",
};

export const MODULATION_TARGET_LABELS: Record<ModulationTargetId, string> = {
  "osc.a.position": "OSC A Pos",
  "osc.a.warp": "OSC A Warp",
  "osc.a.fine": "OSC A Fine",
  "osc.a.level": "OSC A Level",
  "osc.a.pan": "OSC A Pan",
  "osc.b.position": "OSC B Pos",
  "osc.b.warp": "OSC B Warp",
  "osc.b.fine": "OSC B Fine",
  "osc.b.level": "OSC B Level",
  "osc.b.pan": "OSC B Pan",
  "osc.a.unison.detune": "OSC A Detune",
  "osc.a.unison.spread": "OSC A Spread",
  "osc.b.unison.detune": "OSC B Detune",
  "osc.b.unison.spread": "OSC B Spread",
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
    taxonomy: taxonomyAssignmentForInstrumentId("wavetable_synth"),
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
    effects: { filters: [] },
    metadata: {
      createdBy: "Beat",
      tags: [],
      icon: "ph:cube",
      macros: cloneDefaultMacros(),
      wavemaps: { [DEFAULT_CUSTOM_WAVETABLE_ID]: createDefaultCustomWavetable() },
      customWavetables: { [DEFAULT_CUSTOM_WAVETABLE_ID]: createDefaultCustomWavetable() },
      oscillators: [{ id: "a", name: "Oscillator A" }, { id: "b", name: "Oscillator B" }],
      sampleSlot1Zones: [],
      managedSfz: undefined,
      managedGranular: undefined,
      managedSpectral: undefined,
    },
  };
}

function parameterPatch(id: SynthParameterId, value: SynthParameterValue): Record<string, SynthParameterValue> {
  if (id === "unison.voices")
    return { [id]: value, "osc.a.unison.voices": value, "osc.b.unison.voices": value };
  if (id === "unison.detune")
    return { [id]: value, "osc.a.unison.detune": value, "osc.b.unison.detune": value };
  if (id === "unison.spread" || id === "unison.blend")
    return { [id]: value, "osc.a.unison.spread": value, "osc.b.unison.spread": value };
  return { [id]: value };
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
    const inheritUnison = (suffix: "voices" | "detune" | "spread", legacyValue: SynthParameterValue) => {
      for (const oscillator of ["a", "b"] as const) {
        const id = `osc.${oscillator}.unison.${suffix}` as OscillatorUnisonParameterId;
        if (!Object.prototype.hasOwnProperty.call(input.parameters, id))
          parameters[id] = legacyValue;
      }
    };
    inheritUnison("voices", parameters["unison.voices"]);
    inheritUnison("detune", parameters["unison.detune"]);
    inheritUnison("spread", parameters["unison.spread"]);
  }

  const mpeMaster = clampMidiChannel(Number(parameters["aether.mpe.masterChannel"]));
  const mpeFirst = clampMidiChannel(Number(parameters["aether.mpe.firstMemberChannel"]));
  const mpeLast = clampMidiChannel(Number(parameters["aether.mpe.lastMemberChannel"]));
  parameters["aether.mpe.masterChannel"] = mpeMaster;
  parameters["aether.mpe.firstMemberChannel"] = Math.min(mpeFirst, mpeLast);
  parameters["aether.mpe.lastMemberChannel"] = Math.max(mpeFirst, mpeLast);
  if (mpeMaster >= Math.min(mpeFirst, mpeLast) && mpeMaster <= Math.max(mpeFirst, mpeLast))
    parameters["aether.mpe.enabled"] = false;

  const modulation = Array.isArray(input.modulation)
    ? input.modulation
        .map(normalizeModulationRoute)
        .filter((route): route is SynthModulationRoute => route !== null)
    : base.modulation;
  const effects = normalizeTrackEffectChain(input.effects);
  const inputMetadata: Record<string, unknown> = isRecord(input.metadata) ? input.metadata : {};
  const wavemaps = normalizeWavemapMetadata(inputMetadata.wavemaps, inputMetadata.customWavetables);
  const inputTaxonomy = isRecord(input.taxonomy) ? taxonomyAssignmentForInstrumentId(String(input.taxonomy.instrumentId ?? "")) : undefined;

  return {
    schemaVersion: SYNTH_PATCH_SCHEMA_VERSION,
    instrumentType: SYNTH_INSTRUMENT_TYPE,
    namespace: SYNTH_PARAMETER_NAMESPACE,
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : base.name,
    taxonomy: inputTaxonomy ?? base.taxonomy,
    parameters,
    modulation: dedupeModulationRouteIds(modulation),
    effects,
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
      oscillators: normalizeOscillatorDefinitions(inputMetadata.oscillators),
      sampleSlot1Zones: normalizeAetherSampleZones(inputMetadata.sampleSlot1Zones),
      managedSfz: normalizeManagedSfz(inputMetadata.managedSfz),
      managedGranular: normalizeManagedGranular(inputMetadata.managedGranular),
      managedSpectral: normalizeManagedSpectral(inputMetadata.managedSpectral),
    },
  };
}

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

export interface SynthMacroLaneState {
  id: MacroId;
  label: string;
  rawValue: number;
  outputValue: number;
  rangeStart: number;
  rangeEnd: number;
  curve: MacroCurve;
  assignmentCount: number;
  targetLabels: string[];
}

export function macroLaneStateForId(draft: SynthDraftPatch, id: MacroId): SynthMacroLaneState {
  const definition = macroDefinitionForId(draft, id);
  const assignments = macroAssignmentsForId(draft, id);
  const rawValue = clamp01(getNumberParam(draft, id));
  return {
    id,
    label: definition.label,
    rawValue,
    outputValue: macroOutputValue(draft, id),
    rangeStart: definition.min,
    rangeEnd: definition.max,
    curve: definition.curve,
    assignmentCount: assignments.length,
    targetLabels: assignments.map((route) => MODULATION_TARGET_LABELS[route.target] ?? route.target),
  };
}

export interface SynthMacroConflictSummary {
  count: number;
  label: string;
}

export type SynthMacroAtAGlanceTone = "idle" | "active" | "conflict";

export interface SynthMacroAtAGlanceState {
  id: MacroId;
  tone: SynthMacroAtAGlanceTone;
  assignmentCount: number;
  conflictCount: number;
  assignmentBadge: string;
  conflictBadge: string;
  outputBadge: string;
  rangeBadge: string;
  targetBadge: string;
  detail: string;
}

export interface SynthMacroConflictDetail {
  target: ModulationTargetId;
  targetLabel: string;
  competingSources: string[];
  behavior: "summed";
  label: string;
}

export function macroConflictDetailsForId(draft: SynthDraftPatch, id: MacroId): SynthMacroConflictDetail[] {
  const assignments = macroAssignmentsForId(draft, id);
  if (assignments.length === 0) return [];
  const conflicts = new Map<ModulationTargetId, Set<string>>();
  for (const route of assignments) {
    const competingSources = draft.modulation
      .filter((candidate) => candidate.enabled && candidate.target === route.target && candidate.source !== id)
      .map((candidate) => modulationSourceLabel(draft, candidate.source));
    if (competingSources.length === 0) continue;
    const sources = conflicts.get(route.target) ?? new Set<string>();
    competingSources.forEach((source) => sources.add(source));
    conflicts.set(route.target, sources);
  }
  return Array.from(conflicts.entries()).map(([target, sources]) => {
    const sourceLabels = Array.from(sources);
    const visibleSources = sourceLabels.slice(0, 2).join(", ");
    const suffix = sourceLabels.length > 2 ? ` +${sourceLabels.length - 2}` : "";
    const targetLabel = MODULATION_TARGET_LABELS[target] ?? target;
    return {
      target,
      targetLabel,
      competingSources: sourceLabels,
      behavior: "summed" as const,
      label: `${targetLabel} with ${visibleSources}${suffix}`,
    };
  });
}

export function macroConflictSummaryForId(draft: SynthDraftPatch, id: MacroId): SynthMacroConflictSummary {
  const details = macroConflictDetailsForId(draft, id);
  if (details.length === 0) return { count: 0, label: "" };
  const visibleSummaries = details.slice(0, 2).map((detail) => detail.label).join("; ");
  const suffix = details.length > 2 ? ` +${details.length - 2}` : "";
  return {
    count: details.length,
    label: `${visibleSummaries}${suffix}`,
  };
}

export function macroAtAGlanceStateForId(draft: SynthDraftPatch, id: MacroId): SynthMacroAtAGlanceState {
  const lane = macroLaneStateForId(draft, id);
  const conflict = macroConflictSummaryForId(draft, id);
  const tone: SynthMacroAtAGlanceTone = conflict.count > 0 ? "conflict" : lane.assignmentCount > 0 ? "active" : "idle";
  const visibleTargets = lane.targetLabels.slice(0, 2).join(", ");
  const targetSuffix = lane.targetLabels.length > 2 ? ` +${lane.targetLabels.length - 2}` : "";
  const assignmentBadge = lane.assignmentCount === 0
    ? "0 routes"
    : `${lane.assignmentCount} route${lane.assignmentCount === 1 ? "" : "s"}`;
  const conflictBadge = conflict.count === 0
    ? "No conflicts"
    : `Conflict ${conflict.count}`;
  const outputBadge = `Out ${Math.round(lane.outputValue * 100)}%`;
  const rangeBadge = `${Math.round(lane.rangeStart * 100)}-${Math.round(lane.rangeEnd * 100)}%`;
  const targetBadge = visibleTargets ? `${visibleTargets}${targetSuffix}` : "No targets";
  return {
    id,
    tone,
    assignmentCount: lane.assignmentCount,
    conflictCount: conflict.count,
    assignmentBadge,
    conflictBadge,
    outputBadge,
    rangeBadge,
    targetBadge,
    detail: conflict.count > 0
      ? conflict.label
      : lane.assignmentCount > 0
        ? targetBadge
        : "No active macro routes",
  };
}

export function modulationSourceLabel(draft: SynthDraftPatch, source: ModulationSourceId): string {
  return isMacroSource(source)
    ? macroDefinitionForId(draft, source).label
    : MODULATION_SOURCE_LABELS[source] ?? source;
}

export function modulationSummaryForTarget(draft: SynthDraftPatch, target: ModulationTargetId): SynthModulationSummary {
  const routes = draft.modulation.filter((route) => route.enabled && route.target === target);
  return summarizeModulationRoutes(
    routes,
    (route) => modulationSourceLabel(draft, route.source),
    (route) => modulationDisplayAmountForRoute(draft, route),
  );
}

export function modulationSummaryForSource(draft: SynthDraftPatch, source: ModulationSourceId): SynthModulationSummary {
  const routes = draft.modulation.filter((route) => route.enabled && route.source === source);
  return summarizeModulationRoutes(
    routes,
    (route) => MODULATION_TARGET_LABELS[route.target] ?? route.target,
    (route) => modulationDisplayAmountForRoute(draft, route),
  );
}

export function modulationRouteDisplay(draft: SynthDraftPatch, route: SynthModulationRoute): SynthModulationRouteDisplay {
  return {
    sourceLabel: modulationSourceLabel(draft, route.source),
    targetLabel: MODULATION_TARGET_LABELS[route.target] ?? route.target,
    amountLabel: formatSignedModAmount(route.amount),
    rangeLabel: formatRouteTargetRange(route.target, route.amount),
    stateLabel: route.enabled ? "Active" : "Off",
  };
}

export function modulationSourceAffordance(draft: SynthDraftPatch, source: ModulationSourceId): SynthModulationSourceAffordance {
  if (/^lfo\.(?:[1-9]|10)$/.test(source)) {
    const enabled = getBooleanParam(draft, `${source}.enabled` as SynthParameterId);
    const shape = getStringParam(draft, `${source}.shape` as SynthParameterId) || "sine";
    const sync = getBooleanParam(draft, `${source}.sync` as SynthParameterId);
    const rate = sync
      ? getStringParam(draft, `${source}.syncedRate` as SynthParameterId) || "1/4"
      : `${formatDecimal(getNumberParam(draft, `${source}.rate` as SynthParameterId), 2)} Hz`;
    return {
      source,
      label: source === "lfo.1" ? "LFO 1" : "LFO 2",
      detail: `${enabled ? "On" : "Off"} · ${shape} · ${rate}`,
      editor: "lfo",
    };
  }

  if (source === "env.1" || source === "env.2" || source === "env.3" || source === "env.4") {
    const loop = getBooleanParam(draft, `${source}.loop` as SynthParameterId);
    const attackCurve = getEnvelopeCurveParam(draft, `${source}.attackCurve` as SynthParameterId);
    const releaseCurve = getEnvelopeCurveParam(draft, `${source}.releaseCurve` as SynthParameterId);
    return {
      source,
      label: source === "env.1" ? "Amp Env" : "Mod Env",
      detail: `${loop ? "Loop" : "One-shot"} · A ${attackCurve} · R ${releaseCurve}`,
      editor: "envelope",
    };
  }

  if (source.startsWith("macro.")) {
    const id = source as MacroId;
    const definition = macroDefinitionForId(draft, id);
    const macroNumber = id.split(".")[1] ?? "";
    return {
      source,
      label: `${definition.label} / M${macroNumber}`,
      detail: `${Math.round(definition.min * 100)}-${Math.round(definition.max * 100)}% · ${definition.curve}`,
      editor: "macro",
    };
  }

  if (source === "velocity") {
    return { source, label: "Performance source", detail: "Per-note velocity", editor: "performance" };
  }
  if (source === "keytrack") {
    return { source, label: "Performance source", detail: "MIDI note position", editor: "performance" };
  }
  if (source === "pressure") {
    return { source, label: "Performance source", detail: "Poly or channel pressure", editor: "performance" };
  }
  if (source === "timbre") {
    return { source, label: "Performance source", detail: "MIDI CC74 timbre", editor: "performance" };
  }
  return { source, label: "Performance source", detail: "Mod wheel CC1", editor: "performance" };
}

export function modulationSourceEditorTarget(source: ModulationSourceId): SynthModulationSourceEditorTarget {
  if (source === "velocity" || source === "keytrack" || source === "modWheel" || source === "pressure" || source === "timbre") return "performance";
  return source;
}

export function synthEnvelopeEditorSummary(draft: SynthDraftPatch, source: "env.1" | "env.2" | "env.3" | "env.4"): SynthEnvelopeEditorSummary {
  const attack = getNumberParam(draft, `${source}.attack` as SynthParameterId);
  const decay = getNumberParam(draft, `${source}.decay` as SynthParameterId);
  const sustain = clamp01(getNumberParam(draft, `${source}.sustain` as SynthParameterId));
  const release = getNumberParam(draft, `${source}.release` as SynthParameterId);
  const attackCurve = getEnvelopeCurveParam(draft, `${source}.attackCurve` as SynthParameterId);
  const decayCurve = getEnvelopeCurveParam(draft, `${source}.decayCurve` as SynthParameterId);
  const releaseCurve = getEnvelopeCurveParam(draft, `${source}.releaseCurve` as SynthParameterId);
  const loop = getBooleanParam(draft, `${source}.loop` as SynthParameterId);
  const assignment = modulationSummaryForSource(draft, source);
  const weights = normalizeEnvelopePhaseWeights(attack, decay, release);
  const attackX = weights.attack * 100;
  const decayX = (weights.attack + weights.decay) * 100;
  const holdX = (weights.attack + weights.decay + weights.hold) * 100;
  const sustainY = (1 - sustain) * 100;

  return {
    source,
    label: source === "env.1" ? "Amp Env" : "Mod Env",
    mode: loop ? "Loop" : "One-shot",
    timingLabel: `A ${formatEnvelopeTime(attack)} / D ${formatEnvelopeTime(decay)} / R ${formatEnvelopeTime(release)}`,
    sustainLabel: `S ${Math.round(sustain * 100)}%`,
    curveLabel: `A ${attackCurve} / D ${decayCurve} / R ${releaseCurve}`,
    assignmentLabel: assignment.count > 0 ? assignment.label : source === "env.1" ? "Amp envelope" : "No routes",
    assignmentCount: assignment.count,
    points: [
      { x: 0, y: 100 },
      { x: Math.round(attackX), y: 0 },
      { x: Math.round(decayX), y: Math.round(sustainY) },
      { x: Math.round(holdX), y: Math.round(sustainY) },
      { x: 100, y: 100 },
    ],
  };
}

export function synthExpressionSummary(draft: SynthDraftPatch, activity?: SynthExpressionActivity | null): SynthExpressionSummaryItem[] {
  const maxVoices = Math.max(1, Math.round(getNumberParam(draft, "maxVoices")));
  const mono = getBooleanParam(draft, "mono.enabled");
  const legato = getBooleanParam(draft, "legato.enabled");
  const glideMs = Math.round(getNumberParam(draft, "glide.ms"));
  const velocity = modulationSummaryForSource(draft, "velocity");
  const keytrack = modulationSummaryForSource(draft, "keytrack");
  const modWheel = modulationSummaryForSource(draft, "modWheel");
  const pressure = modulationSummaryForSource(draft, "pressure");
  const timbre = modulationSummaryForSource(draft, "timbre");
  const filterKeytrack = clamp01(getNumberParam(draft, "filter.keytrack"));
  const liveSource = activity ? expressionActivitySourceLabel(activity.source) : "";
  const liveVelocity = activity?.velocity != null ? clamp01(activity.velocity) : null;
  const liveKeytrack = activity?.keytrack != null ? clamp01(activity.keytrack) : null;
  const liveModWheel = activity?.modWheel != null ? clamp01(activity.modWheel) : null;
  const livePressure = activity?.pressure != null ? clamp01(activity.pressure) : null;
  const liveTimbre = activity?.timbre != null ? clamp01(activity.timbre) : null;
  const livePitchBend = activity?.pitchBendSemitones != null && Number.isFinite(activity.pitchBendSemitones)
    ? activity.pitchBendSemitones
    : null;
  const activeNotes = activity?.activeNotes != null ? Math.max(0, Math.round(activity.activeNotes)) : 0;

  return [
    {
      id: "voices",
      label: "Voices",
      value: activeNotes > 0 ? `${activeNotes} live` : mono ? "Mono" : `${maxVoices} poly`,
      detail: activeNotes > 0 ? liveSource : mono ? "Single active voice" : `Steals above ${maxVoices}`,
      active: activeNotes > 0 || mono || maxVoices < 16,
      ...(activeNotes > 0 ? { live: true } : {}),
    },
    {
      id: "legato",
      label: "Legato",
      value: legato ? "On" : "Off",
      detail: legato ? `Retunes held voice${glideMs > 0 ? ` over ${glideMs} ms` : ""}` : "Retriggers notes",
      active: legato || glideMs > 0,
    },
    {
      id: "pitch-bend",
      label: "Pitch Bend",
      value: livePitchBend == null ? "+/-2 st" : `${formatSignedAmount(livePitchBend)} st`,
      detail: livePitchBend == null ? "Runtime MIDI bend" : liveSource,
      active: true,
      ...(livePitchBend != null ? { live: true } : {}),
    },
    {
      id: "velocity",
      label: "Velocity",
      value: liveVelocity == null ? velocity.count > 0 ? velocity.label : "Available" : `${Math.round(liveVelocity * 100)}%`,
      detail: liveVelocity == null ? velocity.count > 0 ? `${velocity.count} routed` : "No routes" : velocity.count > 0 ? `${velocity.count} routed live` : liveSource,
      active: liveVelocity != null || velocity.count > 0,
      ...(liveVelocity != null ? { live: true } : {}),
    },
    {
      id: "keytrack",
      label: "Keytrack",
      value: liveKeytrack == null ? keytrack.count > 0 ? keytrack.label : `${Math.round(filterKeytrack * 100)}% filter` : `${Math.round(liveKeytrack * 100)}%`,
      detail: liveKeytrack == null ? keytrack.count > 0 ? `${keytrack.count} routed` : "Filter cutoff tracking" : keytrack.count > 0 ? `${keytrack.count} routed live` : liveSource,
      active: liveKeytrack != null || keytrack.count > 0 || filterKeytrack > 0,
      ...(liveKeytrack != null ? { live: true } : {}),
    },
    {
      id: "mod-wheel",
      label: "Mod Wheel",
      value: liveModWheel == null ? modWheel.count > 0 ? modWheel.label : "Available" : `${Math.round(liveModWheel * 100)}%`,
      detail: liveModWheel == null ? modWheel.count > 0 ? `${modWheel.count} routed` : "No routes" : modWheel.count > 0 ? `${modWheel.count} routed live` : liveSource,
      active: liveModWheel != null || modWheel.count > 0,
      ...(liveModWheel != null ? { live: true } : {}),
    },
    {
      id: "pressure",
      label: "Pressure",
      value: livePressure == null ? pressure.count > 0 ? pressure.label : "Available" : `${Math.round(livePressure * 100)}%`,
      detail: livePressure == null ? pressure.count > 0 ? `${pressure.count} routed` : "No routes" : pressure.count > 0 ? `${pressure.count} routed live` : liveSource,
      active: livePressure != null || pressure.count > 0,
      ...(livePressure != null ? { live: true } : {}),
    },
    {
      id: "timbre",
      label: "Timbre",
      value: liveTimbre == null ? timbre.count > 0 ? timbre.label : "Available" : `${Math.round(liveTimbre * 100)}%`,
      detail: liveTimbre == null ? timbre.count > 0 ? `${timbre.count} routed` : "CC74" : timbre.count > 0 ? `${timbre.count} routed live` : liveSource,
      active: liveTimbre != null || timbre.count > 0,
      ...(liveTimbre != null ? { live: true } : {}),
    },
  ];
}

function expressionActivitySourceLabel(source: SynthExpressionActivity["source"]): string {
  if (source === "midi") return "Live MIDI input";
  if (source === "playback") return "Timeline playback";
  return "Audition preview";
}

function formatSignedAmount(value: number): string {
  const fixed = Math.abs(value) >= 1 ? value.toFixed(1) : value.toFixed(2);
  return value > 0 ? `+${fixed}` : fixed;
}

export function synthDraftToInstrumentPatch(draft: SynthDraftPatch): Partial<Instrument> {
  const wavetable = wavetableFromDraft(draft, "a");
  const oscA = oscillatorFromDraft(draft, "a", wavetable);
  const oscB = oscillatorFromDraft(draft, "b", wavetableFromDraft(draft, "b"));
  const filterEnabled = getBooleanParam(draft, "filter.enabled");
  const lfoEnabled = getBooleanParam(draft, "lfo.1.enabled");
  const cutoff01 = filterEnabled ? clamp01(hzToNormalizedCutoff(getNumberParam(draft, "filter.cutoff"))) : 1;

  return {
    name: draft.name,
    kind: "wavetable",
    waveform: "wavetable",
    icon: draft.metadata.icon ?? "ph:cube",
    knobs: {
      cutoff: cutoff01,
      resonance: filterEnabled ? clamp01(getNumberParam(draft, "filter.resonance")) : 0,
      drive: clamp01(getNumberParam(draft, "filter.drive")),
      color: clamp01(getNumberParam(draft, "osc.a.position")),
    },
    filterType: filterTypeFromDraft(draft),
    filter2: {
      enabled: getBooleanParam(draft, "filter.2.enabled"),
      type: filterTypeFromId(getStringParam(draft, "filter.2.type")),
      cutoff: clamp01(hzToNormalizedCutoff(getNumberParam(draft, "filter.2.cutoff"))),
      resonance: clamp01(getNumberParam(draft, "filter.2.resonance")),
      drive: clamp01(getNumberParam(draft, "filter.2.drive")),
    },
    filterRouting: getStringParam(draft, "filter.routing") === "parallel" ? "parallel" : "serial",
    filterKeytrack: getNumberParam(draft, "filter.keytrack"),
    envelope: {
      attackMs: getNumberParam(draft, "env.1.attack") * 1000,
      attackCurve: getEnvelopeCurveParam(draft, "env.1.attackCurve"),
      decayMs: getNumberParam(draft, "env.1.decay") * 1000,
      decayCurve: getEnvelopeCurveParam(draft, "env.1.decayCurve"),
      sustain: getNumberParam(draft, "env.1.sustain"),
      releaseMs: getNumberParam(draft, "env.1.release") * 1000,
      releaseCurve: getEnvelopeCurveParam(draft, "env.1.releaseCurve"),
      loop: getBooleanParam(draft, "env.1.loop"),
    },
    wavetable,
    aether: {
      oscA,
      oscB,
      oscillators: draft.metadata.oscillators.map(({ id, name }) => ({
        id,
        name,
        ...oscillatorFromDraft(draft, id, wavetableFromDraft(draft, id)),
      })),
      sub: {
        enabled: false,
        level: 0,
        octave: -1,
        waveform: "sine",
        route: sourceRouteFromId(getStringParam(draft, "aether.sub.route")),
        fxSends: [clamp01(getNumberParam(draft, "aether.sub.fxSend1")), clamp01(getNumberParam(draft, "aether.sub.fxSend2"))],
      },
      noise: {
        enabled: getBooleanParam(draft, "aether.noise.enabled"),
        level: clamp01(getNumberParam(draft, "aether.noise.level")),
        color: clamp01(getNumberParam(draft, "aether.noise.color")),
        route: sourceRouteFromId(getStringParam(draft, "aether.noise.route")),
        fxSends: [clamp01(getNumberParam(draft, "aether.noise.fxSend1")), clamp01(getNumberParam(draft, "aether.noise.fxSend2"))],
      },
      sampleSlot1: {
        schemaVersion: 5,
        enabled: getBooleanParam(draft, "aether.sample.1.enabled")
          && (Boolean(getStringParam(draft, "aether.sample.1.audioFileId"))
            || draft.metadata.sampleSlot1Zones.length > 0
            || Boolean(draft.metadata.managedSfz?.manifestPath)),
        audioFileId: getStringParam(draft, "aether.sample.1.audioFileId"),
        rootNote: Math.max(0, Math.min(127, Math.round(getNumberParam(draft, "aether.sample.1.rootNote")))),
        level: clamp01(getNumberParam(draft, "aether.sample.1.level")),
        pan: clampBipolar(getNumberParam(draft, "aether.sample.1.pan")),
        route: sourceRouteFromId(getStringParam(draft, "aether.sample.1.route")),
        startRatio: clamp01(getNumberParam(draft, "aether.sample.1.start")),
        endRatio: clamp01(getNumberParam(draft, "aether.sample.1.end")),
        loopEnabled: getBooleanParam(draft, "aether.sample.1.loop.enabled"),
        loopStartRatio: clamp01(getNumberParam(draft, "aether.sample.1.loop.start")),
        loopEndRatio: clamp01(getNumberParam(draft, "aether.sample.1.loop.end")),
        fxSends: [clamp01(getNumberParam(draft, "aether.sample.1.fxSend1")), clamp01(getNumberParam(draft, "aether.sample.1.fxSend2"))],
        zones: draft.metadata.sampleSlot1Zones,
        ...(draft.metadata.managedSfz ? { managedSfz: draft.metadata.managedSfz } : {}),
      },
      granularSlot2: {
        schemaVersion: 1,
        enabled: getBooleanParam(draft, "aether.granular.2.enabled")
          && (getStringParam(draft, "aether.granular.2.builtinSource") === "benchmark"
            || Boolean(draft.metadata.managedGranular?.manifestPath)),
        ...(getStringParam(draft, "aether.granular.2.builtinSource") === "benchmark" ? { builtinSource: "benchmark" as const } : {}),
        rootNote: Math.max(0, Math.min(127, Math.round(getNumberParam(draft, "aether.granular.2.rootNote")))),
        level: clamp01(getNumberParam(draft, "aether.granular.2.level")),
        route: sourceRouteFromId(getStringParam(draft, "aether.granular.2.route")),
        position: clamp01(getNumberParam(draft, "aether.granular.2.position")),
        positionSpread: clamp01(getNumberParam(draft, "aether.granular.2.positionSpread")),
        grainMilliseconds: Math.max(2, Math.min(1000, getNumberParam(draft, "aether.granular.2.grainMilliseconds"))),
        densityHz: Math.max(0.1, Math.min(200, getNumberParam(draft, "aether.granular.2.densityHz"))),
        pitchSemitones: Math.max(-48, Math.min(48, getNumberParam(draft, "aether.granular.2.pitchSemitones"))),
        stereoSpread: clamp01(getNumberParam(draft, "aether.granular.2.stereoSpread")),
        randomSeed: Math.max(1, Math.min(0xffffffff, Math.round(getNumberParam(draft, "aether.granular.2.randomSeed")))),
        fxSends: [clamp01(getNumberParam(draft, "aether.granular.2.fxSend1")), clamp01(getNumberParam(draft, "aether.granular.2.fxSend2"))],
        ...(draft.metadata.managedGranular ? { managedAsset: draft.metadata.managedGranular } : {}),
      },
      spectralSlot3: {
        schemaVersion: 1,
        enabled: getBooleanParam(draft, "aether.spectral.3.enabled")
          && Boolean(draft.metadata.managedSpectral?.manifestPath),
        rootNote: Math.max(0, Math.min(127, Math.round(getNumberParam(draft, "aether.spectral.3.rootNote")))),
        level: clamp01(getNumberParam(draft, "aether.spectral.3.level")),
        pan: clampBipolar(getNumberParam(draft, "aether.spectral.3.pan")),
        stereoWidth: Math.max(0, Math.min(2, getNumberParam(draft, "aether.spectral.3.stereoWidth"))),
        position: clamp01(getNumberParam(draft, "aether.spectral.3.position")),
        pitchSemitones: Math.max(-12, Math.min(12, getNumberParam(draft, "aether.spectral.3.pitchSemitones"))),
        freeze: getBooleanParam(draft, "aether.spectral.3.freeze"),
        route: sourceRouteFromId(getStringParam(draft, "aether.spectral.3.route")),
        fxSends: [clamp01(getNumberParam(draft, "aether.spectral.3.fxSend1")), clamp01(getNumberParam(draft, "aether.spectral.3.fxSend2"))],
        ...(draft.metadata.managedSpectral ? { managedAsset: draft.metadata.managedSpectral } : {}),
      },
      fxBusIds: [getStringParam(draft, "aether.fxBus1Id"), getStringParam(draft, "aether.fxBus2Id")],
      runtimeWarp: clamp01(getNumberParam(draft, "aether.runtimeWarp")),
      runtimeWarpMode: isWavetableWarpMode(draft.parameters["aether.runtimeWarpMode"])
        ? draft.parameters["aether.runtimeWarpMode"]
        : "shape",
      runtimeWarp2: clamp01(getNumberParam(draft, "aether.runtimeWarp2")),
      runtimeWarp2Mode: isWavetableWarpMode(draft.parameters["aether.runtimeWarp2Mode"])
        ? draft.parameters["aether.runtimeWarp2Mode"]
        : "shape",
      interactionMode: draft.parameters["aether.interaction.mode"] === "am" || draft.parameters["aether.interaction.mode"] === "ring"
        ? draft.parameters["aether.interaction.mode"]
        : "off",
      interactionAmount: clamp01(getNumberParam(draft, "aether.interaction.amount")),
      memberExpressionZone: {
        schemaVersion: 1,
        enabled: getBooleanParam(draft, "aether.mpe.enabled"),
        masterChannel: clampMidiChannel(getNumberParam(draft, "aether.mpe.masterChannel")),
        firstMemberChannel: clampMidiChannel(getNumberParam(draft, "aether.mpe.firstMemberChannel")),
        lastMemberChannel: clampMidiChannel(getNumberParam(draft, "aether.mpe.lastMemberChannel")),
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
    ampLevel: clamp01(getNumberParam(draft, "amp.level")),
    ampPan: clampBipolar(getNumberParam(draft, "amp.pan")),
    maxVoices: getNumberParam(draft, "maxVoices"),
    mono: getBooleanParam(draft, "mono.enabled"),
    legato: getBooleanParam(draft, "legato.enabled"),
    glideMs: getNumberParam(draft, "glide.ms"),
    effects: structuredClone(draft.effects),
    sampleIds: [...new Set([
      getStringParam(draft, "aether.sample.1.audioFileId"),
      ...draft.metadata.sampleSlot1Zones.map((zone) => zone.audioFileId),
    ].filter(Boolean))],
    taxonomy: draft.taxonomy,
    synthPatch: cloneSynthPatch(draft),
  };
}

function summarizeModulationRoutes(
  routes: SynthModulationRoute[],
  labelForRoute: (route: SynthModulationRoute) => string,
  amountForRoute: (route: SynthModulationRoute) => number = (route) => route.amount,
): SynthModulationSummary {
  const amount = roundSummaryAmount(clampBipolar(routes.reduce((sum, route) => sum + amountForRoute(route), 0)));
  if (routes.length === 0) return { count: 0, amount: 0, label: "" };
  if (routes.length === 1) {
    const routeAmount = amountForRoute(routes[0]);
    return {
      count: 1,
      amount,
      label: `${labelForRoute(routes[0])} ${formatSignedModAmount(routeAmount)}`,
    };
  }
  return {
    count: routes.length,
    amount,
    label: `${routes.length} routes ${formatSignedModAmount(amount)}`,
  };
}

function roundSummaryAmount(amount: number): number {
  return Math.round(amount * 1_000_000) / 1_000_000;
}

function modulationDisplayAmountForRoute(draft: SynthDraftPatch, route: SynthModulationRoute): number {
  return isMacroSource(route.source)
    ? macroOutputValue(draft, route.source) * route.amount
    : route.amount;
}

function formatSignedModAmount(amount: number): string {
  const clamped = clampBipolar(amount);
  const sign = clamped >= 0 ? "+" : "";
  return `${sign}${Math.round(clamped * 100)}`;
}

function formatDecimal(value: number, decimals: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toFixed(decimals).replace(/\.?0+$/, "");
}

function formatEnvelopeTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  if (safe < 1) return `${Math.round(safe * 1000)}ms`;
  return `${formatDecimal(safe, 2)}s`;
}

function normalizeEnvelopePhaseWeights(attack: number, decay: number, release: number): { attack: number; decay: number; hold: number; release: number } {
  const safeAttack = Math.max(0.03, Number.isFinite(attack) ? attack : 0);
  const safeDecay = Math.max(0.03, Number.isFinite(decay) ? decay : 0);
  const safeRelease = Math.max(0.03, Number.isFinite(release) ? release : 0);
  const hold = 0.22;
  const total = safeAttack + safeDecay + hold + safeRelease;
  return {
    attack: safeAttack / total,
    decay: safeDecay / total,
    hold: hold / total,
    release: safeRelease / total,
  };
}

function formatRouteTargetRange(target: ModulationTargetId, amount: number): string {
  const clamped = clampBipolar(amount);
  const sign = clamped >= 0 ? "+" : "";
  if (target.endsWith(".fine") || target === "unison.detune") {
    return `${sign}${Math.round(clamped * 100)} ct`;
  }
  if (target === "filter.cutoff") {
    return `${sign}${Math.round(clamped * 35)}% cutoff`;
  }
  if (target.endsWith(".pan") || target === "unison.spread") {
    return `${sign}${Math.round(clamped * 100)}%`;
  }
  return `${sign}${Math.round(clamped * 100)}%`;
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
    glideMs: getNumberParam(draft, "glide.ms"),
    maxVoices: getNumberParam(draft, "maxVoices"),
    mono: getBooleanParam(draft, "mono.enabled"),
    legato: getBooleanParam(draft, "legato.enabled"),
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
  const runtimeAether: unknown = instrument.aether;
  if (isRecord(runtimeAether)) {
    const sampleSlot: unknown = runtimeAether.sampleSlot1;
    if (sampleSlot !== undefined) {
      if (!isRecord(sampleSlot))
        hybridMigrationFailure("aether.sample-slot-1.shape", "instrument.aether.sampleSlot1", "Expected an object.");
      if (typeof sampleSlot.schemaVersion !== "number" || !Number.isInteger(sampleSlot.schemaVersion) || sampleSlot.schemaVersion < 0)
        hybridMigrationFailure("aether.sample-slot-1.schema-invalid", "instrument.aether.sampleSlot1.schemaVersion", "Expected a non-negative integer.");
      if (sampleSlot.schemaVersion > 5)
        hybridMigrationFailure("aether.sample-slot-1.schema-future", "instrument.aether.sampleSlot1.schemaVersion", "Version is newer than supported version 5.");
    }
    const granularSlot: unknown = runtimeAether.granularSlot2;
    if (granularSlot !== undefined) {
      if (!isRecord(granularSlot))
        hybridMigrationFailure("aether.granular-slot-2.shape", "instrument.aether.granularSlot2", "Expected an object.");
      if (typeof granularSlot.schemaVersion !== "number" || !Number.isInteger(granularSlot.schemaVersion) || granularSlot.schemaVersion < 0)
        hybridMigrationFailure("aether.granular-slot-2.schema-invalid", "instrument.aether.granularSlot2.schemaVersion", "Expected a non-negative integer.");
      if (granularSlot.schemaVersion > 1)
        hybridMigrationFailure("aether.granular-slot-2.schema-future", "instrument.aether.granularSlot2.schemaVersion", "Version is newer than supported version 1.");
    }
    const spectralSlot: unknown = runtimeAether.spectralSlot3;
    if (spectralSlot !== undefined) {
      if (!isRecord(spectralSlot))
        hybridMigrationFailure("aether.spectral-slot-3.shape", "instrument.aether.spectralSlot3", "Expected an object.");
      if (typeof spectralSlot.schemaVersion !== "number" || !Number.isInteger(spectralSlot.schemaVersion) || spectralSlot.schemaVersion < 0)
        hybridMigrationFailure("aether.spectral-slot-3.schema-invalid", "instrument.aether.spectralSlot3.schemaVersion", "Expected a non-negative integer.");
      if (spectralSlot.schemaVersion > 1)
        hybridMigrationFailure("aether.spectral-slot-3.schema-future", "instrument.aether.spectralSlot3.schemaVersion", "Version is newer than supported version 1.");
    }
  }

  if (instrument.synthPatch) {
    const draft = normalizeSynthDraftPatch(instrument.synthPatch as SynthDraftPatch);
    if (instrument.icon) draft.metadata.icon = instrument.icon;
    draft.taxonomy = instrument.taxonomy ?? draft.taxonomy;
    draft.effects = normalizeTrackEffectChain(instrument.effects ?? draft.effects);
    return draft;
  }

  const draft = createDefaultSynthDraft();
  draft.name = instrument.name;
  draft.taxonomy = instrument.taxonomy ?? draft.taxonomy;
  draft.metadata.icon = instrument.icon ?? draft.metadata.icon;
  draft.effects = normalizeTrackEffectChain(instrument.effects);
  draft.parameters["filter.cutoff"] = normalizedCutoffToHz(instrument.knobs.cutoff);
  draft.parameters["filter.keytrack"] = instrument.filterKeytrack ?? 0;
  draft.parameters["filter.resonance"] = instrument.knobs.resonance;
  draft.parameters["filter.drive"] = instrument.knobs.drive;
  draft.parameters["filter.type"] = instrument.filterType ?? "lowpass";
  draft.parameters["filter.2.enabled"] = instrument.filter2?.enabled ?? false;
  draft.parameters["filter.2.type"] = instrument.filter2?.type ?? "lowpass";
  draft.parameters["filter.2.cutoff"] = normalizedCutoffToHz(instrument.filter2?.cutoff ?? 1);
  draft.parameters["filter.2.resonance"] = instrument.filter2?.resonance ?? 0.1;
  draft.parameters["filter.2.drive"] = instrument.filter2?.drive ?? 0;
  draft.parameters["filter.routing"] = instrument.filterRouting ?? "serial";
  draft.parameters["aether.runtimeWarp"] = instrument.aether?.runtimeWarp ?? 0;
  draft.parameters["aether.runtimeWarpMode"] = instrument.aether?.runtimeWarpMode ?? "shape";
  draft.parameters["aether.runtimeWarp2"] = instrument.aether?.runtimeWarp2 ?? 0;
  draft.parameters["aether.runtimeWarp2Mode"] = instrument.aether?.runtimeWarp2Mode ?? "shape";
  draft.parameters["aether.interaction.mode"] = instrument.aether?.interactionMode ?? "off";
  draft.parameters["aether.interaction.amount"] = instrument.aether?.interactionAmount ?? 0;
  draft.parameters["aether.noise.enabled"] = instrument.aether?.noise.enabled ?? false;
  draft.parameters["aether.noise.level"] = instrument.aether?.noise.level ?? 0;
  draft.parameters["aether.noise.color"] = instrument.aether?.noise.color ?? 0.5;
  draft.parameters["aether.noise.route"] = instrument.aether?.noise.route ?? "filter";
  draft.parameters["aether.sub.route"] = instrument.aether?.sub.route ?? "filter";
  draft.parameters["aether.sub.fxSend1"] = instrument.aether?.sub.fxSends?.[0] ?? 0;
  draft.parameters["aether.sub.fxSend2"] = instrument.aether?.sub.fxSends?.[1] ?? 0;
  draft.parameters["aether.noise.fxSend1"] = instrument.aether?.noise.fxSends?.[0] ?? 0;
  draft.parameters["aether.noise.fxSend2"] = instrument.aether?.noise.fxSends?.[1] ?? 0;
  draft.parameters["aether.sample.1.enabled"] = instrument.aether?.sampleSlot1?.enabled ?? false;
  draft.parameters["aether.sample.1.audioFileId"] = instrument.aether?.sampleSlot1?.audioFileId ?? "";
  draft.parameters["aether.sample.1.rootNote"] = instrument.aether?.sampleSlot1?.rootNote ?? 60;
  draft.parameters["aether.sample.1.level"] = instrument.aether?.sampleSlot1?.level ?? 0.8;
  draft.parameters["aether.sample.1.pan"] = instrument.aether?.sampleSlot1?.pan ?? 0;
  draft.parameters["aether.sample.1.route"] = instrument.aether?.sampleSlot1?.route ?? "filter";
  draft.parameters["aether.sample.1.start"] = instrument.aether?.sampleSlot1?.startRatio ?? 0;
  draft.parameters["aether.sample.1.end"] = instrument.aether?.sampleSlot1?.endRatio ?? 1;
  draft.parameters["aether.sample.1.loop.enabled"] = instrument.aether?.sampleSlot1?.loopEnabled ?? false;
  draft.parameters["aether.sample.1.loop.start"] = instrument.aether?.sampleSlot1?.loopStartRatio ?? 0;
  draft.parameters["aether.sample.1.loop.end"] = instrument.aether?.sampleSlot1?.loopEndRatio ?? 1;
  draft.parameters["aether.sample.1.fxSend1"] = instrument.aether?.sampleSlot1?.fxSends?.[0] ?? 0;
  draft.parameters["aether.sample.1.fxSend2"] = instrument.aether?.sampleSlot1?.fxSends?.[1] ?? 0;
  draft.metadata.sampleSlot1Zones = normalizeAetherSampleZones(instrument.aether?.sampleSlot1?.zones);
  draft.metadata.managedSfz = normalizeManagedSfz(instrument.aether?.sampleSlot1?.managedSfz);
  draft.parameters["aether.granular.2.enabled"] = instrument.aether?.granularSlot2?.enabled ?? false;
  draft.parameters["aether.granular.2.builtinSource"] = instrument.aether?.granularSlot2?.builtinSource ?? "";
  draft.parameters["aether.granular.2.rootNote"] = instrument.aether?.granularSlot2?.rootNote ?? 60;
  draft.parameters["aether.granular.2.level"] = instrument.aether?.granularSlot2?.level ?? 0.7;
  draft.parameters["aether.granular.2.route"] = instrument.aether?.granularSlot2?.route ?? "filter";
  draft.parameters["aether.granular.2.position"] = instrument.aether?.granularSlot2?.position ?? 0.5;
  draft.parameters["aether.granular.2.positionSpread"] = instrument.aether?.granularSlot2?.positionSpread ?? 0.1;
  draft.parameters["aether.granular.2.grainMilliseconds"] = instrument.aether?.granularSlot2?.grainMilliseconds ?? 80;
  draft.parameters["aether.granular.2.densityHz"] = instrument.aether?.granularSlot2?.densityHz ?? 12;
  draft.parameters["aether.granular.2.pitchSemitones"] = instrument.aether?.granularSlot2?.pitchSemitones ?? 0;
  draft.parameters["aether.granular.2.stereoSpread"] = instrument.aether?.granularSlot2?.stereoSpread ?? 0.5;
  draft.parameters["aether.granular.2.randomSeed"] = instrument.aether?.granularSlot2?.randomSeed ?? 1;
  draft.parameters["aether.granular.2.fxSend1"] = instrument.aether?.granularSlot2?.fxSends?.[0] ?? 0;
  draft.parameters["aether.granular.2.fxSend2"] = instrument.aether?.granularSlot2?.fxSends?.[1] ?? 0;
  draft.metadata.managedGranular = normalizeManagedGranular(instrument.aether?.granularSlot2?.managedAsset);
  draft.parameters["aether.spectral.3.enabled"] = instrument.aether?.spectralSlot3?.enabled ?? false;
  draft.parameters["aether.spectral.3.rootNote"] = instrument.aether?.spectralSlot3?.rootNote ?? 60;
  draft.parameters["aether.spectral.3.level"] = instrument.aether?.spectralSlot3?.level ?? 0.7;
  draft.parameters["aether.spectral.3.pan"] = instrument.aether?.spectralSlot3?.pan ?? 0;
  draft.parameters["aether.spectral.3.stereoWidth"] = instrument.aether?.spectralSlot3?.stereoWidth ?? 1;
  draft.parameters["aether.spectral.3.position"] = instrument.aether?.spectralSlot3?.position ?? 0;
  draft.parameters["aether.spectral.3.pitchSemitones"] = instrument.aether?.spectralSlot3?.pitchSemitones ?? 0;
  draft.parameters["aether.spectral.3.freeze"] = instrument.aether?.spectralSlot3?.freeze ?? false;
  draft.parameters["aether.spectral.3.route"] = instrument.aether?.spectralSlot3?.route ?? "filter";
  draft.parameters["aether.spectral.3.fxSend1"] = instrument.aether?.spectralSlot3?.fxSends?.[0] ?? 0;
  draft.parameters["aether.spectral.3.fxSend2"] = instrument.aether?.spectralSlot3?.fxSends?.[1] ?? 0;
  draft.metadata.managedSpectral = normalizeManagedSpectral(instrument.aether?.spectralSlot3?.managedAsset);
  draft.parameters["aether.fxBus1Id"] = instrument.aether?.fxBusIds?.[0] ?? "";
  draft.parameters["aether.fxBus2Id"] = instrument.aether?.fxBusIds?.[1] ?? "";
  draft.parameters["aether.mpe.enabled"] = instrument.aether?.memberExpressionZone?.enabled ?? false;
  draft.parameters["aether.mpe.masterChannel"] = clampMidiChannel(instrument.aether?.memberExpressionZone?.masterChannel ?? 1);
  draft.parameters["aether.mpe.firstMemberChannel"] = clampMidiChannel(instrument.aether?.memberExpressionZone?.firstMemberChannel ?? 2);
  draft.parameters["aether.mpe.lastMemberChannel"] = clampMidiChannel(instrument.aether?.memberExpressionZone?.lastMemberChannel ?? 16);
  draft.parameters["amp.level"] = 0.8;
  draft.parameters["env.1.attack"] = instrument.envelope.attackMs / 1000;
  draft.parameters["env.1.attackCurve"] = instrument.envelope.attackCurve ?? "linear";
  draft.parameters["env.1.decay"] = instrument.envelope.decayMs / 1000;
  draft.parameters["env.1.decayCurve"] = instrument.envelope.decayCurve ?? "linear";
  draft.parameters["env.1.sustain"] = instrument.envelope.sustain;
  draft.parameters["env.1.release"] = instrument.envelope.releaseMs / 1000;
  draft.parameters["env.1.releaseCurve"] = instrument.envelope.releaseCurve ?? "linear";
  draft.parameters["env.1.loop"] = instrument.envelope.loop ?? false;
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
  draft.parameters.maxVoices = instrument.maxVoices ?? 16;
  draft.parameters["mono.enabled"] = instrument.mono ?? false;
  draft.parameters["legato.enabled"] = instrument.legato ?? false;
  draft.parameters["glide.ms"] = instrument.glideMs ?? 0;

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
  expressionActivityByInstrument: {},
  bindInstrument: (instrumentId) => set({ boundInstrumentId: instrumentId }),
  setSelectedOscillator: (id) => set({ selectedOscillator: id }),
  setDraft: (draft) => set({ draft: normalizeSynthDraftPatch(draft) }),
  resetDraft: () => set({ draft: createDefaultSynthDraft(), selectedOscillator: "a" }),
  addOscillator: () => set((state) => {
    const used = new Set(state.draft.metadata.oscillators.map((oscillator) => oscillator.id));
    let index = 1;
    let id = oscillatorIdForIndex(index);
    while (used.has(id)) id = oscillatorIdForIndex(++index);
    const label = oscillatorLabelForIndex(index);
    const parameters = { ...state.draft.parameters };
    for (const [suffix, value] of Object.entries(DEFAULT_ADDED_OSCILLATOR_PARAMETERS)) {
      parameters[`osc.${id}.${suffix}`] = value;
    }
    return {
      selectedOscillator: id,
      draft: { ...state.draft, parameters, metadata: { ...state.draft.metadata, oscillators: [...state.draft.metadata.oscillators, { id, name: `Oscillator ${label}` }] } },
    };
  }),
  removeOscillator: (id) => set((state) => {
    if (id === "a") return state;
    const parameters = Object.fromEntries(Object.entries(state.draft.parameters).filter(([key]) => !key.startsWith(`osc.${id}.`))) as SynthDraftPatch["parameters"];
    return {
      selectedOscillator: state.selectedOscillator === id ? "a" : state.selectedOscillator,
      draft: { ...state.draft, parameters, modulation: state.draft.modulation.filter((route) => !route.target.startsWith(`osc.${id}.`)), metadata: { ...state.draft.metadata, oscillators: state.draft.metadata.oscillators.filter((oscillator) => oscillator.id !== id) } },
    };
  }),
  renameOscillator: (id, name) => set((state) => ({
    draft: { ...state.draft, metadata: { ...state.draft.metadata, oscillators: state.draft.metadata.oscillators.map((oscillator) => oscillator.id === id ? { ...oscillator, name: name.trim().slice(0, 48) || oscillator.name } : oscillator) } },
  })),
  setInstrumentExpressionActivity: (instrumentId, activity) =>
    set((state) => ({
      expressionActivityByInstrument: {
        ...state.expressionActivityByInstrument,
        [instrumentId]: { ...activity, updatedAt: Date.now() },
      },
    })),
  clearInstrumentExpressionActivity: (instrumentId) =>
    set((state) => {
      if (!instrumentId) return { expressionActivityByInstrument: {} };
      const next = { ...state.expressionActivityByInstrument };
      delete next[instrumentId];
      return { expressionActivityByInstrument: next };
    }),
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
        parameters: { ...state.draft.parameters, ...parameterPatch(id, value) },
      },
    })),
  setNumericParameter: (id, value) =>
    set((state) => {
      const sanitized = sanitizeNumber(value, id);
      return {
        draft: {
          ...state.draft,
          parameters: { ...state.draft.parameters, ...parameterPatch(id, sanitized) },
        },
      };
    }),
  setBooleanParameter: (id, value) =>
    set((state) => ({
      draft: {
        ...state.draft,
        parameters: { ...state.draft.parameters, ...parameterPatch(id, value) },
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
  if (id === "filter.cutoff" || id === "filter.2.cutoff") return Math.max(20, Math.min(20000, value));
  if (/^lfo\.(?:[1-9]|10)\.rate$/.test(id)) return Math.max(0.05, Math.min(50, value));
  if (id.includes(".octave")) return Math.max(-4, Math.min(4, Math.round(value)));
  if (id.includes(".semitone")) return Math.max(-12, Math.min(12, Math.round(value)));
  if (id.includes(".fine")) return Math.max(-100, Math.min(100, value));
  if (id.endsWith(".tuning.harmonic")) return Math.max(1, Math.min(64, Math.round(value)));
  if (id.endsWith(".tuning.numerator") || id.endsWith(".tuning.denominator")) return Math.max(0.001, Math.min(64, value));
  if (id.endsWith(".tuning.step")) return Math.max(-96, Math.min(96, Math.round(value)));
  if (id.endsWith(".tuning.divisions")) return Math.max(1, Math.min(96, Math.round(value)));
  if (id === "unison.voices") return Math.max(1, Math.min(16, Math.round(value)));
  if (id.endsWith(".unison.voices")) return Math.max(1, Math.min(8, Math.round(value)));
  if (id === "maxVoices") return Math.max(1, Math.min(32, Math.round(value)));
  if (id === "glide.ms") return Math.max(0, Math.min(5000, Math.round(value)));
  if (id.startsWith("aether.mpe.") && id.endsWith("Channel")) return clampMidiChannel(value);
  if (id === "aether.sample.1.rootNote") return Math.max(0, Math.min(127, Math.round(value)));
  if (id === "aether.granular.2.rootNote") return Math.max(0, Math.min(127, Math.round(value)));
  if (id === "aether.granular.2.grainMilliseconds") return Math.max(2, Math.min(1000, value));
  if (id === "aether.granular.2.densityHz") return Math.max(0.1, Math.min(200, value));
  if (id === "aether.granular.2.pitchSemitones") return Math.max(-48, Math.min(48, value));
  if (id === "aether.granular.2.randomSeed") return Math.max(1, Math.min(0xffffffff, Math.round(value)));
  if (id === "aether.spectral.3.rootNote") return Math.max(0, Math.min(127, Math.round(value)));
  if (id === "aether.spectral.3.stereoWidth") return Math.max(0, Math.min(2, value));
  if (id === "aether.spectral.3.pitchSemitones") return Math.max(-12, Math.min(12, value));
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

function normalizeWavemapMetadata(
  wavemaps: unknown,
  legacyCustomWavetables: unknown,
): Record<string, CustomWavetableDefinition> {
  const defaults = { [DEFAULT_CUSTOM_WAVETABLE_ID]: createDefaultCustomWavetable() };
  return {
    ...defaults,
    ...normalizeCustomWavetables(legacyCustomWavetables, false),
    ...normalizeCustomWavetables(wavemaps, false),
  };
}

function normalizeCustomWavetables(value: unknown, includeDefaults = true): Record<string, CustomWavetableDefinition> {
  const defaults = { [DEFAULT_CUSTOM_WAVETABLE_ID]: createDefaultCustomWavetable() };
  if (!isRecord(value)) return includeDefaults ? defaults : {};
  const next: Record<string, CustomWavetableDefinition> = includeDefaults ? { ...defaults } : {};
  for (const [id, definition] of Object.entries(value)) {
    if (!id.startsWith("user.") || !isRecord(definition)) continue;
    next[id] = normalizeCustomWavetable({ ...definition, id });
  }
  return next;
}

type FactoryGuideEffect = {
  type?: string;
  params?: Record<string, unknown>;
};

type FactoryGuideFrame = {
  scan?: number;
  bright?: number;
  even?: number;
  fold?: number;
  formant?: number;
  notch?: number;
  focus?: number;
  skew?: number;
  tilt?: number;
  phase?: number;
};

type FactoryGuideCustomWavetable = {
  name?: string;
  interpolation?: string;
  morph?: number;
  source?: string;
  frames?: Record<string, FactoryGuideFrame>;
};

type FactoryGuideOscillator = {
  enabled?: boolean;
  mode?: string;
  shape?: string;
  customWavetable?: FactoryGuideCustomWavetable;
  position?: number;
  warpMode?: string;
  warp?: number;
  octave?: number;
  semitone?: number;
  fineCents?: number;
  phase?: number;
  random?: number;
  pan?: number;
  level?: number;
};

type FactoryGuidePatch = {
  name: string;
  category: string;
  intent?: string;
  tags?: string[];
  role?: string;
  auditionNote?: string;
  playMode?: {
    polyphony?: number;
    mono?: boolean;
    legato?: boolean;
    glideMs?: number;
  };
  oscillators?: {
    oscA?: FactoryGuideOscillator;
    oscB?: FactoryGuideOscillator;
  };
  voiceStack?: {
    enabled?: boolean;
    voices?: number;
    detune?: number;
    blend?: number;
    spread?: number;
    max?: number;
  };
  filter?: {
    enabled?: boolean;
    type?: string;
    cutoffHz?: number;
    resonance?: number;
    drive?: number;
    keytrack?: number;
  };
  envelopes?: {
    ampEnv?: FactoryGuideEnvelope;
    modEnv?: FactoryGuideEnvelope;
  };
  lfos?: {
    lfo1?: FactoryGuideLfo;
    lfo2?: FactoryGuideLfo;
  };
  macros?: FactoryGuideMacro[];
  modulationMatrix?: FactoryGuideModulationRoute[];
  fxChain?: FactoryGuideEffect[];
};

type FactoryGuideEnvelope = {
  attackMs?: number;
  decayMs?: number;
  sustain?: number;
  releaseMs?: number;
  attackCurve?: string;
  decayCurve?: string;
  releaseCurve?: string;
};

type FactoryGuideLfo = {
  enabled?: boolean;
  shape?: string;
  sync?: boolean;
  rateHz?: number;
  rate?: string;
  phase?: number;
  smooth?: number;
  random?: number;
  oneShot?: boolean;
  retrigger?: boolean;
  bipolar?: boolean;
};

type FactoryGuideMacro = {
  slot?: string;
  label?: string;
  default?: number;
};

type FactoryGuideModulationRoute = {
  enabled?: boolean;
  source?: string;
  target?: string;
  amount?: number;
  polarity?: string;
};

const FACTORY_GUIDE_CATEGORY_TAXONOMY: Record<string, string> = {
  "Poly Keys": "poly_synth",
  "Arp Pluck": "arpeggiator",
  Pad: "pad_synth",
  Bass: "reese_bass",
  Lead: "lead_synth",
  Bell: "music_box",
  "Lo-Fi Pad": "pad_synth",
  "Chord Stab": "poly_synth",
  "Sub Bass": "sub_bass",
  Atmosphere: "atmospheres",
  "Bass / Crunch": "reese_bass",
  "Crunch Lead": "lead_synth",
  "Vocal Pad": "vocal_pad",
  "Vocal Pluck": "vocal_fx",
  "Synth String": "electric_violin",
  Strings: "electric_violin",
  "Keys / Synth Piano": "felt_piano",
  Mallet: "toy_xylophone",
};

const FACTORY_GUIDE_MACRO_IDS: Record<string, MacroId> = {
  motion: "macro.1",
  color: "macro.2",
  shape: "macro.3",
  space: "macro.4",
};

const FACTORY_GUIDE_MOD_SOURCES: Record<string, ModulationSourceId> = {
  ampEnv: "env.1",
  modEnv: "env.2",
  lfo1: "lfo.1",
  lfo2: "lfo.2",
  velocity: "velocity",
  keytrack: "keytrack",
  modWheel: "modWheel",
  aftertouch: "pressure",
  pressure: "pressure",
  timbre: "timbre",
  cc74: "timbre",
  "macro.motion": "macro.1",
  "macro.color": "macro.2",
  "macro.shape": "macro.3",
  "macro.space": "macro.4",
  motion: "macro.1",
  color: "macro.2",
  shape: "macro.3",
  space: "macro.4",
};

const FACTORY_GUIDE_MOD_TARGETS: Record<string, ModulationTargetId> = {
  "oscA.position": "osc.a.position",
  "oscA.warp": "osc.a.warp",
  "oscA.fine": "osc.a.fine",
  "oscA.level": "osc.a.level",
  "oscA.pan": "osc.a.pan",
  "oscB.position": "osc.b.position",
  "oscB.warp": "osc.b.warp",
  "oscB.fine": "osc.b.fine",
  "oscB.level": "osc.b.level",
  "oscB.pan": "osc.b.pan",
  "osc.a.position": "osc.a.position",
  "osc.a.warp": "osc.a.warp",
  "osc.a.fine": "osc.a.fine",
  "osc.a.level": "osc.a.level",
  "osc.a.pan": "osc.a.pan",
  "osc.b.position": "osc.b.position",
  "osc.b.warp": "osc.b.warp",
  "osc.b.fine": "osc.b.fine",
  "osc.b.level": "osc.b.level",
  "osc.b.pan": "osc.b.pan",
  "global.pitch": "osc.a.fine",
  "global.pitchFine": "osc.a.fine",
  "lfo1.depth": "osc.a.position",
  "lfo2.depth": "osc.b.position",
  "filter.cutoffHz": "filter.cutoff",
  "filter.cutoff": "filter.cutoff",
  "filter.resonance": "filter.resonance",
  "filter.drive": "filter.drive",
  "amp.level": "amp.level",
  "amp.pan": "amp.pan",
  "voice.detune": "unison.detune",
  "voice.spread": "unison.spread",
  "unison.detune": "unison.detune",
  "unison.spread": "unison.spread",
  "fx.Delay.mix": "amp.pan",
  "fx.Reverb / Room.mix": "unison.spread",
  "fx.Chorus.mix": "unison.spread",
};

function createFactorySynthPresetsFromGuide(): SynthFactoryPresetRecord[] {
  const guides = [factoryAetherGuide, benchmarkAetherStrings] as Array<{ patches?: FactoryGuidePatch[] }>;
  const presets = guides
    .flatMap((guide) => guide.patches ?? [])
    .filter((patch) => patch.name && patch.category)
    .map(createFactorySynthPresetFromGuide);
  const granular = normalizeSynthDraftPatch({
    name: "Benchmark - Granular Drift",
    parameters: {
      "osc.a.wavetable": "basic.sine",
      "osc.a.level": 0.12,
      "osc.b.enabled": false,
      "aether.sub.enabled": false,
      "aether.noise.enabled": false,
      "aether.granular.2.enabled": true,
      "aether.granular.2.builtinSource": "benchmark",
      "aether.granular.2.rootNote": 45,
      "aether.granular.2.level": 0.62,
      "aether.granular.2.route": "filter",
      "aether.granular.2.position": 0.46,
      "aether.granular.2.positionSpread": 0.28,
      "aether.granular.2.grainMilliseconds": 145,
      "aether.granular.2.densityHz": 24,
      "aether.granular.2.pitchSemitones": 0,
      "aether.granular.2.stereoSpread": 0.82,
      "aether.granular.2.randomSeed": 271828,
      "filter.cutoff": 9200,
      "filter.resonance": 0.12,
      "env.1.attack": 0.04,
      "env.1.decay": 0.8,
      "env.1.sustain": 0.82,
      "env.1.release": 1.6,
    },
    modulation: [],
    metadata: { createdBy: "Beat", tags: ["factory", "benchmark", "granular", "texture"] },
  } as unknown as Partial<SynthDraftPatch>);
  presets.push({
    id: "factory.benchmark-granular-drift",
    name: granular.name,
    patch: granular,
    tags: ["factory", "benchmark", "granular", "texture"],
    category: "Texture",
    description: "Deterministic Beat-owned granular benchmark using a locally generated immutable source and a quiet sine audition pilot.",
    family: "Granular",
    role: "texture benchmark",
    auditionNote: "Hold a low chord to review grain density, position spread, stereo motion, and release tails.",
  });
  return presets;
}

function createFactorySynthPresetFromGuide(patch: FactoryGuidePatch): SynthFactoryPresetRecord {
  const id = `factory.${slugFactoryGuideName(patch.name)}`;
  const customWavetables: Record<string, CustomWavetableDefinition> = {};
  const parameters: Partial<Record<SynthParameterId, SynthParameterValue>> = {};
  applyFactoryGuideOscillator(parameters, customWavetables, id, "a", patch.oscillators?.oscA);
  applyFactoryGuideOscillator(parameters, customWavetables, id, "b", patch.oscillators?.oscB);
  applyFactoryGuideVoice(parameters, patch);
  applyFactoryGuideFilter(parameters, patch.filter);
  applyFactoryGuideEnvelope(parameters, "env.1", patch.envelopes?.ampEnv);
  applyFactoryGuideEnvelope(parameters, "env.2", patch.envelopes?.modEnv);
  applyFactoryGuideLfo(parameters, "lfo.1", patch.lfos?.lfo1);
  applyFactoryGuideLfo(parameters, "lfo.2", patch.lfos?.lfo2);

  const macros = guideMacros(patch.macros);
  for (const macro of patch.macros ?? []) {
    const id = macro.slot ? FACTORY_GUIDE_MACRO_IDS[macro.slot] : undefined;
    if (id) parameters[id] = guidePercent(macro.default, 0);
  }

  const importedModulation = (patch.modulationMatrix ?? [])
    .map((route, index) => guideModulationRoute(`${id}.mod.${index + 1}`, route))
    .filter((route): route is SynthModulationRoute => route !== null);
  const modulation = [...importedModulation, ...guideFallbackMacroRoutes(id, patch.category, importedModulation)];
  const effects = { filters: guideEffects(id, patch.fxChain) };
  const taxonomy = taxonomyAssignmentForInstrumentId(FACTORY_GUIDE_CATEGORY_TAXONOMY[patch.category] ?? "wavetable_synth");
  const tags = Array.from(new Set([
    "factory",
    "aether",
    "guide",
    patch.category.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-"),
    ...(patch.tags ?? []),
  ]));
  const normalized = normalizeSynthDraftPatch({
    name: patch.name,
    taxonomy,
    parameters,
    modulation,
    effects,
    metadata: {
      createdBy: "Beat",
      tags,
      icon: "ph:cube",
      macros,
      wavemaps: customWavetables,
      customWavetables,
    },
  } as Partial<SynthDraftPatch>);
  tuneFactoryGuidePreset(patch.name, normalized);

  return {
    id,
    name: patch.name,
    patch: normalized,
    tags,
    category: patch.category,
    description: patch.intent ?? `${patch.name} Aether factory patch.`,
    family: patch.category,
    role: patch.role ?? patch.category.toLowerCase(),
    auditionNote: patch.auditionNote ?? `${patch.category} patch built from the v4 Aether factory guide.`,
  };
}

function tuneFactoryGuidePreset(name: string, patch: SynthDraftPatch) {
  const p = patch.parameters;
  const set = (id: SynthParameterId, value: SynthParameterValue) => {
    p[id] = value;
  };
  const setEffectMix = (kind: TrackEffect["kind"], mix: number) => {
    const effect = patch.effects?.filters.find((candidate) => candidate.kind === kind);
    if (effect) effect.params.mix = mix;
  };

  switch (name) {
    case "Block Felt Piano":
      set("osc.a.level", 0.76);
      set("osc.b.position", 0.06);
      set("osc.b.level", 0.34);
      set("filter.cutoff", 6400);
      set("filter.keytrack", 0.55);
      set("env.1.attack", 0.001);
      set("env.1.decay", 0.58);
      set("env.1.decayCurve", "exp");
      set("env.1.sustain", 0);
      set("env.1.release", 0.11);
      set("env.1.releaseCurve", "exp");
      set("env.2.decay", 0.08);
      set("aether.noise.enabled", true);
      set("aether.noise.level", 0.045);
      set("aether.noise.color", 0.38);
      set("lfo.1.enabled", false);
      patch.modulation = patch.modulation.filter((route) => route.source !== "lfo.1");
      set("amp.level", 0.82);
      setEffectMix("chorus", 2);
      setEffectMix("reverb", 8);
      break;
    case "Toy Xylophone":
      set("osc.a.level", 0.76);
      set("osc.b.position", 0.18);
      set("osc.b.level", 0.34);
      set("filter.cutoff", 11800);
      set("filter.keytrack", 0.78);
      set("env.1.attack", 0.001);
      set("env.1.decay", 0.24);
      set("env.1.decayCurve", "exp");
      set("env.1.sustain", 0);
      set("env.1.release", 0.045);
      set("env.1.releaseCurve", "exp");
      set("env.2.decay", 0.045);
      set("aether.noise.enabled", true);
      set("aether.noise.level", 0.035);
      set("aether.noise.color", 0.72);
      set("amp.level", 0.86);
      setEffectMix("delay", 0);
      setEffectMix("reverb", 5);
      break;
    case "Frozen Bell Stack":
      set("osc.a.position", 0.7);
      set("osc.a.warp", 0.22);
      set("osc.a.level", 0.84);
      set("osc.b.level", 0.18);
      set("filter.cutoff", 11200);
      set("env.1.attack", 0.001);
      set("env.1.decay", 0.62);
      set("env.1.decayCurve", "exp");
      set("env.1.sustain", 0);
      set("env.1.release", 0.18);
      set("env.1.releaseCurve", "exp");
      set("env.2.decay", 0.12);
      set("aether.noise.enabled", true);
      set("aether.noise.level", 0.02);
      set("aether.noise.color", 0.6);
      set("lfo.1.enabled", false);
      set("amp.level", 0.78);
      patch.modulation = patch.modulation.filter((route) => route.source !== "lfo.1");
      setEffectMix("delay", 0);
      setEffectMix("reverb", 8);
      break;
    case "Resin Violin Lead":
      set("osc.a.position", 0.48);
      set("osc.a.warp", 0.18);
      set("osc.a.level", 0.82);
      set("osc.b.fine", 3);
      set("osc.b.level", 0.34);
      set("filter.cutoff", 4300);
      set("filter.resonance", 0.22);
      set("filter.drive", 0.1);
      set("filter.keytrack", 0.46);
      set("env.1.attack", 0.08);
      set("env.1.decay", 0.48);
      set("env.1.sustain", 0.86);
      set("env.1.release", 0.42);
      set("env.2.attack", 0.04);
      set("env.2.decay", 0.58);
      set("env.2.sustain", 0.24);
      set("lfo.1.enabled", true);
      set("lfo.1.rate", 5.7);
      set("lfo.1.smoothing", 0.22);
      set("lfo.2.enabled", true);
      set("lfo.2.rate", 0.18);
      set("amp.level", 0.74);
      setEffectMix("chorus", 7);
      setEffectMix("reverb", 16);
      break;
    case "Velvet Choir Pad":
      set("osc.a.level", 0.78);
      set("osc.b.level", 0.56);
      set("filter.cutoff", 7600);
      set("filter.keytrack", 0.28);
      set("env.1.attack", 1.05);
      set("env.1.decay", 2.4);
      set("env.1.sustain", 0.86);
      set("env.1.release", 3.2);
      set("env.2.attack", 1.2);
      set("env.2.sustain", 0.58);
      set("amp.level", 0.76);
      setEffectMix("chorus", 22);
      setEffectMix("reverb", 24);
      break;
    default:
      break;
  }
}

function guideMacros(macros: FactoryGuideMacro[] | undefined): Record<MacroId, SynthMacroDefinition> {
  const next = cloneDefaultMacros();
  for (const macro of macros ?? []) {
    const id = macro.slot ? FACTORY_GUIDE_MACRO_IDS[macro.slot] : undefined;
    if (!id || typeof macro.label !== "string" || !macro.label.trim()) continue;
    next[id] = { ...next[id], label: macro.label.trim().slice(0, 24) };
  }
  return next;
}

function guideFallbackMacroRoutes(
  presetId: string,
  category: string,
  imported: SynthModulationRoute[],
): SynthModulationRoute[] {
  const present = new Set(imported.filter((route) => route.source.startsWith("macro.")).map((route) => route.source as MacroId));
  const defaults = guideFallbackMacroTargets(category);
  return MACRO_IDS.slice(0, 4)
    .filter((source) => !present.has(source))
    .map((source, index) => {
      const fallback = defaults[source];
      return {
        id: `${presetId}.macro.fallback.${index + 1}`,
        source,
        target: fallback.target,
        amount: fallback.amount,
        bipolar: fallback.bipolar,
        enabled: true,
      };
    });
}

function guideFallbackMacroTargets(category: string): Record<MacroId, { target: ModulationTargetId; amount: number; bipolar: boolean }> {
  if (category === "Pad" || category === "Vocal Pad" || category === "Atmosphere" || category === "Lo-Fi Pad") {
    return {
      "macro.1": { target: "osc.a.position", amount: 0.14, bipolar: true },
      "macro.2": { target: "filter.cutoff", amount: 0.16, bipolar: false },
      "macro.3": { target: "unison.spread", amount: 0.18, bipolar: false },
      "macro.4": { target: "amp.pan", amount: 0.1, bipolar: true },
      "macro.5": { target: "amp.level", amount: 0, bipolar: false }, "macro.6": { target: "amp.level", amount: 0, bipolar: false },
      "macro.7": { target: "amp.level", amount: 0, bipolar: false }, "macro.8": { target: "amp.level", amount: 0, bipolar: false },
    };
  }
  if (category === "Bass" || category === "Bass / Crunch" || category === "Sub Bass") {
    return {
      "macro.1": { target: "osc.b.level", amount: 0.16, bipolar: false },
      "macro.2": { target: "filter.cutoff", amount: 0.14, bipolar: true },
      "macro.3": { target: "filter.drive", amount: 0.18, bipolar: false },
      "macro.4": { target: "osc.a.fine", amount: 0.05, bipolar: true },
      "macro.5": { target: "amp.level", amount: 0, bipolar: false }, "macro.6": { target: "amp.level", amount: 0, bipolar: false },
      "macro.7": { target: "amp.level", amount: 0, bipolar: false }, "macro.8": { target: "amp.level", amount: 0, bipolar: false },
    };
  }
  if (category === "Bell" || category === "Mallet" || category === "Keys / Synth Piano" || category === "Arp Pluck") {
    return {
      "macro.1": { target: "amp.level", amount: 0.12, bipolar: false },
      "macro.2": { target: "filter.cutoff", amount: 0.16, bipolar: false },
      "macro.3": { target: "osc.a.warp", amount: 0.14, bipolar: true },
      "macro.4": { target: "unison.spread", amount: 0.12, bipolar: false },
      "macro.5": { target: "amp.level", amount: 0, bipolar: false }, "macro.6": { target: "amp.level", amount: 0, bipolar: false },
      "macro.7": { target: "amp.level", amount: 0, bipolar: false }, "macro.8": { target: "amp.level", amount: 0, bipolar: false },
    };
  }
  return {
    "macro.1": { target: "osc.a.position", amount: 0.14, bipolar: true },
    "macro.2": { target: "filter.cutoff", amount: 0.16, bipolar: false },
    "macro.3": { target: "osc.a.warp", amount: 0.14, bipolar: true },
    "macro.4": { target: "amp.pan", amount: 0.08, bipolar: true },
    "macro.5": { target: "amp.level", amount: 0, bipolar: false }, "macro.6": { target: "amp.level", amount: 0, bipolar: false },
    "macro.7": { target: "amp.level", amount: 0, bipolar: false }, "macro.8": { target: "amp.level", amount: 0, bipolar: false },
  };
}

function applyFactoryGuideOscillator(
  parameters: Partial<Record<SynthParameterId, SynthParameterValue>>,
  customWavetables: Record<string, CustomWavetableDefinition>,
  presetId: string,
  key: OscillatorKey,
  oscillator: FactoryGuideOscillator | undefined,
) {
  const prefix = `osc.${key}` as const;
  if (!oscillator) return;
  parameters[`${prefix}.enabled`] = oscillator.enabled !== false;
  parameters[`${prefix}.position`] = guidePercent(oscillator.position, 0);
  parameters[`${prefix}.warp`] = guidePercent(oscillator.warp, 0);
  parameters[`${prefix}.warpMode`] = guideWarpMode(oscillator.warpMode);
  parameters[`${prefix}.octave`] = guideNumber(oscillator.octave, 0);
  parameters[`${prefix}.semitone`] = guideNumber(oscillator.semitone, 0);
  parameters[`${prefix}.fine`] = guideNumber(oscillator.fineCents, 0);
  parameters[`${prefix}.phase`] = guidePercent(oscillator.phase, 0);
  parameters[`${prefix}.randomPhase`] = guidePercent(oscillator.random, 0);
  parameters[`${prefix}.pan`] = guideBipolarPercent(oscillator.pan, 0);
  parameters[`${prefix}.level`] = guidePercent(oscillator.level, key === "a" ? 80 : 0);

  if (oscillator.mode === "custom_wavetable") {
    const custom = guideCustomWavetable(`${presetId}.${key}`, oscillator.customWavetable);
    customWavetables[custom.id] = custom;
    parameters[`${prefix}.wavetable`] = custom.id;
    return;
  }
  parameters[`${prefix}.wavetable`] = guideBasicWavetable(oscillator.shape);
}

function applyFactoryGuideVoice(parameters: Partial<Record<SynthParameterId, SynthParameterValue>>, patch: FactoryGuidePatch) {
  const playMode = patch.playMode ?? {};
  const voiceStack = patch.voiceStack ?? {};
  parameters.maxVoices = Math.max(1, Math.round(guideNumber(playMode.polyphony ?? voiceStack.max, 8)));
  parameters["mono.enabled"] = playMode.mono === true;
  parameters["legato.enabled"] = playMode.legato === true;
  parameters["glide.ms"] = guideNumber(playMode.glideMs, 0);
  parameters["unison.enabled"] = voiceStack.enabled === true;
  parameters["unison.voices"] = Math.max(1, Math.round(guideNumber(voiceStack.voices, 1)));
  parameters["unison.detune"] = guidePercent(voiceStack.detune, 0);
  parameters["unison.blend"] = guidePercent(voiceStack.blend, 0);
  parameters["unison.spread"] = guidePercent(voiceStack.spread, 0);
}

function applyFactoryGuideFilter(parameters: Partial<Record<SynthParameterId, SynthParameterValue>>, filter: FactoryGuidePatch["filter"]) {
  if (!filter) return;
  parameters["filter.enabled"] = filter.enabled !== false;
  parameters["filter.type"] = guideFilterType(filter.type);
  parameters["filter.cutoff"] = guideNumber(filter.cutoffHz, 18000);
  parameters["filter.resonance"] = guidePercent(filter.resonance, 0);
  parameters["filter.drive"] = guidePercent(filter.drive, 0);
  parameters["filter.keytrack"] = guidePercent(filter.keytrack, 0);
}

function applyFactoryGuideEnvelope(
  parameters: Partial<Record<SynthParameterId, SynthParameterValue>>,
  prefix: "env.1" | "env.2" | "env.3" | "env.4",
  envelope: FactoryGuideEnvelope | undefined,
) {
  if (!envelope) return;
  parameters[`${prefix}.attack`] = guideNumber(envelope.attackMs, 10) / 1000;
  parameters[`${prefix}.decay`] = guideNumber(envelope.decayMs, 180) / 1000;
  parameters[`${prefix}.sustain`] = guidePercent(envelope.sustain, 70);
  parameters[`${prefix}.release`] = guideNumber(envelope.releaseMs, 180) / 1000;
  parameters[`${prefix}.attackCurve`] = guideEnvelopeCurve(envelope.attackCurve);
  parameters[`${prefix}.decayCurve`] = guideEnvelopeCurve(envelope.decayCurve);
  parameters[`${prefix}.releaseCurve`] = guideEnvelopeCurve(envelope.releaseCurve);
}

function applyFactoryGuideLfo(
  parameters: Partial<Record<SynthParameterId, SynthParameterValue>>,
  prefix: "lfo.1" | "lfo.2",
  lfo: FactoryGuideLfo | undefined,
) {
  if (!lfo) return;
  parameters[`${prefix}.enabled`] = lfo.enabled === true;
  parameters[`${prefix}.shape`] = guideLfoShape(lfo.shape);
  parameters[`${prefix}.sync`] = lfo.sync === true;
  parameters[`${prefix}.rate`] = guideNumber(lfo.rateHz, 1);
  parameters[`${prefix}.syncedRate`] = typeof lfo.rate === "string" ? lfo.rate : "1/4";
  parameters[`${prefix}.phase`] = guidePercent(lfo.phase, 0);
  parameters[`${prefix}.smoothing`] = guidePercent(lfo.smooth, 0);
  parameters[`${prefix}.randomPhase`] = guidePercent(lfo.random, 0);
  parameters[`${prefix}.oneShot`] = lfo.oneShot === true;
  parameters[`${prefix}.retrigger`] = lfo.retrigger !== false;
  parameters[`${prefix}.bipolar`] = lfo.bipolar !== false;
}

function guideModulationRoute(id: string, route: FactoryGuideModulationRoute): SynthModulationRoute | null {
  const source = route.source ? FACTORY_GUIDE_MOD_SOURCES[route.source] : undefined;
  const target = route.target ? FACTORY_GUIDE_MOD_TARGETS[route.target] : undefined;
  if (!source || !target) return null;
  const amount = guideBipolarPercent(route.amount, 0);
  return {
    id,
    source,
    target,
    amount,
    bipolar: route.polarity === "bipolar" || amount < 0,
    enabled: route.enabled !== false,
  };
}

function guideEffects(presetId: string, effects: FactoryGuideEffect[] | undefined): TrackEffect[] {
  return (effects ?? [])
    .map((effect, index) => guideEffect(`${presetId}.fx.${index + 1}`, effect))
    .filter((effect): effect is TrackEffect => effect !== null);
}

function guideEffect(id: string, effect: FactoryGuideEffect): TrackEffect | null {
  const kind = guideEffectKind(effect.type);
  if (!kind) return null;
  return {
    id,
    kind,
    bypassed: false,
    params: guideEffectParams(kind, effect.params ?? {}),
  };
}

function guideEffectKind(type: string | undefined): TrackEffect["kind"] | null {
  const normalized = String(type ?? "").toLowerCase().replaceAll(" ", "").replaceAll("-", "").replaceAll("/", "");
  if (normalized === "reverbroom" || normalized === "reverb") return "reverb";
  if (normalized === "delay") return "delay";
  if (normalized === "chorus") return "chorus";
  if (normalized === "phaser") return "phaser";
  if (normalized === "flanger") return "flanger";
  if (normalized === "compressor") return "compressor";
  if (normalized === "lowpass") return "lowpass";
  if (normalized === "highpass") return "highpass";
  if (normalized === "saturator") return "saturator";
  if (normalized === "distortion") return "distortion";
  if (normalized === "bitcrush") return "bitcrush";
  return null;
}

function guideEffectParams(kind: TrackEffect["kind"], params: Record<string, unknown>): Record<string, number> {
  const pct = (key: string, fallback = 0) => guidePercent(params[key], fallback);
  const num = (key: string, fallback = 0) => guideNumber(params[key], fallback);
  switch (kind) {
    case "highpass":
    case "lowpass":
      return { cutoffHz: num("cutoffHz", kind === "highpass" ? 40 : 12000), resonance: pct("resonance", 0) * 100 };
    case "saturator":
    case "distortion":
      return { drive: pct("drive", 20) * 100, tone: pct("tone", 50) * 100, mix: pct("mix", 100) * 100 };
    case "bitcrush":
      return { bits: num("bits", 10), rate: pct("rate", 50) * 100, mix: pct("mix", 100) * 100 };
    case "delay":
      return { timeMs: guideDelayMs(params.time ?? params.timeMs ?? params.timeLeft, 250), feedback: pct("feedback", 20) * 100, mix: pct("mix", 18) * 100 };
    case "reverb":
      return { roomSize: pct("size", 45) * 100, damping: pct("damping", 45) * 100, mix: pct("mix", 20) * 100 };
    case "chorus":
      return { rateHz: num("rateHz", 0.25), depthMs: num("depthMs", 8), delayMs: num("delayMs", 12), feedback: pct("feedback", 4) * 100, mix: pct("mix", 22) * 100 };
    case "phaser":
      return { rateHz: num("rateHz", 0.28), centerHz: num("centerHz", 900), depthOctaves: num("depthOctaves", 1.8), feedback: pct("feedback", 25) * 100, mix: pct("mix", 30) * 100 };
    case "flanger":
      return { rateHz: num("rateHz", 0.2), depthMs: num("depthMs", 2.4), delayMs: num("delayMs", 2.8), feedback: pct("feedback", 28) * 100, mix: pct("mix", 22) * 100 };
    case "compressor":
      return { thresholdDb: -Math.abs(num("thresholdDb", num("threshold", 24))), ratio: Math.max(1, num("ratio", 4)), attackMs: num("attackMs", num("attack", 10)), releaseMs: num("releaseMs", num("release", 120)), makeupDb: num("makeupDb", num("makeup", 0)), mix: pct("mix", 85) * 100 };
    default:
      return {};
  }
}

function guideCustomWavetable(id: string, custom: FactoryGuideCustomWavetable | undefined): CustomWavetableDefinition {
  const frameEntries = Object.entries(custom?.frames ?? {}) as Array<[string, FactoryGuideFrame]>;
  const fallbackFrames: Array<[string, FactoryGuideFrame]> = [["A", {}], ["B", {}], ["C", {}], ["D", {}]];
  const frames = (frameEntries.length > 0 ? frameEntries : fallbackFrames)
    .slice(0, 4)
    .map(([label, frame], index) => guideCustomWavetableFrame(`${id}.frame.${label}`, label, frame, index));
  return normalizeCustomWavetable({
    schemaVersion: 1,
    id: `user.${slugFactoryGuideName(id)}`,
    name: custom?.name ?? id,
    kind: "harmonic-sketch",
    interpolation: custom?.interpolation === "linear" ? "linear" : "smooth",
    morph: guidePercent(custom?.morph, 0),
    source: {
      kind: "generated",
      label: custom?.source ?? "Factory guide",
      createdAt: Date.now(),
    },
    frames,
  });
}

function guideCustomWavetableFrame(id: string, label: string, frame: FactoryGuideFrame, index: number): CustomWavetableFrame {
  return {
    id,
    label,
    position: index / 3,
    brightness: guidePercent(frame.bright, 35),
    even: guidePercent(frame.even, 35),
    fold: guidePercent(frame.fold, 0),
    formant: guidePercent(frame.formant, 0),
    notch: guidePercent(frame.notch, 0),
    skew: guideBipolarPercent(frame.skew, 0),
    tilt: guideBipolarPercent(frame.tilt, 0),
    focus: guidePercent(frame.focus, 0),
    phase: guideBipolarPercent(frame.phase, 0),
  };
}

function guideBasicWavetable(shape: string | undefined): WavetableId {
  if (shape === "saw") return "basic.saw";
  if (shape === "square") return "basic.square";
  if (shape === "triangle") return "basic.triangle";
  if (shape === "pulse") return "basic.pulse";
  return "basic.sine";
}

function guideWarpMode(value: string | undefined): WavetableWarpMode {
  if (value === "fold") return "fold";
  if (value === "mirror") return "mirror";
  if (value === "pinch" || value === "formant") return "pinch";
  return "shape";
}

function guideFilterType(value: string | undefined): string {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("hp") || normalized.includes("high")) return "highpass";
  if (normalized.includes("bp") || normalized.includes("band")) return "bandpass";
  return "lowpass";
}

function guideEnvelopeCurve(value: string | undefined): EnvelopeCurve {
  if (value === "exp" || value === "log" || value === "s-curve") return value;
  return "linear";
}

function guideLfoShape(value: string | undefined): string {
  if (value === "triangle" || value === "square" || value === "saw") return value;
  return "sine";
}

function guideNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function guidePercent(value: unknown, fallbackPercent: number): number {
  return Math.max(0, Math.min(1, guideNumber(value, fallbackPercent) / 100));
}

function guideBipolarPercent(value: unknown, fallbackPercent: number): number {
  return Math.max(-1, Math.min(1, guideNumber(value, fallbackPercent) / 100));
}

function guideDelayMs(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const rates: Record<string, number> = {
    "1/32": 62.5,
    "1/16": 125,
    "1/8": 250,
    "1/8D": 375,
    "1/4": 500,
    "1/4D": 750,
    "1/2": 1000,
    "3/4": 1500,
    "1/1": 2000,
  };
  return rates[value] ?? fallback;
}

function slugFactoryGuideName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("&", "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createFactorySynthPresets(): SynthFactoryPresetRecord[] {
  const guidedPresets = createFactorySynthPresetsFromGuide();
  if (guidedPresets.length > 0) return guidedPresets;

  const custom = createDefaultCustomWavetable();
  const effect = (id: string, kind: TrackEffect["kind"], params: Record<string, number>): TrackEffect => ({
    id,
    kind,
    bypassed: false,
    params,
  });
  const macroLayout = (category: string): Record<MacroId, SynthMacroDefinition> => {
    const labels = (() => {
      if (category === "Bass") return ["Weight", "Movement", "Drive", "Glide"];
      if (category === "Drum" || category === "Percussion") return ["Punch", "Tone", "Drive", "Decay"];
      if (category === "FX" || category === "Texture") return ["Motion", "Brightness", "Grit", "Space"];
      if (category === "Keys") return ["Touch", "Tone", "Body", "Room"];
      if (category === "Lead") return ["Motion", "Bite", "Width", "Echo"];
      if (category === "Pad") return ["Drift", "Warmth", "Width", "Space"];
      if (category === "Pluck") return ["Snap", "Tone", "Body", "Space"];
      if (category === "Wavetable") return ["Scan", "Tone", "Warp", "Motion"];
      return ["Motion", "Color", "Shape", "Space"];
    })();
    return {
      "macro.1": { ...DEFAULT_MACROS["macro.1"], label: labels[0] },
      "macro.2": { ...DEFAULT_MACROS["macro.2"], label: labels[1] },
      "macro.3": { ...DEFAULT_MACROS["macro.3"], label: labels[2] },
      "macro.4": { ...DEFAULT_MACROS["macro.4"], label: labels[3] },
      "macro.5": { ...DEFAULT_MACROS["macro.5"] },
      "macro.6": { ...DEFAULT_MACROS["macro.6"] },
      "macro.7": { ...DEFAULT_MACROS["macro.7"] },
      "macro.8": { ...DEFAULT_MACROS["macro.8"] },
    };
  };
  const macroRoutes = (id: string, category: string): SynthModulationRoute[] => {
    if (category === "Template") return [];
    if (category === "Drum" || category === "Percussion") return [
      { id: `${id}.macro.punch`, source: "macro.1", target: "amp.level", amount: 0.18, bipolar: false, enabled: true },
      { id: `${id}.macro.tone`, source: "macro.2", target: "filter.cutoff", amount: 0.18, bipolar: false, enabled: true },
      { id: `${id}.macro.drive`, source: "macro.3", target: "filter.drive", amount: 0.2, bipolar: false, enabled: true },
      { id: `${id}.macro.decay`, source: "macro.4", target: "filter.resonance", amount: 0.12, bipolar: false, enabled: true },
    ];
    if (category === "Bass") return [
      { id: `${id}.macro.weight`, source: "macro.1", target: "osc.b.level", amount: 0.16, bipolar: false, enabled: true },
      { id: `${id}.macro.motion`, source: "macro.2", target: "filter.cutoff", amount: 0.18, bipolar: true, enabled: true },
      { id: `${id}.macro.drive`, source: "macro.3", target: "filter.drive", amount: 0.2, bipolar: false, enabled: true },
      { id: `${id}.macro.glide`, source: "macro.4", target: "osc.a.fine", amount: 0.08, bipolar: true, enabled: true },
    ];
    if (category === "Pad") return [
      { id: `${id}.macro.drift`, source: "macro.1", target: "osc.a.position", amount: 0.16, bipolar: true, enabled: true },
      { id: `${id}.macro.warmth`, source: "macro.2", target: "filter.cutoff", amount: -0.14, bipolar: false, enabled: true },
      { id: `${id}.macro.width`, source: "macro.3", target: "unison.spread", amount: 0.2, bipolar: false, enabled: true },
      { id: `${id}.macro.space`, source: "macro.4", target: "amp.pan", amount: 0.12, bipolar: true, enabled: true },
    ];
    if (category === "Lead") return [
      { id: `${id}.macro.motion`, source: "macro.1", target: "osc.a.position", amount: 0.16, bipolar: true, enabled: true },
      { id: `${id}.macro.bite`, source: "macro.2", target: "filter.drive", amount: 0.18, bipolar: false, enabled: true },
      { id: `${id}.macro.width`, source: "macro.3", target: "unison.spread", amount: 0.18, bipolar: false, enabled: true },
      { id: `${id}.macro.echo`, source: "macro.4", target: "amp.pan", amount: 0.1, bipolar: true, enabled: true },
    ];
    if (category === "FX" || category === "Texture") return [
      { id: `${id}.macro.motion`, source: "macro.1", target: "osc.a.position", amount: 0.22, bipolar: true, enabled: true },
      { id: `${id}.macro.bright`, source: "macro.2", target: "filter.cutoff", amount: 0.2, bipolar: false, enabled: true },
      { id: `${id}.macro.grit`, source: "macro.3", target: "filter.drive", amount: 0.2, bipolar: false, enabled: true },
      { id: `${id}.macro.space`, source: "macro.4", target: "unison.spread", amount: 0.18, bipolar: false, enabled: true },
    ];
    return [
      { id: `${id}.macro.motion`, source: "macro.1", target: "osc.a.position", amount: 0.14, bipolar: true, enabled: true },
      { id: `${id}.macro.tone`, source: "macro.2", target: "filter.cutoff", amount: 0.16, bipolar: false, enabled: true },
      { id: `${id}.macro.shape`, source: "macro.3", target: "filter.drive", amount: 0.14, bipolar: false, enabled: true },
      { id: `${id}.macro.space`, source: "macro.4", target: "amp.pan", amount: 0.08, bipolar: true, enabled: true },
    ];
  };
  const preset = (
    id: string,
    name: string,
    tags: string[],
    category: string,
    description: string,
    parameters: Partial<Record<SynthParameterId, SynthParameterValue>>,
    modulation: SynthModulationRoute[] = createDefaultSynthDraft().modulation,
    customWavetable: CustomWavetableDefinition = custom,
    closeout: {
      family?: string;
      role?: string;
      auditionNote?: string;
      effects?: TrackEffectChain;
      macros?: Record<MacroId, SynthMacroDefinition>;
      taxonomyId?: string;
    } = {},
  ): SynthFactoryPresetRecord => ({
    id,
    name,
    tags,
    category,
    description,
    family: closeout.family ?? category,
    role: closeout.role ?? category.toLowerCase(),
    auditionNote: closeout.auditionNote ?? `Audition ${name} in the ${category.toLowerCase()} register before release.`,
    patch: normalizeSynthDraftPatch({
      name,
      taxonomy: closeout.taxonomyId ? taxonomyAssignmentForInstrumentId(closeout.taxonomyId) : undefined,
      parameters,
      modulation: [...modulation, ...macroRoutes(id, category)],
      effects: closeout.effects,
      metadata: {
        createdBy: "Beat",
        tags,
        macros: closeout.macros ?? macroLayout(category),
        customWavetables: { [customWavetable.id]: customWavetable },
      },
    } as unknown as Partial<SynthDraftPatch>),
  });
  const pct = (value: number) => value / 100;
  const ms = (value: number) => value / 1000;

  return [
    preset(
      "factory.init",
      "Init",
      ["factory", "template"],
      "Template",
      "Neutral Aether starting point with no modulation routes.",
      {},
      [],
      custom,
      { family: "Template", role: "init patch", auditionNote: "Neutral-design baseline for building a patch, not a finished musical preset." },
    ),
    preset("factory.carbon-poly", "Carbon Poly", ["factory", "demo", "poly", "keys"], "Keys", "Warm modern polysynth keys with subtle wavetable motion and controlled stereo width.", {
      "osc.a.wavetable": DEFAULT_CUSTOM_WAVETABLE_ID,
      "osc.a.position": pct(24),
      "osc.a.warp": pct(18),
      "osc.a.warpMode": "shape",
      "osc.a.level": pct(72),
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.pulse",
      "osc.b.position": pct(38),
      "osc.b.fine": -4,
      "osc.b.level": pct(42),
      "unison.enabled": true,
      "unison.voices": 6,
      "unison.detune": pct(14),
      "unison.blend": pct(70),
      "unison.spread": pct(62),
      "filter.type": "lowpass",
      "filter.cutoff": 7500,
      "filter.resonance": pct(12),
      "filter.drive": pct(8),
      "filter.keytrack": pct(35),
      "env.1.attack": ms(12),
      "env.1.decay": ms(550),
      "env.1.sustain": pct(62),
      "env.1.release": ms(420),
      "env.2.attack": 0,
      "env.2.decay": ms(900),
      "env.2.sustain": 0,
      "env.2.release": ms(250),
      "lfo.1.enabled": true,
      "lfo.1.shape": "triangle",
      "lfo.1.sync": true,
      "lfo.1.syncedRate": "1/2",
      "lfo.1.smoothing": pct(20),
      "amp.level": pct(74),
    }, [
      { id: "carbon_poly_lfo_scan", source: "lfo.1", target: "osc.a.position", amount: 0.12, bipolar: true, enabled: true },
      { id: "carbon_poly_env_filter", source: "env.2", target: "filter.cutoff", amount: 0.18, bipolar: false, enabled: true },
      { id: "carbon_poly_velocity", source: "velocity", target: "amp.level", amount: 0.12, bipolar: false, enabled: true },
    ], custom, {
      family: "Poly Keys",
      role: "warm polysynth keys",
      taxonomyId: "poly_synth",
      auditionNote: "Audition medium chords around C3-C5; it should feel warm, playable, and lightly animated.",
      effects: { filters: [effect("factory.carbon-poly.chorus", "chorus", { rateHz: 0.25, depthMs: 6, delayMs: 12, feedback: 2, mix: 18 })] },
    }),
    preset("factory.glass-runner", "Glass Runner", ["factory", "demo", "pluck", "arp"], "Pluck", "Bright digital pluck for arpeggios and short melodic sequences.", {
      "osc.a.wavetable": DEFAULT_CUSTOM_WAVETABLE_ID,
      "osc.a.position": pct(58),
      "osc.a.warp": pct(36),
      "osc.a.warpMode": "pinch",
      "osc.a.level": pct(82),
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.triangle",
      "osc.b.octave": 1,
      "osc.b.level": pct(28),
      "filter.type": "lowpass",
      "filter.cutoff": 3200,
      "filter.resonance": pct(24),
      "filter.drive": pct(4),
      "filter.keytrack": pct(50),
      "env.1.attack": 0,
      "env.1.decay": ms(240),
      "env.1.sustain": 0,
      "env.1.release": ms(130),
      "env.2.attack": 0,
      "env.2.decay": ms(190),
      "env.2.sustain": 0,
      "env.2.release": ms(90),
      "lfo.1.enabled": true,
      "lfo.1.shape": "sine",
      "lfo.1.sync": true,
      "lfo.1.syncedRate": "1/8",
      "lfo.1.smoothing": pct(10),
      "amp.level": pct(72),
    }, [
      { id: "glass_runner_env_filter", source: "env.2", target: "filter.cutoff", amount: 0.38, bipolar: false, enabled: true },
      { id: "glass_runner_lfo_level", source: "lfo.1", target: "osc.b.level", amount: 0.1, bipolar: true, enabled: true },
    ], custom, {
      family: "Arp Pluck",
      role: "digital arpeggio pluck",
      taxonomyId: "wavetable_synth",
      auditionNote: "Audition fast sixteenth arpeggios around C4; attack should be crisp without a harsh click.",
      effects: { filters: [effect("factory.glass-runner.delay", "delay", { timeMs: 185, feedback: 24, mix: 14 })] },
    }),
    preset("factory.velvet-choir-pad", "Velvet Choir Pad", ["factory", "demo", "pad", "choir"], "Pad", "Wide evolving formant pad with slow modulation and aftertouch-style expression.", {
      "osc.a.wavetable": DEFAULT_CUSTOM_WAVETABLE_ID,
      "osc.a.position": pct(42),
      "osc.a.warp": pct(34),
      "osc.a.warpMode": "mirror",
      "osc.a.level": pct(64),
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.saw",
      "osc.b.octave": 1,
      "osc.b.fine": 7,
      "osc.b.level": pct(36),
      "unison.enabled": true,
      "unison.voices": 8,
      "unison.detune": pct(16),
      "unison.blend": pct(76),
      "unison.spread": pct(86),
      "filter.type": "lowpass",
      "filter.cutoff": 4800,
      "filter.resonance": pct(8),
      "filter.drive": pct(5),
      "filter.keytrack": pct(20),
      "env.1.attack": ms(1800),
      "env.1.decay": ms(3500),
      "env.1.sustain": pct(78),
      "env.1.release": ms(4200),
      "env.2.attack": ms(2500),
      "env.2.decay": ms(5000),
      "env.2.sustain": pct(45),
      "env.2.release": ms(3000),
      "lfo.1.enabled": true,
      "lfo.1.shape": "triangle",
      "lfo.1.sync": false,
      "lfo.1.rate": 0.06,
      "lfo.1.smoothing": pct(60),
      "lfo.2.enabled": true,
      "lfo.2.shape": "sine",
      "lfo.2.sync": false,
      "lfo.2.rate": 0.09,
      "lfo.2.smoothing": pct(70),
      "lfo.2.phase": 0.25,
      "amp.level": pct(58),
    }, [
      { id: "velvet_choir_lfo_a", source: "lfo.1", target: "osc.a.position", amount: 0.2, bipolar: true, enabled: true },
      { id: "velvet_choir_lfo_b", source: "lfo.2", target: "osc.b.pan", amount: 0.14, bipolar: true, enabled: true },
      { id: "velvet_choir_env_filter", source: "env.2", target: "filter.cutoff", amount: 0.12, bipolar: false, enabled: true },
    ], custom, {
      family: "Pad",
      role: "choir-like pad",
      taxonomyId: "pad_synth",
      auditionNote: "Audition slow triads and suspended chords; it should swell smoothly and avoid brittle highs.",
      effects: { filters: [effect("factory.velvet-choir-pad.chorus", "chorus", { rateHz: 0.18, depthMs: 9, delayMs: 18, feedback: 3, mix: 24 }), effect("factory.velvet-choir-pad.room", "reverb", { roomSize: 56, damping: 42, mix: 18 })] },
    }),
    preset("factory.factory-reese", "Factory Reese", ["factory", "demo", "bass", "reese"], "Bass", "Detuned mono bass with moving filter, distortion, and controlled stereo pressure.", {
      "osc.a.wavetable": "basic.saw",
      "osc.a.octave": -1,
      "osc.a.position": pct(36),
      "osc.a.warp": pct(28),
      "osc.a.level": pct(78),
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.saw",
      "osc.b.octave": -1,
      "osc.b.fine": -16,
      "osc.b.level": pct(64),
      "unison.enabled": true,
      "unison.voices": 3,
      "unison.detune": pct(18),
      "unison.blend": pct(72),
      "unison.spread": pct(52),
      "filter.type": "lowpass",
      "filter.cutoff": 1100,
      "filter.resonance": pct(18),
      "filter.drive": pct(28),
      "filter.keytrack": pct(10),
      "env.1.attack": ms(2),
      "env.1.decay": ms(350),
      "env.1.sustain": pct(88),
      "env.1.release": ms(90),
      "env.2.attack": 0,
      "env.2.decay": ms(260),
      "env.2.sustain": pct(20),
      "env.2.release": ms(80),
      "lfo.1.enabled": true,
      "lfo.1.shape": "triangle",
      "lfo.1.sync": true,
      "lfo.1.syncedRate": "1/4",
      "lfo.1.smoothing": pct(25),
      "lfo.2.enabled": true,
      "lfo.2.shape": "sine",
      "lfo.2.sync": true,
      "lfo.2.syncedRate": "1/2",
      "lfo.2.smoothing": pct(40),
      "lfo.2.phase": 0.25,
      "amp.level": pct(72),
      "mono.enabled": true,
      "glide.ms": 38,
    }, [
      { id: "factory_reese_lfo_filter", source: "lfo.1", target: "filter.cutoff", amount: 0.18, bipolar: true, enabled: true },
      { id: "factory_reese_lfo_pan", source: "lfo.2", target: "amp.pan", amount: 0.1, bipolar: true, enabled: true },
      { id: "factory_reese_env_drive", source: "env.2", target: "filter.drive", amount: 0.16, bipolar: false, enabled: true },
    ], custom, {
      family: "Bass",
      role: "detuned reese bass",
      taxonomyId: "reese_bass",
      auditionNote: "Audition sustained low notes around C1-C2; the bass should move without losing the center.",
      effects: { filters: [effect("factory.factory-reese.sat", "saturator", { drive: 18, mix: 68 }), effect("factory.factory-reese.hp", "highpass", { cutoffHz: 32, resonance: 0 })] },
    }),
    preset("factory.laser-brass-lead", "Laser Brass Lead", ["factory", "demo", "lead", "brass"], "Lead", "Sharp mono synth-brass lead with expressive filter movement and vibrato control.", {
      "osc.a.wavetable": "basic.saw",
      "osc.a.position": pct(44),
      "osc.a.warp": pct(32),
      "osc.a.level": pct(78),
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.pulse",
      "osc.b.semitone": 7,
      "osc.b.fine": -6,
      "osc.b.level": pct(36),
      "unison.enabled": true,
      "unison.voices": 2,
      "unison.detune": pct(8),
      "filter.type": "lowpass",
      "filter.cutoff": 2400,
      "filter.resonance": pct(28),
      "filter.drive": pct(18),
      "filter.keytrack": pct(35),
      "env.1.attack": 0,
      "env.1.decay": ms(420),
      "env.1.sustain": pct(74),
      "env.1.release": ms(110),
      "env.2.attack": 0,
      "env.2.decay": ms(280),
      "env.2.sustain": 0,
      "env.2.release": ms(80),
      "lfo.1.enabled": true,
      "lfo.1.shape": "sine",
      "lfo.1.sync": false,
      "lfo.1.rate": 5.5,
      "lfo.1.smoothing": pct(35),
      "amp.level": pct(70),
      "mono.enabled": true,
      "legato.enabled": true,
      "glide.ms": 42,
    }, [
      { id: "laser_brass_env_filter", source: "env.2", target: "filter.cutoff", amount: 0.34, bipolar: false, enabled: true },
      { id: "laser_brass_lfo_pitch", source: "lfo.1", target: "osc.a.fine", amount: 0.04, bipolar: true, enabled: true },
      { id: "laser_brass_modwheel", source: "modWheel", target: "filter.resonance", amount: 0.18, bipolar: false, enabled: true },
    ], custom, {
      family: "Lead",
      role: "mono synth brass lead",
      taxonomyId: "lead_synth",
      auditionNote: "Audition single-note hooks around C4-C5; the filter should bark without collapsing into harshness.",
      effects: { filters: [effect("factory.laser-brass-lead.delay", "delay", { timeMs: 225, feedback: 18, mix: 10 })] },
    }),
    preset("factory.frozen-bell-stack", "Frozen Bell Stack", ["factory", "demo", "bell", "keys"], "Keys", "Icy mallet and music-box hybrid with shimmer and velocity-sensitive brightness.", {
      "osc.a.wavetable": DEFAULT_CUSTOM_WAVETABLE_ID,
      "osc.a.position": pct(76),
      "osc.a.warp": pct(26),
      "osc.a.warpMode": "pinch",
      "osc.a.level": pct(70),
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.sine",
      "osc.b.octave": 1,
      "osc.b.semitone": 7,
      "osc.b.level": pct(34),
      "filter.type": "lowpass",
      "filter.cutoff": 8500,
      "filter.resonance": pct(6),
      "filter.drive": 0,
      "filter.keytrack": pct(70),
      "env.1.attack": 0,
      "env.1.decay": ms(1400),
      "env.1.sustain": 0,
      "env.1.release": ms(1800),
      "env.2.attack": 0,
      "env.2.decay": ms(520),
      "env.2.sustain": 0,
      "env.2.release": ms(300),
      "lfo.1.enabled": true,
      "lfo.1.shape": "sine",
      "lfo.1.sync": true,
      "lfo.1.syncedRate": "1/2",
      "lfo.1.smoothing": pct(50),
      "amp.level": pct(62),
    }, [
      { id: "frozen_bell_velocity", source: "velocity", target: "filter.cutoff", amount: 0.22, bipolar: false, enabled: true },
      { id: "frozen_bell_lfo_pan", source: "lfo.1", target: "amp.pan", amount: 0.1, bipolar: true, enabled: true },
    ], custom, {
      family: "Bell",
      role: "icy bell keys",
      taxonomyId: "wavetable_synth",
      auditionNote: "Audition sparse notes and high-register intervals; it should shimmer without turning into noise.",
      effects: { filters: [effect("factory.frozen-bell-stack.room", "reverb", { roomSize: 62, damping: 34, mix: 22 })] },
    }),
    preset("factory.analog-dust-pad", "Analog Dust Pad", ["factory", "demo", "pad", "lo-fi"], "Pad", "Tape-worn vintage pad with pitch drift, chorus, and softened highs.", {
      "osc.a.wavetable": DEFAULT_CUSTOM_WAVETABLE_ID,
      "osc.a.position": pct(18),
      "osc.a.warp": pct(22),
      "osc.a.warpMode": "mirror",
      "osc.a.level": pct(62),
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.pulse",
      "osc.b.fine": 9,
      "osc.b.level": pct(3),
      "unison.enabled": true,
      "unison.voices": 5,
      "unison.detune": pct(18),
      "unison.blend": pct(78),
      "unison.spread": pct(74),
      "filter.type": "lowpass",
      "filter.cutoff": 2800,
      "filter.resonance": pct(9),
      "filter.drive": pct(12),
      "filter.keytrack": pct(20),
      "env.1.attack": ms(950),
      "env.1.decay": ms(2200),
      "env.1.sustain": pct(70),
      "env.1.release": ms(2800),
      "env.2.attack": ms(1400),
      "env.2.decay": ms(3000),
      "env.2.sustain": pct(35),
      "env.2.release": ms(2000),
      "lfo.1.enabled": true,
      "lfo.1.shape": "sine",
      "lfo.1.sync": false,
      "lfo.1.rate": 0.35,
      "lfo.1.smoothing": pct(70),
      "lfo.2.enabled": true,
      "lfo.2.shape": "square",
      "lfo.2.sync": false,
      "lfo.2.rate": 0.18,
      "lfo.2.smoothing": pct(80),
      "lfo.2.randomPhase": pct(60),
      "amp.level": pct(58),
    }, [
      { id: "analog_dust_lfo_pitch", source: "lfo.1", target: "osc.a.fine", amount: 0.06, bipolar: true, enabled: true },
      { id: "analog_dust_lfo_scan", source: "lfo.2", target: "osc.a.position", amount: 0.18, bipolar: true, enabled: true },
      { id: "analog_dust_env_filter", source: "env.2", target: "filter.cutoff", amount: 0.12, bipolar: false, enabled: true },
    ], custom, {
      family: "Lo-Fi Pad",
      role: "vintage pad",
      taxonomyId: "pad_synth",
      auditionNote: "Audition sustained minor chords; the drift should read as worn tape rather than tuning failure.",
      effects: { filters: [effect("factory.analog-dust-pad.chorus", "chorus", { rateHz: 0.22, depthMs: 10, delayMs: 16, feedback: 2, mix: 22 }), effect("factory.analog-dust-pad.lowpass", "lowpass", { cutoffHz: 7200, resonance: 0 })] },
    }),
    preset("factory.neon-chord-stab", "Neon Chord Stab", ["factory", "demo", "keys", "stab"], "Keys", "Short house and garage-style chord stab with filter snap and rhythmic movement.", {
      "osc.a.wavetable": "basic.saw",
      "osc.a.position": pct(46),
      "osc.a.warp": pct(28),
      "osc.a.level": pct(74),
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.pulse",
      "osc.b.semitone": 7,
      "osc.b.level": pct(32),
      "unison.enabled": true,
      "unison.voices": 4,
      "unison.detune": pct(12),
      "unison.blend": pct(62),
      "unison.spread": pct(64),
      "filter.type": "lowpass",
      "filter.cutoff": 1800,
      "filter.resonance": pct(20),
      "filter.drive": pct(14),
      "filter.keytrack": pct(25),
      "env.1.attack": 0,
      "env.1.decay": ms(320),
      "env.1.sustain": pct(18),
      "env.1.release": ms(170),
      "env.2.attack": 0,
      "env.2.decay": ms(260),
      "env.2.sustain": 0,
      "env.2.release": ms(100),
      "lfo.1.enabled": true,
      "lfo.1.shape": "saw",
      "lfo.1.sync": true,
      "lfo.1.syncedRate": "1/4",
      "lfo.1.smoothing": pct(15),
      "amp.level": pct(66),
    }, [
      { id: "neon_stab_env_filter", source: "env.2", target: "filter.cutoff", amount: 0.42, bipolar: false, enabled: true },
      { id: "neon_stab_lfo_pan", source: "lfo.1", target: "amp.pan", amount: 0.1, bipolar: true, enabled: true },
    ], custom, {
      family: "Chord Stab",
      role: "house chord stab",
      taxonomyId: "poly_synth",
      auditionNote: "Audition short chord hits around C3-C4; it should be punchy, bright, and not overly sustained.",
      effects: { filters: [effect("factory.neon-chord-stab.delay", "delay", { timeMs: 250, feedback: 18, mix: 12 })] },
    }),
    preset("factory.sub-anchor", "Sub Anchor", ["factory", "demo", "bass", "sub"], "Bass", "Clean mono sub bass with subtle harmonic edge and a short pitch transient.", {
      "osc.a.wavetable": "basic.sine",
      "osc.a.octave": -2,
      "osc.a.level": pct(92),
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.triangle",
      "osc.b.octave": -1,
      "osc.b.level": pct(24),
      "filter.type": "lowpass",
      "filter.cutoff": 900,
      "filter.resonance": pct(4),
      "filter.drive": pct(10),
      "filter.keytrack": pct(15),
      "env.1.attack": ms(4),
      "env.1.decay": ms(180),
      "env.1.sustain": 1,
      "env.1.release": ms(80),
      "env.2.attack": 0,
      "env.2.decay": ms(120),
      "env.2.sustain": 0,
      "env.2.release": ms(50),
      "lfo.1.enabled": false,
      "lfo.2.enabled": false,
      "amp.level": pct(82),
      "mono.enabled": true,
      "glide.ms": 18,
    }, [
      { id: "sub_anchor_env_pitch", source: "env.2", target: "osc.a.fine", amount: 0.18, bipolar: false, enabled: true },
      { id: "sub_anchor_velocity", source: "velocity", target: "amp.level", amount: 0.1, bipolar: false, enabled: true },
    ], custom, {
      family: "Sub Bass",
      role: "clean mono sub",
      taxonomyId: "sub_bass",
      auditionNote: "Audition simple C1 bass notes; it should stay clean, centered, and usable under drums.",
      effects: { filters: [effect("factory.sub-anchor.comp", "compressor", { thresholdDb: -20, ratio: 4, attackMs: 12, releaseMs: 120, makeupDb: 1, mix: 86 })] },
    }),
    preset("factory.scanner-drone", "Scanner Drone", ["factory", "demo", "texture", "drone"], "Texture", "Slow evolving drone with wavetable scanning, resonant filtering, and granular-style motion.", {
      "osc.a.wavetable": DEFAULT_CUSTOM_WAVETABLE_ID,
      "osc.a.position": pct(64),
      "osc.a.warp": pct(52),
      "osc.a.warpMode": "mirror",
      "osc.a.level": pct(58),
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.saw",
      "osc.b.octave": -1,
      "osc.b.fine": 11,
      "osc.b.level": pct(32),
      "unison.enabled": true,
      "unison.voices": 7,
      "unison.detune": pct(22),
      "unison.blend": pct(74),
      "unison.spread": pct(90),
      "filter.type": "bandpass",
      "filter.cutoff": 1600,
      "filter.resonance": pct(35),
      "filter.drive": pct(16),
      "filter.keytrack": 0,
      "env.1.attack": ms(650),
      "env.1.decay": ms(3800),
      "env.1.sustain": pct(85),
      "env.1.release": ms(4200),
      "env.2.attack": ms(900),
      "env.2.decay": ms(4500),
      "env.2.sustain": pct(40),
      "env.2.release": ms(3800),
      "lfo.1.enabled": true,
      "lfo.1.shape": "triangle",
      "lfo.1.sync": false,
      "lfo.1.rate": 0.03,
      "lfo.1.smoothing": pct(80),
      "lfo.2.enabled": true,
      "lfo.2.shape": "square",
      "lfo.2.sync": false,
      "lfo.2.rate": 0.07,
      "lfo.2.smoothing": pct(85),
      "lfo.2.randomPhase": pct(70),
      "amp.level": pct(68),
    }, [
      { id: "scanner_drone_lfo_scan", source: "lfo.1", target: "osc.a.position", amount: 0.34, bipolar: true, enabled: true },
      { id: "scanner_drone_lfo_filter", source: "lfo.2", target: "filter.cutoff", amount: 0.22, bipolar: true, enabled: true },
      { id: "scanner_drone_env_space", source: "env.2", target: "unison.spread", amount: 0.1, bipolar: false, enabled: true },
    ], custom, {
      family: "Atmosphere",
      role: "slow scanning drone",
      taxonomyId: "wavetable_synth",
      auditionNote: "Audition long held notes; the patch should evolve slowly without pulsing like an obvious LFO.",
      effects: { filters: [effect("factory.scanner-drone.flanger", "flanger", { rateHz: 0.08, depthMs: 3.2, delayMs: 4.5, feedback: 18, mix: 16 }), effect("factory.scanner-drone.room", "reverb", { roomSize: 70, damping: 38, mix: 24 })] },
    }),
    preset("factory.custom-table", "Custom Wavetable", ["factory", "wavetable"], "Wavetable", "Animated custom wavemap patch with envelope-filter movement.", {
      "osc.a.wavetable": DEFAULT_CUSTOM_WAVETABLE_ID,
      "osc.a.position": 0.35,
      "osc.a.level": 0.82,
      "filter.cutoff": 8200,
      "filter.resonance": 0.12,
      "amp.level": 0.82,
    }, [
      { id: "lfo_custom_pos", source: "lfo.1", target: "osc.a.position", amount: 0.18, bipolar: true, enabled: true },
      { id: "env_custom_filter", source: "env.1", target: "filter.cutoff", amount: 0.18, bipolar: false, enabled: true },
    ], custom, { family: "Wavetable", role: "animated wavemap bed", auditionNote: "Audition as a mid-register sustained chord and verify the wavemap drift reads without pitch wobble." }),
    preset("factory.wt-lead", "WT Lead", ["factory", "lead"], "Lead", "Bright stacked wavetable lead with unison motion and filter push.", {
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
    ], custom, { family: "Lead", role: "bright mono/poly lead", auditionNote: "Audition around C4-C5 with short melodic phrases; should cut through without harsh clipping." }),
    preset("factory.glass-pad", "Glass Pad", ["factory", "pad"], "Pad", "Wide glassy pad with slow wavetable drift and soft envelope lift.", {
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
    ], custom, { family: "Pad", role: "wide sustained pad", auditionNote: "Audition as slow three-note chords; attack and release should feel smooth without vanishing." }),
    preset("factory.sub-bass", "Sub Bass", ["factory", "bass"], "Bass", "Sub-forward square and sine stack with envelope-shaped drive.", {
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
    ], custom, { family: "Bass", role: "sub bass", auditionNote: "Audition around C1-C2; fundamental should stay strong while drive remains controlled." }),
    preset("factory.pluck", "Digital Pluck", ["factory", "pluck"], "Pluck", "Short digital pluck with octave support and envelope-opened filter.", {
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
    ], custom, { family: "Pluck", role: "short digital pluck", auditionNote: "Audition arpeggios around C3-C5; transient should speak clearly without excessive click." }),
    preset("factory.velvet-keys", "Velvet Keys", ["factory", "keys", "warm"], "Keys", "Warm key-style Aether patch with gentle triangle support and velocity-friendly filter movement.", {
      "osc.a.wavetable": "basic.triangle",
      "osc.a.position": 0.36,
      "osc.a.level": 0.72,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.sine",
      "osc.b.position": 0.18,
      "osc.b.semitone": 12,
      "osc.b.level": 0.24,
      "filter.cutoff": 5200,
      "filter.resonance": 0.16,
      "filter.drive": 0.05,
      "env.1.attack": 0.012,
      "env.1.decay": 0.42,
      "env.1.sustain": 0.48,
      "env.1.release": 0.38,
      "lfo.1.rate": 0.2,
      "amp.level": 0.72,
    }, [
      { id: "keys_env_filter", source: "env.1", target: "filter.cutoff", amount: 0.24, bipolar: false, enabled: true },
      { id: "keys_velocity_level", source: "velocity", target: "amp.level", amount: 0.18, bipolar: false, enabled: true },
    ], custom, { family: "Keys", role: "warm chord keys", auditionNote: "Audition compact seventh chords around C3-C4; should feel playable and not pad-like." }),
    preset("factory.carbon-texture", "Carbon Texture", ["factory", "texture", "cinematic"], "Texture", "Noisy folded wavetable texture for risers, drones, and cinematic motion beds.", {
      "osc.a.wavetable": "basic.pulse",
      "osc.a.position": 0.68,
      "osc.a.warp": 0.48,
      "osc.a.warpMode": "fold",
      "osc.a.level": 0.62,
      "osc.b.enabled": true,
      "osc.b.wavetable": DEFAULT_CUSTOM_WAVETABLE_ID,
      "osc.b.position": 0.72,
      "osc.b.level": 0.34,
      "unison.enabled": true,
      "unison.voices": 4,
      "unison.detune": 0.16,
      "unison.spread": 0.72,
      "filter.cutoff": 3600,
      "filter.resonance": 0.28,
      "filter.drive": 0.2,
      "aether.runtimeWarp": 0.24,
      "aether.runtimeWarpMode": "mirror",
      "env.1.attack": 0.42,
      "env.1.decay": 1.2,
      "env.1.sustain": 0.7,
      "env.1.release": 2.4,
      "lfo.1.rate": 0.16,
      "amp.level": 0.58,
    }, [
      { id: "texture_lfo_pos", source: "lfo.1", target: "osc.a.position", amount: 0.32, bipolar: true, enabled: true },
      { id: "texture_lfo_filter", source: "lfo.1", target: "filter.cutoff", amount: 0.18, bipolar: true, enabled: true },
      { id: "texture_env_drive", source: "env.2", target: "filter.drive", amount: 0.12, bipolar: false, enabled: true },
    ], custom, { family: "Texture", role: "cinematic motion bed", auditionNote: "Audition held notes and slow automation; should create motion without masking the whole mix." }),
    preset("factory.razor-perc", "Razor Perc", ["factory", "percussion", "breakcore"], "Percussion", "Short metallic Aether percussion hit for synthetic drums, accents, and chopped breakcore layers.", {
      "osc.a.wavetable": "basic.pulse",
      "osc.a.position": 0.82,
      "osc.a.warp": 0.52,
      "osc.a.warpMode": "pinch",
      "osc.a.level": 0.78,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.square",
      "osc.b.position": 0.64,
      "osc.b.semitone": 7,
      "osc.b.fine": 18,
      "osc.b.level": 0.34,
      "filter.cutoff": 9200,
      "filter.resonance": 0.42,
      "filter.drive": 0.32,
      "aether.runtimeWarp": 0.18,
      "aether.runtimeWarpMode": "fold",
      "env.1.attack": 0.001,
      "env.1.decay": 0.09,
      "env.1.sustain": 0.02,
      "env.1.release": 0.08,
      "amp.level": 0.7,
    }, [
      { id: "perc_env_filter", source: "env.1", target: "filter.cutoff", amount: 0.34, bipolar: false, enabled: true },
      { id: "perc_velocity_drive", source: "velocity", target: "filter.drive", amount: 0.18, bipolar: false, enabled: true },
    ], custom, { family: "Percussion", role: "metallic synthetic hit", auditionNote: "Audition as sixteenth-note accents and one-shot hits; should be sharp without turning into broadband noise." }),
    preset("factory.reese-bass", "Reese Bass", ["factory", "bass", "dnb"], "Bass", "Detuned dual-oscillator bass for drum and bass and breakcore foundations.", {
      "osc.a.wavetable": "basic.saw",
      "osc.a.octave": -1,
      "osc.a.position": 0.5,
      "osc.a.warp": 0.28,
      "osc.a.level": 0.76,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.square",
      "osc.b.octave": -1,
      "osc.b.fine": -14,
      "osc.b.level": 0.58,
      "unison.enabled": true,
      "unison.voices": 3,
      "unison.detune": 0.16,
      "unison.blend": 0.62,
      "filter.cutoff": 2600,
      "filter.resonance": 0.22,
      "filter.drive": 0.32,
      "aether.runtimeWarp": 0.18,
      "aether.runtimeWarpMode": "mirror",
      "env.1.attack": 0.006,
      "env.1.decay": 0.28,
      "env.1.sustain": 0.72,
      "env.1.release": 0.14,
      "lfo.1.syncedRate": "1/2",
      "amp.level": 0.72,
      "mono.enabled": true,
      "glide.ms": 45,
    }, [
      { id: "reese_lfo_filter", source: "lfo.1", target: "filter.cutoff", amount: 0.18, bipolar: true, enabled: true },
      { id: "reese_lfo_pan", source: "lfo.1", target: "amp.pan", amount: 0.12, bipolar: true, enabled: true },
    ], custom, {
      family: "Bass",
      role: "detuned bass",
      auditionNote: "Audition C1-C2 sustained basslines; movement should be audible but the low end should stay centered.",
      effects: { filters: [effect("factory.reese-bass.hp", "highpass", { cutoffHz: 35, resonance: 0 }), effect("factory.reese-bass.sat", "saturator", { drive: 16, mix: 62 })] },
    }),
    preset("factory.acid-line", "Acid Line", ["factory", "bass", "lead", "acid"], "Bass", "Resonant mono line with glide for simple acid hooks and bass riffs.", {
      "osc.a.wavetable": "basic.pulse",
      "osc.a.octave": -1,
      "osc.a.position": 0.7,
      "osc.a.warp": 0.36,
      "osc.a.level": 0.84,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.saw",
      "osc.b.level": 0.28,
      "filter.cutoff": 1700,
      "filter.resonance": 0.62,
      "filter.drive": 0.26,
      "env.1.attack": 0.002,
      "env.1.decay": 0.2,
      "env.1.sustain": 0.32,
      "env.1.release": 0.08,
      "amp.level": 0.7,
      "mono.enabled": true,
      "legato.enabled": true,
      "glide.ms": 72,
    }, [
      { id: "acid_env_filter", source: "env.1", target: "filter.cutoff", amount: 0.48, bipolar: false, enabled: true },
      { id: "acid_mod_res", source: "modWheel", target: "filter.resonance", amount: 0.22, bipolar: false, enabled: true },
    ], custom, { family: "Bass", role: "acid mono line", auditionNote: "Audition short C2-C4 patterns with slides; filter should bite without masking pitch." }),
    preset("factory.hollow-lead", "Hollow Lead", ["factory", "lead", "melody"], "Lead", "Hollow wavetable lead with octave support for hooks and counterlines.", {
      "osc.a.wavetable": DEFAULT_CUSTOM_WAVETABLE_ID,
      "osc.a.position": 0.72,
      "osc.a.warp": 0.34,
      "osc.a.warpMode": "mirror",
      "osc.a.level": 0.8,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.triangle",
      "osc.b.semitone": 12,
      "osc.b.level": 0.24,
      "unison.enabled": true,
      "unison.voices": 4,
      "unison.detune": 0.12,
      "unison.spread": 0.74,
      "filter.cutoff": 5400,
      "filter.resonance": 0.28,
      "filter.drive": 0.12,
      "env.1.attack": 0.006,
      "env.1.decay": 0.18,
      "env.1.sustain": 0.64,
      "env.1.release": 0.2,
      "amp.level": 0.7,
    }, [
      { id: "hollow_lfo_pos", source: "lfo.1", target: "osc.a.position", amount: 0.2, bipolar: true, enabled: true },
      { id: "hollow_velocity_filter", source: "velocity", target: "filter.cutoff", amount: 0.16, bipolar: false, enabled: true },
    ], custom, {
      family: "Lead",
      role: "melodic lead",
      auditionNote: "Audition single-note hooks around C4-C5; tone should feel animated while staying stable.",
      effects: { filters: [effect("factory.hollow-lead.delay", "delay", { timeMs: 185, feedback: 20, mix: 12 })] },
    }),
    preset("factory.warm-string-pad", "Warm String Pad", ["factory", "pad", "strings"], "Pad", "Slow stacked pad for harmonic beds and chorus support.", {
      "osc.a.wavetable": "basic.saw",
      "osc.a.position": 0.38,
      "osc.a.warp": 0.18,
      "osc.a.level": 0.58,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.triangle",
      "osc.b.octave": 1,
      "osc.b.fine": 6,
      "osc.b.level": 0.34,
      "unison.enabled": true,
      "unison.voices": 6,
      "unison.detune": 0.18,
      "unison.blend": 0.78,
      "unison.spread": 0.84,
      "filter.cutoff": 3100,
      "filter.resonance": 0.14,
      "env.1.attack": 0.36,
      "env.1.decay": 1.1,
      "env.1.sustain": 0.78,
      "env.1.release": 1.8,
      "lfo.1.syncedRate": "1",
      "amp.level": 0.58,
    }, [
      { id: "string_lfo_cutoff", source: "lfo.1", target: "filter.cutoff", amount: 0.12, bipolar: true, enabled: true },
      { id: "string_lfo_detune", source: "lfo.1", target: "unison.detune", amount: 0.04, bipolar: false, enabled: true },
    ], custom, {
      family: "Pad",
      role: "warm string pad",
      auditionNote: "Audition sustained chords around C3-C5; should support harmony without a sharp attack.",
      effects: { filters: [effect("factory.warm-string-pad.chorus", "chorus", { rateHz: 0.32, depthMs: 7, delayMs: 14, feedback: 4, mix: 24 }), effect("factory.warm-string-pad.room", "reverb", { roomSize: 48, damping: 42, mix: 18 })] },
    }),
    preset("factory.noise-riser", "Noise Riser", ["factory", "fx", "transition"], "FX", "Moving bright texture for short transitions and generated fills.", {
      "osc.a.wavetable": DEFAULT_CUSTOM_WAVETABLE_ID,
      "osc.a.position": 0.86,
      "osc.a.warp": 0.74,
      "osc.a.warpMode": "fold",
      "osc.a.level": 0.56,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.pulse",
      "osc.b.octave": 1,
      "osc.b.position": 0.94,
      "osc.b.level": 0.22,
      "unison.enabled": true,
      "unison.voices": 5,
      "unison.detune": 0.26,
      "filter.type": "highpass",
      "filter.cutoff": 4200,
      "filter.resonance": 0.36,
      "filter.drive": 0.22,
      "aether.runtimeWarp": 0.4,
      "aether.runtimeWarpMode": "pinch",
      "env.1.attack": 0.22,
      "env.1.decay": 0.72,
      "env.1.sustain": 0.66,
      "env.1.release": 1.1,
      "lfo.1.syncedRate": "1/2",
      "amp.level": 0.46,
    }, [
      { id: "riser_lfo_pos", source: "lfo.1", target: "osc.a.position", amount: 0.34, bipolar: true, enabled: true },
      { id: "riser_env_filter", source: "env.1", target: "filter.cutoff", amount: 0.36, bipolar: false, enabled: true },
    ], custom, {
      family: "FX",
      role: "transition riser",
      auditionNote: "Audition held notes and one-bar transitions; should add motion without becoming full-volume noise.",
      effects: { filters: [effect("factory.noise-riser.flanger", "flanger", { rateHz: 0.18, depthMs: 2.4, delayMs: 2.8, feedback: 34, mix: 28 }), effect("factory.noise-riser.bit", "bitcrush", { bits: 10, rate: 62, mix: 14 })] },
    }),
  ];
}

export const FACTORY_SYNTH_PRESETS: SynthFactoryPresetRecord[] = createFactorySynthPresets();

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
    morph: sanitize01(value.morph, 0),
    source: sanitizeWavemapSource(value.source, fallback.source),
    frames,
  };
}

function sanitizeCustomWavetableFrame(
  value: unknown,
  fallback: CustomWavetableFrame = { brightness: 0.5, even: 0.2, fold: 0.1, formant: 0.12, notch: 0.08, skew: 0, tilt: 0, focus: 0.35, phase: 0 },
): CustomWavetableFrame {
  const source = isRecord(value) ? value : {};
  const partials = sanitizeCustomWavetablePartials(source.partials, fallback.partials);
  const next: CustomWavetableFrame = {
    id: typeof source.id === "string" && source.id.trim() ? source.id.trim().slice(0, 64) : fallback.id,
    label: typeof source.label === "string" && source.label.trim() ? source.label.trim().slice(0, 16) : fallback.label,
    position: sanitize01(source.position, fallback.position ?? 0),
    brightness: sanitize01(source.brightness, fallback.brightness),
    even: sanitize01(source.even, fallback.even),
    fold: sanitize01(source.fold, fallback.fold),
    formant: sanitize01(source.formant, fallback.formant),
    notch: sanitize01(source.notch, fallback.notch),
    skew: sanitizeBipolar(source.skew, fallback.skew),
    tilt: sanitizeBipolar(source.tilt, fallback.tilt),
    focus: sanitize01(source.focus, fallback.focus),
    phase: sanitizeBipolar(source.phase, fallback.phase),
  };
  if (partials) next.partials = partials;
  const analysis = sanitizeWavemapFrameAnalysis(source.analysis, fallback.analysis);
  if (analysis) next.analysis = analysis;
  return next;
}

function sanitizeCustomWavetablePartials(value: unknown, fallback?: number[]): number[] | undefined {
  const source = Array.isArray(value) ? value : fallback;
  if (!Array.isArray(source)) return undefined;
  return Array.from({ length: CUSTOM_WAVETABLE_PARTIAL_COUNT }, (_, index) => sanitize01(source[index], 0));
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
  if (typeof source.channelCount === "number" && Number.isFinite(source.channelCount) && source.channelCount > 0) next.channelCount = Math.floor(source.channelCount);
  else if (fallback.channelCount) next.channelCount = fallback.channelCount;
  if (typeof source.bitDepth === "number" && Number.isFinite(source.bitDepth) && source.bitDepth > 0) next.bitDepth = Math.floor(source.bitDepth);
  else if (fallback.bitDepth) next.bitDepth = fallback.bitDepth;
  if (typeof source.sourceSampleCount === "number" && Number.isFinite(source.sourceSampleCount) && source.sourceSampleCount >= 0) next.sourceSampleCount = Math.floor(source.sourceSampleCount);
  else if (fallback.sourceSampleCount != null) next.sourceSampleCount = fallback.sourceSampleCount;
  if (typeof source.analyzedSampleCount === "number" && Number.isFinite(source.analyzedSampleCount) && source.analyzedSampleCount >= 0) next.analyzedSampleCount = Math.floor(source.analyzedSampleCount);
  else if (fallback.analyzedSampleCount != null) next.analyzedSampleCount = fallback.analyzedSampleCount;
  if (typeof source.frameCount === "number" && Number.isFinite(source.frameCount) && source.frameCount > 0) next.frameCount = Math.floor(source.frameCount);
  else if (fallback.frameCount) next.frameCount = fallback.frameCount;
  if (typeof source.sourceStartSample === "number" && Number.isFinite(source.sourceStartSample)) next.sourceStartSample = Math.max(0, Math.floor(source.sourceStartSample));
  else if (fallback.sourceStartSample != null) next.sourceStartSample = fallback.sourceStartSample;
  if (typeof source.sourceEndSample === "number" && Number.isFinite(source.sourceEndSample)) next.sourceEndSample = Math.max(0, Math.floor(source.sourceEndSample));
  else if (fallback.sourceEndSample != null) next.sourceEndSample = fallback.sourceEndSample;
  if (typeof source.createdAt === "number" && Number.isFinite(source.createdAt) && source.createdAt > 0) next.createdAt = source.createdAt;
  else if (fallback.createdAt) next.createdAt = fallback.createdAt;
  return next;
}

function sanitizeWavemapFrameAnalysis(value: unknown, fallback?: WavemapFrameAnalysis): WavemapFrameAnalysis | undefined {
  const source = isRecord(value) ? value : {};
  if (!isRecord(value) && !fallback) return undefined;
  const next: WavemapFrameAnalysis = {
    rms: sanitize01(source.rms, fallback?.rms ?? 0),
    peak: sanitize01(source.peak, fallback?.peak ?? 0),
    zeroCrossRate: sanitize01(source.zeroCrossRate, fallback?.zeroCrossRate ?? 0),
    roughness: sanitize01(source.roughness, fallback?.roughness ?? 0),
    asymmetry: sanitize01(source.asymmetry, fallback?.asymmetry ?? 0),
    spectralCentroid: sanitizeFinite(source.spectralCentroid, fallback?.spectralCentroid ?? 0, 0, 128),
    dominantHarmonic: Math.max(0, Math.min(128, Math.round(sanitizeFinite(source.dominantHarmonic, fallback?.dominantHarmonic ?? 0, 0, 128)))),
    dominantPhase: sanitizeFinite(source.dominantPhase, fallback?.dominantPhase ?? 0, -Math.PI, Math.PI),
  };
  if (typeof source.sourceStartSample === "number" && Number.isFinite(source.sourceStartSample))
    next.sourceStartSample = Math.max(0, Math.floor(source.sourceStartSample));
  else if (fallback?.sourceStartSample != null)
    next.sourceStartSample = fallback.sourceStartSample;
  if (typeof source.sourceEndSample === "number" && Number.isFinite(source.sourceEndSample))
    next.sourceEndSample = Math.max(0, Math.floor(source.sourceEndSample));
  else if (fallback?.sourceEndSample != null)
    next.sourceEndSample = fallback.sourceEndSample;
  return next;
}

function sanitizeFinite(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, number));
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
  if (Object.prototype.hasOwnProperty.call(source, "formant"))
    next.formant = sanitize01(source.formant, 0.12);
  if (Object.prototype.hasOwnProperty.call(source, "notch"))
    next.notch = sanitize01(source.notch, 0.08);
  if (Object.prototype.hasOwnProperty.call(source, "skew"))
    next.skew = sanitizeBipolar(source.skew, 0);
  if (Object.prototype.hasOwnProperty.call(source, "tilt"))
    next.tilt = sanitizeBipolar(source.tilt, 0);
  if (Object.prototype.hasOwnProperty.call(source, "focus"))
    next.focus = sanitize01(source.focus, 0.35);
  if (Object.prototype.hasOwnProperty.call(source, "phase"))
    next.phase = sanitizeBipolar(source.phase, 0);
  if (Object.prototype.hasOwnProperty.call(source, "partials"))
    next.partials = sanitizeCustomWavetablePartials(source.partials) ?? [];
  if (Object.prototype.hasOwnProperty.call(source, "analysis"))
    next.analysis = sanitizeWavemapFrameAnalysis(source.analysis);
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
  return {
    bank: bankFromWavetableId(wavetableId),
    customId: wavetableId.startsWith("user.") ? wavetableId : undefined,
    position: clamp01(getNumberParam(draft, `osc.${oscillator}.position` as SynthParameterId)),
    warp: getNumberParam(draft, `osc.${oscillator}.warp` as SynthParameterId),
    warpMode: isWavetableWarpMode(warpMode) ? warpMode : "shape",
    unison: getNumberParam(draft, `osc.${oscillator}.unison.voices` as OscillatorUnisonParameterId),
    detuneCents: clamp01(getNumberParam(draft, `osc.${oscillator}.unison.detune` as OscillatorUnisonParameterId)) * 100,
    blend: clamp01(getNumberParam(draft, `osc.${oscillator}.unison.spread` as OscillatorUnisonParameterId)),
  };
}

function lfoWaveformFromDraft(draft: SynthDraftPatch, lfo: 1 | 2 = 1): NonNullable<Instrument["lfoWaveform"]> {
  const shape = getStringParam(draft, `lfo.${lfo}.shape` as SynthParameterId);
  return shape === "triangle" || shape === "saw" || shape === "square" ? shape : "sine";
}

function filterTypeFromDraft(draft: SynthDraftPatch): NonNullable<Instrument["filterType"]> {
  return filterTypeFromId(getStringParam(draft, "filter.type"));
}

function filterTypeFromId(type: string): NonNullable<Instrument["filterType"]> {
  return type === "bandpass" || type === "highpass" ? type : "lowpass";
}

function oscillatorFromDraft(draft: SynthDraftPatch, oscillator: OscillatorKey, wavetable: WavetableConfig) {
  const prefix = `osc.${oscillator}`;
  return {
    enabled: getBooleanParam(draft, `osc.${oscillator}.enabled` as SynthParameterId),
    level: clamp01(getNumberParam(draft, `${prefix}.level` as SynthParameterId)),
    pan: clampBipolar(getNumberParam(draft, `${prefix}.pan` as SynthParameterId)),
    waveform: "wavetable" as const,
    octave: getNumberParam(draft, `osc.${oscillator}.octave` as SynthParameterId),
    semitone: getNumberParam(draft, `osc.${oscillator}.semitone` as SynthParameterId),
    fineCents: clamp(getNumberParam(draft, `${prefix}.fine` as SynthParameterId), -100, 100),
    tuningMode: getStringParam(draft, `${prefix}.tuning.mode` as OscillatorTuningParameterId) as "semitone" | "harmonic" | "ratio" | "step",
    harmonic: getNumberParam(draft, `${prefix}.tuning.harmonic` as OscillatorTuningParameterId),
    ratioNumerator: getNumberParam(draft, `${prefix}.tuning.numerator` as OscillatorTuningParameterId),
    ratioDenominator: getNumberParam(draft, `${prefix}.tuning.denominator` as OscillatorTuningParameterId),
    tuningStep: getNumberParam(draft, `${prefix}.tuning.step` as OscillatorTuningParameterId),
    tuningDivisions: getNumberParam(draft, `${prefix}.tuning.divisions` as OscillatorTuningParameterId),
    phaseMode: getStringParam(draft, `${prefix}.phaseMode` as SynthParameterId) === "memory" ? "memory" as const : "retrigger" as const,
    route: sourceRouteFromId(getStringParam(draft, `${prefix}.route` as SynthParameterId)),
    phase: getNumberParam(draft, `${prefix}.phase` as SynthParameterId),
    randomPhase: getNumberParam(draft, `${prefix}.randomPhase` as SynthParameterId),
    fxSends: [
      clamp01(getNumberParam(draft, `${prefix}.fxSend1` as SynthParameterId)),
      clamp01(getNumberParam(draft, `${prefix}.fxSend2` as SynthParameterId)),
    ] as [number, number],
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
  draft.parameters[`osc.${oscillator}.tuning.mode` as OscillatorTuningParameterId] = source.tuningMode ?? "semitone";
  draft.parameters[`osc.${oscillator}.tuning.harmonic` as OscillatorTuningParameterId] = source.harmonic ?? 1;
  draft.parameters[`osc.${oscillator}.tuning.numerator` as OscillatorTuningParameterId] = source.ratioNumerator ?? 1;
  draft.parameters[`osc.${oscillator}.tuning.denominator` as OscillatorTuningParameterId] = source.ratioDenominator ?? 1;
  draft.parameters[`osc.${oscillator}.tuning.step` as OscillatorTuningParameterId] = source.tuningStep ?? 0;
  draft.parameters[`osc.${oscillator}.tuning.divisions` as OscillatorTuningParameterId] = source.tuningDivisions ?? 12;
  draft.parameters[`osc.${oscillator}.phaseMode` as SynthParameterId] = source.phaseMode ?? "retrigger";
  draft.parameters[`osc.${oscillator}.route` as SynthParameterId] = source.route ?? "filter";
  draft.parameters[`osc.${oscillator}.phase` as SynthParameterId] = source.phase ?? 0;
  draft.parameters[`osc.${oscillator}.randomPhase` as SynthParameterId] = source.randomPhase ?? 0.25;
  draft.parameters[`osc.${oscillator}.fxSend1` as SynthParameterId] = source.fxSends?.[0] ?? 0;
  draft.parameters[`osc.${oscillator}.fxSend2` as SynthParameterId] = source.fxSends?.[1] ?? 0;
  applyWavetableToDraft(draft, oscillator, source.wavetable, oscillator === "a");
}

function sourceRouteFromId(route: string): "both" | "filter1" | "filter2" | "direct" {
  if (route === "direct" || route === "filter1" || route === "filter2") return route;
  return "both";
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
  draft.parameters[`osc.${oscillator}.unison.voices` as OscillatorUnisonParameterId] = wavetable.unison;
  draft.parameters[`osc.${oscillator}.unison.detune` as OscillatorUnisonParameterId] = wavetable.detuneCents / 100;
  draft.parameters[`osc.${oscillator}.unison.spread` as OscillatorUnisonParameterId] = wavetable.blend;
  if (!applyGlobalUnison) return;
  draft.parameters["unison.enabled"] = wavetable.unison > 1;
  draft.parameters["unison.voices"] = wavetable.unison;
  draft.parameters["unison.detune"] = wavetable.detuneCents / 100;
  draft.parameters["unison.blend"] = wavetable.blend;
  draft.parameters["unison.spread"] = wavetable.blend;
}

function isWavetableWarpMode(value: unknown): value is WavetableWarpMode {
  return value === "shape" || value === "fold" || value === "pinch" || value === "mirror";
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

function isMacroSource(source: ModulationSourceId): source is MacroId {
  return source.startsWith("macro.");
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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampMidiChannel(value: number): number {
  return Math.round(clamp(value, 1, 16));
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
