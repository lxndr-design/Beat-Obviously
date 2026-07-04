import { For, Show } from "solid-js";
import type { Segment } from "../../state/types";
import styles from "./SegmentMidiPreview.module.css";

interface Props {
  segment: Segment;
  displayLengthBeats?: number;
  playing?: boolean;
}

export function SegmentMidiPreview(props: Props) {
  const notes = () => (props.segment.payload.kind === "midi" || props.segment.payload.kind === "mixed")
    ? props.segment.payload.notes
    : [];
  const pitchBounds = () => {
    let min = Infinity;
    let max = -Infinity;
    for (const note of notes()) {
      min = Math.min(min, note.pitch);
      max = Math.max(max, note.pitch);
    }
    if (min === max) {
      min -= 6;
      max += 6;
    }
    return { min, max, range: Math.max(1, max - min) };
  };
  const sourceLength = () => Math.max(0.001, props.segment.lengthBeats);
  const viewLength = () => Math.max(0.001, props.displayLengthBeats ?? sourceLength());

  return (
    <Show when={notes().length > 0}>
      <svg
        class={styles.svg}
        viewBox={`0 0 ${viewLength()} 100`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <For each={notes()}>
          {(note) => {
            const bounds = pitchBounds();
            const sourceOffset = props.segment.sourceStartBeat ?? 0;
            const localStart = note.startBeat - sourceOffset;
            const localEnd = localStart + note.lengthBeats;
            if (localEnd <= 0 || localStart >= viewLength()) return null;
            const visibleStart = Math.max(0, localStart);
            const visibleEnd = Math.min(viewLength(), localEnd);
            const y = (1 - (note.pitch - bounds.min) / bounds.range) * 100;
            const velocity = Math.max(0, Math.min(127, note.velocity ?? 96));
            const height = 2.2 + (velocity / 127) * 2.2;
            return (
              <rect
                x={visibleStart}
                y={Math.max(0, Math.min(98, y - height * 0.5))}
                width={Math.max(0.04, visibleEnd - visibleStart)}
                height={height}
                opacity={0.52 + velocity / 270}
                class={`${styles.note} ${props.playing ? styles.playing : ""}`}
              />
            );
          }}
        </For>
      </svg>
    </Show>
  );
}
