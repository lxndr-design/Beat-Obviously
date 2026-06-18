import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Button, FloatingSelect, Icon, Modal, RadioGroup, Toggle } from "../../solid-ui";
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
import { createStoreSelector } from "../../solid-utils/store";
import styles from "./PreferencesModal.module.css";

export function PreferencesModal() {
  const settings = createStoreSelector(useSettingsStore, (s) => s);
  const [activeTab, setActiveTab] = createSignal<PreferenceTab>("audio");
  const [model, setModel] = createSignal(getOllamaModel());
  const [modelOpen, setModelOpen] = createSignal(false);
  const [inputOpen, setInputOpen] = createSignal(false);
  const [outputOpen, setOutputOpen] = createSignal(false);
  const [sampleRateOpen, setSampleRateOpen] = createSignal(false);
  const [bufferOpen, setBufferOpen] = createSignal(false);
  const [latencyOpen, setLatencyOpen] = createSignal(false);
  const [recentOpen, setRecentOpen] = createSignal(false);
  const [assetPolicyOpen, setAssetPolicyOpen] = createSignal(false);
  const [memoryOpen, setMemoryOpen] = createSignal(false);
  const [startupOpen, setStartupOpen] = createSignal(false);
  const [deviceSnapshot, setDeviceSnapshot] = createSignal<AudioDeviceSnapshot | null>(null);
  const [deviceStatus, setDeviceStatus] = createSignal("");
  const [exportStatus, setExportStatus] = createSignal("");
  const [trainingStats, setTrainingStats] = createSignal<TrainingSignalStats>({ drums: 0, instruments: 0, midi: 0 });
  const [trainedAt, setTrainedAt] = createSignal<TrainingSignalStats>(readTrainingCheckpoints());
  const [trainingStatuses, setTrainingStatuses] = createSignal<Partial<Record<TrainingKind, TrainingStatus>>>(readTrainingStatuses());
  const dirty = createMemo(() => model().trim() !== getOllamaModel());
  const checkpoints = createMemo(() => makeTrainingCheckpoints(trainingStats(), trainedAt()));
  const inputOptions = createMemo(() => deviceOptions(deviceSnapshot(), "input"));
  const outputOptions = createMemo(() => deviceOptions(deviceSnapshot(), "output"));
  const selectedInputValue = createMemo(() => selectedDeviceValue(
    inputOptions(),
    settings().preferredAudioTypeName,
    settings().preferredInputDeviceName || deviceSnapshot()?.currentInputName || "",
  ));
  const selectedOutputValue = createMemo(() => selectedDeviceValue(
    outputOptions(),
    deviceSnapshot()?.currentTypeName || "",
    settings().preferredOutputDeviceName || deviceSnapshot()?.currentOutputName || "",
  ));
  const activeTabLabel = createMemo(() => PREFERENCE_TABS.find((tab) => tab.id === activeTab())?.label);

  void refreshTrainingStats();
  void refreshDevices();
  const unsubscribeEvents = onEvent((event) => {
    if (event.kind !== "training.status") return;
    void refreshTrainingStats();
  });
  onCleanup(unsubscribeEvents);

  function close() {
    useUiStore.getState().closeEditor({ kind: "preferences" });
  }

  function save() {
    setOllamaModel(model());
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
    useSettingsStore.getState().setPreferredInputDevice(device?.typeName ?? "", device?.name ?? "");
    if (!device) {
      setDeviceStatus("Following system input");
      return;
    }

    try {
      const response = await send({
        kind: "audio.selectInputDevice",
        typeName: device.typeName,
        deviceName: device.name,
        inputChannelCount: settings().defaultInputChannelCount,
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
    useSettingsStore.getState().setPreferredOutputDevice(device?.typeName ?? "", device?.name ?? "");
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
    downloadJsonl(jsonl, `beat-drum-finetune-${new Date().toISOString().slice(0, 10)}.jsonl`);
    setExportStatus("Exported JSONL training dataset.");
  }

  async function exportInstrumentDataset() {
    const jsonl = await exportInstrumentFineTuneJsonl();
    if (!jsonl.trim()) {
      setExportStatus("No rated or accepted generated instruments yet.");
      return;
    }
    downloadJsonl(jsonl, `beat-instrument-finetune-${new Date().toISOString().slice(0, 10)}.jsonl`);
    setExportStatus("Exported instrument JSONL training dataset.");
  }

  async function exportMidiDataset() {
    const jsonl = await exportMidiSongFineTuneJsonl();
    if (!jsonl.trim()) {
      setExportStatus("No saved MIDI components, MIDI project segments, or MIDI generation feedback yet.");
      return;
    }
    downloadJsonl(jsonl, `beat-midi-song-finetune-${new Date().toISOString().slice(0, 10)}.jsonl`);
    setExportStatus("Exported MIDI/song JSONL training dataset.");
  }

  return (
    <Modal
      open
      scopeId="preferences"
      title={<><Icon name="ph:gear" size={14} decorative />Preferences</>}
      width="lg"
      dirty={dirty()}
      onClose={close}
      onRequestCloseDirty={save}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!dirty()} onClick={save}>Save</Button>
        </>
      }
    >
      <div class={styles.panel}>
        <div class={styles.tabs} role="tablist" aria-label="Preferences sections">
          <For each={PREFERENCE_TABS}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab() === tab.id}
                class={`${styles.tabButton} ${activeTab() === tab.id ? styles.tabButtonActive : ""}`}
                onClick={() => selectTab(tab.id)}
              >
                <Icon name={tab.icon} size={14} decorative />
                {tab.label}
              </button>
            )}
          </For>
        </div>

        <div
          class={styles.tabContent}
          role="tabpanel"
          aria-label={activeTabLabel()}
        >
          <Show when={activeTab() === "audio"}>
            <AudioPreferences
              settings={settings()}
              deviceSnapshot={deviceSnapshot()}
              deviceStatus={deviceStatus()}
              inputOptions={inputOptions()}
              outputOptions={outputOptions()}
              selectedInputValue={selectedInputValue()}
              selectedOutputValue={selectedOutputValue()}
              inputOpen={inputOpen()}
              outputOpen={outputOpen()}
              sampleRateOpen={sampleRateOpen()}
              bufferOpen={bufferOpen()}
              latencyOpen={latencyOpen()}
              setInputOpen={setInputOpen}
              setOutputOpen={setOutputOpen}
              setSampleRateOpen={setSampleRateOpen}
              setBufferOpen={setBufferOpen}
              setLatencyOpen={setLatencyOpen}
              refreshDevices={refreshDevices}
              selectInputDevice={selectInputDevice}
              selectOutputDevice={selectOutputDevice}
            />
          </Show>

          <Show when={activeTab() === "files"}>
            <FilesPreferences
              settings={settings()}
              assetPolicyOpen={assetPolicyOpen()}
              recentOpen={recentOpen()}
              memoryOpen={memoryOpen()}
              startupOpen={startupOpen()}
              setAssetPolicyOpen={setAssetPolicyOpen}
              setRecentOpen={setRecentOpen}
              setMemoryOpen={setMemoryOpen}
              setStartupOpen={setStartupOpen}
            />
          </Show>

          <Show when={activeTab() === "grid"}>
            <GridPreferences settings={settings()} />
          </Show>

          <Show when={activeTab() === "ai"}>
            <AiPreferences
              model={model()}
              modelOpen={modelOpen()}
              checkpoints={checkpoints()}
              trainingStatuses={trainingStatuses()}
              exportStatus={exportStatus()}
              setModel={setModel}
              setModelOpen={setModelOpen}
              runTraining={runTraining}
              exportDataset={exportDataset}
              exportInstrumentDataset={exportInstrumentDataset}
              exportMidiDataset={exportMidiDataset}
            />
          </Show>
        </div>
      </div>
    </Modal>
  );
}

