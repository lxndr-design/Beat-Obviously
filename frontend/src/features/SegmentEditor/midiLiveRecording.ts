import type { MidiNote } from "../../state/types";

export const MIDI_LIVE_MIN_LENGTH_BEATS = 1 / 64;
export const MIDI_LIVE_DEFAULT_VELOCITY = 112;

export type ComputerPianoKey = {
  code: string;
  label: string;
  pitch: number;
};

export type ComputerPianoOctave = {
  whiteKeys: readonly ComputerPianoKey[];
  blackKeys: readonly (ComputerPianoKey | null)[];
};

const computerPianoKey = (code: string, label: string, pitch: number): ComputerPianoKey => ({ code, label, pitch });

export const COMPUTER_PIANO_OCTAVES: readonly ComputerPianoOctave[] = [
  {
    whiteKeys: [
      computerPianoKey("KeyZ", "Z", 60),
      computerPianoKey("KeyX", "X", 62),
      computerPianoKey("KeyC", "C", 64),
      computerPianoKey("KeyV", "V", 65),
      computerPianoKey("KeyB", "B", 67),
      computerPianoKey("KeyN", "N", 69),
      computerPianoKey("KeyM", "M", 71),
    ],
    blackKeys: [
      computerPianoKey("KeyS", "S", 61),
      computerPianoKey("KeyD", "D", 63),
      null,
      computerPianoKey("KeyG", "G", 66),
      computerPianoKey("KeyH", "H", 68),
      computerPianoKey("KeyJ", "J", 70),
      null,
    ],
  },
  {
    whiteKeys: [
      computerPianoKey("KeyQ", "Q", 72),
      computerPianoKey("KeyW", "W", 74),
      computerPianoKey("KeyE", "E", 76),
      computerPianoKey("KeyR", "R", 77),
      computerPianoKey("KeyT", "T", 79),
      computerPianoKey("KeyY", "Y", 81),
      computerPianoKey("KeyU", "U", 83),
      computerPianoKey("KeyI", "I", 84),
      computerPianoKey("KeyO", "O", 86),
      computerPianoKey("KeyP", "P", 88),
    ],
    blackKeys: [
      computerPianoKey("Digit2", "2", 73),
      computerPianoKey("Digit3", "3", 75),
      null,
      computerPianoKey("Digit5", "5", 78),
      computerPianoKey("Digit6", "6", 80),
      computerPianoKey("Digit7", "7", 82),
      null,
      computerPianoKey("Digit9", "9", 85),
      computerPianoKey("Digit0", "0", 87),
      null,
    ],
  },
] as const;

const COMPUTER_PIANO_PITCH_BY_CODE = new Map(
  COMPUTER_PIANO_OCTAVES.flatMap((octave) => [...octave.whiteKeys, ...octave.blackKeys])
    .filter((key): key is ComputerPianoKey => key != null)
    .map((key) => [key.code, key.pitch] as const),
);

export function computerPianoPitch(
  code: string,
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {},
): number | null {
  const basePitch = COMPUTER_PIANO_PITCH_BY_CODE.get(code);
  if (basePitch == null) return null;
  const octaveOffset = (modifiers.shiftKey ? 12 : 0) - (modifiers.ctrlKey ? 12 : 0);
  return Math.max(0, Math.min(127, basePitch + octaveOffset));
}

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
