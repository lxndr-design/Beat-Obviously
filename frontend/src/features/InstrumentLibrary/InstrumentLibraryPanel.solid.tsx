import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Button, Checkbox, HoverInfo, Icon, LibraryFolder, LibrarySearch, LoadingIndicator, RIBBON_HELP, RowActionButton, RowItem, SectionRibbon, SectionRibbonActionButton, createContextMenu, type ContextMenuItem } from "../../solid-ui";
import { createInstrumentBufferSource, preloadInstrumentSamplesForPlayback, previewFrequency } from "../../audio/synthPreview";
import { registerGlobalAudioStop } from "../../audio/globalAudioSafety";
import { AURUM_TEST_SET_ID, LUMEN_TEST_INSTRUMENT_SET_ID, TEMPORARY_DS_INSTRUMENT_SET_ID, runProjectHistoryGroup, useInstrumentStore, usePluginStore, useProjectStore, useUiStore } from "../../state/store";
import { createAurumInstrument } from "../../state/aurum";
import { userAccessibleInstruments } from "../../state/instrumentAccess";
import { createInstrumentSegmentPatch, instrumentUsesDrumSegment } from "../../state/instrumentTrackCreation";
import { instrumentIcon, instrumentIconLabel } from "../../state/instrumentIcons";
import { instrumentRepositorySearchText } from "../../state/instrumentSongAssociations";
import { createDefaultLumenDraft, synthDraftToInstrumentPatch, useSynthStore, type SynthDraftPatch } from "../../state/synthStore";
import type { Instrument, InstrumentSet } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { MergeInstrumentModal } from "./MergeInstrumentModal.solid";
import { decentSamplerEditorKind, decentSamplerPluginForInstrument } from "../PluginLibrary/decentSamplerPluginAdapter";
import { editorRequestForInstrument } from "../InstrumentEditor/instrumentEditorRouting";
import { compileNodeGraphToInstrumentPatch, createStarterInstrumentNodeGraph } from "../NodeInstrumentEditor/nodeGraph";
import styles from "./InstrumentLibraryPanel.module.css";

const KIND_HINT: Record<string, string> = {
  synth: "Synth",
  sampler: "Sampler",
  hybrid: "Hybrid",
  wavetable: "Wavetable",
};

const INSTRUMENT_SET_EXPANSION_KEY = "beat.instrument-library.open-sets.v1";

