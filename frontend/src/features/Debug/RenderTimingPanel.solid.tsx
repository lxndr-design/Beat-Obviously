import { createMemo, createSignal, For, Show } from "solid-js";
import { createStoreSelector } from "../../solid-utils/store";
import { Button, HoverInfo, Icon } from "../../solid-ui";
import { useAnalyzerStore } from "../../state/analyzerStore";
import styles from "./RenderTimingPanel.module.css";

const rows = [
  ["Schedule", "scheduleMs"],
  ["Synth", "synthMs"],
  ["Voice", "voiceMs"],
  ["Mod", "modulationMs"],
  ["Samples", "samplesMs"],
  ["FX", "fxMs"],
  ["Route FX", "filterFxMs"],
  ["Analyzer", "analyzerMs"],
  ["Copy", "copyMs"],
] as const;

const countRows = [
  ["Voices", "activeSynthVoices"],
  ["Samples", "activeSampleVoices"],
  ["Audio", "activeAudioClipVoices"],
  ["Routes", "routeCount"],
  ["Events", "automationEventCount"],
  ["WT", "wavetableCacheSize"],
] as const;

export function RenderTimingPanel() {
  const [collapsed, setCollapsed] = createSignal(true);
  const timing = createStoreSelector(useAnalyzerStore, (state) => state.renderTiming);
  const stale = createMemo(() => timing().sequence === 0);
  const maxMs = createMemo(() => Math.max(0.1, ...rows.map(([, key]) => timing()[key]), timing().totalMs));

  return (
    <Show
      when={!collapsed()}
      fallback={(
        <aside class={`${styles.panel} ${styles.collapsed}`} aria-label="Audio render timing">
          <HoverInfo content="Show render timing" placement="left">
            <Button iconOnly size="md" onClick={() => setCollapsed(false)} aria-label="Show render timing">
              <Icon name="ph:gauge-fill" size={16} decorative />
            </Button>
          </HoverInfo>
        </aside>
      )}
    >
      <aside class={styles.panel} aria-label="Audio render timing">
        <div class={styles.ribbon}>
          <span class={styles.title}>Render Timing</span>
          <span class={styles.metric}>
            {stale() ? "--" : `${formatMs(timing().totalMs)} / ${formatPercent(timing().loadPercent)}`}
          </span>
          <HoverInfo content="Hide render timing">
            <Button iconOnly size="xs" onClick={() => setCollapsed(true)} aria-label="Hide render timing">
              <Icon name="ph:x" size={14} decorative />
            </Button>
          </HoverInfo>
        </div>
        <div class={styles.body}>
          <TimingRow label="Status" fill={stale() ? 0 : 100} value={stale() ? "Preview" : "Native"} />
          <For each={rows}>
            {([label, key]) => {
              const value = () => stale() ? 0 : timing()[key];
              return (
                <TimingRow
                  label={label}
                  fill={Math.min(100, (value() / maxMs()) * 100)}
                  value={stale() ? "--" : formatMs(value())}
                />
              );
            }}
          </For>
          <TimingRow
            label="Total"
            fill={stale() ? 0 : Math.min(100, (timing().totalMs / maxMs()) * 100)}
            value={stale() ? "--" : formatMs(timing().totalMs)}
          />
          <TimingRow
            label="Load"
            fill={stale() ? 0 : Math.min(100, timing().loadPercent)}
            value={stale() ? "--" : formatPercent(timing().loadPercent)}
          />
          <StaticRow label="Block" staticValue={stale() ? "--" : `${timing().blockSamples} samples`} value={stale() ? "--" : formatHz(timing().sampleRate)} />
          <StaticRow label="Seq" staticValue={stale() ? "--" : `${timing().sequence}`} value={stale() ? "--" : `${timing().blockSamples}`} />
          <StaticRow
            label="WT Cache"
            staticValue={stale() ? "--" : `${timing().wavetableCacheHits}/${timing().wavetableCacheMisses}`}
            value={stale() ? "--" : `${timing().wavetableCacheSize}`}
          />
          <StaticRow
            label="Voice Work"
            staticValue={stale() ? "--" : `${formatCount(timing().voiceRenderBlocks)} blk / ${formatCount(timing().voiceRenderSamples)} smp`}
            value={stale() ? "--" : `O ${formatCount(timing().oscillatorSamples)} / WT ${formatCount(timing().wavetableVoiceSamples)}`}
          />
          <StaticRow
            label="Aether"
            staticValue={stale() ? "--" : `A ${formatCount(timing().aetherOscASamples)} / B ${formatCount(timing().aetherOscBSamples)}`}
            value={stale() ? "--" : `S ${formatCount(timing().aetherSubSamples)} / N ${formatCount(timing().aetherNoiseSamples)}`}
          />
          <StaticRow
            label="DSP Work"
            staticValue={stale() ? "--" : `F ${formatCount(timing().filterSamples)} / D ${formatCount(timing().filterDriveSamples)} / C ${formatCount(timing().filterCoefficientUpdates)}`}
            value={stale() ? "--" : `M ${formatCount(timing().modulationSamples)} / R ${formatCount(timing().realtimeRampSamples)} / P ${formatCount(timing().oscillatorRateCalculations)}`}
          />
          <StaticRow
            label="WT Churn"
            staticValue={stale() ? "--" : `F ${formatCount(timing().wavetableFrequencyUpdates)}`}
            value={stale() ? "--" : `P ${formatCount(timing().wavetablePositionUpdates)}`}
          />
          <StaticRow
            label="FX Work"
            staticValue={stale() ? "--" : `T ${formatCount(timing().routeEffectSamples)} / F ${formatCount(timing().routeFilterEffectSamples)}`}
            value={stale() ? "--" : `N ${formatCount(timing().routeNonlinearEffectSamples)} / D ${formatCount(timing().routeDelayEffectSamples)}`}
          />
          <div class={styles.countGrid}>
            <For each={countRows}>
              {([label, key]) => (
                <span class={styles.countPill}>
                  <span>{label}</span>
                  <strong>{stale() ? "--" : timing()[key]}</strong>
                </span>
              )}
            </For>
          </div>
        </div>
      </aside>
    </Show>
  );
}

function TimingRow(props: { label: string; fill: number; value: string }) {
  return (
    <div class={styles.row}>
      <span class={styles.label}>{props.label}</span>
      <span class={styles.track} aria-hidden="true">
        <span class={styles.fill} style={{ "--fill": `${props.fill}%` }} />
      </span>
      <span class={styles.value}>{props.value}</span>
    </div>
  );
}

function StaticRow(props: { label: string; staticValue: string; value: string }) {
  return (
    <div class={styles.row}>
      <span class={styles.label}>{props.label}</span>
      <span class={styles.staticValue}>{props.staticValue}</span>
      <span class={styles.value}>{props.value}</span>
    </div>
  );
}

function formatMs(value: number) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(value < 10 ? 2 : 1)}ms`;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(0)}%`;
}

function formatHz(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k`;
}

function formatCount(value: number) {
  if (!Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value)}`;
}
