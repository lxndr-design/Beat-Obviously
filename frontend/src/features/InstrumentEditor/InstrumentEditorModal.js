import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Modal, Button, FloatingSelect, HoverInfo, Icon, Knob, NumberInput, TextInput, useModalStack } from "../../components";
import { useAudioFileStore, useInstrumentStore, useUiStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import { WaveformPicker } from "./WaveformPicker";
import { InstrumentWaveformPreview } from "./InstrumentWaveformPreview";
import styles from "./InstrumentEditorModal.module.css";
const LFO_WAVEFORMS = [
    { value: "sine", icon: "ph:wave-sine", label: "Sine" },
    { value: "triangle", icon: "ph:wave-triangle", label: "Triangle" },
    { value: "saw", icon: "ph:wave-sawtooth", label: "Saw" },
    { value: "square", icon: "ph:wave-square", label: "Square" },
];
/**
 * InstrumentEditorModal — edit a single instrument.
 *
 * Layout uses a unified 2-column CSS grid so every row aligns:
 *
 *   ┌──── Name ────┬──── Type ────┐
 *   │ inline field │ inline field │
 *   ├──── Macros ──┼─── Envelope ─┤
 *   │   4 knobs    │   A·D·S·R    │
 *   ├──── Oscillator (span 2) ────┤
 *   │ Waveform radios + knobs     │
 *   ├──── Modulation  (span 2) ───┤
 *   │ LFO rate / depth + glide    │
 *   ├──── Samples (sampler/hybrid)┤
 *   ├──── Lineage (if merged) ────┤
 *   └─────────────────────────────┘
 */
export function InstrumentEditorModal({ instrumentId }) {
    const source = useInstrumentStore((s) => s.instruments.find((i) => i.id === instrumentId));
    const update = useInstrumentStore((s) => s.updateInstrument);
    const closeEditor = useUiStore((s) => s.closeEditor);
    const requestDirtyClose = useModalStack((s) => s.requestDirtyClose);
    const addAudioFile = useAudioFileStore((s) => s.addFile);
    const id = `instrument-${instrumentId}`;
    const [draft, setDraft] = useState(source);
    const [typeOpen, setTypeOpen] = useState(false);
    useEffect(() => {
        if (source && !draft)
            setDraft(structuredClone(source));
    }, [source, draft]);
    if (!draft || !source)
        return null;
    const dirty = JSON.stringify(draft) !== JSON.stringify(source);
    const showOscillator = draft.kind === "synth" || draft.kind === "hybrid";
    const showSamples = draft.kind === "sampler" || draft.kind === "hybrid";
    function save() {
        update(instrumentId, draft);
        closeEditor({ kind: "instrument", instrumentId });
    }
    function close() {
        closeEditor({ kind: "instrument", instrumentId });
    }
    function onClose() {
        if (dirty)
            requestDirtyClose(id, save, close);
        else
            close();
    }
    async function uploadSample() {
        const resp = await send({ kind: "audio.import" });
        if (!resp.file)
            return;
        addAudioFile(resp.file);
        setDraft({
            ...draft,
            sampleIds: Array.from(new Set([...draft.sampleIds, resp.file.id])),
            kind: draft.kind === "synth" ? "hybrid" : draft.kind,
            waveform: draft.waveform === "sample" ? "sample" : draft.waveform,
        });
    }
    return (_jsx(Modal, { open: true, scopeId: id, title: `Edit instrument · ${draft.name}`, width: "lg", dirty: dirty, onClose: onClose, onRequestCloseDirty: onClose, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: onClose, children: "Cancel" }), _jsx(Button, { variant: "primary", disabled: !dirty, onClick: save, children: "Save" })] }), children: _jsxs("div", { className: styles.grid, children: [_jsx(InstrumentWaveformPreview, { instrument: draft, hotkeyScopeId: id }), _jsx(TextInput, { label: "Name", layout: "inline", value: draft.name, onChange: (e) => setDraft({ ...draft, name: e.target.value }) }), _jsx(FloatingSelect, { label: "Type", layout: "inline", value: draft.kind, ariaLabel: "Instrument type", options: [
                        { value: "synth", label: "Synth" },
                        { value: "sampler", label: "Sampler" },
                        { value: "hybrid", label: "Hybrid" },
                    ], open: typeOpen, onOpenChange: setTypeOpen, onChange: (kind) => setDraft({ ...draft, kind: kind }) }), _jsxs("section", { className: styles.section, children: [_jsx("h3", { className: styles.sectionHeading, children: "Macros" }), _jsxs("div", { className: styles.fourCol, children: [_jsx(Knob, { size: "sm", value: draft.knobs.cutoff, min: 0, max: 1, step: 0.01, unit: "%", label: "Cut", formatValue: formatPercent, parseValue: parsePercent, onChange: (v) => setDraft({ ...draft, knobs: { ...draft.knobs, cutoff: v } }) }), _jsx(Knob, { size: "sm", value: draft.knobs.resonance, min: 0, max: 1, step: 0.01, unit: "%", label: "Res", formatValue: formatPercent, parseValue: parsePercent, onChange: (v) => setDraft({ ...draft, knobs: { ...draft.knobs, resonance: v } }) }), _jsx(Knob, { size: "sm", value: draft.knobs.drive, min: 0, max: 1, step: 0.01, unit: "%", label: "Drv", formatValue: formatPercent, parseValue: parsePercent, onChange: (v) => setDraft({ ...draft, knobs: { ...draft.knobs, drive: v } }) }), _jsx(Knob, { size: "sm", value: draft.knobs.color, min: 0, max: 1, step: 0.01, unit: "%", label: "Shape", formatValue: formatPercent, parseValue: parsePercent, onChange: (v) => setDraft({ ...draft, knobs: { ...draft.knobs, color: v } }) })] })] }), _jsxs("section", { className: styles.section, children: [_jsx("h3", { className: styles.sectionHeading, children: "Envelope" }), _jsxs("div", { className: styles.fourCol, children: [_jsx(NumberInput, { label: "Attack", unit: "ms", value: draft.envelope.attackMs, min: 0, max: 5000, step: 1, onChange: (v) => setDraft({ ...draft, envelope: { ...draft.envelope, attackMs: v } }) }), _jsx(NumberInput, { label: "Decay", unit: "ms", value: draft.envelope.decayMs, min: 0, max: 5000, step: 1, onChange: (v) => setDraft({ ...draft, envelope: { ...draft.envelope, decayMs: v } }) }), _jsx(NumberInput, { label: "Sustain", unit: "%", value: Math.round(draft.envelope.sustain * 100), min: 0, max: 100, step: 1, onChange: (v) => setDraft({ ...draft, envelope: { ...draft.envelope, sustain: v / 100 } }) }), _jsx(NumberInput, { label: "Release", unit: "ms", value: draft.envelope.releaseMs, min: 0, max: 10000, step: 1, onChange: (v) => setDraft({ ...draft, envelope: { ...draft.envelope, releaseMs: v } }) })] })] }), showOscillator && (_jsxs("section", { className: `${styles.section} ${styles.spanFull}`, children: [_jsx("h3", { className: styles.sectionHeading, children: "Oscillator" }), _jsxs("div", { className: styles.oscRow, children: [_jsx(WaveformPicker, { value: draft.waveform, allowSample: draft.kind === "hybrid", onChange: (w) => setDraft({ ...draft, waveform: w }) }), _jsxs("div", { className: styles.fourCol, children: [_jsx(Knob, { size: "sm", bipolar: true, value: draft.detuneCents ?? 0, min: -100, max: 100, step: 1, unit: "ct", label: "Detune", formatValue: formatInteger, onChange: (v) => setDraft({ ...draft, detuneCents: v }) }), _jsx(Knob, { size: "sm", bipolar: true, label: "Oct", value: draft.octave ?? 0, min: -3, max: 3, step: 1, formatValue: formatInteger, onChange: (v) => setDraft({ ...draft, octave: v }) }), _jsx(Knob, { size: "sm", value: draft.subOscLevel ?? 0, min: 0, max: 1, step: 0.01, unit: "%", label: "Sub", formatValue: formatPercent, parseValue: parsePercent, onChange: (v) => setDraft({ ...draft, subOscLevel: v }) }), _jsx(GlideSlider, { value: draft.glideMs ?? 0, onChange: (v) => setDraft({ ...draft, glideMs: v }) })] })] })] })), showOscillator && (_jsxs("section", { className: `${styles.section} ${styles.spanFull}`, children: [_jsx("h3", { className: styles.sectionHeading, children: "Modulation" }), _jsxs("div", { className: styles.modGrid, children: [_jsx(LfoShapePicker, { value: draft.lfoWaveform ?? "sine", onChange: (value) => setDraft({ ...draft, lfoWaveform: value }) }), _jsx(VerticalSwitch, { label: "Rate", top: "Sync", bottom: "Hz", checked: draft.lfoSync ?? false, onChange: (v) => setDraft({ ...draft, lfoSync: v }) }), _jsx(VerticalSwitch, { label: "Trigger", top: "Retrig", bottom: "Free", checked: draft.lfoRetrigger ?? true, onChange: (v) => setDraft({ ...draft, lfoRetrigger: v }) }), _jsx(Knob, { className: styles.modKnob, size: "sm", value: draft.lfoRateHz ?? 4, min: 1, max: 20, step: 1, unit: "Hz", label: "LFO Rate", formatValue: formatInteger, onChange: (v) => setDraft({ ...draft, lfoRateHz: v }) }), _jsx(Knob, { className: styles.modKnob, size: "sm", value: draft.lfoDepth ?? 0, min: 0, max: 1, step: 0.01, unit: "%", label: "LFO Depth", formatValue: formatPercent, parseValue: parsePercent, onChange: (v) => setDraft({ ...draft, lfoDepth: v }) }), _jsx(Knob, { className: styles.modKnob, size: "sm", value: draft.lfoToPitch ?? 0, min: 0, max: 12, step: 1, unit: "st", label: "LFO Pitch", formatValue: formatInteger, onChange: (v) => setDraft({ ...draft, lfoToPitch: v }) }), _jsx(Knob, { className: styles.modKnob, size: "sm", value: draft.lfoToFilter ?? 0, min: -1, max: 1, step: 0.01, unit: "%", bipolar: true, label: "LFO Filter", formatValue: formatPercent, parseValue: parsePercent, onChange: (v) => setDraft({ ...draft, lfoToFilter: v }) }), _jsx(Knob, { className: styles.modKnob, size: "sm", value: draft.envToFilter ?? 0, min: -1, max: 1, step: 0.01, unit: "%", bipolar: true, label: "Env Filter", formatValue: formatPercent, parseValue: parsePercent, onChange: (v) => setDraft({ ...draft, envToFilter: v }) })] })] })), showSamples && (_jsxs("section", { className: `${styles.section} ${styles.spanFull}`, children: [_jsx("h3", { className: styles.sectionHeading, children: "Samples" }), _jsxs("div", { className: styles.samplesRow, children: [_jsxs("span", { className: styles.hint, children: [draft.sampleIds.length, " sample", draft.sampleIds.length === 1 ? "" : "s", " attached."] }), _jsx(Button, { size: "sm", onClick: uploadSample, children: "Upload sample\u2026" })] })] })), draft.parentIds && (_jsxs("section", { className: `${styles.section} ${styles.spanFull}`, children: [_jsx("h3", { className: styles.sectionHeading, children: "Lineage" }), _jsxs("p", { className: styles.hint, children: ["Derived from ", draft.parentIds.length, " parent instrument", draft.parentIds.length === 1 ? "" : "s", "."] })] }))] }) }));
}
function formatInteger(value) {
    return String(Math.round(value));
}
function formatPercent(value) {
    return String(Math.round(value * 100));
}
function parsePercent(raw) {
    const parsed = parseFloat(raw.replace("%", ""));
    if (Number.isNaN(parsed))
        return NaN;
    return raw.includes(".") && Math.abs(parsed) <= 1 ? parsed : parsed / 100;
}
function GlideSlider({ value, onChange }) {
    const clamped = Math.max(0, Math.min(500, value));
    return (_jsxs("label", { className: styles.glideSlider, children: [_jsxs("span", { className: styles.glideHeader, children: [_jsx("span", { className: styles.glideLabel, children: "Glide" }), _jsxs("span", { className: styles.glideValue, children: [Math.round(clamped), " ms"] })] }), _jsx("input", { className: styles.glideRange, type: "range", min: 0, max: 500, step: 1, value: clamped, "aria-label": "Glide", onChange: (e) => onChange(Number(e.currentTarget.value)) })] }));
}
function LfoShapePicker({ value, onChange }) {
    const selected = LFO_WAVEFORMS.find((option) => option.value === value);
    return (_jsxs("div", { className: styles.lfoShapeControl, children: [_jsx("div", { className: styles.lfoShapeButtons, role: "radiogroup", "aria-label": "LFO shape", children: LFO_WAVEFORMS.map((option) => (_jsx(HoverInfo, { content: option.label, children: _jsx("button", { type: "button", role: "radio", "aria-checked": value === option.value, "aria-label": option.label, className: `${styles.lfoShapeButton} ${value === option.value ? styles.lfoShapeButtonActive : ""}`, onClick: () => onChange(option.value), children: _jsx(Icon, { name: option.icon, size: 16, decorative: true }) }) }, option.value))) }), _jsx("span", { className: styles.lfoShapeLabel, children: selected?.label ?? value }), _jsx("span", { className: styles.switchLabel, children: "LFO Shape" })] }));
}
function VerticalSwitch({ label, top, bottom, checked, onChange }) {
    return (_jsxs("div", { className: styles.switchControl, children: [_jsx("span", { className: `${styles.switchOption} ${checked ? styles.switchOptionActive : ""}`, children: top }), _jsx("button", { type: "button", role: "switch", "aria-checked": checked, "aria-label": label, className: `${styles.verticalSwitch} ${checked ? styles.verticalSwitchOn : ""}`, onClick: () => onChange(!checked), children: _jsx("span", { className: styles.switchBall }) }), _jsx("span", { className: `${styles.switchOption} ${!checked ? styles.switchOptionActive : ""}`, children: bottom }), _jsx("span", { className: styles.switchLabel, children: label })] }));
}
