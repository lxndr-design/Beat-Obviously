import { createMemo, createSignal, For, Show } from "solid-js";
import { Button, FloatingSelect, Icon, Modal, RadioGroup, Toggle } from "../../solid-ui";
import { getOllamaModel, setOllamaModel } from "../../ai/aiService";
import { isNative, send } from "../../ipc/bridge";
import type { AudioDeviceInfo, AudioDeviceSnapshot } from "../../ipc/schema";
import {
  useSettingsStore,
  useUiStore,
  type FileAssetPolicy,
  type MemoryCachePreset,
  type StartupProjectBehavior,
  type ThemeContrastLevel,
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
  const [assetPolicyOpen, setAssetPolicyOpen] = createSignal(false);
  const [memoryOpen, setMemoryOpen] = createSignal(false);
  const [startupOpen, setStartupOpen] = createSignal(false);
  const [contrastOpen, setContrastOpen] = createSignal(false);
  const [deviceSnapshot, setDeviceSnapshot] = createSignal<AudioDeviceSnapshot | null>(null);
  const [deviceStatus, setDeviceStatus] = createSignal("");
  const dirty = createMemo(() => model().trim() !== getOllamaModel());
  const nativeAudioAvailable = isNative();
  const inputOptions = createMemo(() => deviceOptions(deviceSnapshot(), "input", nativeAudioAvailable));
  const outputOptions = createMemo(() => deviceOptions(deviceSnapshot(), "output", nativeAudioAvailable));
  const selectedInputValue = createMemo(() => selectedDeviceValue(
    inputOptions(),
    settings().preferredAudioTypeName,
    settings().preferredInputDeviceName || deviceSnapshot()?.currentInputName || "",
  ));
  const selectedOutputValue = createMemo(() => selectedDeviceValue(
    outputOptions(),
    deviceSnapshot()?.currentTypeName || "",
    deviceSnapshot()?.currentOutputName || settings().preferredOutputDeviceName || "",
  ));
  const activeTabLabel = createMemo(() => PREFERENCE_TABS.find((tab) => tab.id === activeTab())?.label);

  void refreshDevices();

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
    setAssetPolicyOpen(false);
    setMemoryOpen(false);
    setStartupOpen(false);
    setContrastOpen(false);
    setModelOpen(false);
  }

  async function refreshDevices() {
    try {
      const response = await send({ kind: "audio.listDevices" });
      setDeviceSnapshot(response.snapshot);
      setDeviceStatus(nativeAudioAvailable
        ? response.snapshot.currentTypeName ? "Audio ready" : "Audio unavailable"
        : "Browser preview follows the macOS system output");
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

  async function selectOutputDevice(value: string) {
    setOutputOpen(false);
    const device = parseDeviceValue(value);
    if (!device) {
      setDeviceStatus("Following system output");
      return;
    }

    try {
      const response = await send({
        kind: "audio.selectOutputDevice",
        typeName: device.typeName,
        deviceName: device.name,
      });
      setDeviceSnapshot(response.snapshot);
      if (response.ok) {
        useSettingsStore.getState().setPreferredOutputDevice(device.typeName, device.name);
      }
      setDeviceStatus(response.ok ? "Output selected" : response.error ?? "Output selection unavailable");
    } catch (error) {
      setDeviceStatus(error instanceof Error ? error.message : "Output selection unavailable");
    }
  }

  return (
    <Modal
      open
      scopeId="preferences"
      title={<><Icon name="ph:gear" size={18} decorative />Preferences</>}
      width="lg"
      flushBody
      dirty={dirty()}
      onClose={close}
      onRequestCloseDirty={save}
      footer={
        <Show when={dirty()} fallback={<Button variant="primary" onClick={close}>Done</Button>}>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!dirty()} onClick={save}>Save</Button>
        </Show>
      }
    >
      <div class={styles.panel}>
        <div class={styles.tabs} role="tablist" aria-label="Preferences sections">
          <For each={PREFERENCE_TABS}>
            {(tab) => (
              <Button
                role="tab"
                aria-selected={activeTab() === tab.id}
                aria-current={activeTab() === tab.id ? "page" : undefined}
                class={`${styles.navButton} ${activeTab() === tab.id ? styles.navButtonActive : ""}`}
                onClick={() => selectTab(tab.id)}
              >
                {tab.label}
              </Button>
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
              nativeAudioAvailable={nativeAudioAvailable}
              selectedInputValue={selectedInputValue()}
              selectedOutputValue={selectedOutputValue()}
              inputOpen={inputOpen()}
              outputOpen={outputOpen()}
              sampleRateOpen={sampleRateOpen()}
              bufferOpen={bufferOpen()}
              setInputOpen={setInputOpen}
              setOutputOpen={setOutputOpen}
              setSampleRateOpen={setSampleRateOpen}
              setBufferOpen={setBufferOpen}
              refreshDevices={refreshDevices}
              selectInputDevice={selectInputDevice}
              selectOutputDevice={selectOutputDevice}
            />
          </Show>

          <Show when={activeTab() === "files"}>
            <FilesPreferences
              settings={settings()}
              assetPolicyOpen={assetPolicyOpen()}
              memoryOpen={memoryOpen()}
              startupOpen={startupOpen()}
              setAssetPolicyOpen={setAssetPolicyOpen}
              setMemoryOpen={setMemoryOpen}
              setStartupOpen={setStartupOpen}
            />
          </Show>

          <Show when={activeTab() === "theme"}>
            <ThemePreferences
              settings={settings()}
              contrastOpen={contrastOpen()}
              setContrastOpen={setContrastOpen}
            />
          </Show>

          <Show when={activeTab() === "ai"}>
            <AiPreferences
              model={model()}
              modelOpen={modelOpen()}
              setModel={setModel}
              setModelOpen={setModelOpen}
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
  nativeAudioAvailable: boolean;
  selectedInputValue: string;
  selectedOutputValue: string;
  inputOpen: boolean;
  outputOpen: boolean;
  sampleRateOpen: boolean;
  bufferOpen: boolean;
  setInputOpen: (open: boolean) => void;
  setOutputOpen: (open: boolean) => void;
  setSampleRateOpen: (open: boolean) => void;
  setBufferOpen: (open: boolean) => void;
  refreshDevices: () => Promise<void>;
  selectInputDevice: (value: string) => Promise<void>;
  selectOutputDevice: (value: string) => Promise<void>;
}

function AudioPreferences(props: AudioPreferencesProps) {
  return (
    <>
      <section class={styles.section}>
        <div class={styles.sectionHeader}>
          <h3 class={styles.sectionTitle}>Audio I/O</h3>
          <Button size="xs" onClick={() => void props.refreshDevices()}>
            <Icon name="ph:arrows-clockwise" size={18} decorative />
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
            disabled={!props.nativeAudioAvailable}
            open={props.outputOpen}
            onOpenChange={props.setOutputOpen}
            onChange={(value) => void props.selectOutputDevice(value)}
          />
          <Readout label="Audio system" value={props.deviceSnapshot?.currentTypeName || "System"} />
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
        </div>
        <div class={styles.channelGrid}>
          <Readout label="Inputs" value={formatChannelCount(props.deviceSnapshot?.inputChannelNames, "input")} />
          <Readout label="Outputs" value={formatChannelCount(props.deviceSnapshot?.outputChannelNames, "output")} />
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
  memoryOpen: boolean;
  startupOpen: boolean;
  setAssetPolicyOpen: (open: boolean) => void;
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
          <Toggle
            className={styles.inlineToggle}
            labelClassName={styles.gridToggleLabel}
            label="Recovery autosave"
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

interface ThemePreferencesProps {
  settings: SettingsState;
  contrastOpen: boolean;
  setContrastOpen: (open: boolean) => void;
}

function ThemePreferences(props: ThemePreferencesProps) {
  return (
    <>
      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Theme</h3>
        <div class={styles.settingsGrid}>
          <Toggle
            className={styles.inlineToggle}
            labelClassName={styles.gridToggleLabel}
            label="Light mode"
            checked={props.settings.themeMode === "light"}
            onChange={(enabled) => props.settings.setThemeMode(enabled ? "light" : "dark")}
          />
          <FloatingSelect
            className={styles.fieldSelect}
            label="Contrast"
            layout="inline"
            value={props.settings.themeContrastLevel}
            ariaLabel="Theme contrast level"
            options={CONTRAST_LEVEL_OPTIONS}
            open={props.contrastOpen}
            onOpenChange={props.setContrastOpen}
            onChange={(value) => props.settings.setThemeContrastLevel(value as ThemeContrastLevel)}
          />
        </div>
        <p class={styles.hint}>
          Normal keeps the current UI balance. Low pushes faint lines and surfaces closer to white. High restores more separation between subtle and strong UI states.
        </p>
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Grid</h3>
        <div class={styles.gridRows}>
          <div class={styles.gridRow}>
            <Toggle
              className={styles.gridToggle}
              labelClassName={styles.gridToggleLabel}
              label="Arrangement snap"
              checked={props.settings.timelineSmartGrid}
              onChange={props.settings.setTimelineSmartGrid}
            />
            <RadioGroup
              className={styles.gridRadio}
              ariaLabel="Arrangement grid subdivision"
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
              ariaLabel="MIDI grid subdivision"
              value={props.settings.midiSubdivision}
              options={SUBDIVISION_OPTIONS}
              disabled={!props.settings.midiSmartGrid}
              onChange={props.settings.setMidiSubdivision}
            />
          </div>
        </div>
      </section>
    </>
  );
}

interface AiPreferencesProps {
  model: string;
  modelOpen: boolean;
  setModel: (value: string) => void;
  setModelOpen: (open: boolean) => void;
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
          Used for local beat generation, instrument generation, and MIDI/song ideas.
        </p>
      </section>
    </>
  );
}

type PreferenceTab = "audio" | "files" | "theme" | "ai";

const PREFERENCE_TABS: Array<{ id: PreferenceTab; label: string }> = [
  { id: "audio", label: "Audio" },
  { id: "files", label: "Files" },
  { id: "theme", label: "Theme" },
  { id: "ai", label: "AI" },
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
const CONTRAST_LEVEL_OPTIONS: Array<{ value: ThemeContrastLevel; label: string }> = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
];
const SAMPLE_RATE_OPTIONS = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000].map((value) => ({
  value: String(value),
  label: formatSampleRate(value),
}));
const BUFFER_SIZE_OPTIONS = [64, 128, 256, 512, 1024, 2048].map((value) => ({
  value: String(value),
  label: formatBufferSize(value),
}));
function Readout(props: { label: string; value: string }) {
  return (
    <div class={styles.readout}>
      <span class={styles.readoutLabel}>{props.label}</span>
      <span class={styles.readoutValue}>{props.value}</span>
    </div>
  );
}

function deviceOptions(snapshot: AudioDeviceSnapshot | null, direction: "input" | "output", nativeAvailable: boolean) {
  if (!nativeAvailable) {
    return [{ value: "system", label: direction === "input" ? "System input (browser)" : "System output (browser)" }];
  }
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

function formatChannelCount(channels: string[] | undefined, direction: "input" | "output") {
  const count = channels?.length ?? 0;
  if (count === 0) return direction === "input" ? "No input channels" : "No output channels";
  const noun =
    direction === "input"
      ? count === 1
        ? "input channel"
        : "input channels"
      : count === 1
        ? "output channel"
        : "output channels";
  const names = (channels ?? []).map((name, index) => name.trim() || `Channel ${index + 1}`);
  return `${count} ${noun}: ${names.join(", ")}`;
}
