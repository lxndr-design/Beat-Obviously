export const MIDI_NOTE_POINTER_DRAG_THRESHOLD_PX = 3;

export function midiNotePointerMovedPastThreshold({
  startClientX,
  startClientY,
  currentClientX,
  currentClientY,
  thresholdPx = MIDI_NOTE_POINTER_DRAG_THRESHOLD_PX,
}: {
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  thresholdPx?: number;
}): boolean {
  const dx = currentClientX - startClientX;
  const dy = currentClientY - startClientY;
  return Math.hypot(dx, dy) >= thresholdPx;
}

export function midiNoteSelectionAfterPointerDown({
  selectedIndices,
  noteIndex,
  additive,
}: {
  selectedIndices: number[];
  noteIndex: number;
  additive: boolean;
}): number[] {
  if (additive) {
    return selectedIndices.includes(noteIndex)
      ? selectedIndices
      : [...selectedIndices, noteIndex];
  }
  return selectedIndices.includes(noteIndex) ? selectedIndices : [noteIndex];
}

export function midiNoteSelectionForContextMenu(
  selectedIndices: number[],
  noteIndex: number,
): number[] {
  return selectedIndices.includes(noteIndex) ? selectedIndices : [noteIndex];
}

export function midiNotePointerRequestsContextMenu({
  button,
  ctrlKey,
}: {
  button: number;
  ctrlKey: boolean;
}): boolean {
  return button === 2 || (button === 0 && ctrlKey);
}

export function midiNoteDragIndicesForSelection(selectedIndices: number[], noteIndex: number): number[] {
  return selectedIndices.includes(noteIndex) ? selectedIndices : [noteIndex];
}

export function midiNoteSelectionAfterAdditiveClick({
  selectedIndices,
  noteIndex,
  moved,
}: {
  selectedIndices: number[];
  noteIndex: number;
  moved: boolean;
}): number[] {
  if (moved || !selectedIndices.includes(noteIndex)) return selectedIndices;
  return selectedIndices.filter((index) => index !== noteIndex);
}

export function midiNoteSelectionAfterMarquee({
  selectedIndices,
  marqueeIndices,
  additive,
}: {
  selectedIndices: number[];
  marqueeIndices: number[];
  additive: boolean;
}): number[] {
  if (!additive) return [...new Set(marqueeIndices)].sort((a, b) => a - b);
  return [...new Set([...selectedIndices, ...marqueeIndices])].sort((a, b) => a - b);
}

export type MidiGridLineKind = "bar" | "beat" | "half" | "quarter" | "eighth" | "sixteenth";

export function midiGridLineKind(beat: number): MidiGridLineKind {
  const sixteenthIndex = Math.round(beat * 16);
  if (sixteenthIndex % 16 === 0) {
    return Math.round(beat) % 4 === 0 ? "bar" : "beat";
  }
  if (sixteenthIndex % 8 === 0) return "half";
  if (sixteenthIndex % 4 === 0) return "quarter";
  if (sixteenthIndex % 2 === 0) return "eighth";
  return "sixteenth";
}

export function midiVisibleGridSubdivision(pxPerBeat: number): number {
  if (pxPerBeat >= 240) return 16;
  if (pxPerBeat >= 180) return 8;
  if (pxPerBeat >= 120) return 4;
  if (pxPerBeat >= 72) return 2;
  return 1;
}

export function midiVisibleGridBeatStep(pxPerBeat: number): number {
  return 1 / midiVisibleGridSubdivision(pxPerBeat);
}

export function snapMidiBeatToVisibleGrid(beat: number, pxPerBeat: number): number {
  const step = midiVisibleGridBeatStep(pxPerBeat);
  return Math.round((Math.round(beat / step) * step) * 10000) / 10000;
}
