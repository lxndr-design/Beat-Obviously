import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import styles from "./Block.module.css";
/**
 * Block — a section container.
 *
 * The fundamental layout unit. Pages are grids of Blocks. A Block has an
 * optional 1px outline to enforce visual structure, an optional header
 * stripe (uppercase label + right-aligned actions), and a content area.
 */
export function Block({ framed = true, title, actions, padding = "none", fill = false, className, children, ...rest }) {
    const cls = [
        styles.block,
        framed && styles.framed,
        fill && styles.fill,
        styles[`pad-${padding}`],
        className,
    ]
        .filter(Boolean)
        .join(" ");
    return (_jsxs("section", { className: cls, ...rest, children: [(title || actions) && (_jsxs("header", { className: styles.header, children: [title && _jsx("h2", { className: styles.title, children: title }), actions && _jsx("div", { className: styles.actions, children: actions })] })), _jsx("div", { className: styles.body, children: children })] }));
}
