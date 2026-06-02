import { create } from "zustand";
import { temporal } from "zundo";
import { immer } from "zustand/middleware/immer";
import { nanoid } from "nanoid";
import type {
  Beats,
  AudioFile,
  Id,
  Instrument,
  InstrumentSet,
  InstrumentSnapshot,
  Project,
  Segment,
  Track,
  TransportState,
  UiState,
} from "./types";

/**
 * Single root store split into three slices:
 *   - project: persisted, undoable
 *   - transport: live, NOT undoable (you don't undo "press play")
 *   - ui: ephemeral, NOT undoable
 *
 * Only the project slice is wrapped by zundo. Transport and UI live in
 * separate stores below to keep undo history clean.
 */

interface ProjectSlice {
  project: Project;

  // Track ops
  addTrack: (track?: Partial<Track>) => Id;
  removeTrack: (id: Id) => void;
  reorderTracks: (orderedIds: Id[]) => void;
  updateTrack: (id: Id, patch: Partial<Track>) => void;
  /** Exclusive solo: soloing a track auto-mutes currently unmuted tracks.
   *  Unsoloing restores only those auto-mutes. */
  setTrackSolo: (id: Id, solo: boolean) => void;
  /** Mute toggle with invariants:
   *   - Muting a soloed track clears solo and restores auto-mutes.
   *   - Unmuting another track while solo is active clears solo and leaves the
   *     remaining auto-muted tracks muted. */
  setTrackMute: (id: Id, value: boolean) => void;

  // Segment ops
  addSegment: (trackId: Id, segment: Partial<Segment>) => Id;
  removeSegment: (segmentId: Id) => void;
  moveSegment: (segmentId: Id, toTrackId: Id, toStartBeat: Beats) => void;
  updateSegment: (segmentId: Id, patch: Partial<Segment>) => void;
  /** Set repeat count; rest of track is filled until next segment. */
  setSegmentRepeats: (segmentId: Id, repeats: number) => void;

  // Project ops
  setBpm: (bpm: number) => void;
  setTimeSignature: (ts: { num: number; denom: number; boldBeats: number[] }) => void;
  setLengthBeats: (beats: Beats) => void;
  rename: (name: string) => void;

  // Loading
  loadProject: (project: Project) => void;
}

function defaultTrack(): Track {
  return {
    id: nanoid(),
    name: "Track",
    /** Tracks are generic — `kind` defaults to "mixed" and is now informational
     *  only. Each segment carries its own payload kind. */
    kind: "mixed",
    gainDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    effects: { filters: [] },
    segments: [],
    rowHeight: "normal",
  };
}

export function createEmptyProject(): Project {
  return {
    id: nanoid(),
    name: "Untitled",
    bpm: 120,
    timeSignature: { num: 4, denom: 4, boldBeats: [1] },
    lengthBeats: 64,
    // New projects always start with one blank track.
    tracks: [defaultTrack()],
    masterEqAutomation: [],
  };
}

let soloAutoMutedTrackIds = new Set<Id>();

export const useProjectStore = create<ProjectSlice>()(
  temporal(
    immer((set) => ({
      project: createEmptyProject(),

      addTrack: (patch) => {
        const id = nanoid();
        set((s) => {
          const num = s.project.tracks.length + 1;
          s.project.tracks.push({
            ...defaultTrack(),
            name: `Track ${num}`,
            ...patch,
            id,
          });
        });
        return id;
      },

      removeTrack: (id) =>
        set((s) => {
          s.project.tracks = s.project.tracks.filter((t) => t.id !== id);
        }),

      reorderTracks: (orderedIds) =>
        set((s) => {
          const map = new Map(s.project.tracks.map((t) => [t.id, t]));
          s.project.tracks = orderedIds
            .map((id) => map.get(id))
            .filter((t): t is Track => Boolean(t));
        }),

      updateTrack: (id, patch) =>
        set((s) => {
          const t = s.project.tracks.find((x) => x.id === id);
          if (t) Object.assign(t, patch);
        }),

      setTrackSolo: (id, solo) =>
        set((s) => {
          if (solo) {
            restoreSoloAutoMutes(s.project.tracks);
            soloAutoMutedTrackIds = new Set();
            for (const t of s.project.tracks) {
              const isTarget = t.id === id;
              t.solo = isTarget;
              if (isTarget) {
                t.mute = false;
              } else if (!t.mute) {
                soloAutoMutedTrackIds.add(t.id);
                t.mute = true;
              }
            }
            return;
          }

          const t = s.project.tracks.find((x) => x.id === id);
          if (!t || !t.solo) return;
          t.solo = false;
          restoreSoloAutoMutes(s.project.tracks);
        }),

      setTrackMute: (id, value) =>
        set((s) => {
          const me = s.project.tracks.find((t) => t.id === id);
          if (!me) return;
          if (value) {
            if (me.solo) {
              me.solo = false;
              restoreSoloAutoMutes(s.project.tracks);
            }
            me.mute = true;
          } else {
            const other = s.project.tracks.find((t) => t.id !== id && t.solo);
            if (other) {
              other.solo = false;
              soloAutoMutedTrackIds = new Set();
            }
            me.mute = false;
          }
        }),

      addSegment: (trackId, patch) => {
        const id = nanoid();
        set((s) => {
          const track = s.project.tracks.find((t) => t.id === trackId);
          if (!track) return;
          const seg: Segment = {
            id,
            trackId,
            startBeat: 0,
            lengthBeats: 4,
            repeats: 0,
            layer: 0,
            payload: { kind: "midi", notes: [] },
            ...patch,
          };
          track.segments.push(seg);
          normalizeSegmentLayers(track);
        });
        return id;
      },

      removeSegment: (segmentId) =>
        set((s) => {
          for (const track of s.project.tracks) {
            track.segments = track.segments.filter((seg) => seg.id !== segmentId);
          }
        }),

      moveSegment: (segmentId, toTrackId, toStartBeat) =>
        set((s) => {
          let seg: Segment | undefined;
          for (const t of s.project.tracks) {
            const found = t.segments.find((x) => x.id === segmentId);
            if (found) {
              seg = found;
              t.segments = t.segments.filter((x) => x.id !== segmentId);
              break;
            }
          }
          if (!seg) return;
          const dest = s.project.tracks.find((t) => t.id === toTrackId);
          if (!dest) return;
          seg.trackId = toTrackId;
          seg.startBeat = toStartBeat;
          dest.segments.push(seg);
          normalizeSegmentLayers(dest);
        }),

      updateSegment: (segmentId, patch) =>
        set((s) => {
          for (const t of s.project.tracks) {
            const seg = t.segments.find((x) => x.id === segmentId);
            if (seg) {
              Object.assign(seg, patch);
              normalizeSegmentLayers(t);
              return;
            }
          }
        }),

      setSegmentRepeats: (segmentId, repeats) =>
        set((s) => {
          for (const t of s.project.tracks) {
            const seg = t.segments.find((x) => x.id === segmentId);
            if (seg) {
              seg.repeats = Math.max(0, repeats);
              return;
            }
          }
        }),

      setBpm: (bpm) =>
        set((s) => {
          s.project.bpm = Math.max(20, Math.min(999, bpm));
        }),

      setTimeSignature: (ts) =>
        set((s) => {
          s.project.timeSignature = {
            num: Math.max(1, Math.min(32, ts.num)),
            denom: Math.max(1, Math.min(32, ts.denom)),
            boldBeats: ts.boldBeats.filter((b) => b >= 1 && b <= 32),
          };
        }),

      setLengthBeats: (beats) =>
        set((s) => {
          s.project.lengthBeats = Math.max(4, Math.min(4096, beats));
        }),

      rename: (name) =>
        set((s) => {
          s.project.name = name;
        }),

      loadProject: (project) =>
        set((s) => {
          s.project = project;
        }),
    })),
    {
      limit: 100,
      // Equality: skip identical snapshots so undo/redo doesn't get noisy.
      equality: (a, b) => a.project === b.project,
    },
  ),
);

