import { useMemo, useRef } from "react";
import { Icon, HoverInfo, Button, useContextMenu, type ContextMenuItem } from "../../components";
import { useProjectStore, useUiStore } from "../../state/store";
import { expandTrackSegments } from "../../state/selectors";
import { Segment } from "./Segment";
import { BEATS_TO_PX, TRACK_HEADER_WIDTH } from "./geometry";
import styles from "./TrackRow.module.css";
import type { Id } from "../../state/types";

interface Props {
  trackId: Id;
}

/**
 * TrackRow — header column + lane.
 *
 * Header has the editable name, plus Solo / Mute icon-only toggles.
 * Lane right-click adds a segment at the clicked beat; the segment defaults
 * to MIDI (editable via the piano roll) since tracks are generic now.
 */
export function TrackRow({ trackId }: Props) {
  const track = useProjectStore((s) =>
    s.project.tracks.find((t) => t.id === trackId),
  );
  const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
  const removeTrack = useProjectStore((s) => s.removeTrack);
  const updateTrack = useProjectStore((s) => s.updateTrack);
  const addSegment = useProjectStore((s) => s.addSegment);
  const addTrack = useProjectStore((s) => s.addTrack);
  const openEditor = useUiStore((s) => s.openEditor);
  const laneRef = useRef<HTMLDivElement>(null);
  const lastClickBeatRef = useRef<number | null>(null);

  const expanded = useMemo(
    () => (track ? expandTrackSegments(track, lengthBeats) : []),
    [track, lengthBeats],
  );

  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => {
    if (!track) return [];
    return [
      {
        label: "Add MIDI segment here",
        icon: "ph:piano-keys",
        onSelect: () => {
          const beat = lastClickBeatRef.current ?? 0;
          addSegment(trackId, {
            startBeat: beat,
            lengthBeats: 4,
            payload: { kind: "midi", notes: [] },
          });
        },
      },
      {
        label: "Add audio segment here",
        icon: "ph:music-notes-simple",
        onSelect: () => {
          const beat = lastClickBeatRef.current ?? 0;
          addSegment(trackId, {
            startBeat: beat,
            lengthBeats: 4,
            payload: { kind: "audio", audioFileId: "", gainDb: 0 },
          });
        },
      },
      {
        label: track.mute ? "Unmute" : "Mute",
        icon: track.mute ? "ph:speaker-high" : "ph:speaker-x",
        onSelect: () => updateTrack(trackId, { mute: !track.mute }),
        separatorBefore: true,
      },
      {
        label: track.solo ? "Unsolo" : "Solo",
        icon: "ph:headphones",
        onSelect: () => updateTrack(trackId, { solo: !track.solo }),
      },
      {
        label: "Add track",
        icon: "ph:plus",
        onSelect: () => addTrack({}),
        separatorBefore: true,
      },
      {
        label: "Delete track",
        icon: "ph:trash",
        onSelect: () => removeTrack(trackId),
        separatorBefore: true,
      },
    ];
  });

  if (!track) return null;

  function handleContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    const lane = laneRef.current;
    if (lane) {
      const r = lane.getBoundingClientRect();
      const px = e.clientX - r.left;
      lastClickBeatRef.current = Math.max(0, Math.round(px / BEATS_TO_PX));
    }
    onContextMenu(e);
  }

  const segById = new Map(track.segments.map((s) => [s.id, s]));

  return (
    <div
      className={`${styles.row} ${track.rowHeight === "compact" ? styles.compact : ""}`}
      style={{ width: `${TRACK_HEADER_WIDTH + lengthBeats * BEATS_TO_PX}px` }}
    >
      <div className={styles.header} style={{ width: TRACK_HEADER_WIDTH }}>
        <input
          className={styles.name}
          value={track.name}
          onChange={(e) => updateTrack(trackId, { name: e.target.value })}
        />
        <div className={styles.controls}>
          <HoverInfo content={track.solo ? "Unsolo" : "Solo (mute all others)"}>
            <Button
              iconOnly
              size="sm"
              selected={track.solo}
              onClick={() => updateTrack(trackId, { solo: !track.solo })}
              aria-label={track.solo ? "Unsolo" : "Solo"}
            >
              <span className={styles.smLabel}>S</span>
            </Button>
          </HoverInfo>
          <HoverInfo content={track.mute ? "Unmute" : "Mute"}>
            <Button
              iconOnly
              size="sm"
              selected={track.mute}
              onClick={() => updateTrack(trackId, { mute: !track.mute })}
              aria-label={track.mute ? "Unmute" : "Mute"}
            >
              <span className={styles.smLabel}>M</span>
            </Button>
          </HoverInfo>
          <HoverInfo content="Remove track">
            <button
              className={styles.removeBtn}
              onClick={() => removeTrack(trackId)}
              aria-label="Remove track"
              type="button"
            >
              <Icon name="ph:trash" size={16} decorative />
            </button>
          </HoverInfo>
        </div>
      </div>

      <div
        ref={laneRef}
        className={styles.lane}
        onContextMenu={handleContextMenu}
        style={{ width: `${lengthBeats * BEATS_TO_PX}px` }}
      >
        {Array.from({ length: lengthBeats + 1 }, (_, b) => (
          <div
            key={b}
            className={`${styles.gridLine} ${b % 4 === 0 ? styles.gridLineMajor : ""}`}
            style={{ left: `${b * BEATS_TO_PX}px` }}
          />
        ))}

        {expanded.map((occ, idx) => {
          const original = segById.get(occ.segmentId)!;
          return (
            <Segment
              key={`${occ.segmentId}:${occ.repetition}:${idx}`}
              segmentId={occ.segmentId}
              startBeat={occ.startBeat}
              lengthBeats={occ.lengthBeats}
              repetition={occ.repetition}
              layer={original.layer}
              payloadKind={original.payload.kind}
              onEdit={() =>
                openEditor({ kind: "segment", segmentId: occ.segmentId })
              }
            />
          );
        })}
      </div>
      {menu}
    </div>
  );
}