type SettingsState = ReturnType<typeof useSettingsStore.getState>;

interface AudioPreferencesProps {
  settings: SettingsState;
  deviceSnapshot: AudioDeviceSnapshot | null;
  deviceStatus: string;
  inputOptions: Array<{ value: string; label: string }>;
  outputOptions: Array<{ value: string; label: string }>;
  selectedInputValue: string;
  selectedOutputValue: string;
  inputOpen: boolean;
  outputOpen: boolean;
  sampleRateOpen: boolean;
  bufferOpen: boolean;
  latencyOpen: boolean;
  setInputOpen: (open: boolean) => void;
  setOutputOpen: (open: boolean) => void;
  setSampleRateOpen: (open: boolean) => void;
  setBufferOpen: (open: boolean) => void;
  setLatencyOpen: (open: boolean) => void;
  refreshDevices: () => Promise<void>;
  selectInputDevice: (value: string) => Promise<void>;
  selectOutputDevice: (value: string) => void;
}

function AudioPreferences(props: AudioPreferencesProps) {
  return (
    <>
      <section class={styles.section}>
        <div class={styles.sectionHeader}>
          <h3 class={styles.sectionTitle}>Audio I/O</h3>
          <Button size="xs" onClick={() => void props.refreshDevices()}>
            <Icon name="ph:arrows-clockwise" size={14} decorative />
            Refresh
          </Button>
        </div>
        <div class={styles.settingsGrid}>
          <FloatingSelect
            className={styles.fieldSelect}
            label="Input"
            layout="inline"
            value={props.selectedInputValue}
            ariaLabel="Audio input device"
            options={props.inputOptions}
            open={props.inputOpen}
            onOpenChange={props.setInputOpen}
            onChange={(value) => void props.selectInputDevice(value)}
          />
          <FloatingSelect
            className={styles.fieldSelect}
            label="Output"
            layout="inline"
            value={props.selectedOutputValue}
            ariaLabel="Audio output device"
            options={props.outputOptions}
            open={props.outputOpen}
            onOpenChange={props.setOutputOpen}
            onChange={props.selectOutputDevice}
          />
          <Readout label="Driver" value={props.deviceSnapshot?.currentTypeName || "System"} />
          <FloatingSelect
            className={styles.fieldSelect}
            label="Rate"
            layout="inline"
            value={String(props.settings.preferredSampleRate)}
            ariaLabel="Audio sample rate"
            options={SAMPLE_RATE_OPTIONS}
            open={props.sampleRateOpen}
            onOpenChange={props.setSampleRateOpen}
            onChange={(value) => props.settings.setPreferredSampleRate(Number(value))}
          />
          <FloatingSelect
            className={styles.fieldSelect}
            label="Buffer"
            layout="inline"
            value={String(props.settings.preferredBufferSize)}
            ariaLabel="Audio buffer size"
            options={BUFFER_SIZE_OPTIONS}
            open={props.bufferOpen}
            onOpenChange={props.setBufferOpen}
            onChange={(value) => props.settings.setPreferredBufferSize(Number(value))}
          />
          <FloatingSelect
            className={styles.fieldSelect}
            label="Latency"
            layout="inline"
            value={props.settings.audioLatencyMode}
            ariaLabel="Audio latency handling"
            options={LATENCY_MODE_OPTIONS}
            open={props.latencyOpen}
            onOpenChange={props.setLatencyOpen}
            onChange={(value) => props.settings.setAudioLatencyMode(value as AudioLatencyMode)}
          />
        </div>
        <div class={styles.channelGrid}>
          <Readout label="Inputs" value={formatChannels(props.deviceSnapshot?.inputChannelNames)} />
          <Readout label="Outputs" value={formatChannels(props.deviceSnapshot?.outputChannelNames)} />
          <Readout label="Current rate" value={formatSampleRate(props.deviceSnapshot?.sampleRate)} />
          <Readout label="Current buffer" value={formatBufferSize(props.deviceSnapshot?.bufferSize)} />
          <Readout label="Reported latency" value={formatLatency(props.deviceSnapshot)} />
        </div>
        <Show when={props.deviceStatus}><p class={styles.hint}>{props.deviceStatus}</p></Show>
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Recording Defaults</h3>
        <div class={styles.gridRows}>
          <div class={styles.gridRow}>
            <Toggle
              className={styles.gridToggle}
              labelClassName={styles.gridToggleLabel}
              label="Monitor"
              checked={props.settings.defaultInputMonitoring}
              onChange={props.settings.setDefaultInputMonitoring}
            />
            <RadioGroup
              className={`${styles.gridRadio} ${styles.channelRadio}`}
              ariaLabel="Default recording input channels"
              value={props.settings.defaultInputChannelCount}
              options={CHANNEL_COUNT_OPTIONS}
              onChange={props.settings.setDefaultInputChannelCount}
            />
          </div>
          <div class={styles.gridRow}>
            <Toggle
              className={styles.gridToggle}
              labelClassName={styles.gridToggleLabel}
              label="Arm"
              checked={props.settings.defaultRecordArm}
              onChange={props.settings.setDefaultRecordArm}
            />
            <Readout label="New tracks" value={props.settings.defaultRecordArm ? "Armed" : "Idle"} />
          </div>
        </div>
      </section>
    </>
  );
}

