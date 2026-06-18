import { createEffect, createSignal, onCleanup } from "solid-js";
import { appAlert } from "../../solid-ui";
import { isNative, send } from "../../ipc/bridge";
import { saveCurrentDocument } from "../../persistence/documentActions";
import { createStoreSelector } from "../../solid-utils/store";
import { createContextMenu, HoverInfo, Icon, type ContextMenuItem } from "../../solid-ui";
import { useAudioFileStore, useDocumentStore, useInstrumentStore, useProjectStore, useUiStore, useViewStore } from "../../state/store";
import { InstrumentLibraryPanel } from "../InstrumentLibrary/InstrumentLibraryPanel.solid";
import { AudioFileLibraryPanel } from "../AudioFiles/AudioFileLibraryPanel.solid";
import { ComponentLibraryPanel } from "../ComponentLibrary/ComponentLibraryPanel.solid";
import { PluginLibraryPanel } from "../PluginLibrary/PluginLibraryPanel.solid";
import { DecentSamplerLibraryPanel } from "../PluginLibrary/DecentSamplerLibraryPanel.solid";
import styles from "./Sidebar.module.css";

type SidebarPanel = "instruments" | "audio" | "components" | "plugins" | "decentSampler";

const PANELS: Array<{ id: SidebarPanel; label: string; icon?: string; activeIcon?: string; kind?: "decentSampler" }> = [
  { id: "instruments", label: "Instruments", icon: "ph:piano-keys", activeIcon: "ph:piano-keys-fill" },
  { id: "audio", label: "Audio files", icon: "ph:music-note", activeIcon: "ph:music-note-fill" },
  { id: "components", label: "Components", icon: "ph:stack", activeIcon: "ph:stack-fill" },
  { id: "plugins", label: "Plugins", icon: "ph:share-network", activeIcon: "ph:share-network-fill" },
  { id: "decentSampler", label: "DecentSampler", kind: "decentSampler" },
];

export function Sidebar() {
  const width = createStoreSelector(useViewStore, (state) => state.sidebarWidth);
  const project = createStoreSelector(useProjectStore, (state) => state.project);
  const instruments = createStoreSelector(useInstrumentStore, (state) => state.instruments);
  const audioFiles = createStoreSelector(useAudioFileStore, (state) => state.files);
  const dirty = createStoreSelector(useDocumentStore, (state) => state.dirty);
  const documentOpen = createStoreSelector(useDocumentStore, (state) => state.documentOpen);
  const [dragging, setDragging] = createSignal(false);
  const [activePanel, setActivePanel] = createSignal<SidebarPanel>("instruments");
  let resizeStart: { x: number; width: number } | null = null;
  const saveMenu = createContextMenu((): ContextMenuItem[] => [
    { label: "Save", icon: "ph:floppy-disk", onSelect: () => void onSave() },
    { label: "Save as...", icon: "ph:floppy-disk-back", onSelect: () => void onSave({ saveAs: true }) },
  ]);

  createEffect(() => {
    if (!dragging()) return;
    const onMove = (event: PointerEvent) => {
      if (!resizeStart) return;
      useViewStore.getState().setSidebarWidth(resizeStart.width + (event.clientX - resizeStart.x));
    };
    const onUp = () => {
      setDragging(false);
      resizeStart = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    onCleanup(() => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    });
  });

  function onHandleDown(event: PointerEvent) {
    (event.target as Element).setPointerCapture(event.pointerId);
    resizeStart = { x: event.clientX, width: width() };
    setDragging(true);
  }

  async function onSave(options: { saveAs?: boolean } = {}) {
    try {
      await saveCurrentDocument(options);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[Beat] Save failed", error);
      await appAlert("Save failed.");
    }
  }

  async function onExport() {
    try {
      const result = await send({ kind: "project.exportWav", project: project(), instruments: instruments(), audioFiles: audioFiles() });
      if (result.error) {
        await appAlert(result.error);
      } else if (!result.path) {
        return;
      } else if (!isNative()) {
        await appAlert("WAV export ready.");
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[Beat] Export failed", error);
      await appAlert("Export failed.");
    }
  }

  return (
    <aside class={styles.sidebar} style={{ width: `${width()}px` }}>
      <nav class={styles.rail} aria-label="Library sections">
        <div class={styles.railGroup}>
          {PANELS.map((panel) => (
            <HoverInfo content={panel.label} placement="right">
              <button
                type="button"
                class={`${styles.railButton} ${activePanel() === panel.id ? styles.railButtonActive : ""}`}
                onClick={() => setActivePanel(panel.id)}
                aria-label={panel.label}
                aria-pressed={activePanel() === panel.id}
              >
                {panel.kind === "decentSampler" ? (
                  <DecentSamplerRailIcon />
                ) : (
                  <Icon
                    name={(activePanel() === panel.id ? panel.activeIcon : panel.icon) ?? "ph:square"}
                    size={16}
                    decorative
                  />
                )}
              </button>
            </HoverInfo>
          ))}
        </div>
        <div class={styles.railBottom}>
          <span class={styles.railSaveSlot}>
            <HoverInfo content="Save project" placement="right">
              <button
                type="button"
                class={styles.railButton}
                onClick={() => void onSave()}
                onContextMenu={saveMenu.onContextMenu}
                aria-label="Save"
              >
                <Icon name="ph:floppy-disk" size={16} decorative />
              </button>
            </HoverInfo>
            {documentOpen() && dirty() && <span class={styles.dirtyDot} aria-label="Unsaved changes" />}
            {saveMenu.menu()}
          </span>
          <HoverInfo content="Export WAV" placement="right">
            <button type="button" class={styles.railButton} onClick={() => void onExport()} aria-label="Export WAV">
              <Icon name="ph:export" size={16} decorative />
            </button>
          </HoverInfo>
          <HoverInfo content="Settings" placement="right">
            <button
              type="button"
              class={styles.railButton}
              onClick={() => useUiStore.getState().openEditor({ kind: "preferences" })}
              aria-label="Settings"
            >
              <Icon name="ph:gear" size={16} decorative />
            </button>
          </HoverInfo>
        </div>
      </nav>
      <div class={styles.content}>
        {activePanel() === "instruments" && (
          <InstrumentLibraryPanel
            expanded
            onToggle={() => setActivePanel("instruments")}
            onOpenDecentSampler={() => setActivePanel("decentSampler")}
          />
        )}
        {activePanel() === "audio" && (
          <AudioFileLibraryPanel
            expanded
            onToggle={() => setActivePanel("audio")}
          />
        )}
        {activePanel() === "components" && (
          <ComponentLibraryPanel
            expanded
            onToggle={() => setActivePanel("components")}
          />
        )}
        {activePanel() === "plugins" && (
          <PluginLibraryPanel
            expanded
            onToggle={() => setActivePanel("plugins")}
            onOpenDecentSampler={() => setActivePanel("decentSampler")}
          />
        )}
        {activePanel() === "decentSampler" && (
          <DecentSamplerLibraryPanel
            expanded
            onToggle={() => setActivePanel("decentSampler")}
          />
        )}
      </div>
      <div
        class={`${styles.resizeHandle} ${dragging() ? styles.dragging : ""}`}
        onPointerDown={onHandleDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />
    </aside>
  );
}

function DecentSamplerRailIcon() {
  return (
    <span class={styles.decentSamplerIcon} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <rect class={styles.decentSamplerIconFrame} x="3.5" y="3.5" width="17" height="17" />
        <text class={styles.decentSamplerIconGlyph} x="5.1" y="16.4">
          ds
        </text>
      </svg>
    </span>
  );
}
