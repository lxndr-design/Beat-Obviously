import { useState } from "react";
import { Modal, Button } from "../../components";
import { useInstrumentStore, useUiStore } from "../../state/store";
import type { Id } from "../../state/types";
import styles from "./MergeInstrumentModal.module.css";

interface Props {
  sourceId: Id;
  onClose: () => void;
}

/**
 * MergeInstrumentModal — pick a second instrument to merge with `sourceId`.
 *
 * The merge action itself lives in the instrument store (averages knobs +
 * envelope, unions samples, credits both as parents). After creation, the
 * editor opens automatically on the new instrument.
 */
export function MergeInstrumentModal({ sourceId, onClose }: Props) {
  const instruments = useInstrumentStore((s) => s.instruments);
  const merge = useInstrumentStore((s) => s.mergeInstruments);
  const openEditor = useUiStore((s) => s.openEditor);
  const [pickedId, setPickedId] = useState<Id | null>(null);

  const source = instruments.find((i) => i.id === sourceId);
  const others = instruments.filter((i) => i.id !== sourceId);

  function confirm() {
    if (!pickedId) return;
    const id = merge(sourceId, pickedId);
    if (id) openEditor({ kind: "instrument", instrumentId: id });
    onClose();
  }

  return (
    <Modal
      open
      title={`Merge — ${source?.name ?? ""}`}
      width="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!pickedId} onClick={confirm}>
            Merge
          </Button>
        </>
      }
    >
      {others.length === 0 ? (
        <p className={styles.empty}>No other instruments to merge with.</p>
      ) : (
        <ul className={styles.list}>
          {others.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className={`${styles.option} ${pickedId === i.id ? styles.selected : ""}`}
                onClick={() => setPickedId(i.id)}
              >
                <span className={styles.optionName}>{i.name}</span>
                <span className={styles.optionKind}>{i.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
