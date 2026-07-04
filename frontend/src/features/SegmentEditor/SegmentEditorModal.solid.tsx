import { For, createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { DRUM_MAX_STEPS, type GeneratedDrumBeat } from "../../ai/drumBeatGenerator";
import { maybeRunDueTraining } from "../../ai/trainingRunner";
import {
  AETHER_ARRANGEMENT_AUTOMATION_TARGETS,
  type AetherArrangementAutomationPointClipboard,
  type AetherArrangementAutomationTarget,
  aetherArrangementAutomationTargetLabel,
  aetherArrangementAutomationTargetMeta,
  clearSegmentAutomationTarget,
  clipSegmentAutomation,
  copySegmentAutomationPoints,
  formatAetherArrangementAutomationValue,
  insertSegmentAutomationPoint,
  pasteSegmentAutomationPoints,
  quantizeSegmentAutomationPoints,
  removeSegmentAutomationPoint,
  segmentAutomationCurve,
  segmentAutomationEffectiveBadge,
  segmentAutomationSummary,
  segmentAutomationTargetCount,
  segmentAutomationValueRange,
  segmentHasAutomationTarget,
  setSegmentAutomationTargetCurve,
  setSegmentAutomationTargetValues,
  snapSegmentAutomationPointValues,
  updateSegmentAutomationPoint,
  upsertSegmentAutomationTarget,
} from "../../automation/aetherArrangementAutomation";
import {
  denormalizeAetherNoteAutomationValue,
  normalizeAetherNoteAutomationValue,
} from "../../automation/aetherNoteAutomation";
import { AUTOMATION_CURVES, automationCurveLabel } from "../../automation/curves";
import { isSupportedAudioFileName, SUPPORTED_AUDIO_IMPORT_LABEL } from "../../audio/audioFormats";
import { importAudioFile } from "../../audio/audioImport";
import { createInstrumentBufferSource, noteFrequency } from "../../audio/synthPreview";
import { appAlert, useModalStack } from "../../solid-ui";
import { updateDrumBeatFeedback } from "../../persistence/dexie";
import { Button, FloatingSelect, Icon, Modal, NumberInput, TextInput } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { selectSegment } from "../../state/selectors";
import {
  snapshotInstrument,
  useAudioFileStore,
  useInstrumentStore,
  useProjectStore,
  useTransportStore,
  useUiStore,
} from "../../state/store";
import type { AutomationCurve, DrumRow, DrumSpeed, Instrument, MidiNote, Segment, TimeSignature } from "../../state/types";
import { DrumSequencer } from "../DrumEditor/DrumSequencer.solid";
import { PianoRoll } from "../MidiEditor/PianoRoll.solid";
import { MidiTransport } from "../MidiEditor/MidiTransport.solid";
import styles from "./SegmentEditorModal.module.css";

export interface SegmentEditorModalProps {
  segmentId: string;
}

type MidiLikePayload = Extract<Segment["payload"], { kind: "midi" | "mixed" }>;
type DrumPayload = Extract<Segment["payload"], { kind: "drum" }>;
type AudioPayload = Extract<Segment["payload"], { kind: "audio" }>;

// Keep the default MIDI modal focused on piano-roll editing. Aether arrangement
// automation needs a separate opt-in surface instead of living under every MIDI clip.
const SHOW_SEGMENT_AUTOMATION_PANEL = false;

export function SegmentEditorModal(props: SegmentEditorModalProps) {
  const source = createStoreSelector(useProjectStore, () => selectSegment(props.segmentId));
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const positionBeat = createStoreSelector(useTransportStore, (s) => s.positionBeat);
  const playing = createStoreSelector(useTransportStore, (s) => s.playing);
  const timeSignature = createStoreSelector(useProjectStore, (s) => s.project.timeSignature);
  const bpm = createStoreSelector(useProjectStore, (s) => s.project.bpm);
  const updateSegment = useProjectStore.getState().updateSegment;
  const closeEditor = useUiStore.getState().closeEditor;
  const requestDirtyClose = useModalStack.getState().requestDirtyClose;
  const addInstrument = useInstrumentStore.getState().addInstrument;
  const addAudioFile = useAudioFileStore.getState().addFile;
  const scopeId = () => `segment-${props.segmentId}`;
  const [draft, setDraft] = createSignal<Segment | undefined>(source() ? structuredClone(source()) : undefined, { equals: false });
  const [instrumentSelectOpen, setInstrumentSelectOpen] = createSignal(false);
  const [midiTimeSignatureOpen, setMidiTimeSignatureOpen] = createSignal(false);
  const [segmentAutomationCurveOpen, setSegmentAutomationCurveOpen] = createSignal(false);
  const [activeSegmentAutomationTarget, setActiveSegmentAutomationTarget] = createSignal<AetherArrangementAutomationTarget>("macro.1");
  const [draggedSegmentAutomationEdge, setDraggedSegmentAutomationEdge] = createSignal<"start" | "mid" | "end" | null>(null);
  const [segmentAutomationPointClipboard, setSegmentAutomationPointClipboard] = createSignal<AetherArrangementAutomationPointClipboard | null>(null);
  const [selectedSegmentAutomationPointIndices, setSelectedSegmentAutomationPointIndices] = createSignal<number[]>([]);
  const [midiPreviewBeat, setMidiPreviewBeat] = createSignal<number | null>(null);
  const [drumTrainingSessionId, setDrumTrainingSessionId] = createSignal<string | null>(null);
  let previewCtx: AudioContext | null = null;

  createEffect(() => {
    const currentSource = source();
    if (currentSource && !draft()) setDraft(structuredClone(currentSource));
  });

  onCleanup(() => {
    if (previewCtx) void previewCtx.close();
  });

  const dirty = createMemo(() => Boolean(source() && draft() && JSON.stringify(source()) !== JSON.stringify(draft())));
  const isMidi = createMemo(() => draft()?.payload.kind === "midi" || draft()?.payload.kind === "mixed");
  const drumPayload = createMemo<DrumPayload | null>(() => draft()?.payload.kind === "drum" ? draft()!.payload as DrumPayload : null);
  const audioPayload = createMemo<AudioPayload | null>(() => draft()?.payload.kind === "audio" ? draft()!.payload as AudioPayload : null);
  const midiNotes = createMemo<MidiNote[]>(() => isMidi() ? (draft()?.payload as MidiLikePayload).notes : []);
  const transpose = createMemo(() => draft()?.transpose ?? 0);
  const midiGainDb = createMemo(() => draft() ? midiSegmentGainDb(draft()!.payload) : 0);
  const midiVolumePercent = createMemo(() => gainDbToVolumePercent(midiGainDb()));
  const midiTimeSignature = createMemo(() => draft()?.timeSignature ?? timeSignature());
  const activeSegmentAutomationMeta = createMemo(() => aetherArrangementAutomationTargetMeta(activeSegmentAutomationTarget()));
  const segmentAutomationRange = createMemo(() => segmentAutomationValueRange(draft(), activeSegmentAutomationTarget()));
  const activeSegmentAutomationCurve = createMemo(() => segmentAutomationCurve(draft(), activeSegmentAutomationTarget()));
  const segmentAutomationEffective = createMemo(() => segmentAutomationEffectiveBadge(draft(), activeSegmentAutomationTarget()));
  const activeSegmentAutomationPoints = createMemo(() =>
    draft()?.automation?.find((lane) => lane.target === activeSegmentAutomationTarget())?.points ?? []
  );
  const activeSelectedSegmentAutomationPointIndices = createMemo(() =>
    selectedSegmentAutomationPointIndices().filter((index) => index >= 0 && index < activeSegmentAutomationPoints().length)
  );
  createEffect(() => {
    activeSegmentAutomationTarget();
    setSelectedSegmentAutomationPointIndices([]);
  });
  const segmentAutomationCurveOptions = AUTOMATION_CURVES.map((curve) => ({ value: curve, label: automationCurveLabel(curve) }));
  const previewMidiNotes = createMemo(() => midiNotes().map((note) => ({
    ...note,
    pitch: Math.max(0, Math.min(127, note.pitch + transpose())),
    curve: note.curve?.map((point) => ({ ...point, pitch: Math.max(0, Math.min(127, point.pitch + transpose())) })),
  })));
  const displayName = createMemo(() => draft()?.name?.trim() || `Segment ${props.segmentId.slice(0, 6)}`);
  const ribbonName = createMemo(() => dirty() ? `${displayName()} *` : displayName());
  const globalPlayheadBeat = createMemo(() => {
    const currentDraft = draft();
    if (!currentDraft || !playing()) return null;
    const position = positionBeat();
    return position >= currentDraft.startBeat && position <= currentDraft.startBeat + currentDraft.lengthBeats
      ? position - currentDraft.startBeat
      : null;
  });
  const playheadBeat = createMemo(() => midiPreviewBeat() ?? globalPlayheadBeat());

  function close() {
    closeEditor({ kind: "segment", segmentId: props.segmentId });
  }

  function save() {
    const currentDraft = draft();
    if (!currentDraft) return;
    const sessionId = drumTrainingSessionId();
    if (sessionId && currentDraft.payload.kind === "drum") {
      void updateDrumBeatFeedback(sessionId, {
        acceptedEdit: true,
        finalBeat: drumPayloadFromSegment(currentDraft),
      }).then(() => maybeRunDueTraining("drums"));
    }
    updateSegment(props.segmentId, prepareSegmentForSave(currentDraft));
    close();
  }

  function requestClose() {
    if (dirty()) requestDirtyClose(scopeId(), save, close);
    else close();
  }

  function updateMidi(notes: MidiNote[]) {
    setDraft((current) => {
      if (!current || (current.payload.kind !== "midi" && current.payload.kind !== "mixed")) return current;
      return { ...current, payload: { ...current.payload, notes } };
    });
  }

  function updateMidiVolume(percent: number) {
    const gainDb = volumePercentToGainDb(percent);
    setDraft((current) => {
      if (!current || (current.payload.kind !== "midi" && current.payload.kind !== "mixed")) return current;
      return { ...current, payload: { ...current.payload, gainDb } };
    });
  }

  function setDraftSegment(next: Segment) {
    setDraft(next);
  }

  function addSegmentAutomationLane() {
    const currentDraft = draft();
    if (!currentDraft) return;
    setDraftSegment(upsertSegmentAutomationTarget(currentDraft, activeSegmentAutomationTarget()));
  }

  function clearSegmentAutomationLane() {
    const currentDraft = draft();
    if (!currentDraft) return;
    setDraftSegment(clearSegmentAutomationTarget(currentDraft, activeSegmentAutomationTarget()));
  }

  function setSegmentAutomationCurveValue(curve: string) {
    const currentDraft = draft();
    if (!currentDraft) return;
    setDraftSegment(setSegmentAutomationTargetCurve(currentDraft, activeSegmentAutomationTarget(), curve as AutomationCurve));
  }

  function setSegmentAutomationValueEdge(edge: "start" | "mid" | "end", rawValue: string) {
    const currentDraft = draft();
    if (!currentDraft) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    setSegmentAutomationValue(edge, value);
  }

  function setSegmentAutomationValue(edge: "start" | "mid" | "end", value: number) {
    const currentDraft = draft();
    if (!currentDraft || !Number.isFinite(value)) return;
    const current = segmentAutomationValueRange(currentDraft, activeSegmentAutomationTarget());
    setDraftSegment(setSegmentAutomationTargetValues(
      currentDraft,
      activeSegmentAutomationTarget(),
      edge === "start" ? value : current.startValue,
      edge === "end" ? value : current.endValue,
      edge === "mid" ? value : current.midValue,
    ));
  }

  function startSegmentAutomationHandleDrag(edge: "start" | "mid" | "end", event: PointerEvent) {
    if (!draft()) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggedSegmentAutomationEdge(edge);
    const target = event.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic verifier events may not create an active browser pointer capture.
    }
    updateSegmentAutomationHandleDrag(edge, event);
  }

  function updateSegmentAutomationHandleDrag(edge: "start" | "mid" | "end", event: PointerEvent) {
    if (!draft()) return;
    const element = event.currentTarget as HTMLElement;
    const rect = element.parentElement?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const value = denormalizeAetherNoteAutomationValue(activeSegmentAutomationTarget(), (event.clientX - rect.left) / rect.width);
    setSegmentAutomationValue(edge, value);
  }

  function stopSegmentAutomationHandleDrag(edge: "start" | "mid" | "end", event: PointerEvent) {
    if (draggedSegmentAutomationEdge() !== edge) return;
    updateSegmentAutomationHandleDrag(edge, event);
    setDraggedSegmentAutomationEdge(null);
  }

  function addSegmentAutomationPoint() {
    const currentDraft = draft();
    if (!currentDraft) return;
    const range = segmentAutomationValueRange(currentDraft, activeSegmentAutomationTarget());
    setDraftSegment(insertSegmentAutomationPoint(
      currentDraft,
      activeSegmentAutomationTarget(),
      currentDraft.lengthBeats / 2,
      range.midValue,
    ));
  }

  function quantizeSegmentAutomationLanePoints() {
    const currentDraft = draft();
    if (!currentDraft) return;
    setDraftSegment(quantizeSegmentAutomationPoints(currentDraft, activeSegmentAutomationTarget(), 0.25));
  }

  function snapSegmentAutomationLaneValues() {
    const currentDraft = draft();
    if (!currentDraft) return;
    setDraftSegment(snapSegmentAutomationPointValues(currentDraft, activeSegmentAutomationTarget()));
  }

  function copySegmentAutomationLanePoints() {
    const currentDraft = draft();
    if (!currentDraft) return;
    const pointIndices = activeSelectedSegmentAutomationPointIndices().length > 0
      ? activeSelectedSegmentAutomationPointIndices()
      : activeSegmentAutomationPoints().map((_, index) => index);
    if (pointIndices.length === 0) return;
    setSegmentAutomationPointClipboard(copySegmentAutomationPoints(currentDraft, activeSegmentAutomationTarget(), pointIndices));
  }

  function pasteSegmentAutomationLanePoints() {
    const currentDraft = draft();
    const clipboard = segmentAutomationPointClipboard();
    if (!currentDraft || !clipboard || clipboard.target !== activeSegmentAutomationTarget()) return;
    setDraftSegment(pasteSegmentAutomationPoints(currentDraft, clipboard, currentDraft.lengthBeats / 2));
  }

  function setSegmentAutomationPointBeat(index: number, rawBeat: string) {
    const currentDraft = draft();
    if (!currentDraft) return;
    const point = activeSegmentAutomationPoints()[index];
    if (!point) return;
    setDraftSegment(updateSegmentAutomationPoint(
      currentDraft,
      activeSegmentAutomationTarget(),
      index,
      Number(rawBeat),
      point.value,
    ));
  }

  function setSegmentAutomationPointValue(index: number, rawValue: string) {
    const currentDraft = draft();
    if (!currentDraft) return;
    const point = activeSegmentAutomationPoints()[index];
    if (!point) return;
    setDraftSegment(updateSegmentAutomationPoint(
      currentDraft,
      activeSegmentAutomationTarget(),
      index,
      point.beat,
      Number(rawValue),
    ));
  }

  function deleteSegmentAutomationPoint(index: number) {
    const currentDraft = draft();
    if (!currentDraft) return;
    setDraftSegment(removeSegmentAutomationPoint(currentDraft, activeSegmentAutomationTarget(), index));
    setSelectedSegmentAutomationPointIndices((indices) => indices
      .filter((pointIndex) => pointIndex !== index)
      .map((pointIndex) => pointIndex > index ? pointIndex - 1 : pointIndex));
  }

  function toggleSegmentAutomationPointSelection(index: number) {
    setSelectedSegmentAutomationPointIndices((indices) =>
      indices.includes(index)
        ? indices.filter((pointIndex) => pointIndex !== index)
        : [...indices, index].sort((a, b) => a - b)
    );
  }

  function updateDrumRows(rows: DrumRow[]) {
    setDraft((current) => current?.payload.kind === "drum"
      ? { ...current, payload: { ...current.payload, rows } }
      : current);
  }

  function resizeDrum(lengthBeats: number, rows: DrumRow[]) {
    setDraft((current) => {
      if (!current || current.payload.kind !== "drum") return current;
      const nextLength = Math.max(1, Math.min(DRUM_MAX_STEPS, Math.round(lengthBeats)));
      return {
        ...current,
        lengthBeats: nextLength,
        payload: {
          ...current.payload,
          stepCount: Math.max(1, Math.min(DRUM_MAX_STEPS, Math.round(lengthBeats))),
          rows,
        },
      };
    });
  }

  function updateDrumSpeed(speed: DrumSpeed) {
    setDraft((current) => current?.payload.kind === "drum" ? { ...current, payload: { ...current.payload, speed } } : current);
  }

  function updateDrumDefaultPitch(defaultPitchHz: number | undefined) {
    setDraft((current) => current?.payload.kind === "drum" ? { ...current, payload: { ...current.payload, defaultPitchHz } } : current);
  }

  function updateDrumSwing(swingPercent: number) {
    setDraft((current) => current?.payload.kind === "drum" ? { ...current, payload: { ...current.payload, swingPercent } } : current);
  }

  function updateDrumTimeSignature(next: TimeSignature) {
    setDraft((current) => current?.payload.kind === "drum" ? { ...current, payload: { ...current.payload, timeSignature: next } } : current);
  }

  function applyGeneratedDrumBeat(beat: GeneratedDrumBeat) {
    setDraft((current) => {
      if (!current || current.payload.kind !== "drum") return current;
      return {
        ...current,
        lengthBeats: beat.lengthBeats,
        payload: {
          ...current.payload,
          rows: beat.rows,
          stepCount: beat.stepCount,
          speed: beat.speed,
          swingPercent: beat.swingPercent,
          defaultPitchHz: beat.defaultPitchHz ?? current.payload.defaultPitchHz,
        },
      };
    });
  }

  async function uploadDrumRow() {
    const currentDraft = draft();
    if (!currentDraft || currentDraft.payload.kind !== "drum") return;
    const file = await importAudioFile();
    if (!file) return;
    if (!isSupportedAudioFileName(file.name) && !isSupportedAudioFileName(file.path)) {
      await appAlert(`Unsupported audio file. Supported formats: ${SUPPORTED_AUDIO_IMPORT_LABEL}.`);
      return;
    }
    addAudioFile(file);
    const name = sampleName(file.name);
    const uploadedInstrument: Partial<Instrument> = {
      name,
      kind: "sampler",
      waveform: "sample",
      sampleIds: [file.id],
      sampleUrl: file.path,
      source: {
        kind: "uploaded",
        label: file.name,
        url: file.path,
        importedAt: Date.now(),
        edited: false,
      },
      userCreated: true,
    };
    const instrumentId = addInstrument({
      ...uploadedInstrument,
      original: snapshotInstrument({
        ...fallbackInstrument,
        ...uploadedInstrument,
        id: "uploaded-preview",
      } as Instrument),
    });
    const nextRow: DrumRow = {
      id: crypto.randomUUID(),
      instrumentId,
      name,
      steps: Array.from({ length: currentDraft.payload.stepCount }, () => false),
    };
    setDraft({
      ...currentDraft,
      payload: { ...currentDraft.payload, rows: [...currentDraft.payload.rows, nextRow] },
    });
  }

  function previewNote(pitch: number, velocity = 100) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!previewCtx) previewCtx = new Ctor();
    const ctx = previewCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const gain = ctx.createGain();
    const currentDraft = draft();
    if (!currentDraft) return;
    const instrument = instruments().find((item) => item.id === currentDraft.instrumentId);
    const now = ctx.currentTime;
    const peak = (applyGainToVelocity(velocity, midiSegmentGainDb(currentDraft.payload)) / 127) * 0.25;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.005);
    gain.gain.linearRampToValueAtTime(0, now + 0.2);
    gain.connect(ctx.destination);

    const synth = instrument ?? fallbackInstrument;
    const sourceNode = createInstrumentBufferSource(
      ctx,
      synth,
      0.24,
      noteFrequency(Math.max(0, Math.min(127, pitch + (currentDraft.transpose ?? 0))), synth),
      undefined,
      127,
      bpm(),
    );
    sourceNode.connect(gain);
    sourceNode.start(now);
    sourceNode.stop(now + 0.24);
  }

  return (
    <Show when={source() && draft()}>
      <Modal
        open
        scopeId={scopeId()}
        title={<><Icon name={segmentIcon(draft()!.payload.kind)} size={14} decorative />{ribbonName()}</>}
        width="lg"
        dirty={dirty()}
        onClose={requestClose}
        onRequestCloseDirty={requestClose}
        footer={
          <>
            <Button variant="ghost" onClick={requestClose}>Cancel</Button>
            <Button variant="primary" disabled={!dirty()} onClick={save}>Save</Button>
          </>
        }
      >
        <Show when={isMidi()}>
          <>
            <div class={styles.controls}>
              <NumberInput
                layout="inline"
                label="Length"
                value={draft()!.lengthBeats}
                min={1}
                step={1}
                onChange={(lengthBeats) => setDraft((current) => current ? { ...current, lengthBeats: Math.max(1, Math.round(lengthBeats)) } : current)}
              />
              <FloatingSelect
                layout="inline"
                label="Instrument"
                value={draft()!.instrumentId ?? ""}
                ariaLabel="Segment instrument"
                options={[
                  { value: "", label: "-- none --" },
                  ...instruments().map((instrument) => ({ value: instrument.id, label: instrument.name })),
                ]}
                open={instrumentSelectOpen()}
                onOpenChange={setInstrumentSelectOpen}
                onChange={(instrumentId) =>
                  setDraft((current) => current ? { ...current, instrumentId: instrumentId || undefined } : current)
                }
              />
              <NumberInput
                layout="inline"
                label="Transpose"
                value={transpose()}
                min={-48}
                max={DRUM_MAX_STEPS}
                step={1}
                onChange={(value) => setDraft((current) => current ? { ...current, transpose: Math.round(value) } : current)}
              />
              <NumberInput
                layout="inline"
                label="Vol"
                value={midiVolumePercent()}
                min={0}
                max={100}
                step={1}
                unit="%"
                maxLength={3}
                commitOnChange
                onChange={(value) => updateMidiVolume(Math.round(value))}
              />
              <FloatingSelect
                layout="inline"
                label="Time"
                value={formatTimeSignature(midiTimeSignature())}
                ariaLabel="MIDI time signature"
                options={TIME_SIGNATURE_OPTIONS.map((signature) => ({ value: signature, label: signature }))}
                open={midiTimeSignatureOpen()}
                onOpenChange={setMidiTimeSignatureOpen}
                onChange={(value) => setDraft((current) => current ? { ...current, timeSignature: parseTimeSignature(value) } : current)}
              />
              <div class={styles.transportSlot}>
                <MidiTransport
                  notes={previewMidiNotes()}
                  gainDb={midiGainDb()}
                  lengthBeats={draft()!.lengthBeats}
                  bpm={bpm()}
                  instrument={instruments().find((instrument) => instrument.id === draft()!.instrumentId)}
                  hotkeyScopeId={scopeId()}
                  onPositionChange={setMidiPreviewBeat}
                />
              </div>
            </div>

            <PianoRoll
              notes={midiNotes()}
              lengthBeats={draft()!.lengthBeats}
              playheadBeat={playheadBeat()}
              hotkeyScopeId={scopeId()}
              onLengthChange={(lengthBeats: number) => setDraft((current) => current ? { ...current, lengthBeats: Math.max(1, Math.round(lengthBeats)) } : current)}
              onChange={updateMidi}
              onPreviewNote={previewNote}
            />

            {SHOW_SEGMENT_AUTOMATION_PANEL && (
            <div class={styles.automationPanel} aria-label="Aether segment automation lanes">
              <div class={styles.automationHeader}>
                <span>Aether segment lanes</span>
                <span>
                  {aetherArrangementAutomationTargetLabel(activeSegmentAutomationTarget())}
                  {" · "}
                  {segmentAutomationSummary(draft(), activeSegmentAutomationTarget())}
                  {" · "}
                  {segmentAutomationTargetCount(draft())} active
                </span>
              </div>
              <div
                class={styles.automationEffectiveBadge}
                data-tone={segmentAutomationEffective().tone}
                title={segmentAutomationEffective().detail}
              >
                <span>{segmentAutomationEffective().label}</span>
                <span>{segmentAutomationEffective().detail}</span>
              </div>
              <div class={styles.automationTargets} role="radiogroup" aria-label="Aether segment automation target">
                {AETHER_ARRANGEMENT_AUTOMATION_TARGETS.map((target) => (
                  <Button
                    size="xs"
                    selected={activeSegmentAutomationTarget() === target.target}
                    aria-label={`${target.label} segment automation lane`}
                    onClick={() => setActiveSegmentAutomationTarget(target.target)}
                  >
                    {target.label}
                  </Button>
                ))}
              </div>
              <div class={styles.automationActions}>
                <Button size="xs" onClick={addSegmentAutomationLane}>
                  Add lane
                </Button>
                <Button
                  size="xs"
                  disabled={!segmentHasAutomationTarget(draft(), activeSegmentAutomationTarget())}
                  onClick={clearSegmentAutomationLane}
                >
                  Clear
                </Button>
                <FloatingSelect
                  value={activeSegmentAutomationCurve()}
                  options={segmentAutomationCurveOptions}
                  open={segmentAutomationCurveOpen()}
                  className={styles.automationCurveSelect}
                  layout="inline"
                  ariaLabel="Aether segment automation curve"
                  onOpenChange={setSegmentAutomationCurveOpen}
                  onChange={setSegmentAutomationCurveValue}
                />
              </div>
              <div class={styles.automationValueEditor}>
                <label>
                  <span>Start</span>
                  <input
                    type="range"
                    min={activeSegmentAutomationMeta().min}
                    max={activeSegmentAutomationMeta().max}
                    step={activeSegmentAutomationMeta().step}
                    value={segmentAutomationRange().startValue}
                    onInput={(event) => setSegmentAutomationValueEdge("start", event.currentTarget.value)}
                  />
                  <span>{formatAetherArrangementAutomationValue(activeSegmentAutomationTarget(), segmentAutomationRange().startValue)}</span>
                </label>
                <label>
                  <span>Mid</span>
                  <input
                    type="range"
                    min={activeSegmentAutomationMeta().min}
                    max={activeSegmentAutomationMeta().max}
                    step={activeSegmentAutomationMeta().step}
                    value={segmentAutomationRange().midValue}
                    onInput={(event) => setSegmentAutomationValueEdge("mid", event.currentTarget.value)}
                  />
                  <span>{formatAetherArrangementAutomationValue(activeSegmentAutomationTarget(), segmentAutomationRange().midValue)}</span>
                </label>
                <label>
                  <span>End</span>
                  <input
                    type="range"
                    min={activeSegmentAutomationMeta().min}
                    max={activeSegmentAutomationMeta().max}
                    step={activeSegmentAutomationMeta().step}
                    value={segmentAutomationRange().endValue}
                    onInput={(event) => setSegmentAutomationValueEdge("end", event.currentTarget.value)}
                  />
                  <span>{formatAetherArrangementAutomationValue(activeSegmentAutomationTarget(), segmentAutomationRange().endValue)}</span>
                </label>
              </div>
              <div class={styles.automationHandleRail} aria-label="Drag segment automation values">
                <span class={styles.automationHandleLine} aria-hidden="true" />
                <button
                  type="button"
                  classList={{
                    [styles.automationHandleButton]: true,
                    [styles.automationHandleButtonActive]: draggedSegmentAutomationEdge() === "start",
                  }}
                  style={{
                    left: `${normalizeAetherNoteAutomationValue(activeSegmentAutomationTarget(), segmentAutomationRange().startValue) * 100}%`,
                  }}
                  data-aether-segment-automation-handle="start"
                  aria-label={`Drag start ${aetherArrangementAutomationTargetLabel(activeSegmentAutomationTarget())} value`}
                  onPointerDown={(event) => startSegmentAutomationHandleDrag("start", event)}
                  onPointerMove={(event) => draggedSegmentAutomationEdge() === "start" && updateSegmentAutomationHandleDrag("start", event)}
                  onPointerUp={(event) => stopSegmentAutomationHandleDrag("start", event)}
                  onPointerCancel={() => setDraggedSegmentAutomationEdge(null)}
                >
                  S
                </button>
                <button
                  type="button"
                  classList={{
                    [styles.automationHandleButton]: true,
                    [styles.automationHandleButtonActive]: draggedSegmentAutomationEdge() === "mid",
                  }}
                  style={{
                    left: `${normalizeAetherNoteAutomationValue(activeSegmentAutomationTarget(), segmentAutomationRange().midValue) * 100}%`,
                  }}
                  data-aether-segment-automation-handle="mid"
                  aria-label={`Drag midpoint ${aetherArrangementAutomationTargetLabel(activeSegmentAutomationTarget())} value`}
                  onPointerDown={(event) => startSegmentAutomationHandleDrag("mid", event)}
                  onPointerMove={(event) => draggedSegmentAutomationEdge() === "mid" && updateSegmentAutomationHandleDrag("mid", event)}
                  onPointerUp={(event) => stopSegmentAutomationHandleDrag("mid", event)}
                  onPointerCancel={() => setDraggedSegmentAutomationEdge(null)}
                >
                  M
                </button>
                <button
                  type="button"
                  classList={{
                    [styles.automationHandleButton]: true,
                    [styles.automationHandleButtonActive]: draggedSegmentAutomationEdge() === "end",
                  }}
                  style={{
                    left: `${normalizeAetherNoteAutomationValue(activeSegmentAutomationTarget(), segmentAutomationRange().endValue) * 100}%`,
                  }}
                  data-aether-segment-automation-handle="end"
                  aria-label={`Drag end ${aetherArrangementAutomationTargetLabel(activeSegmentAutomationTarget())} value`}
                  onPointerDown={(event) => startSegmentAutomationHandleDrag("end", event)}
                  onPointerMove={(event) => draggedSegmentAutomationEdge() === "end" && updateSegmentAutomationHandleDrag("end", event)}
                  onPointerUp={(event) => stopSegmentAutomationHandleDrag("end", event)}
                  onPointerCancel={() => setDraggedSegmentAutomationEdge(null)}
                >
                  E
                </button>
              </div>
              <div class={styles.automationPointEditor} aria-label="Aether segment automation points">
                <div class={styles.automationPointHeader}>
                  <span>Points</span>
                  <div class={styles.automationPointTools}>
                    <Button size="xs" disabled={activeSegmentAutomationPoints().length === 0} onClick={quantizeSegmentAutomationLanePoints}>
                      Quantize
                    </Button>
                    <Button size="xs" disabled={activeSegmentAutomationPoints().length === 0} onClick={snapSegmentAutomationLaneValues}>
                      Snap values
                    </Button>
                    <Button size="xs" disabled={activeSegmentAutomationPoints().length === 0} onClick={copySegmentAutomationLanePoints}>
                      Copy
                    </Button>
                    <Button
                      size="xs"
                      disabled={segmentAutomationPointClipboard()?.target !== activeSegmentAutomationTarget()}
                      onClick={pasteSegmentAutomationLanePoints}
                    >
                      Paste
                    </Button>
                    <Button size="xs" onClick={addSegmentAutomationPoint}>Add point</Button>
                  </div>
                </div>
                <For each={activeSegmentAutomationPoints()}>
                  {(point, index) => (
                    <div
                      classList={{
                        [styles.automationPointRow]: true,
                        [styles.automationPointRowSelected]: activeSelectedSegmentAutomationPointIndices().includes(index()),
                      }}
                    >
                      <input
                        class={styles.automationPointSelect}
                        type="checkbox"
                        checked={activeSelectedSegmentAutomationPointIndices().includes(index())}
                        readOnly
                        aria-label={`Select segment automation point ${index() + 1}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSegmentAutomationPointSelection(index());
                        }}
                      />
                      <span class={styles.automationPointIndex}>{index() + 1}</span>
                      <label>
                        <span>Beat</span>
                        <input
                          type="number"
                          min={0}
                          max={draft()!.lengthBeats}
                          step={0.125}
                          value={point.beat}
                          onChange={(event) => setSegmentAutomationPointBeat(index(), event.currentTarget.value)}
                        />
                      </label>
                      <label>
                        <span>Value</span>
                        <input
                          type="number"
                          min={activeSegmentAutomationMeta().min}
                          max={activeSegmentAutomationMeta().max}
                          step={activeSegmentAutomationMeta().step}
                          value={point.value}
                          onChange={(event) => setSegmentAutomationPointValue(index(), event.currentTarget.value)}
                        />
                      </label>
                      <span class={styles.automationPointValue}>
                        {formatAetherArrangementAutomationValue(activeSegmentAutomationTarget(), point.value)}
                      </span>
                      <Button size="xs" variant="ghost" onClick={() => deleteSegmentAutomationPoint(index())}>
                        Remove
                      </Button>
                    </div>
                  )}
                </For>
              </div>
            </div>
            )}
          </>
        </Show>

        <Show when={drumPayload()}>
          {(payload) => (
            <DrumSequencer
              rows={payload().rows}
              stepCount={payload().stepCount}
              speed={payload().speed ?? 1}
              defaultPitchHz={payload().defaultPitchHz}
              swingPercent={payload().swingPercent ?? 50}
              lengthBeats={draft()!.lengthBeats}
              bpm={bpm()}
              timeSignature={timeSignature()}
              segmentTimeSignature={payload().timeSignature ?? timeSignature()}
              instruments={instruments()}
              hotkeyScopeId={scopeId()}
              onChange={updateDrumRows}
              onResize={resizeDrum}
              onGenerateBeat={applyGeneratedDrumBeat}
              onTrainingSessionChange={setDrumTrainingSessionId}
              onDefaultPitchChange={updateDrumDefaultPitch}
              onSwingChange={updateDrumSwing}
              onSpeedChange={updateDrumSpeed}
              onTimeSignatureChange={updateDrumTimeSignature}
              onUploadRow={uploadDrumRow}
            />
          )}
        </Show>

        <Show when={audioPayload()}>
          {(payload) => (
          <div class={styles.audioPanel}>
            <TextInput
              label="Name"
              layout="inline"
              value={draft()?.name ?? ""}
              placeholder="Audio segment"
              onInput={(event) => setDraft((current) => current ? { ...current, name: event.currentTarget.value } : current)}
            />
            <div class={styles.audioLabel}>Audio source</div>
            <p class={styles.audioHint}>
              {payload().audioFileId
                ? payload().audioFileId
                : "(no file attached - use 'Import Audio' from the track menu)"}
            </p>
          </div>
          )}
        </Show>
      </Modal>
    </Show>
  );
}

const fallbackInstrument: Instrument = {
  id: "preview-fallback",
  name: "Preview",
  kind: "synth",
  envelope: { attackMs: 5, decayMs: 100, sustain: 0.7, releaseMs: 200 },
  knobs: { cutoff: 0.75, resonance: 0, drive: 0, color: 0.5 },
  waveform: "saw",
  detuneCents: 0,
  octave: 0,
  subOscLevel: 0,
  glideMs: 0,
  sampleIds: [],
  userCreated: false,
};

function sampleName(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "").trim() || "Sample";
}

function drumPayloadFromSegment(segment: Segment): GeneratedDrumBeat | undefined {
  if (segment.payload.kind !== "drum") return undefined;
  return {
    rows: structuredClone(segment.payload.rows),
    stepCount: segment.payload.stepCount,
    lengthBeats: segment.lengthBeats,
    speed: segment.payload.speed,
    swingPercent: segment.payload.swingPercent ?? 50,
    defaultPitchHz: segment.payload.defaultPitchHz,
    source: "local",
  };
}

function segmentIcon(kind: Segment["payload"]["kind"]): string {
  if (kind === "audio") return "ph:waveform";
  if (kind === "drum") return "ph:music-notes-simple";
  return "ph:piano-keys";
}

function formatTimeSignature(timeSignature: TimeSignature): string {
  return `${timeSignature.num}/${timeSignature.denom}`;
}

function parseTimeSignature(value: string): TimeSignature {
  const [numRaw, denomRaw] = value.split("/");
  return {
    num: Math.max(1, Math.min(16, Number(numRaw) || 4)),
    denom: Number(denomRaw) === 8 ? 8 : 4,
    boldBeats: [1],
  };
}

const TIME_SIGNATURE_OPTIONS = ["4/4", "3/4", "6/8", "5/4", "7/8", "12/8"] as const;

function prepareSegmentForSave(segment: Segment): Segment {
  if (segment.payload.kind !== "midi" && segment.payload.kind !== "mixed") return segment;
  const lengthBeats = Math.max(1, Math.round(segment.lengthBeats));
  const payload = {
    ...segment.payload,
    notes: clipMidiNotesToLength(segment.payload.notes, lengthBeats),
  };
  return { ...segment, lengthBeats, automation: clipSegmentAutomation(segment.automation, lengthBeats), payload };
}

function clipMidiNotesToLength(notes: MidiNote[], lengthBeats: number): MidiNote[] {
  return notes.flatMap((note) => {
    const startBeat = Math.max(0, note.startBeat);
    const endBeat = Math.min(lengthBeats, note.startBeat + note.lengthBeats);
    if (startBeat >= lengthBeats || endBeat - startBeat <= 0.000001) return [];
    const clipped: MidiNote = {
      ...note,
      startBeat,
      lengthBeats: Math.max(0.03125, endBeat - startBeat),
      curve: clipNoteCurve(note, startBeat, endBeat),
      automation: note.automation?.map((lane) => ({
        ...lane,
        points: lane.points
          .filter((point) => point.beat >= startBeat && point.beat <= endBeat)
          .map((point) => ({ ...point })),
      })),
    };
    return [clipped];
  });
}

function clipNoteCurve(note: MidiNote, startBeat: number, endBeat: number): MidiNote["curve"] {
  if (!note.curve || note.curve.length < 2) return note.curve;
  const points = note.curve
    .filter((point) => point.beat >= startBeat && point.beat <= endBeat)
    .map((point) => ({ ...point }));
  if (points.length >= 2) return points;
  return [
    { beat: startBeat, pitch: note.pitch },
    { beat: endBeat, pitch: note.pitch },
  ];
}

function midiSegmentGainDb(payload: Segment["payload"]): number {
  if (payload.kind === "midi" || payload.kind === "mixed") return payload.gainDb ?? 0;
  return 0;
}

function gainDbToVolumePercent(gainDb: number): number {
  const gain = Math.pow(10, Math.max(-96, Math.min(24, gainDb)) / 20);
  return Math.max(0, Math.min(100, Math.round(gain * 100)));
}

function volumePercentToGainDb(percent: number): number {
  const gain = Math.max(0, Math.min(100, percent)) / 100;
  if (gain <= 0) return -96;
  return Math.max(-96, Math.min(0, 20 * Math.log10(gain)));
}

function applyGainToVelocity(velocity: number, gainDb: number): number {
  const gain = Math.pow(10, Math.max(-96, Math.min(24, gainDb)) / 20);
  return Math.max(0, Math.min(127, velocity * gain));
}
