import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Modal, Button, FloatingSelect, NumberInput, useModalStack } from "../../components";
import { createInstrumentBufferSource, noteFrequency } from "../../audio/synthPreview";
import { useAudioFileStore, useProjectStore, useUiStore, useInstrumentStore, useTransportStore, } from "../../state/store";
import { send } from "../../ipc/bridge";
import { selectSegment } from "../../state/selectors";
import { PianoRoll } from "../MidiEditor";
import { MidiTransport } from "../MidiEditor/MidiTransport";
import { DrumSequencer } from "../DrumEditor/DrumSequencer";
import styles from "./SegmentEditorModal.module.css";
/**
 * SegmentEditorModal — universal segment editor.
 *
 * MIDI variant:
 *   - Title: "MIDI — <name>"
 *   - Inline controls: Length, Instrument (dropdown)
 *   - In-modal transport: Play / Pause / Restart (auto-loop the segment)
 *   - PianoRoll for note editing
 *
 * Audio variant:
 *   - Stub for now (audio editor lives elsewhere)
 *
 * Removed per spec: Start, Repeats, Layer fields; beats unit suffix.
 */
export function SegmentEditorModal({ segmentId }) {
    const source = useProjectStore(() => selectSegment(segmentId));
    const updateSegment = useProjectStore((s) => s.updateSegment);
    const closeEditor = useUiStore((s) => s.closeEditor);
    const requestDirtyClose = useModalStack((s) => s.requestDirtyClose);
    const instruments = useInstrumentStore((s) => s.instruments);
    const addInstrument = useInstrumentStore((s) => s.addInstrument);
    const addAudioFile = useAudioFileStore((s) => s.addFile);
    const positionBeat = useTransportStore((s) => s.positionBeat);
    const playing = useTransportStore((s) => s.playing);
    const id = `segment-${segmentId}`;
    const [draft, setDraft] = useState(source);
    const [instrumentSelectOpen, setInstrumentSelectOpen] = useState(false);
    const previewCtxRef = useRef(null);
    useEffect(() => {
        if (source && !draft)
            setDraft(structuredClone(source));
    }, [source, draft]);
    useEffect(() => () => {
        if (previewCtxRef.current)
            void previewCtxRef.current.close();
    }, []);
    if (!draft || !source)
        return null;
    const dirty = JSON.stringify(draft) !== JSON.stringify(source);
    function save() {
        updateSegment(segmentId, draft);
        close();
    }
    function close() {
        closeEditor({ kind: "segment", segmentId });
    }
    function onClose() {
        if (dirty)
            requestDirtyClose(id, save, close);
        else
            close();
    }
    const midiNotes = draft.payload.kind === "midi" || draft.payload.kind === "mixed"
        ? draft.payload.notes
        : [];
    function updateMidi(notes) {
        if (draft.payload.kind === "midi") {
            setDraft({ ...draft, payload: { kind: "midi", notes } });
        }
        else if (draft.payload.kind === "mixed") {
            setDraft({ ...draft, payload: { ...draft.payload, notes } });
        }
    }
    function updateDrumRows(rows) {
        if (draft.payload.kind !== "drum")
            return;
        setDraft({ ...draft, payload: { ...draft.payload, rows } });
    }
    function resizeDrum(lengthBeats, rows) {
        if (draft.payload.kind !== "drum")
            return;
        const stepCount = Math.max(1, Math.min(64, Math.round(lengthBeats)));
        setDraft({
            ...draft,
            lengthBeats: stepCount,
            payload: { ...draft.payload, stepCount, rows },
        });
    }
    function updateDrumSpeed(speed) {
        if (draft.payload.kind !== "drum")
            return;
        setDraft({ ...draft, payload: { ...draft.payload, speed } });
    }
    function updateDrumDefaultPitch(frequencyHz) {
        if (draft.payload.kind !== "drum")
            return;
        setDraft({ ...draft, payload: { ...draft.payload, defaultPitchHz: frequencyHz } });
    }
    async function uploadDrumRow() {
        if (draft.payload.kind !== "drum")
            return;
        const resp = await send({ kind: "audio.import" });
        if (!resp.file)
            return;
        addAudioFile(resp.file);
        const name = sampleName(resp.file.name);
        const instrumentId = addInstrument({
            name,
            kind: "sampler",
            waveform: "sample",
            sampleIds: [resp.file.id],
            userCreated: true,
        });
        const nextRow = {
            id: crypto.randomUUID(),
            instrumentId,
            name,
            steps: Array.from({ length: draft.payload.stepCount }, () => false),
        };
        setDraft({
            ...draft,
            payload: { ...draft.payload, rows: [...draft.payload.rows, nextRow] },
        });
    }
    function previewNote(pitch, velocity = 100) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Ctor = (window.AudioContext || window.webkitAudioContext);
        if (!previewCtxRef.current)
            previewCtxRef.current = new Ctor();
        const ctx = previewCtxRef.current;
        if (ctx.state === "suspended")
            void ctx.resume();
        const gain = ctx.createGain();
        const instrument = instruments.find((i) => i.id === draft?.instrumentId);
        const now = ctx.currentTime;
        const peak = (velocity / 127) * 0.25;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.005);
        gain.gain.linearRampToValueAtTime(0, now + 0.2);
        gain.connect(ctx.destination);
        const synth = instrument ?? fallbackInstrument;
        const source = createInstrumentBufferSource(ctx, synth, 0.24, noteFrequency(pitch, synth));
        source.connect(gain);
        source.start(now);
        source.stop(now + 0.24);
    }
    const isMidi = draft.payload.kind === "midi" || draft.payload.kind === "mixed";
    const isDrum = draft.payload.kind === "drum";
    const drumPayload = draft.payload.kind === "drum" ? draft.payload : null;
    const titleKind = draft.payload.kind === "audio" ? "Audio" : isDrum ? "Drums" : "MIDI";
    const displayName = draft.name?.trim() || `Segment ${segmentId.slice(0, 6)}`;
    const playheadBeat = playing &&
        positionBeat >= draft.startBeat &&
        positionBeat <= draft.startBeat + draft.lengthBeats
        ? positionBeat - draft.startBeat
        : null;
    return (_jsxs(Modal, { open: true, scopeId: id, title: `${titleKind} — ${displayName}`, width: "lg", dirty: dirty, onClose: onClose, onRequestCloseDirty: onClose, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: onClose, children: "Cancel" }), _jsx(Button, { variant: "primary", disabled: !dirty, onClick: save, children: "Save" })] }), children: [isMidi && (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles.controls, children: [_jsx(NumberInput, { layout: "inline", label: "Length", value: draft.lengthBeats, min: 0.25, step: 0.25, onChange: (v) => setDraft({ ...draft, lengthBeats: Math.max(0.25, v) }) }), _jsx(FloatingSelect, { layout: "inline", label: "Instrument", value: draft.instrumentId ?? "", ariaLabel: "Segment instrument", options: [
                                    { value: "", label: "-- none --" },
                                    ...instruments.map((i) => ({ value: i.id, label: i.name })),
                                ], open: instrumentSelectOpen, onOpenChange: setInstrumentSelectOpen, onChange: (instrumentId) => setDraft({
                                    ...draft,
                                    instrumentId: instrumentId || undefined,
                                }) }), _jsx("div", { className: styles.transportSlot, children: _jsx(MidiTransport, { notes: midiNotes, lengthBeats: draft.lengthBeats, bpm: useProjectStore.getState().project.bpm, instrument: instruments.find((i) => i.id === draft.instrumentId), hotkeyScopeId: id }) })] }), _jsx(PianoRoll, { notes: midiNotes, lengthBeats: draft.lengthBeats, playheadBeat: playheadBeat, onChange: updateMidi, onPreviewNote: previewNote })] })), drumPayload && (_jsx(_Fragment, { children: _jsx(DrumSequencer, { rows: drumPayload.rows, stepCount: drumPayload.stepCount, speed: drumPayload.speed ?? 1, defaultPitchHz: drumPayload.defaultPitchHz, lengthBeats: draft.lengthBeats, bpm: useProjectStore.getState().project.bpm, instruments: instruments, hotkeyScopeId: id, onChange: updateDrumRows, onResize: resizeDrum, onDefaultPitchChange: updateDrumDefaultPitch, onSpeedChange: updateDrumSpeed, onUploadRow: uploadDrumRow }) })), draft.payload.kind === "audio" && (_jsxs("div", { className: styles.audioPanel, children: [_jsx("div", { className: styles.audioLabel, children: "Audio source" }), _jsx("p", { className: styles.audioHint, children: draft.payload.audioFileId
                            ? draft.payload.audioFileId
                            : "(no file attached — use ‘Import Audio’ from the track menu)" })] }))] }));
}
const fallbackInstrument = {
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
function sampleName(filename) {
    return filename.replace(/\.[a-z0-9]+$/i, "").trim() || "Sample";
}
