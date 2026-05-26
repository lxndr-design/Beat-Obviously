import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef } from "react";
import styles from "./Toggle.module.css";
/**
 * Toggle — binary on/off. Renders as a black-and-white inverting box.
 * No slide animation — color invert per design spec.
 *
 * forwardRef so HoverInfo (and other wrappers that need a DOM handle) can
 * attach refs.
 */
export const Toggle = forwardRef(function Toggle({ checked, onChange, label, disabled }, ref) {
    return (_jsxs("label", { ref: ref, className: styles.wrap, children: [_jsx("button", { type: "button", role: "switch", "aria-checked": checked, disabled: disabled, onClick: () => onChange(!checked), className: `${styles.box} ${checked ? styles.on : ""}` }), label && _jsx("span", { className: styles.label, children: label })] }));
});
