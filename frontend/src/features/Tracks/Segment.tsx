import { useRef, useState } from "react";
import { useProjectStore, useSettingsStore, useUiStore, useViewStore } from "../../state/store";
import { SEGMENT_LAYER_OFFSET_PX } from "./geometry";
import { useContextMenu, Icon, type ContextMenuItem } from "../../components";
import { useClipboard } from "../../state/clipboard";
import { useComponentStore } from "../../state/components";
import { listDrumBeatFeedback, updateDrumBeatFeedback } from "../../persistence/dexie";
import { maybeRunDueTraining } from "../../ai/trainingRunner";
import { SegmentWaveform } from "./SegmentWaveform";
import { SegmentMidiPreview } from "./SegmentMidiPreview";
import { SegmentDrumPreview } from "./SegmentDrumPreview";
import styles from "./Segment.module.css";
import type { Id, Segment as SegmentType } from "../../state/types";

interface Props {
  segmentId: Id;
  startBeat: number;
  lengthBeats: number;
  repetition: number;
  layer: number;
  payloadKind: "audio" | "midi" | "drum" | "mixed";
  onEdit: () => void;
}

/**
 * Segment — universal segment renderer.
 *
 * Both audio and MIDI segments share the same shell:
 *   ┌─── black label strip (white text: name · type) ───┐
 *   │ ▒▒▒  black content overlay on white body  ▒▒▒    │   ← black waveform / mini-notes
 *   │      (white body)                                 │
 *   └───────────────────────────────────────────────────┘
 *
 * Resize handles on left/right edges (8px). Body drags to move. Right-click
 * exposes Edit / Duplicate / Copy / Paste / Rename.
 *
 * Drag/resize snap follows the musical ruler:
 *   - default: one time-signature subtick (one beat)
 *   - Shift held: one full measure (timeSig.num beats)
 * Time labels are derived from BPM after the musical grid is established.
 */
