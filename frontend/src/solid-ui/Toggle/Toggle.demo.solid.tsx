/** @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { Toggle } from "./Toggle.solid";

export function ToggleSolidDemo() {
  const [checked, setChecked] = createSignal(false);
  return (
    <section>
      <h2>Solid Toggle</h2>
      <Toggle checked={checked()} onChange={setChecked} label="Monitor" />
    </section>
  );
}
