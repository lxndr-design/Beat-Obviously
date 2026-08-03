import { createStore as create } from "zustand/vanilla";
import { immer } from "zustand/middleware/immer";
import { current } from "immer";
import { nanoid } from "nanoid";
import { temporal, type TemporalStoreApi } from "./temporal";
import { defaultTrackEffectParams } from "./effects";
import { pruneDevFixtureInstruments } from "./instrumentLibraryGuards";
import { normalizeInstrumentTaxonomy } from "./instrumentTaxonomy";
import { normalizeSampleMap } from "./sampleZones";
import {
  associateInstrumentWithSong,
  mergeInstrumentSongAssociations,
  projectInstrumentAssociations,
} from "./instrumentSongAssociations";
import { createAurumTestInstruments } from "./aurumTestBank";
import { createSalamanderCompactGrand } from "./factoryPiano";
import { createFactoryScoreSamplerBank } from "./factoryScoreSamplers";
import { FACTORY_SYNTH_PRESETS, synthDraftToInstrumentPatch } from "./synthStore";
import { audioBusExists, canSetAudioBusOutput, canSetAudioBusSend } from "./audioBusRouting";
import {
  createSegmentEditOperation,
  hasAppliedProjectOperation,
  markProjectOperationApplied,
  publishProjectOperation,
  type SegmentEditProjectOperation,
} from "../collaboration/projectOperations";
import { normalizeLibraryMetadata, touchLibraryMetadata } from "./libraryMetadata";
import { AUDIO_BUS_SCHEMA_VERSION } from "./types";
import type { BeatProjectAsset, BeatProjectIntegrityReport, ProjectSidecarCleanupReport, RecentProjectEntry } from "../ipc/schema";
import type {
  Beats,
  AudioFile,
  AudioBusCreateOptions,
  Id,
  Instrument,
  InstrumentSet,
  InstrumentSnapshot,
  PluginAdapter,
  Project,
  ReturnBus,
  Segment,
  Track,
  TrackEffect,
  TrackEffectAutomationPoint,
  MasterChainSettings,
  TrackSend,
  TransportState,
  UiState,
} from "./types";

/**
 * Single root store split into three slices:
 *   - project: persisted, undoable
 *   - transport: live, NOT undoable (you don't undo "press play")
 *   - ui: ephemeral, NOT undoable
 *
 * Only the project slice is wrapped by local undo history. Transport and UI live in
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
  updateTrackEffect: (trackId: Id, effectId: Id, patch: Partial<TrackEffect>) => void;
  removeTrackEffect: (trackId: Id, effectId: Id) => void;
  moveTrackEffect: (trackId: Id, effectId: Id, direction: -1 | 1) => void;
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
  upsertTrackSend: (trackId: Id, busId: Id, patch: Partial<TrackSend>) => boolean;
  removeTrackSend: (trackId: Id, busId: Id) => void;
  addReturnBus: (name?: string) => Id;
  addAudioBus: (options?: AudioBusCreateOptions) => Id;
  updateReturnBus: (busId: Id, patch: Partial<ReturnBus>) => void;
  removeReturnBus: (busId: Id) => void;
  setTrackOutputBus: (trackId: Id, busId?: Id, outputEnabled?: boolean) => boolean;
  setAudioBusOutput: (busId: Id, destinationBusId?: Id, outputEnabled?: boolean) => boolean;
  upsertAudioBusSend: (busId: Id, destinationBusId: Id, patch: Partial<TrackSend>) => boolean;
  removeAudioBusSend: (busId: Id, destinationBusId: Id) => void;
  addReturnBusEffect: (busId: Id, kind?: TrackEffect["kind"]) => Id;
  updateReturnBusEffect: (busId: Id, effectId: Id, patch: Partial<TrackEffect>) => void;
  removeReturnBusEffect: (busId: Id, effectId: Id) => void;
  moveReturnBusEffect: (busId: Id, effectId: Id, direction: -1 | 1) => void;

  // Segment ops
  addSegment: (trackId: Id, segment: Partial<Segment>) => Id;
  removeSegment: (segmentId: Id) => void;
  moveSegment: (segmentId: Id, toTrackId: Id, toStartBeat: Beats) => void;
  updateSegment: (segmentId: Id, patch: Partial<Segment>) => void;
  applySegmentEditCommand: (command: SegmentEditCommand, operation?: SegmentEditProjectOperation) => Id[];
  /** Set repeat count; rest of track is filled until next segment. */
  setSegmentRepeats: (segmentId: Id, repeats: number) => void;

  // Project ops
  setBpm: (bpm: number) => void;
  setTimeSignature: (ts: { num: number; denom: number; boldBeats: number[] }) => void;
  setLengthBeats: (beats: Beats) => void;
  updateMasterChain: (patch: Partial<MasterChainSettings>) => void;
  updateRecordingInput: (patch: Partial<Project["recordingInput"]>) => void;
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
      createdSegmentIds?: Id[];
    }
  | {
      kind: "paste";
      segments: Array<Segment & { name?: string }>;
      startBeat?: Beats;
      targetTrackId?: Id;
      createdSegmentIds?: Id[];
    }
  | {
      kind: "delete";
      segmentIds: Id[];
    }
  | {
      kind: "metadata";
      segmentIds: Id[];
      name?: string;
      color?: string | null;
      icon?: string | null;
    }
  | {
      kind: "group";
      segmentIds: Id[];
      groupId?: Id;
    }
  | {
      kind: "ungroup";
      segmentIds?: Id[];
      groupIds?: Id[];
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
      createdSegmentId?: Id;
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
export type AudioLatencyMode = "reported" | "low" | "balanced" | "safe";
export type ThemeContrastLevel = "low" | "normal" | "high";
export type ThemeMode = "dark" | "light" | "mellow";

interface SettingsSnapshot {
  resizeSnapSeconds: number;
  resizeSnapMeasures: number;
  timelineSmartGrid: boolean;
  midiSmartGrid: boolean;
  timelineSubdivision: 2 | 4 | 8 | 16;
  midiSubdivision: 2 | 4 | 8 | 16;
  themeContrastLevel: ThemeContrastLevel;
  themeMode: ThemeMode;
  preferredAudioTypeName: string;
  preferredInputDeviceName: string;
  preferredOutputDeviceName: string;
  preferredSampleRate: number;
  preferredBufferSize: number;
  audioLatencyMode: AudioLatencyMode;
  defaultInputMonitoring: boolean;
  defaultRecordArm: boolean;
  defaultInputChannelCount: 1 | 2;
  fileAssetPolicy: FileAssetPolicy;
  autosaveBackups: boolean;
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
  themeContrastLevel: "normal",
  themeMode: "dark",
  preferredAudioTypeName: "",
  preferredInputDeviceName: "",
  preferredOutputDeviceName: "",
  preferredSampleRate: 48000,
  preferredBufferSize: 512,
  audioLatencyMode: "reported",
  defaultInputMonitoring: false,
  defaultRecordArm: false,
  defaultInputChannelCount: 2,
  fileAssetPolicy: "copy",
  autosaveBackups: true,
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
    themeContrastLevel: normalizeThemeContrastLevel(source.themeContrastLevel),
    themeMode: normalizeThemeMode(source.themeMode),
    preferredAudioTypeName: normalizeString(source.preferredAudioTypeName),
    preferredInputDeviceName: normalizeString(source.preferredInputDeviceName),
    preferredOutputDeviceName: normalizeString(source.preferredOutputDeviceName),
    preferredSampleRate: normalizeSampleRate(source.preferredSampleRate),
    preferredBufferSize: normalizeBufferSize(source.preferredBufferSize),
    audioLatencyMode: normalizeAudioLatencyMode(source.audioLatencyMode),
    defaultInputMonitoring: source.defaultInputMonitoring ?? DEFAULT_SETTINGS.defaultInputMonitoring,
    defaultRecordArm: source.defaultRecordArm ?? DEFAULT_SETTINGS.defaultRecordArm,
    defaultInputChannelCount: source.defaultInputChannelCount === 1 ? 1 : 2,
    fileAssetPolicy: normalizeFileAssetPolicy(source.fileAssetPolicy),
    autosaveBackups: source.autosaveBackups ?? DEFAULT_SETTINGS.autosaveBackups,
    memoryCachePreset: normalizeMemoryCachePreset(source.memoryCachePreset),
    restoreLastProject: source.restoreLastProject ?? DEFAULT_SETTINGS.restoreLastProject,
    startupProjectBehavior: normalizeStartupProjectBehavior(source.startupProjectBehavior),
  };
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value as number)) : fallback;
}

