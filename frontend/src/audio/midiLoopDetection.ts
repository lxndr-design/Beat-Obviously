import type { MidiNote } from "../state/types";

export interface MidiLoopCompaction {
  notes: MidiNote[];
  lengthBeats: number;
  repeats: number;
  confidence: number;
}

export interface MidiLoopDetectionOptions {
  minimumLoopBeats?: number;
  maximumPlays?: number;
  minimumConfidence?: number;
  timingToleranceBeats?: number;
}

const ALIGNMENT_GRID = 0.25;

/**
 * Replaces a completely repeated, end-to-end MIDI transcription with one
 * source cycle plus Beat's explicit additional-repeat count. This deliberately
 * refuses partial or merely similar sections: those need section boundaries,
 * not a loop flag on the whole segment.
 */
export function compactFullyRepeatedMidi(
  notes: MidiNote[],
  sourceLengthBeats: number,
  options: MidiLoopDetectionOptions = {},
): MidiLoopCompaction | null {
  if (notes.length < 2 || !Number.isFinite(sourceLengthBeats) || sourceLengthBeats <= 0) return null;

  const minimumLoopBeats = Math.max(ALIGNMENT_GRID, options.minimumLoopBeats ?? 1);
  const maximumPlays = Math.max(2, Math.floor(options.maximumPlays ?? 32));
  const minimumConfidence = clamp(options.minimumConfidence ?? 0.9, 0.5, 1);
  const timingTolerance = Math.max(1 / 96, options.timingToleranceBeats ?? 0.075);
  const alignedLength = alignSourceLength(sourceLengthBeats, timingTolerance);
  const sorted = notes
    .filter((note) => Number.isFinite(note.startBeat) && Number.isFinite(note.lengthBeats) && note.lengthBeats > 0)
    .slice()
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  if (sorted.length < 2) return null;

  let best: MidiLoopCompaction | null = null;
  const mostPlays = Math.min(maximumPlays, Math.floor(alignedLength / minimumLoopBeats));
  for (let plays = mostPlays; plays >= 2; plays -= 1) {
    const loopLength = alignedLength / plays;
    if (!isGridAligned(loopLength)) continue;

    const cycles = Array.from({ length: plays }, () => [] as MidiNote[]);
    let invalid = false;
    for (const note of sorted) {
      const cycleIndex = Math.min(plays - 1, Math.floor(Math.max(0, note.startBeat) / loopLength));
      if (note.startBeat >= alignedLength + timingTolerance) {
        invalid = true;
        break;
      }
      cycles[cycleIndex].push(note);
    }
    if (invalid || cycles.some((cycle) => cycle.length === 0)) continue;

    const base = normalizeCycle(cycles[0], 0, loopLength);
    if (base.length === 0) continue;
    const scores = cycles.slice(1).map((cycle, index) =>
      compareCycles(base, normalizeCycle(cycle, index + 1, loopLength), timingTolerance),
    );
    const confidence = Math.min(...scores);
    if (confidence < minimumConfidence) continue;

    const candidate: MidiLoopCompaction = {
      notes: base.map(({ note }) => cloneNoteInFirstCycle(note, loopLength)),
      lengthBeats: loopLength,
      repeats: plays - 1,
      confidence,
    };
    if (!best || candidate.lengthBeats < best.lengthBeats) best = candidate;
  }
  return best;
}

interface NormalizedNote {
  note: MidiNote;
  relativeStart: number;
}

function normalizeCycle(notes: MidiNote[], cycleIndex: number, loopLength: number): NormalizedNote[] {
  const cycleStart = cycleIndex * loopLength;
  return notes
    .map((note) => ({ note, relativeStart: note.startBeat - cycleStart }))
    .filter(({ relativeStart }) => relativeStart >= -1 / 96 && relativeStart < loopLength + 1 / 96)
    .sort((a, b) => a.relativeStart - b.relativeStart || a.note.pitch - b.note.pitch);
}

function compareCycles(base: NormalizedNote[], candidate: NormalizedNote[], timingTolerance: number): number {
  if (base.length === 0 || candidate.length === 0) return 0;
  const used = new Set<number>();
  let score = 0;
  for (const expected of base) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < candidate.length; index += 1) {
      if (used.has(index)) continue;
      const actual = candidate[index];
      if (actual.note.pitch !== expected.note.pitch) continue;
      const startDelta = Math.abs(actual.relativeStart - expected.relativeStart);
      if (startDelta > timingTolerance) continue;
      const lengthTolerance = Math.max(timingTolerance * 2, expected.note.lengthBeats * 0.25);
      const lengthDelta = Math.abs(actual.note.lengthBeats - expected.note.lengthBeats);
      if (lengthDelta > lengthTolerance) continue;
      const timingScore = 1 - startDelta / timingTolerance;
      const lengthScore = 1 - lengthDelta / lengthTolerance;
      const velocityScore = 1 - Math.min(1, Math.abs(actual.note.velocity - expected.note.velocity) / 48);
      const matchScore = timingScore * 0.5 + lengthScore * 0.35 + velocityScore * 0.15;
      if (matchScore > bestScore) {
        bestScore = matchScore;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) {
      used.add(bestIndex);
      score += bestScore;
    }
  }
  return score / Math.max(base.length, candidate.length);
}

function cloneNoteInFirstCycle(note: MidiNote, loopLength: number): MidiNote {
  const startBeat = clamp(note.startBeat, 0, Math.max(0, loopLength - 1 / 192));
  return {
    ...note,
    startBeat,
    lengthBeats: Math.min(note.lengthBeats, Math.max(1 / 192, loopLength - startBeat)),
    curve: note.curve?.map((point) => ({ ...point, beat: clamp(point.beat, startBeat, loopLength) })),
  };
}

function alignSourceLength(lengthBeats: number, tolerance: number) {
  const aligned = Math.round(lengthBeats / ALIGNMENT_GRID) * ALIGNMENT_GRID;
  return Math.abs(aligned - lengthBeats) <= tolerance ? aligned : lengthBeats;
}

function isGridAligned(beats: number) {
  return Math.abs(beats / ALIGNMENT_GRID - Math.round(beats / ALIGNMENT_GRID)) < 1e-6;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
