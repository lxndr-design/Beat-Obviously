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
import { Button, Checkbox, FloatingSelect, Icon, Modal, NumberInput, Slider, TextInput } from "../../solid-ui";
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
import {
  MIDI_LIVE_MIN_LENGTH_BEATS,
  composeLiveMidiNotes,
  eraseMidiNotesOverlappingSweep,
  makeLiveMidiNote,
  sortedMidiNotes,
  type MidiLiveHeldKey,
} from "./midiLiveRecording";
import styles from "./SegmentEditorModal.module.css";

export interface SegmentEditorModalProps {
  segmentId: string;
  discardIfUntouched?: boolean;
}

type MidiLikePayload = Extract<Segment["payload"], { kind: "midi" | "mixed" }>;
type DrumPayload = Extract<Segment["payload"], { kind: "drum" }>;
type AudioPayload = Extract<Segment["payload"], { kind: "audio" }>;

// Keep the default MIDI modal focused on piano-roll editing. Aether arrangement
// automation needs a separate opt-in surface instead of living under every MIDI clip.
const SHOW_SEGMENT_AUTOMATION_PANEL = false;
const MIDI_LIVE_BASE_BPM = 120;
const MIDI_LIVE_KEY_MAP: Record<string, number> = {
  a: 60,
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72,
  o: 73,
  l: 74,
  p: 75,
};
const MIDI_LIVE_WHITE_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l"] as const;
const MIDI_LIVE_BLACK_KEYS = ["w", "e", "", "t", "y", "u", "", "o", "p"] as const;

