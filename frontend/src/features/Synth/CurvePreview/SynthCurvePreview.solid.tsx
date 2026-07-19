import { createMemo, Show } from "solid-js";
import styles from "./SynthCurvePreview.module.css";

export interface SynthCurvePreviewProps {
  samples: number[];
  label: string;
  class?: string;
  filled?: boolean;
}

/** Shared Aether curve language for compact waveform and parameter-response previews. */
export function SynthCurvePreview(props: SynthCurvePreviewProps) {
  const path = createMemo(() => makeCurvePath(props.samples));
  const area = createMemo(() => path() ? `${path()} L 100 24 L 0 24 Z` : "");
  return (
    <svg
      class={`${styles.svg} ${props.class ?? ""}`}
      viewBox="0 0 100 48"
      preserveAspectRatio="none"
      role="img"
      aria-label={props.label}
    >
      <line class={styles.gridLine} x1="0" y1="12" x2="100" y2="12" />
      <line class={styles.zeroLine} x1="0" y1="24" x2="100" y2="24" />
      <line class={styles.gridLine} x1="0" y1="36" x2="100" y2="36" />
      <Show when={props.filled && area()}>
        <path class={styles.area} d={area()} />
      </Show>
      <Show when={path()}>
        <path class={styles.path} d={path()} />
      </Show>
    </svg>
  );
}

function makeCurvePath(samples: number[]): string {
  if (samples.length <= 1) return "";
  const last = samples.length - 1;
  return samples.map((sample, index) => {
    const x = (index / last) * 100;
    const y = 24 - clamp(sample, -1, 1) * 18;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
