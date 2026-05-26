import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { nanoid as newNanoid } from "nanoid";
import { Icon, HoverInfo, useContextMenu } from "../../components";
import { useProjectStore } from "../../state/store";
import styles from "./TrackHeader.module.css";
const DND_MIME = "application/x-beat-track";
/**
 * TrackHeader — sticky left column for a single track.
 *
 *   ≡  Track Name (dbl-click to edit)   [S] [M]
 *
 * The ≡ drag handle is `draggable`: drag a track up/down to reorder. Drop
 * above the target row inserts before; drop on the lower half inserts after.
 *
 * Right-click → Mute/Solo/Rename/Duplicate/Delete. The ContextMenu hook
 * stops propagation so the outer TrackList area doesn't intercept it.
 */
export function TrackHeader({ trackId, index }) {
    const track = useProjectStore((s) => s.project.tracks.find((t) => t.id === trackId));
    const updateTrack = useProjectStore((s) => s.updateTrack);
    const setTrackSolo = useProjectStore((s) => s.setTrackSolo);
    const setTrackMute = useProjectStore((s) => s.setTrackMute);
    const removeTrack = useProjectStore((s) => s.removeTrack);
    const reorderTracks = useProjectStore((s) => s.reorderTracks);
    const duplicateTrack = useDuplicateTrack();
    const [editingName, setEditingName] = useState(false);
    const [dropPosition, setDropPosition] = useState(null);
    const { onContextMenu, menu } = useContextMenu(() => {
        if (!track)
            return [];
        return [
            {
                label: track.mute ? "Unmute" : "Mute",
                icon: track.mute ? "ph:speaker-high" : "ph:speaker-x",
                onSelect: () => setTrackMute(trackId, !track.mute),
                disabled: track.solo,
            },
            {
                label: track.solo ? "Unsolo" : "Solo",
                icon: "ph:headphones",
                onSelect: () => setTrackSolo(trackId, !track.solo),
            },
            {
                label: "Rename",
                icon: "ph:pencil-simple",
                onSelect: () => setEditingName(true),
                separatorBefore: true,
            },
            {
                label: "Duplicate track",
                icon: "ph:copy",
                onSelect: () => duplicateTrack(trackId),
            },
            {
                label: "Delete track",
                icon: "ph:trash",
                onSelect: () => removeTrack(trackId),
                separatorBefore: true,
            },
        ];
    });
    // ----- Reorder DnD -----------------------------------------------------
    function onHandleDragStart(e) {
        e.dataTransfer.setData(DND_MIME, trackId);
        e.dataTransfer.effectAllowed = "move";
    }
    function onRowDragOver(e) {
        if (!e.dataTransfer.types.includes(DND_MIME))
            return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = e.currentTarget.getBoundingClientRect();
        setDropPosition(e.clientY < r.top + r.height / 2 ? "above" : "below");
    }
    function onRowDragLeave() {
        setDropPosition(null);
    }
    function onRowDrop(e) {
        const draggedId = e.dataTransfer.getData(DND_MIME);
        const placedBelow = dropPosition === "below";
        setDropPosition(null);
        if (!draggedId || draggedId === trackId)
            return;
        const { project } = useProjectStore.getState();
        const order = project.tracks.map((t) => t.id).filter((id) => id !== draggedId);
        let target = order.indexOf(trackId);
        if (placedBelow)
            target++;
        order.splice(target, 0, draggedId);
        reorderTracks(order);
    }
    if (!track)
        return null;
    return (_jsxs("div", { className: [
            styles.header,
            dropPosition === "above" && styles.dropAbove,
            dropPosition === "below" && styles.dropBelow,
        ]
            .filter(Boolean)
            .join(" "), onContextMenu: onContextMenu, onDragOver: onRowDragOver, onDragLeave: onRowDragLeave, onDrop: onRowDrop, "data-track-index": index, children: [_jsx("span", { className: styles.dragHandle, draggable: true, onDragStart: onHandleDragStart, "aria-hidden": true, children: _jsx(Icon, { name: "ph:dots-six-vertical", size: 16, decorative: true }) }), editingName ? (_jsx("input", { className: styles.nameInput, autoFocus: true, value: track.name, onChange: (e) => updateTrack(trackId, { name: e.target.value }), onBlur: () => setEditingName(false), onKeyDown: (e) => {
                    if (e.key === "Enter" || e.key === "Escape")
                        setEditingName(false);
                } })) : (_jsx("button", { type: "button", className: styles.name, onDoubleClick: () => setEditingName(true), title: "Double-click to rename", children: track.name })), _jsxs("div", { className: styles.controls, children: [_jsx(HoverInfo, { content: track.solo ? "Unsolo" : "Solo (mute others)", children: _jsx("button", { type: "button", className: `${styles.dot} ${track.solo ? styles.dotOn : ""}`, onClick: () => setTrackSolo(trackId, !track.solo), "aria-label": track.solo ? "Unsolo" : "Solo", children: "S" }) }), _jsx(HoverInfo, { content: track.solo ? "Soloed — can't mute" : track.mute ? "Unmute" : "Mute", children: _jsx("button", { type: "button", className: `${styles.dot} ${track.mute ? styles.dotOn : ""}`, onClick: () => setTrackMute(trackId, !track.mute), "aria-label": track.mute ? "Unmute" : "Mute", disabled: track.solo, children: "M" }) })] }), menu] }));
}
function useDuplicateTrack() {
    return (trackId) => {
        const { project, loadProject } = useProjectStore.getState();
        const idx = project.tracks.findIndex((t) => t.id === trackId);
        if (idx < 0)
            return;
        const src = project.tracks[idx];
        const newId = newNanoid();
        const copy = {
            ...structuredClone(src),
            id: newId,
            name: `${src.name} copy`,
            segments: src.segments.map((s) => ({
                ...structuredClone(s),
                id: newNanoid(),
                trackId: newId,
            })),
        };
        const tracks = [...project.tracks];
        tracks.splice(idx + 1, 0, copy);
        loadProject({ ...project, tracks });
    };
}
