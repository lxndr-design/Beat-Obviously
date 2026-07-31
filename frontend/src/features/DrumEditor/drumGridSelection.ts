export interface DrumGridCoordinate {
  rowId: string;
  step: number;
}

export function drumCellKey(rowId: string, step: number): string {
  return `${rowId}:${step}`;
}

export function drumSelectionRectangle(
  rowIds: readonly string[],
  stepCount: number,
  anchor: DrumGridCoordinate,
  focus: DrumGridCoordinate,
): Set<string> {
  const anchorRow = rowIds.indexOf(anchor.rowId);
  const focusRow = rowIds.indexOf(focus.rowId);
  if (anchorRow < 0 || focusRow < 0 || stepCount <= 0) return new Set();

  const firstRow = Math.min(anchorRow, focusRow);
  const lastRow = Math.max(anchorRow, focusRow);
  const firstStep = Math.max(0, Math.min(anchor.step, focus.step));
  const lastStep = Math.min(stepCount - 1, Math.max(anchor.step, focus.step));
  const selection = new Set<string>();
  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    for (let step = firstStep; step <= lastStep; step += 1) {
      selection.add(drumCellKey(rowIds[rowIndex], step));
    }
  }
  return selection;
}

export function mergeDrumSelection(
  base: ReadonlySet<string>,
  rectangle: ReadonlySet<string>,
  additive: boolean,
): Set<string> {
  if (!additive) return new Set(rectangle);
  return new Set([...base, ...rectangle]);
}
