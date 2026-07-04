import { For, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import {
  AETHER_NOTE_AUTOMATION_TARGETS,
  type AetherNoteAutomationPointClipboard,
  aetherNoteAutomationTargetLabel,
  aetherNoteAutomationTargetMeta,
  clearMidiNoteAutomationTarget,
  copyMidiNoteAutomationPoints,
  denormalizeAetherNoteAutomationValue,
  formatAetherNoteAutomationValue,
  insertMidiNoteAutomationPoint,
  midiNoteAutomationTargetCount,
  midiNoteHasAutomationTarget,
  normalizeAetherNoteAutomationValue,
  offsetMidiNoteAutomation,
  pasteMidiNoteAutomationPoints,
  quantizeMidiNoteAutomationPoints,
  removeMidiNoteAutomationPoint,
  selectedMidiNoteAutomationCurve,
  selectedMidiNoteAutomationEffectiveBadge,
  selectedMidiNoteAutomationSummary,
  selectedMidiNoteAutomationValueRange,
  setMidiNoteAutomationTargetCurve,
  setMidiNoteAutomationTargetValues,
  snapMidiNoteAutomationPointValues,
  updateMidiNoteAutomationPoint,
  upsertMidiNoteAutomationTarget,
} from "../../automation/aetherNoteAutomation";
import { AUTOMATION_CURVES, automationCurveLabel } from "../../automation/curves";
import { Button, FloatingLayer, FloatingSelect, HoverInfo, Icon } from "../../solid-ui";
import { useContextualHotkey } from "../../solid-utils/contextualHotkeys.solid";
import { useSettingsStore } from "../../state/store";
import { createStoreSelector } from "../../solid-utils/store";
import type { MidiAutomationTarget, MidiNote } from "../../state/types";
import styles from "./PianoRoll.module.css";

export interface PianoRollProps {
  notes: MidiNote[];
  /** Visible time span in beats. */
  lengthBeats: number;
  /** Current playhead position relative to this segment, in beats. */
  playheadBeat?: number | null;
  hotkeyScopeId?: string;
  onLengthChange?: (lengthBeats: number) => void;
  onChange: (notes: MidiNote[]) => void;
  onPreviewNote?: (pitch: number, velocity?: number) => void;
  /** Advanced per-note Aether automation. Hidden by default so the piano roll stays a plain MIDI editor. */
  showAutomation?: boolean;
}

/**
 * PianoRoll — horizontal MIDI editor.
 *
 * Interaction model:
 *   - Click an empty cell → add a note (default 1/2 beat, vel 100).
 *   - Click a note       → select it.
 *   - Drag note body     → move pitch and time.
 *   - Drag right edge    → extend duration.
 *   - Backspace / Delete → remove selected() note.
 *   - Shift-click        → multi-select (additive).
 *
 * Notes render with white outline / black fill per design rule. The grid
 * uses the inside-object opacity scale (faint, bold for every beat).
 */
const DEFAULT_PX_PER_BEAT = 48;
const MIN_PX_PER_BEAT = 24;
const MAX_PX_PER_BEAT = 384;
const ZOOM_STEP = 8;
const PX_PER_PITCH = 16;
const VIEW_HEIGHT = 520;
const TOP_PITCH = 96;     // C7
const BOTTOM_PITCH = 36;  // C2
const PITCH_RANGE = TOP_PITCH - BOTTOM_PITCH + 1;
const KEY_LABEL_WIDTH = 48;
const DEFAULT_NOTE_LENGTH_BEATS = 0.25;
const MIN_NOTE_LENGTH_BEATS = 1 / 64;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

let midiNoteClipboard: MidiNoteClipboard | null = null;
type MidiToolMode = "draw" | "select";

function createRef<T>(initial: T) {
  return { current: initial };
}

function createPortal(children: JSX.Element, mount: HTMLElement) {
  return <Portal mount={mount}>{children}</Portal>;
}

function px(value: number): string {
  return `${value}px`;
}

function roundTo(value: number, step: number): number {
  const precision = Math.max(0, Math.ceil(Math.log10(1 / Math.max(0.000001, step))));
  return Number(value.toFixed(Math.min(6, precision)));
}

function createCompatEffect(effect: () => void | (() => void), _deps?: unknown[]) {
  createEffect(() => {
    const cleanup = effect();
    if (cleanup) onCleanup(cleanup);
  });
}

export function PianoRoll(props: PianoRollProps) {
  const notes = new Proxy([] as MidiNote[], {
    get: (_target, property) => Reflect.get(props.notes, property),
  });
  const lengthBeats = {
    valueOf: () => props.lengthBeats,
  } as number;
  const onLengthChange = (nextLengthBeats: number) => props.onLengthChange?.(nextLengthBeats);
  const onChange = (nextNotes: MidiNote[]) => props.onChange(nextNotes);
  const onPreviewNote = (pitch: number, velocity?: number) => props.onPreviewNote?.(pitch, velocity);
  const containerRef = createRef<HTMLDivElement | null>(null);
  const keysScrollRef = createRef<HTMLDivElement | null>(null);
  const timeScrollRef = createRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = createSignal<number[]>([]);
  const [pxPerBeat, setPxPerBeat] = createSignal(DEFAULT_PX_PER_BEAT);
  const [selectBox, setSelectBox] = createSignal<Rect | null>(null);
  const [noteMenu, setNoteMenu] = createSignal<{ x: number; y: number; idx: number; target: PasteTarget } | null>(null);
  const [gridMenu, setGridMenu] = createSignal<{ x: number; y: number; target: PasteTarget } | null>(null);
  const [volumePopover, setVolumePopover] = createSignal<VolumePopoverState | null>(null);
  const [noteEditor, setNoteEditor] = createSignal<NoteEditorState | null>(null);
  const [hoveredNoteSide, setHoveredNoteSide] = createSignal<{ idx: number; side: "left" | "right" } | null>(null);
  const [toolMode, setToolMode] = createSignal<MidiToolMode>("draw");
  const [activeAutomationTarget, setActiveAutomationTarget] = createSignal<MidiAutomationTarget>("amp.level");
  const [dragActive, setDragActive] = createSignal(false);
  const [lengthHandleActive, setLengthHandleActive] = createSignal(false);
  const [connectFrom, setConnectFrom] = createSignal<number | null>(null);
  const [connectPointer, setConnectPointer] = createSignal<{ x: number; y: number } | null>(null);
  const [curveFrom, setCurveFrom] = createSignal<number | null>(null);
  const [curvePointer, setCurvePointer] = createSignal<{ x: number; y: number } | null>(null);
  const [draggedAutomationEdge, setDraggedAutomationEdge] = createSignal<"start" | "mid" | "end" | null>(null);
  const [automationCurveSelectOpen, setAutomationCurveSelectOpen] = createSignal(false);
  const [automationPointClipboard, setAutomationPointClipboard] = createSignal<AetherNoteAutomationPointClipboard | null>(null);
  const [selectedAutomationPointIndices, setSelectedAutomationPointIndices] = createSignal<number[]>([]);
  const lastDrawnLengthRef = createRef(DEFAULT_NOTE_LENGTH_BEATS);
  const lastPointerTargetRef = createRef<PasteTarget | null>(null);
  const historyRef = createRef<MidiNote[][]>([]);
  const dragAuditionRef = createRef<{ idx: number; pitch: number } | null>(null);
  const automationDragHistoryPushedRef = createRef(false);
  const [auditionedNoteIndex, setAuditionedNoteIndex] = createSignal<number | null>(null);
  const midiSmartGrid = createStoreSelector(useSettingsStore, (s) => s.midiSmartGrid);
  const midiSubdivision = createStoreSelector(useSettingsStore, (s) => s.midiSubdivision);
  const drag = createRef<
    | {
        mode: "draw";
        idx: number;
        anchorBeat: number;
        initialLength: number;
        currentLength: number;
      }
    | {
        mode: "move";
        indices: number[];
        startX: number;
        startY: number;
        startNotes: Array<Pick<MidiNote, "startBeat" | "pitch" | "lengthBeats"> & { curve?: MidiNote["curve"]; automation?: MidiNote["automation"] }>;
        historyPushed?: boolean;
      }
    | {
        mode: "resize";
        indices: number[];
        edge: "left" | "right";
        startX: number;
        startNotes: Array<Pick<MidiNote, "startBeat" | "lengthBeats"> & { curve?: MidiNote["curve"]; automation?: MidiNote["automation"] }>;
        historyPushed?: boolean;
      }
    | { mode: "curve-handle"; idx: number; edge: "start" | "end"; historyPushed?: boolean }
    | { mode: "length-resize"; startX: number; startLengthBeats: number }
    | { mode: "select"; anchorX: number; anchorY: number; pointerId: number }
    | null
  >(null);
  let auditionTimer: number | null = null;

  function clearDragAudition() {
    dragAuditionRef.current = null;
    setAuditionedNoteIndex(null);
    if (auditionTimer != null) {
      window.clearTimeout(auditionTimer);
      auditionTimer = null;
    }
  }

  function previewDraggedNote(idx: number, pitch: number, velocity?: number) {
    if (dragAuditionRef.current?.idx === idx && dragAuditionRef.current.pitch === pitch) return;
    dragAuditionRef.current = { idx, pitch };
    onPreviewNote(pitch, velocity);
    setAuditionedNoteIndex(idx);
    if (auditionTimer != null) window.clearTimeout(auditionTimer);
    auditionTimer = window.setTimeout(() => {
      setAuditionedNoteIndex((current) => current === idx ? null : current);
      auditionTimer = null;
    }, 150);
  }

  onCleanup(() => {
    if (auditionTimer != null) window.clearTimeout(auditionTimer);
  });

  const width = () => lengthBeats * pxPerBeat();
  const height = PITCH_RANGE * PX_PER_PITCH;
  const gridLines = createMemo(() => makeGridLines(lengthBeats, pxPerBeat()));
  const selectedAutomationSummary = createMemo(() =>
    selectedMidiNoteAutomationSummary(props.notes, selected(), activeAutomationTarget())
  );
  const selectedAutomationEffective = createMemo(() =>
    selectedMidiNoteAutomationEffectiveBadge(props.notes, selected(), activeAutomationTarget())
  );
  const activeAutomationMeta = createMemo(() => aetherNoteAutomationTargetMeta(activeAutomationTarget()));
  const selectedAutomationValueRange = createMemo(() =>
    selectedMidiNoteAutomationValueRange(props.notes, selected(), activeAutomationTarget())
  );
  const selectedAutomationCurve = createMemo(() =>
    selectedMidiNoteAutomationCurve(props.notes, selected(), activeAutomationTarget())
  );
  const selectedAutomationPoints = createMemo(() => {
    if (activeAutomationTarget() === "pitch") return [];
    const firstSelectedNote = selected().map((index) => props.notes[index]).find(Boolean) as MidiNote | undefined;
    if (!firstSelectedNote) return [];
    const lane = firstSelectedNote.automation?.find((candidate) => candidate.target === activeAutomationTarget());
    return (lane?.points ?? []).map((point) => ({
      beat: Math.max(0, point.beat - firstSelectedNote.startBeat),
      value: point.value,
    }));
  });
  const activeSelectedAutomationPointIndices = createMemo(() =>
    selectedAutomationPointIndices().filter((index) => index >= 0 && index < selectedAutomationPoints().length)
  );
  createEffect(() => {
    activeAutomationTarget();
    selected().join(",");
    setSelectedAutomationPointIndices([]);
  });
  const selectedAutomationPointLength = createMemo(() => {
    const firstSelectedNote = selected().map((index) => props.notes[index]).find(Boolean) as MidiNote | undefined;
    return Math.max(MIN_NOTE_LENGTH_BEATS, firstSelectedNote?.lengthBeats ?? DEFAULT_NOTE_LENGTH_BEATS);
  });
  const nextAutomationPointBeat = createMemo(() => {
    const length = selectedAutomationPointLength();
    const beats = selectedAutomationPoints()
      .map((point) => clamp(point.beat, 0, length))
      .sort((a, b) => a - b);
    if (beats.length === 0) return length / 2;
    const gaps = [
      { start: 0, end: beats[0] },
      ...beats.slice(1).map((beat, index) => ({ start: beats[index], end: beat })),
      { start: beats[beats.length - 1], end: length },
    ].filter((gap) => gap.end - gap.start > 0.000001);
    if (gaps.length === 0) return length / 2;
    const widest = gaps.reduce((best, gap) =>
      gap.end - gap.start > best.end - best.start ? gap : best
    );
    return (widest.start + widest.end) / 2;
  });
  const automationCurveOptions = AUTOMATION_CURVES.map((curve) => ({ value: curve, label: automationCurveLabel(curve) }));

  useContextualHotkey(
    () => props.hotkeyScopeId ?? "",
    "d",
    () => {
      setToolMode("draw");
      return true;
    },
    () => Boolean(props.hotkeyScopeId),
  );

  useContextualHotkey(
    () => props.hotkeyScopeId ?? "",
    "s",
    () => {
      setToolMode("select");
      return true;
    },
    () => Boolean(props.hotkeyScopeId),
  );

  // Keep selected() indices valid if notes shrink.
  createCompatEffect(() => {
    setSelected((prev) => prev.filter((i) => i >= 0 && i < notes.length));
  }, [notes.length]);

  createCompatEffect(() => {
    if (!noteEditor() && !volumePopover()) return;
    function closeNoteDetails(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-midi-note-detail]")) return;
      setNoteEditor(null);
      setVolumePopover(null);
    }
    window.addEventListener("pointerdown", closeNoteDetails, true);
    return () => window.removeEventListener("pointerdown", closeNoteDetails, true);
  }, [noteEditor(), volumePopover()]);

  createCompatEffect(() => {
    const scroll = timeScrollRef.current;
    if (!scroll) return;
    const c4Center = (TOP_PITCH - 60) * PX_PER_PITCH + PX_PER_PITCH / 2;
    scroll.scrollTop = Math.max(0, c4Center - VIEW_HEIGHT / 2);
    syncKeyScroll();
  }, []);

  createCompatEffect(() => {
    if (!dragActive()) return;
    function finishDrag() {
      onNotePointerUp();
    }
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [dragActive(), notes, selectBox()]);

  function pitchFromY(y: number): number {
    const row = Math.floor(y / PX_PER_PITCH);
    return TOP_PITCH - row;
  }
  function curvePitchFromY(y: number, snapToNote: boolean): number {
    const pitch = TOP_PITCH - y / PX_PER_PITCH;
    const next = snapToNote ? Math.round(pitch) : Math.round(pitch * 100) / 100;
    return clamp(next, BOTTOM_PITCH, TOP_PITCH);
  }
  function beatFromX(x: number): number {
    return Math.max(0, Math.min(lengthBeats, x / pxPerBeat()));
  }
  function targetFromClient(clientX: number, clientY: number): PasteTarget {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { beat: 0, pitch: BOTTOM_PITCH };
    const beat = beatFromX(clientX - rect.left);
    const pitch = clamp(pitchFromY(clientY - rect.top), BOTTOM_PITCH, TOP_PITCH);
    return { beat, pitch };
  }
  function snap(beat: number): number {
    if (!midiSmartGrid()) return beat;
    const factor = midiSubdivision() / 4;
    return Math.round(beat * factor) / factor;
  }
  function snapShiftDrag(beat: number): number {
    return Math.round(beat * 4) / 4;
  }

  function pushHistorySnapshot() {
    historyRef.current.push(structuredClone(props.notes));
    if (historyRef.current.length > 100) historyRef.current.shift();
  }

  function commitChange(next: MidiNote[]) {
    pushHistorySnapshot();
    onChange(next);
  }

  function applyTransientChange(next: MidiNote[]) {
    onChange(next);
  }

  function ensureDragHistory(
    d: Extract<NonNullable<typeof drag.current>, { historyPushed?: boolean }>,
  ) {
    if (d.historyPushed) return;
    pushHistorySnapshot();
    d.historyPushed = true;
  }

  function undoLocal() {
    const previous = historyRef.current.pop();
    if (!previous) return;
    onChange(previous);
    setSelected((prev) => prev.filter((idx) => previous[idx]));
  }

  function onGridPointerDown(e: PointerEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    e.preventDefault();
    setNoteMenu(null);
    setGridMenu(null);
    setVolumePopover(null);
    setNoteEditor(null);
    (e.target as Element).setPointerCapture(e.pointerId);
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    lastPointerTargetRef.current = { beat: beatFromX(x), pitch: clamp(pitchFromY(y), BOTTOM_PITCH, TOP_PITCH) };
    if (connectFrom() != null) {
      setConnectFrom(null);
      setConnectPointer(null);
      return;
    }
    const activeCurveFrom = curveFrom();
    if (activeCurveFrom != null) {
      completeCurve(activeCurveFrom, {
        beat: e.shiftKey ? snapShiftDrag(beatFromX(x)) : beatFromX(x),
        pitch: clamp(pitchFromY(y), BOTTOM_PITCH, TOP_PITCH),
      });
      return;
    }
    if (toolMode() === "select" || e.altKey) {
      startMarquee(x, y, e.pointerId);
      return;
    }
    const beat = e.shiftKey ? snapShiftDrag(beatFromX(x)) : beatFromX(x);
    const pitch = pitchFromY(y);
    const initialLength = clamp(lastDrawnLengthRef.current, MIN_NOTE_LENGTH_BEATS, Math.max(MIN_NOTE_LENGTH_BEATS, lengthBeats - beat));
    const newNote: MidiNote = {
      pitch,
      velocity: 127,
      startBeat: beat,
      lengthBeats: initialLength,
    };
    const next = [...notes, newNote];
    commitChange(next);
    const idx = next.length - 1;
    setSelected([idx]);
    drag.current = { mode: "draw", idx, anchorBeat: beat, initialLength, currentLength: initialLength };
    setDragActive(true);
    onPreviewNote?.(pitch, newNote.velocity);
  }

  function onTimeScrollPointerDown(e: PointerEvent) {
    if (e.target !== e.currentTarget || toolMode() !== "select" || e.button !== 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    if (y < 0 || y > height) return;
    e.preventDefault();
    setNoteMenu(null);
    setGridMenu(null);
    setVolumePopover(null);
    setNoteEditor(null);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    startMarquee(e.clientX - rect.left, y, e.pointerId);
  }

  function startMarquee(anchorX: number, anchorY: number, pointerId: number) {
    const y = clamp(anchorY, 0, height);
    drag.current = { mode: "select", anchorX, anchorY: y, pointerId };
    setSelectBox({ left: anchorX, top: y, width: 0, height: 0 });
    setDragActive(true);
  }

  function startLengthResize(e: PointerEvent) {
    if (!onLengthChange || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setNoteMenu(null);
    setGridMenu(null);
    setVolumePopover(null);
    setNoteEditor(null);
    drag.current = { mode: "length-resize", startX: e.clientX, startLengthBeats: lengthBeats };
    setLengthHandleActive(true);
    setDragActive(true);
  }

  function startMove(idx: number, e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    setNoteMenu(null);
    setGridMenu(null);
    setVolumePopover(null);
    const activeConnectFrom = connectFrom();
    if (activeConnectFrom != null) {
      if (activeConnectFrom !== idx) {
        commitChange(connectNotes(notes, activeConnectFrom, idx));
      }
      setConnectFrom(null);
      setConnectPointer(null);
      return;
    }
    const activeCurveFrom = curveFrom();
    if (activeCurveFrom != null) {
      completeCurve(activeCurveFrom, targetFromClient(e.clientX, e.clientY));
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    if (e.altKey) {
      const sourceIndices = selected().includes(idx) ? selected() : [idx];
      const duplicated = duplicateNotes(notes, sourceIndices);
      if (duplicated.indices.length === 0) return;
      commitChange(duplicated.notes);
      setSelected(duplicated.indices);
      drag.current = {
        mode: "move",
        indices: duplicated.indices,
        startX: e.clientX,
        startY: e.clientY,
        startNotes: duplicated.indices.map((i) => ({
          startBeat: duplicated.notes[i].startBeat,
          pitch: duplicated.notes[i].pitch,
          lengthBeats: duplicated.notes[i].lengthBeats,
          curve: structuredClone(duplicated.notes[i].curve),
          automation: structuredClone(duplicated.notes[i].automation),
        })),
        historyPushed: true,
      };
      const auditionIdx = duplicated.indices.length === 1 ? duplicated.indices[0] : null;
      dragAuditionRef.current = auditionIdx == null
        ? null
        : { idx: auditionIdx, pitch: duplicated.notes[auditionIdx]?.pitch ?? -1 };
      setDragActive(true);
      return;
    }
    const indices = selected().includes(idx) ? selected() : [idx];
    drag.current = {
      mode: "move",
      indices,
      startX: e.clientX,
      startY: e.clientY,
      startNotes: indices.map((i) => ({
        startBeat: notes[i].startBeat,
        pitch: notes[i].pitch,
        lengthBeats: notes[i].lengthBeats,
        curve: structuredClone(notes[i].curve),
        automation: structuredClone(notes[i].automation),
      })),
    };
    const auditionIdx = indices.length === 1 ? indices[0] : null;
    dragAuditionRef.current = auditionIdx == null
      ? null
      : { idx: auditionIdx, pitch: notes[auditionIdx]?.pitch ?? -1 };
    setDragActive(true);
    setSelected(e.shiftKey
      ? selected().includes(idx) ? selected() : [...selected(), idx]
      : [idx]);
  }

  function startResize(idx: number, edge: "left" | "right", e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const indices = selected().includes(idx) ? selected() : [idx];
    drag.current = {
      mode: "resize",
      indices,
      edge,
      startX: e.clientX,
      startNotes: indices.map((i) => ({
        startBeat: notes[i].startBeat,
        lengthBeats: notes[i].lengthBeats,
        curve: structuredClone(notes[i].curve),
        automation: structuredClone(notes[i].automation),
      })),
    };
    setDragActive(true);
    setSelected(indices);
  }

  function onNotePointerMove(e: PointerEvent) {
    const d = drag.current;
    if (connectFrom() != null) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setConnectPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    if (curveFrom() != null) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setCurvePointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    if (!d) return;
    if (d.mode === "draw") {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const currentBeat = e.shiftKey ? snapShiftDrag(beatFromX(e.clientX - rect.left)) : beatFromX(e.clientX - rect.left);
      const startBeat = Math.min(d.anchorBeat, currentBeat);
      const drawnLength = Math.abs(currentBeat - d.anchorBeat);
      const length = drawnLength > 0 ? Math.max(DEFAULT_NOTE_LENGTH_BEATS, drawnLength) : d.initialLength;
      d.currentLength = Math.min(length, lengthBeats - startBeat);
      const next = notes.slice();
      if (!next[d.idx]) return;
      next[d.idx] = {
        ...next[d.idx],
        startBeat,
        lengthBeats: d.currentLength,
      };
      applyTransientChange(next);
    } else if (d.mode === "move") {
      ensureDragHistory(d);
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const rawBeatDelta = dx / pxPerBeat();
      const dPitch = -Math.round(dy / PX_PER_PITCH);
      const next = notes.slice();
      d.indices.forEach((idx, groupIdx) => {
        if (!next[idx]) return;
        const start = d.startNotes[groupIdx];
        const rawStartBeat = start.startBeat + rawBeatDelta;
        const startBeat = clamp(e.shiftKey ? snap(rawStartBeat) : rawStartBeat, 0, lengthBeats - start.lengthBeats);
        const pitch = clamp(start.pitch + dPitch, BOTTOM_PITCH, TOP_PITCH);
        next[idx] = {
          ...next[idx],
          startBeat,
          pitch,
          curve: shiftCurveWithNote(start.curve, start.pitch, startBeat, pitch, start.lengthBeats),
          automation: offsetMidiNoteAutomation(start.automation, startBeat - start.startBeat),
        };
      });
      if (d.indices.length === 1) {
        const idx = d.indices[0];
        const moved = next[idx];
        if (moved) previewDraggedNote(idx, moved.pitch, moved.velocity);
      }
      applyTransientChange(next);
    } else if (d.mode === "resize") {
      ensureDragHistory(d);
      const dx = e.clientX - d.startX;
      const dLen = e.shiftKey ? snapShiftDrag(dx / pxPerBeat()) : dx / pxPerBeat();
      const next = notes.slice();
      d.indices.forEach((idx, groupIdx) => {
        if (!next[idx]) return;
        const start = d.startNotes[groupIdx];
        if (d.edge === "right") {
          next[idx] = {
            ...next[idx],
            lengthBeats: clamp(start.lengthBeats + dLen, MIN_NOTE_LENGTH_BEATS, lengthBeats - start.startBeat),
          };
        } else {
          const originalEnd = start.startBeat + start.lengthBeats;
          const nextStart = clamp(start.startBeat + dLen, 0, originalEnd - MIN_NOTE_LENGTH_BEATS);
          next[idx] = {
            ...next[idx],
            startBeat: nextStart,
            lengthBeats: clamp(originalEnd - nextStart, MIN_NOTE_LENGTH_BEATS, lengthBeats - nextStart),
          };
        }
        next[idx] = normalizeNoteCurveToBounds(next[idx]);
      });
      applyTransientChange(next);
    } else if (d.mode === "curve-handle") {
      ensureDragHistory(d);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = notes.slice();
      const note = next[d.idx];
      if (!note) return;
      const pitch = curvePitchFromY(e.clientY - rect.top, e.shiftKey);
      next[d.idx] = updateNoteCurveHandle(note, d.edge, pitch);
      applyTransientChange(next);
    } else if (d.mode === "length-resize") {
      const deltaBeats = (e.clientX - d.startX) / pxPerBeat();
      onLengthChange?.(Math.max(1, Math.round(d.startLengthBeats + deltaBeats)));
    } else {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = clamp(e.clientY - rect.top, 0, height);
      setSelectBox(normalizeRect(d.anchorX, d.anchorY, x, y));
    }
  }

  function onNotePointerUp() {
    if (drag.current?.mode === "draw") {
      lastDrawnLengthRef.current = Math.max(MIN_NOTE_LENGTH_BEATS, drag.current.currentLength);
    }
    const currentSelectBox = selectBox();
    if (drag.current?.mode === "select" && currentSelectBox) {
      const selectedIndices = notes
        .map((note, index) => ({ note, index, rect: visibleNoteRect(note) }))
        .filter(({ rect }) => rect ? rectsIntersect(currentSelectBox, rect) : false)
        .map(({ index }) => index);
      setSelected(selectedIndices);
      setSelectBox(null);
    }
    setLengthHandleActive(false);
    drag.current = null;
    clearDragAudition();
    setDragActive(false);
  }

  function stopLengthResizeOnLeave() {
    if (drag.current?.mode !== "length-resize") return;
    onNotePointerUp();
  }

  function openNoteMenu(idx: number, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const nextSelected = selected().includes(idx) ? selected() : [idx];
    setSelected(nextSelected);
    setVolumePopover(null);
    setGridMenu(null);
    const target = targetFromClient(e.clientX, e.clientY);
    lastPointerTargetRef.current = target;
    setNoteMenu({ idx, x: e.clientX, y: e.clientY, target });
  }

  function openGridMenu(e: MouseEvent) {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    e.stopPropagation();
    const target = targetFromClient(e.clientX, e.clientY);
    lastPointerTargetRef.current = target;
    setNoteMenu(null);
    setVolumePopover(null);
    setNoteEditor(null);
    setGridMenu({ x: e.clientX, y: e.clientY, target });
  }

  function openVolumePopover(idx: number, x: number, y: number) {
    setVolumePopover({
      idx,
      x,
      y,
      value: String(velocityToPercent(notes[idx]?.velocity ?? 100)),
      error: false,
    });
  }

  function openNoteEditor(idx: number) {
    const note = notes[idx];
    const rect = noteViewportRect(note);
    if (!note || !rect) return;
    setSelected([idx]);
    setNoteMenu(null);
    setGridMenu(null);
    setVolumePopover(null);
    setNoteEditor({
      idx,
      x: rect.left,
      y: rect.bottom + 4,
      value: String(velocityToPercent(note.velocity)),
      error: false,
    });
    if (!note.curve || note.curve.length < 2) {
      const next = notes.slice();
      next[idx] = defaultNoteCurve(note);
      commitChange(next);
    }
  }

  function applyNoteVolume() {
    const current = volumePopover();
    if (!current) return;
    const velocity = parseVolumeInput(current.value);
    if (velocity == null) {
      setVolumePopover({ ...current, error: true });
      return;
    }
    const next = notes.slice();
    next[current.idx] = { ...next[current.idx], velocity };
    commitChange(next);
    setVolumePopover(null);
  }

  function applyNoteEditorVolume() {
    const current = noteEditor();
    if (!current) return;
    const velocity = parseVolumeInput(current.value);
    if (velocity == null) {
      setNoteEditor({ ...current, error: true });
      return;
    }
    const next = notes.slice();
    next[current.idx] = { ...next[current.idx], velocity };
    commitChange(next);
  }

  function startCurveHandleDrag(idx: number, edge: "start" | "end", e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelected([idx]);
    drag.current = { mode: "curve-handle", idx, edge };
    setDragActive(true);
  }

  function clearNoteVolume() {
    const current = volumePopover();
    if (!current) return;
    const next = notes.slice();
    next[current.idx] = { ...next[current.idx], velocity: 127 };
    commitChange(next);
    setVolumePopover(null);
  }

  function startConnect(idx: number) {
    const rect = noteRect(notes[idx]);
    setCurveFrom(null);
    setCurvePointer(null);
    setGridMenu(null);
    setVolumePopover(null);
    setNoteEditor(null);
    setConnectFrom(idx);
    setConnectPointer({
      x: Math.min(width(), rect.left + rect.width + 24),
      y: rect.top + rect.height / 2,
    });
  }

  function startCurve(idx: number) {
    const rect = noteRect(notes[idx]);
    setConnectFrom(null);
    setConnectPointer(null);
    setGridMenu(null);
    setVolumePopover(null);
    setNoteEditor(null);
    setCurveFrom(idx);
    setCurvePointer({
      x: Math.min(width(), rect.left + rect.width + 24),
      y: rect.top + rect.height / 2,
    });
  }

  function completeCurve(idx: number, target: PasteTarget) {
    const note = notes[idx];
    if (!note) return;
    const targetBeat = clamp(snap(target.beat), 0, lengthBeats);
    const targetPitch = clamp(target.pitch ?? note.pitch, BOTTOM_PITCH, TOP_PITCH);
    if (Math.abs(targetBeat - note.startBeat) < 0.001) {
      setCurveFrom(null);
      setCurvePointer(null);
      return;
    }
    const next = notes.slice();
    if (targetBeat < note.startBeat) {
      next[idx] = {
        ...note,
        startBeat: targetBeat,
        pitch: targetPitch,
        lengthBeats: note.startBeat - targetBeat,
        curve: [
          { beat: targetBeat, pitch: targetPitch },
          { beat: note.startBeat, pitch: note.pitch },
        ],
      };
    } else {
      next[idx] = {
        ...note,
        lengthBeats: targetBeat - note.startBeat,
        curve: [
          { beat: note.startBeat, pitch: note.pitch },
          { beat: targetBeat, pitch: targetPitch },
        ],
      };
    }
    commitChange(next);
    setSelected([idx]);
    setCurveFrom(null);
    setCurvePointer(null);
  }

  function deleteNote(idx: number) {
    const next = notes
      .filter((_, index) => index !== idx)
      .map((note) => {
        const to = note.connectToIndex;
        if (to == null) return note;
        if (to === idx) return { ...note, connectToIndex: undefined };
        return { ...note, connectToIndex: to > idx ? to - 1 : to };
      });
    commitChange(next);
    setSelected([]);
    setConnectFrom(null);
    setConnectPointer(null);
    setCurveFrom(null);
    setCurvePointer(null);
  }

  function addAutomationLaneToSelection() {
    if (selected().length === 0) return;
    commitChange(upsertMidiNoteAutomationTarget(props.notes, selected(), activeAutomationTarget()));
  }

  function clearAutomationLaneFromSelection() {
    if (selected().length === 0) return;
    commitChange(clearMidiNoteAutomationTarget(props.notes, selected(), activeAutomationTarget()));
  }

  function setAutomationCurve(curve: string) {
    if (selected().length === 0 || activeAutomationTarget() === "pitch") return;
    commitChange(setMidiNoteAutomationTargetCurve(props.notes, selected(), activeAutomationTarget(), curve as typeof AUTOMATION_CURVES[number]));
  }

  function setAutomationValueEdge(edge: "start" | "mid" | "end", rawValue: string) {
    if (selected().length === 0 || activeAutomationTarget() === "pitch") return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    const current = selectedAutomationValueRange();
    commitChange(setMidiNoteAutomationTargetValues(
      props.notes,
      selected(),
      activeAutomationTarget(),
      edge === "start" ? value : current.startValue,
      edge === "end" ? value : current.endValue,
      edge === "mid" ? value : current.midCount > 0 ? current.midValue : undefined,
    ));
  }

  function setAutomationValue(edge: "start" | "mid" | "end", value: number, transient = false) {
    if (selected().length === 0 || activeAutomationTarget() === "pitch" || !Number.isFinite(value)) return;
    const current = selectedAutomationValueRange();
    const next = setMidiNoteAutomationTargetValues(
      props.notes,
      selected(),
      activeAutomationTarget(),
      edge === "start" ? value : current.startValue,
      edge === "end" ? value : current.endValue,
      edge === "mid" ? value : current.midCount > 0 ? current.midValue : undefined,
    );
    if (transient) applyTransientChange(next);
    else commitChange(next);
  }

  function addAutomationPointToSelection() {
    if (selected().length === 0 || activeAutomationTarget() === "pitch") return;
    const current = selectedAutomationValueRange();
    commitChange(insertMidiNoteAutomationPoint(
      props.notes,
      selected(),
      activeAutomationTarget(),
      nextAutomationPointBeat(),
      current.midValue,
    ));
  }

  function quantizeAutomationPointsForSelection() {
    if (selected().length === 0 || activeAutomationTarget() === "pitch") return;
    commitChange(quantizeMidiNoteAutomationPoints(props.notes, selected(), activeAutomationTarget(), 0.25));
  }

  function snapAutomationPointValuesForSelection() {
    if (selected().length === 0 || activeAutomationTarget() === "pitch") return;
    commitChange(snapMidiNoteAutomationPointValues(props.notes, selected(), activeAutomationTarget()));
  }

  function copyAutomationPointsForSelection() {
    if (selected().length === 0 || activeAutomationTarget() === "pitch") return;
    const pointIndices = activeSelectedAutomationPointIndices().length > 0
      ? activeSelectedAutomationPointIndices()
      : selectedAutomationPoints().map((_, index) => index);
    if (pointIndices.length === 0) return;
    setAutomationPointClipboard(copyMidiNoteAutomationPoints(props.notes, selected()[0], activeAutomationTarget(), pointIndices));
  }

  function pasteAutomationPointsForSelection() {
    if (selected().length === 0 || activeAutomationTarget() === "pitch") return;
    const clipboard = automationPointClipboard();
    if (!clipboard || clipboard.target !== activeAutomationTarget()) return;
    commitChange(pasteMidiNoteAutomationPoints(props.notes, selected(), clipboard, nextAutomationPointBeat()));
  }

  function setAutomationPointBeat(pointIndex: number, rawBeat: string) {
    if (selected().length === 0 || activeAutomationTarget() === "pitch") return;
    const beat = Number(rawBeat);
    if (!Number.isFinite(beat)) return;
    const point = selectedAutomationPoints()[pointIndex];
    if (!point) return;
    commitChange(updateMidiNoteAutomationPoint(
      props.notes,
      selected(),
      activeAutomationTarget(),
      pointIndex,
      beat,
      point.value,
    ));
  }

  function setAutomationPointValue(pointIndex: number, rawValue: string) {
    if (selected().length === 0 || activeAutomationTarget() === "pitch") return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    const point = selectedAutomationPoints()[pointIndex];
    if (!point) return;
    commitChange(updateMidiNoteAutomationPoint(
      props.notes,
      selected(),
      activeAutomationTarget(),
      pointIndex,
      point.beat,
      value,
    ));
  }

  function deleteAutomationPoint(pointIndex: number) {
    if (selected().length === 0 || activeAutomationTarget() === "pitch") return;
    commitChange(removeMidiNoteAutomationPoint(props.notes, selected(), activeAutomationTarget(), pointIndex));
    setSelectedAutomationPointIndices((indices) => indices
      .filter((index) => index !== pointIndex)
      .map((index) => index > pointIndex ? index - 1 : index));
  }

  function toggleAutomationPointSelection(pointIndex: number) {
    setSelectedAutomationPointIndices((indices) =>
      indices.includes(pointIndex)
        ? indices.filter((index) => index !== pointIndex)
        : [...indices, pointIndex].sort((a, b) => a - b)
    );
  }

  function startAutomationPointDrag(edge: "start" | "mid" | "end", event: PointerEvent) {
    if (selected().length === 0 || activeAutomationTarget() === "pitch") return;
    event.preventDefault();
    event.stopPropagation();
    setDraggedAutomationEdge(edge);
    if (!automationDragHistoryPushedRef.current) {
      pushHistorySnapshot();
      automationDragHistoryPushedRef.current = true;
    }
    const target = event.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic verifier events may not create an active browser pointer capture.
    }
    updateAutomationPointDrag(edge, event);
  }

  function updateAutomationPointDrag(edge: "start" | "mid" | "end", event: PointerEvent) {
    if (selected().length === 0 || activeAutomationTarget() === "pitch") return;
    const element = event.currentTarget as HTMLElement;
    const rect = element.parentElement?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const value = denormalizeAetherNoteAutomationValue(activeAutomationTarget(), (event.clientX - rect.left) / rect.width);
    setAutomationValue(edge, value, true);
  }

  function stopAutomationPointDrag(edge: "start" | "mid" | "end", event: PointerEvent) {
    if (draggedAutomationEdge() === edge) {
      updateAutomationPointDrag(edge, event);
      setDraggedAutomationEdge(null);
      automationDragHistoryPushedRef.current = false;
    }
  }

  function copyNotes(indices: number[]): boolean {
    const unique = Array.from(new Set(indices))
      .filter((idx) => notes[idx])
      .sort((a, b) => notes[a].startBeat - notes[b].startBeat || notes[a].pitch - notes[b].pitch);
    if (unique.length === 0) return false;
    const minStart = Math.min(...unique.map((idx) => notes[idx].startBeat));
    const minPitch = Math.min(...unique.map((idx) => notes[idx].pitch));
    const maxPitch = Math.max(...unique.map((idx) => notes[idx].pitch));
    const indexMap = new Map(unique.map((idx, copyIndex) => [idx, copyIndex]));
    midiNoteClipboard = {
      notes: unique.map((idx) => {
        const note = notes[idx];
        const mappedConnection = note.connectToIndex == null ? undefined : indexMap.get(note.connectToIndex);
        return {
          ...note,
          startBeat: note.startBeat - minStart,
          pitch: note.pitch - minPitch,
          curve: offsetNoteCurve(note.curve, -minStart),
          automation: offsetMidiNoteAutomation(note.automation, -minStart),
          connectToIndex: mappedConnection,
        };
      }),
      minPitch,
      pitchSpan: maxPitch - minPitch,
      spanBeats: Math.max(...unique.map((idx) => notes[idx].startBeat + notes[idx].lengthBeats)) - minStart,
      nextStartBeat: minStart + 1,
    };
    return true;
  }

  function copyCurrentSelection(fallbackIdx?: number): boolean {
    const indices = selected().length > 0 ? selected() : fallbackIdx == null ? [] : [fallbackIdx];
    return copyNotes(indices);
  }

  function pasteCopiedNotes(_target?: PasteTarget): boolean {
    if (!midiNoteClipboard || midiNoteClipboard.notes.length === 0) return false;
    const maxStart = Math.max(0, lengthBeats - midiNoteClipboard.spanBeats);
    const startBeat = clamp(snap(midiNoteClipboard.nextStartBeat), 0, maxStart);
    const basePitch = clamp(
      midiNoteClipboard.minPitch,
      BOTTOM_PITCH,
      TOP_PITCH - midiNoteClipboard.pitchSpan,
    );
    const baseIndex = notes.length;
    const pasted = midiNoteClipboard.notes.map((note) => ({
      ...note,
      startBeat: startBeat + note.startBeat,
      pitch: basePitch + note.pitch,
      curve: offsetNoteCurve(note.curve, startBeat),
      automation: offsetMidiNoteAutomation(note.automation, startBeat),
      connectToIndex: note.connectToIndex == null ? undefined : baseIndex + note.connectToIndex,
    }));
    commitChange([...notes, ...pasted]);
    setSelected(pasted.map((_, i) => baseIndex + i));
    midiNoteClipboard = {
      ...midiNoteClipboard,
      nextStartBeat: startBeat + 1,
    };
    lastPointerTargetRef.current = { beat: startBeat, pitch: basePitch };
    return true;
  }

  // Keyboard: Backspace/Delete removes selected().
  createCompatEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setConnectFrom(null);
        setConnectPointer(null);
        setCurveFrom(null);
        setCurvePointer(null);
        setNoteMenu(null);
        setGridMenu(null);
        setVolumePopover(null);
        setNoteEditor(null);
        setSelectBox(null);
        drag.current = null;
        setDragActive(false);
        return;
      }
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const isCopyPasteModifier = e.metaKey || e.ctrlKey;
      if (isCopyPasteModifier && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        undoLocal();
        return;
      }
      if (isCopyPasteModifier && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setSelected(notes.map((_, index) => index));
        return;
      }
      if (isCopyPasteModifier && e.key.toLowerCase() === "c") {
        if (!copyCurrentSelection()) return;
        e.preventDefault();
        return;
      }
      if (isCopyPasteModifier && e.key.toLowerCase() === "v") {
        if (!pasteCopiedNotes()) return;
        e.preventDefault();
        return;
      }
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (selected().length === 0) return;
      e.preventDefault();
      const removed = new Set(selected());
      const indexMap = new Map<number, number>();
      let nextIndex = 0;
      notes.forEach((_, i) => {
        if (!removed.has(i)) indexMap.set(i, nextIndex++);
      });
      const next = notes
        .filter((_, i) => !removed.has(i))
        .map((note) => {
          const mapped = note.connectToIndex == null ? undefined : indexMap.get(note.connectToIndex);
          return { ...note, connectToIndex: mapped };
        });
      commitChange(next);
      setSelected([]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected(), notes, onChange, volumePopover(), props.playheadBeat]);

  createCompatEffect(() => {
    if (connectFrom() == null && curveFrom() == null && !noteMenu() && !gridMenu() && !volumePopover() && !noteEditor()) return;
    function cancel(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if ((target as Element).closest?.("[data-floating-layer]")) return;
      setNoteMenu(null);
      setGridMenu(null);
      setVolumePopover(null);
      setNoteEditor(null);
      if (connectFrom() != null) {
        setConnectFrom(null);
        setConnectPointer(null);
      }
      if (curveFrom() != null) {
        setCurveFrom(null);
        setCurvePointer(null);
      }
    }
    window.addEventListener("mousedown", cancel);
    return () => window.removeEventListener("mousedown", cancel);
  }, [connectFrom(), curveFrom(), noteMenu(), gridMenu(), volumePopover(), noteEditor()]);

  function syncKeyScroll() {
    if (!keysScrollRef.current || !timeScrollRef.current) return;
    keysScrollRef.current.scrollTop = timeScrollRef.current.scrollTop;
  }

  function zoom(delta: number, clientX?: number) {
    setPxPerBeat((current) => {
      const next = Math.max(MIN_PX_PER_BEAT, Math.min(MAX_PX_PER_BEAT, current + delta));
      const scroll = timeScrollRef.current;
      if (scroll && clientX != null && next !== current) {
        const rect = scroll.getBoundingClientRect();
        const x = clientX - rect.left;
        const beatUnderPointer = (scroll.scrollLeft + x) / current;
        requestAnimationFrame(() => {
          scroll.scrollLeft = Math.max(0, beatUnderPointer * next - x);
          syncKeyScroll();
        });
      }
      return next;
    });
  }

  function handleWheelZoom(e: WheelEvent): boolean {
    if (!e.ctrlKey && !e.metaKey) return false;
    e.preventDefault();
    zoom(e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP, e.clientX);
    return true;
  }

  function noteRect(note: MidiNote): Rect {
    return {
      left: note.startBeat * pxPerBeat(),
      top: (TOP_PITCH - note.pitch) * PX_PER_PITCH,
      width: note.lengthBeats * pxPerBeat(),
      height: PX_PER_PITCH,
    };
  }

  function visibleNoteRect(note: MidiNote): Rect | null {
    const start = note.startBeat;
    const end = Math.min(lengthBeats, note.startBeat + note.lengthBeats);
    if (start >= lengthBeats || end <= 0 || end <= start) return null;
    return {
      left: start * pxPerBeat(),
      top: (TOP_PITCH - note.pitch) * PX_PER_PITCH,
      width: Math.max(1, (end - start) * pxPerBeat()),
      height: PX_PER_PITCH,
    };
  }

  function isNotePlaying(note: MidiNote): boolean {
    const beat = props.playheadBeat;
    if (beat == null) return false;
    return beat >= note.startBeat && beat < note.startBeat + note.lengthBeats;
  }

  function noteViewportRect(note: MidiNote): DOMRect | null {
    const gridRect = containerRef.current?.getBoundingClientRect();
    if (!gridRect) return null;
    const rect = noteRect(note);
    return new DOMRect(gridRect.left + rect.left, gridRect.top + rect.top, rect.width, rect.height);
  }

  function scrollKeysWithGrid(e: WheelEvent) {
    if (handleWheelZoom(e)) return;
    if (!timeScrollRef.current) return;
    timeScrollRef.current.scrollTop += e.deltaY;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      timeScrollRef.current.scrollLeft += e.deltaX || e.deltaY;
    }
    syncKeyScroll();
  }

  // Key labels along the left side.
  const keyLabels = createMemo(() => {
    const out: { pitch: number; label: string; isBlack: boolean }[] = [];
    for (let p = TOP_PITCH; p >= BOTTOM_PITCH; p--) {
      const name = NOTE_NAMES[((p % 12) + 12) % 12];
      const octave = Math.floor(p / 12) - 1;
      out.push({ pitch: p, label: `${name}${octave}`, isBlack: name.includes("#") });
    }
    return out;
  }, []);

  return (
    <div class={styles.rollWrap}>
      <div class={styles.editorFrame}>
        <div
          ref={(element) => {
            keysScrollRef.current = element;
          }}
          class={styles.keysScroll}
          style={{ width: px(KEY_LABEL_WIDTH), height: px(VIEW_HEIGHT) }}
          onWheel={scrollKeysWithGrid}
        >
          {/* Key column */}
          <div class={styles.keys} style={{ width: px(KEY_LABEL_WIDTH), height: px(height) }}>
            {keyLabels().map((k) => (
              <div
                class={`${styles.key} ${k.isBlack ? styles.keyBlack : ""}`}
                style={{ height: px(PX_PER_PITCH) }}
              >
                {k.label}
              </div>
            ))}
          </div>
        </div>

        <div
          ref={(element) => {
            timeScrollRef.current = element;
          }}
          class={styles.timeScroll}
          style={{ height: px(VIEW_HEIGHT) }}
          onScroll={syncKeyScroll}
          onWheel={handleWheelZoom}
          onPointerDown={onTimeScrollPointerDown}
          onPointerMove={onNotePointerMove}
          onPointerUp={onNotePointerUp}
          onPointerLeave={stopLengthResizeOnLeave}
        >
          <div class={styles.inner} style={{ width: px(width()), height: px(height) }}>
            {/* Grid + notes */}
            <div
              ref={(element) => {
                containerRef.current = element;
              }}
              class={`${styles.grid} ${toolMode() === "select" ? styles.gridSelectMode : styles.gridDrawMode}`}
              style={{ width: px(width()), height: px(height) }}
              data-midi-note-count={notes.length}
              onPointerDown={onGridPointerDown}
              onPointerMove={onNotePointerMove}
              onPointerUp={onNotePointerUp}
              onContextMenu={openGridMenu}
            >
              <div
                class={`${styles.lengthHandle} ${lengthHandleActive() ? styles.lengthHandleActive : ""}`}
                style={{ left: px(width()) }}
                onPointerDown={startLengthResize}
                onPointerMove={onNotePointerMove}
                onPointerUp={onNotePointerUp}
                onPointerEnter={() => setLengthHandleActive(true)}
                onPointerLeave={() => {
                  if (drag.current?.mode !== "length-resize") setLengthHandleActive(false);
                }}
                aria-hidden
              />
              {/* Horizontal rows (per pitch) */}
              {keyLabels().map((k, i) => (
                <div
                  class={`${styles.row} ${k.isBlack ? styles.rowBlack : ""}`}
                  style={{ top: px(i * PX_PER_PITCH), height: px(PX_PER_PITCH) }}
                />
              ))}
              {/* Vertical lines adapt with zoom: bars, beats, and close-view subdivisions. */}
              {gridLines().map((line) => (
                <div
                  class={`${styles.beatLine} ${line.kind === "bar" ? styles.beatLineMajor : line.kind === "sub" ? styles.beatLineSub : ""}`}
                  style={{ left: px(line.beat * pxPerBeat()) }}
                />
              ))}

              <svg class={styles.connections} width={width()} height={height} aria-hidden>
                {notes.map((note, i) => {
                  if (!note.curve || note.curve.length < 2) return null;
                  if (noteEditor()?.idx === i) return null;
                  const [from, to] = note.curve;
                  const noteCenterY = (TOP_PITCH - note.pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
                  const x1 = from.beat * pxPerBeat();
                  const y1 = (TOP_PITCH - from.pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
                  const x2 = to.beat * pxPerBeat();
                  const y2 = (TOP_PITCH - to.pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
                  const c = Math.max(24, Math.abs(x2 - x1) * 0.45);
                  return (
                    <g>
                      <path
                        class={styles.curvePathFill}
                        d={`M ${x1} ${noteCenterY} L ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2} L ${x2} ${noteCenterY} Z`}
                      />
                      <path
                        class={styles.curvePath}
                        d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`}
                      />
                    </g>
                  );
                })}
                {notes.map((note) => {
                  const to = note.connectToIndex;
                  if (to == null || !notes[to]) return null;
                  const fromRect = noteRect(note);
                  const toRect = noteRect(notes[to]);
                  const x1 = fromRect.left + fromRect.width;
                  const y1 = fromRect.top + fromRect.height / 2;
                  const x2 = toRect.left;
                  const y2 = toRect.top + toRect.height / 2;
                  const c = Math.max(24, Math.abs(x2 - x1) * 0.45);
                  return (
                    <path
                      class={styles.connectionPath}
                      d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`}
                    />
                  );
                })}
                {(() => {
                  const activeConnectFrom = connectFrom();
                  const pointer = connectPointer();
                  if (activeConnectFrom == null || !notes[activeConnectFrom] || !pointer) return null;
                  const fromRect = noteRect(notes[activeConnectFrom]);
                  const x1 = fromRect.left + fromRect.width;
                  const y1 = fromRect.top + fromRect.height / 2;
                  const x2 = pointer.x;
                  const y2 = pointer.y;
                  const c = Math.max(24, Math.abs(x2 - x1) * 0.45);
                  return (
                    <path
                      class={styles.connectionPathActive}
                      d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`}
                    />
                  );
                })()}
                {(() => {
                  const activeCurveFrom = curveFrom();
                  const pointer = curvePointer();
                  if (activeCurveFrom == null || !notes[activeCurveFrom] || !pointer) return null;
                  const note = notes[activeCurveFrom];
                  const x1 = note.startBeat * pxPerBeat();
                  const y1 = (TOP_PITCH - note.pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
                  const x2 = pointer.x;
                  const y2 = pointer.y;
                  const c = Math.max(24, Math.abs(x2 - x1) * 0.45);
                  return (
                    <path
                      class={styles.curvePathActive}
                      d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`}
                    />
                  );
                })()}
              </svg>

            {/* Notes */}
            <For each={props.notes}>
              {(n, index) => {
                const i = index();
                const rect = visibleNoteRect(n);
                if (!rect) return null;
                const isSelected = selected().includes(i);
                const isAuditioned = auditionedNoteIndex() === i;
                const isPlaying = isNotePlaying(n);
                const hovered = hoveredNoteSide();
                const hoveredSide = hovered?.idx === i ? hovered.side : null;
                const volumePercent = Math.round((clamp(n.velocity, 0, 127) / 127) * 100);
                const laneCount = midiNoteAutomationTargetCount(n);
                const hasActiveAutomation = midiNoteHasAutomationTarget(n, activeAutomationTarget());
                return (
                  <div
                    class={[
                      styles.note,
                      isSelected && styles.noteSelected,
                      isAuditioned && styles.noteAuditioned,
                      isPlaying && styles.notePlaying,
                      hoveredSide === "left" && styles.noteHoverLeft,
                      hoveredSide === "right" && styles.noteHoverRight,
                    ].filter(Boolean).join(" ")}
                    style={{
                      left: px(rect.left),
                      top: px(rect.top),
                      width: px(rect.width),
                      height: px(rect.height),
                      "--note-volume": `${volumePercent}%`,
                    } as JSX.CSSProperties}
                    data-midi-note-index={String(i)}
                    onPointerDown={(e) => startMove(i, e)}
                    onPointerMove={onNotePointerMove}
                    onPointerUp={onNotePointerUp}
                    onMouseMove={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setHoveredNoteSide({ idx: i, side: event.clientX - rect.left < rect.width / 2 ? "left" : "right" });
                    }}
                    onMouseLeave={() => {
                      setHoveredNoteSide((current) => current?.idx === i ? null : current);
                    }}
                    onDblClick={(e) => {
                      e.stopPropagation();
                      openNoteEditor(i);
                    }}
                    onContextMenu={(e) => openNoteMenu(i, e)}
                  >
                    {volumePercent < 100 && (
                      <div class={styles.noteVolumeOverlay} aria-hidden>
                        {volumePercent}%
                      </div>
                    )}
                    {hasActiveAutomation && <div class={styles.noteAutomationStripe} aria-hidden />}
                    {laneCount > 0 && (
                      <div class={styles.noteAutomationBadge} aria-label={`${laneCount} automation lane${laneCount === 1 ? "" : "s"}`}>
                        {laneCount}
                      </div>
                    )}
                    <div
                      class={`${styles.noteResize} ${styles.noteResizeLeft}`}
                      onPointerDown={(e) => startResize(i, "left", e)}
                      onPointerMove={onNotePointerMove}
                      onPointerUp={onNotePointerUp}
                    />
                    <div
                      class={`${styles.noteResize} ${styles.noteResizeRight}`}
                      onPointerDown={(e) => startResize(i, "right", e)}
                      onPointerMove={onNotePointerMove}
                      onPointerUp={onNotePointerUp}
                    />
                    {noteEditor()?.idx === i && (
                      <CurveHandles
                        note={n}
                        pxPerBeat={pxPerBeat()}
                        onPointerDown={startCurveHandleDrag}
                        noteIndex={i}
                      />
                    )}
                  </div>
                );
              }}
            </For>
            {selectBox() && (
              <div
                class={styles.selectBox}
                style={{
                  left: px(selectBox()!.left),
                  top: px(selectBox()!.top),
                  width: px(selectBox()!.width),
                  height: px(selectBox()!.height),
                }}
              />
            )}
            {props.playheadBeat != null && props.playheadBeat >= 0 && props.playheadBeat <= lengthBeats && (
              <div
                class={styles.playhead}
                style={{ left: px(props.playheadBeat * pxPerBeat()) }}
                aria-hidden
              />
            )}
            </div>
          </div>
        </div>
        <div class={styles.zoomControls}>
          <HoverInfo content="Draw notes (D)">
            <Button
              iconOnly
              size="xs"
              selected={toolMode() === "draw"}
              onClick={() => setToolMode("draw")}
              aria-label="Draw notes tool, D"
            >
              <Icon name="ph:pen" size={16} decorative />
            </Button>
          </HoverInfo>
          <HoverInfo content="Select notes (S)">
            <Button
              iconOnly
              size="xs"
              selected={toolMode() === "select"}
              onClick={() => setToolMode("select")}
              aria-label="Select notes tool, S"
            >
              <Icon name="ph:cursor" size={16} decorative />
            </Button>
          </HoverInfo>
          <span class={styles.toolDivider} aria-hidden />
          <HoverInfo content="Zoom out">
            <Button
              iconOnly
              size="xs"
              onClick={() => zoom(-ZOOM_STEP)}
              aria-label="Zoom MIDI editor out"
            >
              <Icon name="ph:magnifying-glass-minus" size={16} decorative />
            </Button>
          </HoverInfo>
          <HoverInfo content="Zoom in">
            <Button
              iconOnly
              size="xs"
              onClick={() => zoom(ZOOM_STEP)}
              aria-label="Zoom MIDI editor in"
            >
              <Icon name="ph:magnifying-glass-plus" size={16} decorative />
            </Button>
          </HoverInfo>
        </div>
        {props.showAutomation && (
          <div class={styles.automationPanel} aria-label="Aether note automation lanes">
            <div class={styles.automationHeader}>
              <span>Aether lanes</span>
              <span>{aetherNoteAutomationTargetLabel(activeAutomationTarget())} · {selectedAutomationSummary()}</span>
            </div>
            <div
              class={styles.automationEffectiveBadge}
              data-tone={selectedAutomationEffective().tone}
              title={selectedAutomationEffective().detail}
            >
              <span>{selectedAutomationEffective().label}</span>
              <span>{selectedAutomationEffective().detail}</span>
            </div>
            <div class={styles.automationTargets} role="radiogroup" aria-label="Aether note automation target">
              {AETHER_NOTE_AUTOMATION_TARGETS.map((target) => (
                <Button
                  size="xs"
                  selected={activeAutomationTarget() === target.target}
                  aria-label={`${target.label} automation lane`}
                  onClick={() => setActiveAutomationTarget(target.target)}
                >
                  {target.label}
                </Button>
              ))}
            </div>
            <div class={styles.automationActions}>
              <Button size="xs" disabled={selected().length === 0} onClick={addAutomationLaneToSelection}>
                Add lane
              </Button>
              <Button size="xs" disabled={selected().length === 0} onClick={clearAutomationLaneFromSelection}>
                Clear
              </Button>
              {activeAutomationTarget() !== "pitch" && (
                <FloatingSelect
                  value={selectedAutomationCurve()}
                  options={automationCurveOptions}
                  open={automationCurveSelectOpen()}
                  className={styles.automationCurveSelect}
                  layout="inline"
                  ariaLabel="Aether note automation curve"
                  onOpenChange={setAutomationCurveSelectOpen}
                  onChange={setAutomationCurve}
                />
              )}
            </div>
            {activeAutomationTarget() === "pitch" ? (
              <div class={styles.automationValueEditor}>
                <span>Pitch uses note curve handles</span>
              </div>
            ) : (
              <div class={styles.automationValueEditor}>
              <label>
                <span>Start</span>
                <input
                  type="range"
                  min={activeAutomationMeta().min}
                  max={activeAutomationMeta().max}
                  step={activeAutomationMeta().step}
                  value={selectedAutomationValueRange().startValue}
                  disabled={selected().length === 0}
                  onChange={(event) => setAutomationValueEdge("start", event.currentTarget.value)}
                />
                <span>{formatAetherNoteAutomationValue(activeAutomationTarget(), selectedAutomationValueRange().startValue)}</span>
              </label>
              <label>
                <span>Mid</span>
                <input
                  type="range"
                  min={activeAutomationMeta().min}
                  max={activeAutomationMeta().max}
                  step={activeAutomationMeta().step}
                  value={selectedAutomationValueRange().midValue}
                  disabled={selected().length === 0}
                  onChange={(event) => setAutomationValueEdge("mid", event.currentTarget.value)}
                />
                <span>{formatAetherNoteAutomationValue(activeAutomationTarget(), selectedAutomationValueRange().midValue)}</span>
              </label>
              <label>
                <span>End</span>
                <input
                  type="range"
                  min={activeAutomationMeta().min}
                  max={activeAutomationMeta().max}
                  step={activeAutomationMeta().step}
                  value={selectedAutomationValueRange().endValue}
                  disabled={selected().length === 0}
                  onChange={(event) => setAutomationValueEdge("end", event.currentTarget.value)}
                />
                <span>{formatAetherNoteAutomationValue(activeAutomationTarget(), selectedAutomationValueRange().endValue)}</span>
              </label>
              <div class={styles.automationPointRail} aria-label="Drag start and end automation values">
                <div class={styles.automationPointLine} aria-hidden="true" />
                <button
                  type="button"
                  class={`${styles.automationPointHandle} ${draggedAutomationEdge() === "start" ? styles.automationPointHandleActive : ""}`}
                  style={{
                    left: `${normalizeAetherNoteAutomationValue(activeAutomationTarget(), selectedAutomationValueRange().startValue) * 100}%`,
                  }}
                  disabled={selected().length === 0}
                  data-aether-note-automation-handle="start"
                  aria-label={`Drag start ${aetherNoteAutomationTargetLabel(activeAutomationTarget())} value`}
                  onPointerDown={(event) => startAutomationPointDrag("start", event)}
                  onPointerMove={(event) => draggedAutomationEdge() === "start" && updateAutomationPointDrag("start", event)}
                  onPointerUp={(event) => stopAutomationPointDrag("start", event)}
                  onPointerCancel={(event) => stopAutomationPointDrag("start", event)}
                >
                  S
                </button>
                <button
                  type="button"
                  class={`${styles.automationPointHandle} ${draggedAutomationEdge() === "mid" ? styles.automationPointHandleActive : ""}`}
                  style={{
                    left: `${normalizeAetherNoteAutomationValue(activeAutomationTarget(), selectedAutomationValueRange().midValue) * 100}%`,
                  }}
                  disabled={selected().length === 0}
                  data-aether-note-automation-handle="mid"
                  aria-label={`Drag midpoint ${aetherNoteAutomationTargetLabel(activeAutomationTarget())} value`}
                  onPointerDown={(event) => startAutomationPointDrag("mid", event)}
                  onPointerMove={(event) => draggedAutomationEdge() === "mid" && updateAutomationPointDrag("mid", event)}
                  onPointerUp={(event) => stopAutomationPointDrag("mid", event)}
                  onPointerCancel={(event) => stopAutomationPointDrag("mid", event)}
                >
                  M
                </button>
                <button
                  type="button"
                  class={`${styles.automationPointHandle} ${draggedAutomationEdge() === "end" ? styles.automationPointHandleActive : ""}`}
                  style={{
                    left: `${normalizeAetherNoteAutomationValue(activeAutomationTarget(), selectedAutomationValueRange().endValue) * 100}%`,
                  }}
                  disabled={selected().length === 0}
                  data-aether-note-automation-handle="end"
                  aria-label={`Drag end ${aetherNoteAutomationTargetLabel(activeAutomationTarget())} value`}
                  onPointerDown={(event) => startAutomationPointDrag("end", event)}
                  onPointerMove={(event) => draggedAutomationEdge() === "end" && updateAutomationPointDrag("end", event)}
                  onPointerUp={(event) => stopAutomationPointDrag("end", event)}
                  onPointerCancel={(event) => stopAutomationPointDrag("end", event)}
                >
                  E
                </button>
              </div>
              <div class={styles.automationPointEditor} aria-label="Aether note automation points">
                <div class={styles.automationPointHeader}>
                  <span>Points</span>
                  <div class={styles.automationPointTools}>
                    <Button
                      size="xs"
                      disabled={selected().length === 0 || activeAutomationTarget() === "pitch" || selectedAutomationPoints().length === 0}
                      onClick={quantizeAutomationPointsForSelection}
                    >
                      Quantize
                    </Button>
                    <Button
                      size="xs"
                      disabled={selected().length === 0 || activeAutomationTarget() === "pitch" || selectedAutomationPoints().length === 0}
                      onClick={snapAutomationPointValuesForSelection}
                    >
                      Snap values
                    </Button>
                    <Button
                      size="xs"
                      disabled={selected().length === 0 || activeAutomationTarget() === "pitch" || selectedAutomationPoints().length === 0}
                      onClick={copyAutomationPointsForSelection}
                    >
                      Copy
                    </Button>
                    <Button
                      size="xs"
                      disabled={selected().length === 0 || activeAutomationTarget() === "pitch" || automationPointClipboard()?.target !== activeAutomationTarget()}
                      onClick={pasteAutomationPointsForSelection}
                    >
                      Paste
                    </Button>
                    <Button
                      size="xs"
                      disabled={selected().length === 0}
                      onClick={addAutomationPointToSelection}
                    >
                      Add point
                    </Button>
                  </div>
                </div>
                <For each={selectedAutomationPoints()}>
                  {(point, index) => (
                    <div
                      classList={{
                        [styles.automationPointRow]: true,
                        [styles.automationPointRowSelected]: activeSelectedAutomationPointIndices().includes(index()),
                      }}
                    >
                      <input
                        class={styles.automationPointSelect}
                        type="checkbox"
                        checked={activeSelectedAutomationPointIndices().includes(index())}
                        readOnly
                        aria-label={`Select automation point ${index() + 1}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleAutomationPointSelection(index());
                        }}
                      />
                      <span class={styles.automationPointIndex}>{index() + 1}</span>
                      <label>
                        <span>Beat</span>
                        <input
                          type="number"
                          min={0}
                          max={selectedAutomationPointLength()}
                          step={0.125}
                          value={roundTo(point.beat, 0.001)}
                          disabled={selected().length === 0}
                          onChange={(event) => setAutomationPointBeat(index(), event.currentTarget.value)}
                        />
                      </label>
                      <label>
                        <span>Value</span>
                        <input
                          type="number"
                          min={activeAutomationMeta().min}
                          max={activeAutomationMeta().max}
                          step={activeAutomationMeta().step}
                          value={roundTo(point.value, activeAutomationMeta().step)}
                          disabled={selected().length === 0}
                          onChange={(event) => setAutomationPointValue(index(), event.currentTarget.value)}
                        />
                      </label>
                      <span class={styles.automationPointValue}>
                        {formatAetherNoteAutomationValue(activeAutomationTarget(), point.value)}
                      </span>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={selected().length === 0}
                        onClick={() => deleteAutomationPoint(index())}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </For>
              </div>
              </div>
            )}
          </div>
        )}
      </div>
      {(() => {
        const currentNoteMenu = noteMenu();
        if (!currentNoteMenu) return null;
        return (
        <NoteMenu
          x={currentNoteMenu.x}
          y={currentNoteMenu.y}
          onVolume={() => {
            openVolumePopover(currentNoteMenu.idx, currentNoteMenu.x, currentNoteMenu.y);
            setNoteMenu(null);
          }}
          onConnect={() => {
            startConnect(currentNoteMenu.idx);
            setNoteMenu(null);
          }}
          onCurve={() => {
            startCurve(currentNoteMenu.idx);
            setNoteMenu(null);
          }}
          onCopy={() => {
            copyCurrentSelection(currentNoteMenu.idx);
            setNoteMenu(null);
          }}
          onPaste={() => {
            pasteCopiedNotes(currentNoteMenu.target);
            setNoteMenu(null);
          }}
          onDelete={() => {
            deleteNote(currentNoteMenu.idx);
            setNoteMenu(null);
          }}
          canCopy={selected().length > 0 || currentNoteMenu.idx != null}
          canPaste={Boolean(midiNoteClipboard)}
        />
        );
      })()}
      {(() => {
        const currentGridMenu = gridMenu();
        if (!currentGridMenu) return null;
        return (
        <GridMenu
          x={currentGridMenu.x}
          y={currentGridMenu.y}
          canCopy={selected().length > 0}
          canPaste={Boolean(midiNoteClipboard)}
          onCopy={() => {
            copyCurrentSelection();
            setGridMenu(null);
          }}
          onPaste={() => {
            pasteCopiedNotes(currentGridMenu.target);
            setGridMenu(null);
          }}
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
          onApply={applyNoteVolume}
          onClear={clearNoteVolume}
        />
        );
      })()}
      {(() => {
        const currentNoteEditor = noteEditor();
        if (!currentNoteEditor) return null;
        return (
        <VolumePopover
          state={currentNoteEditor}
          label="Vol"
          showClear={false}
          onChange={(value: string) => setNoteEditor({ ...currentNoteEditor, value, error: false })}
          onApply={applyNoteEditorVolume}
          onClear={() => {
            setNoteEditor({ ...currentNoteEditor, value: "100", error: false });
            const next = notes.slice();
            next[currentNoteEditor.idx] = { ...next[currentNoteEditor.idx], velocity: 127 };
            commitChange(next);
          }}
        />
        );
      })()}
    </div>
  );
}

function NoteMenu({
  x,
  y,
  onVolume,
  onConnect,
  onCurve,
  onCopy,
  onPaste,
  onDelete,
  canCopy,
  canPaste,
}: {
  x: number;
  y: number;
  onVolume: () => void;
  onConnect: () => void;
  onCurve: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  canCopy: boolean;
  canPaste: boolean;
}) {
  const runMenuAction = (event: MouseEvent, action: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  return createPortal(
    <FloatingLayer class={styles.noteMenu} x={x} y={y} role="menu">
      <button type="button" class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onVolume)} role="menuitem">
        Volume
      </button>
      <button type="button" class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onConnect)} role="menuitem">
        Connect To
      </button>
      <button type="button" class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onCurve)} role="menuitem">
        Curve To…
      </button>
      <button type="button" class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onCopy)} disabled={!canCopy} role="menuitem">
        Copy
      </button>
      <button type="button" class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onPaste)} disabled={!canPaste} role="menuitem">
        Paste
      </button>
      <button type="button" class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onDelete)} role="menuitem">
        Delete
      </button>
    </FloatingLayer>,
    document.body,
  );
}

function GridMenu({
  x,
  y,
  canCopy,
  canPaste,
  onCopy,
  onPaste,
}: {
  x: number;
  y: number;
  canCopy: boolean;
  canPaste: boolean;
  onCopy: () => void;
  onPaste: () => void;
}) {
  const runMenuAction = (event: MouseEvent, action: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  return createPortal(
    <FloatingLayer class={styles.noteMenu} x={x} y={y} role="menu">
      <button type="button" class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onCopy)} disabled={!canCopy} role="menuitem">
        Copy
      </button>
      <button type="button" class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onPaste)} disabled={!canPaste} role="menuitem">
        Paste
      </button>
    </FloatingLayer>,
    document.body,
  );
}

interface PasteTarget {
  beat: number;
  pitch?: number;
}

interface MidiNoteClipboard {
  notes: MidiNote[];
  minPitch: number;
  pitchSpan: number;
  spanBeats: number;
  nextStartBeat: number;
}

interface VolumePopoverState {
  idx: number;
  x: number;
  y: number;
  value: string;
  error: boolean;
}

type NoteEditorState = VolumePopoverState;

function CurveHandles({
  note,
  noteIndex,
  pxPerBeat,
  onPointerDown,
}: {
  note: MidiNote;
  noteIndex: number;
  pxPerBeat: number;
  onPointerDown: (idx: number, edge: "start" | "end", event: PointerEvent) => void;
}) {
  const startPitch = curveEdgePitch(note, "start");
  const endPitch = curveEdgePitch(note, "end");
  const startY = curvePitchToNoteY(note, startPitch);
  const endY = curvePitchToNoteY(note, endPitch);
  const endX = note.lengthBeats * pxPerBeat;
  const centerY = PX_PER_PITCH / 2;
  const curveC = Math.max(12, Math.abs(endX) * 0.45);

  return (
    <>
      <svg
        class={styles.noteCurveOverlay}
        width={Math.max(1, endX)}
        height={PX_PER_PITCH}
        aria-hidden
      >
        <path
          class={styles.noteCurveFill}
          d={`M 0 ${centerY} L 0 ${startY} C ${curveC} ${startY}, ${Math.max(0, endX - curveC)} ${endY}, ${endX} ${endY} L ${endX} ${centerY} Z`}
        />
        <path
          class={styles.noteCurveLine}
          d={`M 0 ${startY} C ${curveC} ${startY}, ${Math.max(0, endX - curveC)} ${endY}, ${endX} ${endY}`}
        />
      </svg>
      <span
        class={`${styles.curveHandle} ${styles.curveHandleStart}`}
        style={{ left: px(0), top: px(startY) }}
        title={`Start ${formatPitchValue(startPitch)}`}
        data-midi-note-detail
        onPointerDown={(event) => onPointerDown(noteIndex, "start", event)}
      />
      <span
        class={`${styles.curveHandle} ${styles.curveHandleEnd}`}
        style={{ left: px(endX), top: px(endY) }}
        title={`End ${formatPitchValue(endPitch)}`}
        data-midi-note-detail
        onPointerDown={(event) => onPointerDown(noteIndex, "end", event)}
      />
    </>
  );
}

function VolumePopover({
  state,
  label = "Volume",
  showClear = true,
  onChange,
  onApply,
  onClear,
}: {
  state: VolumePopoverState;
  label?: string;
  showClear?: boolean;
  onChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const numericValue = Math.max(0, Math.min(100, Number(state.value.replace(/%$/, "")) || 0));
  return createPortal(
    <FloatingLayer class={styles.volumePopover} x={state.x} y={state.y}>
      <div class={`${styles.volumeSliderRow} ${!showClear ? styles.volumeSliderRowNoClear : ""}`} data-midi-note-detail>
        <span class={styles.volumeLabel}>{label}</span>
        <input
          class={styles.volumeSlider}
          type="range"
          min={0}
          max={100}
          step={1}
          value={numericValue}
          onInput={(e) => onChange(e.currentTarget.value)}
          onPointerUp={onApply}
          onKeyDown={(e) => {
            if (e.key === "Enter") onApply();
          }}
        />
        <span class={styles.volumeValue}>{numericValue}%</span>
        {showClear && (
          <button type="button" class={styles.volumeClear} onClick={onClear} aria-label="Clear note volume">
            x
          </button>
        )}
      </div>
      {state.error && <div class={styles.volumeError}>Use 0-100%</div>}
    </FloatingLayer>,
    document.body,
  );
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function parseVolumeInput(value: string): number | null {
  const normalized = value.trim().replace(/%$/, "");
  if (!normalized) return null;
  const percent = Number(normalized);
  if (!Number.isFinite(percent)) return null;
  return Math.round((Math.max(0, Math.min(100, percent)) / 100) * 127);
}

function duplicateNotes(notes: MidiNote[], indices: number[]): { notes: MidiNote[]; indices: number[] } {
  const unique = Array.from(new Set(indices))
    .filter((idx) => notes[idx])
    .sort((a, b) => a - b);
  if (unique.length === 0) return { notes, indices: [] };
  const baseIndex = notes.length;
  const indexMap = new Map(unique.map((idx, copyIdx) => [idx, baseIndex + copyIdx]));
  const duplicated = unique.map((idx) => {
    const note = structuredClone(notes[idx]);
    return {
      ...note,
      connectToIndex: note.connectToIndex == null ? undefined : indexMap.get(note.connectToIndex),
    };
  });
  return {
    notes: [...notes, ...duplicated],
    indices: duplicated.map((_, copyIdx) => baseIndex + copyIdx),
  };
}

function connectNotes(notes: MidiNote[], fromIndex: number, toIndex: number): MidiNote[] {
  return notes.map((note, index) => {
    const touchesConnection =
      index === fromIndex ||
      index === toIndex ||
      note.connectToIndex === fromIndex ||
      note.connectToIndex === toIndex;
    if (!touchesConnection) return note;
    return {
      ...note,
      connectToIndex: index === fromIndex ? toIndex : undefined,
    };
  });
}

function velocityToPercent(velocity: number): number {
  return Math.round((Math.max(0, Math.min(127, velocity)) / 127) * 100);
}

function defaultNoteCurve(note: MidiNote): MidiNote {
  return {
    ...note,
    curve: [
      { beat: note.startBeat, pitch: note.pitch },
      { beat: note.startBeat + note.lengthBeats, pitch: note.pitch },
    ],
  };
}

function normalizeNoteCurveToBounds(note: MidiNote): MidiNote {
  if (!note.curve || note.curve.length < 2) return note;
  return {
    ...note,
    curve: [
      { beat: note.startBeat, pitch: curveEdgePitch(note, "start") },
      { beat: note.startBeat + note.lengthBeats, pitch: curveEdgePitch(note, "end") },
    ],
  };
}

function offsetNoteCurve(curve: MidiNote["curve"], beatDelta: number): MidiNote["curve"] {
  if (!curve?.length || !Number.isFinite(beatDelta) || Math.abs(beatDelta) < 0.000001) return curve ? structuredClone(curve) : undefined;
  return curve.map((point) => ({
    ...point,
    beat: point.beat + beatDelta,
  }));
}

function shiftCurveWithNote(
  curve: MidiNote["curve"],
  oldPitch: number,
  nextStartBeat: number,
  nextPitch: number,
  lengthBeats: number,
): MidiNote["curve"] {
  if (!curve || curve.length < 2) return undefined;
  const deltaPitch = nextPitch - oldPitch;
  const startPitch = clamp(curve[0]?.pitch + deltaPitch, BOTTOM_PITCH, TOP_PITCH);
  const endPitch = clamp(curve[curve.length - 1]?.pitch + deltaPitch, BOTTOM_PITCH, TOP_PITCH);
  return [
    { beat: nextStartBeat, pitch: startPitch },
    { beat: nextStartBeat + lengthBeats, pitch: endPitch },
  ];
}

function updateNoteCurveHandle(note: MidiNote, edge: "start" | "end", pitch: number): MidiNote {
  const curved = note.curve && note.curve.length >= 2 ? normalizeNoteCurveToBounds(note) : defaultNoteCurve(note);
  const startPitch = edge === "start" ? pitch : curveEdgePitch(curved, "start");
  const endPitch = edge === "end" ? pitch : curveEdgePitch(curved, "end");
  return {
    ...curved,
    curve: [
      { beat: note.startBeat, pitch: startPitch },
      { beat: note.startBeat + note.lengthBeats, pitch: endPitch },
    ],
  };
}

function curveEdgePitch(note: MidiNote, edge: "start" | "end"): number {
  if (!note.curve || note.curve.length < 2) return note.pitch;
  const point = edge === "start" ? note.curve[0] : note.curve[note.curve.length - 1];
  return clamp(point?.pitch ?? note.pitch, BOTTOM_PITCH, TOP_PITCH);
}

function curvePitchToNoteY(note: MidiNote, pitch: number): number {
  return (note.pitch - pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
}

function formatPitchValue(pitch: number): string {
  return Number.isInteger(pitch) ? String(pitch) : pitch.toFixed(2);
}

function makeGridLines(lengthBeats: number, pxPerBeat: number): Array<{ beat: number; kind: "bar" | "beat" | "sub" }> {
  const subdivision = pxPerBeat >= 240 ? 16 : pxPerBeat >= 120 ? 4 : 1;
  const step = 1 / subdivision;
  const count = Math.floor(lengthBeats / step);
  const lines: Array<{ beat: number; kind: "bar" | "beat" | "sub" }> = [];
  for (let i = 0; i <= count; i++) {
    const beat = Math.round(i * step * 10000) / 10000;
    const nearestBeat = Math.round(beat);
    const isWholeBeat = Math.abs(beat - nearestBeat) < 0.0001;
    lines.push({
      beat,
      kind: isWholeBeat ? nearestBeat % 4 === 0 ? "bar" : "beat" : "sub",
    });
  }
  if (Math.abs(lengthBeats - count * step) > 0.0001) {
    lines.push({ beat: lengthBeats, kind: "bar" });
  }
  return lines;
}
