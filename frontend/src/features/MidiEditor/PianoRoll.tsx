import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button, FloatingLayer, HoverInfo, Icon } from "../../components";
import { useSettingsStore } from "../../state/store";
import type { MidiNote } from "../../state/types";
import styles from "./PianoRoll.module.css";

export interface PianoRollProps {
  notes: MidiNote[];
  /** Visible time span in beats. */
  lengthBeats: number;
  /** Current playhead position relative to this segment, in beats. */
  playheadBeat?: number | null;
  onChange: (notes: MidiNote[]) => void;
  onPreviewNote?: (pitch: number, velocity?: number) => void;
}

/**
 * PianoRoll — horizontal MIDI editor.
 *
 * Interaction model:
 *   - Click an empty cell → add a note (default 1/2 beat, vel 100).
 *   - Click a note       → select it.
 *   - Drag note body     → move pitch and time.
 *   - Drag right edge    → extend duration.
 *   - Backspace / Delete → remove selected note.
 *   - Shift-click        → multi-select (additive).
 *
 * Notes render with white outline / black fill per design rule. The grid
 * uses the inside-object opacity scale (faint, bold for every beat).
 */
const DEFAULT_PX_PER_BEAT = 48;
const MIN_PX_PER_BEAT = 24;
const MAX_PX_PER_BEAT = 160;
const ZOOM_STEP = 8;
const PX_PER_PITCH = 16;
const VIEW_HEIGHT = 520;
const TOP_PITCH = 96;     // C7
const BOTTOM_PITCH = 36;  // C2
const PITCH_RANGE = TOP_PITCH - BOTTOM_PITCH + 1;
const KEY_LABEL_WIDTH = 48;
const DEFAULT_NOTE_LENGTH_BEATS = 0.25;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

let midiNoteClipboard: MidiNoteClipboard | null = null;

