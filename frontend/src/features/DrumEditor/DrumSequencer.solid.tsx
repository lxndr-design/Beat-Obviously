import { createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Button, FloatingLayer, FloatingSelect, HoverInfo, Icon, NumberInput, RadioGroup, TextInput } from "../../solid-ui";
import { ai } from "../../ai/aiService";
import { DRUM_COMPLEXITY_DEFAULT, DRUM_GENRES, DRUM_MAX_STEPS, type DrumGenre, type GeneratedDrumBeat } from "../../ai/drumBeatGenerator";
import { maybeRunDueTraining } from "../../ai/trainingRunner";
import { createInstrumentBufferSource, noteFrequency, preloadInstrumentSample } from "../../audio/synthPreview";
import { useContextualHotkey } from "../../solid-utils/contextualHotkeys.solid";
import { listDrumBeatFeedback, saveDrumBeatFeedback } from "../../persistence/dexie";
import { TimeSignatureControl } from "../Transport/TimeSignatureControl.solid";
import {
  DEFAULT_DRUM_MIDI_PITCH,
  DEFAULT_DRUM_VELOCITY,
  drumPlaybackDurationSeconds,
  drumPlaybackStepLengthBeats,
  drumTimingOffsetBeats,
  effectiveDrumVelocity,
  formatFrequency,
  frequencyToNoteName,
  hasCustomDrumVelocity,
  normalizeDrumCell,
  normalizeDrumSteps,
  parsePitchInput,
  sanitizeLeanPercent,
  sanitizeSwingPercent,
  sanitizeVelocity,
} from "../../state/drumSteps";
import type { DrumCell, DrumRow, DrumSpeed, Instrument, TimeSignature } from "../../state/types";
import styles from "./DrumSequencer.module.css";

interface Props {
  rows: DrumRow[];
  stepCount: number;
  speed: DrumSpeed;
  lengthBeats: number;
  defaultPitchHz?: number;
  swingPercent?: number;
  bpm: number;
  timeSignature: TimeSignature;
  segmentTimeSignature?: TimeSignature;
  instruments: Instrument[];
  hotkeyScopeId?: string;
  onChange: (rows: DrumRow[]) => void;
  onResize: (lengthBeats: number, rows: DrumRow[]) => void;
  onGenerateBeat?: (beat: GeneratedDrumBeat) => void;
  onTrainingSessionChange?: (id: string | null) => void;
  onDefaultPitchChange?: (frequencyHz: number | undefined) => void;
  onSwingChange?: (swingPercent: number) => void;
  onSpeedChange: (speed: DrumSpeed) => void;
  onTimeSignatureChange?: (timeSignature: TimeSignature) => void;
  onUploadRow?: () => void;
}

interface CellMenuState {
  x: number;
  y: number;
  rowId: string;
  step: number;
}

interface PitchPopoverState extends CellMenuState {
  value: string;
  error: boolean;
}

interface VolumePopoverState extends CellMenuState {
  value: string;
  error: boolean;
}

interface LeanPopoverState extends CellMenuState {
  value: string;
  error: boolean;
}

interface FeedbackPopoverState {
  x: number;
  y: number;
  value: string;
}

interface CopiedCell {
  rowOffset: number;
  stepOffset: number;
  cell: DrumCell;
}

interface CopiedCells {
  cells: CopiedCell[];
}

function createRef<T>(initial: T) {
  return { current: initial };
}

function createCompatEffect(effect: () => void | (() => void), _deps?: unknown[]) {
  createEffect(() => {
    const cleanup = effect();
    if (cleanup) onCleanup(cleanup);
  });
}

function createPortal(children: JSX.Element, mount: HTMLElement) {
  return <Portal mount={mount}>{children}</Portal>;
}

function px(value: number): string {
  return `${value}px`;
}

