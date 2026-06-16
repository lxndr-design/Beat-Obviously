export type DialogKind = "alert" | "confirm" | "prompt";

export interface DialogRequest<T = unknown> {
  id: number;
  kind: DialogKind;
  title: string;
  message: string;
  defaultValue?: string;
  resolve: (value: T) => void;
}

export type ActiveDialog = DialogRequest<void> | DialogRequest<boolean> | DialogRequest<string | null>;

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

export function getActiveAppDialog() {
  return activeDialog;
}

export function subscribeAppDialog(listener: (dialog: ActiveDialog | null) => void) {
  listeners.add(listener);
  listener(activeDialog);
  return () => {
    listeners.delete(listener);
  };
}

export function completeDialog<T>(id: number, value: T) {
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
