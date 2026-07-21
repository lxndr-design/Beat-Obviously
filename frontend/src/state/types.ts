/**
 * Domain types for Beat.
 *
 * Mirror these (in spirit) on the C++ side in backend/Source/Ipc/Schema.h.
 * IDs are short stable string identifiers (nanoid). Beat-positions are
 * floats measured in beats from project start (1 beat = 1/4 note).
 */

export type Id = string;
export type Beats = number; // floating-point position/length in beats
export type DrumSpeed = 1 | 2 | 3 | 4 | 5 | 6;

export type TrackKind = "audio" | "midi" | "mixed" | "group";

export type WavetableWarpMode = "shape" | "fold" | "pinch" | "mirror";
export type SamplerComplexity = "single" | "layered" | "mapped" | "performance";

export type MidiAutomationTarget =
  | "pitch"
  | "osc.a.position"
  | "osc.a.warp"
  | "osc.a.fine"
  | "osc.a.level"
  | "osc.a.pan"
  | "osc.a.phase"
  | "osc.b.position"
  | "osc.b.warp"
  | "osc.b.fine"
  | "osc.b.level"
  | "osc.b.pan"
  | "osc.b.phase"
  | "filter.cutoff"
  | "filter.resonance"
  | "filter.drive"
  | "amp.level"
  | "amp.pan"
  | "macro.1"
  | "macro.2"
  | "macro.3"
  | "macro.4"
  | "unison.detune"
  | "unison.spread";

export interface MidiAutomationLane {
  target: MidiAutomationTarget;
  points: Array<{ beat: Beats; value: number; curve?: AutomationCurve }>;
}

export interface MidiNote {
  pitch: number; // MIDI note number 0..127
  /** Optional exact oscillator frequency. Used by drum cells that store Hz. */
  frequencyHz?: number;
  velocity: number; // 0..127
  startBeat: Beats; // relative to segment start
  lengthBeats: Beats;
  /** Optional note this note should slide/legato-connect into. */
  connectToIndex?: number;
  /** Optional unselectable pitch curve trail inside this note. Fractional pitch values are allowed. */
  curve?: Array<{ beat: Beats; pitch: number }>;
  /** Optional per-note parameter automation. Existing curve remains the legacy pitch lane. */
  automation?: MidiAutomationLane[];
  /** Optional sampler zone/articulation override for sampler-backed instruments. */
  sampleZoneId?: Id;
  samplePath?: string;
  sampleLabel?: string;
}

export interface DrumCell {
  on: boolean;
  /** Optional exact oscillator frequency for this hit. */
  pitchHz?: number;
  /** Optional per-cell MIDI-style hit velocity override, 0..127. */
  velocity?: number;
  /** Optional per-cell timing lean, -50..50 percent of one step. UI presents this as 0..100 with 50 straight. */
  leanPercent?: number;
}

export type DrumStep = boolean | DrumCell;

export interface DrumRow {
  id: Id;
  instrumentId?: Id;
  name: string;
  steps: DrumStep[];
}

export type DrumpadKeyboardLayout = "mac" | "windows";

export interface DrumpadLane {
  id: Id;
  instrumentId?: Id;
  name: string;
  keyCode?: string;
  keyLabel?: string;
  muted?: boolean;
  pitch?: number;
}

export interface DrumpadHit {
  id: Id;
  laneId: Id;
  startBeat: Beats;
  lengthBeats: Beats;
  velocity: number;
  keyCode?: string;
}

export interface DrumpadPayload {
  kind: "drumpad";
  keyboardLayout: DrumpadKeyboardLayout;
  lanes: DrumpadLane[];
  hits: DrumpadHit[];
  /** Recording quantization in seconds. Defaults to 1/64 second. */
  quantizeSeconds: number;
  gainDb?: number;
}

export type SegmentPayload =
  | { kind: "audio"; audioFileId: Id; gainDb: number }
  | { kind: "midi"; notes: MidiNote[]; gainDb?: number }
  | { kind: "drum"; rows: DrumRow[]; stepCount: number; speed: DrumSpeed; sourceLengthBeats?: Beats; defaultPitchHz?: number; swingPercent?: number; timeSignature?: TimeSignature }
  | DrumpadPayload
  | { kind: "mixed"; audioFileId: Id; notes: MidiNote[]; gainDb: number };

