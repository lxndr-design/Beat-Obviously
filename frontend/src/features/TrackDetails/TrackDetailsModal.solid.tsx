import { For, createEffect, createMemo, createSignal, Show } from "solid-js";
import {
  AETHER_ARRANGEMENT_AUTOMATION_TARGETS,
  type AetherArrangementAutomationPointClipboard,
  type AetherArrangementAutomationTarget,
  aetherArrangementAutomationTargetLabel,
  aetherArrangementAutomationTargetMeta,
  clearTrackAutomationTarget,
  copyTrackAutomationPoints,
  formatAetherArrangementAutomationValue,
  insertTrackAutomationPoint,
  pasteTrackAutomationPoints,
  quantizeTrackAutomationPoints,
  removeTrackAutomationPoint,
  setTrackAutomationTargetCurve,
  setTrackAutomationTargetValues,
  snapTrackAutomationPointValues,
  trackAutomationCurve,
  trackAutomationEffectiveBadge,
  trackAutomationSummary,
  trackAutomationTargetCount,
  trackAutomationValueRange,
  trackHasAutomationTarget,
  updateTrackAutomationPoint,
  upsertTrackAutomationTarget,
} from "../../automation/aetherArrangementAutomation";
import {
  denormalizeAetherNoteAutomationValue,
  normalizeAetherNoteAutomationValue,
} from "../../automation/aetherNoteAutomation";
import { AUTOMATION_CURVES, automationCurveLabel } from "../../automation/curves";
import { Button, Checkbox, FloatingSelect, Modal, NumberInput, Slider, TextInput, Toggle } from "../../solid-ui";
import { useProjectStore, useUiStore } from "../../state/store";
import { createStoreSelector } from "../../solid-utils/store";
import styles from "./TrackDetailsModal.module.css";
import type { AutomationCurve, Id, Track } from "../../state/types";

interface TrackDetailsModalProps {
  trackId: Id;
}

