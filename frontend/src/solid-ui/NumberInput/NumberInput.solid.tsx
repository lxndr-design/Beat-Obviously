import { createEffect, createSignal, Show } from "solid-js";
import styles from "./NumberInput.module.css";

export interface NumberInputProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  layout?: "stacked" | "inline" | "editor" | "bare";
  ariaLabel?: string;
  className?: string;
  inputClassName?: string;
  commitOnChange?: boolean;
  maxLength?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}

export function NumberInput(props: NumberInputProps) {
  const [text, setText] = createSignal(String(props.value));
  const [editing, setEditing] = createSignal(false);

  createEffect(() => {
    if (editing()) return;
    setText(String(props.value));
  });

  function commit(raw: string) {
    if (props.disabled) return;
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) {
      setText(String(props.value));
      return;
    }
    const clamped = Math.max(props.min ?? -Infinity, Math.min(props.max ?? Infinity, parsed));
    props.onChange(clamped);
    setText(String(clamped));
  }

  function updateText(raw: string) {
    if (props.disabled) return;
    setText(raw);
    if (!props.commitOnChange) return;
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) return;
    props.onChange(Math.max(props.min ?? -Infinity, Math.min(props.max ?? Infinity, parsed)));
  }

  function onKeyDown(event: KeyboardEvent) {
    if (props.disabled) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      commit(String(props.value + (event.shiftKey ? (props.step ?? 1) * 10 : props.step ?? 1)));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      commit(String(props.value - (event.shiftKey ? (props.step ?? 1) * 10 : props.step ?? 1)));
    } else if (event.key === "Enter") {
      (event.target as HTMLInputElement).blur();
    }
  }

  return (
    <label
      class={[
        styles.wrap,
        props.layout === "inline" && styles.inline,
        props.layout === "editor" && styles.editor,
        props.layout === "bare" && styles.bare,
        props.className,
      ].filter(Boolean).join(" ")}
    >
      <Show when={props.label}>
        <span class={styles.label}>{props.label}</span>
      </Show>
      <span class={styles.fieldFrame}>
        <input
          class={[styles.input, props.inputClassName].filter(Boolean).join(" ")}
          type="text"
          inputMode="decimal"
          aria-label={props.ariaLabel ?? props.label}
          maxLength={props.maxLength}
          disabled={props.disabled}
          value={text()}
          onInput={(event) => updateText(event.currentTarget.value)}
          onFocus={() => setEditing(true)}
          onBlur={(event) => {
            setEditing(false);
            commit(event.currentTarget.value);
          }}
          onKeyDown={onKeyDown}
        />
        <Show when={props.unit}>
          <span class={styles.unit}>{props.unit}</span>
        </Show>
      </span>
    </label>
  );
}
