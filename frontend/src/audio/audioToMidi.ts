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
import type { AudioStemKind, DrumpadLane, Id, Instrument, Segment } from "../state/types";
import { appAlert } from "../solid-ui";
import { stemSeparationState } from "./stemSeparation";
import { basicPitchNotesToBeatNotes } from "./audioToMidiMapping";
import { compactFullyRepeatedMidi } from "./midiLoopDetection";
import { fusePianoTranscriptions, type PianoTranscriptionFusion } from "./pianoTranscriptionFusion";
import { SALAMANDER_COMPACT_GRAND_NAME } from "../state/factoryPiano";

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

function installMidiTrack(segmentId: Id, result: AudioTranscriptionJobStatus, profile: "general" | "piano") {
  const projectStore = useProjectStore.getState();
  const source = currentSegment(segmentId);
  if (!source || source.payload.kind !== "audio")
    throw new Error("The source stem is no longer available.");

  const detectedNotes = basicPitchNotesToBeatNotes(result.notes, projectStore.project.bpm);
  if (detectedNotes.length === 0) return null;
  const compaction = compactFullyRepeatedMidi(detectedNotes, source.lengthBeats);
  const notes = compaction?.notes ?? detectedNotes;
  const sourcePlays = Math.max(1, source.repeats + 1);
  const detectedPlays = Math.max(1, (compaction?.repeats ?? 0) + 1);

  let trackId = "";
  let midiSegmentId = "";
  runProjectHistoryGroup(() => {
    const orderedBefore = projectStore.project.tracks.map((track) => track.id);
    const sourceTrackIndex = orderedBefore.indexOf(source.trackId);
    if (sourceTrackIndex < 0)
      throw new Error("The source stem track is no longer available.");

    const label = sourceDisplayName(source);
    const availableInstruments = useInstrumentStore.getState().instruments;
    const playbackInstrument = profile === "piano"
      ? availableInstruments.find((candidate) => candidate.name === SALAMANDER_COMPACT_GRAND_NAME)
        ?? availableInstruments.find((candidate) => candidate.name === "Aurum_Keys_01")
        ?? availableInstruments.find((candidate) => candidate.descriptors?.includes("keys"))
        ?? availableInstruments.find((candidate) => candidate.name.toLowerCase() === "lead saw")
      : availableInstruments.find((candidate) => candidate.name.toLowerCase() === "lead saw");
    trackId = projectStore.addTrack({
      name: `${label} · MIDI`,
      kind: "midi",
      instrumentId: playbackInstrument?.id,
    });
    midiSegmentId = projectStore.addSegment(trackId, {
      name: `${label} MIDI`,
      startBeat: source.startBeat,
      lengthBeats: compaction?.lengthBeats ?? source.lengthBeats,
      sourceStartBeat: source.sourceStartBeat,
      repeats: sourcePlays * detectedPlays - 1,
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
  return {
    trackId,
    midiSegmentId,
    noteCount: notes.length,
    detectedNoteCount: detectedNotes.length,
    loopPlays: compaction ? compaction.repeats + 1 : 1,
  };
}

function displayInstrumentName(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Other";
}

function instrumentSearchTerms(group: string) {
  const direct = group.split("_").filter((part) => part.length > 2);
  const aliases: Record<string, string[]> = {
    acoustic_piano: ["piano", "keys"],
    electric_piano: ["electric piano", "keys"],
    acoustic_guitar: ["acoustic guitar", "guitar"],
    clean_electric_guitar: ["clean guitar", "electric guitar", "guitar"],
    distorted_electric_guitar: ["distorted guitar", "electric guitar", "guitar"],
    acoustic_bass: ["acoustic bass", "bass"],
    electric_bass: ["electric bass", "bass"],
    soprano_and_alto_sax: ["sax", "reed"],
    tenor_sax: ["tenor sax", "sax"],
    baritone_sax: ["baritone sax", "sax"],
    flutes: ["flute"],
    string_ensemble: ["strings", "string"],
    synth_strings: ["synth strings", "strings", "pad"],
    synth_lead: ["lead"],
    synth_pad: ["pad"],
    voice: ["voice", "vocal"],
  };
  return [...(aliases[group] ?? []), group.replaceAll("_", " "), ...direct];
}

function findInstrumentForGroup(group: string, instruments: Instrument[]) {
  if (group === "acoustic_piano") {
    const sampledGrand = instruments.find((instrument) => instrument.name === SALAMANDER_COMPACT_GRAND_NAME);
    if (sampledGrand) return sampledGrand;
    const aurumKeys = instruments.find((instrument) => instrument.name === "Aurum_Keys_01");
    if (aurumKeys) return aurumKeys;
  }
  const terms = instrumentSearchTerms(group).map((term) => term.toLowerCase());
  return instruments.find((instrument) => {
    const haystack = [instrument.name, ...(instrument.descriptors ?? [])].join(" ").toLowerCase();
    return terms.some((term) => haystack.includes(term));
  }) ?? instruments.find((instrument) => instrument.name.toLowerCase() === "lead saw");
}

function drumLaneDescription(pitch: number) {
  if (pitch === 35 || pitch === 36) return { name: "Kick", terms: ["kick", "bass drum"] };
  if (pitch === 37) return { name: "Rim", terms: ["rim", "side stick"] };
  if (pitch === 38 || pitch === 40) return { name: "Snare", terms: ["snare"] };
  if (pitch === 39) return { name: "Clap", terms: ["clap"] };
  if (pitch === 42 || pitch === 44) return { name: "Closed Hat", terms: ["closed hat", "hihat closed"] };
  if (pitch === 46) return { name: "Open Hat", terms: ["open hat", "hihat open"] };
  if (pitch === 49 || pitch === 55 || pitch === 57) return { name: "Crash", terms: ["crash"] };
  if (pitch === 51 || pitch === 53 || pitch === 59) return { name: "Ride", terms: ["ride"] };
  if (pitch >= 41 && pitch <= 50) return { name: "Tom", terms: ["tom"] };
  return { name: `Percussion ${pitch}`, terms: ["perc", "triangle"] };
}

function findDrumInstrument(pitch: number, instruments: Instrument[]) {
  const descriptor = drumLaneDescription(pitch);
  return instruments.find((instrument) => {
    const haystack = [instrument.name, ...(instrument.descriptors ?? [])].join(" ").toLowerCase();
    return descriptor.terms.some((term) => haystack.includes(term));
  });
}

function installMultiInstrumentTracks(segmentId: Id, result: AudioTranscriptionJobStatus) {
  const projectStore = useProjectStore.getState();
  const source = currentSegment(segmentId);
  if (!source || source.payload.kind !== "audio")
    throw new Error("The source audio is no longer available.");

  const grouped = new Map<string, AudioTranscriptionJobStatus["notes"]>();
  for (const note of result.notes) {
    const group = note.isDrum ? "drums" : note.instrument?.trim() || "other";
    grouped.set(group, [...(grouped.get(group) ?? []), note]);
  }
  if (grouped.size === 0) return null;

  const availableInstruments = useInstrumentStore.getState().instruments;
  const baseLabel = sourceDisplayName(source);
  const editGroupId = `transcription_${crypto.randomUUID()}`;
  const createdTrackIds: Id[] = [];
  const createdSegmentIds: Id[] = [];
  let noteCount = 0;

  runProjectHistoryGroup(() => {
    const orderedBefore = projectStore.project.tracks.map((track) => track.id);
    const sourceTrackIndex = orderedBefore.indexOf(source.trackId);
    if (sourceTrackIndex < 0)
      throw new Error("The source audio track is no longer available.");

    const entries = [...grouped.entries()].sort(([left], [right]) => {
      if (left === "drums") return 1;
      if (right === "drums") return -1;
      return left.localeCompare(right);
    });
    for (const [group, transcriptionNotes] of entries) {
      const mapped = basicPitchNotesToBeatNotes(transcriptionNotes, projectStore.project.bpm);
      if (mapped.length === 0) continue;
      const label = displayInstrumentName(group);
      const playbackInstrument = group === "drums" ? undefined : findInstrumentForGroup(group, availableInstruments);
      const trackId = projectStore.addTrack({
        name: `${baseLabel} · ${label}`,
        kind: "midi",
        instrumentId: playbackInstrument?.id,
      });

      let payload: Segment["payload"];
      if (group === "drums") {
        const pitches = [...new Set(mapped.map((note) => note.pitch))].sort((a, b) => a - b);
        const lanes: DrumpadLane[] = pitches.map((pitch) => {
          const description = drumLaneDescription(pitch);
          return {
            id: `lane_${crypto.randomUUID()}`,
            name: description.name,
            instrumentId: findDrumInstrument(pitch, availableInstruments)?.id,
          };
        });
        const laneByPitch = new Map(pitches.map((pitch, index) => [pitch, lanes[index].id]));
        payload = {
          kind: "drumpad",
          keyboardLayout: "mac",
          lanes,
          hits: mapped.map((note) => ({
            id: `hit_${crypto.randomUUID()}`,
            laneId: laneByPitch.get(note.pitch)!,
            startBeat: note.startBeat,
            lengthBeats: Math.max(0.03, note.lengthBeats),
            velocity: note.velocity,
          })),
          quantizeSeconds: 1 / 64,
          gainDb: 0,
        };
      } else {
        payload = { kind: "midi", notes: mapped, gainDb: 0 };
      }

      const createdSegmentId = projectStore.addSegment(trackId, {
        name: `${label} MIDI`,
        groupId: editGroupId,
        startBeat: source.startBeat,
        lengthBeats: source.lengthBeats,
        sourceStartBeat: source.sourceStartBeat,
        repeats: source.repeats,
        layer: 0,
        muted: false,
        instrumentId: playbackInstrument?.id,
        payload,
      });
      createdTrackIds.push(trackId);
      createdSegmentIds.push(createdSegmentId);
      noteCount += mapped.length;
    }

    const orderedAfter = useProjectStore.getState().project.tracks
      .map((track) => track.id)
      .filter((trackId) => !createdTrackIds.includes(trackId));
    orderedAfter.splice(sourceTrackIndex + 1, 0, ...createdTrackIds);
    projectStore.reorderTracks(orderedAfter);
  });

  useUiStore.getState().setSelectedSegments(createdSegmentIds);
  useUiStore.getState().setSelectedTracks(createdTrackIds);
  return { trackCount: createdTrackIds.length, noteCount };
}

export async function convertStemToMidi(segmentId: Id) {
  const source = currentSegment(segmentId);
  if (!source || source.payload.kind !== "audio") return;
  const profile = transcriptionProfile(source.stemKind);
  if (!profile) {
    const message = source.stemKind === "drums"
      ? "Drum transcription needs a separate model and is not included in this first version."
      : "General conversion is currently available for separated Bass, Vocals, and Other stems.";
    await appAlert(message, "Convert Stem to MIDI");
    return;
  }
  await convertAudioSegmentToMidi(segmentId, profile);
}

export async function convertPianoToMidi(segmentId: Id) {
  const source = currentSegment(segmentId);
  if (!source || source.payload.kind !== "audio") return;
  if (source.stemKind === "drums") {
    await appAlert("Use Piano performance only for piano or keyboard audio.", "Convert Audio to MIDI");
    return;
  }
  await convertAudioSegmentToMidi(segmentId, "piano");
}

export async function convertMultiInstrumentToMidi(segmentId: Id) {
  const source = currentSegment(segmentId);
  if (!source || source.payload.kind !== "audio") return;
  await convertAudioSegmentToMidi(segmentId, "multi-instrument");
}

async function convertAudioSegmentToMidi(segmentId: Id, profile: AudioTranscriptionProfile) {
  if (audioToMidiState()) {
    await appAlert("Another audio-to-MIDI job is already running.", "Convert Audio to MIDI");
    return;
  }
  if (stemSeparationState()) {
    await appAlert("Wait for stem separation to finish before converting audio to MIDI.", "Convert Audio to MIDI");
    return;
  }
  if (!isNative()) {
    await appAlert("Audio-to-MIDI is available in the native Beat app.", "Convert Audio to MIDI");
    return;
  }

  const source = currentSegment(segmentId);
  if (!source || source.payload.kind !== "audio") return;
  const sourcePayload = source.payload;

  const audioFile = useAudioFileStore.getState().files.find((file) => file.id === sourcePayload.audioFileId);
  if (!audioFile?.path) {
    await appAlert("The source audio file is missing.", "Convert Audio to MIDI");
    return;
  }

  try {
    let fusion: PianoTranscriptionFusion | null = null;
    let status: AudioTranscriptionJobStatus | null;
    if (profile === "piano") {
      const primary = await runTranscriptionJob(segmentId, audioFile.path, "piano");
      if (!primary) return;
      const recovery = await runTranscriptionJob(segmentId, audioFile.path, "piano-recovery");
      if (!recovery) return;
      fusion = fusePianoTranscriptions(primary.notes, recovery.notes);
      status = { ...primary, notes: fusion.notes };
    } else {
      status = await runTranscriptionJob(segmentId, audioFile.path, profile);
      if (!status) return;
    }

    const multiInstalled = profile === "multi-instrument"
      ? installMultiInstrumentTracks(segmentId, status)
      : null;
    if (multiInstalled) {
      await appAlert(
        `Created ${multiInstalled.trackCount} linked instrument lane${multiInstalled.trackCount === 1 ? "" : "s"}`
          + ` with ${multiInstalled.noteCount} source-dynamic MIDI note${multiInstalled.noteCount === 1 ? "" : "s"}.`
          + " The source audio was kept unchanged.",
        "Multi-Instrument MIDI Complete",
      );
      return;
    }
    const installed = profile === "multi-instrument"
      ? null
      : installMidiTrack(segmentId, status, profile === "piano" ? "piano" : "general");
    if (!installed) {
      await appAlert("The transcription completed but did not detect any notes.", "Convert Audio to MIDI");
      return;
    }
    await appAlert(
      `Created an aligned MIDI lane with ${installed.noteCount} note${installed.noteCount === 1 ? "" : "s"}`
        + (fusion
          ? ` (${fusion.primaryCount} Transkun notes + ${fusion.recoveredCount} conservative Basic Pitch recoveries)`
          : "")
        + (installed.loopPlays > 1
          ? ` in a detected ${installed.loopPlays}-play loop (${installed.detectedNoteCount} transcribed events before compaction)`
          : "")
        + ". The source audio was kept unchanged.",
      "Audio-to-MIDI Complete",
    );
  } catch (error) {
    await appAlert(error instanceof Error ? error.message : "Audio-to-MIDI failed.", "Convert Audio to MIDI");
  } finally {
    setAudioToMidiState(null);
  }
}

async function runTranscriptionJob(
  segmentId: Id,
  path: string,
  profile: AudioTranscriptionProfile,
): Promise<AudioTranscriptionJobStatus | null> {
  const preparingStage = profile === "piano"
    ? "Preparing Transkun piano transcription"
    : profile === "piano-recovery"
      ? "Checking missed piano strikes with Basic Pitch"
      : profile === "multi-instrument"
        ? "Preparing MuScriptor multi-instrument transcription"
      : "Preparing Spotify Basic Pitch";
  setAudioToMidiState({ segmentId, progress: 0, stage: preparingStage });
  let status = await send({ kind: "audio.transcriptionStart", path, profile });
  if (!status.active && !status.ok)
    throw new Error(status.error || "Audio-to-MIDI could not start.");

  setAudioToMidiState({ segmentId, jobId: status.jobId, progress: status.progress, stage: status.stage });
  while (status.active) {
    await delay(300);
    status = await send({ kind: "audio.transcriptionStatus" });
    setAudioToMidiState({ segmentId, jobId: status.jobId, progress: status.progress, stage: status.stage });
  }
  if (status.cancelled) return null;
  if (!status.ok) throw new Error(status.error || "Audio-to-MIDI failed.");
  return status;
}

export async function cancelAudioToMidi() {
  const active = audioToMidiState();
  if (!active) return;
  setAudioToMidiState({ ...active, stage: "Cancelling audio-to-MIDI" });
  await send({ kind: "audio.transcriptionCancel" });
}
