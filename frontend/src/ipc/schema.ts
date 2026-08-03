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
  DecentSamplerUiBinding,
  DecentSamplerUiControl,
  EqAutomationPoint,
  Id,
  Instrument,
  ManagedSfzAssetConfig,
  ManagedGranularAssetConfig,
  MidiNote,
  InstrumentSet,
  PluginAdapter,
  Project,
  Track,
  WavemapDefinition,
} from "../state/types";
import type { BeatComponent, ComponentFolder } from "../state/components";

export interface BeatProjectDocument {
  schemaVersion: 1;
  savedAt: number;
  project: Project;
  instruments?: Instrument[];
  instrumentSets?: InstrumentSet[];
  audioFiles?: AudioFile[];
  components?: BeatComponent[];
  componentFolders?: ComponentFolder[];
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

export type StemSeparationKind = "drums" | "bass" | "vocals" | "other";

export interface StemSeparationResult {
  stem: StemSeparationKind;
  file: AudioFile;
}

export interface StemSeparationJobStatus {
  jobId?: string;
  active: boolean;
  finished: boolean;
  ok: boolean;
  cancelled: boolean;
  progress: number;
  stage: string;
  error: string;
  stems: StemSeparationResult[];
}

export type AudioTranscriptionProfile = "bass" | "vocals" | "other" | "piano" | "piano-recovery" | "multi-instrument";

export interface AudioTranscriptionNote {
  startSeconds: number;
  endSeconds: number;
  pitch: number;
  velocity: number;
  /** MuScriptor instrument group. Missing for single-instrument providers. */
  instrument?: string;
  isDrum?: boolean;
  /** Basic Pitch contour offsets in thirds of a semitone. */
  pitchBends: number[];
}

export interface AudioTranscriptionJobStatus {
  jobId?: string;
  active: boolean;
  finished: boolean;
  ok: boolean;
  cancelled: boolean;
  progress: number;
  stage: string;
  error: string;
  notes: AudioTranscriptionNote[];
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
  cancelled?: boolean;
  jobId?: string;
  type?: "project" | "track" | "range" | "stems";
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
  quality?: "standard" | "high";
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
  blocked: boolean;
  deletedPaths: string[];
  failedPaths: string[];
  diagnostics: Array<{ code: string; path: string; message: string }>;
}

export interface DecentSamplerImportSample {
  path: string;
  name: string;
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

export type { DecentSamplerUiBinding, DecentSamplerUiControl };

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

export interface ScoreOcrArtifacts {
  artifactDirectoryPath: string;
  musicXmlPath?: string;
  omrPath?: string;
  ocrLogPath?: string;
  warningCount: number;
  errorCount: number;
  exceptionCount: number;
}

export interface ScoreImportResponse {
  name?: string;
  dataBase64?: string;
  ocrEngine?: "audiveris" | "homr" | "hybrid";
  artifactDirectoryPath?: string;
  musicXmlPath?: string;
  omrPath?: string;
  ocrLogPath?: string;
  ocrWarningCount?: number;
  ocrErrorCount?: number;
  ocrExceptionCount?: number;
  pageScores?: Array<{ name: string; dataBase64: string; firstPage: number; lastPage: number; ocrEngine?: "audiveris" | "homr" }>;
  adaptiveRecovery?: boolean;
  error?: string;
}

// ===== Outbound (JS → C++) =================================================

export type OutboundRequest =
  | { kind: "app.shellReady" }
  | { kind: "app.startupStage"; stage: "instruments" | "components" | "audio"; durationMs: number; itemCount: number }
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
  | { kind: "project.duplicateFile"; path: string }
  | { kind: "project.chooseExportFolder"; pathHint?: string }
  | { kind: "project.inspectDocument"; document: BeatProjectDocument; projectPath?: string }
  | { kind: "project.repairDocument"; document: BeatProjectDocument; projectPath?: string; action: "rebuildAssetManifest" | "repairSegmentTrackIds" }
  | { kind: "project.listBackups"; projectPath: string }
  | { kind: "project.restoreBackup"; projectPath: string; backupPath: string }
  | { kind: "project.relinkAsset"; asset: Pick<BeatProjectAsset, "kind" | "name" | "path">; pathHint?: string }
  | { kind: "project.cleanupAssets"; projectPath: string; document: BeatProjectDocument }
  | { kind: "project.exportWav"; project: Project; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; includeTail?: boolean; options?: ProjectExportOptions }
  | { kind: "project.exportTrackWav"; project: Project; trackId: Id; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; includeTail?: boolean; options?: ProjectExportOptions }
  | { kind: "project.exportRangeWav"; project: Project; startBeat: Beats; endBeat: Beats; includeTail?: boolean; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; options?: ProjectExportOptions }
  | { kind: "project.bounceTrackWav"; project: Project; trackId: Id; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; includeTail?: boolean; options?: ProjectExportOptions }
  | { kind: "project.exportWavAsync"; project: Project; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; includeTail?: boolean; options?: ProjectExportOptions }
  | { kind: "project.exportTrackWavAsync"; project: Project; trackId: Id; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; includeTail?: boolean; options?: ProjectExportOptions }
  | { kind: "project.exportRangeWavAsync"; project: Project; startBeat: Beats; endBeat: Beats; includeTail?: boolean; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; options?: ProjectExportOptions }
  | { kind: "project.exportAllTrackWavsAsync"; project: Project; instruments?: Instrument[]; audioFiles?: AudioFile[]; pathHint?: string; includeTail?: boolean; options?: ProjectExportOptions }
  | { kind: "project.exportCancel" }
  | { kind: "project.exportStatus" }
  // Tracks / segments — the audio engine reflects these into its model -----
  | { kind: "engine.applyProject"; project: Project; instruments?: Instrument[]; audioFiles?: AudioFile[] }
  | { kind: "engine.updateSegment"; segmentId: Id; patch: Partial<{ startBeat: Beats; lengthBeats: Beats; repeats: number; muted: boolean }> }
  | { kind: "engine.setParameter"; instrumentId: Id; parameterId: string; value: number; sampleOffset?: number; rampSamples?: number }
  | { kind: "engine.previewMidiNote"; trackId: Id; instrumentId: Id; pitch: number; velocity: number; delaySeconds?: number; durationSeconds?: number; gainDb?: number; note?: MidiNote; glideTargetPitch?: number; glideMs?: number }
  | { kind: "engine.stopMidiPreview"; trackId: Id }
  | { kind: "engine.previewAudioSegment"; trackId: Id; audioFileId: Id; sourceStartBeat?: Beats; positionBeat?: Beats; lengthBeats: Beats; fadeInBeats?: Beats; fadeOutBeats?: Beats; gainDb?: number }
  | { kind: "engine.stopAudioPreview"; trackId: Id }
  // Instruments ------------------------------------------------------------
  | { kind: "instrument.save"; instrument: Instrument }
  | { kind: "instrument.delete"; id: Id }
  | { kind: "instrument.list" }
  | { kind: "instrument.importDecent"; pathHint?: string }
  | { kind: "instrument.importSfz"; projectPath: string; pathHint?: string }
  | { kind: "instrument.importGranular"; projectPath: string; pathHint?: string }
  | { kind: "instrument.renderPreview"; instrument: Instrument; note?: number; velocity?: number; bpm?: number; durationBeats?: Beats; bucketCount?: number; includeAudio?: boolean }
  | { kind: "instrument.resynthesizeWavemap"; audioFile: Pick<AudioFile, "id" | "name" | "path" | "sampleRate">; wavemapId?: string; name?: string; selection?: WavemapResynthesisSelection }
  // Audio files -----------------------------------------------------------
  | { kind: "audio.import"; pathHint?: string } // opens file picker
  | { kind: "audio.importMany"; pathHint?: string } // opens multi-file picker
  | { kind: "audio.list"; refreshMetadata?: boolean }
  | { kind: "audio.delete"; ids: Id[]; deleteFiles?: boolean }
  | { kind: "audio.reveal"; path: string }
  | { kind: "audio.waveform"; path: string; bucketCount?: number }
  | { kind: "audio.previewData"; path: string }
  | { kind: "audio.stemsStart"; path: string }
  | { kind: "audio.stemsStatus" }
  | { kind: "audio.stemsCancel" }
  | { kind: "audio.transcriptionStart"; path: string; profile: AudioTranscriptionProfile }
  | { kind: "audio.transcriptionStatus" }
  | { kind: "audio.transcriptionCancel" }
  | { kind: "audio.listDevices" }
  | { kind: "audio.selectInputDevice"; typeName?: string; deviceName: string; inputChannelCount?: number }
  | { kind: "audio.selectOutputDevice"; typeName?: string; deviceName: string }
  // Notated scores --------------------------------------------------------
  | { kind: "score.import"; pathHint?: string }
  | { kind: "score.importLibrary"; pathHint?: string }
  | { kind: "score.revealArtifacts"; path: string }
  | { kind: "score.openOcrReview"; path: string }
  // Recording -------------------------------------------------------------
  | { kind: "recording.plan"; project: Project; instruments?: Instrument[]; audioFiles?: AudioFile[]; trackId?: Id; startBeat: Beats; countInBeats?: Beats; maxDurationSeconds: number; inputChannels?: number; sampleRate?: number; bpm?: number; requireRecordArm?: boolean }
  | { kind: "recording.prepare"; maxDurationSeconds: number; inputChannels?: number }
  | { kind: "recording.start" }
  | { kind: "recording.stop" }
  | { kind: "recording.cancel" }
  | { kind: "recording.status" }
  | { kind: "recording.writeWav"; pathHint: string; bitDepth?: 16 | 24 | 32 }
  | { kind: "recording.commitTake"; project: Project; instruments?: Instrument[]; audioFiles?: AudioFile[]; trackId?: Id; pathHint?: string; startBeat?: Beats; name?: string; trackName?: string; audioFileId?: Id; segmentId?: Id; bpm?: number; gainDb?: number; compensateLatency?: boolean; inputLatencySamples?: number; outputLatencySamples?: number; manualLatencySamples?: number; bitDepth?: 16 | 24 | 32 }
  // EQ -------------------------------------------------------------------
  | { kind: "eq.setAutomation"; points: EqAutomationPoint[] }
  // Misc -----------------------------------------------------------------
  | { kind: "diagnostics.readLog"; maxLines?: number }
  | { kind: "diagnostics.clearLog" }
  | { kind: "diagnostics.saveLog"; text: string }
  | { kind: "diagnostics.write"; category: string; message: string }
  | { kind: "ping" };

export type ResponseFor<R extends OutboundRequest> =
  R extends { kind: "engine.previewMidiNote" } ? boolean :
  R extends { kind: "engine.previewAudioSegment" } ? boolean :
  R extends { kind: "project.list" }   ? { projects: Array<Pick<Project, "id" | "name" | "savedAt">> } :
  R extends { kind: "project.load" }   ? { project: Project | null } :
  R extends { kind: "project.saveFile" } ? { path: string; backupPath?: string; cleanupReport?: ProjectSidecarCleanupReport; integrityReport?: BeatProjectIntegrityReport; error?: string } :
  R extends { kind: "project.openFile" } ? { path: string; document?: BeatProjectDocument; missingAssets?: BeatProjectAsset[]; integrityReport?: BeatProjectIntegrityReport; error?: string } :
  R extends { kind: "project.recentList" } ? { projects: RecentProjectEntry[] } :
  R extends { kind: "project.recentRemove" } ? { ok: true } :
  R extends { kind: "project.revealFile" } ? { ok: boolean; missing?: boolean; error?: string } :
  R extends { kind: "project.duplicateFile" } ? { ok: boolean; missing?: boolean; project?: RecentProjectEntry; error?: string } :
  R extends { kind: "project.chooseExportFolder" } ? { path: string; cancelled?: boolean; error?: string } :
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
  R extends { kind: "project.exportAllTrackWavsAsync" } ? { started: boolean; job: ProjectExportJobStatus; error?: string } :
  R extends { kind: "project.exportCancel" } ? ProjectExportJobStatus :
  R extends { kind: "project.exportStatus" } ? ProjectExportJobStatus :
  R extends { kind: "instrument.list" }? { instruments: Instrument[] } :
  R extends { kind: "instrument.importDecent" } ? { preset: DecentSamplerImport | null } :
  R extends { kind: "instrument.importSfz" } ? { managedSfz?: ManagedSfzAssetConfig; diagnostics?: Array<{ severity: "warning" | "error"; code: string; message: string; line: number; column: number }>; error?: string } :
  R extends { kind: "instrument.importGranular" } ? { managedGranular?: ManagedGranularAssetConfig; error?: string } :
  R extends { kind: "instrument.renderPreview" } ? { analysis?: AudioRenderAnalysis; waveform?: AudioWaveformSummary | null; audioDataUrl?: string; durationBeats?: Beats; note?: number; velocity?: number; error?: string } :
  R extends { kind: "instrument.resynthesizeWavemap" } ? { wavemap?: WavemapDefinition; error?: string } :
  R extends { kind: "audio.import" }   ? { file: AudioFile | null } :
  R extends { kind: "audio.importMany" } ? { files: AudioFile[] } :
  R extends { kind: "audio.list" }     ? { files: AudioFile[] } :
  R extends { kind: "audio.delete" }   ? { deletedIds: Id[]; failedIds: Id[]; failedPaths: string[]; error?: string } :
  R extends { kind: "audio.reveal" }   ? { ok: boolean; error?: string } :
  R extends { kind: "audio.waveform" } ? { waveform: AudioWaveformSummary | null; cached?: boolean; error?: string } :
  R extends { kind: "audio.previewData" } ? { audioDataUrl?: string; error?: string } :
  R extends { kind: "audio.stemsStart" } ? StemSeparationJobStatus :
  R extends { kind: "audio.stemsStatus" } ? StemSeparationJobStatus :
  R extends { kind: "audio.stemsCancel" } ? StemSeparationJobStatus :
  R extends { kind: "audio.transcriptionStart" } ? AudioTranscriptionJobStatus :
  R extends { kind: "audio.transcriptionStatus" } ? AudioTranscriptionJobStatus :
  R extends { kind: "audio.transcriptionCancel" } ? AudioTranscriptionJobStatus :
  R extends { kind: "audio.listDevices" } ? { snapshot: AudioDeviceSnapshot } :
  R extends { kind: "audio.selectInputDevice" } ? { ok: boolean; snapshot: AudioDeviceSnapshot; error?: string } :
  R extends { kind: "audio.selectOutputDevice" } ? { ok: boolean; snapshot: AudioDeviceSnapshot; error?: string } :
  R extends { kind: "score.import" } ? ScoreImportResponse :
  R extends { kind: "score.importLibrary" } ? { scores: ScoreImportResponse[] } :
  R extends { kind: "score.revealArtifacts" } ? { ok: boolean; error?: string } :
  R extends { kind: "score.openOcrReview" } ? { ok: boolean; error?: string } :
  R extends { kind: "recording.plan" } ? { plan: RecordingSessionPlan | null; error?: string } :
  R extends { kind: "recording.prepare" } ? { ok: boolean; stats: RecordingCaptureStats; error?: string } :
  R extends { kind: "recording.start" } ? { stats: RecordingCaptureStats } :
  R extends { kind: "recording.stop" } ? { stats: RecordingCaptureStats } :
  R extends { kind: "recording.cancel" } ? { stats: RecordingCaptureStats } :
  R extends { kind: "recording.status" } ? { stats: RecordingCaptureStats } :
  R extends { kind: "recording.writeWav" } ? { path: string; stats: RecordingCaptureStats; analysis?: AudioRenderAnalysis; error?: string } :
  R extends { kind: "recording.commitTake" } ? { path?: string; trackId?: Id; audioFileId?: Id; segmentId?: Id; lengthBeats?: Beats; stats: RecordingCaptureStats; audioFile?: AudioFile; track?: Track; analysis?: AudioRenderAnalysis; error?: string } :
  R extends { kind: "diagnostics.readLog" } ? { path: string; text: string; lineCount: number; truncated: boolean } :
  R extends { kind: "diagnostics.clearLog" } ? { ok: boolean; path: string; error?: string } :
  R extends { kind: "diagnostics.saveLog" } ? { path: string; cancelled?: boolean; error?: string } :
  R extends { kind: "diagnostics.write" } ? { ok: true } :
  R extends { kind: "app.shellReady" }  ? { ok: true } :
  R extends { kind: "app.startupStage" } ? { ok: true } :
  R extends { kind: "app.ready" }       ? { ok: true } :
  R extends { kind: "ping" }           ? { pong: true; backendVersion: string } :
  { ok: true };

// ===== Inbound events (C++ → JS) ==========================================

export type InboundEvent =
  | { kind: "transport.positionChanged"; positionBeat: Beats }
  | { kind: "transport.playbackEnded" }
  | { kind: "transport.safetyMuted"; reason: "realtime-deadline-overload"; deadlineOverruns: number }
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
      hottestRouteIndex: number;
      hottestRouteMs: number;
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
      voiceNonlinearSamples: number;
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
      realtimeQueueAccepted: number;
      realtimeQueueRejected: number;
      blockEventOverflows: number;
      deadlineOverruns: number;
      callbackSafetyViolations: number;
      modulationWorkBudgetOverruns: number;
      nonlinearWorkBudgetOverruns: number;
      pendingNoteOffOverflows: number;
      overloadSafetyMutes: number;
      callbackLockMisses: number;
    }
  | { kind: "audio.deviceChanged"; deviceName: string; sampleRate: number }
  | {
      kind: "synth.expressionActivity";
      instrumentId: Id;
      source: "midi";
      active: boolean;
      activeNotes: number;
      pitchBendSemitones: number;
      velocity: number;
      keytrack: number;
      modWheel: number;
      pressure: number;
      timbre: number;
    }
  | (ProjectExportJobStatus & { kind: "project.exportProgress" })
  | { kind: "native.menuCommand"; command: "home" | "whatsNew" | "userGuide" | "newProject" | "openProject" | "saveProject" | "importAudio" | "exportWav" | "preferences" | "undo" | "redo" | "songInfo" }
  | { kind: "native.openProjectFile"; path: string }
  | { kind: "log"; level: "info" | "warn" | "error"; message: string };

export type InboundListener = (event: InboundEvent) => void;
