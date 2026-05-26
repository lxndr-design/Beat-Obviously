import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./VerticalSlider.module.css";

export interface VerticalSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  bipolar?: boolean;
  onChange: (v: number) => void;
}

/**
 * VerticalSlider — drag a thumb vertically along a 1px white track.
 * Bipolar mode draws a center tick at the 0 position.
 * Click on the track jumps the value to that position.
 */
export function VerticalSlider({
  value,
  min,
  max,
  step = 0.1,
  bipolar = false,
  onChange,
}: VerticalSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFromClient = useCallback(
    (clientY: number) => {
      const el = trackRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Top of track = max, bottom = min
      const ratio = 1 - Math.max(0, Math.min(1, (clientY - r.top) / r.height));
      let v = min + ratio * (max - min);
      if (step > 0) v = Math.round(v / step) * step;
      onChange(Math.max(min, Math.min(max, v)));
    },
    [min, max, step, onChange],
  );

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(true);
    handleFromClient(e.clientY);
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) { handleFromClient(e.clientY); }
    function onUp() { setDragging(false); }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, handleFromClient]);

  // Position of the thumb (0 at min, 1 at max).
  const ratio = (value - min) / (max - min);
  // 0% from top = max value; we use bottom positioning so the thumb sits at
  // (ratio * 100)% from the bottom.
  const thumbPct = ratio * 100;
  const zeroPct = bipolar ? ((-min) / (max - min)) * 100 : null;

  return (
    <div
      ref={trackRef}
      className={styles.track}
      onPointerDown={onPointerDown}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div className={styles.rail} />
      {zeroPct !== null && (
        <div className={styles.zero} style={{ bottom: `${zeroPct}%` }} />
      )}
      <div
        className={styles.thumb}
        style={{ bottom: `${thumbPct}%` }}
      />
    </div>
  );
}
