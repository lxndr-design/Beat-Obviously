import { Button } from "../Button";
import { DemoGrid, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { ActionFooter } from "./ActionFooter";

export function ActionFooterDemo() {
  return (
    <DemoSection title="ActionFooter" note="Modal and editor action rows with deterministic alignment.">
      <DemoGrid>
        <DemoSample label="end aligned">
          <ActionFooter>
            <Button variant="ghost">Cancel</Button>
            <Button variant="primary">Save</Button>
          </ActionFooter>
        </DemoSample>
        <DemoSample label="start aligned">
          <ActionFooter align="start">
            <Button variant="danger">Delete</Button>
            <Button variant="ghost">Archive</Button>
          </ActionFooter>
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
