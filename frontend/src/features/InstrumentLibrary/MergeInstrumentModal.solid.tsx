/** @jsxImportSource solid-js */
import { createSignal, For, Show } from "solid-js";
import { Button, Modal } from "../../solid-ui";
import { useInstrumentStore, useUiStore } from "../../state/store";
import type { Id } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { editorRequestForInstrument } from "../InstrumentEditor/instrumentEditorRouting";
import styles from "./MergeInstrumentModal.module.css";

interface Props {
  sourceId: Id;
  onClose: () => void;
}

export function MergeInstrumentModalSolid(props: Props) {
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const [pickedId, setPickedId] = createSignal<Id | null>(null);
  const source = () => instruments().find((instrument) => instrument.id === props.sourceId);
  const others = () => instruments().filter((instrument) => instrument.id !== props.sourceId);

  function confirm() {
    const picked = pickedId();
    if (!picked) return;
    const id = useInstrumentStore.getState().mergeInstruments(props.sourceId, picked);
    if (id) {
      const instrument = useInstrumentStore.getState().instruments.find((candidate) => candidate.id === id);
      if (instrument) useUiStore.getState().openEditor(editorRequestForInstrument(instrument));
    }
    props.onClose();
  }

  return (
    <Modal
      open
      title={`Merge - ${source()?.name ?? ""}`}
      width="sm"
      onClose={props.onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" disabled={!pickedId()} onClick={confirm}>
            Merge
          </Button>
        </>
      )}
    >
      <Show when={others().length > 0} fallback={<p class={styles.empty}>No other instruments to merge with.</p>}>
        <ul class={styles.list}>
          <For each={others()}>
            {(instrument) => (
              <li>
                <button
                  type="button"
                  class={`${styles.option} ${pickedId() === instrument.id ? styles.selected : ""}`}
                  onClick={() => setPickedId(instrument.id)}
                >
                  <span class={styles.optionName}>{instrument.name}</span>
                  <span class={styles.optionKind}>{instrument.kind}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Modal>
  );
}
