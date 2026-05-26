import { useEffect } from "react";
import { useContextualHotkeyStore } from "./contextualHotkeys";
import { redo, undo, useTransportStore } from "../state/store";
import { primeTimelineAudio, stopTimelineAudio } from "../audio/timelineAudio";
function comboFromEvent(e) {
    const parts = [];
    if (e.metaKey || e.ctrlKey)
        parts.push("meta");
    if (e.shiftKey)
        parts.push("shift");
    if (e.altKey)
        parts.push("alt");
    const key = e.key.toLowerCase();
    parts.push(key === " " ? "space" : key);
    return parts.join("+");
}
const BINDINGS = [
    {
        combo: "space",
        description: "Play / pause",
        preventDefault: true,
        action: () => {
            const t = useTransportStore.getState();
            if (t.playing) {
                t.pause();
                stopTimelineAudio();
            }
            else {
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
export function listHotkeys() {
    return BINDINGS;
}
export function useGlobalHotkeys() {
    useEffect(() => {
        function onKey(e) {
            // Ignore when typing in an input.
            const target = e.target;
            if (target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable)) {
                return;
            }
            const combo = comboFromEvent(e);
            if (useContextualHotkeyStore.getState().run(combo)) {
                e.preventDefault();
                return;
            }
            const binding = BINDINGS.find((b) => b.combo === combo);
            if (!binding)
                return;
            if (binding.preventDefault)
                e.preventDefault();
            binding.action();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
}
