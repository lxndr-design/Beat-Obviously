import type { Segment } from "../../state/types";
import { drumStepOn } from "../../state/drumSteps";
import styles from "./SegmentDrumPreview.module.css";

interface Props {
  segment: Segment;
  displayLengthBeats?: number;
}

export function SegmentDrumPreview({ segment, displayLengthBeats }: Props) {
  if (segment.payload.kind !== "drum") return null;
  const { rows, stepCount } = segment.payload;
  if (rows.length === 0 || stepCount <= 0) return null;
  const viewLen = Math.max(0.001, displayLengthBeats ?? segment.lengthBeats);
  const stepBeats = segment.lengthBeats / stepCount;

  return (
    <svg className={styles.svg} viewBox={`0 0 ${viewLen} 100`} preserveAspectRatio="none" aria-hidden>
      {rows.map((row, rowIdx) => {
        const rowH = 100 / rows.length;
        const rowTop = rowIdx * rowH;
        return row.steps.slice(0, stepCount).map((step, stepIdx) => {
          if (!drumStepOn(step)) return null;
          const cellX = stepIdx * stepBeats;
          const cellW = stepBeats;
          if (cellX >= viewLen) return null;
          const markerW = Math.max(0.025, Math.min(cellW * 0.16, 0.08));
          return (
            <rect
              key={`${row.id}:${stepIdx}`}
              x={Math.min(viewLen - markerW, cellX + cellW * 0.5 - markerW * 0.5)}
              y={rowTop + rowH * 0.22}
              width={markerW}
              height={Math.max(2.5, rowH * 0.56)}
              className={styles.hit}
            />
          );
        });
      })}
    </svg>
  );
}