export interface Segment {
  id: Id;
  trackId: Id;
  /** Optional display name shown in the segment's label strip. */
  name?: string;
  /** Optional visual tag color for future segment metadata/organization UI. */
  color?: string;
  /** Optional Iconify icon name for future segment metadata/organization UI. */
  icon?: string;
  /** Optional edit group id for linked arrangement operations. */
  groupId?: Id;
  /** Bound instrument from the library (renders this segment). */
  instrumentId?: Id;
  /** MIDI playback transpose in semitones. */
  transpose?: number;
  /** Optional per-segment time signature for editor grid/emphasis. */
  timeSignature?: TimeSignature;
  /** Position in the track timeline. */
  startBeat: Beats;
  /** Length in beats. */
  lengthBeats: Beats;
  /** Offset into the source content for non-destructive trim/split, in beats. */
  sourceStartBeat?: Beats;
  /** Linear fade-in duration at the segment head, in beats. */
  fadeInBeats?: Beats;
  /** Linear fade-out duration at the segment tail, in beats. */
  fadeOutBeats?: Beats;
  /** When > 0, repeat this segment until the next segment / end of track. */
  repeats: number;
  payload: SegmentPayload;
  /** Segment-local Aether/instrument parameter automation, stored in beats relative to segment start. */
  automation?: MidiAutomationLane[];
  /** Layer index within the track row (0 = base). Higher = overlaid. */
  layer: number;
  muted?: boolean;
}

export interface TrackEffectChain {
  /** Each filter is an opaque effect node with parameters. */
  filters: TrackEffect[];
}

export type AutomationCurve = "hold" | "linear" | "quadratic" | "cubic" | "easeIn" | "easeOut" | "smoothstep";

export interface TrackEffectAutomationPoint {
  id: Id;
  /** Absolute beat on the project timeline. */
  beat: Beats;
  value: number;
  /** Curve from this point toward the next point. */
  curve?: AutomationCurve;
}

export interface TrackEffectAutomationLane {
  /** Effect parameter key, e.g. cutoffHz, resonance, drive, mix. */
  param: string;
  points: TrackEffectAutomationPoint[];
}

export interface TrackEffect {
  id: Id;
  kind: "bitcrush" | "lowpass" | "highpass" | "saturator" | "distortion" | "reverb" | "delay" | "compressor" | "chorus" | "phaser" | "flanger" | "plugin";
  bypassed: boolean;
  /** Optional future effect-plugin host metadata. Native playback bypasses unavailable plugin processors safely. */
  pluginId?: Id;
  pluginName?: string;
  pluginFormat?: PluginFormat;
  latencySamples?: number;
  params: Record<string, number>;
  /** Track-owned timeline lanes for this effect. Empty lanes use params defaults. */
  automation?: TrackEffectAutomationLane[];
}

export interface TrackSend {
  busId: Id;
  gainDb: number;
  pan: number;
  enabled: boolean;
  preFader?: boolean;
}

export const AUDIO_BUS_SCHEMA_VERSION = 1;

export interface AudioBusCreateOptions {
  name?: string;
  /** Tracks routed here atomically when the Bus is created. Unknown ids are ignored. */
  trackIds?: Id[];
}

export interface TrackFreezeSource {
  sourceTrackId: Id;
  sourceTrackName?: string;
  audioFileId: Id;
  segmentId?: Id;
  createdAt: number;
  sourceMute: boolean;
  sourceSolo: boolean;
  sourceParentTrackId?: Id;
}

export interface ReturnBus {
  schemaVersion?: number;
  id: Id;
  name: string;
  color?: string;
  icon?: string;
  channelLayout?: "mono" | "stereo";
  /** Empty/undefined routes to Master. A missing non-empty ID must remain silent. */
  outputBusId?: Id;
  outputEnabled?: boolean;
  inputTrimDb?: number;
  gainDb: number;
  pan: number;
  mute: boolean;
  solo?: boolean;
  soloSafe?: boolean;
  mixerOrder?: number;
  sends?: TrackSend[];
  effects: TrackEffectChain;
  automation?: MidiAutomationLane[];
}

export type AudioBus = ReturnBus;

