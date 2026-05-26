import { create } from "zustand";
import { temporal } from "zundo";
import { immer } from "zustand/middleware/immer";
import { nanoid } from "nanoid";
import type {
  Beats,
  AudioFile,
  Id,
  Instrument,
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

function makeEmptyProject(): Project {
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
      project: makeEmptyProject(),

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
          seg.layer = computeLayerForInsertion(track, seg);
          track.segments.push(seg);
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
          // Auto-assign a layer so overlapping segments don't collide.
          seg.layer = computeLayerForInsertion(dest, seg);
          dest.segments.push(seg);
        }),

      updateSegment: (segmentId, patch) =>
        set((s) => {
          for (const t of s.project.tracks) {
            const seg = t.segments.find((x) => x.id === segmentId);
            if (seg) {
              Object.assign(seg, patch);
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
export const undo = () => useProjectStore.temporal.getState().undo();
export const redo = () => useProjectStore.temporal.getState().redo();
export const canUndo = () =>
  useProjectStore.temporal.getState().pastStates.length > 0;
export const canRedo = () =>
  useProjectStore.temporal.getState().futureStates.length > 0;

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
  setResizeSnapSeconds: (s: number) => void;
  setResizeSnapMeasures: (m: number) => void;
}

export const useSettingsStore = create<SettingsSlice>()((set) => ({
  resizeSnapSeconds: 1,
  resizeSnapMeasures: 1,
  setResizeSnapSeconds: (s) => set({ resizeSnapSeconds: Math.max(0.0625, s) }),
  setResizeSnapMeasures: (m) => set({ resizeSnapMeasures: Math.max(1, Math.round(m)) }),
}));

// ---------------------------------------------------------------------------
// UI: ephemeral selection / modal state.
// ---------------------------------------------------------------------------
interface UiSlice extends UiState {
  selectTrack: (id: Id, additive?: boolean) => void;
  selectSegment: (id: Id, additive?: boolean) => void;
  clearSelection: () => void;
  openEditor: (e: UiState["openEditors"][number]) => void;
  closeEditor: (e: UiState["openEditors"][number]) => void;
}

export const useUiStore = create<UiSlice>()((set) => ({
  selectedTrackIds: [],
  selectedSegmentIds: [],
  openEditors: [],
  selectTrack: (id, additive) =>
    set((s) => ({
      selectedTrackIds: additive
        ? s.selectedTrackIds.includes(id)
          ? s.selectedTrackIds.filter((x) => x !== id)
          : [...s.selectedTrackIds, id]
        : [id],
    })),
  selectSegment: (id, additive) =>
    set((s) => ({
      selectedSegmentIds: additive
        ? s.selectedSegmentIds.includes(id)
          ? s.selectedSegmentIds.filter((x) => x !== id)
          : [...s.selectedSegmentIds, id]
        : [id],
    })),
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
}));

// ---------------------------------------------------------------------------
// Instruments are a separate store: they're project-independent (library).
// ---------------------------------------------------------------------------
interface InstrumentLibrarySlice {
  instruments: Instrument[];
  addInstrument: (i?: Partial<Instrument>) => Id;
  removeInstrument: (id: Id) => void;
  updateInstrument: (id: Id, patch: Partial<Instrument>) => void;
  duplicateInstrument: (id: Id) => Id;
  /** Merge two instruments into a new one — average their knobs/envelope,
   *  union their samples, list them as parents. */
  mergeInstruments: (a: Id, b: Id) => Id | null;
  /** Seed the library with system (non-deletable) instruments. Idempotent. */
  seedSystemInstruments: () => void;
}

function defaultInstrument(): Instrument {
  return {
    id: nanoid(),
    name: "New Instrument",
    kind: "synth",
    envelope: { attackMs: 5, decayMs: 100, sustain: 0.7, releaseMs: 200 },
    knobs: { cutoff: 0.6, resonance: 0.2, drive: 0.1, color: 0.5 },
    waveform: "saw",
    detuneCents: 0,
    octave: 0,
    subOscLevel: 0,
    glideMs: 0,
    lfoWaveform: "sine",
    lfoRateHz: 4,
    lfoDepth: 0,
    lfoSync: false,
    lfoRetrigger: true,
    lfoToPitch: 0,
    lfoToFilter: 0,
    envToFilter: 0,
    sampleIds: [],
    userCreated: true,
  };
}

export const useInstrumentStore = create<InstrumentLibrarySlice>()(
  immer((set, get) => ({
    instruments: [],
    addInstrument: (patch) => {
      const i = { ...defaultInstrument(), ...patch, id: nanoid() };
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
        if (i) Object.assign(i, patch);
      }),
    duplicateInstrument: (id) => {
      const src = get().instruments.find((i) => i.id === id);
      if (!src) return "";
      const copy: Instrument = {
        ...structuredClone(src),
        id: nanoid(),
        name: `${src.name} copy`,
        userCreated: true,
        parentIds: [src.id],
      };
      set((s) => {
        s.instruments.push(copy);
      });
      return copy.id;
    },
    seedSystemInstruments: () => {
      const existing = get().instruments;
      if (existing.some((i) => !i.userCreated)) return;

      const sampler = (
        name: string,
        sampleUrl: string,
        knobs: Instrument["knobs"] = { cutoff: 0.7, resonance: 0.15, drive: 0.1, color: 0.5 },
      ): Instrument => ({
        id: nanoid(),
        name,
        kind: "sampler",
        envelope: { attackMs: 1, decayMs: 80, sustain: 0, releaseMs: 80 },
        knobs,
        waveform: "sample",
        sampleIds: [],
        sampleUrl,
        userCreated: false,
      });

      const seeds: Instrument[] = [
        {
          id: nanoid(),
          name: "Basic Kick",
          kind: "sampler",
          envelope: { attackMs: 1, decayMs: 80, sustain: 0.0, releaseMs: 40 },
          knobs: { cutoff: 0.18, resonance: 0.25, drive: 0.4, color: 0.1 },
          waveform: "sample",
          sampleIds: [],
          sampleUrl: "/samples/tr505/tr505-kick.wav",
          userCreated: false,
        },
        {
          id: nanoid(),
          name: "Snap Snare",
          kind: "sampler",
          envelope: { attackMs: 1, decayMs: 60, sustain: 0.0, releaseMs: 120 },
          knobs: { cutoff: 0.7, resonance: 0.5, drive: 0.3, color: 0.6 },
          waveform: "sample",
          sampleIds: [],
          sampleUrl: "/samples/tr505/tr505-snare.wav",
          userCreated: false,
        },
        {
          id: nanoid(),
          name: "Closed Hat",
          kind: "sampler",
          envelope: { attackMs: 1, decayMs: 50, sustain: 0.0, releaseMs: 40 },
          knobs: { cutoff: 0.8, resonance: 0.1, drive: 0.0, color: 0.5 },
          waveform: "sample",
          sampleIds: [],
          sampleUrl: "/samples/tr505/tr505-hihat-closed.wav",
          userCreated: false,
        },
        {
          id: nanoid(),
          name: "Open Hat",
          kind: "sampler",
          envelope: { attackMs: 1, decayMs: 140, sustain: 0.0, releaseMs: 120 },
          knobs: { cutoff: 0.85, resonance: 0.1, drive: 0.0, color: 0.5 },
          waveform: "sample",
          sampleIds: [],
          sampleUrl: "/samples/tr505/tr505-hihat-open.wav",
          userCreated: false,
        },
        sampler("TR-505 Clap", "/samples/tr505/tr505-clap.wav", { cutoff: 0.7, resonance: 0.25, drive: 0.25, color: 0.5 }),
        sampler("TR-505 Rim", "/samples/tr505/tr505-rim.wav", { cutoff: 0.65, resonance: 0.35, drive: 0.1, color: 0.55 }),
        sampler("TR-505 Crash", "/samples/tr505/tr505-crash.wav", { cutoff: 0.9, resonance: 0.1, drive: 0, color: 0.7 }),
        sampler("TR-505 Ride", "/samples/tr505/tr505-ride.wav", { cutoff: 0.85, resonance: 0.12, drive: 0, color: 0.65 }),
        sampler("TR-505 Low Tom", "/samples/tr505/tr505-tom-l.wav", { cutoff: 0.4, resonance: 0.2, drive: 0.15, color: 0.35 }),
        sampler("TR-505 Mid Tom", "/samples/tr505/tr505-tom-m.wav", { cutoff: 0.5, resonance: 0.2, drive: 0.15, color: 0.4 }),
        sampler("TR-505 High Tom", "/samples/tr505/tr505-tom-h.wav", { cutoff: 0.6, resonance: 0.2, drive: 0.15, color: 0.45 }),
        sampler("TR-505 Low Conga", "/samples/tr505/tr505-conga-l.wav", { cutoff: 0.45, resonance: 0.25, drive: 0.1, color: 0.35 }),
        sampler("TR-505 High Conga", "/samples/tr505/tr505-conga-h.wav", { cutoff: 0.58, resonance: 0.25, drive: 0.1, color: 0.4 }),
        sampler("TR-505 Cowbell Low", "/samples/tr505/tr505-cowb-l.wav", { cutoff: 0.72, resonance: 0.45, drive: 0.05, color: 0.55 }),
        sampler("TR-505 Cowbell High", "/samples/tr505/tr505-cowb-h.wav", { cutoff: 0.78, resonance: 0.45, drive: 0.05, color: 0.6 }),
        sampler("TR-505 Timbal", "/samples/tr505/tr505-timbal.wav", { cutoff: 0.7, resonance: 0.3, drive: 0.1, color: 0.5 }),
        sampler("CR-78 Cymbal", "/samples/cr78/cymbal.wav", { cutoff: 0.9, resonance: 0.15, drive: 0, color: 0.7 }),
        sampler("CR-78 Tambourine", "/samples/cr78/tamb-short.wav", { cutoff: 0.86, resonance: 0.12, drive: 0, color: 0.65 }),
        sampler("CR-78 Guiro", "/samples/cr78/guiro-short.wav", { cutoff: 0.75, resonance: 0.2, drive: 0.05, color: 0.55 }),
        {
          id: nanoid(),
          name: "808 Bass Kick",
          kind: "synth",
          envelope: { attackMs: 1, decayMs: 260, sustain: 0, releaseMs: 180 },
          knobs: { cutoff: 0.24, resonance: 0.1, drive: 0.18, color: 0.45 },
          waveform: "sine",
          octave: -2,
          detuneCents: 0,
          subOscLevel: 0.35,
          glideMs: 0,
          sampleIds: [],
          userCreated: false,
        },
        {
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
          userCreated: false,
        },
        {
          id: nanoid(),
          name: "Lead Saw",
          kind: "synth",
          envelope: { attackMs: 5, decayMs: 200, sustain: 0.7, releaseMs: 300 },
          knobs: { cutoff: 0.55, resonance: 0.3, drive: 0.15, color: 0.5 },
          waveform: "saw",
          sampleIds: [],
          userCreated: false,
        },
        {
          id: nanoid(),
          name: "Sample Pad",
          kind: "sampler",
          envelope: { attackMs: 10, decayMs: 200, sustain: 0.8, releaseMs: 500 },
          knobs: { cutoff: 0.6, resonance: 0.2, drive: 0.0, color: 0.5 },
          waveform: "sample",
          sampleIds: [],
          userCreated: false,
        },
      ];
      set((s) => {
        s.instruments.unshift(...seeds);
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
        parentIds: [a.id, b.id],
        userCreated: true,
      };
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
  return true;
}

function restoreSoloAutoMutes(tracks: Track[]) {
  for (const t of tracks) {
    if (soloAutoMutedTrackIds.has(t.id)) t.mute = false;
    t.solo = false;
  }
  soloAutoMutedTrackIds = new Set();
}

/**
 * Compute the layer index for a newly-inserted segment in a track.
 * If it overlaps an existing segment, layer up so it sits above. The
 * visual layout will visually shorten layered segments to keep all of
 * them clickable (per spec).
 */
function computeLayerForInsertion(track: Track, seg: Segment): number {
  const segEnd = seg.startBeat + seg.lengthBeats;
  let maxLayer = 0;
  for (const existing of track.segments) {
    const existingEnd = existing.startBeat + existing.lengthBeats;
    const overlaps = seg.startBeat < existingEnd && existing.startBeat < segEnd;
    if (overlaps) maxLayer = Math.max(maxLayer, existing.layer + 1);
  }
  return maxLayer;
}
