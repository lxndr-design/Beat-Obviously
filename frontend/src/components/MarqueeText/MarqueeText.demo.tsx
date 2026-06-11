import { DemoGrid, DemoSample, DemoSection, constrainedDemoClassName } from "../../design/UiKitDemo";
import { MarqueeText } from "./MarqueeText";

export function MarqueeTextDemo() {
  return (
    <DemoSection title="MarqueeText" note="Single-line labels stay stable and only animate when text overflows.">
      <DemoGrid>
        <DemoSample label="short">
          <MarqueeText text="Kick Bus" />
        </DemoSample>
        <DemoSample label="overflow">
          <span className={constrainedDemoClassName}>
            <MarqueeText text="Imported Decent Sampler Percussion Palette Long Name" />
          </span>
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
