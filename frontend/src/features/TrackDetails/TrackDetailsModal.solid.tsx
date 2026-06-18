import { createMemo, Show } from "solid-js";
import { Button, Modal, NumberInput, TextInput, Toggle } from "../../solid-ui";
import { useProjectStore, useUiStore } from "../../state/store";
import { createStoreSelector } from "../../solid-utils/store";
import styles from "./TrackDetailsModal.module.css";
import type { Id, Track } from "../../state/types";

interface TrackDetailsModalSolidProps {
  trackId: Id;
}

export function TrackDetailsModalSolid(props: TrackDetailsModalSolidProps) {
  const tracks = createStoreSelector(useProjectStore, (s) => s.project.tracks);
  const track = createMemo(() => tracks().find((candidate) => candidate.id === props.trackId));

  function close() {
    useUiStore.getState().closeEditor({ kind: "track", trackId: props.trackId });
  }

  function updateTrack(patch: Partial<Track>) {
    useProjectStore.getState().updateTrack(props.trackId, patch);
  }

  return (
    <Show when={track()}>
      {(currentTrack) => (
        <Modal
          open
          title="Track Details"
          width="md"
          scopeId={`track-details-${props.trackId}`}
          onClose={close}
          footer={(
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          )}
        >
          <div class={styles.panel}>
            <TextInput
              className={styles.spanFull}
              label="Name"
              value={currentTrack().name}
              onInput={(event) => updateTrack({ name: event.currentTarget.value })}
            />

            <section class={styles.section}>
              <header class={styles.sectionHeader}>Level</header>
              <div class={styles.sectionBody}>
                <SliderRow
                  label="Volume"
                  value={currentTrack().gainDb}
                  min={-48}
                  max={24}
                  step={1}
                  display={formatGain(currentTrack().gainDb)}
                  onChange={(gainDb) => updateTrack({ gainDb })}
                />
              </div>
            </section>

            <section class={styles.section}>
              <header class={styles.sectionHeader}>Stereo</header>
              <div class={styles.sectionBody}>
                <SliderRow
                  label="Pan"
                  value={Math.round(currentTrack().pan * 100)}
                  min={-100}
                  max={100}
                  step={1}
                  display={formatPan(currentTrack().pan)}
                  onChange={(panPercent) => updateTrack({ pan: panPercent / 100 })}
                />
              </div>
            </section>

            <section class={`${styles.section} ${styles.spanFull}`}>
              <header class={styles.sectionHeader}>Recording</header>
              <div class={styles.sectionBody}>
                <div class={styles.toggleGrid}>
                  <Toggle
                    label="Arm"
                    checked={currentTrack().recordArmed}
                    onChange={(recordArmed) => updateTrack({ recordArmed })}
                  />
                  <Toggle
                    label="Monitor"
                    checked={currentTrack().inputMonitoring}
                    onChange={(inputMonitoring) => updateTrack({ inputMonitoring })}
                  />
                </div>
                <TextInput
                  label="Input Device ID"
                  value={currentTrack().inputDeviceId ?? ""}
                  onInput={(event) => updateTrack({ inputDeviceId: event.currentTarget.value })}
                />
                <div class={styles.numberGrid}>
                  <NumberInput
                    label="Channel Start"
                    layout="inline"
                    value={currentTrack().inputChannelStart}
                    min={0}
                    max={1024}
                    step={1}
                    onChange={(inputChannelStart) => updateTrack({ inputChannelStart: Math.round(inputChannelStart) })}
                  />
                  <NumberInput
                    label="Channels"
                    layout="inline"
                    value={currentTrack().inputChannelCount}
                    min={1}
                    max={1024}
                    step={1}
                    onChange={(inputChannelCount) => updateTrack({ inputChannelCount: Math.round(inputChannelCount) })}
                  />
                </div>
                <SliderRow
                  label="Rec Gain"
                  value={currentTrack().recordGainDb}
                  min={-48}
                  max={24}
                  step={1}
                  display={formatGain(currentTrack().recordGainDb)}
                  onChange={(recordGainDb) => updateTrack({ recordGainDb })}
                />
              </div>
            </section>
          </div>
        </Modal>
      )}
    </Show>
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

function SliderRow(props: SliderRowProps) {
  return (
    <label class={styles.sliderRow}>
      <span class={styles.sliderLabel}>{props.label}</span>
      <input
        class={styles.range}
        type="range"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onInput={(event) => props.onChange(Number(event.currentTarget.value))}
      />
      <span class={styles.sliderValue}>{props.display}</span>
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
