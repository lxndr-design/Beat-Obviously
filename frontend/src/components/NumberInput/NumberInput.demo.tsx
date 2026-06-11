import { useState } from "react";
import { DemoGrid, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { NumberInput } from "./NumberInput";

export function NumberInputDemo() {
  const [bpm, setBpm] = useState(132);
  const [gain, setGain] = useState(-6);

  return (
    <DemoSection title="NumberInput" note="Numeric fields clamp, commit, and support arrow-key stepping.">
      <DemoGrid>
        <DemoSample label="stacked">
          <NumberInput label="Tempo" value={bpm} min={20} max={300} step={1} unit="bpm" onChange={setBpm} />
        </DemoSample>
        <DemoSample label="inline">
          <NumberInput label="Gain" value={gain} min={-48} max={24} step={0.5} unit="dB" layout="inline" onChange={setGain} />
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
