import { Show, splitProps, type JSX } from "solid-js";
import styles from "./TextInput.module.css";

export interface TextInputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  layout?: "stacked" | "inline" | "bare";
  unit?: string;
  className?: string;
}

export function TextInput(allProps: TextInputProps) {
  const [local, props] = splitProps(allProps, ["label", "layout", "unit", "class", "className", "type"]);
  const cls = () => [
    styles.wrap,
    (local.layout ?? "stacked") === "inline" && styles.inline,
    (local.layout ?? "stacked") === "bare" && styles.bare,
    local.class,
    local.className,
  ].filter(Boolean).join(" ");

  return (
    <label class={cls()}>
      <Show when={local.label}>
        <span class={styles.label}>{local.label}</span>
      </Show>
      <span class={styles.fieldFrame}>
        <input class={styles.input} type={local.type ?? "text"} {...props} />
        <Show when={local.unit}>
          <span class={styles.unit}>{local.unit}</span>
        </Show>
      </span>
    </label>
  );
}
