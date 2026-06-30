import { Show, splitProps, type JSX } from "solid-js";
import styles from "./Select.module.css";

export interface SelectProps extends Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  layout?: "stacked" | "inline" | "bare";
  className?: string;
  selectClassName?: string;
}

export function Select(allProps: SelectProps) {
  const [local, props] = splitProps(allProps, ["label", "layout", "class", "className", "selectClassName", "children"]);
  const layout = () => local.layout ?? "stacked";
  const cls = () => [
    styles.wrap,
    layout() === "inline" && styles.inline,
    layout() === "bare" && styles.bare,
    local.class,
    local.className,
  ].filter(Boolean).join(" ");

  return (
    <label class={cls()}>
      <Show when={local.label}>
        <span class={`${styles.label} ds-field-label`}>{local.label}</span>
      </Show>
      <span class={styles.fieldFrame}>
        <select class={[styles.select, "ds-select", local.selectClassName].filter(Boolean).join(" ")} {...props}>
          {local.children}
        </select>
      </span>
    </label>
  );
}