export interface Track {
  id: Id;
  name: string;
  kind: TrackKind;
  /** Optional bound instrument from the library. */
  instrumentId?: Id;
  /** Loaded audio file if this is an audio-input track. */
  audioFileId?: Id;
  /** Optional parent group/folder route. Missing parent falls back to master. */
  parentTrackId?: Id;
  /** Primary mixer output. Empty/undefined routes to Master. */
  outputBusId?: Id;
  /** False is an explicit no-output route and must never fall back to Master. */
  outputEnabled?: boolean;
  gainDb: number;
  pan: number; // -1..1
  mute: boolean;
  solo: boolean;
  /** Native recording state. Persisted so armed/input mappings survive document roundtrip. */
  recordArmed: boolean;
  inputMonitoring: boolean;
  inputDeviceId?: string;
  inputChannelStart: number;
  inputChannelCount: number;
  recordGainDb: number;
  /** Color is not exposed in this design system — kept here for future themes. */
  sends?: TrackSend[];
  /** Present on bounced/frozen audio tracks so the original source can be restored. */
  freezeSource?: TrackFreezeSource;
  /** Track-level Aether/instrument parameter automation, stored on the project timeline. */
  automation?: MidiAutomationLane[];
  effects: TrackEffectChain;
  segments: Segment[];
  /** UI-only: row height variant. */
  rowHeight: "normal" | "compact";
}

export type EnvelopeCurve = "linear" | "exp" | "log" | "s-curve";

export interface AdsrEnvelope {
  attackMs: number;
  decayMs: number;
  sustain: number; // 0..1
  releaseMs: number;
  attackCurve?: EnvelopeCurve;
  decayCurve?: EnvelopeCurve;
  releaseCurve?: EnvelopeCurve;
  loop?: boolean;
}

/**
 * Instrument — a definition that can be bound to a track. At least 4 knobs
 * per spec (we expose 4 named, plus envelope and optional samples).
 */
export interface Instrument {
  id: Id;
  name: string;
  /** User-facing library/editor icon, stored as an Iconify icon name. */
  icon?: string;
  kind: "synth" | "sampler" | "hybrid" | "wavetable";
  envelope: AdsrEnvelope;
  /** Named macro knobs — spec calls for at least 4. */
  knobs: {
    cutoff: number;     // 0..1, displayed as %
    resonance: number;  // 0..1, displayed as %
    drive: number;      // 0..1, displayed as %
    color: number;      // 0..1, displayed as Shape % — waveform morph
  };
  filterType?: "lowpass" | "bandpass" | "highpass";
  filterKeytrack?: number; // 0..1 — one cutoff octave per pitch octave at 1.0
  /** Wavetable / oscillator shape. */
  waveform: "sine" | "saw" | "square" | "triangle" | "noise" | "sample" | "wavetable";

  /** Synth-specific oscillator params (only meaningful when kind=synth/hybrid).
   *  Made optional with sensible defaults so older saved instruments still
   *  deserialize. */
  detuneCents?: number;   // ±100 cents — pitch fine-tune
  octave?: number;        // ±3 — coarse octave shift
  subOscLevel?: number;   // 0..1 — square sub-osc one octave below, displayed as %
  glideMs?: number;       // 0..500 — portamento between notes
  maxVoices?: number;     // 1..32 — synth voice allocation cap
  mono?: boolean;          // true caps synth playback to one active voice
  legato?: boolean;        // true retunes active mono voices without envelope retrigger
  ampLevel?: number;      // 0..1 — final synth voice level
  ampPan?: number;        // -1..1 — final synth voice pan

  /** Aether wavetable params. Meaningful when kind=wavetable. */
  wavetable?: WavetableConfig;
  /** Serum-style multi-oscillator stack for Aether WT instruments. */
  aether?: AetherSynthConfig;
  /** Six-operator FM/additive engine used by Aurum instruments. */
  aurum?: AurumSynthConfig;
  /** Exact synth-editor patch contract. Preserves modulation/macro state. */
  synthPatch?: SynthPatchSnapshot;
  /** Visual node-editor graph for synth-style instruments. */
  nodeGraph?: InstrumentNodeGraph;

