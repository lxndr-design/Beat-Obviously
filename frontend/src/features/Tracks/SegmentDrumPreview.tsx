import type { Segment } from "../../state/types";
import { drumStepOn } from "../../state/drumSteps";
import styles from "./SegmentDrumPreview.module.css";

interface Props {
  segment: Segment;
}

export function SegmentDrumPreview({ segment }: Props) {
  if (segment.payload.kind !== "drum") return null;
  const { rows, stepCount } = segment.payload;
  if (rows.length === 0 || stepCount <= 0) return null;

  return (
    <svg className={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {rows.map((row, rowIdx) => {
        const rowY = ((rowIdx + 0.5) / rows.length) * 100;
        return row.steps.slice(0, stepCount).map((step, stepIdx) => {
          if (!drumStepOn(step)) return null;
          const cellW = 100 / stepCount;
          return (
            <rect
              key={`${row.id}:${stepIdx}`}
              x={stepIdx * cellW + cellW * 0.24}
              y={rowY - 2}
              width={Math.max(1, cellW * 0.52)}
              height={4}
              className={styles.hit}
            />
          );
        });
      })}
    </svg>
  );
}
