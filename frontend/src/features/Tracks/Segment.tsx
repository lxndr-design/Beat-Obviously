import { useRef, useState } from "react";
import { useProjectStore, useSettingsStore, useTransportStore, useUiStore, useViewStore } from "../../state/store";
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
  const updateSegment = useProjectStore((s) => s.updateSegment);
  const addSegment = useProjectStore((s) => s.addSegment);
  const applySegmentEditCommand = useProjectStore((s) => s.applySegmentEditCommand);
  const setSegmentRepeats = useProjectStore((s) => s.setSegmentRepeats);
  const projectLengthBeats = useProjectStore((s) => s.project.lengthBeats);
  const tsNum = useProjectStore((s) => s.project.timeSignature.num);
  const timelineSmartGrid = useSettingsStore((s) => s.timelineSmartGrid);
  const timelineSubdivision = useSettingsStore((s) => s.timelineSubdivision);
  const selectedSegmentIds = useUiStore((s) => s.selectedSegmentIds);
  const selected = selectedSegmentIds.includes(segmentId);
  const editing = useUiStore((s) => s.openEditors.some((editor) => editor.kind === "segment" && editor.segmentId === segmentId));
  const setSelectedSegments = useUiStore((s) => s.setSelectedSegments);
  const setSelectedTracks = useUiStore((s) => s.setSelectedTracks);
  const { copy: copyToClipboard, copyMany, paste } = useClipboard();
  const saveComponent = useComponentStore((s) => s.add);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ startBeat: number; lengthBeats: number } | null>(null);
  const [fadePreview, setFadePreview] = useState<{ fadeInBeats: number; fadeOutBeats: number } | null>(null);

  const drag = useRef<
    | {
        mode: "move";
        startX: number;
        startY: number;
        anchorSegmentId: Id;
        originTrackIndex: number;
        segments: Array<{ id: Id; startBeat: number; trackId: Id; trackIndex: number }>;
        moved: boolean;
        pendingMoves: Array<{ segmentId: Id; toTrackId: Id; toStartBeat: number }>;
      }
    | {
        mode: "resize-right";
        startX: number;
        startBeat: number;
        startLen: number;
        sourceStartBeat: number;
        payload: SegmentType["payload"] | null;
        shift: boolean;
        pendingResize: { startBeat: number; lengthBeats: number } | null;
      }
    | {
        mode: "resize-left";
        startX: number;
        startBeat: number;
        startLen: number;
        sourceStartBeat: number;
        payload: SegmentType["payload"] | null;
        shift: boolean;
        pendingResize: { startBeat: number; lengthBeats: number } | null;
      }
    | {
        mode: "fade-in" | "fade-out";
        startX: number;
        startLen: number;
        startFadeInBeats: number;
        startFadeOutBeats: number;
        pendingFade: { fadeInBeats: number; fadeOutBeats: number } | null;
      }
    | null
  >(null);
  const previewRaf = useRef<number | null>(null);
  const pendingPreview = useRef<{ startBeat: number; lengthBeats: number } | null>(null);

  function scheduleDragPreview(next: { startBeat: number; lengthBeats: number } | null) {
    pendingPreview.current = next;
    if (previewRaf.current != null) return;
    previewRaf.current = window.requestAnimationFrame(() => {
      previewRaf.current = null;
      setDragPreview(pendingPreview.current);
    });
  }

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
  function snapFadeLen(len: number, maxLen: number, shift: boolean): number {
    const step = snapStepBeats(shift);
    return Math.max(0, Math.min(maxLen, Math.round(len / step) * step));
  }
  function clampFadeLen(len: number, maxLen: number): number {
    return Math.max(0, Math.min(maxLen, len));
  }

  function startDrag(
    mode: "move" | "resize-right" | "resize-left" | "fade-in" | "fade-out",
    e: React.PointerEvent,
  ) {
    if (e.button !== 0 || e.ctrlKey) return;
    if (repetition > 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    if (mode === "move") {
      const project = useProjectStore.getState().project;
      const ids = useUiStore.getState().selectedSegmentIds;
      const nextSelected = ids.includes(segmentId)
        ? ids
        : e.shiftKey
          ? [...ids, segmentId]
          : [segmentId];
      setSelectedSegments(nextSelected);
      setSelectedTracks([]);
      const selectedIdSet = new Set(nextSelected);
      const segments = project.tracks.flatMap((track, trackIndex) =>
        track.segments
          .filter((seg) => selectedIdSet.has(seg.id))
          .map((seg) => ({
            id: seg.id,
            startBeat: seg.startBeat,
            trackId: seg.trackId,
            trackIndex,
          })),
      );
      const originTrackIndex = Math.max(0, project.tracks.findIndex((track) => track.id === liveSeg?.trackId));
      drag.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        anchorSegmentId: segmentId,
        originTrackIndex,
        segments: segments.length > 0 ? segments : [{ id: segmentId, startBeat, trackId: liveSeg?.trackId ?? "", trackIndex: originTrackIndex }],
        moved: false,
        pendingMoves: [],
      };
    } else if (mode === "resize-right") {
      setSelectedSegments([segmentId]);
      setSelectedTracks([]);
      drag.current = {
        mode,
        startX: e.clientX,
        startBeat,
        startLen: lengthBeats,
        sourceStartBeat: liveSeg?.sourceStartBeat ?? 0,
        payload: liveSeg ? structuredClone(liveSeg.payload) : null,
        shift: e.shiftKey,
        pendingResize: null,
      };
    } else if (mode === "resize-left") {
      setSelectedSegments([segmentId]);
      setSelectedTracks([]);
      drag.current = {
        mode,
        startX: e.clientX,
        startBeat,
        startLen: lengthBeats,
        sourceStartBeat: liveSeg?.sourceStartBeat ?? 0,
        payload: liveSeg ? structuredClone(liveSeg.payload) : null,
        shift: e.shiftKey,
        pendingResize: null,
      };
    } else {
      setSelectedSegments([segmentId]);
      setSelectedTracks([]);
      drag.current = {
        mode,
        startX: e.clientX,
        startLen: lengthBeats,
        startFadeInBeats: liveSeg?.fadeInBeats ?? 0,
        startFadeOutBeats: liveSeg?.fadeOutBeats ?? 0,
        pendingFade: null,
      };
    }
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dxPx = e.clientX - d.startX;
    const dyPx = "startY" in d ? e.clientY - d.startY : 0;
    if (Math.hypot(dxPx, dyPx) < 3) return;
    if ("moved" in d) d.moved = true;
    const dxBeats = dxPx / beatsToPx;

    if (d.mode === "move") {
      const project = useProjectStore.getState().project;
      const anchor = d.segments.find((seg) => seg.id === d.anchorSegmentId) ?? d.segments[0];
      const snappedAnchor = snapBeat(anchor.startBeat + dxBeats, e.shiftKey);
      let deltaBeats = snappedAnchor - anchor.startBeat;
      const minStart = Math.min(...d.segments.map((seg) => seg.startBeat + deltaBeats));
      if (minStart < 0) deltaBeats -= minStart;
      const targetTrackIndex = trackIndexAtClientY(e.clientY, project.tracks.map((track) => track.id));
      const trackDelta = targetTrackIndex == null ? 0 : targetTrackIndex - d.originTrackIndex;
      const moves = d.segments.flatMap((seg) => {
        const targetIndex = Math.max(0, Math.min(project.tracks.length - 1, seg.trackIndex + trackDelta));
        const targetTrackId = project.tracks[targetIndex]?.id ?? seg.trackId;
        const newStart = Math.max(0, seg.startBeat + deltaBeats);
        if (seg.trackId === targetTrackId && seg.startBeat === newStart) return [];
        return [{ segmentId: seg.id, toTrackId: targetTrackId, toStartBeat: newStart }];
      });
      d.pendingMoves = moves;
      const ownMove = moves.find((move) => move.segmentId === segmentId);
      scheduleDragPreview(ownMove ? { startBeat: ownMove.toStartBeat, lengthBeats } : { startBeat, lengthBeats });
    } else if (d.mode === "resize-right") {
      const raw = d.startLen + dxBeats;
      const newLen = snapLen(raw, e.shiftKey);
      if (newLen === lengthBeats) return;
      d.pendingResize = { startBeat: d.startBeat, lengthBeats: newLen };
      scheduleDragPreview(d.pendingResize);
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
      d.pendingResize = { startBeat: clampedStart, lengthBeats: newLen };
      scheduleDragPreview(d.pendingResize);
    } else if (d.mode === "fade-in") {
      const next = {
        fadeInBeats: snapFadeLen(d.startFadeInBeats + dxBeats, d.startLen, e.shiftKey),
        fadeOutBeats: d.startFadeOutBeats,
      };
      d.pendingFade = next;
      setFadePreview(next);
    } else if (d.mode === "fade-out") {
      const next = {
        fadeInBeats: d.startFadeInBeats,
        fadeOutBeats: snapFadeLen(d.startFadeOutBeats - dxBeats, d.startLen, e.shiftKey),
      };
      d.pendingFade = next;
      setFadePreview(next);
    }
  }

  function onPointerUp() {
    const d = drag.current;
    if (d?.mode === "move" && !d.moved) {
      setSelectedSegments([segmentId]);
    } else if (d?.mode === "move" && d.pendingMoves.length > 0) {
      applySegmentEditCommand({ kind: "move", moves: d.pendingMoves });
    } else if ((d?.mode === "resize-right" || d?.mode === "resize-left") && d.pendingResize) {
      applySegmentEditCommand({
        kind: "resize",
        segmentId,
        startBeat: d.pendingResize.startBeat,
        lengthBeats: d.pendingResize.lengthBeats,
        originStartBeat: d.startBeat,
        originLengthBeats: d.startLen,
        originSourceStartBeat: d.sourceStartBeat,
        originPayload: d.payload ?? undefined,
      });
      setLastLen(d.pendingResize.lengthBeats);
    } else if (d?.mode === "fade-in" && d.pendingFade) {
      applySegmentEditCommand({ kind: "fade", segmentId, fadeInBeats: d.pendingFade.fadeInBeats });
    } else if (d?.mode === "fade-out" && d.pendingFade) {
      applySegmentEditCommand({ kind: "fade", segmentId, fadeOutBeats: d.pendingFade.fadeOutBeats });
    }
    drag.current = null;
    scheduleDragPreview(null);
    setFadePreview(null);
    setDragging(false);
  }

  function onFadeHandleKeyDown(mode: "fade-in" | "fade-out", e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!liveSeg) return;
    const step = snapStepBeats(e.shiftKey);
    const fadeIn = liveSeg.fadeInBeats ?? 0;
    const fadeOut = liveSeg.fadeOutBeats ?? 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedSegments([segmentId]);
      setSelectedTracks([]);
    } else {
      return;
    }

    if (mode === "fade-in") {
      const next = e.key === "Home"
        ? 0
        : e.key === "End"
          ? lengthBeats
          : fadeIn + (e.key === "ArrowRight" ? step : -step);
      applySegmentEditCommand({ kind: "fade", segmentId, fadeInBeats: clampFadeLen(next, lengthBeats) });
      return;
    }

    const next = e.key === "Home"
      ? 0
      : e.key === "End"
        ? lengthBeats
        : fadeOut + (e.key === "ArrowLeft" ? step : -step);
    applySegmentEditCommand({ kind: "fade", segmentId, fadeOutBeats: clampFadeLen(next, lengthBeats) });
  }

  // Right-click menu.
  const segState = useProjectStore.getState();
  const liveSeg = segState.project.tracks
    .flatMap((t) => t.segments)
    .find((s) => s.id === segmentId);
  const selectedSegments = segState.project.tracks
    .flatMap((t) => t.segments)
    .filter((s) => selectedSegmentIds.includes(s.id));

  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => {
    if (!liveSeg) return [];
    if (selected && selectedSegmentIds.length > 1) {
      return [
        {
          label: "Copy",
          icon: "ph:clipboard",
          onSelect: () => copyMany(selectedSegments),
        },
        {
          label: "Delete",
          icon: "ph:trash",
          separatorBefore: true,
          onSelect: () => {
            const ids = selectedSegments.map((seg) => seg.id);
            applySegmentEditCommand({ kind: "delete", segmentIds: ids });
            setSelectedSegments([]);
          },
        },
      ];
    }
    const isMidi =
      liveSeg.payload.kind === "midi" || liveSeg.payload.kind === "mixed";
    const canLoop = isMidi || liveSeg.payload.kind === "drum";
    const playheadBeat = useTransportStore.getState().positionBeat;
    const canSplitAtPlayhead =
      playheadBeat > liveSeg.startBeat + GRID_TICK_BEATS / 4 &&
      playheadBeat < liveSeg.startBeat + liveSeg.lengthBeats - GRID_TICK_BEATS / 4;
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
      ...(canSplitAtPlayhead
        ? [
            {
              label: "Split at Playhead",
              icon: "ph:scissors",
              separatorBefore: true,
              onSelect: () => {
                const [createdId] = applySegmentEditCommand({
                  kind: "split",
                  segmentId,
                  splitBeat: playheadBeat,
                });
                if (createdId) setSelectedSegments([createdId]);
              },
            } as ContextMenuItem,
          ]
        : []),
      {
        label: "Fade In 1/4",
        icon: "ph:triangle",
        onSelect: () => applySegmentEditCommand({ kind: "fade", segmentId, fadeInBeats: 0.25 }),
        separatorBefore: !canSplitAtPlayhead,
      },
      {
        label: "Fade Out 1/4",
        icon: "ph:triangle",
        onSelect: () => applySegmentEditCommand({ kind: "fade", segmentId, fadeOutBeats: 0.25 }),
      },
      {
        label: "Clear Fades",
        icon: "ph:x-circle",
        onSelect: () => applySegmentEditCommand({ kind: "fade", segmentId, fadeInBeats: 0, fadeOutBeats: 0 }),
      },
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
          const [createdId] = applySegmentEditCommand({
            kind: "duplicate",
            segments: [{ ...liveSeg, name: duplicateSegmentName(liveSeg) }],
            offsetBeats: liveSeg.lengthBeats,
          });
          if (createdId) setSelectedSegments([createdId]);
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
        onSelect: () => applySegmentEditCommand({ kind: "delete", segmentIds: [segmentId] }),
        separatorBefore: true,
      },
    ];
  });

  const visualStartBeat = dragPreview?.startBeat ?? startBeat;
  const visualLengthBeats = dragPreview?.lengthBeats ?? lengthBeats;
  const left = visualStartBeat * beatsToPx;
  const width = Math.max(beatsToPx / 2, visualLengthBeats * beatsToPx);
  const visualLayer = layer > 0 ? 1 : 0;
  const top = visualLayer * SEGMENT_LAYER_OFFSET_PX;
  const fadeInBeats = Math.max(0, Math.min(visualLengthBeats, fadePreview?.fadeInBeats ?? liveSeg?.fadeInBeats ?? 0));
  const fadeOutBeats = Math.max(0, Math.min(visualLengthBeats, fadePreview?.fadeOutBeats ?? liveSeg?.fadeOutBeats ?? 0));
  const fadeInPx = Math.min(width, fadeInBeats * beatsToPx);
  const fadeOutPx = Math.min(width, fadeOutBeats * beatsToPx);
  const fadeInHandleX = Math.min(Math.max(8, fadeInPx), Math.max(8, width - 8));
  const fadeOutHandleInset = Math.min(Math.max(8, fadeOutPx), Math.max(8, width - 8));

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
      style={{ left, width, top, bottom: 0, zIndex: dragging ? 90 : 10 + visualLayer }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setSelectedSegments([segmentId]);
        setSelectedTracks([]);
        onEdit();
      }}
      onContextMenu={onContextMenu}
      data-segment-id={segmentId}
      data-track-id={liveSeg?.trackId}
      data-segment-repetition={repetition}
    >
      {repetition === 0 && (
        <div
          className={`${styles.handle} ${styles.handleLeft}`}
          data-segment-handle
          onPointerDown={(e) => startDrag("resize-left", e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}

      <div
        className={styles.body}
        data-segment-body
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
              <span className={styles.repBadge} aria-label="Loop repeat">
                <Icon name="ph:repeat" size={12} decorative />
              </span>
            )}
          </span>
          <span className={styles.kindIcon} aria-hidden>
            <Icon name={kindIcon} size={12} decorative />
          </span>
        </div>
        <div className={styles.content}>
          {payloadKind === "midi" && liveSeg && (
            <SegmentMidiPreview segment={liveSeg as SegmentType} displayLengthBeats={visualLengthBeats} />
          )}
          {payloadKind === "drum" && liveSeg && (
            <SegmentDrumPreview segment={liveSeg as SegmentType} displayLengthBeats={visualLengthBeats} />
          )}
          {payloadKind === "audio" && liveSeg && (
            <SegmentWaveform segment={liveSeg as SegmentType} />
          )}
          {repetition === 0 && liveSeg && (
            <div className={styles.fadeLayer}>
              {fadeInPx > 0 && (
                <div
                  className={`${styles.fadeRegion} ${styles.fadeInRegion}`}
                  style={{ width: fadeInPx }}
                />
              )}
              {fadeOutPx > 0 && (
                <div
                  className={`${styles.fadeRegion} ${styles.fadeOutRegion}`}
                  style={{ width: fadeOutPx }}
                />
              )}
              <button
                type="button"
                className={`${styles.fadeHandle} ${styles.fadeHandleIn}`}
                style={{ left: fadeInHandleX }}
                data-segment-fade-handle="in"
                aria-label="Adjust fade in"
                onPointerDown={(e) => startDrag("fade-in", e)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onKeyDown={(e) => onFadeHandleKeyDown("fade-in", e)}
              />
              <button
                type="button"
                className={`${styles.fadeHandle} ${styles.fadeHandleOut}`}
                style={{ right: fadeOutHandleInset }}
                data-segment-fade-handle="out"
                aria-label="Adjust fade out"
                onPointerDown={(e) => startDrag("fade-out", e)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onKeyDown={(e) => onFadeHandleKeyDown("fade-out", e)}
              />
            </div>
          )}
        </div>
      </div>

      {repetition === 0 && (
        <div
          className={`${styles.handle} ${styles.handleRight}`}
          data-segment-handle
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

function trackIndexAtClientY(clientY: number, trackIds: Id[]): number | null {
  const lanes = Array.from(document.querySelectorAll<HTMLElement>("[data-track-lane-id]"));
  if (lanes.length === 0) return null;
  let closestIndex: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const lane of lanes) {
    const trackId = lane.dataset.trackLaneId;
    const index = trackIds.indexOf(trackId ?? "");
    if (index < 0) continue;
    const rect = lane.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) return index;
    const distance = clientY < rect.top ? rect.top - clientY : clientY - rect.bottom;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }
  return closestIndex;
}

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
