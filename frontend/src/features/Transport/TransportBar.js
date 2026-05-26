import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button, Icon, NumberInput, HoverInfo } from "../../components";
import { useProjectStore, useTransportStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import { TimeSignatureModal } from "./TimeSignatureModal";
import styles from "./TransportBar.module.css";
/**
 * TransportBar — bottom strip.
 *
 * Left:    Restart / Play / Stop
 * Middle:  Time display (M:SS:cs), loop range if active
 * Right:   Playback section — Time signature, BPM, Speed%
 *
 * The playback section is grouped tightly next to the time controls per
 * spec. Time signature uses a drop-up popover; speed is shown as a
 * percentage (internally still a multiplier).
 */
export function TransportBar() {
    const { playing, positionBeat, speed, loopRange } = useTransportStore();
    const bpm = useProjectStore((s) => s.project.bpm);
    const ts = useProjectStore((s) => s.project.timeSignature);
    const setBpm = useProjectStore((s) => s.setBpm);
    const setTs = useProjectStore((s) => s.setTimeSignature);
    const transport = useTransportStore();
    const [tsModalOpen, setTsModalOpen] = useState(false);
    const [tsMenuOpen, setTsMenuOpen] = useState(false);
    async function onPlay() {
        transport.play();
        await send({ kind: "transport.play" });
    }
    async function onPause() {
        transport.pause();
        await send({ kind: "transport.pause" });
    }
    async function onStop() {
        transport.stop();
        await send({ kind: "transport.stop" });
    }
    async function onRestart() {
        transport.setPosition(0);
        transport.play();
        await send({ kind: "transport.seek", positionBeat: 0 });
        await send({ kind: "transport.play" });
    }
    async function onSpeedPercent(p) {
        const mult = p / 100;
        transport.setSpeed(mult);
        await send({ kind: "transport.setSpeed", speed: mult });
    }
    return (_jsxs("div", { className: styles.bar, children: [_jsxs("div", { className: styles.transport, children: [_jsx(HoverInfo, { content: "Restart from beginning", children: _jsx(Button, { onClick: onRestart, "aria-label": "Restart", iconOnly: true, size: "md", children: _jsx(Icon, { name: "ph:skip-back-fill", size: 16, decorative: true }) }) }), _jsx(HoverInfo, { content: playing ? "Pause (Space)" : "Play (Space)", children: _jsx(Button, { onClick: playing ? onPause : onPlay, "aria-label": playing ? "Pause" : "Play", iconOnly: true, size: "md", variant: playing ? "primary" : "default", children: _jsx(Icon, { name: playing ? "ph:pause-fill" : "ph:play-fill", size: 16, decorative: true }) }) }), _jsx(HoverInfo, { content: "Stop (.)", children: _jsx(Button, { onClick: onStop, "aria-label": "Stop", iconOnly: true, size: "md", children: _jsx(Icon, { name: "ph:stop-fill", size: 16, decorative: true }) }) }), _jsx("span", { className: styles.timeDisplay, children: formatClock(positionBeat, bpm) }), loopRange && (_jsxs("span", { className: styles.loop, children: ["\u27F2 ", formatClock(loopRange.startBeat, bpm), " \u2013 ", formatClock(loopRange.endBeat, bpm)] }))] }), _jsx("div", { className: styles.spacer }), _jsxs("div", { className: styles.playback, children: [_jsxs("div", { className: styles.tsWrap, children: [_jsx(HoverInfo, { content: "Time signature", children: _jsxs("button", { type: "button", className: styles.tsBtn, onClick: () => setTsMenuOpen((v) => !v), "aria-label": "Time signature", "aria-expanded": tsMenuOpen, children: [ts.num, "/", ts.denom, _jsx(Icon, { name: "ph:caret-up", size: 16, decorative: true })] }) }), tsMenuOpen && (_jsxs("div", { className: styles.dropUp, role: "menu", children: [TS_PRESETS.map((preset) => (_jsx("button", { type: "button", className: styles.dropItem, onClick: () => {
                                            const [n, d] = preset.split("/").map(Number);
                                            setTs({ num: n, denom: d, boldBeats: [1] });
                                            setTsMenuOpen(false);
                                        }, children: preset }, preset))), _jsx("div", { className: styles.dropSep }), _jsx("button", { type: "button", className: styles.dropItem, onClick: () => {
                                            setTsMenuOpen(false);
                                            setTsModalOpen(true);
                                        }, children: "Custom\u2026" })] }))] }), _jsx(NumberInput, { label: "BPM", value: bpm, min: 20, max: 999, step: 1, onChange: setBpm }), _jsx(NumberInput, { label: "Speed", value: Math.round(speed * 100), min: 10, max: 400, step: 5, unit: "%", onChange: onSpeedPercent })] }), tsModalOpen && _jsx(TimeSignatureModal, { onClose: () => setTsModalOpen(false) })] }));
}
const TS_PRESETS = ["4/4", "3/4", "6/8", "5/4", "7/8", "12/8"];
/** Format a beat-position as M:SS:cs clock time using the current BPM. */
function formatClock(beat, bpm) {
    const seconds = (beat * 60) / bpm;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds * 100) % 100);
    return `${m}:${String(s).padStart(2, "0")}:${String(cs).padStart(2, "0")}`;
}
