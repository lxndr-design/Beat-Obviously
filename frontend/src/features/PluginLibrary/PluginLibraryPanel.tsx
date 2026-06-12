import { useState } from "react";
import { Button, HoverInfo, Icon, MarqueeText, Modal, SectionRibbon, SectionRibbonActionButton, useContextMenu, type ContextMenuItem } from "../../components";
import { isNative, send } from "../../ipc/bridge";
import { useAudioFileStore, usePluginStore, useUiStore } from "../../state/store";
import type { PluginAdapter, PluginFormat, PluginKind } from "../../state/types";
import { decentSamplerDragPluginId, pluginFromDecentSamplerPreset } from "./decentSamplerPluginAdapter";
import { upsertDecentSamplerInstrument } from "../InstrumentLibrary/decentSamplerInstrument";
import styles from "./PluginLibraryPanel.module.css";

interface PluginLibraryPanelProps {
  expanded: boolean;
  onToggle: () => void;
}

export function PluginLibraryPanel({ expanded, onToggle }: PluginLibraryPanelProps) {
  const [importOpen, setImportOpen] = useState(false);
  const plugins = usePluginStore((s) => s.plugins);
  const openEditor = useUiStore((s) => s.openEditor);

  return (
    <div className={styles.panel}>
      <SectionRibbon
        title="Plugins"
        expanded={expanded}
        onToggle={onToggle}
        showToggle={false}
        count={plugins.length}
        actions={
          <HoverInfo content="Import plugin">
            <SectionRibbonActionButton onClick={() => setImportOpen(true)} aria-label="Import plugin">
              <Icon name="ph:plus" size={16} decorative />
            </SectionRibbonActionButton>
          </HoverInfo>
        }
      />

      <ul className={`${styles.list} ${expanded ? styles.listOpen : ""}`} aria-hidden={!expanded}>
        {plugins.map((plugin) => (
          <PluginItem
            key={plugin.id}
            plugin={plugin}
            onOpen={() => openEditor({ kind: "plugin", pluginId: plugin.id })}
          />
        ))}
      </ul>

      {importOpen && (
        <PluginImportModal
          onClose={() => setImportOpen(false)}
          onInstalled={(pluginId) => {
            setImportOpen(false);
            openEditor({ kind: "plugin", pluginId });
          }}
        />
      )}
    </div>
  );
}

export function PluginImportModal({ onClose, onInstalled }: { onClose: () => void; onInstalled: (pluginId: string) => void }) {
  const addPlugin = usePluginStore((s) => s.addPlugin);
  const updatePlugin = usePluginStore((s) => s.updatePlugin);
  const addAudioFile = useAudioFileStore((s) => s.addFile);
  const [file, setFile] = useState<File | null>(null);
  const [installing, setInstalling] = useState(false);
  const detected = detectPluginFile(file);

  async function install() {
    if (!file) return;
    if (installing) return;

    setInstalling(true);
    try {
      if (detected.format === "decent-sampler" && isNative()) {
        const preset = (await send({ kind: "instrument.importDecent", pathHint: nativeFilePath(file) })).preset;
        if (!preset) return;
        preset.audioFiles.forEach(addAudioFile);
        const id = addPlugin(pluginFromDecentSamplerPreset(preset));
        const instrumentId = upsertDecentSamplerInstrument(preset, {
          pluginId: id,
          sourceLabel: `DecentSampler compatibility: ${preset.name}`,
        });
        updatePlugin(id, { associatedInstrumentId: instrumentId });
        onInstalled(id);
        return;
      }

      if (detected.format === "decent-sampler") {
        window.alert("DecentSampler packages must be installed from the native app so Beat can parse the preset, register sample assets, and create the sampler bridge.");
        return;
      }

      const id = addPlugin({
        name: detected.name,
        vendor: detected.vendor,
        kind: detected.kind,
        format: detected.format,
        status: "installed",
        instrumentMode: detected.kind === "synth" ? "fallback-aether" : "rendered-audio",
        version: detected.version,
        sourceFileName: file.name,
        installedAt: Date.now(),
        description: detected.description,
      });
      onInstalled(id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Plugin install failed.");
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
          <Icon name="ph:plug" size={14} decorative />
          Import Plugin
        </>
      )}
      width="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void install()} disabled={!file || installing}>
            <Icon name="ph:download-simple" size={14} decorative />
            {installing ? "Installing" : "Install"}
          </Button>
        </>
      }
    >
      <div className={styles.importBody}>
        <label className={styles.fileDrop}>
          <input
            type="file"
            accept=".zip,.dspreset,.dslibrary,.dsconfig,.xml,.vst3,.component,.plugin"
            onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
          />
          <Icon name="ph:archive" size={32} decorative />
          <span>{file ? file.name : "Choose plugin file or zip"}</span>
          <small>DecentSampler zip/preset packages are supported first. VST3/AU/native files are registered as protected placeholders until native adapters are available.</small>
        </label>

        <div className={styles.importGrid}>
          <ImportCell label="Kind" value={detected.kind} />
          <ImportCell label="Format" value={detected.format} />
          <ImportCell label="Mode" value={detected.format === "decent-sampler" ? "DS Sampler" : detected.kind === "synth" ? "Fallback Aether" : "Rendered Audio"} />
          <ImportCell label="Status" value={file ? "Ready" : "Waiting for file"} />
        </div>
      </div>
    </Modal>
  );
}

