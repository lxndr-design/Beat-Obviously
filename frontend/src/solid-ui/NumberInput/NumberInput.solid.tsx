import { createEffect, createSignal, Show } from "solid-js";
import styles from "./NumberInput.module.css";

export interface NumberInputProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  layout?: "stacked" | "inline";
  commitOnChange?: boolean;
  maxLength?: number;
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
    setText(raw);
    if (!props.commitOnChange) return;
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) return;
    props.onChange(Math.max(props.min ?? -Infinity, Math.min(props.max ?? Infinity, parsed)));
  }

  function onKeyDown(event: KeyboardEvent) {
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
    <label class={`${styles.wrap} ${props.layout === "inline" ? styles.inline : ""}`}>
      <Show when={props.label}>
        <span class={styles.label}>{props.label}</span>
      </Show>
      <span class={styles.fieldFrame}>
        <input
          class={styles.input}
          type="text"
          inputMode="numeric"
          maxLength={props.maxLength}
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
