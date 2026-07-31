import { onCleanup, Show, splitProps, type JSX } from "solid-js";
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
    const rect = inputRef?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    const configuredThumbWidth = inputRef
      ? Number.parseFloat(window.getComputedStyle(inputRef).getPropertyValue("--slider-thumb-hit-width"))
      : 0;
    const thumbWidth = Number.isFinite(configuredThumbWidth)
      ? Math.min(Math.max(0, configuredThumbWidth), rect.width)
      : 0;
    const railLeft = rect.left + thumbWidth / 2;
    const railWidth = Math.max(1, rect.width - thumbWidth);
    const ratio = clamp((clientX - railLeft) / railWidth, 0, 1);
    return normalizeValue(local.min + ratio * (local.max - local.min));
  }

  function updateFromPointer(clientX: number) {
    const next = valueFromPointer(clientX);
    if (next !== null) local.onChange(next);
  }

  function removePointerListeners() {
    window.removeEventListener("pointermove", continuePointerDrag, true);
    window.removeEventListener("pointerup", endPointerDrag, true);
    window.removeEventListener("pointercancel", endPointerDrag, true);
  }

  function beginPointerDrag(event: PointerEvent) {
    if (local.disabled || event.button !== 0) return;
    activePointerId = event.pointerId;
    inputRef?.focus({ preventScroll: true });
    updateFromPointer(event.clientX);
    removePointerListeners();
    window.addEventListener("pointermove", continuePointerDrag, true);
    window.addEventListener("pointerup", endPointerDrag, true);
    window.addEventListener("pointercancel", endPointerDrag, true);
  }

  function continuePointerDrag(event: PointerEvent) {
    if (local.disabled || activePointerId !== event.pointerId) return;
    updateFromPointer(event.clientX);
  }

  function endPointerDrag(event: PointerEvent) {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    removePointerListeners();
  }

  onCleanup(removePointerListeners);

  return (
    <label class={cls()}>
      <Show when={local.label}>
        <span class={styles.label}>{local.label}</span>
      </Show>
      <span class={styles.fieldFrame}>
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
          onPointerDown={beginPointerDrag}
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
