import { useEffect, useMemo, useState } from "react";
import { Button, FloatingSelect, Icon, Modal, RadioGroup, Toggle } from "../../components";
import { getOllamaModel, setOllamaModel } from "../../ai/aiService";
import {
  exportDrumBeatFineTuneJsonl,
  exportInstrumentFineTuneJsonl,
  exportMidiSongFineTuneJsonl,
  getTrainingSignalStats,
  type TrainingSignalStats,
} from "../../persistence/dexie";
import {
  makeTrainingCheckpoints,
  maybeRunDueTraining,
  readTrainingCheckpoints,
  readTrainingStatuses,
  TRAINING_BREAKPOINT,
  type TrainingKind,
  type TrainingStatus,
} from "../../ai/trainingRunner";
import { onEvent } from "../../ipc/bridge";
import { useSettingsStore, useUiStore } from "../../state/store";
import styles from "./PreferencesModal.module.css";

export function PreferencesModal() {
  const closeEditor = useUiStore((s) => s.closeEditor);
  const settings = useSettingsStore();
  const [model, setModel] = useState(() => getOllamaModel());
  const [modelOpen, setModelOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [trainingStats, setTrainingStats] = useState<TrainingSignalStats>({ drums: 0, instruments: 0, midi: 0 });
  const [trainedAt, setTrainedAt] = useState<TrainingSignalStats>(() => readTrainingCheckpoints());
  const [trainingStatuses, setTrainingStatuses] = useState<Partial<Record<TrainingKind, TrainingStatus>>>(() => readTrainingStatuses());
  const dirty = model.trim() !== getOllamaModel();
  const checkpoints = useMemo(() => makeTrainingCheckpoints(trainingStats, trainedAt), [trainingStats, trainedAt]);

  useEffect(() => {
    void refreshTrainingStats();
    return onEvent((event) => {
      if (event.kind !== "training.status") return;
      void refreshTrainingStats();
    });
  }, []);

  function close() {
    closeEditor({ kind: "preferences" });
  }

  function save() {
    setOllamaModel(model);
    close();
  }

  async function refreshTrainingStats() {
    setTrainingStats(await getTrainingSignalStats());
    setTrainedAt(readTrainingCheckpoints());
    setTrainingStatuses(readTrainingStatuses());
  }

  async function runTraining(kind: TrainingKind) {
    const result = await maybeRunDueTraining(kind, { force: true });
    setTrainingStats(result.stats);
    setTrainedAt(result.trainedAt);
    setTrainingStatuses(result.statuses);
  }

  async function exportDataset() {
    const jsonl = await exportDrumBeatFineTuneJsonl();
    if (!jsonl.trim()) {
      setExportStatus("No rated or accepted generated beats yet.");
      return;
    }
    const blob = new Blob([`${jsonl}\n`], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `beat-drum-finetune-${new Date().toISOString().slice(0, 10)}.jsonl`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportStatus("Exported JSONL training dataset.");
  }

  async function exportInstrumentDataset() {
    const jsonl = await exportInstrumentFineTuneJsonl();
    if (!jsonl.trim()) {
      setExportStatus("No rated or accepted generated instruments yet.");
      return;
    }
    const blob = new Blob([`${jsonl}\n`], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `beat-instrument-finetune-${new Date().toISOString().slice(0, 10)}.jsonl`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportStatus("Exported instrument JSONL training dataset.");
  }

  async function exportMidiDataset() {
    const jsonl = await exportMidiSongFineTuneJsonl();
    if (!jsonl.trim()) {
      setExportStatus("No saved MIDI components, MIDI project segments, or MIDI generation feedback yet.");
      return;
    }
    const blob = new Blob([`${jsonl}\n`], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `beat-midi-song-finetune-${new Date().toISOString().slice(0, 10)}.jsonl`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportStatus("Exported MIDI/song JSONL training dataset.");
  }

  return (
    <Modal
      open
      scopeId="preferences"
      title={<><Icon name="ph:gear" size={14} decorative />Preferences</>}
      width="md"
      dirty={dirty}
      onClose={close}
      onRequestCloseDirty={save}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!dirty} onClick={save}>Save</Button>
        </>
      }
    >
      <div className={styles.panel}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Local AI</h3>
          <div className={styles.row}>
            <FloatingSelect
              label="Ollama model"
              layout="inline"
              value={model}
              ariaLabel="Ollama model"
              options={MODEL_OPTIONS.map((option) => ({ value: option, label: option }))}
              open={modelOpen}
              onOpenChange={setModelOpen}
              onChange={setModel}
            />
          </div>
          <p className={styles.hint}>
            Use a base model like qwen3:4b now, then switch this to your tuned model name after training, such as beat-qwen:latest.
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Smart Grid</h3>
          <div className={styles.gridRows}>
            <div className={styles.gridRow}>
              <Toggle
                label="Timeline"
                checked={settings.timelineSmartGrid}
                onChange={settings.setTimelineSmartGrid}
              />
              {settings.timelineSmartGrid && (
                <RadioGroup
                  ariaLabel="Timeline smart grid subdivision"
                  value={settings.timelineSubdivision}
                  options={SUBDIVISION_OPTIONS}
                  onChange={settings.setTimelineSubdivision}
                />
              )}
            </div>
            <div className={styles.gridRow}>
              <Toggle
                label="MIDI"
                checked={settings.midiSmartGrid}
                onChange={settings.setMidiSmartGrid}
              />
              {settings.midiSmartGrid && (
                <RadioGroup
                  ariaLabel="MIDI smart grid subdivision"
                  value={settings.midiSubdivision}
                  options={SUBDIVISION_OPTIONS}
                  onChange={settings.setMidiSubdivision}
                />
              )}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Training Checkpoints</h3>
          <div className={styles.checkpointList}>
            {checkpoints.map((checkpoint) => (
              <div key={checkpoint.kind} className={styles.checkpointRow}>
                <div className={styles.checkpointMeta}>
                  <span className={styles.checkpointName}>{checkpoint.label}</span>
                  <span className={styles.checkpointCount}>
                    {checkpoint.sinceLast}/{TRAINING_BREAKPOINT} new signals
                  </span>
                </div>
                <span className={checkpoint.ready ? styles.readyBadge : styles.waitingBadge}>
                  {formatCheckpointStatus(checkpoint.ready, checkpoint.remaining, trainingStatuses[checkpoint.kind])}
                </span>
                <Button
                  size="xs"
                  disabled={checkpoint.sinceLast === 0}
                  onClick={() => void runTraining(checkpoint.kind)}
                >
                  Run now
                </Button>
              </div>
            ))}
          </div>
          <div className={styles.exportActions}>
            <Button size="sm" onClick={() => void exportDataset()}>
              <Icon name="ph:download-simple" size={14} decorative />
              Export drums
            </Button>
            <Button size="sm" onClick={() => void exportInstrumentDataset()}>
              <Icon name="ph:download-simple" size={14} decorative />
              Export instruments
            </Button>
            <Button size="sm" onClick={() => void exportMidiDataset()}>
              <Icon name="ph:download-simple" size={14} decorative />
              Export MIDI
            </Button>
          </div>
          <p className={styles.hint}>
            Beat starts a local training checkpoint every {TRAINING_BREAKPOINT} new rated/accepted signals in the standalone app. Export keeps the dataset handoff inspectable.
          </p>
          {exportStatus && <p className={styles.hint}>{exportStatus}</p>}
        </section>
      </div>
    </Modal>
  );
}

const MODEL_OPTIONS = ["qwen3:4b", "qwen3:8b", "beat-qwen:latest", "beat-instrument-qwen:latest", "beat-midi-qwen:latest"];
const SUBDIVISION_OPTIONS = [
  { value: 2, label: "1/2" },
  { value: 4, label: "1/4" },
  { value: 8, label: "1/8" },
  { value: 16, label: "1/16" },
] as Array<{ value: 2 | 4 | 8 | 16; label: string }>;

function formatCheckpointStatus(
  ready: boolean,
  remaining: number,
  status: TrainingStatus | undefined,
) {
  if (status?.status === "running" || status?.status === "queued") return "Running";
  if (status?.status === "failed") {
    const message = status.message?.toLowerCase() ?? "";
    if (message.includes("native app")) return "Native only";
    if (message.includes("llamafactory") || message.includes("not found") || message.includes("missing")) return "Needs setup";
    return "Failed";
  }
  if (status?.status === "finished") return "Trained";
  if (ready) return "Ready";
  return `${remaining} left`;
}
