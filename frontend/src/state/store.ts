import { create } from "zustand";
import { temporal } from "zundo";
import { immer } from "zustand/middleware/immer";
import { nanoid } from "nanoid";
import type { BeatProjectAsset, BeatProjectIntegrityReport, ProjectSidecarCleanupReport, RecentProjectEntry } from "../ipc/schema";
import type {
  Beats,
  AudioFile,
  Id,
  Instrument,
  InstrumentSet,
  InstrumentSnapshot,
  MidiNote,
  PluginAdapter,
  Project,
  Segment,
  Track,
  TrackEffect,
  TrackEffectAutomationPoint,
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
  addTrackEffect: (trackId: Id, kind?: TrackEffect["kind"]) => Id;
  setTrackEffectKind: (trackId: Id, effectId: Id, kind: TrackEffect["kind"]) => void;
  upsertTrackEffectAutomationPoint: (
    trackId: Id,
    effectId: Id,
    param: string,
    point: Partial<TrackEffectAutomationPoint> & { beat: Beats; value: number },
  ) => Id;
  removeTrackEffectAutomationPoint: (trackId: Id, effectId: Id, param: string, pointId: Id) => void;
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
  applySegmentEditCommand: (command: SegmentEditCommand) => Id[];
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

export type SegmentEditCommand =
  | {
      kind: "move";
      moves: Array<{ segmentId: Id; toTrackId: Id; toStartBeat: Beats }>;
    }
  | {
      kind: "resize";
      segmentId: Id;
      startBeat: Beats;
      lengthBeats: Beats;
      originStartBeat?: Beats;
      originLengthBeats?: Beats;
      originSourceStartBeat?: Beats;
      originPayload?: Segment["payload"];
    }
  | {
      kind: "duplicate";
      segments: Array<Segment & { name?: string }>;
      offsetBeats?: Beats;
      targetTrackId?: Id;
    }
  | {
      kind: "delete";
      segmentIds: Id[];
    }
  | {
      kind: "nudge";
      segmentIds: Id[];
      deltaBeats: Beats;
    }
  | {
      kind: "quantize";
      segmentIds: Id[];
      gridBeats: Beats;
    }
  | {
      kind: "split";
      segmentId: Id;
      splitBeat: Beats;
    }
  | {
      kind: "trim";
      segmentId: Id;
      edge: "start" | "end";
      beat: Beats;
    }
  | {
      kind: "fade";
      segmentId: Id;
      fadeInBeats?: Beats;
      fadeOutBeats?: Beats;
    }
  | {
      kind: "crossfade";
      firstSegmentId: Id;
      secondSegmentId: Id;
      lengthBeats?: Beats;
    };

const MIN_SEGMENT_LENGTH_BEATS = 0.25;
const SETTINGS_STORAGE_KEY = "beat.settings.v1";

export type FileAssetPolicy = "reference" | "copy" | "ask";
export type MemoryCachePreset = "conservative" | "balanced" | "performance";
export type StartupProjectBehavior = "home" | "restore-last" | "new-project";

interface SettingsSnapshot {
  resizeSnapSeconds: number;
  resizeSnapMeasures: number;
  timelineSmartGrid: boolean;
  midiSmartGrid: boolean;
  timelineSubdivision: 2 | 4 | 8 | 16;
  midiSubdivision: 2 | 4 | 8 | 16;
  preferredAudioTypeName: string;
  preferredInputDeviceName: string;
  preferredOutputDeviceName: string;
  defaultInputMonitoring: boolean;
  defaultRecordArm: boolean;
  defaultInputChannelCount: 1 | 2;
  fileAssetPolicy: FileAssetPolicy;
  autosaveBackups: boolean;
  maxRecentProjects: number;
  memoryCachePreset: MemoryCachePreset;
  restoreLastProject: boolean;
  startupProjectBehavior: StartupProjectBehavior;
}

const DEFAULT_SETTINGS: SettingsSnapshot = {
  resizeSnapSeconds: 1,
  resizeSnapMeasures: 1,
  timelineSmartGrid: true,
  midiSmartGrid: true,
  timelineSubdivision: 4,
  midiSubdivision: 4,
  preferredAudioTypeName: "",
  preferredInputDeviceName: "",
  preferredOutputDeviceName: "",
  defaultInputMonitoring: false,
  defaultRecordArm: false,
  defaultInputChannelCount: 2,
  fileAssetPolicy: "copy",
  autosaveBackups: true,
  maxRecentProjects: 8,
  memoryCachePreset: "balanced",
  restoreLastProject: false,
  startupProjectBehavior: "home",
};

function readSettingsSnapshot(): SettingsSnapshot {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    return normalizeSettingsSnapshot(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}"));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettingsPatch(patch: Partial<SettingsSnapshot>) {
  if (typeof window === "undefined") return;
  const next = normalizeSettingsSnapshot({ ...readSettingsSnapshot(), ...patch });
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
}

function normalizeSettingsSnapshot(value: unknown): SettingsSnapshot {
  const source = value && typeof value === "object" ? value as Partial<SettingsSnapshot> : {};
  return {
    resizeSnapSeconds: clampNumber(source.resizeSnapSeconds, 0.0625, 16, DEFAULT_SETTINGS.resizeSnapSeconds),
    resizeSnapMeasures: Math.max(1, Math.min(16, Math.round(source.resizeSnapMeasures ?? DEFAULT_SETTINGS.resizeSnapMeasures))),
    timelineSmartGrid: source.timelineSmartGrid ?? DEFAULT_SETTINGS.timelineSmartGrid,
    midiSmartGrid: source.midiSmartGrid ?? DEFAULT_SETTINGS.midiSmartGrid,
    timelineSubdivision: normalizeSubdivision(source.timelineSubdivision, DEFAULT_SETTINGS.timelineSubdivision),
    midiSubdivision: normalizeSubdivision(source.midiSubdivision, DEFAULT_SETTINGS.midiSubdivision),
    preferredAudioTypeName: normalizeString(source.preferredAudioTypeName),
    preferredInputDeviceName: normalizeString(source.preferredInputDeviceName),
    preferredOutputDeviceName: normalizeString(source.preferredOutputDeviceName),
    defaultInputMonitoring: source.defaultInputMonitoring ?? DEFAULT_SETTINGS.defaultInputMonitoring,
    defaultRecordArm: source.defaultRecordArm ?? DEFAULT_SETTINGS.defaultRecordArm,
    defaultInputChannelCount: source.defaultInputChannelCount === 1 ? 1 : 2,
    fileAssetPolicy: normalizeFileAssetPolicy(source.fileAssetPolicy),
    autosaveBackups: source.autosaveBackups ?? DEFAULT_SETTINGS.autosaveBackups,
    maxRecentProjects: Math.max(4, Math.min(24, Math.round(source.maxRecentProjects ?? DEFAULT_SETTINGS.maxRecentProjects))),
    memoryCachePreset: normalizeMemoryCachePreset(source.memoryCachePreset),
    restoreLastProject: source.restoreLastProject ?? DEFAULT_SETTINGS.restoreLastProject,
    startupProjectBehavior: normalizeStartupProjectBehavior(source.startupProjectBehavior),
  };
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value as number)) : fallback;
}