  /** LFO that modulates the filter cutoff (and optionally pitch). */
  lfoWaveform?: "sine" | "triangle" | "saw" | "square"; // LFO movement shape
  lfoRateHz?: number;       // 1..20
  lfoDepth?: number;        // 0..1
  lfoSync?: boolean;        // true = tempo-synced, false = absolute Hz
  lfoSyncedRate?: string;    // note division, e.g. 1/4
  lfoSmoothing?: number;     // 0..1 shape-corner smoothing
  lfoRandomPhase?: number;   // 0..1 note-on phase randomization amount
  lfoPhase?: number;        // 0..1 cycle offset
  lfoRetrigger?: boolean;   // true = restart LFO per note
  lfoOneShot?: boolean;     // true = stop at the end of one cycle
  lfo2Waveform?: "sine" | "triangle" | "saw" | "square";
  lfo2RateHz?: number;
  lfo2Sync?: boolean;
  lfo2SyncedRate?: string;
  lfo2Smoothing?: number;
  lfo2RandomPhase?: number;
  lfo2Enabled?: boolean;
  lfo2Phase?: number;
  lfo2Retrigger?: boolean;
  lfo2OneShot?: boolean;
  lfoPositionBipolar?: boolean;
  lfoPitchBipolar?: boolean;
  lfoFilterBipolar?: boolean;
  lfoToPitch?: number;      // 0..12 semitones — vibrato / siren amount
  lfoToFilter?: number;     // -1..1 — rhythmic filter sweep amount
  envToFilter?: number;     // -1..1 — ADSR-to-filter cutoff depth

  /** Instrument-owned FX inserted before track FX. Used by plugin/sample imports. */
  effects?: TrackEffectChain;

  /** Sample IDs the instrument can play. */
  sampleIds: Id[];
  /** Built-in or imported one-shot sample URL for sampler-style instruments. */
  sampleUrl?: string;
  /** Multiple sample URLs for one logical sampler instrument. */
  sampleUrls?: string[];
  /** Optional multisample, hit-variant, or round-robin zones, e.g. parsed from imports. */
  sampleMap?: InstrumentSampleZone[];
  /** Sampler editing/runtime complexity level. Keeps simple one-shots separate from layered or performable maps. */
  samplerComplexity?: SamplerComplexity;
  /** Sidebar grouping bucket for instrument library organization. */
  setId?: Id;
  /** Canonical library taxonomy assignment for search and organization. */
  taxonomy?: InstrumentTaxonomyAssignment;
  /** Where this instrument came from. Kept even after edits. */
  source?: InstrumentSource;
  /** Lightweight local sound descriptors used by beat/instrument generation. */
  descriptors?: string[];
  /** Original non-recursive settings, used for source-preserving revert. */
  original?: InstrumentSnapshot;
  /** Source instruments this was derived from (for merge lineage). */
  parentIds?: Id[];
  /** When true, this is a user-created instrument (vs. built-in factory). */
  userCreated: boolean;
}

export interface InstrumentSampleZone {
  /** Stable zone identity used by MIDI notes that force a specific sample/articulation. */
  id?: Id;
  path: string;
  name?: string;
  trigger?: string;
  rootNote: number;
  loNote: number;
  hiNote: number;
  loVel: number;
  hiVel: number;
  volumeDb: number;
  pan: number;
  tuning: number;
  seqPosition: number;
  chokeGroup?: number;
  loopEnabled?: boolean;
  loopStart?: number;
  loopEnd?: number;
  oneShot?: boolean;
  durationSeconds?: number;
  loLengthSeconds?: number;
  hiLengthSeconds?: number;
  startSample?: number;
  endSample?: number;
}

export interface WavetableConfig {
  /** Built-in wavetable bank. */
  bank: "aether" | "glass" | "vocal" | "organ" | "fm" | "custom";
  /** Stable user wavetable id when bank=custom. */
  customId?: string;
  /** 0..1 morph position across frames. */
  position: number;
  /** 0..1 harmonic warp / folding pressure. */
  warp: number;
  /** Bounded table-generation warp style. */
  warpMode: WavetableWarpMode;
  /** 1..8 stacked voice count. */
  unison: number;
  /** 0..100 cents spread across unison voices. */
  detuneCents: number;
  /** 0..1 stereo/phase spread stand-in for the current mono renderer. */
  blend: number;
}

export interface AetherOscillatorConfig {
  enabled: boolean;
  level: number;
  pan: number;
  waveform: "sine" | "saw" | "square" | "triangle" | "noise" | "wavetable";
  octave: number;
  semitone: number;
  fineCents: number;
  phase: number;
  randomPhase: number;
  wavetable: WavetableConfig;
}

