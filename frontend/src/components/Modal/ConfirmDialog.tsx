import { Modal } from "./Modal";
import { Button } from "../Button";

/**
 * Notification / warning preset. Buttons per spec: [OK, Cancel].
 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  onOk: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  okLabel = "OK",
  cancelLabel = "Cancel",
  onOk,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      width="sm"
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={onOk}>
            {okLabel}
          </Button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}
