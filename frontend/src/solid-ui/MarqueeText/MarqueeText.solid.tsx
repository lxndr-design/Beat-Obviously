/** @jsxImportSource solid-js */
import { createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import styles from "../../components/MarqueeText/MarqueeText.module.css";

export interface MarqueeTextProps {
  text: string;
  className?: string;
  title?: string;
}

export function MarqueeText(props: MarqueeTextProps) {
  let rootElement: HTMLSpanElement | undefined;
  let innerElement: HTMLSpanElement | undefined;
  const [metrics, setMetrics] = createSignal({ overflow: false, offset: 0, duration: 1.4 }, { equals: false });

  createEffect(() => {
    const text = props.text;
    const root = rootElement;
    const inner = innerElement;
    if (!root || !inner) return;

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

    void text;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(inner);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    });
  });

  const style = (): JSX.CSSProperties => ({
    "--marquee-offset": `${-metrics().offset}px`,
    "--marquee-duration": `${metrics().duration}s`,
  });

  return (
    <span
      ref={rootElement}
      class={`${styles.root} ${props.className ?? ""}`}
      data-overflow={metrics().overflow ? "true" : "false"}
      style={style()}
      title={props.title ?? props.text}
    >
      <span ref={innerElement} class={styles.inner}>
        {props.text}
      </span>
    </span>
  );
}
