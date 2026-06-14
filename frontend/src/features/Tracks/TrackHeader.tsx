import { useState } from "react";
import { nanoid as newNanoid } from "nanoid";
import { Icon, HoverInfo, useContextMenu, type ContextMenuItem } from "../../components";
import { useProjectStore, useUiStore } from "../../state/store";
import { useAnalyzerStore } from "../../state/analyzerStore";
import styles from "./TrackHeader.module.css";
import type { Id } from "../../state/types";

interface Props {
  trackId: Id;
  index: number;
  selected?: boolean;
  onSelect?: (event: React.MouseEvent) => void;
}

const DND_MIME = "application/x-beat-track";

function isPlainSelectionClick(event: React.MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey;
}

function formatGainBadge(gainDb: number): string | null {
  if (Math.abs(gainDb) < 0.05) return null;
  const rounded = Math.round(gainDb);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function formatPanBadge(pan: number): "L" | "R" | null {
  if (Math.abs(pan) < 0.01) return null;
  return pan < 0 ? "L" : "R";
}

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
  selected = false,
  onSelect,
}: Props) {
  const track = useProjectStore((s) =>
    s.project.tracks.find((t) => t.id === trackId),
  );
  const updateTrack = useProjectStore((s) => s.updateTrack);
  const setTrackSolo = useProjectStore((s) => s.setTrackSolo);
  const setTrackMute = useProjectStore((s) => s.setTrackMute);
  const removeTrack = useProjectStore((s) => s.removeTrack);
  const reorderTracks = useProjectStore((s) => s.reorderTracks);
  const addTrackEffect = useProjectStore((s) => s.addTrackEffect);
  const openEditor = useUiStore((s) => s.openEditor);
  const meter = useAnalyzerStore((s) => s.trackMeters[trackId]);
  const duplicateTrack = useDuplicateTrack();
  const [editingName, setEditingName] = useState(false);
  const [dropPosition, setDropPosition] = useState<"above" | "below" | null>(null);
  const meterPeak = clamp01(meter?.peak ?? 0);
  const meterRms = clamp01(meter?.rms ?? 0);
  const gainBadge = formatGainBadge(track?.gainDb ?? 0);
  const panBadge = formatPanBadge(track?.pan ?? 0);

  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => {
    if (!track) return [];
    return [
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
        label: track.recordArmed ? "Disarm recording" : "Arm recording",
        icon: track.recordArmed ? "ph:record-fill" : "ph:record",
        onSelect: () => updateTrack(trackId, { recordArmed: !track.recordArmed }),
        separatorBefore: true,
      },
      {
        label: track.inputMonitoring ? "Disable input monitoring" : "Enable input monitoring",
        icon: "ph:speaker-high",
        onSelect: () => updateTrack(trackId, { inputMonitoring: !track.inputMonitoring }),
      },
      {
        label: "Rename",
        icon: "ph:pencil-simple",
        onSelect: () => setEditingName(true),
        separatorBefore: true,
      },
      {
        label: "+ Effect",
        icon: "ph:sliders-horizontal",
        onSelect: () => addTrackEffect(trackId),
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
        selected && styles.headerSelected,
        dropPosition === "above" && styles.dropAbove,
        dropPosition === "below" && styles.dropBelow,
      ]
        .filter(Boolean)
        .join(" ")}
      onContextMenu={onContextMenu}
      onClick={(event) => {
        if (!isPlainSelectionClick(event)) return;
        onSelect?.(event);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (!isPlainSelectionClick(event)) return;
        onSelect?.(event);
        openEditor({ kind: "track", trackId });
      }}
      onDragOver={onRowDragOver}
      onDragLeave={onRowDragLeave}
      onDrop={onRowDrop}
      data-track-header
      data-track-index={index}
    >
      <span
        className={styles.dragHandle}
        draggable
        onClick={(event) => event.stopPropagation()}
        onDragStart={onHandleDragStart}
        aria-hidden
      >
        <Icon name="ph:dots-six-vertical" size={16} decorative />
      </span>

      <div className={styles.nameStack}>
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
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (!isPlainSelectionClick(event)) return;
              onSelect?.(event);
              openEditor({ kind: "track", trackId });
            }}
            title="Double-click to rename"
          >
            {track.name}
          </button>
        )}

        <div className={styles.channelControls}>
          <HoverInfo content={track.solo ? "Unsolo" : "Solo (mute others)"}>
            <button
              type="button"
              className={`${styles.dot} ${styles.textDot} ${track.solo ? styles.dotOn : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                if (event.ctrlKey) return;
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
              className={`${styles.dot} ${styles.textDot} ${track.mute ? styles.dotOn : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                if (event.ctrlKey) return;
                setTrackMute(trackId, !track.mute);
              }}
              aria-label={track.mute ? "Unmute" : "Mute"}
              disabled={track.solo}
            >
              M
            </button>
          </HoverInfo>
        </div>
        <div className={styles.meter} aria-hidden>
          <span className={styles.meterLane}>
            <span
              className={styles.meterFill}
              style={{ transform: `scaleX(${meterPeak})` }}
            />
          </span>
          <span className={styles.meterLane}>
            <span
              className={styles.meterFill}
              style={{ transform: `scaleX(${meterRms})` }}
            />
          </span>
        </div>
        {(gainBadge || panBadge || track.recordArmed || track.inputMonitoring) && (
          <div className={styles.statusRow} aria-hidden>
            {gainBadge && <span className={styles.statusBadge}>{gainBadge}</span>}
            {panBadge && <span className={styles.statusBadge}>{panBadge}</span>}
            {track.recordArmed && <span className={styles.statusBadge}>REC</span>}
            {track.inputMonitoring && <span className={styles.statusBadge}>IN</span>}
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <HoverInfo content={track.recordArmed ? "Disarm recording" : "Arm recording"}>
          <button
            type="button"
            className={`${styles.dot} ${track.recordArmed ? styles.dotOn : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              if (event.ctrlKey) return;
              updateTrack(trackId, { recordArmed: !track.recordArmed });
            }}
            aria-label={track.recordArmed ? "Disarm recording" : "Arm recording"}
          >
            <Icon name={track.recordArmed ? "ph:microphone-fill" : "ph:microphone"} size={12} decorative />
          </button>
        </HoverInfo>
        <HoverInfo content={track.inputMonitoring ? "Disable input monitoring" : "Enable input monitoring"}>
          <button
            type="button"
            className={`${styles.dot} ${track.inputMonitoring ? styles.dotOn : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              if (event.ctrlKey) return;
              updateTrack(trackId, { inputMonitoring: !track.inputMonitoring });
            }}
            aria-label={track.inputMonitoring ? "Disable input monitoring" : "Enable input monitoring"}
          >
            <Icon name={track.inputMonitoring ? "ph:speaker-high-fill" : "ph:speaker-high"} size={12} decorative />
          </button>
        </HoverInfo>
      </div>
      {menu}
    </div>
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
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
