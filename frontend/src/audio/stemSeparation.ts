import { createSignal } from "solid-js";
import { send, isNative } from "../ipc/bridge";
import type { StemSeparationJobStatus, StemSeparationKind } from "../ipc/schema";
import {
  runProjectHistoryGroup,
  useAudioFileStore,
  useProjectStore,
  useUiStore,
} from "../state/store";
import type { Id, Segment } from "../state/types";
import { appAlert } from "../solid-ui";

export interface StemSeparationUiState {
  segmentId: Id;
  jobId?: string;
  progress: number;
  stage: string;
}

const [stemSeparationState, setStemSeparationState] = createSignal<StemSeparationUiState | null>(null);

export { stemSeparationState };

const STEM_LABELS: Record<StemSeparationKind, string> = {
  drums: "Drums",
  bass: "Bass",
  vocals: "Vocals",
  other: "Other",
};

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function currentSegment(segmentId: Id): Segment | undefined {
  return useProjectStore.getState().project.tracks
    .flatMap((track) => track.segments)
    .find((segment) => segment.id === segmentId);
}

function sourceDisplayName(segment: Segment, audioFileName: string) {
  const clipName = segment.name?.trim();
  if (clipName) return clipName;
  return audioFileName.replace(/\.[^.]+$/, "").trim() || "Audio";
}

function installStemTracks(segmentId: Id, result: StemSeparationJobStatus) {
  const projectStore = useProjectStore.getState();
  const source = currentSegment(segmentId);
  if (!source || source.payload.kind !== "audio")
    throw new Error("The source audio clip is no longer available.");
  const sourcePayload = source.payload;
  if (result.stems.length !== 4)
    throw new Error("Stem separation did not return all four expected stems.");

  const sourceFile = useAudioFileStore.getState().files.find((file) => file.id === sourcePayload.audioFileId);
  const baseName = sourceDisplayName(source, sourceFile?.name ?? "Audio");
  for (const { file } of result.stems)
    useAudioFileStore.getState().addFile(file);

  runProjectHistoryGroup(() => {
    const before = projectStore.project.tracks.map((track) => track.id);
    const sourceTrackIndex = before.indexOf(source.trackId);
    if (sourceTrackIndex < 0)
      throw new Error("The source track is no longer available.");

    const createdTrackIds: Id[] = [];
    const createdSegmentIds: Id[] = [];
    for (const { stem, file } of result.stems) {
      const label = STEM_LABELS[stem];
      const trackId = projectStore.addTrack({
        name: `${baseName} · ${label}`,
        kind: "audio",
      });
      const stemSegmentId = projectStore.addSegment(trackId, {
        name: label,
        stemKind: stem,
        startBeat: source.startBeat,
        lengthBeats: source.lengthBeats,
        sourceStartBeat: source.sourceStartBeat,
        fadeInBeats: source.fadeInBeats,
        fadeOutBeats: source.fadeOutBeats,
        repeats: source.repeats,
        layer: 0,
        muted: false,
        payload: {
          kind: "audio",
          audioFileId: file.id,
          gainDb: sourcePayload.gainDb,
        },
      });
      createdTrackIds.push(trackId);
      createdSegmentIds.push(stemSegmentId);
    }

    projectStore.applySegmentEditCommand({
      kind: "group",
      segmentIds: createdSegmentIds,
      groupId: `stems_${crypto.randomUUID()}`,
    });
    projectStore.updateSegment(source.id, { muted: true });

    const remaining = useProjectStore.getState().project.tracks
      .map((track) => track.id)
      .filter((trackId) => !createdTrackIds.includes(trackId));
    remaining.splice(sourceTrackIndex + 1, 0, ...createdTrackIds);
    projectStore.reorderTracks(remaining);
  });
}

export async function separateSegmentIntoStems(segmentId: Id) {
  if (stemSeparationState()) {
    await appAlert("Another stem-separation job is already running.", "Separate into Stems");
    return;
  }
  if (!isNative()) {
    await appAlert("Stem separation is available in the native Beat app.", "Separate into Stems");
    return;
  }

  const source = currentSegment(segmentId);
  if (!source || source.payload.kind !== "audio") return;
  const sourcePayload = source.payload;
  const audioFile = useAudioFileStore.getState().files.find((file) => file.id === sourcePayload.audioFileId);
  if (!audioFile?.path) {
    await appAlert("The source audio file is missing.", "Separate into Stems");
    return;
  }

  try {
    setStemSeparationState({ segmentId, progress: 0, stage: "Preparing stem separation" });
    let status = await send({ kind: "audio.stemsStart", path: audioFile.path });
    if (!status.active && !status.ok)
      throw new Error(status.error || "Stem separation could not start.");

    setStemSeparationState({
      segmentId,
      jobId: status.jobId,
      progress: status.progress,
      stage: status.stage,
    });

    while (status.active) {
      await delay(300);
      status = await send({ kind: "audio.stemsStatus" });
      setStemSeparationState({
        segmentId,
        jobId: status.jobId,
        progress: status.progress,
        stage: status.stage,
      });
    }

    if (status.cancelled) return;
    if (!status.ok)
      throw new Error(status.error || "Stem separation failed.");

    installStemTracks(segmentId, status);
    await appAlert("Created linked Drums, Bass, Vocals, and Other tracks. The original clip was muted and kept in place.", "Stem Separation Complete");
  } catch (error) {
    await appAlert(error instanceof Error ? error.message : "Stem separation failed.", "Separate into Stems");
  } finally {
    setStemSeparationState(null);
  }
}

export async function cancelStemSeparation() {
  const active = stemSeparationState();
  if (!active) return;
  setStemSeparationState({ ...active, stage: "Cancelling stem separation" });
  await send({ kind: "audio.stemsCancel" });
}

export function unlinkStemGroup(segment: Segment) {
  if (!segment.groupId) return;
  useProjectStore.getState().applySegmentEditCommand({ kind: "ungroup", groupIds: [segment.groupId] });
  useUiStore.getState().setSelectedSegments([segment.id]);
  useUiStore.getState().setSelectedTracks([]);
}
