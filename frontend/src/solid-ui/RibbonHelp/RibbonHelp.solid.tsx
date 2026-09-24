import { createEffect, createSignal, createUniqueId, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Button } from "../Button";
import { Icon } from "../Icon";
import styles from "./RibbonHelp.module.css";

export interface RibbonHelpPage {
  title: string;
  body: string;
}

export interface RibbonHelpProps {
  label: string;
  pages: RibbonHelpPage[];
}

const RIBBON_HELP_OPEN_EVENT = "beat:ribbon-help-open";
let nextRibbonHelpOwnerId = 1;

export function RibbonHelp(props: RibbonHelpProps) {
  let triggerElement: HTMLButtonElement | undefined;
  let popoverElement: HTMLDivElement | undefined;
  const ownerId = nextRibbonHelpOwnerId++;
  const popoverId = `ribbon-help-${createUniqueId()}`;
  const [open, setOpen] = createSignal(false);
  const [pageIndex, setPageIndex] = createSignal(0);
  const [position, setPosition] = createSignal<{
    x: number;
    y: number;
    arrowX: number;
    placement: "top" | "bottom";
  } | null>(null, { equals: false });

  const pages = () => props.pages.filter((page) => page.title.trim() && page.body.trim());
  const currentPage = () => pages()[Math.min(pageIndex(), Math.max(0, pages().length - 1))];

  function close() {
    setOpen(false);
    setPosition(null);
  }

  function toggle(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (open()) {
      close();
      return;
    }
    window.dispatchEvent(new CustomEvent(RIBBON_HELP_OPEN_EVENT, { detail: { ownerId } }));
    setPageIndex(0);
    setPosition(null);
    setOpen(true);
  }

  function updatePosition() {
    const trigger = triggerElement;
    const popover = popoverElement;
    if (!trigger || !popover) return;

    const triggerRect = trigger.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const dialogBoundary = trigger.closest('[role="dialog"]')?.getBoundingClientRect();
    const boundary = dialogBoundary ?? {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
    const gap = 6;
    const margin = 6;
    const preferredX = triggerRect.left + (triggerRect.width / 2) - 30;
    const x = Math.min(
      Math.max(preferredX, boundary.left + margin),
      Math.max(boundary.left + margin, boundary.right - popoverRect.width - margin),
    );
    const fitsBelow = triggerRect.bottom + gap + popoverRect.height <= boundary.bottom - margin;
    const placement = fitsBelow ? "bottom" : "top";
    const y = placement === "bottom"
      ? triggerRect.bottom + gap
      : triggerRect.top - popoverRect.height - gap;
    const arrowX = Math.min(
      Math.max(triggerRect.left + (triggerRect.width / 2) - x, 15),
      Math.max(15, popoverRect.width - 15),
    );

    setPosition({
      x,
      y: Math.min(Math.max(y, boundary.top + margin), boundary.bottom - popoverRect.height - margin),
      arrowX,
      placement,
    });
  }

  createEffect(() => {
    if (!open()) return;
    pageIndex();
    queueMicrotask(updatePosition);
  });

  createEffect(() => {
    if (!open()) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && (triggerElement?.contains(target) || popoverElement?.contains(target))) return;
      close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
        triggerElement?.focus();
      }
    }
    function onAnyHelpOpen(event: Event) {
      const nextOwnerId = event instanceof CustomEvent ? event.detail?.ownerId : undefined;
      if (nextOwnerId !== ownerId) close();
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener(RIBBON_HELP_OPEN_EVENT, onAnyHelpOpen);
    onCleanup(() => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener(RIBBON_HELP_OPEN_EVENT, onAnyHelpOpen);
    });
  });

  return (
    <Show when={pages().length > 0}>
      <Button
        ref={triggerElement}
        iconOnly
        size="xs"
        variant="ghost"
        class={styles.trigger}
        aria-label={`About ${props.label}`}
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={open() ? popoverId : undefined}
        onClick={toggle}
      >
        <Icon name="ph:info" size={18} decorative />
      </Button>

      <Show when={open() && currentPage()}>
        <Portal mount={document.body}>
          <div
            ref={popoverElement}
            id={popoverId}
            class={styles.popover}
            style={{
              left: `${position()?.x ?? 0}px`,
              top: `${position()?.y ?? 0}px`,
              visibility: position() ? "visible" : "hidden",
              "--ribbon-help-arrow-x": `${position()?.arrowX ?? 15}px`,
            }}
            role="dialog"
            aria-label={`${props.label} help`}
            data-placement={position()?.placement ?? "bottom"}
            data-floating-layer
          >
            <span class={styles.arrow} aria-hidden />
            <header class={styles.header}>
              <span class={styles.context}>{props.label}</span>
              <Button iconOnly size="xs" variant="ghost" class={styles.close} onClick={close} aria-label={`Close ${props.label} help`}>
                <Icon name="ph:x" size={18} decorative />
              </Button>
            </header>
            <For each={[currentPage()]}>
              {(page) => (
                <div class={styles.content}>
                  <h3>{page.title}</h3>
                  <p>{page.body}</p>
                </div>
              )}
            </For>
            <Show when={pages().length > 1}>
              <footer class={styles.footer}>
                <Button size="xs" variant="ghost" disabled={pageIndex() === 0} onClick={() => setPageIndex((index) => Math.max(0, index - 1))}>
                  <Icon name="ph:caret-left" size={18} decorative />
                  Back
                </Button>
                <span class={styles.pageCount}>{pageIndex() + 1} / {pages().length}</span>
                <Button size="xs" variant="ghost" disabled={pageIndex() >= pages().length - 1} onClick={() => setPageIndex((index) => Math.min(pages().length - 1, index + 1))}>
                  Next
                  <Icon name="ph:caret-right" size={18} decorative />
                </Button>
              </footer>
            </Show>
          </div>
        </Portal>
      </Show>
    </Show>
  );
}
