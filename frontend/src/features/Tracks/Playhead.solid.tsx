import { createStoreSelector } from "../../solid-utils/store";
import { useTransportStore, useViewStore } from "../../state/store";
import styles from "./Playhead.module.css";

export function Playhead(props: { offsetPx?: number } = {}) {
  const position = createStoreSelector(useTransportStore, (state) => state.positionBeat);
  const beatsToPx = createStoreSelector(useViewStore, (state) => state.beatsToPx);
  return (
    <div
      class={styles.playhead}
      style={{ left: `${position() * beatsToPx() + (props.offsetPx ?? 0)}px` }}
      aria-hidden="true"
    />
  );
}
