import { create } from "zustand";
const store = create()((set, get) => ({
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
