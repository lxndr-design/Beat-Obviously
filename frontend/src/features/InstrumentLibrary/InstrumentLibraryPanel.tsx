import { useState } from "react";
import { Button, Icon, useContextMenu, HoverInfo, type ContextMenuItem } from "../../components";
import { useInstrumentStore, useUiStore } from "../../state/store";
import { MergeInstrumentModal } from "./MergeInstrumentModal";
import styles from "./InstrumentLibraryPanel.module.css";

const KIND_ICON: Record<string, string> = {
  synth:   "ph:piano-keys",     // three piano keys
  sampler: "ph:music-notes",    // musical notes
  hybrid:  "ph:waveform",       // squiggle
};

const KIND_HINT: Record<string, string> = {
  synth:   "Synth",
  sampler: "Sampler",
  hybrid:  "Hybrid",
};

/**
 * InstrumentLibraryPanel — sidebar Library section.
 *
 * Layout:
 *   ┌─────────────────────────────────────┐
 *   │ ▾  LIBRARY                       +  │   ← header: chevron, label, add
 *   ├─────────────────────────────────────┤
 *   │   ▸ kick                  synth     │   ← indented list
 *   │   ▸ snare                 sampler   │
 *   └─────────────────────────────────────┘
 *
 * Right-click an instrument for Edit / Duplicate / Merge / Delete.
 * System instruments are not deletable (userCreated === false).
 */
export function InstrumentLibraryPanel() {
  const instruments = useInstrumentStore((s) => s.instruments);
  const addInstrument = useInstrumentStore((s) => s.addInstrument);
  const duplicate = useInstrumentStore((s) => s.duplicateInstrument);
  const remove = useInstrumentStore((s) => s.removeInstrument);
  const openEditor = useUiStore((s) => s.openEditor);
  const [expanded, setExpanded] = useState(true);
  const [mergeFromId, setMergeFromId] = useState<string | null>(null);

  function createNew() {
    const id = addInstrument({ name: "New Instrument", userCreated: true });
    openEditor({ kind: "instrument", instrumentId: id });
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.chevronBtn}
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "Collapse instruments" : "Expand instruments"}
        >
          <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} size={16} decorative />
        </button>
        <span className={styles.headerLabel}>Instruments</span>
        <Button
          iconOnly
          size="sm"
          onClick={createNew}
          aria-label="New instrument"
        >
          <Icon name="ph:plus" size={16} decorative />
        </Button>
      </div>

      {expanded && (
        <ul className={styles.list}>
          {instruments.length === 0 && (
            <li className={styles.empty}>No instruments yet.</li>
          )}
          {instruments.map((i) => (
            <InstrumentItem
              key={i.id}
              id={i.id}
              name={i.name}
              kind={i.kind}
              sampleUrl={i.sampleUrl}
              userCreated={i.userCreated}
              onEdit={() => openEditor({ kind: "instrument", instrumentId: i.id })}
              onDuplicate={() => duplicate(i.id)}
              onMerge={() => setMergeFromId(i.id)}
              onDelete={() => remove(i.id)}
            />
          ))}
        </ul>
      )}

      {mergeFromId && (
        <MergeInstrumentModal
          sourceId={mergeFromId}
          onClose={() => setMergeFromId(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

interface ItemProps {
  id: string;
  name: string;
  kind: string;
  sampleUrl?: string;
  userCreated: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onMerge: () => void;
  onDelete: () => void;
}

function InstrumentItem({
  id,
  name,
  kind,
  sampleUrl,
  userCreated,
  onEdit,
  onDuplicate,
  onMerge,
  onDelete,
}: ItemProps) {
  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    { label: "Edit", icon: "ph:pencil-simple", onSelect: onEdit },
    { label: "Duplicate", icon: "ph:copy", onSelect: onDuplicate },
    { label: "Merge with…", icon: "ph:intersect", onSelect: onMerge },
    {
      label: userCreated ? "Delete" : "Delete (system)",
      icon: "ph:trash",
      onSelect: onDelete,
      disabled: !userCreated,
      separatorBefore: true,
    },
  ]);

  function onDragStart(e: React.DragEvent<HTMLLIElement>) {
    e.dataTransfer.setData("application/x-beat-instrument", id);
    e.dataTransfer.setData("text/plain", name);
    e.dataTransfer.effectAllowed = "copy";
  }

  const drum = isDrumInstrument(name, sampleUrl);
  const iconName = drum ? "ph:drum" : KIND_ICON[kind] ?? "ph:question";
  const hint = drum ? "Drum" : KIND_HINT[kind] ?? kind;

  return (
    <li
      className={styles.item}
      draggable
      onDragStart={onDragStart}
      onDoubleClick={onEdit}
      onContextMenu={onContextMenu}
    >
      <span className={styles.itemDot} aria-hidden>
        <Icon name="ph:dots-six-vertical" size={14} decorative />
      </span>
      <span className={styles.itemName}>{name}</span>
      <HoverInfo content={hint}>
        <span className={styles.itemKindIcon} aria-label={hint}>
          <Icon name={iconName} size={14} decorative />
        </span>
      </HoverInfo>
      {menu}
    </li>
  );
}

function isDrumInstrument(name: string, sampleUrl?: string): boolean {
  if (sampleUrl?.startsWith("/samples/tr505/") || sampleUrl?.startsWith("/samples/cr78/")) return true;
  return /\b(808|kick|snare|hat|tom|clap|rim|ride|crash|cymbal|cowbell|conga|timbal|tamb|guiro|triangle)\b/i.test(name);
}
