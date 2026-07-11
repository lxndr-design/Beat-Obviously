import { createSignal } from "solid-js";
import { Icon } from "../Icon";
import { FieldActionButton } from "./FieldActionButton.solid";

export function FieldActionButtonDemo() {
  const [active, setActive] = createSignal(false);
  return (
    <section>
      <h2>Field action button</h2>
      <FieldActionButton active={active()} onClick={() => setActive(!active())} aria-label="Generate">
        <Icon name="ph:sparkle" size={18} decorative />
      </FieldActionButton>
    </section>
  );
}
