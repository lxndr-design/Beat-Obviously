import { For, Show } from "solid-js";
import { drumStepOn } from "../../state/drumSteps";
import type { Segment } from "../../state/types";
import styles from "./SegmentDrumPreview.module.css";

interface Props {
  segment: Segment;
  displayLengthBeats?: number;
  playing?: boolean;
}

export function SegmentDrumPreview(props: Props) {
  const drumPayload = () => props.segment.payload.kind === "drum" ? props.segment.payload : null;
  const viewLength = () => Math.max(0.001, props.displayLengthBeats ?? props.segment.lengthBeats);
  const stepBeats = () => {
    const payload = drumPayload();
    return payload ? props.segment.lengthBeats / payload.stepCount : 0;
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
                      if (!drumStepOn(step)) return null;
                      const cellX = stepIndex() * stepBeats();
                      if (cellX >= viewLength()) return null;
                      const markerWidth = Math.max(0.025, Math.min(stepBeats() * 0.16, 0.08));
                      return (
                        <rect
                          x={Math.min(viewLength() - markerWidth, cellX + stepBeats() * 0.5 - markerWidth * 0.5)}
                          y={rowTop + rowHeight * 0.22}
                          width={markerWidth}
                          height={Math.max(2.5, rowHeight * 0.56)}
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
