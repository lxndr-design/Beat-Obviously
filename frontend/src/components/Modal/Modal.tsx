import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.css";
import { Icon } from "../Icon";
import { useModalStack } from "./modalStack";

export interface ModalProps {
  open: boolean;
  title: string;
  /** Optional subtitle under the title in the header stripe. */
  subtitle?: string;
  /** Footer content. Typically a row of Buttons; see ConfirmDialog for presets. */
  footer?: ReactNode;
  /** Width preset. */
  width?: "sm" | "md" | "lg" | "full";
  /** Stable id for modal stack coordination and contextual hotkeys. */
  scopeId?: string;
  /** Should the modal track dirty state and prompt on close? */
  dirty?: boolean;
  /** Called when the user requests close (X, escape, or a footer cancel). */
  onClose: () => void;
  /** Optional handler invoked when the user requests close while `dirty`. */
  onRequestCloseDirty?: () => void;
  children: ReactNode;
}

/**
 * Modal — the universal floating panel.
 *
 * - Animates in from the bottom (slide).
 * - Backdrop scrim. Clicking the scrim requests close.
 * - Multiple modals stack via the modalStack registry; the stacking order
 *   determines z-index, and the unsaved-check overlay (rendered by
 *   <ModalStackOverlay/>) shadows everything when triggered.
 */
export function Modal({
  open,
  title,
  subtitle,
  footer,
  width = "md",
  scopeId,
  dirty = false,
  onClose,
  onRequestCloseDirty,
  children,
}: ModalProps) {
  const autoId = useId();
  const id = scopeId ?? autoId;
  const ref = useRef<HTMLDivElement>(null);
  const { push, pop, indexOf } = useModalStack();

  useEffect(() => {
    if (!open) return;
    push(id);
    return () => pop(id);
  }, [open, id, push, pop]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dirty]);

  function requestClose() {
    if (dirty && onRequestCloseDirty) {
      onRequestCloseDirty();
    } else {
      onClose();
    }
  }

  if (!open) return null;

  const stackIndex = indexOf(id);

  return createPortal(
    <div
      className={styles.scrim}
      style={{ zIndex: 300 + stackIndex * 10 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={ref}
        className={`${styles.modal} ${styles[`width-${width}`]} animate-slide-in-bottom`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h2 id={`${id}-title`} className={styles.title}>
              {title}
            </h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          <button
            className={styles.closeBtn}
            onClick={requestClose}
            aria-label="Close"
            type="button"
          >
            <Icon name="ph:x" size={16} decorative />
          </button>
        </header>

        <div className={styles.body}>{children}</div>

        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
