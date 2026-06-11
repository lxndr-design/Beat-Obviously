import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import styles from "./ContextMenu.module.css";

export interface ContextMenuItem {
  label: string;
  /** Optional Iconify name (ph:* only). */
  icon?: string;
  onSelect?: () => void;
  disabled?: boolean;
  submenu?: ContextMenuItem[];
  /** Show a thin divider above this item. */
  separatorBefore?: boolean;
  /** Items rendered to the right (e.g. shortcut hint). */
  hint?: string;
}

/* -------------------------------------------------------------------------
 * useContextMenu — local hook for any component that wants to be a target.
 *
 *   const { onContextMenu, menu } = useContextMenu(() => [...items]);
 *   return <div onContextMenu={onContextMenu}>{menu}...</div>;
 *
 * Items are produced lazily so the trigger callback can build them from
 * fresh state (e.g. selected ids) without stale closure issues.
 * ----------------------------------------------------------------------- */

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

const CONTEXT_MENU_OPEN_EVENT = "beat:context-menu-open";
let nextContextMenuOwnerId = 1;

export function useContextMenu(itemsFactory: () => ContextMenuItem[]) {
  const [state, setState] = useState<MenuState | null>(null);
  const factoryRef = useRef(itemsFactory);
  const ownerIdRef = useRef(0);
  factoryRef.current = itemsFactory;
  if (ownerIdRef.current === 0) ownerIdRef.current = nextContextMenuOwnerId++;

  useEffect(() => {
    function onAnyMenuOpen(event: Event) {
      const ownerId = event instanceof CustomEvent ? event.detail?.ownerId : undefined;
      if (ownerId !== ownerIdRef.current) setState(null);
    }
    window.addEventListener(CONTEXT_MENU_OPEN_EVENT, onAnyMenuOpen);
    return () => window.removeEventListener(CONTEXT_MENU_OPEN_EVENT, onAnyMenuOpen);
  }, []);

  const announceOpen = useCallback(() => {
    window.dispatchEvent(new CustomEvent(CONTEXT_MENU_OPEN_EVENT, { detail: { ownerId: ownerIdRef.current } }));
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Stop the event so an *outer* context-menu listener (e.g. on a parent
    // empty area) doesn't fire after we open the inner menu.
    e.stopPropagation();
    const items = factoryRef.current();
    if (items.length === 0) return;
    announceOpen();
    setState({ x: e.clientX, y: e.clientY, items });
  }, [announceOpen]);

  const openAt = useCallback((x: number, y: number) => {
    const items = factoryRef.current();
    if (items.length === 0) return;
    announceOpen();
    setState({ x, y, items });
  }, [announceOpen]);

  const close = useCallback(() => setState(null), []);

  const menu = state ? (
    <ContextMenuPortal x={state.x} y={state.y} items={state.items} onClose={close} />
  ) : null;

  return { onContextMenu, openAt, menu, close };
}

/* -------------------------------------------------------------------------
 * The portal-rendered menu itself.
 * ----------------------------------------------------------------------- */

interface PortalProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

function ContextMenuPortal({ x, y, items, onClose }: PortalProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);

  // Clamp to viewport after first paint so we don't overflow the right/bottom edges.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (x + rect.width > vw) nx = vw - rect.width;
    if (y + rect.height > vh) ny = vh - rect.height;
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
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

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      data-floating-layer
    >
      {items.map((item, i) => (
        <Fragment key={i}>
          {item.separatorBefore && <div className={styles.separator} />}
          <div
            className={styles.itemWrap}
            onMouseEnter={() => setSubmenuIndex(!item.disabled && item.submenu ? i : null)}
            onFocus={() => setSubmenuIndex(!item.disabled && item.submenu ? i : null)}
          >
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={styles.item}
              onClick={() => {
                if (item.disabled || item.submenu) return;
                item.onSelect?.();
                onClose();
              }}
            >
              <span className={styles.itemIcon}>
                {item.icon && <Icon name={item.icon} size={12} decorative />}
              </span>
              <span className={styles.itemLabel}>{item.label}</span>
              {item.submenu ? (
                <span className={styles.itemHint}>›</span>
              ) : item.hint ? (
                <span className={styles.itemHint}>{item.hint}</span>
              ) : null}
            </button>
            {item.submenu && submenuIndex === i && (
              <div className={styles.submenu} role="menu" data-floating-layer>
                {item.submenu.map((child, childIndex) => (
                  <button
                    key={`${child.label}:${childIndex}`}
                    type="button"
                    role="menuitem"
                    disabled={child.disabled}
                    className={styles.item}
                    onClick={() => {
                      if (child.disabled) return;
                      child.onSelect?.();
                      onClose();
                    }}
                  >
                    <span className={styles.itemIcon}>
                      {child.icon && <Icon name={child.icon} size={12} decorative />}
                    </span>
                    <span className={styles.itemLabel}>{child.label}</span>
                    {child.hint && <span className={styles.itemHint}>{child.hint}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}

// Tiny inline Fragment helper to keep the JSX above readable.
function Fragment({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/* -------------------------------------------------------------------------
 * Lightweight provider — not strictly required by useContextMenu, but
 * exported for the rare case a feature wants to share one menu across many
 * triggers (e.g. when a global keyboard accelerator opens the menu).
 * ----------------------------------------------------------------------- */

interface CtxValue {
  open: (x: number, y: number, items: ContextMenuItem[]) => void;
  close: () => void;
}
const Ctx = createContext<CtxValue | null>(null);

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MenuState | null>(null);
  const value: CtxValue = {
    open: (x, y, items) => setState({ x, y, items }),
    close: () => setState(null),
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      {state && (
        <ContextMenuPortal
          x={state.x}
          y={state.y}
          items={state.items}
          onClose={() => setState(null)}
        />
      )}
    </Ctx.Provider>
  );
}

export function useGlobalContextMenu(): CtxValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGlobalContextMenu requires <ContextMenuProvider>");
  return v;
}