/** Bound helpers for invoking undo/redo from anywhere. */
export const undo = () => {
  const temporalState = useProjectStore.temporal.getState();
  const previous = temporalState.pastStates[temporalState.pastStates.length - 1];
  const current = useProjectStore.getState();
  if (previous?.project && wouldUndoDestructively(current.project, previous.project)) return;
  temporalState.undo();
};
export const redo = () => useProjectStore.temporal.getState().redo();
export const canUndo = () =>
  useProjectStore.temporal.getState().pastStates.length > 0;
export const canRedo = () =>
  useProjectStore.temporal.getState().futureStates.length > 0;

function wouldUndoDestructively(current: Project, previous: Project): boolean {
  if (previous.tracks.length < current.tracks.length) return true;
  const previousTrackIds = new Set(previous.tracks.map((track) => track.id));
  if (current.tracks.some((track) => !previousTrackIds.has(track.id) && trackHasContent(track))) return true;

  const previousSegmentIds = new Set(previous.tracks.flatMap((track) => track.segments.map((segment) => segment.id)));
  return current.tracks
    .flatMap((track) => track.segments)
    .some((segment) => !previousSegmentIds.has(segment.id) && segmentHasContent(segment));
}

function trackHasContent(track: Track): boolean {
  return track.segments.some(segmentHasContent);
}

function segmentHasContent(segment: Segment): boolean {
  if (segment.payload.kind === "midi" || segment.payload.kind === "mixed") return segment.payload.notes.length > 0;
  if (segment.payload.kind === "drum") {
    return segment.payload.rows.some((row) => row.steps.some((step) => Boolean(typeof step === "object" ? step.on : step)));
  }
  return Boolean(segment.payload.audioFileId);
}

// ---------------------------------------------------------------------------
// Transport: live state, NOT undoable.
// ---------------------------------------------------------------------------
interface TransportSlice extends TransportState {
  play: () => void;
  pause: () => void;
  stop: () => void;
  setPosition: (beat: Beats) => void;
  setSpeed: (speed: number) => void;
  setLoopRange: (range: TransportState["loopRange"]) => void;
}

export const useTransportStore = create<TransportSlice>()((set) => ({
  playing: false,
  positionBeat: 0,
  speed: 1,
  loopRange: null,
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  stop: () => set({ playing: false, positionBeat: 0 }),
  setPosition: (beat) => set({ positionBeat: Math.max(0, beat) }),
  setSpeed: (speed) => set({ speed: Math.max(0.1, Math.min(4, speed)) }),
  setLoopRange: (range) => set({ loopRange: range }),
}));

// ---------------------------------------------------------------------------
// View: ephemeral view settings — zoom, last-edited length. Not undoable.
// ---------------------------------------------------------------------------
interface ViewSlice {
  /** Pixels per beat. Lower = zoomed out (long times look smaller). */
  beatsToPx: number;
  /** Default segment length used by drag-drop / quick-add. */
  lastSegmentLength: number;
  /** Width of the left sidebar in px (user-resizable). */
  sidebarWidth: number;
  setZoom: (px: number) => void;
  setLastSegmentLength: (n: number) => void;
  setSidebarWidth: (px: number) => void;
}

export const useViewStore = create<ViewSlice>()((set) => ({
  beatsToPx: 64,
  lastSegmentLength: 4,
  sidebarWidth: 200,
  setZoom: (px) => set({ beatsToPx: Math.max(8, Math.min(256, px)) }),
  setLastSegmentLength: (n) => set({ lastSegmentLength: Math.max(0.25, n) }),
  setSidebarWidth: (px) => set({ sidebarWidth: Math.max(160, Math.min(480, px)) }),
}));

// ---------------------------------------------------------------------------
// Settings: durable user preferences. Persist surface for the preferences
// modal; not undoable.
// ---------------------------------------------------------------------------
interface SettingsSlice {
  /** Soft snap during segment resize, in seconds. */
  resizeSnapSeconds: number;
  /** Override: when Shift is held, snap to N measures instead. */
  resizeSnapMeasures: number;
  timelineSmartGrid: boolean;
  midiSmartGrid: boolean;
  timelineSubdivision: 2 | 4 | 8 | 16;
  midiSubdivision: 2 | 4 | 8 | 16;
  setResizeSnapSeconds: (s: number) => void;
  setResizeSnapMeasures: (m: number) => void;
  setTimelineSmartGrid: (enabled: boolean) => void;
  setMidiSmartGrid: (enabled: boolean) => void;
  setTimelineSubdivision: (subdivision: 2 | 4 | 8 | 16) => void;
  setMidiSubdivision: (subdivision: 2 | 4 | 8 | 16) => void;
}

