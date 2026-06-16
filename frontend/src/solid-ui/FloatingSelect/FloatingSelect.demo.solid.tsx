/** @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { FloatingSelect } from "./FloatingSelect.solid";

export function FloatingSelectSolidDemo() {
  const [open, setOpen] = createSignal(false);
  const [value, setValue] = createSignal("midi");
  return (
    <section>
      <h2>Solid FloatingSelect</h2>
      <FloatingSelect
        label="Editor"
        layout="inline"
        value={value()}
        open={open()}
        onOpenChange={setOpen}
        onChange={setValue}
        options={[
          { value: "auto", label: "Auto" },
          { value: "midi", label: "MIDI" },
          { value: "drum", label: "Drum" },
        ]}
      />
    </section>
  );
}
