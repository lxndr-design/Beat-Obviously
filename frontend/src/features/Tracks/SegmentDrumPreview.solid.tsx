import { For, Show } from "solid-js";
import {
  drumPlaybackStepLengthBeats,
  drumTimingOffsetBeats,
  normalizeDrumCell,
} from "../../state/drumSteps";
import type { Segment } from "../../state/types";
import styles from "./SegmentDrumPreview.module.css";

interface Props {
  segment: Segment;
  displayLengthBeats?: number;
  playing?: boolean;
}

export function SegmentDrumPreview(props: Props) {
  const drumPayload = () => props.segment.payload.kind === "drum" ? props.segment.payload : null;
  const sourceLength = () => {
    const payload = drumPayload();
    return payload ? Math.max(0.25, payload.sourceLengthBeats ?? payload.stepCount) : props.segment.lengthBeats;
  };
  const viewLength = () => Math.max(0.001, props.displayLengthBeats ?? props.segment.lengthBeats);
  const sourceOffset = () => Math.max(0, props.segment.sourceStartBeat ?? 0);
  const stepBeats = () => {
    const payload = drumPayload();
    return payload ? drumPlaybackStepLengthBeats(sourceLength(), payload.stepCount, payload.speed) : 0;
  };

  return (
    <Show when={drumPayload()}>
      {(payload) => (
        <Show when={payload().rows.length > 0 && payload().stepCount > 0}>
          <svg class={styles.svg} viewBox={`0 0 ${viewLength()} 100`} preserveAspectRatio="none" aria-hidden="true">
            <For each={payload().rows}>
              {(row, rowIndex) => {
                const rowHeight = 100 / payload().rows.length;
                const rowTop = rowIndex() * rowHeight;
                return (
                  <For each={row.steps.slice(0, payload().stepCount)}>
                    {(step, stepIndex) => {
                      const cell = normalizeDrumCell(step);
                      if (!cell.on) return null;
                      const cellX = stepIndex() * stepBeats()
                        + drumTimingOffsetBeats(stepIndex(), stepBeats(), payload().swingPercent, cell.leanPercent)
                        - sourceOffset();
                      if (cellX < 0 || cellX >= viewLength()) return null;
                      const markerWidth = Math.max(0.025, Math.min(stepBeats() * 0.24, 0.09));
                      const velocity = Math.max(0, Math.min(127, cell.velocity ?? 96));
                      return (
                        <rect
                          x={Math.min(viewLength() - markerWidth, cellX + stepBeats() * 0.5 - markerWidth * 0.5)}
                          y={rowTop + rowHeight * 0.22}
                          width={markerWidth}
                          height={Math.max(2.5, rowHeight * 0.56)}
                          opacity={0.44 + velocity / 230}
                          class={`${styles.hit} ${props.playing ? styles.playing : ""}`}
                        />
                      );
                    }}
                  </For>
                );
              }}
            </For>
          </svg>
        </Show>
      )}
    </Show>
  );
}
