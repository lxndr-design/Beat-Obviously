import { DemoRow, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { Icon } from "./Icon";

export function IconDemo() {
  return (
    <DemoSection title="Icon" note="Single Iconify wrapper. Product icons use the Phosphor ph: set.">
      <DemoSample label="allowed sizes">
        <DemoRow>
          <Icon name="ph:play-fill" size={12} title="Play" />
          <Icon name="ph:waveform" size={16} title="Waveform" />
          <Icon name="ph:sliders-horizontal" size={24} title="Controls" />
          <Icon name="ph:speaker-high" size={32} title="Output" />
          <Icon name="ph:piano-keys" size={40} title="Keys" />
        </DemoRow>
      </DemoSample>
    </DemoSection>
  );
}
