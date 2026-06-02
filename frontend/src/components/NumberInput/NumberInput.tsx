import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
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

/**
 * NumberInput — a single-line numeric field with arrow-key step and clamp.
 * Visual: black bg, white text, 1px white frame (legitimate — input frame
 * counts as structure delineation).
 */
export function NumberInput({
  value,
  min = -Infinity,
  max = Infinity,
  step = 1,
  unit,
  label,
  layout = "stacked",
  commitOnChange = false,
  maxLength,
  onChange,
}: NumberInputProps) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (editing) return;
    setText(String(value));
  }, [editing, value]);

  function commit(raw: string) {
    const n = parseFloat(raw);
    if (Number.isNaN(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, n));
    onChange(clamped);
    setText(String(clamped));
  }

  function updateText(raw: string) {
    setText(raw);
    if (!commitOnChange) return;
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return;
    onChange(Math.max(min, Math.min(max, n)));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.shiftKey ? step * 10 : step;
      commit(String(value + delta));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const delta = e.shiftKey ? step * 10 : step;
      commit(String(value - delta));
    } else if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <label className={`${styles.wrap} ${layout === "inline" ? styles.inline : ""}`}>
      {label && <span className={styles.label}>{label}</span>}
      <span className={styles.fieldFrame}>
        <input
          className={styles.input}
          type="text"
          inputMode="numeric"
          maxLength={maxLength}
          value={text}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateText(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={(e) => {
            setEditing(false);
            commit(e.currentTarget.value);
          }}
          onKeyDown={onKeyDown}
        />
        {unit && <span className={styles.unit}>{unit}</span>}
      </span>
    </label>
  );
}
