import { useEffect, useMemo, useRef, useState } from "react";
import { Button, HoverInfo, Icon } from "../../components";
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

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

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
  const drag = useRef<
    | {
        mode: "draw";
        idx: number;
        anchorBeat: number;
      }
    | {
        mode: "move";
        indices: number[];
        startX: number;
        startY: number;
        startNotes: Pick<MidiNote, "startBeat" | "pitch" | "lengthBeats">[];
      }
    | { mode: "resize"; idx: number; startX: number; startLen: number }
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
  function snap(beat: number): number {
    // 16th-note snap by default
    return Math.round(beat * 4) / 4;
  }

  function onGridPointerDown(e: React.PointerEvent) {
    if (e.target !== e.currentTarget) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const beat = snap(beatFromX(x));
    const pitch = pitchFromY(y);
    const newNote: MidiNote = {
      pitch,
      velocity: 100,
      startBeat: beat,
      lengthBeats: 0.25,
    };
    const next = [...notes, newNote];
    onChange(next);
    const idx = next.length - 1;
    setSelected([idx]);
    drag.current = { mode: "draw", idx, anchorBeat: beat };
    onPreviewNote?.(pitch, newNote.velocity);
  }

  function startMove(idx: number, e: React.PointerEvent) {
    e.stopPropagation();
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
    if (!d) return;
    if (d.mode === "draw") {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const currentBeat = snap(beatFromX(e.clientX - rect.left));
      const startBeat = Math.min(d.anchorBeat, currentBeat);
      const length = Math.max(0.25, Math.abs(currentBeat - d.anchorBeat) || 0.25);
      const next = notes.slice();
      if (!next[d.idx]) return;
      next[d.idx] = {
        ...next[d.idx],
        startBeat,
        lengthBeats: Math.min(length, lengthBeats - startBeat),
      };
      onChange(next);
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
      onChange(next);
    } else {
      const dx = e.clientX - d.startX;
      const dLen = snap(dx / pxPerBeat);
      const next = notes.slice();
      next[d.idx] = {
        ...next[d.idx],
        lengthBeats: clamp(d.startLen + dLen, 0.25, lengthBeats - next[d.idx].startBeat),
      };
      onChange(next);
    }
  }

  function onNotePointerUp() {
    drag.current = null;
  }

  // Keyboard: Backspace/Delete removes selected.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (selected.length === 0) return;
      // ignore when typing in an input
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      const next = notes.filter((_, i) => !selected.includes(i));
      onChange(next);
      setSelected([]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, notes, onChange]);

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
          <div className={styles.inner} style={{ width, height }}>
            {/* Grid + notes */}
            <div
              ref={containerRef}
              className={styles.grid}
              style={{ width, height }}
              onPointerDown={onGridPointerDown}
              onPointerMove={onNotePointerMove}
              onPointerUp={onNotePointerUp}
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

            {/* Notes */}
            {notes.map((n, i) => {
              const row = TOP_PITCH - n.pitch;
              const top = row * PX_PER_PITCH;
              const left = n.startBeat * pxPerBeat;
              const noteWidth = n.lengthBeats * pxPerBeat;
              const isSelected = selected.includes(i);
              return (
                <div
                  key={i}
                  className={`${styles.note} ${isSelected ? styles.noteSelected : ""}`}
                  style={{
                    left,
                    top,
                    width: noteWidth,
                    height: PX_PER_PITCH,
                  }}
                  onPointerDown={(e) => startMove(i, e)}
                  onPointerMove={onNotePointerMove}
                  onPointerUp={onNotePointerUp}
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
      <div className={styles.footer}>
        <div className={styles.help}>
          Click empty to add · drag to move · drag right edge to resize · Delete to remove
        </div>
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
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
