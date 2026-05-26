import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { useProjectStore, useUiStore, useViewStore } from "../../state/store";
import { SEGMENT_LAYER_OFFSET_PX } from "./geometry";
import { useContextMenu, Icon } from "../../components";
import { useClipboard } from "../../state/clipboard";
import { useComponentStore } from "../../state/components";
import { SegmentWaveform } from "./SegmentWaveform";
import { SegmentMidiPreview } from "./SegmentMidiPreview";
import { SegmentDrumPreview } from "./SegmentDrumPreview";
import styles from "./Segment.module.css";
/**
 * Segment — universal segment renderer.
 *
 * Both audio and MIDI segments share the same shell:
 *   ┌─── black label strip (white text: name · type) ───┐
 *   │ ▒▒▒  black content overlay on white body  ▒▒▒    │   ← black waveform / mini-notes
 *   │      (white body)                                 │
 *   └───────────────────────────────────────────────────┘
 *
 * Resize handles on left/right edges (8px). Body drags to move. Right-click
 * exposes Edit / Duplicate / Copy / Paste / Rename.
 *
 * Drag/resize snap follows the musical ruler:
 *   - default: one time-signature subtick (one beat)
 *   - Shift held: one full measure (timeSig.num beats)
 * Time labels are derived from BPM after the musical grid is established.
 */
