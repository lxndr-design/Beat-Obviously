import { splitProps, type JSX } from "solid-js";
import styles from "./Button.module.css";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  selected?: boolean;
  iconOnly?: boolean;
  className?: string;
}

export function Button(allProps: ButtonProps) {
  const [local, props] = splitProps(allProps, [
    "variant",
    "size",
    "fullWidth",
    "selected",
    "iconOnly",
    "class",
    "className",
    "type",
  ]);
  const variant = () => local.variant ?? "default";
  const size = () => local.size ?? "md";
  const cls = () => [
    styles.button,
    styles[`variant-${variant()}`],
    styles[`size-${size()}`],
    local.fullWidth && styles.fullWidth,
    local.selected && styles.selected,
    local.iconOnly && styles.iconOnly,
    local.class,
    local.className,
  ].filter(Boolean).join(" ");

  return (
    <button type={local.type ?? "button"} class={cls()} {...props} />
  );
}
