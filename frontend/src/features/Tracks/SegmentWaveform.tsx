import { useMemo } from "react";
import type { Segment } from "../../state/types";
import styles from "./SegmentWaveform.module.css";

interface Props {
  segment: Segment;
}

/**
 * SegmentWaveform — black waveform drawn on the white segment body.
 *
 * v1: synthesizes a deterministic waveform from the segment id so segments
 * have a stable visual identity until real PCM data lives in the audioFile.
 * Replace `samples` with downsampled peaks from the bound audio file once
 * uploads are wired through IPC.
 */
export function SegmentWaveform({ segment }: Props) {
  const samples = useMemo(() => synthPeaks(segment.id, 96), [segment.id]);

  const path = useMemo(() => {
    let d = "";
    samples.forEach((s, i) => {
      const x = (i / (samples.length - 1)) * 100;
      const top = 50 - s * 48;
      const bot = 50 + s * 48;
      d += `M${x} ${top} L${x} ${bot} `;
    });
    return d.trim();
  }, [samples]);

  return (
    <svg
      className={styles.svg}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={path} className={styles.waveform} />
    </svg>
  );
}

/** Tiny PRNG to generate a stable waveform shape from a string seed. */
function synthPeaks(seed: string, n: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    h = (Math.imul(h, 16777619) ^ i) >>> 0;
    const r = ((h >>> 8) & 0xff) / 255;
    const env = Math.sin((i / n) * Math.PI);
    out.push(0.2 + 0.8 * r * env);
  }
  return out;
}
