import { Icon } from "../Icon";
import { RowActionButton } from "./RowActionButton.solid";

export function RowActionButtonDemo() {
  return (
    <section>
      <h2>Row action button</h2>
      <RowActionButton aria-label="Preview"><Icon name="ph:play-fill" size={18} decorative /></RowActionButton>
      <RowActionButton size="compact" aria-label="Compact preview"><Icon name="ph:play-fill" size={18} decorative /></RowActionButton>
    </section>
  );
}
