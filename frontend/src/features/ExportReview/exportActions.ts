import { isNative, send } from "../../ipc/bridge";
import { buildCurrentBeatDocument } from "../../persistence/beatDocument";
import { useAudioFileStore, useDocumentStore, useInstrumentStore, useProjectStore, useTransportStore, useUiStore } from "../../state/store";
import type { Id, Track } from "../../state/types";
import {
  exportPresetById,
  exportValidationBlocksExport,
  exportValidationStatusFromReport,
  failedExportValidationStatus,
  normalizeExportOptions,
  projectFolderFromFilePath,
  useExportStore,
  type ExportPresetTarget,
  type ExportValidationStatus,
} from "../../state/exportStore";

export async function runProjectExport(mode: ExportPresetTarget = "project") {
  const exportState = useExportStore.getState();
  const exportPreset = exportPresetById(exportState.selectedPresetId, mode);
  const options = normalizeExportOptions(exportPreset.options);
  const destinationFolder = exportState.exportDestinationFolder
    || projectFolderFromFilePath(useDocumentStore.getState().currentFilePath)
    || "";
  const pathHint = exportPathHint(destinationFolder, mode);
  const validation = await validateCurrentProjectBeforeExport();
  if (exportValidationBlocksExport(validation)) throw new Error(validation.message);
  const request = {
    project: useProjectStore.getState().project,
    instruments: useInstrumentStore.getState().instruments,
    audioFiles: useAudioFileStore.getState().files,
    pathHint,
    includeTail: true,
    options,
  };
  const renderableTracks = request.project.tracks.filter(isRenderableStemTrack);
  const range = useTransportStore.getState().loopRange;
  const selectedTrackIds = useUiStore.getState().selectedTrackIds;

  if (isNative()) {
    if (mode === "range") {
      if (range.endBeat <= range.startBeat) throw new Error("Set a review loop range before exporting a range.");
      const result = await send({
        kind: "project.exportRangeWavAsync",
        ...request,
        startBeat: range.startBeat,
        endBeat: range.endBeat,
      });
      useExportStore.getState().setJob(result.job);
      if (result.error) throw new Error(result.error);
      return;
    }
    if (mode === "track") {
      if (selectedTrackIds.length !== 1) throw new Error("Select exactly one track before exporting a stem.");
      const selectedTrack = request.project.tracks.find((track) => track.id === selectedTrackIds[0]);
      if (!selectedTrack || !isRenderableStemTrack(selectedTrack)) throw new Error("Group tracks cannot be exported as individual stems yet.");
      const result = await send({
        kind: "project.exportTrackWavAsync",
        ...request,
        trackId: selectedTrackIds[0],
      });
      useExportStore.getState().setJob(result.job);
      if (result.error) throw new Error(result.error);
      return;
    }
    if (mode === "stems") {
      if (renderableTracks.length === 0) throw new Error("Add at least one renderable track before exporting all stems.");
      const result = await send({
        kind: "project.exportAllTrackWavsAsync",
        ...request,
      });
      useExportStore.getState().setJob(result.job);
      if (result.error) throw new Error(result.error);
      return;
    }
    const result = await send({
      kind: "project.exportWavAsync",
      ...request,
    });
    useExportStore.getState().setJob(result.job);
    if (result.error) throw new Error(result.error);
    return;
  }

  if (mode === "range") {
    if (range.endBeat <= range.startBeat) throw new Error("Set a review loop range before exporting a range.");
    const result = await send({
      kind: "project.exportRangeWav",
      ...request,
      startBeat: range.startBeat,
      endBeat: range.endBeat,
    });
    if (result.error) throw new Error(result.error);
    recordCompletedExport(result.path, "range");
    return;
  }
  if (mode === "track") {
    if (selectedTrackIds.length !== 1) throw new Error("Select exactly one track before exporting a stem.");
    const selectedTrack = request.project.tracks.find((track) => track.id === selectedTrackIds[0]);
    if (!selectedTrack || !isRenderableStemTrack(selectedTrack)) throw new Error("Group tracks cannot be exported as individual stems yet.");
    const result = await send({
      kind: "project.exportTrackWav",
      ...request,
      trackId: selectedTrackIds[0],
    });
    if (result.error) throw new Error(result.error);
    recordCompletedExport(result.path, "track");
    return;
  }
  if (mode === "stems") {
    if (renderableTracks.length === 0) throw new Error("Add at least one renderable track before exporting all stems.");
    for (const track of renderableTracks) {
      const result = await send({
        kind: "project.exportTrackWav",
        ...request,
        trackId: track.id,
        pathHint: stemExportPathHint(destinationFolder, track.name),
      });
      if (result.error) throw new Error(result.error);
      recordCompletedExport(result.path, "track");
    }
    return;
  }

  const result = await send({
    kind: "project.exportWav",
    ...request,
  });
  if (result.error) throw new Error(result.error);
  recordCompletedExport(result.path, mode);
}

