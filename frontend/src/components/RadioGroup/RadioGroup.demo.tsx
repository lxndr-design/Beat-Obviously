import { useState } from "react";
import { DemoGrid, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { RadioGroup } from "./RadioGroup";

export function RadioGroupDemo() {
  const [mode, setMode] = useState<"draw" | "select" | "split">("select");

  return (
    <DemoSection title="RadioGroup" note="Segmented mutually-exclusive controls fill their containing column.">
      <DemoGrid>
        <DemoSample label="active group">
          <RadioGroup
            label="Tool"
            ariaLabel="Piano roll tool"
            value={mode}
            options={[
              { value: "select", label: "Select" },
              { value: "draw", label: "Draw" },
              { value: "split", label: "Split" },
            ]}
            onChange={setMode}
          />
        </DemoSample>
        <DemoSample label="disabled">
          <RadioGroup
            label="Mode"
            ariaLabel="Disabled mode"
            value="grid"
            disabled
            options={[
              { value: "grid", label: "Grid" },
              { value: "free", label: "Free" },
            ]}
            onChange={() => undefined}
          />
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
