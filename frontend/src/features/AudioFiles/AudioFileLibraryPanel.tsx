import { useState } from "react";
import { Button, HoverInfo, Icon, useContextMenu, type ContextMenuItem } from "../../components";
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
    if (resp.file) addFile(resp.file);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.chevronBtn}
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "Collapse audio files" : "Expand audio files"}
        >
          <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} size={16} decorative />
        </button>
        <span className={styles.headerLabel}>Audio files</span>
        <Button iconOnly size="sm" onClick={upload} aria-label="Upload audio file">
          <Icon name="ph:plus" size={16} decorative />
        </Button>
      </div>

      {expanded && (
        <ul className={styles.list}>
          {files.length === 0 && <li className={styles.empty}>No audio files yet.</li>}
          {files.map((file) => (
            <AudioFileItem
              key={file.id}
              id={file.id}
              name={file.name}
              durationSeconds={file.durationSeconds}
              onRemove={() => removeFile(file.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ItemProps {
  id: string;
  name: string;
  durationSeconds: number;
  onRemove: () => void;
}

function AudioFileItem({ id, name, durationSeconds, onRemove }: ItemProps) {
  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    {
      label: "Delete",
      icon: "ph:trash",
      onSelect: onRemove,
    },
  ]);

  function onDragStart(e: React.DragEvent<HTMLLIElement>) {
    e.dataTransfer.setData("application/x-beat-audio-file", id);
    e.dataTransfer.setData("text/plain", name);
    e.dataTransfer.effectAllowed = "copy";
  }

  return (
    <li
      className={styles.item}
      draggable
      onDragStart={onDragStart}
      onContextMenu={onContextMenu}
    >
      <span className={styles.itemDot} aria-hidden>
        <Icon name="ph:dots-six-vertical" size={14} decorative />
      </span>
      <span className={styles.itemName}>{name}</span>
      <HoverInfo content={formatDuration(durationSeconds)}>
        <span className={styles.itemMeta}>
          <Icon name="ph:waveform" size={14} decorative />
        </span>
      </HoverInfo>
      {menu}
    </li>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
