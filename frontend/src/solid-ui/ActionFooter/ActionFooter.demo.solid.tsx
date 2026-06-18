import { Button } from "../Button";
import { ActionFooter } from "./ActionFooter.solid";

export function ActionFooterDemo() {
  return (
    <section>
      <h2>Solid ActionFooter</h2>
      <ActionFooter>
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Apply</Button>
      </ActionFooter>
      <ActionFooter align="start">
        <Button>Reset</Button>
      </ActionFooter>
    </section>
  );
}
