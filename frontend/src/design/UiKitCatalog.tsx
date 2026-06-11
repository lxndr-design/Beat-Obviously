import { ActionFooterDemo } from "../components/ActionFooter/ActionFooter.demo";
import { BlockDemo } from "../components/Block/Block.demo";
import { ButtonDemo } from "../components/Button/Button.demo";
import { ContextMenuDemo } from "../components/ContextMenu/ContextMenu.demo";
import { DitheredImageDemo } from "../components/DitheredImage/DitheredImage.demo";
import { FloatingLayerDemo } from "../components/FloatingLayer/FloatingLayer.demo";
import { FloatingSelectDemo } from "../components/FloatingSelect/FloatingSelect.demo";
import { HoverInfoDemo } from "../components/HoverInfo/HoverInfo.demo";
import { IconDemo } from "../components/Icon/Icon.demo";
import { KnobDemo } from "../components/Knob/Knob.demo";
import { MarqueeTextDemo } from "../components/MarqueeText/MarqueeText.demo";
import { ModalDemo } from "../components/Modal/Modal.demo";
import { NumberInputDemo } from "../components/NumberInput/NumberInput.demo";
import { RadioGroupDemo } from "../components/RadioGroup/RadioGroup.demo";
import { SectionRibbonDemo } from "../components/SectionRibbon/SectionRibbon.demo";
import { TextInputDemo } from "../components/TextInput/TextInput.demo";
import { ToggleDemo } from "../components/Toggle/Toggle.demo";
import { DemoGrid, DemoSection, DemoSwatch, UiKitDemoPage } from "./UiKitDemo";

export function UiKitCatalog() {
  return (
    <UiKitDemoPage>
      <FoundationsDemo />
      <ButtonDemo />
      <IconDemo />
      <BlockDemo />
      <SectionRibbonDemo />
      <ActionFooterDemo />
      <TextInputDemo />
      <NumberInputDemo />
      <RadioGroupDemo />
      <ToggleDemo />
      <FloatingSelectDemo />
      <ContextMenuDemo />
      <HoverInfoDemo />
      <KnobDemo />
      <MarqueeTextDemo />
      <DitheredImageDemo />
      <FloatingLayerDemo />
      <ModalDemo />
    </UiKitDemoPage>
  );
}

function FoundationsDemo() {
  return (
    <DemoSection title="Foundations" note="Tokens are the contract. Component CSS should consume these instead of raw values.">
      <DemoGrid>
        <DemoSwatch label="--color-bg" style={{ background: "var(--color-bg)" }} />
        <DemoSwatch label="--color-fg" style={{ background: "var(--color-fg)" }} />
        <DemoSwatch label="--surface-subtle" style={{ background: "var(--surface-subtle)" }} />
        <DemoSwatch label="--surface-selected" style={{ background: "var(--surface-selected)" }} />
      </DemoGrid>
    </DemoSection>
  );
}
