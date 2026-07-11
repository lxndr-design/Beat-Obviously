import { splitProps, type JSX } from "solid-js";
import styles from "./RailButton.module.css";

export interface RailButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  className?: string;
}

export function RailButton(allProps: RailButtonProps) {
  const [local, props] = splitProps(allProps, ["selected", "class", "className", "type", "children"]);
  return (
    <button
      type={local.type ?? "button"}
      class={[styles.button, local.selected && styles.selected, local.class, local.className].filter(Boolean).join(" ")}
      aria-pressed={local.selected}
      {...props}
    >
      {local.children}
    </button>
  );
}
