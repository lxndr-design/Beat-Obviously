import { useAnalyzerStore } from "../../../state/analyzerStore";
import styles from "./AnalyzerPanel.module.css";

export function AnalyzerPanel() {
  const snapshot = useAnalyzerStore((state) => state.master);
  const bands = snapshot.bands.length > 0 ? snapshot.bands : Array.from({ length: 32 }, () => 0);
  const hasSpectrum = bands.some((value) => value > 0);

  return (
    <section className="ds-panel" aria-label="Spectrum analyzer">
      <header className="ds-panel-header">
        <div className="ds-panel-title">Analyzer</div>
        <div className="ds-panel-actions">
          <span className={styles.readout}>RMS {formatDb(snapshot.rms)}</span>
          <span className={styles.readout}>PK {formatDb(snapshot.peak)}</span>
        </div>
      </header>
      <div className={`ds-panel-body ${styles.body}`}>
        <div className={styles.meters}>
          <Meter label="RMS" value={snapshot.rms} />
          <Meter label="Peak" value={snapshot.peak} />
        </div>
        <div className={styles.spectrum} aria-label={hasSpectrum ? "Spectrum bands" : "Spectrum placeholder"}>
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
