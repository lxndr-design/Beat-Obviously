import { useEffect, useState } from "react";
import { Button } from "../Button";
import { Modal } from "../Modal";
import { TextInput } from "../TextInput";
import styles from "./AppDialog.module.css";

type DialogKind = "alert" | "confirm" | "prompt";

interface DialogRequest<T = unknown> {
  id: number;
  kind: DialogKind;
  title: string;
  message: string;
  defaultValue?: string;
  resolve: (value: T) => void;
}

type ActiveDialog = DialogRequest<void> | DialogRequest<boolean> | DialogRequest<string | null>;

let nextDialogId = 1;
let activeDialog: ActiveDialog | null = null;
const dialogQueue: ActiveDialog[] = [];
const listeners = new Set<(dialog: ActiveDialog | null) => void>();

function emitDialogState() {
  for (const listener of listeners) listener(activeDialog);
}

function pumpDialogQueue() {
  if (!activeDialog) activeDialog = dialogQueue.shift() ?? null;
  emitDialogState();
}

function enqueueDialog<T>(request: Omit<DialogRequest<T>, "id" | "resolve">): Promise<T> {
  return new Promise<T>((resolve) => {
    dialogQueue.push({
      ...request,
      id: nextDialogId,
      resolve: resolve as (value: unknown) => void,
    } as ActiveDialog);
    nextDialogId += 1;
    pumpDialogQueue();
  });
}

function completeDialog<T>(id: number, value: T) {
  if (activeDialog?.id !== id) return;
  const resolve = activeDialog.resolve as (value: T) => void;
  activeDialog = null;
  resolve(value);
  pumpDialogQueue();
}

export function appAlert(message: string, title = "Notice"): Promise<void> {
  return enqueueDialog<void>({ kind: "alert", title, message });
}

export function appConfirm(message: string, title = "Confirm"): Promise<boolean> {
  return enqueueDialog<boolean>({ kind: "confirm", title, message });
}

export function appPrompt(message: string, defaultValue = "", title = "Input"): Promise<string | null> {
  return enqueueDialog<string | null>({ kind: "prompt", title, message, defaultValue });
}

export function AppDialogHost() {
  const [dialog, setDialog] = useState<ActiveDialog | null>(activeDialog);
  const [promptValue, setPromptValue] = useState("");

  useEffect(() => {
    listeners.add(setDialog);
    setDialog(activeDialog);
    return () => {
      listeners.delete(setDialog);
    };
  }, []);

  useEffect(() => {
    if (dialog?.kind === "prompt") setPromptValue(dialog.defaultValue ?? "");
  }, [dialog]);

  if (!dialog) return null;

  function cancel() {
    if (!dialog) return;
    completeDialog(dialog.id, dialog.kind === "confirm" ? false : dialog.kind === "prompt" ? null : undefined);
  }

  function accept() {
    if (!dialog) return;
    completeDialog(dialog.id, dialog.kind === "confirm" ? true : dialog.kind === "prompt" ? promptValue : undefined);
  }

  return (
    <Modal
      open
      scopeId={`app-dialog-${dialog.id}`}
      title={dialog.title}
      width="sm"
      closeOnEscape
      onClose={cancel}
      footer={
        <>
          {dialog.kind !== "alert" && (
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          )}
          <Button variant="primary" onClick={accept}>
            {dialog.kind === "prompt" ? "Done" : "OK"}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p className={styles.message}>{dialog.message}</p>
        {dialog.kind === "prompt" && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              accept();
            }}
          >
            <TextInput
              layout="bare"
              value={promptValue}
              onChange={(event) => setPromptValue(event.currentTarget.value)}
              autoFocus
              aria-label={dialog.message}
            />
          </form>
        )}
      </div>
    </Modal>
  );
}
