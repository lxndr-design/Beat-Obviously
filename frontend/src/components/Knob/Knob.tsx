import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "./Knob.module.css";

export interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Optional label rendered below the knob (uppercase). */
  label?: string;
  /** Optional unit string appended to the readout (e.g. "Hz", "dB"). */
  unit?: string;
  /** Optional formatter for the displayed/editable value. */
  formatValue?: (value: number) => string;
  /** Optional parser for values typed into the editable readout. */
  parseValue?: (raw: string) => number;
  className?: string;
  size?: "sm" | "md" | "lg";
  /** When true, knob renders centered around zero (e.g. pan, EQ gain). */
  bipolar?: boolean;
  /** Sensitivity in pixels per full sweep — defaults to 200. */
  sensitivity?: number;
  onChange: (value: number) => void;
  /** Called when the user starts dragging — useful for begin-edit undo grouping. */
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/**
 * Knob — vertical-drag rotary control with a directly-editable numeric value.
 *
 * Interaction model:
 *   - Drag the dial vertically to change. Hold Shift while dragging for fine.
 *   - Click the value text to edit directly. Enter commits, Esc cancels.
 *   - With focus on the value field: ArrowUp/Down = step, Shift+ArrowUp/Down = 0.1.
 */
export function Knob({
  value,
  min,
  max,
  step = 0.01,
  label,
  unit,
  formatValue = defaultFormatValue,
  parseValue,
  className,
  size = "md",
  bipolar = false,
  sensitivity = 200,
  onChange,
  onDragStart,
  onDragEnd,
}: KnobProps) {
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const startY = useRef(0);
  const startValue = useRef(value);

  const normalized = (value - min) / (max - min);
  const angle = -135 + normalized * 270;

  const commit = useCallback(
    (raw: string) => {
      const n = parseValue ? parseValue(raw) : parseFloat(raw);
      if (Number.isNaN(n)) {
        setEditing(null);
        return;
      }
      onChange(clamp(n, min, max));
      setEditing(null);
    },
    [onChange, min, max, parseValue],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (editing !== null) return;
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      startY.current = e.clientY;
      startValue.current = value;
      setDragging(true);
      onDragStart?.();
    },
    [value, onDragStart, editing],
  );

  useEffect(() => {
    if (!dragging) return;

    function move(e: PointerEvent) {
      const dy = startY.current - e.clientY;
      const fine = e.shiftKey ? 0.2 : 1;
      const delta = (dy / sensitivity) * (max - min) * fine;
      let next = startValue.current + delta;
      next = clamp(next, min, max);
      if (step > 0) next = Math.round(next / step) * step;
      onChange(next);
    }
    function up() {
      setDragging(false);
      onDragEnd?.();
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, min, max, step, sensitivity, onChange, onDragEnd]);

  function onValueKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      commit(e.currentTarget.value);
    } else if (e.key === "Escape") {
      setEditing(null);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? 1 : -1;
      const inc = e.shiftKey ? 0.1 : step;
      onChange(clamp(value + dir * inc, min, max));
    }
  }

  return (
    <div className={`${styles.knob} ${styles[`size-${size}`]} ${className ?? ""}`}>
      <div
        className={styles.dial}
        onPointerDown={handlePointerDown}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        tabIndex={0}
      >
        <svg viewBox="-50 -50 100 100" className={styles.svg}>
          <circle cx="0" cy="0" r="44" fill="var(--color-bg)" stroke="var(--color-fg)" strokeWidth="2" />
          {bipolar && (
            <line x1="0" y1="-44" x2="0" y2="-36" stroke="var(--color-fg)" strokeWidth="2" />
          )}
          <g transform={`rotate(${angle})`}>
            <line x1="0" y1="-10" x2="0" y2="-40" stroke="var(--color-fg)" strokeWidth="3" strokeLinecap="square" />
          </g>
        </svg>
      </div>

      {editing !== null ? (
        <input
          autoFocus
          className={styles.editValue}
          defaultValue={editing}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={onValueKeyDown}
        />
      ) : (
        <button
          type="button"
          className={styles.value}
          onClick={() => setEditing(formatValue(value))}
          aria-label={`Edit ${label ?? "value"}`}
        >
          {formatValue(value)}
          {unit ? ` ${unit}` : ""}
        </button>
      )}

      {label && <div className={styles.label}>{label}</div>}
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function defaultFormatValue(v: number): string {
  // Cap decimal precision at two places without limiting total digits.
  return v.toFixed(2);
}