function normalizeString(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSubdivision(value: number | undefined, fallback: 2 | 4 | 8 | 16): 2 | 4 | 8 | 16 {
  return value === 2 || value === 4 || value === 8 || value === 16 ? value : fallback;
}

function normalizeFileAssetPolicy(value: FileAssetPolicy | undefined): FileAssetPolicy {
  return value === "reference" || value === "copy" || value === "ask" ? value : DEFAULT_SETTINGS.fileAssetPolicy;
}

function normalizeMemoryCachePreset(value: MemoryCachePreset | undefined): MemoryCachePreset {
  return value === "conservative" || value === "balanced" || value === "performance" ? value : DEFAULT_SETTINGS.memoryCachePreset;
}

function normalizeStartupProjectBehavior(value: StartupProjectBehavior | undefined): StartupProjectBehavior {
  return value === "home" || value === "restore-last" || value === "new-project" ? value : DEFAULT_SETTINGS.startupProjectBehavior;
}

function defaultTrack(): Track {
  const settings = readSettingsSnapshot();
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
    recordArmed: settings.defaultRecordArm,
    inputMonitoring: settings.defaultInputMonitoring,
    inputDeviceId: "",
    inputChannelStart: 0,
    inputChannelCount: settings.defaultInputChannelCount,
    recordGainDb: 0,
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
    returnBuses: [],
    masterEqAutomation: [],
    masterChain: {
      inputGainDb: 0,
      compressorEnabled: false,
      compressorThresholdDb: -18,
      compressorRatio: 2,
      compressorAttackMs: 20,
      compressorReleaseMs: 160,
      compressorMakeupDb: 0,
      compressorMix: 100,
      outputGainDb: 0,
    },
    recordingInput: {
      inputDeviceId: "",
      inputDeviceName: "",
      inputChannelStart: 0,
      inputChannelCount: 2,
      calibrationSampleRate: 0,
      measuredRoundTripSamples: 0,
      reportedInputLatencySamples: 0,
      reportedOutputLatencySamples: 0,
      userLatencyAdjustmentSamples: 0,
    },
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

      addTrackEffect: (trackId, kind = "reverb") => {
        const effectId = nanoid();
        set((s) => {
          const track = s.project.tracks.find((candidate) => candidate.id === trackId);
          if (!track) return;
          track.effects.filters.push({
            id: effectId,
            kind,
            bypassed: false,
            params: defaultTrackEffectParams(kind),
            automation: [],
          });
        });
        return effectId;
      },

      setTrackEffectKind: (trackId, effectId, kind) =>
        set((s) => {
          const track = s.project.tracks.find((candidate) => candidate.id === trackId);
          const effect = track?.effects.filters.find((candidate) => candidate.id === effectId);
          if (!effect) return;
          effect.kind = kind;
          effect.bypassed = false;
          effect.params = defaultTrackEffectParams(kind);
          effect.automation = [];
        }),

      upsertTrackEffectAutomationPoint: (trackId, effectId, param, point) => {
        const pointId = point.id ?? nanoid();
        set((s) => {
          const track = s.project.tracks.find((candidate) => candidate.id === trackId);
          const effect = track?.effects.filters.find((candidate) => candidate.id === effectId);
          if (!effect || !param.trim()) return;
          effect.automation ??= [];
          let lane = effect.automation.find((candidate) => candidate.param === param);
          if (!lane) {
            lane = { param, points: [] };
            effect.automation.push(lane);
          }
          const nextPoint = {
            id: pointId,
            beat: clampProjectBeat(point.beat, s.project.lengthBeats),
            value: clampAutomationValue(point.value),
            curve: point.curve ?? "linear",
          };
          const existing = lane.points.findIndex((candidate) => candidate.id === pointId);
          if (existing >= 0) lane.points[existing] = nextPoint;
          else lane.points.push(nextPoint);
          lane.points.sort((a, b) => a.beat - b.beat);
        });
        return pointId;
      },

      removeTrackEffectAutomationPoint: (trackId, effectId, param, pointId) =>
        set((s) => {
          const track = s.project.tracks.find((candidate) => candidate.id === trackId);
          const effect = track?.effects.filters.find((candidate) => candidate.id === effectId);
          if (!effect?.automation) return;
          effect.automation = effect.automation
            .map((lane) => lane.param === param
              ? { ...lane, points: lane.points.filter((point) => point.id !== pointId) }
              : lane)
            .filter((lane) => lane.points.length > 0);
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
              enforceSegmentBounds(seg, s.project.lengthBeats);
              normalizeSegmentLayers(t);
              return;
            }
          }
        }),

      applySegmentEditCommand: (command) => {
        const createdIds: Id[] = [];
        if (command.kind === "duplicate") {
          for (let index = 0; index < command.segments.length; index++) {
            createdIds.push(nanoid());
          }
        } else if (command.kind === "split") {
          createdIds.push(nanoid());
        }

        set((s) => {
          if (command.kind === "move") {
            const touched = new Set<Track>();
            for (const move of command.moves) {
              const source = s.project.tracks.find((track) =>
                track.segments.some((segment) => segment.id === move.segmentId),
              );
              const dest = s.project.tracks.find((track) => track.id === move.toTrackId);
              if (!source || !dest) continue;
              const index = source.segments.findIndex((segment) => segment.id === move.segmentId);
              if (index < 0) continue;
              const [segment] = source.segments.splice(index, 1);
              segment.trackId = dest.id;
              segment.startBeat = Math.max(0, move.toStartBeat);
              enforceSegmentBounds(segment, s.project.lengthBeats);
              dest.segments.push(segment);
              touched.add(source);
              touched.add(dest);
            }
            touched.forEach(normalizeSegmentLayers);
            return;
          }

          if (command.kind === "resize") {
            for (const track of s.project.tracks) {
              const segment = track.segments.find((candidate) => candidate.id === command.segmentId);
              if (!segment) continue;
              applySegmentWindow(segment, command.startBeat, command.lengthBeats, s.project.lengthBeats, {
                startBeat: command.originStartBeat,
                lengthBeats: command.originLengthBeats,
                sourceStartBeat: command.originSourceStartBeat,
                payload: command.originPayload,
              });
              normalizeSegmentLayers(track);
              return;
            }
            return;
          }

          if (command.kind === "duplicate") {
            const tracksById = new Map(s.project.tracks.map((track) => [track.id, track]));
            for (const [index, source] of command.segments.entries()) {
              const targetTrack = tracksById.get(command.targetTrackId ?? source.trackId);
              if (!targetTrack) continue;
              const clone: Segment = {
                ...cloneProjectData(source),
                id: createdIds[index],
                trackId: targetTrack.id,
                startBeat: Math.max(0, source.startBeat + (command.offsetBeats ?? source.lengthBeats)),
              };
              enforceSegmentBounds(clone, s.project.lengthBeats);
              targetTrack.segments.push(clone);
              normalizeSegmentLayers(targetTrack);
            }
            return;
          }

          if (command.kind === "delete") {
            const ids = new Set(command.segmentIds);
            for (const track of s.project.tracks) {
              const next = track.segments.filter((segment) => !ids.has(segment.id));
              if (next.length === track.segments.length) continue;
              track.segments = next;
              normalizeSegmentLayers(track);
            }
            return;
          }

          if (command.kind === "nudge" || command.kind === "quantize") {
            const ids = new Set(command.segmentIds);
            const touched = new Set<Track>();
            const gridBeats = command.kind === "quantize" ? Math.max(MIN_SEGMENT_LENGTH_BEATS, command.gridBeats) : 0;
            for (const track of s.project.tracks) {
              for (const segment of track.segments) {
                if (!ids.has(segment.id)) continue;
                segment.startBeat = command.kind === "nudge"
                  ? segment.startBeat + command.deltaBeats
                  : Math.round(segment.startBeat / gridBeats) * gridBeats;
                enforceSegmentBounds(segment, s.project.lengthBeats);
                touched.add(track);
              }
            }
            touched.forEach(normalizeSegmentLayers);
            return;
          }

          if (command.kind === "split") {
            for (const track of s.project.tracks) {
              const segmentIndex = track.segments.findIndex((candidate) => candidate.id === command.segmentId);
              if (segmentIndex < 0) continue;
              const segment = track.segments[segmentIndex];
              const splitBeat = juceLikeClamp(segment.startBeat + MIN_SEGMENT_LENGTH_BEATS,
                                              segment.startBeat + segment.lengthBeats - MIN_SEGMENT_LENGTH_BEATS,
                                              command.splitBeat);
              if (splitBeat <= segment.startBeat || splitBeat >= segment.startBeat + segment.lengthBeats)
                return;

              const leftLength = splitBeat - segment.startBeat;
              const rightLength = segment.startBeat + segment.lengthBeats - splitBeat;
              const right = cloneProjectData(segment);
              right.id = createdIds[0];
              right.startBeat = splitBeat;
              right.lengthBeats = rightLength;
              right.repeats = 0;
              right.sourceStartBeat = (segment.sourceStartBeat ?? 0) + leftLength;
              right.fadeInBeats = clampFade(right.fadeInBeats ?? 0, rightLength);
              right.fadeOutBeats = clampFade(right.fadeOutBeats ?? 0, rightLength);
              trimSegmentPayloadToRange(right, leftLength, segment.lengthBeats);

              segment.lengthBeats = leftLength;
              segment.repeats = 0;
              segment.fadeInBeats = clampFade(segment.fadeInBeats ?? 0, leftLength);
              segment.fadeOutBeats = clampFade(segment.fadeOutBeats ?? 0, leftLength);
              trimSegmentPayloadToRange(segment, 0, leftLength);
              enforceSegmentBounds(segment, s.project.lengthBeats);
              enforceSegmentBounds(right, s.project.lengthBeats);
              track.segments.splice(segmentIndex + 1, 0, right);
              normalizeSegmentLayers(track);
              return;
            }
            return;
          }

          if (command.kind === "trim") {
            for (const track of s.project.tracks) {
              const segment = track.segments.find((candidate) => candidate.id === command.segmentId);
              if (!segment) continue;
              const oldStart = segment.startBeat;
              const oldEnd = segment.startBeat + segment.lengthBeats;
              if (command.edge === "start") {
                const nextStart = juceLikeClamp(0, oldEnd - MIN_SEGMENT_LENGTH_BEATS, command.beat);
                applySegmentWindow(segment, nextStart, oldEnd - nextStart, s.project.lengthBeats);
              } else {
                const nextEnd = juceLikeClamp(oldStart + MIN_SEGMENT_LENGTH_BEATS, s.project.lengthBeats, command.beat);
                applySegmentWindow(segment, oldStart, nextEnd - oldStart, s.project.lengthBeats);
              }
              normalizeSegmentLayers(track);
              return;
            }
            return;
          }

          if (command.kind === "fade") {
            for (const track of s.project.tracks) {
              const segment = track.segments.find((candidate) => candidate.id === command.segmentId);
              if (!segment) continue;
              if (command.fadeInBeats != null)
                segment.fadeInBeats = clampFade(command.fadeInBeats, segment.lengthBeats);
              if (command.fadeOutBeats != null)
                segment.fadeOutBeats = clampFade(command.fadeOutBeats, segment.lengthBeats);
              return;
            }
          }

          if (command.kind === "crossfade") {
            for (const track of s.project.tracks) {
              const first = track.segments.find((candidate) => candidate.id === command.firstSegmentId);
              const second = track.segments.find((candidate) => candidate.id === command.secondSegmentId);
              if (!first || !second || first.id === second.id) continue;
              const [left, right] = first.startBeat <= second.startBeat ? [first, second] : [second, first];
              const leftEnd = left.startBeat + left.lengthBeats;
              const rightEnd = right.startBeat + right.lengthBeats;
              const overlap = Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(left.startBeat, right.startBeat));
              const requested = command.lengthBeats ?? overlap;
              const duration = Math.max(0, Math.min(requested, left.lengthBeats, right.lengthBeats));
              left.fadeOutBeats = clampFade(duration, left.lengthBeats);
              right.fadeInBeats = clampFade(duration, right.lengthBeats);
              return;
            }
          }
        });

        return createdIds;
      },

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

