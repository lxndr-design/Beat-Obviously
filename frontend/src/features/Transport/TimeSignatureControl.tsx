import { useState } from "react";
import { HoverInfo, Icon } from "../../components";
import type { TimeSignature } from "../../state/types";
import { TimeSignatureModal } from "./TimeSignatureModal";
import styles from "./TimeSignatureControl.module.css";

interface Props {
  value: TimeSignature;
  onChange: (value: TimeSignature) => void;
  ariaLabel?: string;
  direction?: "down" | "up";
}

const TS_PRESETS = ["4/4", "3/4", "6/8", "5/4", "7/8", "12/8"] as const;

export function TimeSignatureControl({
  value,
  onChange,
  ariaLabel = "Time signature",
  direction = "down",
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className={styles.wrap}>
      <HoverInfo content={ariaLabel}>
        <button
          type="button"
          className={styles.button}
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={ariaLabel}
          aria-expanded={menuOpen}
        >
          {value.num}/{value.denom}
          <Icon name={direction === "up" ? "ph:caret-up" : "ph:caret-down"} size={16} decorative />
        </button>
      </HoverInfo>
      {menuOpen && (
        <div className={`${styles.dropdown} ${direction === "up" ? styles.dropUp : ""}`} role="menu">
          {TS_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={styles.dropItem}
              onClick={() => {
                const [num, denom] = preset.split("/").map(Number);
                onChange({ num, denom, boldBeats: [1] });
                setMenuOpen(false);
              }}
            >
              {preset}
            </button>
          ))}
          <div className={styles.dropSep} />
          <button
            type="button"
            className={styles.dropItem}
            onClick={() => {
              setMenuOpen(false);
              setModalOpen(true);
            }}
          >
            Custom...
          </button>
        </div>
      )}
      {modalOpen && (
        <TimeSignatureModal
          value={value}
          onChange={onChange}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