export function SegmentEditorModal(props: SegmentEditorModalProps) {
  const source = createStoreSelector(useProjectStore, () => selectSegment(props.segmentId));
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const positionBeat = createStoreSelector(useTransportStore, (s) => s.positionBeat);
  const playing = createStoreSelector(useTransportStore, (s) => s.playing);
  const timeSignature = createStoreSelector(useProjectStore, (s) => s.project.timeSignature);
  const bpm = createStoreSelector(useProjectStore, (s) => s.project.bpm);
  const updateSegment = useProjectStore.getState().updateSegment;
  const removeSegment = useProjectStore.getState().removeSegment;
  const closeEditor = useUiStore.getState().closeEditor;
  const setSelectedSegments = useUiStore.getState().setSelectedSegments;
  const requestDirtyClose = useModalStack.getState().requestDirtyClose;
  const addInstrument = useInstrumentStore.getState().addInstrument;
  const addAudioFile = useAudioFileStore.getState().addFile;
  const scopeId = () => `segment-${props.segmentId}`;
  const [draft, setDraftInternal] = createSignal<Segment | undefined>(source() ? structuredClone(source()) : undefined, { equals: false });
  const [touched, setTouched] = createSignal(false);
  const [instrumentSelectOpen, setInstrumentSelectOpen] = createSignal(false);
  const [segmentAutomationCurveOpen, setSegmentAutomationCurveOpen] = createSignal(false);
  const [activeSegmentAutomationTarget, setActiveSegmentAutomationTarget] = createSignal<AetherArrangementAutomationTarget>("macro.1");
  const [draggedSegmentAutomationEdge, setDraggedSegmentAutomationEdge] = createSignal<"start" | "mid" | "end" | null>(null);
  const [segmentAutomationPointClipboard, setSegmentAutomationPointClipboard] = createSignal<AetherArrangementAutomationPointClipboard | null>(null);
  const [selectedSegmentAutomationPointIndices, setSelectedSegmentAutomationPointIndices] = createSignal<number[]>([]);
  const [midiPreviewBeat, setMidiPreviewBeat] = createSignal<number | null>(null);
  const [midiLiveRecording, setMidiLiveRecording] = createSignal(false);
  const [midiLiveMode, setMidiLiveMode] = createSignal<"overwrite" | "additive">("additive");
  const [midiLiveStartedAtMs, setMidiLiveStartedAtMs] = createSignal<number | null>(null);
  const [midiLiveElapsedMs, setMidiLiveElapsedMs] = createSignal(0);
  const [midiLiveHeldKeys, setMidiLiveHeldKeys] = createSignal<Record<string, MidiLiveHeldKey>>({});
  const [midiLiveSourceNotes, setMidiLiveSourceNotes] = createSignal<MidiNote[] | null>(null);
  const [midiLiveCommittedNotes, setMidiLiveCommittedNotes] = createSignal<MidiNote[]>([]);
  const [midiLiveOverwriteSweepBeat, setMidiLiveOverwriteSweepBeat] = createSignal(0);
  const [drumTrainingSessionId, setDrumTrainingSessionId] = createSignal<string | null>(null);
  let previewCtx: AudioContext | null = null;
  let midiLiveRaf: number | null = null;

  function markTouched() {
    if (props.discardIfUntouched) setTouched(true);
  }

  function setDraft(next: Segment | undefined | ((current: Segment | undefined) => Segment | undefined)) {
    markTouched();
    setDraftInternal(next as Segment | undefined);
  }

  createEffect(() => {
    const currentSource = source();
    if (currentSource && !draft()) setDraftInternal(structuredClone(currentSource));
  });

  onCleanup(() => {
    if (previewCtx) void previewCtx.close();
    if (midiLiveRaf) cancelAnimationFrame(midiLiveRaf);
  });

  const dirty = createMemo(() => Boolean(source() && draft() && JSON.stringify(source()) !== JSON.stringify(draft())));
  const isMidi = createMemo(() => draft()?.payload.kind === "midi" || draft()?.payload.kind === "mixed");
  const drumPayload = createMemo<DrumPayload | null>(() => draft()?.payload.kind === "drum" ? draft()!.payload as DrumPayload : null);
  const audioPayload = createMemo<AudioPayload | null>(() => draft()?.payload.kind === "audio" ? draft()!.payload as AudioPayload : null);
  const midiNotes = createMemo<MidiNote[]>(() => isMidi() ? (draft()?.payload as MidiLikePayload).notes : []);
  const transpose = createMemo(() => draft()?.transpose ?? 0);
  const midiGainDb = createMemo(() => draft() ? midiSegmentGainDb(draft()!.payload) : 0);
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
  const liveMidiNotes = createMemo(() => {
    if (!midiLiveRecording()) return midiNotes();
    return composeLiveMidiNotes({
      sourceNotes: midiLiveSourceNotes() ?? midiNotes(),
      committedNotes: midiLiveCommittedNotes(),
      heldKeys: midiLiveHeldKeys(),
      currentBeat: midiPreviewBeat() ?? 0,
    });
  });
  const previewMidiNotes = createMemo(() => liveMidiNotes().map((note) => ({
    ...note,
    pitch: Math.max(0, Math.min(127, note.pitch + transpose())),
    curve: note.curve?.map((point) => ({ ...point, pitch: Math.max(0, Math.min(127, point.pitch + transpose())) })),
  })));
  const editorTitle = createMemo(() => {
    const currentDraft = draft();
    if (!currentDraft) return "Segment";
    return `${segmentTypeTitle(currentDraft.payload.kind)}${dirty() ? " *" : ""}`;
  });
  const globalPlayheadBeat = createMemo(() => {
    const currentDraft = draft();
    if (!currentDraft || !playing()) return null;
    const position = positionBeat();
    return position >= currentDraft.startBeat && position <= currentDraft.startBeat + currentDraft.lengthBeats
      ? position - currentDraft.startBeat
      : null;
  });
  const playheadBeat = createMemo(() => midiPreviewBeat() ?? globalPlayheadBeat());
  const midiLiveElapsedLabel = createMemo(() => `${(midiLiveElapsedMs() / 1000).toFixed(2)}s`);
  const midiLiveActiveKeys = createMemo(() => new Set(Object.keys(midiLiveHeldKeys())));

  createEffect(() => {
    if (!isMidi()) return;
    window.addEventListener("keydown", handleMidiLiveKeyDown, true);
    window.addEventListener("keyup", handleMidiLiveKeyUp, true);
    onCleanup(() => {
      window.removeEventListener("keydown", handleMidiLiveKeyDown, true);
      window.removeEventListener("keyup", handleMidiLiveKeyUp, true);
    });
  });

  createEffect(() => {
    if (!midiLiveRecording()) {
      if (midiLiveRaf) cancelAnimationFrame(midiLiveRaf);
      midiLiveRaf = null;
      return;
    }

    const tick = () => {
      const now = performance.now();
      const startedAt = midiLiveStartedAtMs();
      if (startedAt != null) setMidiLiveElapsedMs(now - startedAt);
      const beat = currentMidiLiveBeat(now);
      ensureMidiLiveLengthForBeat(beat);
      sweepMidiLiveOverwriteToBeat(beat);
      setMidiPreviewBeat(beat);
      midiLiveRaf = requestAnimationFrame(tick);
    };

    midiLiveRaf = requestAnimationFrame(tick);
    onCleanup(() => {
      if (midiLiveRaf) cancelAnimationFrame(midiLiveRaf);
      midiLiveRaf = null;
    });
  });

  function closeEditorOnly() {
    closeEditor({ kind: "segment", segmentId: props.segmentId });
  }

  function close() {
    if (props.discardIfUntouched && !touched()) {
      removeSegment(props.segmentId);
      setSelectedSegments([]);
    }
    closeEditorOnly();
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
    closeEditorOnly();
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

  function currentMidiLiveBeat(nowMs = performance.now()) {
    const startedAt = midiLiveStartedAtMs();
    if (startedAt == null) return 0;
    const beatsPerSecond = (bpm() || MIDI_LIVE_BASE_BPM) / 60;
    return Math.max(0, ((nowMs - startedAt) / 1000) * beatsPerSecond);
  }

  function ensureMidiLiveLengthForBeat(beat: number) {
    const current = draft();
    if (!current || (current.payload.kind !== "midi" && current.payload.kind !== "mixed")) return;
    if (beat <= current.lengthBeats - MIDI_LIVE_MIN_LENGTH_BEATS) return;
    const nextLength = Math.ceil((beat + MIDI_LIVE_MIN_LENGTH_BEATS) * 4) / 4;
    setDraft({ ...current, lengthBeats: Math.max(current.lengthBeats, nextLength) });
  }

  function sweepMidiLiveOverwriteToBeat(beat: number) {
    if (midiLiveMode() !== "overwrite") return;
    const previousBeat = midiLiveOverwriteSweepBeat();
    if (beat <= previousBeat) return;
    setMidiLiveSourceNotes((sourceNotes) => eraseMidiNotesOverlappingSweep(sourceNotes ?? midiNotes(), previousBeat, beat));
    setMidiLiveOverwriteSweepBeat(beat);
  }

  function finalMidiLiveNotes(nowMs = performance.now()) {
    const held = midiLiveHeldKeys();
    const entries = Object.entries(held);
    const endBeat = currentMidiLiveBeat(nowMs);
    ensureMidiLiveLengthForBeat(endBeat);
    sweepMidiLiveOverwriteToBeat(endBeat);
    const heldNotes = entries.map(([, heldKey]) => makeLiveMidiNote(heldKey.pitch, heldKey.startBeat, endBeat));
    return composeLiveMidiNotes({
      sourceNotes: midiLiveSourceNotes() ?? midiNotes(),
      committedNotes: [...midiLiveCommittedNotes(), ...heldNotes],
      heldKeys: {},
      currentBeat: endBeat,
    });
  }

  function clearMidiLiveSession() {
    setMidiLiveHeldKeys({});
    setMidiLiveSourceNotes(null);
    setMidiLiveCommittedNotes([]);
    setMidiLiveOverwriteSweepBeat(0);
  }

  function startMidiLiveRecording() {
    if (!isMidi()) return;
    const now = performance.now();
    clearMidiLiveSession();
    setMidiLiveSourceNotes(structuredClone(midiNotes()));
    setMidiLiveStartedAtMs(now);
    setMidiLiveElapsedMs(0);
    setMidiPreviewBeat(0);
    setMidiLiveRecording(true);
  }

  function stopMidiLiveRecording() {
    updateMidi(finalMidiLiveNotes());
    setMidiLiveRecording(false);
    setMidiLiveStartedAtMs(null);
    setMidiPreviewBeat(null);
    clearMidiLiveSession();
  }

  function toggleMidiLiveRecording() {
    if (midiLiveRecording()) stopMidiLiveRecording();
    else startMidiLiveRecording();
  }

  function handleMidiLiveKeyDown(event: KeyboardEvent) {
    if (!isMidi() || !midiLiveRecording() || isEditableEventTarget(event.target)) return;
    const key = event.key.toLowerCase();
    const pitch = MIDI_LIVE_KEY_MAP[key];
    if (pitch == null || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const startBeat = currentMidiLiveBeat();
    ensureMidiLiveLengthForBeat(startBeat);
    sweepMidiLiveOverwriteToBeat(startBeat);
    setMidiPreviewBeat(startBeat);
    setMidiLiveHeldKeys((held) => {
      if (held[key]) return held;
      return { ...held, [key]: { pitch, startBeat, startedAtMs: performance.now() } };
    });
    previewNote(pitch, 112);
  }

  function handleMidiLiveKeyUp(event: KeyboardEvent) {
    if (!isMidi() || !midiLiveRecording() || isEditableEventTarget(event.target)) return;
    const key = event.key.toLowerCase();
    const heldKey = midiLiveHeldKeys()[key];
    if (!heldKey) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const endBeat = currentMidiLiveBeat();
    ensureMidiLiveLengthForBeat(endBeat);
    sweepMidiLiveOverwriteToBeat(endBeat);
    setMidiPreviewBeat(endBeat);
    const note = makeLiveMidiNote(heldKey.pitch, heldKey.startBeat, endBeat);
    setMidiLiveCommittedNotes((notes) => sortedMidiNotes([...notes, note]));
    setMidiLiveHeldKeys((held) => {
      const next = { ...held };
      delete next[key];
      return next;
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
        title={<><Icon name={segmentIcon(draft()!.payload.kind)} size={18} decorative />{editorTitle()}</>}
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
            <div class={styles.midiTopFields}>
              <TextInput
                label="Name"
                layout="inline"
                value={draft()?.name ?? ""}
                placeholder="Trackname"
                onInput={(event) => setDraft((current) => current ? { ...current, name: event.currentTarget.value } : current)}
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
                searchable
                searchPlaceholder="Search instruments"
                open={instrumentSelectOpen()}
                onOpenChange={setInstrumentSelectOpen}
                onChange={(instrumentId) =>
                  setDraft((current) => current ? { ...current, instrumentId: instrumentId || undefined } : current)
                }
              />
            </div>
            <div class={styles.midiLivePanel} aria-label="Live MIDI keyboard recording">
              <div class={styles.midiLiveTransport}>
                <div class={styles.transportSlot}>
                  <MidiTransport
                    notes={previewMidiNotes()}
                    gainDb={midiGainDb()}
                    lengthBeats={draft()!.lengthBeats}
                    bpm={bpm()}
                    instrument={instruments().find((instrument) => instrument.id === draft()!.instrumentId)}
                    hotkeyScopeId={scopeId()}
                    captureSpaceKey
                    onPositionChange={setMidiPreviewBeat}
                  />
                </div>
                <Button
                  size="xs"
                  variant={midiLiveRecording() ? "primary" : "default"}
                  onClick={toggleMidiLiveRecording}
                >
                  <Icon name={midiLiveRecording() ? "ph:stop-fill" : "ph:record-fill"} size={18} decorative />
                  Record
                </Button>
                <Button
                  size="xs"
                  selected={midiLiveMode() === "overwrite"}
                  disabled={midiLiveRecording()}
                  onClick={() => setMidiLiveMode("overwrite")}
                >
                  Overwrite
                </Button>
                <Button
                  size="xs"
                  selected={midiLiveMode() === "additive"}
                  disabled={midiLiveRecording()}
                  onClick={() => setMidiLiveMode("additive")}
                >
                  Additive
                </Button>
                <span class={styles.midiLiveTime}>{midiLiveElapsedLabel()}</span>
              </div>
              <Show when={midiLiveRecording()}>
                <div class={styles.midiLiveKeyboard} aria-label="Computer keyboard MIDI map">
                  <div class={styles.midiLiveKeyboardRow} data-row="black">
                    <For each={MIDI_LIVE_BLACK_KEYS}>
                      {(key) => key
                        ? (
                          <span
                            classList={{
                              [styles.midiLiveKey]: true,
                              [styles.midiLiveBlackKey]: true,
                              [styles.midiLiveKeyActive]: midiLiveActiveKeys().has(key),
                            }}
                          >
                            <span>{key.toUpperCase()}</span>
                            <span>{midiPitchName(MIDI_LIVE_KEY_MAP[key])}</span>
                          </span>
                        )
                        : <span class={styles.midiLiveKeySpacer} />}
                    </For>
                  </div>
                  <div class={styles.midiLiveKeyboardRow} data-row="white">
                    <For each={MIDI_LIVE_WHITE_KEYS}>
                      {(key) => (
                        <span
                          classList={{
                            [styles.midiLiveKey]: true,
                            [styles.midiLiveKeyActive]: midiLiveActiveKeys().has(key),
                          }}
                        >
                          <span>{key.toUpperCase()}</span>
                          <span>{midiPitchName(MIDI_LIVE_KEY_MAP[key])}</span>
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>

            <PianoRoll
              notes={liveMidiNotes()}
              instrument={instruments().find((instrument) => instrument.id === draft()!.instrumentId)}
              lengthBeats={draft()!.lengthBeats}
              playheadBeat={playheadBeat()}
              hotkeyScopeId={scopeId()}
              showAutomation={false}
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
                <Slider layout="inline" label="Start" min={activeSegmentAutomationMeta().min} max={activeSegmentAutomationMeta().max} step={activeSegmentAutomationMeta().step} value={segmentAutomationRange().startValue} readout={formatAetherArrangementAutomationValue(activeSegmentAutomationTarget(), segmentAutomationRange().startValue)} onChange={(value) => setSegmentAutomationValueEdge("start", String(value))} />
                <Slider layout="inline" label="Mid" min={activeSegmentAutomationMeta().min} max={activeSegmentAutomationMeta().max} step={activeSegmentAutomationMeta().step} value={segmentAutomationRange().midValue} readout={formatAetherArrangementAutomationValue(activeSegmentAutomationTarget(), segmentAutomationRange().midValue)} onChange={(value) => setSegmentAutomationValueEdge("mid", String(value))} />
                <Slider layout="inline" label="End" min={activeSegmentAutomationMeta().min} max={activeSegmentAutomationMeta().max} step={activeSegmentAutomationMeta().step} value={segmentAutomationRange().endValue} readout={formatAetherArrangementAutomationValue(activeSegmentAutomationTarget(), segmentAutomationRange().endValue)} onChange={(value) => setSegmentAutomationValueEdge("end", String(value))} />
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
                      <Checkbox
                        inputClassName={styles.automationPointSelect}
                        checked={activeSelectedSegmentAutomationPointIndices().includes(index())}
                        readOnly
                        aria-label={`Select segment automation point ${index() + 1}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSegmentAutomationPointSelection(index());
                        }}
                      />
                      <span class={styles.automationPointIndex}>{index() + 1}</span>
                      <NumberInput layout="inline" label="Beat" min={0} max={draft()!.lengthBeats} step={0.125} value={point.beat} onChange={(value) => setSegmentAutomationPointBeat(index(), String(value))} />
                      <NumberInput layout="inline" label="Value" min={activeSegmentAutomationMeta().min} max={activeSegmentAutomationMeta().max} step={activeSegmentAutomationMeta().step} value={point.value} onChange={(value) => setSegmentAutomationPointValue(index(), String(value))} />
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
  if (kind === "drumpad") return "ph:keyboard";
  return "ph:piano-keys";
}

function segmentTypeTitle(kind: Segment["payload"]["kind"]): string {
  if (kind === "audio") return "WAV Segment";
  if (kind === "drum") return "Drum Sequencer";
  if (kind === "drumpad") return "Drum Pad";
  return "MIDI Segment";
}

const MIDI_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

function midiPitchName(pitch: number): string {
  const name = MIDI_NOTE_NAMES[((pitch % 12) + 12) % 12];
  const octave = Math.floor(pitch / 12) - 1;
  return `${name}${octave}`;
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

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

function applyGainToVelocity(velocity: number, gainDb: number): number {
  const gain = Math.pow(10, Math.max(-96, Math.min(24, gainDb)) / 20);
  return Math.max(0, Math.min(127, velocity * gain));
}