type TemporalInternals = ReturnType<typeof useProjectStore.temporal.getState> & {
  _handleSet?: (
    pastState: ProjectSlice,
    replace: undefined,
    currentState: ProjectSlice,
    deltaState?: Partial<ProjectSlice> | null,
  ) => void;
};

/**
 * Run multiple project mutations as a single undo step. This is for compound
 * DAW edits such as "drag selected clips" or "create effect with default
 * lanes", where the user perceives several store writes as one edit.
 */
export function runProjectHistoryGroup<T>(mutation: () => T): T {
  const temporalState = useProjectStore.temporal.getState();
  const wasTracking = temporalState.isTracking;
  const before = useProjectStore.getState();
  let completed = false;
  let result: T;

  if (wasTracking) temporalState.pause();
  try {
    result = mutation();
    completed = true;
  } finally {
    if (wasTracking) temporalState.resume();
    if (wasTracking && completed) {
      const after = useProjectStore.getState();
      if (before.project !== after.project) {
        (useProjectStore.temporal.getState() as TemporalInternals)._handleSet?.(before, undefined, after);
      }
    }
  }

  return result!;
}

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

function enforceSegmentBounds(segment: Segment, projectLengthBeats: Beats): void {
  segment.startBeat = Math.max(0, segment.startBeat);
  segment.lengthBeats = Math.max(MIN_SEGMENT_LENGTH_BEATS, segment.lengthBeats);
  const maxEnd = Math.max(MIN_SEGMENT_LENGTH_BEATS, projectLengthBeats);
  if (segment.startBeat + segment.lengthBeats > maxEnd) {
    segment.lengthBeats = Math.max(MIN_SEGMENT_LENGTH_BEATS, maxEnd - segment.startBeat);
  }
  segment.fadeInBeats = clampFade(segment.fadeInBeats ?? 0, segment.lengthBeats);
  segment.fadeOutBeats = clampFade(segment.fadeOutBeats ?? 0, segment.lengthBeats);
  segment.sourceStartBeat = Math.max(0, segment.sourceStartBeat ?? 0);
}

