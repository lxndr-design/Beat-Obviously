import { jsx as _jsx } from "react/jsx-runtime";
import { Icon as IconifyIcon } from "@iconify/react";
const ALLOWED_PREFIX = "ph:";
export function Icon({ name, size = 16, className, style, decorative = false, title, }) {
    if (!name.startsWith(ALLOWED_PREFIX) && import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[Beat] Icon "${name}" is not from the Phosphor set. ` +
            `Only \`${ALLOWED_PREFIX}*\` icons are allowed (design rule).`);
    }
    return (_jsx(IconifyIcon, { icon: name, width: size, height: size, className: className, style: { color: "currentColor", display: "block", ...style }, "aria-hidden": decorative, role: decorative ? "presentation" : "img", "aria-label": decorative ? undefined : title ?? name }));
}
