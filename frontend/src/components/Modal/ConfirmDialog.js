import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { Modal } from "./Modal";
import { Button } from "../Button";
export function ConfirmDialog({ open, title, message, okLabel = "OK", cancelLabel = "Cancel", onOk, onCancel, }) {
    return (_jsx(Modal, { open: open, title: title, width: "sm", onClose: onCancel, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: onCancel, children: cancelLabel }), _jsx(Button, { variant: "primary", onClick: onOk, children: okLabel })] }), children: _jsx("p", { children: message }) }));
}