interface FilesPreferencesProps {
  settings: SettingsState;
  assetPolicyOpen: boolean;
  recentOpen: boolean;
  memoryOpen: boolean;
  startupOpen: boolean;
  setAssetPolicyOpen: (open: boolean) => void;
  setRecentOpen: (open: boolean) => void;
  setMemoryOpen: (open: boolean) => void;
  setStartupOpen: (open: boolean) => void;
}

function FilesPreferences(props: FilesPreferencesProps) {
  return (
    <>
      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>File Handling</h3>
        <div class={styles.settingsGrid}>
          <FloatingSelect
            className={styles.fieldSelect}
            label="Assets"
            layout="inline"
            value={props.settings.fileAssetPolicy}
            ariaLabel="Default asset handling"
            options={ASSET_POLICY_OPTIONS}
            open={props.assetPolicyOpen}
            onOpenChange={props.setAssetPolicyOpen}
            onChange={(value) => props.settings.setFileAssetPolicy(value as FileAssetPolicy)}
          />
          <FloatingSelect
            className={styles.fieldSelect}
            label="Recents"
            layout="inline"
            value={String(props.settings.maxRecentProjects)}
            ariaLabel="Recent project limit"
            options={RECENT_PROJECT_OPTIONS}
            open={props.recentOpen}
            onOpenChange={props.setRecentOpen}
            onChange={(value) => props.settings.setMaxRecentProjects(Number(value))}
          />
          <Toggle
            className={styles.inlineToggle}
            labelClassName={styles.gridToggleLabel}
            label="Backups"
            checked={props.settings.autosaveBackups}
            onChange={props.settings.setAutosaveBackups}
          />
        </div>
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Memory & Startup</h3>
        <div class={styles.settingsGrid}>
          <FloatingSelect
            className={styles.fieldSelect}
            label="Cache"
            layout="inline"
            value={props.settings.memoryCachePreset}
            ariaLabel="Preview cache memory"
            options={MEMORY_CACHE_OPTIONS}
            open={props.memoryOpen}
            onOpenChange={props.setMemoryOpen}
            onChange={(value) => props.settings.setMemoryCachePreset(value as MemoryCachePreset)}
          />
          <FloatingSelect
            className={styles.fieldSelect}
            label="Startup"
            layout="inline"
            value={props.settings.startupProjectBehavior}
            ariaLabel="Startup project behavior"
            options={STARTUP_OPTIONS}
            open={props.startupOpen}
            onOpenChange={props.setStartupOpen}
            onChange={(value) => {
              props.settings.setStartupProjectBehavior(value as StartupProjectBehavior);
              props.settings.setRestoreLastProject(value === "restore-last");
            }}
          />
          <Toggle
            className={styles.inlineToggle}
            labelClassName={styles.gridToggleLabel}
            label="Restore"
            checked={props.settings.restoreLastProject}
            onChange={(enabled) => {
              props.settings.setRestoreLastProject(enabled);
              props.settings.setStartupProjectBehavior(enabled ? "restore-last" : "home");
            }}
          />
        </div>
      </section>
    </>
  );
}

