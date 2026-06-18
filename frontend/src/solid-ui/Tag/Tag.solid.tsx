import { splitProps, type JSX } from "solid-js";
import styles from "./Tag.module.css";

export type TagProps = JSX.HTMLAttributes<HTMLSpanElement> & { className?: string; tone?: "default" | "zero" };

export function Tag(allProps: TagProps) {
  const [local, props] = splitProps(allProps, ["class", "className", "tone"]);
  return (
    <span class={[styles.tag, local.tone === "zero" && styles.zero, local.class, local.className].filter(Boolean).join(" ")} {...props} />
  );
}