export async function exportTrackAsWav(trackId: Id) {
  const exportState = useExportStore.getState();
  const project = useProjectStore.getState().project;
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new Error("Track was not found.");
  if (!isRenderableStemTrack(track)) throw new Error("Group tracks cannot be exported as individual WAV files yet.");

  const validation = await validateCurrentProjectBeforeExport();
  if (exportValidationBlocksExport(validation)) throw new Error(validation.message);

  const destinationFolder = exportState.exportDestinationFolder
    || projectFolderFromFilePath(useDocumentStore.getState().currentFilePath)
    || "";
  const preset = exportPresetById("selected-stem", "track");
  const request = {
    project,
    instruments: useInstrumentStore.getState().instruments,
    audioFiles: useAudioFileStore.getState().files,
    trackId,
    pathHint: stemExportPathHint(destinationFolder, track.name),
    includeTail: true,
    options: normalizeExportOptions(preset.options),
  };

  if (isNative()) {
    const result = await send({ kind: "project.exportTrackWavAsync", ...request });
    useExportStore.getState().setJob(result.job);
    if (result.error) throw new Error(result.error);
    return;
  }

  const result = await send({ kind: "project.exportTrackWav", ...request });
  if (result.error) throw new Error(result.error);
  recordCompletedExport(result.path, "track");
}

export async function bounceTrackInPlace(trackId?: Id) {
  const uiState = useUiStore.getState();
  const selectedTrackIds = trackId ? [trackId] : uiState.selectedTrackIds;
  if (selectedTrackIds.length !== 1) throw new Error("Select exactly one track before bouncing in place.");

  const projectState = useProjectStore.getState();
  const project = projectState.project;
  const sourceTrack = project.tracks.find((track) => track.id === selectedTrackIds[0]);
  if (!sourceTrack) throw new Error("Selected track was not found.");
  if (sourceTrack.kind === "group") throw new Error("Group track bounce is not supported yet.");

  const validation = await validateCurrentProjectBeforeExport();
  if (exportValidationBlocksExport(validation)) throw new Error(validation.message);
  if (!isNative()) throw new Error("Bounce in place is available in the native app.");

  const preset = exportPresetById("selected-stem", "track");
  const result = await send({
    kind: "project.bounceTrackWav",
    project,
    instruments: useInstrumentStore.getState().instruments,
    audioFiles: useAudioFileStore.getState().files,
    trackId: sourceTrack.id,
    includeTail: true,
    options: normalizeExportOptions(preset.options),
  });
  if (result.error) throw new Error(result.error);
  if (!result.track || !result.audioFile) throw new Error("Bounce did not return a bounced track.");

  const nextProject = structuredClone(project);
  const nextSource = nextProject.tracks.find((track) => track.id === sourceTrack.id);
  if (nextSource) {
    nextSource.mute = true;
    nextSource.solo = false;
  }
  const bouncedTrack = structuredClone(result.track);
  bouncedTrack.freezeSource = {
    sourceTrackId: sourceTrack.id,
    sourceTrackName: sourceTrack.name,
    audioFileId: result.audioFile.id,
    segmentId: bouncedTrack.segments[0]?.id,
    createdAt: Date.now(),
    sourceMute: sourceTrack.mute,
    sourceSolo: sourceTrack.solo,
    sourceParentTrackId: sourceTrack.parentTrackId,
  };
  nextProject.tracks.push(bouncedTrack);
  useAudioFileStore.getState().addFile(result.audioFile);
  projectState.loadProject(nextProject);
  useUiStore.getState().setSelectedTracks([bouncedTrack.id]);
  recordCompletedExport(result.path, "track");
  return result;
}

