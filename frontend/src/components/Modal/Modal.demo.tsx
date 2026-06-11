import { useState } from "react";
import { ActionFooter } from "../ActionFooter";
import { Button } from "../Button";
import { DemoRow, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";

export function ModalDemo() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <DemoSection title="Modal" note="Editors and confirmations use the same stacked modal shell.">
      <DemoSample label="modal presets">
        <DemoRow>
          <Button onClick={() => setEditorOpen(true)}>Open editor</Button>
          <Button onClick={() => setConfirmOpen(true)}>Open warning</Button>
        </DemoRow>
        <Modal
          open={editorOpen}
          title="Track Details"
          subtitle="Lead Synth"
          width="sm"
          closeOnEscape
          onClose={() => setEditorOpen(false)}
          footer={
            <ActionFooter>
              <Button variant="ghost" onClick={() => setEditorOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setEditorOpen(false)}>Save</Button>
            </ActionFooter>
          }
        >
          Gain, routing, and recording controls compose inside the modal body.
        </Modal>
        <ConfirmDialog
          open={confirmOpen}
          title="Discard Changes"
          message="Unsaved edits will be lost."
          onOk={() => setConfirmOpen(false)}
          onCancel={() => setConfirmOpen(false)}
        />
      </DemoSample>
    </DemoSection>
  );
}
