import { Button, Modal, TextInput } from "../../components";
import { useProjectStore, useUiStore } from "../../state/store";
import styles from "./TrackDetailsModal.module.css";
import type { Id } from "../../state/types";

interface TrackDetailsModalProps {
  trackId: Id;
}

export function TrackDetailsModal({ trackId }: TrackDetailsModalProps) {
  const track = useProjectStore((s) => s.project.tracks.find((candidate) => candidate.id === trackId));
  const updateTrack = useProjectStore((s) => s.updateTrack);
  const closeEditor = useUiStore((s) => s.closeEditor);

  if (!track) return null;

  const close = () => closeEditor({ kind: "track", trackId });

  return (
    <Modal
      open
      title="Track Details"
      width="md"
      scopeId={`track-details-${trackId}`}
      onClose={close}
      footer={
        <Button variant="primary" onClick={close}>
          Done
        </Button>
      }
    >
      <div className={styles.panel}>
        <TextInput
          className={styles.spanFull}
          label="Name"
          value={track.name}
          onChange={(event) => updateTrack(trackId, { name: event.target.value })}
        />

        <section className={styles.section}>
          <header className={styles.sectionHeader}>Level</header>
          <div className={styles.sectionBody}>
            <SliderRow
              label="Volume"
              value={track.gainDb}
              min={-48}
              max={24}
              step={1}
              display={formatGain(track.gainDb)}
              onChange={(gainDb) => updateTrack(trackId, { gainDb })}
            />
          </div>
        </section>

        <section className={styles.section}>
          <header className={styles.sectionHeader}>Stereo</header>
          <div className={styles.sectionBody}>
            <SliderRow
              label="Pan"
              value={Math.round(track.pan * 100)}
              min={-100}
              max={100}
              step={1}
              display={formatPan(track.pan)}
              onChange={(panPercent) => updateTrack(trackId, { pan: panPercent / 100 })}
            />
          </div>
        </section>
      </div>
    </Modal>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

function SliderRow({ label, value, min, max, step, display, onChange }: SliderRowProps) {
  return (
    <label className={styles.sliderRow}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        className={styles.range}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className={styles.sliderValue}>{display}</span>
    </label>
  );
}

function formatGain(gainDb: number): string {
  if (Math.abs(gainDb) < 0.05) return "0 dB";
  const rounded = Math.round(gainDb);
  return `${rounded > 0 ? "+" : ""}${rounded} dB`;
}

function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.01) return "C";
  return pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`;
}
