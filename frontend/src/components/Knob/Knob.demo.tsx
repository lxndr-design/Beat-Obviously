import { useState } from "react";
import { DemoGrid, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { Knob } from "./Knob";

export function KnobDemo() {
  const [cutoff, setCutoff] = useState(6400);
  const [pan, setPan] = useState(-0.2);

  return (
    <DemoSection title="Knob" note="Continuous parameters support drag, direct edit, keyboard nudging, and modulation labels.">
      <DemoGrid>
        <DemoSample label="monopolar with modulation">
          <Knob
            label="Cutoff"
            unit="Hz"
            min={20}
            max={20000}
            step={10}
            value={cutoff}
            defaultValue={2000}
            modulationAmount={0.34}
            formatValue={(value) => Math.round(value).toString()}
            onChange={setCutoff}
          />
        </DemoSample>
        <DemoSample label="bipolar">
          <Knob
            label="Pan"
            min={-1}
            max={1}
            step={0.01}
            value={pan}
            bipolar
            formatValue={(value) => value.toFixed(2)}
            onChange={setPan}
          />
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
