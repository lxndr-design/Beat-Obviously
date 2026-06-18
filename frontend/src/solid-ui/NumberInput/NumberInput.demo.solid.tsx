import { createSignal } from "solid-js";
import { NumberInput } from "./NumberInput.solid";

export function NumberInputSolidDemo() {
  const [value, setValue] = createSignal(60);
  return (
    <section>
      <h2>Solid NumberInput</h2>
      <NumberInput label="Cut" value={value()} min={0} max={100} unit="%" onChange={setValue} />
    </section>
  );
}