export function DrumSequencer(props: Props) {
  const [playing, setPlaying] = createSignal(false);
  const [playStep, setPlayStep] = createSignal<number | null>(null);
  const [selectedCells, setSelectedCells] = createSignal<Set<string>>(new Set(), { equals: false });
  const [openRowId, setOpenRowId] = createSignal<string | null>(null);
  const [generateGenre, setGenerateGenre] = createSignal<DrumGenre>("rock");
  const [generateGenreOpen, setGenerateGenreOpen] = createSignal(false);
  const [generateComplexity, setGenerateComplexity] = createSignal(DRUM_COMPLEXITY_DEFAULT);
  const [generating, setGenerating] = createSignal(false);
  const [lastGeneratedBeat, setLastGeneratedBeat] = createSignal<GeneratedDrumBeat | null>(null);
  const [feedbackRating, setFeedbackRating] = createSignal<"up" | "down" | null>(null);
  const [feedbackId, setFeedbackId] = createSignal<string | null>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = createSignal<"up" | "down" | null>(null);
  const [feedbackPopover, setFeedbackPopover] = createSignal<FeedbackPopoverState | null>(null);
  const [cellMenu, setCellMenu] = createSignal<CellMenuState | null>(null);
  const [pitchPopover, setPitchPopover] = createSignal<PitchPopoverState | null>(null);
  const [volumePopover, setVolumePopover] = createSignal<VolumePopoverState | null>(null);
  const [leanPopover, setLeanPopover] = createSignal<LeanPopoverState | null>(null);
  const [cellSize, setCellSize] = createSignal(DEFAULT_CELL_SIZE);
  const wrapRef = createRef<HTMLDivElement | null>(null);
  const rowsRef = createRef(props.rows);
  const instrumentsRef = createRef(props.instruments);
  const defaultPitchRef = createRef(props.defaultPitchHz);
  const ctxRef = createRef<AudioContext | null>(null);
  const rafRef = createRef<number | null>(null);
  const scheduledRef = createRef<Set<string>>(new Set());
  const activeSourcesRef = createRef<Set<AudioBufferSourceNode>>(new Set());
  const activeGainsRef = createRef<Set<GainNode>>(new Set());
  const loopStartTimeRef = createRef(0);
  const stepRef = createRef(0);
  const dragRef = createRef<{ pointerId: number; setOn: boolean; touched: Set<string> } | null>(null);
  const volumeDragRef = createRef<{ rowId: string; step: number; pointerId: number; rect: DOMRect } | null>(null);
  const cellClipboardRef = createRef<CopiedCells | null>(null);

  const swingPercent = () => props.swingPercent ?? 50;

  createEffect(() => {
    rowsRef.current = props.rows;
    instrumentsRef.current = props.instruments;
    defaultPitchRef.current = props.defaultPitchHz;
  });

  useContextualHotkey(
    () => props.hotkeyScopeId ?? "",
    "space",
    () => {
      if (playing()) stop();
      else play();
    },
    () => Boolean(props.hotkeyScopeId),
  );

  createCompatEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopDrumPreviewAudio();
      if (ctxRef.current) void ctxRef.current.close();
    },
    [],
  );

  createCompatEffect(() => {
    function resetZoom(e: globalThis.KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "0") return;
      const active = document.activeElement;
      if (active && wrapRef.current && !wrapRef.current.contains(active)) return;
      e.preventDefault();
      setCellSize(DEFAULT_CELL_SIZE);
    }
    window.addEventListener("keydown", resetZoom);
    return () => window.removeEventListener("keydown", resetZoom);
  }, []);

  createCompatEffect(() => {
    if (!playing()) return;
    restartPlaybackClock();
  }, [props.stepCount, props.lengthBeats, props.bpm, props.speed, swingPercent]);

  createCompatEffect(() => {
    const ctx = getCtx();
    for (const instrument of props.instruments) {
      if (!instrument.sampleUrl) continue;
      void preloadInstrumentSample(ctx, instrument).catch(() => {
        // Falling back to synthesized preview keeps playback resilient.
      });
    }
  }, [props.instruments]);

  createCompatEffect(() => {
    function closeFloating(e: MouseEvent) {
      const target = e.target as Element | null;
      if (target?.closest("[data-floating-layer]")) return;
      setOpenRowId(null);
      setGenerateGenreOpen(false);
      setCellMenu(null);
      setPitchPopover(null);
      setVolumePopover(null);
      setLeanPopover(null);
      setFeedbackPopover(null);
    }
    function closeOnEscape(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpenRowId(null);
      setGenerateGenreOpen(false);
      setCellMenu(null);
      setPitchPopover(null);
      setVolumePopover(null);
      setLeanPopover(null);
      setFeedbackPopover(null);
    }
    window.addEventListener("mousedown", closeFloating);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeFloating);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function getCtx(): AudioContext {
    if (!ctxRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      ctxRef.current = new Ctor();
    }
    return ctxRef.current;
  }

  function play() {
    const ctx = getCtx();
    if (ctx.state === "suspended") void ctx.resume();
    stopDrumPreviewAudio();
    scheduledRef.current.clear();
    loopStartTimeRef.current = ctx.currentTime;
    stepRef.current = 0;
    setPlayStep(0);
    setPlaying(true);
  }

  function stop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    scheduledRef.current.clear();
    stopDrumPreviewAudio();
    setPlaying(false);
    setPlayStep(null);
  }

  function restartPlaybackClock() {
    const ctx = getCtx();
    stopDrumPreviewAudio();
    scheduledRef.current.clear();
    loopStartTimeRef.current = ctx.currentTime;
    stepRef.current = 0;
    setPlayStep(0);
  }

  function stopDrumPreviewAudio() {
    for (const source of activeSourcesRef.current) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    for (const gain of activeGainsRef.current) gain.disconnect();
    activeSourcesRef.current.clear();
    activeGainsRef.current.clear();
  }

  function scheduleStep(step: number, atTimeS: number, stepSeconds: number) {
    const stepLengthBeats = drumPlaybackStepLengthBeats(props.lengthBeats, props.stepCount, props.speed);
    const beatsPerSecond = props.bpm / 60;
    for (const row of rowsRef.current) {
      const cell = normalizeDrumCell(row.steps[step]);
      if (!cell.on) continue;
      const instrument =
        instrumentsRef.current.find((i) => i.id === row.instrumentId) ??
        instrumentsRef.current[0] ??
        fallbackInstrument;
      const hitTimeS = atTimeS + drumTimingOffsetBeats(step, stepLengthBeats, swingPercent(), cell.leanPercent) / beatsPerSecond;
      if (hitTimeS < getCtx().currentTime - 0.002) continue;
      playInstrument(
        instrument,
        cell.pitchHz ?? defaultPitchRef.current ?? noteFrequency(DEFAULT_DRUM_MIDI_PITCH, instrument),
        cell.velocity,
        hitTimeS,
        Math.max(0.05, Math.min(0.22, stepSeconds * 0.95)),
      );
    }
  }

  function playInstrument(instrument: Instrument, frequencyHz: number, velocity = DEFAULT_DRUM_VELOCITY, atTimeS: number, maxDuration = 0.22) {
    const ctx = getCtx();
    const source = createInstrumentBufferSource(ctx, instrument, 0.2, frequencyHz, undefined, velocity, props.bpm);
    const duration = source.buffer
      ? Math.max(0.05, Math.min(1.5, source.buffer.duration / source.playbackRate.value))
      : maxDuration;
    const gain = ctx.createGain();
    const peak = (Math.max(0, Math.min(127, velocity)) / 127) * 0.28;
    gain.gain.setValueAtTime(0, atTimeS);
    gain.gain.linearRampToValueAtTime(peak, atTimeS + 0.004);
    gain.gain.linearRampToValueAtTime(0, atTimeS + duration);
    gain.connect(ctx.destination);
    source.connect(gain);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
      activeGainsRef.current.delete(gain);
      source.disconnect();
      gain.disconnect();
    };
    activeSourcesRef.current.add(source);
    activeGainsRef.current.add(gain);
    source.start(atTimeS);
    source.stop(atTimeS + duration + 0.02);
  }

  createCompatEffect(() => {
    if (!playing()) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      scheduledRef.current.clear();
      return;
    }

    const ctx = getCtx();
    const tick = () => {
      const phraseSeconds = drumPlaybackDurationSeconds(props.lengthBeats, props.bpm, props.speed);
      const stepSeconds = Math.max(0.005, phraseSeconds / Math.max(1, props.stepCount));
      const stepLengthBeats = drumPlaybackStepLengthBeats(props.lengthBeats, props.stepCount, props.speed);
      const beatsPerSecond = props.bpm / 60;
      const now = ctx.currentTime;
      const elapsed = Math.max(0, now - loopStartTimeRef.current);
      const cycle = Math.floor(elapsed / phraseSeconds);
      const loopTime = elapsed - cycle * phraseSeconds;
      const visualStep = Math.min(props.stepCount - 1, Math.max(0, Math.floor(loopTime / stepSeconds)));

      if (visualStep !== stepRef.current) {
        stepRef.current = visualStep;
        setPlayStep(visualStep);
      }

      const horizon = now + DRUM_LOOKAHEAD_SECONDS;
      for (let scheduleCycle = cycle; scheduleCycle <= cycle + 1; scheduleCycle++) {
        for (let step = 0; step < props.stepCount; step++) {
          const atTimeS = loopStartTimeRef.current + scheduleCycle * phraseSeconds + step * stepSeconds;
          const earliestSwingTimeS = atTimeS + Math.min(0, drumTimingOffsetBeats(step, stepLengthBeats, swingPercent(), -50) / beatsPerSecond);
          if (earliestSwingTimeS > horizon) break;
          if (atTimeS < now - stepSeconds) continue;
          const key = `${scheduleCycle}:${step}`;
          if (scheduledRef.current.has(key)) continue;
          scheduledRef.current.add(key);
          scheduleStep(step, atTimeS, stepSeconds);
        }
      }

      for (const key of scheduledRef.current) {
        const scheduleCycle = Number(key.split(":")[0]);
        if (Number.isFinite(scheduleCycle) && scheduleCycle < cycle - 1) scheduledRef.current.delete(key);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing(), props.lengthBeats, props.speed, props.stepCount, props.bpm, swingPercent]);

  function updateRow(rowId: string, patch: Partial<DrumRow>) {
    props.onChange(props.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function updateCells(keys: Set<string>, updater: (cell: DrumCell) => DrumCell) {
    props.onChange(props.rows.map((row) => {
      if (!Array.from(keys).some((key) => key.startsWith(`${row.id}:`))) return row;
      const steps = normalizeDrumSteps(row.steps, props.stepCount).map((cell, step) => (
        keys.has(cellKey(row.id, step)) ? updater(cell) : cell
      ));
      return { ...row, steps };
    }));
  }

  function addRow() {
    const instrument = props.instruments.find((i) => !props.rows.some((row) => row.instrumentId === i.id)) ?? props.instruments[0];
    props.onChange([
      ...props.rows,
      {
        id: crypto.randomUUID(),
        instrumentId: instrument?.id,
        name: instrument?.name ?? `Row ${props.rows.length + 1}`,
        steps: Array.from({ length: props.stepCount }, () => false),
      },
    ]);
  }

  function removeRow(rowId: string) {
    props.onChange(props.rows.filter((row) => row.id !== rowId));
    setSelectedCells((prev) => new Set(Array.from(prev).filter((key) => !key.startsWith(`${rowId}:`))));
  }

  function resizeLength(nextLength: number) {
    const length = Math.max(1, Math.min(DRUM_MAX_STEPS, Math.round(nextLength)));
    const count = Math.max(1, Math.min(DRUM_MAX_STEPS, length));
    props.onResize(length, props.rows.map((row) => ({ ...row, steps: normalizeDrumSteps(row.steps, count) })));
    setSelectedCells((prev) => new Set(Array.from(prev).filter((key) => Number(key.split(":")[1]) < count)));
  }

  function changeSpeed(nextSpeed: DrumSpeed) {
    props.onSpeedChange(nextSpeed);
  }

  async function generateBeat() {
    setGenerating(true);
    try {
      const feedback = await listDrumBeatFeedback(24);
      const generated = await ai.generateDrumBeat({
        genre: generateGenre(),
        instruments: props.instruments,
        stepCount: props.stepCount,
        lengthBeats: props.lengthBeats,
        speed: props.speed,
        timeSignature: props.timeSignature,
        complexity: generateComplexity(),
        variationSeed: Date.now() + Math.floor(Math.random() * 100000),
        feedbackExamples: feedback
          .filter((entry): entry is typeof entry & { rating: "up" | "down" } => Boolean(entry.rating))
          .map((entry) => ({
            genre: entry.genre,
            rating: entry.rating,
            beat: entry.finalBeat ?? entry.modelBeat,
            userFeedback: entry.userFeedback,
          })),
      });
      const nextFeedbackId = crypto.randomUUID();
      await saveDrumBeatFeedback({
        id: nextFeedbackId,
        genre: generateGenre(),
        modelBeat: generated,
        prompt: generated.prompt,
        model: generated.model,
        source: generated.source,
        context: {
          genre: generateGenre(),
          stepCount: props.stepCount,
          lengthBeats: props.lengthBeats,
          speed: props.speed,
          timeSignature: props.timeSignature,
          complexity: generateComplexity(),
          instrumentIds: props.instruments.map((instrument) => instrument.id),
        },
        createdAt: Date.now(),
      });
      setSelectedCells(new Set<string>());
      setLastGeneratedBeat(generated);
      setFeedbackRating(null);
      setFeedbackSubmitted(null);
      setFeedbackPopover(null);
      setFeedbackId(nextFeedbackId);
      props.onTrainingSessionChange?.(nextFeedbackId);
      stop();
      if (props.onGenerateBeat) {
        props.onGenerateBeat(generated);
        return;
      }
      props.onResize(generated.lengthBeats, generated.rows);
      props.onChange(generated.rows);
      props.onSpeedChange(generated.speed);
      props.onSwingChange?.(generated.swingPercent);
      props.onDefaultPitchChange?.(generated.defaultPitchHz);
    } finally {
      setGenerating(false);
    }
  }

  async function rateGeneratedBeat(rating: "up" | "down", userFeedback?: string) {
    const beat = lastGeneratedBeat();
    if (!beat || feedbackSubmitted()) return;
    setFeedbackRating(rating);
    setFeedbackSubmitted(rating);
    const id = feedbackId() ?? crypto.randomUUID();
    const entry = {
      genre: generateGenre(),
      rating,
      userFeedback,
      modelBeat: beat,
      prompt: beat.prompt,
      model: beat.model,
      source: beat.source,
      context: {
        genre: generateGenre(),
        stepCount: props.stepCount,
        lengthBeats: props.lengthBeats,
        speed: props.speed,
        timeSignature: props.timeSignature,
        complexity: generateComplexity(),
        instrumentIds: props.instruments.map((instrument) => instrument.id),
      },
      createdAt: Date.now(),
    };
    await saveDrumBeatFeedback({ id, ...entry });
    void maybeRunDueTraining("drums");
    props.onTrainingSessionChange?.(id);
    window.setTimeout(() => setLastGeneratedBeat(null), 700);
  }

  function startCellPointer(e: PointerEvent, rowId: string, step: number) {
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey) return;
    wrapRef.current?.focus();
    e.preventDefault();
    const target = e.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    target.setPointerCapture(e.pointerId);
    const key = cellKey(rowId, step);
    if (e.shiftKey) {
      setSelectedCells((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }
    const row = props.rows.find((candidate) => candidate.id === rowId);
    const setOn = !normalizeDrumCell(row?.steps[step]).on;
    dragRef.current = { pointerId: e.pointerId, setOn, touched: new Set([key]) };
    updateCells(new Set([key]), (cell) => ({ ...cell, on: setOn }));
    setSelectedCells(new Set<string>());
  }

  function enterCell(rowId: string, step: number) {
    const drag = dragRef.current;
    if (!drag) return;
    const key = cellKey(rowId, step);
    if (drag.touched.has(key)) return;
    drag.touched.add(key);
    updateCells(new Set([key]), (cell) => ({ ...cell, on: drag.setOn }));
  }

  function endCellPointer() {
    dragRef.current = null;
  }

  function openCellMenu(e: MouseEvent, rowId: string, step: number) {
    e.preventDefault();
    e.stopPropagation();
    const key = cellKey(rowId, step);
    if (!selectedCells().has(key)) setSelectedCells(new Set([key]));
    setCellMenu({ x: e.clientX, y: e.clientY, rowId, step });
    setOpenRowId(null);
    setPitchPopover(null);
    setVolumePopover(null);
    setLeanPopover(null);
  }

  function targetKeys(rowId: string, step: number): Set<string> {
    const key = cellKey(rowId, step);
    return selectedCells().has(key) ? new Set(selectedCells()) : new Set([key]);
  }

  function copyCells(rowId: string, step: number) {
    const keys = targetKeys(rowId, step);
    const selected = Array.from(keys).map(parseCellKey).filter(Boolean) as Array<{ rowId: string; step: number }>;
    const rowIndexLookup = new Map(props.rows.map((row, index) => [row.id, index]));
    const minRow = Math.min(...selected.map((cell) => rowIndexLookup.get(cell.rowId) ?? 0));
    const minStep = Math.min(...selected.map((cell) => cell.step));
    cellClipboardRef.current = {
      cells: selected.map((cell) => {
        const row = props.rows.find((candidate) => candidate.id === cell.rowId);
        return {
          rowOffset: (rowIndexLookup.get(cell.rowId) ?? 0) - minRow,
          stepOffset: cell.step - minStep,
          cell: cloneDrumCell(row?.steps[cell.step]),
        };
      }),
    };
  }

  function pasteCells(rowId: string, step: number) {
    const copied = cellClipboardRef.current;
    if (!copied) return;
    const rowStart = props.rows.findIndex((row) => row.id === rowId);
    if (rowStart < 0) return;
    props.onChange(props.rows.map((row, rowIndex) => {
      const patches = copied.cells.filter((cell) => rowStart + cell.rowOffset === rowIndex);
      if (patches.length === 0) return row;
      const steps = normalizeDrumSteps(row.steps, props.stepCount);
      for (const patch of patches) {
        const targetStep = step + patch.stepOffset;
        if (targetStep < 0 || targetStep >= props.stepCount) continue;
        steps[targetStep] = { ...patch.cell };
      }
      return { ...row, steps };
    }));
  }

  function resetCells(rowId: string, step: number) {
    updateCells(targetKeys(rowId, step), () => ({ on: false }));
  }

  function applyPitch() {
    const current = pitchPopover();
    if (!current) return;
    const hz = parsePitchInput(current.value);
    if (!hz) {
      setPitchPopover({ ...current, error: true });
      return;
    }
    updateCells(targetKeys(current.rowId, current.step), (cell) => ({ ...cell, pitchHz: hz }));
    setPitchPopover(null);
  }

  function clearPitch() {
    const current = pitchPopover();
    if (!current) return;
    updateCells(targetKeys(current.rowId, current.step), (cell) => ({ ...cell, pitchHz: undefined }));
    setPitchPopover(null);
  }

  function applyVolume() {
    const current = volumePopover();
    if (!current) return;
    const velocity = parseVolumeInput(current.value);
    if (velocity == null) {
      setVolumePopover({ ...current, error: true });
      return;
    }
    updateCells(targetKeys(current.rowId, current.step), (cell) => ({ ...cell, velocity }));
    setVolumePopover(null);
  }

  function clearVolume() {
    const current = volumePopover();
    if (!current) return;
    updateCells(targetKeys(current.rowId, current.step), (cell) => ({ ...cell, velocity: undefined }));
    setVolumePopover(null);
  }

  function applyLean() {
    const current = leanPopover();
    if (!current) return;
    const leanPercent = parseLeanInput(current.value);
    if (leanPercent == null) {
      setLeanPopover({ ...current, error: true });
      return;
    }
    updateCells(targetKeys(current.rowId, current.step), (cell) => ({ ...cell, leanPercent }));
    setLeanPopover(null);
  }

  function clearLean() {
    const current = leanPopover();
    if (!current) return;
    updateCells(targetKeys(current.rowId, current.step), (cell) => ({ ...cell, leanPercent: undefined }));
    setLeanPopover(null);
  }

  function startVolumeDrag(e: PointerEvent, rowId: string, step: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const cellButton = target.closest("button");
    if (!(cellButton instanceof HTMLElement)) return;
    const rect = cellButton.getBoundingClientRect();
    volumeDragRef.current = { rowId, step, pointerId: e.pointerId, rect };
    target.setPointerCapture(e.pointerId);
    applyVolumeFromPointer(e.clientY, rowId, step, rect);
  }

  function dragVolume(e: PointerEvent) {
    const drag = volumeDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    applyVolumeFromPointer(e.clientY, drag.rowId, drag.step, drag.rect);
  }

  function endVolumeDrag(e: PointerEvent) {
    const drag = volumeDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    volumeDragRef.current = null;
  }

  function applyVolumeFromPointer(clientY: number, rowId: string, step: number, rect: DOMRect) {
    const ratio = Math.max(0, Math.min(1, 1 - ((clientY - rect.top) / Math.max(1, rect.height))));
    const velocity = Math.round(ratio * 127);
    updateCells(new Set([cellKey(rowId, step)]), (cell) => ({ ...cell, velocity }));
  }

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "0") {
      e.preventDefault();
      setCellSize(DEFAULT_CELL_SIZE);
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (selectedCells().size === 0) return;
    const first = parseCellKey(Array.from(selectedCells())[0]);
    if (!first) return;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      updateCells(selectedCells(), () => ({ on: false }));
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copyCells(first.rowId, first.step);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteCells(first.rowId, first.step);
    }
  }

  const activeTimeSignature = props.segmentTimeSignature ?? props.timeSignature;
  const sequenceStyle = {
    "--step-count": props.stepCount,
    "--play-step": playStep() ?? 0,
    "--cell-width": `${cellSize()}px`,
    "--cell-height": `${DEFAULT_CELL_SIZE}px`,
  } as JSX.CSSProperties;

  return (
    <div ref={(element) => { wrapRef.current = element; }} class={styles.wrap} tabIndex={-1} onKeyDown={handleKeyDown}>
      <div class={styles.toolbar}>
        <NumberInput
          layout="inline"
          label="Length"
          value={props.lengthBeats}
          min={1}
          max={DRUM_MAX_STEPS}
          step={1}
          maxLength={3}
          onChange={resizeLength}
        />
        {props.onDefaultPitchChange && (
          <NumberInput
            layout="inline"
            label="Pitch"
            value={Math.round(props.defaultPitchHz ?? noteFrequency(DEFAULT_DRUM_MIDI_PITCH, fallbackInstrument))}
            min={20}
            max={20000}
            step={1}
            unit="Hz"
            onChange={props.onDefaultPitchChange}
          />
        )}
        {props.onSwingChange && (
          <label class={styles.swingControl}>
            <span class={styles.swingHeader}>
              <span class={styles.swingLabel}>Swing</span>
              <span class={styles.swingValue}>{sanitizeSwingPercent(swingPercent())}%</span>
            </span>
            <input
              class={styles.swingRange}
              type="range"
              min={0}
              max={100}
              step={1}
              value={sanitizeSwingPercent(swingPercent())}
              onInput={(event) => props.onSwingChange?.(Number(event.currentTarget.value))}
            />
          </label>
        )}
        {props.onTimeSignatureChange && (
          <TimeSignatureControl
            value={activeTimeSignature}
            ariaLabel="Drum time signature"
            onChange={props.onTimeSignatureChange}
          />
        )}
        <div class={styles.generateBlock}>
          <FloatingSelect
            className={styles.genreSelect}
            fillHeight
            label="Genre"
            layout="inline"
            value={generateGenre()}
            ariaLabel="Generated beat genre"
            options={DRUM_GENRES.map((genre) => ({ value: genre, label: genreLabel(genre) }))}
            open={generateGenreOpen()}
            onOpenChange={(open) => {
              setGenerateGenreOpen(open);
              if (open) setOpenRowId(null);
            }}
            onChange={(value) => setGenerateGenre(value as DrumGenre)}
          />
          <label class={styles.complexityControl}>
            <span class={styles.complexityHeader}>
              <span class={styles.complexityLabel}>Complexity</span>
              <span class={styles.complexityValue}>{generateComplexity()}</span>
            </span>
            <input
              class={styles.complexityRange}
              type="range"
              min={0}
              max={100}
              step={1}
              value={generateComplexity()}
              onInput={(event) => setGenerateComplexity(Number(event.currentTarget.value))}
              aria-label="Generated beat complexity"
            />
          </label>
          <Button
            class={styles.generateButton}
            iconOnly
            size="xs"
            onClick={generateBeat}
            aria-label="Generate beat"
            disabled={generating()}
          >
            <Icon name={generating() ? "ph:spinner" : "ph:sparkle"} size={14} decorative />
          </Button>
        </div>
        {lastGeneratedBeat() && !feedbackSubmitted() && (
          <div class={styles.feedbackBlock} aria-label="Generated beat feedback">
            <HoverInfo content="Good generation">
              <Button
                iconOnly
                size="xs"
                selected={feedbackRating() === "up"}
                onClick={() => void rateGeneratedBeat("up")}
                aria-label="Rate generated beat up"
              >
                <Icon name="ph:thumbs-up" size={14} decorative />
              </Button>
            </HoverInfo>
            <HoverInfo content="Bad generation">
              <Button
                iconOnly
                size="xs"
                selected={feedbackRating() === "down"}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setFeedbackPopover({ x: rect.left, y: rect.bottom + 2, value: "" });
                }}
                aria-label="Rate generated beat down"
              >
                <Icon name="ph:thumbs-down" size={14} decorative />
              </Button>
            </HoverInfo>
          </div>
        )}
        {feedbackSubmitted() && <span class={styles.feedbackDone}>Thumbs {feedbackSubmitted() === "up" ? "up" : "down"} saved</span>}
      </div>
      <div class={styles.sequenceShell} style={sequenceStyle}>
        <div class={styles.instrumentColumn}>
          <div class={styles.headerStub} aria-hidden />
          {props.rows.map((row) => (
            <div class={styles.rowControls}>
              <FloatingSelect
                fillHeight
                value={row.instrumentId ?? ""}
                ariaLabel={`${row.name} instrument`}
                options={props.instruments.map((instrument) => ({
                  value: instrument.id,
                  label: instrument.name,
                }))}
                open={openRowId() === row.id}
                onOpenChange={(open) => {
                  setOpenRowId(open ? row.id : null);
                  setCellMenu(null);
                  setPitchPopover(null);
                  setVolumePopover(null);
                }}
                onChange={(instrumentId) => {
                  const instrument = props.instruments.find((candidate) => candidate.id === instrumentId);
                  updateRow(row.id, {
                    instrumentId,
                    name: instrument?.name ?? row.name,
                  });
                }}
              />
              <HoverInfo content="Remove row">
                <Button
                  class={styles.rowRemoveButton}
                  iconOnly
                  size="xs"
                  onClick={() => removeRow(row.id)}
                  aria-label={`Remove ${row.name}`}
                >
                  <Icon name="ph:trash" size={12} decorative />
                </Button>
              </HoverInfo>
            </div>
          ))}
          <div class={styles.addRowControls}>
            <Button size="sm" onClick={addRow} fullWidth>
              <Icon name="ph:plus" size={14} decorative />
              Instrument
            </Button>
            {props.onUploadRow && (
              <Button iconOnly size="xs" onClick={props.onUploadRow} aria-label="Upload drum instrument row">
                <Icon name="ph:upload" size={14} decorative />
              </Button>
            )}
          </div>
        </div>

        <div class={styles.stepScroller}>
          <div class={styles.stepPlane}>
            {playStep() != null && <div class={styles.playColumn} aria-hidden />}
            <div class={styles.stepHeader}>
              {Array.from({ length: props.stepCount }, (_, step) => (
                <div
                  class={`${styles.stepNumber} ${isStrongBeat(step, props.speed, activeTimeSignature) ? styles.stepStrong : ""}`}
                  style={swingStepStyle(step, swingPercent(), cellSize())}
                >
                  {step + 1}
                </div>
              ))}
            </div>

            <div class={styles.stepRows}>
              {props.rows.map((row) => (
                <div class={styles.stepGrid}>
                  {normalizeDrumSteps(row.steps, props.stepCount).map((cell, step) => {
                    const selected = selectedCells().has(cellKey(row.id, step));
                    const activeStep = playStep() === step;
                    const customVolume = hasCustomDrumVelocity(row.steps[step]);
                    const volumePercent = customVolume ? velocityToPercent(effectiveDrumVelocity(cell)) : 0;
                    return (
                      <button
                        type="button"
                        class={[
                          styles.stepCell,
                          isStrongBeat(step, props.speed, activeTimeSignature) && styles.stepStrong,
                          cell.on && styles.stepCellOn,
                          activeStep && styles.stepCellPlaying,
                          selected && styles.stepCellSelected,
                          cell.pitchHz && styles.stepCellTuned,
                          customVolume && styles.stepCellCustomVolume,
                        ].filter(Boolean).join(" ")}
                        style={{
                          ...swingStepStyle(step, swingPercent(), cellSize()),
                          ...(customVolume ? { "--cell-volume": `${volumePercent}%` } as JSX.CSSProperties : null),
                        }}
                        onPointerDown={(e) => startCellPointer(e, row.id, step)}
                        onPointerEnter={() => enterCell(row.id, step)}
                        onPointerUp={endCellPointer}
                        onPointerCancel={endCellPointer}
                        onContextMenu={(e) => openCellMenu(e, row.id, step)}
                        aria-pressed={cell.on}
                        aria-label={`${row.name} step ${step + 1}`}
                      >
                        {cell.pitchHz && (
                          <span class={styles.cellNote}>{frequencyToNoteName(cell.pitchHz)}</span>
                        )}
                        {cell.leanPercent != null && (
                          <span
                            class={styles.cellLean}
                            style={{ "--cell-lean": `${Math.max(-20, Math.min(20, cell.leanPercent * 0.4))}deg` } as JSX.CSSProperties}
                            title={`${leanToDisplay(cell.leanPercent)}% (${cell.leanPercent >= 0 ? "+" : ""}${cell.leanPercent}%)`}
                          />
                        )}
                        {customVolume && (
                          <span
                            class={styles.cellVolume}
                            onPointerDown={(e) => startVolumeDrag(e, row.id, step)}
                            onPointerMove={dragVolume}
                            onPointerUp={endVolumeDrag}
                            onPointerCancel={endVolumeDrag}
                            aria-hidden
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div class={styles.addRowSpacer} aria-hidden />
            </div>
          </div>
        </div>
      </div>

      <div class={styles.transportRow}>
        <RadioGroup
          label="Grid"
          ariaLabel="Drum grid density"
          value={props.speed}
          options={DRUM_SPEEDS.map((option) => ({ value: option, label: String(option) }))}
          onChange={changeSpeed}
        />
        <div class={styles.transportBlock}>
          <HoverInfo content="Restart">
            <Button
              iconOnly
              size="xs"
              onClick={play}
              aria-label="Restart drum sequence"
            >
              <Icon name="ph:skip-back-fill" size={16} decorative />
            </Button>
          </HoverInfo>
          <HoverInfo content={playing() ? "Pause" : "Play"}>
            <Button
              iconOnly
              size="xs"
              variant={playing() ? "primary" : "default"}
              onClick={playing() ? stop : play}
              aria-label={playing() ? "Pause drum sequence" : "Play drum sequence"}
            >
              <Icon name={playing() ? "ph:pause-fill" : "ph:play-fill"} size={16} decorative />
            </Button>
          </HoverInfo>
        </div>
        <div class={styles.zoomControl}>
          <HoverInfo content="Zoom out">
            <Button
              iconOnly
              size="xs"
              onClick={() => setCellSize((size) => Math.max(MIN_CELL_SIZE, size - CELL_ZOOM_STEP))}
              aria-label="Zoom drum cells out"
            >
              <Icon name="ph:magnifying-glass-minus" size={16} decorative />
            </Button>
          </HoverInfo>
          <HoverInfo content="Reset zoom">
            <Button
              iconOnly
              size="xs"
              onClick={() => setCellSize(DEFAULT_CELL_SIZE)}
              aria-label="Reset drum cell zoom"
            >
              <Icon name="ph:arrow-counter-clockwise" size={16} decorative />
            </Button>
          </HoverInfo>
          <HoverInfo content="Zoom in">
            <Button
              iconOnly
              size="xs"
              onClick={() => setCellSize((size) => Math.min(MAX_CELL_WIDTH, size + CELL_ZOOM_STEP))}
              aria-label="Zoom drum cells in"
            >
              <Icon name="ph:magnifying-glass-plus" size={16} decorative />
            </Button>
          </HoverInfo>
        </div>
      </div>

      {(() => {
        const currentCellMenu = cellMenu();
        if (!currentCellMenu) return null;
        return (
        <CellMenu
          state={currentCellMenu}
          hasClipboard={Boolean(cellClipboardRef.current)}
          selectionSize={targetKeys(currentCellMenu.rowId, currentCellMenu.step).size}
          onShiftPitch={() => {
            const row = props.rows.find((candidate) => candidate.id === currentCellMenu.rowId);
            const cell = normalizeDrumCell(row?.steps[currentCellMenu.step]);
            setPitchPopover({
              ...currentCellMenu,
              value: formatFrequency(cell.pitchHz),
              error: false,
            });
            setVolumePopover(null);
            setCellMenu(null);
          }}
          onVolume={() => {
            const row = props.rows.find((candidate) => candidate.id === currentCellMenu.rowId);
            const cell = normalizeDrumCell(row?.steps[currentCellMenu.step]);
            setVolumePopover({
              ...currentCellMenu,
              value: String(velocityToPercent(effectiveDrumVelocity(cell))),
              error: false,
            });
            setPitchPopover(null);
            setLeanPopover(null);
            setCellMenu(null);
          }}
          onLean={() => {
            const row = props.rows.find((candidate) => candidate.id === currentCellMenu.rowId);
            const cell = normalizeDrumCell(row?.steps[currentCellMenu.step]);
            setLeanPopover({
              ...currentCellMenu,
              value: String(leanToDisplay(cell.leanPercent)),
              error: false,
            });
            setPitchPopover(null);
            setVolumePopover(null);
            setCellMenu(null);
          }}
          onCopy={() => {
            copyCells(currentCellMenu.rowId, currentCellMenu.step);
            setCellMenu(null);
          }}
          onPaste={() => {
            pasteCells(currentCellMenu.rowId, currentCellMenu.step);
            setCellMenu(null);
          }}
          onReset={() => {
            resetCells(currentCellMenu.rowId, currentCellMenu.step);
            setCellMenu(null);
          }}
        />
        );
      })()}

      {(() => {
        const currentPitchPopover = pitchPopover();
        if (!currentPitchPopover) return null;
        return (
        <PitchPopover
          state={currentPitchPopover}
          onChange={(value: string) => setPitchPopover({ ...currentPitchPopover, value, error: false })}
          onApply={applyPitch}
          onClear={clearPitch}
        />
        );
      })()}

      {(() => {
        const currentVolumePopover = volumePopover();
        if (!currentVolumePopover) return null;
        return (
        <VolumePopover
          state={currentVolumePopover}
          onChange={(value: string) => setVolumePopover({ ...currentVolumePopover, value, error: false })}
          onApply={applyVolume}
          onClear={clearVolume}
        />
        );
      })()}

      {(() => {
        const currentLeanPopover = leanPopover();
        if (!currentLeanPopover) return null;
        return (
        <LeanPopover
          state={currentLeanPopover}
          onChange={(value: string) => setLeanPopover({ ...currentLeanPopover, value, error: false })}
          onApply={applyLean}
          onClear={clearLean}
        />
        );
      })()}
      {(() => {
        const currentFeedbackPopover = feedbackPopover();
        if (!currentFeedbackPopover) return null;
        return (
        <FeedbackPopover
          state={currentFeedbackPopover}
          onChange={(value: string) => setFeedbackPopover({ ...currentFeedbackPopover, value })}
          onSubmit={() => {
            const value = currentFeedbackPopover.value.trim();
            setFeedbackPopover(null);
            void rateGeneratedBeat("down", value || undefined);
          }}
        />
        );
      })()}
    </div>
  );
}

function CellMenu({
  state,
  hasClipboard,
  selectionSize,
  onShiftPitch,
  onVolume,
  onLean,
  onCopy,
  onPaste,
  onReset,
}: {
  state: CellMenuState;
  hasClipboard: boolean;
  selectionSize: number;
  onShiftPitch: () => void;
  onVolume: () => void;
  onLean: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onReset: () => void;
}) {
  const labelSuffix = selectionSize > 1 ? " selection" : " cell";
  return createPortal(
    <FloatingLayer class={styles.cellMenu} x={state.x} y={state.y} role="menu">
      <button type="button" class={styles.cellMenuItem} onClick={onShiftPitch} role="menuitem">
        Shift pitch
      </button>
      <button type="button" class={styles.cellMenuItem} onClick={onVolume} role="menuitem">
        Volume
      </button>
      <button type="button" class={styles.cellMenuItem} onClick={onLean} role="menuitem">
        Lean beat…
      </button>
      <button type="button" class={styles.cellMenuItem} onClick={onCopy} role="menuitem">
        Copy{labelSuffix}
      </button>
      <button type="button" class={styles.cellMenuItem} onClick={onPaste} disabled={!hasClipboard} role="menuitem">
        Paste
      </button>
      <button type="button" class={styles.cellMenuItem} onClick={onReset} role="menuitem">
        Reset{labelSuffix}
      </button>
    </FloatingLayer>,
    document.body,
  );
}

function LeanPopover({
  state,
  onChange,
  onApply,
  onClear,
}: {
  state: LeanPopoverState;
  onChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  return createPortal(
    <FloatingLayer class={styles.valuePopover} x={state.x} y={state.y}>
      <TextInput
        autofocus
        class={styles.valueField}
        label="Lean"
        layout="inline"
        value={state.value}
        placeholder="0-100"
        unit="%"
        onInput={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onApply();
        }}
      />
      {state.error && <div class={styles.valueError}>Use 0 to 100%</div>}
      <div class={styles.valueActions}>
        <Button size="xs" onClick={onClear}>Default</Button>
        <Button size="xs" variant="primary" onClick={onApply}>Apply</Button>
      </div>
    </FloatingLayer>,
    document.body,
  );
}

function PitchPopover({
  state,
  onChange,
  onApply,
  onClear,
}: {
  state: PitchPopoverState;
  onChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  return createPortal(
    <FloatingLayer class={styles.pitchPopover} x={state.x} y={state.y}>
      <TextInput
        autofocus
        class={styles.pitchField}
        label="Pitch"
        layout="inline"
        value={state.value}
        placeholder="C4 or 440"
        onInput={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onApply();
        }}
      />
      {state.error && <div class={styles.pitchError}>Use note or Hz</div>}
      <div class={styles.pitchActions}>
        <Button size="xs" onClick={onClear}>Default</Button>
        <Button size="xs" variant="primary" onClick={onApply}>Apply</Button>
      </div>
    </FloatingLayer>,
    document.body,
  );
}

function VolumePopover({
  state,
  onChange,
  onApply,
  onClear,
}: {
  state: VolumePopoverState;
  onChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  return createPortal(
    <FloatingLayer class={styles.valuePopover} x={state.x} y={state.y}>
      <TextInput
        autofocus
        class={styles.valueField}
        label="Volume"
        layout="inline"
        value={state.value}
        placeholder="0-100%"
        onInput={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onApply();
        }}
      />
      {state.error && <div class={styles.valueError}>Use 0-100%</div>}
      <div class={styles.valueActions}>
        <Button size="xs" onClick={onClear}>Default</Button>
        <Button size="xs" variant="primary" onClick={onApply}>Apply</Button>
      </div>
    </FloatingLayer>,
    document.body,
  );
}

function FeedbackPopover({
  state,
  onChange,
  onSubmit,
}: {
  state: FeedbackPopoverState;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return createPortal(
    <FloatingLayer class={styles.valuePopover} x={state.x} y={state.y}>
      <TextInput
        autofocus
        class={styles.valueField}
        label="Issue"
        layout="inline"
        value={state.value}
        placeholder="What felt wrong?"
        onInput={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
      />
      <div class={styles.valueActions}>
        <Button size="xs" variant="primary" onClick={onSubmit}>Submit</Button>
      </div>
    </FloatingLayer>,
    document.body,
  );
}

function cellKey(rowId: string, step: number): string {
  return `${rowId}:${step}`;
}

function parseCellKey(key: string): { rowId: string; step: number } | null {
  const lastColon = key.lastIndexOf(":");
  if (lastColon < 0) return null;
  const step = Number(key.slice(lastColon + 1));
  if (!Number.isInteger(step)) return null;
  return { rowId: key.slice(0, lastColon), step };
}

function cloneDrumCell(step: DrumCell | boolean | undefined): DrumCell {
  if (typeof step === "object" && step) return normalizeDrumCell(step);
  return { on: Boolean(step) };
}

function parseVolumeInput(value: string): number | null {
  const normalized = value.trim().replace(/%$/, "");
  if (!normalized) return null;
  const percent = Number(normalized);
  if (!Number.isFinite(percent)) return null;
  return sanitizeVelocity(Math.round((Math.max(0, Math.min(100, percent)) / 100) * 127)) ?? null;
}

function parseLeanInput(value: string): number | null {
  const normalized = value.trim().replace(/%$/, "");
  if (!normalized) return null;
  const display = Number(normalized);
  if (!Number.isFinite(display)) return null;
  return sanitizeLeanPercent(Math.max(0, Math.min(100, display)) - 50) ?? null;
}

function leanToDisplay(value: number | undefined): number {
  return Math.max(0, Math.min(100, (sanitizeLeanPercent(value) ?? 0) + 50));
}

function swingStepStyle(step: number, swingPercent: number, cellSize: number): JSX.CSSProperties | undefined {
  const swing = sanitizeSwingPercent(swingPercent);
  if (swing === 50 || step % 2 !== 0) return undefined;
  const marginRight = Math.max(-cellSize * 0.35, Math.min(cellSize * 0.5, ((swing - 50) / 50) * cellSize * 0.5));
  return { "margin-right": px(marginRight) };
}

function isStrongBeat(step: number, speed: DrumSpeed, timeSignature: TimeSignature): boolean {
  const stepsPerBar = Math.max(1, timeSignature.num * speed);
  return step % stepsPerBar === 0;
}

function velocityToPercent(velocity: number): number {
  return Math.round((Math.max(0, Math.min(127, velocity)) / 127) * 100);
}

function genreLabel(genre: DrumGenre): string {
  if (genre === "dnb") return "DnB";
  return genre.replace(/^\w/, (letter) => letter.toUpperCase());
}

const fallbackInstrument: Instrument = {
  id: "drum-fallback",
  name: "Drum Preview",
  kind: "synth",
  envelope: { attackMs: 1, decayMs: 80, sustain: 0, releaseMs: 40 },
  knobs: { cutoff: 0.4, resonance: 0.2, drive: 0.2, color: 0.5 },
  waveform: "sine",
  sampleIds: [],
  userCreated: false,
};

const DRUM_SPEEDS = [1, 2, 3, 4, 5, 6] as const satisfies readonly DrumSpeed[];
const DRUM_LOOKAHEAD_SECONDS = 0.08;
const DEFAULT_CELL_SIZE = 28;
const MIN_CELL_SIZE = 20;
const MAX_CELL_WIDTH = 56;
const CELL_ZOOM_STEP = 4;
