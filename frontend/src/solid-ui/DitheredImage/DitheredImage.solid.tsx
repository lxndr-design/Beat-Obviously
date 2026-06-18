import { createSignal, onMount, Show, splitProps, type JSX } from "solid-js";
import styles from "./DitheredImage.module.css";

export type DitheredImageProps = Omit<JSX.ImgHTMLAttributes<HTMLImageElement>, "onError" | "onLoad"> & {
  fallback?: JSX.Element;
  onError?: (event: ErrorEvent) => void;
  onLoad?: (event: Event) => void;
};

export function DitheredImage(allProps: DitheredImageProps) {
  const [props, rest] = splitProps(allProps, ["class", "fallback", "onError", "onLoad"]);
  const [ready, setReady] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let imageRef: HTMLImageElement | undefined;

  onMount(() => {
    if (imageRef?.complete) setReady(true);
  });

  return (
    <Show
      when={!failed()}
      fallback={<div class={styles.fallback} data-dithered-image-fallback>{props.fallback}</div>}
    >
      <img
        {...rest}
        ref={imageRef}
        class={`${styles.dithered} ${ready() ? styles.ready : ""} ${props.class ?? ""}`}
        data-dithered-image
        onError={(event) => {
          setFailed(true);
          props.onError?.(event);
        }}
        onLoad={(event) => {
          setReady(true);
          props.onLoad?.(event);
        }}
      />
    </Show>
  );
}
