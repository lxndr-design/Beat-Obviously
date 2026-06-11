import { useMemo, useState, type CSSProperties } from "react";
import { Button, HoverInfo, Icon } from "../../components";
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
  const [collapsed, setCollapsed] = useState(true);
  const timing = useAnalyzerStore((state) => state.renderTiming);
  const maxMs = useMemo(
    () => Math.max(0.1, ...rows.map(([, key]) => timing[key]), timing.totalMs),
    [timing],
  );

  const stale = timing.sequence === 0;
  if (collapsed) {
    return (
      <aside className={`${styles.panel} ${styles.collapsed}`} aria-label="Audio render timing">
        <HoverInfo content="Show render timing" placement="left">
          <Button iconOnly size="md" onClick={() => setCollapsed(false)} aria-label="Show render timing">
            <Icon name="ph:gauge-fill" size={16} decorative />
          </Button>
        </HoverInfo>
      </aside>
    );
  }

  return (
    <aside className={styles.panel} aria-label="Audio render timing">
      <div className={styles.ribbon}>
        <span className={styles.title}>Render Timing</span>
        <span className={styles.metric}>
          {stale ? "--" : `${formatMs(timing.totalMs)} / ${formatPercent(timing.loadPercent)}`}
        </span>
        <HoverInfo content="Hide render timing">
          <Button iconOnly size="xs" onClick={() => setCollapsed(true)} aria-label="Hide render timing">
            <Icon name="ph:x" size={14} decorative />
          </Button>
        </HoverInfo>
      </div>
      <div className={styles.body}>
          <div className={styles.row}>
            <span className={styles.label}>Status</span>
            <span className={styles.track} aria-hidden="true">
              <span className={styles.fill} style={{ "--fill": stale ? "0%" : "100%" } as CSSProperties} />
            </span>
            <span className={styles.value}>{stale ? "Preview" : "Native"}</span>
          </div>
          {rows.map(([label, key]) => {
            const value = stale ? 0 : timing[key];
            return (
              <div className={styles.row} key={key}>
                <span className={styles.label}>{label}</span>
                <span className={styles.track} aria-hidden="true">
                  <span className={styles.fill} style={{ "--fill": `${Math.min(100, (value / maxMs) * 100)}%` } as CSSProperties} />
                </span>
                <span className={styles.value}>{stale ? "--" : formatMs(value)}</span>
              </div>
            );
          })}
          <div className={styles.row}>
            <span className={styles.label}>Total</span>
            <span className={styles.track} aria-hidden="true">
              <span className={styles.fill} style={{ "--fill": stale ? "0%" : `${Math.min(100, (timing.totalMs / maxMs) * 100)}%` } as CSSProperties} />
            </span>
            <span className={styles.value}>{stale ? "--" : formatMs(timing.totalMs)}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Load</span>
            <span className={styles.track} aria-hidden="true">
              <span className={styles.fill} style={{ "--fill": stale ? "0%" : `${Math.min(100, timing.loadPercent)}%` } as CSSProperties} />
            </span>
            <span className={styles.value}>{stale ? "--" : formatPercent(timing.loadPercent)}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Block</span>
            <span className={styles.staticValue}>{stale ? "--" : `${timing.blockSamples} samples`}</span>
            <span className={styles.value}>{stale ? "--" : formatHz(timing.sampleRate)}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Seq</span>
            <span className={styles.staticValue}>{stale ? "--" : `${timing.sequence}`}</span>
            <span className={styles.value}>{stale ? "--" : `${timing.blockSamples}`}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>WT Cache</span>
            <span className={styles.staticValue}>
              {stale ? "--" : `${timing.wavetableCacheHits}/${timing.wavetableCacheMisses}`}
            </span>
            <span className={styles.value}>{stale ? "--" : `${timing.wavetableCacheSize}`}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Voice Work</span>
            <span className={styles.staticValue}>
              {stale ? "--" : `${formatCount(timing.voiceRenderBlocks)} blk / ${formatCount(timing.voiceRenderSamples)} smp`}
            </span>
            <span className={styles.value}>
              {stale
                ? "--"
                : `O ${formatCount(timing.oscillatorSamples)} / WT ${formatCount(timing.wavetableVoiceSamples)}`}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Aether</span>
            <span className={styles.staticValue}>
              {stale
                ? "--"
                : `A ${formatCount(timing.aetherOscASamples)} / B ${formatCount(timing.aetherOscBSamples)}`}
            </span>
            <span className={styles.value}>
              {stale
                ? "--"
                : `S ${formatCount(timing.aetherSubSamples)} / N ${formatCount(timing.aetherNoiseSamples)}`}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>DSP Work</span>
            <span className={styles.staticValue}>
              {stale
                ? "--"
                : `F ${formatCount(timing.filterSamples)} / D ${formatCount(timing.filterDriveSamples)} / C ${formatCount(timing.filterCoefficientUpdates)}`}
            </span>
            <span className={styles.value}>
              {stale
                ? "--"
                : `M ${formatCount(timing.modulationSamples)} / R ${formatCount(timing.realtimeRampSamples)} / P ${formatCount(timing.oscillatorRateCalculations)}`}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>WT Churn</span>
            <span className={styles.staticValue}>
              {stale ? "--" : `F ${formatCount(timing.wavetableFrequencyUpdates)}`}
            </span>
            <span className={styles.value}>{stale ? "--" : `P ${formatCount(timing.wavetablePositionUpdates)}`}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>FX Work</span>
            <span className={styles.staticValue}>
              {stale ? "--" : `T ${formatCount(timing.routeEffectSamples)} / F ${formatCount(timing.routeFilterEffectSamples)}`}
            </span>
            <span className={styles.value}>
              {stale
                ? "--"
                : `N ${formatCount(timing.routeNonlinearEffectSamples)} / D ${formatCount(timing.routeDelayEffectSamples)}`}
            </span>
          </div>
          <div className={styles.countGrid}>
            {countRows.map(([label, key]) => (
              <span className={styles.countPill} key={key}>
                <span>{label}</span>
                <strong>{stale ? "--" : timing[key]}</strong>
              </span>
            ))}
          </div>
      </div>
    </aside>
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
