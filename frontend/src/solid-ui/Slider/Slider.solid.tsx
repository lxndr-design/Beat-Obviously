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
  let fieldFrameRef: HTMLSpanElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let activePointerId: number | null = null;
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
    if (Number.isFinite(parsed)) local.onChange(normalizeValue(parsed));
  }

  function normalizeValue(value: number): number {
    const step = local.step ?? 0.01;
    const stepped = step > 0
      ? Math.round((value - local.min) / step) * step + local.min
      : value;
    return clamp(Number(stepped.toFixed(8)), local.min, local.max);
  }

  function valueFromPointer(clientX: number): number | null {
    const rect = fieldFrameRef?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return normalizeValue(local.min + ratio * (local.max - local.min));
  }

  function updateFromPointer(clientX: number) {
    const next = valueFromPointer(clientX);
    if (next !== null) local.onChange(next);
  }

  function handlePointerDown(event: PointerEvent) {
    if (local.disabled) return;
    const target = event.currentTarget as HTMLSpanElement | null;
    activePointerId = event.pointerId;
    target?.setPointerCapture?.(event.pointerId);
    inputRef?.focus({ preventScroll: true });
    event.preventDefault();
    updateFromPointer(event.clientX);
  }

  function handlePointerMove(event: PointerEvent) {
    if (local.disabled || activePointerId !== event.pointerId) return;
    event.preventDefault();
    updateFromPointer(event.clientX);
  }

  function endPointerDrag(event: PointerEvent) {
    if (activePointerId !== event.pointerId) return;
    const target = event.currentTarget as HTMLSpanElement | null;
    activePointerId = null;
    target?.releasePointerCapture?.(event.pointerId);
  }

  return (
    <label class={cls()}>
      <Show when={local.label}>
        <span class={`${styles.label} ds-field-label`}>{local.label}</span>
      </Show>
      <span
        ref={fieldFrameRef}
        class={styles.fieldFrame}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointerDrag}
        onPointerCancel={endPointerDrag}
        onLostPointerCapture={() => { activePointerId = null; }}
      >
        <input
          ref={inputRef}
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
