/**
 * IPC schema — JS ↔ C++ message contract.
 *
 * IMPORTANT: keep this in sync with `backend/Source/Ipc/Schema.h`. The two
 * sides exchange JSON-encoded payloads keyed by the request `kind`. If you
 * add/change a kind here, mirror it there.
 */

import type {
  AudioFile,
  Beats,
  EqAutomationPoint,
  Id,
  Instrument,
  InstrumentSet,
  PluginAdapter,
  Project,
  Track,
  WavemapDefinition,
} from "../state/types";
import type { BeatComponent } from "../state/components";

export interface BeatProjectDocument {
  schemaVersion: 1;
  savedAt: number;
  project: Project;
  instruments?: Instrument[];
  instrumentSets?: InstrumentSet[];
  audioFiles?: AudioFile[];
  components?: BeatComponent[];
  plugins?: PluginAdapter[];
  assets?: BeatProjectAsset[];
}

export type BeatProjectAssetKind = "audio" | "sample" | "plugin";
export type BeatProjectAssetPolicy = "bundled" | "external" | "plugin";

export interface BeatProjectAsset {
  id: string;
  kind: BeatProjectAssetKind;
  path: string;
  name?: string;
  policy: BeatProjectAssetPolicy;
  references: string[];
}

export type WavemapResynthesisSelectionMode = "full" | "transient" | "sustain" | "manual";

export interface WavemapResynthesisSelection {
  mode?: WavemapResynthesisSelectionMode;
  startRatio?: number;
  endRatio?: number;
  windowRatio?: number;
}

export type BeatProjectIntegritySeverity = "info" | "warning" | "error";

export interface BeatProjectIntegrityIssue {
  severity: BeatProjectIntegritySeverity;
  code: string;
  message: string;
  path?: string;
}

export interface BeatProjectIntegrityReport {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  issues: BeatProjectIntegrityIssue[];
}

