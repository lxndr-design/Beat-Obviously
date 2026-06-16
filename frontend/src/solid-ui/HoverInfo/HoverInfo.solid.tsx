/** @jsxImportSource solid-js */
import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import styles from "../../components/HoverInfo/HoverInfo.module.css";

type HoverInfoPlacement = "top" | "bottom" | "left" | "right";

export interface HoverInfoProps {
  children: JSX.Element;
  content: JSX.Element;
  delay?: number;
  placement?: HoverInfoPlacement;
}

export function HoverInfo(props: HoverInfoProps) {
  let triggerElement: HTMLSpanElement | undefined;
  let popoverElement: HTMLDivElement | undefined;
  let timer: number | null = null;
  const [open, setOpen] = createSignal(false);
  const [coords, setCoords] = createSignal<{ x: number; y: number } | null>(null, { equals: false });
  const [activePlacement, setActivePlacement] = createSignal<HoverInfoPlacement>(props.placement ?? "bottom");

  function show() {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      setCoords(null);
      setActivePlacement(props.placement ?? "bottom");
      setOpen(true);
    }, props.delay ?? 2000);
  }

  function hide() {
    if (timer) window.clearTimeout(timer);
    setOpen(false);
  }

  function updatePosition() {
    const trigger = triggerElement;
    const popover = popoverElement;
    if (!trigger || !popover) return;
    const triggerRect = trigger.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const boundary = trigger.closest('[role="dialog"]')?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
    const offset = 3;
    const margin = 3;
    const desired = props.placement ?? "bottom";
    const placements: HoverInfoPlacement[] = [desired, ...(["bottom", "right", "left", "top"] as HoverInfoPlacement[]).filter((next) => next !== desired)];

    function pointFor(placement: HoverInfoPlacement) {
      if (placement === "bottom") return { x: triggerRect.left + triggerRect.width / 2 - popRect.width / 2, y: triggerRect.bottom + offset };
      if (placement === "right") return { x: triggerRect.right + offset, y: triggerRect.top + triggerRect.height / 2 - popRect.height / 2 };
      if (placement === "left") return { x: triggerRect.left - popRect.width - offset, y: triggerRect.top + triggerRect.height / 2 - popRect.height / 2 };
      return { x: triggerRect.left + triggerRect.width / 2 - popRect.width / 2, y: triggerRect.top - popRect.height - offset };
    }

    function fits(point: { x: number; y: number }) {
      return (
        point.x >= boundary.left + margin
        && point.y >= boundary.top + margin
        && point.x + popRect.width <= boundary.right - margin
        && point.y + popRect.height <= boundary.bottom - margin
      );
    }

    const placement = placements.find((candidate) => fits(pointFor(candidate))) ?? "bottom";
    const point = pointFor(placement);
    setActivePlacement(placement);
    setCoords({
      x: Math.min(Math.max(point.x, boundary.left + margin), boundary.right - popRect.width - margin),
      y: Math.min(Math.max(point.y, boundary.top + margin), boundary.bottom - popRect.height - margin),
    });
  }

  createEffect(() => {
    if (!open()) return;
    queueMicrotask(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    onCleanup(() => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    });
  });

  onCleanup(() => {
    if (timer) window.clearTimeout(timer);
  });

  return (
    <>
      <span
        ref={triggerElement}
        class={styles.trigger}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {props.children}
      </span>
      <Show when={open()}>
        <Portal mount={document.body}>
          <div
            ref={popoverElement}
            class={`${styles.popover} ${styles[`placement-${activePlacement()}`]} animate-hover-reveal`}
            style={{
              top: `${coords()?.y ?? 0}px`,
              left: `${coords()?.x ?? 0}px`,
              visibility: coords() ? "visible" : "hidden",
            }}
            role="tooltip"
          >
            {props.content}
          </div>
        </Portal>
      </Show>
    </>
  );
}
