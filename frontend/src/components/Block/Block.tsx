import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Block.module.css";

interface BlockProps extends HTMLAttributes<HTMLDivElement> {
  /** Render an outlined frame around the block (delineates grid structure). */
  framed?: boolean;
  /** Section title, rendered as a small uppercase label in the top stripe. */
  title?: string;
  /** Optional right-side actions (buttons, icons) in the header stripe. */
  actions?: ReactNode;
  /** Padding scale; defaults to none (caller composes inside). */
  padding?: "none" | "sm" | "md" | "lg";
  /** Pin block to fill parent. */
  fill?: boolean;
}

/**
 * Block — a section container.
 *
 * The fundamental layout unit. Pages are grids of Blocks. A Block has an
 * optional 1px outline to enforce visual structure, an optional header
 * stripe (uppercase label + right-aligned actions), and a content area.
 */
export function Block({
  framed = true,
  title,
  actions,
  padding = "none",
  fill = false,
  className,
  children,
  ...rest
}: BlockProps) {
  const cls = [
    styles.block,
    framed && styles.framed,
    fill && styles.fill,
    styles[`pad-${padding}`],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={cls} {...rest}>
      {(title || actions) && (
        <header className={styles.header}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
