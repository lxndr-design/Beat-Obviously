import { createMemo, createSignal, onMount, Show } from "solid-js";
import {
  AETHER_ARRANGEMENT_AUTOMATION_TARGETS,
  aetherArrangementAutomationTargetLabel,
  trackAutomationTargetCount,
} from "../../automation/aetherArrangementAutomation";
import { appAlert, Button, FloatingSelect, Knob, Modal, Slider, TextInput, Toggle } from "../../solid-ui";
import { isNative, send } from "../../ipc/bridge";
import type { AudioDeviceSnapshot } from "../../ipc/schema";
import { useProjectStore, useUiStore } from "../../state/store";
import { createStoreSelector } from "../../solid-utils/store";
import type { Id, Track } from "../../state/types";
import styles from "./TrackDetailsModal.module.css";

interface TrackDetailsModalProps {
  trackId: Id;
}

export function TrackDetailsModal(props: TrackDetailsModalProps) {
  const tracks = createStoreSelector(useProjectStore, (state) => state.project.tracks);
  const returnBuses = createStoreSelector(useProjectStore, (state) => state.project.returnBuses);
  const track = createMemo(() => tracks().find((candidate) => candidate.id === props.trackId));
  const [outputBusOpen, setOutputBusOpen] = createSignal(false);
  const [inputDeviceOpen, setInputDeviceOpen] = createSignal(false);
  const [inputChannelsOpen, setInputChannelsOpen] = createSignal(false);
  const [deviceSnapshot, setDeviceSnapshot] = createSignal<AudioDeviceSnapshot | null>(null);
  const outputBusValue = createMemo(() => currentOutputBusValue(track()));
  const outputBusOptions = createMemo(() => [
    { value: "master", label: "Master" },
    ...returnBuses().map((bus) => ({ value: bus.id, label: bus.name })),
    { value: "none", label: "No output" },
  ]);
  const inputDeviceOptions = createMemo(() => [
    { value: "", label: "System default" },
    ...(deviceSnapshot()?.devices ?? [])
      .filter((device) => device.input)
      .map((device) => ({ value: nativeDeviceValue(device.typeName, device.name), label: device.name })),
  ]);
  const inputChannelOptions = createMemo(() => audioInputChannelOptions(
    deviceSnapshot()?.inputChannelNames ?? [],
    track()?.inputChannelStart ?? 0,
    track()?.inputChannelCount ?? 2,
  ));
  const automatedParameterLabels = createMemo(() => {
    const activeTargets = new Set((track()?.automation ?? []).filter((lane) => lane.points.length > 0).map((lane) => lane.target));
    return AETHER_ARRANGEMENT_AUTOMATION_TARGETS
      .filter((target) => activeTargets.has(target.target))
      .map((target) => aetherArrangementAutomationTargetLabel(target.target));
  });

  onMount(() => {
    if (!isNative()) return;
    void send({ kind: "audio.listDevices" })
      .then((response) => setDeviceSnapshot(response.snapshot))
      .catch(() => setDeviceSnapshot(null));
  });

  function close() {
    useUiStore.getState().closeEditor({ kind: "track", trackId: props.trackId });
  }

  function openAutomationEditor() {
    const ui = useUiStore.getState();
    ui.closeEditor({ kind: "track", trackId: props.trackId });
    ui.openEditor({ kind: "trackAutomation", trackId: props.trackId });
  }

  function updateTrack(patch: Partial<Track>) {
    useProjectStore.getState().updateTrack(props.trackId, patch);
  }

  function setOutputBus(value: string) {
    if (value === "none") {
      useProjectStore.getState().setTrackOutputBus(props.trackId, undefined, false);
      return;
    }
    useProjectStore.getState().setTrackOutputBus(props.trackId, value === "master" ? undefined : value, true);
  }

  async function setInputDevice(value: string) {
    if (!value || !isNative()) {
      updateTrack({ inputDeviceId: value || undefined });
      return;
    }
    const selected = parseNativeDeviceValue(value);
    if (!selected) return;
    try {
      const response = await send({
        kind: "audio.selectInputDevice",
        typeName: selected.typeName,
        deviceName: selected.name,
        inputChannelCount: track()?.inputChannelCount ?? 2,
      });
      setDeviceSnapshot(response.snapshot);
      if (!response.ok) throw new Error(response.error ?? "Could not select input device.");
      updateTrack({ inputDeviceId: value });
    } catch (error) {
      await appAlert(error instanceof Error ? error.message : "Could not select input device.");
    }
  }

  function setInputChannels(value: string) {
    const [startRaw, countRaw] = value.split(":");
    const inputChannelStart = Number(startRaw);
    const inputChannelCount = Number(countRaw);
    if (!Number.isInteger(inputChannelStart) || !Number.isInteger(inputChannelCount)) return;
    updateTrack({ inputChannelStart, inputChannelCount });
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
          footer={<Button variant="primary" onClick={close}>Done</Button>}
        >
          <div class={styles.panel}>
            <TextInput
              className={styles.spanFull}
              label="Name"
              value={currentTrack().name}
              onInput={(event) => updateTrack({ name: event.currentTarget.value })}
            />

            <section class={`${styles.section} ${styles.spanFull}`}>
              <header class={styles.sectionHeader}>Routing</header>
              <div class={styles.sectionBody}>
                <FloatingSelect
                  label="Output bus"
                  layout="inline"
                  value={outputBusValue()}
                  options={outputBusOptions()}
                  open={outputBusOpen()}
                  ariaLabel="Track output bus"
                  onOpenChange={setOutputBusOpen}
                  onChange={setOutputBus}
                />
              </div>
            </section>

            <section class={styles.section}>
              <header class={styles.sectionHeader}>Level</header>
              <div class={styles.sectionBody}>
                <Knob
                  className={styles.trackKnob}
                  size="md"
                  label="Volume"
                  value={currentTrack().gainDb}
                  min={-48}
                  max={24}
                  step={0.1}
                  defaultValue={0}
                  formatValue={formatGain}
                  onChange={(gainDb) => updateTrack({ gainDb })}
                />
              </div>
            </section>

            <section class={styles.section}>
              <header class={styles.sectionHeader}>Stereo</header>
              <div class={styles.sectionBody}>
                <Knob
                  className={styles.trackKnob}
                  size="md"
                  label="Pan"
                  value={currentTrack().pan}
                  min={-1}
                  max={1}
                  step={0.01}
                  bipolar
                  defaultValue={0}
                  formatValue={formatPan}
                  onChange={(pan) => updateTrack({ pan })}
                />
              </div>
            </section>

            <section class={`${styles.section} ${styles.spanFull}`}>
              <header class={styles.sectionHeader}>
                <span>Instrument automation</span>
                <span>{trackAutomationTargetCount(currentTrack())} active</span>
              </header>
              <div class={styles.automationSummary}>
                <div>
                  <strong>{automatedParameterLabels().length === 0
                    ? "No automated parameters"
                    : `${automatedParameterLabels().length} automated ${automatedParameterLabels().length === 1 ? "parameter" : "parameters"}`}</strong>
                  <span>{automatedParameterLabels().length > 0
                    ? automatedParameterLabels().join(" · ")
                    : "Change instrument parameters over the project timeline. Use the track automation button for aligned timeline lanes."}</span>
                </div>
                <Button onClick={openAutomationEditor}>Edit automation</Button>
              </div>
            </section>

            <section class={`${styles.section} ${styles.spanFull}`}>
              <header class={styles.sectionHeader}>Recording</header>
              <div class={styles.sectionBody}>
                <div class={styles.toggleGrid}>
                  <Toggle label="Arm" checked={currentTrack().recordArmed} onChange={(recordArmed) => updateTrack({ recordArmed })} />
                  <Toggle label="Monitor" checked={currentTrack().inputMonitoring} onChange={(inputMonitoring) => updateTrack({ inputMonitoring })} />
                </div>
                <div class={styles.recordingSelectGrid}>
                  <FloatingSelect
                    label="Input device"
                    layout="inline"
                    value={currentTrack().inputDeviceId ?? ""}
                    options={inputDeviceOptions()}
                    open={inputDeviceOpen()}
                    ariaLabel="Audio input device"
                    onOpenChange={setInputDeviceOpen}
                    onChange={(value) => void setInputDevice(value)}
                  />
                  <FloatingSelect
                    label="Input channels"
                    layout="inline"
                    value={`${currentTrack().inputChannelStart}:${currentTrack().inputChannelCount}`}
                    options={inputChannelOptions()}
                    open={inputChannelsOpen()}
                    ariaLabel="Audio input channels"
                    onOpenChange={setInputChannelsOpen}
                    onChange={setInputChannels}
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

function SliderRow(props: { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (value: number) => void }) {
  return (
    <Slider
      className={styles.sliderRow}
      inputClassName={styles.range}
      readoutClassName={styles.sliderValue}
      layout="inline"
      label={props.label}
      value={props.value}
      min={props.min}
      max={props.max}
      step={props.step}
      readout={props.display}
      onChange={props.onChange}
    />
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

function currentOutputBusValue(track: Track | undefined): string {
  if (!track || track.outputEnabled === false) return "none";
  return track.outputBusId ?? "master";
}

function nativeDeviceValue(typeName: string, name: string): string {
  return `${encodeURIComponent(typeName)}::${encodeURIComponent(name)}`;
}

function parseNativeDeviceValue(value: string): { typeName: string; name: string } | null {
  const separator = value.indexOf("::");
  if (separator < 0) return null;
  try {
    return {
      typeName: decodeURIComponent(value.slice(0, separator)),
      name: decodeURIComponent(value.slice(separator + 2)),
    };
  } catch {
    return null;
  }
}

function audioInputChannelOptions(names: string[], currentStart: number, currentCount: number) {
  const channelCount = Math.max(2, names.length);
  const options: Array<{ value: string; label: string }> = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    options.push({ value: `${channel}:1`, label: `Mono · ${names[channel]?.trim() || `Input ${channel + 1}`}` });
  }
  for (let channel = 0; channel + 1 < channelCount; channel += 2) {
    options.push({
      value: `${channel}:2`,
      label: `Stereo · ${names[channel]?.trim() || `Input ${channel + 1}`} + ${names[channel + 1]?.trim() || `Input ${channel + 2}`}`,
    });
  }
  const currentValue = `${currentStart}:${currentCount}`;
  if (!options.some((option) => option.value === currentValue)) {
    options.push({ value: currentValue, label: `${currentCount === 1 ? "Mono" : `${currentCount}-channel`} · starts at input ${currentStart + 1}` });
  }
  return options;
}
