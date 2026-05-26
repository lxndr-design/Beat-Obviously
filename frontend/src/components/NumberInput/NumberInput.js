import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import styles from "./NumberInput.module.css";
/**
 * NumberInput — a single-line numeric field with arrow-key step and clamp.
 * Visual: black bg, white text, 1px white frame (legitimate — input frame
 * counts as structure delineation).
 */
export function NumberInput({ value, min = -Infinity, max = Infinity, step = 1, unit, label, layout = "stacked", commitOnChange = false, onChange, }) {
    const [text, setText] = useState(String(value));
    const [editing, setEditing] = useState(false);
    useEffect(() => {
        if (editing)
            return;
        setText(String(value));
    }, [editing, value]);
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
    function updateText(raw) {
        setText(raw);
        if (!commitOnChange)
            return;
        const n = parseFloat(raw);
        if (Number.isNaN(n))
            return;
        onChange(Math.max(min, Math.min(max, n)));
    }
    function onKeyDown(e) {
        if (e.key === "ArrowUp") {
            e.preventDefault();
            const delta = e.shiftKey ? step * 10 : step;
            commit(String(value + delta));
        }
        else if (e.key === "ArrowDown") {
            e.preventDefault();
            const delta = e.shiftKey ? step * 10 : step;
            commit(String(value - delta));
        }
        else if (e.key === "Enter") {
            e.target.blur();
        }
    }
    return (_jsxs("label", { className: `${styles.wrap} ${layout === "inline" ? styles.inline : ""}`, children: [label && _jsx("span", { className: styles.label, children: label }), _jsxs("span", { className: styles.fieldFrame, children: [_jsx("input", { className: styles.input, type: "text", inputMode: "numeric", value: text, onChange: (e) => updateText(e.target.value), onFocus: () => setEditing(true), onBlur: (e) => {
                            setEditing(false);
                            commit(e.currentTarget.value);
                        }, onKeyDown: onKeyDown }), unit && _jsx("span", { className: styles.unit, children: unit })] })] }));
}