export function Segment({
  segmentId,
  startBeat,
  lengthBeats,
  repetition,
  layer,
  payloadKind,
  onEdit,
}: Props) {
  const beatsToPx = useViewStore((s) => s.beatsToPx);
  const setLastLen = useViewStore((s) => s.setLastSegmentLength);
  const moveSegment = useProjectStore((s) => s.moveSegment);
  const updateSegment = useProjectStore((s) => s.updateSegment);
  const removeSegment = useProjectStore((s) => s.removeSegment);
  const addSegment = useProjectStore((s) => s.addSegment);
  const setSegmentRepeats = useProjectStore((s) => s.setSegmentRepeats);
  const projectLengthBeats = useProjectStore((s) => s.project.lengthBeats);
  const tsNum = useProjectStore((s) => s.project.timeSignature.num);
  const timelineSmartGrid = useSettingsStore((s) => s.timelineSmartGrid);
  const timelineSubdivision = useSettingsStore((s) => s.timelineSubdivision);
  const selected = useUiStore((s) => s.selectedSegmentIds.includes(segmentId));
  const editing = useUiStore((s) => s.openEditors.some((editor) => editor.kind === "segment" && editor.segmentId === segmentId));
  const selectSegment = useUiStore((s) => s.selectSegment);
  const { copy: copyToClipboard, paste } = useClipboard();
  const saveComponent = useComponentStore((s) => s.add);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [dragging, setDragging] = useState(false);

  const drag = useRef<
    | { mode: "move"; startX: number; startBeat: number }
    | { mode: "resize-right"; startX: number; startLen: number; shift: boolean }
    | { mode: "resize-left"; startX: number; startBeat: number; startLen: number; shift: boolean }
    | null
  >(null);

  function snapStepBeats(shift: boolean): number {
    if (shift) return Math.max(1, tsNum);
    return timelineSmartGrid ? 4 / timelineSubdivision : GRID_TICK_BEATS;
  }
  function snapBeat(beat: number, shift: boolean): number {
    const step = snapStepBeats(shift);
    return Math.max(0, Math.round(beat / step) * step);
  }
  function snapLen(len: number, shift: boolean): number {
    const step = snapStepBeats(shift);
    return Math.max(GRID_TICK_BEATS, Math.round(len / step) * step);
  }

  function startDrag(
    mode: "move" | "resize-right" | "resize-left",
    e: React.PointerEvent,
  ) {
    if (repetition > 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    if (mode === "move") {
      drag.current = { mode, startX: e.clientX, startBeat };
    } else if (mode === "resize-right") {
      drag.current = { mode, startX: e.clientX, startLen: lengthBeats, shift: e.shiftKey };
    } else {
      drag.current = { mode, startX: e.clientX, startBeat, startLen: lengthBeats, shift: e.shiftKey };
    }
    setDragging(true);
    selectSegment(segmentId, e.shiftKey);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dxPx = e.clientX - d.startX;
    const dxBeats = dxPx / beatsToPx;

    if (d.mode === "move") {
      const newStart = snapBeat(d.startBeat + dxBeats, e.shiftKey);
      if (newStart === startBeat) return;
      const seg = useProjectStore.getState().project.tracks
        .flatMap((t) => t.segments)
        .find((s) => s.id === segmentId);
      if (seg) moveSegment(segmentId, seg.trackId, newStart);
    } else if (d.mode === "resize-right") {
      const raw = d.startLen + dxBeats;
      const newLen = snapLen(raw, e.shiftKey);
      if (newLen === lengthBeats) return;
      updateSegment(segmentId, { lengthBeats: newLen });
      setLastLen(newLen);
    } else if (d.mode === "resize-left") {
      // Lock the right edge — it's the anchor while we drag the left handle.
      // Snap the new start to the same step the right handle uses, then
      // derive length = rightEdge - snappedStart. This guarantees the right
      // edge does not drift, no matter the snap setting or shift state.
      const rightBeat = d.startBeat + d.startLen;
      const rawStart = d.startBeat + dxBeats;
      const snappedStart = snapBeat(rawStart, e.shiftKey);
      // Don't allow the start to cross the right edge — keep one grid tick minimum.
      const clampedStart = Math.min(rightBeat - GRID_TICK_BEATS, snappedStart);
      const newLen = rightBeat - clampedStart;
      if (clampedStart === startBeat && newLen === lengthBeats) return;
      updateSegment(segmentId, { startBeat: clampedStart, lengthBeats: newLen });
      setLastLen(newLen);
    }
  }

  function onPointerUp() {
    drag.current = null;
    setDragging(false);
  }

  // Right-click menu.
  const segState = useProjectStore.getState();
  const liveSeg = segState.project.tracks
    .flatMap((t) => t.segments)
    .find((s) => s.id === segmentId);

  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => {
    if (!liveSeg) return [];
    const isMidi =
      liveSeg.payload.kind === "midi" || liveSeg.payload.kind === "mixed";
    const canLoop = isMidi || liveSeg.payload.kind === "drum";
    return [
      { label: "Edit", icon: "ph:pencil-simple", onSelect: onEdit },
      {
        label: "Rename",
        icon: "ph:text-aa",
        onSelect: () => {
          const next = window.prompt("Segment name", liveSeg.name ?? "");
          if (next != null) updateSegment(segmentId, { name: next });
        },
      },
      ...(canLoop
        ? [
            {
              label: liveSeg.repeats > 0 ? "Unloop" : "Loop",
              icon: "ph:repeat",
              onSelect: () => {
                const remaining = Math.max(0, projectLengthBeats - liveSeg.startBeat - liveSeg.lengthBeats);
                const repeats = liveSeg.repeats > 0
                  ? 0
                  : Math.max(0, Math.ceil(remaining / liveSeg.lengthBeats));
                setSegmentRepeats(segmentId, repeats);
              },
            } as ContextMenuItem,
          ]
        : []),
      ...(isMidi || liveSeg.payload.kind === "drum"
        ? [
            {
              label: "Save as Component",
              icon: "ph:package",
              onSelect: () => {
                const fallback = liveSeg.name?.trim() || "Untitled Component";
                const name = window.prompt("Component name", fallback) ?? fallback;
                if (!name) return;
                if (liveSeg.payload.kind === "drum") {
                  saveComponent({
                    kind: "drum",
                    name,
                    rows: liveSeg.payload.rows,
                    stepCount: liveSeg.payload.stepCount,
                    speed: liveSeg.payload.speed,
                    defaultPitchHz: liveSeg.payload.defaultPitchHz,
                    swingPercent: liveSeg.payload.swingPercent,
                    timeSignature: liveSeg.payload.timeSignature,
                    lengthBeats: liveSeg.lengthBeats,
                  });
                  void markSavedGeneratedDrum(liveSeg);
                } else if (liveSeg.payload.kind === "midi" || liveSeg.payload.kind === "mixed") {
                  saveComponent({
                    kind: "midi",
                    name,
                    notes: liveSeg.payload.notes,
                    lengthBeats: liveSeg.lengthBeats,
                    instrumentId: liveSeg.instrumentId,
                  });
                }
              },
            } as ContextMenuItem,
          ]
        : []),
      {
        label: "Duplicate",
        icon: "ph:copy",
        onSelect: () => {
          addSegment(liveSeg.trackId, {
            ...structuredClone(liveSeg),
            startBeat: liveSeg.startBeat + liveSeg.lengthBeats,
            name: duplicateSegmentName(liveSeg),
            id: undefined as unknown as Id,
          });
        },
        separatorBefore: true,
      },
      {
        label: "Copy",
        icon: "ph:clipboard",
        onSelect: () => copyToClipboard(liveSeg),
      },
      {
        label: "Paste",
        icon: "ph:clipboard-text",
        onSelect: () => {
          const pasted = paste();
          if (!pasted) return;
          addSegment(liveSeg.trackId, {
            ...pasted,
            id: undefined as unknown as Id,
            startBeat: liveSeg.startBeat + liveSeg.lengthBeats,
            name: duplicateSegmentName(pasted),
          });
        },
      },
      {
        label: "Delete",
        icon: "ph:trash",
        onSelect: () => removeSegment(segmentId),
        separatorBefore: true,
      },
    ];
  });

  const left = startBeat * beatsToPx;
  const width = Math.max(beatsToPx / 2, lengthBeats * beatsToPx);
  const visualLayer = layer > 0 ? 1 : 0;
  const top = visualLayer * SEGMENT_LAYER_OFFSET_PX;

  const label = liveSeg?.name?.trim() || defaultName(payloadKind);
  const kindIcon =
    payloadKind === "midi"
      ? "ph:piano-keys"
      : payloadKind === "audio"
        ? "ph:music-notes-simple"
        : payloadKind === "drum"
          ? "ph:squares-four"
          : "ph:dots-three";

  return (
    <div
      className={[
        styles.segment,
        selected && styles.selected,
        editing && styles.editing,
        dragging && styles.dragging,
        layer > 0 && styles.layered,
        repetition > 0 && styles.virtual,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ left, width, top, bottom: 0, zIndex: dragging ? 1000 : Math.round(startBeat * 100) + layer + 1 }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      onContextMenu={onContextMenu}
    >
      {repetition === 0 && (
        <div
          className={`${styles.handle} ${styles.handleLeft}`}
          onPointerDown={(e) => startDrag("resize-left", e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}

      <div
        className={styles.body}
        onPointerDown={(e) => startDrag("move", e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className={styles.labelStrip}>
          <span className={styles.nameplate}>
            {editingName ? (
              <input
                className={styles.nameInput}
                autoFocus
                value={nameDraft}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  updateSegment(segmentId, { name: nameDraft });
                  setEditingName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditingName(false);
                }}
              />
            ) : (
              <span
                className={styles.nameText}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (repetition > 0 || !liveSeg) return;
                  setNameDraft(liveSeg.name ?? label);
                  setEditingName(true);
                }}
              >
                {label}
              </span>
            )}
            {repetition > 0 && (
              <span className={styles.repBadge}>×{repetition + 1}</span>
            )}
          </span>
          <span className={styles.kindIcon} aria-hidden>
            <Icon name={kindIcon} size={12} decorative />
          </span>
        </div>
        <div className={styles.content}>
          {payloadKind === "midi" && liveSeg && (
            <SegmentMidiPreview segment={liveSeg as SegmentType} />
          )}
          {payloadKind === "drum" && liveSeg && (
            <SegmentDrumPreview segment={liveSeg as SegmentType} />
          )}
          {payloadKind === "audio" && liveSeg && (
            <SegmentWaveform segment={liveSeg as SegmentType} />
          )}
        </div>
      </div>

      {repetition === 0 && (
        <div
          className={`${styles.handle} ${styles.handleRight}`}
          onPointerDown={(e) => startDrag("resize-right", e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}

      {menu}
    </div>
  );
}

/** Default display name when a segment hasn't been explicitly renamed.
 *  Auto-numbered names (e.g. "Midi 3") are picked at insertion time in
 *  TrackLane; this is the runtime fallback if `name` is empty. */
function defaultName(kind: "audio" | "midi" | "drum" | "mixed"): string {
  return kind === "midi" ? "Midi" : kind === "audio" ? "Audio" : kind === "drum" ? "Drums" : "Mixed";
}

function duplicateSegmentName(seg: SegmentType): string {
  const kind = seg.payload.kind === "audio" ? "audio" : seg.payload.kind === "drum" ? "drum" : "midi";
  const stem = kind === "midi" ? "Midi" : kind === "audio" ? "Audio" : "Drums";
  const trimmed = seg.name?.trim() ?? "";
  if (!trimmed || new RegExp(`^${stem}\\s+\\d+$`).test(trimmed)) {
    return nextAutoSegmentName(kind);
  }
  return `${trimmed} copy`;
}

function nextAutoSegmentName(kind: "midi" | "audio" | "drum"): string {
  const stem = kind === "midi" ? "Midi" : kind === "audio" ? "Audio" : "Drums";
  const used = new Set<number>();
  for (const track of useProjectStore.getState().project.tracks) {
    for (const segment of track.segments) {
      if (segment.payload.kind !== kind && (kind === "drum" || segment.payload.kind !== "mixed")) continue;
      const match = (segment.name ?? "").match(new RegExp(`^${stem}\\s+(\\d+)$`));
      if (match) used.add(parseInt(match[1], 10));
    }
  }
  let next = 1;
  while (used.has(next)) next++;
  return `${stem} ${next}`;
}

const GRID_TICK_BEATS = 1;

async function markSavedGeneratedDrum(seg: SegmentType) {
  if (seg.payload.kind !== "drum") return;
  const payload = seg.payload;
  const feedback = await listDrumBeatFeedback(20);
  const match = feedback.find((entry) => {
    const beat = entry.finalBeat ?? entry.modelBeat;
    return beat.stepCount === payload.stepCount &&
      beat.speed === payload.speed &&
      JSON.stringify(beat.rows) === JSON.stringify(payload.rows);
  });
  if (!match) return;
  await updateDrumBeatFeedback(match.id, {
    savedAsComponent: true,
    rating: match.rating ?? "up",
    finalBeat: {
      rows: structuredClone(payload.rows),
      stepCount: payload.stepCount,
      lengthBeats: seg.lengthBeats,
      speed: payload.speed,
      swingPercent: payload.swingPercent ?? 50,
      defaultPitchHz: payload.defaultPitchHz,
      source: "local",
    },
  });
  void maybeRunDueTraining("drums");
}
