/** @jsxImportSource solid-js */
import { Icon } from "../../solid-ui";
import styles from "./BrandMark.module.css";

export function BrandMarkSolid() {
  return (
    <div class={`${styles.mark} brandMark`} aria-label="Beat">
      <Icon name="ph:music-note" size={16} decorative />
    </div>
  );
}
