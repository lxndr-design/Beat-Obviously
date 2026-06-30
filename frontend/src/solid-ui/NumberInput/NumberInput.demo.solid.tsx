import { createSignal } from "solid-js";
import { NumberInput } from "./NumberInput.solid";

export function NumberInputDemo() {
  const [value, setValue] = createSignal(60);
  return (
    <section>
      <h2>Solid NumberInput</h2>
      <NumberInput label="Cut" value={value()} min={0} max={100} unit="%" onChange={setValue} />
      <NumberInput
        layout="inline"
        label="Fine"
        value={value() / 100}
        min={0}
        max={1}
        step={0.01}
        commitOnChange
        onChange={(next) => setValue(Math.round(next * 100))}
      />
    </section>
  );
}
