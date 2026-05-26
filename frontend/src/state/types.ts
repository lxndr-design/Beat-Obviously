/**
 * Domain types for Beat.
 *
 * Mirror these (in spirit) on the C++ side in backend/Source/Ipc/Schema.h.
 * IDs are short stable string identifiers (nanoid). Beat-positions are
 * floats measured in beats from project start (1 beat = 1/4 note).
 */

export type Id = string;
export type Beats = number; // floating-point position/length in beats

export type TrackKind = "audio" | "midi" | "mixed";

export interface MidiNote {
  pitch: number; // MIDI note number 0..127
  /** Optional exact oscillator frequency. Used by drum cells that store Hz. */
  frequencyHz?: number;
  velocity: number; // 0..127
  startBeat: Beats; // relative to segment start
  lengthBeats: Beats;
}

export interface DrumCell {
  on: boolean;
  /** Optional exact oscillator frequency for this hit. */
  pitchHz?: number;
  /** MIDI-style hit velocity. */
  velocity?: number;
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
  | { kind: "drum"; rows: DrumRow[]; stepCount: number; speed: 1 | 2 | 4 | 8; defaultPitchHz?: number }
  | { kind: "mixed"; audioFileId: Id; notes: MidiNote[]; gainDb: number };

export interface Segment {
  id: Id;
  trackId: Id;
  /** Optional display name shown in the segment's label strip. */
  name?: string;
  /** Bound instrument from the library (renders this segment). */
  instrumentId?: Id;
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
  kind: "synth" | "sampler" | "hybrid";
  envelope: AdsrEnvelope;
  /** Named macro knobs — spec calls for at least 4. */
  knobs: {
    cutoff: number;     // 0..1, displayed as %
    resonance: number;  // 0..1, displayed as %
    drive: number;      // 0..1, displayed as %
    color: number;      // 0..1, displayed as Shape % — waveform morph
  };
  /** Wavetable / oscillator shape. */
  waveform: "sine" | "saw" | "square" | "triangle" | "noise" | "sample";

  /** Synth-specific oscillator params (only meaningful when kind=synth/hybrid).
   *  Made optional with sensible defaults so older saved instruments still
   *  deserialize. */
  detuneCents?: number;   // ±100 cents — pitch fine-tune
  octave?: number;        // ±3 — coarse octave shift
  subOscLevel?: number;   // 0..1 — square sub-osc one octave below, displayed as %
  glideMs?: number;       // 0..500 — portamento between notes

  /** LFO that modulates the filter cutoff (and optionally pitch). */
  lfoWaveform?: "sine" | "triangle" | "saw" | "square"; // LFO movement shape
  lfoRateHz?: number;       // 1..20
  lfoDepth?: number;        // 0..1
  lfoSync?: boolean;        // true = tempo-synced, false = absolute Hz
  lfoRetrigger?: boolean;   // true = restart LFO per note
  lfoToPitch?: number;      // 0..12 semitones — vibrato / siren amount
  lfoToFilter?: number;     // -1..1 — rhythmic filter sweep amount
  envToFilter?: number;     // -1..1 — ADSR-to-filter cutoff depth

  /** Sample IDs the instrument can play. */
  sampleIds: Id[];
  /** Built-in or imported one-shot sample URL for sampler-style instruments. */
  sampleUrl?: string;
  /** Source instruments this was derived from (for merge lineage). */
  parentIds?: Id[];
  /** When true, this is a user-created instrument (vs. built-in factory). */
  userCreated: boolean;
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
    | { kind: "segment"; segmentId: Id }
    | { kind: "eq" }
    | { kind: "preferences" }
  >;
}
