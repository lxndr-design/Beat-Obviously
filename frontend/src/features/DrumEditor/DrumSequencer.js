import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, FloatingLayer, FloatingSelect, HoverInfo, Icon, NumberInput, RadioGroup, TextInput } from "../../components";
import { createInstrumentBufferSource, noteFrequency, preloadInstrumentSample } from "../../audio/synthPreview";
import { useContextualHotkey } from "../../hotkeys/contextualHotkeys";
import { DEFAULT_DRUM_MIDI_PITCH, DEFAULT_DRUM_VELOCITY, formatFrequency, frequencyToNoteName, normalizeDrumCell, normalizeDrumSteps, parsePitchInput, } from "../../state/drumSteps";
import styles from "./DrumSequencer.module.css";
export function DrumSequencer({ rows, stepCount, speed, lengthBeats, defaultPitchHz, bpm, instruments, hotkeyScopeId, onChange, onResize, onDefaultPitchChange, onSpeedChange, onUploadRow, }) {
    const [playing, setPlaying] = useState(false);
    const [playStep, setPlayStep] = useState(null);
    const [selectedCells, setSelectedCells] = useState(() => new Set());
    const [openRowId, setOpenRowId] = useState(null);
    const [cellMenu, setCellMenu] = useState(null);
    const [pitchPopover, setPitchPopover] = useState(null);
    const [cellSize, setCellSize] = useState(DEFAULT_CELL_SIZE);
    const wrapRef = useRef(null);
    const rowsRef = useRef(rows);
    const instrumentsRef = useRef(instruments);
    const defaultPitchRef = useRef(defaultPitchHz);
    const ctxRef = useRef(null);
    const timerRef = useRef(null);
    const stepRef = useRef(0);
    const dragRef = useRef(null);
    const cellClipboardRef = useRef(null);
    rowsRef.current = rows;
    instrumentsRef.current = instruments;
    defaultPitchRef.current = defaultPitchHz;
    useContextualHotkey(hotkeyScopeId ?? "", "space", () => {
        if (playing)
            stop();
        else
            play();
    }, Boolean(hotkeyScopeId));
    useEffect(() => () => {
        stop();
        if (ctxRef.current)
            void ctxRef.current.close();
    }, []);
    useEffect(() => {
        if (!playing)
            return;
        stop();
        play();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stepCount, lengthBeats, bpm, speed]);
    useEffect(() => {
        const ctx = getCtx();
        for (const instrument of instruments) {
            if (!instrument.sampleUrl)
                continue;
            void preloadInstrumentSample(ctx, instrument).catch(() => {
                // Falling back to synthesized preview keeps playback resilient.
            });
        }
    }, [instruments]);
    useEffect(() => {
        function closeFloating(e) {
            const target = e.target;
            if (target?.closest("[data-floating-layer]"))
                return;
            setOpenRowId(null);
            setCellMenu(null);
            setPitchPopover(null);
        }
        function closeOnEscape(e) {
            if (e.key !== "Escape")
                return;
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
    function getCtx() {
        if (!ctxRef.current) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const Ctor = (window.AudioContext || window.webkitAudioContext);
            ctxRef.current = new Ctor();
        }
        return ctxRef.current;
    }
    function play() {
        const ctx = getCtx();
        if (ctx.state === "suspended")
            void ctx.resume();
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
        if (timerRef.current)
            window.clearInterval(timerRef.current);
        timerRef.current = null;
        setPlaying(false);
        setPlayStep(null);
    }
    function triggerStep(step) {
        setPlayStep(step);
        for (const row of rowsRef.current) {
            const cell = normalizeDrumCell(row.steps[step]);
            if (!cell.on)
                continue;
            const instrument = instrumentsRef.current.find((i) => i.id === row.instrumentId) ??
                instrumentsRef.current[0] ??
                fallbackInstrument;
            playInstrument(instrument, cell.pitchHz ?? defaultPitchRef.current ?? noteFrequency(DEFAULT_DRUM_MIDI_PITCH, instrument), cell.velocity);
        }
    }
    function playInstrument(instrument, frequencyHz, velocity = DEFAULT_DRUM_VELOCITY) {
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
    function updateRow(rowId, patch) {
        onChange(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
    }
    function updateCells(keys, updater) {
        onChange(rows.map((row) => {
            if (!Array.from(keys).some((key) => key.startsWith(`${row.id}:`)))
                return row;
            const steps = normalizeDrumSteps(row.steps, stepCount).map((cell, step) => (keys.has(cellKey(row.id, step)) ? updater(cell) : cell));
            return { ...row, steps };
        }));
    }
    function toggleStep(rowId, step) {
        const key = cellKey(rowId, step);
        updateCells(new Set([key]), (cell) => {
            const next = { ...cell, on: !cell.on };
            const instrument = instruments.find((i) => i.id === rows.find((row) => row.id === rowId)?.instrumentId)
                ?? instruments[0]
                ?? fallbackInstrument;
            if (next.on) {
                playInstrument(instrument, next.pitchHz ?? defaultPitchRef.current ?? noteFrequency(DEFAULT_DRUM_MIDI_PITCH, instrument), next.velocity);
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
    function removeRow(rowId) {
        onChange(rows.filter((row) => row.id !== rowId));
        setSelectedCells((prev) => new Set(Array.from(prev).filter((key) => !key.startsWith(`${rowId}:`))));
    }
    function resizeSteps(nextCount) {
        const count = Math.max(1, Math.min(64, Math.round(nextCount)));
        onResize(count, rows.map((row) => ({ ...row, steps: normalizeDrumSteps(row.steps, count) })));
        setSelectedCells((prev) => new Set(Array.from(prev).filter((key) => Number(key.split(":")[1]) < count)));
    }
    function startCellPointer(e, rowId, step) {
        if (e.button !== 0)
            return;
        wrapRef.current?.focus();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const key = cellKey(rowId, step);
        dragRef.current = { moved: false, pointerId: e.pointerId, startedOn: key };
        setSelectedCells((prev) => {
            if (!e.shiftKey)
                return new Set([key]);
            const next = new Set(prev);
            if (next.has(key))
                next.delete(key);
            else
                next.add(key);
            return next;
        });
    }
    function enterCell(rowId, step) {
        if (!dragRef.current)
            return;
        dragRef.current.moved = true;
        setSelectedCells((prev) => new Set(prev).add(cellKey(rowId, step)));
    }
    function endCellPointer(rowId, step) {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag || drag.moved)
            return;
        toggleStep(rowId, step);
    }
    function openCellMenu(e, rowId, step) {
        e.preventDefault();
        e.stopPropagation();
        const key = cellKey(rowId, step);
        if (!selectedCells.has(key))
            setSelectedCells(new Set([key]));
        setCellMenu({ x: e.clientX, y: e.clientY, rowId, step });
        setOpenRowId(null);
        setPitchPopover(null);
    }
    function targetKeys(rowId, step) {
        const key = cellKey(rowId, step);
        return selectedCells.has(key) ? new Set(selectedCells) : new Set([key]);
    }
    function copyCells(rowId, step) {
        const keys = targetKeys(rowId, step);
        const selected = Array.from(keys).map(parseCellKey).filter(Boolean);
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
    function pasteCells(rowId, step) {
        const copied = cellClipboardRef.current;
        if (!copied)
            return;
        const rowStart = rows.findIndex((row) => row.id === rowId);
        if (rowStart < 0)
            return;
        onChange(rows.map((row, rowIndex) => {
            const patches = copied.cells.filter((cell) => rowStart + cell.rowOffset === rowIndex);
            if (patches.length === 0)
                return row;
            const steps = normalizeDrumSteps(row.steps, stepCount);
            for (const patch of patches) {
                const targetStep = step + patch.stepOffset;
                if (targetStep < 0 || targetStep >= stepCount)
                    continue;
                steps[targetStep] = { ...patch.cell };
            }
            return { ...row, steps };
        }));
    }
    function resetCells(rowId, step) {
        updateCells(targetKeys(rowId, step), () => ({ on: false, velocity: DEFAULT_DRUM_VELOCITY }));
    }
    function applyPitch() {
        if (!pitchPopover)
            return;
        const hz = parsePitchInput(pitchPopover.value);
        if (!hz) {
            setPitchPopover({ ...pitchPopover, error: true });
            return;
        }
        updateCells(targetKeys(pitchPopover.rowId, pitchPopover.step), (cell) => ({ ...cell, pitchHz: hz }));
        setPitchPopover(null);
    }
    function clearPitch() {
        if (!pitchPopover)
            return;
        updateCells(targetKeys(pitchPopover.rowId, pitchPopover.step), (cell) => ({ ...cell, pitchHz: undefined }));
        setPitchPopover(null);
    }
    function handleKeyDown(e) {
        if (selectedCells.size === 0)
            return;
        const first = parseCellKey(Array.from(selectedCells)[0]);
        if (!first)
            return;
        if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            updateCells(selectedCells, () => ({ on: false, velocity: DEFAULT_DRUM_VELOCITY }));
        }
        else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
            e.preventDefault();
            copyCells(first.rowId, first.step);
        }
        else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
            e.preventDefault();
            pasteCells(first.rowId, first.step);
        }
    }
    const sequenceStyle = {
        "--step-count": stepCount,
        "--play-step": playStep ?? 0,
        "--cell-size": `${cellSize}px`,
    };
    return (_jsxs("div", { ref: wrapRef, className: styles.wrap, tabIndex: -1, onKeyDown: handleKeyDown, children: [_jsxs("div", { className: styles.toolbar, children: [_jsx(NumberInput, { layout: "inline", label: "Length", value: stepCount, min: 1, max: 64, step: 1, onChange: resizeSteps }), onDefaultPitchChange && (_jsx(NumberInput, { layout: "inline", label: "Pitch", value: Math.round(defaultPitchHz ?? noteFrequency(DEFAULT_DRUM_MIDI_PITCH, fallbackInstrument)), min: 20, max: 20000, step: 1, unit: "Hz", onChange: onDefaultPitchChange })), _jsx(RadioGroup, { label: "Speed", ariaLabel: "Drum speed", value: speed, options: DRUM_SPEEDS.map((option) => ({ value: option, label: `${option}x` })), onChange: onSpeedChange }), _jsxs("div", { className: styles.transportBlock, children: [_jsx(HoverInfo, { content: "Restart", children: _jsx(Button, { iconOnly: true, size: "xs", onClick: () => {
                                        stop();
                                        play();
                                    }, "aria-label": "Restart drum sequence", children: _jsx(Icon, { name: "ph:skip-back-fill", size: 16, decorative: true }) }) }), _jsx(HoverInfo, { content: "Play", children: _jsx(Button, { iconOnly: true, size: "xs", variant: playing ? "primary" : "default", disabled: playing, onClick: play, "aria-label": "Play drum sequence", children: _jsx(Icon, { name: "ph:play-fill", size: 16, decorative: true }) }) }), _jsx(HoverInfo, { content: "Pause", children: _jsx(Button, { iconOnly: true, size: "xs", variant: playing ? "primary" : "default", disabled: !playing, onClick: stop, "aria-label": "Pause drum sequence", children: _jsx(Icon, { name: "ph:pause-fill", size: 16, decorative: true }) }) })] }), _jsxs("div", { className: styles.zoomControl, children: [_jsx(HoverInfo, { content: "Zoom out", children: _jsx(Button, { iconOnly: true, size: "xs", onClick: () => setCellSize((size) => Math.max(MIN_CELL_SIZE, size - CELL_ZOOM_STEP)), "aria-label": "Zoom drum cells out", children: _jsx(Icon, { name: "ph:magnifying-glass-minus", size: 16, decorative: true }) }) }), _jsx(HoverInfo, { content: "Zoom in", children: _jsx(Button, { iconOnly: true, size: "xs", onClick: () => setCellSize((size) => Math.min(DEFAULT_CELL_SIZE, size + CELL_ZOOM_STEP)), "aria-label": "Zoom drum cells in", children: _jsx(Icon, { name: "ph:magnifying-glass-plus", size: 16, decorative: true }) }) })] })] }), _jsxs("div", { className: styles.sequenceShell, style: sequenceStyle, children: [_jsxs("div", { className: styles.instrumentColumn, children: [_jsx("div", { className: styles.headerStub, "aria-hidden": true }), rows.map((row) => (_jsxs("div", { className: styles.rowControls, children: [_jsx(FloatingSelect, { fillHeight: true, value: row.instrumentId ?? "", ariaLabel: `${row.name} instrument`, options: instruments.map((instrument) => ({
                                            value: instrument.id,
                                            label: instrument.name,
                                        })), open: openRowId === row.id, onOpenChange: (open) => {
                                            setOpenRowId(open ? row.id : null);
                                            setCellMenu(null);
                                            setPitchPopover(null);
                                        }, onChange: (instrumentId) => {
                                            const instrument = instruments.find((candidate) => candidate.id === instrumentId);
                                            updateRow(row.id, {
                                                instrumentId,
                                                name: instrument?.name ?? row.name,
                                            });
                                        } }), _jsx(HoverInfo, { content: "Remove row", children: _jsx(Button, { className: styles.rowRemoveButton, iconOnly: true, size: "xs", onClick: () => removeRow(row.id), "aria-label": `Remove ${row.name}`, children: _jsx(Icon, { name: "ph:trash", size: 12, decorative: true }) }) })] }, row.id))), _jsxs("div", { className: styles.addRowControls, children: [_jsxs(Button, { size: "sm", onClick: addRow, fullWidth: true, children: [_jsx(Icon, { name: "ph:plus", size: 14, decorative: true }), "Instrument"] }), onUploadRow && (_jsx(Button, { iconOnly: true, size: "xs", onClick: onUploadRow, "aria-label": "Upload drum instrument row", children: _jsx(Icon, { name: "ph:upload", size: 14, decorative: true }) }))] })] }), _jsx("div", { className: styles.stepScroller, children: _jsxs("div", { className: styles.stepPlane, children: [playStep != null && _jsx("div", { className: styles.playColumn, "aria-hidden": true }), _jsx("div", { className: styles.stepHeader, children: Array.from({ length: stepCount }, (_, step) => (_jsx("div", { className: styles.stepNumber, children: step + 1 }, step))) }), _jsxs("div", { className: styles.stepRows, children: [rows.map((row) => (_jsx("div", { className: styles.stepGrid, children: normalizeDrumSteps(row.steps, stepCount).map((cell, step) => {
                                                const selected = selectedCells.has(cellKey(row.id, step));
                                                return (_jsx("button", { type: "button", className: [
                                                        styles.stepCell,
                                                        cell.on && styles.stepCellOn,
                                                        selected && styles.stepCellSelected,
                                                        cell.pitchHz && styles.stepCellTuned,
                                                    ].filter(Boolean).join(" "), onPointerDown: (e) => startCellPointer(e, row.id, step), onPointerEnter: () => enterCell(row.id, step), onPointerUp: () => endCellPointer(row.id, step), onContextMenu: (e) => openCellMenu(e, row.id, step), "aria-pressed": cell.on, "aria-label": `${row.name} step ${step + 1}`, children: cell.pitchHz && (_jsx("span", { className: styles.cellNote, children: frequencyToNoteName(cell.pitchHz) })) }, step));
                                            }) }, row.id))), _jsx("div", { className: styles.addRowSpacer, "aria-hidden": true })] })] }) })] }), cellMenu && (_jsx(CellMenu, { state: cellMenu, hasClipboard: Boolean(cellClipboardRef.current), selectionSize: targetKeys(cellMenu.rowId, cellMenu.step).size, onShiftPitch: () => {
                    const row = rows.find((candidate) => candidate.id === cellMenu.rowId);
                    const cell = normalizeDrumCell(row?.steps[cellMenu.step]);
                    setPitchPopover({
                        ...cellMenu,
                        value: formatFrequency(cell.pitchHz),
                        error: false,
                    });
                    setCellMenu(null);
                }, onCopy: () => {
                    copyCells(cellMenu.rowId, cellMenu.step);
                    setCellMenu(null);
                }, onPaste: () => {
                    pasteCells(cellMenu.rowId, cellMenu.step);
                    setCellMenu(null);
                }, onReset: () => {
                    resetCells(cellMenu.rowId, cellMenu.step);
                    setCellMenu(null);
                } })), pitchPopover && (_jsx(PitchPopover, { state: pitchPopover, onChange: (value) => setPitchPopover({ ...pitchPopover, value, error: false }), onApply: applyPitch, onClear: clearPitch }))] }));
}
function CellMenu({ state, hasClipboard, selectionSize, onShiftPitch, onCopy, onPaste, onReset, }) {
    const labelSuffix = selectionSize > 1 ? " selection" : " cell";
    return createPortal(_jsxs(FloatingLayer, { className: styles.cellMenu, x: state.x, y: state.y, role: "menu", children: [_jsx("button", { type: "button", className: styles.cellMenuItem, onClick: onShiftPitch, role: "menuitem", children: "Shift pitch" }), _jsxs("button", { type: "button", className: styles.cellMenuItem, onClick: onCopy, role: "menuitem", children: ["Copy", labelSuffix] }), _jsx("button", { type: "button", className: styles.cellMenuItem, onClick: onPaste, disabled: !hasClipboard, role: "menuitem", children: "Paste" }), _jsxs("button", { type: "button", className: styles.cellMenuItem, onClick: onReset, role: "menuitem", children: ["Reset", labelSuffix] })] }), document.body);
}
function PitchPopover({ state, onChange, onApply, onClear, }) {
    return createPortal(_jsxs(FloatingLayer, { className: styles.pitchPopover, x: state.x, y: state.y, children: [_jsx(TextInput, { autoFocus: true, className: styles.pitchField, label: "Pitch", layout: "inline", value: state.value, placeholder: "C4 or 440", onChange: (e) => onChange(e.target.value), onKeyDown: (e) => {
                    if (e.key === "Enter")
                        onApply();
                } }), state.error && _jsx("div", { className: styles.pitchError, children: "Use note or Hz" }), _jsxs("div", { className: styles.pitchActions, children: [_jsx(Button, { size: "xs", onClick: onClear, children: "Default" }), _jsx(Button, { size: "xs", variant: "primary", onClick: onApply, children: "Apply" })] })] }), document.body);
}
function cellKey(rowId, step) {
    return `${rowId}:${step}`;
}
function parseCellKey(key) {
    const lastColon = key.lastIndexOf(":");
    if (lastColon < 0)
        return null;
    const step = Number(key.slice(lastColon + 1));
    if (!Number.isInteger(step))
        return null;
    return { rowId: key.slice(0, lastColon), step };
}
const fallbackInstrument = {
    id: "drum-fallback",
    name: "Drum Preview",
    kind: "synth",
    envelope: { attackMs: 1, decayMs: 80, sustain: 0, releaseMs: 40 },
    knobs: { cutoff: 0.4, resonance: 0.2, drive: 0.2, color: 0.5 },
    waveform: "sine",
    sampleIds: [],
    userCreated: false,
};
const DRUM_SPEEDS = [1, 2, 4, 8];
const DEFAULT_CELL_SIZE = 28;
const MIN_CELL_SIZE = 20;
const CELL_ZOOM_STEP = 4;
