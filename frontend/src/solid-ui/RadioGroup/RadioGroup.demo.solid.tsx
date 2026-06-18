import { createSignal } from "solid-js";
import { RadioGroup } from "./RadioGroup.solid";

export function RadioGroupSolidDemo() {
  const [value, setValue] = createSignal<2 | 4 | 8 | 16>(8);
  return (
    <section>
      <h2>Solid RadioGroup</h2>
      <RadioGroup
        ariaLabel="Grid subdivision"
        value={value()}
        options={[
          { value: 2, label: "1/2" },
          { value: 4, label: "1/4" },
          { value: 8, label: "1/8" },
          { value: 16, label: "1/16" },
        ]}
        onChange={setValue}
      />
    </section>
  );
}
