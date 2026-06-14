import { useEffect, useMemo, useRef, useState } from "react";
import { Button, HoverInfo, Icon, RowItem, SectionRibbon, SectionRibbonActionButton, appAlert, useContextMenu, type ContextMenuItem } from "../../components";
import { isSupportedAudioFileName, SUPPORTED_AUDIO_IMPORT_LABEL } from "../../audio/audioFormats";
import { importAudioFile } from "../../audio/audioImport";
import { useAudioFileStore } from "../../state/store";
import type { AudioFile } from "../../state/types";
import { ImportInstrumentModal } from "../InstrumentLibrary/ImportInstrumentModal";
import styles from "./AudioFileLibraryPanel.module.css";

interface AudioFileLibraryPanelProps {
  expanded: boolean;
  onToggle: () => void;
}

export function AudioFileLibraryPanel({ expanded, onToggle }: AudioFileLibraryPanelProps) {
  const files = useAudioFileStore((s) => s.files);
  const addFile = useAudioFileStore((s) => s.addFile);
  const removeFile = useAudioFileStore((s) => s.removeFile);
  const panelRef = useRef<HTMLDivElement>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [groupingFiles, setGroupingFiles] = useState<AudioFile[] | null>(null);
  const selectedFiles = useMemo(
    () => files.filter((file) => selectedIds.has(file.id)),
    [files, selectedIds],
  );
  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    {
      label: "Select",
      icon: "ph:checks",
      onSelect: () => enterSelectMode(),
    },
  ]);

  useEffect(() => {
    if (!selectMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") exitSelectMode();
    }
    function onPointerDown(event: PointerEvent) {
      if (panelRef.current?.contains(event.target as Node)) return;
      exitSelectMode();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [selectMode]);

  async function upload() {
    const file = await importAudioFile();
    if (!file) return;
    if (!isSupportedAudioFileName(file.name) && !isSupportedAudioFileName(file.path)) {
      await appAlert(`Unsupported audio file. Supported formats: ${SUPPORTED_AUDIO_IMPORT_LABEL}.`);
      return;
    }
    addFile(file);
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
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }

  function selectFile(fileId: string, shiftKey: boolean) {
    setSelectMode(true);
    setSelectedIds((current) => {
      if (shiftKey && lastSelectedId) {
        const start = files.findIndex((file) => file.id === lastSelectedId);
        const end = files.findIndex((file) => file.id === fileId);
        if (start >= 0 && end >= 0) {
          const [lo, hi] = start < end ? [start, end] : [end, start];
          return new Set([...current, ...files.slice(lo, hi + 1).map((file) => file.id)]);
        }
      }
      const next = new Set(current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
    setLastSelectedId(fileId);
  }

  function deleteSelected() {
    selectedFiles.forEach((file) => removeFile(file.id));
    exitSelectMode();
  }

  function groupSelected() {
    if (selectedFiles.length === 0) return;
    setGroupingFiles(selectedFiles);
  }

  return (
    <div ref={panelRef} className={styles.panel} onContextMenu={onContextMenu}>
      <SectionRibbon
        title="Audio Files"
        expanded={expanded}
        onToggle={onToggle}
        showToggle={false}
        onContextMenu={onContextMenu}
        actions={(
          <HoverInfo content={`Upload ${SUPPORTED_AUDIO_IMPORT_LABEL}`}>
            <SectionRibbonActionButton onClick={upload} aria-label="Upload audio file">
              <Icon name="ph:plus" size={16} decorative />
            </SectionRibbonActionButton>
          </HoverInfo>
        )}
      />
      {selectMode && expanded && (
        <div className={styles.selectionBar}>
          <Button size="xs" disabled={selectedFiles.length === 0} onClick={deleteSelected}>
            Delete
          </Button>
          <Button size="xs" disabled={selectedFiles.length === 0} onClick={groupSelected}>
            Group
          </Button>
          <span className={styles.selectionCount}>{selectedFiles.length}</span>
        </div>
      )}

      <ul className={`${styles.list} ${expanded ? styles.listOpen : ""}`} aria-hidden={!expanded}>
        {files.length === 0 && <li className={styles.empty}>No audio files yet.</li>}
        {files.map((file) => (
          <AudioFileItem
            key={file.id}
            file={file}
            selectMode={selectMode}
            selected={selectedIds.has(file.id)}
            onSelect={(event) => selectFile(file.id, event.shiftKey)}
            onEnterSelectMode={() => enterSelectMode(file.id)}
            onRemove={() => removeFile(file.id)}
          />
        ))}
      </ul>
      {menu}
      {groupingFiles && (
        <ImportInstrumentModal
          initialFiles={groupingFiles}
          onImportedFiles={(imported) => {
            imported.forEach((file) => removeFile(file.id));
            exitSelectMode();
          }}
          onClose={() => setGroupingFiles(null)}
        />
      )}
    </div>
  );
}

interface ItemProps {
  file: AudioFile;
  selectMode: boolean;
  selected: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onEnterSelectMode: () => void;
  onRemove: () => void;
}

function AudioFileItem({ file, selectMode, selected, onSelect, onEnterSelectMode, onRemove }: ItemProps) {
  const { id, name, durationSeconds } = file;
  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    {
      label: "Select",
      icon: "ph:checks",
      onSelect: onEnterSelectMode,
    },
    {
      label: "Delete",
      icon: "ph:trash",
      onSelect: onRemove,
      separatorBefore: true,
    },
  ]);

  function onDragStart(e: React.DragEvent<HTMLLIElement>) {
    e.dataTransfer.setData("application/x-beat-audio-file", id);
    e.dataTransfer.setData("text/plain", name);
    e.dataTransfer.effectAllowed = "copy";
  }

  return (
    <RowItem
      className={`${styles.item} ${selected ? styles.itemSelected : ""} ${selectMode ? styles.itemSelecting : ""}`}
      reserveDragSlot={false}
      cursor={selectMode ? "pointer" : "grab"}
      draggable={!selectMode}
      onClick={(event) => {
        if (!selectMode) return;
        onSelect(event);
      }}
      onDragStart={onDragStart}
      onContextMenu={onContextMenu}
      iconAriaHidden={!selectMode}
      icon={selectMode ? (
        <input
          className={styles.itemCheckbox}
          type="checkbox"
          checked={selected}
          readOnly
          onClick={(event) => {
            event.stopPropagation();
            onSelect(event);
          }}
          aria-label={`Select ${name}`}
        />
      ) : (
        <span className={styles.itemDot} aria-hidden>
          <Icon name="ph:dots-six-vertical" size={14} decorative />
        </span>
      )}
      name={name}
      action={(
        <HoverInfo content={formatDuration(durationSeconds)}>
          <span className={styles.itemMeta}>
            <Icon name="ph:waveform" size={14} decorative />
          </span>
        </HoverInfo>
      )}
    >
      {menu}
    </RowItem>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
