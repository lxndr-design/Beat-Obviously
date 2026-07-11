import styles from "./AppLogo.module.css";

export interface AppLogoProps {
  class?: string;
  decorative?: boolean;
}

export function AppLogo(props: AppLogoProps) {
  return (
    <span
      class={[styles.logo, props.class].filter(Boolean).join(" ")}
      aria-hidden={props.decorative ?? true}
      role={props.decorative === false ? "img" : undefined}
      aria-label={props.decorative === false ? "Beat" : undefined}
    >
      <img class={styles.image} src="/assets/beat-logo.svg" alt="" draggable={false} />
    </span>
  );
}