function GridPreferences(props: { settings: SettingsState }) {
  return (
    <section class={styles.section}>
      <h3 class={styles.sectionTitle}>Grid Snap</h3>
      <div class={styles.gridRows}>
        <div class={styles.gridRow}>
          <Toggle
            className={styles.gridToggle}
            labelClassName={styles.gridToggleLabel}
            label="Timeline snap"
            checked={props.settings.timelineSmartGrid}
            onChange={props.settings.setTimelineSmartGrid}
          />
          <RadioGroup
            className={styles.gridRadio}
            ariaLabel="Timeline smart grid subdivision"
            value={props.settings.timelineSubdivision}
            options={SUBDIVISION_OPTIONS}
            disabled={!props.settings.timelineSmartGrid}
            onChange={props.settings.setTimelineSubdivision}
          />
        </div>
        <div class={styles.gridRow}>
          <Toggle
            className={styles.gridToggle}
            labelClassName={styles.gridToggleLabel}
            label="MIDI snap"
            checked={props.settings.midiSmartGrid}
            onChange={props.settings.setMidiSmartGrid}
          />
          <RadioGroup
            className={styles.gridRadio}
            ariaLabel="MIDI smart grid subdivision"
            value={props.settings.midiSubdivision}
            options={SUBDIVISION_OPTIONS}
            disabled={!props.settings.midiSmartGrid}
            onChange={props.settings.setMidiSubdivision}
          />
        </div>
      </div>
    </section>
  );
}

