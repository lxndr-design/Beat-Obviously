import { createMemo, createSignal, Show } from "solid-js";
import { nanoid as newNanoid } from "nanoid";
import { createStoreSelector } from "../../solid-utils/store";
import {
  appAlert,
  appConfirm,
  createContextMenu,
  HoverInfo,
  Icon,
  MicroButton,
  StatusChip,
  type ContextMenuItem,
} from "../../solid-ui";
import { useAnalyzerStore } from "../../state/analyzerStore";
import { useProjectStore, useUiStore } from "../../state/store";
import { exportTrackAsWav } from "../ExportReview/exportActions";
import styles from "./TrackHeader.module.css";
import type { Id, Track } from "../../state/types";

interface Props {
  trackId: Id;
  index: number;
  selected?: boolean;
  onSelect?: (event: MouseEvent) => void;
}

const DND_MIME = "application/x-beat-track";

export function TrackHeader(props: Props) {
  const track = createStoreSelector(useProjectStore, (state) => state.project.tracks.find((candidate) => candidate.id === props.trackId));
  const meter = createStoreSelector(useAnalyzerStore, (state) => state.trackMeters[props.trackId]);
  const [editingName, setEditingName] = createSignal(false);
  const [dropPosition, setDropPosition] = createSignal<"above" | "below" | null>(null);
  const duplicateTrack = duplicateTrackAction;
  const leftMeterPeak = createMemo(() => clamp01(meter()?.leftPeak ?? meter()?.peak ?? 0));
  const rightMeterPeak = createMemo(() => clamp01(meter()?.rightPeak ?? meter()?.peak ?? 0));
  const gainBadge = createMemo(() => formatGainBadge(track()?.gainDb ?? 0));
  const panBadge = createMemo(() => formatPanBadge(track()?.pan ?? 0));

  const menu = createContextMenu((): ContextMenuItem[] => {
    const current = track();
    if (!current) return [];
    const projectStore = useProjectStore.getState();
    return [
      {
        label: current.mute ? "Unmute" : "Mute",
        icon: current.mute ? "ph:speaker-high" : "ph:speaker-x",
        onSelect: () => projectStore.setTrackMute(props.trackId, !current.mute),
        disabled: current.solo,
      },
      {
        label: current.solo ? "Unsolo" : "Solo",
        icon: "ph:headphones",
        onSelect: () => projectStore.setTrackSolo(props.trackId, !current.solo),
      },
      {
        label: current.recordArmed ? "Disarm recording" : "Arm recording",
        icon: current.recordArmed ? "ph:record-fill" : "ph:record",
        onSelect: () => projectStore.updateTrack(props.trackId, { recordArmed: !current.recordArmed }),
        separatorBefore: true,
      },
      {
        label: current.inputMonitoring ? "Disable input monitoring" : "Enable input monitoring",
        icon: "ph:speaker-high",
        onSelect: () => projectStore.updateTrack(props.trackId, { inputMonitoring: !current.inputMonitoring }),
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
        onSelect: () => projectStore.addTrackEffect(props.trackId),
      },
      {
        label: "Duplicate track",
        icon: "ph:copy",
        onSelect: () => duplicateTrack(props.trackId),
      },
      {
        label: "Export as .wav",
        icon: "ph:export",
        disabled: current.kind === "group",
        onSelect: () => void exportTrackWithErrorHandling(props.trackId),
        separatorBefore: true,
      },
      {
        label: "Delete track",
        icon: "ph:trash",
        onSelect: () => void removeTrackWithConfirmation(props.trackId),
        separatorBefore: true,
      },
    ];
  });

  function updateTrack(patch: Partial<Track>) {
    useProjectStore.getState().updateTrack(props.trackId, patch);
  }

  function setTrackSolo(solo: boolean) {
    useProjectStore.getState().setTrackSolo(props.trackId, solo);
  }

  function setTrackMute(mute: boolean) {
    useProjectStore.getState().setTrackMute(props.trackId, mute);
  }

  function openTrackEditor() {
    useUiStore.getState().openEditor({ kind: "track", trackId: props.trackId });
  }

  function handleContextMenu(event: MouseEvent) {
    if (!props.selected) props.onSelect?.(event);
    menu.onContextMenu(event);
  }

  function onHandleDragStart(event: DragEvent) {
    event.dataTransfer?.setData(DND_MIME, props.trackId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function onHeaderDragStart(event: DragEvent) {
    if (shouldSuppressHeaderDrag(event.target)) {
      event.preventDefault();
      return;
    }
    onHandleDragStart(event);
  }

  function onRowDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes(DND_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
    setDropPosition(event.clientY < rect.top + rect.height / 2 ? "above" : "below");
  }

  function onRowDrop(event: DragEvent) {
    const draggedId = event.dataTransfer?.getData(DND_MIME);
    const placedBelow = dropPosition() === "below";
    setDropPosition(null);
    if (!draggedId || draggedId === props.trackId) return;
    const { project, reorderTracks } = useProjectStore.getState();
    const order = project.tracks.map((candidate) => candidate.id).filter((id) => id !== draggedId);
    let target = order.indexOf(props.trackId);
    if (placedBelow) target++;
    order.splice(target, 0, draggedId);
    reorderTracks(order);
  }

  return (
    <Show when={track()}>
      {(current) => (
        <div
          class={[
            styles.header,
            props.selected && styles.headerSelected,
            dropPosition() === "above" && styles.dropAbove,
            dropPosition() === "below" && styles.dropBelow,
          ].filter(Boolean).join(" ")}
          onContextMenu={handleContextMenu}
          onClick={(event) => {
            if (!isPlainSelectionClick(event)) return;
            props.onSelect?.(event);
          }}
          onDblClick={(event) => {
            event.stopPropagation();
            if (!isPlainSelectionClick(event)) return;
            props.onSelect?.(event);
            openTrackEditor();
          }}
          onDragOver={onRowDragOver}
          onDragLeave={() => setDropPosition(null)}
          onDrop={onRowDrop}
          onDragStart={onHeaderDragStart}
          onDragEnd={() => setDropPosition(null)}
          draggable={!editingName()}
          data-track-header
          data-track-index={props.index}
        >
          <span
            class={styles.dragHandle}
            draggable
            onClick={(event) => event.stopPropagation()}
            onDragStart={onHandleDragStart}
            aria-hidden="true"
          >
            <Icon name="ph:dots-six-vertical" size={18} decorative />
          </span>

          <div class={styles.nameStack}>
            <Show
              when={editingName()}
              fallback={(
                <button
                  type="button"
                  class={styles.name}
                  onDblClick={(event) => {
                    event.stopPropagation();
                    if (!isPlainSelectionClick(event)) return;
                    props.onSelect?.(event);
                    openTrackEditor();
                  }}
                  title="Double-click to rename"
                >
                  {current().name}
                </button>
              )}
            >
              <input
                class={styles.nameInput}
                autofocus
                value={current().name}
                onInput={(event) => updateTrack({ name: event.currentTarget.value })}
                onBlur={() => setEditingName(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "Escape") setEditingName(false);
                }}
              />
            </Show>

            <div class={styles.channelControls}>
              <HoverInfo content={current().solo ? "Unsolo" : "Solo (mute others)"}>
                <MicroButton
                  active={current().solo}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.ctrlKey) return;
                    setTrackSolo(!current().solo);
                  }}
                  aria-label={current().solo ? "Unsolo" : "Solo"}
                >
                  S
                </MicroButton>
              </HoverInfo>
              <HoverInfo content={current().solo ? "Soloed - can't mute" : current().mute ? "Unmute" : "Mute"}>
                <MicroButton
                  active={current().mute}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.ctrlKey) return;
                    setTrackMute(!current().mute);
                  }}
                  aria-label={current().mute ? "Unmute" : "Mute"}
                  disabled={current().solo}
                >
                  M
                </MicroButton>
              </HoverInfo>
            </div>
            <div class={styles.meter} aria-label="Stereo track meter" role="group">
              <span class={styles.meterLane} data-meter-channel="left">
                <span class={styles.meterFill} style={{ transform: `scaleX(${leftMeterPeak()})` }} />
              </span>
              <span class={styles.meterLane} data-meter-channel="right">
                <span class={styles.meterFill} style={{ transform: `scaleX(${rightMeterPeak()})` }} />
              </span>
            </div>
            <Show when={gainBadge() || panBadge() || current().recordArmed || current().inputMonitoring}>
              <div class={styles.statusRow} aria-hidden="true">
                <Show when={gainBadge()}>{(badge) => <StatusChip>{badge()}</StatusChip>}</Show>
                <Show when={panBadge()}>{(badge) => <StatusChip>{badge()}</StatusChip>}</Show>
                <Show when={current().recordArmed}><StatusChip>REC</StatusChip></Show>
                <Show when={current().inputMonitoring}><StatusChip>IN</StatusChip></Show>
              </div>
            </Show>
          </div>

          <div class={styles.controls}>
            <HoverInfo content={current().recordArmed ? "Disarm recording" : "Arm recording"}>
              <MicroButton
                active={current().recordArmed}
                onClick={(event) => {
                  event.stopPropagation();
                  if (event.ctrlKey) return;
                  updateTrack({ recordArmed: !current().recordArmed });
                }}
                aria-label={current().recordArmed ? "Disarm recording" : "Arm recording"}
              >
                <Icon name={current().recordArmed ? "ph:microphone-fill" : "ph:microphone"} size={18} decorative />
              </MicroButton>
            </HoverInfo>
            <HoverInfo content={current().inputMonitoring ? "Disable input monitoring" : "Enable input monitoring"}>
              <MicroButton
                active={current().inputMonitoring}
                onClick={(event) => {
                  event.stopPropagation();
                  if (event.ctrlKey) return;
                  updateTrack({ inputMonitoring: !current().inputMonitoring });
                }}
                aria-label={current().inputMonitoring ? "Disable input monitoring" : "Enable input monitoring"}
              >
                <Icon name={current().inputMonitoring ? "ph:speaker-high-fill" : "ph:speaker-high"} size={18} decorative />
              </MicroButton>
            </HoverInfo>
          </div>
          {menu.menu()}
        </div>
      )}
    </Show>
  );
}

function isPlainSelectionClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey;
}

function shouldSuppressHeaderDrag(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  if (element.closest("input, select, textarea, [contenteditable='true'], [data-track-no-drag]")) return true;
  const button = element.closest("button");
  return Boolean(button && !button.classList.contains(styles.name));
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function duplicateTrackAction(trackId: Id) {
  const { project, loadProject } = useProjectStore.getState();
  const index = project.tracks.findIndex((candidate) => candidate.id === trackId);
  if (index < 0) return;
  const source = project.tracks[index];
  const newId = newNanoid();
  const copy = {
    ...structuredClone(source),
    id: newId,
    name: `${source.name} copy`,
    segments: source.segments.map((segment) => ({
      ...structuredClone(segment),
      id: newNanoid(),
      trackId: newId,
    })),
  };
  const tracks = [...project.tracks];
  tracks.splice(index + 1, 0, copy);
  loadProject({ ...project, tracks });
}

async function removeTrackWithConfirmation(trackId: Id) {
  const projectStore = useProjectStore.getState();
  const track = projectStore.project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return;
  if (trackHasDestructiveContent(track)) {
    const confirmed = await appConfirm(`Delete "${track.name}" and remove its clips, effects, routing, and track settings?`);
    if (!confirmed) return;
  }
  projectStore.removeTrack(trackId);
}

async function exportTrackWithErrorHandling(trackId: Id) {
  try {
    await exportTrackAsWav(trackId);
  } catch (error) {
    await appAlert(error instanceof Error ? error.message : "Track export failed.");
  }
}

function trackHasDestructiveContent(track: Track): boolean {
  return Boolean(
    track.segments.length > 0
    || track.instrumentId
    || track.audioFileId
    || track.parentTrackId
    || (track.sends?.length ?? 0) > 0
    || track.effects.filters.length > 0
    || track.recordArmed
    || track.inputMonitoring,
  );
}
