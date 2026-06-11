import { Button } from "../Button";
import { Icon } from "../Icon";
import { DemoRow, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { HoverInfo } from "./HoverInfo";

export function HoverInfoDemo() {
  return (
    <DemoSection title="HoverInfo" note="Compact hover/focus detail with viewport-aware placement.">
      <DemoSample label="tooltip triggers">
        <DemoRow>
          <HoverInfo content="Preview the selected component at project tempo.">
            <Button iconOnly aria-label="Preview component">
              <Icon name="ph:play-fill" size={16} decorative />
            </Button>
          </HoverInfo>
          <HoverInfo content="Arms this track for the next recording pass.">
            <Button>Arm</Button>
          </HoverInfo>
        </DemoRow>
      </DemoSample>
    </DemoSection>
  );
}
