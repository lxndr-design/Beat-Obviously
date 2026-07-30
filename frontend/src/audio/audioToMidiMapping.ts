import type { AudioTranscriptionNote } from "../ipc/schema";
import type { MidiNote } from "../state/types";

function pitchBendsToCurve(note: AudioTranscriptionNote, startBeat: number, lengthBeats: number) {
  if (note.pitchBends.length < 2) return undefined;
  const finalIndex = note.pitchBends.length - 1;
  return note.pitchBends.map((bend, index) => ({
    beat: startBeat + lengthBeats * index / finalIndex,
    pitch: Math.max(0, Math.min(127, note.pitch + bend / 3)),
  }));
}

export function basicPitchNotesToBeatNotes(notes: AudioTranscriptionNote[], bpm: number): MidiNote[] {
  const secondsToBeats = Math.max(1, bpm) / 60;
  return notes
    .map((note): MidiNote | null => {
      const startBeat = note.startSeconds * secondsToBeats;
      const lengthBeats = (note.endSeconds - note.startSeconds) * secondsToBeats;
      if (!Number.isFinite(startBeat) || !Number.isFinite(lengthBeats) || lengthBeats <= 0) return null;
      return {
        pitch: Math.max(0, Math.min(127, Math.round(note.pitch))),
        velocity: Math.max(1, Math.min(127, Math.round(note.velocity))),
        startBeat,
        lengthBeats,
        curve: pitchBendsToCurve(note, startBeat, lengthBeats),
      };
    })
    .filter((note): note is MidiNote => note != null);
}
