import { DitheredImage } from "./DitheredImage.solid";

const demoImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAGElEQVR4nGNkYGD4z8DAwMgABYwMjAACCgEABpMAf5S4JikAAAAASUVORK5CYII=";

export function DitheredImageSolidDemo() {
  return (
    <DitheredImage
      src={demoImage}
      alt="Dithered preview"
      width={64}
      height={64}
      fallback={<span>Image unavailable</span>}
    />
  );
}
