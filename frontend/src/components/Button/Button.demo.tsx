import { DemoGrid, DemoRow, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { Icon } from "../Icon";
import { Button } from "./Button";

export function ButtonDemo() {
  return (
    <DemoSection title="Button" note="Commands use monochrome variants; icon-only buttons stay square.">
      <DemoGrid>
        <DemoSample label="variants">
          <DemoRow>
            <Button>Default</Button>
            <Button variant="primary">Save</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger">Delete</Button>
          </DemoRow>
        </DemoSample>
        <DemoSample label="sizes and selected state">
          <DemoRow>
            <Button size="xs">XS</Button>
            <Button size="sm">SM</Button>
            <Button size="md" selected>Solo</Button>
            <Button size="lg">Export</Button>
          </DemoRow>
        </DemoSample>
        <DemoSample label="icon only and disabled">
          <DemoRow>
            <Button iconOnly size="sm" aria-label="Play">
              <Icon name="ph:play-fill" size={12} decorative />
            </Button>
            <Button iconOnly size="md" aria-label="Stop">
              <Icon name="ph:stop-fill" size={16} decorative />
            </Button>
            <Button disabled>Disabled</Button>
          </DemoRow>
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
