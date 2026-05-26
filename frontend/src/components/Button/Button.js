import { jsx as _jsx } from "react/jsx-runtime";
import { forwardRef } from "react";
import styles from "./Button.module.css";
/**
 * Base button.
 * No outline by default. Hover = color invert in 0.1s.
 * Variants are all monochrome — they differ in starting state, not color.
 *
 * - default: black bg, white fg → invert on hover
 * - primary: white bg, black fg (already inverted)
 * - ghost:   transparent bg, no hover background, just text invert
 * - danger:  same shape as default; uses a stronger label treatment
 */
export const Button = forwardRef(function Button({ variant = "default", size = "md", fullWidth = false, selected = false, iconOnly = false, className, children, type = "button", ...rest }, ref) {
    const cls = [
        styles.button,
        styles[`variant-${variant}`],
        styles[`size-${size}`],
        fullWidth && styles.fullWidth,
        selected && styles.selected,
        iconOnly && styles.iconOnly,
        className,
    ]
        .filter(Boolean)
        .join(" ");
    return (_jsx("button", { ref: ref, type: type, className: cls, ...rest, children: children }));
});
