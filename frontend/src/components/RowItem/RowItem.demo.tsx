import { Button } from "../Button";
import { Icon } from "../Icon";
import { DemoGrid, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { RowItem } from "./RowItem";

export function RowItemDemo() {
  return (
    <DemoSection title="RowItem" note="Shared library/browser row primitive with drag, icon, text, metadata, and action slots.">
      <DemoGrid>
        <DemoSample label="compact draggable">
          <ul>
            <RowItem
              density="compact"
              cursor="grab"
              icon={<Icon name="ph:piano-keys" size={14} decorative />}
              hoverIcon={<Icon name="ph:dots-six-vertical" size={14} decorative />}
              name="Four on the Floor"
              action={(
                <Button iconOnly size="sm" aria-label="Play component">
                  <Icon name="ph:play-fill" size={12} decorative />
                </Button>
              )}
            />
          </ul>
        </DemoSample>
        <DemoSample label="media row">
          <ul>
            <RowItem
              density="media"
              icon={<Icon name="ph:wave-sine" size={14} decorative />}
              name="Aether Bridge Host"
              meta="Beat / synth / available"
              detail="v0.1.0"
              action={(
                <Button iconOnly size="sm" aria-label="Open plugin">
                  <Icon name="ph:box-arrow-up-right" size={12} decorative />
                </Button>
              )}
            />
          </ul>
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
