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
  segments: Segment[];
  copy: (seg: Segment) => void;
  copyMany: (segments: Segment[]) => void;
  paste: () => Segment | null;
  pasteMany: () => Segment[];
}

const store = create<ClipboardState>()((set, get) => ({
  segment: null,
  segments: [],
  copy: (seg) => set({ segment: structuredClone(seg), segments: [structuredClone(seg)] }),
  copyMany: (segments) =>
    set({
      segment: segments[0] ? structuredClone(segments[0]) : null,
      segments: segments.map((seg) => structuredClone(seg)),
    }),
  paste: () => {
    const s = get().segments[0] ?? get().segment;
    return s ? structuredClone(s) : null;
  },
  pasteMany: () => get().segments.map((seg) => structuredClone(seg)),
}));

/** Hook returning a stable copy/paste API. */
export function useClipboard() {
  return {
    copy: store.getState().copy,
    copyMany: store.getState().copyMany,
    paste: store.getState().paste,
    pasteMany: store.getState().pasteMany,
  };
}

export const clipboardStore = store;
