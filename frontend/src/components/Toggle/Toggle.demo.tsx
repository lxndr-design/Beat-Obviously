import { useState } from "react";
import { DemoGrid, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { Toggle } from "./Toggle";

export function ToggleDemo() {
  const [monitoring, setMonitoring] = useState(true);

  return (
    <DemoSection title="Toggle" note="Binary settings invert in place and avoid slide-switch motion.">
      <DemoGrid>
        <DemoSample label="on/off">
          <Toggle checked={monitoring} onChange={setMonitoring} label="Input Monitoring" />
        </DemoSample>
        <DemoSample label="disabled">
          <Toggle checked={false} onChange={() => undefined} label="Frozen" disabled />
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
