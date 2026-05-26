import { jsx as _jsx } from "react/jsx-runtime";
import styles from "./FloatingLayer.module.css";
export function FloatingLayer({ x, y, width, className, role, children }) {
    return (_jsx("div", { className: `${styles.layer} ${className ?? ""}`, style: {
            "--floating-layer-x": `${x}px`,
            "--floating-layer-y": `${y}px`,
            "--floating-layer-width": width ? `${width}px` : undefined,
        }, role: role, "data-floating-layer": true, children: children }));
}
