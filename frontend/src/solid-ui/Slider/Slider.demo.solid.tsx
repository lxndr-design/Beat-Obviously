import { createSignal } from "solid-js";
import { Slider } from "./Slider.solid";

export function SliderDemo() {
  const [gain, setGain] = createSignal(0.42);
  const [amount, setAmount] = createSignal(-0.25);

  return (
    <section>
      <h2>Solid Slider</h2>
      <Slider
        label="Gain"
        value={gain()}
        min={0}
        max={1}
        step={0.01}
        readout={`${Math.round(gain() * 100)}%`}
        onChange={setGain}
      />
      <Slider
        layout="inline"
        label="Amount"
        value={amount()}
        min={-1}
        max={1}
        step={0.01}
        readout={`${amount() > 0 ? "+" : ""}${Math.round(amount() * 100)}%`}
        onChange={setAmount}
      />
    </section>
  );
}