interface PluginItemProps {
  plugin: PluginAdapter;
  onOpen: () => void;
}

export function PluginItem({ plugin, onOpen }: PluginItemProps) {
  const removePlugin = usePluginStore((s) => s.removePlugin);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    { label: "Open", icon: "ph:box-arrow-up-right", onSelect: onOpen },
    {
      label: plugin.format === "decent-sampler"
        ? (plugin.status === "installed" ? "Refresh Package" : "Install Package")
        : (plugin.status === "installed" ? "Reinstall" : "Install"),
      icon: "ph:download-simple",
      onSelect: onOpen,
    },
    {
      label: plugin.format === "decent-sampler" ? "Open Package UI" : plugin.kind === "synth" ? "Create Instrument" : "Render WAV",
      icon: plugin.format === "decent-sampler" ? "ph:package" : plugin.kind === "synth" ? "ph:wave-sine" : "ph:file-audio",
      onSelect: onOpen,
      separatorBefore: true,
    },
    {
      label: "Delete",
      icon: "ph:trash",
      disabled: Boolean(plugin.factory),
      separatorBefore: true,
      onSelect: () => {
        closeEditor({ kind: "plugin", pluginId: plugin.id });
        removePlugin(plugin.id);
      },
    },
  ]);
  const draggablePluginId = decentSamplerDragPluginId(plugin);

  function onDragStart(e: React.DragEvent<HTMLLIElement>) {
    if (!draggablePluginId) return;
    e.dataTransfer.setData("application/x-beat-decent-sampler-plugin", draggablePluginId);
    e.dataTransfer.setData("text/plain", plugin.name);
    e.dataTransfer.effectAllowed = "copy";
  }

  return (
    <li
      className={styles.item}
      draggable={Boolean(draggablePluginId)}
      onClick={onOpen}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      title={draggablePluginId ? "Drag to a track to create a new DS instrument instance" : undefined}
    >
      <span className={styles.itemIcon} aria-hidden>
        {plugin.format === "decent-sampler" && plugin.uiImageDataUrl ? (
          <img className={styles.itemThumb} src={plugin.uiImageDataUrl} alt="" />
        ) : (
          <Icon name={iconForPlugin(plugin)} size={14} decorative />
        )}
      </span>
      <span className={styles.itemText}>
        <MarqueeText className={styles.itemName} text={plugin.name} />
        <span className={styles.itemMeta}>
          {plugin.vendor} · {plugin.format === "decent-sampler" ? "DS package" : plugin.kind} · {plugin.status}
        </span>
        <span className={styles.itemVersion}>v{plugin.version ?? "1.0.0"}</span>
      </span>
      <HoverInfo content="Open plugin">
        <Button
          className={styles.itemOpenButton}
          iconOnly
          size="sm"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          aria-label={`Open ${plugin.name}`}
        >
          <Icon name="ph:box-arrow-up-right" size={12} decorative />
        </Button>
      </HoverInfo>
      {menu}
    </li>
  );
}

function ImportCell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.importCell}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

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

function iconForPlugin(plugin: PluginAdapter) {
  if (plugin.format === "decent-sampler") return "ph:package";
  if (plugin.kind === "synth") return "ph:wave-sine";
  if (plugin.kind === "effect") return "ph:sliders-horizontal";
  if (plugin.kind === "renderer") return "ph:file-audio";
  return "ph:puzzle-piece";
}
