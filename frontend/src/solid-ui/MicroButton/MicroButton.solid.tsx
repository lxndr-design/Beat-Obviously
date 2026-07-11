import { splitProps, type JSX } from "solid-js";
import styles from "./MicroButton.module.css";

export interface MicroButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  className?: string;
}

export function MicroButton(allProps: MicroButtonProps) {
  const [local, props] = splitProps(allProps, ["active", "class", "className", "type", "children"]);
  return (
    <button
      type={local.type ?? "button"}
      class={[styles.button, local.active && styles.active, local.class, local.className].filter(Boolean).join(" ")}
      aria-pressed={local.active}
      {...props}
    >
      {local.children}
    </button>
  );
}
