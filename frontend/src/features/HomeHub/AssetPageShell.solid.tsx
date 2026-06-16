/** @jsxImportSource solid-js */
import { Show, type JSX } from "solid-js";
import { Icon } from "../../solid-ui";
import styles from "./AssetPageShell.module.css";

type AssetPageVariant = "balanced" | "wide-browser" | "instrument";

interface AssetPageShellProps {
  browserLabel: string;
  browser: JSX.Element;
  browserClassName?: string;
  previewLabel: string;
  preview: JSX.Element;
  previewClassName?: string;
  variant?: AssetPageVariant;
}

export function AssetPageShellSolid(props: AssetPageShellProps) {
  const pageClass = () => [
    styles.page,
    props.variant === "wide-browser" && styles.pageWideBrowser,
    props.variant === "instrument" && styles.pageInstrument,
  ].filter(Boolean).join(" ");
  const browserClass = () => [styles.browser, props.browserClassName].filter(Boolean).join(" ");
  const previewClass = () => [styles.preview, props.previewClassName].filter(Boolean).join(" ");

  return (
    <div class={pageClass()}>
      <section class={browserClass()} aria-label={props.browserLabel}>
        {props.browser}
      </section>
      <section class={previewClass()} aria-label={props.previewLabel}>
        {props.preview}
      </section>
    </div>
  );
}

export function AssetBrowserRibbonSolid(props: { label: string; count?: number }) {
  return (
    <div class={styles.browserRibbon}>
      <span>{props.label}</span>
      <Show when={typeof props.count === "number"}>
        <strong>{props.count}</strong>
      </Show>
    </div>
  );
}

type AssetStateTone = "neutral" | "loading" | "warning" | "danger";

export function AssetStateMessageSolid(props: {
  icon: string;
  title: string;
  body?: string;
  tone?: AssetStateTone;
  children?: JSX.Element;
}) {
  const className = () => [
    styles.stateMessage,
    props.tone === "loading" && styles.stateLoading,
    props.tone === "warning" && styles.stateWarning,
    props.tone === "danger" && styles.stateDanger,
  ].filter(Boolean).join(" ");

  return (
    <div class={className()}>
      <span class={styles.stateIcon} aria-hidden>
        <Icon name={props.icon} size={16} decorative />
      </span>
      <div class={styles.stateCopy}>
        <strong>{props.title}</strong>
        <Show when={props.body}>
          <span>{props.body}</span>
        </Show>
      </div>
      <Show when={props.children}>
        <div class={styles.stateActions}>{props.children}</div>
      </Show>
    </div>
  );
}
