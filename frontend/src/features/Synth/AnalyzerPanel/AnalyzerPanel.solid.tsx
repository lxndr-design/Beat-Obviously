/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { Button, Icon } from "../../../solid-ui";
import { useAnalyzerStore, type AnalyzerSnapshot } from "../../../state/analyzerStore";
import { createStoreSelector } from "../../../solid-utils/store";
import styles from "./AnalyzerPanel.module.css";

export interface AnalyzerPanelProps {
  scope?: "master" | "synth";
  snapshotOverride?: AnalyzerSnapshot;
  wavetable?: number[];
  playing?: boolean;
  onTogglePlayback?: () => void;
}

export function AnalyzerPanelSolid(props: { state: Accessor<AnalyzerPanelProps> }) {
  const masterSnapshot = createStoreSelector(useAnalyzerStore, (state) => state.master);
  const synthSnapshot = createStoreSelector(useAnalyzerStore, (state) => state.synth);
  const snapshot = createMemo(() => props.state().snapshotOverride ?? (props.state().scope === "synth" ? synthSnapshot() : masterSnapshot()));
  const bands = createMemo(() => toBandCount(snapshot().bands.length > 0 ? snapshot().bands : Array.from({ length: 64 }, () => 0), 64));
  const hasSpectrum = createMemo(() => bands().some((value) => value > 0));
  const wavetablePath = createMemo(() => {
    const wavetable = props.state().wavetable;
    return wavetable && wavetable.length > 1 ? makeWavetablePath(wavetable) : "";
  });

  return (
    <section class="ds-panel" aria-label="Spectrum analyzer">
      <header class="ds-panel-header">
        <div class="ds-panel-title">Analyzer</div>
        <div class={`ds-panel-actions ${styles.actions}`}>
          <Show when={props.state().onTogglePlayback}>
            <div class={styles.playbackControls}>
              <Button
                size="xs"
                selected={props.state().playing}
                onClick={() => props.state().onTogglePlayback?.()}
                aria-label={props.state().playing ? "Stop analyzer audition" : "Play analyzer audition"}
              >
                <Icon name={props.state().playing ? "ph:stop-fill" : "ph:play-fill"} size={12} decorative />
                {props.state().playing ? "Stop" : "Play"}
              </Button>
            </div>
          </Show>
        </div>
      </header>
      <div class={`ds-panel-body ${styles.body} ${wavetablePath() ? "" : styles.bodyCompact}`}>
        <div class={styles.meters}>
          <Meter label="RMS" value={snapshot().rms} />
          <Meter label="Peak" value={snapshot().peak} />
        </div>
        <Show when={wavetablePath()}>
          <div class={styles.wavetable} aria-label="Wavetable visualizer">
            <span class={styles.scopeLabel}>Wavetable</span>
            <svg class={styles.wavetableSvg} viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
              <line class={styles.zeroLine} x1="0" y1="24" x2="100" y2="24" />
              <path class={styles.wavetablePath} d={wavetablePath()} />
            </svg>
          </div>
        </Show>
        <div class={styles.spectrum} aria-label={hasSpectrum() ? "Spectrum bands" : "Spectrum placeholder"}>
          <span class={styles.scopeLabel}>Spectrum</span>
          <div class={styles.spectrumBands}>
            <For each={bands()}>
              {(band) => (
                <span
                  class={styles.band}
                  style={{ height: `${Math.max(2, Math.round(clamp01(band) * 100))}%` }}
                />
              )}
            </For>
          </div>
        </div>
      </div>
    </section>
  );
}

function Meter(props: { label: string; value: number }) {
  return (
    <div class={styles.meter}>
      <span class={styles.meterLabel}>{props.label}</span>
      <span class={styles.meterTrack}>
        <span class={styles.meterFill} style={{ transform: `scaleX(${clamp01(props.value)})` }} />
      </span>
      <span class={styles.meterValue}>{formatDb(props.value)}</span>
    </div>
  );
}

function formatDb(value: number): string {
  if (value <= 0) return "-inf";
  return `${Math.round(20 * Math.log10(value))}dB`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function makeWavetablePath(samples: number[]): string {
  const last = Math.max(1, samples.length - 1);
  return samples.map((sample, index) => {
    const x = (index / last) * 100;
    const y = 24 - Math.max(-1, Math.min(1, sample)) * 20;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function toBandCount(source: number[], count: number): number[] {
  if (source.length === count) return source;
  if (source.length === 0) return Array.from({ length: count }, () => 0);
  if (source.length === 1) return Array.from({ length: count }, () => clamp01(source[0]));

  return Array.from({ length: count }, (_, index) => {
    const position = (index / Math.max(1, count - 1)) * (source.length - 1);
    const left = Math.floor(position);
    const right = Math.min(source.length - 1, left + 1);
    const mix = position - left;
    return clamp01(source[left] + (source[right] - source[left]) * mix);
  });
}

export interface MountedAnalyzerPanelSolid {
  update: (next: AnalyzerPanelProps) => void;
  dispose: () => void;
}

export function mountAnalyzerPanelSolid(host: HTMLElement, initialProps: AnalyzerPanelProps): MountedAnalyzerPanelSolid {
  const [state, setState] = createSignalForMount(initialProps);
  const dispose = render(() => <AnalyzerPanelSolid state={state} />, host);
  return { update: setState, dispose };
}

function createSignalForMount<T>(initial: T): [Accessor<T>, (next: T) => void] {
  return createSignal(initial, { equals: false });
}
