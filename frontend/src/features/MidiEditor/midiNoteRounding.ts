import type { MidiNote } from "../../state/types";

const MINIMUM_STEP_BEATS = 1 / 1024;
const BEAT_PRECISION = 1_000_000;

export interface RoundMidiNotesResult {
  notes: MidiNote[];
  movedNoteCount: number;
  extendedNoteCount: number;
}

export function roundMidiNotesToNearest(
  notes: MidiNote[],
  stepBeats: number,
  segmentLengthBeats: number,
): RoundMidiNotesResult {
  const step = Math.max(MINIMUM_STEP_BEATS, normalizeBeat(stepBeats));
  const segmentLength = Math.max(step, normalizeBeat(segmentLengthBeats));
  let movedNoteCount = 0;
  let extendedNoteCount = 0;

  const roundedNotes = notes.map((note) => {
    const originalStart = normalizeBeat(note.startBeat);
    const originalLength = Math.max(0, normalizeBeat(note.lengthBeats));
    const nextLength = Math.min(segmentLength, Math.max(step, originalLength));
    const nearestStart = normalizeBeat(Math.round(originalStart / step) * step);
    const lastGridStart = normalizeBeat(
      Math.floor(Math.max(0, segmentLength - nextLength) / step + 1e-9) * step,
    );
    const nextStart = normalizeBeat(Math.max(0, Math.min(nearestStart, lastGridStart)));
    const beatDelta = roundBeat(nextStart - originalStart);

    if (Math.abs(beatDelta) > 1e-9) movedNoteCount += 1;
    if (nextLength > originalLength + 1e-9) extendedNoteCount += 1;

    return {
      ...note,
      startBeat: nextStart,
      lengthBeats: nextLength,
      curve: roundNoteCurve(note, nextStart, nextLength),
      automation: shiftNoteAutomation(note, beatDelta),
    };
  });

  return { notes: roundedNotes, movedNoteCount, extendedNoteCount };
}

function roundNoteCurve(
  note: MidiNote,
  nextStartBeat: number,
  nextLengthBeats: number,
): MidiNote["curve"] {
  if (!note.curve?.length) return undefined;
  if (note.curve.length === 1) {
    return [{ ...note.curve[0], beat: nextStartBeat }];
  }
  return note.curve.map((point, index) => {
    if (index === 0) return { ...point, beat: nextStartBeat };
    if (index === note.curve!.length - 1) {
      return { ...point, beat: normalizeBeat(nextStartBeat + nextLengthBeats) };
    }
    const originalLocalBeat = point.beat - note.startBeat;
    const normalizedPosition = note.lengthBeats > 0
      ? Math.max(0, Math.min(1, originalLocalBeat / note.lengthBeats))
      : 0;
    return {
      ...point,
      beat: normalizeBeat(nextStartBeat + normalizedPosition * nextLengthBeats),
    };
  });
}

function shiftNoteAutomation(note: MidiNote, beatDelta: number): MidiNote["automation"] {
  if (!note.automation?.length) return undefined;
  return note.automation.map((lane) => ({
    ...lane,
    points: lane.points.map((point) => ({
      ...point,
      beat: normalizeBeat(point.beat + beatDelta),
    })),
  }));
}

function normalizeBeat(value: number): number {
  return Math.max(0, roundBeat(value));
}

function roundBeat(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * BEAT_PRECISION) / BEAT_PRECISION;
}
