import { type ReactNode } from "react";
import styles from "./AssetPageShell.module.css";

type AssetPageVariant = "balanced" | "wide-browser" | "instrument";

interface AssetPageShellProps {
  browserLabel: string;
  browser: ReactNode;
  browserClassName?: string;
  previewLabel: string;
  preview: ReactNode;
  previewClassName?: string;
  variant?: AssetPageVariant;
}

export function AssetPageShell({
  browserLabel,
  browser,
  browserClassName,
  previewLabel,
  preview,
  previewClassName,
  variant = "balanced",
}: AssetPageShellProps) {
  const pageClass = [
    styles.page,
    variant === "wide-browser" && styles.pageWideBrowser,
    variant === "instrument" && styles.pageInstrument,
  ].filter(Boolean).join(" ");

  const browserClass = [styles.browser, browserClassName].filter(Boolean).join(" ");
  const previewClass = [styles.preview, previewClassName].filter(Boolean).join(" ");

  return (
    <div className={pageClass}>
      <section className={browserClass} aria-label={browserLabel}>
        {browser}
      </section>
      <section className={previewClass} aria-label={previewLabel}>
        {preview}
      </section>
    </div>
  );
}

export function AssetBrowserRibbon({ label, count }: { label: string; count?: number }) {
  return (
    <div className={styles.browserRibbon}>
      <span>{label}</span>
      {typeof count === "number" ? <strong>{count}</strong> : null}
    </div>
  );
}
