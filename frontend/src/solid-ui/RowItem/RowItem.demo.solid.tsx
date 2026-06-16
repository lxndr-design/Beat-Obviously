/** @jsxImportSource solid-js */
import { Icon } from "../Icon";
import { RowItem } from "./RowItem.solid";

export function RowItemSolidDemo() {
  return (
    <section>
      <h2>Solid RowItem</h2>
      <ul>
        <RowItem
          name="Pearl Kick"
          meta="Sampler"
          icon={<Icon name="ph:music-notes" decorative />}
          hoverIcon={<Icon name="ph:dots-six-vertical" decorative />}
          action={<Icon name="ph:play-fill" decorative />}
        />
      </ul>
    </section>
  );
}
