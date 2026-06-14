import type { CSSProperties } from "react";
import { Icon } from "../../components";
import styles from "./StartupSplash.module.css";

export interface StartupStage {
  id: string;
  label: string;
  ready: boolean;
}

interface StartupSplashProps {
  stages: StartupStage[];
}

export function StartupSplash({ stages }: StartupSplashProps) {
  const readyCount = stages.filter((stage) => stage.ready).length;
  const ready = stages.length > 0 && readyCount === stages.length;
  if (ready) return null;

  const progress = stages.length === 0 ? 0 : Math.round((readyCount / stages.length) * 100);
  const activeStage = stages.find((stage) => !stage.ready)?.label ?? "Preparing workspace";
  const style = { "--startup-progress": `${progress}%` } as CSSProperties;

  return (
    <div className={styles.scrim} role="status" aria-live="polite" aria-label={`Starting Beat. ${activeStage}.`}>
      <section className={styles.panel} style={style}>
        <div className={styles.mark} aria-hidden="true">
          <Icon name="ph:music-note" size={16} decorative />
        </div>
        <div className={styles.copy}>
          <h1>Beat</h1>
          <p>{activeStage}</p>
        </div>
        <div className={styles.progress} aria-hidden="true">
          <span />
        </div>
        <ul className={styles.stageList}>
          {stages.map((stage) => (
            <li key={stage.id} className={stage.ready ? styles.stageReady : ""}>
              <span className={styles.stageDot} aria-hidden="true" />
              <span>{stage.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
