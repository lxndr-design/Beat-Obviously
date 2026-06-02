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

export type TrackKind = "audio" | "midi" | "mixed";

export type MidiAutomationTarget =
  | "pitch"
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

export interface MidiAutomationLane {
  target: MidiAutomationTarget;
  points: Array<{ beat: Beats; value: number }>;
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
  /** Optional unselectable pitch curve trail inside this note. Points are relative to the segment. */
  curve?: Array<{ beat: Beats; pitch: number }>;
  /** Optional per-note parameter automation. Existing curve remains the legacy pitch lane. */
  automation?: MidiAutomationLane[];
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

export type SegmentPayload =
  | { kind: "audio"; audioFileId: Id; gainDb: number }
  | { kind: "midi"; notes: MidiNote[] }
  | { kind: "drum"; rows: DrumRow[]; stepCount: number; speed: DrumSpeed; defaultPitchHz?: number; swingPercent?: number; timeSignature?: TimeSignature }
  | { kind: "mixed"; audioFileId: Id; notes: MidiNote[]; gainDb: number };

export interface Segment {
  id: Id;
  trackId: Id;
  /** Optional display name shown in the segment's label strip. */
  name?: string;
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
  /** When > 0, repeat this segment until the next segment / end of track. */
  repeats: number;
  payload: SegmentPayload;
  /** Layer index within the track row (0 = base). Higher = overlaid. */
  layer: number;
  muted?: boolean;
}

export interface TrackEffectChain {
  /** Each filter is an opaque effect node with parameters. */
  filters: Array<{
    id: Id;
    kind: "bitcrush" | "lowpass" | "highpass" | "saturator" | "reverb" | "delay";
    bypassed: boolean;
    params: Record<string, number>;
  }>;
}

export interface Track {
  id: Id;
  name: string;
  kind: TrackKind;
  /** Optional bound instrument from the library. */
  instrumentId?: Id;
  /** Loaded audio file if this is an audio-input track. */
  audioFileId?: Id;
  gainDb: number;
  pan: number; // -1..1
  mute: boolean;
  solo: boolean;
  /** Color is not exposed in this design system — kept here for future themes. */
  effects: TrackEffectChain;
  segments: Segment[];
  /** UI-only: row height variant. */
  rowHeight: "normal" | "compact";
}

export interface AdsrEnvelope {
  attackMs: number;
  decayMs: number;
  sustain: number; // 0..1
  releaseMs: number;
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
  /** Wavetable / oscillator shape. */
  waveform: "sine" | "saw" | "square" | "triangle" | "noise" | "sample" | "wavetable";

  /** Synth-specific oscillator params (only meaningful when kind=synth/hybrid).
   *  Made optional with sensible defaults so older saved instruments still
   *  deserialize. */
  detuneCents?: number;   // ±100 cents — pitch fine-tune
  octave?: number;        // ±3 — coarse octave shift
  subOscLevel?: number;   // 0..1 — square sub-osc one octave below, displayed as %
  glideMs?: number;       // 0..500 — portamento between notes
  ampLevel?: number;      // 0..1 — final synth voice level
  ampPan?: number;        // -1..1 — final synth voice pan

  /** Aether wavetable params. Meaningful when kind=wavetable. */
  wavetable?: WavetableConfig;
  /** Serum-style multi-oscillator stack for Aether WT instruments. */
  aether?: AetherSynthConfig;
  /** Exact synth-editor patch contract. Preserves modulation/macro state. */
  synthPatch?: SynthPatchSnapshot;

  /** LFO that modulates the filter cutoff (and optionally pitch). */
  lfoWaveform?: "sine" | "triangle" | "saw" | "square"; // LFO movement shape
  lfoRateHz?: number;       // 1..20
  lfoDepth?: number;        // 0..1
  lfoSync?: boolean;        // true = tempo-synced, false = absolute Hz
  lfoRetrigger?: boolean;   // true = restart LFO per note
  lfoPositionBipolar?: boolean;
  lfoPitchBipolar?: boolean;
  lfoFilterBipolar?: boolean;
  lfoToPitch?: number;      // 0..12 semitones — vibrato / siren amount
  lfoToFilter?: number;     // -1..1 — rhythmic filter sweep amount
  envToFilter?: number;     // -1..1 — ADSR-to-filter cutoff depth

