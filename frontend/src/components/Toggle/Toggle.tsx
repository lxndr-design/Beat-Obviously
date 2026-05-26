import { forwardRef } from "react";
import styles from "./Toggle.module.css";

export interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}

/**
 * Toggle — binary on/off. Renders as a black-and-white inverting box.
 * No slide animation — color invert per design spec.
 *
 * forwardRef so HoverInfo (and other wrappers that need a DOM handle) can
 * attach refs.
 */
export const Toggle = forwardRef<HTMLLabelElement, ToggleProps>(function Toggle(
  { checked, onChange, label, disabled },
  ref,
) {
  return (
    <label ref={ref} className={styles.wrap}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`${styles.box} ${checked ? styles.on : ""}`}
      />
      {label && <span className={styles.label}>{label}</span>}
    </label>
  );
});