export const useSettingsStore = create<SettingsSlice>()((set) => ({
  resizeSnapSeconds: 1,
  resizeSnapMeasures: 1,
  timelineSmartGrid: true,
  midiSmartGrid: true,
  timelineSubdivision: 4,
  midiSubdivision: 4,
  setResizeSnapSeconds: (s) => set({ resizeSnapSeconds: Math.max(0.0625, s) }),
  setResizeSnapMeasures: (m) => set({ resizeSnapMeasures: Math.max(1, Math.round(m)) }),
  setTimelineSmartGrid: (enabled) => set({ timelineSmartGrid: enabled }),
  setMidiSmartGrid: (enabled) => set({ midiSmartGrid: enabled }),
  setTimelineSubdivision: (subdivision) => set({ timelineSubdivision: subdivision }),
  setMidiSubdivision: (subdivision) => set({ midiSubdivision: subdivision }),
}));

// ---------------------------------------------------------------------------
// UI: ephemeral selection / modal state.
// ---------------------------------------------------------------------------
interface UiSlice extends UiState {
  selectTrack: (id: Id, additive?: boolean) => void;
  setSelectedTracks: (ids: Id[]) => void;
  selectSegment: (id: Id, additive?: boolean) => void;
  setSelectedSegments: (ids: Id[]) => void;
  clearSelection: () => void;
  openEditor: (e: UiState["openEditors"][number]) => void;
  closeEditor: (e: UiState["openEditors"][number]) => void;
  openTrackEffects: (trackId: Id) => void;
  closeTrackEffects: () => void;
}

export const useUiStore = create<UiSlice>()((set) => ({
  selectedTrackIds: [],
  selectedSegmentIds: [],
  openEditors: [],
  trackEffectsEditorTrackId: null,
  selectTrack: (id, additive) =>
    set((s) => ({
      selectedTrackIds: additive
        ? s.selectedTrackIds.includes(id)
          ? s.selectedTrackIds.filter((x) => x !== id)
          : [...s.selectedTrackIds, id]
        : [id],
    })),
  setSelectedTracks: (ids) => set({ selectedTrackIds: ids }),
  selectSegment: (id, additive) =>
    set((s) => ({
      selectedSegmentIds: additive
        ? s.selectedSegmentIds.includes(id)
          ? s.selectedSegmentIds.filter((x) => x !== id)
          : [...s.selectedSegmentIds, id]
        : [id],
    })),
  setSelectedSegments: (ids) => set({ selectedSegmentIds: ids }),
  clearSelection: () =>
    set({ selectedTrackIds: [], selectedSegmentIds: [] }),
  openEditor: (e) =>
    set((s) => ({
      openEditors: dedupeEditor(s.openEditors, e),
    })),
  closeEditor: (e) =>
    set((s) => ({
      openEditors: s.openEditors.filter((x) => !sameEditor(x, e)),
    })),
  openTrackEffects: (trackId) => set({ trackEffectsEditorTrackId: trackId }),
  closeTrackEffects: () => set({ trackEffectsEditorTrackId: null }),
}));

// ---------------------------------------------------------------------------
// Instruments are a separate store: they're project-independent (library).
// ---------------------------------------------------------------------------
interface InstrumentLibrarySlice {
  instruments: Instrument[];
  instrumentSets: InstrumentSet[];
  addInstrument: (i?: Partial<Instrument>) => Id;
  removeInstrument: (id: Id) => void;
  updateInstrument: (id: Id, patch: Partial<Instrument>) => void;
  duplicateInstrument: (id: Id) => Id;
  hydrateInstruments: (instruments: Instrument[], sets?: InstrumentSet[]) => void;
  addInstrumentSet: (name?: string) => Id;
  renameInstrumentSet: (id: Id, name: string) => void;
  ungroupInstrumentSet: (id: Id, targetSetId?: Id) => void;
  moveInstrument: (id: Id, toSetId: Id, beforeInstrumentId?: Id | null) => void;
  reorderInstrumentSets: (orderedIds: Id[]) => void;
  /** Merge two instruments into a new one — average their knobs/envelope,
   *  union their samples, list them as parents. */
  mergeInstruments: (a: Id, b: Id) => Id | null;
  /** Seed the library with system (non-deletable) instruments. Idempotent. */
  seedSystemInstruments: () => void;
}

export const FACTORY_DRUM_SET_ID = "factory-drums";
export const FACTORY_SYNTH_SET_ID = "factory-synths";
export const ROCK_DRUM_SET_ID = "rock-drums";
export const ORCHESTRA_SET_ID = "orchestra-pit";
export const USER_INSTRUMENT_SET_ID = "user-instruments";

function defaultInstrumentSets(): InstrumentSet[] {
  return [
    { id: ROCK_DRUM_SET_ID, name: "Rock & Roll", factory: true },
    { id: FACTORY_DRUM_SET_ID, name: "Classic Machines", factory: true },
    { id: ORCHESTRA_SET_ID, name: "Orchestra Pit", factory: true },
    { id: FACTORY_SYNTH_SET_ID, name: "Synths", factory: true },
    { id: USER_INSTRUMENT_SET_ID, name: "User", factory: true },
  ];
}

function defaultInstrument(): Instrument {
  return {
    id: nanoid(),
    name: "New Instrument",
    icon: "ph:piano-keys",
    kind: "synth",
    envelope: { attackMs: 5, decayMs: 100, sustain: 0.7, releaseMs: 200 },
    knobs: { cutoff: 0.6, resonance: 0.2, drive: 0.1, color: 0.5 },
    filterType: "lowpass",
    waveform: "saw",
    detuneCents: 0,
    octave: 0,
    subOscLevel: 0,
    glideMs: 0,
    ampLevel: 1,
    ampPan: 0,
    lfoWaveform: "sine",
    lfoRateHz: 4,
    lfoDepth: 0,
    lfoSync: false,
    lfoRetrigger: true,
    lfoPositionBipolar: true,
    lfoPitchBipolar: true,
    lfoFilterBipolar: true,
    lfoToPitch: 0,
    lfoToFilter: 0,
    envToFilter: 0,
    sampleIds: [],
    setId: USER_INSTRUMENT_SET_ID,
    source: { kind: "created", label: "Made in Beat" },
    userCreated: true,
  };
}