export function Segment({ segmentId, startBeat, lengthBeats, repetition, layer, payloadKind, onEdit, }) {
    const beatsToPx = useViewStore((s) => s.beatsToPx);
    const setLastLen = useViewStore((s) => s.setLastSegmentLength);
    const moveSegment = useProjectStore((s) => s.moveSegment);
    const updateSegment = useProjectStore((s) => s.updateSegment);
    const removeSegment = useProjectStore((s) => s.removeSegment);
    const addSegment = useProjectStore((s) => s.addSegment);
    const setSegmentRepeats = useProjectStore((s) => s.setSegmentRepeats);
    const projectLengthBeats = useProjectStore((s) => s.project.lengthBeats);
    const tsNum = useProjectStore((s) => s.project.timeSignature.num);
    const selected = useUiStore((s) => s.selectedSegmentIds.includes(segmentId));
    const selectSegment = useUiStore((s) => s.selectSegment);
    const { copy: copyToClipboard, paste } = useClipboard();
    const saveComponent = useComponentStore((s) => s.add);
    const drag = useRef(null);
    function snapStepBeats(shift) {
        return shift ? Math.max(1, tsNum) : GRID_TICK_BEATS;
    }
    function snapBeat(beat, shift) {
        const step = snapStepBeats(shift);
        return Math.max(0, Math.round(beat / step) * step);
    }
    function snapLen(len, shift) {
        const step = snapStepBeats(shift);
        return Math.max(GRID_TICK_BEATS, Math.round(len / step) * step);
    }
    function startDrag(mode, e) {
        if (repetition > 0)
            return;
        e.stopPropagation();
        e.target.setPointerCapture(e.pointerId);
        if (mode === "move") {
            drag.current = { mode, startX: e.clientX, startBeat };
        }
        else if (mode === "resize-right") {
            drag.current = { mode, startX: e.clientX, startLen: lengthBeats, shift: e.shiftKey };
        }
        else {
            drag.current = { mode, startX: e.clientX, startBeat, startLen: lengthBeats, shift: e.shiftKey };
        }
        selectSegment(segmentId, e.shiftKey);
    }
    function onPointerMove(e) {
        const d = drag.current;
        if (!d)
            return;
        const dxPx = e.clientX - d.startX;
        const dxBeats = dxPx / beatsToPx;
        if (d.mode === "move") {
            const newStart = snapBeat(d.startBeat + dxBeats, e.shiftKey);
            if (newStart === startBeat)
                return;
            const seg = useProjectStore.getState().project.tracks
                .flatMap((t) => t.segments)
                .find((s) => s.id === segmentId);
            if (seg)
                moveSegment(segmentId, seg.trackId, newStart);
        }
        else if (d.mode === "resize-right") {
            const raw = d.startLen + dxBeats;
            const newLen = snapLen(raw, e.shiftKey);
            if (newLen === lengthBeats)
                return;
            updateSegment(segmentId, { lengthBeats: newLen });
            setLastLen(newLen);
        }
        else if (d.mode === "resize-left") {
            // Lock the right edge — it's the anchor while we drag the left handle.
            // Snap the new start to the same step the right handle uses, then
            // derive length = rightEdge - snappedStart. This guarantees the right
            // edge does not drift, no matter the snap setting or shift state.
            const rightBeat = d.startBeat + d.startLen;
            const rawStart = d.startBeat + dxBeats;
            const snappedStart = snapBeat(rawStart, e.shiftKey);
            // Don't allow the start to cross the right edge — keep one grid tick minimum.
            const clampedStart = Math.min(rightBeat - GRID_TICK_BEATS, snappedStart);
            const newLen = rightBeat - clampedStart;
            if (clampedStart === startBeat && newLen === lengthBeats)
                return;
            updateSegment(segmentId, { startBeat: clampedStart, lengthBeats: newLen });
            setLastLen(newLen);
        }
    }
    function onPointerUp() {
        drag.current = null;
    }
    // Right-click menu.
    const segState = useProjectStore.getState();
    const liveSeg = segState.project.tracks
        .flatMap((t) => t.segments)
        .find((s) => s.id === segmentId);
    const { onContextMenu, menu } = useContextMenu(() => {
        if (!liveSeg)
            return [];
        const isMidi = liveSeg.payload.kind === "midi" || liveSeg.payload.kind === "mixed";
        const canLoop = isMidi || liveSeg.payload.kind === "drum";
        return [
            { label: "Edit", icon: "ph:pencil-simple", onSelect: onEdit },
            {
                label: "Rename",
                icon: "ph:text-aa",
                onSelect: () => {
                    const next = window.prompt("Segment name", liveSeg.name ?? "");
                    if (next != null)
                        updateSegment(segmentId, { name: next });
                },
            },
            ...(canLoop
                ? [
                    {
                        label: liveSeg.repeats > 0 ? "Unloop" : "Loop",
                        icon: "ph:repeat",
                        onSelect: () => {
                            const remaining = Math.max(0, projectLengthBeats - liveSeg.startBeat - liveSeg.lengthBeats);
                            const repeats = liveSeg.repeats > 0
                                ? 0
                                : Math.max(0, Math.ceil(remaining / liveSeg.lengthBeats));
                            setSegmentRepeats(segmentId, repeats);
                        },
                    },
                ]
                : []),
            ...(isMidi || liveSeg.payload.kind === "drum"
                ? [
                    {
                        label: "Save as Component",
                        icon: "ph:package",
                        onSelect: () => {
                            const fallback = liveSeg.name?.trim() || "Untitled Component";
                            const name = window.prompt("Component name", fallback) ?? fallback;
                            if (!name)
                                return;
                            if (liveSeg.payload.kind === "drum") {
                                saveComponent({
                                    kind: "drum",
                                    name,
                                    rows: liveSeg.payload.rows,
                                    stepCount: liveSeg.payload.stepCount,
                                    speed: liveSeg.payload.speed,
                                    defaultPitchHz: liveSeg.payload.defaultPitchHz,
                                    lengthBeats: liveSeg.lengthBeats,
                                });
                            }
                            else if (liveSeg.payload.kind === "midi" || liveSeg.payload.kind === "mixed") {
                                saveComponent({
                                    kind: "midi",
                                    name,
                                    notes: liveSeg.payload.notes,
                                    lengthBeats: liveSeg.lengthBeats,
                                    instrumentId: liveSeg.instrumentId,
                                });
                            }
                        },
                    },
                ]
                : []),
            {
                label: "Duplicate",
                icon: "ph:copy",
                onSelect: () => {
                    addSegment(liveSeg.trackId, {
                        ...structuredClone(liveSeg),
                        startBeat: liveSeg.startBeat + liveSeg.lengthBeats,
                        name: duplicateSegmentName(liveSeg),
                        id: undefined,
                    });
                },
                separatorBefore: true,
            },
            {
                label: "Copy",
                icon: "ph:clipboard",
                onSelect: () => copyToClipboard(liveSeg),
            },
            {
                label: "Paste",
                icon: "ph:clipboard-text",
                onSelect: () => {
                    const pasted = paste();
                    if (!pasted)
                        return;
                    addSegment(liveSeg.trackId, {
                        ...pasted,
                        id: undefined,
                        startBeat: liveSeg.startBeat + liveSeg.lengthBeats,
                        name: duplicateSegmentName(pasted),
                    });
                },
            },
            {
                label: "Delete",
                icon: "ph:trash",
                onSelect: () => removeSegment(segmentId),
                separatorBefore: true,
            },
        ];
    });
    const left = startBeat * beatsToPx;
    const width = Math.max(beatsToPx / 2, lengthBeats * beatsToPx);
    const visualLayer = layer > 0 ? 1 : 0;
    const top = visualLayer * SEGMENT_LAYER_OFFSET_PX;
    const label = liveSeg?.name?.trim() || defaultName(payloadKind);
    const kindIcon = payloadKind === "midi"
        ? "ph:piano-keys"
        : payloadKind === "audio"
            ? "ph:music-notes-simple"
            : payloadKind === "drum"
                ? "ph:squares-four"
                : "ph:dots-three";
    return (_jsxs("div", { className: [
            styles.segment,
            selected && styles.selected,
            layer > 0 && styles.layered,
            repetition > 0 && styles.virtual,
        ]
            .filter(Boolean)
            .join(" "), style: { left, width, top, bottom: 0, zIndex: layer + 1 }, onDoubleClick: (e) => {
            e.stopPropagation();
            onEdit();
        }, onContextMenu: onContextMenu, children: [repetition === 0 && (_jsx("div", { className: `${styles.handle} ${styles.handleLeft}`, onPointerDown: (e) => startDrag("resize-left", e), onPointerMove: onPointerMove, onPointerUp: onPointerUp })), _jsxs("div", { className: styles.body, onPointerDown: (e) => startDrag("move", e), onPointerMove: onPointerMove, onPointerUp: onPointerUp, children: [_jsxs("div", { className: styles.labelStrip, children: [_jsxs("span", { className: styles.nameplate, children: [_jsx("span", { className: styles.nameText, children: label }), repetition > 0 && (_jsxs("span", { className: styles.repBadge, children: ["\u00D7", repetition + 1] }))] }), _jsx("span", { className: styles.kindIcon, "aria-hidden": true, children: _jsx(Icon, { name: kindIcon, size: 12, decorative: true }) })] }), _jsxs("div", { className: styles.content, children: [payloadKind === "midi" && liveSeg && (_jsx(SegmentMidiPreview, { segment: liveSeg })), payloadKind === "drum" && liveSeg && (_jsx(SegmentDrumPreview, { segment: liveSeg })), payloadKind === "audio" && liveSeg && (_jsx(SegmentWaveform, { segment: liveSeg }))] })] }), repetition === 0 && (_jsx("div", { className: `${styles.handle} ${styles.handleRight}`, onPointerDown: (e) => startDrag("resize-right", e), onPointerMove: onPointerMove, onPointerUp: onPointerUp })), menu] }));
}
/** Default display name when a segment hasn't been explicitly renamed.
 *  Auto-numbered names (e.g. "Midi 3") are picked at insertion time in
 *  TrackLane; this is the runtime fallback if `name` is empty. */
