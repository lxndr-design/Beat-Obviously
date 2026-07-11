import type { MidiNote } from "../../state/types";

export const MIDI_LIVE_MIN_LENGTH_BEATS = 1 / 64;
export const MIDI_LIVE_DEFAULT_VELOCITY = 112;

export type MidiLiveHeldKey = {
  pitch: number;
  startBeat: number;
  startedAtMs: number;
};

export type MidiLiveHeldKeys = Record<string, MidiLiveHeldKey>;

export function makeLiveMidiNote(
  pitch: number,
  startBeat: number,
  endBeat: number,
  velocity = MIDI_LIVE_DEFAULT_VELOCITY,
): MidiNote {
  return {
    pitch,
    startBeat: Math.max(0, startBeat),
    lengthBeats: Math.max(MIDI_LIVE_MIN_LENGTH_BEATS, endBeat - startBeat),
    velocity,
  };
}

export function heldLiveMidiNotes(heldKeys: MidiLiveHeldKeys, currentBeat: number): MidiNote[] {
  return Object.values(heldKeys).map((heldKey) => makeLiveMidiNote(heldKey.pitch, heldKey.startBeat, currentBeat));
}

export function sortedMidiNotes(notes: MidiNote[]): MidiNote[] {
  return [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
}

export function eraseMidiNotesOverlappingSweep(notes: MidiNote[], fromBeat: number, toBeat: number): MidiNote[] {
  const sweepStart = Math.min(fromBeat, toBeat);
  const sweepEnd = Math.max(fromBeat, toBeat);
  if (sweepEnd <= sweepStart) return notes;
  return notes.filter((note) => !midiNoteOverlapsRange(note, sweepStart, sweepEnd));
}

export function composeLiveMidiNotes({
  sourceNotes,
  committedNotes,
  heldKeys,
  currentBeat,
}: {
  sourceNotes: MidiNote[];
  committedNotes: MidiNote[];
  heldKeys: MidiLiveHeldKeys;
  currentBeat: number;
}): MidiNote[] {
  return sortedMidiNotes([
    ...sourceNotes,
    ...committedNotes,
    ...heldLiveMidiNotes(heldKeys, currentBeat),
  ]);
}

function midiNoteOverlapsRange(note: MidiNote, startBeat: number, endBeat: number): boolean {
  const noteStart = note.startBeat;
  const noteEnd = note.startBeat + note.lengthBeats;
  return noteStart < endBeat && noteEnd > startBeat;
}