export function unfreezeBouncedTrack(trackId: Id) {
  const projectState = useProjectStore.getState();
  const project = projectState.project;
  const bouncedTrack = project.tracks.find((track) => track.id === trackId);
  const freezeSource = bouncedTrack?.freezeSource;
  if (!bouncedTrack || !freezeSource) throw new Error("Selected track is not a frozen bounce.");

  const sourceTrack = project.tracks.find((track) => track.id === freezeSource.sourceTrackId);
  if (!sourceTrack) throw new Error("Original source track is missing.");

  const nextProject = structuredClone(project);
  const nextSource = nextProject.tracks.find((track) => track.id === freezeSource.sourceTrackId);
  if (nextSource) {
    nextSource.mute = freezeSource.sourceMute;
    nextSource.solo = freezeSource.sourceSolo;
    nextSource.parentTrackId = freezeSource.sourceParentTrackId;
  }
  nextProject.tracks = nextProject.tracks.filter((track) => track.id !== bouncedTrack.id);
  projectState.loadProject(nextProject);
  useAudioFileStore.getState().removeFile(freezeSource.audioFileId);
  useUiStore.getState().setSelectedTracks([freezeSource.sourceTrackId]);
}

export async function validateCurrentProjectBeforeExport(): Promise<ExportValidationStatus> {
  const exportStore = useExportStore.getState();
  const checking: ExportValidationStatus = {
    state: "checking",
    message: "Checking Project Health before export.",
    errorCount: 0,
    warningCount: 0,
    missingAssetCount: 0,
    checkedAt: Date.now(),
  };
  exportStore.setValidation(checking);
  try {
    const documentStore = useDocumentStore.getState();
    const result = await send({
      kind: "project.inspectDocument",
      projectPath: documentStore.currentFilePath ?? undefined,
      document: buildCurrentBeatDocument(),
    });
    if (result.error) throw new Error(result.error);
    documentStore.setMissingAssets(result.missingAssets ?? []);
    documentStore.setIntegrityReport(result.integrityReport ?? null);
    const status = exportValidationStatusFromReport(result.integrityReport, result.missingAssets ?? []);
    useExportStore.getState().setValidation(status);
    return status;
  } catch (error) {
    const status = failedExportValidationStatus(error instanceof Error ? error.message : "Project Health validation failed.");
    useExportStore.getState().setValidation(status);
    return status;
  }
}

export async function revealExportDestination(path: string): Promise<void> {
  if (!path.trim()) throw new Error("No export destination is available to reveal.");
  if (!isNative()) throw new Error("View in Folder is only available in the native app.");
  const result = await send({ kind: "project.revealFile", path });
  if (!result.ok) throw new Error(result.error || "Could not reveal this export destination.");
}

function isRenderableStemTrack(track: Track): boolean {
  return track.kind !== "group";
}

function safeStemFileName(name: string): string {
  const clean = name.trim().replace(/[^\w .-]+/g, "-").replace(/\s+/g, " ");
  return clean || "Track Stem";
}

function recordCompletedExport(path: string, type: "project" | "track" | "range") {
  if (!path.trim()) return;
  useExportStore.getState().setJob({
    active: false,
    finished: true,
    ok: true,
    type,
    path,
    progress: 1,
  });
}

function exportPathHint(folder: string, mode: ExportPresetTarget): string | undefined {
  const cleanFolder = folder.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!cleanFolder) return undefined;
  if (mode === "stems") return cleanFolder;
  const fileName = mode === "range"
    ? "Beat Range Export.wav"
    : mode === "track"
      ? "Beat Track Export.wav"
      : "Beat Export.wav";
  return `${cleanFolder}/${fileName}`;
}

function stemExportPathHint(folder: string, trackName: string): string {
  const cleanFolder = folder.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  const fileName = `${safeStemFileName(trackName)}.wav`;
  return cleanFolder ? `${cleanFolder}/${fileName}` : fileName;
}
