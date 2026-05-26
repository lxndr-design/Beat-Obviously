import { useEffect, useRef, useState } from "react";
import { useProjectStore, useTransportStore, useViewStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import styles from "./Timeline.module.css";

/**
 * Timeline — ruler strip at the bottom of the lane scroll column.
 *
 * Tick marks are musical: each subtick is one beat, and each bold tick is one
 * measure according to the time signature. Time labels are calculated from BPM
 * afterward and do not create guide ticks.
 *
 * Clicking or dragging anywhere on the strip scrubs the transport
 * `positionBeat` — i.e. the timeline doubles as a scrubber.
 */
export function Timeline() {
  const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
  const ts = useProjectStore((s) => s.project.timeSignature);
  const bpm = useProjectStore((s) => s.project.bpm);
  const beatsToPx = useViewStore((s) => s.beatsToPx);
  const setPosition = useTransportStore((s) => s.setPosition);
  const stripRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const ticks: number[] = [];
  for (let b = 0; b <= lengthBeats; b++) ticks.push(b);
  const totalSeconds = Math.ceil((lengthBeats * 60) / bpm);
  const secondTicks = Array.from({ length: totalSeconds + 1 }, (_, seconds) => ({
    seconds,
    beat: (seconds * bpm) / 60,
  })).filter((t) => t.beat <= lengthBeats);
  const secondLabelSpacingPx = (bpm / 60) * beatsToPx;
  const showSecondLabels = secondLabelSpacingPx >= MIN_SECOND_LABEL_SPACING_PX;

  function isBold(beatIdx: number): boolean {
    return beatIdx % Math.max(1, ts.num) === 0;
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

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(true);
    commit(e.clientX);
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

  return (
    <div
      ref={stripRef}
      className={styles.timeline}
      style={{ width: lengthBeats * beatsToPx }}
      onPointerDown={onPointerDown}
    >
      {ticks.map((b) => {
        const major = b % ts.num === 0;
        const bold = isBold(b);
        return (
          <div
            key={b}
            className={`${styles.tick} ${major ? styles.major : ""} ${bold ? styles.bold : ""}`}
            style={{ left: b * beatsToPx }}
          >
            {major && !showSecondLabels && (
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
    </div>
  );
}

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
