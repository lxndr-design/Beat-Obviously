import { DemoGrid, DemoSample, DemoSection } from "../../design/UiKitDemo";
import { DitheredImage } from "./DitheredImage";

const demoImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='96' viewBox='0 0 160 96'%3E%3Crect width='160' height='96' fill='white'/%3E%3Ccircle cx='48' cy='48' r='32' fill='black'/%3E%3Crect x='88' y='16' width='48' height='64' fill='%23777'/%3E%3Cpath d='M0 96 L160 0' stroke='%23000' stroke-width='8'/%3E%3C/svg%3E";

export function DitheredImageDemo() {
  return (
    <DemoSection title="DitheredImage" note="Raster previews render only the black-and-white dithered result.">
      <DemoGrid>
        <DemoSample label="threshold 128">
          <DitheredImage src={demoImage} alt="Dithered synth pack preview" width={160} height={96} />
        </DemoSample>
        <DemoSample label="threshold 190">
          <DitheredImage src={demoImage} alt="High-threshold dithered preview" width={160} height={96} threshold={190} />
        </DemoSample>
      </DemoGrid>
    </DemoSection>
  );
}
