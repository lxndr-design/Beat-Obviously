import { createSignal } from "solid-js";
import { isNative, send } from "../ipc/bridge";
import type {
  AudioTranscriptionJobStatus,
  AudioTranscriptionProfile,
} from "../ipc/schema";
import {
  runProjectHistoryGroup,
  useAudioFileStore,
  useInstrumentStore,
  useProjectStore,
  useUiStore,
} from "../state/store";
import type { AudioStemKind, Id, Segment } from "../state/types";
import { appAlert } from "../solid-ui";
import { stemSeparationState } from "./stemSeparation";
import { basicPitchNotesToBeatNotes } from "./audioToMidiMapping";

export { basicPitchNotesToBeatNotes } from "./audioToMidiMapping";

export interface AudioToMidiUiState {
  segmentId: Id;
  jobId?: string;
  progress: number;
  stage: string;
}

const [audioToMidiState, setAudioToMidiState] = createSignal<AudioToMidiUiState | null>(null);

export { audioToMidiState };

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function currentSegment(segmentId: Id): Segment | undefined {
  return useProjectStore.getState().project.tracks
    .flatMap((track) => track.segments)
    .find((segment) => segment.id === segmentId);
}

function transcriptionProfile(stemKind: AudioStemKind | undefined): AudioTranscriptionProfile | null {
  return stemKind === "bass" || stemKind === "vocals" || stemKind === "other"
    ? stemKind
    : null;
}

function sourceDisplayName(segment: Segment) {
  const clipName = segment.name?.trim();
  if (clipName) return clipName;
  const track = useProjectStore.getState().project.tracks.find((candidate) => candidate.id === segment.trackId);
  return track?.name.trim() || "Stem";
}

function installMidiTrack(segmentId: Id, result: AudioTranscriptionJobStatus) {
  const projectStore = useProjectStore.getState();
  const source = currentSegment(segmentId);
  if (!source || source.payload.kind !== "audio")
    throw new Error("The source stem is no longer available.");

  const notes = basicPitchNotesToBeatNotes(result.notes, projectStore.project.bpm);
  if (notes.length === 0) return null;

  let trackId = "";
  let midiSegmentId = "";
  runProjectHistoryGroup(() => {
    const orderedBefore = projectStore.project.tracks.map((track) => track.id);
    const sourceTrackIndex = orderedBefore.indexOf(source.trackId);
    if (sourceTrackIndex < 0)
      throw new Error("The source stem track is no longer available.");

    const label = sourceDisplayName(source);
    const playbackInstrument = useInstrumentStore.getState().instruments.find(
      (candidate) => candidate.name.toLowerCase() === "lead saw",
    );
    trackId = projectStore.addTrack({
      name: `${label} · MIDI`,
      kind: "midi",
      instrumentId: playbackInstrument?.id,
    });
    midiSegmentId = projectStore.addSegment(trackId, {
      name: `${label} MIDI`,
      startBeat: source.startBeat,
      lengthBeats: source.lengthBeats,
      sourceStartBeat: source.sourceStartBeat,
      repeats: source.repeats,
      layer: 0,
      muted: false,
      payload: {
        kind: "midi",
        notes,
        gainDb: 0,
      },
    });

    const orderedAfter = useProjectStore.getState().project.tracks
      .map((track) => track.id)
      .filter((candidate) => candidate !== trackId);
    orderedAfter.splice(sourceTrackIndex + 1, 0, trackId);
    projectStore.reorderTracks(orderedAfter);
  });

  useUiStore.getState().setSelectedSegments([midiSegmentId]);
  useUiStore.getState().setSelectedTracks([trackId]);
  return { trackId, midiSegmentId, noteCount: notes.length };
}

export async function convertStemToMidi(segmentId: Id) {
  if (audioToMidiState()) {
    await appAlert("Another audio-to-MIDI job is already running.", "Convert Stem to MIDI");
    return;
  }
  if (stemSeparationState()) {
    await appAlert("Wait for stem separation to finish before converting a stem to MIDI.", "Convert Stem to MIDI");
    return;
  }
  if (!isNative()) {
    await appAlert("Audio-to-MIDI is available in the native Beat app.", "Convert Stem to MIDI");
    return;
  }

  const source = currentSegment(segmentId);
  if (!source || source.payload.kind !== "audio") return;
  const sourcePayload = source.payload;
  const profile = transcriptionProfile(source.stemKind);
  if (!profile) {
    const message = source.stemKind === "drums"
      ? "Drum transcription needs a separate model and is not included in this first version."
      : "Convert to MIDI is currently available for separated Bass, Vocals, and Other stems.";
    await appAlert(message, "Convert Stem to MIDI");
    return;
  }

  const audioFile = useAudioFileStore.getState().files.find((file) => file.id === sourcePayload.audioFileId);
  if (!audioFile?.path) {
    await appAlert("The source stem audio file is missing.", "Convert Stem to MIDI");
    return;
  }

  try {
    setAudioToMidiState({ segmentId, progress: 0, stage: "Preparing Spotify Basic Pitch" });
    let status = await send({
      kind: "audio.transcriptionStart",
      path: audioFile.path,
      profile,
    });
    if (!status.active && !status.ok)
      throw new Error(status.error || "Audio-to-MIDI could not start.");

    setAudioToMidiState({
      segmentId,
      jobId: status.jobId,
      progress: status.progress,
      stage: status.stage,
    });

    while (status.active) {
      await delay(300);
      status = await send({ kind: "audio.transcriptionStatus" });
      setAudioToMidiState({
        segmentId,
        jobId: status.jobId,
        progress: status.progress,
        stage: status.stage,
      });
    }

    if (status.cancelled) return;
    if (!status.ok)
      throw new Error(status.error || "Audio-to-MIDI failed.");

    const installed = installMidiTrack(segmentId, status);
    if (!installed) {
      await appAlert("Basic Pitch completed but did not detect any notes in this stem.", "Convert Stem to MIDI");
      return;
    }
    await appAlert(
      `Created an aligned MIDI lane with ${installed.noteCount} note${installed.noteCount === 1 ? "" : "s"}. The source stem was kept unchanged.`,
      "Audio-to-MIDI Complete",
    );
  } catch (error) {
    await appAlert(error instanceof Error ? error.message : "Audio-to-MIDI failed.", "Convert Stem to MIDI");
  } finally {
    setAudioToMidiState(null);
  }
}

export async function cancelAudioToMidi() {
  const active = audioToMidiState();
  if (!active) return;
  setAudioToMidiState({ ...active, stage: "Cancelling audio-to-MIDI" });
  await send({ kind: "audio.transcriptionCancel" });
}