function applySegmentWindow(
  segment: Segment,
  nextStartBeat: Beats,
  nextLengthBeats: Beats,
  projectLengthBeats: Beats,
  origin?: { startBeat?: Beats; lengthBeats?: Beats; sourceStartBeat?: Beats; payload?: Segment["payload"] },
): void {
  const oldStartBeat = origin?.startBeat ?? segment.startBeat;
  const oldLengthBeats = origin?.lengthBeats ?? segment.lengthBeats;
  const oldSourceStartBeat = origin?.sourceStartBeat ?? segment.sourceStartBeat ?? 0;
  const newStartBeat = Math.max(0, nextStartBeat);
  const newLengthBeats = Math.max(MIN_SEGMENT_LENGTH_BEATS, nextLengthBeats);
  const localStart = Math.max(0, newStartBeat - oldStartBeat);
  const localEnd = Math.min(oldLengthBeats, localStart + newLengthBeats);
  if (origin?.payload) segment.payload = cloneProjectData(origin.payload);
  segment.startBeat = newStartBeat;
  segment.lengthBeats = newLengthBeats;
  segment.sourceStartBeat = Math.max(0, oldSourceStartBeat + localStart);
  trimSegmentPayloadToRange(segment, localStart, localEnd);
  enforceSegmentBounds(segment, projectLengthBeats);
}

function trimSegmentPayloadToRange(segment: Segment, rangeStartBeat: Beats, rangeEndBeat: Beats): void {
  if (segment.payload.kind === "midi" || segment.payload.kind === "mixed") {
    segment.payload.notes = trimNotesToRange(segment.payload.notes, rangeStartBeat, rangeEndBeat);
  }
}

function trimNotesToRange(notes: MidiNote[], rangeStartBeat: Beats, rangeEndBeat: Beats): MidiNote[] {
  return notes.flatMap((note) => {
    const noteStart = note.startBeat;
    const noteEnd = note.startBeat + note.lengthBeats;
    const overlapStart = Math.max(noteStart, rangeStartBeat);
    const overlapEnd = Math.min(noteEnd, rangeEndBeat);
    if (overlapEnd - overlapStart < 0.000001) return [];
    const shifted: MidiNote = {
      ...note,
      curve: note.curve?.map((point) => ({ ...point })),
      automation: note.automation?.map((lane) => ({
        ...lane,
        points: lane.points.map((point) => ({ ...point })),
      })),
      startBeat: overlapStart - rangeStartBeat,
      lengthBeats: Math.max(0.03125, overlapEnd - overlapStart),
    };
    if (shifted.curve) {
      shifted.curve = shifted.curve
        .filter((point) => point.beat >= overlapStart && point.beat <= overlapEnd)
        .map((point) => ({ ...point, beat: point.beat - rangeStartBeat }));
    }
    if (shifted.automation) {
      shifted.automation = shifted.automation.map((lane) => ({
        ...lane,
        points: lane.points
          .filter((point) => point.beat >= overlapStart && point.beat <= overlapEnd)
          .map((point) => ({ ...point, beat: point.beat - rangeStartBeat })),
      }));
    }
    return [shifted];
  });
}

function clampFade(value: Beats, lengthBeats: Beats): Beats {
  return Math.max(0, Math.min(Math.max(0, lengthBeats), value));
}

function juceLikeClamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

function cloneProjectData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clampProjectBeat(beat: Beats, projectLengthBeats: Beats): Beats {
  return Math.max(0, Math.min(Math.max(0, projectLengthBeats), Number.isFinite(beat) ? beat : 0));
}

function clampAutomationValue(value: number): number {
  return Math.max(-100000, Math.min(100000, Number.isFinite(value) ? value : 0));
}

