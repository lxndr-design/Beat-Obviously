import { create } from "zustand";
import type { Segment } from "./types";

/**
 * Clipboard — single-slot store for cut/copy/paste of segments.
 *
 * Lives outside the project undo history so paste produces a new undo entry
 * via the project store, not a clipboard one.
 */
interface ClipboardState {
  segment: Segment | null;
  copy: (seg: Segment) => void;
  paste: () => Segment | null;
}

const store = create<ClipboardState>()((set, get) => ({
  segment: null,
  copy: (seg) => set({ segment: structuredClone(seg) }),
  paste: () => {
    const s = get().segment;
    return s ? structuredClone(s) : null;
  },
}));

/** Hook returning a stable copy/paste API. */
export function useClipboard() {
  return {
    copy: store.getState().copy,
    paste: store.getState().paste,
  };
}

export const clipboardStore = store;
