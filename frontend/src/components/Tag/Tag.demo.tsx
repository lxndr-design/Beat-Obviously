import { DemoGrid, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { Tag } from "./Tag";

export function TagDemo() {
  return (
    <DemoSection title="Tag" note="Compact tinted metadata labels without outlines.">
      <DemoGrid>
        <DemoSample label="counts">
          <Tag>26</Tag>
          <Tag>5</Tag>
          <Tag>0</Tag>
        </DemoSample>
        <DemoSample label="metadata">
          <Tag>Sampler</Tag>
          <Tag>DS</Tag>
          <Tag>MIDI</Tag>
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
