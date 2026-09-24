import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { meshTintVariantFor } from "../meshTint";
import { Icon } from "../Icon";
import styles from "./ContextMenu.module.css";

export interface ContextMenuItem {
  label: string;
  icon?: string;
  onSelect?: () => void;
  disabled?: boolean;
  submenu?: ContextMenuItem[];
  separatorBefore?: boolean;
  hint?: string;
}

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

const CONTEXT_MENU_OPEN_EVENT = "beat:context-menu-open";
let nextContextMenuOwnerId = 1;

export function createContextMenu(itemsFactory: () => ContextMenuItem[]) {
  const [state, setState] = createSignal<MenuState | null>(null, { equals: false });
  const ownerId = nextContextMenuOwnerId++;
  let secondaryOpenTimer: number | undefined;
  let fallbackOpen: { x: number; y: number; at: number } | undefined;

  function clearSecondaryOpenTimer() {
    if (secondaryOpenTimer === undefined) return;
    window.clearTimeout(secondaryOpenTimer);
    secondaryOpenTimer = undefined;
  }

  function onAnyMenuOpen(event: Event) {
    const nextOwnerId = event instanceof CustomEvent ? event.detail?.ownerId : undefined;
    if (nextOwnerId !== ownerId) setState(null);
  }
  window.addEventListener(CONTEXT_MENU_OPEN_EVENT, onAnyMenuOpen);
  onCleanup(() => {
    clearSecondaryOpenTimer();
    window.removeEventListener(CONTEXT_MENU_OPEN_EVENT, onAnyMenuOpen);
  });

  function announceOpen() {
    window.dispatchEvent(new CustomEvent(CONTEXT_MENU_OPEN_EVENT, { detail: { ownerId } }));
  }

  function openAt(x: number, y: number) {
    const items = itemsFactory();
    if (items.length === 0) return;
    announceOpen();
    setState({ x, y, items });
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    clearSecondaryOpenTimer();
    if (
      fallbackOpen
      && performance.now() - fallbackOpen.at < 500
      && Math.abs(fallbackOpen.x - event.clientX) < 2
      && Math.abs(fallbackOpen.y - event.clientY) < 2
    ) {
      fallbackOpen = undefined;
      return;
    }
    fallbackOpen = undefined;
    openAt(event.clientX, event.clientY);
  }

  function onMouseDown(event: MouseEvent) {
    if (event.button !== 2 && !(event.button === 0 && event.ctrlKey)) return;
    event.preventDefault();
    event.stopPropagation();
    const { clientX, clientY } = event;
    clearSecondaryOpenTimer();
    // WKWebView can consume the later contextmenu event. A deferred fallback
    // keeps custom menus working for both secondary-click and macOS Control-click.
    secondaryOpenTimer = window.setTimeout(() => {
      secondaryOpenTimer = undefined;
      fallbackOpen = { x: clientX, y: clientY, at: performance.now() };
      openAt(clientX, clientY);
    }, 0);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    openAt(rect.left + Math.min(24, rect.width / 2), rect.top + Math.min(24, rect.height));
  }

  function close() {
    setState(null);
  }

  const menu = () => (
    <Show when={state()}>
      {(current) => (
        <ContextMenuPortal
          x={current().x}
          y={current().y}
          items={current().items}
          onClose={close}
        />
      )}
    </Show>
  );

  return { onContextMenu, onMouseDown, onKeyDown, openAt, menu, close };
}

function ContextMenuPortal(props: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  let menuElement: HTMLDivElement | undefined;
  const [position, setPosition] = createSignal({ x: props.x, y: props.y }, { equals: false });
  const [submenuIndex, setSubmenuIndex] = createSignal<number | null>(null);

  createEffect(() => {
    const element = menuElement;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let x = props.x;
    let y = props.y;
    if (x + rect.width > viewportWidth) x = viewportWidth - rect.width;
    if (y + rect.height > viewportHeight) y = viewportHeight - rect.height;
    setPosition({ x, y });
  });

  function onDown(event: MouseEvent) {
    if (!menuElement?.contains(event.target as Node)) props.onClose();
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") props.onClose();
  }
  window.addEventListener("mousedown", onDown);
  window.addEventListener("keydown", onKey);
  window.addEventListener("blur", props.onClose);
  window.addEventListener("wheel", props.onClose, { passive: true });
  onCleanup(() => {
    window.removeEventListener("mousedown", onDown);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("blur", props.onClose);
    window.removeEventListener("wheel", props.onClose);
  });

  return (
    <Portal mount={document.body}>
      <div
        ref={menuElement}
        class={styles.menu}
        style={{ left: `${position().x}px`, top: `${position().y}px` }}
        role="menu"
        data-floating-layer
      >
        <For each={props.items}>
          {(item, index) => (
            <>
              <Show when={item.separatorBefore}><div class={styles.separator} /></Show>
              <div
                class={styles.itemWrap}
                onMouseEnter={() => setSubmenuIndex(!item.disabled && item.submenu ? index() : null)}
                onFocus={() => setSubmenuIndex(!item.disabled && item.submenu ? index() : null)}
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  class={styles.item}
                  data-mesh-variant={meshTintVariantFor(item.label)}
                  onClick={() => {
                    if (item.disabled || item.submenu) return;
                    item.onSelect?.();
                    props.onClose();
                  }}
                >
                  <span class={styles.itemIcon}>
                    <Show when={item.icon}>{(icon) => <Icon name={icon()} size={18} decorative />}</Show>
                  </span>
                  <span class={styles.itemLabel}>{item.label}</span>
                  <Show when={item.submenu} fallback={<Show when={item.hint}><span class={styles.itemHint}>{item.hint}</span></Show>}>
                    <span class={styles.itemHint}>›</span>
                  </Show>
                </button>
                <Show when={item.submenu && submenuIndex() === index()}>
                  <div class={styles.submenu} role="menu" data-floating-layer>
                    <For each={item.submenu}>
                      {(child) => (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={child.disabled}
                          class={styles.item}
                          data-mesh-variant={meshTintVariantFor(child.label)}
                          onClick={() => {
                            if (child.disabled) return;
                            child.onSelect?.();
                            props.onClose();
                          }}
                        >
                          <span class={styles.itemIcon}>
                            <Show when={child.icon}>{(icon) => <Icon name={icon()} size={18} decorative />}</Show>
                          </span>
                          <span class={styles.itemLabel}>{child.label}</span>
                          <Show when={child.hint}><span class={styles.itemHint}>{child.hint}</span></Show>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </>
          )}
        </For>
      </div>
    </Portal>
  );
}