function defaultTrackEffectParams(kind: TrackEffect["kind"]): Record<string, number> {
  switch (kind) {
    case "delay":
      return { timeMs: 250, feedback: 25, mix: 18 };
    case "lowpass":
      return { cutoffHz: 8000, resonance: 8 };
    case "highpass":
      return { cutoffHz: 80, resonance: 0 };
    case "saturator":
      return { drive: 20, mix: 100 };
    case "distortion":
      return { drive: 55, shape: 35, trimDb: 6, mix: 45 };
    case "bitcrush":
      return { bits: 8, rate: 50, mix: 35 };
    case "compressor":
      return { thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 120, makeupDb: 0, mix: 100 };
    case "chorus":
      return { rateHz: 0.8, depthMs: 8, delayMs: 12, feedback: 8, mix: 35 };
    case "phaser":
      return { rateHz: 0.45, centerHz: 900, depthOct: 1.8, feedback: 35, mix: 45 };
    case "flanger":
      return { rateHz: 0.28, depthMs: 2, delayMs: 2.5, feedback: 45, mix: 50 };
    case "plugin":
      return { mix: 100 };
    case "reverb":
    default:
      return { roomSize: 40, damping: 35, mix: 20 };
  }
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
  setLoopEnabled: (enabled: boolean) => void;
  setLoopRange: (range: TransportState["loopRange"]) => void;
  setRepeatTrackEnabled: (enabled: boolean) => void;
}

export const useTransportStore = create<TransportSlice>()((set) => ({
  playing: false,
  positionBeat: 0,
  speed: 1,
  loopEnabled: false,
  loopRange: { startBeat: 0, endBeat: 0 },
  repeatTrackEnabled: false,
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  stop: () => set({ playing: false, positionBeat: 0 }),
  setPosition: (beat) => set({ positionBeat: Math.max(0, beat) }),
  setSpeed: (speed) => set({ speed: Math.max(0.1, Math.min(4, speed)) }),
  setLoopEnabled: (enabled) => set({ loopEnabled: enabled }),
  setLoopRange: (range) => set({ loopRange: range }),
  setRepeatTrackEnabled: (enabled) => set({ repeatTrackEnabled: enabled }),
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
  sidebarWidth: 230,
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
  preferredAudioTypeName: string;
  preferredInputDeviceName: string;
  preferredOutputDeviceName: string;
  defaultInputMonitoring: boolean;
  defaultRecordArm: boolean;
  defaultInputChannelCount: 1 | 2;
  fileAssetPolicy: FileAssetPolicy;
  autosaveBackups: boolean;
  maxRecentProjects: number;
  memoryCachePreset: MemoryCachePreset;
  restoreLastProject: boolean;
  startupProjectBehavior: StartupProjectBehavior;
  setResizeSnapSeconds: (s: number) => void;
  setResizeSnapMeasures: (m: number) => void;
  setTimelineSmartGrid: (enabled: boolean) => void;
  setMidiSmartGrid: (enabled: boolean) => void;
  setTimelineSubdivision: (subdivision: 2 | 4 | 8 | 16) => void;
  setMidiSubdivision: (subdivision: 2 | 4 | 8 | 16) => void;
  setPreferredInputDevice: (typeName: string, deviceName: string) => void;
  setPreferredOutputDevice: (typeName: string, deviceName: string) => void;
  setDefaultInputMonitoring: (enabled: boolean) => void;
  setDefaultRecordArm: (enabled: boolean) => void;
  setDefaultInputChannelCount: (count: 1 | 2) => void;
  setFileAssetPolicy: (policy: FileAssetPolicy) => void;
  setAutosaveBackups: (enabled: boolean) => void;
  setMaxRecentProjects: (count: number) => void;
  setMemoryCachePreset: (preset: MemoryCachePreset) => void;
  setRestoreLastProject: (enabled: boolean) => void;
  setStartupProjectBehavior: (behavior: StartupProjectBehavior) => void;
}

const initialSettings = readSettingsSnapshot();

export const useSettingsStore = create<SettingsSlice>()((set) => ({
  ...initialSettings,
  setResizeSnapSeconds: (s) => {
    const resizeSnapSeconds = Math.max(0.0625, s);
    writeSettingsPatch({ resizeSnapSeconds });
    set({ resizeSnapSeconds });
  },
  setResizeSnapMeasures: (m) => {
    const resizeSnapMeasures = Math.max(1, Math.round(m));
    writeSettingsPatch({ resizeSnapMeasures });
    set({ resizeSnapMeasures });
  },
  setTimelineSmartGrid: (timelineSmartGrid) => {
    writeSettingsPatch({ timelineSmartGrid });
    set({ timelineSmartGrid });
  },
  setMidiSmartGrid: (midiSmartGrid) => {
    writeSettingsPatch({ midiSmartGrid });
    set({ midiSmartGrid });
  },
  setTimelineSubdivision: (timelineSubdivision) => {
    writeSettingsPatch({ timelineSubdivision });
    set({ timelineSubdivision });
  },
  setMidiSubdivision: (midiSubdivision) => {
    writeSettingsPatch({ midiSubdivision });
    set({ midiSubdivision });
  },
  setPreferredInputDevice: (preferredAudioTypeName, preferredInputDeviceName) => {
    writeSettingsPatch({ preferredAudioTypeName, preferredInputDeviceName });
    set({ preferredAudioTypeName, preferredInputDeviceName });
  },
  setPreferredOutputDevice: (_typeName, preferredOutputDeviceName) => {
    writeSettingsPatch({ preferredOutputDeviceName });
    set({ preferredOutputDeviceName });
  },
  setDefaultInputMonitoring: (defaultInputMonitoring) => {
    writeSettingsPatch({ defaultInputMonitoring });
    set({ defaultInputMonitoring });
  },
  setDefaultRecordArm: (defaultRecordArm) => {
    writeSettingsPatch({ defaultRecordArm });
    set({ defaultRecordArm });
  },
  setDefaultInputChannelCount: (defaultInputChannelCount) => {
    writeSettingsPatch({ defaultInputChannelCount });
    set({ defaultInputChannelCount });
  },
  setFileAssetPolicy: (fileAssetPolicy) => {
    writeSettingsPatch({ fileAssetPolicy });
    set({ fileAssetPolicy });
  },
  setAutosaveBackups: (autosaveBackups) => {
    writeSettingsPatch({ autosaveBackups });
    set({ autosaveBackups });
  },
  setMaxRecentProjects: (maxRecentProjects) => {
    const normalized = Math.max(4, Math.min(24, Math.round(maxRecentProjects)));
    writeSettingsPatch({ maxRecentProjects: normalized });
    set({ maxRecentProjects: normalized });
  },
  setMemoryCachePreset: (memoryCachePreset) => {
    writeSettingsPatch({ memoryCachePreset });
    set({ memoryCachePreset });
  },
  setRestoreLastProject: (restoreLastProject) => {
    writeSettingsPatch({ restoreLastProject });
    set({ restoreLastProject });
  },
  setStartupProjectBehavior: (startupProjectBehavior) => {
    writeSettingsPatch({ startupProjectBehavior });
    set({ startupProjectBehavior });
  },
}));

// ---------------------------------------------------------------------------
// Document: current .beat file metadata and dirty state.
// ---------------------------------------------------------------------------
interface DocumentSlice {
  currentFilePath: string | null;
  documentOpen: boolean;
  dirty: boolean;
  savedFingerprint: string | null;
  recentFilePaths: string[];
  recentProjects: RecentProjectEntry[];
  missingAssets: BeatProjectAsset[];
  integrityReport: BeatProjectIntegrityReport | null;
  cleanupReport: ProjectSidecarCleanupReport | null;
  lastBackupPath: string | null;
  markDirty: (currentFingerprint?: string) => void;
  markSaved: (path?: string | null, savedFingerprint?: string) => void;
  closeDocument: () => void;
  setCurrentFilePath: (path: string | null) => void;
  addRecentFilePath: (path: string) => void;
  addRecentProject: (project: Partial<RecentProjectEntry> & { path: string }) => void;
  removeRecentFilePath: (path: string) => void;
  setMissingAssets: (assets: BeatProjectAsset[]) => void;
  setIntegrityReport: (report: BeatProjectIntegrityReport | null) => void;
  setCleanupReport: (report: ProjectSidecarCleanupReport | null) => void;
  setLastBackupPath: (path: string | null) => void;
}

const initialRecentProjects = loadRecentProjects();

export const useDocumentStore = create<DocumentSlice>()((set) => ({
  currentFilePath: null,
  documentOpen: false,
  dirty: false,
  savedFingerprint: null,
  recentProjects: initialRecentProjects,
  recentFilePaths: initialRecentProjects.map((project) => project.path),
  missingAssets: [],
  integrityReport: null,
  cleanupReport: null,
  lastBackupPath: null,
  markDirty: (currentFingerprint) =>
    set((state) => ({
      dirty: !state.documentOpen
        ? false
        : currentFingerprint && state.savedFingerprint
        ? currentFingerprint !== state.savedFingerprint
        : true,
    })),
  markSaved: (path, savedFingerprint) =>
    set((state) => ({
      documentOpen: true,
      dirty: false,
      savedFingerprint: savedFingerprint ?? state.savedFingerprint,
      currentFilePath: path === undefined ? state.currentFilePath : path,
      ...(path ? storeRecentProjectState(upsertRecentProject(state.recentProjects, { path, openedAt: Date.now() })) : {}),
    })),
  closeDocument: () => set({
    currentFilePath: null,
    documentOpen: false,
    dirty: false,
    savedFingerprint: null,
    missingAssets: [],
    integrityReport: null,
    cleanupReport: null,
    lastBackupPath: null,
  }),
  setCurrentFilePath: (path) => set((state) => ({ currentFilePath: path, documentOpen: path ? true : state.documentOpen })),
  addRecentFilePath: (path) => set((state) => storeRecentProjectState(upsertRecentProject(state.recentProjects, { path, openedAt: Date.now() }))),
  addRecentProject: (project) => set((state) => storeRecentProjectState(upsertRecentProject(state.recentProjects, project))),
  removeRecentFilePath: (path) => set((state) => storeRecentProjectState(state.recentProjects.filter((project) => project.path !== path))),
  setMissingAssets: (assets) => set({ missingAssets: assets }),
  setIntegrityReport: (report) => set({ integrityReport: report }),
  setCleanupReport: (report) => set({ cleanupReport: report }),
  setLastBackupPath: (path) => set({ lastBackupPath: path }),
}));

const RECENT_FILE_PATHS_KEY = "beat.recentFilePaths";
const RECENT_PROJECTS_KEY = "beat.recentProjects";

function loadRecentProjects(): RecentProjectEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_PROJECTS_KEY) ?? "[]");
    if (Array.isArray(parsed) && parsed.length > 0) return normalizeRecentProjects(parsed);
  } catch {
    // Fall through to the legacy path-only list.
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_FILE_PATHS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? normalizeRecentFilePaths(parsed).map((path) => createRecentProject({ path }))
      : [];
  } catch {
    return [];
  }
}

