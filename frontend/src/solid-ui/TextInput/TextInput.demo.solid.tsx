/** @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { TextInput } from "./TextInput.solid";

export function TextInputSolidDemo() {
  const [name, setName] = createSignal("Nodemap");
  return (
    <section>
      <h2>Solid TextInput</h2>
      <TextInput label="Name" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
      <TextInput layout="inline" label="Unit" value="Hz" />
    </section>
  );
}
