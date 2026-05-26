import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FloatingLayer } from "../FloatingLayer";
import { Icon } from "../Icon";
import styles from "./FloatingSelect.module.css";
export function FloatingSelect({ value, options, open, fillHeight = false, label, layout = "default", ariaLabel, onOpenChange, onChange, }) {
    const buttonRef = useRef(null);
    const [menuRect, setMenuRect] = useState(null);
    const selected = options.find((option) => option.value === value) ?? options[0];
    useEffect(() => {
        if (!open)
            return;
        function position() {
            const rect = buttonRef.current?.getBoundingClientRect();
            if (!rect)
                return;
            setMenuRect({ left: rect.left, top: rect.bottom - 1, width: rect.width });
        }
        position();
        window.addEventListener("resize", position);
        window.addEventListener("scroll", position, true);
        return () => {
            window.removeEventListener("resize", position);
            window.removeEventListener("scroll", position, true);
        };
    }, [open]);
    return (_jsxs("div", { className: [
            styles.wrap,
            fillHeight && styles.fillHeight,
            layout === "inline" && styles.inline,
        ].filter(Boolean).join(" "), "data-floating-layer": true, children: [label && _jsx("span", { className: styles.label, children: label }), _jsxs("button", { ref: buttonRef, type: "button", className: styles.trigger, onClick: () => onOpenChange(!open), "aria-label": ariaLabel, "aria-haspopup": "listbox", "aria-expanded": open, children: [_jsx("span", { className: styles.text, children: selected?.label ?? "" }), _jsx(Icon, { name: "ph:caret-down", size: 12, decorative: true })] }), open && menuRect && createPortal(_jsx(FloatingLayer, { className: styles.menu, x: menuRect.left, y: menuRect.top, width: menuRect.width, role: "listbox", children: options.map((option) => (_jsx("button", { type: "button", role: "option", "aria-selected": option.value === selected?.value, className: `${styles.option} ${option.value === selected?.value ? styles.optionSelected : ""}`, onClick: () => {
                        onChange(option.value);
                        onOpenChange(false);
                    }, children: option.label }, option.value))) }), document.body)] }));
}
