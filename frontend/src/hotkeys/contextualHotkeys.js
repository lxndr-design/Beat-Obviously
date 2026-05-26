import { useEffect } from "react";
import { create } from "zustand";
import { useModalStack } from "../components";
export const useContextualHotkeyStore = create((set, get) => ({
    handlers: {},
    register: (scopeId, combo, handler) => set((state) => ({
        handlers: {
            ...state.handlers,
            [scopeId]: { ...(state.handlers[scopeId] ?? {}), [combo]: handler },
        },
    })),
    unregister: (scopeId, combo) => set((state) => {
        const scoped = { ...(state.handlers[scopeId] ?? {}) };
        delete scoped[combo];
        const handlers = { ...state.handlers };
        if (Object.keys(scoped).length === 0)
            delete handlers[scopeId];
        else
            handlers[scopeId] = scoped;
        return { handlers };
    }),
    run: (combo) => {
        const { stack } = useModalStack.getState();
        const handlers = get().handlers;
        for (let i = stack.length - 1; i >= 0; i--) {
            const handler = handlers[stack[i]]?.[combo];
            if (handler)
                return handler() !== false;
        }
        return false;
    },
}));
export function useContextualHotkey(scopeId, combo, handler, enabled = true) {
    useEffect(() => {
        if (!enabled)
            return;
        useContextualHotkeyStore.getState().register(scopeId, combo, handler);
        return () => {
            useContextualHotkeyStore.getState().unregister(scopeId, combo);
        };
    }, [scopeId, combo, handler, enabled]);
}
