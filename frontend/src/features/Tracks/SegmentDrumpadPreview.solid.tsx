import { For, Show } from "solid-js";
import type { Segment } from "../../state/types";
import styles from "./SegmentDrumpadPreview.module.css";

interface Props {
  segment: Segment;
  displayLengthBeats: number;
  playing?: boolean;
}

export function SegmentDrumpadPreview(props: Props) {
  const payload = () => props.segment.payload.kind === "drumpad" ? props.segment.payload : null;
  const laneHeight = () => {
    const count = Math.max(1, payload()?.lanes.length ?? 1);
    return 100 / count;
  };
  const sourceOffset = () => Math.max(0, props.segment.sourceStartBeat ?? 0);

  return (
    <Show when={payload()}>
      {(current) => (
        <div class={styles.preview}>
          <svg class={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <For each={current().lanes}>
              {(lane, laneIndex) => (
                <>
                  <line
                    class={styles.rowLine}
                    x1="0"
                    x2="100"
                    y1={String((laneIndex() + 1) * laneHeight())}
                    y2={String((laneIndex() + 1) * laneHeight())}
                  />
                  <For each={current().hits.filter((hit) => hit.laneId === lane.id)}>
                    {(hit) => {
                      const localStart = hit.startBeat - sourceOffset();
                      const localEnd = localStart + hit.lengthBeats;
                      if (localEnd <= 0 || localStart >= props.displayLengthBeats) return null;
                      const visibleStart = Math.max(0, localStart);
                      const visibleEnd = Math.min(props.displayLengthBeats, localEnd);
                      const x = Math.max(0, Math.min(100, (visibleStart / props.displayLengthBeats) * 100));
                      const w = Math.max(0.6, ((visibleEnd - visibleStart) / props.displayLengthBeats) * 100);
                      return (
                        <rect
                          class={props.playing ? styles.hitPlaying : styles.hit}
                          x={String(x)}
                          y={String(laneIndex() * laneHeight() + laneHeight() * 0.24)}
                          width={String(Math.min(w, 100 - x))}
                          height={String(laneHeight() * 0.52)}
                        />
                      );
                    }}
                  </For>
                </>
              )}
            </For>
          </svg>
        </div>
      )}
    </Show>
  );
}
