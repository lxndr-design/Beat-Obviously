import { create } from "zustand";
export const useModalStack = create((set, get) => ({
    stack: [],
    pendingDirtyClose: null,
    push: (id) => set((s) => (s.stack.includes(id) ? s : { stack: [...s.stack, id] })),
    pop: (id) => set((s) => ({
        stack: s.stack.filter((x) => x !== id),
        pendingDirtyClose: s.pendingDirtyClose?.modalId === id ? null : s.pendingDirtyClose,
    })),
    indexOf: (id) => get().stack.indexOf(id),
    requestDirtyClose: (modalId, onSave, onDontSave) => set({ pendingDirtyClose: { modalId, onSave, onDontSave } }),
    clearDirtyClose: () => set({ pendingDirtyClose: null }),
}));
