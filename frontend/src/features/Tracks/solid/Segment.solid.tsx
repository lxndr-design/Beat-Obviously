import { createMemo, createSignal, Show } from "solid-js";
import { createStoreSelector } from "../../../solid-utils/store";
import {
  useInstrumentStore,
  usePluginStore,
  useProjectStore,
  useSettingsStore,
  useTransportStore,
  useUiStore,
  useViewStore,
} from "../../../state/store";
import { clipboardStore } from "../../../state/clipboard";
import { useComponentStore } from "../../../state/components";
import { listDrumBeatFeedback, updateDrumBeatFeedback } from "../../../persistence/dexie";
import { maybeRunDueTraining } from "../../../ai/trainingRunner";
import { selectedCrossfadeCandidate } from "../arrangementActions";
import { decentSamplerPluginForInstrument } from "../../PluginLibrary/decentSamplerPluginAdapter";
import { appPrompt } from "../../../components";
import { createContextMenu, Icon, type ContextMenuItem } from "../../../solid-ui";
import { SEGMENT_LAYER_OFFSET_PX } from "../geometry";
import {
  GRID_TICK_BEATS,
  clampFadeLen,
  snapBeat,
  snapDragBeat,
  snapFadeLen,
  snapLen,
  snapStepBeats,
  type SegmentSnapSettings,
} from "../segmentMath";
import { SegmentMidiPreviewSolid } from "./SegmentMidiPreview.solid";
import { SegmentDrumPreviewSolid } from "./SegmentDrumPreview.solid";
import { SegmentWaveformSolid } from "./SegmentWaveform.solid";
import styles from "../Segment.module.css";
import type { Id, Segment as SegmentType } from "../../../state/types";

interface Props {
  segmentId: Id;
  startBeat: number;
  lengthBeats: number;
  repetition: number;
  layer: number;
  payloadKind: "audio" | "midi" | "drum" | "mixed";
  onEdit: () => void;
}

type DragState =
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
      mode: "resize-right" | "resize-left";
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
    };

