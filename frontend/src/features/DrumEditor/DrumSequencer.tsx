import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button, FloatingLayer, FloatingSelect, HoverInfo, Icon, NumberInput, RadioGroup, TextInput } from "../../components";
import { createInstrumentBufferSource, noteFrequency, preloadInstrumentSample } from "../../audio/synthPreview";
import { useContextualHotkey } from "../../hotkeys/contextualHotkeys";
import {
  DEFAULT_DRUM_MIDI_PITCH,
  DEFAULT_DRUM_VELOCITY,
  formatFrequency,
  frequencyToNoteName,
  normalizeDrumCell,
  normalizeDrumSteps,
  parsePitchInput,
} from "../../state/drumSteps";
import type { DrumCell, DrumRow, Instrument } from "../../state/types";
import styles from "./DrumSequencer.module.css";

interface Props {
  rows: DrumRow[];
  stepCount: number;
  speed: 1 | 2 | 4 | 8;
  lengthBeats: number;
  defaultPitchHz?: number;
  bpm: number;
  instruments: Instrument[];
  hotkeyScopeId?: string;
  onChange: (rows: DrumRow[]) => void;
  onResize: (lengthBeats: number, rows: DrumRow[]) => void;
  onDefaultPitchChange?: (frequencyHz: number | undefined) => void;
  onSpeedChange: (speed: 1 | 2 | 4 | 8) => void;
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
  bpm,
  instruments,
  hotkeyScopeId,
  onChange,
  onResize,
  onDefaultPitchChange,
  onSpeedChange,
  onUploadRow,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [playStep, setPlayStep] = useState<number | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(() => new Set());
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [cellMenu, setCellMenu] = useState<CellMenuState | null>(null);
  const [pitchPopover, setPitchPopover] = useState<PitchPopoverState | null>(null);
  const [cellSize, setCellSize] = useState(DEFAULT_CELL_SIZE);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  const instrumentsRef = useRef(instruments);
  const defaultPitchRef = useRef(defaultPitchHz);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const stepRef = useRef(0);
  const dragRef = useRef<{ moved: boolean; pointerId: number; startedOn: string } | null>(null);
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
      stop();
      if (ctxRef.current) void ctxRef.current.close();
    },
    [],
  );

  useEffect(() => {
    if (!playing) return;
    stop();
    play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepCount, lengthBeats, bpm, speed]);

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
      setCellMenu(null);
      setPitchPopover(null);
    }
    function closeOnEscape(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpenRowId(null);
      setCellMenu(null);
      setPitchPopover(null);
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
    stepRef.current = 0;
    setPlaying(true);
    triggerStep(0);
    const stepMs = Math.max(20, ((lengthBeats / speed) / stepCount) * (60 / bpm) * 1000);
    timerRef.current = window.setInterval(() => {
      stepRef.current = (stepRef.current + 1) % stepCount;
      triggerStep(stepRef.current);
    }, stepMs);
  }

  function stop() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setPlaying(false);
    setPlayStep(null);
  }

  function triggerStep(step: number) {
    setPlayStep(step);
    for (const row of rowsRef.current) {
      const cell = normalizeDrumCell(row.steps[step]);
      if (!cell.on) continue;
      const instrument =
        instrumentsRef.current.find((i) => i.id === row.instrumentId) ??
        instrumentsRef.current[0] ??
        fallbackInstrument;
      playInstrument(
        instrument,
        cell.pitchHz ?? defaultPitchRef.current ?? noteFrequency(DEFAULT_DRUM_MIDI_PITCH, instrument),
        cell.velocity,
      );
    }
  }

  function playInstrument(instrument: Instrument, frequencyHz: number, velocity = DEFAULT_DRUM_VELOCITY) {
    const ctx = getCtx();
    const now = ctx.currentTime;
    const source = createInstrumentBufferSource(ctx, instrument, 0.2, frequencyHz);
    const duration = source.buffer
      ? Math.max(0.05, Math.min(1.5, source.buffer.duration / source.playbackRate.value))
      : 0.22;
    const gain = ctx.createGain();
    const peak = (Math.max(1, Math.min(127, velocity)) / 127) * 0.28;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.004);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    gain.connect(ctx.destination);
    source.connect(gain);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

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

  function toggleStep(rowId: string, step: number) {
    const key = cellKey(rowId, step);
    updateCells(new Set([key]), (cell) => {
      const next = { ...cell, on: !cell.on };
      const instrument = instruments.find((i) => i.id === rows.find((row) => row.id === rowId)?.instrumentId)
        ?? instruments[0]
        ?? fallbackInstrument;
      if (next.on) {
        playInstrument(
          instrument,
          next.pitchHz ?? defaultPitchRef.current ?? noteFrequency(DEFAULT_DRUM_MIDI_PITCH, instrument),
          next.velocity,
        );
      }
      return next;
    });
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

  function resizeSteps(nextCount: number) {
    const count = Math.max(1, Math.min(64, Math.round(nextCount)));
    onResize(count, rows.map((row) => ({ ...row, steps: normalizeDrumSteps(row.steps, count) })));
    setSelectedCells((prev) => new Set(Array.from(prev).filter((key) => Number(key.split(":")[1]) < count)));
  }

  function startCellPointer(e: React.PointerEvent<HTMLButtonElement>, rowId: string, step: number) {
    if (e.button !== 0) return;
    wrapRef.current?.focus();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const key = cellKey(rowId, step);
    dragRef.current = { moved: false, pointerId: e.pointerId, startedOn: key };
    setSelectedCells((prev) => {
      if (!e.shiftKey) return new Set([key]);
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function enterCell(rowId: string, step: number) {
    if (!dragRef.current) return;
    dragRef.current.moved = true;
    setSelectedCells((prev) => new Set(prev).add(cellKey(rowId, step)));
  }

  function endCellPointer(rowId: string, step: number) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved) return;
    toggleStep(rowId, step);
  }

  function openCellMenu(e: React.MouseEvent<HTMLButtonElement>, rowId: string, step: number) {
    e.preventDefault();
    e.stopPropagation();
    const key = cellKey(rowId, step);
    if (!selectedCells.has(key)) setSelectedCells(new Set([key]));
    setCellMenu({ x: e.clientX, y: e.clientY, rowId, step });
    setOpenRowId(null);
    setPitchPopover(null);
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
          cell: normalizeDrumCell(row?.steps[cell.step]),
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
    updateCells(targetKeys(rowId, step), () => ({ on: false, velocity: DEFAULT_DRUM_VELOCITY }));
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

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (selectedCells.size === 0) return;
    const first = parseCellKey(Array.from(selectedCells)[0]);
    if (!first) return;
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      updateCells(selectedCells, () => ({ on: false, velocity: DEFAULT_DRUM_VELOCITY }));
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copyCells(first.rowId, first.step);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteCells(first.rowId, first.step);
    }
  }

  const sequenceStyle = {
    "--step-count": stepCount,
    "--play-step": playStep ?? 0,
    "--cell-size": `${cellSize}px`,
  } as CSSProperties;

  return (
    <div ref={wrapRef} className={styles.wrap} tabIndex={-1} onKeyDown={handleKeyDown}>
      <div className={styles.toolbar}>
        <NumberInput
          layout="inline"
          label="Length"
          value={stepCount}
          min={1}
          max={64}
          step={1}
          onChange={resizeSteps}
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
        <RadioGroup
          label="Speed"
          ariaLabel="Drum speed"
          value={speed}
          options={DRUM_SPEEDS.map((option) => ({ value: option, label: `${option}x` }))}
          onChange={onSpeedChange}
        />
        <div className={styles.transportBlock}>
          <HoverInfo content="Restart">
            <Button
              iconOnly
              size="xs"
              onClick={() => {
                stop();
                play();
              }}
              aria-label="Restart drum sequence"
            >
              <Icon name="ph:skip-back-fill" size={16} decorative />
            </Button>
          </HoverInfo>
          <HoverInfo content="Play">
            <Button
              iconOnly
              size="xs"
              variant={playing ? "primary" : "default"}
              disabled={playing}
              onClick={play}
              aria-label="Play drum sequence"
            >
              <Icon name="ph:play-fill" size={16} decorative />
            </Button>
          </HoverInfo>
          <HoverInfo content="Pause">
            <Button
              iconOnly
              size="xs"
              variant={playing ? "primary" : "default"}
              disabled={!playing}
              onClick={stop}
              aria-label="Pause drum sequence"
            >
              <Icon name="ph:pause-fill" size={16} decorative />
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
          <HoverInfo content="Zoom in">
            <Button
              iconOnly
              size="xs"
              onClick={() => setCellSize((size) => Math.min(DEFAULT_CELL_SIZE, size + CELL_ZOOM_STEP))}
              aria-label="Zoom drum cells in"
            >
              <Icon name="ph:magnifying-glass-plus" size={16} decorative />
            </Button>
          </HoverInfo>
        </div>
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
                <div key={step} className={styles.stepNumber}>
                  {step + 1}
                </div>
              ))}
            </div>

            <div className={styles.stepRows}>
              {rows.map((row) => (
                <div key={row.id} className={styles.stepGrid}>
                  {normalizeDrumSteps(row.steps, stepCount).map((cell, step) => {
                    const selected = selectedCells.has(cellKey(row.id, step));
                    return (
                      <button
                        key={step}
                        type="button"
                        className={[
                          styles.stepCell,
                          cell.on && styles.stepCellOn,
                          selected && styles.stepCellSelected,
                          cell.pitchHz && styles.stepCellTuned,
                        ].filter(Boolean).join(" ")}
                        onPointerDown={(e) => startCellPointer(e, row.id, step)}
                        onPointerEnter={() => enterCell(row.id, step)}
                        onPointerUp={() => endCellPointer(row.id, step)}
                        onContextMenu={(e) => openCellMenu(e, row.id, step)}
                        aria-pressed={cell.on}
                        aria-label={`${row.name} step ${step + 1}`}
                      >
                        {cell.pitchHz && (
                          <span className={styles.cellNote}>{frequencyToNoteName(cell.pitchHz)}</span>
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
    </div>
  );
}

function CellMenu({
  state,
  hasClipboard,
  selectionSize,
  onShiftPitch,
  onCopy,
  onPaste,
  onReset,
}: {
  state: CellMenuState;
  hasClipboard: boolean;
  selectionSize: number;
  onShiftPitch: () => void;
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

const DRUM_SPEEDS = [1, 2, 4, 8] as const;
const DEFAULT_CELL_SIZE = 28;
const MIN_CELL_SIZE = 20;
const CELL_ZOOM_STEP = 4;