export function defaultWavetableConfig() {
  return {
    bank: "aether",
    position: 0.35,
    warp: 0.2,
    unison: 1,
    detuneCents: 12,
    blend: 0.5,
  } satisfies Instrument["wavetable"];
}

export function defaultAetherSynthConfig() {
  const oscA = defaultWavetableConfig();
  return {
    oscA: {
      enabled: true,
      level: 0.78,
      pan: 0,
      waveform: "wavetable",
      octave: 0,
      semitone: 0,
      fineCents: 0,
      wavetable: oscA,
    },
    oscB: {
      enabled: false,
      level: 0.42,
      pan: 0,
      waveform: "wavetable",
      octave: 0,
      semitone: 7,
      fineCents: -4,
      wavetable: { ...oscA, bank: "glass", position: 0.25, warp: 0.16, detuneCents: 8, blend: 0.35 },
    },
    sub: {
      enabled: true,
      level: 0.18,
      octave: -1,
      waveform: "sine",
    },
    noise: {
      enabled: false,
      level: 0.08,
      color: 0.45,
    },
  } satisfies Instrument["aether"];
}

export function snapshotInstrument(instrument: Instrument): InstrumentSnapshot {
  return {
    name: instrument.name,
    icon: instrument.icon,
    kind: instrument.kind,
    envelope: structuredClone(instrument.envelope),
    knobs: structuredClone(instrument.knobs),
    filterType: instrument.filterType,
    waveform: instrument.waveform,
    detuneCents: instrument.detuneCents,
    octave: instrument.octave,
    subOscLevel: instrument.subOscLevel,
    glideMs: instrument.glideMs,
    ampLevel: instrument.ampLevel,
    ampPan: instrument.ampPan,
    wavetable: instrument.wavetable ? structuredClone(instrument.wavetable) : undefined,
    aether: instrument.aether ? structuredClone(instrument.aether) : undefined,
    synthPatch: instrument.synthPatch ? structuredClone(instrument.synthPatch) : undefined,
    lfoWaveform: instrument.lfoWaveform,
    lfoRateHz: instrument.lfoRateHz,
    lfoDepth: instrument.lfoDepth,
    lfoSync: instrument.lfoSync,
    lfoRetrigger: instrument.lfoRetrigger,
    lfoPositionBipolar: instrument.lfoPositionBipolar,
    lfoPitchBipolar: instrument.lfoPitchBipolar,
    lfoFilterBipolar: instrument.lfoFilterBipolar,
    lfoToPitch: instrument.lfoToPitch,
    lfoToFilter: instrument.lfoToFilter,
    envToFilter: instrument.envToFilter,
    sampleIds: [...instrument.sampleIds],
    sampleUrl: instrument.sampleUrl,
    sampleUrls: instrument.sampleUrls ? [...instrument.sampleUrls] : undefined,
    sampleMap: instrument.sampleMap ? structuredClone(instrument.sampleMap) : undefined,
    parentIds: instrument.parentIds ? [...instrument.parentIds] : undefined,
    descriptors: instrument.descriptors ? [...instrument.descriptors] : undefined,
  };
}

function withOriginal(instrument: Instrument): Instrument {
  return { ...instrument, original: snapshotInstrument(instrument) };
}

function normalizeInstrument(instrument: Instrument): Instrument {
  const source = instrument.source ?? inferInstrumentSource(instrument);
  return {
    ...instrument,
    setId: instrument.setId ?? (instrument.userCreated ? USER_INSTRUMENT_SET_ID : FACTORY_SYNTH_SET_ID),
    source,
    descriptors: instrument.descriptors ?? characterizeInstrument(instrument),
    original: instrument.original ?? (source.kind === "created" ? undefined : snapshotInstrument(instrument)),
  };
}

export function characterizeInstrument(instrument: Pick<Instrument, "name" | "kind" | "waveform" | "sampleUrl" | "knobs" | "octave" | "subOscLevel" | "glideMs">): string[] {
  const lower = `${instrument.name} ${instrument.sampleUrl ?? ""}`.toLowerCase();
  const tags = new Set<string>([instrument.kind, instrument.waveform]);
  const addIf = (tag: string, pattern: RegExp) => {
    if (pattern.test(lower)) tags.add(tag);
  };
  addIf("kick", /\b(kick|bd|bass drum|808)\b/);
  addIf("snare", /\b(snare|sd)\b/);
  addIf("clap", /\bclap\b/);
  addIf("rim", /\brim\b/);
  addIf("closed-hat", /\b(closed hat|ch|hh closed)\b/);
  addIf("open-hat", /\b(open hat|oh|hh open)\b/);
  addIf("cymbal", /\b(crash|ride|cymbal)\b/);
  addIf("tom", /\btom\b/);
  addIf("percussion", /\b(conga|bongo|cowbell|timbal|tamb|shaker|triangle|guiro|perc)\b/);
  addIf("bass", /\b(bass|sub|808)\b/);
  addIf("lead", /\b(lead|saw|pluck)\b/);
  addIf("pad", /\b(pad|warm|soft|ambient)\b/);
  if ((instrument.octave ?? 0) < 0 || (instrument.subOscLevel ?? 0) > 0.3) tags.add("low");
  if ((instrument.knobs.drive ?? 0) > 0.35) tags.add("driven");
  if ((instrument.knobs.cutoff ?? 0.5) > 0.75) tags.add("bright");
  if ((instrument.glideMs ?? 0) > 40) tags.add("glide");
  if (instrument.kind === "wavetable" || instrument.waveform === "wavetable") tags.add("wavetable");
  return Array.from(tags).slice(0, 10);
}

