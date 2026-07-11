import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Button, Checkbox, Icon, Modal, TextInput, createContextMenu } from "../../solid-ui";
import { appAlert } from "../../solid-ui";
import { browserFileToAudioFile, importAudioFiles } from "../../audio/audioImport";
import { isSupportedAudioFileName, SUPPORTED_AUDIO_IMPORT_EXTENSIONS, SUPPORTED_AUDIO_IMPORT_LABEL } from "../../audio/audioFormats";
import { isNative, send } from "../../ipc/bridge";
import type { DecentSamplerImport } from "../../ipc/schema";
import { characterizeInstrument, snapshotInstrument, useAudioFileStore, useInstrumentStore, USER_INSTRUMENT_SET_ID } from "../../state/store";
import type { AudioFile, Instrument } from "../../state/types";
import { createDecentSamplerInstrument } from "./decentSamplerInstrument";
import styles from "./ImportInstrumentModal.module.css";

interface Props {
  onClose: () => void;
  initialFiles?: AudioFile[];
  onImportedFiles?: (files: AudioFile[]) => void;
}

interface ImportGroup {
  id: string;
  name: string;
  type: string;
  normalize: boolean;
}

const INSTRUMENT_TYPES = [
  "Kick",
  "Snare",
  "Clap",
  "Rim",
  "Closed Hi-Hat",
  "Open Hi-Hat",
  "Crash Cymbal",
  "Ride Cymbal",
  "Tom",
  "Percussion",
  "808",
  "Bass",
  "Strings",
  "Violin",
  "Cello",
  "Brass",
  "Woodwind",
  "Vocal",
  "Choir",
  "Piano",
  "Guitar",
  "Synth Lead",
  "Synth Bass",
  "Pad",
  "FX",
  "Foley",
];

