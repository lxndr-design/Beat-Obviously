import { type InputHTMLAttributes } from "react";
import styles from "./TextInput.module.css";

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  layout?: "stacked" | "inline" | "bare";
  unit?: string;
}

export function TextInput({
  label,
  layout = "stacked",
  unit,
  className,
  ...rest
}: TextInputProps) {
  const cls = [
    styles.wrap,
    layout === "inline" && styles.inline,
    layout === "bare" && styles.bare,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={cls}>
      {label && <span className={styles.label}>{label}</span>}
      <span className={styles.fieldFrame}>
        <input className={styles.input} type="text" {...rest} />
        {unit && <span className={styles.unit}>{unit}</span>}
      </span>
    </label>
  );
}
