import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Icon, HoverInfo } from "../../components";
import styles from "./WaveformPicker.module.css";
const OPTIONS = [
    { value: "sine", icon: "ph:wave-sine", label: "Sine" },
    { value: "saw", icon: "ph:wave-sawtooth", label: "Saw" },
    { value: "square", icon: "ph:wave-square", label: "Square" },
    { value: "triangle", icon: "ph:wave-triangle", label: "Triangle" },
    { value: "noise", icon: "ph:waveform", label: "Noise" },
];
/**
 * WaveformPicker — radio-group of icon buttons, one per waveform shape.
 *
 * The selected option is filled (inverted bg). Hovering the selected option
 * dims it to the off-white token, matching the rest of the active-surface
 * hover rule. Hovering an unselected option color-inverts as usual.
 */
export function WaveformPicker({ value, allowSample, onChange }) {
    const opts = allowSample
        ? [...OPTIONS, { value: "sample", icon: "ph:music-notes-simple", label: "Sample" }]
        : OPTIONS;
    const selected = opts.find((o) => o.value === value);
    return (_jsxs("div", { className: styles.wrap, children: [_jsx("div", { className: styles.row, role: "radiogroup", "aria-label": "Waveform", children: opts.map((o) => (_jsx(HoverInfo, { content: o.label, children: _jsx("button", { type: "button", role: "radio", "aria-checked": value === o.value, "aria-label": o.label, className: `${styles.btn} ${value === o.value ? styles.active : ""}`, onClick: () => onChange(o.value), children: _jsx(Icon, { name: o.icon, size: 16, decorative: true }) }) }, o.value))) }), _jsx("div", { className: styles.selectedLabel, children: selected?.label ?? value })] }));
}
