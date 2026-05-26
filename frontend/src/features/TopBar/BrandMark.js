import { jsx as _jsx } from "react/jsx-runtime";
import { Icon } from "../../components";
import styles from "./BrandMark.module.css";
/**
 * BrandMark — the new BEAT logo: a white square containing a musical note.
 * Replaces the "BEAT" wordmark.
 */
export function BrandMark() {
    return (_jsx("div", { className: styles.mark, "aria-label": "Beat", children: _jsx(Icon, { name: "ph:music-note", size: 16, decorative: true }) }));
}
