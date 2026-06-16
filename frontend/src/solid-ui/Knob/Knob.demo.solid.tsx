/** @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { Knob } from "./Knob.solid";

export function KnobSolidDemo() {
  const [value, setValue] = createSignal(0);
  return (
    <section>
      <h2>Solid Knob</h2>
      <Knob
        value={value()}
        min={-24}
        max={24}
        step={0.1}
        unit="dB"
        label="Gain"
        bipolar
        size="sm"
        onChange={setValue}
      />
    </section>
  );
}
