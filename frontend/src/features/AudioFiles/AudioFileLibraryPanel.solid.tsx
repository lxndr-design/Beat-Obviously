/** @jsxImportSource solid-js */
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Button, HoverInfo, Icon, RowItem, SectionRibbon, SectionRibbonActionButton, createContextMenu, type ContextMenuItem } from "../../solid-ui";
import { appAlert, appConfirm } from "../../components";
import { isSupportedAudioFileName, SUPPORTED_AUDIO_IMPORT_LABEL } from "../../audio/audioFormats";
import { importAudioFile } from "../../audio/audioImport";
import { useAudioFileStore } from "../../state/store";
import type { AudioFile } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { ImportInstrumentModalSolid } from "../InstrumentLibrary/ImportInstrumentModal.solid";
import styles from "./AudioFileLibraryPanel.module.css";

interface AudioFileLibraryPanelProps {
  expanded: boolean;
  onToggle: () => void;
}

export function AudioFileLibraryPanelSolid(props: AudioFileLibraryPanelProps) {
  const files = createStoreSelector(useAudioFileStore, (s) => s.files);
  const [selectMode, setSelectMode] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set(), { equals: false });
  const [lastSelectedId, setLastSelectedId] = createSignal<string | null>(null);
  const [groupingFiles, setGroupingFiles] = createSignal<AudioFile[] | null>(null);
  let panelElement: HTMLDivElement | undefined;
  const panelMenu = createContextMenu((): ContextMenuItem[] => [
    {
      label: "Select",
      icon: "ph:checks",
      onSelect: () => enterSelectMode(),
    },
  ]);

  const selectedFiles = () => files().filter((file) => selectedIds().has(file.id));

  createEffect(() => {
    if (!selectMode()) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") exitSelectMode();
    }

    function onPointerDown(event: PointerEvent) {
      if (panelElement?.contains(event.target as Node)) return;
      exitSelectMode();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    });
  });

  async function upload() {
    const file = await importAudioFile();
    if (!file) return;
    if (!isSupportedAudioFileName(file.name) && !isSupportedAudioFileName(file.path)) {
      await appAlert(`Unsupported audio file. Supported formats: ${SUPPORTED_AUDIO_IMPORT_LABEL}.`);
      return;
    }
    useAudioFileStore.getState().addFile(file);
  }

  function enterSelectMode(fileId?: string) {
    setSelectMode(true);
    if (fileId) {
      setSelectedIds(new Set([fileId]));
      setLastSelectedId(fileId);
    }
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set<string>());
    setLastSelectedId(null);
  }

  function selectFile(fileId: string, shiftKey: boolean) {
    setSelectMode(true);
    const current = selectedIds();
    if (shiftKey && lastSelectedId()) {
      const start = files().findIndex((file) => file.id === lastSelectedId());
      const end = files().findIndex((file) => file.id === fileId);
      if (start >= 0 && end >= 0) {
        const [lo, hi] = start < end ? [start, end] : [end, start];
        setSelectedIds(new Set([...current, ...files().slice(lo, hi + 1).map((file) => file.id)]));
        setLastSelectedId(fileId);
        return;
      }
    }

    const next = new Set(current);
    if (next.has(fileId)) next.delete(fileId);
    else next.add(fileId);
    setSelectedIds(next);
    setLastSelectedId(fileId);
  }

  async function deleteSelected() {
    if (!await appConfirm(`Delete ${selectedFiles().length} audio file${selectedFiles().length === 1 ? "" : "s"} from this project?`)) return;
    for (const file of selectedFiles()) useAudioFileStore.getState().removeFile(file.id);
    exitSelectMode();
  }

  async function deleteFile(file: AudioFile) {
    if (!await appConfirm(`Delete "${file.name}" from this project?`)) return;
    useAudioFileStore.getState().removeFile(file.id);
  }

  function groupSelected() {
    if (selectedFiles().length === 0) return;
    setGroupingFiles(selectedFiles());
  }

  return (
    <div ref={panelElement} class={styles.panel} onContextMenu={panelMenu.onContextMenu}>
      <SectionRibbon
        title="Audio Files"
        expanded={props.expanded}
        onToggle={props.onToggle}
        showToggle={false}
        onContextMenu={panelMenu.onContextMenu}
        actions={(
          <HoverInfo content={`Upload ${SUPPORTED_AUDIO_IMPORT_LABEL}`}>
            <SectionRibbonActionButton onClick={() => void upload()} aria-label="Upload audio file">
              <Icon name="ph:plus" size={16} decorative />
            </SectionRibbonActionButton>
          </HoverInfo>
        )}
      />
      <Show when={selectMode() && props.expanded}>
        <div class={styles.selectionBar}>
          <Button size="xs" disabled={selectedFiles().length === 0} onClick={() => void deleteSelected()}>
            Delete
          </Button>
          <Button size="xs" disabled={selectedFiles().length === 0} onClick={groupSelected}>
            Group
          </Button>
          <span class={styles.selectionCount}>{selectedFiles().length}</span>
        </div>
      </Show>

      <ul class={`${styles.list} ${props.expanded ? styles.listOpen : ""}`} aria-hidden={!props.expanded}>
        <Show when={files().length === 0}>
          <li class={styles.empty}>No audio files yet.</li>
        </Show>
        <For each={files()}>
          {(file) => (
            <AudioFileItem
              file={file}
              selectMode={selectMode()}
              selected={selectedIds().has(file.id)}
              onSelect={(event) => selectFile(file.id, event.shiftKey)}
              onEnterSelectMode={() => enterSelectMode(file.id)}
              onRemove={() => void deleteFile(file)}
            />
          )}
        </For>
      </ul>
      {panelMenu.menu()}
      <Show when={groupingFiles()}>
        {(currentGroupingFiles) => (
          <ImportInstrumentModalSolid
            initialFiles={currentGroupingFiles()}
            onImportedFiles={(imported) => {
              for (const file of imported) useAudioFileStore.getState().removeFile(file.id);
              exitSelectMode();
            }}
            onClose={() => setGroupingFiles(null)}
          />
        )}
      </Show>
    </div>
  );
}

