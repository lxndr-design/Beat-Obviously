import { Button } from "../Button";
import { Block } from "./Block.solid";

export function BlockDemo() {
  return (
    <Block
      title="Block"
      framed
      padding="sm"
      actions={<Button size="sm" variant="ghost">Action</Button>}
    >
      <p>Reusable section frame with shared title, action, fill, and padding rules.</p>
    </Block>
  );
}
