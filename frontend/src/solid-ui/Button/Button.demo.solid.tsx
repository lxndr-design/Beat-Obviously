/** @jsxImportSource solid-js */
import { Button } from "./Button.solid";
import { Icon } from "../Icon";

export function ButtonSolidDemo() {
  return (
    <section>
      <h2>Solid Button</h2>
      <Button>Default</Button>
      <Button variant="primary">Primary</Button>
      <Button selected>Selected</Button>
      <Button iconOnly aria-label="Add node"><Icon name="ph:plus" decorative /></Button>
    </section>
  );
}