interface AudioFileItemProps {
  file: AudioFile;
  selectMode: boolean;
  selected: boolean;
  onSelect: (event: MouseEvent) => void;
  onEnterSelectMode: () => void;
  onRemove: () => void;
}

function AudioFileItem(props: AudioFileItemProps) {
  const menu = createContextMenu((): ContextMenuItem[] => [
    {
      label: "Select",
      icon: "ph:checks",
      onSelect: props.onEnterSelectMode,
    },
    {
      label: "Delete",
      icon: "ph:trash",
      onSelect: props.onRemove,
      separatorBefore: true,
    },
  ]);

  function onDragStart(event: DragEvent) {
    event.dataTransfer?.setData("application/x-beat-audio-file", props.file.id);
    event.dataTransfer?.setData("text/plain", props.file.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
  }

  return (
    <RowItem
      className={`${styles.item} ${props.selected ? styles.itemSelected : ""} ${props.selectMode ? styles.itemSelecting : ""}`}
      reserveDragSlot={false}
      cursor={props.selectMode ? "pointer" : "grab"}
      draggable={!props.selectMode}
      onClick={(event) => {
        if (!props.selectMode) return;
        props.onSelect(event);
      }}
      onDragStart={onDragStart}
      onContextMenu={menu.onContextMenu}
      iconAriaHidden={!props.selectMode}
      icon={props.selectMode ? (
        <input
          class={styles.itemCheckbox}
          type="checkbox"
          checked={props.selected}
          readOnly
          onClick={(event) => {
            event.stopPropagation();
            props.onSelect(event);
          }}
          aria-label={`Select ${props.file.name}`}
        />
      ) : (
        <span class={styles.itemDot} aria-hidden>
          <Icon name="ph:dots-six-vertical" size={14} decorative />
        </span>
      )}
      name={props.file.name}
      action={(
        <HoverInfo content={formatDuration(props.file.durationSeconds)}>
          <span class={styles.itemMeta}>
            <Icon name="ph:waveform" size={14} decorative />
          </span>
        </HoverInfo>
      )}
    >
      {menu.menu()}
    </RowItem>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
