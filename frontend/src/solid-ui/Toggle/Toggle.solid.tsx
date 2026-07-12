import { Show } from "solid-js";
import styles from "./Toggle.module.css";

export interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  "aria-label"?: string;
  disabled?: boolean;
  class?: string;
  className?: string;
  labelClassName?: string;
}

export function Toggle(props: ToggleProps) {
  const toggle = () => {
    if (!props.disabled) props.onChange(!props.checked);
  };

  return (
    <span class={[styles.wrap, props.class, props.className].filter(Boolean).join(" ")}>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props["aria-label"] ?? props.label}
        disabled={props.disabled}
        onClick={toggle}
        class={`${styles.box} ${props.checked ? styles.on : ""}`}
      />
      <Show when={props.label}>
        <span
          class={[styles.label, props.labelClassName].filter(Boolean).join(" ")}
          onClick={toggle}
        >
          {props.label}
        </span>
      </Show>
    </span>
  );
}
