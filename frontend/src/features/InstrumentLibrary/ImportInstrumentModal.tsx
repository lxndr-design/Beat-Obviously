import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { Button, Icon, Modal, TextInput, useContextMenu } from "../../components";
import { browserFileToAudioFile, importAudioFiles } from "../../audio/audioImport";
import { isSupportedAudioFileName, SUPPORTED_AUDIO_IMPORT_EXTENSIONS, SUPPORTED_AUDIO_IMPORT_LABEL } from "../../audio/audioFormats";
import { isNative, send } from "../../ipc/bridge";
import type { DecentSamplerImport } from "../../ipc/schema";
import { characterizeInstrument, snapshotInstrument, useAudioFileStore, useInstrumentStore, USER_INSTRUMENT_SET_ID } from "../../state/store";
import type { AudioFile, Instrument } from "../../state/types";
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
  volumes: ImportVolume[];
}

interface ImportVolume {
  id: string;
  name: string;
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

export function ImportInstrumentModal({ onClose, initialFiles = [], onImportedFiles }: Props) {
  const addAudioFile = useAudioFileStore((s) => s.addFile);
  const addInstrument = useInstrumentStore((s) => s.addInstrument);
  const updateInstrument = useInstrumentStore((s) => s.updateInstrument);
  const [files, setFiles] = useState<AudioFile[]>(() => initialFiles);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(initialFiles.map((file) => file.id)));
  const [groups, setGroups] = useState<ImportGroup[]>([]);
  const [fileGroups, setFileGroups] = useState<Record<string, string | undefined>>({});
  const [fileVolumes, setFileVolumes] = useState<Record<string, string | undefined>>({});
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [dragIds, setDragIds] = useState<string[]>([]);
  const [decentStatus, setDecentStatus] = useState("");
  const [samplePeaks, setSamplePeaks] = useState<Record<string, number>>({});
  const [playingPreviewId, setPlayingPreviewId] = useState<string | null>(null);
  const contextIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (initialFiles.length === 0) return;
    void measureSamplePeaks(initialFiles).then((peaks) => {
      setSamplePeaks((current) => ({ ...current, ...peaks }));
    });
  }, [initialFiles]);

  const groupedFiles = useMemo(
    () => groups
      .map((group) => ({
        group,
        files: files.filter((file) => fileGroups[file.id] === group.id),
      }))
      .filter((entry) => entry.files.length > 0),
    [fileGroups, files, groups],
  );
  const ungroupedFiles = useMemo(
    () => files.filter((file) => !fileGroups[file.id]),
    [fileGroups, files],
  );
  const importableCount = groupedFiles.length;

  const fileMenu = useContextMenu(() => {
    const ids = Array.from(contextIdsRef.current).filter((id) => files.some((file) => file.id === id));
    const containsGrouped = ids.some((id) => fileGroups[id]);
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
    onClose();
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
      preset.audioFiles.forEach(addAudioFile);
      createDecentInstrument(preset, addInstrument, updateInstrument);
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Decent Sampler import is unavailable here.";
      setDecentStatus(message);
      window.alert(message);
    }
  }

  function selectFile(id: string, event: MouseEvent) {
    setSelectedIds((current) => {
      if (event.shiftKey && lastSelectedId) {
        const start = files.findIndex((file) => file.id === lastSelectedId);
        const end = files.findIndex((file) => file.id === id);
        if (start >= 0 && end >= 0) {
          const [lo, hi] = start < end ? [start, end] : [end, start];
          return new Set([...current, ...files.slice(lo, hi + 1).map((file) => file.id)]);
        }
      }
      return new Set([id]);
    });
    setLastSelectedId(id);
  }

  function focusFileForDrag(id: string, event: MouseEvent) {
    if (event.button !== 0 || event.shiftKey) return;
    if (selectedIds.has(id)) return;
    setSelectedIds(new Set([id]));
    setLastSelectedId(id);
  }

  function openFileContext(id: string, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const ids = selectedIds.has(id) ? selectedIds : new Set([id]);
    contextIdsRef.current = ids;
    setSelectedIds(ids);
    setLastSelectedId(id);
    fileMenu.openAt(event.clientX, event.clientY);
  }

  function groupFiles(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids)).filter((id) => files.some((file) => file.id === id));
    if (uniqueIds.length === 0) return;
    const targets = files.filter((file) => uniqueIds.includes(file.id));
    const id = crypto.randomUUID();
    const nextGroup: ImportGroup = {
      id,
      name: commonInstrumentName(targets),
      type: inferInstrumentType(targets),
      normalize: false,
      volumes: [{ id: crypto.randomUUID(), name: "Volume 1" }],
    };
    setGroups((current) => [...current, nextGroup]);
    moveFilesToGroup(uniqueIds, id, false, nextGroup.volumes[0].id);
  }

  function moveFilesToGroup(ids: string[], groupId: string | undefined, prune = true, volumeId?: string) {
    setFileGroups((current) => {
      const next = { ...current };
      ids.forEach((id) => {
        if (groupId) next[id] = groupId;
        else delete next[id];
      });
      if (prune) pruneEmptyGroups(next);
      return next;
    });
    setFileVolumes((current) => {
      const next = { ...current };
      ids.forEach((id) => {
        if (groupId) next[id] = volumeId;
        else delete next[id];
      });
      return next;
    });
  }

  function pruneEmptyGroups(nextFileGroups: Record<string, string | undefined>) {
    setGroups((current) => current.filter((group) => files.some((file) => nextFileGroups[file.id] === group.id)));
  }

  function updateGroup(id: string, patch: Partial<ImportGroup>) {
    setGroups((current) => current.map((group) => group.id === id ? { ...group, ...patch } : group));
  }

  function addVolume(groupId: string) {
    setGroups((current) => current.map((group) => group.id === groupId
      ? {
        ...group,
        volumes: [
          ...group.volumes,
          { id: crypto.randomUUID(), name: `Volume ${group.volumes.length + 1}` },
        ],
      }
      : group));
  }

  function deleteVolume(groupId: string, volumeId: string) {
    const group = groups.find((item) => item.id === groupId);
    if (!group || group.volumes.length <= 1) return;
    const index = group.volumes.findIndex((volume) => volume.id === volumeId);
    const fallback = group.volumes[index + 1] ?? group.volumes[index - 1] ?? group.volumes[0];
    setGroups((current) => current.map((item) => item.id === groupId
      ? { ...item, volumes: item.volumes.filter((volume) => volume.id !== volumeId) }
      : item));
    setFileVolumes((current) => {
      const next = { ...current };
      files.forEach((file) => {
        if (fileGroups[file.id] === groupId && next[file.id] === volumeId) next[file.id] = fallback.id;
      });
      return next;
    });
  }

  function dragStart(fileId: string, event: DragEvent) {
    const ids = selectedIds.has(fileId) ? Array.from(selectedIds) : [fileId];
    if (!selectedIds.has(fileId)) {
      setSelectedIds(new Set([fileId]));
      setLastSelectedId(fileId);
    }
    setDragIds(ids);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ids.join(","));
  }

  function dropOnGroup(groupId: string, event: DragEvent) {
    event.preventDefault();
    const ids = draggedIds(event);
    const group = groups.find((item) => item.id === groupId);
    moveFilesToGroup(ids, groupId, true, group?.volumes[0]?.id);
    setDragIds([]);
  }

  function dropOnVolume(groupId: string, volumeId: string, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    moveFilesToGroup(draggedIds(event), groupId, true, volumeId);
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
    const targetGroup = fileGroups[targetId];
    if (targetGroup) {
      moveFilesToGroup(ids, targetGroup, true, fileVolumes[targetId]);
      return;
    }
    groupFiles([...ids, targetId]);
    setDragIds([]);
  }

  function draggedIds(event: DragEvent): string[] {
    const raw = event.dataTransfer.getData("text/plain");
    return (raw ? raw.split(",") : dragIds).filter(Boolean);
  }

  function importGroups() {
    const importedFiles: AudioFile[] = [];
    groupedFiles.forEach(({ group, files: groupFiles }) => {
      importedFiles.push(...groupFiles);
      groupFiles.forEach(addAudioFile);
      createSamplerInstrument(
        group.name.trim() || commonInstrumentName(groupFiles),
        groupFiles,
        groupFiles.length > 1 ? `Round robin upload (${groupFiles.length} files)` : groupFiles[0].name,
        group.type,
        group.normalize,
        group.volumes,
        fileVolumes,
        samplePeaks,
        addInstrument,
        updateInstrument,
      );
    });
    onImportedFiles?.(importedFiles);
    closeModal();
  }

  async function previewFile(file: AudioFile) {
    if (playingPreviewId === file.id) {
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
      title={<><Icon name="ph:upload-simple" size={14} decorative />Import instruments</>}
      width="lg"
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>Cancel</Button>
          <Button variant="primary" disabled={importableCount === 0} onClick={importGroups}>
            Import Instruments
          </Button>
        </>
      }
    >
      <div className={styles.panel}>
        <div className={styles.topRow}>
          <Button onClick={() => void uploadFiles()}>
            <Icon name="ph:plus" size={14} decorative />
            Add WAVs
          </Button>
          <Button onClick={() => void importDecentPreset()}>
            <Icon name="ph:waveform" size={14} decorative />
            Import DS
          </Button>
          <Button disabled={selectedIds.size === 0} onClick={() => groupFiles(Array.from(selectedIds))}>
            <Icon name="ph:stack-simple" size={14} decorative />
            Group
          </Button>
        </div>
        {decentStatus && <div className={styles.status}>{decentStatus}</div>}
        <datalist id="instrument-import-types">
          {INSTRUMENT_TYPES.map((type) => <option key={type} value={type} />)}
        </datalist>
        <div className={styles.importGrid}>
          <section
            className={styles.fileList}
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropOnUngrouped}
          >
            <div className={styles.listHeader}>WAVs</div>
            {files.length === 0 && (
              <div className={styles.empty}>Upload one-shot WAVs, select related files, then right-click or drag them together into an instrument group.</div>
            )}
            {ungroupedFiles.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                selected={selectedIds.has(file.id)}
                grouped={false}
                onClick={(event) => selectFile(file.id, event)}
                onMouseDown={(event) => focusFileForDrag(file.id, event)}
                onContextMenu={(event) => openFileContext(file.id, event)}
                onDragStart={(event) => dragStart(file.id, event)}
                onDrop={(event) => dropOnFile(file.id, event)}
                onPreview={() => void previewFile(file)}
                playing={playingPreviewId === file.id}
              />
            ))}
          </section>
          <section className={styles.groupList}>
            <div className={styles.listHeader}>Instruments</div>
            {groupedFiles.length === 0 && files.length > 0 && (
              <div className={styles.empty}>No grouped instruments yet. Ungrouped files are temporary and will not be imported.</div>
            )}
            {groupedFiles.map(({ group, files: groupFiles }) => (
              <div
                key={group.id}
                className={styles.groupCard}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropOnGroup(group.id, event)}
              >
                <div className={styles.groupHeader}>
                  <TextInput
                    label="Name"
                    layout="inline"
                    value={group.name}
                    onChange={(event) => updateGroup(group.id, { name: event.currentTarget.value })}
                  />
                  <label className={styles.typeField}>
                    <span>Type</span>
                    <input
                      value={group.type}
                      list="instrument-import-types"
                      onChange={(event) => updateGroup(group.id, { type: event.currentTarget.value })}
                    />
                  </label>
                  <label className={styles.normalizeField}>
                    <input
                      type="checkbox"
                      checked={group.normalize}
                      onChange={(event) => updateGroup(group.id, { normalize: event.currentTarget.checked })}
                    />
                    <span>Normalize</span>
                  </label>
                  <Button size="xs" onClick={() => addVolume(group.id)}>
                    <Icon name="ph:plus" size={12} decorative />
                    Add Volume
                  </Button>
                </div>
                <div className={styles.groupRows}>
                  {group.volumes.map((volume) => {
                    const volumeFiles = groupFiles.filter((file) => (fileVolumes[file.id] ?? group.volumes[0]?.id) === volume.id);
                    return (
                      <div
                        key={volume.id}
                        className={styles.volumeBlock}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => dropOnVolume(group.id, volume.id, event)}
                      >
                        <div className={styles.volumeHeader}>
                          <span>{volume.name}</span>
                          <button
                            type="button"
                            className={styles.volumeDelete}
                            disabled={group.volumes.length <= 1}
                            onClick={() => deleteVolume(group.id, volume.id)}
                            aria-label={`Delete ${volume.name}`}
                          >
                            <Icon name="ph:trash" size={12} decorative />
                          </button>
                        </div>
                        {volumeFiles.map((file) => (
                          <FileRow
                            key={file.id}
                            file={file}
                            selected={selectedIds.has(file.id)}
                            grouped
                            onClick={(event) => selectFile(file.id, event)}
                            onMouseDown={(event) => focusFileForDrag(file.id, event)}
                            onContextMenu={(event) => openFileContext(file.id, event)}
                            onDragStart={(event) => dragStart(file.id, event)}
                            onDrop={(event) => dropOnFile(file.id, event)}
                            onPreview={() => void previewFile(file)}
                            playing={playingPreviewId === file.id}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        </div>
        <div className={styles.discardNote}>{ungroupedFiles.length} ungrouped files will be discarded</div>
        {groupedFiles.some((entry) => entry.files.length > 1) && (
          <p className={styles.hint}>
            Groups with multiple files become one sampler instrument and cycle those files round-robin on playback.
          </p>
        )}
        {fileMenu.menu}
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

function FileRow({ file, selected, grouped, onClick, onMouseDown, onContextMenu, onDragStart, onDrop, onPreview, playing }: FileRowProps) {
  return (
    <div
      className={[
        styles.fileRow,
        selected && styles.fileRowSelected,
        grouped && styles.fileRowGrouped,
      ].filter(Boolean).join(" ")}
      draggable
      onClick={onClick}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      role="button"
      tabIndex={0}
    >
      <span className={styles.dragHandle}>::</span>
      <span className={styles.fileName}>{file.name}</span>
      <span className={styles.fileMeta}>{formatDuration(file.durationSeconds)}</span>
      <button
        type="button"
        className={styles.previewButton}
        aria-label={`${playing ? "Stop" : "Preview"} ${file.name}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onPreview();
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        draggable={false}
      >
        <Icon name={playing ? "ph:pause-fill" : "ph:play-fill"} size={12} decorative />
      </button>
    </div>
  );
}

function createDecentInstrument(
  preset: DecentSamplerImport,
  addInstrument: ReturnType<typeof useInstrumentStore.getState>["addInstrument"],
  updateInstrument: ReturnType<typeof useInstrumentStore.getState>["updateInstrument"],
) {
  const sampleUrls = Array.from(new Set(preset.sampleUrls));
  const audioIds = new Map(preset.audioFiles.map((file) => [file.path, file.id]));
  const patch: Partial<Instrument> = {
    name: preset.name || "Decent Sampler instrument",
    kind: "sampler",
    waveform: "sample",
    sampleIds: sampleUrls.map((url) => audioIds.get(url)).filter(Boolean) as string[],
    sampleUrl: sampleUrls[0],
    sampleUrls,
    sampleMap: preset.samples.map((sample) => ({
      path: sample.path,
      name: sample.name,
      rootNote: sample.rootNote,
      loNote: sample.loNote,
      hiNote: sample.hiNote,
      loVel: sample.loVel,
      hiVel: sample.hiVel,
      volumeDb: sample.volumeDb,
      pan: sample.pan,
      tuning: sample.tuning,
      seqPosition: sample.seqPosition,
    })),
    setId: USER_INSTRUMENT_SET_ID,
    source: {
      kind: "uploaded",
      label: `Decent Sampler: ${preset.name}`,
      url: preset.path,
      importedAt: Date.now(),
      edited: false,
    },
    descriptors: describeDecentPreset(preset),
    userCreated: true,
  };
  const id = addInstrument(patch);
  const instrument = useInstrumentStore.getState().instruments.find((item) => item.id === id);
  if (instrument) updateInstrument(id, { original: snapshotInstrument(instrument) });
}

function createSamplerInstrument(
  name: string,
  files: AudioFile[],
  sourceLabel: string,
  instrumentType: string,
  normalize: boolean,
  volumes: ImportVolume[],
  fileVolumes: Record<string, string | undefined>,
  samplePeaks: Record<string, number>,
  addInstrument: ReturnType<typeof useInstrumentStore.getState>["addInstrument"],
  updateInstrument: ReturnType<typeof useInstrumentStore.getState>["updateInstrument"],
) {
  const sampleIds = files.map((file) => file.id);
  const sampleUrls = files.map((file) => file.path);
  const sampleMap = (normalize || volumes.length > 1) ? mappedSampleZones(files, samplePeaks, normalize, volumes, fileVolumes) : undefined;
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
  volumes: ImportVolume[],
  fileVolumes: Record<string, string | undefined>,
): Instrument["sampleMap"] {
  const lanes = volumes.length > 0 ? volumes : [{ id: "default", name: "Volume 1" }];
  return files.map((file, index) => {
    const peak = samplePeaks[file.id] ?? 0;
    const volumeDb = normalize && peak > 0
      ? Math.max(-24, Math.min(24, 20 * Math.log10(0.9 / peak)))
      : 0;
    const laneIndex = Math.max(0, lanes.findIndex((lane) => lane.id === (fileVolumes[file.id] ?? lanes[0].id)));
    const loVel = Math.round((laneIndex / lanes.length) * 128);
    const hiVel = Math.min(127, Math.round(((laneIndex + 1) / lanes.length) * 128) - 1);
    return {
      path: file.path,
      name: file.name,
      rootNote: 60,
      loNote: 0,
      hiNote: 127,
      loVel,
      hiVel,
      volumeDb,
      pan: 0,
      tuning: 0,
      seqPosition: index,
    };
  });
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
  return Array.from(new Set(["sampler", "uploaded", "round-robin", ...custom, ...base])).slice(0, 18);
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
  return prefix.replace(/[-_\s]+$/g, "").trim() || "Round robin instrument";
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
    .map((sample) => sampleFromElement(sample, presetFile, entries))
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
    input.accept = [".dspreset", ...SUPPORTED_AUDIO_IMPORT_EXTENSIONS].join(",");
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
): DecentSamplerImport["samples"][number] | null {
  const rawPath = firstAttribute(element, ["path", "file", "filename", "fileName", "sample"]);
  const match = matchBrowserSample(rawPath, presetFile, entries);
  if (!match) return null;
  return {
    path: match.audioFile.path,
    name: match.file.name,
    rootNote: intAttribute(element, ["rootNote", "root", "pitch_keycenter"], 60),
    loNote: intAttribute(element, ["loNote", "loKey", "lokey"], 0),
    hiNote: intAttribute(element, ["hiNote", "hiKey", "hikey"], 127),
    loVel: intAttribute(element, ["loVel", "lovel"], 0),
    hiVel: intAttribute(element, ["hiVel", "hivel"], 127),
    volumeDb: floatAttribute(element, ["volume", "gain"], 0),
    pan: floatAttribute(element, ["pan"], 0),
    tuning: floatAttribute(element, ["tuning", "pitch"], 0),
    seqPosition: intAttribute(element, ["seqPosition", "seq_position"], 0),
  };
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

function describeDecentPreset(preset: DecentSamplerImport): string[] {
  const words = new Set(["sampler", "decent-sampler", "multisample"]);
  for (const sample of preset.samples.slice(0, 24)) {
    for (const token of sample.name.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length > 2) words.add(token);
    }
  }
  if (preset.samples.some((sample) => sample.loNote !== 0 || sample.hiNote !== 127)) words.add("key-zoned");
  if (preset.samples.some((sample) => sample.loVel !== 0 || sample.hiVel !== 127)) words.add("velocity-zoned");
  return Array.from(words).slice(0, 18);
}
