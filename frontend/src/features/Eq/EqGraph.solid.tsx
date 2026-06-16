/** @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, onCleanup } from "solid-js";
import { EQ_BAND_CENTERS_HZ } from "../../state/types";
import styles from "./EqGraph.module.css";

export interface EqGraphSolidProps {
  bandsDb: number[];
  onChange: (idx: number, db: number) => void;
}

const MIN_DB = -24;
const MAX_DB = 24;
const MIN_HZ = 80;
const MAX_HZ = 22000;
const TOP_PAD = 8;
const BOTTOM_PAD = 16;
const LEFT_PAD = 8;
const RIGHT_PAD = 8;

let nextGradientId = 1;

export function EqGraphSolid(props: EqGraphSolidProps) {
  let svgElement: SVGSVGElement | undefined;
  const gradientId = `beat-eq-gradient-${nextGradientId++}`;
  const [size, setSize] = createSignal({ w: 600, h: 100 }, { equals: false });
  const [dragIdx, setDragIdx] = createSignal<number | null>(null);
  const [hoverIdx, setHoverIdx] = createSignal<number | null>(null);

  const innerW = createMemo(() => Math.max(1, size().w - LEFT_PAD - RIGHT_PAD));
  const innerH = createMemo(() => Math.max(1, size().h - TOP_PAD - BOTTOM_PAD));

  function xFor(hz: number): number {
    const lmin = Math.log(MIN_HZ);
    const lmax = Math.log(MAX_HZ);
    const t = (Math.log(hz) - lmin) / (lmax - lmin);
    return LEFT_PAD + t * innerW();
  }

  function yFor(db: number): number {
    const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db));
    const t = 1 - (clamped - MIN_DB) / (MAX_DB - MIN_DB);
    return TOP_PAD + t * innerH();
  }

  function dbFromY(y: number): number {
    const t = 1 - (y - TOP_PAD) / innerH();
    return MIN_DB + t * (MAX_DB - MIN_DB);
  }

  function onDotPointerDown(idx: number, event: PointerEvent) {
    (event.target as Element).setPointerCapture(event.pointerId);
    setDragIdx(idx);
  }

  createEffect(() => {
    const svg = svgElement;
    const parent = svg?.parentElement;
    if (!parent) return;
    const resize = () => {
      const rect = parent.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    resize();
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    const index = dragIdx();
    if (index === null) return;
    const onMove = (event: PointerEvent) => {
      const svg = svgElement;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const db = Math.max(MIN_DB, Math.min(MAX_DB, dbFromY(y)));
      props.onChange(index, Math.round(db * 10) / 10);
    };
    const onUp = () => setDragIdx(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    onCleanup(() => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    });
  });

  const points = createMemo(() => EQ_BAND_CENTERS_HZ.map((hz, index) => ({
    hz,
    db: props.bandsDb[index] ?? 0,
    x: xFor(hz),
    y: yFor(props.bandsDb[index] ?? 0),
  })));
  const smoothCurve = createMemo(() => buildSmoothCurve(points()));
  const filledArea = createMemo(() => buildFilledArea(points(), yFor(0)));
  const zeroY = createMemo(() => yFor(0));

  return (
    <svg
      ref={svgElement}
      class={styles.svg}
      width="100%"
      height="100%"
      viewBox={`0 0 ${size().w} ${size().h}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--color-fg)" stop-opacity="0.5" />
          <stop offset="50%" stop-color="var(--color-fg)" stop-opacity="0" />
          <stop offset="100%" stop-color="var(--color-fg)" stop-opacity="0.5" />
        </linearGradient>
      </defs>

      <path d={filledArea()} fill={`url(#${gradientId})`} />
      <line x1={LEFT_PAD} x2={size().w - RIGHT_PAD} y1={zeroY()} y2={zeroY()} class={styles.zeroLine} />
      <line x1={LEFT_PAD} x2={size().w - RIGHT_PAD} y1={yFor(12)} y2={yFor(12)} class={styles.gridLine} />
      <line x1={LEFT_PAD} x2={size().w - RIGHT_PAD} y1={yFor(-12)} y2={yFor(-12)} class={styles.gridLine} />
      <path d={smoothCurve()} class={styles.response} />

      <For each={points()}>
        {(point, index) => {
          const active = () => dragIdx() === index() || hoverIdx() === index();
          const showReadout = () => active() || Math.abs(point.db) >= 0.05;
          return (
            <g>
              <circle
                cx={point.x}
                cy={point.y}
                r={active() ? 5.5 : 4}
                class={`${styles.dot} ${active() ? styles.dotActive : ""}`}
                onPointerDown={(event) => onDotPointerDown(index(), event)}
                onMouseEnter={() => setHoverIdx(index())}
                onMouseLeave={() => setHoverIdx((current) => current === index() ? null : current)}
              />
              <text x={point.x} y={size().h - 4} text-anchor="middle" class={styles.freqLabel}>
                {formatFreq(point.hz)}
              </text>
              <ShowReadout when={showReadout()}>
                <text x={point.x} y={Math.max(point.y - 8, TOP_PAD + 8)} text-anchor="middle" class={styles.dbReadout}>
                  {point.db > 0 ? "+" : ""}{formatDb(point.db)}
                </text>
              </ShowReadout>
            </g>
          );
        }}
      </For>
    </svg>
  );
}

function ShowReadout(props: { when: boolean; children: import("solid-js").JSX.Element }) {
  return props.when ? props.children : null;
}

function buildSmoothCurve(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}${smoothSegments(points)}`;
}

function buildFilledArea(points: { x: number; y: number }[], baselineY: number): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  d += smoothSegments(points);
  d += ` L ${points[points.length - 1].x.toFixed(2)} ${baselineY.toFixed(2)}`;
  d += ` L ${points[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
  return d;
}

function smoothSegments(points: { x: number; y: number }[]): string {
  const tension = 0.5;
  let out = "";
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension * 2;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension * 2;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension * 2;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension * 2;
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
