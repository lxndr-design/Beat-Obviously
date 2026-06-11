import { useState } from "react";
import { DemoGrid, DemoSample, DemoSection, constrainedDemoClassName } from "../../design/UiKitDemo";
import { FloatingSelect } from "./FloatingSelect";

const options = [
  { value: "bar", label: "Bar" },
  { value: "beat", label: "Beat" },
  { value: "sixteenth", label: "Sixteenth" },
  { value: "sample", label: "Sample Accurate" },
];

export function FloatingSelectDemo() {
  const [value, setValue] = useState("beat");
  const [open, setOpen] = useState(false);

  return (
    <DemoSection title="FloatingSelect" note="Compact listbox select for dense DAW surfaces.">
      <DemoGrid>
        <DemoSample label="default">
          <FloatingSelect
            value={value}
            options={options}
            open={open}
            onOpenChange={setOpen}
            onChange={setValue}
            ariaLabel="Snap resolution"
          />
        </DemoSample>
        <DemoSample label="inline constrained">
          <FloatingSelect
            className={constrainedDemoClassName}
            value={value}
            options={options}
            open={false}
            label="Grid"
            layout="inline"
            onOpenChange={() => undefined}
            onChange={setValue}
            ariaLabel="Inline snap resolution"
          />
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