export function SegmentSolid(props: Props) {
  let drag: DragState | null = null;
  let previewRaf: number | null = null;
  let pendingPreview: { startBeat: number; lengthBeats: number } | null = null;

  const beatsToPx = createStoreSelector(useViewStore, (state) => state.beatsToPx);
  const project = createStoreSelector(useProjectStore, (state) => state.project);
  const projectLengthBeats = createStoreSelector(useProjectStore, (state) => state.project.lengthBeats);
  const timeSignatureBeats = createStoreSelector(useProjectStore, (state) => state.project.timeSignature.num);
  const timelineSmartGrid = createStoreSelector(useSettingsStore, (state) => state.timelineSmartGrid);
  const timelineSubdivision = createStoreSelector(useSettingsStore, (state) => state.timelineSubdivision);
  const selectedSegmentIds = createStoreSelector(useUiStore, (state) => state.selectedSegmentIds);
  const openEditors = createStoreSelector(useUiStore, (state) => state.openEditors);
  const instruments = createStoreSelector(useInstrumentStore, (state) => state.instruments);
  const plugins = createStoreSelector(usePluginStore, (state) => state.plugins);
  const [editingName, setEditingName] = createSignal(false);
  const [nameDraft, setNameDraft] = createSignal("");
  const [dragging, setDragging] = createSignal(false);
  const [dragPreview, setDragPreview] = createSignal<{ startBeat: number; lengthBeats: number } | null>(null, { equals: false });
  const [fadePreview, setFadePreview] = createSignal<{ fadeInBeats: number; fadeOutBeats: number } | null>(null, { equals: false });

  const liveSeg = createMemo(() => project().tracks.flatMap((track) => track.segments).find((segment) => segment.id === props.segmentId));
  const selected = createMemo(() => selectedSegmentIds().includes(props.segmentId));
  const editing = createMemo(() => openEditors().some((editor) => editor.kind === "segment" && editor.segmentId === props.segmentId));
  const liveInstrument = createMemo(() => {
    const segment = liveSeg();
    return segment?.instrumentId ? instruments().find((instrument) => instrument.id === segment.instrumentId) : undefined;
  });
  const decentSamplerPlugin = createMemo(() => decentSamplerPluginForInstrument(liveInstrument(), plugins()));
  const selectedSegments = createMemo(() => project().tracks
    .flatMap((track) => track.segments)
    .filter((segment) => selectedSegmentIds().includes(segment.id)));
  const snapSettings = createMemo<SegmentSnapSettings>(() => ({
    timeSignatureBeats: timeSignatureBeats(),
    timelineSmartGrid: timelineSmartGrid(),
    timelineSubdivision: timelineSubdivision(),
  }));

  function scheduleDragPreview(next: { startBeat: number; lengthBeats: number } | null) {
    pendingPreview = next;
    if (previewRaf != null) return;
    previewRaf = window.requestAnimationFrame(() => {
      previewRaf = null;
      setDragPreview(pendingPreview);
    });
  }

  function startDrag(mode: DragState["mode"], event: PointerEvent) {
    if (event.button !== 0 || event.ctrlKey || props.repetition > 0) return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture(event.pointerId);
    const projectState = useProjectStore.getState().project;
    const uiStore = useUiStore.getState();
    const segment = liveSeg();

    if (mode === "move") {
      const ids = uiStore.selectedSegmentIds;
      const nextSelected = ids.includes(props.segmentId)
        ? ids
        : event.shiftKey
          ? [...ids, props.segmentId]
          : [props.segmentId];
      uiStore.setSelectedSegments(nextSelected);
      uiStore.setSelectedTracks([]);
      const selectedIdSet = new Set(nextSelected);
      const segments = projectState.tracks.flatMap((track, trackIndex) =>
        track.segments
          .filter((candidate) => selectedIdSet.has(candidate.id))
          .map((candidate) => ({
            id: candidate.id,
            startBeat: candidate.startBeat,
            trackId: candidate.trackId,
            trackIndex,
          })),
      );
      const originTrackIndex = Math.max(0, projectState.tracks.findIndex((track) => track.id === segment?.trackId));
      drag = {
        mode,
        startX: event.clientX,
        startY: event.clientY,
        anchorSegmentId: props.segmentId,
        originTrackIndex,
        segments: segments.length > 0
          ? segments
          : [{ id: props.segmentId, startBeat: props.startBeat, trackId: segment?.trackId ?? "", trackIndex: originTrackIndex }],
        moved: false,
        pendingMoves: [],
      };
    } else if (mode === "resize-left" || mode === "resize-right") {
      uiStore.setSelectedSegments([props.segmentId]);
      uiStore.setSelectedTracks([]);
      drag = {
        mode,
        startX: event.clientX,
        startBeat: props.startBeat,
        startLen: props.lengthBeats,
        sourceStartBeat: segment?.sourceStartBeat ?? 0,
        payload: segment ? structuredClone(segment.payload) : null,
        shift: event.shiftKey,
        pendingResize: null,
      };
    } else {
      uiStore.setSelectedSegments([props.segmentId]);
      uiStore.setSelectedTracks([]);
      drag = {
        mode,
        startX: event.clientX,
        startLen: props.lengthBeats,
        startFadeInBeats: segment?.fadeInBeats ?? 0,
        startFadeOutBeats: segment?.fadeOutBeats ?? 0,
        pendingFade: null,
      };
    }
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent) {
    const currentDrag = drag;
    if (!currentDrag) return;
    const dxPx = event.clientX - currentDrag.startX;
    const dyPx = "startY" in currentDrag ? event.clientY - currentDrag.startY : 0;
    if (Math.hypot(dxPx, dyPx) < 3) return;
    if ("moved" in currentDrag) currentDrag.moved = true;
    const dxBeats = dxPx / beatsToPx();
    const settings = snapSettings();

    if (currentDrag.mode === "move") {
      const projectState = useProjectStore.getState().project;
      const anchor = currentDrag.segments.find((segment) => segment.id === currentDrag.anchorSegmentId) ?? currentDrag.segments[0];
      const snappedAnchor = snapDragBeat(anchor.startBeat + dxBeats, event.shiftKey, settings);
      let deltaBeats = snappedAnchor - anchor.startBeat;
      const minStart = Math.min(...currentDrag.segments.map((segment) => segment.startBeat + deltaBeats));
      if (minStart < 0) deltaBeats -= minStart;
      const targetTrackIndex = trackIndexAtClientY(event.clientY, projectState.tracks.map((track) => track.id));
      const trackDelta = targetTrackIndex == null ? 0 : targetTrackIndex - currentDrag.originTrackIndex;
      const moves = currentDrag.segments.flatMap((segment) => {
        const targetIndex = Math.max(0, Math.min(projectState.tracks.length - 1, segment.trackIndex + trackDelta));
        const targetTrackId = projectState.tracks[targetIndex]?.id ?? segment.trackId;
        const newStart = Math.max(0, segment.startBeat + deltaBeats);
        if (segment.trackId === targetTrackId && segment.startBeat === newStart) return [];
        return [{ segmentId: segment.id, toTrackId: targetTrackId, toStartBeat: newStart }];
      });
      currentDrag.pendingMoves = moves;
      const ownMove = moves.find((move) => move.segmentId === props.segmentId);
      scheduleDragPreview(ownMove ? { startBeat: ownMove.toStartBeat, lengthBeats: props.lengthBeats } : { startBeat: props.startBeat, lengthBeats: props.lengthBeats });
    } else if (currentDrag.mode === "resize-right") {
      const newLen = snapLen(currentDrag.startLen + dxBeats, event.shiftKey, settings);
      if (newLen === props.lengthBeats) return;
      currentDrag.pendingResize = { startBeat: currentDrag.startBeat, lengthBeats: newLen };
      scheduleDragPreview(currentDrag.pendingResize);
    } else if (currentDrag.mode === "resize-left") {
      const rightBeat = currentDrag.startBeat + currentDrag.startLen;
      const rawStart = currentDrag.startBeat + dxBeats;
      const snappedStart = snapBeat(rawStart, event.shiftKey, settings);
      const clampedStart = Math.min(rightBeat - GRID_TICK_BEATS, snappedStart);
      const newLen = rightBeat - clampedStart;
      if (clampedStart === props.startBeat && newLen === props.lengthBeats) return;
      currentDrag.pendingResize = { startBeat: clampedStart, lengthBeats: newLen };
      scheduleDragPreview(currentDrag.pendingResize);
    } else if (currentDrag.mode === "fade-in") {
      const next = {
        fadeInBeats: snapFadeLen(currentDrag.startFadeInBeats + dxBeats, currentDrag.startLen, event.shiftKey, settings),
        fadeOutBeats: currentDrag.startFadeOutBeats,
      };
      currentDrag.pendingFade = next;
      setFadePreview(next);
    } else if (currentDrag.mode === "fade-out") {
      const next = {
        fadeInBeats: currentDrag.startFadeInBeats,
        fadeOutBeats: snapFadeLen(currentDrag.startFadeOutBeats - dxBeats, currentDrag.startLen, event.shiftKey, settings),
      };
      currentDrag.pendingFade = next;
      setFadePreview(next);
    }
  }

  function onPointerUp() {
    const currentDrag = drag;
    const projectStore = useProjectStore.getState();
    const uiStore = useUiStore.getState();
    if (currentDrag?.mode === "move" && !currentDrag.moved) {
      uiStore.setSelectedSegments([props.segmentId]);
    } else if (currentDrag?.mode === "move" && currentDrag.pendingMoves.length > 0) {
      projectStore.applySegmentEditCommand({ kind: "move", moves: currentDrag.pendingMoves });
    } else if ((currentDrag?.mode === "resize-right" || currentDrag?.mode === "resize-left") && currentDrag.pendingResize) {
      projectStore.applySegmentEditCommand({
        kind: "resize",
        segmentId: props.segmentId,
        startBeat: currentDrag.pendingResize.startBeat,
        lengthBeats: currentDrag.pendingResize.lengthBeats,
        originStartBeat: currentDrag.startBeat,
        originLengthBeats: currentDrag.startLen,
        originSourceStartBeat: currentDrag.sourceStartBeat,
        originPayload: currentDrag.payload ?? undefined,
      });
      useViewStore.getState().setLastSegmentLength(currentDrag.pendingResize.lengthBeats);
    } else if (currentDrag?.mode === "fade-in" && currentDrag.pendingFade) {
      projectStore.applySegmentEditCommand({ kind: "fade", segmentId: props.segmentId, fadeInBeats: currentDrag.pendingFade.fadeInBeats });
    } else if (currentDrag?.mode === "fade-out" && currentDrag.pendingFade) {
      projectStore.applySegmentEditCommand({ kind: "fade", segmentId: props.segmentId, fadeOutBeats: currentDrag.pendingFade.fadeOutBeats });
    }
    drag = null;
    scheduleDragPreview(null);
    setFadePreview(null);
    setDragging(false);
  }

  function onFadeHandleKeyDown(mode: "fade-in" | "fade-out", event: KeyboardEvent) {
    const segment = liveSeg();
    if (!segment) return;
    const step = snapStepBeats(event.shiftKey, snapSettings());
    const fadeIn = segment.fadeInBeats ?? 0;
    const fadeOut = segment.fadeOutBeats ?? 0;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      useUiStore.getState().setSelectedSegments([props.segmentId]);
      useUiStore.getState().setSelectedTracks([]);
    } else {
      return;
    }

    if (mode === "fade-in") {
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? props.lengthBeats
          : fadeIn + (event.key === "ArrowRight" ? step : -step);
      useProjectStore.getState().applySegmentEditCommand({ kind: "fade", segmentId: props.segmentId, fadeInBeats: clampFadeLen(next, props.lengthBeats) });
      return;
    }

    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? props.lengthBeats
        : fadeOut + (event.key === "ArrowLeft" ? step : -step);
    useProjectStore.getState().applySegmentEditCommand({ kind: "fade", segmentId: props.segmentId, fadeOutBeats: clampFadeLen(next, props.lengthBeats) });
  }

  const menu = createContextMenu((): ContextMenuItem[] => {
    const segment = liveSeg();
    if (!segment) return [];
    const projectStore = useProjectStore.getState();
    const uiStore = useUiStore.getState();
    if (selected() && selectedSegmentIds().length > 1) {
      const crossfadeCandidate = selectedCrossfadeCandidate(selectedSegments());
      const selectedIds = selectedSegments().map((candidate) => candidate.id);
      const groupedIds = Array.from(new Set(selectedSegments()
        .map((candidate) => candidate.groupId)
        .filter((groupId): groupId is Id => Boolean(groupId))));
      return [
        ...(crossfadeCandidate
          ? [{
              label: crossfadeCandidate.kind === "overlap" ? "Crossfade Overlap" : "Crossfade Adjacent",
              icon: "ph:wave-triangle",
              onSelect: () => {
                projectStore.applySegmentEditCommand({
                  kind: "crossfade",
                  firstSegmentId: crossfadeCandidate.firstSegmentId,
                  secondSegmentId: crossfadeCandidate.secondSegmentId,
                  lengthBeats: crossfadeCandidate.lengthBeats,
                });
              },
            } as ContextMenuItem]
          : []),
        {
          label: "Group",
          icon: "ph:brackets-square",
          separatorBefore: Boolean(crossfadeCandidate),
          onSelect: () => projectStore.applySegmentEditCommand({ kind: "group", segmentIds: selectedIds }),
        },
        ...(groupedIds.length > 0
          ? [{
              label: "Ungroup",
              icon: "ph:brackets-curly",
              onSelect: () => projectStore.applySegmentEditCommand({ kind: "ungroup", groupIds: groupedIds }),
            } as ContextMenuItem]
          : []),
        {
          label: "Copy",
          icon: "ph:clipboard",
          separatorBefore: true,
          onSelect: () => clipboardStore.getState().copyMany(selectedSegments()),
        },
        {
          label: "Delete",
          icon: "ph:trash",
          separatorBefore: true,
          onSelect: () => {
            projectStore.applySegmentEditCommand({ kind: "delete", segmentIds: selectedIds });
            uiStore.setSelectedSegments([]);
          },
        },
      ];
    }
    const isMidi = segment.payload.kind === "midi" || segment.payload.kind === "mixed";
    const canLoop = isMidi || segment.payload.kind === "drum";
    const playheadBeat = useTransportStore.getState().positionBeat;
    const canSplitAtPlayhead = playheadBeat > segment.startBeat + GRID_TICK_BEATS / 4
      && playheadBeat < segment.startBeat + segment.lengthBeats - GRID_TICK_BEATS / 4;
    const dsPlugin = decentSamplerPlugin();
    return [
      { label: "Edit", icon: "ph:pencil-simple", onSelect: props.onEdit },
      ...(dsPlugin
        ? [{
            label: "Edit DS Instrument",
            icon: "ph:package",
            onSelect: () => uiStore.openEditor({ kind: "plugin", pluginId: dsPlugin.id }),
          } as ContextMenuItem]
        : []),
      {
        label: "Rename",
        icon: "ph:text-aa",
        onSelect: () => {
          void (async () => {
            const next = await appPrompt("Segment name", segment.name ?? "");
            if (next != null) {
              projectStore.applySegmentEditCommand({ kind: "metadata", segmentIds: [props.segmentId], name: next });
            }
          })();
        },
      },
      ...(canLoop
        ? [{
            label: segment.repeats > 0 ? "Unloop" : "Loop",
            icon: "ph:repeat",
            onSelect: () => {
              const remaining = Math.max(0, projectLengthBeats() - segment.startBeat - segment.lengthBeats);
              const repeats = segment.repeats > 0 ? 0 : Math.max(0, Math.ceil(remaining / segment.lengthBeats));
              projectStore.setSegmentRepeats(props.segmentId, repeats);
            },
          } as ContextMenuItem]
        : []),
      ...(canSplitAtPlayhead
        ? [{
            label: "Split at Playhead",
            icon: "ph:scissors",
            separatorBefore: true,
            onSelect: () => {
              const [createdId] = projectStore.applySegmentEditCommand({ kind: "split", segmentId: props.segmentId, splitBeat: playheadBeat });
              if (createdId) uiStore.setSelectedSegments([createdId]);
            },
          } as ContextMenuItem]
        : []),
      {
        label: "Fade In 1/4",
        icon: "ph:triangle",
        onSelect: () => projectStore.applySegmentEditCommand({ kind: "fade", segmentId: props.segmentId, fadeInBeats: 0.25 }),
        separatorBefore: !canSplitAtPlayhead,
      },
      {
        label: "Fade Out 1/4",
        icon: "ph:triangle",
        onSelect: () => projectStore.applySegmentEditCommand({ kind: "fade", segmentId: props.segmentId, fadeOutBeats: 0.25 }),
      },
      {
        label: "Clear Fades",
        icon: "ph:x-circle",
        onSelect: () => projectStore.applySegmentEditCommand({ kind: "fade", segmentId: props.segmentId, fadeInBeats: 0, fadeOutBeats: 0 }),
      },
      ...(isMidi || segment.payload.kind === "drum"
        ? [{
            label: "Save as Component",
            icon: "ph:package",
            onSelect: () => {
              const fallback = segment.name?.trim() || "Untitled Component";
              void (async () => {
                const name = await appPrompt("Component name", fallback) ?? fallback;
                if (!name) return;
                if (segment.payload.kind === "drum") {
                  useComponentStore.getState().add({
                    kind: "drum",
                    name,
                    rows: segment.payload.rows,
                    stepCount: segment.payload.stepCount,
                    speed: segment.payload.speed,
                    defaultPitchHz: segment.payload.defaultPitchHz,
                    swingPercent: segment.payload.swingPercent,
                    timeSignature: segment.payload.timeSignature,
                    lengthBeats: segment.lengthBeats,
                  });
                  void markSavedGeneratedDrum(segment);
                } else if (segment.payload.kind === "midi" || segment.payload.kind === "mixed") {
                  useComponentStore.getState().add({
                    kind: "midi",
                    name,
                    notes: segment.payload.notes,
                    lengthBeats: segment.lengthBeats,
                    instrumentId: segment.instrumentId,
                  });
                }
              })();
            },
          } as ContextMenuItem]
        : []),
      {
        label: "Duplicate",
        icon: "ph:copy",
        onSelect: () => {
          const [createdId] = projectStore.applySegmentEditCommand({
            kind: "duplicate",
            segments: [{ ...segment, name: duplicateSegmentName(segment) }],
            offsetBeats: segment.lengthBeats,
          });
          if (createdId) uiStore.setSelectedSegments([createdId]);
        },
        separatorBefore: true,
      },
      {
        label: "Copy",
        icon: "ph:clipboard",
        onSelect: () => clipboardStore.getState().copy(segment),
      },
      {
        label: "Paste",
        icon: "ph:clipboard-text",
        onSelect: () => {
          const pasted = clipboardStore.getState().paste();
          if (!pasted) return;
          const [createdId] = projectStore.applySegmentEditCommand({
            kind: "paste",
            targetTrackId: segment.trackId,
            startBeat: segment.startBeat + segment.lengthBeats,
            segments: [{
              ...pasted,
              name: duplicateSegmentName(pasted),
            }],
          });
          if (createdId) uiStore.setSelectedSegments([createdId]);
        },
      },
      {
        label: "Delete",
        icon: "ph:trash",
        onSelect: () => projectStore.applySegmentEditCommand({ kind: "delete", segmentIds: [props.segmentId] }),
        separatorBefore: true,
      },
    ];
  });

  function handleContextMenu(event: MouseEvent) {
    if (!selected()) {
      useUiStore.getState().setSelectedSegments([props.segmentId]);
      useUiStore.getState().setSelectedTracks([]);
    }
    menu.onContextMenu(event);
  }

  const visualStartBeat = createMemo(() => dragPreview()?.startBeat ?? props.startBeat);
  const visualLengthBeats = createMemo(() => dragPreview()?.lengthBeats ?? props.lengthBeats);
  const left = createMemo(() => visualStartBeat() * beatsToPx());
  const width = createMemo(() => Math.max(beatsToPx() / 2, visualLengthBeats() * beatsToPx()));
  const visualLayer = createMemo(() => props.layer > 0 ? 1 : 0);
  const top = createMemo(() => visualLayer() * SEGMENT_LAYER_OFFSET_PX);
  const fadeInBeats = createMemo(() => Math.max(0, Math.min(visualLengthBeats(), fadePreview()?.fadeInBeats ?? liveSeg()?.fadeInBeats ?? 0)));
  const fadeOutBeats = createMemo(() => Math.max(0, Math.min(visualLengthBeats(), fadePreview()?.fadeOutBeats ?? liveSeg()?.fadeOutBeats ?? 0)));
  const fadeInPx = createMemo(() => Math.min(width(), fadeInBeats() * beatsToPx()));
  const fadeOutPx = createMemo(() => Math.min(width(), fadeOutBeats() * beatsToPx()));
  const fadeInHandleX = createMemo(() => Math.min(Math.max(8, fadeInPx()), Math.max(8, width() - 8)));
  const fadeOutHandleInset = createMemo(() => Math.min(Math.max(8, fadeOutPx()), Math.max(8, width() - 8)));
  const label = createMemo(() => liveSeg()?.name?.trim() || defaultName(props.payloadKind));
  const kindIcon = createMemo(() =>
    props.payloadKind === "midi"
      ? "ph:piano-keys"
      : props.payloadKind === "audio"
        ? "ph:music-notes-simple"
        : props.payloadKind === "drum"
          ? "ph:squares-four"
          : "ph:dots-three");

  return (
    <div
      class={[
        styles.segment,
        selected() && styles.selected,
        editing() && styles.editing,
        dragging() && styles.dragging,
        props.layer > 0 && styles.layered,
        props.repetition > 0 && styles.virtual,
      ].filter(Boolean).join(" ")}
      style={{ left: `${left()}px`, width: `${width()}px`, top: `${top()}px`, bottom: "0", "z-index": dragging() ? 90 : 10 + visualLayer() }}
      onDblClick={(event) => {
        event.stopPropagation();
        useUiStore.getState().setSelectedSegments([props.segmentId]);
        useUiStore.getState().setSelectedTracks([]);
        props.onEdit();
      }}
      onContextMenu={handleContextMenu}
      data-segment-id={props.segmentId}
      data-track-id={liveSeg()?.trackId}
      data-segment-repetition={props.repetition}
    >
      <Show when={props.repetition === 0}>
        <div
          class={`${styles.handle} ${styles.handleLeft}`}
          data-segment-handle
          onPointerDown={(event) => startDrag("resize-left", event)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      </Show>

      <div
        class={styles.body}
        data-segment-body
        onPointerDown={(event) => startDrag("move", event)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div class={styles.labelStrip}>
          <span class={styles.nameplate}>
            <Show
              when={editingName()}
              fallback={(
                <span
                  class={styles.nameText}
                  onDblClick={(event) => {
                    event.stopPropagation();
                    const segment = liveSeg();
                    if (props.repetition > 0 || !segment) return;
                    setNameDraft(segment.name ?? label());
                    setEditingName(true);
                  }}
                >
                  {label()}
                </span>
              )}
            >
              <input
                class={styles.nameInput}
                autofocus
                value={nameDraft()}
                onPointerDown={(event) => event.stopPropagation()}
                onDblClick={(event) => event.stopPropagation()}
                onInput={(event) => setNameDraft(event.currentTarget.value)}
                onBlur={() => {
                  useProjectStore.getState().applySegmentEditCommand({
                    kind: "metadata",
                    segmentIds: [props.segmentId],
                    name: nameDraft(),
                  });
                  setEditingName(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setEditingName(false);
                }}
              />
            </Show>
            <Show when={props.repetition > 0}>
              <span class={styles.repBadge} aria-label="Loop repeat">
                <Icon name="ph:repeat" size={12} decorative />
              </span>
            </Show>
            <Show when={decentSamplerPlugin()}>
              <span class={styles.decentSamplerBadge} aria-label="DecentSampler instrument">
                <img src="/assets/decent-sampler.svg" alt="" aria-hidden="true" />
              </span>
            </Show>
          </span>
          <span class={styles.kindIcon} aria-hidden="true">
            <Icon name={kindIcon()} size={12} decorative />
          </span>
        </div>
        <div class={styles.content}>
          <Show when={props.payloadKind === "midi" && liveSeg()}>
            {(segment) => <SegmentMidiPreviewSolid segment={segment()} displayLengthBeats={visualLengthBeats()} />}
          </Show>
          <Show when={props.payloadKind === "drum" && liveSeg()}>
            {(segment) => <SegmentDrumPreviewSolid segment={segment()} displayLengthBeats={visualLengthBeats()} />}
          </Show>
          <Show when={props.payloadKind === "audio" && liveSeg()}>
            {(segment) => <SegmentWaveformSolid segment={segment()} />}
          </Show>
          <Show when={props.repetition === 0 && liveSeg()}>
            <div class={styles.fadeLayer}>
              <Show when={fadeInPx() > 0}>
                <div class={`${styles.fadeRegion} ${styles.fadeInRegion}`} style={{ width: `${fadeInPx()}px` }} />
              </Show>
              <Show when={fadeOutPx() > 0}>
                <div class={`${styles.fadeRegion} ${styles.fadeOutRegion}`} style={{ width: `${fadeOutPx()}px` }} />
              </Show>
              <Show when={fadeInBeats() > 0}>
                <button
                  type="button"
                  class={`${styles.fadeHandle} ${styles.fadeHandleIn}`}
                  style={{ left: `${fadeInHandleX()}px` }}
                  data-segment-fade-handle="in"
                  aria-label="Adjust fade in"
                  onPointerDown={(event) => startDrag("fade-in", event)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onKeyDown={(event) => onFadeHandleKeyDown("fade-in", event)}
                />
              </Show>
              <Show when={fadeOutBeats() > 0}>
                <button
                  type="button"
                  class={`${styles.fadeHandle} ${styles.fadeHandleOut}`}
                  style={{ right: `${fadeOutHandleInset()}px` }}
                  data-segment-fade-handle="out"
                  aria-label="Adjust fade out"
                  onPointerDown={(event) => startDrag("fade-out", event)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onKeyDown={(event) => onFadeHandleKeyDown("fade-out", event)}
                />
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <Show when={props.repetition === 0}>
        <div
          class={`${styles.handle} ${styles.handleRight}`}
          data-segment-handle
          onPointerDown={(event) => startDrag("resize-right", event)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      </Show>

      {menu.menu()}
    </div>
  );
}

function defaultName(kind: "audio" | "midi" | "drum" | "mixed"): string {
  return kind === "midi" ? "Midi" : kind === "audio" ? "Audio" : kind === "drum" ? "Drums" : "Mixed";
}

function duplicateSegmentName(segment: SegmentType): string {
  const kind = segment.payload.kind === "audio" ? "audio" : segment.payload.kind === "drum" ? "drum" : "midi";
  const stem = kind === "midi" ? "Midi" : kind === "audio" ? "Audio" : "Drums";
  const trimmed = segment.name?.trim() ?? "";
  if (!trimmed || new RegExp(`^${stem}\\s+\\d+$`).test(trimmed)) return nextAutoSegmentName(kind);
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
  while (used.has(next)) next += 1;
  return `${stem} ${next}`;
}

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

async function markSavedGeneratedDrum(segment: SegmentType) {
  if (segment.payload.kind !== "drum") return;
  const payload = segment.payload;
  const feedback = await listDrumBeatFeedback(20);
  const match = feedback.find((entry) => {
    const beat = entry.finalBeat ?? entry.modelBeat;
    return beat.stepCount === payload.stepCount
      && beat.speed === payload.speed
      && JSON.stringify(beat.rows) === JSON.stringify(payload.rows);
  });
  if (!match) return;
  await updateDrumBeatFeedback(match.id, {
    savedAsComponent: true,
    rating: match.rating ?? "up",
    finalBeat: {
      rows: structuredClone(payload.rows),
      stepCount: payload.stepCount,
      lengthBeats: segment.lengthBeats,
      speed: payload.speed,
      swingPercent: payload.swingPercent ?? 50,
      defaultPitchHz: payload.defaultPitchHz,
      source: "local",
    },
  });
  void maybeRunDueTraining("drums");
}
