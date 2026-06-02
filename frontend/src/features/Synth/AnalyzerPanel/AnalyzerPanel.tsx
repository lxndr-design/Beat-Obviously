import { Button, Icon } from "../../../components";
import { useAnalyzerStore, type AnalyzerSnapshot } from "../../../state/analyzerStore";
import styles from "./AnalyzerPanel.module.css";

interface Props {
  scope?: "master" | "synth";
  snapshotOverride?: AnalyzerSnapshot;
  wavetable?: number[];
  playing?: boolean;
  onTogglePlayback?: () => void;
}

export function AnalyzerPanel({ scope = "master", snapshotOverride, wavetable, playing = false, onTogglePlayback }: Props) {
  const storeSnapshot = useAnalyzerStore((state) => (scope === "synth" ? state.synth : state.master));
  const snapshot = snapshotOverride ?? storeSnapshot;
  const bands = toBandCount(snapshot.bands.length > 0 ? snapshot.bands : Array.from({ length: 64 }, () => 0), 64);
  const hasSpectrum = bands.some((value) => value > 0);
  const wavetablePath = wavetable && wavetable.length > 1 ? makeWavetablePath(wavetable) : "";

  return (
    <section className="ds-panel" aria-label="Spectrum analyzer">
      <header className="ds-panel-header">
        <div className="ds-panel-title">Analyzer</div>
        <div className={`ds-panel-actions ${styles.actions}`}>
          {onTogglePlayback && (
            <div className={styles.playbackControls}>
              <Button
                size="xs"
                selected={playing}
                onClick={onTogglePlayback}
                aria-label={playing ? "Stop analyzer audition" : "Play analyzer audition"}
              >
                <Icon name={playing ? "ph:stop-fill" : "ph:play-fill"} size={12} decorative />
                {playing ? "Stop" : "Play"}
              </Button>
            </div>
          )}
        </div>
      </header>
      <div className={`ds-panel-body ${styles.body} ${wavetablePath ? "" : styles.bodyCompact}`}>
        <div className={styles.meters}>
          <Meter label="RMS" value={snapshot.rms} />
          <Meter label="Peak" value={snapshot.peak} />
        </div>
        {wavetablePath ? (
          <div className={styles.wavetable} aria-label="Wavetable visualizer">
            <span className={styles.scopeLabel}>Wavetable</span>
            <svg className={styles.wavetableSvg} viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
              <line className={styles.zeroLine} x1="0" y1="24" x2="100" y2="24" />
              <path className={styles.wavetablePath} d={wavetablePath} />
            </svg>
          </div>
        ) : null}
        <div className={styles.spectrum} aria-label={hasSpectrum ? "Spectrum bands" : "Spectrum placeholder"}>
          <span className={styles.scopeLabel}>Spectrum</span>
          <div className={styles.spectrumBands}>
            {bands.map((band, index) => (
              <span
                // eslint-disable-next-line react/no-array-index-key
                key={index}
                className={styles.band}
                style={{ height: `${Math.max(2, Math.round(clamp01(band) * 100))}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.meter}>
      <span className={styles.meterLabel}>{label}</span>
      <span className={styles.meterTrack}>
        <span className={styles.meterFill} style={{ transform: `scaleX(${clamp01(value)})` }} />
      </span>
      <span className={styles.meterValue}>{formatDb(value)}</span>
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
