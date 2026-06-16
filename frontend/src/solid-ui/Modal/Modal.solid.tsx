/** @jsxImportSource solid-js */
import { createEffect, createUniqueId, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "../Icon";
import styles from "../../components/Modal/Modal.module.css";

export interface ModalProps {
  open: boolean;
  title: JSX.Element;
  subtitle?: string;
  footer?: JSX.Element;
  flushBody?: boolean;
  headerActions?: JSX.Element;
  closeOnScrimClick?: boolean;
  closeOnEscape?: boolean;
  width?: "sm" | "md" | "lg" | "full";
  scopeId?: string;
  dirty?: boolean;
  onClose: () => void;
  onRequestCloseDirty?: () => void;
  children: JSX.Element;
}

export function Modal(allProps: ModalProps) {
  const props = allProps;
  const autoId = createUniqueId();
  const id = () => props.scopeId ?? autoId;
  const width = () => props.width ?? "md";

  createEffect(() => {
    if (!props.open || !props.closeOnEscape) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      requestClose();
    }
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  function requestClose() {
    if (props.dirty && props.onRequestCloseDirty) {
      props.onRequestCloseDirty();
      return;
    }
    props.onClose();
  }

  return (
    <Show when={props.open}>
      <Portal mount={document.body}>
        <div
          class={styles.scrim}
          style={{ "z-index": 3000 }}
          data-floating-layer
          onMouseDown={(event) => {
            if (props.closeOnScrimClick && event.target === event.currentTarget) requestClose();
          }}
        >
          <div
            class={`${styles.modal} ${styles[`width-${width()}`]} animate-slide-in-bottom`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id()}-title`}
            data-floating-layer
          >
            <header class={styles.header}>
              <div class={styles.titleGroup}>
                <h2 id={`${id()}-title`} class={styles.title}>
                  {props.title}
                </h2>
                <Show when={props.subtitle}><p class={styles.subtitle}>{props.subtitle}</p></Show>
              </div>
              <div class={styles.headerRight}>
                <Show when={props.headerActions}><div class={styles.headerActions}>{props.headerActions}</div></Show>
                <button class={styles.closeBtn} onClick={requestClose} aria-label="Close" type="button">
                  <Icon name="ph:x" size={16} decorative />
                </button>
              </div>
            </header>

            <div class={`${styles.body} ${props.flushBody ? styles.bodyFlush : ""}`}>{props.children}</div>

            <Show when={props.footer}><footer class={styles.footer}>{props.footer}</footer></Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
