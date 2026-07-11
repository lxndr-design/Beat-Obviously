import { createSignal, For, onCleanup, Show } from "solid-js";
import { Icon, LibraryFolder, LibrarySearch, RowActionButton, RowItem, SectionRibbon, SectionRibbonActionButton, createContextMenu, type ContextMenuItem } from "../../solid-ui";
import { appPrompt } from "../../solid-ui";
import { createInstrumentBufferSource, noteFrequency, preloadInstrumentSample } from "../../audio/synthPreview";
import {
  DEFAULT_DRUM_MIDI_PITCH,
  DEFAULT_DRUM_VELOCITY,
  drumPlaybackDurationBeats,
  drumPlaybackStepLengthBeats,
  drumTimingOffsetBeats,
  normalizeDrumCell,
} from "../../state/drumSteps";
import {
  FACTORY_COMPONENT_FOLDER_ID,
  USER_COMPONENT_FOLDER_ID,
  useComponentStore,
  type BeatComponent,
  type ComponentFolder,
} from "../../state/components";
import { useInstrumentStore, useProjectStore, useUiStore } from "../../state/store";
import type { Instrument, MidiNote } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import styles from "./ComponentLibraryPanel.module.css";

interface ComponentLibraryPanelProps {
  expanded: boolean;
  onToggle: () => void;
}

export function ComponentLibraryPanel(props: ComponentLibraryPanelProps) {
  const components = createStoreSelector(useComponentStore, (s) => s.components);
  const folders = createStoreSelector(useComponentStore, (s) => s.componentFolders);
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const bpm = createStoreSelector(useProjectStore, (s) => s.project.bpm);
  const [playingId, setPlayingId] = createSignal<string | null>(null);
  const [openFolders, setOpenFolders] = createSignal<Record<string, boolean>>({
    [FACTORY_COMPONENT_FOLDER_ID]: true,
    [USER_COMPONENT_FOLDER_ID]: true,
  });
  const [renamingFolderId, setRenamingFolderId] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const normalizedSearch = () => searchQuery().trim().toLowerCase();
  let playback: ComponentPlayback | null = null;
  const addMenu = createContextMenu((): ContextMenuItem[] => [{
    label: "New folder",
    icon: "ph:folder-plus",
    onSelect: createFolder,
  }]);

  onCleanup(() => stopComponentPlayback(playback));

  function togglePreview(component: BeatComponent) {
    if (playingId() === component.id) {
      stopComponentPlayback(playback);
      playback = null;
      setPlayingId(null);
      return;
    }

    stopComponentPlayback(playback);
    playback = playComponentPreview(component, instruments(), bpm(), () => {
      playback = null;
      setPlayingId(null);
    });
    setPlayingId(component.id);
  }

  function createFolder() {
    const id = useComponentStore.getState().addFolder();
    setOpenFolders((current) => ({ ...current, [id]: true }));
    setRenamingFolderId(id);
  }

  return (
    <div class={styles.panel} onContextMenu={addMenu.onContextMenu}>
      <SectionRibbon
        title="Components"
        expanded={props.expanded}
        onToggle={props.onToggle}
        showToggle={false}
        onContextMenu={addMenu.onContextMenu}
        actions={(
          <SectionRibbonActionButton
            onClick={(event) => addMenu.openAt(event.clientX, event.clientY)}
            aria-label="Add component item"
          >
            <Icon name="ph:plus" size={18} decorative />
          </SectionRibbonActionButton>
        )}
      />

      <LibrarySearch
        value={searchQuery()}
        onInput={(event) => setSearchQuery(event.currentTarget.value)}
        placeholder="Search..."
        aria-label="Search patterns"
      />

      <div class={`${styles.list} ${props.expanded ? styles.listOpen : ""}`} aria-hidden={!props.expanded}>
        <Show when={components().length === 0}>
          <div class={styles.empty}>
            Right-click a MIDI or drum segment to save it as a component.
          </div>
        </Show>
        <For each={folders()}>
          {(folder) => {
            const items = () => components().filter((component) =>
              componentFolderId(component) === folder.id
              && (!normalizedSearch() || `${component.name} ${component.kind}`.toLowerCase().includes(normalizedSearch())),
            );
            const open = () => openFolders()[folder.id] ?? false;
            return (
              <Show when={!normalizedSearch() || items().length > 0}>
              <LibraryFolder
                name={componentFolderDisplayName(folder)}
                count={items().length}
                scale="large"
                factory={folder.factory}
                locked={folder.id === USER_COMPONENT_FOLDER_ID}
                open={Boolean(normalizedSearch()) || open()}
                renaming={renamingFolderId() === folder.id}
                dragMime="application/x-beat-component"
                onToggle={() => setOpenFolders((current) => ({ ...current, [folder.id]: !open() }))}
                onDropItem={(componentId) => useComponentStore.getState().moveToFolder(componentId, folder.id)}
                onStartRename={() => setRenamingFolderId(folder.id)}
                onRename={(name) => {
                  useComponentStore.getState().renameFolder(folder.id, name);
                  setRenamingFolderId(null);
                }}
                onCancelRename={() => setRenamingFolderId(null)}
                onUngroup={() => {
                  useComponentStore.getState().ungroupFolder(folder.id);
                  setOpenFolders((current) => {
                    const next = { ...current };
                    delete next[folder.id];
                    return next;
                  });
                }}
              >
                <For each={items()}>
                  {(component) => (
                    <ComponentItem
                      component={component}
                      itemCount={component.kind === "drum"
                        ? component.rows.reduce((sum, row) => sum + row.steps.filter(Boolean).length, 0)
                        : component.notes.length}
                      playing={playingId() === component.id}
                      onTogglePreview={() => togglePreview(component)}
                      onMoveBefore={(componentId) => useComponentStore.getState().moveToFolder(componentId, folder.id, component.id)}
                    />
                  )}
                </For>
              </LibraryFolder>
              </Show>
            );
          }}
        </For>
      </div>
      {addMenu.menu()}
    </div>
  );
}

