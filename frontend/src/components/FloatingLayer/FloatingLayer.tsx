import { type CSSProperties, type ReactNode } from "react";
import styles from "./FloatingLayer.module.css";

interface FloatingLayerProps {
  x: number;
  y: number;
  width?: number;
  className?: string;
  role?: string;
  children: ReactNode;
}

export function FloatingLayer({ x, y, width, className, role, children }: FloatingLayerProps) {
  return (
    <div
      className={`${styles.layer} ${className ?? ""}`}
      style={{
        "--floating-layer-x": `${x}px`,
        "--floating-layer-y": `${y}px`,
        "--floating-layer-width": width ? `${width}px` : undefined,
      } as CSSProperties}
      role={role}
      data-floating-layer
    >
      {children}
    </div>
  );
}
