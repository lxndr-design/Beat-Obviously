import { DemoSample, DemoSection } from "../../design/UiKitDemo";
import { FloatingLayer } from "./FloatingLayer";

export function FloatingLayerDemo() {
  return (
    <DemoSection title="FloatingLayer" note="Low-level positioned layer used by menus, selects, and tooltips.">
      <DemoSample label="fixed layer at viewport offset">
        <span>Layer renders through fixed positioning and data-floating-layer.</span>
        <FloatingLayer x={24} y={24} width={192} role="note">
          Floating layer
        </FloatingLayer>
      </DemoSample>
    </DemoSection>
  );
}