export function TrackDetailsModal(props: TrackDetailsModalProps) {
  const tracks = createStoreSelector(useProjectStore, (s) => s.project.tracks);
  const projectLengthBeats = createStoreSelector(useProjectStore, (s) => s.project.lengthBeats);
  const track = createMemo(() => tracks().find((candidate) => candidate.id === props.trackId));
  const [automationCurveOpen, setAutomationCurveOpen] = createSignal(false);
  const [activeAutomationTarget, setActiveAutomationTarget] = createSignal<AetherArrangementAutomationTarget>("macro.1");
  const [draggedAutomationEdge, setDraggedAutomationEdge] = createSignal<"start" | "mid" | "end" | null>(null);
  const [automationPointClipboard, setAutomationPointClipboard] = createSignal<AetherArrangementAutomationPointClipboard | null>(null);
  const [selectedAutomationPointIndices, setSelectedAutomationPointIndices] = createSignal<number[]>([]);
  const activeAutomationMeta = createMemo(() => aetherArrangementAutomationTargetMeta(activeAutomationTarget()));
  const automationRange = createMemo(() => trackAutomationValueRange(track(), activeAutomationTarget()));
  const activeAutomationCurve = createMemo(() => trackAutomationCurve(track(), activeAutomationTarget()));
  const automationEffectiveBadge = createMemo(() => trackAutomationEffectiveBadge(track(), activeAutomationTarget()));
  const activeAutomationPoints = createMemo(() =>
    track()?.automation?.find((lane) => lane.target === activeAutomationTarget())?.points ?? []
  );
  const activeSelectedAutomationPointIndices = createMemo(() =>
    selectedAutomationPointIndices().filter((index) => index >= 0 && index < activeAutomationPoints().length)
  );
  createEffect(() => {
    activeAutomationTarget();
    setSelectedAutomationPointIndices([]);
  });
  const automationCurveOptions = AUTOMATION_CURVES.map((curve) => ({ value: curve, label: automationCurveLabel(curve) }));

  function close() {
    useUiStore.getState().closeEditor({ kind: "track", trackId: props.trackId });
  }

  function updateTrack(patch: Partial<Track>) {
    useProjectStore.getState().updateTrack(props.trackId, patch);
  }

  function updateTrackAutomation(nextTrack: Track) {
    updateTrack({ automation: nextTrack.automation });
  }

  function addTrackAutomationLane() {
    const current = track();
    if (!current) return;
    updateTrackAutomation(upsertTrackAutomationTarget(current, activeAutomationTarget(), projectLengthBeats()));
  }

  function clearTrackAutomationLane() {
    const current = track();
    if (!current) return;
    updateTrackAutomation(clearTrackAutomationTarget(current, activeAutomationTarget()));
  }

  function setTrackAutomationCurveValue(curve: string) {
    const current = track();
    if (!current) return;
    updateTrackAutomation(setTrackAutomationTargetCurve(current, activeAutomationTarget(), curve as AutomationCurve));
  }

  function setTrackAutomationValueEdge(edge: "start" | "mid" | "end", rawValue: string) {
    const current = track();
    if (!current) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    setTrackAutomationValue(edge, value);
  }

  function setTrackAutomationValue(edge: "start" | "mid" | "end", value: number) {
    const current = track();
    if (!current || !Number.isFinite(value)) return;
    const range = trackAutomationValueRange(current, activeAutomationTarget());
    updateTrackAutomation(setTrackAutomationTargetValues(
      current,
      activeAutomationTarget(),
      projectLengthBeats(),
      edge === "start" ? value : range.startValue,
      edge === "end" ? value : range.endValue,
      edge === "mid" ? value : range.midValue,
    ));
  }

  function startTrackAutomationHandleDrag(edge: "start" | "mid" | "end", event: PointerEvent) {
    if (!track()) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggedAutomationEdge(edge);
    const target = event.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic verifier events may not create an active browser pointer capture.
    }
    updateTrackAutomationHandleDrag(edge, event);
  }

  function updateTrackAutomationHandleDrag(edge: "start" | "mid" | "end", event: PointerEvent) {
    if (!track()) return;
    const element = event.currentTarget as HTMLElement;
    const rect = element.parentElement?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const value = denormalizeAetherNoteAutomationValue(activeAutomationTarget(), (event.clientX - rect.left) / rect.width);
    setTrackAutomationValue(edge, value);
  }

  function stopTrackAutomationHandleDrag(edge: "start" | "mid" | "end", event: PointerEvent) {
    if (draggedAutomationEdge() !== edge) return;
    updateTrackAutomationHandleDrag(edge, event);
    setDraggedAutomationEdge(null);
  }

  function addTrackAutomationPoint() {
    const current = track();
    if (!current) return;
    const range = trackAutomationValueRange(current, activeAutomationTarget());
    updateTrackAutomation(insertTrackAutomationPoint(
      current,
      activeAutomationTarget(),
      projectLengthBeats(),
      projectLengthBeats() / 2,
      range.midValue,
    ));
  }

  function quantizeTrackAutomationLanePoints() {
    const current = track();
    if (!current) return;
    updateTrackAutomation(quantizeTrackAutomationPoints(
      current,
      activeAutomationTarget(),
      projectLengthBeats(),
      0.25,
    ));
  }

  function snapTrackAutomationLaneValues() {
    const current = track();
    if (!current) return;
    updateTrackAutomation(snapTrackAutomationPointValues(current, activeAutomationTarget()));
  }

  function copyTrackAutomationLanePoints() {
    const current = track();
    if (!current) return;
    const pointIndices = activeSelectedAutomationPointIndices().length > 0
      ? activeSelectedAutomationPointIndices()
      : activeAutomationPoints().map((_, index) => index);
    if (pointIndices.length === 0) return;
    setAutomationPointClipboard(copyTrackAutomationPoints(current, activeAutomationTarget(), pointIndices));
  }

  function pasteTrackAutomationLanePoints() {
    const current = track();
    const clipboard = automationPointClipboard();
    if (!current || !clipboard || clipboard.target !== activeAutomationTarget()) return;
    updateTrackAutomation(pasteTrackAutomationPoints(current, clipboard, projectLengthBeats(), projectLengthBeats() / 2));
  }

  function setTrackAutomationPointBeat(index: number, rawBeat: string) {
    const current = track();
    if (!current) return;
    const point = activeAutomationPoints()[index];
    if (!point) return;
    updateTrackAutomation(updateTrackAutomationPoint(
      current,
      activeAutomationTarget(),
      projectLengthBeats(),
      index,
      Number(rawBeat),
      point.value,
    ));
  }

  function setTrackAutomationPointValue(index: number, rawValue: string) {
    const current = track();
    if (!current) return;
    const point = activeAutomationPoints()[index];
    if (!point) return;
    updateTrackAutomation(updateTrackAutomationPoint(
      current,
      activeAutomationTarget(),
      projectLengthBeats(),
      index,
      point.beat,
      Number(rawValue),
    ));
  }

  function deleteTrackAutomationPoint(index: number) {
    const current = track();
    if (!current) return;
    updateTrackAutomation(removeTrackAutomationPoint(current, activeAutomationTarget(), index));
    setSelectedAutomationPointIndices((indices) => indices
      .filter((pointIndex) => pointIndex !== index)
      .map((pointIndex) => pointIndex > index ? pointIndex - 1 : pointIndex));
  }

  function toggleTrackAutomationPointSelection(index: number) {
    setSelectedAutomationPointIndices((indices) =>
      indices.includes(index)
        ? indices.filter((pointIndex) => pointIndex !== index)
        : [...indices, index].sort((a, b) => a - b)
    );
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
              <header class={styles.sectionHeader}>
                <span>Aether automation</span>
                <span>{trackAutomationTargetCount(currentTrack())} active</span>
              </header>
              <div class={styles.automationPanel} aria-label="Aether track automation lanes">
                <div class={styles.automationHeader}>
                  <span>Track lanes</span>
                  <span>
                    {aetherArrangementAutomationTargetLabel(activeAutomationTarget())}
                    {" · "}
                    {trackAutomationSummary(currentTrack(), activeAutomationTarget())}
                    {" · "}
                    {projectLengthBeats()} beats
                  </span>
                </div>
                <div
                  class={styles.automationEffectiveBadge}
                  data-tone={automationEffectiveBadge().tone}
                  title={automationEffectiveBadge().detail}
                >
                  <span>{automationEffectiveBadge().label}</span>
                  <span>{automationEffectiveBadge().detail}</span>
                </div>
                <div class={styles.automationTargets} role="radiogroup" aria-label="Aether track automation target">
                  {AETHER_ARRANGEMENT_AUTOMATION_TARGETS.map((target) => (
                    <Button
                      size="xs"
                      selected={activeAutomationTarget() === target.target}
                      aria-label={`${target.label} track automation lane`}
                      onClick={() => setActiveAutomationTarget(target.target)}
                    >
                      {target.label}
                    </Button>
                  ))}
                </div>
                <div class={styles.automationActions}>
                  <Button size="xs" onClick={addTrackAutomationLane}>
                    Add lane
                  </Button>
                  <Button
                    size="xs"
                    disabled={!trackHasAutomationTarget(currentTrack(), activeAutomationTarget())}
                    onClick={clearTrackAutomationLane}
                  >
                    Clear
                  </Button>
                  <FloatingSelect
                    value={activeAutomationCurve()}
                    options={automationCurveOptions}
                    open={automationCurveOpen()}
                    className={styles.automationCurveSelect}
                    layout="inline"
                    ariaLabel="Aether track automation curve"
                    onOpenChange={setAutomationCurveOpen}
                    onChange={setTrackAutomationCurveValue}
                  />
                </div>
                <div class={styles.automationValueEditor}>
                  <Slider layout="inline" label="Start" min={activeAutomationMeta().min} max={activeAutomationMeta().max} step={activeAutomationMeta().step} value={automationRange().startValue} readout={formatAetherArrangementAutomationValue(activeAutomationTarget(), automationRange().startValue)} onChange={(value) => setTrackAutomationValueEdge("start", String(value))} />
                  <Slider layout="inline" label="Mid" min={activeAutomationMeta().min} max={activeAutomationMeta().max} step={activeAutomationMeta().step} value={automationRange().midValue} readout={formatAetherArrangementAutomationValue(activeAutomationTarget(), automationRange().midValue)} onChange={(value) => setTrackAutomationValueEdge("mid", String(value))} />
                  <Slider layout="inline" label="End" min={activeAutomationMeta().min} max={activeAutomationMeta().max} step={activeAutomationMeta().step} value={automationRange().endValue} readout={formatAetherArrangementAutomationValue(activeAutomationTarget(), automationRange().endValue)} onChange={(value) => setTrackAutomationValueEdge("end", String(value))} />
                </div>
                <div class={styles.automationHandleRail} aria-label="Drag track automation values">
                  <span class={styles.automationHandleLine} aria-hidden="true" />
                  <button
                    type="button"
                    classList={{
                      [styles.automationHandleButton]: true,
                      [styles.automationHandleButtonActive]: draggedAutomationEdge() === "start",
                    }}
                    style={{
                      left: `${normalizeAetherNoteAutomationValue(activeAutomationTarget(), automationRange().startValue) * 100}%`,
                    }}
                    data-aether-track-automation-handle="start"
                    aria-label={`Drag start ${aetherArrangementAutomationTargetLabel(activeAutomationTarget())} value`}
                    onPointerDown={(event) => startTrackAutomationHandleDrag("start", event)}
                    onPointerMove={(event) => draggedAutomationEdge() === "start" && updateTrackAutomationHandleDrag("start", event)}
                    onPointerUp={(event) => stopTrackAutomationHandleDrag("start", event)}
                    onPointerCancel={() => setDraggedAutomationEdge(null)}
                  >
                    S
                  </button>
                  <button
                    type="button"
                    classList={{
                      [styles.automationHandleButton]: true,
                      [styles.automationHandleButtonActive]: draggedAutomationEdge() === "mid",
                    }}
                    style={{
                      left: `${normalizeAetherNoteAutomationValue(activeAutomationTarget(), automationRange().midValue) * 100}%`,
                    }}
                    data-aether-track-automation-handle="mid"
                    aria-label={`Drag midpoint ${aetherArrangementAutomationTargetLabel(activeAutomationTarget())} value`}
                    onPointerDown={(event) => startTrackAutomationHandleDrag("mid", event)}
                    onPointerMove={(event) => draggedAutomationEdge() === "mid" && updateTrackAutomationHandleDrag("mid", event)}
                    onPointerUp={(event) => stopTrackAutomationHandleDrag("mid", event)}
                    onPointerCancel={() => setDraggedAutomationEdge(null)}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    classList={{
                      [styles.automationHandleButton]: true,
                      [styles.automationHandleButtonActive]: draggedAutomationEdge() === "end",
                    }}
                    style={{
                      left: `${normalizeAetherNoteAutomationValue(activeAutomationTarget(), automationRange().endValue) * 100}%`,
                    }}
                    data-aether-track-automation-handle="end"
                    aria-label={`Drag end ${aetherArrangementAutomationTargetLabel(activeAutomationTarget())} value`}
                    onPointerDown={(event) => startTrackAutomationHandleDrag("end", event)}
                    onPointerMove={(event) => draggedAutomationEdge() === "end" && updateTrackAutomationHandleDrag("end", event)}
                    onPointerUp={(event) => stopTrackAutomationHandleDrag("end", event)}
                    onPointerCancel={() => setDraggedAutomationEdge(null)}
                  >
                    E
                  </button>
                </div>
                <div class={styles.automationPointEditor} aria-label="Aether track automation points">
                  <div class={styles.automationPointHeader}>
                    <span>Points</span>
                    <div class={styles.automationPointTools}>
                      <Button size="xs" disabled={activeAutomationPoints().length === 0} onClick={quantizeTrackAutomationLanePoints}>
                        Quantize
                      </Button>
                      <Button size="xs" disabled={activeAutomationPoints().length === 0} onClick={snapTrackAutomationLaneValues}>
                        Snap values
                      </Button>
                      <Button size="xs" disabled={activeAutomationPoints().length === 0} onClick={copyTrackAutomationLanePoints}>
                        Copy
                      </Button>
                      <Button
                        size="xs"
                        disabled={automationPointClipboard()?.target !== activeAutomationTarget()}
                        onClick={pasteTrackAutomationLanePoints}
                      >
                        Paste
                      </Button>
                      <Button size="xs" onClick={addTrackAutomationPoint}>Add point</Button>
                    </div>
                  </div>
                  <For each={activeAutomationPoints()}>
                    {(point, index) => (
                      <div
                        classList={{
                          [styles.automationPointRow]: true,
                          [styles.automationPointRowSelected]: activeSelectedAutomationPointIndices().includes(index()),
                        }}
                      >
                        <Checkbox
                          inputClassName={styles.automationPointSelect}
                          checked={activeSelectedAutomationPointIndices().includes(index())}
                          readOnly
                          aria-label={`Select track automation point ${index() + 1}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleTrackAutomationPointSelection(index());
                          }}
                        />
                        <span class={styles.automationPointIndex}>{index() + 1}</span>
                        <NumberInput layout="inline" label="Beat" min={0} max={projectLengthBeats()} step={0.125} value={point.beat} onChange={(value) => setTrackAutomationPointBeat(index(), String(value))} />
                        <NumberInput layout="inline" label="Value" min={activeAutomationMeta().min} max={activeAutomationMeta().max} step={activeAutomationMeta().step} value={point.value} onChange={(value) => setTrackAutomationPointValue(index(), String(value))} />
                        <span class={styles.automationPointValue}>
                          {formatAetherArrangementAutomationValue(activeAutomationTarget(), point.value)}
                        </span>
                        <Button size="xs" variant="ghost" onClick={() => deleteTrackAutomationPoint(index())}>
                          Remove
                        </Button>
                      </div>
                    )}
                  </For>
                </div>
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
