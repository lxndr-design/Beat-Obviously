import { useEffect, useRef, useState } from "react";
import styles from "./DitheredImage.module.css";

export interface DitheredImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** Threshold for B&W conversion before dithering. 0..255, default 128. */
  threshold?: number;
  className?: string;
}

/**
 * DitheredImage — render any raster image as B&W with Floyd-Steinberg dither.
 *
 * Per design spec, we never display the original image. We:
 * 1. Load it into an off-screen canvas at the target size.
 * 2. Convert to grayscale.
 * 3. Apply Floyd-Steinberg error-diffusion dithering.
 * 4. Render only the dithered canvas, never the source <img>.
 */
export function DitheredImage({
  src,
  alt,
  width,
  height,
  threshold = 128,
  className,
}: DitheredImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      // Pixel-perfect: disable smoothing so the dither stays crisp.
      ctx.imageSmoothingEnabled = false;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      // Pre-step: convert to grayscale buffer for in-place error diffusion.
      const buf = new Float32Array(width * height);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        // ITU-R BT.709 luma
        buf[j] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      }

      // Floyd-Steinberg
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const old = buf[idx];
          const newPx = old < threshold ? 0 : 255;
          buf[idx] = newPx;
          const err = old - newPx;
          if (x + 1 < width) buf[idx + 1] += (err * 7) / 16;
          if (y + 1 < height) {
            if (x > 0) buf[idx + width - 1] += (err * 3) / 16;
            buf[idx + width] += (err * 5) / 16;
            if (x + 1 < width) buf[idx + width + 1] += (err * 1) / 16;
          }
        }
      }

      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const v = buf[j];
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      setReady(true);
    };
    img.src = src;
  }, [src, width, height, threshold]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      aria-label={alt}
      role="img"
      className={`${styles.dithered} ${ready ? styles.ready : ""} ${className ?? ""}`}
      style={{ width, height }}
    />
  );
}
