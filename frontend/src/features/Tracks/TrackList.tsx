import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid as newNanoid } from "nanoid";
import { Block, Button, Icon, HoverInfo, useContextMenu, type ContextMenuItem } from "../../components";
import { useProjectStore, useUiStore, useViewStore } from "../../state/store";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { Timeline } from "./Timeline";
import { Playhead } from "./Playhead";
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
  const project = useProjectStore((s) => s.project);
  const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
  const addTrack = useProjectStore((s) => s.addTrack);
  const removeTrack = useProjectStore((s) => s.removeTrack);
  const loadProject = useProjectStore((s) => s.loadProject);
  const selectedTrackIds = useUiStore((s) => s.selectedTrackIds);
  const setSelectedTracks = useUiStore((s) => s.setSelectedTracks);
  const beatsToPx = useViewStore((s) => s.beatsToPx);
  const setZoom = useViewStore((s) => s.setZoom);
  const rootRef = useRef<HTMLDivElement>(null);
  const laneScrollRef = useRef<HTMLDivElement>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [lastSelectedId, setLastSelectedId] = useState<Id | null>(null);
  const selectedTracks = useMemo(
    () => tracks.filter((track) => selectedTrackIds.includes(track.id)),
    [tracks, selectedTrackIds],
  );

  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    {
      label: "Select",
      icon: "ph:checks",
      onSelect: () => enterSelectMode(),
    },
  ]);

  useEffect(() => {
    if (!selectMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") exitSelectMode();
    }
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      exitSelectMode();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [selectMode]);

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    setZoom(beatsToPx + dir * ZOOM_STEP);
  }

  function enterSelectMode(trackId?: Id) {
    setSelectMode(true);
    if (trackId) {
      setSelectedTracks([trackId]);
      setLastSelectedId(trackId);
    }
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedTracks([]);
    setLastSelectedId(null);
  }

  function selectTrack(trackId: Id, shiftKey: boolean) {
    setSelectMode(true);
    const current = new Set(selectedTrackIds);
    if (shiftKey && lastSelectedId) {
      const start = tracks.findIndex((track) => track.id === lastSelectedId);
      const end = tracks.findIndex((track) => track.id === trackId);
      if (start >= 0 && end >= 0) {
        const [lo, hi] = start < end ? [start, end] : [end, start];
        tracks.slice(lo, hi + 1).forEach((track) => current.add(track.id));
        setSelectedTracks(Array.from(current));
        setLastSelectedId(trackId);
        return;
      }
    }
    if (current.has(trackId)) current.delete(trackId);
    else current.add(trackId);
    setSelectedTracks(Array.from(current));
    setLastSelectedId(trackId);
  }

  function deleteSelected() {
    if (selectedTrackIds.length === 0 || selectedTrackIds.length >= tracks.length) return;
    selectedTrackIds.forEach((id) => removeTrack(id));
    exitSelectMode();
  }

  function duplicateSelected() {
    if (selectedTracks.length === 0) return;
    const selected = new Set(selectedTrackIds);
    const nextTracks = [...project.tracks];
    let offset = 0;
    project.tracks.forEach((track, index) => {
      if (!selected.has(track.id)) return;
      const newId = newNanoid();
      const copy = {
        ...structuredClone(track),
        id: newId,
        name: `${track.name} copy`,
        segments: track.segments.map((segment) => ({
          ...structuredClone(segment),
          id: newNanoid(),
          trackId: newId,
        })),
      };
      nextTracks.splice(index + 1 + offset, 0, copy);
      offset++;
    });
    loadProject({ ...project, tracks: nextTracks });
    exitSelectMode();
  }

  return (
    <Block title="Tracks" framed fill>
      <div ref={rootRef} className={styles.panel} onContextMenu={onContextMenu}>
        {selectMode && (
          <div className={styles.selectionBar}>
            <Button
              size="xs"
              disabled={selectedTracks.length === 0 || selectedTracks.length >= tracks.length}
              onClick={deleteSelected}
            >
              Delete
            </Button>
            <Button size="xs" disabled={selectedTracks.length === 0} onClick={duplicateSelected}>
              Duplicate
            </Button>
            <span className={styles.selectionCount}>{selectedTracks.length}</span>
          </div>
        )}
        <div className={styles.area}>
        <div className={styles.headerCol}>
          {tracks.map((t, i) => (
            <TrackHeader
              key={t.id}
              trackId={t.id}
              index={i}
              selectMode={selectMode}
              selected={selectedTrackIds.includes(t.id)}
              onSelect={(event) => selectTrack(t.id, event.shiftKey)}
              onEnterSelectMode={() => enterSelectMode(t.id)}
            />
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
            >
              {tracks.map((t) => (
                <TrackLane
                  key={t.id}
                  trackId={t.id}
                  selectMode={selectMode}
                  selected={selectedTrackIds.includes(t.id)}
                  onSelect={(event) => selectTrack(t.id, event.shiftKey)}
                  onEnterSelectMode={() => enterSelectMode(t.id)}
                />
              ))}
              <div className={styles.addRowLaneSpacer} />
              <Playhead />
              <Timeline />
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
      {menu}
    </Block>
  );
}