  /** Sample IDs the instrument can play. */
  sampleIds: Id[];
  /** Built-in or imported one-shot sample URL for sampler-style instruments. */
  sampleUrl?: string;
  /** Multiple sample URLs played round-robin for one logical instrument. */
  sampleUrls?: string[];
  /** Optional multisample/round-robin zones, e.g. parsed from Decent Sampler presets. */
  sampleMap?: InstrumentSampleZone[];
  /** Sidebar grouping bucket for instrument library organization. */
  setId?: Id;
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
  path: string;
  name?: string;
  rootNote: number;
  loNote: number;
  hiNote: number;
  loVel: number;
  hiVel: number;
  volumeDb: number;
  pan: number;
  tuning: number;
  seqPosition: number;
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
  sub: AetherSubConfig;
  noise: AetherNoiseConfig;
}

export type SynthPatchParameterValue = boolean | number | string;

export interface CustomWavetableFrame {
  brightness: number;
  even: number;
  fold: number;
  phase: number;
}

export interface CustomWavetableDefinition {
  id: string;
  name: string;
  frames: CustomWavetableFrame[];
}

export interface SynthPatchModulationRoute {
  id: string;
  source: string;
  target: string;
  amount: number;
  bipolar: boolean;
  enabled: boolean;
}

export interface SynthPatchSnapshot {
  schemaVersion: 1;
  instrumentType: "wavetable-synth";
  namespace: "synth";
  name: string;
  parameters: Record<string, SynthPatchParameterValue>;
  modulation: SynthPatchModulationRoute[];
  metadata: {
    createdBy: "Beat";
    tags: string[];
    icon?: string;
    customWavetables?: Record<string, CustomWavetableDefinition>;
  };
}

export interface InstrumentSource {
  kind: "factory" | "uploaded" | "created" | "derived";
  label: string;
  url?: string;
  license?: string;
  importedAt?: number;
  edited?: boolean;
}

export interface InstrumentSnapshot {
  name: string;
  icon?: string;
  kind: Instrument["kind"];
  envelope: AdsrEnvelope;
  knobs: Instrument["knobs"];
  filterType?: Instrument["filterType"];
  waveform: Instrument["waveform"];
  detuneCents?: number;
  octave?: number;
  subOscLevel?: number;
  glideMs?: number;
  ampLevel?: number;
  ampPan?: number;
  wavetable?: WavetableConfig;
  aether?: AetherSynthConfig;
  synthPatch?: SynthPatchSnapshot;
  lfoWaveform?: Instrument["lfoWaveform"];
  lfoRateHz?: number;
  lfoDepth?: number;
  lfoSync?: boolean;
  lfoRetrigger?: boolean;
  lfoPositionBipolar?: boolean;
  lfoPitchBipolar?: boolean;
  lfoFilterBipolar?: boolean;
  lfoToPitch?: number;
  lfoToFilter?: number;
  envToFilter?: number;
  sampleIds: Id[];
  sampleUrl?: string;
  sampleUrls?: string[];
  sampleMap?: InstrumentSampleZone[];
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
  masterEqAutomation: EqAutomationPoint[];
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
  /** Active selection loop range for preview, or null. */
  loopRange: { startBeat: Beats; endBeat: Beats } | null;
}

/** UI-only ephemeral state — selection, focus, drag — not persisted, not undone. */
export interface UiState {
  selectedTrackIds: Id[];
  selectedSegmentIds: Id[];
  /** Open editors. Multiple modals can be open at once. */
  openEditors: Array<
    | { kind: "instrument"; instrumentId: Id }
    | { kind: "synth" }
    | { kind: "segment"; segmentId: Id }
    | { kind: "component"; componentId: Id }
    | { kind: "eq" }
    | { kind: "preferences" }
  >;
  /** Modeless, singleton editor for per-track effects. */
  trackEffectsEditorTrackId?: Id | null;
}
