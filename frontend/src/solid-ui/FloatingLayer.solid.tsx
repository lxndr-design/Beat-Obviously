import type { JSX } from "solid-js";
import styles from "../components/FloatingLayer/FloatingLayer.module.css";

export interface FloatingLayerProps {
  x: number;
  y: number;
  width?: number;
  style?: JSX.CSSProperties;
  class?: string;
  className?: string;
  role?: JSX.HTMLAttributes<HTMLDivElement>["role"];
  children: JSX.Element;
  ref?: (element: HTMLDivElement) => void;
}

export function FloatingLayer(props: FloatingLayerProps) {
  return (
    <div
      ref={props.ref}
      class={`${styles.layer} ${props.class ?? props.className ?? ""}`}
      style={{
        "--floating-layer-x": `${props.x}px`,
        "--floating-layer-y": `${props.y}px`,
        "--floating-layer-width": props.width ? `${props.width}px` : undefined,
        ...props.style,
      } as JSX.CSSProperties}
      role={props.role}
      data-floating-layer
    >
      {props.children}
    </div>
  );
}