function normalizedTrackSend(busId: Id, source: Partial<TrackSend>): TrackSend {
  return {
    busId,
    gainDb: clampNumber(source.gainDb, -120, 24, -12),
    pan: clampNumber(source.pan, -1, 1, 0),
    enabled: source.enabled !== false,
    preFader: source.preFader === true,
  };
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

function normalizeThemeContrastLevel(value: ThemeContrastLevel | undefined): ThemeContrastLevel {
  return value === "low" || value === "normal" || value === "high" ? value : DEFAULT_SETTINGS.themeContrastLevel;
}

function normalizeThemeMode(value: ThemeMode | undefined): ThemeMode {
  return value === "light" || value === "dark" || value === "mellow" ? value : DEFAULT_SETTINGS.themeMode;
}

function normalizeSampleRate(value: number | undefined): number {
  return value === 44100 || value === 48000 || value === 88200 || value === 96000 || value === 192000
    ? value
    : DEFAULT_SETTINGS.preferredSampleRate;
}

function normalizeBufferSize(value: number | undefined): number {
  return value === 64 || value === 128 || value === 256 || value === 512 || value === 1024 || value === 2048
    ? value
    : DEFAULT_SETTINGS.preferredBufferSize;
}

function normalizeAudioLatencyMode(value: AudioLatencyMode | undefined): AudioLatencyMode {
  return value === "reported" || value === "low" || value === "balanced" || value === "safe"
    ? value
    : DEFAULT_SETTINGS.audioLatencyMode;
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
    outputEnabled: true,
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
    immer((set, get) => ({
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

      updateTrackEffect: (trackId, effectId, patch) =>
        set((s) => {
          const track = s.project.tracks.find((candidate) => candidate.id === trackId);
          const effect = track?.effects.filters.find((candidate) => candidate.id === effectId);
          if (effect) Object.assign(effect, patch);
        }),

      removeTrackEffect: (trackId, effectId) =>
        set((s) => {
          const track = s.project.tracks.find((candidate) => candidate.id === trackId);
          if (track) track.effects.filters = track.effects.filters.filter((effect) => effect.id !== effectId);
        }),

      moveTrackEffect: (trackId, effectId, direction) =>
        set((s) => {
          const track = s.project.tracks.find((candidate) => candidate.id === trackId);
          if (!track) return;
          moveArrayItem(track.effects.filters, effectId, direction);
        }),

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

      upsertTrackSend: (trackId, busId, patch) =>
      {
        let changed = false;
        set((s) => {
          const track = s.project.tracks.find((candidate) => candidate.id === trackId);
          if (!track || !busId || !audioBusExists(s.project.returnBuses, busId)) return;
          if (!track.sends) track.sends = [];
          let send = track.sends.find((candidate) => candidate.busId === busId);
          if (!send) {
            send = normalizedTrackSend(busId, {});
            track.sends.push(send);
          }
          Object.assign(send, normalizedTrackSend(busId, { ...send, ...patch }));
          changed = true;
        });
        return changed;
      },

      removeTrackSend: (trackId, busId) =>
        set((s) => {
          const track = s.project.tracks.find((candidate) => candidate.id === trackId);
          if (!track?.sends) return;
          track.sends = track.sends.filter((send) => send.busId !== busId);
        }),

      addReturnBus: (name) => useProjectStore.getState().addAudioBus({ name }),

      addAudioBus: (options = {}) => {
        const id = nanoid();
        set((s) => {
          const index = s.project.returnBuses.length + 1;
          s.project.returnBuses.push({
            schemaVersion: AUDIO_BUS_SCHEMA_VERSION,
            id,
            name: options.name?.trim() || `Bus ${index}`,
            channelLayout: "stereo",
            outputEnabled: true,
            inputTrimDb: 0,
            gainDb: 0,
            pan: 0,
            mute: false,
            solo: false,
            soloSafe: false,
            mixerOrder: index - 1,
            sends: [],
            effects: { filters: [] },
          });
          const trackIds = new Set(options.trackIds ?? []);
          for (const track of s.project.tracks) {
            if (!trackIds.has(track.id)) continue;
            track.outputBusId = id;
            track.outputEnabled = true;
          }
        });
        return id;
      },

      updateReturnBus: (busId, patch) =>
        set((s) => {
          const bus = s.project.returnBuses.find((candidate) => candidate.id === busId);
          if (!bus) return;
          const {
            id: _id,
            schemaVersion: _schemaVersion,
            outputBusId: _outputBusId,
            outputEnabled: _outputEnabled,
            sends: _sends,
            ...safePatch
          } = patch;
          Object.assign(bus, safePatch);
          bus.name = bus.name.trim() || "Bus";
          bus.channelLayout = bus.channelLayout === "mono" ? "mono" : "stereo";
          bus.inputTrimDb = clampNumber(bus.inputTrimDb, -96, 24, 0);
          bus.gainDb = clampNumber(bus.gainDb, -96, 24, 0);
          bus.pan = clampNumber(bus.pan, -1, 1, 0);
          bus.mixerOrder = Math.max(0, Math.trunc(clampNumber(bus.mixerOrder, 0, 100000, 0)));
        }),

      removeReturnBus: (busId) =>
        set((s) => {
          s.project.returnBuses = s.project.returnBuses.filter((candidate) => candidate.id !== busId);
          for (const track of s.project.tracks) {
            if (track.sends) track.sends = track.sends.filter((send) => send.busId !== busId);
            if (track.outputBusId === busId) {
              track.outputBusId = undefined;
              track.outputEnabled = false;
            }
          }
          for (const bus of s.project.returnBuses) {
            if (bus.sends) bus.sends = bus.sends.filter((send) => send.busId !== busId);
            if (bus.outputBusId === busId) {
              bus.outputBusId = undefined;
              bus.outputEnabled = false;
            }
          }
        }),

      setTrackOutputBus: (trackId, busId, outputEnabled = true) => {
        let changed = false;
        set((s) => {
          const track = s.project.tracks.find((candidate) => candidate.id === trackId);
          if (!track || (outputEnabled && busId && !audioBusExists(s.project.returnBuses, busId))) return;
          track.outputBusId = busId;
          track.outputEnabled = outputEnabled;
          changed = true;
        });
        return changed;
      },

      setAudioBusOutput: (busId, destinationBusId, outputEnabled = true) => {
        let changed = false;
        set((s) => {
          const bus = s.project.returnBuses.find((candidate) => candidate.id === busId);
          if (!bus || (outputEnabled && !canSetAudioBusOutput(s.project.returnBuses, busId, destinationBusId))) return;
          bus.outputBusId = destinationBusId;
          bus.outputEnabled = outputEnabled;
          changed = true;
        });
        return changed;
      },

      upsertAudioBusSend: (busId, destinationBusId, patch) => {
        let changed = false;
        set((s) => {
          const bus = s.project.returnBuses.find((candidate) => candidate.id === busId);
          if (!bus || !canSetAudioBusSend(s.project.returnBuses, busId, destinationBusId, patch)) return;
          if (!bus.sends) bus.sends = [];
          let send = bus.sends.find((candidate) => candidate.busId === destinationBusId);
          if (!send) {
            send = normalizedTrackSend(destinationBusId, {});
            bus.sends.push(send);
          }
          Object.assign(send, normalizedTrackSend(destinationBusId, { ...send, ...patch }));
          changed = true;
        });
        return changed;
      },

      removeAudioBusSend: (busId, destinationBusId) =>
        set((s) => {
          const bus = s.project.returnBuses.find((candidate) => candidate.id === busId);
          if (bus?.sends) bus.sends = bus.sends.filter((send) => send.busId !== destinationBusId);
        }),

      addReturnBusEffect: (busId, kind = "reverb") => {
        const effectId = nanoid();
        set((s) => {
          const bus = s.project.returnBuses.find((candidate) => candidate.id === busId);
          if (!bus) return;
          bus.effects.filters.push({
            id: effectId,
            kind,
            bypassed: false,
            params: defaultTrackEffectParams(kind),
            automation: [],
          });
        });
        return effectId;
      },

      updateReturnBusEffect: (busId, effectId, patch) =>
        set((s) => {
          const bus = s.project.returnBuses.find((candidate) => candidate.id === busId);
          const effect = bus?.effects.filters.find((candidate) => candidate.id === effectId);
          if (effect) Object.assign(effect, patch);
        }),

      removeReturnBusEffect: (busId, effectId) =>
        set((s) => {
          const bus = s.project.returnBuses.find((candidate) => candidate.id === busId);
          if (bus) bus.effects.filters = bus.effects.filters.filter((effect) => effect.id !== effectId);
        }),

      moveReturnBusEffect: (busId, effectId, direction) =>
        set((s) => {
          const bus = s.project.returnBuses.find((candidate) => candidate.id === busId);
          if (!bus) return;
          moveArrayItem(bus.effects.filters, effectId, direction);
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

      applySegmentEditCommand: (requestedCommand, suppliedOperation) => {
        const operation = suppliedOperation ?? createSegmentEditOperation(get().project.id, requestedCommand);
        if (hasAppliedProjectOperation(operation.operationId)) return [];
        const command = operation.payload.command;
        const createdIds: Id[] = [];
        if (command.kind === "duplicate" || command.kind === "paste") {
          createdIds.push(...(command.createdSegmentIds ?? []));
        } else if (command.kind === "group" && command.groupId) {
          createdIds.push(command.groupId);
        } else if (command.kind === "split") {
          if (command.createdSegmentId) createdIds.push(command.createdSegmentId);
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

          if (command.kind === "paste") {
            const tracksById = new Map(s.project.tracks.map((track) => [track.id, track]));
            const sourceAnchor = command.startBeat === undefined
              ? 0
              : Math.min(...command.segments.map((segment) => segment.startBeat));
            for (const [index, source] of command.segments.entries()) {
              const targetTrack = tracksById.get(command.targetTrackId ?? source.trackId);
              if (!targetTrack) continue;
              const pastedStart = command.startBeat === undefined
                ? source.startBeat
                : command.startBeat + source.startBeat - sourceAnchor;
              const clone: Segment = {
                ...cloneProjectData(source),
                id: createdIds[index],
                trackId: targetTrack.id,
                startBeat: Math.max(0, pastedStart),
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

          if (command.kind === "metadata") {
            const ids = new Set(command.segmentIds);
            for (const track of s.project.tracks) {
              for (const segment of track.segments) {
                if (!ids.has(segment.id)) continue;
                if (command.name !== undefined) {
                  const nextName = command.name.trim();
                  if (nextName) segment.name = nextName;
                  else delete segment.name;
                }
                if (command.color !== undefined) {
                  const nextColor = command.color?.trim() ?? "";
                  if (nextColor) segment.color = nextColor;
                  else delete segment.color;
                }
                if (command.icon !== undefined) {
                  const nextIcon = command.icon?.trim() ?? "";
                  if (nextIcon) segment.icon = nextIcon;
                  else delete segment.icon;
                }
              }
            }
            return;
          }

          if (command.kind === "group") {
            const groupId = command.groupId ?? createdIds[0];
            if (!groupId) return;
            const ids = new Set(command.segmentIds);
            for (const track of s.project.tracks) {
              for (const segment of track.segments) {
                if (ids.has(segment.id)) segment.groupId = groupId;
              }
            }
            return;
          }

          if (command.kind === "ungroup") {
            const segmentIds = new Set(command.segmentIds ?? []);
            const groupIds = new Set(command.groupIds ?? []);
            if (segmentIds.size === 0 && groupIds.size === 0) return;
            for (const track of s.project.tracks) {
              for (const segment of track.segments) {
                if (segmentIds.has(segment.id) || (segment.groupId && groupIds.has(segment.groupId))) {
                  delete segment.groupId;
                }
              }
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

              if (segment.payload.kind === "midi" || segment.payload.kind === "mixed") {
                const originalNotes = cloneProjectData(segment.payload.notes);
                segment.payload.notes = clipMidiNotesToWindow(originalNotes, 0, leftLength);
                if (right.payload.kind === "midi" || right.payload.kind === "mixed") {
                  right.payload.notes = clipMidiNotesToWindow(originalNotes, leftLength, rightLength);
                }
              } else if (segment.payload.kind === "drumpad" && right.payload.kind === "drumpad") {
                const originalHits = cloneProjectData(segment.payload.hits);
                segment.payload.hits = clipMidiNotesToWindow(originalHits, 0, leftLength);
                right.payload.hits = clipMidiNotesToWindow(originalHits, leftLength, rightLength);
              }

              segment.lengthBeats = leftLength;
              segment.repeats = 0;
              segment.fadeInBeats = clampFade(segment.fadeInBeats ?? 0, leftLength);
              segment.fadeOutBeats = clampFade(segment.fadeOutBeats ?? 0, leftLength);
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

        markProjectOperationApplied(operation);
        if (!suppliedOperation) publishProjectOperation(operation);

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

      updateMasterChain: (patch) =>
        set((s) => {
          Object.assign(s.project.masterChain, patch);
        }),
      updateRecordingInput: (patch) =>
        set((s) => {
          Object.assign(s.project.recordingInput, patch);
        }),

      rename: (name) => {
        set((s) => {
          s.project.name = name;
        });
        queueMicrotask(() => {
          useInstrumentStore.getState().associateProjectInstruments(useProjectStore.getState().project);
        });
      },

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
) as TemporalStoreApi<ProjectSlice>;

export interface UndoOptions {
  allowDestructive?: boolean;
}

export const nextUndoRequiresConfirmation = () => {
  const temporalState = useProjectStore.temporal.getState();
  const previous = temporalState.pastStates[temporalState.pastStates.length - 1];
  const current = useProjectStore.getState();
  return Boolean(previous?.project && wouldUndoDestructively(current.project, previous.project));
};

/** Bound helpers for invoking undo/redo from anywhere. */
export const undo = (options: UndoOptions = {}) => {
  if (nextUndoRequiresConfirmation() && !options.allowDestructive) return false;
  const temporalState = useProjectStore.temporal.getState();
  if (temporalState.pastStates.length === 0) return false;
  temporalState.undo();
  return true;
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
  if (segment.payload.kind === "drumpad") return segment.payload.hits.length > 0;
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
  const requestedStartBeat = Math.max(0, nextStartBeat);
  const newLengthBeats = Math.max(MIN_SEGMENT_LENGTH_BEATS, nextLengthBeats);
  // Drum grids are fixed-time sources. Shortening either edge is an end trim,
  // never a time stretch or a request to discard the opening of the groove.
  const newStartBeat = segment.payload.kind === "drum" && newLengthBeats < oldLengthBeats
    ? oldStartBeat
    : requestedStartBeat;
  const localStart = Math.max(0, newStartBeat - oldStartBeat);
  if (origin?.payload) segment.payload = cloneProjectData(origin.payload);
  if (segment.payload.kind === "midi" || segment.payload.kind === "mixed")
    segment.payload.notes = clipMidiNotesToWindow(segment.payload.notes, localStart, newLengthBeats);
  else if (segment.payload.kind === "drumpad")
    segment.payload.hits = clipMidiNotesToWindow(segment.payload.hits, localStart, newLengthBeats);
  if (segment.payload.kind === "drum" && segment.payload.sourceLengthBeats == null) {
    segment.payload.sourceLengthBeats = Math.max(1, segment.payload.stepCount);
  }
  segment.startBeat = newStartBeat;
  segment.lengthBeats = newLengthBeats;
  segment.sourceStartBeat = Math.max(0, oldSourceStartBeat + localStart);
  enforceSegmentBounds(segment, projectLengthBeats);
}

function clipMidiNotesToWindow<T extends { startBeat: Beats; lengthBeats: Beats }>(
  notes: T[],
  windowStart: Beats,
  windowLength: Beats,
): T[] {
  const windowEnd = windowStart + windowLength;
  return notes
    .filter((note) => note.startBeat < windowEnd && note.startBeat + note.lengthBeats > windowStart)
    .map((note) => {
      const clippedStart = Math.max(note.startBeat, windowStart);
      const clippedEnd = Math.min(note.startBeat + note.lengthBeats, windowEnd);
      return {
        ...note,
        startBeat: clippedStart - windowStart,
        lengthBeats: clippedEnd - clippedStart,
      };
    })
    .filter((note) => note.lengthBeats > 0);
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
  sidebarWidth: 330,
  setZoom: (px) => set({ beatsToPx: Math.max(8, Math.min(256, px)) }),
  setLastSegmentLength: (n) => set({ lastSegmentLength: Math.max(0.25, n) }),
  setSidebarWidth: (px) => set({ sidebarWidth: Math.max(220, Math.min(560, px)) }),
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
  themeContrastLevel: ThemeContrastLevel;
  themeMode: ThemeMode;
  preferredAudioTypeName: string;
  preferredInputDeviceName: string;
  preferredOutputDeviceName: string;
  preferredSampleRate: number;
  preferredBufferSize: number;
  audioLatencyMode: AudioLatencyMode;
  defaultInputMonitoring: boolean;
  defaultRecordArm: boolean;
  defaultInputChannelCount: 1 | 2;
  fileAssetPolicy: FileAssetPolicy;
  autosaveBackups: boolean;
  memoryCachePreset: MemoryCachePreset;
  restoreLastProject: boolean;
  startupProjectBehavior: StartupProjectBehavior;
  setResizeSnapSeconds: (s: number) => void;
  setResizeSnapMeasures: (m: number) => void;
  setTimelineSmartGrid: (enabled: boolean) => void;
  setMidiSmartGrid: (enabled: boolean) => void;
  setTimelineSubdivision: (subdivision: 2 | 4 | 8 | 16) => void;
  setMidiSubdivision: (subdivision: 2 | 4 | 8 | 16) => void;
  setThemeContrastLevel: (level: ThemeContrastLevel) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setPreferredInputDevice: (typeName: string, deviceName: string) => void;
  setPreferredOutputDevice: (typeName: string, deviceName: string) => void;
  setPreferredSampleRate: (sampleRate: number) => void;
  setPreferredBufferSize: (bufferSize: number) => void;
  setAudioLatencyMode: (mode: AudioLatencyMode) => void;
  setDefaultInputMonitoring: (enabled: boolean) => void;
  setDefaultRecordArm: (enabled: boolean) => void;
  setDefaultInputChannelCount: (count: 1 | 2) => void;
  setFileAssetPolicy: (policy: FileAssetPolicy) => void;
  setAutosaveBackups: (enabled: boolean) => void;
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
  setThemeContrastLevel: (themeContrastLevel) => {
    const normalized = normalizeThemeContrastLevel(themeContrastLevel);
    writeSettingsPatch({ themeContrastLevel: normalized });
    set({ themeContrastLevel: normalized });
  },
  setThemeMode: (themeMode) => {
    const normalized = normalizeThemeMode(themeMode);
    writeSettingsPatch({ themeMode: normalized });
    set({ themeMode: normalized });
  },
  setPreferredInputDevice: (preferredAudioTypeName, preferredInputDeviceName) => {
    writeSettingsPatch({ preferredAudioTypeName, preferredInputDeviceName });
    set({ preferredAudioTypeName, preferredInputDeviceName });
  },
  setPreferredOutputDevice: (_typeName, preferredOutputDeviceName) => {
    writeSettingsPatch({ preferredOutputDeviceName });
    set({ preferredOutputDeviceName });
  },
  setPreferredSampleRate: (sampleRate) => {
    const preferredSampleRate = normalizeSampleRate(sampleRate);
    writeSettingsPatch({ preferredSampleRate });
    set({ preferredSampleRate });
  },
  setPreferredBufferSize: (bufferSize) => {
    const preferredBufferSize = normalizeBufferSize(bufferSize);
    writeSettingsPatch({ preferredBufferSize });
    set({ preferredBufferSize });
  },
  setAudioLatencyMode: (audioLatencyMode) => {
    const normalized = normalizeAudioLatencyMode(audioLatencyMode);
    writeSettingsPatch({ audioLatencyMode: normalized });
    set({ audioLatencyMode: normalized });
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
  recentProjectsLoading: boolean;
  missingAssets: BeatProjectAsset[];
  integrityReport: BeatProjectIntegrityReport | null;
  cleanupReport: ProjectSidecarCleanupReport | null;
  lastBackupPath: string | null;
  markDirty: (currentFingerprint?: string) => void;
  markUnsavedNewDocument: () => void;
  markSaved: (path?: string | null, savedFingerprint?: string) => void;
  closeDocument: () => void;
  setCurrentFilePath: (path: string | null) => void;
  addRecentFilePath: (path: string) => void;
  addRecentProject: (project: Partial<RecentProjectEntry> & { path: string }) => void;
  setRecentProjectsLoading: (loading: boolean) => void;
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
  recentProjectsLoading: true,
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
  markUnsavedNewDocument: () =>
    set({
      currentFilePath: null,
      documentOpen: true,
      dirty: true,
      savedFingerprint: null,
      lastBackupPath: null,
    }),
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
  setRecentProjectsLoading: (loading) => set({ recentProjectsLoading: loading }),
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
    openedAt: normalizeTimestampMs(project.openedAt),
    sizeBytes: Number.isFinite(project.sizeBytes) ? Number(project.sizeBytes) : 0,
    exists: project.exists ?? true,
  };
}

function normalizeTimestampMs(value: unknown): number {
  const timestamp = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  const timestampMs = timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp;
  return timestampMs >= Date.UTC(2024, 0, 1) ? timestampMs : 0;
}

function normalizeRecentProjects(projects: unknown[]): RecentProjectEntry[] {
  const unique: RecentProjectEntry[] = [];
  for (const project of projects) {
    if (!project || typeof project !== "object") continue;
    const candidate = project as Partial<RecentProjectEntry>;
    if (typeof candidate.path !== "string" || !candidate.path.trim()) continue;
    const normalized = createRecentProject(candidate as Partial<RecentProjectEntry> & { path: string });
    if (!unique.some((existing) => existing.path === normalized.path)) unique.push(normalized);
  }
  return unique.sort((left, right) => (
    right.openedAt - left.openedAt
    || left.path.localeCompare(right.path, undefined, { sensitivity: "base" })
  ));
}

function normalizeRecentFilePaths(paths: unknown[]): string[] {
  const unique: string[] = [];
  for (const path of paths) {
    if (typeof path !== "string" || !path.trim()) continue;
    const trimmed = path.trim();
    if (!unique.includes(trimmed)) unique.push(trimmed);
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
        version: "0.3.2",
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
let segmentPlaybackToken = 0;

interface UiSlice extends UiState {
  selectTrack: (id: Id, additive?: boolean) => void;
  setSelectedTracks: (ids: Id[]) => void;
  selectSegment: (id: Id, additive?: boolean) => void;
  setSelectedSegments: (ids: Id[]) => void;
  selectTrackEffectAutomationPoint: (key: string, additive?: boolean) => void;
  setSelectedTrackEffectAutomationPoints: (keys: string[]) => void;
  clearSelection: () => void;
  triggerSegmentPlayback: (id: Id) => void;
  openEditor: (e: UiState["openEditors"][number]) => void;
  closeEditor: (e: UiState["openEditors"][number]) => void;
  openTrackEffects: (trackId: Id) => void;
  closeTrackEffects: () => void;
}

export const useUiStore = create<UiSlice>()((set) => ({
  selectedTrackIds: [],
  selectedSegmentIds: [],
  selectedTrackEffectAutomationPointKeys: [],
  activeSegmentPlayback: {},
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
  setSelectedTrackEffectAutomationPoints: (keys) => set({
    selectedTrackEffectAutomationPointKeys: Array.from(new Set(keys)),
    selectedTrackIds: [],
    selectedSegmentIds: [],
  }),
  clearSelection: () =>
    set({ selectedTrackIds: [], selectedSegmentIds: [], selectedTrackEffectAutomationPointKeys: [] }),
  triggerSegmentPlayback: (id) => {
    const token = ++segmentPlaybackToken;
    set((s) => ({
      activeSegmentPlayback: {
        ...s.activeSegmentPlayback,
        [id]: token,
      },
    }));
    globalThis.setTimeout(() => {
      set((s) => {
        if (s.activeSegmentPlayback[id] !== token) return s;
        const { [id]: _expired, ...nextActive } = s.activeSegmentPlayback;
        return { activeSegmentPlayback: nextActive };
      });
    }, 220);
  },
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
  deletedInstrumentStack: Instrument[];
  addInstrument: (i?: Partial<Instrument>) => Id;
  removeInstrument: (id: Id) => void;
  undoLastInstrumentDelete: () => boolean;
  updateInstrument: (id: Id, patch: Partial<Instrument>) => void;
  duplicateInstrument: (id: Id) => Id;
  hydrateInstruments: (instruments: Instrument[], sets?: InstrumentSet[]) => void;
  mergeProjectInstruments: (instruments: Instrument[], project: Project, sets?: InstrumentSet[]) => void;
  associateProjectInstruments: (project: Project) => void;
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
export const FACTORY_KEYS_SET_ID = "factory-keys";
export const FACTORY_SYNTH_SET_ID = "factory-synths";
export const AURUM_TEST_SET_ID = "aurum-test";
/** Stable library ID retained so existing project grouping references remain valid. */
export const LUMEN_TEST_INSTRUMENT_SET_ID = "lumus-test";
export const ROCK_DRUM_SET_ID = "rock-drums";
export const ORCHESTRA_SET_ID = "orchestra-pit";
export const TEMPORARY_DS_INSTRUMENT_SET_ID = "temporary-ds-instruments";
export const USER_INSTRUMENT_SET_ID = "user-instruments";

function defaultInstrumentSets(): InstrumentSet[] {
  return [
    { id: ROCK_DRUM_SET_ID, name: "Rock & Roll", factory: true },
    { id: FACTORY_DRUM_SET_ID, name: "Classic Machines", factory: true },
    { id: FACTORY_KEYS_SET_ID, name: "Acoustic Keys", factory: true },
    { id: ORCHESTRA_SET_ID, name: "Orchestra Pit", factory: true },
    { id: FACTORY_SYNTH_SET_ID, name: "Synths", factory: true },
    { id: AURUM_TEST_SET_ID, name: "Aurum Test", factory: true },
    { id: LUMEN_TEST_INSTRUMENT_SET_ID, name: "Lumen Test", factory: true },
    { id: TEMPORARY_DS_INSTRUMENT_SET_ID, name: "Instanced Instruments", factory: true },
    { id: USER_INSTRUMENT_SET_ID, name: "User", factory: true },
  ];
}

function defaultInstrument(): Instrument {
  const now = Date.now();
  return {
    id: nanoid(),
    name: "Aether Patch 1",
    createdAt: now,
    updatedAt: now,
    icon: "ph:cube",
    kind: "wavetable",
    envelope: { attackMs: 5, decayMs: 100, sustain: 0.7, releaseMs: 200 },
    knobs: { cutoff: 0.6, resonance: 0.2, drive: 0.1, color: 0.5 },
    filterType: "lowpass",
    waveform: "wavetable",
    detuneCents: 0,
    octave: 0,
    subOscLevel: 0,
    glideMs: 0,
    maxVoices: 16,
    mono: false,
    legato: false,
    pitchBendRangeSemitones: 2,
    ampLevel: 1,
    ampPan: 0,
    lfoWaveform: "sine",
    lfoRateHz: 4,
    lfoDepth: 0,
    lfoSync: false,
    lfoSyncedRate: "1/4",
    lfoSmoothing: 0,
    lfoRandomPhase: 0,
    lfoPhase: 0,
    lfoRetrigger: true,
    lfoOneShot: false,
    lfo2Waveform: "triangle",
    lfo2RateHz: 0.5,
    lfo2Sync: false,
    lfo2SyncedRate: "1/2",
    lfo2Smoothing: 0,
    lfo2RandomPhase: 0,
    lfo2Enabled: false,
    lfo2Phase: 0,
    lfo2Retrigger: true,
    lfo2OneShot: false,
    lfoPositionBipolar: true,
    lfoPitchBipolar: true,
    lfoFilterBipolar: true,
    lfoToPitch: 0,
    lfoToFilter: 0,
    envToFilter: 0,
    wavetable: defaultWavetableConfig(),
    aether: defaultAetherSynthConfig(),
    sampleIds: [],
    setId: USER_INSTRUMENT_SET_ID,
    taxonomy: { categoryId: "synth_electronic", instrumentId: "wavetable_synth" },
    source: { kind: "created", label: "Made in Beat / Aether" },
    userCreated: true,
  };
}

export function defaultWavetableConfig() {
  return {
    bank: "aether",
    position: 0.35,
    warp: 0.2,
    warpMode: "shape",
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
      phase: 0,
      randomPhase: 0.25,
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
      phase: 0,
      randomPhase: 0.25,
      wavetable: { ...oscA, bank: "glass", position: 0.25, warp: 0.16, warpMode: "shape", detuneCents: 8, blend: 0.35 },
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
    sampleSlot1: {
      schemaVersion: 5,
      enabled: false,
      audioFileId: "",
      rootNote: 60,
      level: 0.8,
      pan: 0,
      route: "filter",
      startRatio: 0,
      endRatio: 1,
      loopEnabled: false,
      loopStartRatio: 0,
      loopEndRatio: 1,
      fxSends: [0, 0],
      zones: [],
    },
    runtimeWarp: 0,
    runtimeWarpMode: "shape",
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
    maxVoices: instrument.maxVoices,
    mono: instrument.mono,
    legato: instrument.legato,
    pitchBendRangeSemitones: instrument.pitchBendRangeSemitones,
    ampLevel: instrument.ampLevel,
    ampPan: instrument.ampPan,
    wavetable: instrument.wavetable ? structuredClone(instrument.wavetable) : undefined,
    aether: instrument.aether ? structuredClone(instrument.aether) : undefined,
    aurum: instrument.aurum ? structuredClone(instrument.aurum) : undefined,
    synthPatch: instrument.synthPatch ? structuredClone(instrument.synthPatch) : undefined,
    nodeGraph: instrument.nodeGraph ? structuredClone(instrument.nodeGraph) : undefined,
    lfoWaveform: instrument.lfoWaveform,
    lfoRateHz: instrument.lfoRateHz,
    lfoDepth: instrument.lfoDepth,
    lfoSync: instrument.lfoSync,
    lfoSyncedRate: instrument.lfoSyncedRate,
    lfoSmoothing: instrument.lfoSmoothing,
    lfoRandomPhase: instrument.lfoRandomPhase,
    lfoPhase: instrument.lfoPhase,
    lfoRetrigger: instrument.lfoRetrigger,
    lfoOneShot: instrument.lfoOneShot,
    lfo2Waveform: instrument.lfo2Waveform,
    lfo2RateHz: instrument.lfo2RateHz,
    lfo2Sync: instrument.lfo2Sync,
    lfo2SyncedRate: instrument.lfo2SyncedRate,
    lfo2Smoothing: instrument.lfo2Smoothing,
    lfo2RandomPhase: instrument.lfo2RandomPhase,
    lfo2Enabled: instrument.lfo2Enabled,
    lfo2Phase: instrument.lfo2Phase,
    lfo2Retrigger: instrument.lfo2Retrigger,
    lfo2OneShot: instrument.lfo2OneShot,
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
    samplerComplexity: instrument.samplerComplexity,
    taxonomy: instrument.taxonomy ? structuredClone(instrument.taxonomy) : undefined,
    parentIds: instrument.parentIds ? [...instrument.parentIds] : undefined,
    descriptors: instrument.descriptors ? [...instrument.descriptors] : undefined,
  };
}

function withOriginal(instrument: Instrument): Instrument {
  return { ...instrument, original: snapshotInstrument(instrument) };
}

function normalizeInstrument(instrument: Instrument): Instrument {
  const source = instrument.source ?? inferInstrumentSource(instrument);
  const createdAt = instrument.createdAt ?? source.importedAt ?? Date.now();
  const updatedAt = Math.max(createdAt, instrument.updatedAt ?? createdAt);
  const sampleMap = normalizeSampleMap(instrument.sampleMap);
  const setId = isDecentSamplerInstancedInstrument(instrument, source)
    && (!instrument.setId || instrument.setId === USER_INSTRUMENT_SET_ID)
    ? TEMPORARY_DS_INSTRUMENT_SET_ID
    : instrument.setId ?? (instrument.userCreated ? USER_INSTRUMENT_SET_ID : FACTORY_SYNTH_SET_ID);
  return {
    ...instrument,
    createdAt,
    updatedAt,
    libraryMetadata: normalizeLibraryMetadata(instrument.libraryMetadata, {
      factory: !instrument.userCreated,
      createdAt,
      updatedAt,
      tags: instrument.descriptors,
      license: source.license,
      provenance: source.label,
    }),
    pitchBendRangeSemitones: clampNumber(instrument.pitchBendRangeSemitones, 0, 24, 2),
    sampleMap,
    setId,
    source,
    taxonomy: normalizeInstrumentTaxonomy(instrument),
    descriptors: instrument.descriptors ?? characterizeInstrument(instrument),
    songAssociations: mergeInstrumentSongAssociations(instrument.songAssociations),
    original: instrument.original ?? (source.kind === "created" ? undefined : snapshotInstrument(instrument)),
  };
}

function isSampleBackedInstrumentPatch(patch?: Partial<Instrument>): boolean {
  return patch?.kind === "sampler"
    || patch?.waveform === "sample"
    || Boolean(patch?.sampleUrl)
    || Boolean(patch?.sampleUrls?.length)
    || Boolean(patch?.sampleMap?.length);
}

function shouldUseAetherForCreatedInstrument(patch?: Partial<Instrument>): boolean {
  if (isSampleBackedInstrumentPatch(patch)) return false;
  return patch?.kind === undefined
    || patch.kind === "synth"
    || patch.kind === "wavetable"
    || patch.kind === "hybrid";
}

function defaultInstrumentForPatch(patch?: Partial<Instrument>): Instrument {
  const base = defaultInstrument();
  if (!isSampleBackedInstrumentPatch(patch)) return base;
  const { wavetable: _wavetable, aether: _aether, synthPatch: _synthPatch, ...sampleBase } = base;
  return {
    ...sampleBase,
    name: "Instrument 1",
    icon: "ph:waveform",
    kind: "sampler",
    waveform: "sample",
    taxonomy: patch?.taxonomy ?? { categoryId: "samplers", instrumentId: "sampler" },
    source: { kind: "created", label: "Made in Beat" },
  };
}

function aetherizeCreatedInstrumentPatch(patch: Partial<Instrument> = {}): Partial<Instrument> {
  if (patch.aurum) {
    return { ...patch, kind: "synth", waveform: "sine", wavetable: undefined, aether: undefined };
  }
  if (!shouldUseAetherForCreatedInstrument(patch)) return patch;
  return {
    ...patch,
    icon: patch.icon ?? "ph:cube",
    kind: "wavetable",
    waveform: "wavetable",
    wavetable: patch.wavetable ?? defaultWavetableConfig(),
    aether: patch.aether ?? defaultAetherSynthConfig(),
    source: patch.source ?? { kind: "created", label: "Made in Beat / Aether" },
    descriptors: Array.from(new Set([...(patch.descriptors ?? []), "aether", "wavetable"])).slice(0, 10),
  };
}

function uniqueInstrumentName(
  requestedName: string | undefined,
  instruments: Pick<Instrument, "id" | "name">[],
  currentId?: Id,
): string {
  const normalizedName = requestedName?.trim() || "Instrument 1";
  const existing = new Set(
    instruments
      .filter((instrument) => instrument.id !== currentId)
      .map((instrument) => instrument.name.trim().toLowerCase()),
  );
  if (!existing.has(normalizedName.toLowerCase())) return normalizedName;

  const match = normalizedName.match(/^(.*?)(?:\s+(\d+))?$/);
  const base = match?.[1]?.trim() || normalizedName;
  const start = match?.[2] ? Number.parseInt(match[2], 10) : 1;
  for (let index = Math.max(1, start); index < 10000; index += 1) {
    const name = `${base} ${index}`;
    if (!existing.has(name.toLowerCase())) return name;
  }
  return `${base} ${Date.now()}`;
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
  if (!sets || sets.length === 0) {
    return defaults.map((set) => ({
      ...set,
      libraryMetadata: normalizeLibraryMetadata(undefined, { factory: set.factory }),
    }));
  }
  const byId = new Map(defaults.map((set) => [set.id, set]));
  for (const set of sets) {
    const defaultSet = byId.get(set.id);
    const next =
      defaultSet?.factory
        ? { ...set, name: set.name.trim() || defaultSet.name, factory: true }
        : set;
    byId.set(
      set.id,
      { ...next, libraryMetadata: normalizeLibraryMetadata(next.libraryMetadata, { factory: next.factory }) },
    );
  }
  return Array.from(byId.values()).map((set) => ({
    ...set,
    libraryMetadata: normalizeLibraryMetadata(set.libraryMetadata, { factory: set.factory }),
  }));
}

export const useInstrumentStore = create<InstrumentLibrarySlice>()(
  immer((set, get) => ({
    loading: true,
    instruments: [],
    instrumentSets: defaultInstrumentSets(),
    deletedInstrumentStack: [],
    addInstrument: (patch) => {
      const normalizedPatch = aetherizeCreatedInstrumentPatch(patch);
      const requestedId = normalizedPatch.id;
      const id = requestedId && !get().instruments.some((instrument) => instrument.id === requestedId)
        ? requestedId
        : nanoid();
      let i = normalizeInstrument({ ...defaultInstrumentForPatch(normalizedPatch), ...normalizedPatch, id });
      i = { ...i, name: uniqueInstrumentName(i.name, get().instruments, i.id) };
      if (useDocumentStore.getState().documentOpen) {
        const project = useProjectStore.getState().project;
        i = associateInstrumentWithSong(i, {
          projectId: project.id,
          title: project.name,
          linkedAt: Date.now(),
        });
      }
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
        s.deletedInstrumentStack.push(structuredClone(current(target)));
        s.instruments = s.instruments.filter((i) => i.id !== id);
      }),
    undoLastInstrumentDelete: () => {
      let restored = false;
      set((s) => {
        const target = s.deletedInstrumentStack.pop();
        if (!target) return;
        const idTaken = s.instruments.some((instrument) => instrument.id === target.id);
        const restoredInstrument = idTaken ? { ...target, id: nanoid() } : target;
        restoredInstrument.name = uniqueInstrumentName(restoredInstrument.name, s.instruments, restoredInstrument.id);
        s.instruments.push(restoredInstrument);
        restored = true;
      });
      return restored;
    },
    updateInstrument: (id, patch) =>
      set((s) => {
        const i = s.instruments.find((x) => x.id === id);
        if (i) {
          const nextPatch = aetherizeCreatedInstrumentPatch({ ...i, ...patch });
          if (typeof nextPatch.name === "string") {
            nextPatch.name = uniqueInstrumentName(nextPatch.name, s.instruments, id);
          }
          Object.assign(i, nextPatch);
          i.updatedAt = Date.now();
          i.libraryMetadata = touchLibraryMetadata(i.libraryMetadata, {
            factory: !i.userCreated,
            createdAt: i.createdAt,
            tags: i.descriptors,
            license: i.source?.license,
            provenance: i.source?.label,
          });
          i.descriptors = characterizeInstrument(i);
        }
      }),
    duplicateInstrument: (id) => {
      const src = get().instruments.find((i) => i.id === id);
      if (!src) return "";
      const copy: Instrument = {
        ...structuredClone(src),
        id: nanoid(),
        name: uniqueInstrumentName(`${src.name} copy`, get().instruments),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        userCreated: true,
        setId: src.setId ?? USER_INSTRUMENT_SET_ID,
        source: { kind: "derived", label: `Derived from ${src.name}`, edited: false },
        original: snapshotInstrument(src),
        parentIds: [src.id],
        descriptors: characterizeInstrument(src),
        libraryMetadata: normalizeLibraryMetadata(undefined, {
          createdAt: Date.now(),
          updatedAt: Date.now(),
          forkedFromId: src.id,
          provenance: `Derived from ${src.name}`,
          tags: src.descriptors,
          license: src.source?.license,
        }),
      };
      set((s) => {
        s.instruments.push(copy);
      });
      return copy.id;
    },
    hydrateInstruments: (instruments, sets) =>
      set((s) => {
        s.instrumentSets = normalizeInstrumentSets(sets);
        s.instruments = pruneDevFixtureInstruments(instruments).map((instrument) => normalizeInstrument(instrument));
        s.loading = false;
      }),
    mergeProjectInstruments: (instruments, project, sets) =>
      set((s) => {
        const incomingById = new Map(
          pruneDevFixtureInstruments(instruments).map((instrument) => [instrument.id, instrument]),
        );
        const associations = projectInstrumentAssociations(project, Date.now());
        for (const association of associations) {
          const existingIndex = s.instruments.findIndex((instrument) => instrument.id === association.instrumentId);
          const existing = existingIndex >= 0 ? current(s.instruments[existingIndex]) : undefined;
          const incoming = incomingById.get(association.instrumentId);
          if (incoming) {
            const next = normalizeInstrument({
              ...incoming,
              songAssociations: mergeInstrumentSongAssociations(
                existing?.songAssociations,
                incoming.songAssociations,
                [association],
              ),
            });
            if (existingIndex >= 0) s.instruments[existingIndex] = next;
            else s.instruments.push(next);
          } else if (existingIndex >= 0) {
            s.instruments[existingIndex].songAssociations = mergeInstrumentSongAssociations(
              existing?.songAssociations,
              [association],
            );
          }
        }
        s.instrumentSets = normalizeInstrumentSets([
          ...current(s.instrumentSets),
          ...(sets ?? []),
        ]);
        s.loading = false;
      }),
    associateProjectInstruments: (project) =>
      set((s) => {
        for (const association of projectInstrumentAssociations(project, Date.now())) {
          const instrument = s.instruments.find((candidate) => candidate.id === association.instrumentId);
          if (!instrument) continue;
          instrument.songAssociations = mergeInstrumentSongAssociations(
            current(instrument).songAssociations,
            [association],
          );
        }
      }),
    addInstrumentSet: (name) => {
      const id = nanoid();
      set((s) => {
        const num = s.instrumentSets.filter((set) => !set.factory).length + 1;
        s.instrumentSets.push({
          id,
          name: name?.trim() || `Set ${num}`,
          libraryMetadata: normalizeLibraryMetadata(undefined),
        });
      });
      return id;
    },
    renameInstrumentSet: (id, name) =>
      set((s) => {
        const target = s.instrumentSets.find((instrumentSet) => instrumentSet.id === id);
        const nextName = name.trim();
        if (!target || !nextName) return;
        target.name = nextName.slice(0, 48);
        target.libraryMetadata = touchLibraryMetadata(target.libraryMetadata, { factory: target.factory });
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
      const lumenTestSeeds: Instrument[] = FACTORY_SYNTH_PRESETS
        .filter((preset) => preset.tags.includes("mvp-test") && preset.patch.instrumentType === "lumen-hybrid-synth")
        .map((preset) => {
          const patch = synthDraftToInstrumentPatch(preset.patch);
          return withOriginal({
            ...defaultInstrument(),
            ...patch,
            id: preset.id,
            name: preset.name,
            icon: "ph:sparkle",
            kind: "wavetable",
            waveform: "wavetable",
            sampleIds: patch.sampleIds ?? [],
            setId: LUMEN_TEST_INSTRUMENT_SET_ID,
            source: { kind: "created", label: "Made in Beat / Lumen v16 capability bank" },
            descriptors: ["lumen", "mvp-test", "lumen-test-bank", "v16", preset.category.toLowerCase()],
            userCreated: false,
          });
        });

      const seeds: Instrument[] = [
        withOriginal(createSalamanderCompactGrand(FACTORY_KEYS_SET_ID)),
        ...createFactoryScoreSamplerBank(ORCHESTRA_SET_ID).map(withOriginal),
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
        sampler("Pearl Crash 2", "/samples/pearl-master-studio/crash-02.wav", pearlSource, { cutoff: 0.94, resonance: 0.08, drive: 0, color: 0.74 }, ROCK_DRUM_SET_ID, { attackMs: 1, decayMs: 420, sustain: 0, releaseMs: 720 }),
        sampler("Pearl Ride", "/samples/pearl-master-studio/ride-01.wav", pearlSource, { cutoff: 0.9, resonance: 0.12, drive: 0, color: 0.72 }, ROCK_DRUM_SET_ID),
        sampler("Pearl Ride 2", "/samples/pearl-master-studio/ride-02.wav", pearlSource, { cutoff: 0.9, resonance: 0.12, drive: 0, color: 0.7 }, ROCK_DRUM_SET_ID, { attackMs: 1, decayMs: 360, sustain: 0, releaseMs: 620 }),
        sampler("Pearl Splash", "/samples/pearl-master-studio/splash-01.wav", pearlSource, { cutoff: 0.96, resonance: 0.08, drive: 0, color: 0.78 }, ROCK_DRUM_SET_ID, { attackMs: 1, decayMs: 260, sustain: 0, releaseMs: 420 }),
        sampler("Pearl Splash 2", "/samples/pearl-master-studio/splash-02.wav", pearlSource, { cutoff: 0.96, resonance: 0.08, drive: 0, color: 0.78 }, ROCK_DRUM_SET_ID, { attackMs: 1, decayMs: 280, sustain: 0, releaseMs: 460 }),
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
        ...lumenTestSeeds,
      ];
      seeds.push(...createAurumTestInstruments(AURUM_TEST_SET_ID).map(withOriginal));
      const deprecatedBreakcoreAetherInstrumentNames = new Set([
        "Breakcore Kick (Aether)",
        "Breakcore Snare (Aether)",
        "Breakcore Ghost Snare (Aether)",
        "Breakcore Closed Hat (Aether)",
        "Breakcore Open Hat (Aether)",
        "Breakcore Crash Ride (Aether)",
        "Breakcore Pitched Snare (Aether)",
        "Breakcore Noise Burst (Aether)",
        "Breakcore Clap Layer (Aether)",
        "Breakcore Metal Hit (Aether)",
        "Breakcore Rim Click (Aether)",
        "Breakcore Fast Roll Snare (Aether)",
        "Breakcore Kick (Synth)",
        "Breakcore Snare (Synth)",
        "Breakcore Ghost Snare (Synth)",
        "Breakcore Closed Hat (Synth)",
        "Breakcore Open Hat (Synth)",
        "Breakcore Crash Ride (Synth)",
        "Breakcore Pitched Snare (Synth)",
        "Breakcore Noise Burst (Synth)",
        "Breakcore Clap Layer (Synth)",
        "Breakcore Metal Hit (Synth)",
        "Breakcore Rim Click (Synth)",
        "Breakcore Fast Roll Snare (Synth)",
      ]);
      const isDeprecatedBreakcoreAetherInstrument = (instrument: Instrument) =>
        deprecatedBreakcoreAetherInstrumentNames.has(instrument.name)
        || (
          instrument.userCreated !== true
          && instrument.descriptors?.includes("breakcore") === true
          && instrument.descriptors?.includes("aether") === true
        );
      const canonicalSeeds = seeds.map((instrument) => {
        const normalized = normalizeInstrument(instrument);
        return { ...normalized, original: snapshotInstrument(normalized) };
      });
      const activeSeeds = canonicalSeeds.filter((instrument) => !isDeprecatedBreakcoreAetherInstrument(instrument));
      set((s) => {
        s.instrumentSets = normalizeInstrumentSets(s.instrumentSets);
        s.instruments = s.instruments
          .map((instrument) => normalizeInstrument(instrument))
          .filter((instrument) => instrument.userCreated || !isDeprecatedBreakcoreAetherInstrument(instrument));
        const seedByName = new Map(activeSeeds.map((instrument) => [instrument.name, instrument]));
        const seedById = new Map(activeSeeds.map((instrument) => [instrument.id, instrument]));
        for (const instrument of s.instruments) {
          if (instrument.userCreated) continue;
          const replacement = seedById.get(instrument.id) ?? seedByName.get(instrument.name);
          if (replacement && (
            instrument.descriptors?.includes("breakcore")
            || replacement.descriptors?.includes("aurum-test-bank")
            || replacement.descriptors?.includes("lumen-test-bank")
          )) {
            const existingId = instrument.id;
            Object.assign(instrument, structuredClone(replacement), { id: existingId });
          }
        }
        const existingIds = new Set(s.instruments.filter((instrument) => !instrument.userCreated).map((instrument) => instrument.id));
        const existingKeys = new Set(
          s.instruments
            .filter((instrument) => !instrument.userCreated)
            .map((instrument) => instrument.sampleUrl ?? instrument.name),
        );
        const missingSeeds = activeSeeds.filter((instrument) => !existingIds.has(instrument.id) && !existingKeys.has(instrument.sampleUrl ?? instrument.name));
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
        createdAt: Date.now(),
        updatedAt: Date.now(),
        libraryMetadata: normalizeLibraryMetadata(undefined, {
          forkedFromId: a.id,
          provenance: `Merged from ${a.name} and ${b.name}`,
          tags: Array.from(new Set([...(a.descriptors ?? []), ...(b.descriptors ?? [])])),
        }),
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
  if (a.kind === "samplerInstrument" && b.kind === "samplerInstrument")
    return a.instrumentId === b.instrumentId;
  if (a.kind === "synthInstrument" && b.kind === "synthInstrument")
    return a.instrumentId === b.instrumentId;
  if (a.kind === "track" && b.kind === "track")
    return a.trackId === b.trackId;
  if (a.kind === "trackAutomation" && b.kind === "trackAutomation")
    return a.trackId === b.trackId;
  if (a.kind === "segment" && b.kind === "segment")
    return a.segmentId === b.segmentId;
  if (a.kind === "component" && b.kind === "component")
    return a.componentId === b.componentId;
  if (a.kind === "plugin" && b.kind === "plugin")
    return a.pluginId === b.pluginId;
  return true;
}

function moveArrayItem(items: Array<{ id: Id }>, id: Id, direction: -1 | 1) {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return;
  const to = Math.max(0, Math.min(items.length - 1, from + direction));
  if (to === from) return;
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
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
  const recordingGroups = new Map<Id, Segment[]>();
  for (const segment of ordered) {
    if (!segment.recordingGroupId) continue;
    const takes = recordingGroups.get(segment.recordingGroupId) ?? [];
    takes.push(segment);
    recordingGroups.set(segment.recordingGroupId, takes);
  }
  for (const takes of recordingGroups.values()) {
    takes
      .sort((a, b) => (a.recordingTakeNumber ?? 0) - (b.recordingTakeNumber ?? 0) || (a.recordedAt ?? 0) - (b.recordedAt ?? 0) || a.id.localeCompare(b.id))
      .forEach((segment, index) => {
        segment.layer = index;
      });
  }
  for (const seg of ordered) {
    if (seg.recordingGroupId) continue;
    const segEnd = seg.startBeat + seg.lengthBeats;
    const fullyCoveredByEarlier = ordered.some((candidate) => {
      if (candidate === seg || candidate.startBeat > seg.startBeat) return false;
      const candidateEnd = candidate.startBeat + candidate.lengthBeats;
      return seg.startBeat >= candidate.startBeat && segEnd <= candidateEnd;
    });
    seg.layer = fullyCoveredByEarlier ? 1 : 0;
  }
}
