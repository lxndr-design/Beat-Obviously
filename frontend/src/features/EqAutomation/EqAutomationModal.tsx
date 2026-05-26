import { Modal, Button, NumberInput, Knob } from "../../components";
import { useProjectStore, useUiStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import { EQ_BAND_COUNT, EQ_BAND_LABELS, type EqAutomationPoint } from "../../state/types";
import styles from "./EqAutomationModal.module.css";

/**
 * EqAutomationModal — whole-song 7-band master EQ with automation timeline.
 *
 * Each automation point holds 7 dB values matching EQ_BAND_CENTERS_HZ. Engine
 * interpolates linearly between adjacent points at playback time.
 */
export function EqAutomationModal() {
  const points = useProjectStore((s) => s.project.masterEqAutomation);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const setProject = useProjectStore((s) => s.loadProject);
  const project = useProjectStore((s) => s.project);

  function setPoints(next: EqAutomationPoint[]) {
    setProject({ ...project, masterEqAutomation: next });
    void send({ kind: "eq.setAutomation", points: next });
  }

  function addPoint() {
    const last = points[points.length - 1];
    const next: EqAutomationPoint[] = [
      ...points,
      {
        atBeat: last ? last.atBeat + 4 : 0,
        bandsDb: new Array(EQ_BAND_COUNT).fill(0),
      },
    ];
    setPoints(next);
  }

  function removePoint(idx: number) {
    setPoints(points.filter((_, i) => i !== idx));
  }

  function updatePointBeat(idx: number, atBeat: number) {
    setPoints(points.map((p, i) => (i === idx ? { ...p, atBeat } : p)));
  }

  function updateBand(idx: number, band: number, db: number) {
    setPoints(
      points.map((p, i) =>
        i === idx
          ? { ...p, bandsDb: p.bandsDb.map((d, b) => (b === band ? db : d)) }
          : p,
      ),
    );
  }

  return (
    <Modal
      open
      title="Master EQ — 7-band automation"
      width="lg"
      onClose={() => closeEditor({ kind: "eq" })}
      footer={
        <>
          <Button onClick={addPoint}>+ Add point</Button>
          <Button variant="primary" onClick={() => closeEditor({ kind: "eq" })}>
            Done
          </Button>
        </>
      }
    >
      <p className={styles.hint}>
        Engine interpolates between automation points during playback.
      </p>

      {points.length === 0 ? (
        <p className={styles.empty}>No automation points yet. Click "Add point".</p>
      ) : (
        <div className={styles.list}>
          {points.map((p, i) => (
            <div key={i} className={styles.point}>
              <NumberInput
                label="@beat"
                value={p.atBeat}
                min={0}
                step={0.25}
                onChange={(v) => updatePointBeat(i, v)}
              />
              {EQ_BAND_LABELS.map((label, band) => (
                <Knob
                  key={band}
                  value={p.bandsDb[band] ?? 0}
                  min={-24}
                  max={24}
                  step={0.1}
                  unit="dB"
                  label={label}
                  bipolar
                  size="sm"
                  onChange={(v) => updateBand(i, band, v)}
                />
              ))}
              <Button variant="ghost" size="sm" onClick={() => removePoint(i)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
