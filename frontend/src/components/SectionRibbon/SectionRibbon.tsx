import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { Button } from "../Button";
import { Icon } from "../Icon";
import styles from "./SectionRibbon.module.css";

interface SectionRibbonProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  count?: number;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
}

export function SectionRibbon({
  title,
  expanded,
  onToggle,
  actions,
  count,
  onContextMenu,
}: SectionRibbonProps) {
  return (
    <div className={styles.ribbon} onContextMenu={onContextMenu}>
      <Button
        iconOnly
        size="xs"
        className={styles.toggle}
        onClick={onToggle}
        aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
      >
        <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} size={16} decorative />
      </Button>
      <span className={styles.label}>{title}</span>
      <span className={styles.right}>
        {typeof count === "number" && <span className={styles.count}>{count}</span>}
        {actions && <span className={styles.actions}>{actions}</span>}
      </span>
    </div>
  );
}

export const SectionRibbonActionButton = forwardRef<
  HTMLButtonElement,
  Omit<ComponentProps<typeof Button>, "iconOnly" | "size">
>(function SectionRibbonActionButton({ children, className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      iconOnly
      size="xs"
      className={[styles.actionButton, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </Button>
  );
});
