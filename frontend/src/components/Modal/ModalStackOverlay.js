import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createPortal } from "react-dom";
import { Button } from "../Button";
import { useModalStack } from "./modalStack";
import styles from "./Modal.module.css";
import overlayStyles from "./ModalStackOverlay.module.css";
/**
 * Global overlay that shadows the entire window when an unsaved-check is
 * pending. Renders above every other modal. Always mounted near the app root.
 *
 * Per spec: save-confirmation has [Save, Don't Save, Cancel] buttons.
 */
export function ModalStackOverlay() {
    const pending = useModalStack((s) => s.pendingDirtyClose);
    const clear = useModalStack((s) => s.clearDirtyClose);
    if (!pending)
        return null;
    function handleSave() {
        pending.onSave();
        clear();
    }
    function handleDontSave() {
        pending.onDontSave();
        clear();
    }
    function handleCancel() {
        clear();
    }
    return createPortal(_jsx("div", { className: overlayStyles.fullOverlay, children: _jsxs("div", { className: `${styles.modal} ${styles["width-sm"]} animate-slide-in-bottom`, children: [_jsx("header", { className: styles.header, children: _jsx("h2", { className: styles.title, children: "Unsaved changes" }) }), _jsx("div", { className: styles.body, children: _jsx("p", { children: "You have unsaved changes. What would you like to do?" }) }), _jsxs("footer", { className: styles.footer, children: [_jsx(Button, { variant: "ghost", onClick: handleCancel, children: "Cancel" }), _jsx(Button, { variant: "default", onClick: handleDontSave, children: "Don't save" }), _jsx(Button, { variant: "primary", onClick: handleSave, children: "Save" })] })] }) }), document.body);
}
