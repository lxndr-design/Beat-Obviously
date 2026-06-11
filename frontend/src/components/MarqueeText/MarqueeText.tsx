import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./MarqueeText.module.css";

interface MarqueeTextProps {
  text: string;
  className?: string;
  title?: string;
}

export function MarqueeText({ text, className, title }: MarqueeTextProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [metrics, setMetrics] = useState({ overflow: false, offset: 0, duration: 1.4 });

  useEffect(() => {
    const root = rootRef.current;
    const inner = innerRef.current;
    if (!root || !inner) return undefined;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const offset = Math.ceil(inner.scrollWidth - root.clientWidth);
        setMetrics({
          overflow: offset > 1,
          offset: Math.max(0, offset),
          duration: Math.max(1.2, Math.min(8, offset / 34)),
        });
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(inner);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [text]);

  return (
    <span
      ref={rootRef}
      className={`${styles.root} ${className ?? ""}`}
      data-overflow={metrics.overflow ? "true" : "false"}
      style={{
        "--marquee-offset": `${-metrics.offset}px`,
        "--marquee-duration": `${metrics.duration}s`,
      } as CSSProperties}
      title={title ?? text}
    >
      <span ref={innerRef} className={styles.inner}>
        {text}
      </span>
    </span>
  );
}
