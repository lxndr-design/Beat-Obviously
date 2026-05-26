import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FloatingLayer } from "../FloatingLayer";
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
  fillHeight?: boolean;
  label?: string;
  layout?: "default" | "inline";
  ariaLabel?: string;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}

export function FloatingSelect({
  value,
  options,
  open,
  fillHeight = false,
  label,
  layout = "default",
  ariaLabel,
  onOpenChange,
  onChange,
}: FloatingSelectProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    function position() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuRect({ left: rect.left, top: rect.bottom - 1, width: rect.width });
    }

    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  return (
    <div
      className={[
        styles.wrap,
        fillHeight && styles.fillHeight,
        layout === "inline" && styles.inline,
      ].filter(Boolean).join(" ")}
      data-floating-layer
    >
      {label && <span className={styles.label}>{label}</span>}
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        onClick={() => onOpenChange(!open)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.text}>{selected?.label ?? ""}</span>
        <Icon name="ph:caret-down" size={12} decorative />
      </button>
      {open && menuRect && createPortal(
        <FloatingLayer
          className={styles.menu}
          x={menuRect.left}
          y={menuRect.top}
          width={menuRect.width}
          role="listbox"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === selected?.value}
              className={`${styles.option} ${option.value === selected?.value ? styles.optionSelected : ""}`}
              onClick={() => {
                onChange(option.value);
                onOpenChange(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </FloatingLayer>,
        document.body,
      )}
    </div>
  );
}
