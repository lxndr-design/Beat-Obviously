import { createPortal } from "react-dom";
import { Button } from "../Button";
import { useModalStack } from "./modalStack";
import styles from "./Modal.module.css";
import overlayStyles from "./ModalStackOverlay.module.css";

/**
 * Global overlay that shadows the entire window when an unsaved-check is
 * pending. Renders above every other modal. Always mounted near the app root.
 *
 * Per spec: save-confirmation has [Save, Don't Save, Cancel] buttons.
 */
export function ModalStackOverlay() {
  const pending = useModalStack((s) => s.pendingDirtyClose);
  const clear = useModalStack((s) => s.clearDirtyClose);

  if (!pending) return null;

  function handleSave() {
    pending!.onSave();
    clear();
  }
  function handleDontSave() {
    pending!.onDontSave();
    clear();
  }
  function handleCancel() {
    clear();
  }

  return createPortal(
    <div className={overlayStyles.fullOverlay}>
      <div className={`${styles.modal} ${styles["width-sm"]} animate-slide-in-bottom`}>
        <header className={styles.header}>
          <h2 className={styles.title}>Unsaved changes</h2>
        </header>
        <div className={styles.body}>
          <p>You have unsaved changes. What would you like to do?</p>
        </div>
        <footer className={styles.footer}>
          <Button variant="ghost" onClick={handleCancel}>
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
    </div>,
    document.body,
  );
}