export interface AetherSubConfig {
  enabled: boolean;
  level: number;
  octave: number;
  waveform: "sine" | "square" | "triangle";
}

export interface AetherNoiseConfig {
  enabled: boolean;
  level: number;
  color: number;
}

export interface AetherSynthConfig {
  oscA: AetherOscillatorConfig;
  oscB: AetherOscillatorConfig;
  /** Ordered oscillator collection. oscA/oscB remain for document compatibility. */
  oscillators?: Array<AetherOscillatorConfig & { id: string; name: string }>;
  sub: AetherSubConfig;
  noise: AetherNoiseConfig;
  /** 0..1 opt-in runtime nonlinear warp applied after Aether oscillator mixing. */
  runtimeWarp?: number;
  /** Runtime warp curve. Reuses table-generation warp labels for UI continuity. */
  runtimeWarpMode?: WavetableWarpMode;
}

export type AurumOperatorWaveform = "sine" | "triangle" | "saw" | "square" | "additive";

export interface AurumOperatorConfig {
  id: string;
  name: string;
  enabled: boolean;
  waveform: AurumOperatorWaveform;
  ratio: number;
  coarse: number;
  fineCents: number;
  level: number;
  phase: number;
  wavefold: number;
  harmonics: number[];
  envelope: AdsrEnvelope;
  pitchEnvelope: AdsrEnvelope;
  pitchEnvelopeSemitones: number;
  phaseEnvelope: AdsrEnvelope;
  phaseEnvelopeDegrees: number;
}

/** Six-operator FM/additive instrument. Matrix rows are sources; columns 0..5
 * are FM destinations and column 6 is direct output. Diagonal values are
 * operator feedback. */
export interface AurumSynthConfig {
  version: 5;
  operators: AurumOperatorConfig[];
  matrix: number[][];
  rmMatrix: number[][];
  unison: number;
  detuneCents: number;
  stereoSpread: number;
}

export type SynthPatchParameterValue = boolean | number | string;

export interface CustomWavetableFrame {
  /** Stable frame id for editor identity and future frame reordering. */
  id?: string;
  /** User-facing frame label. */
  label?: string;
  /** 0..1 position in the wavemap scan. */
  position?: number;
  brightness: number;
  even: number;
  fold: number;
  /** 0..1 focused resonant harmonic band amount. */
  formant: number;
  /** 0..1 spectral notch amount that carves a harmonic valley. */
  notch: number;
  /** -1..1 harmonic bias; negative weights low harmonics, positive weights high harmonics. */
  skew: number;
  /** -1..1 spectral slope; negative darkens upper harmonics, positive lifts them. */
  tilt: number;
  /** 0..1 resonance focus; higher values narrow the formant and notch bands. */
  focus: number;
  phase: number;
  /** Optional 16-bin manual harmonic drawing overlay. */
  partials?: number[];
  /** Deterministic analysis summary for drawn/imported/resynthesized frames. */
  analysis?: WavemapFrameAnalysis;
}

export type WavemapKind = "harmonic-sketch" | "resynthesized";
export type WavemapInterpolation = "linear" | "smooth";

export interface WavemapFrameAnalysis {
  sourceStartSample?: number;
  sourceEndSample?: number;
  rms: number;
  peak: number;
  zeroCrossRate: number;
  roughness: number;
  asymmetry: number;
  spectralCentroid: number;
  dominantHarmonic: number;
  dominantPhase: number;
}

export interface WavemapSource {
  kind: "drawn" | "generated" | "imported-audio" | "resynthesized";
  label?: string;
  audioFileId?: Id;
  path?: string;
  sampleRate?: number;
  channelCount?: number;
  bitDepth?: number;
  sourceSampleCount?: number;
  analyzedSampleCount?: number;
  frameCount?: number;
  sourceStartSample?: number;
  sourceEndSample?: number;
  createdAt?: number;
}

export interface WavemapDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  kind: WavemapKind;
  interpolation: WavemapInterpolation;
  /** 0..1 frame-morph curve amount; older patches omit this and render as 0. */
  morph: number;
  source: WavemapSource;
  frames: CustomWavetableFrame[];
}

/** Legacy name kept while older saved synth patches still use customWavetables. */
export type CustomWavetableDefinition = WavemapDefinition;

