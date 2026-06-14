import { type ButtonHTMLAttributes, forwardRef } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When true, fills the parent column completely (per design spec). */
  fullWidth?: boolean;
  /** When true, renders as a selected toggle with filled foreground treatment. */
  selected?: boolean;
  /** Icon-only button — renders as a 1:1 square at the size's square dim. */
  iconOnly?: boolean;
}

/**
 * Base button.
 * No outline by default. Hover uses a light surface tint; selected/primary
 * states use filled foreground treatment.
 *
 * - default: transparent bg, white fg, tint on hover
 * - primary: white bg, black fg
 * - ghost:   transparent bg, softer tint on hover
 * - danger:  same shape as default; uses stronger label weight
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "default",
    size = "md",
    fullWidth = false,
    selected = false,
    iconOnly = false,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  const cls = [
    styles.button,
    styles[`variant-${variant}`],
    styles[`size-${size}`],
    fullWidth && styles.fullWidth,
    selected && styles.selected,
    iconOnly && styles.iconOnly,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {children}
    </button>
  );
});
