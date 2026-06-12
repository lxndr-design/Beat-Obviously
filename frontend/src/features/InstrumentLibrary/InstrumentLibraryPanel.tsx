import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Icon, MarqueeText, useContextMenu, HoverInfo, SectionRibbon, SectionRibbonActionButton, type ContextMenuItem } from "../../components";
import { createInstrumentBufferSource, preloadInstrumentSample, previewFrequency } from "../../audio/synthPreview";
import { TEMPORARY_DS_INSTRUMENT_SET_ID, useInstrumentStore, useUiStore } from "../../state/store";
import { instrumentIcon, instrumentIconLabel } from "../../state/instrumentIcons";
import {
  FACTORY_SYNTH_PRESETS,
  createDefaultSynthDraft,
  synthDraftToInstrumentPatch,
  useSynthStore,
  type SynthDraftPatch,
} from "../../state/synthStore";
import type { Instrument, InstrumentSet } from "../../state/types";
import { ImportInstrumentModal } from "./ImportInstrumentModal";
import { MergeInstrumentModal } from "./MergeInstrumentModal";
import styles from "./InstrumentLibraryPanel.module.css";

const KIND_HINT: Record<string, string> = {
  synth:   "Synth",
  sampler: "Sampler",
  hybrid:  "Hybrid",
  wavetable: "Aether WT",
};

interface WavetableStarter {
  label: string;
  icon: string;
  presetId: string;
  fallbackName: string;
}

const WAVETABLE_STARTERS: WavetableStarter[] = [
  { label: "Create Aether", icon: "ph:cube", presetId: "factory.init", fallbackName: "Aether" },
];

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
interface InstrumentLibraryPanelProps {
  expanded: boolean;
  onToggle: () => void;
}

