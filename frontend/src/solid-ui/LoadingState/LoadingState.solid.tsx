import { For, Show } from "solid-js";
import styles from "./LoadingState.module.css";

export interface LoadingIndicatorProps {
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  announce?: boolean;
}

const SIGNAL_BARS = [0, 1, 2, 3, 4, 5, 6];

export function LoadingIndicator(props: LoadingIndicatorProps) {
  const className = () => [
    styles.indicator,
    props.size === "sm" && styles.small,
    props.size === "lg" && styles.large,
    props.className,
  ].filter(Boolean).join(" ");

  return (
    <span
      class={className()}
      role={props.announce === false ? undefined : "status"}
      aria-live={props.announce === false ? undefined : "polite"}
      aria-label={props.label || "Loading"}
    >
      <span class={styles.signal} aria-hidden="true">
        <For each={SIGNAL_BARS}>{(bar) => <i style={{ "--loading-index": bar }} />}</For>
      </span>
      <Show when={props.label}>
        <span class={styles.label}>{props.label}</span>
      </Show>
    </span>
  );
}

export function LoadingSkeleton(props: {
  label?: string;
  variant?: "row" | "media";
  className?: string;
}) {
  const className = () => [
    styles.skeleton,
    props.variant !== "row" && styles.skeletonMedia,
    props.className,
  ].filter(Boolean).join(" ");

  return (
    <div class={className()} role="status" aria-label={props.label || "Loading content"}>
      <Show when={props.variant !== "row"}>
        <span class={`${styles.skeletonShape} ${styles.skeletonSquare}`} aria-hidden="true" />
      </Show>
      <span class={styles.skeletonCopy} aria-hidden="true">
        <span class={`${styles.skeletonShape} ${styles.skeletonPrimary}`} />
        <span class={`${styles.skeletonShape} ${styles.skeletonSecondary}`} />
      </span>
    </div>
  );
}
