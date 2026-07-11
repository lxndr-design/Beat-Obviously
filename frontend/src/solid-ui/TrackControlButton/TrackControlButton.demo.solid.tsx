import { createSignal } from "solid-js";
import { Icon } from "../Icon";
import { TrackControlButton } from "./TrackControlButton.solid";

export function TrackControlButtonDemo() {
  const [active, setActive] = createSignal(false);
  return (
    <section>
      <h2>Track control button</h2>
      <TrackControlButton active={active()} onClick={() => setActive(!active())} aria-label="Record">R</TrackControlButton>
      <TrackControlButton active aria-label="Input monitor"><Icon name="ph:speaker-high-fill" decorative /></TrackControlButton>
      <TrackControlButton disabled aria-label="Mute">M</TrackControlButton>
    </section>
  );
}
