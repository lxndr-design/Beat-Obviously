import { createSignal } from "solid-js";
import { Checkbox } from "./Checkbox.solid";

export function CheckboxDemo() {
  const [checked, setChecked] = createSignal(true);
  return (
    <section>
      <h2>Checkbox</h2>
      <Checkbox label="Selected" checked={checked()} onChange={setChecked} />
      <Checkbox label="Disabled" checked={false} disabled />
    </section>
  );
}
