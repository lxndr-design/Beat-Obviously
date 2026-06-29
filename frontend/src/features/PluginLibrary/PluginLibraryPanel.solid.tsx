import { createSignal, For, Show } from "solid-js";
import { Button, HoverInfo, Icon, RowItem, SectionRibbon, SectionRibbonActionButton, createContextMenu, type ContextMenuItem } from "../../solid-ui";
import { appConfirm } from "../../solid-ui";
import { usePluginStore, useUiStore } from "../../state/store";
import type { PluginAdapter } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { decentSamplerDragPluginId } from "./decentSamplerPluginAdapter";
import { PluginImportModal } from "./PluginImportModal.solid";
import styles from "./PluginLibraryPanel.module.css";

interface PluginLibraryPanelProps {
  expanded: boolean;
  onToggle: () => void;
  onOpenDecentSampler?: () => void;
}

export const BUILTIN_DECENT_SAMPLER_PLUGIN_ID = "plugin-decent-sampler-host";
const AETHER_BRIDGE_HOST_PLUGIN_ID = "plugin-aether-bridge-host";
const BUILTIN_DECENT_SAMPLER_PLUGIN: PluginAdapter = {
  id: BUILTIN_DECENT_SAMPLER_PLUGIN_ID,
  name: "DecentSampler",
  vendor: "Beat",
  version: "built-in",
  kind: "renderer",
  format: "native",
  status: "installed",
  instrumentMode: "live-instrument",
  factory: true,
  description: "Built-in DecentSampler host. Installed DS packages live in the DecentSampler rail pane.",
  capabilities: [
    {
      id: "decent-sampler-host",
      kind: "instrument",
      label: "Host DecentSampler packages",
      realtime: true,
      offline: true,
      latencySamples: 0,
      fallbackMode: "pass-through",
    },
  ],
};

export function PluginLibraryPanel(props: PluginLibraryPanelProps) {
  const plugins = createStoreSelector(usePluginStore, (s) => s.plugins);
  const [importOpen, setImportOpen] = createSignal(false);
  const visiblePlugins = () => [
    ...plugins().filter((plugin) => plugin.format !== "decent-sampler"),
    BUILTIN_DECENT_SAMPLER_PLUGIN,
  ];

  function openPlugin(plugin: PluginAdapter) {
    if (plugin.id === BUILTIN_DECENT_SAMPLER_PLUGIN_ID) {
      props.onOpenDecentSampler?.();
      return;
    }
    useUiStore.getState().openEditor({ kind: "plugin", pluginId: plugin.id });
  }

  return (
    <div class={styles.panel}>
      <SectionRibbon
        title="Plugins"
        expanded={props.expanded}
        onToggle={props.onToggle}
        showToggle={false}
        actions={(
          <HoverInfo content="Import DS file">
            <SectionRibbonActionButton onClick={() => setImportOpen(true)} aria-label="Import DS file">
              <Icon name="ph:plus" size={16} decorative />
            </SectionRibbonActionButton>
          </HoverInfo>
        )}
      />

      <ul class={`${styles.list} ${props.expanded ? styles.listOpen : ""}`} aria-hidden={!props.expanded}>
        <For each={visiblePlugins()}>
          {(plugin) => (
            <PluginItem
              plugin={plugin}
              onOpen={() => openPlugin(plugin)}
            />
          )}
        </For>
      </ul>

      <Show when={importOpen()}>
        <PluginImportModal
          onClose={() => setImportOpen(false)}
          onInstalled={(pluginId) => {
            setImportOpen(false);
            useUiStore.getState().openEditor({ kind: "plugin", pluginId });
          }}
        />
      </Show>
    </div>
  );
}

interface PluginItemProps {
  plugin: PluginAdapter;
  onOpen: () => void;
}

