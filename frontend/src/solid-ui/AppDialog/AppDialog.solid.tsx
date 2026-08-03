import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Button, Modal, TextInput } from "..";
import { completeDialog, getActiveAppDialog, subscribeAppDialog, type ActiveDialog } from "./state";
import styles from "./AppDialog.module.css";

export function AppDialogHost() {
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
    completeDialog(
      current.id,
      current.kind === "confirm"
        ? false
        : current.kind === "prompt"
          ? null
          : current.kind === "save-confirm"
            ? "cancel"
            : undefined,
    );
  }

  function accept() {
    const current = dialog();
    if (!current) return;
    completeDialog(
      current.id,
      current.kind === "confirm"
        ? true
        : current.kind === "prompt"
          ? promptValue()
          : current.kind === "save-confirm"
            ? "save"
            : undefined,
    );
  }

  function dontSave() {
    const current = dialog();
    if (!current || current.kind !== "save-confirm") return;
    completeDialog(current.id, "dont-save");
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
            <Show when={dialog()?.kind === "save-confirm"}>
              <Button variant="default" onClick={dontSave}>
                Don't save
              </Button>
            </Show>
            <Button variant="primary" onClick={accept}>
              {dialog()?.kind === "prompt" ? "Done" : dialog()?.kind === "save-confirm" ? "Save" : "OK"}
            </Button>
          </>
        )}
      >
        <div class={styles.body}>
          <Show
            when={dialog()?.kind === "prompt"}
            fallback={<p class={styles.message}>{dialog()?.message}</p>}
          >
            <form
              class={styles.promptForm}
              onSubmit={(event) => {
                event.preventDefault();
                accept();
              }}
            >
              <TextInput
                label={dialog()?.message}
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
