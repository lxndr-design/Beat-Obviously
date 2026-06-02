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
  const [openPanel, setOpenPanel] = useState<"instruments" | "audio" | "components" | null>("instruments");
  const startRef = useRef<{ x: number; w: number } | null>(null);

  function onHandleDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, w: width };
    setDragging(true);
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      if (!startRef.current) return;
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

  return (
    <aside className={styles.sidebar} style={{ width }}>
      <div className={styles.section}>
        <InstrumentLibraryPanel
          expanded={openPanel === "instruments"}
          onToggle={() => setOpenPanel(openPanel === "instruments" ? null : "instruments")}
        />
      </div>
      <div className={styles.section}>
        <AudioFileLibraryPanel
          expanded={openPanel === "audio"}
          onToggle={() => setOpenPanel(openPanel === "audio" ? null : "audio")}
        />
      </div>
      <div className={styles.section}>
        <ComponentLibraryPanel
          expanded={openPanel === "components"}
          onToggle={() => setOpenPanel(openPanel === "components" ? null : "components")}
        />
      </div>
      <div
        className={`${styles.resizeHandle} ${dragging ? styles.dragging : ""}`}
        onPointerDown={onHandleDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />
    </aside>
  );
}
