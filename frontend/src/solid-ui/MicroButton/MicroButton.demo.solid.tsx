import { createSignal } from "solid-js";
import { Icon } from "../Icon";
import { MicroButton } from "./MicroButton.solid";

export function MicroButtonDemo() {
  const [active, setActive] = createSignal(false);
  return (
    <section>
      <h2>Micro button</h2>
      <MicroButton active={active()} onClick={() => setActive(!active())} aria-label="Solo">S</MicroButton>
      <MicroButton active aria-label="Input monitor"><Icon name="ph:speaker-high-fill" size={18} decorative /></MicroButton>
      <MicroButton disabled aria-label="Mute">M</MicroButton>
    </section>
  );
}
