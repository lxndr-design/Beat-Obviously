import { createSignal, For, Show } from "solid-js";
import { HoverInfo, Icon, SectionRibbon, SectionRibbonActionButton } from "../../solid-ui";
import { usePluginStore, useUiStore } from "../../state/store";
import { createStoreSelector } from "../../solid-utils/store";
import { PluginImportModalSolid } from "./PluginImportModal.solid";
import { PluginItemSolid } from "./PluginLibraryPanel.solid";
import styles from "./PluginLibraryPanel.module.css";

interface DecentSamplerLibraryPanelProps {
  expanded: boolean;
  onToggle: () => void;
}

export function DecentSamplerLibraryPanelSolid(props: DecentSamplerLibraryPanelProps) {
  const allPlugins = createStoreSelector(usePluginStore, (s) => s.plugins);
  const plugins = () => allPlugins().filter((plugin) => plugin.format === "decent-sampler");
  const [importOpen, setImportOpen] = createSignal(false);

  return (
    <div class={styles.panel}>
      <SectionRibbon
        title="DecentSampler"
        expanded={props.expanded}
        onToggle={props.onToggle}
        showToggle={false}
        count={plugins().length}
        actions={(
          <HoverInfo content="Import DS file">
            <SectionRibbonActionButton onClick={() => setImportOpen(true)} aria-label="Import DS file">
              <Icon name="ph:plus" size={16} decorative />
            </SectionRibbonActionButton>
          </HoverInfo>
        )}
      />

      <ul class={`${styles.list} ${props.expanded ? styles.listOpen : ""}`} aria-hidden={!props.expanded}>
        <Show when={plugins().length > 0} fallback={<li class={styles.empty}>No DecentSampler packages installed.</li>}>
          <For each={plugins()}>
            {(plugin) => (
              <PluginItemSolid
                plugin={plugin}
                onOpen={() => useUiStore.getState().openEditor({ kind: "plugin", pluginId: plugin.id })}
              />
            )}
          </For>
        </Show>
      </ul>

      <Show when={importOpen()}>
        <PluginImportModalSolid
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