interface AiPreferencesProps {
  model: string;
  modelOpen: boolean;
  checkpoints: ReturnType<typeof makeTrainingCheckpoints>;
  trainingStatuses: Partial<Record<TrainingKind, TrainingStatus>>;
  exportStatus: string;
  setModel: (value: string) => void;
  setModelOpen: (open: boolean) => void;
  runTraining: (kind: TrainingKind) => Promise<void>;
  exportDataset: () => Promise<void>;
  exportInstrumentDataset: () => Promise<void>;
  exportMidiDataset: () => Promise<void>;
}

function AiPreferences(props: AiPreferencesProps) {
  return (
    <>
      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Local AI</h3>
        <div class={styles.row}>
          <FloatingSelect
            className={styles.modelSelect}
            label="AI model"
            layout="inline"
            value={props.model}
            ariaLabel="AI model"
            options={MODEL_OPTIONS.map((option) => ({ value: option, label: option }))}
            open={props.modelOpen}
            onOpenChange={props.setModelOpen}
            onChange={props.setModel}
          />
        </div>
        <p class={styles.hint}>
          Used for local beat generation, instrument generation, MIDI/song ideas, and training-assisted suggestions. Use a base model now, then switch to a tuned Beat model after training.
        </p>
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Local AI Training Status</h3>
        <div class={styles.checkpointList}>
          <For each={props.checkpoints}>
            {(checkpoint) => (
              <div class={styles.checkpointRow}>
                <div class={styles.checkpointMeta}>
                  <span class={styles.checkpointName}>{checkpoint.label}</span>
                  <span class={styles.checkpointCount}>
                    {checkpoint.sinceLast}/{TRAINING_BREAKPOINT} new signals
                  </span>
                </div>
                <span class={checkpoint.ready ? styles.readyBadge : styles.waitingBadge}>
                  {formatCheckpointStatus(checkpoint.ready, checkpoint.remaining, props.trainingStatuses[checkpoint.kind])}
                </span>
                <Button
                  size="xs"
                  disabled={checkpoint.sinceLast === 0}
                  onClick={() => void props.runTraining(checkpoint.kind)}
                >
                  Send
                </Button>
              </div>
            )}
          </For>
        </div>
        <div class={styles.exportActions}>
          <Button size="sm" onClick={() => void props.exportDataset()}>
            <Icon name="ph:download-simple" size={14} decorative />
            Drum training data
          </Button>
          <Button size="sm" onClick={() => void props.exportInstrumentDataset()}>
            <Icon name="ph:download-simple" size={14} decorative />
            Instrument training data
          </Button>
          <Button size="sm" onClick={() => void props.exportMidiDataset()}>
            <Icon name="ph:download-simple" size={14} decorative />
            MIDI training data
          </Button>
        </div>
        <p class={styles.hint}>
          Send queues the current JSONL dataset into the local native trainer. The buttons below only download inspectable dataset backups; they do not export project audio or MIDI files.
        </p>
        <Show when={props.exportStatus}><p class={styles.hint}>{props.exportStatus}</p></Show>
      </section>
    </>
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

function Readout(props: { label: string; value: string }) {
  return (
    <div class={styles.readout}>
      <span class={styles.readoutLabel}>{props.label}</span>
      <span class={styles.readoutValue}>{props.value}</span>
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

function downloadJsonl(jsonl: string, filename: string) {
  const blob = new Blob([`${jsonl}\n`], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
