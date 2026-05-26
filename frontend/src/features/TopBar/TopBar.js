import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button, Icon, HoverInfo } from "../../components";
import { useProjectStore, useTransportStore, useUiStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import { saveProject } from "../../persistence/dexie";
import { primeTimelineAudio, stopTimelineAudio } from "../../audio/timelineAudio";
import { TimeSignatureModal } from "../Transport/TimeSignatureModal";
import { BrandMark } from "./BrandMark";
import { InlineNumber } from "./InlineNumber";
import styles from "./TopBar.module.css";
/**
 * TopBar — single sleek strip holding all global controls.
 *
 *   [▣ logo  ⚙]  [⏮ ▶ ⏹]  0:00:00  4/4∨  BPM 120   ……  [💾 ⤓]
 *
 * - Every icon button is 32×32 with an 8px row gap.
 * - Time display, time-sig, and BPM inputs share one unified
 *   input-frame style so they read as a single horizontal "playback" row.
 */
export function TopBar() {
    const { playing, positionBeat } = useTransportStore();
    const transport = useTransportStore();
    const bpm = useProjectStore((s) => s.project.bpm);
    const ts = useProjectStore((s) => s.project.timeSignature);
    const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
    const setBpm = useProjectStore((s) => s.setBpm);
    const setTs = useProjectStore((s) => s.setTimeSignature);
    const setLengthBeats = useProjectStore((s) => s.setLengthBeats);
    const project = useProjectStore((s) => s.project);
    const openEditor = useUiStore((s) => s.openEditor);
    const [tsMenuOpen, setTsMenuOpen] = useState(false);
    const [tsModalOpen, setTsModalOpen] = useState(false);
    async function onSave() {
        await Promise.all([
            saveProject(project),
            send({ kind: "project.save", project }),
        ]);
    }
    function onPlay() {
        primeTimelineAudio();
        transport.play();
        void send({ kind: "transport.play" });
    }
    function onPause() {
        transport.pause();
        stopTimelineAudio();
        void send({ kind: "transport.pause" });
    }
    function onStop() {
        transport.stop();
        stopTimelineAudio();
        void send({ kind: "transport.stop" });
    }
    function onRestart() {
        transport.setPosition(0);
        primeTimelineAudio();
        transport.play();
        void send({ kind: "transport.seek", positionBeat: 0 });
        void send({ kind: "transport.play" });
    }
    return (_jsxs("header", { className: styles.bar, children: [_jsxs("div", { className: styles.brand, children: [_jsx(BrandMark, {}), _jsx(HoverInfo, { content: "Preferences", children: _jsx(Button, { iconOnly: true, size: "md", onClick: () => openEditor({ kind: "preferences" }), "aria-label": "Preferences", children: _jsx(Icon, { name: "ph:gear", size: 16, decorative: true }) }) })] }), _jsxs("div", { className: styles.playback, children: [_jsx(HoverInfo, { content: "Restart", children: _jsx(Button, { iconOnly: true, size: "md", onClick: onRestart, "aria-label": "Restart", children: _jsx(Icon, { name: "ph:skip-back-fill", size: 16, decorative: true }) }) }), _jsx(HoverInfo, { content: playing ? "Pause (Space)" : "Play (Space)", children: _jsx(Button, { iconOnly: true, size: "md", variant: playing ? "primary" : "default", onClick: playing ? onPause : onPlay, "aria-label": playing ? "Pause" : "Play", children: _jsx(Icon, { name: playing ? "ph:pause-fill" : "ph:play-fill", size: 16, decorative: true }) }) }), _jsx(HoverInfo, { content: "Stop (.)", children: _jsx(Button, { iconOnly: true, size: "md", onClick: onStop, "aria-label": "Stop", children: _jsx(Icon, { name: "ph:stop-fill", size: 16, decorative: true }) }) }), _jsx("span", { className: `${styles.field} ${styles.timeField}`, children: formatClock(positionBeat, bpm) }), _jsx(InlineNumber, { label: "Length", value: lengthBeats, min: 4, max: 4096, step: 4, onChange: setLengthBeats }), _jsxs("div", { className: styles.tsWrap, children: [_jsxs("button", { type: "button", className: `${styles.field} ${styles.tsBtn}`, onClick: () => setTsMenuOpen((v) => !v), "aria-label": "Time signature", "aria-expanded": tsMenuOpen, children: [ts.num, "/", ts.denom, _jsx(Icon, { name: "ph:caret-down", size: 16, decorative: true })] }), tsMenuOpen && (_jsxs("div", { className: styles.dropdown, role: "menu", children: [TS_PRESETS.map((p) => (_jsx("button", { type: "button", className: styles.dropItem, onClick: () => {
                                            const [n, d] = p.split("/").map(Number);
                                            setTs({ num: n, denom: d, boldBeats: [1] });
                                            setTsMenuOpen(false);
                                        }, children: p }, p))), _jsx("div", { className: styles.dropSep }), _jsx("button", { type: "button", className: styles.dropItem, onClick: () => {
                                            setTsMenuOpen(false);
                                            setTsModalOpen(true);
                                        }, children: "Custom\u2026" })] }))] }), _jsx(InlineNumber, { label: "BPM", value: bpm, min: 20, max: 999, step: 1, onChange: setBpm })] }), _jsx("div", { className: styles.spacer }), _jsxs("div", { className: styles.actions, children: [_jsx(HoverInfo, { content: "Save project (\u2318S)", children: _jsx(Button, { iconOnly: true, size: "md", onClick: onSave, "aria-label": "Save", children: _jsx(Icon, { name: "ph:floppy-disk", size: 16, decorative: true }) }) }), _jsx(HoverInfo, { content: "Export to WAV", children: _jsx(Button, { iconOnly: true, size: "md", onClick: () => send({ kind: "project.exportWav" }), "aria-label": "Export", children: _jsx(Icon, { name: "ph:export", size: 16, decorative: true }) }) })] }), tsModalOpen && _jsx(TimeSignatureModal, { onClose: () => setTsModalOpen(false) })] }));
}
const TS_PRESETS = ["4/4", "3/4", "6/8", "5/4", "7/8", "12/8"];
function formatClock(beat, bpm) {
    const seconds = (beat * 60) / bpm;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds * 100) % 100);
    return `${m}:${String(s).padStart(2, "0")}:${String(cs).padStart(2, "0")}`;
}
