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
import { onEvent, send } from "../../ipc/bridge";
import type { AudioDeviceInfo, AudioDeviceSnapshot } from "../../ipc/schema";
import {
  useSettingsStore,
  useUiStore,
  type AudioLatencyMode,
  type FileAssetPolicy,
  type MemoryCachePreset,
  type StartupProjectBehavior,
} from "../../state/store";
import styles from "./PreferencesModal.module.css";

export function PreferencesModal() {
  const closeEditor = useUiStore((s) => s.closeEditor);
  const settings = useSettingsStore();
  const [activeTab, setActiveTab] = useState<PreferenceTab>("audio");
  const [model, setModel] = useState(() => getOllamaModel());
  const [modelOpen, setModelOpen] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [sampleRateOpen, setSampleRateOpen] = useState(false);
  const [bufferOpen, setBufferOpen] = useState(false);
  const [latencyOpen, setLatencyOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [assetPolicyOpen, setAssetPolicyOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [startupOpen, setStartupOpen] = useState(false);
  const [deviceSnapshot, setDeviceSnapshot] = useState<AudioDeviceSnapshot | null>(null);
  const [deviceStatus, setDeviceStatus] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [trainingStats, setTrainingStats] = useState<TrainingSignalStats>({ drums: 0, instruments: 0, midi: 0 });
  const [trainedAt, setTrainedAt] = useState<TrainingSignalStats>(() => readTrainingCheckpoints());
  const [trainingStatuses, setTrainingStatuses] = useState<Partial<Record<TrainingKind, TrainingStatus>>>(() => readTrainingStatuses());
  const dirty = model.trim() !== getOllamaModel();
  const checkpoints = useMemo(() => makeTrainingCheckpoints(trainingStats, trainedAt), [trainingStats, trainedAt]);
  const inputOptions = useMemo(() => deviceOptions(deviceSnapshot, "input"), [deviceSnapshot]);
  const outputOptions = useMemo(() => deviceOptions(deviceSnapshot, "output"), [deviceSnapshot]);
  const selectedInputValue = selectedDeviceValue(
    inputOptions,
    settings.preferredAudioTypeName,
    settings.preferredInputDeviceName || deviceSnapshot?.currentInputName || "",
  );
  const selectedOutputValue = selectedDeviceValue(
    outputOptions,
    deviceSnapshot?.currentTypeName || "",
    settings.preferredOutputDeviceName || deviceSnapshot?.currentOutputName || "",
  );

  useEffect(() => {
    void refreshTrainingStats();
    void refreshDevices();
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

  function selectTab(tab: PreferenceTab) {
    setActiveTab(tab);
    setInputOpen(false);
    setOutputOpen(false);
    setSampleRateOpen(false);
    setBufferOpen(false);
    setLatencyOpen(false);
    setRecentOpen(false);
    setAssetPolicyOpen(false);
    setMemoryOpen(false);
    setStartupOpen(false);
    setModelOpen(false);
  }

  async function refreshDevices() {
    try {
      const response = await send({ kind: "audio.listDevices" });
      setDeviceSnapshot(response.snapshot);
      setDeviceStatus(response.snapshot.currentTypeName ? "Audio ready" : "Audio unavailable");
    } catch (error) {
      setDeviceStatus(error instanceof Error ? error.message : "Audio unavailable");
    }
  }

  async function selectInputDevice(value: string) {
    setInputOpen(false);
    const device = parseDeviceValue(value);
    settings.setPreferredInputDevice(device?.typeName ?? "", device?.name ?? "");
    if (!device) {
      setDeviceStatus("Following system input");
      return;
    }

    try {
      const response = await send({
        kind: "audio.selectInputDevice",
        typeName: device.typeName,
        deviceName: device.name,
        inputChannelCount: settings.defaultInputChannelCount,
      });
      setDeviceSnapshot(response.snapshot);
      setDeviceStatus(response.ok ? "Input selected" : response.error ?? "Input selection unavailable");
    } catch (error) {
      setDeviceStatus(error instanceof Error ? error.message : "Input selection unavailable");
    }
  }

  function selectOutputDevice(value: string) {
    setOutputOpen(false);
    const device = parseDeviceValue(value);
    settings.setPreferredOutputDevice(device?.typeName ?? "", device?.name ?? "");
    setDeviceStatus(device ? "Output preference saved" : "Following system output");
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
      width="lg"
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
        <div className={styles.tabs} role="tablist" aria-label="Preferences sections">
          {PREFERENCE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`${styles.tabButton} ${activeTab === tab.id ? styles.tabButtonActive : ""}`}
              onClick={() => selectTab(tab.id)}
            >
              <Icon name={tab.icon} size={14} decorative />
              {tab.label}
            </button>
          ))}
        </div>

        <div
          className={styles.tabContent}
          role="tabpanel"
          aria-label={PREFERENCE_TABS.find((tab) => tab.id === activeTab)?.label}
        >
          {activeTab === "audio" && (
            <>
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h3 className={styles.sectionTitle}>Audio I/O</h3>
                  <Button size="xs" onClick={() => void refreshDevices()}>
                    <Icon name="ph:arrows-clockwise" size={14} decorative />
                    Refresh
                  </Button>
                </div>
                <div className={styles.settingsGrid}>
                  <FloatingSelect
                    className={styles.fieldSelect}
                    label="Input"
                    layout="inline"
                    value={selectedInputValue}
                    ariaLabel="Audio input device"
                    options={inputOptions}
                    open={inputOpen}
                    onOpenChange={setInputOpen}
                    onChange={(value) => void selectInputDevice(value)}
                  />
                  <FloatingSelect
                    className={styles.fieldSelect}
                    label="Output"
                    layout="inline"
                    value={selectedOutputValue}
                    ariaLabel="Audio output device"
                    options={outputOptions}
                    open={outputOpen}
                    onOpenChange={setOutputOpen}
                    onChange={selectOutputDevice}
                  />
                  <Readout label="Driver" value={deviceSnapshot?.currentTypeName || "System"} />
                  <FloatingSelect
                    className={styles.fieldSelect}
                    label="Rate"
                    layout="inline"
                    value={String(settings.preferredSampleRate)}
                    ariaLabel="Audio sample rate"
                    options={SAMPLE_RATE_OPTIONS}
                    open={sampleRateOpen}
                    onOpenChange={setSampleRateOpen}
                    onChange={(value) => settings.setPreferredSampleRate(Number(value))}
                  />
                  <FloatingSelect
                    className={styles.fieldSelect}
                    label="Buffer"
                    layout="inline"
                    value={String(settings.preferredBufferSize)}
                    ariaLabel="Audio buffer size"
                    options={BUFFER_SIZE_OPTIONS}
                    open={bufferOpen}
                    onOpenChange={setBufferOpen}
                    onChange={(value) => settings.setPreferredBufferSize(Number(value))}
                  />
                  <FloatingSelect
                    className={styles.fieldSelect}
                    label="Latency"
                    layout="inline"
                    value={settings.audioLatencyMode}
                    ariaLabel="Audio latency handling"
                    options={LATENCY_MODE_OPTIONS}
                    open={latencyOpen}
                    onOpenChange={setLatencyOpen}
                    onChange={(value) => settings.setAudioLatencyMode(value as AudioLatencyMode)}
                  />
                </div>
                <div className={styles.channelGrid}>
                  <Readout label="Inputs" value={formatChannels(deviceSnapshot?.inputChannelNames)} />
                  <Readout label="Outputs" value={formatChannels(deviceSnapshot?.outputChannelNames)} />
                  <Readout label="Current rate" value={formatSampleRate(deviceSnapshot?.sampleRate)} />
                  <Readout label="Current buffer" value={formatBufferSize(deviceSnapshot?.bufferSize)} />
                  <Readout label="Reported latency" value={formatLatency(deviceSnapshot)} />
                </div>
                {deviceStatus && <p className={styles.hint}>{deviceStatus}</p>}
              </section>

              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Recording Defaults</h3>
                <div className={styles.gridRows}>
                  <div className={styles.gridRow}>
                    <Toggle
                      className={styles.gridToggle}
                      labelClassName={styles.gridToggleLabel}
                      label="Monitor"
                      checked={settings.defaultInputMonitoring}
                      onChange={settings.setDefaultInputMonitoring}
                    />
                    <RadioGroup
                      className={`${styles.gridRadio} ${styles.channelRadio}`}
                      ariaLabel="Default recording input channels"
                      value={settings.defaultInputChannelCount}
                      options={CHANNEL_COUNT_OPTIONS}
                      onChange={settings.setDefaultInputChannelCount}
                    />
                  </div>
                  <div className={styles.gridRow}>
                    <Toggle
                      className={styles.gridToggle}
                      labelClassName={styles.gridToggleLabel}
                      label="Arm"
                      checked={settings.defaultRecordArm}
                      onChange={settings.setDefaultRecordArm}
                    />
                    <Readout label="New tracks" value={settings.defaultRecordArm ? "Armed" : "Idle"} />
                  </div>
                </div>
              </section>
            </>
          )}

          {activeTab === "files" && (
            <>
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>File Handling</h3>
                <div className={styles.settingsGrid}>
                  <FloatingSelect
                    className={styles.fieldSelect}
                    label="Assets"
                    layout="inline"
                    value={settings.fileAssetPolicy}
                    ariaLabel="Default asset handling"
                    options={ASSET_POLICY_OPTIONS}
                    open={assetPolicyOpen}
                    onOpenChange={setAssetPolicyOpen}
                    onChange={(value) => settings.setFileAssetPolicy(value as FileAssetPolicy)}
                  />
                  <FloatingSelect
                    className={styles.fieldSelect}
                    label="Recents"
                    layout="inline"
                    value={String(settings.maxRecentProjects)}
                    ariaLabel="Recent project limit"
                    options={RECENT_PROJECT_OPTIONS}
                    open={recentOpen}
                    onOpenChange={setRecentOpen}
                    onChange={(value) => settings.setMaxRecentProjects(Number(value))}
                  />
                  <Toggle
                    className={styles.inlineToggle}
                    labelClassName={styles.gridToggleLabel}
                    label="Backups"
                    checked={settings.autosaveBackups}
                    onChange={settings.setAutosaveBackups}
                  />
                </div>
              </section>

              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Memory & Startup</h3>
                <div className={styles.settingsGrid}>
                  <FloatingSelect
                    className={styles.fieldSelect}
                    label="Cache"
                    layout="inline"
                    value={settings.memoryCachePreset}
                    ariaLabel="Preview cache memory"
                    options={MEMORY_CACHE_OPTIONS}
                    open={memoryOpen}
                    onOpenChange={setMemoryOpen}
                    onChange={(value) => settings.setMemoryCachePreset(value as MemoryCachePreset)}
                  />
                  <FloatingSelect
                    className={styles.fieldSelect}
                    label="Startup"
                    layout="inline"
                    value={settings.startupProjectBehavior}
                    ariaLabel="Startup project behavior"
                    options={STARTUP_OPTIONS}
                    open={startupOpen}
                    onOpenChange={setStartupOpen}
                    onChange={(value) => {
                      settings.setStartupProjectBehavior(value as StartupProjectBehavior);
                      settings.setRestoreLastProject(value === "restore-last");
                    }}
                  />
                  <Toggle
                    className={styles.inlineToggle}
                    labelClassName={styles.gridToggleLabel}
                    label="Restore"
                    checked={settings.restoreLastProject}
                    onChange={(enabled) => {
                      settings.setRestoreLastProject(enabled);
                      settings.setStartupProjectBehavior(enabled ? "restore-last" : "home");
                    }}
                  />
                </div>
              </section>
            </>
          )}

          {activeTab === "grid" && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Smart Grid</h3>
              <div className={styles.gridRows}>
                <div className={styles.gridRow}>
                  <Toggle
                    className={styles.gridToggle}
                    labelClassName={styles.gridToggleLabel}
                    label="Timeline"
                    checked={settings.timelineSmartGrid}
                    onChange={settings.setTimelineSmartGrid}
                  />
                  <RadioGroup
                    className={styles.gridRadio}
                    ariaLabel="Timeline smart grid subdivision"
                    value={settings.timelineSubdivision}
                    options={SUBDIVISION_OPTIONS}
                    disabled={!settings.timelineSmartGrid}
                    onChange={settings.setTimelineSubdivision}
                  />
                </div>
                <div className={styles.gridRow}>
                  <Toggle
                    className={styles.gridToggle}
                    labelClassName={styles.gridToggleLabel}
                    label="MIDI"
                    checked={settings.midiSmartGrid}
                    onChange={settings.setMidiSmartGrid}
                  />
                  <RadioGroup
                    className={styles.gridRadio}
                    ariaLabel="MIDI smart grid subdivision"
                    value={settings.midiSubdivision}
                    options={SUBDIVISION_OPTIONS}
                    disabled={!settings.midiSmartGrid}
                    onChange={settings.setMidiSubdivision}
                  />
                </div>
              </div>
            </section>
          )}

          {activeTab === "ai" && (
            <>
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Local AI</h3>
                <div className={styles.row}>
                  <FloatingSelect
                    className={styles.modelSelect}
                    label="AI model"
                    layout="inline"
                    value={model}
                    ariaLabel="AI model"
                    options={MODEL_OPTIONS.map((option) => ({ value: option, label: option }))}
                    open={modelOpen}
                    onOpenChange={setModelOpen}
                    onChange={setModel}
                  />
                </div>
                <p className={styles.hint}>
                  Used for local beat generation, instrument generation, MIDI/song ideas, and training-assisted suggestions. Use a base model now, then switch to a tuned Beat model after training.
                </p>
              </section>

              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Local AI Training Status</h3>
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
                        Send
                      </Button>
                    </div>
                  ))}
                </div>
                <div className={styles.exportActions}>
                  <Button size="sm" onClick={() => void exportDataset()}>
                    <Icon name="ph:download-simple" size={14} decorative />
                    Drum training data
                  </Button>
                  <Button size="sm" onClick={() => void exportInstrumentDataset()}>
                    <Icon name="ph:download-simple" size={14} decorative />
                    Instrument training data
                  </Button>
                  <Button size="sm" onClick={() => void exportMidiDataset()}>
                    <Icon name="ph:download-simple" size={14} decorative />
                    MIDI training data
                  </Button>
                </div>
                <p className={styles.hint}>
                  Send queues the current JSONL dataset into the local native trainer. The buttons below only download inspectable dataset backups; they do not export project audio or MIDI files.
                </p>
                {exportStatus && <p className={styles.hint}>{exportStatus}</p>}
              </section>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

type PreferenceTab = "audio" | "files" | "grid" | "ai";

const PREFERENCE_TABS: Array<{ id: PreferenceTab; label: string; icon: string }> = [
  { id: "audio", label: "Audio", icon: "ph:speaker-high" },
  { id: "files", label: "Files", icon: "ph:folder-open" },
  { id: "grid", label: "Grid", icon: "ph:grid-four" },
  { id: "ai", label: "AI", icon: "ph:sparkle" },
];

const MODEL_OPTIONS = ["qwen3:4b", "qwen3:8b", "beat-qwen:latest", "beat-instrument-qwen:latest", "beat-midi-qwen:latest"];
const DEVICE_VALUE_SEPARATOR = "\u001f";

const SUBDIVISION_OPTIONS = [
  { value: 2, label: "1/2" },
  { value: 4, label: "1/4" },
  { value: 8, label: "1/8" },
  { value: 16, label: "1/16" },
] as Array<{ value: 2 | 4 | 8 | 16; label: string }>;
const CHANNEL_COUNT_OPTIONS = [
  { value: 1, label: "Mono" },
  { value: 2, label: "Stereo" },
] as Array<{ value: 1 | 2; label: string }>;
const ASSET_POLICY_OPTIONS = [
  { value: "copy", label: "Copy" },
  { value: "reference", label: "Reference" },
  { value: "ask", label: "Ask" },
];
const MEMORY_CACHE_OPTIONS = [
  { value: "conservative", label: "Conservative" },
  { value: "balanced", label: "Balanced" },
  { value: "performance", label: "Performance" },
];
const STARTUP_OPTIONS = [
  { value: "home", label: "Home" },
  { value: "restore-last", label: "Restore last" },
  { value: "new-project", label: "New project" },
];
const RECENT_PROJECT_OPTIONS = ["4", "8", "12", "16", "24"].map((value) => ({ value, label: value }));
const SAMPLE_RATE_OPTIONS = [44100, 48000, 88200, 96000, 192000].map((value) => ({
  value: String(value),
  label: formatSampleRate(value),
}));
const BUFFER_SIZE_OPTIONS = [64, 128, 256, 512, 1024, 2048].map((value) => ({
  value: String(value),
  label: formatBufferSize(value),
}));
const LATENCY_MODE_OPTIONS: Array<{ value: AudioLatencyMode; label: string }> = [
  { value: "reported", label: "Reported" },
  { value: "low", label: "Low" },
  { value: "balanced", label: "Balanced" },
  { value: "safe", label: "Safe" },
];

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.readout}>
      <span className={styles.readoutLabel}>{label}</span>
      <span className={styles.readoutValue}>{value}</span>
    </div>
  );
}