export function PluginItem(props: PluginItemProps) {
  const isBuiltInDecentSampler = () => props.plugin.id === BUILTIN_DECENT_SAMPLER_PLUGIN_ID;
  const isAetherBridgeHost = () => props.plugin.id === AETHER_BRIDGE_HOST_PLUGIN_ID;
  const draggablePluginId = () => decentSamplerDragPluginId(props.plugin);
  const menu = createContextMenu((): ContextMenuItem[] => {
    if (isBuiltInDecentSampler()) {
      return [
        { label: "Open DecentSampler", icon: "ph:arrow-square-out", onSelect: props.onOpen },
      ];
    }
    return [
      { label: "Open", icon: "ph:arrow-square-out", onSelect: props.onOpen },
      {
        label: props.plugin.format === "decent-sampler"
          ? (props.plugin.status === "installed" ? "Refresh Package" : "Install Package")
          : (props.plugin.status === "installed" ? "Reinstall" : "Install"),
        icon: "ph:download-simple",
        onSelect: props.onOpen,
      },
      {
        label: props.plugin.format === "decent-sampler" ? "Open Package UI" : props.plugin.kind === "synth" ? "Create Instrument" : "Render WAV",
        icon: props.plugin.format === "decent-sampler" ? "ph:package" : props.plugin.kind === "synth" ? "ph:wave-sine" : "ph:file-audio",
        onSelect: props.onOpen,
        separatorBefore: true,
      },
      {
        label: "Delete",
        icon: "ph:trash",
        disabled: Boolean(props.plugin.factory),
        separatorBefore: true,
        onSelect: () => void deletePlugin(props.plugin),
      },
    ];
  });

  async function deletePlugin(plugin: PluginAdapter) {
    if (plugin.factory) return;
    if (!await appConfirm(`Delete "${plugin.name}" from this project?`)) return;
    useUiStore.getState().closeEditor({ kind: "plugin", pluginId: plugin.id });
    usePluginStore.getState().removePlugin(plugin.id);
  }

  function onDragStart(event: DragEvent) {
    const id = draggablePluginId();
    if (!id) return;
    event.dataTransfer?.setData("application/x-beat-decent-sampler-plugin", id);
    event.dataTransfer?.setData("text/plain", props.plugin.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
  }

  return (
    <RowItem
      className={styles.pluginRow}
      density="media"
      cursor="pointer"
      draggable={Boolean(draggablePluginId())}
      onClick={props.onOpen}
      onDblClick={props.onOpen}
      onContextMenu={menu.onContextMenu}
      onDragStart={onDragStart}
      title={draggablePluginId() ? "Drag to a track to create a new DS instrument instance" : undefined}
      dragSlot={draggablePluginId() && <Icon name="ph:dots-six-vertical" size={14} decorative />}
      icon={
        isAetherBridgeHost() ? (
          <AetherBridgeIcon />
        ) : isBuiltInDecentSampler() ? (
          <img class={styles.itemLogo} src="/assets/decent-sampler.svg" alt="" />
        ) : props.plugin.format === "decent-sampler" && props.plugin.uiImageDataUrl ? (
          <img class={styles.itemThumb} src={props.plugin.uiImageDataUrl} alt="" />
        ) : (
          <Icon name={iconForPlugin(props.plugin)} size={14} decorative />
        )
      }
      name={props.plugin.name}
      meta={`${props.plugin.vendor} · ${isBuiltInDecentSampler() ? "built-in plugin" : props.plugin.format === "decent-sampler" ? "DS package" : props.plugin.kind} · ${props.plugin.status}`}
      detail={isBuiltInDecentSampler() ? "host" : `v${props.plugin.version ?? "1.0.0"}`}
      action={(
        <Button
          className={styles.itemOpenButton}
          iconOnly
          size="sm"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            props.onOpen();
          }}
          aria-label={`Open ${props.plugin.name}`}
        >
          <Icon name="ph:arrow-square-out" size={12} decorative />
        </Button>
      )}
    >
      {menu.menu()}
    </RowItem>
  );
}

function AetherBridgeIcon() {
  return (
    <span class={styles.aetherBridgeIcon}>
      <svg viewBox="0 0 28 28">
        <path
          class={styles.aetherBridgeWaveShadow}
          d="M3.4 14c2.1-5.4 4.2-5.4 6.3 0s4.2 5.4 6.3 0 4.2-5.4 6.3 0 4.2 5.4 6.3 0"
        />
        <path
          class={styles.aetherBridgeWave}
          d="M3.4 14c2.1-5.4 4.2-5.4 6.3 0s4.2 5.4 6.3 0 4.2-5.4 6.3 0 4.2 5.4 6.3 0"
        />
      </svg>
    </span>
  );
}

function iconForPlugin(plugin: PluginAdapter) {
  if (plugin.format === "decent-sampler") return "ph:package";
  if (plugin.kind === "synth") return "ph:wave-sine";
  if (plugin.kind === "effect") return "ph:sliders-horizontal";
  if (plugin.kind === "renderer") return "ph:file-audio";
  return "ph:puzzle-piece";
}