export function InstrumentLibraryPanel({ expanded, onToggle }: InstrumentLibraryPanelProps) {
  const instruments = useInstrumentStore((s) => s.instruments);
  const instrumentSets = useInstrumentStore((s) => s.instrumentSets);
  const loading = useInstrumentStore((s) => s.loading);
  const addInstrument = useInstrumentStore((s) => s.addInstrument);
  const addInstrumentSet = useInstrumentStore((s) => s.addInstrumentSet);
  const renameInstrumentSet = useInstrumentStore((s) => s.renameInstrumentSet);
  const ungroupInstrumentSet = useInstrumentStore((s) => s.ungroupInstrumentSet);
  const moveInstrument = useInstrumentStore((s) => s.moveInstrument);
  const duplicate = useInstrumentStore((s) => s.duplicateInstrument);
  const remove = useInstrumentStore((s) => s.removeInstrument);
  const openEditor = useUiStore((s) => s.openEditor);
  const bindSynthInstrument = useSynthStore((s) => s.bindInstrument);
  const setSynthDraft = useSynthStore((s) => s.setDraft);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mergeFromId, setMergeFromId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewRequestRef = useRef(0);
  const [openSets, setOpenSets] = useState<Record<string, boolean>>({});
  const [renamingSetId, setRenamingSetId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const selectedInstruments = useMemo(
    () => instruments.filter((instrument) => selectedIds.has(instrument.id)),
    [instruments, selectedIds],
  );
  const sortedInstrumentSets = useMemo(
    () => [...instrumentSets].sort((a, b) => instrumentSetDisplayName(a).localeCompare(instrumentSetDisplayName(b), undefined, { sensitivity: "base" })),
    [instrumentSets],
  );
  const { onContextMenu: onPanelContextMenu, menu: panelMenu } = useContextMenu((): ContextMenuItem[] => [
    {
      label: "Select",
      icon: "ph:checks",
      onSelect: () => enterSelectMode(),
    },
  ]);
  const { menu: addMenu, openAt: openAddMenu } = useContextMenu((): ContextMenuItem[] => [
    {
      label: "+ New Group",
      icon: "ph:folder-plus",
      onSelect: () => addInstrumentSet(),
    },
    {
      label: "Create instrument",
      icon: "ph:piano-keys",
      onSelect: createNew,
    },
    {
      label: "Import Instrument",
      icon: "ph:upload-simple",
      onSelect: () => setImportOpen(true),
    },
    ...WAVETABLE_STARTERS.map((starter, index) => ({
      label: starter.label,
      icon: starter.icon,
      hint: index === 0 ? "Init" : undefined,
      onSelect: () => createWavetable(starter),
    })),
  ]);

  useEffect(() => () => {
    previewRequestRef.current += 1;
    stopInstrumentPreview();
  }, []);

  useEffect(() => {
    if (!selectMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") exitSelectMode();
    }
    function onPointerDown(event: PointerEvent) {
      if (panelRef.current?.contains(event.target as Node)) return;
      exitSelectMode();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [selectMode]);

  function createNew() {
    const id = addInstrument({ name: "New Instrument", userCreated: true });
    openEditor({ kind: "instrument", instrumentId: id });
  }

  function createWavetable(starter: WavetableStarter) {
    const preset = FACTORY_SYNTH_PRESETS.find((candidate) => candidate.id === starter.presetId);
    const draft = preset?.patch ?? createDefaultSynthDraft();
    const namedDraft: SynthDraftPatch = {
      ...structuredClone(draft),
      name: starter.fallbackName,
    };
    const id = addInstrument({
      ...synthDraftToInstrumentPatch(namedDraft),
      name: namedDraft.name,
      userCreated: true,
    });
    bindSynthInstrument(id);
    setSynthDraft(namedDraft);
    openEditor({ kind: "synth" });
  }

  function togglePreview(instrument: Instrument) {
    if (previewingId === instrument.id) {
      previewRequestRef.current += 1;
      stopInstrumentPreview();
      setPreviewingId(null);
      return;
    }
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    stopInstrumentPreview();
    void playInstrumentPreview(
      instrument,
      () => {
        if (previewRequestRef.current === requestId) setPreviewingId(null);
      },
      () => previewRequestRef.current === requestId,
    ).catch(() => {
      if (previewRequestRef.current === requestId) setPreviewingId(null);
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
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }

  function selectInstrument(instrumentId: string, shiftKey: boolean) {
    setSelectMode(true);
    setSelectedIds((current) => {
      if (shiftKey && lastSelectedId) {
        const start = instruments.findIndex((instrument) => instrument.id === lastSelectedId);
        const end = instruments.findIndex((instrument) => instrument.id === instrumentId);
        if (start >= 0 && end >= 0) {
          const [lo, hi] = start < end ? [start, end] : [end, start];
          return new Set([...current, ...instruments.slice(lo, hi + 1).map((instrument) => instrument.id)]);
        }
      }
      const next = new Set(current);
      if (next.has(instrumentId)) next.delete(instrumentId);
      else next.add(instrumentId);
      return next;
    });
    setLastSelectedId(instrumentId);
  }

  function deleteSelected() {
    selectedInstruments.filter((instrument) => instrument.userCreated).forEach((instrument) => remove(instrument.id));
    exitSelectMode();
  }

  function groupSelected() {
    if (selectedInstruments.length === 0) return;
    const groupId = addInstrumentSet("New group");
    selectedInstruments.forEach((instrument) => moveInstrument(instrument.id, groupId));
    setOpenSets((value) => ({ ...value, [groupId]: true }));
    exitSelectMode();
  }

  return (
    <div ref={panelRef} className={styles.panel} onContextMenu={onPanelContextMenu}>
      <SectionRibbon
        title="Instruments"
        expanded={expanded}
        onToggle={onToggle}
        showToggle={false}
        onContextMenu={onPanelContextMenu}
        actions={(
          <>
            <SectionRibbonActionButton
              onClick={(e) => openAddMenu(e.clientX, e.clientY)}
              aria-label="Add instrument item"
            >
              <Icon name="ph:plus" size={16} decorative />
            </SectionRibbonActionButton>
          </>
        )}
      />
      {selectMode && expanded && (
        <div className={styles.selectionBar}>
          <Button size="xs" disabled={selectedInstruments.every((instrument) => !instrument.userCreated)} onClick={deleteSelected}>
            Delete
          </Button>
          <Button size="xs" disabled={selectedInstruments.length === 0} onClick={groupSelected}>
            Group
          </Button>
          <span className={styles.selectionCount}>{selectedInstruments.length}</span>
        </div>
      )}

      <div className={`${styles.list} ${expanded ? styles.listOpen : ""}`} aria-hidden={!expanded}>
        {loading && (
          <div className={styles.loadingState} role="status" aria-live="polite">
            <span className={styles.loadingRing} />
            <span>Loading Instruments...</span>
          </div>
        )}
        {!loading && instruments.length === 0 && (
          <div className={styles.empty}>No instruments yet.</div>
        )}
        {!loading && sortedInstrumentSets.map((set) => {
          const setOpen = openSets[set.id] ?? false;
          const items = instruments.filter((instrument) => instrumentSetId(instrument) === set.id);
          return (
            <InstrumentSetSection
              key={set.id}
              set={set}
              open={setOpen}
              items={items}
              renaming={renamingSetId === set.id}
              onToggle={() => setOpenSets((value) => ({ ...value, [set.id]: !setOpen }))}
              onDropInstrument={(instrumentId) => moveInstrument(instrumentId, set.id)}
              onStartRename={() => setRenamingSetId(set.id)}
              onRename={(name) => {
                renameInstrumentSet(set.id, name);
                setRenamingSetId(null);
              }}
              onCancelRename={() => setRenamingSetId(null)}
              onUngroup={() => {
                ungroupInstrumentSet(set.id);
                setOpenSets((value) => {
                  const next = { ...value };
                  delete next[set.id];
                  return next;
                });
              }}
            >
              {items.map((i) => (
                <InstrumentItem
                  key={i.id}
                  instrument={i}
                  onEdit={() => openEditor({ kind: "instrument", instrumentId: i.id })}
                  onDuplicate={() => duplicate(i.id)}
                  onMerge={() => setMergeFromId(i.id)}
                  onDelete={() => remove(i.id)}
                  onMoveBefore={(draggedId) => moveInstrument(draggedId, set.id, i.id)}
                  previewing={previewingId === i.id}
                  onTogglePreview={() => togglePreview(i)}
                  selectMode={selectMode}
                  selected={selectedIds.has(i.id)}
                  onSelect={(event) => selectInstrument(i.id, event.shiftKey)}
                  onEnterSelectMode={() => enterSelectMode(i.id)}
                />
              ))}
            </InstrumentSetSection>
          );
        })}
      </div>
      {addMenu}
      {panelMenu}

      {mergeFromId && (
        <MergeInstrumentModal
          sourceId={mergeFromId}
          onClose={() => setMergeFromId(null)}
        />
      )}
      {importOpen && (
        <ImportInstrumentModal onClose={() => setImportOpen(false)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

interface ItemProps {
  instrument: Instrument;
  onEdit: () => void;
  onDuplicate: () => void;
  onMerge: () => void;
  onDelete: () => void;
  onMoveBefore: (instrumentId: string) => void;
  previewing: boolean;
  onTogglePreview: () => void;
  selectMode: boolean;
  selected: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onEnterSelectMode: () => void;
}

function InstrumentItem({
  instrument,
  onEdit,
  onDuplicate,
  onMerge,
  onDelete,
  onMoveBefore,
  previewing,
  onTogglePreview,
  selectMode,
  selected,
  onSelect,
  onEnterSelectMode,
}: ItemProps) {
  const { id, name, kind, userCreated } = instrument;
  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    { label: "Select", icon: "ph:checks", onSelect: onEnterSelectMode },
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
    e.dataTransfer.effectAllowed = "copyMove";
  }

  function onDragOver(e: React.DragEvent<HTMLLIElement>) {
    if (!e.dataTransfer.types.includes("application/x-beat-instrument")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: React.DragEvent<HTMLLIElement>) {
    const draggedId = e.dataTransfer.getData("application/x-beat-instrument");
    if (!draggedId || draggedId === id) return;
    e.preventDefault();
    onMoveBefore(draggedId);
  }

  const icon = instrumentIcon(instrument);
  const hint = instrument.icon ? instrumentIconLabel(instrument.icon) : KIND_HINT[kind] ?? kind;

  return (
    <li
      className={`${styles.item} ${selected ? styles.itemSelected : ""} ${selectMode ? styles.itemSelecting : ""}`}
      draggable={!selectMode}
      onClick={(event) => {
        if (!selectMode) return;
        onSelect(event);
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDoubleClick={onEdit}
      onContextMenu={onContextMenu}
    >
      {selectMode ? (
        <input
          className={styles.itemCheckbox}
          type="checkbox"
          checked={selected}
          readOnly
          onClick={(event) => {
            event.stopPropagation();
            onSelect(event);
          }}
          aria-label={`Select ${name}`}
        />
      ) : (
        <span className={styles.itemDot} aria-hidden>
          <Icon name="ph:dots-six-vertical" size={14} decorative />
        </span>
      )}
      <MarqueeText className={styles.itemName} text={name} />
      <HoverInfo content={hint}>
        <span className={styles.itemKindIcon} aria-label={hint}>
          <Icon name={icon} size={14} decorative />
        </span>
      </HoverInfo>
      <HoverInfo content={previewing ? "Pause sound" : "Play sound"}>
        <Button
          className={styles.itemPreviewButton}
          iconOnly
          size="sm"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePreview();
          }}
          aria-label={`${previewing ? "Pause" : "Play"} ${name}`}
        >
          <Icon name={previewing ? "ph:pause-fill" : "ph:play-fill"} size={12} decorative />
        </Button>
      </HoverInfo>
      {menu}
    </li>
  );
}

function InstrumentSetSection({
  set,
  open,
  items,
  children,
  renaming,
  onToggle,
  onDropInstrument,
  onStartRename,
  onRename,
  onCancelRename,
  onUngroup,
}: {
  set: InstrumentSet;
  open: boolean;
  items: Instrument[];
  children: ReactNode;
  renaming: boolean;
  onToggle: () => void;
  onDropInstrument: (instrumentId: string) => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onUngroup: () => void;
}) {
  const [draftName, setDraftName] = useState(set.name);
  const displayName = instrumentSetDisplayName(set);
  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    {
      label: "Rename",
      icon: "ph:pencil-simple",
      onSelect: () => {
        setDraftName(set.name);
        onStartRename();
      },
    },
    {
      label: "Ungroup",
      icon: "ph:folder-simple-dashed",
      disabled: Boolean(set.factory),
      onSelect: onUngroup,
      separatorBefore: true,
    },
  ]);

  useEffect(() => {
    if (renaming) setDraftName(set.name);
  }, [renaming, set.name]);

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes("application/x-beat-instrument")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    const draggedId = e.dataTransfer.getData("application/x-beat-instrument");
    if (!draggedId) return;
    e.preventDefault();
    onDropInstrument(draggedId);
  }

  return (
    <section className={styles.setSection} onDragOver={onDragOver} onDrop={onDrop}>
      <div
        className={`${styles.setHeader} ${open ? styles.setHeaderOpen : ""}`}
        role={renaming ? undefined : "button"}
        tabIndex={renaming ? undefined : 0}
        aria-expanded={renaming ? undefined : open}
        aria-label={renaming ? undefined : `${open ? "Collapse" : "Expand"} ${displayName}`}
        onClick={renaming ? undefined : onToggle}
        onContextMenu={onContextMenu}
        onKeyDown={renaming ? undefined : (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onToggle();
        }}
      >
        <span className={styles.setToggle} aria-hidden>
          <Icon name={open ? "ph:caret-down" : "ph:caret-right"} size={12} decorative />
        </span>
        {renaming ? (
          <input
            className={styles.setNameInput}
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => onRename(draftName)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRename(draftName);
              if (e.key === "Escape") onCancelRename();
            }}
            aria-label={`Rename ${displayName}`}
          />
        ) : (
          <span className={styles.setNameButton}>
            <MarqueeText className={styles.setName} text={displayName} />
          </span>
        )}
        <span className={styles.setCount}>{items.length}</span>
      </div>
      <ul className={`${styles.setList} ${open ? styles.setListOpen : ""}`} aria-hidden={!open}>
        {children}
      </ul>
      {menu}
    </section>
  );
}

function instrumentSetId(instrument: Instrument): string {
  return instrument.setId ?? "user-instruments";
}

function instrumentSetDisplayName(set: InstrumentSet): string {
  if (!set.factory || set.id === "user-instruments" || set.id === TEMPORARY_DS_INSTRUMENT_SET_ID) return set.name;
  return set.name.toLowerCase().startsWith("factory ") ? set.name : `Factory ${set.name}`;
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

async function playInstrumentPreview(instrument: Instrument, onDone: () => void, shouldContinue: () => boolean) {
  const ctx = getPreviewCtx();
  if (ctx.state === "suspended") await ctx.resume();
  await preloadInstrumentSample(ctx, instrument).catch(() => {
    // Synth fallback remains useful when a sample cannot be decoded.
  });
  if (!shouldContinue()) return;

  stopInstrumentPreview();
  if (!shouldContinue()) return;

  const now = ctx.currentTime;
  const source = createInstrumentBufferSource(ctx, instrument, PREVIEW_SECONDS, previewFrequency(instrument));
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