export interface SynthPatchModulationRoute {
  id: string;
  source: string;
  target: string;
  amount: number;
  bipolar: boolean;
  enabled: boolean;
}

export interface SynthPatchMacroDefinition {
  id: string;
  label: string;
  min: number;
  max: number;
  curve: "linear" | "ease-in" | "ease-out" | "s-curve";
}

export interface SynthPatchSnapshot {
  schemaVersion: 1;
  instrumentType: "wavetable-synth";
  namespace: "synth";
  name: string;
  taxonomy?: InstrumentTaxonomyAssignment;
  parameters: Record<string, SynthPatchParameterValue>;
  modulation: SynthPatchModulationRoute[];
  /** Instrument-owned FX inserted before track FX. Older patches omit this. */
  effects?: TrackEffectChain;
  metadata: {
    createdBy: "Beat";
    tags: string[];
    icon?: string;
    macros?: Record<string, SynthPatchMacroDefinition>;
    wavemaps?: Record<string, WavemapDefinition>;
    /** Legacy alias for older Aether patches. New code writes both keys. */
    customWavetables?: Record<string, CustomWavetableDefinition>;
  };
}

export type InstrumentNodeKind =
  | "instrument"
  | "oscillator"
  | "oscillatorMerge"
  | "noise"
  | "mixer"
  | "panWidth"
  | "filter"
  | "gain"
  | "unison"
  | "constant"
  | "cvScale"
  | "cvCombiner"
  | "gateTrigger"
  | "velocity"
  | "keytrack"
  | "modWheel"
  | "midiControl"
  | "macro"
  | "random"
  | "lfo"
  | "wavetableLfo"
  | "envelope"
  | "drive"
  | "resonator"
  | "shaper"
  | "distortion"
  | "delay"
  | "chorus"
  | "reverb"
  | "phaser"
  | "flanger"
  | "compressor"
  | "bitcrush"
  | "meterScope"
  | "output";

export type InstrumentNodePortKind = "input" | "output";
export type InstrumentNodeSignalKind = "audio" | "control";
export type InstrumentNodeParameterValue = boolean | number | string;

export interface InstrumentNodePort {
  id: string;
  label: string;
  kind: InstrumentNodePortKind;
  signal: InstrumentNodeSignalKind;
  /** Inputs default to one incoming cable unless this is explicitly true. Outputs may always fan out. */
  acceptsMultiple?: boolean;
}

export interface InstrumentNode {
  id: Id;
  kind: InstrumentNodeKind;
  label: string;
  x: number;
  y: number;
  inputs: InstrumentNodePort[];
  outputs: InstrumentNodePort[];
  parameters: Record<string, InstrumentNodeParameterValue>;
}

export interface InstrumentNodeCable {
  id: Id;
  fromNodeId: Id;
  fromPortId: string;
  toNodeId: Id;
  toPortId: string;
}

export interface InstrumentNodeGraph {
  schemaVersion: 1;
  nodes: InstrumentNode[];
  cables: InstrumentNodeCable[];
}

export interface InstrumentSource {
  kind: "factory" | "uploaded" | "created" | "derived" | "plugin";
  label: string;
  url?: string;
  license?: string;
  importedAt?: number;
  edited?: boolean;
  pluginId?: Id;
  fallbackEngine?: "aether";
}

export interface InstrumentTaxonomyAssignment {
  categoryId: string;
  instrumentId: string;
}

export type PluginKind = "synth" | "effect" | "renderer" | "utility";
export type PluginFormat = "native" | "vst3" | "audio-unit" | "bridge" | "decent-sampler";
export type PluginInstallState = "available" | "installed" | "missing" | "blocked";
export type PluginCapabilityKind = "instrument" | "effect" | "renderer" | "utility";
export type PluginFallbackMode = "aether" | "rendered-audio" | "pass-through";
export type PluginEditorKind = "midi" | "drum";

export interface DecentSamplerUiBinding {
  type?: string;
  level?: string;
  parameter?: string;
  position?: number;
}

export interface DecentSamplerUiControl {
  kind: string;
  label: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  minValue?: number;
  maxValue?: number;
  value?: number;
  bindings?: DecentSamplerUiBinding[];
}

export interface PluginCapability {
  id: Id;
  kind: PluginCapabilityKind;
  label: string;
  realtime: boolean;
  offline: boolean;
  latencySamples?: number;
  fallbackMode?: PluginFallbackMode;
}

