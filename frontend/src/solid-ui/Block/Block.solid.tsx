import { Show, type JSX } from "solid-js";
import styles from "./Block.module.css";

export interface BlockProps {
  title?: JSX.Element;
  actions?: JSX.Element;
  framed?: boolean;
  fill?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  className?: string;
  bodyClass?: string;
  children: JSX.Element;
}

export function Block(props: BlockProps) {
  const padding = () => props.padding ?? "md";
  const className = () => [
    styles.block,
    props.framed ? styles.framed : "",
    props.fill ? styles.fill : "",
    styles[`pad-${padding()}`],
    props.className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <section class={className()}>
      <Show when={props.title || props.actions}>
        <header class={styles.header}>
          <Show when={props.title}>
            <h2 class={styles.title}>{props.title}</h2>
          </Show>
          <Show when={props.actions}>
            <div class={styles.actions}>{props.actions}</div>
          </Show>
        </header>
      </Show>
      <div class={`${styles.body} ${props.bodyClass ?? ""}`}>{props.children}</div>
    </section>
  );
}
