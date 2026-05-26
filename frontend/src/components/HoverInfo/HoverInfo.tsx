import {
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./HoverInfo.module.css";

export interface HoverInfoProps {
  /** Element to attach hover-info to. Must accept onMouseEnter/onMouseLeave. */
  children: ReactElement;
  /** Content rendered inside the popover. */
  content: ReactNode;
  /** Delay before reveal in ms. Default 2000ms — slow reveal. */
  delay?: number;
  /** Placement relative to the trigger. */
  placement?: "top" | "bottom" | "left" | "right";
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
  placement = "top",
}: HoverInfoProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  function placeFromTrigger() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = r.left + r.width / 2;
    let y = r.top;
    if (placement === "bottom") y = r.bottom;
    if (placement === "left") {
      x = r.left;
      y = r.top + r.height / 2;
    }
    if (placement === "right") {
      x = r.right;
      y = r.top + r.height / 2;
    }
    setCoords({ x, y });
  }

  function show() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      placeFromTrigger();
      setOpen(true);
    }, delay);
  }
  function hide() {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  }

  // Viewport clamp — after the popover renders, measure and nudge if needed.
  useLayoutEffect(() => {
    if (!open || !coords) return;
    const pop = popoverRef.current;
    if (!pop) return;
    const rect = pop.getBoundingClientRect();
    const margin = 8;
    let nx = coords.x;
    let ny = coords.y;
    if (rect.left < margin) nx += margin - rect.left;
    if (rect.right > window.innerWidth - margin)
      nx -= rect.right - (window.innerWidth - margin);
    if (rect.top < margin) ny += margin - rect.top;
    if (rect.bottom > window.innerHeight - margin)
      ny -= rect.bottom - (window.innerHeight - margin);
    if (nx !== coords.x || ny !== coords.y) {
      setCoords({ x: nx, y: ny });
    }
  }, [open, coords]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  if (!isValidElement(children)) return children;

  const child = cloneElement(children, {
    ref: triggerRef,
    onMouseEnter: (e: MouseEvent) => {
      // @ts-expect-error pass-through
      children.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: MouseEvent) => {
      // @ts-expect-error pass-through
      children.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent) => {
      // @ts-expect-error pass-through
      children.props.onFocus?.(e);
      show();
    },
    onBlur: (e: FocusEvent) => {
      // @ts-expect-error pass-through
      children.props.onBlur?.(e);
      hide();
    },
  } as Partial<typeof children.props> & { ref: typeof triggerRef });

  return (
    <>
      {child}
      {open &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            className={`${styles.popover} ${styles[`placement-${placement}`]} animate-hover-reveal`}
            style={{ top: coords.y, left: coords.x }}
            role="tooltip"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