export interface PluginAdapter {
  id: Id;
  name: string;
  vendor: string;
  version?: string;
  kind: PluginKind;
  format: PluginFormat;
  status: PluginInstallState;
  /** Synth plugins can either create live instruments or render audio when hosting is unavailable. */
  instrumentMode: "live-instrument" | "rendered-audio" | "fallback-aether";
  description: string;
  factory?: boolean;
  sourceFileName?: string;
  sourcePath?: string;
  uiImagePath?: string;
  uiImageDataUrl?: string;
  uiWidth?: number;
  uiHeight?: number;
  uiControlDetails?: DecentSamplerUiControl[];
  associatedInstrumentId?: Id;
  defaultEditorKind?: PluginEditorKind;
  sampleCount?: number;
  uiControlCount?: number;
  installedAt?: number;
  capabilities?: PluginCapability[];
}

export interface InstrumentSnapshot {
  name: string;
  icon?: string;
  kind: Instrument["kind"];
  envelope: AdsrEnvelope;
  knobs: Instrument["knobs"];
  filterType?: Instrument["filterType"];
  filterKeytrack?: number;
  waveform: Instrument["waveform"];
  detuneCents?: number;
  octave?: number;
  subOscLevel?: number;
  glideMs?: number;
  maxVoices?: number;
  mono?: boolean;
  legato?: boolean;
  ampLevel?: number;
  ampPan?: number;
  wavetable?: WavetableConfig;
  aether?: AetherSynthConfig;
  aurum?: AurumSynthConfig;
  synthPatch?: SynthPatchSnapshot;
  nodeGraph?: InstrumentNodeGraph;
  lfoWaveform?: Instrument["lfoWaveform"];
  lfoRateHz?: number;
  lfoDepth?: number;
  lfoSync?: boolean;
  lfoSyncedRate?: string;
  lfoSmoothing?: number;
  lfoRandomPhase?: number;
  lfoPhase?: number;
  lfoRetrigger?: boolean;
  lfoOneShot?: boolean;
  lfo2Waveform?: Instrument["lfo2Waveform"];
  lfo2RateHz?: number;
  lfo2Sync?: boolean;
  lfo2SyncedRate?: string;
  lfo2Smoothing?: number;
  lfo2RandomPhase?: number;
  lfo2Enabled?: boolean;
  lfo2Phase?: number;
  lfo2Retrigger?: boolean;
  lfo2OneShot?: boolean;
  lfoPositionBipolar?: boolean;
  lfoPitchBipolar?: boolean;
  lfoFilterBipolar?: boolean;
  lfoToPitch?: number;
  lfoToFilter?: number;
  envToFilter?: number;
  effects?: TrackEffectChain;
  sampleIds: Id[];
  sampleUrl?: string;
  sampleUrls?: string[];
  sampleMap?: InstrumentSampleZone[];
  samplerComplexity?: SamplerComplexity;
  taxonomy?: InstrumentTaxonomyAssignment;
  parentIds?: Id[];
  descriptors?: string[];
}

export interface InstrumentSet {
  id: Id;
  name: string;
  collapsed?: boolean;
  factory?: boolean;
}

export interface AudioFile {
  id: Id;
  name: string;
  /** Backend-resolved path on disk. */
  path: string;
  durationSeconds: number;
  sampleRate: number;
  /** Source bit depth when the file format exposes it. */
  bitDepth?: number;
  /** Optional original/imported file size in bytes. Older libraries may omit this. */
  sizeBytes?: number;
  /** Unix ms timestamp when the asset entered the Beat audio library. */
  importedAt?: number;
  /** User-provided source/provenance label captured at import time. */
  importSource?: string;
  /** Native producer-facing analysis metadata. Omitted when unavailable. */
  leftPeakDbFS?: number;
  rightPeakDbFS?: number;
  truePeakDbTP?: number;
  rmsDbFS?: number;
  crestFactorDb?: number;
  dcOffset?: number;
  clippingCount?: number;
  clippingRatio?: number;
  stereoCorrelation?: number;
  integratedLufs?: number;
}

