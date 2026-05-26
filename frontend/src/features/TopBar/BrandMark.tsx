import { Icon } from "../../components";
import styles from "./BrandMark.module.css";

/**
 * BrandMark — the new BEAT logo: a white square containing a musical note.
 * Replaces the "BEAT" wordmark.
 */
export function BrandMark() {
  return (
    <div className={styles.mark} aria-label="Beat">
      <Icon name="ph:music-note" size={16} decorative />
    </div>
  );
}
