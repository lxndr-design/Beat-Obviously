import { useState } from "react";
import { Icon, useContextMenu, HoverInfo, type ContextMenuItem } from "../../components";
import { useComponentStore } from "../../state/components";
import styles from "./ComponentLibraryPanel.module.css";

/**
 * ComponentLibraryPanel — sidebar Components section.
 *
 * Mirrors InstrumentLibraryPanel: collapsible header + indented list.
 * Components are draggable onto track lanes (mime: x-beat-component).
 */
export function ComponentLibraryPanel() {
  const components = useComponentStore((s) => s.components);
  const remove = useComponentStore((s) => s.remove);
  const rename = useComponentStore((s) => s.rename);
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.chevronBtn}
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "Collapse components" : "Expand components"}
        >
          <Icon
            name={expanded ? "ph:caret-down" : "ph:caret-right"}
            size={16}
            decorative
          />
        </button>
        <span className={styles.headerLabel}>Components</span>
        <span className={styles.headerCount}>{components.length}</span>
      </div>

      {expanded && (
        <ul className={styles.list}>
          {components.length === 0 && (
            <li className={styles.empty}>
              Right-click a MIDI or drum segment to save it as a component.
            </li>
          )}
          {components.map((c) => (
            <ComponentItem
              key={c.id}
              id={c.id}
              name={c.name}
              kind={c.kind ?? "midi"}
              lengthBeats={c.lengthBeats}
              itemCount={c.kind === "drum"
                ? c.rows.reduce((sum, row) => sum + row.steps.filter(Boolean).length, 0)
                : c.notes.length}
              onRemove={() => remove(c.id)}
              onRename={() => {
                const next = window.prompt("Component name", c.name);
                if (next != null) rename(c.id, next);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

interface ItemProps {
  id: string;
  name: string;
  kind: "midi" | "drum";
  lengthBeats: number;
  itemCount: number;
  onRemove: () => void;
  onRename: () => void;
}

function ComponentItem({
  id,
  name,
  kind,
  lengthBeats,
  itemCount,
  onRemove,
  onRename,
}: ItemProps) {
  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    { label: "Rename", icon: "ph:pencil-simple", onSelect: onRename },
    {
      label: "Delete",
      icon: "ph:trash",
      onSelect: onRemove,
      separatorBefore: true,
    },
  ]);

  function onDragStart(e: React.DragEvent<HTMLLIElement>) {
    e.dataTransfer.setData("application/x-beat-component", id);
    e.dataTransfer.setData("text/plain", name);
    e.dataTransfer.effectAllowed = "copy";
  }

  return (
    <li
      className={styles.item}
      draggable
      onDragStart={onDragStart}
      onContextMenu={onContextMenu}
    >
      <span className={styles.itemDot} aria-hidden>
        <Icon name="ph:dots-six-vertical" size={14} decorative />
      </span>
      <span className={styles.itemName}>{name}</span>
      <HoverInfo content={`${itemCount} ${kind === "drum" ? "hit" : "note"}${itemCount === 1 ? "" : "s"} · ${lengthBeats} beats`}>
        <span className={styles.itemMeta}>
          <Icon name={kind === "drum" ? "ph:drum" : "ph:piano-keys"} size={14} decorative />
        </span>
      </HoverInfo>
      {menu}
    </li>
  );
}
