import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.css";
import { Icon } from "../Icon";
import { useModalStack } from "./modalStack";
/**
 * Modal — the universal floating panel.
 *
 * - Animates in from the bottom (slide).
 * - Backdrop scrim. Clicking the scrim requests close.
 * - Multiple modals stack via the modalStack registry; the stacking order
 *   determines z-index, and the unsaved-check overlay (rendered by
 *   <ModalStackOverlay/>) shadows everything when triggered.
 */
export function Modal({ open, title, subtitle, footer, width = "md", scopeId, dirty = false, onClose, onRequestCloseDirty, children, }) {
    const autoId = useId();
    const id = scopeId ?? autoId;
    const ref = useRef(null);
    const { push, pop, indexOf } = useModalStack();
    useEffect(() => {
        if (!open)
            return;
        push(id);
        return () => pop(id);
    }, [open, id, push, pop]);
    useEffect(() => {
        if (!open)
            return;
        function onKey(e) {
            if (e.key === "Escape") {
                e.stopPropagation();
                requestClose();
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, dirty]);
    function requestClose() {
        if (dirty && onRequestCloseDirty) {
            onRequestCloseDirty();
        }
        else {
            onClose();
        }
    }
    if (!open)
        return null;
    const stackIndex = indexOf(id);
    return createPortal(_jsx("div", { className: styles.scrim, style: { zIndex: 300 + stackIndex * 10 }, onMouseDown: (e) => {
            if (e.target === e.currentTarget)
                requestClose();
        }, children: _jsxs("div", { ref: ref, className: `${styles.modal} ${styles[`width-${width}`]} animate-slide-in-bottom`, role: "dialog", "aria-modal": "true", "aria-labelledby": `${id}-title`, children: [_jsxs("header", { className: styles.header, children: [_jsxs("div", { className: styles.titleGroup, children: [_jsx("h2", { id: `${id}-title`, className: styles.title, children: title }), subtitle && _jsx("p", { className: styles.subtitle, children: subtitle })] }), _jsx("button", { className: styles.closeBtn, onClick: requestClose, "aria-label": "Close", type: "button", children: _jsx(Icon, { name: "ph:x", size: 16, decorative: true }) })] }), _jsx("div", { className: styles.body, children: children }), footer && _jsx("footer", { className: styles.footer, children: footer })] }) }), document.body);
}