export function ImportInstrumentModal(props: Props) {
  const [files, setFiles] = createSignal<AudioFile[]>(props.initialFiles ?? [], { equals: false });
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set((props.initialFiles ?? []).map((file) => file.id)), { equals: false });
  const [groups, setGroups] = createSignal<ImportGroup[]>([], { equals: false });
  const [fileGroups, setFileGroups] = createSignal<Record<string, string | undefined>>({}, { equals: false });
  const [lastSelectedId, setLastSelectedId] = createSignal<string | null>(null);
  const [dragIds, setDragIds] = createSignal<string[]>([], { equals: false });
  const [decentStatus, setDecentStatus] = createSignal("");
  const [samplePeaks, setSamplePeaks] = createSignal<Record<string, number>>({}, { equals: false });
  const [playingPreviewId, setPlayingPreviewId] = createSignal<string | null>(null);
  let contextIds = new Set<string>();

  onMount(() => {
    const initial = props.initialFiles ?? [];
    if (initial.length === 0) return;
    void measureSamplePeaks(initial).then((peaks) => {
      setSamplePeaks((current) => ({ ...current, ...peaks }));
    });
  });

  onCleanup(() => {
    stopImportSamplePreview();
  });

  const groupedFiles = createMemo(() => groups()
    .map((group) => ({
      group,
      files: files().filter((file) => fileGroups()[file.id] === group.id),
    }))
    .filter((entry) => entry.files.length > 0));
  const ungroupedFiles = createMemo(() => files().filter((file) => !fileGroups()[file.id]));
  const importableCount = () => groupedFiles().length;

  const fileMenu = createContextMenu(() => {
    const ids = Array.from(contextIds).filter((id) => files().some((file) => file.id === id));
    const containsGrouped = ids.some((id) => fileGroups()[id]);
    return [
      {
        label: ids.length > 1 ? "Group selection as instrument" : "Group as instrument",
        icon: "ph:stack-simple",
        disabled: ids.length === 0,
        onSelect: () => groupFiles(ids),
      },
      {
        label: "Ungroup",
        icon: "ph:arrow-square-out",
        disabled: !containsGrouped,
        onSelect: () => moveFilesToGroup(ids, undefined),
      },
    ];
  });

  function closeModal() {
    stopImportSamplePreview();
    setPlayingPreviewId(null);
    props.onClose();
  }

  async function uploadFiles() {
    const imported = await importAudioFiles();
    if (imported.length === 0) return;
    setFiles((current) => {
      const ids = new Set(current.map((file) => file.id));
      return [...current, ...imported.filter((file) => !ids.has(file.id))];
    });
    setSelectedIds((current) => new Set([...current, ...imported.map((file) => file.id)]));
    void measureSamplePeaks(imported).then((peaks) => {
      setSamplePeaks((current) => ({ ...current, ...peaks }));
    });
  }

  async function importDecentPreset() {
    try {
      const preset = isNative()
        ? (await send({ kind: "instrument.importDecent" })).preset
        : await importDecentPresetInBrowser();
      if (!preset) return;
      preset.audioFiles.forEach(useAudioFileStore.getState().addFile);
      createDecentSamplerInstrument(
        preset,
        useInstrumentStore.getState().addInstrument,
        useInstrumentStore.getState().updateInstrument,
      );
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Decent Sampler import is unavailable here.";
      setDecentStatus(message);
      await appAlert(message);
    }
  }

  function selectFile(id: string, event: MouseEvent) {
    if (event.shiftKey && lastSelectedId()) {
      const start = files().findIndex((file) => file.id === lastSelectedId());
      const end = files().findIndex((file) => file.id === id);
      if (start >= 0 && end >= 0) {
        const [lo, hi] = start < end ? [start, end] : [end, start];
        setSelectedIds((current) => new Set([...current, ...files().slice(lo, hi + 1).map((file) => file.id)]));
        setLastSelectedId(id);
        return;
      }
    }
    setSelectedIds(new Set([id]));
    setLastSelectedId(id);
  }

  function focusFileForDrag(id: string, event: MouseEvent) {
    if (event.button !== 0 || event.shiftKey) return;
    if (selectedIds().has(id)) return;
    setSelectedIds(new Set([id]));
    setLastSelectedId(id);
  }

  function openFileContext(id: string, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const ids = selectedIds().has(id) ? selectedIds() : new Set([id]);
    contextIds = ids;
    setSelectedIds(ids);
    setLastSelectedId(id);
    fileMenu.openAt(event.clientX, event.clientY);
  }

  function groupFiles(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids)).filter((id) => files().some((file) => file.id === id));
    if (uniqueIds.length === 0) return;
    const targets = files().filter((file) => uniqueIds.includes(file.id));
    const id = crypto.randomUUID();
    const nextGroup: ImportGroup = {
      id,
      name: commonInstrumentName(targets),
      type: inferInstrumentType(targets),
      normalize: false,
    };
    setGroups((current) => [...current, nextGroup]);
    moveFilesToGroup(uniqueIds, id, false);
  }

  function moveFilesToGroup(ids: string[], groupId: string | undefined, prune = true) {
    setFileGroups((current) => {
      const next = { ...current };
      ids.forEach((id) => {
        if (groupId) next[id] = groupId;
        else delete next[id];
      });
      if (prune) pruneEmptyGroups(next);
      return next;
    });
  }

  function pruneEmptyGroups(nextFileGroups: Record<string, string | undefined>) {
    setGroups((current) => current.filter((group) => files().some((file) => nextFileGroups[file.id] === group.id)));
  }

  function updateGroup(id: string, patch: Partial<ImportGroup>) {
    setGroups((current) => current.map((group) => group.id === id ? { ...group, ...patch } : group));
  }

  function dragStart(fileId: string, event: DragEvent) {
    const ids = selectedIds().has(fileId) ? Array.from(selectedIds()) : [fileId];
    if (!selectedIds().has(fileId)) {
      setSelectedIds(new Set([fileId]));
      setLastSelectedId(fileId);
    }
    setDragIds(ids);
    event.dataTransfer?.setData("text/plain", ids.join(","));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function dropOnGroup(groupId: string, event: DragEvent) {
    event.preventDefault();
    const ids = draggedIds(event);
    moveFilesToGroup(ids, groupId, true);
    setDragIds([]);
  }

  function dropOnUngrouped(event: DragEvent) {
    event.preventDefault();
    moveFilesToGroup(draggedIds(event), undefined);
    setDragIds([]);
  }

  function dropOnFile(targetId: string, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const ids = draggedIds(event).filter((id) => id !== targetId);
    if (ids.length === 0) return;
    const targetGroup = fileGroups()[targetId];
    if (targetGroup) {
      moveFilesToGroup(ids, targetGroup, true);
      return;
    }
    groupFiles([...ids, targetId]);
    setDragIds([]);
  }

  function draggedIds(event: DragEvent): string[] {
    const raw = event.dataTransfer?.getData("text/plain") ?? "";
    return (raw ? raw.split(",") : dragIds()).filter(Boolean);
  }

  function importGroups() {
    const importedFiles: AudioFile[] = [];
    groupedFiles().forEach(({ group, files: groupFiles }) => {
      importedFiles.push(...groupFiles);
      groupFiles.forEach(useAudioFileStore.getState().addFile);
      createSamplerInstrument(
        group.name.trim() || commonInstrumentName(groupFiles),
        groupFiles,
        groupFiles.length > 1 ? `Hit variants upload (${groupFiles.length} files)` : groupFiles[0].name,
        group.type,
        group.normalize,
        samplePeaks(),
        useInstrumentStore.getState().addInstrument,
        useInstrumentStore.getState().updateInstrument,
      );
    });
    props.onImportedFiles?.(importedFiles);
    closeModal();
  }

  async function previewFile(file: AudioFile) {
    if (playingPreviewId() === file.id) {
      stopImportSamplePreview();
      setPlayingPreviewId(null);
      return;
    }
    stopImportSamplePreview();
    setPlayingPreviewId(file.id);
    try {
      await playImportSamplePreview(file, () => {
        setPlayingPreviewId((current) => current === file.id ? null : current);
      });
    } catch {
      setPlayingPreviewId(null);
    }
  }

  return (
    <Modal
      open
      scopeId="import-instruments"
      title={<><Icon name="ph:upload-simple" size={18} decorative />Import instruments</>}
      width="lg"
      onClose={closeModal}
      footer={(
        <>
          <Button variant="ghost" onClick={closeModal}>Cancel</Button>
          <Button variant="primary" disabled={importableCount() === 0} onClick={importGroups}>
            Import Instruments
          </Button>
        </>
      )}
    >
      <div class={styles.panel}>
        <div class={styles.topRow}>
          <Button onClick={() => void uploadFiles()}>
            <Icon name="ph:plus" size={18} decorative />
            Add WAVs
          </Button>
          <Button onClick={() => void importDecentPreset()}>
            <Icon name="ph:waveform" size={18} decorative />
            Import DS Pack
          </Button>
          <Button disabled={selectedIds().size === 0} onClick={() => groupFiles(Array.from(selectedIds()))}>
            <Icon name="ph:stack-simple" size={18} decorative />
            Group
          </Button>
        </div>
        <Show when={decentStatus()}><div class={styles.status}>{decentStatus()}</div></Show>
        <datalist id="instrument-import-types">
          <For each={INSTRUMENT_TYPES}>{(type) => <option value={type} />}</For>
        </datalist>
        <div class={styles.importGrid}>
          <section
            class={styles.fileList}
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropOnUngrouped}
          >
            <div class={styles.listHeader}>WAVs</div>
            <Show when={files().length === 0}>
              <div class={styles.empty}>Upload one-shot WAVs, select related files, then right-click or drag them together into an instrument group.</div>
            </Show>
            <For each={ungroupedFiles()}>
              {(file) => (
                <FileRow
                  file={file}
                  selected={selectedIds().has(file.id)}
                  grouped={false}
                  onClick={(event) => selectFile(file.id, event)}
                  onMouseDown={(event) => focusFileForDrag(file.id, event)}
                  onContextMenu={(event) => openFileContext(file.id, event)}
                  onDragStart={(event) => dragStart(file.id, event)}
                  onDrop={(event) => dropOnFile(file.id, event)}
                  onPreview={() => void previewFile(file)}
                  playing={playingPreviewId() === file.id}
                />
              )}
            </For>
          </section>
          <section class={styles.groupList}>
            <div class={styles.listHeader}>Instruments</div>
            <Show when={groupedFiles().length === 0 && files().length > 0}>
              <div class={styles.empty}>No grouped instruments yet. Ungrouped files are temporary and will not be imported.</div>
            </Show>
            <For each={groupedFiles()}>
              {({ group, files: groupFiles }) => (
                <div
                  class={styles.groupCard}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => dropOnGroup(group.id, event)}
                >
                  <div class={styles.groupHeader}>
                    <TextInput
                      label="Name"
                      layout="inline"
                      value={group.name}
                      onInput={(event) => updateGroup(group.id, { name: event.currentTarget.value })}
                    />
                    <label class={styles.typeField}>
                      <span>Type</span>
                      <input
                        value={group.type}
                        list="instrument-import-types"
                        onInput={(event) => updateGroup(group.id, { type: event.currentTarget.value })}
                      />
                    </label>
                    <Checkbox
                      class={styles.normalizeField}
                      label="Normalize"
                      checked={group.normalize}
                      onChange={(checked) => updateGroup(group.id, { normalize: checked })}
                    />
                  </div>
                  <div class={styles.groupRows}>
                    <For each={groupFiles}>
                      {(file) => (
                        <FileRow
                          file={file}
                          selected={selectedIds().has(file.id)}
                          grouped
                          onClick={(event) => selectFile(file.id, event)}
                          onMouseDown={(event) => focusFileForDrag(file.id, event)}
                          onContextMenu={(event) => openFileContext(file.id, event)}
                          onDragStart={(event) => dragStart(file.id, event)}
                          onDrop={(event) => dropOnFile(file.id, event)}
                          onPreview={() => void previewFile(file)}
                          playing={playingPreviewId() === file.id}
                        />
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </section>
        </div>
        <div class={styles.discardNote}>{ungroupedFiles().length} ungrouped files will be discarded</div>
        <Show when={groupedFiles().some((entry) => entry.files.length > 1)}>
          <p class={styles.hint}>
            Groups with multiple files become one sampler instrument with length-aware hit variants.
          </p>
        </Show>
        {fileMenu.menu()}
      </div>
    </Modal>
  );
}

interface FileRowProps {
  file: AudioFile;
  selected: boolean;
  grouped: boolean;
  onClick: (event: MouseEvent) => void;
  onMouseDown: (event: MouseEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
  onDragStart: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onPreview: () => void;
  playing: boolean;
}

function FileRow(props: FileRowProps) {
  return (
    <div
      class={[
        styles.fileRow,
        props.selected && styles.fileRowSelected,
        props.grouped && styles.fileRowGrouped,
      ].filter(Boolean).join(" ")}
      draggable
      onClick={props.onClick}
      onMouseDown={props.onMouseDown}
      onContextMenu={props.onContextMenu}
      onDragStart={props.onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={props.onDrop}
      role="button"
      tabIndex={0}
    >
      <span class={styles.dragHandle}>::</span>
      <span class={styles.fileName}>{props.file.name}</span>
      <span class={styles.fileMeta}>{formatDuration(props.file.durationSeconds)}</span>
      <Button
        iconOnly
        size="xs"
        variant="ghost"
        class={styles.previewButton}
        aria-label={`${props.playing ? "Stop" : "Preview"} ${props.file.name}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onPreview();
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        draggable={false}
      >
        <Icon name={props.playing ? "ph:pause-fill" : "ph:play-fill"} size={18} decorative />
      </Button>
    </div>
  );
}

function createSamplerInstrument(
  name: string,
  files: AudioFile[],
  sourceLabel: string,
  instrumentType: string,
  normalize: boolean,
  samplePeaks: Record<string, number>,
  addInstrument: ReturnType<typeof useInstrumentStore.getState>["addInstrument"],
  updateInstrument: ReturnType<typeof useInstrumentStore.getState>["updateInstrument"],
) {
  const sampleIds = files.map((file) => file.id);
  const sampleUrls = files.map((file) => file.path);
  const sampleMap = mappedSampleZones(files, samplePeaks, normalize);
  const patch: Partial<Instrument> = {
    name,
    kind: "sampler",
    waveform: "sample",
    sampleIds,
    sampleUrl: sampleUrls[0],
    sampleUrls,
    ...(sampleMap ? { sampleMap } : {}),
    setId: USER_INSTRUMENT_SET_ID,
    source: {
      kind: "uploaded",
      label: sourceLabel,
      url: sampleUrls[0],
      importedAt: Date.now(),
      edited: false,
    },
    descriptors: describeUploadedInstrument(name, instrumentType, files),
    userCreated: true,
  };
  const id = addInstrument(patch);
  const instrument = useInstrumentStore.getState().instruments.find((item) => item.id === id);
  if (instrument) updateInstrument(id, { original: snapshotInstrument(instrument) });
}

function mappedSampleZones(
  files: AudioFile[],
  samplePeaks: Record<string, number>,
  normalize: boolean,
): Instrument["sampleMap"] {
  const durationSorted = [...files].sort((a, b) => {
    const delta = safeDurationSeconds(a) - safeDurationSeconds(b);
    return Math.abs(delta) > 0.001 ? delta : a.name.localeCompare(b.name);
  });
  const maxDuration = durationSorted.reduce((max, file) => Math.max(max, safeDurationSeconds(file)), 0);
  const hasUsefulDurationSpread = durationSorted.length > 1
    && maxDuration > 0
    && safeDurationSeconds(durationSorted[durationSorted.length - 1]) - safeDurationSeconds(durationSorted[0]) > 0.025;

  return durationSorted.map((file, index) => {
    const peak = samplePeaks[file.id] ?? 0;
    const volumeDb = normalize && peak > 0
      ? Math.max(-24, Math.min(24, 20 * Math.log10(0.9 / peak)))
      : 0;
    const durationSeconds = safeDurationSeconds(file);
    const loLengthSeconds = hasUsefulDurationSpread ? (index / durationSorted.length) * maxDuration : undefined;
    const hiLengthSeconds = hasUsefulDurationSpread
      ? ((index + 1) / durationSorted.length) * maxDuration + 0.001
      : undefined;
    return {
      path: file.path,
      name: file.name,
      rootNote: 60,
      loNote: 0,
      hiNote: 127,
      loVel: 0,
      hiVel: 127,
      volumeDb,
      pan: 0,
      tuning: 0,
      seqPosition: index,
      chokeGroup: 0,
      ...(durationSeconds > 0 ? { durationSeconds } : {}),
      ...(loLengthSeconds != null && hiLengthSeconds != null ? { loLengthSeconds, hiLengthSeconds } : {}),
      oneShot: true,
    };
  });
}

function safeDurationSeconds(file: AudioFile): number {
  return Number.isFinite(file.durationSeconds) ? Math.max(0, file.durationSeconds) : 0;
}

async function measureSamplePeaks(files: AudioFile[]): Promise<Record<string, number>> {
  if (files.length === 0) return {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new Ctor();
    const entries = await Promise.all(files.map(async (file) => {
      try {
        const response = await fetch(file.path);
        const data = await response.arrayBuffer();
        const buffer = await ctx.decodeAudioData(data.slice(0));
        let peak = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const samples = buffer.getChannelData(channel);
          for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
        }
        return [file.id, peak] as const;
      } catch {
        return [file.id, 0] as const;
      }
    }));
    await ctx.close();
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

let activeImportSamplePreview: { ctx: AudioContext; source: AudioBufferSourceNode; gain: GainNode } | null = null;

async function playImportSamplePreview(file: AudioFile, onEnded: () => void) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctor();
  const response = await fetch(file.path);
  const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  const duration = Math.min(2.5, buffer.duration || 2.5);
  source.buffer = buffer;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.28, now + 0.006);
  gain.gain.setValueAtTime(0.28, Math.max(now + 0.006, now + duration - 0.04));
  gain.gain.linearRampToValueAtTime(0, now + duration);
  source.connect(gain).connect(ctx.destination);
  activeImportSamplePreview = { ctx, source, gain };
  source.onended = () => {
    if (activeImportSamplePreview?.source === source) activeImportSamplePreview = null;
    void ctx.close().catch(() => {});
    onEnded();
  };
  source.start(now);
  source.stop(now + duration);
}

function stopImportSamplePreview() {
  const active = activeImportSamplePreview;
  if (!active) return;
  activeImportSamplePreview = null;
  const now = active.ctx.currentTime;
  try {
    active.gain.gain.cancelScheduledValues(now);
    active.gain.gain.setValueAtTime(active.gain.gain.value, now);
    active.gain.gain.linearRampToValueAtTime(0, now + 0.025);
    active.source.stop(now + 0.03);
  } catch {
    // Source may already be stopped.
  }
}

function describeUploadedInstrument(name: string, instrumentType: string, files: AudioFile[]): string[] {
  const sampleUrl = files.map((file) => file.path).join(" ");
  const base = characterizeInstrument({
    name: `${name} ${instrumentType} ${files.map((file) => file.name).join(" ")}`,
    kind: "sampler",
    waveform: "sample",
    sampleUrl,
    knobs: { cutoff: 0.7, resonance: 0.18, drive: 0.08, color: 0.55 },
    octave: 0,
    subOscLevel: 0,
    glideMs: 0,
  });
  const custom = instrumentType
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
  return Array.from(new Set(["sampler", "uploaded", "hit-variants", ...custom, ...base])).slice(0, 18);
}

function commonInstrumentName(files: AudioFile[]): string {
  if (files.length === 0) return "Imported instrument";
  if (files.length === 1) return stripAudioExtension(files[0].name);
  const stems = files.map((file) => stripAudioExtension(file.name));
  let prefix = stems[0] ?? "Imported";
  for (const stem of stems.slice(1)) {
    while (prefix && !stem.toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix.replace(/[-_\s]+$/g, "").trim() || "Hit variant instrument";
}

function stripAudioExtension(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "").trim() || "Sample";
}

function inferInstrumentType(files: AudioFile[]): string {
  const lower = files.map((file) => file.name).join(" ").toLowerCase();
  const match = INSTRUMENT_TYPES.find((type) => {
    const normalized = type.toLowerCase().replace(/-/g, " ");
    return normalized.split(/\s+/).some((token) => token.length > 2 && lower.includes(token));
  });
  if (match) return match;
  if (/\b(hh|hat)\b/.test(lower)) return "Closed Hi-Hat";
  if (/\b(bd|kick)\b/.test(lower)) return "Kick";
  if (/\b(sd|snare)\b/.test(lower)) return "Snare";
  return "Sampler";
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  return `${seconds.toFixed(seconds < 1 ? 2 : 1)}s`;
}

async function importDecentPresetInBrowser(): Promise<DecentSamplerImport | null> {
  const files = await chooseDecentFiles();
  if (files.length === 0) return null;

  if (files.some((file) => file.name.toLowerCase().endsWith(".zip"))) {
    throw new Error("Decent Sampler ZIP pack import is available in the native app. In browser preview, select the .dspreset and its sample files together.");
  }

  const presetFile = files.find((file) => file.name.toLowerCase().endsWith(".dspreset"));
  if (!presetFile) {
    throw new Error("Select a .dspreset file plus its referenced sample files.");
  }

  const audioFiles = files.filter((file) => isSupportedAudioFileName(file.name));
  if (audioFiles.length === 0) {
    throw new Error(`Select the .dspreset and at least one referenced sample file (${SUPPORTED_AUDIO_IMPORT_LABEL}).`);
  }

  const xmlText = await presetFile.text();
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  if (xml.querySelector("parsererror")) {
    throw new Error("Could not parse this Decent Sampler preset.");
  }

  const entries = await Promise.all(audioFiles.map(async (file) => ({
    file,
    audioFile: await browserFileToAudioFile(file),
  })));

  const samples = Array.from(xml.querySelectorAll("sample"))
    .map((sample) => sampleFromElement(sample, presetFile, entries, inheritedSampleTrigger(sample)))
    .filter((sample): sample is DecentSamplerImport["samples"][number] => Boolean(sample));

  if (samples.length === 0) {
    throw new Error("No matching sample files were found. Select the .dspreset and the WAV/AIFF sample files it references together.");
  }

  const sampleUrls = Array.from(new Set(samples.map((sample) => sample.path)));
  const matchedAudioFiles = entries
    .map((entry) => entry.audioFile)
    .filter((file) => sampleUrls.includes(file.path));
  const root = xml.documentElement;

  return {
    name: root.getAttribute("name") || stripAudioExtension(presetFile.name),
    path: presetFile.name,
    sampleUrls,
    samples,
    audioFiles: matchedAudioFiles,
  };
}

function chooseDecentFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = [".dspreset", ".zip", ...SUPPORTED_AUDIO_IMPORT_EXTENSIONS].join(",");
    input.style.display = "none";
    document.body.append(input);
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(files);
    }, { once: true });
    input.click();
  });
}

function sampleFromElement(
  element: Element,
  presetFile: File,
  entries: Array<{ file: File; audioFile: AudioFile }>,
  inheritedTrigger = "attack",
): DecentSamplerImport["samples"][number] | null {
  const rawPath = firstAttribute(element, ["path", "file", "filename", "fileName", "sample"]);
  const match = matchBrowserSample(rawPath, presetFile, entries);
  if (!match) return null;
  return {
    path: match.audioFile.path,
    name: match.file.name,
    trigger: normalizedDecentTrigger(firstAttribute(element, ["trigger", "playbackMode", "playback_mode"]) || inheritedTrigger),
    rootNote: intAttribute(element, ["rootNote", "root", "pitch_keycenter"], 60),
    loNote: intAttribute(element, ["loNote", "loKey", "lokey"], 0),
    hiNote: intAttribute(element, ["hiNote", "hiKey", "hikey"], 127),
    loVel: intAttribute(element, ["loVel", "lovel"], 0),
    hiVel: intAttribute(element, ["hiVel", "hivel"], 127),
    volumeDb: floatAttribute(element, ["volume", "gain"], 0),
    pan: floatAttribute(element, ["pan"], 0),
    tuning: floatAttribute(element, ["tuning", "pitch"], 0),
    seqPosition: intAttribute(element, ["seqPosition", "seq_position"], 0),
    chokeGroup: Math.max(0, intAttribute(element, ["chokeGroup", "choke_group", "exclusiveGroup", "exclusive_group"], 0)),
    loopEnabled: boolAttribute(element, ["loopEnabled", "loop", "loop_enabled"], false)
      || stringAttributeMatches(element, ["loopMode", "loop_mode", "playbackMode", "trigger"], ["loop", "loop_continuous", "loop_sustain", "sustain"]),
    loopStart: Math.max(0, intAttribute(element, ["loopStart", "loop_start", "loopStartSample", "loop_start_sample"], 0)),
    loopEnd: Math.max(0, intAttribute(element, ["loopEnd", "loop_end", "loopEndSample", "loop_end_sample"], 0)),
    oneShot: boolAttribute(element, ["oneShot", "one_shot"], false)
      || stringAttributeMatches(element, ["trigger", "playbackMode", "loopMode", "loop_mode"], ["one_shot", "oneshot", "one shot"]),
  };
}

function inheritedSampleTrigger(element: Element) {
  let trigger = "attack";
  const groups: Element[] = [];
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName.toLowerCase() === "group") groups.unshift(parent);
  }
  for (const parent of groups) {
    const groupTrigger = firstAttribute(parent, ["trigger", "playbackMode", "playback_mode"]);
    if (groupTrigger) trigger = normalizedDecentTrigger(groupTrigger);
    const name = parent.getAttribute("name") ?? "";
    if (trigger === "attack" && /release/i.test(name)) trigger = "release";
  }
  return trigger;
}

function normalizedDecentTrigger(raw: string) {
  const trigger = raw.trim().toLowerCase();
  if (["release", "note_off", "note-off", "noteoff"].includes(trigger)) return "release";
  if (["attack", "note_on", "note-on", "noteon"].includes(trigger)) return "attack";
  return trigger || "attack";
}

function matchBrowserSample(
  samplePath: string,
  presetFile: File,
  entries: Array<{ file: File; audioFile: AudioFile }>,
) {
  const normalizedSample = normalizeBrowserPath(samplePath);
  const basename = normalizedSample.split("/").pop() ?? normalizedSample;
  const presetBase = stripAudioExtension(presetFile.name).toLowerCase();
  return entries.find((entry) => {
    const relative = normalizeBrowserPath((entry.file as File & { webkitRelativePath?: string }).webkitRelativePath || entry.file.name);
    return Boolean(normalizedSample) && (relative.endsWith(normalizedSample) || relative.endsWith(`/${normalizedSample}`));
  }) ?? entries.find((entry) => entry.file.name.toLowerCase() === basename)
    ?? entries.find((entry) => stripAudioExtension(entry.file.name).toLowerCase().startsWith(presetBase));
}

function normalizeBrowserPath(path: string | undefined): string {
  return (path ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .toLowerCase();
}

function firstAttribute(element: Element, names: string[]): string {
  for (const name of names) {
    const value = element.getAttribute(name);
    if (value) return value;
  }
  return "";
}

function intAttribute(element: Element, names: string[], fallback: number): number {
  const value = Number.parseInt(firstAttribute(element, names), 10);
  return Number.isFinite(value) ? value : fallback;
}

function floatAttribute(element: Element, names: string[], fallback: number): number {
  const value = Number.parseFloat(firstAttribute(element, names));
  return Number.isFinite(value) ? value : fallback;
}

function boolAttribute(element: Element, names: string[], fallback: boolean): boolean {
  const value = firstAttribute(element, names).trim().toLowerCase();
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

function stringAttributeMatches(element: Element, names: string[], values: string[]): boolean {
  const value = firstAttribute(element, names).trim().toLowerCase();
  return value ? values.some((expected) => value === expected.toLowerCase()) : false;
}
