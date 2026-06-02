import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useContextMenu } from "../ContextMenu";
import { Icon } from "../Icon";
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
  /** Baseline value for subtle changed-state glow/arc. Defaults to 0 for bipolar, otherwise min. */
  defaultValue?: number;
  /** Sensitivity in pixels per full sweep — defaults to 200. */
  sensitivity?: number;
  /** Optional compact indicator for active modulation routed to this control. */
  modulationAmount?: number;
  modulationLabel?: string;
  pickTargetId?: string;
  pickSourceId?: string;
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
  defaultValue,
  sensitivity = 200,
  modulationAmount = 0,
  modulationLabel,
  pickTargetId,
  pickSourceId,
  onChange,
  onDragStart,
  onDragEnd,
}: KnobProps) {
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const startY = useRef(0);
  const startValue = useRef(value);

  const normalized = normalizeValue(value, min, max);
  const angle = -135 + normalized * 270;
  const baseline = clamp(defaultValue ?? (bipolar ? 0 : min), min, max);
  const baselineNormalized = normalizeValue(baseline, min, max);
  const baselineAngle = -135 + baselineNormalized * 270;
  const shifted = Math.abs(value - baseline) > Math.max(0.0001, step / 2);
  const hasModulation = Math.abs(modulationAmount) > 0.0001 || Boolean(modulationLabel);
  const modulationText = modulationLabel || formatSignedPercent(modulationAmount);
  const defaultArcRadius = 47;
  const arcSegments = shifted ? describeArcSegments(0, 0, defaultArcRadius, baselineAngle, angle) : [];
  const resetLabel = `${formatValue(baseline)}${unit ? ` ${unit}` : ""}`;
  const { onContextMenu, menu } = useContextMenu(() => [
    {
      label: "Reset",
      icon: "ph:arrow-counter-clockwise",
      hint: resetLabel,
      disabled: !shifted,
      onSelect: () => onChange(baseline),
    },
  ]);

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
    <div
      className={`${styles.knob} ${styles[`size-${size}`]} ${shifted ? styles.shifted : ""} ${className ?? ""}`}
      onContextMenu={onContextMenu}
      data-synth-target-id={pickTargetId}
      data-synth-source-id={pickSourceId}
    >
      {hasModulation && (
        <div className={styles.modulation} aria-label={`${label ?? "Value"} modulation ${modulationText}`}>
          <Icon name="ph:plug" size={12} decorative />
          <span className={styles.modulationLabel}>{modulationText}</span>
        </div>
      )}
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
          <circle className={styles.ring} cx="0" cy="0" r="44" />
          {arcSegments.map((segment, index) => (
            <path
              key={index}
              className={styles.defaultArcSegment}
              d={segment.path}
              style={{ opacity: segment.opacity }}
            />
          ))}
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
      {menu}
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
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
  const gapDegrees = 0;
  const segments: Array<{ path: string; opacity: number }> = [];

  for (let i = 0; i < count; i++) {
    const a0 = startAngle + (delta * i) / count;
    const a1 = startAngle + (delta * (i + 1)) / count;
    const direction = Math.sign(delta) || 1;
    const segmentStart = a0 + gapDegrees * 0.5 * direction;
    const segmentEnd = a1 - gapDegrees * 0.5 * direction;
    const progress = count === 1 ? 1 : i / (count - 1);
    segments.push({
      path: describeArc(cx, cy, r, segmentStart, segmentEnd),
      opacity: 0.08 + progress * 0.92,
    });
  }

  return segments;
}

function pointOnArc(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  const radians = angle * Math.PI / 180;
  return {
    x: cx + Math.sin(radians) * r,
    y: cy - Math.cos(radians) * r,
  };
}

function defaultFormatValue(v: number): string {
  // Cap decimal precision at two places without limiting total digits.
  return v.toFixed(2);
}

function formatSignedPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${Math.round(value * 100)}`;
}
