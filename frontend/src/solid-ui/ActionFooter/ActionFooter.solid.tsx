import { splitProps, type JSX } from "solid-js";
import styles from "./ActionFooter.module.css";

export interface ActionFooterProps extends JSX.HTMLAttributes<HTMLElement> {
  align?: "start" | "end";
  className?: string;
}

export function ActionFooter(allProps: ActionFooterProps) {
  const [local, props] = splitProps(allProps, ["align", "class", "className", "children"]);
  const cls = () => [
    styles.footer,
    local.align === "start" && styles.start,
    local.class,
    local.className,
  ].filter(Boolean).join(" ");

  return (
    <footer class={cls()} {...props}>
      {local.children}
    </footer>
  );
}
