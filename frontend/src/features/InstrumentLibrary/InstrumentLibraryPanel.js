import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button, Icon, useContextMenu, HoverInfo } from "../../components";
import { useInstrumentStore, useUiStore } from "../../state/store";
import { MergeInstrumentModal } from "./MergeInstrumentModal";
import styles from "./InstrumentLibraryPanel.module.css";
const KIND_ICON = {
    synth: "ph:piano-keys", // three piano keys
    sampler: "ph:music-notes", // musical notes
    hybrid: "ph:waveform", // squiggle
};
const KIND_HINT = {
    synth: "Synth",
    sampler: "Sampler",
    hybrid: "Hybrid",
};
/**
 * InstrumentLibraryPanel — sidebar Library section.
 *
 * Layout:
 *   ┌─────────────────────────────────────┐
 *   │ ▾  LIBRARY                       +  │   ← header: chevron, label, add
 *   ├─────────────────────────────────────┤
 *   │   ▸ kick                  synth     │   ← indented list
 *   │   ▸ snare                 sampler   │
 *   └─────────────────────────────────────┘
 *
 * Right-click an instrument for Edit / Duplicate / Merge / Delete.
 * System instruments are not deletable (userCreated === false).
 */
export function InstrumentLibraryPanel() {
    const instruments = useInstrumentStore((s) => s.instruments);
    const addInstrument = useInstrumentStore((s) => s.addInstrument);
    const duplicate = useInstrumentStore((s) => s.duplicateInstrument);
    const remove = useInstrumentStore((s) => s.removeInstrument);
    const openEditor = useUiStore((s) => s.openEditor);
    const [expanded, setExpanded] = useState(true);
    const [mergeFromId, setMergeFromId] = useState(null);
    function createNew() {
        const id = addInstrument({ name: "New Instrument", userCreated: true });
        openEditor({ kind: "instrument", instrumentId: id });
    }
    return (_jsxs("div", { className: styles.panel, children: [_jsxs("div", { className: styles.header, children: [_jsx("button", { type: "button", className: styles.chevronBtn, onClick: () => setExpanded(!expanded), "aria-label": expanded ? "Collapse instruments" : "Expand instruments", children: _jsx(Icon, { name: expanded ? "ph:caret-down" : "ph:caret-right", size: 16, decorative: true }) }), _jsx("span", { className: styles.headerLabel, children: "Instruments" }), _jsx(Button, { iconOnly: true, size: "sm", onClick: createNew, "aria-label": "New instrument", children: _jsx(Icon, { name: "ph:plus", size: 16, decorative: true }) })] }), expanded && (_jsxs("ul", { className: styles.list, children: [instruments.length === 0 && (_jsx("li", { className: styles.empty, children: "No instruments yet." })), instruments.map((i) => (_jsx(InstrumentItem, { id: i.id, name: i.name, kind: i.kind, sampleUrl: i.sampleUrl, userCreated: i.userCreated, onEdit: () => openEditor({ kind: "instrument", instrumentId: i.id }), onDuplicate: () => duplicate(i.id), onMerge: () => setMergeFromId(i.id), onDelete: () => remove(i.id) }, i.id)))] })), mergeFromId && (_jsx(MergeInstrumentModal, { sourceId: mergeFromId, onClose: () => setMergeFromId(null) }))] }));
}
function InstrumentItem({ id, name, kind, sampleUrl, userCreated, onEdit, onDuplicate, onMerge, onDelete, }) {
    const { onContextMenu, menu } = useContextMenu(() => [
        { label: "Edit", icon: "ph:pencil-simple", onSelect: onEdit },
        { label: "Duplicate", icon: "ph:copy", onSelect: onDuplicate },
        { label: "Merge with…", icon: "ph:intersect", onSelect: onMerge },
        {
            label: userCreated ? "Delete" : "Delete (system)",
            icon: "ph:trash",
            onSelect: onDelete,
            disabled: !userCreated,
            separatorBefore: true,
        },
    ]);
    function onDragStart(e) {
        e.dataTransfer.setData("application/x-beat-instrument", id);
        e.dataTransfer.setData("text/plain", name);
        e.dataTransfer.effectAllowed = "copy";
    }
    const drum = isDrumInstrument(name, sampleUrl);
    const iconName = drum ? "ph:drum" : KIND_ICON[kind] ?? "ph:question";
    const hint = drum ? "Drum" : KIND_HINT[kind] ?? kind;
    return (_jsxs("li", { className: styles.item, draggable: true, onDragStart: onDragStart, onDoubleClick: onEdit, onContextMenu: onContextMenu, children: [_jsx("span", { className: styles.itemDot, "aria-hidden": true, children: _jsx(Icon, { name: "ph:dots-six-vertical", size: 14, decorative: true }) }), _jsx("span", { className: styles.itemName, children: name }), _jsx(HoverInfo, { content: hint, children: _jsx("span", { className: styles.itemKindIcon, "aria-label": hint, children: _jsx(Icon, { name: iconName, size: 14, decorative: true }) }) }), menu] }));
}
function isDrumInstrument(name, sampleUrl) {
    if (sampleUrl?.startsWith("/samples/tr505/") || sampleUrl?.startsWith("/samples/cr78/"))
        return true;
    return /\b(808|kick|snare|hat|tom|clap|rim|ride|crash|cymbal|cowbell|conga|timbal|tamb|guiro|triangle)\b/i.test(name);
}
