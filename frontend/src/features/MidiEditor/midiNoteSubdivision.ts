import type { MidiAutomationLane, MidiNote } from "../../state/types";

export interface MidiSubdivisionResult {
  notes: MidiNote[];
  selectedIndices: number[];
}

/** Split selected notes into equal, consecutive notes without changing their total span. */
export function subdivideMidiNotes(
  notes: MidiNote[],
  selectedIndices: number[],
  divisions: number,
): MidiSubdivisionResult {
  const count = Math.max(2, Math.min(64, Math.round(divisions)));
  const selected = new Set(selectedIndices.filter((index) => notes[index]));
  if (selected.size === 0) return { notes, selectedIndices: [] };

  const firstOutputIndex = new Map<number, number>();
  const lastOutputIndex = new Map<number, number>();
  const output: MidiNote[] = [];
  const nextSelection: number[] = [];

  notes.forEach((note, sourceIndex) => {
    firstOutputIndex.set(sourceIndex, output.length);
    if (!selected.has(sourceIndex)) {
      output.push(structuredClone(note));
      lastOutputIndex.set(sourceIndex, output.length - 1);
      return;
    }

    const childLength = note.lengthBeats / count;
    for (let part = 0; part < count; part += 1) {
      const startBeat = note.startBeat + childLength * part;
      const endBeat = startBeat + childLength;
      const child: MidiNote = {
        ...structuredClone(note),
        id: undefined,
        startBeat,
        lengthBeats: childLength,
        connectToIndex: undefined,
        curve: sliceCurve(note, startBeat, endBeat),
        automation: sliceAutomation(note.automation, startBeat, endBeat),
      };
      output.push(child);
      nextSelection.push(output.length - 1);
    }
    lastOutputIndex.set(sourceIndex, output.length - 1);
  });

  notes.forEach((note, sourceIndex) => {
    if (note.connectToIndex == null) return;
    const from = lastOutputIndex.get(sourceIndex);
    const to = firstOutputIndex.get(note.connectToIndex);
    if (from == null || to == null || !output[from]) return;
    output[from] = { ...output[from], connectToIndex: to };
  });

  return { notes: output, selectedIndices: nextSelection };
}

function sliceCurve(note: MidiNote, startBeat: number, endBeat: number): MidiNote["curve"] {
  const curve = note.curve;
  if (!curve || curve.length < 2) return undefined;
  return [
    { beat: startBeat, pitch: interpolatePoints(curve, startBeat, "pitch") },
    { beat: endBeat, pitch: interpolatePoints(curve, endBeat, "pitch") },
  ];
}

function sliceAutomation(
  automation: MidiAutomationLane[] | undefined,
  startBeat: number,
  endBeat: number,
): MidiAutomationLane[] | undefined {
  if (!automation?.length) return undefined;
  return automation.map((lane) => {
    const inside = lane.points.filter((point) => point.beat > startBeat && point.beat < endBeat);
    const firstCurve = lane.points.find((point) => point.beat >= startBeat)?.curve
      ?? lane.points[lane.points.length - 1]?.curve;
    const lastCurve = lane.points.find((point) => point.beat >= endBeat)?.curve
      ?? lane.points[lane.points.length - 1]?.curve;
    return {
      ...lane,
      points: [
        { beat: startBeat, value: interpolatePoints(lane.points, startBeat, "value"), curve: firstCurve },
        ...inside.map((point) => ({ ...point })),
        { beat: endBeat, value: interpolatePoints(lane.points, endBeat, "value"), curve: lastCurve },
      ],
    };
  });
}

function interpolatePoints<T extends { beat: number }>(
  points: T[],
  beat: number,
  property: "pitch" | "value",
): number {
  const sorted = [...points].sort((a, b) => a.beat - b.beat);
  const first = sorted[0] as T & Record<typeof property, number>;
  const last = sorted[sorted.length - 1] as T & Record<typeof property, number>;
  if (!first || !last) return 0;
  if (beat <= first.beat) return first[property];
  if (beat >= last.beat) return last[property];
  const rightIndex = sorted.findIndex((point) => point.beat >= beat);
  const left = sorted[rightIndex - 1] as T & Record<typeof property, number>;
  const right = sorted[rightIndex] as T & Record<typeof property, number>;
  const span = Math.max(0.000001, right.beat - left.beat);
  const ratio = (beat - left.beat) / span;
  return left[property] + (right[property] - left[property]) * ratio;
}