interface ItemProps {
  component: BeatComponent;
  itemCount: number;
  playing: boolean;
  onTogglePreview: () => void;
  onMoveBefore: (componentId: string) => void;
}

function ComponentItem(props: ItemProps) {
  const menu = createContextMenu((): ContextMenuItem[] => [
    {
      label: "Edit",
      icon: "ph:pencil-line",
      onSelect: () => useUiStore.getState().openEditor({ kind: "component", componentId: props.component.id }),
    },
    {
      label: "Rename",
      icon: "ph:pencil-simple",
      onSelect: () => void renameComponent(props.component),
    },
    {
      label: "Delete",
      icon: "ph:trash",
      onSelect: () => useComponentStore.getState().remove(props.component.id),
      separatorBefore: true,
    },
  ]);

  async function renameComponent(component: BeatComponent) {
    const next = await appPrompt("Component name", component.name);
    if (next != null) useComponentStore.getState().rename(component.id, next);
  }

  function onDragStart(event: DragEvent) {
    event.dataTransfer?.setData("application/x-beat-component", props.component.id);
    event.dataTransfer?.setData("text/plain", props.component.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(event: DragEvent) {
    if (!Array.from(event.dataTransfer?.types ?? []).includes("application/x-beat-component")) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function onDrop(event: DragEvent) {
    const draggedId = event.dataTransfer?.getData("application/x-beat-component");
    if (!draggedId || draggedId === props.component.id) return;
    event.preventDefault();
    props.onMoveBefore(draggedId);
  }

  const kind = () => props.component.kind ?? "midi";

  return (
    <RowItem
      className={styles.componentRow}
      density="compact"
      scale="large"
      cursor="grab"
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={menu.onContextMenu}
      title={`${props.itemCount} ${kind() === "drum" ? "hit" : "note"}${props.itemCount === 1 ? "" : "s"} · ${componentPlaybackLength(props.component)} beats`}
      icon={kind() === "drum" ? <span class={styles.drumIcon} aria-hidden /> : <Icon name="ph:piano-keys" size={18} decorative />}
      hoverIcon={<Icon name="ph:dots-six-vertical" size={18} decorative />}
      name={props.component.name}
      action={(
        <RowActionButton
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            props.onTogglePreview();
          }}
          aria-label={`${props.playing ? "Pause" : "Play"} ${props.component.name}`}
        >
          <Icon name={props.playing ? "ph:pause-fill" : "ph:play-fill"} size={18} decorative />
        </RowActionButton>
      )}
    >
      {menu.menu()}
    </RowItem>
  );
}

function componentFolderId(component: BeatComponent): string {
  return component.folderId ?? (component.factory ? FACTORY_COMPONENT_FOLDER_ID : USER_COMPONENT_FOLDER_ID);
}

function componentFolderDisplayName(folder: ComponentFolder): string {
  if (!folder.factory || folder.name.toLowerCase().startsWith("factory")) return folder.name;
  return `Factory ${folder.name}`;
}

export interface ComponentPlayback {
  ctx: AudioContext;
  sources: Set<AudioBufferSourceNode>;
  gains: Set<GainNode>;
  timers: number[];
  bpm: number;
  onDone: () => void;
  doneTimer: number;
}

export function playComponentPreview(
  component: BeatComponent,
  instruments: Instrument[],
  bpm: number,
  onDone: () => void,
  speedMultiplier = 1,
  donePaddingMs = 80,
): ComponentPlayback {
  const ctx = getComponentPreviewCtx();
  if (ctx.state === "suspended") void ctx.resume();

  const playback: ComponentPlayback = {
    ctx,
    sources: new Set(),
    gains: new Set(),
    timers: [],
    bpm,
    onDone,
    doneTimer: 0,
  };

  const previewSpeed = Math.max(0.25, Math.min(4, speedMultiplier));
  const secondsPerBeat = (60 / Math.max(1, bpm)) / previewSpeed;
  const durationBeats = component.kind === "drum" ? drumPlaybackDurationBeats(component.lengthBeats, component.speed) : component.lengthBeats;
  const durationSeconds = Math.max(0.1, durationBeats * secondsPerBeat);
  const now = ctx.currentTime;

  if (component.kind === "drum") {
    const stepLengthBeats = drumPlaybackStepLengthBeats(component.lengthBeats, component.stepCount, component.speed);
    for (const row of component.rows) {
      const instrument = instruments.find((i) => i.id === row.instrumentId) ?? instruments[0] ?? fallbackInstrument;
      if (instrument.sampleUrl) {
        void preloadInstrumentSample(ctx, instrument).catch(() => undefined);
      }
      for (let step = 0; step < component.stepCount; step++) {
        const cell = normalizeDrumCell(row.steps[step]);
        if (!cell.on) continue;
        const at = now + (
          step * stepLengthBeats +
          drumTimingOffsetBeats(step, stepLengthBeats, component.swingPercent, cell.leanPercent)
        ) * secondsPerBeat;
        schedulePreviewNote(
          playback,
          instrument,
          cell.pitchHz ?? component.defaultPitchHz ?? noteFrequency(DEFAULT_DRUM_MIDI_PITCH, instrument),
          at,
          Math.max(0.05, Math.min(0.18, stepLengthBeats * secondsPerBeat)),
          cell.velocity ?? DEFAULT_DRUM_VELOCITY,
        );
      }
    }
  } else {
    const instrument = instruments.find((i) => i.id === component.instrumentId) ?? instruments[0] ?? fallbackInstrument;
    if (instrument.sampleUrl) {
      void preloadInstrumentSample(ctx, instrument).catch(() => undefined);
    }
    for (const note of component.notes) {
      schedulePreviewMidiNote(playback, note, instrument, now, secondsPerBeat);
    }
  }

  playback.doneTimer = window.setTimeout(() => {
    stopComponentPlayback(playback);
    onDone();
  }, Math.ceil(durationSeconds * 1000) + Math.max(0, donePaddingMs));

  return playback;
}

function schedulePreviewMidiNote(
  playback: ComponentPlayback,
  note: MidiNote,
  instrument: Instrument,
  startTime: number,
  secondsPerBeat: number,
) {
  schedulePreviewNote(
    playback,
    instrument,
    note.frequencyHz ?? noteFrequency(note.pitch, instrument),
    startTime + note.startBeat * secondsPerBeat,
    Math.max(0.03, note.lengthBeats * secondsPerBeat),
    note.velocity,
  );
}

function schedulePreviewNote(
  playback: ComponentPlayback,
  instrument: Instrument,
  frequencyHz: number,
  atTimeS: number,
  durationS: number,
  velocity: number,
) {
  const source = createInstrumentBufferSource(playback.ctx, instrument, durationS + 0.05, frequencyHz, undefined, velocity, playback.bpm);
  const playbackDuration = source.buffer
    ? Math.max(durationS, Math.min(1.5, source.buffer.duration / source.playbackRate.value))
    : durationS;
  const gain = playback.ctx.createGain();
  const peak = (Math.max(0, Math.min(127, velocity)) / 127) * 0.24;
  const release = Math.min(0.12, playbackDuration * 0.5);
  gain.gain.setValueAtTime(0, atTimeS);
  gain.gain.linearRampToValueAtTime(peak, atTimeS + 0.005);
  gain.gain.setValueAtTime(peak, atTimeS + Math.max(0, playbackDuration - release));
  gain.gain.linearRampToValueAtTime(0, atTimeS + playbackDuration);
  source.connect(gain);
  gain.connect(playback.ctx.destination);
  source.onended = () => {
    playback.sources.delete(source);
    playback.gains.delete(gain);
    source.disconnect();
    gain.disconnect();
  };
  playback.sources.add(source);
  playback.gains.add(gain);
  source.start(atTimeS);
  source.stop(atTimeS + playbackDuration + 0.03);
}

export function stopComponentPlayback(playback: ComponentPlayback | null) {
  if (!playback) return;
  window.clearTimeout(playback.doneTimer);
  for (const timer of playback.timers) window.clearTimeout(timer);
  for (const source of playback.sources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
    source.disconnect();
  }
  for (const gain of playback.gains) gain.disconnect();
  playback.sources.clear();
  playback.gains.clear();
}

let componentPreviewCtx: AudioContext | null = null;

function getComponentPreviewCtx(): AudioContext {
  if (!componentPreviewCtx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    componentPreviewCtx = new Ctor();
  }
  return componentPreviewCtx;
}

function componentPlaybackLength(component: BeatComponent): string {
  const beats = component.kind === "drum"
    ? drumPlaybackDurationBeats(component.lengthBeats, component.speed)
    : component.lengthBeats;
  return Number.isInteger(beats) ? `${beats}` : beats.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

const fallbackInstrument: Instrument = {
  id: "component-preview-fallback",
  name: "Component Preview",
  kind: "synth",
  envelope: { attackMs: 5, decayMs: 100, sustain: 0.6, releaseMs: 160 },
  knobs: { cutoff: 0.6, resonance: 0.15, drive: 0.1, color: 0.5 },
  waveform: "saw",
  sampleIds: [],
  userCreated: false,
};
