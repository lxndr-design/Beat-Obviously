import { useTransportStore, useViewStore } from "../../state/store";
import styles from "./Playhead.module.css";

/**
 * Playhead — vertical line that follows the transport position.
 * Lives inside the lane-scroll column, so it doesn't need to offset
 * for the track-header column (which is in a separate grid column).
 */
export function Playhead() {
  const position = useTransportStore((s) => s.positionBeat);
  const beatsToPx = useViewStore((s) => s.beatsToPx);
  return (
    <div
      className={styles.playhead}
      style={{ left: position * beatsToPx }}
      aria-hidden
    />
  );
}
