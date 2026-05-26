import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button, HoverInfo, Icon, useContextMenu } from "../../components";
import { send } from "../../ipc/bridge";
import { useAudioFileStore } from "../../state/store";
import styles from "./AudioFileLibraryPanel.module.css";
export function AudioFileLibraryPanel() {
    const files = useAudioFileStore((s) => s.files);
    const addFile = useAudioFileStore((s) => s.addFile);
    const removeFile = useAudioFileStore((s) => s.removeFile);
    const [expanded, setExpanded] = useState(true);
    async function upload() {
        const resp = await send({ kind: "audio.import" });
        if (resp.file)
            addFile(resp.file);
    }
    return (_jsxs("div", { className: styles.panel, children: [_jsxs("div", { className: styles.header, children: [_jsx("button", { type: "button", className: styles.chevronBtn, onClick: () => setExpanded(!expanded), "aria-label": expanded ? "Collapse audio files" : "Expand audio files", children: _jsx(Icon, { name: expanded ? "ph:caret-down" : "ph:caret-right", size: 16, decorative: true }) }), _jsx("span", { className: styles.headerLabel, children: "Audio files" }), _jsx(Button, { iconOnly: true, size: "sm", onClick: upload, "aria-label": "Upload audio file", children: _jsx(Icon, { name: "ph:plus", size: 16, decorative: true }) })] }), expanded && (_jsxs("ul", { className: styles.list, children: [files.length === 0 && _jsx("li", { className: styles.empty, children: "No audio files yet." }), files.map((file) => (_jsx(AudioFileItem, { id: file.id, name: file.name, durationSeconds: file.durationSeconds, onRemove: () => removeFile(file.id) }, file.id)))] }))] }));
}
function AudioFileItem({ id, name, durationSeconds, onRemove }) {
    const { onContextMenu, menu } = useContextMenu(() => [
        {
            label: "Delete",
            icon: "ph:trash",
            onSelect: onRemove,
        },
    ]);
    function onDragStart(e) {
        e.dataTransfer.setData("application/x-beat-audio-file", id);
        e.dataTransfer.setData("text/plain", name);
        e.dataTransfer.effectAllowed = "copy";
    }
    return (_jsxs("li", { className: styles.item, draggable: true, onDragStart: onDragStart, onContextMenu: onContextMenu, children: [_jsx("span", { className: styles.itemDot, "aria-hidden": true, children: _jsx(Icon, { name: "ph:dots-six-vertical", size: 14, decorative: true }) }), _jsx("span", { className: styles.itemName, children: name }), _jsx(HoverInfo, { content: formatDuration(durationSeconds), children: _jsx("span", { className: styles.itemMeta, children: _jsx(Icon, { name: "ph:waveform", size: 14, decorative: true }) }) }), menu] }));
}
function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}
