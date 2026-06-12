import { useMemo, useState } from "react";
import { Button, Icon, Modal } from "../../components";
import { isNative, send } from "../../ipc/bridge";
import { useAudioFileStore, usePluginStore, useUiStore } from "../../state/store";
import type { PluginAdapter } from "../../state/types";
import type { DecentSamplerImport } from "../../ipc/schema";
import { upsertDecentSamplerInstrument } from "../InstrumentLibrary/decentSamplerInstrument";
import styles from "./DecentSamplerLibraryModal.module.css";

interface DecentSamplerLibraryModalProps {
  onClose?: () => void;
}

export function DecentSamplerLibraryModal({ onClose }: DecentSamplerLibraryModalProps) {
  const allPlugins = usePluginStore((s) => s.plugins);
  const plugins = useMemo(
    () => allPlugins.filter((plugin) => plugin.format === "decent-sampler"),
    [allPlugins],
  );
  const addPlugin = usePluginStore((s) => s.addPlugin);
  const updatePlugin = usePluginStore((s) => s.updatePlugin);
  const addAudioFile = useAudioFileStore((s) => s.addFile);
  const openEditor = useUiStore((s) => s.openEditor);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const [file, setFile] = useState<File | null>(null);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState("");
  const close = onClose ?? (() => closeEditor({ kind: "decentSamplerLibrary" }));
  const native = isNative();

  function openPlugin(plugin: PluginAdapter) {
    close();
    openEditor({ kind: "plugin", pluginId: plugin.id });
  }

  async function install() {
    if (installing) return;
    if (!native && !file) return;

    setInstalling(true);
    setStatus("");
    try {
      if (native) {
        const preset = (await send({ kind: "instrument.importDecent" })).preset;
        if (!preset) {
          setStatus("Install cancelled.");
          return;
        }
        preset.audioFiles.forEach(addAudioFile);
        const pluginId = addPlugin(pluginFromDecentSamplerPreset(preset));
        const instrumentId = upsertDecentSamplerInstrument(preset, {
          pluginId,
          sourceLabel: `DecentSampler compatibility: ${preset.name}`,
        });
        updatePlugin(pluginId, { associatedInstrumentId: instrumentId });
        setStatus(`Installed ${preset.name}.`);
        close();
        openEditor({ kind: "plugin", pluginId });
        return;
      }

      if (!file) return;
      const message = "DecentSampler packages must be installed from the native app so Beat can parse the preset, register sample assets, and create the sampler bridge.";
      setStatus(message);
      window.alert(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "DecentSampler install failed.";
      setStatus(message);
      window.alert(message);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Modal
      open
      scopeId="decent-sampler-library"
      title={(
        <>
          <Icon name="ph:piano-keys" size={14} decorative />
          DecentSampler
        </>
      )}
      width="lg"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => void install()} disabled={installing || (!native && !file)}>
            <Icon name="ph:download-simple" size={14} decorative />
            {installing ? "Installing" : "Install"}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <section className={styles.installed}>
          <div className={styles.ribbon}>
            <span>Installed Files</span>
            <span>{plugins.length}</span>
          </div>
          <div className={styles.list}>
            {plugins.length === 0 ? (
              <div className={styles.empty}>No DecentSampler files installed.</div>
            ) : (
              plugins.map((plugin) => (
                <button
                  key={plugin.id}
                  type="button"
                  className={styles.row}
                  onClick={() => openPlugin(plugin)}
                >
                  <Icon name="ph:piano-keys" size={14} decorative />
                  <span className={styles.rowText}>
                    <strong>{plugin.name}</strong>
                    <small>{plugin.sourceFileName ?? "Package source unavailable"}</small>
                  </span>
                  <span className={styles.status}>{plugin.status}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className={styles.install}>
          <div className={styles.ribbon}>
            <span>Install New File</span>
            <span>DS</span>
          </div>
          {native ? (
            <div className={styles.fileDrop} aria-label="Native DecentSampler installer">
              <img className={styles.decentLogo} src="/assets/decent-sampler.png" alt="" aria-hidden="true" />
              <span>Press Install</span>
              <small>Choose a .zip or .dspreset. Beat extracts the package, parses the DS preset, registers sample assets, creates the MIDI-compatible sampler instrument, and opens the package UI.</small>
            </div>
          ) : (
            <label className={styles.fileDrop}>
              <input
                type="file"
                accept=".zip,.dspreset,.dslibrary,.dsconfig,.xml"
                onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
              />
              <img className={styles.decentLogo} src="/assets/decent-sampler.png" alt="" aria-hidden="true" />
              <span>{file ? file.name : "Choose .zip / .dspreset / .dslibrary"}</span>
              <small>Browser mode can register the package shell. Full zip extraction and sample-map parsing run in the native app.</small>
            </label>
          )}
          <div className={styles.compatGrid}>
            <InfoCell label="Format" value="DecentSampler" />
            <InfoCell label="Host" value="Package UI" />
            <InfoCell label="Install" value={native ? "Native parser" : "Browser shell"} />
          </div>
          {status && <div className={styles.statusText}>{status}</div>}
        </section>
      </div>
    </Modal>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.infoCell}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function pluginFromDecentSamplerPreset(preset: DecentSamplerImport): Partial<PluginAdapter> {
  return {
    name: preset.name || "DecentSampler Package",
    vendor: "DecentSampler",
    version: "1.0.0",
    kind: "renderer",
    format: "decent-sampler",
    status: "installed",
    instrumentMode: "live-instrument",
    sourceFileName: fileNameFromPath(preset.path),
    sourcePath: preset.path,
    uiImagePath: preset.uiImagePath,
    uiImageDataUrl: preset.uiImageDataUrl,
    uiWidth: preset.uiWidth,
    uiHeight: preset.uiHeight,
    sampleCount: preset.samples.length,
    uiControlCount: preset.uiControls?.length ?? 0,
    installedAt: Date.now(),
    description: `DecentSampler sample package with ${preset.samples.length} mapped sample zone${preset.samples.length === 1 ? "" : "s"}. Opens to the package UI and plays through Beat's sampler engine.`,
    capabilities: [
      {
        id: "decent-sampler-package",
        kind: "instrument",
        label: "Play DecentSampler package through Beat sampler",
        realtime: true,
        offline: true,
        latencySamples: 0,
        fallbackMode: "pass-through",
      },
    ],
  };
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || path;
}
