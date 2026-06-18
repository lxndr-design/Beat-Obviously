import { createStore as create } from "zustand/vanilla";
import { useModalStack } from "../solid-ui";

type HotkeyHandler = () => boolean | void;

interface ContextualHotkeyState {
  handlers: Record<string, Record<string, HotkeyHandler>>;
  register: (scopeId: string, combo: string, handler: HotkeyHandler) => void;
  unregister: (scopeId: string, combo: string) => void;
  run: (combo: string) => boolean;
}

export const useContextualHotkeyStore = create<ContextualHotkeyState>((set, get) => ({
  handlers: {},
  register: (scopeId, combo, handler) =>
    set((state) => ({
      handlers: {
        ...state.handlers,
        [scopeId]: { ...(state.handlers[scopeId] ?? {}), [combo]: handler },
      },
    })),
  unregister: (scopeId, combo) =>
    set((state) => {
      const scoped = { ...(state.handlers[scopeId] ?? {}) };
      delete scoped[combo];
      const handlers = { ...state.handlers };
      if (Object.keys(scoped).length === 0) delete handlers[scopeId];
      else handlers[scopeId] = scoped;
      return { handlers };
    }),
  run: (combo) => {
    const { stack } = useModalStack.getState();
    const handlers = get().handlers;

    for (let i = stack.length - 1; i >= 0; i--) {
      const handler = handlers[stack[i]]?.[combo];
      if (handler) return handler() !== false;
    }

    return false;
  },
}));
