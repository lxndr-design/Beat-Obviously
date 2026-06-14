import type { ComponentProps } from "react";
import styles from "./Tag.module.css";

export type TagProps = ComponentProps<"span">;

export function Tag({ className, children, ...props }: TagProps) {
  return (
    <span className={[styles.tag, className].filter(Boolean).join(" ")} {...props}>
      {children}
    </span>
  );
}
