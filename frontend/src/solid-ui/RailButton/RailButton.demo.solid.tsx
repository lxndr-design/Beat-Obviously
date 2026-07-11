import { createSignal } from "solid-js";
import { AppLogo } from "../AppLogo";
import { Icon } from "../Icon";
import { RailButton } from "./RailButton.solid";

export function RailButtonDemo() {
  const [selected, setSelected] = createSignal(false);
  return (
    <section>
      <h2>Rail button</h2>
      <RailButton selected={selected()} onClick={() => setSelected(!selected())} aria-label="Instruments">
        <Icon name="ph:piano-keys" size={18} decorative />
      </RailButton>
      <RailButton aria-label="Beat menu"><AppLogo /></RailButton>
    </section>
  );
}
