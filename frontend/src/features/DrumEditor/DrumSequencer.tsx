import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button, FloatingLayer, FloatingSelect, HoverInfo, Icon, NumberInput, RadioGroup, TextInput } from "../../components";
import { ai } from "../../ai/aiService";
import { DRUM_COMPLEXITY_DEFAULT, DRUM_GENRES, DRUM_MAX_STEPS, type DrumGenre, type GeneratedDrumBeat } from "../../ai/drumBeatGenerator";
import { maybeRunDueTraining } from "../../ai/trainingRunner";
import { createInstrumentBufferSource, noteFrequency, preloadInstrumentSample } from "../../audio/synthPreview";
import { useContextualHotkey } from "../../hotkeys/contextualHotkeys";
import { listDrumBeatFeedback, saveDrumBeatFeedback } from "../../persistence/dexie";
import { TimeSignatureControl } from "../Transport/TimeSignatureControl";
import {
  DEFAULT_DRUM_MIDI_PITCH,
  DEFAULT_DRUM_VELOCITY,
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

export function DrumSequencer({
  rows,
  stepCount,
  speed,
  lengthBeats,
  defaultPitchHz,
  swingPercent = 50,
  bpm,
  timeSignature,
  segmentTimeSignature,
  instruments,
  hotkeyScopeId,
  onChange,
  onResize,
  onGenerateBeat,
  onTrainingSessionChange,
  onDefaultPitchChange,
  onSwingChange,
  onSpeedChange,
  onTimeSignatureChange,
  onUploadRow,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [playStep, setPlayStep] = useState<number | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(() => new Set());
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [generateGenre, setGenerateGenre] = useState<DrumGenre>("rock");
  const [generateGenreOpen, setGenerateGenreOpen] = useState(false);
  const [generateComplexity, setGenerateComplexity] = useState(DRUM_COMPLEXITY_DEFAULT);
  const [generating, setGenerating] = useState(false);
  const [lastGeneratedBeat, setLastGeneratedBeat] = useState<GeneratedDrumBeat | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<"up" | "down" | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<"up" | "down" | null>(null);
  const [feedbackPopover, setFeedbackPopover] = useState<FeedbackPopoverState | null>(null);
  const [cellMenu, setCellMenu] = useState<CellMenuState | null>(null);
  const [pitchPopover, setPitchPopover] = useState<PitchPopoverState | null>(null);
  const [volumePopover, setVolumePopover] = useState<VolumePopoverState | null>(null);
  const [leanPopover, setLeanPopover] = useState<LeanPopoverState | null>(null);
  const [cellSize, setCellSize] = useState(DEFAULT_CELL_SIZE);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  const instrumentsRef = useRef(instruments);
  const defaultPitchRef = useRef(defaultPitchHz);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const scheduledRef = useRef<Set<string>>(new Set());
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const activeGainsRef = useRef<Set<GainNode>>(new Set());
  const loopStartTimeRef = useRef(0);
  const stepRef = useRef(0);
  const dragRef = useRef<{ pointerId: number; setOn: boolean; touched: Set<string> } | null>(null);
  const volumeDragRef = useRef<{ rowId: string; step: number; pointerId: number; rect: DOMRect } | null>(null);
  const cellClipboardRef = useRef<CopiedCells | null>(null);

  rowsRef.current = rows;
  instrumentsRef.current = instruments;
  defaultPitchRef.current = defaultPitchHz;

  useContextualHotkey(
    hotkeyScopeId ?? "",
    "space",
    () => {
      if (playing) stop();
      else play();
    },
    Boolean(hotkeyScopeId),
  );

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopDrumPreviewAudio();
      if (ctxRef.current) void ctxRef.current.close();
    },
    [],
  );

  useEffect(() => {
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

  useEffect(() => {
    if (!playing) return;
    restartPlaybackClock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepCount, lengthBeats, bpm, speed, swingPercent]);

  useEffect(() => {
    const ctx = getCtx();
    for (const instrument of instruments) {
      if (!instrument.sampleUrl) continue;
      void preloadInstrumentSample(ctx, instrument).catch(() => {
        // Falling back to synthesized preview keeps playback resilient.
      });
    }
  }, [instruments]);

  useEffect(() => {
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
    const stepLengthBeats = (lengthBeats / speed) / Math.max(1, stepCount);
    const beatsPerSecond = bpm / 60;
    for (const row of rowsRef.current) {
      const cell = normalizeDrumCell(row.steps[step]);
      if (!cell.on) continue;
      const instrument =
        instrumentsRef.current.find((i) => i.id === row.instrumentId) ??
        instrumentsRef.current[0] ??
        fallbackInstrument;
      const hitTimeS = atTimeS + drumTimingOffsetBeats(step, stepLengthBeats, swingPercent, cell.leanPercent) / beatsPerSecond;
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
    const source = createInstrumentBufferSource(ctx, instrument, 0.2, frequencyHz, undefined, velocity);
    const duration = source.buffer
      ? Math.max(0.05, Math.min(1.5, maxDuration, source.buffer.duration / source.playbackRate.value))
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

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      scheduledRef.current.clear();
      return;
    }

    const ctx = getCtx();
    const tick = () => {
      const phraseSeconds = Math.max(0.05, ((lengthBeats / speed) * 60) / Math.max(1, bpm));
      const stepSeconds = Math.max(0.005, phraseSeconds / Math.max(1, stepCount));
      const stepLengthBeats = (lengthBeats / speed) / Math.max(1, stepCount);
      const beatsPerSecond = bpm / 60;
      const now = ctx.currentTime;
      const elapsed = Math.max(0, now - loopStartTimeRef.current);
      const cycle = Math.floor(elapsed / phraseSeconds);
      const loopTime = elapsed - cycle * phraseSeconds;
      const visualStep = Math.min(stepCount - 1, Math.max(0, Math.floor(loopTime / stepSeconds)));

      if (visualStep !== stepRef.current) {
        stepRef.current = visualStep;
        setPlayStep(visualStep);
      }

      const horizon = now + DRUM_LOOKAHEAD_SECONDS;
      for (let scheduleCycle = cycle; scheduleCycle <= cycle + 1; scheduleCycle++) {
        for (let step = 0; step < stepCount; step++) {
          const atTimeS = loopStartTimeRef.current + scheduleCycle * phraseSeconds + step * stepSeconds;
          const earliestSwingTimeS = atTimeS + Math.min(0, drumTimingOffsetBeats(step, stepLengthBeats, swingPercent, -50) / beatsPerSecond);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, lengthBeats, speed, stepCount, bpm, swingPercent]);

  function updateRow(rowId: string, patch: Partial<DrumRow>) {
    onChange(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function updateCells(keys: Set<string>, updater: (cell: DrumCell) => DrumCell) {
    onChange(rows.map((row) => {
      if (!Array.from(keys).some((key) => key.startsWith(`${row.id}:`))) return row;
      const steps = normalizeDrumSteps(row.steps, stepCount).map((cell, step) => (
        keys.has(cellKey(row.id, step)) ? updater(cell) : cell
      ));
      return { ...row, steps };
    }));
  }

  function addRow() {
    const instrument = instruments.find((i) => !rows.some((row) => row.instrumentId === i.id)) ?? instruments[0];
    onChange([
      ...rows,
      {
        id: crypto.randomUUID(),
        instrumentId: instrument?.id,
        name: instrument?.name ?? `Row ${rows.length + 1}`,
        steps: Array.from({ length: stepCount }, () => false),
      },
    ]);
  }

  function removeRow(rowId: string) {
    onChange(rows.filter((row) => row.id !== rowId));
    setSelectedCells((prev) => new Set(Array.from(prev).filter((key) => !key.startsWith(`${rowId}:`))));
  }

  function resizeLength(nextLength: number) {
    const length = Math.max(1, Math.min(DRUM_MAX_STEPS, Math.round(nextLength)));
    const count = Math.max(1, Math.min(DRUM_MAX_STEPS, length));
    onResize(length, rows.map((row) => ({ ...row, steps: normalizeDrumSteps(row.steps, count) })));
    setSelectedCells((prev) => new Set(Array.from(prev).filter((key) => Number(key.split(":")[1]) < count)));
  }

  function changeSpeed(nextSpeed: DrumSpeed) {
    onSpeedChange(nextSpeed);
  }

  async function generateBeat() {
    setGenerating(true);
    try {
      const feedback = await listDrumBeatFeedback(24);
      const generated = await ai.generateDrumBeat({
        genre: generateGenre,
        instruments,
        stepCount,
        lengthBeats,
        speed,
        timeSignature,
        complexity: generateComplexity,
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
      const feedbackId = crypto.randomUUID();
      await saveDrumBeatFeedback({
        id: feedbackId,
        genre: generateGenre,
        modelBeat: generated,
        prompt: generated.prompt,
        model: generated.model,
        source: generated.source,
        context: {
          genre: generateGenre,
          stepCount,
          lengthBeats,
          speed,
          timeSignature,
          complexity: generateComplexity,
          instrumentIds: instruments.map((instrument) => instrument.id),
        },
        createdAt: Date.now(),
      });
      setSelectedCells(new Set());
      setLastGeneratedBeat(generated);
      setFeedbackRating(null);
      setFeedbackSubmitted(null);
      setFeedbackPopover(null);
      setFeedbackId(feedbackId);
      onTrainingSessionChange?.(feedbackId);
      stop();
      if (onGenerateBeat) {
        onGenerateBeat(generated);
        return;
      }
      onResize(generated.lengthBeats, generated.rows);
      onChange(generated.rows);
      onSpeedChange(generated.speed);
      onSwingChange?.(generated.swingPercent);
      onDefaultPitchChange?.(generated.defaultPitchHz);
    } finally {
      setGenerating(false);
    }
  }

  async function rateGeneratedBeat(rating: "up" | "down", userFeedback?: string) {
    if (!lastGeneratedBeat || feedbackSubmitted) return;
    setFeedbackRating(rating);
    setFeedbackSubmitted(rating);
    const id = feedbackId ?? crypto.randomUUID();
    const entry = {
      genre: generateGenre,
      rating,
      userFeedback,
      modelBeat: lastGeneratedBeat,
      prompt: lastGeneratedBeat.prompt,
      model: lastGeneratedBeat.model,
      source: lastGeneratedBeat.source,
      context: {
        genre: generateGenre,
        stepCount,
        lengthBeats,
        speed,
        timeSignature,
        complexity: generateComplexity,
        instrumentIds: instruments.map((instrument) => instrument.id),
      },
      createdAt: Date.now(),
    };
    await saveDrumBeatFeedback({ id, ...entry });
    void maybeRunDueTraining("drums");
    onTrainingSessionChange?.(id);
    window.setTimeout(() => setLastGeneratedBeat(null), 700);
  }

  function startCellPointer(e: React.PointerEvent<HTMLButtonElement>, rowId: string, step: number) {
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey) return;
    wrapRef.current?.focus();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
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
    const row = rows.find((candidate) => candidate.id === rowId);
    const setOn = !normalizeDrumCell(row?.steps[step]).on;
    dragRef.current = { pointerId: e.pointerId, setOn, touched: new Set([key]) };
    updateCells(new Set([key]), (cell) => ({ ...cell, on: setOn }));
    setSelectedCells(new Set());
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

  function openCellMenu(e: React.MouseEvent<HTMLButtonElement>, rowId: string, step: number) {
    e.preventDefault();
    e.stopPropagation();
    const key = cellKey(rowId, step);
    if (!selectedCells.has(key)) setSelectedCells(new Set([key]));
    setCellMenu({ x: e.clientX, y: e.clientY, rowId, step });
    setOpenRowId(null);
    setPitchPopover(null);
    setVolumePopover(null);
    setLeanPopover(null);
  }

  function targetKeys(rowId: string, step: number): Set<string> {
    const key = cellKey(rowId, step);
    return selectedCells.has(key) ? new Set(selectedCells) : new Set([key]);
  }

  function copyCells(rowId: string, step: number) {
    const keys = targetKeys(rowId, step);
    const selected = Array.from(keys).map(parseCellKey).filter(Boolean) as Array<{ rowId: string; step: number }>;
    const rowIndexLookup = new Map(rows.map((row, index) => [row.id, index]));
    const minRow = Math.min(...selected.map((cell) => rowIndexLookup.get(cell.rowId) ?? 0));
    const minStep = Math.min(...selected.map((cell) => cell.step));
    cellClipboardRef.current = {
      cells: selected.map((cell) => {
        const row = rows.find((candidate) => candidate.id === cell.rowId);
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
    const rowStart = rows.findIndex((row) => row.id === rowId);
    if (rowStart < 0) return;
    onChange(rows.map((row, rowIndex) => {
      const patches = copied.cells.filter((cell) => rowStart + cell.rowOffset === rowIndex);
      if (patches.length === 0) return row;
      const steps = normalizeDrumSteps(row.steps, stepCount);
      for (const patch of patches) {
        const targetStep = step + patch.stepOffset;
        if (targetStep < 0 || targetStep >= stepCount) continue;
        steps[targetStep] = { ...patch.cell };
      }
      return { ...row, steps };
    }));
  }

  function resetCells(rowId: string, step: number) {
    updateCells(targetKeys(rowId, step), () => ({ on: false }));
  }

  function applyPitch() {
    if (!pitchPopover) return;
    const hz = parsePitchInput(pitchPopover.value);
    if (!hz) {
      setPitchPopover({ ...pitchPopover, error: true });
      return;
    }
    updateCells(targetKeys(pitchPopover.rowId, pitchPopover.step), (cell) => ({ ...cell, pitchHz: hz }));
    setPitchPopover(null);
  }

  function clearPitch() {
    if (!pitchPopover) return;
    updateCells(targetKeys(pitchPopover.rowId, pitchPopover.step), (cell) => ({ ...cell, pitchHz: undefined }));
    setPitchPopover(null);
  }

  function applyVolume() {
    if (!volumePopover) return;
    const velocity = parseVolumeInput(volumePopover.value);
    if (velocity == null) {
      setVolumePopover({ ...volumePopover, error: true });
      return;
    }
    updateCells(targetKeys(volumePopover.rowId, volumePopover.step), (cell) => ({ ...cell, velocity }));
    setVolumePopover(null);
  }

  function clearVolume() {
    if (!volumePopover) return;
    updateCells(targetKeys(volumePopover.rowId, volumePopover.step), (cell) => ({ ...cell, velocity: undefined }));
    setVolumePopover(null);
  }

  function applyLean() {
    if (!leanPopover) return;
    const leanPercent = parseLeanInput(leanPopover.value);
    if (leanPercent == null) {
      setLeanPopover({ ...leanPopover, error: true });
      return;
    }
    updateCells(targetKeys(leanPopover.rowId, leanPopover.step), (cell) => ({ ...cell, leanPercent }));
    setLeanPopover(null);
  }

  function clearLean() {
    if (!leanPopover) return;
    updateCells(targetKeys(leanPopover.rowId, leanPopover.step), (cell) => ({ ...cell, leanPercent: undefined }));
    setLeanPopover(null);
  }

  function startVolumeDrag(e: React.PointerEvent<HTMLSpanElement>, rowId: string, step: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const cellButton = e.currentTarget.closest("button");
    if (!(cellButton instanceof HTMLElement)) return;
    const rect = cellButton.getBoundingClientRect();
    volumeDragRef.current = { rowId, step, pointerId: e.pointerId, rect };
    e.currentTarget.setPointerCapture(e.pointerId);
    applyVolumeFromPointer(e.clientY, rowId, step, rect);
  }

  function dragVolume(e: React.PointerEvent<HTMLSpanElement>) {
    const drag = volumeDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    applyVolumeFromPointer(e.clientY, drag.rowId, drag.step, drag.rect);
  }

  function endVolumeDrag(e: React.PointerEvent<HTMLSpanElement>) {
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

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "0") {
      e.preventDefault();
      setCellSize(DEFAULT_CELL_SIZE);
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (selectedCells.size === 0) return;
    const first = parseCellKey(Array.from(selectedCells)[0]);
    if (!first) return;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      updateCells(selectedCells, () => ({ on: false }));
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copyCells(first.rowId, first.step);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteCells(first.rowId, first.step);
    }
  }

  const activeTimeSignature = segmentTimeSignature ?? timeSignature;
  const sequenceStyle = {
    "--step-count": stepCount,
    "--play-step": playStep ?? 0,
    "--cell-width": `${cellSize}px`,
    "--cell-height": `${DEFAULT_CELL_SIZE}px`,
  } as CSSProperties;

  return (
    <div ref={wrapRef} className={styles.wrap} tabIndex={-1} onKeyDown={handleKeyDown}>
      <div className={styles.toolbar}>
        <NumberInput
          layout="inline"
          label="Length"
          value={lengthBeats}
          min={1}
          max={DRUM_MAX_STEPS}
          step={1}
          maxLength={3}
          onChange={resizeLength}
        />
        {onDefaultPitchChange && (
          <NumberInput
            layout="inline"
            label="Pitch"
            value={Math.round(defaultPitchHz ?? noteFrequency(DEFAULT_DRUM_MIDI_PITCH, fallbackInstrument))}
            min={20}
            max={20000}
            step={1}
            unit="Hz"
            onChange={onDefaultPitchChange}
          />
        )}
        {onSwingChange && (
          <label className={styles.swingControl}>
            <span className={styles.swingHeader}>
              <span className={styles.swingLabel}>Swing</span>
              <span className={styles.swingValue}>{sanitizeSwingPercent(swingPercent)}%</span>
            </span>
            <input
              className={styles.swingRange}
              type="range"
              min={0}
              max={100}
              step={1}
              value={sanitizeSwingPercent(swingPercent)}
              onChange={(event) => onSwingChange(Number(event.currentTarget.value))}
            />
          </label>
        )}
        {onTimeSignatureChange && (
          <TimeSignatureControl
            value={activeTimeSignature}
            ariaLabel="Drum time signature"
            onChange={onTimeSignatureChange}
          />
        )}
        <div className={styles.generateBlock}>
          <FloatingSelect
            fillHeight
            label="Genre"
            layout="inline"
            value={generateGenre}
            ariaLabel="Generated beat genre"
            options={DRUM_GENRES.map((genre) => ({ value: genre, label: genreLabel(genre) }))}
            open={generateGenreOpen}
            onOpenChange={(open) => {
              setGenerateGenreOpen(open);
              if (open) setOpenRowId(null);
            }}
            onChange={(value) => setGenerateGenre(value as DrumGenre)}
          />
          <label className={styles.complexityControl}>
            <span className={styles.complexityHeader}>
              <span className={styles.complexityLabel}>Complexity</span>
              <span className={styles.complexityValue}>{generateComplexity}</span>
            </span>
            <input
              className={styles.complexityRange}
              type="range"
              min={0}
              max={100}
              step={1}
              value={generateComplexity}
              onInput={(event) => setGenerateComplexity(Number(event.currentTarget.value))}
              onChange={(event) => setGenerateComplexity(Number(event.currentTarget.value))}
              aria-label="Generated beat complexity"
            />
          </label>
          <Button
            className={styles.generateButton}
            iconOnly
            size="xs"
            onClick={generateBeat}
            aria-label="Generate beat"
            disabled={generating}
          >
            <Icon name={generating ? "ph:spinner" : "ph:sparkle"} size={14} decorative />
          </Button>
        </div>
        {lastGeneratedBeat && !feedbackSubmitted && (
          <div className={styles.feedbackBlock} aria-label="Generated beat feedback">
            <HoverInfo content="Good generation">
              <Button
                iconOnly
                size="xs"
                selected={feedbackRating === "up"}
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
                selected={feedbackRating === "down"}
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
        {feedbackSubmitted && <span className={styles.feedbackDone}>Thumbs {feedbackSubmitted === "up" ? "up" : "down"} saved</span>}
      </div>
      <div className={styles.sequenceShell} style={sequenceStyle}>
        <div className={styles.instrumentColumn}>
          <div className={styles.headerStub} aria-hidden />
          {rows.map((row) => (
            <div key={row.id} className={styles.rowControls}>
              <FloatingSelect
                fillHeight
                value={row.instrumentId ?? ""}
                ariaLabel={`${row.name} instrument`}
                options={instruments.map((instrument) => ({
                  value: instrument.id,
                  label: instrument.name,
                }))}
                open={openRowId === row.id}
                onOpenChange={(open) => {
                  setOpenRowId(open ? row.id : null);
                  setCellMenu(null);
                  setPitchPopover(null);
                  setVolumePopover(null);
                }}
                onChange={(instrumentId) => {
                  const instrument = instruments.find((candidate) => candidate.id === instrumentId);
                  updateRow(row.id, {
                    instrumentId,
                    name: instrument?.name ?? row.name,
                  });
                }}
              />
              <HoverInfo content="Remove row">
                <Button
                  className={styles.rowRemoveButton}
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
          <div className={styles.addRowControls}>
            <Button size="sm" onClick={addRow} fullWidth>
              <Icon name="ph:plus" size={14} decorative />
              Instrument
            </Button>
            {onUploadRow && (
              <Button iconOnly size="xs" onClick={onUploadRow} aria-label="Upload drum instrument row">
                <Icon name="ph:upload" size={14} decorative />
              </Button>
            )}
          </div>
        </div>

        <div className={styles.stepScroller}>
          <div className={styles.stepPlane}>
            {playStep != null && <div className={styles.playColumn} aria-hidden />}
            <div className={styles.stepHeader}>
              {Array.from({ length: stepCount }, (_, step) => (
                <div
                  key={step}
                  className={`${styles.stepNumber} ${isStrongBeat(step, speed, activeTimeSignature) ? styles.stepStrong : ""}`}
                  style={swingStepStyle(step, swingPercent, cellSize)}
                >
                  {step + 1}
                </div>
              ))}
            </div>

            <div className={styles.stepRows}>
              {rows.map((row) => (
                <div key={row.id} className={styles.stepGrid}>
                  {normalizeDrumSteps(row.steps, stepCount).map((cell, step) => {
                    const selected = selectedCells.has(cellKey(row.id, step));
                    const customVolume = hasCustomDrumVelocity(row.steps[step]);
                    const volumePercent = customVolume ? velocityToPercent(effectiveDrumVelocity(cell)) : 0;
                    return (
                      <button
                        key={step}
                        type="button"
                        className={[
                          styles.stepCell,
                          isStrongBeat(step, speed, activeTimeSignature) && styles.stepStrong,
                          cell.on && styles.stepCellOn,
                          selected && styles.stepCellSelected,
                          cell.pitchHz && styles.stepCellTuned,
                          customVolume && styles.stepCellCustomVolume,
                        ].filter(Boolean).join(" ")}
                        style={{
                          ...swingStepStyle(step, swingPercent, cellSize),
                          ...(customVolume ? { "--cell-volume": `${volumePercent}%` } as CSSProperties : null),
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
                          <span className={styles.cellNote}>{frequencyToNoteName(cell.pitchHz)}</span>
                        )}
                        {cell.leanPercent != null && (
                          <span
                            className={styles.cellLean}
                            style={{ "--cell-lean": `${Math.max(-20, Math.min(20, cell.leanPercent * 0.4))}deg` } as CSSProperties}
                            title={`${leanToDisplay(cell.leanPercent)}% (${cell.leanPercent >= 0 ? "+" : ""}${cell.leanPercent}%)`}
                          />
                        )}
                        {customVolume && (
                          <span
                            className={styles.cellVolume}
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
              <div className={styles.addRowSpacer} aria-hidden />
            </div>
          </div>
        </div>
      </div>

      <div className={styles.transportRow}>
        <RadioGroup
          label="Speed"
          ariaLabel="Drum speed"
          value={speed}
          options={DRUM_SPEEDS.map((option) => ({ value: option, label: String(option) }))}
          onChange={changeSpeed}
        />
        <div className={styles.transportBlock}>
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
          <HoverInfo content={playing ? "Pause" : "Play"}>
            <Button
              iconOnly
              size="xs"
              variant={playing ? "primary" : "default"}
              onClick={playing ? stop : play}
              aria-label={playing ? "Pause drum sequence" : "Play drum sequence"}
            >
              <Icon name={playing ? "ph:pause-fill" : "ph:play-fill"} size={16} decorative />
            </Button>
          </HoverInfo>
        </div>
        <div className={styles.zoomControl}>
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

      {cellMenu && (
        <CellMenu
          state={cellMenu}
          hasClipboard={Boolean(cellClipboardRef.current)}
          selectionSize={targetKeys(cellMenu.rowId, cellMenu.step).size}
          onShiftPitch={() => {
            const row = rows.find((candidate) => candidate.id === cellMenu.rowId);
            const cell = normalizeDrumCell(row?.steps[cellMenu.step]);
            setPitchPopover({
              ...cellMenu,
              value: formatFrequency(cell.pitchHz),
              error: false,
            });
            setVolumePopover(null);
            setCellMenu(null);
          }}
          onVolume={() => {
            const row = rows.find((candidate) => candidate.id === cellMenu.rowId);
            const cell = normalizeDrumCell(row?.steps[cellMenu.step]);
            setVolumePopover({
              ...cellMenu,
              value: String(velocityToPercent(effectiveDrumVelocity(cell))),
              error: false,
            });
            setPitchPopover(null);
            setLeanPopover(null);
            setCellMenu(null);
          }}
          onLean={() => {
            const row = rows.find((candidate) => candidate.id === cellMenu.rowId);
            const cell = normalizeDrumCell(row?.steps[cellMenu.step]);
            setLeanPopover({
              ...cellMenu,
              value: String(leanToDisplay(cell.leanPercent)),
              error: false,
            });
            setPitchPopover(null);
            setVolumePopover(null);
            setCellMenu(null);
          }}
          onCopy={() => {
            copyCells(cellMenu.rowId, cellMenu.step);
            setCellMenu(null);
          }}
          onPaste={() => {
            pasteCells(cellMenu.rowId, cellMenu.step);
            setCellMenu(null);
          }}
          onReset={() => {
            resetCells(cellMenu.rowId, cellMenu.step);
            setCellMenu(null);
          }}
        />
      )}

      {pitchPopover && (
        <PitchPopover
          state={pitchPopover}
          onChange={(value) => setPitchPopover({ ...pitchPopover, value, error: false })}
          onApply={applyPitch}
          onClear={clearPitch}
        />
      )}

      {volumePopover && (
        <VolumePopover
          state={volumePopover}
          onChange={(value) => setVolumePopover({ ...volumePopover, value, error: false })}
          onApply={applyVolume}
          onClear={clearVolume}
        />
      )}

      {leanPopover && (
        <LeanPopover
          state={leanPopover}
          onChange={(value) => setLeanPopover({ ...leanPopover, value, error: false })}
          onApply={applyLean}
          onClear={clearLean}
        />
      )}
      {feedbackPopover && (
        <FeedbackPopover
          state={feedbackPopover}
          onChange={(value) => setFeedbackPopover({ ...feedbackPopover, value })}
          onSubmit={() => {
            const value = feedbackPopover.value.trim();
            setFeedbackPopover(null);
            void rateGeneratedBeat("down", value || undefined);
          }}
        />
      )}
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
    <FloatingLayer className={styles.cellMenu} x={state.x} y={state.y} role="menu">
      <button type="button" className={styles.cellMenuItem} onClick={onShiftPitch} role="menuitem">
        Shift pitch
      </button>
      <button type="button" className={styles.cellMenuItem} onClick={onVolume} role="menuitem">
        Volume
      </button>
      <button type="button" className={styles.cellMenuItem} onClick={onLean} role="menuitem">
        Lean beat…
      </button>
      <button type="button" className={styles.cellMenuItem} onClick={onCopy} role="menuitem">
        Copy{labelSuffix}
      </button>
      <button type="button" className={styles.cellMenuItem} onClick={onPaste} disabled={!hasClipboard} role="menuitem">
        Paste
      </button>
      <button type="button" className={styles.cellMenuItem} onClick={onReset} role="menuitem">
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
    <FloatingLayer className={styles.valuePopover} x={state.x} y={state.y}>
      <TextInput
        autoFocus
        className={styles.valueField}
        label="Lean"
        layout="inline"
        value={state.value}
        placeholder="0-100"
        unit="%"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onApply();
        }}
      />
      {state.error && <div className={styles.valueError}>Use 0 to 100%</div>}
      <div className={styles.valueActions}>
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
    <FloatingLayer className={styles.pitchPopover} x={state.x} y={state.y}>
      <TextInput
        autoFocus
        className={styles.pitchField}
        label="Pitch"
        layout="inline"
        value={state.value}
        placeholder="C4 or 440"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onApply();
        }}
      />
      {state.error && <div className={styles.pitchError}>Use note or Hz</div>}
      <div className={styles.pitchActions}>
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
    <FloatingLayer className={styles.valuePopover} x={state.x} y={state.y}>
      <TextInput
        autoFocus
        className={styles.valueField}
        label="Volume"
        layout="inline"
        value={state.value}
        placeholder="0-100%"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onApply();
        }}
      />
      {state.error && <div className={styles.valueError}>Use 0-100%</div>}
      <div className={styles.valueActions}>
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
    <FloatingLayer className={styles.valuePopover} x={state.x} y={state.y}>
      <TextInput
        autoFocus
        className={styles.valueField}
        label="Issue"
        layout="inline"
        value={state.value}
        placeholder="What felt wrong?"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
      />
      <div className={styles.valueActions}>
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

function swingStepStyle(step: number, swingPercent: number, cellSize: number): CSSProperties | undefined {
  const swing = sanitizeSwingPercent(swingPercent);
  if (swing === 50 || step % 2 !== 0) return undefined;
  const marginRight = Math.max(-cellSize * 0.35, Math.min(cellSize * 0.5, ((swing - 50) / 50) * cellSize * 0.5));
  return { marginRight };
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
