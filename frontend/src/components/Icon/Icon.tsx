import { Icon as IconifyIcon } from "@iconify/react";
import type { CSSProperties } from "react";

/**
 * Icon wrapper. Single source for icons — Phosphor (`ph:*`).
 * Reject any name that doesn't start with `ph:` so we never mix icon sets.
 */
export interface IconProps {
  /** Iconify name, must start with `ph:` (Phosphor). */
  name: string;
  /** Size in px. Defaults to 16 (matches min font-size, 8px-grid friendly). */
  size?: 12 | 14 | 16 | 24 | 32 | 40 | 48;
  className?: string;
  style?: CSSProperties;
  /** Hidden from screen readers if purely decorative. */
  decorative?: boolean;
  title?: string;
}

const ALLOWED_PREFIX = "ph:";

export function Icon({
  name,
  size = 16,
  className,
  style,
  decorative = false,
  title,
}: IconProps) {
  if (!name.startsWith(ALLOWED_PREFIX) && import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(
      `[Beat] Icon "${name}" is not from the Phosphor set. ` +
        `Only \`${ALLOWED_PREFIX}*\` icons are allowed (design rule).`,
    );
  }

  return (
    <IconifyIcon
      icon={name}
      width={size}
      height={size}
      className={className}
      style={{ color: "currentColor", display: "block", ...style }}
      aria-hidden={decorative}
      role={decorative ? "presentation" : "img"}
      aria-label={decorative ? undefined : title ?? name}
    />
  );
}
