import { createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { createStoreSelector } from "../../../solid-utils/store";
import { Button, HoverInfo, Icon } from "../../../solid-ui";
import { useProjectStore, useTransportStore, useUiStore, useViewStore } from "../../../state/store";
import { clipboardStore } from "../../../state/clipboard";
import { TrackLaneSolid } from "./TrackLane.solid";
import { TrackEffectHeaderRowsSolid, TrackEffectLaneRowsSolid } from "./TrackEffectRows.solid";
import { TimelineSolid } from "./Timeline.solid";
import { PlayheadSolid } from "./Playhead.solid";
import { TrackHeaderSolid } from "./TrackHeader.solid";
import {
  clampClientYToTimeline,
  marqueeStyleFromClientPoints,
  normalizedTimelineRect,
  rectsOverlap,
  type TimelineRect,
} from "../geometry";
import styles from "../TrackList.module.css";
import type { Id } from "../../../state/types";

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

export function TrackListSolid() {
  let laneScrollElement: HTMLDivElement | undefined;
  let marqueeRef: MarqueeState | null = null;
  let suppressLaneClick = false;

  const tracks = createStoreSelector(useProjectStore, (state) => state.project.tracks);
  const lengthBeats = createStoreSelector(useProjectStore, (state) => state.project.lengthBeats);
  const selectedTrackIds = createStoreSelector(useUiStore, (state) => state.selectedTrackIds);
  const selectedSegmentIds = createStoreSelector(useUiStore, (state) => state.selectedSegmentIds);
  const loopEnabled = createStoreSelector(useTransportStore, (state) => state.loopEnabled);
  const loopRange = createStoreSelector(useTransportStore, (state) => state.loopRange);
  const beatsToPx = createStoreSelector(useViewStore, (state) => state.beatsToPx);
  const [marquee, setMarquee] = createSignal<MarqueeState | null>(null, { equals: false });
  const [expandedEffectIds, setExpandedEffectIds] = createSignal<Set<Id>>(new Set(), { equals: false });
  const selectedSegments = createMemo(() => {
    const ids = new Set(selectedSegmentIds());
    return tracks().flatMap((track) => track.segments).filter((segment) => ids.has(segment.id));
  });
  const selectedGroupIds = createMemo(() => Array.from(new Set(selectedSegments()
    .map((segment) => segment.groupId)
    .filter((groupId): groupId is Id => Boolean(groupId)))));

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
      clampMarqueeClientY(next.startClientY, laneScrollElement),
      next.currentClientX,
      clampMarqueeClientY(next.currentClientY, laneScrollElement),
    );
    const ids = new Set<Id>();
    laneScrollElement
      ?.querySelectorAll<HTMLElement>("[data-segment-id]")
      .forEach((node) => {
        const segmentId = node.dataset.segmentId;
        if (!segmentId) return;
        if (rectsOverlap(rect, rectFromDom(node.getBoundingClientRect()))) ids.add(segmentId);
      });
    useUiStore.getState().setSelectedSegments(Array.from(ids));
    useUiStore.getState().setSelectedTracks([]);
  }

  function onLanePointerDown(event: PointerEvent) {
    if (event.button !== 0 || event.ctrlKey) return;
    const target = event.target as Element;
    if (target.closest("[data-timeline-ruler], [data-segment-body], [data-segment-handle], [data-segment-fade-handle], input, button, [data-floating-layer]")) return;
    const inner = laneScrollElement?.querySelector<HTMLElement>(`.${styles.lanesInner}`);
    if (!inner?.contains(target)) return;
    const next = {
      startClientX: event.clientX,
      startClientY: clampMarqueeClientY(event.clientY, laneScrollElement),
      currentClientX: event.clientX,
      currentClientY: clampMarqueeClientY(event.clientY, laneScrollElement),
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
    const currentClientY = clampMarqueeClientY(event.clientY, laneScrollElement);
    const next = {
      ...current,
      currentClientX: event.clientX,
      currentClientY,
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

  return (
    <div class={styles.panel}>
      <div class={styles.area}>
        <div class={styles.headerCol}>
          <For each={tracks()}>
            {(track, index) => (
              <div>
                <TrackHeaderSolid
                  trackId={track.id}
                  index={index()}
                  selected={selectedTrackIds().includes(track.id)}
                  onSelect={(event) => selectTrack(track.id, event.shiftKey)}
                />
                <TrackEffectHeaderRowsSolid
                  trackId={track.id}
                  expandedEffectIds={expandedEffectIds()}
                  onToggleEffect={toggleEffectRows}
                />
              </div>
            )}
          </For>
          <button
            type="button"
            class={styles.addRow}
            onClick={addTrack}
            aria-label="Add track"
          >
            <Icon name="ph:plus" size={16} decorative />
            <span>Add track</span>
          </button>
          <div class={styles.timelineSpacer} aria-hidden="true" />
        </div>

        <div class={styles.laneWrap}>
          <Show when={selectedSegments().length > 1}>
            <div class={styles.selectionBar} data-floating-layer>
              <span class={styles.selectionCount}>{selectedSegments().length}</span>
              <HoverInfo content="Group selected segments">
                <Button iconOnly size="xs" aria-label="Group selected segments" onClick={groupSelectedSegments}>
                  <Icon name="ph:brackets-square" size={16} decorative />
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
                  <Icon name="ph:brackets-curly" size={16} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Copy selected segments">
                <Button iconOnly size="xs" aria-label="Copy selected segments" onClick={copySelectedSegments}>
                  <Icon name="ph:clipboard" size={16} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Delete selected segments">
                <Button iconOnly size="xs" aria-label="Delete selected segments" onClick={deleteSelectedSegments}>
                  <Icon name="ph:trash" size={16} decorative />
                </Button>
              </HoverInfo>
            </div>
          </Show>
          <div
            ref={laneScrollElement}
            class={styles.laneScroll}
            onWheel={onWheel}
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
              <For each={tracks()}>
                {(track) => (
                  <div>
                    <TrackLaneSolid
                      trackId={track.id}
                      selected={selectedTrackIds().includes(track.id)}
                    />
                    <TrackEffectLaneRowsSolid
                      trackId={track.id}
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
              <PlayheadSolid />
              <TimelineSolid />
              <Show when={marquee()}>
                {(current) => <div class={styles.marquee} style={marqueeStyle(current(), laneScrollElement)} />}
              </Show>
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
                <Icon name="ph:magnifying-glass-minus" size={16} decorative />
              </Button>
            </HoverInfo>
            <HoverInfo content="Zoom in">
              <Button
                iconOnly
                size="xs"
                onClick={() => setZoom(Math.min(MAX_ZOOM, beatsToPx() + ZOOM_STEP))}
                aria-label="Zoom in"
              >
                <Icon name="ph:magnifying-glass-plus" size={16} decorative />
              </Button>
            </HoverInfo>
          </div>
        </div>
      </div>
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
    getTimelineTop(laneScroll),
  );
  return {
    left: `${next.left}px`,
    top: `${next.top}px`,
    width: `${next.width}px`,
    height: `${next.height}px`,
  };
}

function clampMarqueeClientY(clientY: number, laneScroll: HTMLDivElement | undefined): number {
  return clampClientYToTimeline(clientY, getTimelineTop(laneScroll));
}

function getTimelineTop(laneScroll: HTMLDivElement | undefined): number | undefined {
  const timeline = laneScroll?.querySelector<HTMLElement>("[data-timeline-ruler]");
  return timeline?.getBoundingClientRect().top;
}

function rectFromDom(rect: DOMRect): TimelineRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}
