import { forwardRef, type CSSProperties, type ReactNode } from "react";
import styles from "./FloatingLayer.module.css";

interface FloatingLayerProps {
  x: number;
  y: number;
  width?: number;
  style?: CSSProperties;
  className?: string;
  role?: string;
  children: ReactNode;
}

export const FloatingLayer = forwardRef<HTMLDivElement, FloatingLayerProps>(function FloatingLayer(
  { x, y, width, style, className, role, children },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`${styles.layer} ${className ?? ""}`}
      style={{
        "--floating-layer-x": `${x}px`,
        "--floating-layer-y": `${y}px`,
        "--floating-layer-width": width ? `${width}px` : undefined,
        ...style,
      } as CSSProperties}
      role={role}
      data-floating-layer
    >
      {children}
    </div>
  );
});
