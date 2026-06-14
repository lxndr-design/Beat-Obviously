import type { HTMLAttributes, ReactNode } from "react";
import { MarqueeText } from "../MarqueeText";
import styles from "./RowItem.module.css";

type RowItemDensity = "compact" | "standard" | "media";

export interface RowItemProps extends HTMLAttributes<HTMLLIElement> {
  density?: RowItemDensity;
  reserveDragSlot?: boolean;
  dragSlot?: ReactNode;
  icon?: ReactNode;
  hoverIcon?: ReactNode;
  iconAriaHidden?: boolean;
  name: string;
  meta?: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  cursor?: "pointer" | "grab" | "default";
}

export function RowItem({
  density = "standard",
  reserveDragSlot = true,
  dragSlot,
  icon,
  hoverIcon,
  iconAriaHidden = true,
  name,
  meta,
  detail,
  action,
  cursor = "pointer",
  className,
  children,
  ...props
}: RowItemProps) {
  const cls = [
    styles.row,
    styles[`density-${density}`],
    styles[`cursor-${cursor}`],
    !reserveDragSlot && styles.noDragSlot,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={cls} {...props}>
      {reserveDragSlot && (
        <span className={styles.dragSlot} aria-hidden>
          {dragSlot}
        </span>
      )}
      <span className={`${styles.iconSlot} ${hoverIcon ? styles.iconSwapSlot : ""}`} aria-hidden={iconAriaHidden}>
        {hoverIcon ? (
          <>
            <span className={styles.iconDefault}>{icon}</span>
            <span className={styles.iconHover}>{hoverIcon}</span>
          </>
        ) : icon}
      </span>
      <span className={styles.text}>
        <MarqueeText className={styles.name} text={name} />
        {meta && <span className={styles.meta}>{meta}</span>}
        {detail && <span className={styles.detail}>{detail}</span>}
        {children}
      </span>
      {action && <span className={styles.action}>{action}</span>}
    </li>
  );
}