/**
 * Master EQ automation point — 7-band graphic EQ.
 *
 * Standard graphic-EQ band centers used here:
 *   80 Hz | 200 Hz | 500 Hz | 1.25 kHz | 3 kHz | 6 kHz | 16 kHz
 *
 * `bandsDb` indexes match `EQ_BAND_CENTERS_HZ`. Per-band range ±24 dB.
 */
export const EQ_BAND_CENTERS_HZ = [80, 200, 500, 1250, 3000, 6000, 16000] as const;
export const EQ_BAND_LABELS = ["Low", "Lo-Mid", "Mid", "Up-Mid", "Hi-Mid", "High", "Air"] as const;
export const EQ_BAND_COUNT = 7;

export interface EqAutomationPoint {
  /** Project-time position in beats. */
  atBeat: Beats;
  /** 7-band gains in dB, ordered to match EQ_BAND_CENTERS_HZ. */
  bandsDb: number[];
}

export interface MasterChainSettings {
  inputGainDb: number;
  compressorEnabled: boolean;
  compressorThresholdDb: number;
  compressorRatio: number;
  compressorAttackMs: number;
  compressorReleaseMs: number;
  compressorMakeupDb: number;
  compressorMix: number;
  outputGainDb: number;
}

export interface RecordingInputProfile {
  inputDeviceId?: string;
  inputDeviceName?: string;
  inputChannelStart: number;
  inputChannelCount: number;
  calibrationSampleRate: number;
  measuredRoundTripSamples: number;
  reportedInputLatencySamples: number;
  reportedOutputLatencySamples: number;
  userLatencyAdjustmentSamples: number;
}

export interface TimeSignature {
  num: number;
  denom: number;
  /** 1-indexed beats within the bar that get a bold tick.
   *  For 4/4 with boldBeats=[1], only the downbeat is bold.
   *  For 5/4 with boldBeats=[1,4], both the 1st and 4th of every bar.
   *  Empty array = no bold ticks; just the regular major-tick-per-bar. */
  boldBeats: number[];
}

export interface Project {
  id: Id;
  name: string;
  bpm: number;
  timeSignature: TimeSignature;
  /** Beats counted from 0 — where to stop sequencer playback. */
  lengthBeats: Beats;
  tracks: Track[];
  returnBuses: ReturnBus[];
  masterEqAutomation: EqAutomationPoint[];
  masterChain: MasterChainSettings;
  recordingInput: RecordingInputProfile;
  /** Last saved timestamp ms. */
  savedAt?: number;
}

/**
 * Transport / playback state. Lives separately from project data because
 * undoing should NOT undo "press play".
 */
export interface TransportState {
  playing: boolean;
  /** Current playhead position in beats. */
  positionBeat: Beats;
  /** Playback speed multiplier. 1.0 = normal. */
  speed: number;
  /** Review loop toggle. When enabled, playback wraps at loopRange.endBeat. */
  loopEnabled: boolean;
  /** Review loop clamp positions. Stored even when loopEnabled is false. */
  loopRange: { startBeat: Beats; endBeat: Beats };
  /** Whole-project repeat toggle. When enabled, playback restarts at project end. */
  repeatTrackEnabled: boolean;
}

/** UI-only ephemeral state — selection, focus, drag — not persisted, not undone. */
export interface UiState {
  selectedTrackIds: Id[];
  selectedSegmentIds: Id[];
  selectedTrackEffectAutomationPointKeys: string[];
  /** Segment ids that are currently receiving a short playback pulse. */
  activeSegmentPlayback: Record<Id, number>;
  /** Open editors. Multiple modals can be open at once. */
  openEditors: Array<
    | { kind: "instrument"; instrumentId: Id; draftInstrument?: Instrument }
    | { kind: "samplerInstrument"; instrumentId: Id; draftInstrument?: Instrument }
    | { kind: "synthInstrument"; instrumentId: Id; draftInstrument?: Instrument }
    | { kind: "synth" }
    | { kind: "track"; trackId: Id }
    | { kind: "segment"; segmentId: Id; discardIfUntouched?: boolean }
    | { kind: "component"; componentId: Id }
    | { kind: "plugin"; pluginId: Id }
    | { kind: "eq" }
    | { kind: "mixer" }
    | { kind: "exportReview" }
    | { kind: "projectHealth" }
    | { kind: "preferences" }
  >;
  /** Modeless, singleton editor for per-track effects. */
  trackEffectsEditorTrackId?: Id | null;
}
