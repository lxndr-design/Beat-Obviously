import { useEffect, useId, useRef, useState } from "react";
import { EQ_BAND_CENTERS_HZ } from "../../state/types";
import styles from "./EqGraph.module.css";

export interface EqGraphProps {
  /** Current band dB values, indexed to match EQ_BAND_CENTERS_HZ. */
  bandsDb: number[];
  onChange: (idx: number, db: number) => void;
}

const MIN_DB = -24;
const MAX_DB = 24;
const MIN_HZ = 80;        // first band sits at the left edge — no left gap
const MAX_HZ = 22000;
const TOP_PAD = 8;
const BOTTOM_PAD = 16;
const LEFT_PAD = 8;       // small breathing room so the leftmost dot isn't clipped
const RIGHT_PAD = 8;

/**
 * EqGraph — 7-band graphic EQ rendered as an interactive graph.
 *
 *   - X axis: logarithmic frequency, anchored at 80 Hz (no left gap).
 *   - Y axis: linear dB centered on 0.
 *   - Curve: smooth Catmull-Rom path through the dots.
 *   - Fill: vertical gradient between the curve and the 0 dB baseline
 *           (50% white opacity at the curve, fading to 0% at the baseline).
 *   - Dots: outline-only by default; filled while hovered or dragged.
 *   - Frequency labels: micro mono text under the X axis.
 *
 * No add/remove — only the seven fixed bands.
 */
export function EqGraph({ bandsDb, onChange }: EqGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 600, h: 100 });
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const gradientId = useId();

  useEffect(() => {
    if (!svgRef.current) return;
    const el = svgRef.current.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  const innerW = Math.max(1, size.w - LEFT_PAD - RIGHT_PAD);
  const innerH = Math.max(1, size.h - TOP_PAD - BOTTOM_PAD);

  function xFor(hz: number): number {
    const lmin = Math.log(MIN_HZ);
    const lmax = Math.log(MAX_HZ);
    const t = (Math.log(hz) - lmin) / (lmax - lmin);
    return LEFT_PAD + t * innerW;
  }
  function yFor(db: number): number {
    const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db));
    const t = 1 - (clamped - MIN_DB) / (MAX_DB - MIN_DB);
    return TOP_PAD + t * innerH;
  }
  function dbFromY(y: number): number {
    const t = 1 - (y - TOP_PAD) / innerH;
    return MIN_DB + t * (MAX_DB - MIN_DB);
  }

  function onDotPointerDown(idx: number, e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragIdx(idx);
  }

  useEffect(() => {
    if (dragIdx === null) return;
    function onMove(e: PointerEvent) {
      const svg = svgRef.current;
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      const y = e.clientY - r.top;
      const db = Math.max(MIN_DB, Math.min(MAX_DB, dbFromY(y)));
      onChange(dragIdx as number, Math.round(db * 10) / 10);
    }
    function onUp() {
      setDragIdx(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragIdx, innerH, size]);

  const points = EQ_BAND_CENTERS_HZ.map((hz, i) => ({
    hz,
    db: bandsDb[i] ?? 0,
    x: xFor(hz),
    y: yFor(bandsDb[i] ?? 0),
  }));

  const smoothCurve = buildSmoothCurve(points);
  const filledArea = buildFilledArea(points, yFor(0));
  const zeroY = yFor(0);

  return (
    <svg
      ref={svgRef}
      className={styles.svg}
      width="100%"
      height="100%"
      viewBox={`0 0 ${size.w} ${size.h}`}
      preserveAspectRatio="none"
    >
      <defs>
        {/*
          Vertical white gradient. With a 0-centered dB axis, the baseline
          sits at 50% of the inner height. The gradient fades 50% → 0% at
          the baseline (top half) and 0% → 50% (bottom half), so the fill
          on either side of the curve always tapers toward zero.
        */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#fff" stopOpacity="0.5" />
          <stop offset="50%"  stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.5" />
        </linearGradient>
      </defs>

      {/* Filled area between curve and baseline */}
      <path d={filledArea} fill={`url(#${gradientId})`} />

      {/* Zero dB reference line */}
      <line
        x1={LEFT_PAD}
        x2={size.w - RIGHT_PAD}
        y1={zeroY}
        y2={zeroY}
        className={styles.zeroLine}
      />
      {/* Faint dB gridlines at +12 and -12 */}
      <line
        x1={LEFT_PAD}
        x2={size.w - RIGHT_PAD}
        y1={yFor(12)}
        y2={yFor(12)}
        className={styles.gridLine}
      />
      <line
        x1={LEFT_PAD}
        x2={size.w - RIGHT_PAD}
        y1={yFor(-12)}
        y2={yFor(-12)}
        className={styles.gridLine}
      />

      {/* Smooth response curve drawn on top of the fill */}
      <path d={smoothCurve} className={styles.response} />

      {points.map((p, i) => {
        const active = dragIdx === i || hoverIdx === i;
        const showReadout = active || Math.abs(p.db) >= 0.05;
        return (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={active ? 5.5 : 4}
              className={`${styles.dot} ${active ? styles.dotActive : ""}`}
              onPointerDown={(e) => onDotPointerDown(i, e)}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
            />
            <text
              x={p.x}
              y={size.h - 4}
              textAnchor="middle"
              className={styles.freqLabel}
            >
              {formatFreq(p.hz)}
            </text>
            {showReadout && (
              <text
                x={p.x}
                y={Math.max(p.y - 8, TOP_PAD + 8)}
                textAnchor="middle"
                className={styles.dbReadout}
              >
                {p.db > 0 ? "+" : ""}
                {formatDb(p.db)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Catmull-Rom → cubic-Bezier smoothing. Uniform CR with tension 0.5.
 * Returns just the "M ... C ... C ..." curve path (no fill).
 */
function buildSmoothCurve(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  d += smoothSegments(pts);
  return d;
}

/** The same smoothed curve but closed to the baseline so it can be filled. */
function buildFilledArea(
  pts: { x: number; y: number }[],
  baselineY: number,
): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  d += smoothSegments(pts);
  d += ` L ${pts[pts.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)}`;
  d += ` L ${pts[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
  return d;
}

function smoothSegments(pts: { x: number; y: number }[]): string {
  const k = 0.5;
  let out = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + ((p2.x - p0.x) / 6) * k * 2;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * k * 2;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * k * 2;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * k * 2;
    out += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return out;
}

function formatFreq(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return `${hz}`;
}

function formatDb(db: number): string {
  const rounded = Math.abs(db) >= 10 ? db.toFixed(0) : db.toFixed(1);
  return `${rounded}dB`;
}
