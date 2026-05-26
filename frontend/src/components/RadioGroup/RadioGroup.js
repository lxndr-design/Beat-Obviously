import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from "./RadioGroup.module.css";
export function RadioGroup({ label, ariaLabel, value, options, onChange, }) {
    return (_jsxs("div", { className: styles.wrap, children: [label && _jsx("span", { className: styles.label, children: label }), _jsx("div", { className: styles.control, role: "radiogroup", "aria-label": ariaLabel, children: options.map((option) => {
                    const selected = option.value === value;
                    return (_jsx("button", { type: "button", role: "radio", "aria-checked": selected, className: `${styles.button} ${selected ? styles.active : ""}`, onClick: () => onChange(option.value), children: option.label }, String(option.value)));
                }) })] }));
}
