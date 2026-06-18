import { For, Show } from "solid-js";
import { Button, Knob, Modal, NumberInput } from "../../solid-ui";
import { send } from "../../ipc/bridge";
import { useProjectStore, useUiStore } from "../../state/store";
import { EQ_BAND_COUNT, EQ_BAND_LABELS, type EqAutomationPoint } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import styles from "./EqAutomationModal.module.css";

export function EqAutomationModalSolid() {
  const points = createStoreSelector(useProjectStore, (s) => s.project.masterEqAutomation);
  const project = createStoreSelector(useProjectStore, (s) => s.project);
  const closeEditor = useUiStore.getState().closeEditor;
  const setProject = useProjectStore.getState().loadProject;

  function setPoints(next: EqAutomationPoint[]) {
    setProject({ ...project(), masterEqAutomation: next });
    void send({ kind: "eq.setAutomation", points: next });
  }

  function addPoint() {
    const current = points();
    const last = current[current.length - 1];
    setPoints([
      ...current,
      {
        atBeat: last ? last.atBeat + 4 : 0,
        bandsDb: new Array(EQ_BAND_COUNT).fill(0),
      },
    ]);
  }

  function removePoint(index: number) {
    setPoints(points().filter((_, candidateIndex) => candidateIndex !== index));
  }

  function updatePointBeat(index: number, atBeat: number) {
    setPoints(points().map((point, candidateIndex) => (
      candidateIndex === index ? { ...point, atBeat } : point
    )));
  }

  function updateBand(index: number, band: number, db: number) {
    setPoints(points().map((point, candidateIndex) => (
      candidateIndex === index
        ? { ...point, bandsDb: point.bandsDb.map((value, valueIndex) => (valueIndex === band ? db : value)) }
        : point
    )));
  }

  function close() {
    closeEditor({ kind: "eq" });
  }

  return (
    <Modal
      open
      title="Master EQ - 7-band automation"
      width="lg"
      onClose={close}
      footer={
        <>
          <Button onClick={addPoint}>+ Add point</Button>
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <p class={styles.hint}>
        Engine interpolates between automation points during playback.
      </p>

      <Show
        when={points().length > 0}
        fallback={<p class={styles.empty}>No automation points yet. Click "Add point".</p>}
      >
        <div class={styles.list}>
          <For each={points()}>
            {(point, index) => (
              <div class={styles.point}>
                <NumberInput
                  label="@beat"
                  value={point.atBeat}
                  min={0}
                  step={0.25}
                  onChange={(value) => updatePointBeat(index(), value)}
                />
                <For each={EQ_BAND_LABELS}>
                  {(label, band) => (
                    <Knob
                      value={point.bandsDb[band()] ?? 0}
                      min={-24}
                      max={24}
                      step={0.1}
                      unit="dB"
                      label={label}
                      bipolar
                      size="sm"
                      onChange={(value) => updateBand(index(), band(), value)}
                    />
                  )}
                </For>
                <Button variant="ghost" size="sm" onClick={() => removePoint(index())}>
                  Remove
                </Button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Modal>
  );
}
