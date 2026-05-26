import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Icon, useContextMenu, HoverInfo } from "../../components";
import { useComponentStore } from "../../state/components";
import styles from "./ComponentLibraryPanel.module.css";
/**
 * ComponentLibraryPanel — sidebar Components section.
 *
 * Mirrors InstrumentLibraryPanel: collapsible header + indented list.
 * Components are draggable onto track lanes (mime: x-beat-component).
 */
export function ComponentLibraryPanel() {
    const components = useComponentStore((s) => s.components);
    const remove = useComponentStore((s) => s.remove);
    const rename = useComponentStore((s) => s.rename);
    const [expanded, setExpanded] = useState(true);
    return (_jsxs("div", { className: styles.panel, children: [_jsxs("div", { className: styles.header, children: [_jsx("button", { type: "button", className: styles.chevronBtn, onClick: () => setExpanded(!expanded), "aria-label": expanded ? "Collapse components" : "Expand components", children: _jsx(Icon, { name: expanded ? "ph:caret-down" : "ph:caret-right", size: 16, decorative: true }) }), _jsx("span", { className: styles.headerLabel, children: "Components" }), _jsx("span", { className: styles.headerCount, children: components.length })] }), expanded && (_jsxs("ul", { className: styles.list, children: [components.length === 0 && (_jsx("li", { className: styles.empty, children: "Right-click a MIDI or drum segment to save it as a component." })), components.map((c) => (_jsx(ComponentItem, { id: c.id, name: c.name, kind: c.kind ?? "midi", lengthBeats: c.lengthBeats, itemCount: c.kind === "drum"
                            ? c.rows.reduce((sum, row) => sum + row.steps.filter(Boolean).length, 0)
                            : c.notes.length, onRemove: () => remove(c.id), onRename: () => {
                            const next = window.prompt("Component name", c.name);
                            if (next != null)
                                rename(c.id, next);
                        } }, c.id)))] }))] }));
}
function ComponentItem({ id, name, kind, lengthBeats, itemCount, onRemove, onRename, }) {
    const { onContextMenu, menu } = useContextMenu(() => [
        { label: "Rename", icon: "ph:pencil-simple", onSelect: onRename },
        {
            label: "Delete",
            icon: "ph:trash",
            onSelect: onRemove,
            separatorBefore: true,
        },
    ]);
    function onDragStart(e) {
        e.dataTransfer.setData("application/x-beat-component", id);
        e.dataTransfer.setData("text/plain", name);
        e.dataTransfer.effectAllowed = "copy";
    }
    return (_jsxs("li", { className: styles.item, draggable: true, onDragStart: onDragStart, onContextMenu: onContextMenu, children: [_jsx("span", { className: styles.itemDot, "aria-hidden": true, children: _jsx(Icon, { name: "ph:dots-six-vertical", size: 14, decorative: true }) }), _jsx("span", { className: styles.itemName, children: name }), _jsx(HoverInfo, { content: `${itemCount} ${kind === "drum" ? "hit" : "note"}${itemCount === 1 ? "" : "s"} · ${lengthBeats} beats`, children: _jsx("span", { className: styles.itemMeta, children: _jsx(Icon, { name: kind === "drum" ? "ph:drum" : "ph:piano-keys", size: 14, decorative: true }) }) }), menu] }));
}
