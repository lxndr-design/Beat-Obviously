import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Block, Button, Icon, HoverInfo } from "../../components";
import { useProjectStore, useTransportStore, useUiStore, useViewStore } from "../../state/store";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { TrackEffectHeaderRows, TrackEffectLaneRows } from "./TrackEffectRows";
import { Timeline } from "./Timeline";
import { Playhead } from "./Playhead";
import {
  clampClientYToTimeline,
  marqueeStyleFromClientPoints,
  normalizedTimelineRect,
  rectsOverlap,
  type TimelineRect,
} from "./geometry";
import styles from "./TrackList.module.css";
import type { Id } from "../../state/types";

const ZOOM_STEP = 8;
const MIN_ZOOM = 16;
const MAX_ZOOM = 192;

/**
 * TrackList — main center panel.
 *
 * The lane area is wrapped in a positioning context so the zoom cluster
 * can `position: absolute` to the **viewport** of the lanes (bottom-right,
 * 8px inset), not the scroll content.
 */
export function TrackList() {
  const tracks = useProjectStore((s) => s.project.tracks);
  const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
  const addTrack = useProjectStore((s) => s.addTrack);
  const selectedTrackIds = useUiStore((s) => s.selectedTrackIds);
  const setSelectedTracks = useUiStore((s) => s.setSelectedTracks);
  const setSelectedSegments = useUiStore((s) => s.setSelectedSegments);
  const loopEnabled = useTransportStore((s) => s.loopEnabled);
  const loopRange = useTransportStore((s) => s.loopRange);
  const beatsToPx = useViewStore((s) => s.beatsToPx);
  const setZoom = useViewStore((s) => s.setZoom);
  const laneScrollRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [expandedEffectIds, setExpandedEffectIds] = useState<Set<Id>>(() => new Set());
  const marqueeRef = useRef<MarqueeState | null>(null);
  const suppressLaneClickRef = useRef(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setSelectedTracks([]);
      setSelectedSegments([]);
    }

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0 || event.ctrlKey) return;
      if (event.shiftKey) return;
      const target = event.target as Element | null;
      if (target?.closest("[data-track-header], [data-floating-layer]")) return;
      setSelectedTracks([]);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [setSelectedSegments, setSelectedTracks]);

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    setZoom(beatsToPx + dir * ZOOM_STEP);
  }

  function updateMarqueeSelection(next: MarqueeState) {
    const rect = normalizedTimelineRect(
      next.startClientX,
      clampMarqueeClientY(next.startClientY, laneScrollRef.current),
      next.currentClientX,
      clampMarqueeClientY(next.currentClientY, laneScrollRef.current),
    );
    const ids = new Set<Id>();
    laneScrollRef.current
      ?.querySelectorAll<HTMLElement>("[data-segment-id]")
      .forEach((node) => {
        const segmentId = node.dataset.segmentId;
        if (!segmentId) return;
        if (rectsOverlap(rect, rectFromDom(node.getBoundingClientRect()))) ids.add(segmentId);
      });
    setSelectedSegments(Array.from(ids));
    setSelectedTracks([]);
  }

  function onLanePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || e.ctrlKey) return;
    const target = e.target as Element;
    if (target.closest("[data-timeline-ruler], [data-segment-body], [data-segment-handle], input, button, [data-floating-layer]")) return;
    const inner = laneScrollRef.current?.querySelector<HTMLElement>(`.${styles.lanesInner}`);
    if (!inner?.contains(target)) return;
    const next = {
      startClientX: e.clientX,
      startClientY: clampMarqueeClientY(e.clientY, laneScrollRef.current),
      currentClientX: e.clientX,
      currentClientY: clampMarqueeClientY(e.clientY, laneScrollRef.current),
      active: false,
    };
    marqueeRef.current = next;
    setMarquee(next);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onLanePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const current = marqueeRef.current;
    if (!current) return;
    const active = current.active || Math.hypot(e.clientX - current.startClientX, e.clientY - current.startClientY) >= 4;
    const currentClientY = clampMarqueeClientY(e.clientY, laneScrollRef.current);
    const next = {
      ...current,
      currentClientX: e.clientX,
      currentClientY,
      active,
    };
    marqueeRef.current = next;
    setMarquee(next);
    if (active) updateMarqueeSelection(next);
  }

  function onLanePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const current = marqueeRef.current;
    if (!current) return;
    if (!current.active) {
      setSelectedSegments([]);
      setSelectedTracks([]);
    }
    else {
      updateMarqueeSelection(current);
      suppressLaneClickRef.current = true;
      window.setTimeout(() => {
        suppressLaneClickRef.current = false;
      }, 0);
    }
    marqueeRef.current = null;
    setMarquee(null);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function cancelPendingMarquee() {
    if (!marqueeRef.current && !marquee) return;
    marqueeRef.current = null;
    setMarquee(null);
    suppressLaneClickRef.current = true;
    window.setTimeout(() => {
      suppressLaneClickRef.current = false;
    }, 0);
  }

  function onLaneClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (!suppressLaneClickRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressLaneClickRef.current = false;
  }

  function selectTrack(trackId: Id, shiftKey: boolean) {
    setSelectedSegments([]);
    if (shiftKey) {
      const next = new Set(selectedTrackIds);
      next.add(trackId);
      setSelectedTracks(Array.from(next));
      return;
    }
    setSelectedTracks([trackId]);
  }

  function toggleEffectRows(effectId: Id) {
    setExpandedEffectIds((current) => {
      const next = new Set(current);
      if (next.has(effectId)) next.delete(effectId);
      else next.add(effectId);
      return next;
    });
  }

  return (
    <Block title="Tracks" framed fill className={styles.tracksBlock}>
      <div className={styles.panel}>
        <div className={styles.area}>
        <div className={styles.headerCol}>
          {tracks.map((t, i) => (
            <div key={t.id}>
              <TrackHeader
                trackId={t.id}
                index={i}
                selected={selectedTrackIds.includes(t.id)}
                onSelect={(event) => selectTrack(t.id, event.shiftKey)}
              />
              <TrackEffectHeaderRows
                trackId={t.id}
                expandedEffectIds={expandedEffectIds}
                onToggleEffect={toggleEffectRows}
              />
            </div>
          ))}
          <button
            type="button"
            className={styles.addRow}
            onClick={() => addTrack({})}
            aria-label="Add track"
          >
            <Icon name="ph:plus" size={16} decorative />
            <span>Add track</span>
          </button>
          <div className={styles.timelineSpacer} aria-hidden />
        </div>

        <div className={styles.laneWrap}>
          <div
            ref={laneScrollRef}
            className={styles.laneScroll}
            onWheel={onWheel}
          >
            <div
              className={styles.lanesInner}
              style={{ width: lengthBeats * beatsToPx }}
              onPointerDown={onLanePointerDown}
              onPointerMove={onLanePointerMove}
              onPointerUp={onLanePointerUp}
              onPointerCancel={cancelPendingMarquee}
              onContextMenuCapture={cancelPendingMarquee}
              onClickCapture={onLaneClickCapture}
            >
              {tracks.map((t) => (
                <div key={t.id}>
                  <TrackLane
                    trackId={t.id}
                    selected={selectedTrackIds.includes(t.id)}
                  />
                  <TrackEffectLaneRows
                    trackId={t.id}
                    expandedEffectIds={expandedEffectIds}
                    onToggleEffect={toggleEffectRows}
                  />
                </div>
              ))}
              {loopRange.endBeat > loopRange.startBeat && (
                <div
                  className={`${styles.loopLaneRegion} ${loopEnabled ? styles.loopLaneRegionEnabled : ""}`}
                  style={{
                    left: loopRange.startBeat * beatsToPx,
                    width: (loopRange.endBeat - loopRange.startBeat) * beatsToPx,
                  }}
                  aria-hidden
                />
              )}
              <div className={styles.addRowLaneSpacer} />
              <Playhead />
              <Timeline />
              {marquee && <div className={styles.marquee} style={marqueeStyle(marquee, laneScrollRef.current)} />}
            </div>
          </div>

          {/* Truly floating — anchored to the viewport, NOT inside the scroll. */}
          <div className={styles.zoomFloat}>
            <HoverInfo content="Zoom out">
              <Button
                iconOnly
                size="xs"
                onClick={() => setZoom(Math.max(MIN_ZOOM, beatsToPx - ZOOM_STEP))}
                aria-label="Zoom out"
              >
                <Icon name="ph:magnifying-glass-minus" size={16} decorative />
              </Button>
            </HoverInfo>
            <HoverInfo content="Zoom in">
              <Button
                iconOnly
                size="xs"
                onClick={() => setZoom(Math.min(MAX_ZOOM, beatsToPx + ZOOM_STEP))}
                aria-label="Zoom in"
              >
                <Icon name="ph:magnifying-glass-plus" size={16} decorative />
              </Button>
            </HoverInfo>
          </div>
        </div>
        </div>
      </div>
    </Block>
  );
}

interface MarqueeState {
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  active: boolean;
}

function marqueeStyle(state: MarqueeState, laneScroll: HTMLDivElement | null): CSSProperties {
  const inner = laneScroll?.querySelector<HTMLElement>(`.${styles.lanesInner}`);
  const rect = inner?.getBoundingClientRect();
  return marqueeStyleFromClientPoints(
    state.startClientX,
    state.startClientY,
    state.currentClientX,
    state.currentClientY,
    rect?.left ?? 0,
    rect?.top ?? 0,
    getTimelineTop(laneScroll),
  );
}

function clampMarqueeClientY(clientY: number, laneScroll: HTMLDivElement | null): number {
  return clampClientYToTimeline(clientY, getTimelineTop(laneScroll));
}

function getTimelineTop(laneScroll: HTMLDivElement | null): number | undefined {
  const timeline = laneScroll?.querySelector<HTMLElement>("[data-timeline-ruler]");
  return timeline?.getBoundingClientRect().top;
}

function rectFromDom(rect: DOMRect): TimelineRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}
