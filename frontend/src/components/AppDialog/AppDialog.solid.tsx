import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Button, Modal, TextInput } from "../../solid-ui";
import { completeDialog, getActiveAppDialog, subscribeAppDialog, type ActiveDialog } from "./state";
import styles from "./AppDialog.module.css";

export function AppDialogHostSolid() {
  const [dialog, setDialog] = createSignal<ActiveDialog | null>(getActiveAppDialog());
  const [promptValue, setPromptValue] = createSignal("");

  const unsubscribe = subscribeAppDialog(setDialog);
  onCleanup(unsubscribe);
  createEffect(() => {
    const current = dialog();
    if (current?.kind === "prompt") setPromptValue(current.defaultValue ?? "");
  });

  function cancel() {
    const current = dialog();
    if (!current) return;
    completeDialog(current.id, current.kind === "confirm" ? false : current.kind === "prompt" ? null : undefined);
  }

  function accept() {
    const current = dialog();
    if (!current) return;
    completeDialog(current.id, current.kind === "confirm" ? true : current.kind === "prompt" ? promptValue() : undefined);
  }

  return (
    <>
      <Modal
        open={Boolean(dialog())}
        scopeId={dialog() ? `app-dialog-${dialog()!.id}` : "app-dialog"}
        title={dialog()?.title ?? "Notice"}
        width="sm"
        closeOnEscape
        onClose={cancel}
        footer={(
          <>
            <Show when={dialog()?.kind !== "alert"}>
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </Show>
            <Button variant="primary" onClick={accept}>
              {dialog()?.kind === "prompt" ? "Done" : "OK"}
            </Button>
          </>
        )}
      >
        <div class={styles.body}>
          <p class={styles.message}>{dialog()?.message}</p>
          <Show when={dialog()?.kind === "prompt"}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                accept();
              }}
            >
              <TextInput
                layout="bare"
                value={promptValue()}
                onInput={(event) => setPromptValue(event.currentTarget.value)}
                autofocus
                aria-label={dialog()?.message}
              />
            </form>
          </Show>
        </div>
      </Modal>
    </>
  );
}