function storeRecentProjectState(projects: RecentProjectEntry[]) {
  const normalized = normalizeRecentProjects(projects);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(normalized));
    window.localStorage.setItem(RECENT_FILE_PATHS_KEY, JSON.stringify(normalized.map((project) => project.path)));
  }
  return {
    recentProjects: normalized,
    recentFilePaths: normalized.map((project) => project.path),
  };
}

function upsertRecentProject(
  projects: RecentProjectEntry[],
  project: Partial<RecentProjectEntry> & { path: string },
): RecentProjectEntry[] {
  return [
    createRecentProject(project),
    ...projects.filter((candidate) => candidate.path !== project.path),
  ];
}

function createRecentProject(project: Partial<RecentProjectEntry> & { path: string }): RecentProjectEntry {
  return {
    path: project.path.trim(),
    name: project.name?.trim() || projectFileName(project.path),
    openedAt: Number.isFinite(project.openedAt) ? Number(project.openedAt) : Date.now(),
    sizeBytes: Number.isFinite(project.sizeBytes) ? Number(project.sizeBytes) : 0,
    exists: project.exists ?? true,
  };
}

function normalizeRecentProjects(projects: unknown[]): RecentProjectEntry[] {
  const unique: RecentProjectEntry[] = [];
  const maxRecentProjects = readSettingsSnapshot().maxRecentProjects;
  for (const project of projects) {
    if (!project || typeof project !== "object") continue;
    const candidate = project as Partial<RecentProjectEntry>;
    if (typeof candidate.path !== "string" || !candidate.path.trim()) continue;
    const normalized = createRecentProject(candidate as Partial<RecentProjectEntry> & { path: string });
    if (!unique.some((existing) => existing.path === normalized.path)) unique.push(normalized);
    if (unique.length >= maxRecentProjects) break;
  }
  return unique;
}

function normalizeRecentFilePaths(paths: unknown[]): string[] {
  const unique: string[] = [];
  const maxRecentProjects = readSettingsSnapshot().maxRecentProjects;
  for (const path of paths) {
    if (typeof path !== "string" || !path.trim()) continue;
    const trimmed = path.trim();
    if (!unique.includes(trimmed)) unique.push(trimmed);
    if (unique.length >= maxRecentProjects) break;
  }
  return unique;
}

function projectFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

