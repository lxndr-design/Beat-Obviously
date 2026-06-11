import { Button } from "../Button";
import { Icon } from "../Icon";
import { DemoGrid, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { Block } from "./Block";

export function BlockDemo() {
  return (
    <DemoSection title="Block" note="The structural section primitive for panels and editor regions.">
      <DemoGrid>
        <DemoSample label="framed with title and action">
          <Block
            title="Route"
            padding="md"
            actions={
              <Button iconOnly size="sm" aria-label="Add route">
                <Icon name="ph:plus" size={12} decorative />
              </Button>
            }
          >
            Output bus, sends, and track routing controls compose inside this frame.
          </Block>
        </DemoSample>
        <DemoSample label="unframed body block">
          <Block framed={false} padding="md">
            Use unframed blocks only inside an already-framed parent surface.
          </Block>
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