function inferInstrumentSource(instrument: Instrument): NonNullable<Instrument["source"]> {
  if (instrument.sampleUrl?.startsWith("/samples/tr505/")) {
    return {
      kind: "factory",
      label: "Oramics sampled / TR-505",
      url: "https://oramics.github.io/sampled/DM/TR-505/",
      license: "Public Domain",
    };
  }
  if (instrument.sampleUrl?.startsWith("/samples/cr78/")) {
    return {
      kind: "factory",
      label: "Oramics sampled / CR-78",
      url: "https://oramics.github.io/sampled/DM/CR-78/",
      license: "Public Domain",
    };
  }
  if (instrument.sampleUrl?.startsWith("/samples/lm2/")) {
    return {
      kind: "factory",
      label: "Oramics sampled / LM-2",
      url: "https://oramics.github.io/sampled/DM/LM-2/",
      license: "Public Domain",
    };
  }
  if (instrument.sampleUrl?.startsWith("/samples/pearl-master-studio/")) {
    return {
      kind: "factory",
      label: "Oramics sampled / Pearl Master Studio",
      url: "https://oramics.github.io/sampled/DRUMS/pearl-master-studio/",
      license: "Creative Commons Attribution 3.0",
    };
  }
  if (instrument.sampleUrl?.startsWith("/samples/vsco-ce/")) {
    return {
      kind: "factory",
      label: "VSCO 2 Community Edition",
      url: "https://github.com/sgossner/VSCO-2-CE",
      license: "CC0-1.0",
    };
  }
  if (instrument.sampleUrl && !instrument.sampleUrl.startsWith("/samples/")) {
    return {
      kind: "uploaded",
      label: instrument.name,
      url: instrument.sampleUrl,
      edited: false,
    };
  }
  return instrument.userCreated
    ? { kind: "created", label: "Made in Beat" }
    : { kind: "created", label: "Made in Beat" };
}

function normalizeInstrumentSets(sets?: InstrumentSet[]): InstrumentSet[] {
  const defaults = defaultInstrumentSets();
  if (!sets || sets.length === 0) return defaults;
  const byId = new Map(defaults.map((set) => [set.id, set]));
  for (const set of sets) {
    const defaultSet = byId.get(set.id);
    byId.set(
      set.id,
      defaultSet?.factory
        ? { ...set, name: set.name.trim() || defaultSet.name, factory: true }
        : set,
    );
  }
  return Array.from(byId.values());
}

