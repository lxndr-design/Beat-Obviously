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
import { Button, Checkbox, FloatingLayer, FloatingSelect, HoverInfo, Icon, NumberInput, Slider } from "../../solid-ui";
import { useContextualHotkey } from "../../solid-utils/contextualHotkeys.solid";
import { useSettingsStore } from "../../state/store";
import { createStoreSelector } from "../../solid-utils/store";
import { isSampleBackedInstrument, midiNoteSampleLabel, sampleZoneDisplayName, sampleZoneStableId } from "../../state/sampleZones";
import type {
  Instrument,
  MidiArpeggiationNoteValue,
  MidiArpeggiationSequence,
  MidiArpeggiationTimingType,
  MidiAutomationTarget,
  MidiNote,
} from "../../state/types";
import {
  MIDI_ARPEGGIATION_NOTE_VALUES,
  groupMidiNotes,
  midiGroupBounds,
  midiGroupIndices,
  midiSelectionArpeggiation,
  midiSelectionCanArpeggiate,
  midiSelectionIsSingleGroup,
  removeMidiArpeggiation,
  remapPastedMidiGroups,
  renderMidiArpeggiations,
  setMidiArpeggiation,
  ungroupMidiNotes,
} from "../../state/midiNoteGroups";
import {
  midiGridLineKind,
  midiNoteDragIndicesForSelection,
  midiNotePointerMovedPastThreshold,
  midiNotePointerRequestsContextMenu,
  midiNoteSelectionAfterAdditiveClick,
  midiNoteSelectionAfterMarquee,
  midiNoteSelectionAfterPointerDown,
  midiNoteSelectionForContextMenu,
  midiVisibleGridBeatStep,
  snapMidiBeatToVisibleGrid,
  type MidiGridLineKind,
} from "./pianoRollInteraction";
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
  /** Optional bounded pitch range for instrument-owned note editors. */
  bottomPitch?: number;
  topPitch?: number;
  pitchLabel?: (pitch: number) => string;
  /** When set, all note starts and lengths snap to this fixed unit. */
  fixedGridStepBeats?: number;
  defaultNoteLengthBeats?: number;
  minimumNoteLengthBeats?: number;
  maxNotes?: number;
  /** Advanced per-note Aether automation. Hidden by default so the piano roll stays a plain MIDI editor. */
  showAutomation?: boolean;
  /** Active track/component instrument. Used for sampler-zone note overrides. */
  instrument?: Instrument;
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
const ENABLE_AETHER_NOTE_AUTOMATION_PANEL = false;
const TOP_PITCH = 127;    // G9 — expose the complete MIDI note range by default.
const BOTTOM_PITCH = 0;   // C-1 — bass/sub notes must remain visible and editable.
const KEY_LABEL_WIDTH = 48;
const DEFAULT_NOTE_LENGTH_BEATS = 0.25;
const MIN_NOTE_LENGTH_BEATS = 1 / 64;
const ARPEGGIATION_SEQUENCE_OPTIONS = [
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
  { value: "up-down", label: "Up / down" },
  { value: "down-up", label: "Down / up" },
  { value: "played", label: "Played order" },
] satisfies Array<{ value: MidiArpeggiationSequence; label: string }>;
const ARPEGGIATION_TIMING_OPTIONS = [
  { value: "loops", label: "Loops" },
  { value: "notes-per-beat", label: "Notes per beat" },
] satisfies Array<{ value: MidiArpeggiationTimingType; label: string }>;
const ARPEGGIATION_NOTE_VALUE_OPTIONS = MIDI_ARPEGGIATION_NOTE_VALUES.map((noteValue) => ({
  value: String(noteValue),
  label: `1/${noteValue}`,
}));

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
  const bottomPitch = clamp(Math.round(props.bottomPitch ?? BOTTOM_PITCH), 0, 127);
  const topPitch = clamp(Math.round(props.topPitch ?? TOP_PITCH), bottomPitch, 127);
  const pitchRange = topPitch - bottomPitch + 1;
  const fixedGridStep = props.fixedGridStepBeats && props.fixedGridStepBeats > 0
    ? props.fixedGridStepBeats
    : null;
  const minimumNoteLength = Math.max(MIN_NOTE_LENGTH_BEATS, props.minimumNoteLengthBeats ?? MIN_NOTE_LENGTH_BEATS);
  const defaultNoteLength = Math.max(minimumNoteLength, props.defaultNoteLengthBeats ?? DEFAULT_NOTE_LENGTH_BEATS);
  const notes = new Proxy([] as MidiNote[], {
    get: (_target, property) => Reflect.get(props.notes, property),
    has: (_target, property) => Reflect.has(props.notes, property),
    ownKeys: () => Reflect.ownKeys(props.notes),
    getOwnPropertyDescriptor: (_target, property) => Reflect.getOwnPropertyDescriptor(props.notes, property),
  });
  const lengthBeats = {
    valueOf: () => props.lengthBeats,
  } as number;
  const onLengthChange = (nextLengthBeats: number) => props.onLengthChange?.(nextLengthBeats);
  const onChange = (nextNotes: MidiNote[]) => props.onChange(nextNotes);
  const onPreviewNote = (pitch: number, velocity?: number) => props.onPreviewNote?.(pitch, velocity);
  const rollWrapRef = createRef<HTMLDivElement | null>(null);
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
  const [arpeggiationPopover, setArpeggiationPopover] = createSignal<ArpeggiationPopoverState | null>(null);
  const [arpeggiationSequenceSelectOpen, setArpeggiationSequenceSelectOpen] = createSignal(false);
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
  const [sampleZoneSelectOpen, setSampleZoneSelectOpen] = createSignal(false);
  const [automationPointClipboard, setAutomationPointClipboard] = createSignal<AetherNoteAutomationPointClipboard | null>(null);
  const [selectedAutomationPointIndices, setSelectedAutomationPointIndices] = createSignal<number[]>([]);
  const [viewportVersion, setViewportVersion] = createSignal(0);
  const anchoredNoteMenu = createMemo(() => {
    const state = noteMenu();
    return state ? noteAnchoredViewportState(state, 150, 214) : null;
  });
  const anchoredVolumePopover = createMemo(() => {
    const state = volumePopover();
    return state ? noteAnchoredViewportState(state, 225, 48) : null;
  });
  const anchoredNoteEditor = createMemo(() => {
    const state = noteEditor();
    return state ? noteAnchoredViewportState(state, 225, 66) : null;
  });
  const anchoredArpeggiationPopover = createMemo(() => {
    const state = arpeggiationPopover();
    return state ? noteAnchoredViewportState(state, 244, 190) : null;
  });
  const lastDrawnLengthRef = createRef(defaultNoteLength);
  const lastPointerTargetRef = createRef<PasteTarget | null>(null);
  const lastPointerDownAtRef = createRef(0);
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
        editStarted?: boolean;
        additiveToggleIndex?: number;
      }
    | {
        mode: "resize";
        indices: number[];
        edge: "left" | "right";
        startX: number;
        startY: number;
        startNotes: Array<Pick<MidiNote, "startBeat" | "lengthBeats"> & { curve?: MidiNote["curve"]; automation?: MidiNote["automation"] }>;
        historyPushed?: boolean;
        editStarted?: boolean;
      }
    | { mode: "curve-handle"; idx: number; edge: "start" | "end"; startX: number; startY: number; historyPushed?: boolean; editStarted?: boolean }
    | { mode: "length-resize"; startX: number; startLengthBeats: number }
    | { mode: "select"; anchorX: number; anchorY: number; pointerId: number; additive: boolean; baseSelection: number[] }
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

  function linkedSelection(indices = selected()): number[] {
    return midiGroupIndices(props.notes, indices);
  }

  const width = () => lengthBeats * pxPerBeat();
  const height = pitchRange * PX_PER_PITCH;
  const gridLines = createMemo(() => makeGridLines(lengthBeats, pxPerBeat()));
  const noteGroupBounds = createMemo(() => midiGroupBounds(props.notes));
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
    return Math.max(minimumNoteLength, firstSelectedNote?.lengthBeats ?? defaultNoteLength);
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
  const samplerZones = createMemo(() => props.instrument?.sampleMap ?? []);
  const samplerZoneOptions = createMemo(() => [
    { value: "", label: "Auto" },
    ...samplerZones().map((zone, index) => ({
      value: sampleZoneStableId(zone, index),
      label: sampleZoneDisplayName(zone, index),
    })),
  ]);
  const missingSamplerZoneCount = createMemo(() => {
    if (!isSampleBackedInstrument(props.instrument)) return 0;
    const zoneIds = new Set(samplerZones().map((zone, index) => sampleZoneStableId(zone, index)));
    const zonePaths = new Set(samplerZones().map((zone) => zone.path));
    return props.notes.filter((note) => (
      (note.sampleZoneId && !zoneIds.has(note.sampleZoneId))
      || (note.samplePath && !zonePaths.has(note.samplePath))
    )).length;
  });
  const selectedSampleZoneValue = createMemo(() => {
    const selection = selected().map((index) => props.notes[index]).filter(Boolean) as MidiNote[];
    if (selection.length === 0) return "";
    const values = selection.map((note) => note.sampleZoneId ?? note.samplePath ?? "");
    const first = values[0] ?? "";
    return values.every((value) => value === first) ? first : "";
  });
  const selectedSampleSummary = createMemo(() => {
    const count = selected().length;
    if (count === 0) return "Select notes to assign a sample zone.";
    const value = selectedSampleZoneValue();
    if (!value) return `${count} selected · Auto zone`;
    const note = selected().map((index) => props.notes[index]).find(Boolean) as MidiNote | undefined;
    const label = note ? midiNoteSampleLabel(props.instrument, note) : undefined;
    return `${count} selected · ${label ?? "Sample zone"}`;
  });
  const showSamplerZoneControls = createMemo(() =>
    isSampleBackedInstrument(props.instrument) && samplerZones().length > 0
  );

  function assignSampleZoneToSelection(value: string) {
    const selection = selected();
    if (selection.length === 0) return;
    const zoneIndex = samplerZones().findIndex((candidate, index) => sampleZoneStableId(candidate, index) === value);
    const zone = zoneIndex >= 0 ? samplerZones()[zoneIndex] : undefined;
    onChange(props.notes.map((note, index) => {
      if (!selection.includes(index)) return note;
      if (!zone) {
        const nextNote = { ...note };
        delete nextNote.sampleZoneId;
        delete nextNote.samplePath;
        delete nextNote.sampleLabel;
        return nextNote;
      }
      return {
        ...note,
        sampleZoneId: sampleZoneStableId(zone, zoneIndex),
        samplePath: zone.path,
        sampleLabel: sampleZoneDisplayName(zone, zoneIndex),
      };
    }));
  }

  function clearMissingSamplerZoneAssignments() {
    const zoneIds = new Set(samplerZones().map((zone, index) => sampleZoneStableId(zone, index)));
    const zonePaths = new Set(samplerZones().map((zone) => zone.path));
    onChange(props.notes.map((note) => {
      const missingZone = note.sampleZoneId && !zoneIds.has(note.sampleZoneId);
      const missingPath = note.samplePath && !zonePaths.has(note.samplePath);
      if (!missingZone && !missingPath) return note;
      const nextNote = { ...note };
      delete nextNote.sampleZoneId;
      delete nextNote.samplePath;
      delete nextNote.sampleLabel;
      return nextNote;
    }));
  }

  useContextualHotkey(
    () => props.hotkeyScopeId ?? "",
    "b",
    () => {
      setToolMode("draw");
      return true;
    },
    () => Boolean(props.hotkeyScopeId),
  );

  useContextualHotkey(
    () => props.hotkeyScopeId ?? "",
    "v",
    () => {
      setToolMode("select");
      return true;
    },
    () => Boolean(props.hotkeyScopeId),
  );

  function selectAllNotes() {
    setSelected(notes.map((_, index) => index));
    setNoteMenu(null);
    setGridMenu(null);
  }

  useContextualHotkey(
    () => props.hotkeyScopeId ?? "",
    "meta+a",
    () => {
      selectAllNotes();
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
      if (target && rollWrapRef.current?.contains(target)) return;
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
    const pitches = notes
      .map((note) => note.pitch)
      .filter((pitch) => Number.isFinite(pitch) && pitch >= bottomPitch && pitch <= topPitch)
      .sort((a, b) => a - b);
    const visiblePitchCount = VIEW_HEIGHT / PX_PER_PITCH;
    const lowestPitch = pitches[0];
    const highestPitch = pitches[pitches.length - 1];
    const centerPitch = pitches.length === 0
      ? clamp(60, bottomPitch, topPitch)
      : highestPitch - lowestPitch + 1 <= visiblePitchCount
        ? (lowestPitch + highestPitch) / 2
        : pitches[Math.floor(pitches.length / 2)];
    const noteCenter = (topPitch - centerPitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
    const maxScrollTop = Math.max(0, height - VIEW_HEIGHT);
    scroll.scrollTop = clamp(noteCenter - VIEW_HEIGHT / 2, 0, maxScrollTop);
    syncKeyScroll();
  }, []);

  createCompatEffect(() => {
    if (!dragActive()) return;
    function moveDrag(event: PointerEvent | MouseEvent) {
      event.preventDefault();
      onNotePointerMove(event);
    }
    function finishDrag() {
      onNotePointerUp();
    }
    window.addEventListener("pointermove", moveDrag, true);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    window.addEventListener("mousemove", moveDrag, true);
    window.addEventListener("mouseup", finishDrag);
    return () => {
      window.removeEventListener("pointermove", moveDrag, true);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      window.removeEventListener("mousemove", moveDrag, true);
      window.removeEventListener("mouseup", finishDrag);
    };
  }, [dragActive(), notes, selectBox()]);

  function pitchFromY(y: number): number {
    const row = Math.floor(y / PX_PER_PITCH);
    return topPitch - row;
  }
  function curvePitchFromY(y: number, snapToNote: boolean): number {
    const pitch = topPitch - y / PX_PER_PITCH;
    const next = snapToNote ? Math.round(pitch) : Math.round(pitch * 100) / 100;
    return clamp(next, bottomPitch, topPitch);
  }
  function beatFromX(x: number): number {
    return Math.max(0, Math.min(lengthBeats, x / pxPerBeat()));
  }
  function targetFromClient(clientX: number, clientY: number): PasteTarget {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { beat: 0, pitch: bottomPitch };
    const beat = beatFromX(clientX - rect.left);
    const pitch = clamp(pitchFromY(clientY - rect.top), bottomPitch, topPitch);
    return { beat, pitch };
  }
  function snap(beat: number): number {
    if (fixedGridStep != null) return Math.round(beat / fixedGridStep) * fixedGridStep;
    if (!midiSmartGrid()) return beat;
    const factor = midiSubdivision() / 4;
    return Math.round(beat * factor) / factor;
  }
  function snapShiftDrag(beat: number): number {
    if (fixedGridStep != null)
      return clamp(Math.round(beat / fixedGridStep) * fixedGridStep, 0, lengthBeats);
    return clamp(snapMidiBeatToVisibleGrid(beat, pxPerBeat()), 0, lengthBeats);
  }

  function editBeat(beat: number, shiftKey: boolean): number {
    return fixedGridStep != null || shiftKey ? snapShiftDrag(beat) : beat;
  }

  function pushHistorySnapshot() {
    historyRef.current.push(structuredClone(props.notes));
    if (historyRef.current.length > 100) historyRef.current.shift();
  }

  function commitChange(next: MidiNote[]) {
    pushHistorySnapshot();
    onChange(props.maxNotes == null ? next : next.slice(0, Math.max(0, Math.floor(props.maxNotes))));
  }

  function applyTransientChange(next: MidiNote[]) {
    onChange(props.maxNotes == null ? next : next.slice(0, Math.max(0, Math.floor(props.maxNotes))));
  }

  function ensureDragHistory(
    d: Extract<NonNullable<typeof drag.current>, { historyPushed?: boolean }>,
  ) {
    if (d.historyPushed) return;
    pushHistorySnapshot();
    d.historyPushed = true;
  }

  function noteEditDragHasStarted(
    d: Extract<NonNullable<typeof drag.current>, { startX: number; startY: number; editStarted?: boolean }>,
    e: PointerEvent | MouseEvent,
  ): boolean {
    if (d.editStarted) return true;
    if (!midiNotePointerMovedPastThreshold({
      startClientX: d.startX,
      startClientY: d.startY,
      currentClientX: e.clientX,
      currentClientY: e.clientY,
    })) {
      return false;
    }
    d.editStarted = true;
    return true;
  }

  function undoLocal() {
    const previous = historyRef.current.pop();
    if (!previous) return;
    onChange(previous);
    setSelected((prev) => prev.filter((idx) => previous[idx]));
  }

  function capturePointer(event: PointerEvent | MouseEvent) {
    if (!("pointerId" in event)) return;
    const target = event.currentTarget;
    if (!(target instanceof Element)) return;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic verifier events and detached test nodes may not support capture.
    }
  }

  function isMidiInteractiveTarget(target: EventTarget | null) {
    return target instanceof Element && target.closest("[data-midi-interactive='true']") != null;
  }

  function onGridPointerDown(e: PointerEvent) {
    if (isMidiInteractiveTarget(e.target)) return;
    if (e.button !== 0) return;
    e.preventDefault();
    setNoteMenu(null);
    setGridMenu(null);
    setVolumePopover(null);
    setNoteEditor(null);
    capturePointer(e);
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    lastPointerTargetRef.current = { beat: beatFromX(x), pitch: clamp(pitchFromY(y), bottomPitch, topPitch) };
    if (connectFrom() != null) {
      setConnectFrom(null);
      setConnectPointer(null);
      return;
    }
    const activeCurveFrom = curveFrom();
    if (activeCurveFrom != null) {
      completeCurve(activeCurveFrom, {
        beat: editBeat(beatFromX(x), e.shiftKey),
        pitch: clamp(pitchFromY(y), bottomPitch, topPitch),
      });
      return;
    }
    if (toolMode() === "select" || e.altKey) {
      startMarquee(x, y, e.pointerId, e.shiftKey);
      return;
    }
    if (props.maxNotes != null && notes.length >= props.maxNotes) return;
    const beat = editBeat(beatFromX(x), e.shiftKey);
    const pitch = pitchFromY(y);
    const initialLength = clamp(lastDrawnLengthRef.current, minimumNoteLength, Math.max(minimumNoteLength, lengthBeats - beat));
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
    capturePointer(e);
    startMarquee(e.clientX - rect.left, y, e.pointerId, e.shiftKey);
  }

  function startMarquee(anchorX: number, anchorY: number, pointerId: number, additive: boolean) {
    const y = clamp(anchorY, 0, height);
    drag.current = { mode: "select", anchorX, anchorY: y, pointerId, additive, baseSelection: selected() };
    setSelectBox({ left: anchorX, top: y, width: 0, height: 0 });
    setDragActive(true);
  }

  function startLengthResize(e: PointerEvent) {
    if (!onLengthChange || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    capturePointer(e);
    setNoteMenu(null);
    setGridMenu(null);
    setVolumePopover(null);
    setNoteEditor(null);
    drag.current = { mode: "length-resize", startX: e.clientX, startLengthBeats: lengthBeats };
    setLengthHandleActive(true);
    setDragActive(true);
  }

  function notePointerDown(idx: number, e: PointerEvent) {
    if (midiNotePointerRequestsContextMenu(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    lastPointerDownAtRef.current = performance.now();
    startMove(idx, e);
  }

  function noteMouseDown(idx: number, e: MouseEvent) {
    if (midiNotePointerRequestsContextMenu(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (performance.now() - lastPointerDownAtRef.current < 500) return;
    startMove(idx, e);
  }

  function startMove(idx: number, e: PointerEvent | MouseEvent) {
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
    capturePointer(e);
    if (e.altKey) {
      const sourceIndices = linkedSelection(selected().includes(idx) ? selected() : [idx]);
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
        editStarted: true,
      };
      const auditionIdx = duplicated.indices.length === 1 ? duplicated.indices[0] : null;
      dragAuditionRef.current = auditionIdx == null
        ? null
        : { idx: auditionIdx, pitch: duplicated.notes[auditionIdx]?.pitch ?? -1 };
      setDragActive(true);
      return;
    }
    const currentSelection = selected();
    const nextSelection = linkedSelection(midiNoteSelectionAfterPointerDown({
      selectedIndices: currentSelection,
      noteIndex: idx,
      additive: e.shiftKey,
    }));
    const indices = nextSelection;
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
      additiveToggleIndex: e.shiftKey && currentSelection.includes(idx) ? idx : undefined,
    };
    const auditionIdx = indices.length === 1 ? indices[0] : null;
    dragAuditionRef.current = auditionIdx == null
      ? null
      : { idx: auditionIdx, pitch: notes[auditionIdx]?.pitch ?? -1 };
    setDragActive(true);
    setSelected(nextSelection);
  }

  function startResize(idx: number, edge: "left" | "right", e: PointerEvent | MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    capturePointer(e);
    const dragIndices = linkedSelection(midiNoteDragIndicesForSelection(selected(), idx));
    drag.current = {
      mode: "resize",
      indices: dragIndices,
      edge,
      startX: e.clientX,
      startY: e.clientY,
      startNotes: dragIndices.map((i) => ({
        startBeat: notes[i].startBeat,
        lengthBeats: notes[i].lengthBeats,
        curve: structuredClone(notes[i].curve),
        automation: structuredClone(notes[i].automation),
      })),
    };
    setDragActive(true);
    setSelected(dragIndices);
  }

  function onNotePointerMove(e: PointerEvent | MouseEvent) {
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
      const currentBeat = editBeat(beatFromX(e.clientX - rect.left), e.shiftKey);
      const startBeat = Math.min(d.anchorBeat, currentBeat);
      const drawnLength = Math.abs(currentBeat - d.anchorBeat);
      const length = drawnLength > 0 ? Math.max(defaultNoteLength, drawnLength) : d.initialLength;
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
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!noteEditDragHasStarted(d, e)) return;
      ensureDragHistory(d);
      const rawBeatDelta = dx / pxPerBeat();
      const anchorStart = d.startNotes[0];
      const snappedBeatDelta = editBeat(anchorStart.startBeat + rawBeatDelta, e.shiftKey) - anchorStart.startBeat;
      const minimumBeatDelta = Math.max(...d.startNotes.map((start) => -start.startBeat));
      const maximumBeatDelta = Math.min(...d.startNotes.map((start) => lengthBeats - start.startBeat - start.lengthBeats));
      const beatDelta = clamp(snappedBeatDelta, minimumBeatDelta, maximumBeatDelta);
      const rawPitchDelta = -Math.round(dy / PX_PER_PITCH);
      const minimumPitchDelta = Math.max(...d.startNotes.map((start) => bottomPitch - start.pitch));
      const maximumPitchDelta = Math.min(...d.startNotes.map((start) => topPitch - start.pitch));
      const dPitch = clamp(rawPitchDelta, minimumPitchDelta, maximumPitchDelta);
      const next = notes.slice();
      d.indices.forEach((idx, groupIdx) => {
        if (!next[idx]) return;
        const start = d.startNotes[groupIdx];
        const startBeat = start.startBeat + beatDelta;
        const pitch = start.pitch + dPitch;
        next[idx] = {
          ...next[idx],
          startBeat,
          pitch,
          curve: shiftCurveWithNote(start.curve, start.pitch, startBeat, pitch, start.lengthBeats, bottomPitch, topPitch),
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
      const dx = e.clientX - d.startX;
      if (!noteEditDragHasStarted(d, e)) return;
      ensureDragHistory(d);
      const rawLengthDelta = dx / pxPerBeat();
      const anchor = d.startNotes[0];
      const snappedLengthDelta = d.edge === "right"
        ? editBeat(anchor.startBeat + anchor.lengthBeats + rawLengthDelta, e.shiftKey) - anchor.startBeat - anchor.lengthBeats
        : editBeat(anchor.startBeat + rawLengthDelta, e.shiftKey) - anchor.startBeat;
      const minimumLengthDelta = d.edge === "right"
        ? Math.max(...d.startNotes.map((start) => minimumNoteLength - start.lengthBeats))
        : Math.max(...d.startNotes.map((start) => -start.startBeat));
      const maximumLengthDelta = d.edge === "right"
        ? Math.min(...d.startNotes.map((start) => lengthBeats - start.startBeat - start.lengthBeats))
        : Math.min(...d.startNotes.map((start) => start.lengthBeats - minimumNoteLength));
      const dLen = clamp(snappedLengthDelta, minimumLengthDelta, maximumLengthDelta);
      const next = notes.slice();
      d.indices.forEach((idx, groupIdx) => {
        if (!next[idx]) return;
        const start = d.startNotes[groupIdx];
        if (d.edge === "right") {
          next[idx] = {
            ...next[idx],
            lengthBeats: start.lengthBeats + dLen,
          };
        } else {
          const originalEnd = start.startBeat + start.lengthBeats;
          const nextStart = start.startBeat + dLen;
          next[idx] = {
            ...next[idx],
            startBeat: nextStart,
            lengthBeats: originalEnd - nextStart,
          };
        }
        next[idx] = normalizeNoteCurveToBounds(next[idx], bottomPitch, topPitch);
      });
      applyTransientChange(next);
    } else if (d.mode === "curve-handle") {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (!noteEditDragHasStarted(d, e)) return;
      ensureDragHistory(d);
      const next = notes.slice();
      const note = next[d.idx];
      if (!note) return;
      const pitch = curvePitchFromY(e.clientY - rect.top, e.shiftKey);
      next[d.idx] = updateNoteCurveHandle(note, d.edge, pitch, bottomPitch, topPitch);
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
    const finishedDrag = drag.current;
    if (drag.current?.mode === "draw") {
      lastDrawnLengthRef.current = Math.max(minimumNoteLength, drag.current.currentLength);
    }
    const currentSelectBox = selectBox();
    if (finishedDrag?.mode === "select" && currentSelectBox) {
      const selectedIndices = notes
        .map((note, index) => ({ note, index, rect: visibleNoteRect(note) }))
        .filter(({ rect }) => rect ? rectsIntersect(currentSelectBox, rect) : false)
        .map(({ index }) => index);
      setSelected(linkedSelection(midiNoteSelectionAfterMarquee({
        selectedIndices: finishedDrag.baseSelection,
        marqueeIndices: selectedIndices,
        additive: finishedDrag.additive,
      })));
      setSelectBox(null);
    }
    if (finishedDrag?.mode === "move" && finishedDrag.additiveToggleIndex != null) {
      setSelected((current) => {
        const baseSelection = midiNoteSelectionAfterAdditiveClick({
          selectedIndices: current,
          noteIndex: finishedDrag.additiveToggleIndex!,
          moved: Boolean(finishedDrag.editStarted),
        });
        if (finishedDrag.editStarted) return baseSelection;
        const toggledGroup = midiGroupIndices(props.notes, [finishedDrag.additiveToggleIndex!]);
        const toggled = new Set(toggledGroup);
        return baseSelection.filter((index) => !toggled.has(index));
      });
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
    const nextSelected = linkedSelection(midiNoteSelectionForContextMenu(selected(), idx));
    setSelected(nextSelected);
    setVolumePopover(null);
    setNoteEditor(null);
    setArpeggiationSequenceSelectOpen(false);
    setArpeggiationPopover(null);
    setGridMenu(null);
    const target = targetFromClient(e.clientX, e.clientY);
    lastPointerTargetRef.current = target;
    setNoteMenu({ idx, x: e.clientX, y: e.clientY, target });
  }

  function openArpeggiationEditor(idx: number) {
    const indices = linkedSelection();
    if (!midiSelectionCanArpeggiate(props.notes, indices)) return;
    const current = midiSelectionArpeggiation(props.notes, indices);
    setArpeggiationPopover({
      indices,
      idx,
      x: 0,
      y: 0,
      loops: current?.loops ?? 1,
      sequence: current?.sequence ?? "up",
      timingType: current?.timingType ?? "loops",
      noteValue: current?.noteValue ?? 16,
    });
  }

  function applyArpeggiation() {
    const current = arpeggiationPopover();
    if (!current) return;
    const result = setMidiArpeggiation(props.notes, current.indices, {
      loops: current.loops,
      sequence: current.sequence,
      timingType: current.timingType,
      noteValue: current.noteValue,
    });
    if (result.indices.length < 2) return;
    commitChange(result.notes);
    setSelected(result.indices);
    setArpeggiationSequenceSelectOpen(false);
    setArpeggiationPopover(null);
  }

  function groupCurrentSelection() {
    const result = groupMidiNotes(props.notes, linkedSelection());
    if (result.indices.length < 2) return;
    commitChange(result.notes);
    setSelected(result.indices);
  }

  function ungroupCurrentSelection() {
    const indices = linkedSelection();
    commitChange(ungroupMidiNotes(props.notes, indices));
    setSelected(indices);
  }

  function removeCurrentArpeggiation() {
    const indices = linkedSelection();
    commitChange(removeMidiArpeggiation(props.notes, indices));
    setSelected(indices);
  }

  function openGridMenu(e: MouseEvent) {
    if (isMidiInteractiveTarget(e.target)) return;
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
    setSelected(linkedSelection([idx]));
    setNoteMenu(null);
    setGridMenu(null);
    setVolumePopover(null);
    setNoteEditor({
      idx,
      x: rect.left,
      y: rect.bottom + 4,
      value: String(clamp(Math.round(note.velocity), 0, 127)),
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
    for (const index of linkedSelection([current.idx])) {
      next[index] = { ...next[index], velocity };
    }
    commitChange(next);
    setVolumePopover(null);
  }

  function applyNoteEditorVelocity() {
    const current = noteEditor();
    if (!current) return;
    const velocity = parseVelocityInput(current.value);
    if (velocity == null) {
      setNoteEditor({ ...current, error: true });
      return;
    }
    const next = notes.slice();
    for (const index of linkedSelection([current.idx])) {
      next[index] = { ...next[index], velocity };
    }
    commitChange(next);
  }

  function startCurveHandleDrag(idx: number, edge: "start" | "end", e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    capturePointer(e);
    setNoteMenu(null);
    setGridMenu(null);
    setVolumePopover(null);
    setSelected(linkedSelection([idx]));
    drag.current = { mode: "curve-handle", idx, edge, startX: e.clientX, startY: e.clientY };
    setDragActive(true);
  }

  function clearNoteVolume() {
    const current = volumePopover();
    if (!current) return;
    const next = notes.slice();
    for (const index of linkedSelection([current.idx])) {
      next[index] = { ...next[index], velocity: 127 };
    }
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
    const targetPitch = clamp(target.pitch ?? note.pitch, bottomPitch, topPitch);
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
    setSelected(linkedSelection([idx]));
    setCurveFrom(null);
    setCurvePointer(null);
  }

  function deleteNote(idx: number) {
    const removed = new Set(linkedSelection(selected().includes(idx) ? selected() : [idx]));
    const indexMap = new Map<number, number>();
    let nextIndex = 0;
    notes.forEach((_, index) => {
      if (!removed.has(index)) indexMap.set(index, nextIndex++);
    });
    const next = notes
      .filter((_, index) => !removed.has(index))
      .map((note) => {
        const to = note.connectToIndex;
        if (to == null) return note;
        return { ...note, connectToIndex: indexMap.get(to) };
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
    const indices = linkedSelection(selected().length > 0 ? selected() : fallbackIdx == null ? [] : [fallbackIdx]);
    return copyNotes(indices);
  }

  function pasteCopiedNotes(_target?: PasteTarget): boolean {
    if (!midiNoteClipboard || midiNoteClipboard.notes.length === 0) return false;
    const maxStart = Math.max(0, lengthBeats - midiNoteClipboard.spanBeats);
    const startBeat = clamp(snap(midiNoteClipboard.nextStartBeat), 0, maxStart);
    const basePitch = clamp(
      midiNoteClipboard.minPitch,
      bottomPitch,
      topPitch - midiNoteClipboard.pitchSpan,
    );
    const baseIndex = notes.length;
    const pasted = remapPastedMidiGroups(midiNoteClipboard.notes).map((note) => ({
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
        setArpeggiationSequenceSelectOpen(false);
        setArpeggiationPopover(null);
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
        if (props.hotkeyScopeId) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        selectAllNotes();
        return;
      }
      if (isCopyPasteModifier && e.key.toLowerCase() === "c") {
        if (!copyCurrentSelection()) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      if (isCopyPasteModifier && e.key.toLowerCase() === "v") {
        if (!pasteCopiedNotes()) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (selected().length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const removed = new Set(linkedSelection(selected()));
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
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selected(), notes, onChange, volumePopover(), props.playheadBeat]);

  createCompatEffect(() => {
    if (connectFrom() == null && curveFrom() == null && !noteMenu() && !gridMenu() && !volumePopover() && !noteEditor() && !arpeggiationPopover()) return;
    function cancel(e: MouseEvent) {
      const target = e.target as Node;
      if (rollWrapRef.current?.contains(target)) return;
      if ((target as Element).closest?.("[data-floating-layer]")) return;
      setNoteMenu(null);
      setGridMenu(null);
      setVolumePopover(null);
      setNoteEditor(null);
      setArpeggiationSequenceSelectOpen(false);
      setArpeggiationPopover(null);
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
  }, [connectFrom(), curveFrom(), noteMenu(), gridMenu(), volumePopover(), noteEditor(), arpeggiationPopover()]);

  function syncKeyScroll() {
    if (!keysScrollRef.current || !timeScrollRef.current) return;
    keysScrollRef.current.scrollTop = timeScrollRef.current.scrollTop;
    setViewportVersion((version) => version + 1);
  }

  function zoom(delta: number, clientX?: number) {
    setPxPerBeat((current) => {
      const next = Math.max(MIN_PX_PER_BEAT, Math.min(MAX_PX_PER_BEAT, current + delta));
      const scroll = timeScrollRef.current;
      if (scroll && next !== current) {
        const rect = scroll.getBoundingClientRect();
        const x = clientX == null ? rect.width / 2 : clientX - rect.left;
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
      top: (topPitch - note.pitch) * PX_PER_PITCH,
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
      top: (topPitch - note.pitch) * PX_PER_PITCH,
      width: Math.max(1, (end - start) * pxPerBeat()),
      height: PX_PER_PITCH,
    };
  }

  const activeArpeggiationPitches = createMemo(() => {
    const beat = props.playheadBeat;
    const activeByGroup = new Map<string, Set<number>>();
    if (beat == null) return activeByGroup;
    const groupIds = new Set(props.notes
      .filter((note) => note.groupId && note.arpeggiation)
      .map((note) => note.groupId!));
    for (const groupId of groupIds) {
      const rendered = renderMidiArpeggiations(props.notes.filter((note) => note.groupId === groupId));
      activeByGroup.set(groupId, new Set(rendered
        .filter((note) => beat >= note.startBeat && beat < note.startBeat + note.lengthBeats)
        .map((note) => note.pitch)));
    }
    return activeByGroup;
  });

  function isNotePlaying(note: MidiNote): boolean {
    if (note.arpeggiation && note.groupId) return activeArpeggiationPitches().get(note.groupId)?.has(note.pitch) ?? false;
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

  function noteAnchoredViewportState<T extends { idx: number; x: number; y: number }>(
    state: T,
    floatingWidth: number,
    floatingHeight: number,
  ): T {
    viewportVersion();
    pxPerBeat();
    const note = notes[state.idx];
    const rect = note ? noteViewportRect(note) : null;
    const viewport = timeScrollRef.current?.getBoundingClientRect();
    if (!rect || !viewport) return state;
    const margin = 4;
    const minX = viewport.left + margin;
    const maxX = Math.max(minX, viewport.right - floatingWidth - margin);
    const minY = viewport.top + margin;
    const maxY = Math.max(minY, viewport.bottom - floatingHeight - margin);
    const anchorX = clamp(rect.left + rect.width / 2, viewport.left, viewport.right);
    const below = rect.bottom + margin;
    const above = rect.top - floatingHeight - margin;
    const y = rect.bottom < viewport.top
      ? minY
      : rect.top > viewport.bottom
        ? maxY
        : below + floatingHeight <= viewport.bottom - margin
          ? below
          : above >= minY
            ? above
            : clamp(below, minY, maxY);
    return {
      ...state,
      x: clamp(anchorX - floatingWidth / 2, minX, maxX),
      y,
    };
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
    for (let p = topPitch; p >= bottomPitch; p--) {
      const name = NOTE_NAMES[((p % 12) + 12) % 12];
      const octave = Math.floor(p / 12) - 1;
      out.push({ pitch: p, label: props.pitchLabel?.(p) ?? `${name}${octave}`, isBlack: name.includes("#") });
    }
    return out;
  }, []);

  return (
    <div ref={(element) => { rollWrapRef.current = element; }} class={styles.rollWrap}>
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
              role="listbox"
              aria-label="MIDI notes"
              aria-multiselectable="true"
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
                data-midi-interactive="true"
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
                  class={`${styles.beatLine} ${midiGridLineClass(line.kind)}`}
                  style={{ left: px(line.beat * pxPerBeat()) }}
                  data-midi-grid-division={line.kind}
                />
              ))}

              <svg class={styles.connections} width={width()} height={height} aria-hidden>
                {notes.map((note, i) => {
                  if (!note.curve || note.curve.length < 2) return null;
                  if (noteEditor()?.idx === i) return null;
                  const [from, to] = note.curve;
                  const noteCenterY = (topPitch - note.pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
                  const x1 = from.beat * pxPerBeat();
                  const y1 = (topPitch - from.pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
                  const x2 = to.beat * pxPerBeat();
                  const y2 = (topPitch - to.pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
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
                  const y1 = (topPitch - note.pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
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

            {/* Linked-note groups remain source geometry; arpeggiation is rendered only for playback/export. */}
            <For each={noteGroupBounds()}>
              {(group) => (
                <div
                  class={`${styles.noteGroupOutline} ${group.arpeggiated ? styles.noteGroupOutlineArpeggiated : ""}`}
                  style={{
                    left: px(group.minStartBeat * pxPerBeat() - 3),
                    top: px((topPitch - group.maxPitch) * PX_PER_PITCH - 3),
                    width: px((group.maxEndBeat - group.minStartBeat) * pxPerBeat() + 6),
                    height: px((group.maxPitch - group.minPitch + 1) * PX_PER_PITCH + 6),
                  }}
                  data-midi-note-group={group.groupId}
                  data-arpeggiated={group.arpeggiated ? "true" : "false"}
                  aria-hidden
                />
              )}
            </For>

            {/* Notes */}
            <For each={props.notes}>
              {(n, index) => {
                const i = index();
                const rect = createMemo(() => visibleNoteRect(n));
                const noteStyle = createMemo(() => {
                  const currentRect = rect();
                  if (!currentRect) return { display: "none" } as JSX.CSSProperties;
                  const volumePercent = Math.round((clamp(n.velocity, 0, 127) / 127) * 100);
                  return {
                    left: px(currentRect.left),
                    top: px(currentRect.top),
                    width: px(currentRect.width),
                    height: px(currentRect.height),
                    "--note-volume": `${volumePercent}%`,
                  } as JSX.CSSProperties;
                });
                const isSelected = () => selected().includes(i);
                const isAuditioned = () => auditionedNoteIndex() === i;
                const isPlaying = () => isNotePlaying(n);
                const hoveredSide = () => {
                  const hovered = hoveredNoteSide();
                  return hovered?.idx === i ? hovered.side : null;
                };
                const volumePercent = Math.round((clamp(n.velocity, 0, 127) / 127) * 100);
                const hasAutomation = midiNoteAutomationTargetCount(n) > 0;
                const hasArpeggiation = Boolean(n.arpeggiation);
                const hasActiveAutomation = () => midiNoteHasAutomationTarget(n, activeAutomationTarget());
                return (
                  <div
                    class={[
                      styles.note,
                      isSelected() && styles.noteSelected,
                      isAuditioned() && styles.noteAuditioned,
                      isPlaying() && styles.notePlaying,
                      hasArpeggiation && styles.noteArpeggiated,
                      hoveredSide() === "left" && styles.noteHoverLeft,
                      hoveredSide() === "right" && styles.noteHoverRight,
                    ].filter(Boolean).join(" ")}
                    style={noteStyle()}
                    data-midi-note-index={String(i)}
                    data-midi-interactive="true"
                    role="option"
                    aria-selected={isSelected()}
                    aria-label={`${NOTE_NAMES[((n.pitch % 12) + 12) % 12]}${Math.floor(n.pitch / 12) - 1}, beat ${roundTo(n.startBeat, 0.001)}, ${roundTo(n.lengthBeats, 0.001)} beats`}
                    tabIndex={isSelected() ? 0 : -1}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      setSelected((current) => event.shiftKey
                        ? current.includes(i)
                          ? current.filter((index) => !midiGroupIndices(props.notes, [i]).includes(index))
                          : midiGroupIndices(props.notes, [...current, i])
                        : midiGroupIndices(props.notes, [i]));
                    }}
                    onPointerDown={(e) => notePointerDown(i, e)}
                    onMouseDown={(e) => noteMouseDown(i, e)}
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
                    {hasActiveAutomation() && <div class={styles.noteAutomationStripe} aria-hidden />}
                    {hasArpeggiation ? (
                      <div
                        class={`${styles.noteAutomationBadge} ${styles.noteArpeggiationBadge}`}
                        aria-label="Arpeggiated note"
                        title="Arpeggiated note"
                      >
                        A
                      </div>
                    ) : hasAutomation && (
                      <div
                        class={styles.noteAutomationBadge}
                        aria-label="Note automation"
                        title="Note automation"
                      />
                    )}
                    <div
                      class={`${styles.noteResize} ${styles.noteResizeLeft}`}
                      data-midi-interactive="true"
                      onPointerDown={(e) => startResize(i, "left", e)}
                      onPointerMove={onNotePointerMove}
                      onPointerUp={onNotePointerUp}
                    />
                    <div
                      class={`${styles.noteResize} ${styles.noteResizeRight}`}
                      data-midi-interactive="true"
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
                        activeEdge={dragActive() && drag.current?.mode === "curve-handle" && drag.current.idx === i ? drag.current.edge : null}
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
          <HoverInfo content="Draw notes (B)">
            <Button
              iconOnly
              size="xs"
              selected={toolMode() === "draw"}
              onClick={() => setToolMode("draw")}
              aria-label="Draw notes tool, B"
            >
              <Icon name="ph:pen" size={18} decorative />
            </Button>
          </HoverInfo>
          <HoverInfo content="Select notes (V)">
            <Button
              iconOnly
              size="xs"
              selected={toolMode() === "select"}
              onClick={() => setToolMode("select")}
              aria-label="Select notes tool, V"
            >
              <Icon name="ph:cursor" size={18} decorative />
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
              <Icon name="ph:magnifying-glass-minus" size={18} decorative />
            </Button>
          </HoverInfo>
          <HoverInfo content="Zoom in">
            <Button
              iconOnly
              size="xs"
              onClick={() => zoom(ZOOM_STEP)}
              aria-label="Zoom MIDI editor in"
            >
              <Icon name="ph:magnifying-glass-plus" size={18} decorative />
            </Button>
          </HoverInfo>
        </div>
        {showSamplerZoneControls() && (
          <div class={styles.samplerPanel} aria-label="Sampler zone note overrides">
            <div class={styles.samplerHeader}>
              <span>Sampler zone</span>
              <span>{selectedSampleSummary()}</span>
              {missingSamplerZoneCount() > 0 && (
                <span class={styles.samplerWarning}>
                  {missingSamplerZoneCount()} missing
                </span>
              )}
              {missingSamplerZoneCount() > 0 && (
                <Button size="xs" onClick={clearMissingSamplerZoneAssignments}>
                  Clear
                </Button>
              )}
            </div>
            <FloatingSelect
              className={styles.samplerSelect}
              value={selectedSampleZoneValue()}
              options={samplerZoneOptions()}
              open={sampleZoneSelectOpen()}
              onOpenChange={setSampleZoneSelectOpen}
              onChange={assignSampleZoneToSelection}
              ariaLabel="Assign selected MIDI notes to a sampler zone"
            />
          </div>
        )}
        {ENABLE_AETHER_NOTE_AUTOMATION_PANEL && props.showAutomation && (
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
              <Slider layout="inline" label="Start" min={activeAutomationMeta().min} max={activeAutomationMeta().max} step={activeAutomationMeta().step} value={selectedAutomationValueRange().startValue} disabled={selected().length === 0} readout={formatAetherNoteAutomationValue(activeAutomationTarget(), selectedAutomationValueRange().startValue)} onChange={(value) => setAutomationValueEdge("start", String(value))} />
              <Slider layout="inline" label="Mid" min={activeAutomationMeta().min} max={activeAutomationMeta().max} step={activeAutomationMeta().step} value={selectedAutomationValueRange().midValue} disabled={selected().length === 0} readout={formatAetherNoteAutomationValue(activeAutomationTarget(), selectedAutomationValueRange().midValue)} onChange={(value) => setAutomationValueEdge("mid", String(value))} />
              <Slider layout="inline" label="End" min={activeAutomationMeta().min} max={activeAutomationMeta().max} step={activeAutomationMeta().step} value={selectedAutomationValueRange().endValue} disabled={selected().length === 0} readout={formatAetherNoteAutomationValue(activeAutomationTarget(), selectedAutomationValueRange().endValue)} onChange={(value) => setAutomationValueEdge("end", String(value))} />
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
                      <Checkbox
                        inputClassName={styles.automationPointSelect}
                        checked={activeSelectedAutomationPointIndices().includes(index())}
                        readOnly
                        aria-label={`Select automation point ${index() + 1}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleAutomationPointSelection(index());
                        }}
                      />
                      <span class={styles.automationPointIndex}>{index() + 1}</span>
                      <NumberInput layout="inline" label="Beat" min={0} max={selectedAutomationPointLength()} step={0.125} value={roundTo(point.beat, 0.001)} disabled={selected().length === 0} onChange={(value) => setAutomationPointBeat(index(), String(value))} />
                      <NumberInput layout="inline" label="Value" min={activeAutomationMeta().min} max={activeAutomationMeta().max} step={activeAutomationMeta().step} value={roundTo(point.value, activeAutomationMeta().step)} disabled={selected().length === 0} onChange={(value) => setAutomationPointValue(index(), String(value))} />
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
        const currentNoteMenu = anchoredNoteMenu();
        if (!currentNoteMenu) return null;
        const menuSelection = linkedSelection();
        const grouped = midiSelectionIsSingleGroup(props.notes, menuSelection);
        const arpeggiation = midiSelectionArpeggiation(props.notes, menuSelection);
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
          onArpeggiation={() => {
            openArpeggiationEditor(currentNoteMenu.idx);
            setNoteMenu(null);
          }}
          onGroup={() => {
            groupCurrentSelection();
            setNoteMenu(null);
          }}
          onUngroup={() => {
            ungroupCurrentSelection();
            setNoteMenu(null);
          }}
          onRemoveArpeggiation={() => {
            removeCurrentArpeggiation();
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
          canArpeggiate={midiSelectionCanArpeggiate(props.notes, menuSelection)}
          canGroup={menuSelection.length >= 2}
          isGrouped={grouped}
          hasArpeggiation={Boolean(arpeggiation)}
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
        const currentVolumePopover = anchoredVolumePopover();
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
        const currentNoteEditor = anchoredNoteEditor();
        if (!currentNoteEditor) return null;
        return (
        <VolumePopover
          state={currentNoteEditor}
          label="Velocity"
          maxValue={127}
          unit=""
          errorText="Use 0-127"
          showClear={false}
          secondaryLabel="Volume"
          secondaryValue={`${velocityToPercent(Number(currentNoteEditor.value))}%`}
          onChange={(value: string) => setNoteEditor({ ...currentNoteEditor, value, error: false })}
          onApply={applyNoteEditorVelocity}
          onClear={() => {
            setNoteEditor({ ...currentNoteEditor, value: "127", error: false });
            const next = notes.slice();
            for (const index of linkedSelection([currentNoteEditor.idx])) {
              next[index] = { ...next[index], velocity: 127 };
            }
            commitChange(next);
          }}
        />
        );
      })()}
      {(() => {
        const currentArpeggiation = anchoredArpeggiationPopover();
        if (!currentArpeggiation) return null;
        return (
          <ArpeggiationPopover
            state={currentArpeggiation}
            sequenceOpen={arpeggiationSequenceSelectOpen()}
            onSequenceOpenChange={setArpeggiationSequenceSelectOpen}
            onTimingTypeChange={(timingType) => setArpeggiationPopover({ ...currentArpeggiation, timingType })}
            onNoteValueChange={(noteValue) => setArpeggiationPopover({ ...currentArpeggiation, noteValue })}
            onLoopsChange={(loops) => setArpeggiationPopover({ ...currentArpeggiation, loops })}
            onSequenceChange={(sequence) => {
              setArpeggiationPopover({ ...currentArpeggiation, sequence });
              setArpeggiationSequenceSelectOpen(false);
            }}
            onApply={applyArpeggiation}
            onCancel={() => {
              setArpeggiationSequenceSelectOpen(false);
              setArpeggiationPopover(null);
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
  onArpeggiation,
  onGroup,
  onUngroup,
  onRemoveArpeggiation,
  onCopy,
  onPaste,
  onDelete,
  canCopy,
  canPaste,
  canArpeggiate,
  canGroup,
  isGrouped,
  hasArpeggiation,
}: {
  x: number;
  y: number;
  onVolume: () => void;
  onConnect: () => void;
  onCurve: () => void;
  onArpeggiation: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onRemoveArpeggiation: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  canCopy: boolean;
  canPaste: boolean;
  canArpeggiate: boolean;
  canGroup: boolean;
  isGrouped: boolean;
  hasArpeggiation: boolean;
}) {
  const runMenuAction = (event: MouseEvent, action: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  return createPortal(
    <FloatingLayer class={styles.noteMenu} x={x} y={y} role="menu">
      <Button variant="ghost" fullWidth class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onVolume)} role="menuitem">
        Volume
      </Button>
      <Button variant="ghost" fullWidth class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onConnect)} role="menuitem">
        Connect To
      </Button>
      <Button variant="ghost" fullWidth class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onCurve)} role="menuitem">
        Curve To…
      </Button>
      <Button
        variant="ghost"
        fullWidth
        class={styles.noteMenuItem}
        onClick={(event) => runMenuAction(event, onArpeggiation)}
        disabled={!canArpeggiate}
        title={!canArpeggiate ? "Select at least two different pitches" : undefined}
        role="menuitem"
      >
        {hasArpeggiation ? "Edit arpeggiation…" : "Create arpeggiation…"}
      </Button>
      {!isGrouped && (
        <Button variant="ghost" fullWidth class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onGroup)} disabled={!canGroup} role="menuitem">
          Group notes
        </Button>
      )}
      {isGrouped && (
        <Button variant="ghost" fullWidth class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onUngroup)} role="menuitem">
          Ungroup notes
        </Button>
      )}
      {hasArpeggiation && (
        <Button variant="ghost" fullWidth class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onRemoveArpeggiation)} role="menuitem">
          Remove arpeggiation
        </Button>
      )}
      <Button variant="ghost" fullWidth class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onCopy)} disabled={!canCopy} role="menuitem">
        Copy
      </Button>
      <Button variant="ghost" fullWidth class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onPaste)} disabled={!canPaste} role="menuitem">
        Paste
      </Button>
      <Button variant="ghost" fullWidth class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onDelete)} role="menuitem">
        Delete
      </Button>
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
      <Button variant="ghost" fullWidth class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onCopy)} disabled={!canCopy} role="menuitem">
        Copy
      </Button>
      <Button variant="ghost" fullWidth class={styles.noteMenuItem} onClick={(event) => runMenuAction(event, onPaste)} disabled={!canPaste} role="menuitem">
        Paste
      </Button>
    </FloatingLayer>,
    document.body,
  );
}

function ArpeggiationPopover(props: {
  state: ArpeggiationPopoverState;
  sequenceOpen: boolean;
  onSequenceOpenChange: (open: boolean) => void;
  onTimingTypeChange: (timingType: MidiArpeggiationTimingType) => void;
  onNoteValueChange: (noteValue: MidiArpeggiationNoteValue) => void;
  onLoopsChange: (loops: number) => void;
  onSequenceChange: (sequence: MidiArpeggiationSequence) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <FloatingLayer class={styles.arpeggiationPopover} x={props.state.x} y={props.state.y} role="dialog" aria-label="Arpeggiation settings">
      <div class={styles.arpeggiationTitle}>Arpeggiation</div>
      <FloatingSelect
        className={styles.arpeggiationSelect}
        layout="inline"
        label="Type"
        value={props.state.timingType}
        options={ARPEGGIATION_TIMING_OPTIONS}
        onChange={(value) => props.onTimingTypeChange(value as MidiArpeggiationTimingType)}
        ariaLabel="Arpeggiation timing type"
      />
      {props.state.timingType === "loops" ? (
        <NumberInput
          layout="inline"
          label="Loops"
          min={1}
          max={64}
          step={1}
          value={props.state.loops}
          onChange={(value) => props.onLoopsChange(Math.max(1, Math.min(64, Math.round(value))))}
        />
      ) : (
        <FloatingSelect
          className={styles.arpeggiationSelect}
          layout="inline"
          label="Note value"
          value={String(props.state.noteValue)}
          options={ARPEGGIATION_NOTE_VALUE_OPTIONS}
          onChange={(value) => props.onNoteValueChange(Number(value) as MidiArpeggiationNoteValue)}
          ariaLabel="Arpeggiation note value"
        />
      )}
      <FloatingSelect
        className={styles.arpeggiationSequence}
        layout="inline"
        label="Sequence"
        value={props.state.sequence}
        options={ARPEGGIATION_SEQUENCE_OPTIONS}
        open={props.sequenceOpen}
        onOpenChange={props.onSequenceOpenChange}
        onChange={(value) => props.onSequenceChange(value as MidiArpeggiationSequence)}
        ariaLabel="Arpeggiation sequence"
      />
      <div class={styles.arpeggiationActions}>
        <Button size="xs" variant="ghost" onClick={props.onCancel}>Cancel</Button>
        <Button size="xs" onClick={props.onApply}>Apply</Button>
      </div>
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

interface ArpeggiationPopoverState {
  indices: number[];
  idx: number;
  x: number;
  y: number;
  loops: number;
  sequence: MidiArpeggiationSequence;
  timingType: MidiArpeggiationTimingType;
  noteValue: MidiArpeggiationNoteValue;
}

function CurveHandles({
  note,
  noteIndex,
  pxPerBeat,
  activeEdge,
  onPointerDown,
}: {
  note: MidiNote;
  noteIndex: number;
  pxPerBeat: number;
  activeEdge: "start" | "end" | null;
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
      <button
        type="button"
        class={`${styles.curveHandle} ${styles.curveHandleStart} ${activeEdge === "start" ? styles.curveHandleActive : ""}`}
        style={{ left: px(0), top: px(startY) }}
        title={`Start ${formatPitchValue(startPitch)}`}
        data-midi-note-detail
        data-midi-interactive="true"
        aria-label={`Drag pitch curve start handle, ${formatPitchValue(startPitch)}`}
        onPointerDown={(event) => onPointerDown(noteIndex, "start", event)}
      />
      <button
        type="button"
        class={`${styles.curveHandle} ${styles.curveHandleEnd} ${activeEdge === "end" ? styles.curveHandleActive : ""}`}
        style={{ left: px(endX), top: px(endY) }}
        title={`End ${formatPitchValue(endPitch)}`}
        data-midi-note-detail
        data-midi-interactive="true"
        aria-label={`Drag pitch curve end handle, ${formatPitchValue(endPitch)}`}
        onPointerDown={(event) => onPointerDown(noteIndex, "end", event)}
      />
    </>
  );
}

function VolumePopover({
  state,
  label = "Volume",
  maxValue = 100,
  unit = "%",
  errorText = "Use 0-100%",
  showClear = true,
  secondaryLabel,
  secondaryValue,
  onChange,
  onApply,
  onClear,
}: {
  state: VolumePopoverState;
  label?: string;
  maxValue?: number;
  unit?: string;
  errorText?: string;
  showClear?: boolean;
  secondaryLabel?: string;
  secondaryValue?: string;
  onChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const numericValue = Math.max(0, Math.min(maxValue, Math.round(Number(state.value.replace(/%$/, "")) || 0)));
  const valueFromPointer = (slider: HTMLElement, clientX: number) => {
    const rect = slider.getBoundingClientRect();
    if (rect.width <= 0) return String(numericValue);
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return String(Math.round(ratio * maxValue));
  };
  const updateValueFromPointer = (slider: HTMLElement, clientX: number) => {
    onChange(valueFromPointer(slider, clientX));
  };
  const updateValueByStep = (delta: number) => {
    onChange(String(clamp(numericValue + delta, 0, maxValue)));
  };
  let mouseDragInput: HTMLElement | null = null;
  const stopMouseDrag = () => {
    window.removeEventListener("mousemove", handleMouseMove, true);
    window.removeEventListener("mouseup", handleMouseUp, true);
    mouseDragInput = null;
  };
  const handleMouseMove = (event: MouseEvent) => {
    if (!mouseDragInput) return;
    event.preventDefault();
    event.stopPropagation();
    updateValueFromPointer(mouseDragInput, event.clientX);
  };
  const handleMouseUp = (event: MouseEvent) => {
    if (!mouseDragInput) return;
    event.preventDefault();
    event.stopPropagation();
    updateValueFromPointer(mouseDragInput, event.clientX);
    stopMouseDrag();
    onApply();
  };
  const handleMouseDown = (event: MouseEvent & { currentTarget: HTMLElement }) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    mouseDragInput = event.currentTarget;
    updateValueFromPointer(event.currentTarget, event.clientX);
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
  };
  onCleanup(stopMouseDrag);
  return createPortal(
    <FloatingLayer class={styles.volumePopover} x={state.x} y={state.y}>
      <div class={`${styles.volumeSliderRow} ${!showClear ? styles.volumeSliderRowNoClear : ""}`} data-midi-note-detail>
        <span class={styles.volumeLabel}>{label}</span>
        <div
          class={styles.volumeSlider}
          role="slider"
          tabIndex={0}
          aria-label={`${label} value`}
          aria-valuemin={0}
          aria-valuemax={maxValue}
          aria-valuenow={numericValue}
          aria-valuetext={`${numericValue}${unit}`}
          style={{ "--volume-slider-percent": `${(numericValue / maxValue) * 100}%` } as JSX.CSSProperties}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Synthetic verifier events and detached test nodes may not support capture.
            }
            updateValueFromPointer(e.currentTarget, e.clientX);
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            updateValueFromPointer(e.currentTarget, e.clientX);
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              updateValueFromPointer(e.currentTarget, e.clientX);
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            onApply();
          }}
          onMouseDown={handleMouseDown}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              onApply();
              return;
            }
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              e.stopPropagation();
              updateValueByStep(-1);
              return;
            }
            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              e.stopPropagation();
              updateValueByStep(1);
              return;
            }
            if (e.key === "PageDown") {
              e.preventDefault();
              e.stopPropagation();
              updateValueByStep(-10);
              return;
            }
            if (e.key === "PageUp") {
              e.preventDefault();
              e.stopPropagation();
              updateValueByStep(10);
              return;
            }
            if (e.key === "Home" || e.key === "End") {
              e.preventDefault();
              e.stopPropagation();
              onChange(e.key === "Home" ? "0" : String(maxValue));
            }
          }}
        >
          <span class={styles.volumeSliderTrack} aria-hidden />
          <span class={styles.volumeSliderFill} aria-hidden />
          <span class={styles.volumeSliderThumb} aria-hidden />
        </div>
        <span class={styles.volumeValue}>{numericValue}{unit}</span>
        {showClear && (
          <Button iconOnly size="xs" variant="ghost" class={styles.volumeClear} onClick={onClear} aria-label="Clear note volume">
            x
          </Button>
        )}
      </div>
      {secondaryLabel && secondaryValue && (
        <div class={styles.volumeSecondaryRow} data-midi-note-detail>
          <span>{secondaryLabel}</span>
          <span>{secondaryValue}</span>
        </div>
      )}
      {state.error && <div class={styles.volumeError}>{errorText}</div>}
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

function parseVelocityInput(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const velocity = Number(normalized);
  if (!Number.isFinite(velocity)) return null;
  return Math.round(Math.max(0, Math.min(127, velocity)));
}

function duplicateNotes(notes: MidiNote[], indices: number[]): { notes: MidiNote[]; indices: number[] } {
  const unique = Array.from(new Set(indices))
    .filter((idx) => notes[idx])
    .sort((a, b) => a - b);
  if (unique.length === 0) return { notes, indices: [] };
  const baseIndex = notes.length;
  const indexMap = new Map(unique.map((idx, copyIdx) => [idx, baseIndex + copyIdx]));
  const duplicated = remapPastedMidiGroups(unique.map((idx) => {
    const note = structuredClone(notes[idx]);
    return {
      ...note,
      connectToIndex: note.connectToIndex == null ? undefined : indexMap.get(note.connectToIndex),
    };
  }));
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

function normalizeNoteCurveToBounds(note: MidiNote, bottomPitch = BOTTOM_PITCH, topPitch = TOP_PITCH): MidiNote {
  if (!note.curve || note.curve.length < 2) return note;
  return {
    ...note,
    curve: [
      { beat: note.startBeat, pitch: curveEdgePitch(note, "start", bottomPitch, topPitch) },
      { beat: note.startBeat + note.lengthBeats, pitch: curveEdgePitch(note, "end", bottomPitch, topPitch) },
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
  bottomPitch = BOTTOM_PITCH,
  topPitch = TOP_PITCH,
): MidiNote["curve"] {
  if (!curve || curve.length < 2) return undefined;
  const deltaPitch = nextPitch - oldPitch;
  const startPitch = clamp(curve[0]?.pitch + deltaPitch, bottomPitch, topPitch);
  const endPitch = clamp(curve[curve.length - 1]?.pitch + deltaPitch, bottomPitch, topPitch);
  return [
    { beat: nextStartBeat, pitch: startPitch },
    { beat: nextStartBeat + lengthBeats, pitch: endPitch },
  ];
}

function updateNoteCurveHandle(
  note: MidiNote,
  edge: "start" | "end",
  pitch: number,
  bottomPitch = BOTTOM_PITCH,
  topPitch = TOP_PITCH,
): MidiNote {
  const curved = note.curve && note.curve.length >= 2
    ? normalizeNoteCurveToBounds(note, bottomPitch, topPitch)
    : defaultNoteCurve(note);
  const startPitch = edge === "start" ? pitch : curveEdgePitch(curved, "start", bottomPitch, topPitch);
  const endPitch = edge === "end" ? pitch : curveEdgePitch(curved, "end", bottomPitch, topPitch);
  return {
    ...curved,
    curve: [
      { beat: note.startBeat, pitch: startPitch },
      { beat: note.startBeat + note.lengthBeats, pitch: endPitch },
    ],
  };
}

function curveEdgePitch(
  note: MidiNote,
  edge: "start" | "end",
  bottomPitch = BOTTOM_PITCH,
  topPitch = TOP_PITCH,
): number {
  if (!note.curve || note.curve.length < 2) return note.pitch;
  const point = edge === "start" ? note.curve[0] : note.curve[note.curve.length - 1];
  return clamp(point?.pitch ?? note.pitch, bottomPitch, topPitch);
}

function curvePitchToNoteY(note: MidiNote, pitch: number): number {
  return (note.pitch - pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
}

function formatPitchValue(pitch: number): string {
  return Number.isInteger(pitch) ? String(pitch) : pitch.toFixed(2);
}

function midiGridLineClass(kind: MidiGridLineKind): string {
  if (kind === "bar") return styles.beatLineBar;
  if (kind === "beat") return styles.beatLineWhole;
  if (kind === "half") return styles.beatLineHalf;
  if (kind === "quarter") return styles.beatLineQuarter;
  if (kind === "eighth") return styles.beatLineEighth;
  return styles.beatLineSixteenth;
}

function makeGridLines(lengthBeats: number, pxPerBeat: number): Array<{ beat: number; kind: MidiGridLineKind }> {
  const step = midiVisibleGridBeatStep(pxPerBeat);
  const count = Math.floor(lengthBeats / step);
  const lines: Array<{ beat: number; kind: MidiGridLineKind }> = [];
  for (let i = 0; i <= count; i++) {
    const beat = Math.round(i * step * 10000) / 10000;
    lines.push({
      beat,
      kind: midiGridLineKind(beat),
    });
  }
  if (Math.abs(lengthBeats - count * step) > 0.0001) {
    lines.push({ beat: lengthBeats, kind: "bar" });
  }
  return lines;
}
