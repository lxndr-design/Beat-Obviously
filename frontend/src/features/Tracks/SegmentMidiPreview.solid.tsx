import { For, Show } from "solid-js";
import type { Segment } from "../../state/types";
import styles from "./SegmentMidiPreview.module.css";

interface Props {
  segment: Segment;
  displayLengthBeats?: number;
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
            const y = (1 - (note.pitch - bounds.min) / bounds.range) * 100;
            return (
              <rect
                x={note.startBeat}
                y={Math.max(0, Math.min(98, y - 2))}
                width={Math.max(0, Math.min(viewLength() - note.startBeat, Math.max(0.04, note.lengthBeats)))}
                height={3}
                class={styles.note}
              />
            );
          }}
        </For>
      </svg>
    </Show>
  );
}
