import { createEffect, createSignal, Show, type JSX } from "solid-js";
import { createContextMenu, type ContextMenuItem } from "../ContextMenu";
import { Icon } from "../Icon";
import { Tag } from "../Tag";
import styles from "./LibraryFolder.module.css";

export interface LibraryFolderProps {
  name: string;
  count: number;
  open: boolean;
  scale?: "default" | "large";
  factory?: boolean;
  locked?: boolean;
  renaming?: boolean;
  dragMime: string;
  children: JSX.Element;
  onToggle: () => void;
  onDropItem: (id: string) => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onUngroup: () => void;
}

export function LibraryFolder(props: LibraryFolderProps) {
  const [draftName, setDraftName] = createSignal(props.name);
  const hasItems = () => props.count > 0;
  const expanded = () => props.open && hasItems();
  const canEdit = () => !props.factory && !props.locked;
  const menu = createContextMenu((): ContextMenuItem[] => [
    { label: "Rename", icon: "ph:pencil-simple", disabled: !canEdit(), onSelect: startRename },
    { label: "Ungroup", icon: "ph:folder-simple-dashed", disabled: !canEdit(), onSelect: props.onUngroup, separatorBefore: true },
  ]);

  createEffect(() => {
    if (props.renaming) setDraftName(props.name);
  });

  function startRename() {
    if (!canEdit()) return;
    setDraftName(props.name);
    props.onStartRename();
  }

  function onDragOver(event: DragEvent) {
    if (!Array.from(event.dataTransfer?.types ?? []).includes(props.dragMime)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function onDrop(event: DragEvent) {
    const id = event.dataTransfer?.getData(props.dragMime);
    if (!id) return;
    event.preventDefault();
    props.onDropItem(id);
  }

  return (
    <section class={[styles.folder, styles[`scale-${props.scale ?? "default"}`]].join(" ")} onDragOver={onDragOver} onDrop={onDrop}>
      <div
        class={[styles.header, expanded() && styles.headerOpen, !hasItems() && styles.headerDisabled].filter(Boolean).join(" ")}
        role={props.renaming || !hasItems() ? undefined : "button"}
        tabIndex={props.renaming || !hasItems() ? undefined : 0}
        aria-expanded={props.renaming || !hasItems() ? undefined : expanded()}
        aria-disabled={props.renaming || hasItems() ? undefined : true}
        aria-label={props.renaming ? undefined : hasItems() ? `${expanded() ? "Collapse" : "Expand"} ${props.name}` : props.name}
        onClick={props.renaming || !hasItems() ? undefined : props.onToggle}
        onContextMenu={menu.onContextMenu}
        onKeyDown={props.renaming || !hasItems() ? undefined : (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          props.onToggle();
        }}
      >
        <span class={styles.toggle} aria-hidden>
          <Icon name={expanded() ? "ph:caret-down" : "ph:caret-right"} size={18} decorative />
        </span>
        <Show
          when={props.renaming}
          fallback={<span class={styles.name} title={props.name}>{props.name}</span>}
        >
          <input
            class={styles.nameInput}
            value={draftName()}
            autofocus
            onFocus={(event) => event.currentTarget.select()}
            onInput={(event) => setDraftName(event.currentTarget.value)}
            onBlur={() => props.onRename(draftName())}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onRename(draftName());
              if (event.key === "Escape") props.onCancelRename();
            }}
            aria-label={`Rename ${props.name}`}
          />
        </Show>
        <Tag className={styles.count} tone={props.count === 0 ? "zero" : "default"}>{props.count}</Tag>
      </div>
      <ul class={`${styles.list} ${expanded() ? styles.listOpen : ""}`} aria-hidden={!expanded()}>
        {props.children}
      </ul>
      {menu.menu()}
    </section>
  );
}
