import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "../Icon";
import styles from "./FloatingSelect.module.css";

export interface FloatingSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface FloatingSelectProps {
  value: string;
  options: FloatingSelectOption[];
  open?: boolean;
  className?: string;
  triggerClassName?: string;
  fillHeight?: boolean;
  label?: string;
  layout?: "default" | "inline" | "bare";
  ariaLabel?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  onOpenChange?: (open: boolean) => void;
  onChange: (value: string) => void;
}

export function FloatingSelect(props: FloatingSelectProps) {
  let rootElement: HTMLDivElement | undefined;
  const [internalOpen, setInternalOpen] = createSignal(false);
  const [menuRect, setMenuRect] = createSignal<{ left: number; top: number; width: number; maxHeight: number } | null>(null, { equals: false });
  const [query, setQuery] = createSignal("");
  const open = () => props.open ?? internalOpen();
  const setOpen = (next: boolean) => {
    if (props.disabled) return;
    if (props.open === undefined) setInternalOpen(next);
    props.onOpenChange?.(next);
  };
  const selected = () => props.options.find((option) => option.value === props.value) ?? props.options[0];
  const filteredOptions = createMemo(() => {
    const normalized = query().trim().toLowerCase();
    if (!normalized) return props.options;
    return props.options.filter((option) => option.label.toLowerCase().includes(normalized));
  });

  createEffect(() => {
    if (!open()) {
      setMenuRect(null);
      setQuery("");
      return;
    }

    function position() {
      const rect = rootElement?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const searchHeight = props.searchable ? 33 : 0;
      const estimatedHeight = Math.min(260, Math.max(24, props.options.length * 24 + searchHeight));
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
    props.layout === "bare" && styles.bare,
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
        class={[styles.trigger, props.triggerClassName].filter(Boolean).join(" ")}
        onClick={() => setOpen(!open())}
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open()}
        disabled={props.disabled}
      >
        <span class={styles.text}>{selected()?.label ?? ""}</span>
        <Icon name="ph:caret-down" size={18} decorative />
      </button>
      <Show when={open() && menuRect()}>
        {(rect) => (
          <Portal mount={document.body}>
            <div
              class={styles.menu}
              style={menuStyle(rect())}
              role="listbox"
              data-floating-layer
            >
              <Show when={props.searchable}>
                <input
                  class={styles.search}
                  type="search"
                  value={query()}
                  placeholder={props.searchPlaceholder ?? "Search"}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </Show>
              <Show when={filteredOptions().length > 0} fallback={<div class={styles.empty}>No matches</div>}>
              <For each={filteredOptions()}>
                {(option) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === selected()?.value}
                    disabled={option.disabled}
                    class={`${styles.option} ${option.value === selected()?.value ? styles.optionSelected : ""}`}
                    onClick={() => {
                      if (option.disabled) return;
                      props.onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                )}
              </For>
              </Show>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}
