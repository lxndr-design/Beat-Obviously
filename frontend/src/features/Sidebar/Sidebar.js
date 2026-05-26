import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { InstrumentLibraryPanel } from "../InstrumentLibrary/InstrumentLibraryPanel";
import { AudioFileLibraryPanel } from "../AudioFiles/AudioFileLibraryPanel";
import { ComponentLibraryPanel } from "../ComponentLibrary/ComponentLibraryPanel";
import { useViewStore } from "../../state/store";
import styles from "./Sidebar.module.css";
/**
 * Sidebar — left rail. Resizable via a 4px drag handle on the right edge.
 *
 *   ┌──────────────────┬─┐
 *   │ Instruments      │░│
 *   ├──────────────────┤░│
 *   │ Components       │░│
 *   └──────────────────┴─┘
 *
 * Width persists in useViewStore.sidebarWidth (160px..480px).
 */
export function Sidebar() {
    const width = useViewStore((s) => s.sidebarWidth);
    const setWidth = useViewStore((s) => s.setSidebarWidth);
    const [dragging, setDragging] = useState(false);
    const startRef = useRef(null);
    function onHandleDown(e) {
        e.target.setPointerCapture(e.pointerId);
        startRef.current = { x: e.clientX, w: width };
        setDragging(true);
    }
    useEffect(() => {
        if (!dragging)
            return;
        function onMove(e) {
            if (!startRef.current)
                return;
            setWidth(startRef.current.w + (e.clientX - startRef.current.x));
        }
        function onUp() {
            setDragging(false);
            startRef.current = null;
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
    }, [dragging, setWidth]);
    return (_jsxs("aside", { className: styles.sidebar, style: { width }, children: [_jsx("div", { className: styles.section, children: _jsx(InstrumentLibraryPanel, {}) }), _jsx("div", { className: styles.section, children: _jsx(AudioFileLibraryPanel, {}) }), _jsx("div", { className: styles.section, children: _jsx(ComponentLibraryPanel, {}) }), _jsx("div", { className: `${styles.resizeHandle} ${dragging ? styles.dragging : ""}`, onPointerDown: onHandleDown, role: "separator", "aria-orientation": "vertical", "aria-label": "Resize sidebar" })] }));
}
