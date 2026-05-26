import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { useProjectStore, useTransportStore, useViewStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import styles from "./Timeline.module.css";
/**
 * Timeline — ruler strip at the bottom of the lane scroll column.
 *
 * Tick marks are musical: each subtick is one beat, and each bold tick is one
 * measure according to the time signature. Time labels are calculated from BPM
 * afterward and do not create guide ticks.
 *
 * Clicking or dragging anywhere on the strip scrubs the transport
 * `positionBeat` — i.e. the timeline doubles as a scrubber.
 */
export function Timeline() {
    const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
    const ts = useProjectStore((s) => s.project.timeSignature);
    const bpm = useProjectStore((s) => s.project.bpm);
    const beatsToPx = useViewStore((s) => s.beatsToPx);
    const setPosition = useTransportStore((s) => s.setPosition);
    const stripRef = useRef(null);
    const [dragging, setDragging] = useState(false);
    const ticks = [];
    for (let b = 0; b <= lengthBeats; b++)
        ticks.push(b);
    const totalSeconds = Math.ceil((lengthBeats * 60) / bpm);
    const secondTicks = Array.from({ length: totalSeconds + 1 }, (_, seconds) => ({
        seconds,
        beat: (seconds * bpm) / 60,
    })).filter((t) => t.beat <= lengthBeats);
    const secondLabelSpacingPx = (bpm / 60) * beatsToPx;
    const showSecondLabels = secondLabelSpacingPx >= MIN_SECOND_LABEL_SPACING_PX;
    function isBold(beatIdx) {
        return beatIdx % Math.max(1, ts.num) === 0;
    }
    function beatAt(clientX) {
        const r = stripRef.current?.getBoundingClientRect();
        if (!r)
            return 0;
        const beat = (clientX - r.left) / beatsToPx;
        return Math.max(0, Math.min(lengthBeats, beat));
    }
    function commit(clientX) {
        const b = beatAt(clientX);
        setPosition(b);
        void send({ kind: "transport.seek", positionBeat: b });
    }
    function onPointerDown(e) {
        e.target.setPointerCapture(e.pointerId);
        setDragging(true);
        commit(e.clientX);
    }
    useEffect(() => {
        if (!dragging)
            return;
        function onMove(e) {
            commit(e.clientX);
        }
        function onUp() {
            setDragging(false);
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dragging, beatsToPx, lengthBeats]);
    return (_jsxs("div", { ref: stripRef, className: styles.timeline, style: { width: lengthBeats * beatsToPx }, onPointerDown: onPointerDown, children: [ticks.map((b) => {
                const major = b % ts.num === 0;
                const bold = isBold(b);
                return (_jsx("div", { className: `${styles.tick} ${major ? styles.major : ""} ${bold ? styles.bold : ""}`, style: { left: b * beatsToPx }, children: major && !showSecondLabels && (_jsx("span", { className: styles.label, children: formatTime(b, bpm) })) }, b));
            }), secondTicks.map(({ seconds, beat }) => (_jsx("div", { className: styles.timeLabelTick, style: { left: beat * beatsToPx }, children: showSecondLabels && (_jsx("span", { className: styles.label, children: formatSeconds(seconds) })) }, `second-${seconds}`)))] }));
}
function formatTime(beat, bpm) {
    const seconds = (beat * 60) / bpm;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}
function formatSeconds(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}
const MIN_SECOND_LABEL_SPACING_PX = 36;