export const useInstrumentStore = create<InstrumentLibrarySlice>()(
  immer((set, get) => ({
    instruments: [],
    instrumentSets: defaultInstrumentSets(),
    addInstrument: (patch) => {
      const i = normalizeInstrument({ ...defaultInstrument(), ...patch, id: nanoid() });
      set((s) => {
        s.instruments.push(i);
      });
      return i.id;
    },
    removeInstrument: (id) =>
      set((s) => {
        // System instruments (userCreated === false) are not deletable.
        const target = s.instruments.find((i) => i.id === id);
        if (!target || !target.userCreated) return;
        s.instruments = s.instruments.filter((i) => i.id !== id);
      }),
    updateInstrument: (id, patch) =>
      set((s) => {
        const i = s.instruments.find((x) => x.id === id);
        if (i) {
          Object.assign(i, patch);
          i.descriptors = characterizeInstrument(i);
        }
      }),
    duplicateInstrument: (id) => {
      const src = get().instruments.find((i) => i.id === id);
      if (!src) return "";
      const copy: Instrument = {
        ...structuredClone(src),
        id: nanoid(),
        name: `${src.name} copy`,
        userCreated: true,
        setId: src.setId ?? USER_INSTRUMENT_SET_ID,
        source: { kind: "derived", label: `Derived from ${src.name}`, edited: false },
        original: snapshotInstrument(src),
        parentIds: [src.id],
        descriptors: characterizeInstrument(src),
      };
      set((s) => {
        s.instruments.push(copy);
      });
      return copy.id;
    },
    hydrateInstruments: (instruments, sets) =>
      set((s) => {
        s.instrumentSets = normalizeInstrumentSets(sets);
        s.instruments = instruments.map((instrument) => normalizeInstrument(instrument));
      }),
    addInstrumentSet: (name) => {
      const id = nanoid();
      set((s) => {
        const num = s.instrumentSets.filter((set) => !set.factory).length + 1;
        s.instrumentSets.push({ id, name: name?.trim() || `Set ${num}` });
      });
      return id;
    },
    renameInstrumentSet: (id, name) =>
      set((s) => {
        const target = s.instrumentSets.find((instrumentSet) => instrumentSet.id === id);
        const nextName = name.trim();
        if (!target || !nextName) return;
        target.name = nextName.slice(0, 48);
      }),
    ungroupInstrumentSet: (id, targetSetId = USER_INSTRUMENT_SET_ID) =>
      set((s) => {
        const target = s.instrumentSets.find((instrumentSet) => instrumentSet.id === id);
        if (!target || target.factory) return;
        s.instruments.forEach((instrument) => {
          if (instrument.setId === id) instrument.setId = targetSetId;
        });
        s.instrumentSets = s.instrumentSets.filter((instrumentSet) => instrumentSet.id !== id);
      }),
    moveInstrument: (id, toSetId, beforeInstrumentId) =>
      set((s) => {
        const moving = s.instruments.find((instrument) => instrument.id === id);
        if (!moving) return;
        moving.setId = toSetId;
        s.instruments = s.instruments.filter((instrument) => instrument.id !== id);
        const targetIndex = beforeInstrumentId
          ? s.instruments.findIndex((instrument) => instrument.id === beforeInstrumentId)
          : -1;
        if (targetIndex >= 0) s.instruments.splice(targetIndex, 0, moving);
        else s.instruments.push(moving);
      }),
    reorderInstrumentSets: (orderedIds) =>
      set((s) => {
        const map = new Map(s.instrumentSets.map((set) => [set.id, set]));
        s.instrumentSets = orderedIds
          .map((id) => map.get(id))
          .filter((set): set is InstrumentSet => Boolean(set));
      }),
    seedSystemInstruments: () => {
      const sampler = (
        name: string,
        sampleUrl: string,
        source: Instrument["source"],
        knobs: Instrument["knobs"] = { cutoff: 0.7, resonance: 0.15, drive: 0.1, color: 0.5 },
        setId: Id = FACTORY_DRUM_SET_ID,
        envelope: Instrument["envelope"] = { attackMs: 1, decayMs: 80, sustain: 0, releaseMs: 80 },
      ): Instrument => withOriginal({
          id: nanoid(),
          name,
          kind: "sampler",
          envelope,
          knobs,
          waveform: "sample",
          sampleIds: [],
          sampleUrl,
          setId,
          source,
          userCreated: false,
        });

      const tr505Source: Instrument["source"] = {
        kind: "factory",
        label: "Oramics sampled / TR-505",
        url: "https://oramics.github.io/sampled/DM/TR-505/",
        license: "Public Domain",
      };
      const cr78Source: Instrument["source"] = {
        kind: "factory",
        label: "Oramics sampled / CR-78",
        url: "https://oramics.github.io/sampled/DM/CR-78/",
        license: "Public Domain",
      };
      const lm2Source: Instrument["source"] = {
        kind: "factory",
        label: "Oramics sampled / LM-2",
        url: "https://oramics.github.io/sampled/DM/LM-2/",
        license: "Public Domain",
      };
      const pearlSource: Instrument["source"] = {
        kind: "factory",
        label: "Oramics sampled / Pearl Master Studio",
        url: "https://oramics.github.io/sampled/DRUMS/pearl-master-studio/",
        license: "Creative Commons Attribution 3.0",
      };
      const vscoSource: Instrument["source"] = {
        kind: "factory",
        label: "VSCO 2 Community Edition",
        url: "https://github.com/sgossner/VSCO-2-CE",
        license: "CC0-1.0",
      };
      const beatSource: Instrument["source"] = {
        kind: "created",
        label: "Made in Beat",
      };

      const seeds: Instrument[] = [
        withOriginal({
          id: nanoid(),
          name: "Basic Kick",
          kind: "sampler",
          envelope: { attackMs: 1, decayMs: 80, sustain: 0.0, releaseMs: 40 },
          knobs: { cutoff: 0.18, resonance: 0.25, drive: 0.4, color: 0.1 },
          waveform: "sample",
          sampleIds: [],
          sampleUrl: "/samples/tr505/tr505-kick.wav",
          setId: FACTORY_DRUM_SET_ID,
          source: tr505Source,
          userCreated: false,
        }),
        withOriginal({
          id: nanoid(),
          name: "Snap Snare",
          kind: "sampler",
          envelope: { attackMs: 1, decayMs: 60, sustain: 0.0, releaseMs: 120 },
          knobs: { cutoff: 0.7, resonance: 0.5, drive: 0.3, color: 0.6 },
          waveform: "sample",
          sampleIds: [],
          sampleUrl: "/samples/tr505/tr505-snare.wav",
          setId: FACTORY_DRUM_SET_ID,
          source: tr505Source,
          userCreated: false,
        }),
        withOriginal({
          id: nanoid(),
          name: "Closed Hat",
          kind: "sampler",
          envelope: { attackMs: 1, decayMs: 50, sustain: 0.0, releaseMs: 40 },
          knobs: { cutoff: 0.8, resonance: 0.1, drive: 0.0, color: 0.5 },
          waveform: "sample",
          sampleIds: [],
          sampleUrl: "/samples/tr505/tr505-hihat-closed.wav",
          setId: FACTORY_DRUM_SET_ID,
          source: tr505Source,
          userCreated: false,
        }),
        withOriginal({
          id: nanoid(),
          name: "Open Hat",
          kind: "sampler",
          envelope: { attackMs: 1, decayMs: 140, sustain: 0.0, releaseMs: 120 },
          knobs: { cutoff: 0.85, resonance: 0.1, drive: 0.0, color: 0.5 },
          waveform: "sample",
          sampleIds: [],
          sampleUrl: "/samples/tr505/tr505-hihat-open.wav",
          setId: FACTORY_DRUM_SET_ID,
          source: tr505Source,
          userCreated: false,
        }),
        sampler("TR-505 Clap", "/samples/tr505/tr505-clap.wav", tr505Source, { cutoff: 0.7, resonance: 0.25, drive: 0.25, color: 0.5 }),
        sampler("TR-505 Rim", "/samples/tr505/tr505-rim.wav", tr505Source, { cutoff: 0.65, resonance: 0.35, drive: 0.1, color: 0.55 }),
        sampler("TR-505 Crash", "/samples/tr505/tr505-crash.wav", tr505Source, { cutoff: 0.9, resonance: 0.1, drive: 0, color: 0.7 }),
        sampler("TR-505 Ride", "/samples/tr505/tr505-ride.wav", tr505Source, { cutoff: 0.85, resonance: 0.12, drive: 0, color: 0.65 }),
        sampler("TR-505 Low Tom", "/samples/tr505/tr505-tom-l.wav", tr505Source, { cutoff: 0.4, resonance: 0.2, drive: 0.15, color: 0.35 }),
        sampler("TR-505 Mid Tom", "/samples/tr505/tr505-tom-m.wav", tr505Source, { cutoff: 0.5, resonance: 0.2, drive: 0.15, color: 0.4 }),
        sampler("TR-505 High Tom", "/samples/tr505/tr505-tom-h.wav", tr505Source, { cutoff: 0.6, resonance: 0.2, drive: 0.15, color: 0.45 }),
        sampler("TR-505 Low Conga", "/samples/tr505/tr505-conga-l.wav", tr505Source, { cutoff: 0.45, resonance: 0.25, drive: 0.1, color: 0.35 }),
        sampler("TR-505 High Conga", "/samples/tr505/tr505-conga-h.wav", tr505Source, { cutoff: 0.58, resonance: 0.25, drive: 0.1, color: 0.4 }),
        sampler("TR-505 Cowbell Low", "/samples/tr505/tr505-cowb-l.wav", tr505Source, { cutoff: 0.72, resonance: 0.45, drive: 0.05, color: 0.55 }),
        sampler("TR-505 Cowbell High", "/samples/tr505/tr505-cowb-h.wav", tr505Source, { cutoff: 0.78, resonance: 0.45, drive: 0.05, color: 0.6 }),
        sampler("TR-505 Timbal", "/samples/tr505/tr505-timbal.wav", tr505Source, { cutoff: 0.7, resonance: 0.3, drive: 0.1, color: 0.5 }),
        sampler("CR-78 Cymbal", "/samples/cr78/cymbal.wav", cr78Source, { cutoff: 0.9, resonance: 0.15, drive: 0, color: 0.7 }),
        sampler("CR-78 Tambourine", "/samples/cr78/tamb-short.wav", cr78Source, { cutoff: 0.86, resonance: 0.12, drive: 0, color: 0.65 }),
        sampler("CR-78 Guiro", "/samples/cr78/guiro-short.wav", cr78Source, { cutoff: 0.75, resonance: 0.2, drive: 0.05, color: 0.55 }),
        sampler("LM-2 Kick", "/samples/lm2/kick.wav", lm2Source, { cutoff: 0.4, resonance: 0.18, drive: 0.18, color: 0.35 }),
        sampler("LM-2 Snare", "/samples/lm2/snare-m.wav", lm2Source, { cutoff: 0.7, resonance: 0.2, drive: 0.18, color: 0.55 }),
        sampler("LM-2 Closed Hat", "/samples/lm2/hihat-closed-short.wav", lm2Source, { cutoff: 0.9, resonance: 0.08, drive: 0, color: 0.68 }),
        sampler("LM-2 Open Hat", "/samples/lm2/hihat-open.wav", lm2Source, { cutoff: 0.9, resonance: 0.08, drive: 0, color: 0.7 }),
        sampler("LM-2 Clap", "/samples/lm2/clap.wav", lm2Source, { cutoff: 0.75, resonance: 0.2, drive: 0.2, color: 0.55 }),
        sampler("LM-2 Crash", "/samples/lm2/crash.wav", lm2Source, { cutoff: 0.92, resonance: 0.1, drive: 0, color: 0.72 }),
        sampler("LM-2 Ride", "/samples/lm2/ride.wav", lm2Source, { cutoff: 0.88, resonance: 0.1, drive: 0, color: 0.68 }),
        sampler("Pearl Kick", "/samples/pearl-master-studio/kick-01.wav", pearlSource, { cutoff: 0.48, resonance: 0.15, drive: 0.08, color: 0.34 }, ROCK_DRUM_SET_ID),
        sampler("Pearl Snare", "/samples/pearl-master-studio/snare-01.wav", pearlSource, { cutoff: 0.74, resonance: 0.18, drive: 0.1, color: 0.55 }, ROCK_DRUM_SET_ID),
        sampler("Pearl Closed Hat", "/samples/pearl-master-studio/hihat-closed.wav", pearlSource, { cutoff: 0.9, resonance: 0.08, drive: 0, color: 0.7 }, ROCK_DRUM_SET_ID),
        sampler("Pearl Open Hat", "/samples/pearl-master-studio/hihat-open.wav", pearlSource, { cutoff: 0.92, resonance: 0.08, drive: 0, color: 0.72 }, ROCK_DRUM_SET_ID),
        sampler("Pearl Crash", "/samples/pearl-master-studio/crash-01.wav", pearlSource, { cutoff: 0.94, resonance: 0.08, drive: 0, color: 0.75 }, ROCK_DRUM_SET_ID),
        sampler("Pearl Ride", "/samples/pearl-master-studio/ride-01.wav", pearlSource, { cutoff: 0.9, resonance: 0.12, drive: 0, color: 0.72 }, ROCK_DRUM_SET_ID),
        sampler("Pearl Low Tom", "/samples/pearl-master-studio/tom-01.wav", pearlSource, { cutoff: 0.52, resonance: 0.12, drive: 0.06, color: 0.4 }, ROCK_DRUM_SET_ID),
        sampler("Pearl Mid Tom", "/samples/pearl-master-studio/tom-02.wav", pearlSource, { cutoff: 0.58, resonance: 0.12, drive: 0.06, color: 0.45 }, ROCK_DRUM_SET_ID),
        sampler("Pearl High Tom", "/samples/pearl-master-studio/tom-03.wav", pearlSource, { cutoff: 0.64, resonance: 0.12, drive: 0.06, color: 0.5 }, ROCK_DRUM_SET_ID),
        sampler("Orchestral Bass Drum", "/samples/vsco-ce/bass-drum.wav", vscoSource, { cutoff: 0.45, resonance: 0.12, drive: 0.04, color: 0.42 }, ORCHESTRA_SET_ID, { attackMs: 1, decayMs: 240, sustain: 0, releaseMs: 220 }),
        sampler("Triangle", "/samples/vsco-ce/triangle-hit.wav", vscoSource, { cutoff: 0.95, resonance: 0.08, drive: 0, color: 0.8 }, ORCHESTRA_SET_ID, { attackMs: 1, decayMs: 350, sustain: 0, releaseMs: 500 }),
        sampler("Suspended Cymbal", "/samples/vsco-ce/suspended-cymbal.wav", vscoSource, { cutoff: 0.9, resonance: 0.1, drive: 0, color: 0.7 }, ORCHESTRA_SET_ID, { attackMs: 1, decayMs: 500, sustain: 0, releaseMs: 800 }),
        sampler("Flute Staccato", "/samples/vsco-ce/flute-c5.wav", vscoSource, { cutoff: 0.82, resonance: 0.1, drive: 0, color: 0.65 }, ORCHESTRA_SET_ID, { attackMs: 3, decayMs: 140, sustain: 0.35, releaseMs: 160 }),
        sampler("Violin Pizzicato", "/samples/vsco-ce/violin-pizz-c5.wav", vscoSource, { cutoff: 0.78, resonance: 0.12, drive: 0.02, color: 0.62 }, ORCHESTRA_SET_ID, { attackMs: 1, decayMs: 160, sustain: 0, releaseMs: 220 }),
        withOriginal({
          id: nanoid(),
          name: "Sub Kick (Synth)",
          kind: "synth",
          envelope: { attackMs: 1, decayMs: 260, sustain: 0, releaseMs: 180 },
          knobs: { cutoff: 0.24, resonance: 0.1, drive: 0.18, color: 0.45 },
          waveform: "sine",
          octave: -2,
          detuneCents: 0,
          subOscLevel: 0.35,
          glideMs: 0,
          sampleIds: [],
          setId: FACTORY_SYNTH_SET_ID,
          source: beatSource,
          userCreated: false,
        }),
        withOriginal({
          id: nanoid(),
          name: "Triangle Perc",
          kind: "synth",
          envelope: { attackMs: 1, decayMs: 160, sustain: 0, releaseMs: 80 },
          knobs: { cutoff: 0.78, resonance: 0.18, drive: 0.05, color: 0.55 },
          waveform: "triangle",
          octave: 2,
          detuneCents: 0,
          subOscLevel: 0,
          glideMs: 0,
          sampleIds: [],
          setId: FACTORY_SYNTH_SET_ID,
          source: beatSource,
          userCreated: false,
        }),
        withOriginal({
          id: nanoid(),
          name: "Lead Saw",
          kind: "synth",
          envelope: { attackMs: 5, decayMs: 200, sustain: 0.7, releaseMs: 300 },
          knobs: { cutoff: 0.55, resonance: 0.3, drive: 0.15, color: 0.5 },
          waveform: "saw",
          sampleIds: [],
          setId: FACTORY_SYNTH_SET_ID,
          source: beatSource,
          userCreated: false,
        }),
        withOriginal({
          id: nanoid(),
          name: "Sample Pad",
          kind: "sampler",
          envelope: { attackMs: 10, decayMs: 200, sustain: 0.8, releaseMs: 500 },
          knobs: { cutoff: 0.6, resonance: 0.2, drive: 0.0, color: 0.5 },
          waveform: "sample",
          sampleIds: [],
          setId: FACTORY_SYNTH_SET_ID,
          source: beatSource,
          userCreated: false,
        }),
      ];
      set((s) => {
        s.instrumentSets = normalizeInstrumentSets(s.instrumentSets);
        const existingKeys = new Set(
          s.instruments
            .filter((instrument) => !instrument.userCreated)
            .map((instrument) => instrument.sampleUrl ?? instrument.name),
        );
        const missingSeeds = seeds.filter((instrument) => !existingKeys.has(instrument.sampleUrl ?? instrument.name));
        for (const instrument of s.instruments) {
          if (!instrument.userCreated && instrument.name === "808 Bass Kick" && instrument.kind === "synth") {
            instrument.name = "Sub Kick (Synth)";
            instrument.setId = FACTORY_SYNTH_SET_ID;
            instrument.source = beatSource;
          }
        }
        s.instruments.unshift(...missingSeeds);
      });
    },

    mergeInstruments: (aId, bId) => {
      const all = get().instruments;
      const a = all.find((i) => i.id === aId);
      const b = all.find((i) => i.id === bId);
      if (!a || !b) return null;
      // "Merge" = arithmetic average of continuous params, union of samples,
      // pick the more interesting waveform (b wins ties), and credit both as
      // parents. Other "creative" merges can plug in later.
      const avg = (x: number, y: number) => (x + y) / 2;
      const merged: Instrument = {
        id: nanoid(),
        name: `${a.name} × ${b.name}`,
        kind:
          a.kind === b.kind ? a.kind : a.kind === "synth" ? "hybrid" : "hybrid",
        envelope: {
          attackMs: avg(a.envelope.attackMs, b.envelope.attackMs),
          decayMs: avg(a.envelope.decayMs, b.envelope.decayMs),
          sustain: avg(a.envelope.sustain, b.envelope.sustain),
          releaseMs: avg(a.envelope.releaseMs, b.envelope.releaseMs),
        },
        knobs: {
          cutoff: avg(a.knobs.cutoff, b.knobs.cutoff),
          resonance: avg(a.knobs.resonance, b.knobs.resonance),
          drive: avg(a.knobs.drive, b.knobs.drive),
          color: avg(a.knobs.color, b.knobs.color),
        },
        waveform: b.waveform,
        sampleIds: Array.from(new Set([...a.sampleIds, ...b.sampleIds])),
        sampleUrl: b.sampleUrl ?? a.sampleUrl,
        sampleUrls: Array.from(new Set([
          ...(a.sampleUrls ?? []),
          ...(a.sampleUrl ? [a.sampleUrl] : []),
          ...(b.sampleUrls ?? []),
          ...(b.sampleUrl ? [b.sampleUrl] : []),
        ])),
        setId: USER_INSTRUMENT_SET_ID,
        source: { kind: "derived", label: `Merged from ${a.name} and ${b.name}` },
        parentIds: [a.id, b.id],
        userCreated: true,
      };
      merged.original = snapshotInstrument(merged);
      set((s) => {
        s.instruments.push(merged);
      });
      return merged.id;
    },
  })),
);

