import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { Block, Button, Icon, HoverInfo } from "../../components";
import { useProjectStore, useViewStore } from "../../state/store";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { Timeline } from "./Timeline";
import { Playhead } from "./Playhead";
import styles from "./TrackList.module.css";
const ZOOM_STEP = 8;
const MIN_ZOOM = 16;
const MAX_ZOOM = 192;
/**
 * TrackList — main center panel.
 *
 * The lane area is wrapped in a positioning context so the zoom cluster
 * can `position: absolute` to the **viewport** of the lanes (bottom-right,
 * 8px inset), not the scroll content.
 */
export function TrackList() {
    const tracks = useProjectStore((s) => s.project.tracks);
    const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
    const addTrack = useProjectStore((s) => s.addTrack);
    const beatsToPx = useViewStore((s) => s.beatsToPx);
    const setZoom = useViewStore((s) => s.setZoom);
    const laneScrollRef = useRef(null);
    function onWheel(e) {
        if (!(e.ctrlKey || e.metaKey))
            return;
        e.preventDefault();
        const dir = e.deltaY > 0 ? -1 : 1;
        setZoom(beatsToPx + dir * ZOOM_STEP);
    }
    return (_jsx(Block, { title: "Tracks", framed: true, fill: true, children: _jsxs("div", { className: styles.area, children: [_jsxs("div", { className: styles.headerCol, children: [tracks.map((t, i) => (_jsx(TrackHeader, { trackId: t.id, index: i }, t.id))), _jsxs("button", { type: "button", className: styles.addRow, onClick: () => addTrack({}), "aria-label": "Add track", children: [_jsx(Icon, { name: "ph:plus", size: 16, decorative: true }), _jsx("span", { children: "Add track" })] }), _jsx("div", { className: styles.timelineSpacer, "aria-hidden": true })] }), _jsxs("div", { className: styles.laneWrap, children: [_jsx("div", { ref: laneScrollRef, className: styles.laneScroll, onWheel: onWheel, children: _jsxs("div", { className: styles.lanesInner, style: { width: lengthBeats * beatsToPx }, children: [tracks.map((t) => (_jsx(TrackLane, { trackId: t.id }, t.id))), _jsx("div", { className: styles.addRowLaneSpacer }), _jsx(Playhead, {}), _jsx(Timeline, {})] }) }), _jsxs("div", { className: styles.zoomFloat, children: [_jsx(HoverInfo, { content: "Zoom out", children: _jsx(Button, { iconOnly: true, size: "xs", onClick: () => setZoom(Math.max(MIN_ZOOM, beatsToPx - ZOOM_STEP)), "aria-label": "Zoom out", children: _jsx(Icon, { name: "ph:magnifying-glass-minus", size: 16, decorative: true }) }) }), _jsx(HoverInfo, { content: "Zoom in", children: _jsx(Button, { iconOnly: true, size: "xs", onClick: () => setZoom(Math.min(MAX_ZOOM, beatsToPx + ZOOM_STEP)), "aria-label": "Zoom in", children: _jsx(Icon, { name: "ph:magnifying-glass-plus", size: 16, decorative: true }) }) })] })] })] }) }));
}
