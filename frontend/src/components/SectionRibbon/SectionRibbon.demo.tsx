import { useState } from "react";
import { DemoGrid, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { Icon } from "../Icon";
import { SectionRibbon, SectionRibbonActionButton } from "./SectionRibbon";

export function SectionRibbonDemo() {
  const [expanded, setExpanded] = useState(true);

  return (
    <DemoSection title="SectionRibbon" note="Sidebar and panel section headers with count and action slots.">
      <DemoGrid>
        <DemoSample label="toggle with count and action">
          <SectionRibbon
            title="Instruments"
            expanded={expanded}
            count={8}
            onToggle={() => setExpanded((value) => !value)}
            actions={
              <SectionRibbonActionButton aria-label="Add instrument">
                <Icon name="ph:plus" size={16} decorative />
              </SectionRibbonActionButton>
            }
          />
        </DemoSample>
        <DemoSample label="static ribbon">
          <SectionRibbon title="Audio Files" expanded onToggle={() => undefined} showToggle={false} count={3} />
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