function createDraftId() {
  return globalThis.crypto?.randomUUID?.() ?? `draft_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function createDraftInstrument(patch: Partial<Instrument>): Instrument {
  return {
    ...(patch as Instrument),
    id: patch.id ?? createDraftId(),
    name: patch.name ?? "Instrument",
    kind: patch.kind ?? "sampler",
    userCreated: patch.userCreated ?? true,
    knobs: patch.knobs ?? { cutoff: 0.6, resonance: 0.2, drive: 0.1, color: 0.5 },
    envelope: patch.envelope ?? { attackMs: 5, decayMs: 100, sustain: 0.7, releaseMs: 200 },
  };
}

interface InstrumentLibraryPanelProps {
  expanded: boolean;
  onToggle: () => void;
  onOpenDecentSampler: () => void;
}

export function InstrumentLibraryPanel(props: InstrumentLibraryPanelProps) {
  const [searchQuery, setSearchQuery] = createSignal("");
  const normalizedSearch = () => searchQuery().trim().toLowerCase();
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const accessibleInstruments = createMemo(() => userAccessibleInstruments(instruments()));
  const instrumentSets = createStoreSelector(useInstrumentStore, (s) => s.instrumentSets);
  const loading = createStoreSelector(useInstrumentStore, (s) => s.loading);
  const plugins = createStoreSelector(usePluginStore, (s) => s.plugins);
  const [mergeFromId, setMergeFromId] = createSignal<string | null>(null);
  const [previewingId, setPreviewingId] = createSignal<string | null>(null);
  const [openSets, setOpenSets] = createSignal<Record<string, boolean>>(loadOpenInstrumentSets(), { equals: false });
  const [renamingSetId, setRenamingSetId] = createSignal<string | null>(null);
  const [selectMode, setSelectMode] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set(), { equals: false });
  const [lastSelectedId, setLastSelectedId] = createSignal<string | null>(null);
  let previewRequest = 0;
  let panelElement: HTMLDivElement | undefined;

  const selectedInstruments = () => accessibleInstruments().filter((instrument) => selectedIds().has(instrument.id));
  const sortedInstrumentSets = () => [...instrumentSets()]
    .sort((a, b) => instrumentSetDisplayName(a).localeCompare(instrumentSetDisplayName(b), undefined, { sensitivity: "base" }));

  createEffect(() => persistOpenInstrumentSets(openSets()));

  const panelMenu = createContextMenu((): ContextMenuItem[] => [
    {
      label: "Select",
      icon: "ph:checks",
      onSelect: () => enterSelectMode(),
    },
  ]);
  const addMenu = createContextMenu((): ContextMenuItem[] => [
    {
      label: "Create Nodemap",
      icon: "ph:graph",
      onSelect: createNodemap,
    },
    {
      label: "Create Aurum",
      icon: "ph:circles-three-plus",
      onSelect: createAurum,
    },
    {
      label: "Create Lumen",
      icon: "ph:sparkle",
      onSelect: createLumen,
    },
    {
      label: "Create Sampler",
      icon: "ph:waveform",
      onSelect: createSampler,
    },
    {
      label: "Create Timeline Jumper",
      icon: "ph:scissors",
      onSelect: createTimelineJumper,
    },
    {
      label: "Add DS instrument",
      icon: "ph:piano-keys",
      separatorBefore: true,
      onSelect: props.onOpenDecentSampler,
    },
    {
      label: "New Group",
      icon: "ph:folder-plus",
      separatorBefore: true,
      onSelect: createNewGroup,
    },
  ]);

  onCleanup(() => {
    previewRequest += 1;
    stopInstrumentPreview();
  });

  createEffect(() => {
    if (!selectMode()) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") exitSelectMode();
    }

    function onPointerDown(event: PointerEvent) {
      if (panelElement?.contains(event.target as Node)) return;
      exitSelectMode();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    });
  });

  function createNodemap() {
    const draft = createDefaultLumenDraft();
    const instrumentName = nextInstrumentName(instruments(), "Nodemap Patch");
    const namedDraft: SynthDraftPatch = {
      ...structuredClone(draft),
      name: instrumentName,
      metadata: {
        ...structuredClone(draft.metadata),
        icon: "ph:graph",
        tags: [...new Set([...draft.metadata.tags, "node", "nodemap"])],
      },
    };
    const baseInstrument = createDraftInstrument({
      ...synthDraftToInstrumentPatch(namedDraft),
      icon: "ph:graph",
      name: namedDraft.name,
      userCreated: true,
    });
    const graph = createStarterInstrumentNodeGraph(baseInstrument);
    const draftInstrument = {
      ...baseInstrument,
      ...compileNodeGraphToInstrumentPatch(graph, baseInstrument),
    };
    useUiStore.getState().openEditor({
      kind: "synthInstrument",
      instrumentId: draftInstrument.id,
      draftInstrument,
    });
  }

  function createSampler() {
    const instrumentName = nextInstrumentName(instruments(), "Instrument");
    const draftInstrument = createDraftInstrument({
      name: instrumentName,
      icon: "ph:waveform",
      kind: "sampler",
      waveform: "sample",
      sampleIds: [],
      samplerComplexity: "mapped",
      source: { kind: "created", label: "Made in Beat" },
      userCreated: true,
    });
    useUiStore.getState().openEditor({
      kind: "samplerInstrument",
      instrumentId: draftInstrument.id,
      draftInstrument,
    });
  }

  function createTimelineJumper() {
    const instrumentName = nextInstrumentName(instruments(), "Timeline Jumper");
    const draftInstrument = createDraftInstrument({
      name: instrumentName,
      icon: "ph:scissors",
      kind: "sampler",
      waveform: "sample",
      sampleIds: [],
      samplerComplexity: "timeline-jumping",
      envelope: { attackMs: 1, decayMs: 100, sustain: 1, releaseMs: 35 },
      source: { kind: "created", label: "Made in Beat / Timeline Jumping" },
      descriptors: ["sampler", "timeline jumping", "slices", "pads", "keyboard"],
      userCreated: true,
    });
    useUiStore.getState().openEditor({
      kind: "samplerInstrument",
      instrumentId: draftInstrument.id,
      draftInstrument,
    });
  }

  function createAurum() {
    const instrumentName = nextInstrumentName(instruments(), "Aurum Patch");
    const draftInstrument = createAurumInstrument(createDraftId(), instrumentName);
    useUiStore.getState().openEditor({
      kind: "synthInstrument",
      instrumentId: draftInstrument.id,
      draftInstrument,
    });
  }

  function createLumen() {
    const draft = createDefaultLumenDraft();
    const instrumentName = nextInstrumentName(instruments(), "Lumen Patch");
    const namedDraft: SynthDraftPatch = {
      ...structuredClone(draft),
      name: instrumentName,
    };
    useSynthStore.getState().bindInstrument(null);
    useSynthStore.getState().setDraft(namedDraft);
    useUiStore.getState().openEditor({ kind: "lumen" });
  }

  function createNewGroup() {
    const groupName = nextGroupName(instrumentSets());
    const groupId = useInstrumentStore.getState().addInstrumentSet(groupName);
    setOpenSets((value) => ({ ...value, [groupId]: true }));
    setRenamingSetId(groupId);
  }

  function togglePreview(instrument: Instrument) {
    if (previewingId() === instrument.id) {
      previewRequest += 1;
      stopInstrumentPreview();
      setPreviewingId(null);
      return;
    }
    const requestId = previewRequest + 1;
    previewRequest = requestId;
    stopInstrumentPreview();
    void playInstrumentPreview(
      instrument,
      () => {
        if (previewRequest === requestId) setPreviewingId(null);
      },
      () => previewRequest === requestId,
    ).catch(() => {
      if (previewRequest === requestId) setPreviewingId(null);
    });
    setPreviewingId(instrument.id);
  }

  function enterSelectMode(instrumentId?: string) {
    setSelectMode(true);
    if (instrumentId) {
      setSelectedIds(new Set([instrumentId]));
      setLastSelectedId(instrumentId);
    }
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set<string>());
    setLastSelectedId(null);
  }

  function selectInstrument(instrumentId: string, shiftKey: boolean) {
    setSelectMode(true);
    const current = selectedIds();
    if (shiftKey && lastSelectedId()) {
      const start = accessibleInstruments().findIndex((instrument) => instrument.id === lastSelectedId());
      const end = accessibleInstruments().findIndex((instrument) => instrument.id === instrumentId);
      if (start >= 0 && end >= 0) {
        const [lo, hi] = start < end ? [start, end] : [end, start];
        setSelectedIds(new Set([...current, ...accessibleInstruments().slice(lo, hi + 1).map((instrument) => instrument.id)]));
        setLastSelectedId(instrumentId);
        return;
      }
    }

    const next = new Set(current);
    if (next.has(instrumentId)) next.delete(instrumentId);
    else next.add(instrumentId);
    setSelectedIds(next);
    setLastSelectedId(instrumentId);
  }

  function deleteSelected() {
    const deletable = selectedInstruments().filter((candidate) => candidate.userCreated);
    if (deletable.length === 0) return;
    for (const instrument of deletable) {
      useInstrumentStore.getState().removeInstrument(instrument.id);
    }
    exitSelectMode();
  }

  function deleteInstrument(instrument: Instrument) {
    if (!instrument.userCreated) return;
    useInstrumentStore.getState().removeInstrument(instrument.id);
  }

  function createTrackForInstrument(instrument: Instrument) {
    const dsPlugin = decentSamplerPluginForInstrument(instrument, plugins());
    const drum = dsPlugin
      ? decentSamplerEditorKind(dsPlugin) === "drum"
      : instrumentUsesDrumSegment(instrument);
    let segmentId = "";
    runProjectHistoryGroup(() => {
      const projectStore = useProjectStore.getState();
      const trackId = projectStore.addTrack({
        name: instrument.name,
        kind: "midi",
        instrumentId: instrument.id,
      });
      segmentId = projectStore.addSegment(trackId, createInstrumentSegmentPatch(instrument, { drum }));
    });
    if (segmentId) useUiStore.getState().setSelectedSegments([segmentId]);
  }

  function groupSelected() {
    if (selectedInstruments().length === 0) return;
    const groupId = useInstrumentStore.getState().addInstrumentSet("New group");
    for (const instrument of selectedInstruments()) useInstrumentStore.getState().moveInstrument(instrument.id, groupId);
    setOpenSets((value) => ({ ...value, [groupId]: true }));
    exitSelectMode();
  }

  return (
    <div ref={panelElement} class={styles.panel} onMouseDown={panelMenu.onMouseDown} onContextMenu={panelMenu.onContextMenu}>
      <SectionRibbon
        title="Instruments"
        help={RIBBON_HELP.instruments}
        expanded={props.expanded}
        onToggle={props.onToggle}
        showToggle={false}
        onContextMenu={panelMenu.onContextMenu}
        actions={(
          <SectionRibbonActionButton
            onClick={(event) => addMenu.openAt(event.clientX, event.clientY)}
            aria-label="Add instrument item"
          >
            <Icon name="ph:plus" size={18} decorative />
          </SectionRibbonActionButton>
        )}
      />
      <LibrarySearch
        value={searchQuery()}
        onInput={(event) => setSearchQuery(event.currentTarget.value)}
        placeholder="Search instruments or songs..."
        aria-label="Search instruments"
      />
      <Show when={selectMode() && props.expanded}>
        <div class={styles.selectionBar}>
          <Button size="xs" disabled={selectedInstruments().every((instrument) => !instrument.userCreated)} onClick={() => void deleteSelected()}>
            Delete
          </Button>
          <Button size="xs" disabled={selectedInstruments().length === 0} onClick={groupSelected}>
            Group
          </Button>
          <span class={styles.selectionCount}>{selectedInstruments().length}</span>
        </div>
      </Show>

      <div class={`${styles.list} ${props.expanded ? styles.listOpen : ""}`} aria-hidden={!props.expanded}>
        <Show when={loading()}>
          <div class={styles.loadingState} role="status" aria-live="polite">
            <LoadingIndicator size="md" label="Loading Instruments" announce={false} />
          </div>
        </Show>
        <Show when={!loading() && accessibleInstruments().length === 0}>
          <div class={styles.empty}>No instruments yet.</div>
        </Show>
        <Show when={!loading()}>
          <For each={sortedInstrumentSets()}>
            {(set) => {
              const setOpen = () => openSets()[set.id] ?? false;
              const items = () => accessibleInstruments().filter((instrument) =>
                instrumentSetId(instrument) === set.id
                && (!normalizedSearch() || instrumentRepositorySearchText(instrument).includes(normalizedSearch())),
              );
              return (
                <Show when={!normalizedSearch() || items().length > 0}>
                <LibraryFolder
                  name={instrumentSetDisplayName(set)}
                  count={items().length}
                  factory={set.factory}
                  locked={set.id === "user-instruments" || set.id === TEMPORARY_DS_INSTRUMENT_SET_ID}
                  open={Boolean(normalizedSearch()) || setOpen()}
                  scale="large"
                  renaming={renamingSetId() === set.id}
                  dragMime="application/x-beat-instrument"
                  onToggle={() => setOpenSets((value) => ({ ...value, [set.id]: !setOpen() }))}
                  onDropItem={(instrumentId) => useInstrumentStore.getState().moveInstrument(instrumentId, set.id)}
                  onStartRename={() => setRenamingSetId(set.id)}
                  onRename={(name) => {
                    useInstrumentStore.getState().renameInstrumentSet(set.id, name);
                    setRenamingSetId(null);
                  }}
                  onCancelRename={() => setRenamingSetId(null)}
                  onUngroup={() => {
                    useInstrumentStore.getState().ungroupInstrumentSet(set.id);
                    setOpenSets((value) => {
                      const next = { ...value };
                      delete next[set.id];
                      return next;
                    });
                  }}
                >
                  <For each={items()}>
                    {(instrument) => (
                      <InstrumentItem
                        instrument={instrument}
                        onNewTrack={() => createTrackForInstrument(instrument)}
                        onEdit={() => {
                          const dsPlugin = decentSamplerPluginForInstrument(instrument, plugins());
                          if (dsPlugin) {
                            useUiStore.getState().openEditor({ kind: "plugin", pluginId: dsPlugin.id });
                            return;
                          }
                          const request = editorRequestForInstrument(instrument);
                          if (request) useUiStore.getState().openEditor(request);
                        }}
                        onDuplicate={() => useInstrumentStore.getState().duplicateInstrument(instrument.id)}
                        onMerge={() => setMergeFromId(instrument.id)}
                        onDelete={() => void deleteInstrument(instrument)}
                        onMoveBefore={(draggedId) => useInstrumentStore.getState().moveInstrument(draggedId, set.id, instrument.id)}
                        previewing={previewingId() === instrument.id}
                        onTogglePreview={() => togglePreview(instrument)}
                        selectMode={selectMode()}
                        selected={selectedIds().has(instrument.id)}
                        onSelect={(event) => selectInstrument(instrument.id, event.shiftKey)}
                        onEnterSelectMode={() => enterSelectMode(instrument.id)}
                      />
                    )}
                  </For>
                </LibraryFolder>
                </Show>
              );
            }}
          </For>
        </Show>
      </div>
      {addMenu.menu()}
      {panelMenu.menu()}

      <Show when={mergeFromId()}>
        {(sourceId) => (
          <MergeInstrumentModal
            sourceId={sourceId()}
            onClose={() => setMergeFromId(null)}
          />
        )}
      </Show>
    </div>
  );
}

interface InstrumentItemProps {
  instrument: Instrument;
  onNewTrack: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onMerge: () => void;
  onDelete: () => void;
  onMoveBefore: (instrumentId: string) => void;
  previewing: boolean;
  onTogglePreview: () => void;
  selectMode: boolean;
  selected: boolean;
  onSelect: (event: MouseEvent) => void;
  onEnterSelectMode: () => void;
}

function InstrumentItem(props: InstrumentItemProps) {
  const menu = createContextMenu((): ContextMenuItem[] => [
    { label: "New Track", icon: "ph:plus", onSelect: props.onNewTrack },
    { label: "Select", icon: "ph:checks", onSelect: props.onEnterSelectMode },
    { label: "Edit", icon: "ph:pencil-simple", onSelect: props.onEdit },
    { label: "Duplicate", icon: "ph:copy", onSelect: props.onDuplicate },
    { label: "Merge with...", icon: "ph:intersect", onSelect: props.onMerge },
    {
      label: props.instrument.userCreated ? "Delete" : "Delete (system)",
      icon: "ph:trash",
      onSelect: props.onDelete,
      disabled: !props.instrument.userCreated,
      separatorBefore: true,
    },
  ]);

  function onDragStart(event: DragEvent) {
    event.dataTransfer?.setData("application/x-beat-instrument", props.instrument.id);
    event.dataTransfer?.setData("text/plain", props.instrument.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
  }

  function onDragOver(event: DragEvent) {
    if (!Array.from(event.dataTransfer?.types ?? []).includes("application/x-beat-instrument")) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function onDrop(event: DragEvent) {
    const draggedId = event.dataTransfer?.getData("application/x-beat-instrument");
    if (!draggedId || draggedId === props.instrument.id) return;
    event.preventDefault();
    props.onMoveBefore(draggedId);
  }

  const icon = () => instrumentIcon(props.instrument);
  const hint = () => props.instrument.icon
    ? instrumentIconLabel(props.instrument.icon)
    : props.instrument.synthPatch?.instrumentType === "lumen-hybrid-synth"
      || props.instrument.synthPatch?.namespace === "lumen"
      ? "Lumen"
      : KIND_HINT[props.instrument.kind] ?? props.instrument.kind;

  return (
    <RowItem
      className={`${styles.item} ${props.selected ? styles.itemSelected : ""} ${props.selectMode ? styles.itemSelecting : ""}`}
      density="compact"
      scale="large"
      reserveDragSlot={false}
      cursor={props.selectMode ? "pointer" : "grab"}
      draggable={!props.selectMode}
      onClick={(event) => {
        if (!props.selectMode) return;
        props.onSelect(event);
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDblClick={props.onEdit}
      tabIndex={0}
      onMouseDown={menu.onMouseDown}
      onContextMenu={menu.onContextMenu}
      onKeyDown={menu.onKeyDown}
      iconAriaHidden={!props.selectMode}
      icon={props.selectMode ? (
        <Checkbox
          inputClassName={styles.itemCheckbox}
          checked={props.selected}
          readOnly
          onClick={(event) => {
            event.stopPropagation();
            props.onSelect(event);
          }}
          aria-label={`Select ${props.instrument.name}`}
        />
      ) : (
        <HoverInfo content={hint()}>
          <Icon name={icon()} size={18} title={hint()} />
        </HoverInfo>
      )}
      hoverIcon={!props.selectMode && <Icon name="ph:dots-six-vertical" size={18} decorative />}
      name={props.instrument.name}
      action={(
        <RowActionButton
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            props.onTogglePreview();
          }}
          aria-label={`${props.previewing ? "Pause" : "Play"} ${props.instrument.name}`}
        >
          <Icon name={props.previewing ? "ph:pause-fill" : "ph:play-fill"} size={18} decorative />
        </RowActionButton>
      )}
    >
      {menu.menu()}
    </RowItem>
  );
}

function instrumentSetId(instrument: Instrument): string {
  return instrument.setId ?? "user-instruments";
}

function loadOpenInstrumentSets(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INSTRUMENT_SET_EXPANSION_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

function persistOpenInstrumentSets(openSets: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INSTRUMENT_SET_EXPANSION_KEY, JSON.stringify(openSets));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

function instrumentSetDisplayName(set: InstrumentSet): string {
  if (!set.factory || set.id === "user-instruments" || set.id === TEMPORARY_DS_INSTRUMENT_SET_ID || set.id === LUMEN_TEST_INSTRUMENT_SET_ID || set.id === AURUM_TEST_SET_ID) return set.name;
  return set.name.toLowerCase().startsWith("factory ") ? set.name : `Factory ${set.name}`;
}

function nextGroupName(sets: InstrumentSet[]): string {
  const existing = new Set(sets.map((set) => set.name.trim().toLowerCase()));
  for (let index = 1; index < 1000; index += 1) {
    const name = `Group ${index}`;
    if (!existing.has(name.toLowerCase())) return name;
  }
  return "Group";
}

function nextInstrumentName(instruments: Instrument[], base: string): string {
  const normalizedBase = base.trim() || "Instrument";
  const existing = new Set(instruments.map((instrument) => instrument.name.trim().toLowerCase()));
  for (let index = 1; index < 10000; index += 1) {
    const name = `${normalizedBase} ${index}`;
    if (!existing.has(name.toLowerCase())) return name;
  }
  return `${normalizedBase} ${Date.now()}`;
}

let previewCtx: AudioContext | null = null;
let activePreview: { source: AudioBufferSourceNode; gain: GainNode; stopping: boolean } | null = null;

function getPreviewCtx(): AudioContext {
  if (!previewCtx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    previewCtx = new Ctor();
  }
  return previewCtx;
}

function stopInstrumentPreview() {
  if (!activePreview) return;
  if (activePreview.stopping) return;
  activePreview.stopping = true;
  const { source, gain } = activePreview;
  const ctx = gain.context;
  const now = ctx.currentTime;
  const fadeEnd = now + 0.035;
  source.onended = null;
  try {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, fadeEnd);
    source.stop(fadeEnd + 0.015);
  } catch {
    // Already stopped.
  }
  window.setTimeout(() => {
    try {
      source.disconnect();
      gain.disconnect();
    } catch {
      // Already disconnected.
    }
    if (activePreview?.source === source) activePreview = null;
  }, 80);
}

registerGlobalAudioStop(stopInstrumentPreview);

async function playInstrumentPreview(instrument: Instrument, onDone: () => void, shouldContinue: () => boolean) {
  const ctx = getPreviewCtx();
  if (ctx.state === "suspended") await ctx.resume();
  await preloadInstrumentSamplesForPlayback(ctx, instrument, previewFrequency(instrument), 127);
  if (!shouldContinue()) return;

  stopInstrumentPreview();
  if (!shouldContinue()) return;

  const now = ctx.currentTime;
  const source = createInstrumentBufferSource(ctx, instrument, PREVIEW_SECONDS, previewFrequency(instrument), undefined, 127, useProjectStore.getState().project.bpm);
  const duration = source.buffer
    ? Math.min(PREVIEW_SECONDS, Math.max(0.05, source.buffer.duration / source.playbackRate.value))
    : PREVIEW_SECONDS;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.24, now + 0.006);
  gain.gain.setValueAtTime(0.24, Math.max(now + 0.006, now + duration - 0.06));
  gain.gain.linearRampToValueAtTime(0, now + duration);
  source.connect(gain);
  gain.connect(ctx.destination);
  source.onended = () => {
    if (activePreview?.source === source) {
      activePreview = null;
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected.
      }
      if (shouldContinue()) onDone();
    }
  };
  activePreview = { source, gain, stopping: false };
  source.start(now);
  source.stop(now + duration + 0.02);
}

const PREVIEW_SECONDS = 1.5;
