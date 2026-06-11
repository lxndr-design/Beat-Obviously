import { type HTMLAttributes, type ReactNode } from "react";
import styles from "./ActionFooter.module.css";

interface ActionFooterProps extends HTMLAttributes<HTMLElement> {
  align?: "start" | "end";
  children: ReactNode;
}

export function ActionFooter({ align = "end", className, children, ...rest }: ActionFooterProps) {
  const cls = [styles.footer, align === "start" && styles.start, className].filter(Boolean).join(" ");
  return (
    <footer className={cls} {...rest}>
      {children}
    </footer>
  );
}
