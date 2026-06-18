import { createSignal } from "solid-js";
import { Button } from "../Button";
import { Modal } from "./Modal.solid";

export function ModalSolidDemo() {
  const [open, setOpen] = createSignal(false);
  return (
    <section>
      <h2>Solid Modal</h2>
      <Button onClick={() => setOpen(true)}>Open Modal</Button>
      <Modal
        open={open()}
        scopeId="solid-modal-demo"
        title="Solid Modal"
        width="sm"
        onClose={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>Close</Button>}
      >
        <p>Modal body</p>
      </Modal>
    </section>
  );
}