// ---------------------------------------------------------------------------
// Audio files are library-level assets, separate from track placement.
// ---------------------------------------------------------------------------
interface AudioFileLibrarySlice {
  files: AudioFile[];
  addFile: (file: AudioFile) => void;
  removeFile: (id: Id) => void;
}

export const useAudioFileStore = create<AudioFileLibrarySlice>()(
  immer((set) => ({
    files: [],
    addFile: (file) =>
      set((s) => {
        if (s.files.some((f) => f.id === file.id)) return;
        s.files.push(file);
      }),
    removeFile: (id) =>
      set((s) => {
        s.files = s.files.filter((f) => f.id !== id);
      }),
  })),
);

// ---- Helpers -----------------------------------------------------------

function dedupeEditor(
  list: UiState["openEditors"],
  e: UiState["openEditors"][number],
) {
  return list.some((x) => sameEditor(x, e)) ? list : [...list, e];
}
function sameEditor(
  a: UiState["openEditors"][number],
  b: UiState["openEditors"][number],
) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "instrument" && b.kind === "instrument")
    return a.instrumentId === b.instrumentId;
  if (a.kind === "segment" && b.kind === "segment")
    return a.segmentId === b.segmentId;
  if (a.kind === "component" && b.kind === "component")
    return a.componentId === b.componentId;
  return true;
}

function restoreSoloAutoMutes(tracks: Track[]) {
  for (const t of tracks) {
    if (soloAutoMutedTrackIds.has(t.id)) t.mute = false;
    t.solo = false;
  }
  soloAutoMutedTrackIds = new Set();
}

function normalizeSegmentLayers(track: Track) {
  const ordered = [...track.segments].sort((a, b) => a.startBeat - b.startBeat || a.id.localeCompare(b.id));
  for (const seg of ordered) {
    const segEnd = seg.startBeat + seg.lengthBeats;
    const fullyCoveredByEarlier = ordered.some((candidate) => {
      if (candidate === seg || candidate.startBeat > seg.startBeat) return false;
      const candidateEnd = candidate.startBeat + candidate.lengthBeats;
      return seg.startBeat >= candidate.startBeat && segEnd <= candidateEnd;
    });
    seg.layer = fullyCoveredByEarlier ? 1 : 0;
  }
}
