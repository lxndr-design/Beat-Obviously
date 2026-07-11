import { Icon } from "../Icon";
import { RowActionButton } from "../RowActionButton";
import { RowItem } from "./RowItem.solid";

export function RowItemDemo() {
  return (
    <section>
      <h2>Solid RowItem</h2>
      <ul>
        <RowItem
          density="compact"
          name="Pearl Kick"
          meta="Sampler"
          icon={<Icon name="ph:music-notes" decorative />}
          hoverIcon={<Icon name="ph:dots-six-vertical" decorative />}
          action={<RowActionButton size="compact" aria-label="Preview Pearl Kick"><Icon name="ph:play-fill" decorative /></RowActionButton>}
        />
      </ul>
    </section>
  );
}
