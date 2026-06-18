import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "../Icon";
import styles from "./FloatingSelect.module.css";

export interface FloatingSelectOption {
  value: string;
  label: string;
}

interface FloatingSelectProps {
  value: string;
  options: FloatingSelectOption[];
  open: boolean;
  className?: string;
  fillHeight?: boolean;
  label?: string;
  layout?: "default" | "inline";
  ariaLabel?: string;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}

export function FloatingSelect(props: FloatingSelectProps) {
  let rootElement: HTMLDivElement | undefined;
  const [menuRect, setMenuRect] = createSignal<{ left: number; top: number; width: number; maxHeight: number } | null>(null, { equals: false });
  const selected = () => props.options.find((option) => option.value === props.value) ?? props.options[0];

  createEffect(() => {
    if (!props.open) {
      setMenuRect(null);
      return;
    }

    function position() {
      const rect = rootElement?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const estimatedHeight = Math.min(260, Math.max(24, props.options.length * 24));
      const availableBelow = window.innerHeight - rect.bottom - margin;
      const availableAbove = rect.top - margin;
      const openBelow = availableBelow >= Math.min(estimatedHeight, 144) || availableBelow >= availableAbove;
      const maxHeight = Math.max(96, Math.min(estimatedHeight, openBelow ? availableBelow : availableAbove));
      const top = openBelow ? rect.bottom - 1 : Math.max(margin, rect.top - maxHeight + 1);
      const width = Math.max(0, Math.min(rect.width, window.innerWidth - margin * 2));
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
      setMenuRect({ left, top, width, maxHeight });
    }

    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    onCleanup(() => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    });
  });

  const wrapClass = () => [
    styles.wrap,
    props.className,
    props.fillHeight && styles.fillHeight,
    props.layout === "inline" && styles.inline,
  ].filter(Boolean).join(" ");

  const menuStyle = (rect: NonNullable<ReturnType<typeof menuRect>>): JSX.CSSProperties => ({
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    "max-height": `${rect.maxHeight}px`,
    position: "fixed",
    "z-index": 4000,
  });

  return (
    <div ref={rootElement} class={wrapClass()} data-floating-layer>
      <Show when={props.label}><span class={styles.label}>{props.label}</span></Show>
      <button
        type="button"
        class={styles.trigger}
        onClick={() => props.onOpenChange(!props.open)}
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={props.open}
      >
        <span class={styles.text}>{selected()?.label ?? ""}</span>
        <Icon name="ph:caret-down" size={12} decorative />
      </button>
      <Show when={props.open && menuRect()}>
        {(rect) => (
          <Portal mount={document.body}>
            <div
              class={styles.menu}
              style={menuStyle(rect())}
              role="listbox"
              data-floating-layer
            >
              <For each={props.options}>
                {(option) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === selected()?.value}
                    class={`${styles.option} ${option.value === selected()?.value ? styles.optionSelected : ""}`}
                    onClick={() => {
                      props.onChange(option.value);
                      props.onOpenChange(false);
                    }}
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}
