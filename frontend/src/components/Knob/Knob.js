import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./Knob.module.css";
/**
 * Knob — vertical-drag rotary control with a directly-editable numeric value.
 *
 * Interaction model:
 *   - Drag the dial vertically to change. Hold Shift while dragging for fine.
 *   - Click the value text to edit directly. Enter commits, Esc cancels.
 *   - With focus on the value field: ArrowUp/Down = step, Shift+ArrowUp/Down = 0.1.
 */
export function Knob({ value, min, max, step = 0.01, label, unit, formatValue = defaultFormatValue, parseValue, className, size = "md", bipolar = false, sensitivity = 200, onChange, onDragStart, onDragEnd, }) {
    const [dragging, setDragging] = useState(false);
    const [editing, setEditing] = useState(null);
    const startY = useRef(0);
    const startValue = useRef(value);
    const normalized = (value - min) / (max - min);
    const angle = -135 + normalized * 270;
    const commit = useCallback((raw) => {
        const n = parseValue ? parseValue(raw) : parseFloat(raw);
        if (Number.isNaN(n)) {
            setEditing(null);
            return;
        }
        onChange(clamp(n, min, max));
        setEditing(null);
    }, [onChange, min, max, parseValue]);
    const handlePointerDown = useCallback((e) => {
        if (editing !== null)
            return;
        e.preventDefault();
        e.target.setPointerCapture(e.pointerId);
        startY.current = e.clientY;
        startValue.current = value;
        setDragging(true);
        onDragStart?.();
    }, [value, onDragStart, editing]);
    useEffect(() => {
        if (!dragging)
            return;
        function move(e) {
            const dy = startY.current - e.clientY;
            const fine = e.shiftKey ? 0.2 : 1;
            const delta = (dy / sensitivity) * (max - min) * fine;
            let next = startValue.current + delta;
            next = clamp(next, min, max);
            if (step > 0)
                next = Math.round(next / step) * step;
            onChange(next);
        }
        function up() {
            setDragging(false);
            onDragEnd?.();
        }
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
    }, [dragging, min, max, step, sensitivity, onChange, onDragEnd]);
    function onValueKeyDown(e) {
        if (e.key === "Enter") {
            commit(e.currentTarget.value);
        }
        else if (e.key === "Escape") {
            setEditing(null);
        }
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const dir = e.key === "ArrowUp" ? 1 : -1;
            const inc = e.shiftKey ? 0.1 : step;
            onChange(clamp(value + dir * inc, min, max));
        }
    }
    return (_jsxs("div", { className: `${styles.knob} ${styles[`size-${size}`]} ${className ?? ""}`, children: [_jsx("div", { className: styles.dial, onPointerDown: handlePointerDown, role: "slider", "aria-valuemin": min, "aria-valuemax": max, "aria-valuenow": value, "aria-label": label, tabIndex: 0, children: _jsxs("svg", { viewBox: "-50 -50 100 100", className: styles.svg, children: [_jsx("circle", { cx: "0", cy: "0", r: "44", fill: "var(--color-bg)", stroke: "var(--color-fg)", strokeWidth: "2" }), bipolar && (_jsx("line", { x1: "0", y1: "-44", x2: "0", y2: "-36", stroke: "var(--color-fg)", strokeWidth: "2" })), _jsx("g", { transform: `rotate(${angle})`, children: _jsx("line", { x1: "0", y1: "-10", x2: "0", y2: "-40", stroke: "var(--color-fg)", strokeWidth: "3", strokeLinecap: "square" }) })] }) }), editing !== null ? (_jsx("input", { autoFocus: true, className: styles.editValue, defaultValue: editing, onBlur: (e) => commit(e.currentTarget.value), onKeyDown: onValueKeyDown })) : (_jsxs("button", { type: "button", className: styles.value, onClick: () => setEditing(formatValue(value)), "aria-label": `Edit ${label ?? "value"}`, children: [formatValue(value), unit ? ` ${unit}` : ""] })), label && _jsx("div", { className: styles.label, children: label })] }));
}
function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}
function defaultFormatValue(v) {
    // Cap decimal precision at two places without limiting total digits.
    return v.toFixed(2);
}
