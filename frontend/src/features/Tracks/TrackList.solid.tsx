import { createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { createStoreSelector } from "../../solid-utils/store";
import { Button, HoverInfo, Icon } from "../../solid-ui";
import { useAudioFileStore, useProjectStore, useTransportStore, useUiStore, useViewStore } from "../../state/store";
import { clipboardStore } from "../../state/clipboard";
import { AudioRecordingModal } from "./AudioRecordingModal.solid";
import { TrackLane } from "./TrackLane.solid";
import { TrackEffectHeaderRows, TrackEffectLaneRows } from "./TrackEffectRows.solid";
import { Timeline } from "./Timeline.solid";
import { Playhead } from "./Playhead.solid";
import { TrackHeader } from "./TrackHeader.solid";
import { TrackAutomationHeaderRows, TrackAutomationLaneRows } from "./TrackAutomationRows.solid";
import {
  marqueeStyleFromClientPoints,
  normalizedTimelineRect,
  rectsOverlap,
  type TimelineRect,
} from "./geometry";
import styles from "./TrackList.module.css";
import type { AudioFile, Id } from "../../state/types";

const ZOOM_STEP = 8;
const MIN_ZOOM = 16;
const MAX_ZOOM = 192;

interface MarqueeState {
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  active: boolean;
}

export function TrackList() {
  let laneScrollElement: HTMLDivElement | undefined;
  let marqueeRef: MarqueeState | null = null;
  let suppressLaneClick = false;

  const tracks = createStoreSelector(useProjectStore, (state) => state.project.tracks);
  const lengthBeats = createStoreSelector(useProjectStore, (state) => state.project.lengthBeats);
  const bpm = createStoreSelector(useProjectStore, (state) => state.project.bpm);
  const audioFiles = createStoreSelector(useAudioFileStore, (state) => state.files);
  const selectedTrackIds = createStoreSelector(useUiStore, (state) => state.selectedTrackIds);
  const selectedSegmentIds = createStoreSelector(useUiStore, (state) => state.selectedSegmentIds);
  const loopEnabled = createStoreSelector(useTransportStore, (state) => state.loopEnabled);
  const loopRange = createStoreSelector(useTransportStore, (state) => state.loopRange);
  const beatsToPx = createStoreSelector(useViewStore, (state) => state.beatsToPx);
  const [marquee, setMarquee] = createSignal<MarqueeState | null>(null, { equals: false });
  const [horizontalScrollLeft, setHorizontalScrollLeft] = createSignal(0);
  const [expandedEffectIds, setExpandedEffectIds] = createSignal<Set<Id>>(new Set(), { equals: false });
  const [expandedAutomationTrackIds, setExpandedAutomationTrackIds] = createSignal<Set<Id>>(new Set(), { equals: false });
  const [audioRecordingRequest, setAudioRecordingRequest] = createSignal<{ trackId: Id; startBeat: number; recordingGroupId: Id } | null>(null);
  const selectedSegments = createMemo(() => {
    const ids = new Set(selectedSegmentIds());
    return tracks().flatMap((track) => track.segments).filter((segment) => ids.has(segment.id));
  });
  const selectedGroupIds = createMemo(() => Array.from(new Set(selectedSegments()
    .map((segment) => segment.groupId)
    .filter((groupId): groupId is Id => Boolean(groupId)))));
  const audioRecordingContext = createMemo(() => {
    const request = audioRecordingRequest();
    const track = request ? tracks().find((candidate) => candidate.id === request.trackId) : undefined;
    if (!request || !track) return null;
    const filesById = new Map(audioFiles().map((file) => [file.id, file]));
    const takes = track.segments
      .filter((segment) => segment.recordingGroupId === request.recordingGroupId && segment.payload.kind === "audio")
      .sort((a, b) => (a.recordingTakeNumber ?? 0) - (b.recordingTakeNumber ?? 0) || (a.recordedAt ?? 0) - (b.recordedAt ?? 0))
      .map((segment) => ({ segment, file: filesById.get(segment.payload.kind === "audio" ? segment.payload.audioFileId : "") }));
    return { request, track, takes };
  });

  function clearSelection() {
    useUiStore.getState().setSelectedTracks([]);
    useUiStore.getState().setSelectedSegments([]);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    clearSelection();
  }

  function onGlobalPointerDown(event: PointerEvent) {
    if (event.button !== 0 || event.ctrlKey || event.shiftKey) return;
    const target = event.target as Element | null;
    if (target?.closest("[data-track-header], [data-floating-layer]")) return;
    useUiStore.getState().setSelectedTracks([]);
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("pointerdown", onGlobalPointerDown);
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pointerdown", onGlobalPointerDown);
  });

  function onWheel(event: WheelEvent) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    useViewStore.getState().setZoom(beatsToPx() + direction * ZOOM_STEP);
  }

  function updateMarqueeSelection(next: MarqueeState) {
    const rect = normalizedTimelineRect(
      next.startClientX,
      next.startClientY,
      next.currentClientX,
      next.currentClientY,
    );
    const ids = new Set<Id>();
    const effectPointKeys = new Set<string>();
    laneScrollElement
      ?.querySelectorAll<HTMLElement>("[data-segment-id]")
      .forEach((node) => {
        const segmentId = node.dataset.segmentId;
        if (!segmentId) return;
        if (rectsOverlap(rect, rectFromDom(node.getBoundingClientRect()))) ids.add(segmentId);
      });
    laneScrollElement
      ?.querySelectorAll<HTMLElement>("[data-track-timepoint-selection-key]")
      .forEach((node) => {
        const pointKey = node.dataset.trackTimepointSelectionKey;
        if (!pointKey) return;
        if (rectsOverlap(rect, rectFromDom(node.getBoundingClientRect()))) effectPointKeys.add(pointKey);
      });
    if (effectPointKeys.size > 0) {
      useUiStore.getState().setSelectedTrackEffectAutomationPoints(Array.from(effectPointKeys));
      return;
    }
    useUiStore.getState().setSelectedSegments(Array.from(ids));
    useUiStore.getState().setSelectedTracks([]);
  }

  function onLanePointerDown(event: PointerEvent) {
    if (event.button !== 0 || event.ctrlKey) return;
    const target = event.target as Element;
    if (target.closest("[data-timeline-ruler], [data-segment-body], [data-segment-handle], [data-segment-fade-handle], [data-track-timepoint-selection-key], [data-track-automation-lane], input, button, [data-floating-layer]")) return;
    const inner = laneScrollElement?.querySelector<HTMLElement>(`.${styles.lanesInner}`);
    if (!inner?.contains(target)) return;
    const next = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      active: false,
    };
    marqueeRef = next;
    setMarquee(next);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onLanePointerMove(event: PointerEvent) {
    const current = marqueeRef;
    if (!current) return;
    const active = current.active || Math.hypot(event.clientX - current.startClientX, event.clientY - current.startClientY) >= 4;
    const next = {
      ...current,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      active,
    };
    marqueeRef = next;
    setMarquee(next);
    if (active) updateMarqueeSelection(next);
  }

  function onLanePointerUp(event: PointerEvent) {
    const current = marqueeRef;
    if (!current) return;
    if (!current.active) {
      clearSelection();
    } else {
      updateMarqueeSelection(current);
      suppressLaneClick = true;
      window.setTimeout(() => {
        suppressLaneClick = false;
      }, 0);
    }
    marqueeRef = null;
    setMarquee(null);
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  function cancelPendingMarquee() {
    if (!marqueeRef && !marquee()) return;
    marqueeRef = null;
    setMarquee(null);
    suppressLaneClick = true;
    window.setTimeout(() => {
      suppressLaneClick = false;
    }, 0);
  }

  function onLaneClickCapture(event: MouseEvent) {
    if (!suppressLaneClick) return;
    event.preventDefault();
    event.stopPropagation();
    suppressLaneClick = false;
  }

  function selectTrack(trackId: Id, shiftKey: boolean) {
    const uiStore = useUiStore.getState();
    uiStore.setSelectedSegments([]);
    if (shiftKey) {
      const next = new Set(selectedTrackIds());
      next.add(trackId);
      uiStore.setSelectedTracks(Array.from(next));
      return;
    }
    uiStore.setSelectedTracks([trackId]);
  }

  function toggleEffectRows(effectId: Id) {
    setExpandedEffectIds((current) => {
      const next = new Set(current);
      if (next.has(effectId)) next.delete(effectId);
      else next.add(effectId);
      return next;
    });
  }

  function toggleAutomationRows(trackId: Id) {
    setExpandedAutomationTrackIds((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

  function addTrack() {
    useProjectStore.getState().addTrack({});
  }

  function setZoom(next: number) {
    useViewStore.getState().setZoom(next);
  }

  function groupSelectedSegments() {
    const ids = selectedSegments().map((segment) => segment.id);
    if (ids.length < 2) return;
    useProjectStore.getState().applySegmentEditCommand({ kind: "group", segmentIds: ids });
  }

  function ungroupSelectedSegments() {
    const groupIds = selectedGroupIds();
    if (groupIds.length === 0) return;
    useProjectStore.getState().applySegmentEditCommand({ kind: "ungroup", groupIds });
  }

  function copySelectedSegments() {
    clipboardStore.getState().copyMany(selectedSegments());
  }

  function deleteSelectedSegments() {
    const ids = selectedSegments().map((segment) => segment.id);
    if (ids.length === 0) return;
    useProjectStore.getState().applySegmentEditCommand({ kind: "delete", segmentIds: ids });
    useUiStore.getState().setSelectedSegments([]);
  }

  function commitRecordedTake(take: {
    file: AudioFile;
    lengthBeats: number;
    sourceStartBeat: number;
    segmentId?: Id;
    recordedAt?: number;
  }) {
    const request = audioRecordingRequest();
    if (!request) return;
    const lengthBeats = Math.max(0.03125, take.lengthBeats);
    const track = tracks().find((candidate) => candidate.id === request.trackId);
    const existingTakes = track?.segments.filter((segment) => segment.recordingGroupId === request.recordingGroupId) ?? [];
    const takeNumber = existingTakes.reduce((maximum, segment) => Math.max(maximum, segment.recordingTakeNumber ?? 0), 0) + 1;
    useAudioFileStore.getState().addFile(take.file);
    useProjectStore.getState().addSegment(request.trackId, {
      ...(take.segmentId ? { id: take.segmentId } : {}),
      name: `Live Record · Take ${takeNumber}`,
      startBeat: request.startBeat,
      lengthBeats,
      sourceStartBeat: take.sourceStartBeat,
      payload: { kind: "audio", audioFileId: take.file.id, gainDb: 0 },
      recordingGroupId: request.recordingGroupId,
      recordingTakeNumber: takeNumber,
      recordedAt: take.recordedAt ?? Date.now(),
      recordingInputDeviceId: track?.inputDeviceId ?? "",
      recordingInputDeviceName: useProjectStore.getState().project.recordingInput.inputDeviceName ?? "",
      muted: false,
    });
    useViewStore.getState().setLastSegmentLength(lengthBeats);
  }

  function toggleRecordedTake(segmentId: Id, enabled: boolean) {
    useProjectStore.getState().updateSegment(segmentId, { muted: !enabled });
  }

  function updateRecordingInput(input: { id: string; name: string; channelCount: number }) {
    const request = audioRecordingRequest();
    if (!request) return;
    const projectStore = useProjectStore.getState();
    projectStore.updateTrack(request.trackId, {
      inputDeviceId: input.id,
      inputChannelCount: input.channelCount,
    });
    projectStore.updateRecordingInput({
      inputDeviceId: input.id,
      inputDeviceName: input.name,
      inputChannelCount: input.channelCount,
    });
  }

  return (
    <div class={styles.panel}>
      <div class={styles.area}>
        <div class={styles.headerCol}>
          <div class={styles.timelineSpacer} aria-hidden="true" />
          <For each={tracks().map((track) => track.id)}>
            {(trackId, index) => (
              <div>
                <TrackHeader
                  trackId={trackId}
                  index={index()}
                  selected={selectedTrackIds().includes(trackId)}
                  automationExpanded={expandedAutomationTrackIds().has(trackId)}
                  onSelect={(event) => selectTrack(trackId, event.shiftKey)}
                  onToggleAutomation={() => toggleAutomationRows(trackId)}
                />
                <TrackAutomationHeaderRows
                  trackId={trackId}
                  expanded={expandedAutomationTrackIds().has(trackId)}
                  onToggle={() => toggleAutomationRows(trackId)}
                />
                <TrackEffectHeaderRows
                  trackId={trackId}
                  expandedEffectIds={expandedEffectIds()}
                  onToggleEffect={toggleEffectRows}
                />
              </div>
            )}
          </For>
          <Button
            variant="ghost"
            class={styles.addRow}
            onClick={addTrack}
            aria-label="Add track"
          >
            <Icon name="ph:plus" size={18} decorative />
            <span>Add track</span>
          </Button>
        </div>

        <div class={styles.laneWrap}>
          <div class={styles.timelineDock}>
            <Timeline scrollLeft={horizontalScrollLeft()} />
            <Playhead offsetPx={-horizontalScrollLeft()} />
          </div>
          <Show when={selectedSegments().length > 1}>
            <div class={styles.selectionBar} data-floating-layer>
              <span class={styles.selectionCount}>{selectedSegments().length}</span>
              <HoverInfo content="Group selected segments">
                <Button iconOnly size="xs" aria-label="Group selected segments" onClick={groupSelectedSegments}>
                  <Icon name="ph:brackets-square" size={18} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Ungroup selected segments">
                <Button
                  iconOnly
                  size="xs"
                  aria-label="Ungroup selected segments"
                  disabled={selectedGroupIds().length === 0}
                  onClick={ungroupSelectedSegments}
                >
                  <Icon name="ph:brackets-curly" size={18} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Copy selected segments">
                <Button iconOnly size="xs" aria-label="Copy selected segments" onClick={copySelectedSegments}>
                  <Icon name="ph:clipboard" size={18} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Delete selected segments">
                <Button iconOnly size="xs" aria-label="Delete selected segments" onClick={deleteSelectedSegments}>
                  <Icon name="ph:trash" size={18} decorative />
                </Button>
              </HoverInfo>
            </div>
          </Show>
          <div
            ref={laneScrollElement}
            class={styles.laneScroll}
            onWheel={onWheel}
            onScroll={(event) => setHorizontalScrollLeft(event.currentTarget.scrollLeft)}
          >
            <div
              class={styles.lanesInner}
              style={{ width: `${lengthBeats() * beatsToPx()}px` }}
              onPointerDown={onLanePointerDown}
              onPointerMove={onLanePointerMove}
              onPointerUp={onLanePointerUp}
              onPointerCancel={cancelPendingMarquee}
              onContextMenu={cancelPendingMarquee}
              onClick={onLaneClickCapture}
            >
              <For each={tracks().map((track) => track.id)}>
                {(trackId) => (
                  <div>
                    <TrackLane
                      trackId={trackId}
                      selected={selectedTrackIds().includes(trackId)}
                      onRequestAudioRecording={(request) => setAudioRecordingRequest(request)}
                    />
                    <TrackAutomationLaneRows
                      trackId={trackId}
                      expanded={expandedAutomationTrackIds().has(trackId)}
                      onToggle={() => toggleAutomationRows(trackId)}
                    />
                    <TrackEffectLaneRows
                      trackId={trackId}
                      expandedEffectIds={expandedEffectIds()}
                      onToggleEffect={toggleEffectRows}
                    />
                  </div>
                )}
              </For>
              <Show when={loopRange().endBeat > loopRange().startBeat}>
                <div
                  class={`${styles.loopLaneRegion} ${loopEnabled() ? styles.loopLaneRegionEnabled : ""}`}
                  style={{
                    left: `${loopRange().startBeat * beatsToPx()}px`,
                    width: `${(loopRange().endBeat - loopRange().startBeat) * beatsToPx()}px`,
                  }}
                  aria-hidden="true"
                />
              </Show>
              <div class={styles.addRowLaneSpacer} />
              <Playhead />
              <Show when={marquee()}>
                {(current) => <div class={styles.marquee} style={marqueeStyle(current(), laneScrollElement)} />}
              </Show>
            </div>
          </div>

        </div>
      </div>

      <div class={styles.zoomFloat}>
        <HoverInfo content="Zoom out">
          <Button
            iconOnly
            size="xs"
            onClick={() => setZoom(Math.max(MIN_ZOOM, beatsToPx() - ZOOM_STEP))}
            aria-label="Zoom out"
          >
            <Icon name="ph:magnifying-glass-minus" size={18} decorative />
          </Button>
        </HoverInfo>
        <HoverInfo content="Zoom in">
          <Button
            iconOnly
            size="xs"
            onClick={() => setZoom(Math.min(MAX_ZOOM, beatsToPx() + ZOOM_STEP))}
            aria-label="Zoom in"
          >
            <Icon name="ph:magnifying-glass-plus" size={18} decorative />
          </Button>
        </HoverInfo>
      </div>

      <Show when={audioRecordingContext()}>
        {(context) => (
          <AudioRecordingModal
            trackId={context().request.trackId}
            trackName={context().track.name}
            startBeat={context().request.startBeat}
            recordingGroupId={context().request.recordingGroupId}
            bpm={bpm()}
            inputDeviceId={context().track.inputDeviceId ?? ""}
            inputDeviceName={useProjectStore.getState().project.recordingInput.inputDeviceName ?? ""}
            inputChannelCount={context().track.inputChannelCount}
            takes={context().takes}
            onClose={() => setAudioRecordingRequest(null)}
            onCommit={commitRecordedTake}
            onToggleTake={toggleRecordedTake}
            onInputDeviceChange={updateRecordingInput}
          />
        )}
      </Show>
    </div>
  );
}

function marqueeStyle(state: MarqueeState, laneScroll: HTMLDivElement | undefined): JSX.CSSProperties {
  const inner = laneScroll?.querySelector<HTMLElement>(`.${styles.lanesInner}`);
  const rect = inner?.getBoundingClientRect();
  const next = marqueeStyleFromClientPoints(
    state.startClientX,
    state.startClientY,
    state.currentClientX,
    state.currentClientY,
    rect?.left ?? 0,
    rect?.top ?? 0,
    undefined,
  );
  return {
    left: `${next.left}px`,
    top: `${next.top}px`,
    width: `${next.width}px`,
    height: `${next.height}px`,
  };
}

function rectFromDom(rect: DOMRect): TimelineRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}
