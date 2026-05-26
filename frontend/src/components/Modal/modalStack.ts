import { create } from "zustand";

/**
 * Modal stack registry.
 *
 * Modals call push() on mount and pop() on unmount. The order in the stack
 * determines their z-index relative to each other so multiple modals can be
 * open at once.
 *
 * The unsaved-check overlay (rendered by <ModalStackOverlay/>) reads the
 * pendingDirtyClose state to shadow the whole window with a scrim above
 * every open modal.
 */
interface ModalStackState {
  stack: string[];
  pendingDirtyClose: {
    modalId: string;
    onSave: () => void;
    onDontSave: () => void;
  } | null;
  push: (id: string) => void;
  pop: (id: string) => void;
  indexOf: (id: string) => number;
  requestDirtyClose: (
    modalId: string,
    onSave: () => void,
    onDontSave: () => void,
  ) => void;
  clearDirtyClose: () => void;
}

export const useModalStack = create<ModalStackState>((set, get) => ({
  stack: [],
  pendingDirtyClose: null,
  push: (id) =>
    set((s) => (s.stack.includes(id) ? s : { stack: [...s.stack, id] })),
  pop: (id) =>
    set((s) => ({
      stack: s.stack.filter((x) => x !== id),
      pendingDirtyClose:
        s.pendingDirtyClose?.modalId === id ? null : s.pendingDirtyClose,
    })),
  indexOf: (id) => get().stack.indexOf(id),
  requestDirtyClose: (modalId, onSave, onDontSave) =>
    set({ pendingDirtyClose: { modalId, onSave, onDontSave } }),
  clearDirtyClose: () => set({ pendingDirtyClose: null }),
}));
