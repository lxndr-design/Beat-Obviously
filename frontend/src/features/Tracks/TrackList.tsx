import { useRef } from "react";
import { Block, Button, Icon, HoverInfo } from "../../components";
import { useProjectStore, useViewStore } from "../../state/store";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { Timeline } from "./Timeline";
import { Playhead } from "./Playhead";
import styles from "./TrackList.module.css";

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
  const beatsToPx = useViewStore((s) => s.beatsToPx);
  const setZoom = useViewStore((s) => s.setZoom);
  const laneScrollRef = useRef<HTMLDivElement>(null);

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    setZoom(beatsToPx + dir * ZOOM_STEP);
  }

  return (
    <Block title="Tracks" framed fill>
      <div className={styles.area}>
        <div className={styles.headerCol}>
          {tracks.map((t, i) => (
            <TrackHeader key={t.id} trackId={t.id} index={i} />
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
                <TrackLane key={t.id} trackId={t.id} />
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
    </Block>
  );
}
