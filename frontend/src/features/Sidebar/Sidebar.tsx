import { useEffect, useRef, useState } from "react";
import { InstrumentLibraryPanel } from "../InstrumentLibrary/InstrumentLibraryPanel";
import { AudioFileLibraryPanel } from "../AudioFiles/AudioFileLibraryPanel";
import { ComponentLibraryPanel } from "../ComponentLibrary/ComponentLibraryPanel";
import { PluginLibraryPanel } from "../PluginLibrary/PluginLibraryPanel";
import { DecentSamplerLibraryPanel } from "../PluginLibrary/DecentSamplerLibraryPanel";
import { HoverInfo, Icon } from "../../components";
import { isNative, send } from "../../ipc/bridge";
import { saveCurrentDocument } from "../../persistence/documentActions";
import { useAudioFileStore, useDocumentStore, useInstrumentStore, useProjectStore, useUiStore, useViewStore } from "../../state/store";
import styles from "./Sidebar.module.css";

type SidebarPanel = "instruments" | "audio" | "components" | "plugins" | "decentSampler";

const PANELS: Array<{ id: SidebarPanel; label: string; icon: string }> = [
  { id: "instruments", label: "Instruments", icon: "ph:piano-keys" },
  { id: "audio", label: "Audio files", icon: "ph:music-note" },
  { id: "components", label: "Components", icon: "ph:stack" },
  { id: "plugins", label: "Plugins", icon: "ph:share-network" },
];

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
  const openEditor = useUiStore((s) => s.openEditor);
  const project = useProjectStore((s) => s.project);
  const instruments = useInstrumentStore((s) => s.instruments);
  const audioFiles = useAudioFileStore((s) => s.files);
  const dirty = useDocumentStore((s) => s.dirty);
  const documentOpen = useDocumentStore((s) => s.documentOpen);
  const [dragging, setDragging] = useState(false);
  const [activePanel, setActivePanel] = useState<SidebarPanel>("instruments");
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

  async function onSave() {
    try {
      await saveCurrentDocument();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[Beat] Save failed", error);
      window.alert("Save failed.");
    }
  }

  async function onExport() {
    try {
      const result = await send({ kind: "project.exportWav", project, instruments, audioFiles });
      if (result.error) {
        window.alert(result.error);
      } else if (!result.path) {
        return;
      } else if (!isNative()) {
        window.alert("WAV export ready.");
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[Beat] Export failed", error);
      window.alert("Export failed.");
    }
  }

  return (
    <aside className={styles.sidebar} style={{ width }}>
      <nav className={styles.rail} aria-label="Library sections">
        <div className={styles.railGroup}>
          {PANELS.map((panel) => (
            <HoverInfo key={panel.id} content={panel.label} placement="right">
              <button
                type="button"
                className={`${styles.railButton} ${activePanel === panel.id ? styles.railButtonActive : ""}`}
                onClick={() => setActivePanel(panel.id)}
                aria-label={panel.label}
                aria-pressed={activePanel === panel.id}
              >
                <Icon name={panel.icon} size={16} decorative />
              </button>
            </HoverInfo>
          ))}
          <HoverInfo content="DecentSampler" placement="right">
            <button
              type="button"
              className={`${styles.railButton} ${activePanel === "decentSampler" ? styles.railButtonActive : ""}`}
              onClick={() => setActivePanel("decentSampler")}
              aria-label="DecentSampler compatibility"
              aria-pressed={activePanel === "decentSampler"}
            >
              <img className={styles.decentSamplerIcon} src="/assets/decent-sampler.png" alt="" aria-hidden="true" />
            </button>
          </HoverInfo>
        </div>
        <div className={styles.railBottom}>
          <span className={styles.railSaveSlot}>
            <HoverInfo content="Save project" placement="right">
              <button
                type="button"
                className={styles.railButton}
                onClick={() => void onSave()}
                aria-label="Save"
              >
                <Icon name="ph:floppy-disk" size={16} decorative />
              </button>
            </HoverInfo>
            {documentOpen && dirty && <span className={styles.dirtyDot} aria-label="Unsaved changes" />}
          </span>
          <HoverInfo content="Export WAV" placement="right">
            <button
              type="button"
              className={styles.railButton}
              onClick={() => void onExport()}
              aria-label="Export WAV"
            >
              <Icon name="ph:export" size={16} decorative />
            </button>
          </HoverInfo>
          <HoverInfo content="Settings" placement="right">
            <button
              type="button"
              className={styles.railButton}
              onClick={() => openEditor({ kind: "preferences" })}
              aria-label="Settings"
            >
              <Icon name="ph:gear" size={16} decorative />
            </button>
          </HoverInfo>
        </div>
      </nav>
      <div className={styles.content}>
        {activePanel === "instruments" && (
          <InstrumentLibraryPanel
            expanded
            onToggle={() => setActivePanel("instruments")}
          />
        )}
        {activePanel === "audio" && (
          <AudioFileLibraryPanel
            expanded
            onToggle={() => setActivePanel("audio")}
          />
        )}
        {activePanel === "components" && (
          <ComponentLibraryPanel
            expanded
            onToggle={() => setActivePanel("components")}
          />
        )}
        {activePanel === "plugins" && (
          <PluginLibraryPanel
            expanded
            onToggle={() => setActivePanel("plugins")}
          />
        )}
        {activePanel === "decentSampler" && (
          <DecentSamplerLibraryPanel
            expanded
            onToggle={() => setActivePanel("decentSampler")}
          />
        )}
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