// ---------------------------------------------------------------------------
// Plugins: lightweight adapter registry for future native/third-party hosts.
// ---------------------------------------------------------------------------
interface PluginLibrarySlice {
  plugins: PluginAdapter[];
  addPlugin: (plugin?: Partial<PluginAdapter>) => Id;
  hydratePlugins: (plugins: PluginAdapter[]) => void;
  updatePlugin: (id: Id, patch: Partial<PluginAdapter>) => void;
  removePlugin: (id: Id) => void;
}

const PLUGIN_BRIDGE_ID = "plugin-aether-bridge-host";
const PLUGIN_LIBRARY_KEY = "beat.pluginAdapters";

export function normalizePluginAdapter(patch: Partial<PluginAdapter> = {}): PluginAdapter {
  if (isDecentSamplerAdapterPatch(patch)) {
    const normalizedPatch = {
      ...patch,
      kind: "renderer" as const,
      format: "decent-sampler" as const,
      instrumentMode: "live-instrument" as const,
    };
    return {
      id: normalizedPatch.id ?? nanoid(),
      name: normalizedPatch.name ?? "DecentSampler Package",
      vendor: normalizedPatch.vendor ?? "DecentSampler",
      version: normalizedPatch.version ?? "1.0.0",
      status: normalizedPatch.status ?? "installed",
      description: normalizedPatch.description ?? "DecentSampler sample package. Opens to the package UI and plays through Beat's sampler engine.",
      ...normalizedPatch,
      capabilities: [
        {
          id: "decent-sampler-package",
          kind: "instrument",
          label: "Play DecentSampler package through Beat sampler",
          realtime: true,
          offline: true,
          latencySamples: 0,
          fallbackMode: "pass-through",
        },
      ],
    };
  }

  const kind = patch.kind ?? "synth";
  const capabilities = patch.capabilities ?? [
    {
      id: `${kind}-fallback`,
      kind: kind === "synth" ? "instrument" : kind,
      label: kind === "synth" ? "Create Aether-backed instrument" : "Preserve plugin metadata",
      realtime: kind === "synth" && patch.instrumentMode === "live-instrument",
      offline: true,
      latencySamples: 0,
      fallbackMode: kind === "synth" ? "aether" : "pass-through",
    },
  ];

  return {
    id: nanoid(),
    name: "Plugin Adapter",
    vendor: "Beat",
    version: "1.0.0",
    kind,
    format: "bridge",
    status: "available",
    instrumentMode: "fallback-aether",
    description: "Protected host shell for imported synths, effects, renderers, and utility backends.",
    capabilities,
    ...patch,
  };
}

function isDecentSamplerAdapterPatch(patch: Partial<PluginAdapter>) {
  if (patch.format === "decent-sampler") return true;
  const haystack = [
    patch.vendor,
    patch.name,
    patch.sourceFileName,
    patch.sourcePath,
    patch.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("decentsampler") || haystack.includes("decent sampler") || haystack.includes("decent-sampler");
}

function loadPersistedPluginAdapters(): Partial<PluginAdapter>[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PLUGIN_LIBRARY_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((plugin): plugin is Partial<PluginAdapter> => !!plugin && typeof plugin === "object" && !(plugin as PluginAdapter).factory)
      : [];
  } catch {
    return [];
  }
}

function storePersistedPluginAdapters(plugins: PluginAdapter[]) {
  if (typeof window === "undefined") return;
  const userPlugins = plugins.filter((plugin) => !plugin.factory);
  window.localStorage.setItem(PLUGIN_LIBRARY_KEY, JSON.stringify(userPlugins));
}

export function mergePluginAdaptersById(...groups: PluginAdapter[][]): PluginAdapter[] {
  const seen = new Set<string>();
  const merged: PluginAdapter[] = [];
  for (const group of groups) {
    for (const plugin of group) {
      if (seen.has(plugin.id)) continue;
      seen.add(plugin.id);
      merged.push(plugin);
    }
  }
  return merged;
}

export const usePluginStore = create<PluginLibrarySlice>()(
  immer((set) => ({
    plugins: [
      normalizePluginAdapter({
        id: PLUGIN_BRIDGE_ID,
        name: "Aether Bridge Host",
        vendor: "Beat",
        version: "0.1.0",
        kind: "synth",
        format: "bridge",
        status: "available",
        instrumentMode: "fallback-aether",
        factory: true,
        description: "Creates Aether fallback instruments until native plugin hosting is wired.",
        capabilities: [
          {
            id: "aether-fallback-instrument",
            kind: "instrument",
            label: "Create Aether-backed instrument",
            realtime: true,
            offline: true,
            latencySamples: 0,
            fallbackMode: "aether",
          },
        ],
      }),
      ...loadPersistedPluginAdapters().map((plugin) => normalizePluginAdapter(plugin)),
    ],
    addPlugin: (plugin) => {
      let id = nanoid();
      set((s) => {
        const sourcePath = plugin?.sourcePath?.trim();
        const sourceFileName = plugin?.sourceFileName?.trim();
        const existing = s.plugins.find((candidate) => !candidate.factory
          && candidate.format === plugin?.format
          && ((sourcePath && candidate.sourcePath === sourcePath)
            || (!sourcePath && sourceFileName && candidate.sourceFileName === sourceFileName)));
        if (existing) {
          id = existing.id;
          Object.assign(existing, normalizePluginAdapter({ ...plugin, id: existing.id }));
          storePersistedPluginAdapters(s.plugins);
          return;
        }
        s.plugins.push(normalizePluginAdapter({ ...plugin, id }));
        storePersistedPluginAdapters(s.plugins);
      });
      return id;
    },
    hydratePlugins: (plugins) =>
      set((s) => {
        const factory = s.plugins.filter((plugin) => plugin.factory);
        const persistedPlugins = loadPersistedPluginAdapters().map((plugin) => normalizePluginAdapter(plugin));
        const currentUserPlugins = s.plugins.filter((plugin) => !plugin.factory);
        const projectPlugins = plugins
          .filter((plugin) => !plugin.factory)
          .map((plugin) => normalizePluginAdapter(plugin));
        s.plugins = mergePluginAdaptersById(factory, persistedPlugins, currentUserPlugins, projectPlugins);
        storePersistedPluginAdapters(s.plugins);
      }),
    updatePlugin: (id, patch) =>
      set((s) => {
        const plugin = s.plugins.find((candidate) => candidate.id === id);
        if (plugin) Object.assign(plugin, normalizePluginAdapter({ ...plugin, ...patch, id: plugin.id }));
        storePersistedPluginAdapters(s.plugins);
      }),
    removePlugin: (id) =>
      set((s) => {
        const plugin = s.plugins.find((candidate) => candidate.id === id);
        if (plugin?.factory) return;
        s.plugins = s.plugins.filter((candidate) => candidate.id !== id);
        storePersistedPluginAdapters(s.plugins);
      }),
  })),
);

