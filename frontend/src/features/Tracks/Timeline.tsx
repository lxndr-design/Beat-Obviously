import { useEffect, useRef, useState } from "react";
import { useProjectStore, useTransportStore, useViewStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import styles from "./Timeline.module.css";

/**
 * Timeline — ruler strip at the bottom of the lane scroll column.
 *
 * Tick marks are musical: each subtick is one beat, measures are inter-ticks,
 * and bold main ticks adapt to zoom so the ruler stays readable when dense.
 * Time labels are calculated from BPM afterward and do not create guide ticks.
 *
 * Clicking or dragging anywhere on the strip scrubs the transport
 * `positionBeat` — i.e. the timeline doubles as a scrubber.
 */
export function Timeline() {
  const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
  const ts = useProjectStore((s) => s.project.timeSignature);
  const bpm = useProjectStore((s) => s.project.bpm);
  const beatsToPx = useViewStore((s) => s.beatsToPx);
  const loopEnabled = useTransportStore((s) => s.loopEnabled);
  const loopRange = useTransportStore((s) => s.loopRange);
  const setPosition = useTransportStore((s) => s.setPosition);
  const setLoopRange = useTransportStore((s) => s.setLoopRange);
  const stripRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [loopDragging, setLoopDragging] = useState<LoopClamp | null>(null);

  useEffect(() => {
    const parent = stripRef.current?.parentElement;
    if (!parent) return;

    const update = () => setViewportWidth(parent.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const displayWidthPx = Math.max(lengthBeats * beatsToPx, viewportWidth);
  const displayBeats = Math.max(lengthBeats, Math.ceil(displayWidthPx / beatsToPx));
  const ticks: number[] = [];
  for (let b = 0; b <= displayBeats; b++) ticks.push(b);
  const totalSeconds = Math.ceil((displayBeats * 60) / bpm);
  const secondTicks = Array.from({ length: totalSeconds + 1 }, (_, seconds) => ({
    seconds,
    beat: (seconds * bpm) / 60,
  })).filter((t) => t.beat <= displayBeats);
  const secondLabelSpacingPx = (bpm / 60) * beatsToPx;
  const showSecondLabels = secondLabelSpacingPx >= MIN_SECOND_LABEL_SPACING_PX;
  const measureBeats = Math.max(1, ts.num);
  const boldMeasureStep = adaptiveBoldMeasureStep(beatsToPx, measureBeats);

  function isBold(beatIdx: number): boolean {
    if (beatIdx % measureBeats !== 0) return false;
    const measureIndex = beatIdx / measureBeats;
    return measureIndex % boldMeasureStep === 0;
  }

  function beatAt(clientX: number): number {
    const r = stripRef.current?.getBoundingClientRect();
    if (!r) return 0;
    const beat = (clientX - r.left) / beatsToPx;
    return Math.max(0, Math.min(lengthBeats, beat));
  }

  function commit(clientX: number) {
    const b = beatAt(clientX);
    setPosition(b);
    void send({ kind: "transport.seek", positionBeat: b });
  }

  function commitLoopClamp(clamp: LoopClamp, clientX: number) {
    const beat = beatAt(clientX);
    const next = clamp === "start"
      ? { startBeat: Math.min(beat, loopRange.endBeat), endBeat: loopRange.endBeat }
      : { startBeat: loopRange.startBeat, endBeat: Math.max(beat, loopRange.startBeat) };
    setLoopRange(next);
    if (loopEnabled) {
      void send({ kind: "transport.setLoop", range: next.endBeat > next.startBeat ? next : null });
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(true);
    commit(e.clientX);
  }

  function onLoopHandlePointerDown(clamp: LoopClamp, e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    setLoopDragging(clamp);
    commitLoopClamp(clamp, e.clientX);
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      commit(e.clientX);
    }
    function onUp() {
      setDragging(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, beatsToPx, lengthBeats]);

  useEffect(() => {
    if (!loopDragging) return;
    const activeClamp = loopDragging;
    function onMove(e: PointerEvent) {
      commitLoopClamp(activeClamp, e.clientX);
    }
    function onUp() {
      setLoopDragging(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopDragging, beatsToPx, lengthBeats, loopRange, loopEnabled]);

  const loopStartPx = loopRange.startBeat * beatsToPx;
  const loopEndPx = loopRange.endBeat * beatsToPx;
  const showLoopRegion = loopRange.endBeat > loopRange.startBeat;

  return (
    <div
      ref={stripRef}
      className={styles.timeline}
      data-timeline-ruler
      style={{ width: displayWidthPx }}
      onPointerDown={onPointerDown}
    >
      {ticks.map((b) => {
        const major = b % measureBeats === 0;
        const bold = isBold(b);
        return (
          <div
            key={b}
            className={`${styles.tick} ${major ? styles.major : ""} ${bold ? styles.bold : ""}`}
            style={{ left: b * beatsToPx }}
          >
            {bold && !showSecondLabels && (
              <span className={styles.label}>{formatTime(b, bpm)}</span>
            )}
          </div>
        );
      })}
      {secondTicks.map(({ seconds, beat }) => (
        <div
          key={`second-${seconds}`}
          className={styles.timeLabelTick}
          style={{ left: beat * beatsToPx }}
        >
          {showSecondLabels && (
            <span className={styles.label}>{formatSeconds(seconds)}</span>
          )}
        </div>
      ))}
      {showLoopRegion && (
        <div
          className={`${styles.loopRegion} ${loopEnabled ? styles.loopRegionEnabled : ""}`}
          style={{ left: loopStartPx, width: loopEndPx - loopStartPx }}
          aria-hidden
        />
      )}
      <button
        type="button"
        className={`${styles.loopClamp} ${styles.loopClampStart} ${loopEnabled || loopDragging === "start" ? styles.loopClampActive : ""}`}
        style={{ left: loopStartPx }}
        onPointerDown={(e) => onLoopHandlePointerDown("start", e)}
        aria-label="Drag loop start"
      />
      <button
        type="button"
        className={`${styles.loopClamp} ${styles.loopClampEnd} ${loopEnabled || loopDragging === "end" ? styles.loopClampActive : ""}`}
        style={{ left: loopEndPx }}
        onPointerDown={(e) => onLoopHandlePointerDown("end", e)}
        aria-label="Drag loop end"
      />
    </div>
  );
}

type LoopClamp = "start" | "end";

function formatTime(beat: number, bpm: number): string {
  const seconds = (beat * 60) / bpm;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const MIN_SECOND_LABEL_SPACING_PX = 36;
const MIN_BOLD_TICK_SPACING_PX = 72;

function adaptiveBoldMeasureStep(beatsToPx: number, measureBeats: number): number {
  const measurePx = Math.max(1, beatsToPx * measureBeats);
  let step = 1;
  while (measurePx * step < MIN_BOLD_TICK_SPACING_PX) step *= 2;
  return step;
}
