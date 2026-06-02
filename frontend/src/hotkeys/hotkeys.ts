import { useEffect } from "react";
import { useContextualHotkeyStore } from "./contextualHotkeys";
import { redo, undo, useProjectStore, useTransportStore, useUiStore } from "../state/store";
import { clipboardStore } from "../state/clipboard";
import { primeTimelineAudio, stopTimelineAudio } from "../audio/timelineAudio";
import { send } from "../ipc/bridge";

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
        void send({ kind: "transport.pause" });
      } else {
        primeTimelineAudio();
        t.play();
        void send({ kind: "transport.play" });
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
    preventDefault: true,
    action: () => {
      copySelectedTimelineSegments();
    },
  },
  {
    combo: "meta+v",
    description: "Paste",
    preventDefault: true,
    action: () => {
      pasteTimelineSegments();
    },
  },
  {
    combo: ".",
    description: "Stop playback",
    action: () => {
      useTransportStore.getState().stop();
      stopTimelineAudio();
      void send({ kind: "transport.stop" });
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
      if ((combo === "meta+z" || combo === "shift+meta+z") && useUiStore.getState().openEditors.length > 0) {
        e.preventDefault();
        return;
      }
      if (combo === "backspace" || combo === "delete") {
        e.preventDefault();
        deleteSelectedTimelineSegments();
        return;
      }
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

function canUseTimelineSegmentHotkeys(): boolean {
  const ui = useUiStore.getState();
  return ui.openEditors.length === 0 && !ui.trackEffectsEditorTrackId;
}

function selectedTimelineSegments() {
  if (!canUseTimelineSegmentHotkeys()) return [];
  const selected = new Set(useUiStore.getState().selectedSegmentIds);
  if (selected.size === 0) return [];
  return useProjectStore
    .getState()
    .project.tracks.flatMap((track) => track.segments)
    .filter((segment) => selected.has(segment.id))
    .sort((a, b) => a.startBeat - b.startBeat || a.trackId.localeCompare(b.trackId));
}

function copySelectedTimelineSegments(): boolean {
  const segments = selectedTimelineSegments();
  if (segments.length === 0) return false;
  clipboardStore.getState().copyMany(segments);
  return true;
}

function pasteTimelineSegments(): boolean {
  if (!canUseTimelineSegmentHotkeys()) return false;
  const segments = clipboardStore.getState().pasteMany();
  if (segments.length === 0) return false;

  const minStart = Math.min(...segments.map((segment) => segment.startBeat));
  const maxEnd = Math.max(...segments.map((segment) => segment.startBeat + segment.lengthBeats));
  const offset = Math.max(0.25, maxEnd - minStart);
  const addSegment = useProjectStore.getState().addSegment;
  const project = useProjectStore.getState().project;
  const trackIds = new Set(project.tracks.map((track) => track.id));
  const pastedIds = segments
    .filter((segment) => trackIds.has(segment.trackId))
    .map((segment) =>
      addSegment(segment.trackId, {
        ...structuredClone(segment),
        id: undefined,
        startBeat: segment.startBeat + offset,
        name: segment.name ? `${segment.name} copy` : undefined,
      }),
    );

  if (pastedIds.length === 0) return false;
  useUiStore.getState().setSelectedSegments(pastedIds);
  return true;
}

function deleteSelectedTimelineSegments(): boolean {
  const segments = selectedTimelineSegments();
  if (segments.length === 0) return false;
  const removeSegment = useProjectStore.getState().removeSegment;
  segments.forEach((segment) => removeSegment(segment.id));
  useUiStore.getState().setSelectedSegments([]);
  return true;
}
