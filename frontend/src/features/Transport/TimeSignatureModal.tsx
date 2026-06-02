import { useState } from "react";
import { Modal, Button, FloatingSelect, NumberInput } from "../../components";
import { useProjectStore } from "../../state/store";
import type { TimeSignature } from "../../state/types";
import styles from "./TimeSignatureModal.module.css";

interface Props {
  value?: TimeSignature;
  onChange?: (value: TimeSignature) => void;
  onClose: () => void;
}

const DENOMS = [2, 4, 8, 16];

/**
 * TimeSignatureModal — set numerator, denominator, and which beats inside
 * the bar should get a bold tick.
 *
 * Example: 5/4 with boldBeats=[1, 4] renders bold tick marks on beats 1
 * and 4 of every bar (matching the user's example from the spec).
 */
export function TimeSignatureModal({ value, onChange, onClose }: Props) {
  const storeTs = useProjectStore((s) => s.project.timeSignature);
  const setStoreTs = useProjectStore((s) => s.setTimeSignature);
  const ts = value ?? storeTs;

  const [num, setNum] = useState(ts.num);
  const [denom, setDenom] = useState(ts.denom);
  const [bold, setBold] = useState<number[]>(ts.boldBeats);
  const [denomOpen, setDenomOpen] = useState(false);

  const dirty =
    num !== ts.num ||
    denom !== ts.denom ||
    bold.length !== ts.boldBeats.length ||
    bold.some((b, i) => b !== ts.boldBeats[i]);

  function toggleBold(beat: number) {
    setBold((prev) =>
      prev.includes(beat) ? prev.filter((b) => b !== beat) : [...prev, beat].sort((a, b) => a - b),
    );
  }

  function save() {
    const next = { num, denom, boldBeats: bold.filter((b) => b <= num) };
    if (onChange) onChange(next);
    else setStoreTs(next);
    onClose();
  }

  return (
    <Modal
      open
      title="Time signature"
      width="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!dirty} onClick={save}>Save</Button>
        </>
      }
    >
      <div className={styles.row}>
        <NumberInput
          label="Beats per bar"
          value={num}
          min={1}
          max={32}
          step={1}
          onChange={setNum}
        />
        <FloatingSelect
          label="Note value"
          value={String(denom)}
          ariaLabel="Note value"
          options={DENOMS.map((d) => ({ value: String(d), label: `1/${d}` }))}
          open={denomOpen}
          onOpenChange={setDenomOpen}
          onChange={(value) => setDenom(Number(value))}
        />
      </div>

      <div className={styles.boldSection}>
        <span className={styles.label}>Bold ticks (per bar)</span>
        <div className={styles.beatGrid}>
          {Array.from({ length: num }, (_, i) => i + 1).map((b) => (
            <button
              key={b}
              type="button"
              className={`${styles.beatCell} ${bold.includes(b) ? styles.beatActive : ""}`}
              onClick={() => toggleBold(b)}
              aria-pressed={bold.includes(b)}
              aria-label={`Beat ${b}`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