export interface AudioRenderAnalysis {
  sampleRate: number;
  durationSeconds: number;
  lengthInSamples: number;
  channelCount: number;
  bitDepth?: number;
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

export interface AudioWaveformChannel {
  upper: number[];
  lower: number[];
}

export interface AudioWaveformSummary {
  left: AudioWaveformChannel;
  right: AudioWaveformChannel;
  sampleRate: number;
  durationSeconds: number;
  lengthInSamples: number;
  channelCount: number;
  bucketCount: number;
}

export interface AudioDeviceInfo {
  typeName: string;
  name: string;
  input: boolean;
  output: boolean;
  currentInput: boolean;
  currentOutput: boolean;
}

export interface AudioDeviceSnapshot {
  currentTypeName: string;
  currentInputName: string;
  currentOutputName: string;
  sampleRate: number;
  bufferSize: number;
  inputLatencySamples: number;
  outputLatencySamples: number;
  inputChannelNames: string[];
  outputChannelNames: string[];
  devices: AudioDeviceInfo[];
}

export interface RecordingCaptureStats {
  active: boolean;
  channels: number;
  recordedSamples: number;
  capacitySamples: number;
  sampleRate: number;
  overflowed: boolean;
  durationSeconds: number;
}

export interface RecordingSessionPlan {
  trackId: Id;
  transportStartBeat: Beats;
  captureStartBeat: Beats;
  countInBeats: Beats;
  captureDelaySeconds: number;
  maxDurationSeconds: number;
  inputChannels: number;
}

export interface ProjectExportJobStatus {
  active: boolean;
  finished: boolean;
  ok: boolean;
  jobId?: string;
  type?: "project" | "track" | "range";
  path: string;
  progress: number;
  samplesWritten?: number;
  totalSamples?: number;
  analysis?: AudioRenderAnalysis;
  error?: string;
}

export interface ProjectExportOptions {
  sampleRate?: number;
  bitDepth?: 16 | 24 | 32;
  channels?: 1 | 2;
  blockSize?: number;
}

export interface ProjectBackupEntry {
  path: string;
  name: string;
  modifiedAt: string;
  sizeBytes: number;
  latest: boolean;
  valid?: boolean;
  error?: string;
  projectName?: string;
  projectId?: string;
  savedAt?: number;
  schemaVersion?: number;
  integrityReport?: BeatProjectIntegrityReport;
}

export interface RecentProjectEntry {
  path: string;
  name: string;
  openedAt: number;
  sizeBytes: number;
  exists: boolean;
}

export interface ProjectSidecarCleanupReport {
  deletedFiles: number;
  failedFiles: number;
  deletedPaths: string[];
  failedPaths: string[];
}

export interface DecentSamplerImportSample {
  path: string;
  name: string;
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

export interface DecentSamplerEffect {
  type: string;
  position?: number;
  frequency?: number;
  resonance?: number;
  wetLevel?: number;
  roomSize?: number;
  damping?: number;
}

export interface DecentSamplerImport {
  name: string;
  path: string;
  pluginId?: string;
  uiImagePath?: string;
  uiImageDataUrl?: string;
  uiWidth?: number;
  uiHeight?: number;
  uiControls?: string[];
  uiControlDetails?: DecentSamplerUiControl[];
  effects?: DecentSamplerEffect[];
  sampleUrls: string[];
  samples: DecentSamplerImportSample[];
  audioFiles: AudioFile[];
}

// ===== Outbound (JS → C++) =================================================

export type OutboundRequest =
  | { kind: "app.ready" }
  // Transport ---------------------------------------------------------------
  | { kind: "transport.play" }
  | { kind: "transport.pause" }
  | { kind: "transport.stop" }
  | { kind: "transport.restart" }
  | { kind: "transport.seek"; positionBeat: Beats }
  | { kind: "transport.setSpeed"; speed: number }
  | { kind: "transport.setLoop"; range: { startBeat: Beats; endBeat: Beats } | null }
  // Project / persistence ---------------------------------------------------
  | { kind: "project.save"; project: Project }
  | { kind: "project.load"; id: Id }
  | { kind: "project.list" }
  | { kind: "project.saveFile"; document: BeatProjectDocument; pathHint?: string; forcePicker?: boolean }
  | { kind: "project.openFile"; pathHint?: string; directPath?: string }
  | { kind: "project.recentList" }
  | { kind: "project.recentRemove"; path: string }
  | { kind: "project.revealFile"; path: string }
  | { kind: "project.inspectDocument"; document: BeatProjectDocument; projectPath?: string }
  | { kind: "project.repairDocument"; document: BeatProjectDocument; projectPath?: string; action: "rebuildAssetManifest" | "repairSegmentTrackIds" }
  | { kind: "project.listBackups"; projectPath: string }
  | { kind: "project.restoreBackup"; projectPath: string; backupPath: string }
  | { kind: "project.relinkAsset"; asset: Pick<BeatProjectAsset, "kind" | "name" | "path">; pathHint?: string }
  | { kind: "project.cleanupAssets"; projectPath: string; document: BeatProjectDocument }
  | { kind: "project.exportWav"; project: Project; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; options?: ProjectExportOptions }
  | { kind: "project.exportTrackWav"; project: Project; trackId: Id; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; options?: ProjectExportOptions }
  | { kind: "project.exportRangeWav"; project: Project; startBeat: Beats; endBeat: Beats; includeTail?: boolean; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; options?: ProjectExportOptions }
  | { kind: "project.bounceTrackWav"; project: Project; trackId: Id; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; options?: ProjectExportOptions }
  | { kind: "project.exportWavAsync"; project: Project; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; options?: ProjectExportOptions }
  | { kind: "project.exportTrackWavAsync"; project: Project; trackId: Id; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; options?: ProjectExportOptions }
  | { kind: "project.exportRangeWavAsync"; project: Project; startBeat: Beats; endBeat: Beats; includeTail?: boolean; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; options?: ProjectExportOptions }
  | { kind: "project.exportCancel" }
  | { kind: "project.exportStatus" }
  // Tracks / segments — the audio engine reflects these into its model -----
  | { kind: "engine.applyProject"; project: Project; instruments?: Instrument[]; audioFiles?: AudioFile[] }
  | { kind: "engine.updateSegment"; segmentId: Id; patch: Partial<{ startBeat: Beats; lengthBeats: Beats; repeats: number; muted: boolean }> }
  | { kind: "engine.setParameter"; instrumentId: Id; parameterId: string; value: number; sampleOffset?: number; rampSamples?: number }
  // Instruments ------------------------------------------------------------
  | { kind: "instrument.save"; instrument: Instrument }
  | { kind: "instrument.delete"; id: Id }
  | { kind: "instrument.list" }
  | { kind: "instrument.importDecent"; pathHint?: string }
  | { kind: "instrument.renderPreview"; instrument: Instrument; note?: number; velocity?: number; bpm?: number; durationBeats?: Beats; bucketCount?: number; includeAudio?: boolean }
  | { kind: "instrument.resynthesizeWavemap"; audioFile: Pick<AudioFile, "id" | "name" | "path" | "sampleRate">; wavemapId?: string; name?: string; selection?: WavemapResynthesisSelection }
  // Audio files -----------------------------------------------------------
  | { kind: "audio.import"; pathHint?: string } // opens file picker
  | { kind: "audio.importMany"; pathHint?: string } // opens multi-file picker
  | { kind: "audio.list" }
  | { kind: "audio.delete"; ids: Id[]; deleteFiles?: boolean }
  | { kind: "audio.reveal"; path: string }
  | { kind: "audio.waveform"; path: string; bucketCount?: number }
  | { kind: "audio.listDevices" }
  | { kind: "audio.selectInputDevice"; typeName?: string; deviceName: string; inputChannelCount?: number }
  // Recording -------------------------------------------------------------
  | { kind: "recording.plan"; project: Project; instruments?: Instrument[]; audioFiles?: AudioFile[]; trackId?: Id; startBeat: Beats; countInBeats?: Beats; maxDurationSeconds: number; inputChannels?: number; sampleRate?: number; bpm?: number; requireRecordArm?: boolean }
  | { kind: "recording.prepare"; maxDurationSeconds: number; inputChannels?: number }
  | { kind: "recording.start" }
  | { kind: "recording.stop" }
  | { kind: "recording.cancel" }
  | { kind: "recording.status" }
  | { kind: "recording.writeWav"; pathHint: string; bitDepth?: 16 | 24 | 32 }
  | { kind: "recording.commitTake"; project: Project; instruments?: Instrument[]; audioFiles?: AudioFile[]; trackId?: Id; pathHint: string; startBeat?: Beats; name?: string; trackName?: string; audioFileId?: Id; segmentId?: Id; bpm?: number; gainDb?: number; compensateLatency?: boolean; inputLatencySamples?: number; outputLatencySamples?: number; manualLatencySamples?: number; bitDepth?: 16 | 24 | 32 }
  // EQ -------------------------------------------------------------------
  | { kind: "eq.setAutomation"; points: EqAutomationPoint[] }
  // Local AI training ------------------------------------------------------
  | { kind: "training.run"; task: "drums" | "instruments" | "midi"; jsonl: string; signalCount: number }
  // Misc -----------------------------------------------------------------
  | { kind: "ping" };

export type ResponseFor<R extends OutboundRequest> =
  R extends { kind: "project.list" }   ? { projects: Array<Pick<Project, "id" | "name" | "savedAt">> } :
  R extends { kind: "project.load" }   ? { project: Project | null } :
  R extends { kind: "project.saveFile" } ? { path: string; backupPath?: string; cleanupReport?: ProjectSidecarCleanupReport; integrityReport?: BeatProjectIntegrityReport; error?: string } :
  R extends { kind: "project.openFile" } ? { path: string; document?: BeatProjectDocument; missingAssets?: BeatProjectAsset[]; integrityReport?: BeatProjectIntegrityReport; error?: string } :
  R extends { kind: "project.recentList" } ? { projects: RecentProjectEntry[] } :
  R extends { kind: "project.recentRemove" } ? { ok: true } :
  R extends { kind: "project.revealFile" } ? { ok: boolean; missing?: boolean; error?: string } :
  R extends { kind: "project.inspectDocument" } ? { path?: string; missingAssets: BeatProjectAsset[]; integrityReport?: BeatProjectIntegrityReport; error?: string } :
  R extends { kind: "project.repairDocument" } ? { changed: boolean; document?: BeatProjectDocument; path?: string; missingAssets: BeatProjectAsset[]; integrityReport?: BeatProjectIntegrityReport; error?: string } :
  R extends { kind: "project.listBackups" } ? { backups: ProjectBackupEntry[]; error?: string } :
  R extends { kind: "project.restoreBackup" } ? { path: string; backupPath?: string; document?: BeatProjectDocument; missingAssets?: BeatProjectAsset[]; integrityReport?: BeatProjectIntegrityReport; error?: string } :
  R extends { kind: "project.relinkAsset" } ? { path: string; error?: string } :
  R extends { kind: "project.cleanupAssets" } ? { report: ProjectSidecarCleanupReport; error?: string } :
  R extends { kind: "project.exportWav" } ? { path: string; analysis?: AudioRenderAnalysis; error?: string } :
  R extends { kind: "project.exportTrackWav" } ? { path: string; analysis?: AudioRenderAnalysis; error?: string } :
  R extends { kind: "project.exportRangeWav" } ? { path: string; analysis?: AudioRenderAnalysis; error?: string } :
  R extends { kind: "project.bounceTrackWav" } ? { path: string; sourceTrackId?: Id; audioFile?: AudioFile; track?: Track; analysis?: AudioRenderAnalysis; error?: string } :
  R extends { kind: "project.exportWavAsync" } ? { started: boolean; job: ProjectExportJobStatus; error?: string } :
  R extends { kind: "project.exportTrackWavAsync" } ? { started: boolean; job: ProjectExportJobStatus; error?: string } :
  R extends { kind: "project.exportRangeWavAsync" } ? { started: boolean; job: ProjectExportJobStatus; error?: string } :
  R extends { kind: "project.exportCancel" } ? ProjectExportJobStatus :
  R extends { kind: "project.exportStatus" } ? ProjectExportJobStatus :
  R extends { kind: "instrument.list" }? { instruments: Instrument[] } :
  R extends { kind: "instrument.importDecent" } ? { preset: DecentSamplerImport | null } :
  R extends { kind: "instrument.renderPreview" } ? { analysis?: AudioRenderAnalysis; waveform?: AudioWaveformSummary | null; audioDataUrl?: string; durationBeats?: Beats; note?: number; velocity?: number; error?: string } :
  R extends { kind: "instrument.resynthesizeWavemap" } ? { wavemap?: WavemapDefinition; error?: string } :
  R extends { kind: "audio.import" }   ? { file: AudioFile | null } :
  R extends { kind: "audio.importMany" } ? { files: AudioFile[] } :
  R extends { kind: "audio.list" }     ? { files: AudioFile[] } :
  R extends { kind: "audio.delete" }   ? { deletedIds: Id[]; failedIds: Id[]; failedPaths: string[]; error?: string } :
  R extends { kind: "audio.reveal" }   ? { ok: boolean; error?: string } :
  R extends { kind: "audio.waveform" } ? { waveform: AudioWaveformSummary | null; cached?: boolean; error?: string } :
  R extends { kind: "audio.listDevices" } ? { snapshot: AudioDeviceSnapshot } :
  R extends { kind: "audio.selectInputDevice" } ? { ok: boolean; snapshot: AudioDeviceSnapshot; error?: string } :
  R extends { kind: "recording.plan" } ? { plan: RecordingSessionPlan | null; error?: string } :
  R extends { kind: "recording.prepare" } ? { ok: boolean; stats: RecordingCaptureStats; error?: string } :
  R extends { kind: "recording.start" } ? { stats: RecordingCaptureStats } :
  R extends { kind: "recording.stop" } ? { stats: RecordingCaptureStats } :
  R extends { kind: "recording.cancel" } ? { stats: RecordingCaptureStats } :
  R extends { kind: "recording.status" } ? { stats: RecordingCaptureStats } :
  R extends { kind: "recording.writeWav" } ? { path: string; stats: RecordingCaptureStats; analysis?: AudioRenderAnalysis; error?: string } :
  R extends { kind: "recording.commitTake" } ? { path?: string; trackId?: Id; audioFileId?: Id; segmentId?: Id; lengthBeats?: Beats; stats: RecordingCaptureStats; audioFile?: AudioFile; track?: Track; analysis?: AudioRenderAnalysis; error?: string } :
  R extends { kind: "training.run" }    ? { started: boolean; reason?: string } :
  R extends { kind: "app.ready" }       ? { ok: true } :
  R extends { kind: "ping" }           ? { pong: true; backendVersion: string } :
  { ok: true };

// ===== Inbound events (C++ → JS) ==========================================

export type InboundEvent =
  | { kind: "transport.positionChanged"; positionBeat: Beats }
  | { kind: "transport.playbackEnded" }
  | { kind: "engine.segmentTrigger"; segmentId: Id; repetition: number }
  | { kind: "engine.levelMeters"; tracks: Array<{ id: Id; rms: number; peak: number; leftRms?: number; rightRms?: number; leftPeak?: number; rightPeak?: number; rmsDbFS?: number; peakDbFS?: number; truePeakDbTP?: number; momentaryLufs?: number }> }
  | { kind: "analyzer.spectrum"; sequence: number; rms: number; peak: number; bands: number[] }
  | {
      kind: "engine.renderTiming";
      sequence: number;
      blockSamples: number;
      sampleRate: number;
      scheduleMs: number;
      synthMs: number;
      voiceMs: number;
      modulationMs: number;
      samplesMs: number;
      fxMs: number;
      filterFxMs: number;
      analyzerMs: number;
      copyMs: number;
      totalMs: number;
      loadPercent: number;
      activeSynthVoices: number;
      activeSampleVoices: number;
      activeAudioClipVoices: number;
      routeCount: number;
      automationEventCount: number;
      wavetableCacheHits: number;
      wavetableCacheMisses: number;
      wavetableCacheSize: number;
      voiceRenderBlocks: number;
      voiceRenderSamples: number;
      oscillatorSamples: number;
      wavetableVoiceSamples: number;
      aetherOscASamples: number;
      aetherOscBSamples: number;
      aetherSubSamples: number;
      aetherNoiseSamples: number;
      filterSamples: number;
      filterDriveSamples: number;
      filterCoefficientUpdates: number;
      filterCutoffUpdates: number;
      filterResonanceUpdates: number;
      modulationSamples: number;
      realtimeRampSamples: number;
      oscillatorRateCalculations: number;
      wavetableFrequencyUpdates: number;
      wavetablePositionUpdates: number;
      routeEffectSamples: number;
      routeFilterEffectSamples: number;
      routeNonlinearEffectSamples: number;
      routeDelayEffectSamples: number;
    }
  | { kind: "audio.deviceChanged"; deviceName: string; sampleRate: number }
  | (ProjectExportJobStatus & { kind: "project.exportProgress" })
  | { kind: "training.status"; task: "drums" | "instruments" | "midi"; status: "started" | "finished" | "failed"; signalCount: number; message?: string; exitCode?: number }
  | { kind: "native.menuCommand"; command: "newProject" | "openProject" | "saveProject" | "importAudio" | "exportWav" | "preferences" }
  | { kind: "native.openProjectFile"; path: string }
  | { kind: "log"; level: "info" | "warn" | "error"; message: string };

export type InboundListener = (event: InboundEvent) => void;
