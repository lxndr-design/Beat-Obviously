import { createEffect, createSignal, Show } from "solid-js";
import styles from "./InlineNumber.module.css";

export interface InlineNumberProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}

export function InlineNumber(props: InlineNumberProps) {
  const [text, setText] = createSignal(String(props.value));

  createEffect(() => setText(String(props.value)));

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
    <label class={styles.wrap}>
      <span class={styles.label}>{props.label}</span>
      <input
        class={styles.input}
        type="text"
        inputMode="numeric"
        value={text()}
        onInput={(event) => setText(event.currentTarget.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <Show when={props.unit}>
        <span class={styles.unit}>{props.unit}</span>
      </Show>
    </label>
  );
}
