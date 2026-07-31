import type { Instrument } from "../../state/types";

export const AURUM_HISTORY_LIMIT = 100;
export const AURUM_HISTORY_COALESCE_MS = 450;

export interface AurumEditHistory {
  undo: Instrument[];
  redo: Instrument[];
  lastGroup: string | null;
  lastEditAt: number;
}

export interface AurumHistoryTransition {
  history: AurumEditHistory;
  draft: Instrument;
}

export function createAurumEditHistory(): AurumEditHistory {
  return { undo: [], redo: [], lastGroup: null, lastEditAt: 0 };
}

export function recordAurumEdit(
  history: AurumEditHistory,
  current: Instrument,
  group: string,
  now = Date.now(),
  coalesce = true,
): AurumEditHistory {
  const joinsPrevious = coalesce
    && history.lastGroup === group
    && now - history.lastEditAt <= AURUM_HISTORY_COALESCE_MS;
  return {
    undo: joinsPrevious
      ? history.undo
      : [...history.undo, structuredClone(current)].slice(-AURUM_HISTORY_LIMIT),
    redo: [],
    lastGroup: coalesce ? group : null,
    lastEditAt: now,
  };
}

export function undoAurumEdit(history: AurumEditHistory, current: Instrument): AurumHistoryTransition | null {
  const previous = history.undo.at(-1);
  if (!previous) return null;
  return {
    draft: structuredClone(previous),
    history: {
      undo: history.undo.slice(0, -1),
      redo: [...history.redo, structuredClone(current)].slice(-AURUM_HISTORY_LIMIT),
      lastGroup: null,
      lastEditAt: 0,
    },
  };
}

export function redoAurumEdit(history: AurumEditHistory, current: Instrument): AurumHistoryTransition | null {
  const next = history.redo.at(-1);
  if (!next) return null;
  return {
    draft: structuredClone(next),
    history: {
      undo: [...history.undo, structuredClone(current)].slice(-AURUM_HISTORY_LIMIT),
      redo: history.redo.slice(0, -1),
      lastGroup: null,
      lastEditAt: 0,
    },
  };
}
