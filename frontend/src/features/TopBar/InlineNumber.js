import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import styles from "./InlineNumber.module.css";
/**
 * InlineNumber — compact number control with the label sitting inline to
 * the left of the input. Shares the unified `.field` shell with the time
 * display and time-sig button so the playback section reads as one row.
 *
 * Keys: ArrowUp/Down step by `step`; Shift+arrow by 10×; Enter commits.
 */
export function InlineNumber({ label, value, min = -Infinity, max = Infinity, step = 1, unit, onChange, }) {
    const [text, setText] = useState(String(value));
    useEffect(() => setText(String(value)), [value]);
    function commit(raw) {
        const n = parseFloat(raw);
        if (Number.isNaN(n)) {
            setText(String(value));
            return;
        }
        const clamped = Math.max(min, Math.min(max, n));
        onChange(clamped);
        setText(String(clamped));
    }
    function onKeyDown(e) {
        if (e.key === "ArrowUp") {
            e.preventDefault();
            const d = e.shiftKey ? step * 10 : step;
            commit(String(value + d));
        }
        else if (e.key === "ArrowDown") {
            e.preventDefault();
            const d = e.shiftKey ? step * 10 : step;
            commit(String(value - d));
        }
        else if (e.key === "Enter") {
            e.target.blur();
        }
    }
    return (_jsxs("label", { className: styles.wrap, children: [_jsx("span", { className: styles.label, children: label }), _jsx("input", { className: styles.input, type: "text", inputMode: "numeric", value: text, onChange: (e) => setText(e.target.value), onBlur: (e) => commit(e.currentTarget.value), onKeyDown: onKeyDown }), unit && _jsx("span", { className: styles.unit, children: unit })] }));
}
