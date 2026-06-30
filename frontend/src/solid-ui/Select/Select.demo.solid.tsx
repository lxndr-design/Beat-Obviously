import { createSignal } from "solid-js";
import { Select } from "./Select.solid";

export function SelectDemo() {
  const [category, setCategory] = createSignal("lead");
  const [curve, setCurve] = createSignal("linear");

  return (
    <section>
      <h2>Solid Select</h2>
      <Select label="Category" value={category()} onChange={(event) => setCategory(event.currentTarget.value)}>
        <option value="bass">Bass</option>
        <option value="lead">Lead</option>
        <option value="pad">Pad</option>
      </Select>
      <Select layout="inline" label="Curve" value={curve()} onChange={(event) => setCurve(event.currentTarget.value)}>
        <option value="linear">Linear</option>
        <option value="ease-in">Ease In</option>
        <option value="ease-out">Ease Out</option>
      </Select>
    </section>
  );
}
