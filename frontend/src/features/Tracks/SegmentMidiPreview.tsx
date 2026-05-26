import type { Segment } from "../../state/types";
import styles from "./SegmentMidiPreview.module.css";

interface Props {
  segment: Segment;
}

/**
 * SegmentMidiPreview — black mini-notes drawn on the white segment body.
 * Shows note positions/lengths at a glance. Pitch is mapped to vertical
 * position within the segment height (clamped 0..1).
 */
export function SegmentMidiPreview({ segment }: Props) {
  if (segment.payload.kind !== "midi" && segment.payload.kind !== "mixed") return null;
  const notes = segment.payload.notes;
  if (notes.length === 0) return null;

  // Determine pitch range present in the segment so the preview uses the
  // full vertical space.
  let minP = Infinity;
  let maxP = -Infinity;
  for (const n of notes) {
    if (n.pitch < minP) minP = n.pitch;
    if (n.pitch > maxP) maxP = n.pitch;
  }
  if (minP === maxP) {
    minP -= 6;
    maxP += 6;
  }
  const pitchRange = Math.max(1, maxP - minP);
  const segLen = Math.max(0.001, segment.lengthBeats);

  return (
    <svg
      className={styles.svg}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {notes.map((n, i) => {
        const x = (n.startBeat / segLen) * 100;
        const w = Math.max(0.5, (n.lengthBeats / segLen) * 100);
        const y = (1 - (n.pitch - minP) / pitchRange) * 100;
        return (
          <rect
            key={i}
            x={x}
            y={Math.max(0, Math.min(98, y - 2))}
            width={Math.min(100 - x, w)}
            height={3}
            className={styles.note}
          />
        );
      })}
    </svg>
  );
}