export function PianoRoll({
  notes,
  lengthBeats,
  playheadBeat = null,
  onChange,
  onPreviewNote,
}: PianoRollProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const keysScrollRef = useRef<HTMLDivElement>(null);
  const timeScrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [pxPerBeat, setPxPerBeat] = useState(DEFAULT_PX_PER_BEAT);
  const [selectBox, setSelectBox] = useState<Rect | null>(null);
  const [noteMenu, setNoteMenu] = useState<{ x: number; y: number; idx: number; target: PasteTarget } | null>(null);
  const [gridMenu, setGridMenu] = useState<{ x: number; y: number; target: PasteTarget } | null>(null);
  const [volumePopover, setVolumePopover] = useState<VolumePopoverState | null>(null);
  const [connectFrom, setConnectFrom] = useState<number | null>(null);
  const [connectPointer, setConnectPointer] = useState<{ x: number; y: number } | null>(null);
  const [curveFrom, setCurveFrom] = useState<number | null>(null);
  const [curvePointer, setCurvePointer] = useState<{ x: number; y: number } | null>(null);
  const lastDrawnLengthRef = useRef(DEFAULT_NOTE_LENGTH_BEATS);
  const lastPointerTargetRef = useRef<PasteTarget | null>(null);
  const historyRef = useRef<MidiNote[][]>([]);
  const midiSmartGrid = useSettingsStore((s) => s.midiSmartGrid);
  const midiSubdivision = useSettingsStore((s) => s.midiSubdivision);
  const drag = useRef<
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
        startNotes: Pick<MidiNote, "startBeat" | "pitch" | "lengthBeats">[];
      }
    | { mode: "resize"; idx: number; startX: number; startLen: number }
    | { mode: "select"; anchorX: number; anchorY: number; pointerId: number }
    | null
  >(null);

  const width = lengthBeats * pxPerBeat;
  const height = PITCH_RANGE * PX_PER_PITCH;

  // Keep selected indices valid if notes shrink.
  useEffect(() => {
    setSelected((prev) => prev.filter((i) => i >= 0 && i < notes.length));
  }, [notes.length]);

  function pitchFromY(y: number): number {
    const row = Math.floor(y / PX_PER_PITCH);
    return TOP_PITCH - row;
  }
  function beatFromX(x: number): number {
    return Math.max(0, Math.min(lengthBeats, x / pxPerBeat));
  }
  function targetFromClient(clientX: number, clientY: number): PasteTarget {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { beat: 0, pitch: BOTTOM_PITCH };
    const beat = snap(beatFromX(clientX - rect.left));
    const pitch = clamp(pitchFromY(clientY - rect.top), BOTTOM_PITCH, TOP_PITCH);
    return { beat, pitch };
  }
  function snap(beat: number): number {
    if (!midiSmartGrid) return beat;
    const factor = midiSubdivision / 4;
    return Math.round(beat * factor) / factor;
  }

  function commitChange(next: MidiNote[]) {
    historyRef.current.push(structuredClone(notes));
    if (historyRef.current.length > 100) historyRef.current.shift();
    onChange(next);
  }

  function undoLocal() {
    const previous = historyRef.current.pop();
    if (!previous) return;
    onChange(previous);
    setSelected((prev) => prev.filter((idx) => previous[idx]));
  }

  function onGridPointerDown(e: React.PointerEvent) {
    if (e.target !== e.currentTarget) return;
    setNoteMenu(null);
    setGridMenu(null);
    setVolumePopover(null);
    (e.target as Element).setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    lastPointerTargetRef.current = { beat: snap(beatFromX(x)), pitch: clamp(pitchFromY(y), BOTTOM_PITCH, TOP_PITCH) };
    if (connectFrom != null) {
      setConnectFrom(null);
      setConnectPointer(null);
      return;
    }
    if (curveFrom != null) {
      completeCurve(curveFrom, {
        beat: snap(beatFromX(x)),
        pitch: clamp(pitchFromY(y), BOTTOM_PITCH, TOP_PITCH),
      });
      return;
    }
    if (e.altKey) {
      drag.current = { mode: "select", anchorX: x, anchorY: y, pointerId: e.pointerId };
      setSelectBox({ left: x, top: y, width: 0, height: 0 });
      return;
    }
    const beat = snap(beatFromX(x));
    const pitch = pitchFromY(y);
    const initialLength = clamp(lastDrawnLengthRef.current, DEFAULT_NOTE_LENGTH_BEATS, Math.max(DEFAULT_NOTE_LENGTH_BEATS, lengthBeats - beat));
    const newNote: MidiNote = {
      pitch,
      velocity: 100,
      startBeat: beat,
      lengthBeats: initialLength,
    };
    const next = [...notes, newNote];
    commitChange(next);
    const idx = next.length - 1;
    setSelected([idx]);
    drag.current = { mode: "draw", idx, anchorBeat: beat, initialLength, currentLength: initialLength };
    onPreviewNote?.(pitch, newNote.velocity);
  }

  function startMove(idx: number, e: React.PointerEvent) {
    e.stopPropagation();
    setNoteMenu(null);
    setGridMenu(null);
    setVolumePopover(null);
    if (connectFrom != null) {
      if (connectFrom !== idx) {
        commitChange(connectNotes(notes, connectFrom, idx));
      }
      setConnectFrom(null);
      setConnectPointer(null);
      return;
    }
    if (curveFrom != null) {
      completeCurve(curveFrom, targetFromClient(e.clientX, e.clientY));
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    const indices = selected.includes(idx) ? selected : [idx];
    drag.current = {
      mode: "move",
      indices,
      startX: e.clientX,
      startY: e.clientY,
      startNotes: indices.map((i) => ({
        startBeat: notes[i].startBeat,
        pitch: notes[i].pitch,
        lengthBeats: notes[i].lengthBeats,
      })),
    };
    setSelected(e.shiftKey
      ? selected.includes(idx) ? selected.filter((i) => i !== idx) : [...selected, idx]
      : [idx]);
  }

  function startResize(idx: number, e: React.PointerEvent) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = {
      mode: "resize",
      idx,
      startX: e.clientX,
      startLen: notes[idx].lengthBeats,
    };
    setSelected([idx]);
  }

  function onNotePointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (connectFrom != null) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setConnectPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    if (curveFrom != null) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setCurvePointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    if (!d) return;
    if (d.mode === "draw") {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const currentBeat = snap(beatFromX(e.clientX - rect.left));
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
      commitChange(next);
    } else if (d.mode === "move") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const dBeat = snap(dx / pxPerBeat);
      const dPitch = -Math.round(dy / PX_PER_PITCH);
      const next = notes.slice();
      d.indices.forEach((idx, groupIdx) => {
        if (!next[idx]) return;
        const start = d.startNotes[groupIdx];
        next[idx] = {
          ...next[idx],
          startBeat: clamp(start.startBeat + dBeat, 0, lengthBeats - start.lengthBeats),
          pitch: clamp(start.pitch + dPitch, BOTTOM_PITCH, TOP_PITCH),
        };
      });
      commitChange(next);
    } else if (d.mode === "resize") {
      const dx = e.clientX - d.startX;
      const dLen = snap(dx / pxPerBeat);
      const next = notes.slice();
      next[d.idx] = {
        ...next[d.idx],
        lengthBeats: clamp(d.startLen + dLen, 0.25, lengthBeats - next[d.idx].startBeat),
      };
      commitChange(next);
    } else {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setSelectBox(normalizeRect(d.anchorX, d.anchorY, x, y));
    }
  }

  function onNotePointerUp() {
    if (drag.current?.mode === "draw") {
      lastDrawnLengthRef.current = Math.max(DEFAULT_NOTE_LENGTH_BEATS, drag.current.currentLength);
    }
    if (drag.current?.mode === "select" && selectBox) {
      const selectedIndices = notes
        .map((note, index) => ({ note, index, rect: noteRect(note) }))
        .filter(({ rect }) => rectsIntersect(selectBox, rect))
        .map(({ index }) => index);
      setSelected(selectedIndices);
      setSelectBox(null);
    }
    drag.current = null;
  }

  function openNoteMenu(idx: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const nextSelected = selected.includes(idx) ? selected : [idx];
    setSelected(nextSelected);
    setVolumePopover(null);
    setGridMenu(null);
    const target = targetFromClient(e.clientX, e.clientY);
    lastPointerTargetRef.current = target;
    setNoteMenu({ idx, x: e.clientX, y: e.clientY, target });
  }

  function openGridMenu(e: React.MouseEvent) {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    e.stopPropagation();
    const target = targetFromClient(e.clientX, e.clientY);
    lastPointerTargetRef.current = target;
    setNoteMenu(null);
    setVolumePopover(null);
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

  function applyNoteVolume() {
    if (!volumePopover) return;
    const velocity = parseVolumeInput(volumePopover.value);
    if (velocity == null) {
      setVolumePopover({ ...volumePopover, error: true });
      return;
    }
    const next = notes.slice();
    next[volumePopover.idx] = { ...next[volumePopover.idx], velocity };
    commitChange(next);
    setVolumePopover(null);
  }

  function clearNoteVolume() {
    if (!volumePopover) return;
    const next = notes.slice();
    next[volumePopover.idx] = { ...next[volumePopover.idx], velocity: 100 };
    commitChange(next);
    setVolumePopover(null);
  }

  function startConnect(idx: number) {
    const rect = noteRect(notes[idx]);
    setConnectFrom(idx);
    setConnectPointer({
      x: Math.min(width, rect.left + rect.width + 24),
      y: rect.top + rect.height / 2,
    });
  }

  function startCurve(idx: number) {
    const rect = noteRect(notes[idx]);
    setCurveFrom(idx);
    setCurvePointer({
      x: Math.min(width, rect.left + rect.width + 24),
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
          connectToIndex: mappedConnection,
        };
      }),
      minPitch,
      pitchSpan: maxPitch - minPitch,
      spanBeats: Math.max(...unique.map((idx) => notes[idx].startBeat + notes[idx].lengthBeats)) - minStart,
    };
    return true;
  }

  function copyCurrentSelection(fallbackIdx?: number): boolean {
    const indices = selected.length > 0 ? selected : fallbackIdx == null ? [] : [fallbackIdx];
    return copyNotes(indices);
  }

  function pasteCopiedNotes(target?: PasteTarget): boolean {
    if (!midiNoteClipboard || midiNoteClipboard.notes.length === 0) return false;
    const pasteTarget = target ?? lastPointerTargetRef.current ?? fallbackPasteTarget();
    const maxStart = Math.max(0, lengthBeats - midiNoteClipboard.spanBeats);
    const startBeat = clamp(snap(pasteTarget.beat), 0, maxStart);
    const basePitch = clamp(
      pasteTarget.pitch ?? midiNoteClipboard.minPitch,
      BOTTOM_PITCH,
      TOP_PITCH - midiNoteClipboard.pitchSpan,
    );
    const baseIndex = notes.length;
    const pasted = midiNoteClipboard.notes.map((note) => ({
      ...note,
      startBeat: startBeat + note.startBeat,
      pitch: basePitch + note.pitch,
      connectToIndex: note.connectToIndex == null ? undefined : baseIndex + note.connectToIndex,
    }));
    commitChange([...notes, ...pasted]);
    setSelected(pasted.map((_, i) => baseIndex + i));
    lastPointerTargetRef.current = { beat: startBeat, pitch: basePitch };
    return true;
  }

  function fallbackPasteTarget(): PasteTarget {
    if (playheadBeat != null) return { beat: snap(playheadBeat), pitch: midiNoteClipboard?.minPitch ?? 60 };
    if (selected.length > 0 && notes[selected[0]]) {
      const first = notes[selected[0]];
      return { beat: snap(first.startBeat + first.lengthBeats), pitch: first.pitch };
    }
    return { beat: 0, pitch: midiNoteClipboard?.minPitch ?? 60 };
  }

  // Keyboard: Backspace/Delete removes selected.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setConnectFrom(null);
        setConnectPointer(null);
        setCurveFrom(null);
        setCurvePointer(null);
        setNoteMenu(null);
        setGridMenu(null);
        setVolumePopover(null);
        setSelectBox(null);
        drag.current = null;
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
      if (selected.length === 0) return;
      e.preventDefault();
      const removed = new Set(selected);
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
  }, [selected, notes, onChange, volumePopover, playheadBeat]);

  useEffect(() => {
    if (connectFrom == null && curveFrom == null && !noteMenu && !gridMenu && !volumePopover) return;
    function cancel(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if ((target as Element).closest?.("[data-floating-layer]")) return;
      setNoteMenu(null);
      setGridMenu(null);
      setVolumePopover(null);
      if (connectFrom != null) {
        setConnectFrom(null);
        setConnectPointer(null);
      }
      if (curveFrom != null) {
        setCurveFrom(null);
        setCurvePointer(null);
      }
    }
    window.addEventListener("mousedown", cancel);
    return () => window.removeEventListener("mousedown", cancel);
  }, [connectFrom, curveFrom, noteMenu, gridMenu, volumePopover]);

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

  function handleWheelZoom(e: React.WheelEvent<HTMLDivElement>): boolean {
    if (!e.ctrlKey && !e.metaKey) return false;
    e.preventDefault();
    zoom(e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP, e.clientX);
    return true;
  }

  function noteRect(note: MidiNote): Rect {
    return {
      left: note.startBeat * pxPerBeat,
      top: (TOP_PITCH - note.pitch) * PX_PER_PITCH,
      width: note.lengthBeats * pxPerBeat,
      height: PX_PER_PITCH,
    };
  }

  function scrollKeysWithGrid(e: React.WheelEvent<HTMLDivElement>) {
    if (handleWheelZoom(e)) return;
    if (!timeScrollRef.current) return;
    timeScrollRef.current.scrollTop += e.deltaY;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      timeScrollRef.current.scrollLeft += e.deltaX || e.deltaY;
    }
    syncKeyScroll();
  }

  // Key labels along the left side.
  const keyLabels = useMemo(() => {
    const out: { pitch: number; label: string; isBlack: boolean }[] = [];
    for (let p = TOP_PITCH; p >= BOTTOM_PITCH; p--) {
      const name = NOTE_NAMES[((p % 12) + 12) % 12];
      const octave = Math.floor(p / 12) - 1;
      out.push({ pitch: p, label: `${name}${octave}`, isBlack: name.includes("#") });
    }
    return out;
  }, []);

  return (
    <div className={styles.rollWrap}>
      <div className={styles.editorFrame}>
        <div
          ref={keysScrollRef}
          className={styles.keysScroll}
          style={{ width: KEY_LABEL_WIDTH, height: VIEW_HEIGHT }}
          onWheel={scrollKeysWithGrid}
        >
          {/* Key column */}
          <div className={styles.keys} style={{ width: KEY_LABEL_WIDTH, height }}>
            {keyLabels.map((k) => (
              <div
                key={k.pitch}
                className={`${styles.key} ${k.isBlack ? styles.keyBlack : ""}`}
                style={{ height: PX_PER_PITCH }}
              >
                {k.label}
              </div>
            ))}
          </div>
        </div>

        <div
          ref={timeScrollRef}
          className={styles.timeScroll}
          style={{ height: VIEW_HEIGHT }}
          onScroll={syncKeyScroll}
          onWheel={handleWheelZoom}
        >
          <div className={styles.zoomControls}>
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
          <div className={styles.inner} style={{ width, height }}>
            {/* Grid + notes */}
            <div
              ref={containerRef}
              className={styles.grid}
              style={{ width, height }}
              onPointerDown={onGridPointerDown}
              onPointerMove={onNotePointerMove}
              onPointerUp={onNotePointerUp}
              onContextMenu={openGridMenu}
            >
              {/* Horizontal rows (per pitch) */}
              {keyLabels.map((k, i) => (
                <div
                  key={k.pitch}
                  className={`${styles.row} ${k.isBlack ? styles.rowBlack : ""}`}
                  style={{ top: i * PX_PER_PITCH, height: PX_PER_PITCH }}
                />
              ))}
              {/* Vertical lines (per beat) */}
              {Array.from({ length: Math.floor(lengthBeats) + 1 }, (_, b) => (
                <div
                  key={b}
                  className={`${styles.beatLine} ${b % 4 === 0 ? styles.beatLineMajor : ""}`}
                  style={{ left: b * pxPerBeat }}
                />
              ))}

              <svg className={styles.connections} width={width} height={height} aria-hidden>
                {notes.map((note, i) => {
                  if (!note.curve || note.curve.length < 2) return null;
                  const [from, to] = note.curve;
                  const x1 = from.beat * pxPerBeat;
                  const y1 = (TOP_PITCH - from.pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
                  const x2 = to.beat * pxPerBeat;
                  const y2 = (TOP_PITCH - to.pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
                  const c = Math.max(24, Math.abs(x2 - x1) * 0.45);
                  return (
                    <path
                      key={`curve:${i}`}
                      className={styles.curvePath}
                      d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`}
                    />
                  );
                })}
                {notes.map((note, i) => {
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
                      key={`${i}:${to}`}
                      className={styles.connectionPath}
                      d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`}
                    />
                  );
                })}
                {connectFrom != null && notes[connectFrom] && connectPointer && (() => {
                  const fromRect = noteRect(notes[connectFrom]);
                  const x1 = fromRect.left + fromRect.width;
                  const y1 = fromRect.top + fromRect.height / 2;
                  const x2 = connectPointer.x;
                  const y2 = connectPointer.y;
                  const c = Math.max(24, Math.abs(x2 - x1) * 0.45);
                  return (
                    <path
                      className={styles.connectionPathActive}
                      d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`}
                    />
                  );
                })()}
                {curveFrom != null && notes[curveFrom] && curvePointer && (() => {
                  const note = notes[curveFrom];
                  const x1 = note.startBeat * pxPerBeat;
                  const y1 = (TOP_PITCH - note.pitch) * PX_PER_PITCH + PX_PER_PITCH / 2;
                  const x2 = curvePointer.x;
                  const y2 = curvePointer.y;
                  const c = Math.max(24, Math.abs(x2 - x1) * 0.45);
                  return (
                    <path
                      className={styles.curvePathActive}
                      d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`}
                    />
                  );
                })()}
              </svg>

            {/* Notes */}
            {notes.map((n, i) => {
              const row = TOP_PITCH - n.pitch;
              const top = row * PX_PER_PITCH;
              const left = n.startBeat * pxPerBeat;
              const noteWidth = n.lengthBeats * pxPerBeat;
              const isSelected = selected.includes(i);
              const volumePercent = Math.round((clamp(n.velocity, 0, 127) / 127) * 100);
              return (
                <div
                  key={i}
                  className={`${styles.note} ${isSelected ? styles.noteSelected : ""}`}
                  style={{
                    left,
                    top,
                    width: noteWidth,
                    height: PX_PER_PITCH,
                    "--note-volume": `${volumePercent}%`,
                  } as CSSProperties}
                  onPointerDown={(e) => startMove(i, e)}
                  onPointerMove={onNotePointerMove}
                  onPointerUp={onNotePointerUp}
                  onContextMenu={(e) => openNoteMenu(i, e)}
                >
                  <div
                    className={styles.noteResize}
                    onPointerDown={(e) => startResize(i, e)}
                    onPointerMove={onNotePointerMove}
                    onPointerUp={onNotePointerUp}
                  />
                </div>
              );
            })}
            {selectBox && (
              <div
                className={styles.selectBox}
                style={{
                  left: selectBox.left,
                  top: selectBox.top,
                  width: selectBox.width,
                  height: selectBox.height,
                }}
              />
            )}
            {playheadBeat != null && playheadBeat >= 0 && playheadBeat <= lengthBeats && (
              <div
                className={styles.playhead}
                style={{ left: playheadBeat * pxPerBeat }}
                aria-hidden
              />
            )}
            </div>
          </div>
        </div>
      </div>
      {noteMenu && (
        <NoteMenu
          x={noteMenu.x}
          y={noteMenu.y}
          onVolume={() => {
            openVolumePopover(noteMenu.idx, noteMenu.x, noteMenu.y);
            setNoteMenu(null);
          }}
          onConnect={() => {
            startConnect(noteMenu.idx);
            setNoteMenu(null);
          }}
          onCurve={() => {
            startCurve(noteMenu.idx);
            setNoteMenu(null);
          }}
          onCopy={() => {
            copyCurrentSelection(noteMenu.idx);
            setNoteMenu(null);
          }}
          onPaste={() => {
            pasteCopiedNotes(noteMenu.target);
            setNoteMenu(null);
          }}
          onDelete={() => {
            deleteNote(noteMenu.idx);
            setNoteMenu(null);
          }}
          canCopy={selected.length > 0 || noteMenu.idx != null}
          canPaste={Boolean(midiNoteClipboard)}
        />
      )}
      {gridMenu && (
        <GridMenu
          x={gridMenu.x}
          y={gridMenu.y}
          canCopy={selected.length > 0}
          canPaste={Boolean(midiNoteClipboard)}
          onCopy={() => {
            copyCurrentSelection();
            setGridMenu(null);
          }}
          onPaste={() => {
            pasteCopiedNotes(gridMenu.target);
            setGridMenu(null);
          }}
        />
      )}
      {volumePopover && (
        <VolumePopover
          state={volumePopover}
          onChange={(value) => setVolumePopover({ ...volumePopover, value, error: false })}
          onApply={applyNoteVolume}
          onClear={clearNoteVolume}
        />
      )}
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
  return createPortal(
    <FloatingLayer className={styles.noteMenu} x={x} y={y} role="menu">
      <button type="button" className={styles.noteMenuItem} onClick={onVolume} role="menuitem">
        Volume
      </button>
      <button type="button" className={styles.noteMenuItem} onClick={onConnect} role="menuitem">
        Connect To
      </button>
      <button type="button" className={styles.noteMenuItem} onClick={onCurve} role="menuitem">
        Curve To…
      </button>
      <button type="button" className={styles.noteMenuItem} onClick={onCopy} disabled={!canCopy} role="menuitem">
        Copy
      </button>
      <button type="button" className={styles.noteMenuItem} onClick={onPaste} disabled={!canPaste} role="menuitem">
        Paste
      </button>
      <button type="button" className={styles.noteMenuItem} onClick={onDelete} role="menuitem">
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
  return createPortal(
    <FloatingLayer className={styles.noteMenu} x={x} y={y} role="menu">
      <button type="button" className={styles.noteMenuItem} onClick={onCopy} disabled={!canCopy} role="menuitem">
        Copy
      </button>
      <button type="button" className={styles.noteMenuItem} onClick={onPaste} disabled={!canPaste} role="menuitem">
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
}

interface VolumePopoverState {
  idx: number;
  x: number;
  y: number;
  value: string;
  error: boolean;
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
  const numericValue = Math.max(0, Math.min(100, Number(state.value.replace(/%$/, "")) || 0));
  return createPortal(
    <FloatingLayer className={styles.volumePopover} x={state.x} y={state.y}>
      <div className={styles.volumeSliderRow}>
        <span className={styles.volumeLabel}>Volume</span>
        <input
          autoFocus
          className={styles.volumeSlider}
          type="range"
          min={0}
          max={100}
          step={1}
          value={numericValue}
          onChange={(e) => onChange(e.currentTarget.value)}
          onPointerUp={onApply}
          onKeyDown={(e) => {
            if (e.key === "Enter") onApply();
          }}
        />
        <span className={styles.volumeValue}>{numericValue}%</span>
        <button type="button" className={styles.volumeClear} onClick={onClear} aria-label="Clear note volume">
          x
        </button>
      </div>
      {state.error && <div className={styles.volumeError}>Use 0-100%</div>}
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
