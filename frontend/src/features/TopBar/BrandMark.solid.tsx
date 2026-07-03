import { AppLogo } from "../../solid-ui";
import styles from "./BrandMark.module.css";

export function BrandMark() {
  return (
    <div class={`${styles.mark} brandMark`} aria-label="Beat">
      <AppLogo class={styles.logo} />
    </div>
  );
}
