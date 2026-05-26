import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from "./TextInput.module.css";
export function TextInput({ label, layout = "stacked", unit, className, ...rest }) {
    const cls = [
        styles.wrap,
        layout === "inline" && styles.inline,
        layout === "bare" && styles.bare,
        className,
    ]
        .filter(Boolean)
        .join(" ");
    return (_jsxs("label", { className: cls, children: [label && _jsx("span", { className: styles.label, children: label }), _jsxs("span", { className: styles.fieldFrame, children: [_jsx("input", { className: styles.input, type: "text", ...rest }), unit && _jsx("span", { className: styles.unit, children: unit })] })] }));
}
