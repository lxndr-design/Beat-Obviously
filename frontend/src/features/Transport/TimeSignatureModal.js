import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { Modal, Button, FloatingSelect, NumberInput } from "../../components";
import { useProjectStore } from "../../state/store";
import styles from "./TimeSignatureModal.module.css";
const DENOMS = [2, 4, 8, 16];
/**
 * TimeSignatureModal — set numerator, denominator, and which beats inside
 * the bar should get a bold tick.
 *
 * Example: 5/4 with boldBeats=[1, 4] renders bold tick marks on beats 1
 * and 4 of every bar (matching the user's example from the spec).
 */
export function TimeSignatureModal({ onClose }) {
    const ts = useProjectStore((s) => s.project.timeSignature);
    const setTs = useProjectStore((s) => s.setTimeSignature);
    const [num, setNum] = useState(ts.num);
    const [denom, setDenom] = useState(ts.denom);
    const [bold, setBold] = useState(ts.boldBeats);
    const [denomOpen, setDenomOpen] = useState(false);
    const dirty = num !== ts.num ||
        denom !== ts.denom ||
        bold.length !== ts.boldBeats.length ||
        bold.some((b, i) => b !== ts.boldBeats[i]);
    function toggleBold(beat) {
        setBold((prev) => prev.includes(beat) ? prev.filter((b) => b !== beat) : [...prev, beat].sort((a, b) => a - b));
    }
    function save() {
        setTs({ num, denom, boldBeats: bold.filter((b) => b <= num) });
        onClose();
    }
    return (_jsxs(Modal, { open: true, title: "Time signature", width: "sm", onClose: onClose, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: onClose, children: "Cancel" }), _jsx(Button, { variant: "primary", disabled: !dirty, onClick: save, children: "Save" })] }), children: [_jsxs("div", { className: styles.row, children: [_jsx(NumberInput, { label: "Beats per bar", value: num, min: 1, max: 32, step: 1, onChange: setNum }), _jsx(FloatingSelect, { label: "Note value", value: String(denom), ariaLabel: "Note value", options: DENOMS.map((d) => ({ value: String(d), label: `1/${d}` })), open: denomOpen, onOpenChange: setDenomOpen, onChange: (value) => setDenom(Number(value)) })] }), _jsxs("div", { className: styles.boldSection, children: [_jsx("span", { className: styles.label, children: "Bold ticks (per bar)" }), _jsx("div", { className: styles.beatGrid, children: Array.from({ length: num }, (_, i) => i + 1).map((b) => (_jsx("button", { type: "button", className: `${styles.beatCell} ${bold.includes(b) ? styles.beatActive : ""}`, onClick: () => toggleBold(b), "aria-pressed": bold.includes(b), "aria-label": `Beat ${b}`, children: b }, b))) })] })] }));
}
