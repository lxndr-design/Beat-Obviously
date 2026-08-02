import { createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { AppLogo, LoadingIndicator } from "../../solid-ui";
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
        <div class={styles.backgroundGrid} aria-hidden="true" />
        <section class={styles.panel} style={{ "--startup-progress": `${progress()}%` }}>
          <header class={styles.header}>
            <div class={styles.mark} aria-hidden="true">
              <AppLogo class={styles.markGlyph} />
            </div>
            <div class={styles.copy}>
              <span class={styles.eyebrow}>Native audio workspace</span>
              <h1>Beat</h1>
              <p>{activeStage()}</p>
            </div>
            <strong class={styles.percent}>{progress()}%</strong>
          </header>
          <div class={styles.motionField} aria-hidden="true">
            <LoadingIndicator size="lg" announce={false} className={styles.signal} />
            <div class={styles.timeline}>
              <For each={Array.from({ length: 16 })}>{(_, index) => <i class={index() % 4 === 0 ? styles.majorTick : ""} />}</For>
              <span class={styles.playhead} />
            </div>
          </div>
          <div class={styles.progressHeader}>
            <span>Preparing session</span>
            <span>{readyCount()} / {stages().length}</span>
          </div>
          <div class={styles.progress} aria-hidden="true">
            <span />
          </div>
          <ul class={styles.stageList}>
            <For each={stages()}>
              {(stage) => (
                <li class={stage.ready ? styles.stageReady : ""}>
                  <span class={styles.stageIndex} aria-hidden="true">{stages().indexOf(stage) + 1}</span>
                  <span>{stage.label}</span>
                  <span class={styles.stageState} aria-hidden="true">
                    <Show when={stage.ready} fallback={<LoadingIndicator size="sm" announce={false} />}>
                      Ready
                    </Show>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </div>
    </Show>
  );
}
