import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Modal, Button, NumberInput, Knob } from "../../components";
import { useProjectStore, useUiStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import { EQ_BAND_COUNT, EQ_BAND_LABELS } from "../../state/types";
import styles from "./EqAutomationModal.module.css";
/**
 * EqAutomationModal — whole-song 7-band master EQ with automation timeline.
 *
 * Each automation point holds 7 dB values matching EQ_BAND_CENTERS_HZ. Engine
 * interpolates linearly between adjacent points at playback time.
 */
export function EqAutomationModal() {
    const points = useProjectStore((s) => s.project.masterEqAutomation);
    const closeEditor = useUiStore((s) => s.closeEditor);
    const setProject = useProjectStore((s) => s.loadProject);
    const project = useProjectStore((s) => s.project);
    function setPoints(next) {
        setProject({ ...project, masterEqAutomation: next });
        void send({ kind: "eq.setAutomation", points: next });
    }
    function addPoint() {
        const last = points[points.length - 1];
        const next = [
            ...points,
            {
                atBeat: last ? last.atBeat + 4 : 0,
                bandsDb: new Array(EQ_BAND_COUNT).fill(0),
            },
        ];
        setPoints(next);
    }
    function removePoint(idx) {
        setPoints(points.filter((_, i) => i !== idx));
    }
    function updatePointBeat(idx, atBeat) {
        setPoints(points.map((p, i) => (i === idx ? { ...p, atBeat } : p)));
    }
    function updateBand(idx, band, db) {
        setPoints(points.map((p, i) => i === idx
            ? { ...p, bandsDb: p.bandsDb.map((d, b) => (b === band ? db : d)) }
            : p));
    }
    return (_jsxs(Modal, { open: true, title: "Master EQ \u2014 7-band automation", width: "lg", onClose: () => closeEditor({ kind: "eq" }), footer: _jsxs(_Fragment, { children: [_jsx(Button, { onClick: addPoint, children: "+ Add point" }), _jsx(Button, { variant: "primary", onClick: () => closeEditor({ kind: "eq" }), children: "Done" })] }), children: [_jsx("p", { className: styles.hint, children: "Engine interpolates between automation points during playback." }), points.length === 0 ? (_jsx("p", { className: styles.empty, children: "No automation points yet. Click \"Add point\"." })) : (_jsx("div", { className: styles.list, children: points.map((p, i) => (_jsxs("div", { className: styles.point, children: [_jsx(NumberInput, { label: "@beat", value: p.atBeat, min: 0, step: 0.25, onChange: (v) => updatePointBeat(i, v) }), EQ_BAND_LABELS.map((label, band) => (_jsx(Knob, { value: p.bandsDb[band] ?? 0, min: -24, max: 24, step: 0.1, unit: "dB", label: label, bipolar: true, size: "sm", onChange: (v) => updateBand(i, band, v) }, band))), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => removePoint(i), children: "Remove" })] }, i))) }))] }));
}