function deviceOptions(snapshot: AudioDeviceSnapshot | null, direction: "input" | "output") {
  const devices = snapshot?.devices.filter((device) => direction === "input" ? device.input : device.output) ?? [];
  return [
    { value: "system", label: "System" },
    ...devices.map((device) => ({
      value: deviceValue(device),
      label: `${device.name}${device.typeName ? ` / ${device.typeName}` : ""}`,
    })),
  ];
}

function selectedDeviceValue(
  options: Array<{ value: string; label: string }>,
  typeName: string,
  deviceName: string,
) {
  const value = typeName && deviceName ? `${typeName}${DEVICE_VALUE_SEPARATOR}${deviceName}` : "system";
  return options.some((option) => option.value === value) ? value : "system";
}

function deviceValue(device: AudioDeviceInfo) {
  return `${device.typeName}${DEVICE_VALUE_SEPARATOR}${device.name}`;
}

function parseDeviceValue(value: string): Pick<AudioDeviceInfo, "typeName" | "name"> | null {
  if (value === "system") return null;
  const [typeName, name] = value.split(DEVICE_VALUE_SEPARATOR);
  if (!name) return null;
  return { typeName: typeName ?? "", name };
}

function formatSampleRate(sampleRate: number | undefined) {
  return sampleRate && sampleRate > 0 ? `${Math.round(sampleRate).toLocaleString()} Hz` : "--";
}

function formatBufferSize(bufferSize: number | undefined) {
  return bufferSize && bufferSize > 0 ? `${bufferSize} spl` : "--";
}

function formatLatency(snapshot: AudioDeviceSnapshot | null) {
  if (!snapshot || snapshot.sampleRate <= 0) return "--";
  const samples = Math.max(0, snapshot.inputLatencySamples) + Math.max(0, snapshot.outputLatencySamples);
  return `${samples} spl / ${((samples / snapshot.sampleRate) * 1000).toFixed(1)} ms`;
}

function formatChannels(channels: string[] | undefined) {
  if (!channels || channels.length === 0) return "--";
  return channels.slice(0, 4).join(" / ") + (channels.length > 4 ? ` +${channels.length - 4}` : "");
}

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
