import { createMemo, createSignal } from "solid-js";
import { Button, FloatingSelect, Icon, Modal } from "../../solid-ui";
import { appAlert } from "../../solid-ui";
import { isNative, send } from "../../ipc/bridge";
import { useAudioFileStore, usePluginStore } from "../../state/store";
import type { PluginEditorKind, PluginFormat, PluginKind } from "../../state/types";
import { detectDecentSamplerEditorKind, pluginFromDecentSamplerPreset } from "./decentSamplerPluginAdapter";
import { upsertDecentSamplerInstrument } from "../InstrumentLibrary/decentSamplerInstrument";
import styles from "./PluginLibraryPanel.module.css";

export function PluginImportModal(props: {
  onClose: () => void;
  onInstalled: (pluginId: string) => void;
}) {
  const [file, setFile] = createSignal<File | null>(null);
  const [installing, setInstalling] = createSignal(false);
  const [editorKindOpen, setEditorKindOpen] = createSignal(false);
  const [editorKindMode, setEditorKindMode] = createSignal<"auto" | PluginEditorKind>("auto");
  const detected = createMemo(() => detectPluginFile(file()));

  async function install() {
    const selectedFile = file();
    if (!selectedFile) return;
    if (installing()) return;

    setInstalling(true);
    try {
      if (detected().format === "decent-sampler" && isNative()) {
        const preset = (await send({ kind: "instrument.importDecent", pathHint: nativeFilePath(selectedFile) })).preset;
        if (!preset) return;
        const editorKind = editorKindMode() === "auto"
          ? detectDecentSamplerEditorKind(preset)
          : editorKindMode() as PluginEditorKind;
        preset.audioFiles.forEach(useAudioFileStore.getState().addFile);
        const id = usePluginStore.getState().addPlugin(pluginFromDecentSamplerPreset(preset, editorKind));
        const instrumentId = upsertDecentSamplerInstrument(preset, {
          pluginId: id,
          sourceLabel: `DecentSampler compatibility: ${preset.name}`,
        });
        usePluginStore.getState().updatePlugin(id, { associatedInstrumentId: instrumentId });
        props.onInstalled(id);
        return;
      }

      if (detected().format === "decent-sampler") {
        await appAlert("DecentSampler packages must be installed from the native app so Beat can parse the preset, register sample assets, and create the sampler bridge.");
        return;
      }

      const id = usePluginStore.getState().addPlugin({
        name: detected().name,
        vendor: detected().vendor,
        kind: detected().kind,
        format: detected().format,
        status: "installed",
        instrumentMode: detected().kind === "synth" ? "fallback-lumen" : "rendered-audio",
        version: detected().version,
        sourceFileName: selectedFile.name,
        installedAt: Date.now(),
        description: detected().description,
      });
      props.onInstalled(id);
    } catch (error) {
      await appAlert(error instanceof Error ? error.message : "Plugin install failed.");
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Modal
      open
      scopeId="plugin-import"
      title={(
        <>
          <Icon name="ph:plug" size={18} decorative />
          Import DS File
        </>
      )}
      width="sm"
      onClose={props.onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void install()} disabled={!file() || installing()}>
            <Icon name="ph:download-simple" size={18} decorative />
            {installing() ? "Installing" : "Install"}
          </Button>
        </>
      )}
    >
      <div class={styles.importBody}>
        <label class={styles.fileDrop}>
          <input
            type="file"
            accept=".zip,.dspreset,.dslibrary,.dsconfig,.xml"
            onChange={(event) => {
              const selected = event.currentTarget.files?.[0] ?? null;
              setFile(() => selected);
            }}
          />
          <Icon name="ph:archive" size={18} decorative />
          <span>{file()?.name ?? "Choose DS file"}</span>
        </label>

        <FloatingSelect
          className={styles.importSelect}
          label="Editor"
          layout="inline"
          value={editorKindMode()}
          ariaLabel="DecentSampler editor kind"
          options={DECENT_SAMPLER_EDITOR_OPTIONS}
          open={editorKindOpen()}
          onOpenChange={setEditorKindOpen}
          onChange={(value) => setEditorKindMode(value as "auto" | PluginEditorKind)}
        />
      </div>
    </Modal>
  );
}

const DECENT_SAMPLER_EDITOR_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "drum", label: "Drum" },
  { value: "midi", label: "MIDI" },
];

function nativeFilePath(file: File | null) {
  if (!file) return undefined;
  const path = (file as File & { path?: unknown }).path;
  return typeof path === "string" && path.trim() ? path : undefined;
}

function detectPluginFile(file: File | null): {
  name: string;
  vendor: string;
  kind: PluginKind;
  format: PluginFormat;
  description: string;
  version: string;
} {
  if (!file) {
    return {
      name: "Pending Plugin",
      vendor: "External",
      kind: "synth",
      format: "decent-sampler",
      version: "1.0.0",
      description: "Choose a plugin file to inspect before installation.",
    };
  }

  const lower = file.name.toLowerCase();
  const baseName = file.name.replace(/\.(zip|dspreset|dslibrary|dsconfig|xml|vst3|component|plugin)$/i, "");
  if (lower.endsWith(".dspreset") || lower.endsWith(".dslibrary") || lower.endsWith(".dsconfig") || lower.includes("decentsampler") || lower.includes("decent-sampler")) {
    return {
      name: baseName || "DecentSampler Package",
      vendor: "DecentSampler",
      kind: "renderer",
      format: "decent-sampler",
      version: "1.0.0",
      description: "Imported DecentSampler package. Opens to the package UI.",
    };
  }
  if (lower.endsWith(".zip")) {
    return {
      name: baseName || "Imported Plugin",
      vendor: "External",
      kind: "renderer",
      format: "decent-sampler",
      version: "1.0.0",
      description: "Imported package. Zip archives are treated as DecentSampler-compatible sample packages.",
    };
  }
  if (lower.endsWith(".vst3")) {
    return {
      name: baseName || "VST3 Plugin",
      vendor: "External",
      kind: "synth",
      format: "vst3",
      version: "1.0.0",
      description: "Registered VST3 placeholder. Native VST3 execution remains inside the protected plugin boundary when the adapter is available.",
    };
  }
  if (lower.endsWith(".component")) {
    return {
      name: baseName || "Audio Unit Plugin",
      vendor: "External",
      kind: "synth",
      format: "audio-unit",
      version: "1.0.0",
      description: "Registered Audio Unit placeholder. Native AU execution remains inside the protected plugin boundary when the adapter is available.",
    };
  }
  return {
    name: baseName || "Native Plugin",
    vendor: "External",
    kind: "utility",
    format: "native",
    version: "1.0.0",
    description: "Registered native plugin placeholder. Calls stay isolated until a matching adapter is available.",
  };
}
