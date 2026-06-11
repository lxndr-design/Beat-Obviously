import {
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./HoverInfo.module.css";

type HoverInfoPlacement = "top" | "bottom" | "left" | "right";

export interface HoverInfoProps {
  /** Element to attach hover-info to. Must accept onMouseEnter/onMouseLeave. */
  children: ReactElement;
  /** Content rendered inside the popover. */
  content: ReactNode;
  /** Delay before reveal in ms. Default 2000ms — slow reveal. */
  delay?: number;
  /** Placement relative to the trigger. */
  placement?: HoverInfoPlacement;
}

/**
 * HoverInfo — delayed info popover.
 *
 * After it opens, we measure the popover bounds and clamp the position so
 * it never bleeds off the viewport edges. An 8px margin from each edge
 * keeps the popover comfortably inside.
 */
export function HoverInfo({
  children,
  content,
  delay = 2000,
  placement = "bottom",
}: HoverInfoProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const [activePlacement, setActivePlacement] = useState(placement);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const pop = popoverRef.current;
    if (!trigger || !pop) return;

    const triggerRect = trigger.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const boundary = trigger.closest('[role="dialog"]')?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
    const offset = 3;
    const margin = 3;
    const fallbackOrder: HoverInfoPlacement[] = ["bottom", "right", "left", "top"];
    const placements = [
      placement,
      ...fallbackOrder.filter((nextPlacement) => nextPlacement !== placement),
    ];

    function pointFor(nextPlacement: HoverInfoPlacement) {
      if (nextPlacement === "bottom") {
        return {
          x: triggerRect.left + triggerRect.width / 2 - popRect.width / 2,
          y: triggerRect.bottom + offset,
        };
      }
      if (nextPlacement === "right") {
        return {
          x: triggerRect.right + offset,
          y: triggerRect.top + triggerRect.height / 2 - popRect.height / 2,
        };
      }
      if (nextPlacement === "left") {
        return {
          x: triggerRect.left - popRect.width - offset,
          y: triggerRect.top + triggerRect.height / 2 - popRect.height / 2,
        };
      }
      return {
        x: triggerRect.left + triggerRect.width / 2 - popRect.width / 2,
        y: triggerRect.top - popRect.height - offset,
      };
    }

    function fits(point: { x: number; y: number }) {
      return (
        point.x >= boundary.left + margin &&
        point.y >= boundary.top + margin &&
        point.x + popRect.width <= boundary.right - margin &&
        point.y + popRect.height <= boundary.bottom - margin
      );
    }

    const selectedPlacement =
      placements.find((nextPlacement) => fits(pointFor(nextPlacement))) ?? "bottom";
    const selectedPoint = pointFor(selectedPlacement);
    const nextCoords = {
      x: Math.min(
        Math.max(selectedPoint.x, boundary.left + margin),
        boundary.right - popRect.width - margin,
      ),
      y: Math.min(
        Math.max(selectedPoint.y, boundary.top + margin),
        boundary.bottom - popRect.height - margin,
      ),
    };

    setActivePlacement(selectedPlacement);
    setCoords(nextCoords);
  }, [placement]);

  function show() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setCoords(null);
      setActivePlacement(placement);
      setOpen(true);
    }, delay);
  }
  function hide() {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  }

  // Position after render so we can measure the real tooltip size.
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, content, updatePosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  if (!isValidElement(children)) return children;

  return (
    <>
      <span
        ref={triggerRef}
        className={styles.trigger}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className={`${styles.popover} ${styles[`placement-${activePlacement}`]} animate-hover-reveal`}
            style={{
              top: coords?.y ?? 0,
              left: coords?.x ?? 0,
              visibility: coords ? "visible" : "hidden",
            }}
            role="tooltip"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
