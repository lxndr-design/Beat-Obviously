import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Icon } from "../Icon";
import styles from "../../components/Knob/Knob.module.css";

export interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
  unit?: string;
  formatValue?: (value: number) => string;
  parseValue?: (raw: string) => number;
  className?: string;
  size?: "sm" | "md" | "lg";
  bipolar?: boolean;
  defaultValue?: number;
  sensitivity?: number;
  modulationAmount?: number;
  modulationLabel?: string;
  pickTargetId?: string;
  pickSourceId?: string;
  onChange: (value: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function Knob(allProps: KnobProps) {
  const props = allProps;
  const [dragging, setDragging] = createSignal(false);
  const [editing, setEditing] = createSignal<string | null>(null);
  let startY = 0;
  let startValue = props.value;

  const step = () => props.step ?? 0.01;
  const formatValue = () => props.formatValue ?? defaultFormatValue;
  const normalized = createMemo(() => normalizeValue(props.value, props.min, props.max));
  const angle = createMemo(() => -135 + normalized() * 270);
  const baseline = createMemo(() => clamp(props.defaultValue ?? (props.bipolar ? 0 : props.min), props.min, props.max));
  const baselineAngle = createMemo(() => -135 + normalizeValue(baseline(), props.min, props.max) * 270);
  const shifted = createMemo(() => Math.abs(props.value - baseline()) > Math.max(0.0001, step() / 2));
  const hasModulation = createMemo(() => Math.abs(props.modulationAmount ?? 0) > 0.0001 || Boolean(props.modulationLabel));
  const modulationText = createMemo(() => props.modulationLabel || formatSignedPercent(props.modulationAmount ?? 0));
  const arcSegments = createMemo(() => shifted() ? describeArcSegments(0, 0, 47, baselineAngle(), angle()) : []);
  const className = createMemo(() => [
    styles.knob,
    styles[`size-${props.size ?? "md"}`],
    shifted() && styles.shifted,
    props.className,
  ].filter(Boolean).join(" "));

  function commit(raw: string) {
    const parsed = props.parseValue ? props.parseValue(raw) : parseFloat(raw);
    if (!Number.isNaN(parsed)) props.onChange(clamp(parsed, props.min, props.max));
    setEditing(null);
  }

  function handlePointerDown(event: PointerEvent) {
    if (editing() !== null) return;
    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    startY = event.clientY;
    startValue = props.value;
    setDragging(true);
    props.onDragStart?.();
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragging()) return;
    const dy = startY - event.clientY;
    const fine = event.shiftKey ? 0.2 : 1;
    const delta = (dy / (props.sensitivity ?? 200)) * (props.max - props.min) * fine;
    let next = clamp(startValue + delta, props.min, props.max);
    if (step() > 0) next = Math.round(next / step()) * step();
    props.onChange(next);
  }

  function handlePointerUp() {
    if (!dragging()) return;
    setDragging(false);
    props.onDragEnd?.();
  }

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  onCleanup(() => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  });

  function onValueKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      commit((event.currentTarget as HTMLInputElement).value);
    } else if (event.key === "Escape") {
      setEditing(null);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const direction = event.key === "ArrowUp" ? 1 : -1;
      props.onChange(clamp(props.value + direction * (event.shiftKey ? 0.1 : step()), props.min, props.max));
    }
  }

  return (
    <div
      class={className()}
      data-synth-target-id={props.pickTargetId}
      data-synth-source-id={props.pickSourceId}
    >
      <Show when={hasModulation()}>
        <div class={styles.modulation} aria-label={`${props.label ?? "Value"} modulation ${modulationText()}`}>
          <Icon name="ph:plug" size={12} decorative />
          <span class={styles.modulationLabel}>{modulationText()}</span>
        </div>
      </Show>
      <div
        class={styles.dial}
        onPointerDown={handlePointerDown}
        role="slider"
        aria-valuemin={props.min}
        aria-valuemax={props.max}
        aria-valuenow={props.value}
        aria-label={props.label}
        tabIndex={0}
      >
        <svg viewBox="-50 -50 100 100" class={styles.svg}>
          <circle class={styles.ring} cx="0" cy="0" r="44" />
          <For each={arcSegments()}>
            {(segment) => (
              <path
                class={styles.defaultArcSegment}
                d={segment.path}
                style={{ opacity: segment.opacity }}
              />
            )}
          </For>
          <Show when={props.bipolar}>
            <line x1="0" y1="-44" x2="0" y2="-36" stroke="var(--color-fg)" stroke-width="2" />
          </Show>
          <g transform={`rotate(${angle()})`}>
            <line x1="0" y1="-10" x2="0" y2="-40" stroke="var(--color-fg)" stroke-width="3" stroke-linecap="square" />
          </g>
        </svg>
      </div>

      <Show
        when={editing() !== null}
        fallback={
          <button
            type="button"
            class={styles.value}
            onClick={() => setEditing(formatValue()(props.value))}
            aria-label={`Edit ${props.label ?? "value"}`}
          >
            {formatValue()(props.value)}
            {props.unit ? ` ${props.unit}` : ""}
          </button>
        }
      >
        <input
          autofocus
          class={styles.editValue}
          value={editing() ?? ""}
          onBlur={(event) => commit(event.currentTarget.value)}
          onKeyDown={onValueKeyDown}
        />
      </Show>

      <Show when={props.label}>
        <div class={styles.label}>{props.label}</div>
      </Show>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeValue(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = pointOnArc(cx, cy, r, startAngle);
  const end = pointOnArc(cx, cy, r, endAngle);
  const delta = Math.abs(endAngle - startAngle);
  const largeArc = delta > 180 ? 1 : 0;
  const sweep = endAngle >= startAngle ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} ${sweep} ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

function describeArcSegments(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const delta = endAngle - startAngle;
  const count = Math.max(8, Math.min(42, Math.ceil(Math.abs(delta) / 4)));
  return Array.from({ length: count }, (_, index) => {
    const a0 = startAngle + (delta * index) / count;
    const a1 = startAngle + (delta * (index + 1)) / count;
    const progress = count === 1 ? 1 : index / (count - 1);
    return {
      path: describeArc(cx, cy, r, a0, a1),
      opacity: 0.08 + progress * 0.92,
    };
  });
}

function pointOnArc(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  const radians = angle * Math.PI / 180;
  return {
    x: cx + Math.sin(radians) * r,
    y: cy - Math.cos(radians) * r,
  };
}

function defaultFormatValue(value: number): string {
  return value.toFixed(2);
}

function formatSignedPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${Math.round(value * 100)}`;
}
