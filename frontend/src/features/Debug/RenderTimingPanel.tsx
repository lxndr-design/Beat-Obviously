import { useMemo, useState, type CSSProperties } from "react";
import { Button, HoverInfo, Icon } from "../../components";
import { useAnalyzerStore } from "../../state/analyzerStore";
import styles from "./RenderTimingPanel.module.css";

const rows = [
  ["Schedule", "scheduleMs"],
  ["Synth", "synthMs"],
  ["Samples", "samplesMs"],
  ["FX", "fxMs"],
  ["Analyzer", "analyzerMs"],
  ["Copy", "copyMs"],
] as const;

export function RenderTimingPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const timing = useAnalyzerStore((state) => state.renderTiming);
  const maxMs = useMemo(
    () => Math.max(0.1, ...rows.map(([, key]) => timing[key]), timing.totalMs),
    [timing],
  );

  const stale = timing.sequence === 0;
  return (
    <aside className={`${styles.panel} ${collapsed ? styles.collapsed : ""}`} aria-label="Audio render timing">
      <div className={styles.ribbon}>
        <span className={styles.title}>Render Timing</span>
        {!collapsed && (
          <span className={styles.metric}>
            {stale ? "--" : `${formatMs(timing.totalMs)} / ${formatPercent(timing.loadPercent)}`}
          </span>
        )}
        <HoverInfo content={collapsed ? "Show render timing" : "Hide render timing"}>
          <Button iconOnly size="xs" onClick={() => setCollapsed((next) => !next)} aria-label={collapsed ? "Show render timing" : "Hide render timing"}>
            <Icon name={collapsed ? "ph:gauge-fill" : "ph:x"} size={14} decorative />
          </Button>
        </HoverInfo>
      </div>
      {!collapsed && (
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
        </div>
      )}
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
