import { DemoGrid, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { TextInput } from "./TextInput";

export function TextInputDemo() {
  return (
    <DemoSection title="TextInput" note="Text fields support stacked, inline, bare, and unit layouts.">
      <DemoGrid>
        <DemoSample label="stacked">
          <TextInput label="Track Name" defaultValue="Lead Synth" />
        </DemoSample>
        <DemoSample label="inline with unit">
          <TextInput label="Root" layout="inline" defaultValue="C3" unit="note" />
        </DemoSample>
        <DemoSample label="bare">
          <TextInput layout="bare" placeholder="Search samples" />
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
