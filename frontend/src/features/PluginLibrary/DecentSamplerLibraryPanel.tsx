import { useMemo, useState } from "react";
import { HoverInfo, Icon, SectionRibbon, SectionRibbonActionButton } from "../../components";
import { usePluginStore, useUiStore } from "../../state/store";
import { PluginImportModal, PluginItem } from "./PluginLibraryPanel";
import styles from "./PluginLibraryPanel.module.css";

interface DecentSamplerLibraryPanelProps {
  expanded: boolean;
  onToggle: () => void;
}

export function DecentSamplerLibraryPanel({ expanded, onToggle }: DecentSamplerLibraryPanelProps) {
  const allPlugins = usePluginStore((s) => s.plugins);
  const plugins = useMemo(
    () => allPlugins.filter((plugin) => plugin.format === "decent-sampler"),
    [allPlugins],
  );
  const openEditor = useUiStore((s) => s.openEditor);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className={styles.panel}>
      <SectionRibbon
        title="DecentSampler"
        expanded={expanded}
        onToggle={onToggle}
        showToggle={false}
        count={plugins.length}
        actions={
          <HoverInfo content="Import plugin">
            <SectionRibbonActionButton onClick={() => setImportOpen(true)} aria-label="Import DecentSampler package">
              <Icon name="ph:plus" size={16} decorative />
            </SectionRibbonActionButton>
          </HoverInfo>
        }
      />

      <ul className={`${styles.list} ${expanded ? styles.listOpen : ""}`} aria-hidden={!expanded}>
        {plugins.length === 0 ? (
          <li className={styles.empty}>No DecentSampler packages installed.</li>
        ) : (
          plugins.map((plugin) => (
            <PluginItem
              key={plugin.id}
              plugin={plugin}
              onOpen={() => openEditor({ kind: "plugin", pluginId: plugin.id })}
            />
          ))
        )}
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
