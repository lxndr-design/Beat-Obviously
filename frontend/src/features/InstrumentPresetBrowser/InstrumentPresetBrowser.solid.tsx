import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { filterInstrumentPresetEntries, type InstrumentPresetSearchEntry } from "../../state/instrumentPresetLibrary";
import { Button, Checkbox, Icon, LibrarySearch, RowActionButton, RowItem } from "../../solid-ui";
import styles from "./InstrumentPresetBrowser.module.css";

export interface InstrumentPresetBrowserEntry extends InstrumentPresetSearchEntry {
  updatedAt: number;
  sourceLabel?: string;
  description?: string;
  deletable?: boolean;
}

export interface InstrumentPresetBrowserProps {
  open: boolean;
  title: string;
  entries: InstrumentPresetBrowserEntry[];
  loading?: boolean;
  busy?: boolean;
  previewingId?: string | null;
  onClose: () => void;
  onSaveCurrent: () => void;
  onApply: (id: string) => void;
  onTogglePreview: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
}

export function InstrumentPresetBrowser(props: InstrumentPresetBrowserProps) {
  const [search, setSearch] = createSignal("");
  const [favoritesOnly, setFavoritesOnly] = createSignal(false);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const filtered = createMemo(() => filterInstrumentPresetEntries(props.entries, {
    search: search(),
    favoritesOnly: favoritesOnly(),
  }));
  const selected = createMemo(() => {
    const selected = props.entries.find((entry) => entry.id === selectedId());
    if (selected) return selected;
    return filtered()[0] ?? null;
  });

  createEffect(() => {
    if (!props.open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      props.onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    onCleanup(() => window.removeEventListener("keydown", closeOnEscape));
  });

  return (
    <Show when={props.open}>
      <div class={styles.scrim} data-floating-layer onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}>
        <section class={styles.browser} role="dialog" aria-modal="true" aria-label={props.title}>
          <header class={styles.header}>
            <div>
              <h3>{props.title}</h3>
              <p>{props.entries.length} preset{props.entries.length === 1 ? "" : "s"}</p>
            </div>
            <Button iconOnly variant="ghost" aria-label="Close preset browser" onClick={props.onClose}>
              <Icon name="ph:x" size={18} decorative />
            </Button>
          </header>

          <div class={styles.filters}>
            <LibrarySearch
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
              placeholder="Search presets..."
              aria-label="Search instrument presets"
            />
            <Checkbox
              checked={favoritesOnly()}
              label="Favorites"
              onChange={setFavoritesOnly}
            />
          </div>

          <ul class={styles.list} role="listbox" aria-label="Saved instrument presets">
            <Show when={!props.loading} fallback={<li class={styles.empty} role="status">Loading presets...</li>}>
              <Show when={filtered().length > 0} fallback={<li class={styles.empty}>No matching presets.</li>}>
                <For each={filtered()}>{(entry) => (
                  <RowItem
                    className={`${styles.presetRow} ${entry.deletable === false ? styles.singleActionRow : ""} ${selected()?.id === entry.id ? styles.selected : ""}`}
                    density="media"
                    scale="large"
                    reserveDragSlot={false}
                    cursor="pointer"
                    role="option"
                    tabIndex={0}
                    aria-selected={selected()?.id === entry.id}
                    name={entry.name}
                    meta={entry.tags.length > 0 ? entry.tags.join(" / ") : "Untagged"}
                    detail={[entry.sourceLabel, entry.description].filter(Boolean).join(" - ")}
                    icon={(
                      <Checkbox
                        checked={entry.favorite}
                        disabled={props.busy}
                        onChange={() => props.onToggleFavorite(entry.id)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`${entry.favorite ? "Remove" : "Add"} ${entry.name} ${entry.favorite ? "from" : "to"} favorites`}
                      />
                    )}
                    iconAriaHidden={false}
                    action={(
                      <div class={styles.rowActions}>
                        <RowActionButton
                          aria-label={`${props.previewingId === entry.id ? "Stop" : "Preview"} ${entry.name}`}
                          disabled={props.busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onTogglePreview(entry.id);
                          }}
                        >
                          <Icon name={props.previewingId === entry.id ? "ph:stop-fill" : "ph:play-fill"} size={18} decorative />
                        </RowActionButton>
                        <Show when={entry.deletable !== false}>
                          <RowActionButton
                            aria-label={`Delete ${entry.name}`}
                            disabled={props.busy}
                            onClick={(event) => {
                              event.stopPropagation();
                              props.onDelete(entry.id);
                            }}
                          >
                            <Icon name="ph:trash" size={18} decorative />
                          </RowActionButton>
                        </Show>
                      </div>
                    )}
                    onClick={() => setSelectedId(entry.id)}
                    onDblClick={() => { if (!props.busy) props.onApply(entry.id); }}
                    onKeyDown={(event) => {
                      if (event.key === " ") {
                        event.preventDefault();
                        setSelectedId(entry.id);
                      } else if (event.key === "Enter" && !props.busy) {
                        event.preventDefault();
                        props.onApply(entry.id);
                      }
                    }}
                  />
                )}</For>
              </Show>
            </Show>
          </ul>

          <footer class={styles.footer}>
            <Button variant="ghost" disabled={props.busy} onClick={props.onSaveCurrent}>
              <Icon name="ph:floppy-disk" size={18} decorative />
              Save current
            </Button>
            <Button
              variant="primary"
              disabled={props.busy || !selected()}
              onClick={() => selected() && props.onApply(selected()!.id)}
            >
              Apply preset
            </Button>
          </footer>
        </section>
      </div>
    </Show>
  );
}
