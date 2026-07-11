import { splitProps, type JSX } from "solid-js";
import styles from "./RowActionButton.module.css";

export interface RowActionButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "standard" | "compact";
  className?: string;
}

export function RowActionButton(allProps: RowActionButtonProps) {
  const [local, props] = splitProps(allProps, ["size", "class", "className", "type", "children"]);
  const size = () => local.size ?? "standard";
  return (
    <button
      type={local.type ?? "button"}
      class={[styles.button, styles[size()], local.class, local.className].filter(Boolean).join(" ")}
      {...props}
    >
      {local.children}
    </button>
  );
}