// ---------------------------------------------------------------------------
// UI: ephemeral selection / modal state.
// ---------------------------------------------------------------------------
interface UiSlice extends UiState {
  selectTrack: (id: Id, additive?: boolean) => void;
  setSelectedTracks: (ids: Id[]) => void;
  selectSegment: (id: Id, additive?: boolean) => void;
  setSelectedSegments: (ids: Id[]) => void;
  selectTrackEffectAutomationPoint: (key: string, additive?: boolean) => void;
  clearSelection: () => void;
  openEditor: (e: UiState["openEditors"][number]) => void;
  closeEditor: (e: UiState["openEditors"][number]) => void;
  openTrackEffects: (trackId: Id) => void;
  closeTrackEffects: () => void;
}

export const useUiStore = create<UiSlice>()((set) => ({
  selectedTrackIds: [],
  selectedSegmentIds: [],
  selectedTrackEffectAutomationPointKeys: [],
  openEditors: [],
  trackEffectsEditorTrackId: null,
  selectTrack: (id, additive) =>
    set((s) => ({
      selectedTrackIds: additive
        ? s.selectedTrackIds.includes(id)
          ? s.selectedTrackIds.filter((x) => x !== id)
          : [...s.selectedTrackIds, id]
        : [id],
      selectedSegmentIds: [],
      selectedTrackEffectAutomationPointKeys: [],
    })),
  setSelectedTracks: (ids) => set({
    selectedTrackIds: ids,
    ...(ids.length > 0 ? { selectedSegmentIds: [], selectedTrackEffectAutomationPointKeys: [] } : {}),
  }),
  selectSegment: (id, additive) =>
    set((s) => ({
      selectedSegmentIds: additive
        ? s.selectedSegmentIds.includes(id)
          ? s.selectedSegmentIds.filter((x) => x !== id)
          : [...s.selectedSegmentIds, id]
        : [id],
      selectedTrackIds: [],
      selectedTrackEffectAutomationPointKeys: [],
    })),
  setSelectedSegments: (ids) => set({
    selectedSegmentIds: ids,
    ...(ids.length > 0 ? { selectedTrackIds: [], selectedTrackEffectAutomationPointKeys: [] } : {}),
  }),
  selectTrackEffectAutomationPoint: (key, additive) =>
    set((s) => ({
      selectedTrackEffectAutomationPointKeys: additive
        ? s.selectedTrackEffectAutomationPointKeys.includes(key)
          ? s.selectedTrackEffectAutomationPointKeys.filter((x) => x !== key)
          : [...s.selectedTrackEffectAutomationPointKeys, key]
        : [key],
      selectedTrackIds: [],
      selectedSegmentIds: [],
    })),
  clearSelection: () =>
    set({ selectedTrackIds: [], selectedSegmentIds: [], selectedTrackEffectAutomationPointKeys: [] }),
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
  loading: boolean;
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
  setLoading: (loading: boolean) => void;
}

export const FACTORY_DRUM_SET_ID = "factory-drums";
export const FACTORY_SYNTH_SET_ID = "factory-synths";
export const ROCK_DRUM_SET_ID = "rock-drums";
export const ORCHESTRA_SET_ID = "orchestra-pit";
export const TEMPORARY_DS_INSTRUMENT_SET_ID = "temporary-ds-instruments";
export const USER_INSTRUMENT_SET_ID = "user-instruments";

function defaultInstrumentSets(): InstrumentSet[] {
  return [
    { id: ROCK_DRUM_SET_ID, name: "Rock & Roll", factory: true },
    { id: FACTORY_DRUM_SET_ID, name: "Classic Machines", factory: true },
    { id: ORCHESTRA_SET_ID, name: "Orchestra Pit", factory: true },
    { id: FACTORY_SYNTH_SET_ID, name: "Synths", factory: true },
    { id: TEMPORARY_DS_INSTRUMENT_SET_ID, name: "Instanced Instruments", factory: true },
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
    effects: instrument.effects ? structuredClone(instrument.effects) : undefined,
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
  const setId = isDecentSamplerInstancedInstrument(instrument, source)
    && (!instrument.setId || instrument.setId === USER_INSTRUMENT_SET_ID)
    ? TEMPORARY_DS_INSTRUMENT_SET_ID
    : instrument.setId ?? (instrument.userCreated ? USER_INSTRUMENT_SET_ID : FACTORY_SYNTH_SET_ID);
  return {
    ...instrument,
    setId,
    source,
    descriptors: instrument.descriptors ?? characterizeInstrument(instrument),
    original: instrument.original ?? (source.kind === "created" ? undefined : snapshotInstrument(instrument)),
  };
}

function isDecentSamplerInstancedInstrument(
  instrument: Pick<Instrument, "descriptors" | "source">,
  source: NonNullable<Instrument["source"]>,
): boolean {
  const tokens = [
    source.kind,
    source.label,
    source.pluginId,
    ...(instrument.descriptors ?? []),
  ].join(" ").toLowerCase();
  return tokens.includes("decentsampler")
    || tokens.includes("decent sampler")
    || tokens.includes("decent-sampler");
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
    loading: true,
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
        s.loading = false;
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
        s.loading = false;
      });
    },
    setLoading: (loading) => set((s) => {
      s.loading = loading;
    }),

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
  hydrateFiles: (files: AudioFile[]) => void;
  updateFile: (id: Id, patch: Partial<AudioFile>) => void;
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
    hydrateFiles: (files) =>
      set((s) => {
        s.files = files.map((file) => structuredClone(file));
      }),
    updateFile: (id, patch) =>
      set((s) => {
        const file = s.files.find((candidate) => candidate.id === id);
        if (file) Object.assign(file, patch);
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
  if (a.kind === "track" && b.kind === "track")
    return a.trackId === b.trackId;
  if (a.kind === "segment" && b.kind === "segment")
    return a.segmentId === b.segmentId;
  if (a.kind === "component" && b.kind === "component")
    return a.componentId === b.componentId;
  if (a.kind === "plugin" && b.kind === "plugin")
    return a.pluginId === b.pluginId;
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
