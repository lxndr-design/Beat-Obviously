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

export function midiVisibleGridSubdivision(pxPerBeat: number): number {
  return pxPerBeat >= 240 ? 16 : pxPerBeat >= 120 ? 4 : 1;
}

export function midiVisibleGridBeatStep(pxPerBeat: number): number {
  return 1 / midiVisibleGridSubdivision(pxPerBeat);
}

export function snapMidiBeatToVisibleGrid(beat: number, pxPerBeat: number): number {
  const step = midiVisibleGridBeatStep(pxPerBeat);
  return Math.round((Math.round(beat / step) * step) * 10000) / 10000;
}
