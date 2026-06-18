import { createEffect, onCleanup } from "solid-js";
import { useContextualHotkeyStore } from "../hotkeys/contextualHotkeys";

type HotkeyHandler = () => boolean | void;

export function useContextualHotkey(
  scopeId: () => string,
  combo: string,
  handler: HotkeyHandler,
  enabled: () => boolean = () => true,
) {
  createEffect(() => {
    const currentScopeId = scopeId();
    if (!enabled() || !currentScopeId) return;
    useContextualHotkeyStore.getState().register(currentScopeId, combo, handler);
    onCleanup(() => {
      useContextualHotkeyStore.getState().unregister(currentScopeId, combo);
    });
  });
}
