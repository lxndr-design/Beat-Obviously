import { For, Show } from "solid-js";
import styles from "../../components/RadioGroup/RadioGroup.module.css";

export interface RadioGroupOption<T extends string | number> {
  value: T;
  label: string;
}

interface RadioGroupProps<T extends string | number> {
  label?: string;
  ariaLabel: string;
  value: T;
  options: Array<RadioGroupOption<T>>;
  class?: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function RadioGroup<T extends string | number>(props: RadioGroupProps<T>) {
  return (
    <div class={[styles.wrap, props.disabled && styles.disabled, props.class, props.className].filter(Boolean).join(" ")}>
      <Show when={props.label}><span class={styles.label}>{props.label}</span></Show>
      <div class={styles.control} role="radiogroup" aria-label={props.ariaLabel}>
        <For each={props.options}>
          {(option) => {
            const selected = () => option.value === props.value;
            return (
              <button
                type="button"
                role="radio"
                aria-checked={selected()}
                disabled={props.disabled}
                class={`${styles.button} ${selected() ? styles.active : ""}`}
                onClick={() => props.onChange(option.value)}
              >
                {option.label}
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
