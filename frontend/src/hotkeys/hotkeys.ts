import { useEffect } from "react";
import { useContextualHotkeyStore } from "./contextualHotkeys";
import { redo, undo, useTransportStore } from "../state/store";
import { primeTimelineAudio, stopTimelineAudio } from "../audio/timelineAudio";

/**
 * Hotkey registry.
 *
 * Single global listener avoids the per-component-keydown footgun.
 * Bindings are declared once below; components don't register hotkeys
 * directly. To add a hotkey, edit `BINDINGS` here so they stay discoverable.
 */

export interface HotkeyBinding {
  combo: string; // normalized: "meta+z", "shift+meta+z", "space", "k"
  description: string;
  action: () => void;
  /** When true, prevent default browser behavior. */
  preventDefault?: boolean;
}

function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("meta");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  const key = e.key.toLowerCase();
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}

const BINDINGS: HotkeyBinding[] = [
  {
    combo: "space",
    description: "Play / pause",
    preventDefault: true,
    action: () => {
      const t = useTransportStore.getState();
      if (t.playing) {
        t.pause();
        stopTimelineAudio();
      } else {
        primeTimelineAudio();
        t.play();
      }
    },
  },
  {
    combo: "meta+z",
    description: "Undo",
    preventDefault: true,
    action: () => undo(),
  },
  {
    combo: "shift+meta+z",
    description: "Redo",
    preventDefault: true,
    action: () => redo(),
  },
  {
    combo: "meta+s",
    description: "Save project",
    preventDefault: true,
    action: () => {
      // wired in App.tsx via a save-orchestrator hook; left as no-op here.
    },
  },
  {
    combo: "meta+c",
    description: "Copy selection",
    action: () => {
      // delegated to copy/paste service (TODO)
    },
  },
  {
    combo: "meta+v",
    description: "Paste",
    action: () => {
      // delegated to copy/paste service (TODO)
    },
  },
  {
    combo: ".",
    description: "Stop playback",
    action: () => {
      useTransportStore.getState().stop();
      stopTimelineAudio();
    },
  },
];

export function listHotkeys(): HotkeyBinding[] {
  return BINDINGS;
}

export function useGlobalHotkeys() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore when typing in an input.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const combo = comboFromEvent(e);
      if (useContextualHotkeyStore.getState().run(combo)) {
        e.preventDefault();
        return;
      }
      const binding = BINDINGS.find((b) => b.combo === combo);
      if (!binding) return;
      if (binding.preventDefault) e.preventDefault();
      binding.action();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
