import { splitProps, type JSX } from "solid-js";
import styles from "./StatusChip.module.css";

export interface StatusChipProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  tone?: "solid" | "muted";
  className?: string;
}

export function StatusChip(allProps: StatusChipProps) {
  const [local, props] = splitProps(allProps, ["tone", "class", "className"]);
  return (
    <span
      class={[styles.chip, (local.tone ?? "solid") === "muted" && styles.muted, local.class, local.className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
