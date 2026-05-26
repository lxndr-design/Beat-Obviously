import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useRef, useState, } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import styles from "./ContextMenu.module.css";
export function useContextMenu(itemsFactory) {
    const [state, setState] = useState(null);
    const factoryRef = useRef(itemsFactory);
    factoryRef.current = itemsFactory;
    const onContextMenu = useCallback((e) => {
        e.preventDefault();
        // Stop the event so an *outer* context-menu listener (e.g. on a parent
        // empty area) doesn't fire after we open the inner menu.
        e.stopPropagation();
        const items = factoryRef.current();
        if (items.length === 0)
            return;
        setState({ x: e.clientX, y: e.clientY, items });
    }, []);
    const close = useCallback(() => setState(null), []);
    const menu = state ? (_jsx(ContextMenuPortal, { x: state.x, y: state.y, items: state.items, onClose: close })) : null;
    return { onContextMenu, menu, close };
}
function ContextMenuPortal({ x, y, items, onClose }) {
    const menuRef = useRef(null);
    const [pos, setPos] = useState({ x, y });
    // Clamp to viewport after first paint so we don't overflow the right/bottom edges.
    useEffect(() => {
        const el = menuRef.current;
        if (!el)
            return;
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let nx = x;
        let ny = y;
        if (x + rect.width > vw)
            nx = vw - rect.width;
        if (y + rect.height > vh)
            ny = vh - rect.height;
        if (nx !== x || ny !== y)
            setPos({ x: nx, y: ny });
    }, [x, y]);
    useEffect(() => {
        function onDown(e) {
            if (!menuRef.current?.contains(e.target))
                onClose();
        }
        function onKey(e) {
            if (e.key === "Escape")
                onClose();
        }
        window.addEventListener("mousedown", onDown);
        window.addEventListener("keydown", onKey);
        window.addEventListener("blur", onClose);
        window.addEventListener("wheel", onClose, { passive: true });
        return () => {
            window.removeEventListener("mousedown", onDown);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("blur", onClose);
            window.removeEventListener("wheel", onClose);
        };
    }, [onClose]);
    return createPortal(_jsx("div", { ref: menuRef, className: styles.menu, style: { left: pos.x, top: pos.y }, role: "menu", children: items.map((item, i) => (_jsxs(Fragment, { children: [item.separatorBefore && _jsx("div", { className: styles.separator }), _jsxs("button", { type: "button", role: "menuitem", disabled: item.disabled, className: styles.item, onClick: () => {
                        if (item.disabled)
                            return;
                        item.onSelect();
                        onClose();
                    }, children: [_jsx("span", { className: styles.itemIcon, children: item.icon && _jsx(Icon, { name: item.icon, size: 16, decorative: true }) }), _jsx("span", { className: styles.itemLabel, children: item.label }), item.hint && _jsx("span", { className: styles.itemHint, children: item.hint })] })] }, i))) }), document.body);
}
// Tiny inline Fragment helper to keep the JSX above readable.
function Fragment({ children }) {
    return _jsx(_Fragment, { children: children });
}
const Ctx = createContext(null);
export function ContextMenuProvider({ children }) {
    const [state, setState] = useState(null);
    const value = {
        open: (x, y, items) => setState({ x, y, items }),
        close: () => setState(null),
    };
    return (_jsxs(Ctx.Provider, { value: value, children: [children, state && (_jsx(ContextMenuPortal, { x: state.x, y: state.y, items: state.items, onClose: () => setState(null) }))] }));
}
export function useGlobalContextMenu() {
    const v = useContext(Ctx);
    if (!v)
        throw new Error("useGlobalContextMenu requires <ContextMenuProvider>");
    return v;
}
