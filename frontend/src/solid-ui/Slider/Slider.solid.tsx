import { Show, splitProps, type JSX } from "solid-js";
import styles from "./Slider.module.css";

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
  layout?: "stacked" | "inline" | "bare";
  disabled?: boolean;
  id?: string;
  name?: string;
  ariaLabel?: string;
  class?: string;
  className?: string;
  inputClassName?: string;
  readoutClassName?: string;
  readout?: JSX.Element;
  onChange: (value: number) => void;
}

export function Slider(allProps: SliderProps) {
  const [local] = splitProps(allProps, [
    "value",
    "min",
    "max",
    "step",
    "label",
    "layout",
    "disabled",
    "id",
    "name",
    "ariaLabel",
    "class",
    "className",
    "inputClassName",
    "readoutClassName",
    "readout",
    "onChange",
  ]);
  const layout = () => local.layout ?? "stacked";
  const cls = () => [
    styles.wrap,
    layout() === "inline" && styles.inline,
    layout() === "bare" && styles.bare,
    local.class,
    local.className,
  ].filter(Boolean).join(" ");

  function commit(raw: string) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) local.onChange(clamp(parsed, local.min, local.max));
  }

  return (
    <label class={cls()}>
      <Show when={local.label}>
        <span class={`${styles.label} ds-field-label`}>{local.label}</span>
      </Show>
      <span class={styles.fieldFrame}>
        <input
          id={local.id}
          name={local.name}
          class={[styles.input, "ds-range", local.inputClassName].filter(Boolean).join(" ")}
          type="range"
          min={local.min}
          max={local.max}
          step={local.step ?? 0.01}
          value={local.value}
          disabled={local.disabled}
          aria-label={local.ariaLabel ?? local.label}
          onInput={(event) => commit(event.currentTarget.value)}
        />
      </span>
      <Show when={local.readout}>
        <span class={[styles.readout, local.readoutClassName].filter(Boolean).join(" ")} data-slider-readout>
          {local.readout}
        </span>
      </Show>
    </label>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