function defaultName(kind) {
    return kind === "midi" ? "Midi" : kind === "audio" ? "Audio" : kind === "drum" ? "Drums" : "Mixed";
}
function duplicateSegmentName(seg) {
    const kind = seg.payload.kind === "audio" ? "audio" : seg.payload.kind === "drum" ? "drum" : "midi";
    const stem = kind === "midi" ? "Midi" : kind === "audio" ? "Audio" : "Drums";
    const trimmed = seg.name?.trim() ?? "";
    if (!trimmed || new RegExp(`^${stem}\\s+\\d+$`).test(trimmed)) {
        return nextAutoSegmentName(kind);
    }
    return `${trimmed} copy`;
}
function nextAutoSegmentName(kind) {
    const stem = kind === "midi" ? "Midi" : kind === "audio" ? "Audio" : "Drums";
    const used = new Set();
    for (const track of useProjectStore.getState().project.tracks) {
        for (const segment of track.segments) {
            if (segment.payload.kind !== kind && (kind === "drum" || segment.payload.kind !== "mixed"))
                continue;
            const match = (segment.name ?? "").match(new RegExp(`^${stem}\\s+(\\d+)$`));
            if (match)
                used.add(parseInt(match[1], 10));
        }
    }
    let next = 1;
    while (used.has(next))
        next++;
    return `${stem} ${next}`;
}
const GRID_TICK_BEATS = 1;
