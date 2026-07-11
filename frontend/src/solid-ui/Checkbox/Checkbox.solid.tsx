import { Show, splitProps, type JSX } from "solid-js";
import styles from "./Checkbox.module.css";

export interface CheckboxProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "class"> {
  checked: boolean;
  label?: string;
  onChange?: (checked: boolean) => void;
  class?: string;
  className?: string;
  inputClassName?: string;
  labelClassName?: string;
}

export function Checkbox(allProps: CheckboxProps) {
  const [local, props] = splitProps(allProps, ["checked", "label", "onChange", "class", "className", "inputClassName", "labelClassName"]);
  return (
    <label class={[styles.wrap, local.class, local.className].filter(Boolean).join(" ")}>
      <input
        {...props}
        class={[styles.input, local.inputClassName].filter(Boolean).join(" ")}
        type="checkbox"
        checked={local.checked}
        readOnly={props.readOnly ?? !local.onChange}
        onChange={(event) => local.onChange?.(event.currentTarget.checked)}
      />
      <Show when={local.label}>
        <span class={[styles.label, local.labelClassName].filter(Boolean).join(" ")}>{local.label}</span>
      </Show>
    </label>
  );
}
