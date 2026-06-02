import { useState } from "react";
import { nanoid as newNanoid } from "nanoid";
import { Icon, HoverInfo, useContextMenu, type ContextMenuItem } from "../../components";
import { useProjectStore, useUiStore } from "../../state/store";
import styles from "./TrackHeader.module.css";
import type { Id } from "../../state/types";

interface Props {
  trackId: Id;
  index: number;
  selectMode?: boolean;
  selected?: boolean;
  onSelect?: (event: React.MouseEvent) => void;
  onEnterSelectMode?: () => void;
}

const DND_MIME = "application/x-beat-track";

/**
 * TrackHeader — sticky left column for a single track.
 *
 *   ≡  Track Name (dbl-click to edit)   [S] [M]
 *
 * The ≡ drag handle is `draggable`: drag a track up/down to reorder. Drop
 * above the target row inserts before; drop on the lower half inserts after.
 *
 * Right-click → Mute/Solo/Rename/Duplicate/Delete. The ContextMenu hook
 * stops propagation so the outer TrackList area doesn't intercept it.
 */
export function TrackHeader({
  trackId,
  index,
  selectMode = false,
  selected = false,
  onSelect,
  onEnterSelectMode,
}: Props) {
  const track = useProjectStore((s) =>
    s.project.tracks.find((t) => t.id === trackId),
  );
  const updateTrack = useProjectStore((s) => s.updateTrack);
  const setTrackSolo = useProjectStore((s) => s.setTrackSolo);
  const setTrackMute = useProjectStore((s) => s.setTrackMute);
  const removeTrack = useProjectStore((s) => s.removeTrack);
  const reorderTracks = useProjectStore((s) => s.reorderTracks);
  const openTrackEffects = useUiStore((s) => s.openTrackEffects);
  const duplicateTrack = useDuplicateTrack();
  const [editingName, setEditingName] = useState(false);
  const [dropPosition, setDropPosition] = useState<"above" | "below" | null>(null);

  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => {
    if (!track) return [];
    return [
      {
        label: "Select",
        icon: "ph:checks",
        onSelect: () => onEnterSelectMode?.(),
      },
      {
        label: track.mute ? "Unmute" : "Mute",
        icon: track.mute ? "ph:speaker-high" : "ph:speaker-x",
        onSelect: () => setTrackMute(trackId, !track.mute),
        disabled: track.solo,
      },
      {
        label: track.solo ? "Unsolo" : "Solo",
        icon: "ph:headphones",
        onSelect: () => setTrackSolo(trackId, !track.solo),
      },
      {
        label: "Rename",
        icon: "ph:pencil-simple",
        onSelect: () => setEditingName(true),
        separatorBefore: true,
      },
      {
        label: "Effects / Filters",
        icon: "ph:sliders-horizontal",
        onSelect: () => openTrackEffects(trackId),
      },
      {
        label: "Duplicate track",
        icon: "ph:copy",
        onSelect: () => duplicateTrack(trackId),
      },
      {
        label: "Delete track",
        icon: "ph:trash",
        onSelect: () => removeTrack(trackId),
        separatorBefore: true,
      },
    ];
  });

  // ----- Reorder DnD -----------------------------------------------------
  function onHandleDragStart(e: React.DragEvent<HTMLSpanElement>) {
    e.dataTransfer.setData(DND_MIME, trackId);
    e.dataTransfer.effectAllowed = "move";
  }
  function onRowDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    setDropPosition(e.clientY < r.top + r.height / 2 ? "above" : "below");
  }
  function onRowDragLeave() {
    setDropPosition(null);
  }
  function onRowDrop(e: React.DragEvent<HTMLDivElement>) {
    const draggedId = e.dataTransfer.getData(DND_MIME);
    const placedBelow = dropPosition === "below";
    setDropPosition(null);
    if (!draggedId || draggedId === trackId) return;
    const { project } = useProjectStore.getState();
    const order = project.tracks.map((t) => t.id).filter((id) => id !== draggedId);
    let target = order.indexOf(trackId);
    if (placedBelow) target++;
    order.splice(target, 0, draggedId);
    reorderTracks(order);
  }

  if (!track) return null;

  return (
    <div
      className={[
        styles.header,
        selectMode && styles.headerSelecting,
        selected && styles.headerSelected,
        dropPosition === "above" && styles.dropAbove,
        dropPosition === "below" && styles.dropBelow,
      ]
        .filter(Boolean)
        .join(" ")}
      onContextMenu={onContextMenu}
      onClick={(event) => {
        if (!selectMode) return;
        onSelect?.(event);
      }}
      onDragOver={onRowDragOver}
      onDragLeave={onRowDragLeave}
      onDrop={onRowDrop}
      data-track-index={index}
    >
      {selectMode ? (
        <input
          className={styles.checkbox}
          type="checkbox"
          checked={selected}
          readOnly
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(event);
          }}
          aria-label={`Select ${track.name}`}
        />
      ) : (
        <span
          className={styles.dragHandle}
          draggable
          onDragStart={onHandleDragStart}
          aria-hidden
        >
          <Icon name="ph:dots-six-vertical" size={16} decorative />
        </span>
      )}

      {editingName ? (
        <input
          className={styles.nameInput}
          autoFocus
          value={track.name}
          onChange={(e) => updateTrack(trackId, { name: e.target.value })}
          onBlur={() => setEditingName(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") setEditingName(false);
          }}
        />
      ) : (
        <button
          type="button"
          className={styles.name}
          onDoubleClick={() => setEditingName(true)}
          title="Double-click to rename"
        >
          {track.name}
        </button>
      )}

      <div className={styles.controls}>
        <HoverInfo content={track.solo ? "Unsolo" : "Solo (mute others)"}>
          <button
            type="button"
            className={`${styles.dot} ${track.solo ? styles.dotOn : ""}`}
            onClick={(event) => {
              if (selectMode) {
                event.stopPropagation();
                return;
              }
              setTrackSolo(trackId, !track.solo);
            }}
            aria-label={track.solo ? "Unsolo" : "Solo"}
          >
            S
          </button>
        </HoverInfo>
        <HoverInfo
          content={track.solo ? "Soloed — can't mute" : track.mute ? "Unmute" : "Mute"}
        >
          <button
            type="button"
            className={`${styles.dot} ${track.mute ? styles.dotOn : ""}`}
            onClick={(event) => {
              if (selectMode) {
                event.stopPropagation();
                return;
              }
              setTrackMute(trackId, !track.mute);
            }}
            aria-label={track.mute ? "Unmute" : "Mute"}
            disabled={track.solo}
          >
            M
          </button>
        </HoverInfo>
      </div>
      {menu}
    </div>
  );
}

function useDuplicateTrack() {
  return (trackId: Id) => {
    const { project, loadProject } = useProjectStore.getState();
    const idx = project.tracks.findIndex((t) => t.id === trackId);
    if (idx < 0) return;
    const src = project.tracks[idx];
    const newId = newNanoid();
    const copy = {
      ...structuredClone(src),
      id: newId,
      name: `${src.name} copy`,
      segments: src.segments.map((s) => ({
        ...structuredClone(s),
        id: newNanoid(),
        trackId: newId,
      })),
    };
    const tracks = [...project.tracks];
    tracks.splice(idx + 1, 0, copy);
    loadProject({ ...project, tracks });
  };
}
