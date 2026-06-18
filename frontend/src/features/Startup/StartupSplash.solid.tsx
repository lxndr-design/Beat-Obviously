import { createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { Icon } from "../../solid-ui";
import styles from "./StartupSplash.module.css";

export interface StartupStage {
  id: string;
  label: string;
  ready: boolean;
}

export interface StartupSplashProps {
  stages: StartupStage[];
}

export const STARTUP_MINIMUM_VISIBLE_MS = 900;

export function StartupSplash(props: { props: Accessor<StartupSplashProps> }) {
  const [minimumElapsed, setMinimumElapsed] = createSignal(false);
  const stages = () => props.props().stages;
  const readyCount = createMemo(() => stages().filter((stage) => stage.ready).length);
  const ready = createMemo(() => stages().length > 0 && readyCount() === stages().length);
  const progress = createMemo(() => stages().length === 0 ? 0 : Math.round((readyCount() / stages().length) * 100));
  const activeStage = createMemo(() => stages().find((stage) => !stage.ready)?.label ?? "Opening workspace");

  onMount(() => {
    const timer = window.setTimeout(() => setMinimumElapsed(true), STARTUP_MINIMUM_VISIBLE_MS);
    document.getElementById("beat-boot-splash")?.remove();
    onCleanup(() => window.clearTimeout(timer));
  });

  return (
    <Show when={!(ready() && minimumElapsed())}>
      <div class={styles.scrim} role="status" aria-live="polite" aria-label={`Starting Beat. ${activeStage()}.`}>
        <section class={styles.panel} style={{ "--startup-progress": `${progress()}%` }}>
          <div class={styles.mark} aria-hidden="true">
            <Icon name="ph:music-note" size={16} decorative />
          </div>
          <div class={styles.copy}>
            <h1>Beat</h1>
            <p>{activeStage()}</p>
          </div>
          <div class={styles.progress} aria-hidden="true">
            <span />
          </div>
          <ul class={styles.stageList}>
            <For each={stages()}>
              {(stage) => (
                <li class={stage.ready ? styles.stageReady : ""}>
                  <span class={styles.stageDot} aria-hidden="true" />
                  <span>{stage.label}</span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </div>
    </Show>
  );
}
