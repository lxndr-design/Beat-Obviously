/** @jsxImportSource solid-js */
import { createMemo } from "solid-js";
import type { Segment } from "../../../state/types";
import styles from "../SegmentWaveform.module.css";

interface Props {
  segment: Segment;
}

export function SegmentWaveformSolid(props: Props) {
  const samples = createMemo(() => synthPeaks(props.segment.id, 96));
  const path = createMemo(() => samples().map((sample, index) => {
    const x = (index / (samples().length - 1)) * 100;
    const top = 50 - sample * 48;
    const bottom = 50 + sample * 48;
    return `M${x} ${top} L${x} ${bottom}`;
  }).join(" "));

  return (
    <svg class={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={path()} class={styles.waveform} />
    </svg>
  );
}

function synthPeaks(seed: string, count: number): number[] {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) {
    hash = (Math.imul(hash, 16777619) ^ index) >>> 0;
    const random = ((hash >>> 8) & 0xff) / 255;
    const envelope = Math.sin((index / count) * Math.PI);
    out.push(0.2 + 0.8 * random * envelope);
  }
  return out;
}
