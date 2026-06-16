/** @jsxImportSource solid-js */
import { Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Button } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { useModalStack } from "./modalStack";
import styles from "./Modal.module.css";
import overlayStyles from "./ModalStackOverlay.module.css";

export function ModalStackOverlaySolid() {
  const pending = createStoreSelector(useModalStack, (state) => state.pendingDirtyClose);
  const clear = useModalStack.getState().clearDirtyClose;

  function handleSave() {
    pending()?.onSave();
    clear();
  }

  function handleDontSave() {
    pending()?.onDontSave();
    clear();
  }

  return (
    <Show when={pending()}>
      <Portal mount={document.body}>
        <div class={overlayStyles.fullOverlay}>
          <div class={`${styles.modal} ${styles["width-sm"]} animate-slide-in-bottom`}>
            <header class={styles.header}>
              <h2 class={styles.title}>Unsaved changes</h2>
            </header>
            <div class={styles.body}>
              <p>You have unsaved changes. What would you like to do?</p>
            </div>
            <footer class={styles.footer}>
              <Button variant="ghost" onClick={clear}>
                Cancel
              </Button>
              <Button variant="default" onClick={handleDontSave}>
                Don't save
              </Button>
              <Button variant="primary" onClick={handleSave}>
                Save
              </Button>
            </footer>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
