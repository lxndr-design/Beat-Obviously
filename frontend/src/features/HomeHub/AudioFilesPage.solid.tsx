import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { appAlert, appConfirm, appPrompt } from "../../solid-ui";
import { ActionFooter, Button, FloatingSelect, HoverInfo, Icon, LibrarySearch, LoadingIndicator, MarqueeText } from "../../solid-ui";
import { importAudioFiles } from "../../audio/audioImport";
import { registerGlobalAudioStop } from "../../audio/globalAudioSafety";
import { isNative, send } from "../../ipc/bridge";
import type { AudioWaveformSummary } from "../../ipc/schema";
import { buildCurrentBeatDocumentFingerprint } from "../../persistence/beatDocument";
import { useAudioFileStore, useDocumentStore, useInstrumentStore, useProjectStore } from "../../state/store";
import type { AudioFile, Instrument, Track } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { AssetPageShell, AssetStateMessage } from "./AssetPageShell.solid";
import styles from "./AudioFilesPage.module.css";

type SortKey = "name" | "status" | "source" | "size" | "length" | "imported";
type SortDirection = "asc" | "desc";
type PreviewDirection = "forward" | "reverse";
type AudioStatusFilter = "all" | "library" | "remote" | "missing" | "asset";
type WaveformLoadState = "idle" | "loading" | "ready" | "error";
const AUDIO_PAGE_SIZE = 50;
const WAVEFORM_PRIMARY_TIMEOUT_MS = 6_000;
const WAVEFORM_LOAD_TIMEOUT_MS = 10_000;
const AUDIO_STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "library", label: "Library" },
  { value: "remote", label: "Remote" },
  { value: "missing", label: "Missing" },
  { value: "asset", label: "Asset" },
];
type WaveformChannelAnalysis = { upper: number[]; lower: number[] };
type WaveformAnalysis = {
  left: WaveformChannelAnalysis;
  right: WaveformChannelAnalysis;
  leftDb: number;
  rightDb: number;
  integratedLufs: number;
  rmsDb: number;
  truePeakDb: number;
  crestDb: number;
  dcOffset: number;
  clippingCount: number;
  clippingRatio: number;
  stereoCorrelation: number;
};

export function AudioFilesPage() {
  onCleanup(registerGlobalAudioStop(stopPreview));
  const files = createStoreSelector(useAudioFileStore, (s) => s.files);
  const addFile = useAudioFileStore.getState().addFile;
  const removeFile = useAudioFileStore.getState().removeFile;
  const hydrateFiles = useAudioFileStore.getState().hydrateFiles;
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const tracks = createStoreSelector(useProjectStore, (s) => s.project.tracks);
  const [selectMode, setSelectMode] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set(), { equals: false });
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal<AudioStatusFilter>("all");
  const [currentPage, setCurrentPage] = createSignal(1);
  const [sort, setSort] = createSignal<{ key: SortKey; direction: SortDirection }>({ key: "name", direction: "asc" }, { equals: false });
  const [playingId, setPlayingId] = createSignal<string | null>(null);
  const [previewSpeed, setPreviewSpeed] = createSignal<1 | 2 | 3>(1);
  const [loopPreview, setLoopPreview] = createSignal(false);
  const [waveformAnalysis, setWaveformAnalysis] = createSignal<WaveformAnalysis | null>(null, { equals: false });
  const [waveformLoadState, setWaveformLoadState] = createSignal<WaveformLoadState>("idle");
  const [previewProgress, setPreviewProgress] = createSignal(0);
  const [previewDirection, setPreviewDirection] = createSignal<PreviewDirection>("forward");
  const [scrubbing, setScrubbing] = createSignal(false);
  let previewRef: { ctx: AudioContext; source: AudioBufferSourceNode } | null = null;
  let previewRequestId = 0;
  let progressFrame: number | null = null;
  let playbackBarRef: HTMLDivElement | undefined;
  const nativeAvailable = isNative();
  const progressRef: { current: { startTime: number; duration: number; direction: PreviewDirection; loop: boolean } } = { current: {
    startTime: 0,
    duration: 1,
    direction: "forward",
    loop: false,
  } };
  const bufferCache = new Map<string, AudioBuffer>();

  const visibleFiles = createMemo(() => filterAudioFiles(files(), searchQuery(), statusFilter()));
  const sortedFiles = createMemo(() => sortAudioFiles(visibleFiles(), sort().key, sort().direction));
  const pageCount = createMemo(() => Math.max(1, Math.ceil(sortedFiles().length / AUDIO_PAGE_SIZE)));
  const pagedFiles = createMemo(() => {
    const start = (currentPage() - 1) * AUDIO_PAGE_SIZE;
    return sortedFiles().slice(start, start + AUDIO_PAGE_SIZE);
  });
  const pageStart = createMemo(() => sortedFiles().length === 0 ? 0 : (currentPage() - 1) * AUDIO_PAGE_SIZE + 1);
  const pageEnd = createMemo(() => Math.min(currentPage() * AUDIO_PAGE_SIZE, sortedFiles().length));
  const activeFile = createMemo(() => pagedFiles().find((file) => file.id === activeId()) ?? pagedFiles()[0] ?? null);
  const activeReference = createMemo(() => activeFile() ? audioReferenceState(activeFile()!) : null);
  const selectedCount = createMemo(() => selectedIds().size);
  const multipleSelected = createMemo(() => selectMode() && selectedCount() > 1);
  const previewFile = createMemo(() => multipleSelected() ? null : activeFile());
  let previousPreviewFileId: string | null | undefined;

  createEffect(() => {
    const nextPreviewFileId = previewFile()?.id ?? null;
    if (previousPreviewFileId !== undefined && nextPreviewFileId !== previousPreviewFileId) {
      stopPreview();
      setPreviewDirection("forward");
      setScrubbing(false);
    }
    previousPreviewFileId = nextPreviewFileId;
  });

  createEffect(() => {
    const currentFiles = files();
    setSelectedIds((current) => new Set([...current].filter((id) => currentFiles.some((file) => file.id === id))));
    if (activeId() && !currentFiles.some((file) => file.id === activeId())) setActiveId(null);
  });

  createEffect(() => {
    searchQuery();
    statusFilter();
    sort();
    setCurrentPage(1);
  });

  createEffect(() => {
    const maximum = pageCount();
    setCurrentPage((page) => Math.min(Math.max(1, page), maximum));
  });

  createEffect(() => {
    const page = pagedFiles();
    if (activeId() && page.some((file) => file.id === activeId())) return;
    setActiveId(page[0]?.id ?? null);
  });

  onCleanup(() => stopPreview());

  createEffect(() => {
    const currentFiles = files();
    const patches = new Map<string, Partial<AudioFile>>();
    for (const file of currentFiles) {
      const patch = legacyAudioMetadataPatch(file);
      if (patch) patches.set(file.id, patch);
    }
    if (patches.size === 0) return;
    hydrateFiles(currentFiles.map((file) => ({ ...file, ...(patches.get(file.id) ?? {}) })));
  });

  createEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !selectMode()) return;
      setSelectMode(false);
      setSelectedIds(new Set<string>());
    }
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  createEffect(() => {
    let cancelled = false;
    setWaveformAnalysis(null);
    const currentPreviewFile = previewFile();
    if (!currentPreviewFile) {
      setWaveformLoadState("idle");
      return;
    }
    setWaveformLoadState("loading");

    const loadBrowserAnalysis = async () => {
      const ctx = getPreviewContext();
      try {
        const buffer = await loadAudioBuffer(ctx, bufferCache, currentPreviewFile);
        return analyzeAudioBuffer(buffer, 128);
      } finally {
        if (!previewRef || previewRef.ctx !== ctx) {
          void ctx.close().catch(() => undefined);
        }
      }
    };

    const loadNativeAnalysis = async () => {
      const path = nativeAudioFilePath(currentPreviewFile.path) ?? currentPreviewFile.path;
      const response = await send({ kind: "audio.waveform", path, bucketCount: 128 });
      if (!response.waveform) throw new Error(response.error ?? "Waveform unavailable.");
      return nativeWaveformAnalysis(currentPreviewFile, response.waveform);
    };

    const loadPreferredAnalysis = async () => {
      if (!isNative() || !nativeAudioFilePath(currentPreviewFile.path)) return loadBrowserAnalysis();
      try {
        return await withTimeout(loadBrowserAnalysis(), WAVEFORM_PRIMARY_TIMEOUT_MS, "Playable waveform decode timed out.");
      } catch {
        return loadNativeAnalysis();
      }
    };

    void withTimeout(loadPreferredAnalysis(), WAVEFORM_LOAD_TIMEOUT_MS, "Waveform analysis timed out.")
      .then((analysis) => {
        if (cancelled) return;
        setWaveformAnalysis(analysis);
        setWaveformLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setWaveformAnalysis(emptyWaveformAnalysis());
        setWaveformLoadState("error");
      });

    onCleanup(() => {
      cancelled = true;
    });
  });

  async function onImport() {
    const imported = await importAudioFiles();
    if (imported.length === 0) return;
    const importedAt = Date.now();
    const source = (await appPrompt("Source for this import", "", "Import Audio Source"))?.trim() ?? "";
    for (const file of imported) addFile(normalizeImportedAudioFile(file, importedAt, source));
    if (imported[0]) setActiveId(imported[0].id);
  }

  function toggleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function toggleSelection(fileId: string, shiftKey = false) {
    setSelectedIds((current) => {
      const next = new Set(shiftKey ? current : current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }

  function toggleSelectMode() {
    setSelectMode((enabled) => {
      if (enabled) setSelectedIds(new Set<string>());
      return !enabled;
    });
  }

  async function removeSelectedEntries() {
    if (selectedIds().size === 0) return;
    const referenced = selectedReferencedAudioFiles(files(), selectedIds(), tracks(), instruments());
    if (referenced.length > 0) {
      await appAlert(`Remove blocked. ${referenced.length} selected audio entr${referenced.length === 1 ? "y is" : "ies are"} still used by tracks, segments, or instruments.`);
      return;
    }
    if (!await appConfirm(`Remove ${selectedIds().size} unused audio entr${selectedIds().size === 1 ? "y" : "ies"} from the Beat library? Files on disk will not be deleted.`)) return;
    stopPreview();
    selectedIds().forEach((id) => removeFile(id));
    useDocumentStore.getState().markDirty(buildCurrentBeatDocumentFingerprint());
    setSelectedIds(new Set<string>());
    setSelectMode(false);
  }

  async function deleteSelectedFiles() {
    if (selectedIds().size === 0) return;
    const referenced = selectedReferencedAudioFiles(files(), selectedIds(), tracks(), instruments());
    if (referenced.length > 0) {
      await appAlert(`Delete blocked. ${referenced.length} selected audio entr${referenced.length === 1 ? "y is" : "ies are"} still used by tracks, segments, or instruments.`);
      return;
    }
    if (!nativeAvailable) {
      await appAlert("Deleting audio files from disk is only available in the native app.");
      return;
    }
    if (!await appConfirm(`Delete ${selectedIds().size} unused audio file${selectedIds().size === 1 ? "" : "s"} from disk and remove from the Beat library? This cannot be undone.`)) return;
    stopPreview();
    const response = await send({ kind: "audio.delete", ids: [...selectedIds()], deleteFiles: true });
    response.deletedIds.forEach((id) => removeFile(id));
    if (response.deletedIds.length > 0) useDocumentStore.getState().markDirty(buildCurrentBeatDocumentFingerprint());
    if (response.failedIds.length > 0) await appAlert(response.error ?? "Some audio files could not be deleted.");
    setSelectedIds(new Set<string>());
    setSelectMode(false);
  }

  function stopPreview(resetProgress = true) {
    previewRequestId += 1;
    stopProgress(resetProgress);
    const preview = previewRef;
    previewRef = null;
    try {
      preview?.source.stop();
    } catch {
      // Already stopped.
    }
    preview?.source.disconnect();
    setPlayingId(null);
  }

  function stopProgress(reset = true) {
    if (progressFrame !== null) {
      cancelAnimationFrame(progressFrame);
      progressFrame = null;
    }
    if (reset) setPreviewProgress(0);
  }

  function startProgress(ctx: AudioContext, duration: number, speed: number, direction: PreviewDirection, loop: boolean, initialProgress: number) {
    stopProgress(false);
    setPreviewDirection(direction);
    const playbackDuration = Math.max(0.001, duration / Math.max(0.001, speed));
    const rawProgress = direction === "reverse" ? 1 - initialProgress : initialProgress;
    progressRef.current = {
      startTime: ctx.currentTime - rawProgress * playbackDuration,
      duration: playbackDuration,
      direction,
      loop,
    };
    setPreviewProgress(clamp01(initialProgress));

    const tick = () => {
      const state = progressRef.current;
      const elapsed = Math.max(0, ctx.currentTime - state.startTime);
      const raw = state.loop ? (elapsed % state.duration) / state.duration : Math.min(1, elapsed / state.duration);
      setPreviewProgress(state.direction === "reverse" ? 1 - raw : raw);
      if (state.loop || raw < 1) {
        progressFrame = requestAnimationFrame(tick);
      }
    };
    progressFrame = requestAnimationFrame(tick);
  }

  async function playPreview(
    file: AudioFile,
    direction: PreviewDirection = "forward",
    options: { restart?: boolean; speed?: 1 | 2 | 3; loop?: boolean; progress?: number } = {},
  ) {
    const currentProgress = previewProgress();
    if (playingId() === file.id && !options.restart) {
      stopPreview(false);
      if (direction === "forward") return;
    }
    const initialProgress = clamp01(options.progress ?? (direction === "reverse" ? 1 : currentProgress));
    stopPreview(false);
    const requestId = previewRequestId;
    setPreviewDirection(direction);
    setPreviewProgress(initialProgress);
    setPlayingId(file.id);
    try {
      const ctx = getPreviewContext();
      if (ctx.state === "suspended") await ctx.resume();
      const sourceBuffer = await loadAudioBuffer(ctx, bufferCache, file);
      if (requestId !== previewRequestId) {
        void ctx.close().catch(() => undefined);
        return;
      }
      const source = ctx.createBufferSource();
      const playbackBuffer = direction === "reverse" ? reverseAudioBuffer(ctx, sourceBuffer) : sourceBuffer;
      const speed = options.speed ?? previewSpeed();
      const loop = options.loop ?? loopPreview();
      const bufferOffset = direction === "reverse"
        ? sourceBuffer.duration * (1 - initialProgress)
        : sourceBuffer.duration * initialProgress;
      source.buffer = playbackBuffer;
      source.playbackRate.value = speed;
      source.loop = loop;
      source.connect(ctx.destination);
      source.onended = () => {
        if (previewRef?.source === source) {
          previewRef = null;
          setPlayingId(null);
          stopProgress();
        }
      };
      previewRef = { ctx, source };
      startProgress(ctx, sourceBuffer.duration, speed, direction, loop, initialProgress);
      source.start(0, Math.min(playbackBuffer.duration, Math.max(0, bufferOffset)));
    } catch (error) {
      if (requestId !== previewRequestId) return;
      // eslint-disable-next-line no-console
      console.error("[Beat audio preview] Failed to preview audio file", { file, direction, error });
      setPlayingId(null);
      stopProgress();
      const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
      await appAlert(`This audio file could not be previewed.${detail}`);
    }
  }

  function toggleReversePlayback() {
    const file = previewFile();
    if (!file) return;
    const currentlyReversing = playingId() === file.id && previewDirection() === "reverse";
    const nextDirection: PreviewDirection = currentlyReversing ? "forward" : "reverse";
    const handoffProgress = nextDirection === "reverse" && previewProgress() <= 0.001 ? 1 : previewProgress();
    void playPreview(file, nextDirection, { restart: true, progress: handoffProgress });
  }

  function cycleSpeed() {
    const next = previewSpeed() === 1 ? 2 : previewSpeed() === 2 ? 3 : 1;
    setPreviewSpeed(next);
    const file = previewFile();
    if (file && playingId() === file.id) {
      void playPreview(file, progressRef.current.direction, { restart: true, speed: next, progress: previewProgress() });
    }
  }

  function toggleLoop() {
    const next = !loopPreview();
    setLoopPreview(next);
    const file = previewFile();
    if (file && playingId() === file.id) {
      void playPreview(file, progressRef.current.direction, { restart: true, loop: next, progress: previewProgress() });
    }
  }

  function progressFromPointer(clientX: number) {
    const rect = playbackBarRef?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return previewProgress();
    return clamp01((clientX - rect.left) / rect.width);
  }

  function scrubTo(progress: number) {
    const next = clamp01(progress);
    setPreviewProgress(next);
    const file = previewFile();
    if (file && playingId() === file.id) {
      void playPreview(file, progressRef.current.direction, { restart: true, progress: next });
    }
  }

  function onPlaybackBarPointerDown(event: PointerEvent) {
    if (!previewFile()) return;
    const target = event.currentTarget as HTMLDivElement | null;
    target?.setPointerCapture(event.pointerId);
    setScrubbing(true);
    scrubTo(progressFromPointer(event.clientX));
  }

  function onPlaybackBarPointerMove(event: PointerEvent) {
    if (!scrubbing()) return;
    scrubTo(progressFromPointer(event.clientX));
  }

  function onPlaybackBarPointerUp(event: PointerEvent) {
    const target = event.currentTarget as HTMLDivElement | null;
    if (target?.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    setScrubbing(false);
  }

  async function viewInFolder(file: AudioFile) {
    const response = await send({ kind: "audio.reveal", path: file.path });
    if (!response.ok) await appAlert(response.error ?? "View in Folder is only available in the native app.");
  }

  async function copyReference(file: AudioFile) {
    const value = copyableAudioReference(file);
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      await appPrompt("Copy audio reference", value);
    }
  }

  return (
    <AssetPageShell
      variant="wide-browser"
      browserLabel="Audio file browser"
      browserClassName={styles.audioBrowser}
      previewLabel="Audio playback"
      previewClassName={styles.preview}
      browser={
        <>
        <div class={styles.browserControls}>
          <span class={styles.searchField}>
            <Icon name="ph:magnifying-glass" size={18} decorative />
            <LibrarySearch
              className={styles.searchInput}
              value={searchQuery()}
              onInput={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="Search name, path, source, format…"
              aria-label="Search audio files"
            />
          </span>
          <FloatingSelect
            className={styles.statusFilter}
            layout="bare"
            fillHeight
            value={statusFilter()}
            options={AUDIO_STATUS_OPTIONS}
            ariaLabel="Filter audio files by status"
            onChange={(value) => setStatusFilter(value as AudioStatusFilter)}
          />
          <span class={styles.searchCount}>{sortedFiles().length}/{files().length}</span>
          <div class={styles.actions}>
            <Show when={selectMode()}>
              <span class={styles.selectionCount}>{selectedCount()} selected</span>
            </Show>
            <Button variant="ghost" selected={selectMode()} onClick={toggleSelectMode}>
              {selectMode() ? "Done" : "Select"}
            </Button>
            <Button variant="ghost" onClick={() => void onImport()}>
              <Icon name="ph:plus" size={18} decorative />
              Import Audio
            </Button>
            <HoverInfo content="Remove selected unused entries from the Beat library without deleting files">
              <Button variant="ghost" disabled={selectedCount() === 0} onClick={removeSelectedEntries} aria-label="Remove selected audio entries">
                <Icon name="ph:minus" size={18} decorative />
                Remove Entry
              </Button>
            </HoverInfo>
            <HoverInfo content="Delete selected unused files from disk and remove them from the library">
              <Button variant="ghost" disabled={selectedCount() === 0 || !nativeAvailable} onClick={deleteSelectedFiles} aria-label="Delete selected audio files from disk">
                <Icon name="ph:trash" size={18} decorative />
                Delete Files
              </Button>
            </HoverInfo>
          </div>
        </div>

        <div class={`${styles.table} ${selectMode() ? styles.tableSelectMode : ""}`} role="table" aria-label="Audio files">
          <div class={styles.headerRow} role="row">
            <Show when={selectMode()}>
              <span class={styles.checkHeader} />
            </Show>
            <SortHeader label="Name" sortKey="name" current={sort()} onSort={toggleSort} />
            <SortHeader label="Status" sortKey="status" current={sort()} onSort={toggleSort} />
            <SortHeader label="Source" sortKey="source" current={sort()} onSort={toggleSort} />
            <SortHeader label="Length" sortKey="length" current={sort()} onSort={toggleSort} />
            <SortHeader label="Size" sortKey="size" current={sort()} onSort={toggleSort} />
            <SortHeader label="Imported" sortKey="imported" current={sort()} onSort={toggleSort} />
          </div>

          <div class={styles.rows}>
            <Show
              when={sortedFiles().length > 0}
              fallback={
                <div class={styles.emptyRow}>
                <AssetStateMessage
                  icon="ph:waveform"
                  title={files().length > 0 ? "No Matching Audio Files" : "No Audio Files"}
                  body={files().length > 0 ? "Adjust the search text to show more files." : "Import audio to build the project library."}
                >
                  <Button variant="ghost" size="sm" onClick={() => void onImport()}>
                    <Icon name="ph:plus" size={18} decorative />
                    Import Audio
                  </Button>
                </AssetStateMessage>
              </div>
              }
            >
            <For each={pagedFiles()}>
              {(file) => {
              const selected = () => selectedIds().has(file.id);
              const active = () => activeFile()?.id === file.id;
              const reference = audioReferenceState(file);
              return (
                <div
                  class={`${styles.row} ${active() ? styles.rowActive : ""} ${selected() ? styles.rowSelected : ""}`}
                  onClick={(event) => {
                    setActiveId(file.id);
                    if (selectMode()) toggleSelection(file.id, event.shiftKey);
                  }}
                  draggable={!selectMode()}
                  onDragStart={(event) => {
                    event.dataTransfer?.setData("application/x-beat-audio-file", file.id);
                    event.dataTransfer?.setData("text/plain", file.name);
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
                  }}
                  role="row"
                >
                  <Show when={selectMode()}>
                    <span class={styles.checkCell}>
                      <span class={`${styles.checkbox} ${selected() ? styles.checkboxChecked : ""}`}>
                        <Show when={selected()}>
                          <Icon name="ph:check" size={18} decorative />
                        </Show>
                      </span>
                    </span>
                  </Show>
                  <MarqueeText className={styles.nameCell} text={file.name} />
                  <span class={`${styles.referenceChip} ${styles[reference.className]}`}>{reference.label}</span>
                  <span class={styles.sourceCell} title={formatImportSource(file)}>{formatImportSource(file)}</span>
                  <span>{formatDuration(file.durationSeconds)}</span>
                  <span>{formatFileSize(file.sizeBytes)}</span>
                  <span>{formatImported(file.importedAt)}</span>
                </div>
              );
            }}
            </For>
            </Show>
          </div>
          <nav class={styles.pagination} aria-label="Audio file pages">
            <span class={styles.pageRange}>
              {pageStart()}–{pageEnd()} of {sortedFiles().length}
            </span>
            <span class={styles.pageButtons}>
              <Button variant="ghost" iconOnly size="sm" disabled={currentPage() <= 1} onClick={() => setCurrentPage(1)} aria-label="First page">
                <Icon name="ph:caret-double-left" size={18} decorative />
              </Button>
              <Button variant="ghost" iconOnly size="sm" disabled={currentPage() <= 1} onClick={() => setCurrentPage((page) => page - 1)} aria-label="Previous page">
                <Icon name="ph:caret-left" size={18} decorative />
              </Button>
              <span class={styles.pageLabel}>Page {currentPage()} / {pageCount()}</span>
              <Button variant="ghost" iconOnly size="sm" disabled={currentPage() >= pageCount()} onClick={() => setCurrentPage((page) => page + 1)} aria-label="Next page">
                <Icon name="ph:caret-right" size={18} decorative />
              </Button>
              <Button variant="ghost" iconOnly size="sm" disabled={currentPage() >= pageCount()} onClick={() => setCurrentPage(pageCount())} aria-label="Last page">
                <Icon name="ph:caret-double-right" size={18} decorative />
              </Button>
            </span>
          </nav>
        </div>
        </>
      }
      preview={
        <>
        <Show
          when={!multipleSelected()}
          fallback={
          <div class={styles.previewBody}>
            <AssetStateMessage
              icon="ph:checks"
              title={`${selectedCount()} Audio Files Selected`}
              body="Preview is paused while a multi-file selection is active."
            />
            <div class={styles.waveformStage}>
              <div class={styles.waveformLine} />
              <ScopeOverlay analysis={null} />
              <div class={styles.multipleSelected}>Multiple files selected</div>
            </div>
            <div class={styles.previewFileName}>–</div>
            <div class={styles.previewControls} aria-hidden="true">
              <Button variant="ghost" iconOnly disabled aria-label="Play from start"><Icon name="ph:skip-back" size={18} decorative /></Button>
              <Button variant="ghost" iconOnly disabled aria-label="Play or pause"><Icon name="ph:play-fill" size={18} decorative /></Button>
              <Button variant="ghost" iconOnly disabled aria-hidden="true">-</Button>
              <Button variant="ghost" iconOnly disabled aria-label="Play backwards"><Icon name="ph:rewind-fill" size={18} decorative /></Button>
              <Button variant="ghost" iconOnly disabled aria-label="Loop preview"><Icon name="ph:repeat" size={18} decorative /></Button>
            </div>
            <dl class={styles.details}>
              <Info label="Source" value="–" />
              <Info label="Import Date" value="–" />
              <Info label="Playback Resolution" value="–" />
              <Info label="Total Length" value="–" />
              <Info label="File Size" value="–" />
              <Info label="Used In" value="–" />
              <Info label="Instrument" value="–" />
              <Info label="Library Path" value="–" />
              <Info label="Format" value="–" />
            </dl>
            <ActionFooter class={styles.previewActions}>
              <Button variant="ghost" size="sm" disabled>
                <Icon name="ph:folder-open" size={18} decorative />
                View in Folder
              </Button>
            </ActionFooter>
          </div>
          }
        >
        <Show
          when={activeFile()}
          fallback={
            <div class={styles.emptyPreview}>
              <AssetStateMessage
                icon="ph:waveform"
                title="Select an Audio File"
                body="Choose a file to inspect waveform, usage, and reference details."
              />
            </div>
          }
        >
          {(file) => (
          <div class={styles.previewBody}>
            <Show when={activeReference() && activeReference()!.tone !== "neutral"}>
              <AssetStateMessage
                icon={activeReference()!.icon}
                title={activeReference()!.title}
                body={activeReference()!.body}
                tone={activeReference()!.tone}
              />
            </Show>
            <div class={styles.waveformStage}>
              <div class={styles.waveformLine} />
              <ScopeOverlay analysis={waveformAnalysis()} />
              <WaveformPreview analysis={waveformAnalysis()} loading={waveformLoadState() === "loading"} />
              <div class={styles.playhead} style={{ left: `${previewProgress() * 100}%` }} />
              <Show when={waveformLoadState() !== "ready"}>
                <div class={styles.waveformStatus}>
                  {waveformLoadState() === "error" ? "Waveform Unavailable" : "Loading Waveform"}
                </div>
              </Show>
            </div>
            <div class={styles.previewFileName} title={file().name}>{file().name}</div>
            <div
              ref={playbackBarRef}
              class={`${styles.playbackBar} ${scrubbing() ? styles.playbackBarScrubbing : ""}`}
              onPointerDown={onPlaybackBarPointerDown}
              onPointerMove={onPlaybackBarPointerMove}
              onPointerUp={onPlaybackBarPointerUp}
              onPointerCancel={onPlaybackBarPointerUp}
              role="slider"
              aria-label="Preview playback position"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(previewProgress() * 100)}
            >
              <div class={styles.playbackBarFill} style={{ transform: `scaleX(${previewProgress()})` }} />
              <div class={styles.playbackKnob} style={{ left: `${previewProgress() * 100}%` }} />
            </div>
            <div class={styles.previewControls}>
              <HoverInfo content="Play from start">
                <Button variant="ghost" iconOnly onClick={() => void playPreview(file(), "forward", { restart: true, progress: 0 })} aria-label="Play from start">
                  <Icon name="ph:skip-back" size={18} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Play / pause">
                <Button variant="ghost" iconOnly selected={playingId() === file().id} onClick={() => void playPreview(file(), "forward", { progress: previewProgress() >= 1 ? 0 : previewProgress() })} aria-label="Play or pause">
                  <Icon name={playingId() === file().id ? "ph:pause-fill" : "ph:play-fill"} size={18} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Playback speed">
                <Button variant="ghost" iconOnly onClick={cycleSpeed} aria-label={`Playback speed ${previewSpeed()}x`}>{previewSpeed()}x</Button>
              </HoverInfo>
              <HoverInfo content="Play backwards">
                <Button variant="ghost" iconOnly selected={playingId() === file().id && previewDirection() === "reverse"} onClick={toggleReversePlayback} aria-label="Play backwards">
                  <Icon name="ph:rewind-fill" size={18} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Loop preview">
                <Button variant="ghost" iconOnly selected={loopPreview()} onClick={toggleLoop} aria-label="Loop preview">
                  <Icon name="ph:repeat" size={18} decorative />
                </Button>
              </HoverInfo>
            </div>
            <dl class={styles.details}>
              <Info label="Source" value={formatSource(file().path)} />
              <Info label="Import Source" value={formatImportSource(file())} />
              <Info label="Reference" value={activeReference()?.detail ?? "Unknown"} />
              <Info label="Import Date" value={formatImported(file().importedAt)} />
              <Info label="Playback Resolution" value={formatPlaybackResolution(file())} />
              <Info label="Total Length" value={formatDuration(file().durationSeconds)} />
              <Info label="Integrated Loudness" value={formatLufs(waveformAnalysis()?.integratedLufs)} />
              <Info label="True Peak" value={formatTruePeak(waveformAnalysis()?.truePeakDb)} />
              <Info label="RMS" value={formatDb(waveformAnalysis()?.rmsDb)} />
              <Info label="Crest Factor" value={formatDbDelta(waveformAnalysis()?.crestDb)} />
              <Info label="DC Offset" value={formatPercent(waveformAnalysis()?.dcOffset)} />
              <Info label="Clipping" value={formatClipCount(waveformAnalysis()?.clippingCount, waveformAnalysis()?.clippingRatio)} />
              <Info label="Stereo Correlation" value={formatCorrelation(waveformAnalysis()?.stereoCorrelation)} />
              <Info label="File Size" value={formatFileSize(file().sizeBytes)} />
              <Info label="Used In" value={formatUsage(file().id, tracks())} />
              <Info label="Instrument" value={formatInstrumentUsage(file(), instruments())} />
              <Info label="Library Path" value={file().path} />
              <Info label="Format" value={formatExtension(file().name || file().path)} />
            </dl>
            <ActionFooter class={styles.previewActions}>
              <HoverInfo content={canRevealAudioReference(file()) ? "Reveal the referenced file in Finder" : "Reveal is available only for file references in the native app"}>
                <Button variant="ghost" size="sm" disabled={!canRevealAudioReference(file())} onClick={() => void viewInFolder(file())}>
                  <Icon name="ph:folder-open" size={18} decorative />
                  Reveal File
                </Button>
              </HoverInfo>
              <HoverInfo content="Copy the library reference">
                <Button variant="ghost" size="sm" disabled={!copyableAudioReference(file())} onClick={() => void copyReference(file())}>
                  <Icon name="ph:copy" size={18} decorative />
                  Copy Reference
                </Button>
              </HoverInfo>
            </ActionFooter>
          </div>
          )}
        </Show>
        </Show>
        </>
      }
    />
  );
}

function ScopeOverlay({ analysis }: { analysis: WaveformAnalysis | null }) {
  return (
    <>
      <span class={`${styles.waveformScopeLabel} ${styles.waveformDbTop}`}>{formatDb(analysis?.leftDb)}</span>
      <span class={`${styles.waveformScopeLabel} ${styles.waveformDbBottom}`}>{formatDb(analysis?.rightDb)}</span>
      <span class={`${styles.waveformLeftTick} ${styles.waveformLeftTickUpper}`} />
      <span class={`${styles.waveformLeftTick} ${styles.waveformLeftTickLower}`} />
      <span class={`${styles.waveformChannelLabel} ${styles.waveformChannelLeft}`}>L</span>
      <span class={`${styles.waveformChannelLabel} ${styles.waveformChannelRight}`}>R</span>
    </>
  );
}

function WaveformPreview({ analysis, loading }: { analysis: WaveformAnalysis | null; loading: boolean }) {
  if (loading) return <LoadingIndicator size="lg" className={styles.waveformLoading} label="Loading waveform" />;
  if (!analysis) return null;
  if (analysis.left.upper.length === 0 && analysis.right.upper.length === 0) return null;

  const left = stereoWaveformPath(channelEnvelope(analysis.left), 50, -42);
  const right = stereoWaveformPath(channelEnvelope(analysis.right), 50, 42);

  return (
    <svg class={styles.waveformSvg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon class={styles.waveformFill} points={left.fill} />
      <polyline class={styles.waveformTrace} points={left.trace} />
      <polygon class={styles.waveformFill} points={right.fill} />
      <polyline class={styles.waveformTrace} points={right.trace} />
    </svg>
  );
}

function channelEnvelope(channel: WaveformChannelAnalysis) {
  return channel.upper.map((peak, index) => Math.max(peak, channel.lower[index] ?? 0));
}

function stereoWaveformPath(peaks: number[], centerY: number, amplitude: number) {
  const trace = peaks.map((peak, index) => {
    const x = peaks.length === 1 ? 50 : (index / (peaks.length - 1)) * 100;
    const y = centerY + peak * amplitude;
    return `${x.toFixed(3)},${y.toFixed(3)}`;
  });
  const center = peaks.map((_, index) => {
    const x = peaks.length === 1 ? 50 : (index / (peaks.length - 1)) * 100;
    return `${x.toFixed(3)},${centerY.toFixed(3)}`;
  });

  return {
    trace: trace.join(" "),
    fill: [...center, ...trace.reverse()].join(" "),
  };
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  current: { key: SortKey; direction: SortDirection };
  onSort: (key: SortKey) => void;
}

function SortHeader({ label, sortKey, current, onSort }: SortHeaderProps) {
  const active = current.key === sortKey;
  return (
    <Button
      variant="ghost"
      class={`${styles.sortHeader} ${active ? styles.sortHeaderActive : ""}`}
      onClick={() => onSort(sortKey)}
    >
      <span>{label}</span>
      {active && <Icon name={current.direction === "asc" ? "ph:caret-up" : "ph:caret-down"} size={18} decorative />}
    </Button>
  );
}

function normalizeImportedAudioFile(file: AudioFile, importedAt = Date.now(), importSource = ""): AudioFile {
  return {
    ...file,
    importedAt: file.importedAt ?? importedAt,
    importSource: importSource || file.importSource || "Unassigned",
    sizeBytes: file.sizeBytes ?? estimateDataUrlSize(file.path),
  };
}

function legacyAudioMetadataPatch(file: AudioFile): Partial<AudioFile> | null {
  const patch: Partial<AudioFile> = {};
  const estimatedSize = estimateDataUrlSize(file.path);
  const bitDepth = parseDataUrlWavBitDepth(file.path);
  if ((!Number.isFinite(file.sizeBytes) || !file.sizeBytes || file.sizeBytes <= 0) && estimatedSize) {
    patch.sizeBytes = estimatedSize;
  }
  if ((!Number.isFinite(file.bitDepth) || !file.bitDepth || file.bitDepth <= 0) && bitDepth) {
    patch.bitDepth = bitDepth;
  }
  if (!Number.isFinite(file.importedAt) || !file.importedAt) {
    patch.importedAt = Date.now();
  }
  if (file.importSource === undefined) {
    patch.importSource = "";
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function estimateDataUrlSize(path: string) {
  const match = /^data:[^,]*;base64,(.+)$/i.exec(path);
  if (!match) return undefined;
  const base64 = match[1] ?? "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function parseDataUrlWavBitDepth(path: string) {
  const match = /^data:[^,]*;base64,(.+)$/i.exec(path);
  if (!match) return undefined;
  try {
    const binary = window.atob((match[1] ?? "").slice(0, 384));
    if (binary.length < 44 || binary.slice(0, 4) !== "RIFF" || binary.slice(8, 12) !== "WAVE") return undefined;
    let offset = 12;
    while (offset + 24 <= binary.length) {
      const chunkId = binary.slice(offset, offset + 4);
      const chunkSize = readUint32Le(binary, offset + 4);
      if (chunkId === "fmt ") {
        const bits = readUint16Le(binary, offset + 22);
        return bits > 0 ? bits : undefined;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function readUint16Le(binary: string, offset: number) {
  return binary.charCodeAt(offset) | (binary.charCodeAt(offset + 1) << 8);
}

function readUint32Le(binary: string, offset: number) {
  return (
    binary.charCodeAt(offset)
    | (binary.charCodeAt(offset + 1) << 8)
    | (binary.charCodeAt(offset + 2) << 16)
    | (binary.charCodeAt(offset + 3) << 24)
  ) >>> 0;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function filterAudioFiles(files: AudioFile[], query: string, status: AudioStatusFilter) {
  const normalized = query.trim().toLowerCase();
  return files.filter((file) => {
    const reference = audioReferenceState(file);
    if (status !== "all" && reference.label.toLowerCase() !== status) return false;
    if (!normalized) return true;
    return [
      file.name,
      file.path,
      reference.label,
      reference.detail,
      formatImportSource(file),
      formatSource(file.path),
      formatExtension(file.name || file.path),
    ].some((value) => value.toLowerCase().includes(normalized));
  });
}

function sortAudioFiles(files: AudioFile[], key: SortKey, direction: SortDirection) {
  const factor = direction === "asc" ? 1 : -1;
  return [...files].sort((a, b) => {
    if (key === "name") return factor * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (key === "status") return factor * audioReferenceState(a).label.localeCompare(audioReferenceState(b).label, undefined, { sensitivity: "base" });
    if (key === "source") return factor * formatImportSource(a).localeCompare(formatImportSource(b), undefined, { sensitivity: "base" });
    if (key === "size") return factor * ((a.sizeBytes ?? -1) - (b.sizeBytes ?? -1));
    if (key === "length") return factor * ((a.durationSeconds ?? 0) - (b.durationSeconds ?? 0));
    return factor * ((a.importedAt ?? 0) - (b.importedAt ?? 0));
  });
}

function formatDuration(seconds = 0) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00:00";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatFileSize(bytes?: number) {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return "Unknown";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatImported(value?: number) {
  if (!Number.isFinite(value) || !value) return "Unknown";
  return new Date(value).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function playableAudioUrl(path: string) {
  if (/^(data:|blob:|https?:|file:)/.test(path)) return path;
  if (path.startsWith("/")) return `file://${path.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
  return path;
}

function getPreviewContext(): AudioContext {
  const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  return new Ctor();
}

async function loadAudioBuffer(ctx: AudioContext, cache: Map<string, AudioBuffer>, file: AudioFile) {
  const cached = cache.get(file.path);
  if (cached) return cached;
  const nativePath = nativeAudioFilePath(file.path);
  let url = playableAudioUrl(file.path);
  if (isNative() && nativePath) {
    const nativeResponse = await send({ kind: "audio.previewData", path: nativePath });
    if (!nativeResponse.audioDataUrl) throw new Error(nativeResponse.error ?? "Native audio preview data unavailable.");
    url = nativeResponse.audioDataUrl;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Audio preview request failed (${response.status}).`);
  const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
  cache.set(file.path, buffer);
  return buffer;
}

function nativeAudioFilePath(path: string): string | null {
  if (path.startsWith("/")) return path;
  if (!path.startsWith("file:")) return null;
  try {
    return decodeURIComponent(new URL(path).pathname);
  } catch {
    return null;
  }
}

function reverseAudioBuffer(ctx: AudioContext, source: AudioBuffer) {
  const copy = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const input = source.getChannelData(channel);
    const output = copy.getChannelData(channel);
    for (let i = 0, j = input.length - 1; i < input.length; i += 1, j -= 1) output[i] = input[j];
  }
  return copy;
}

function analyzeAudioBuffer(buffer: AudioBuffer, bucketCount: number): WaveformAnalysis {
  const leftUpper: number[] = [];
  const leftLower: number[] = [];
  const rightUpper: number[] = [];
  const rightLower: number[] = [];
  const bucketSize = Math.max(1, Math.floor(buffer.length / bucketCount));
  const leftData = buffer.getChannelData(0);
  const rightData = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : leftData;
  let leftPeakMax = 0;
  let rightPeakMax = 0;

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = bucket * bucketSize;
    const end = Math.min(buffer.length, start + bucketSize);
    let leftMax = 0;
    let leftMin = 0;
    let rightMax = 0;
    let rightMin = 0;
    for (let i = start; i < end; i += 1) {
      const leftValue = leftData[i] ?? 0;
      const rightValue = rightData[i] ?? 0;
      if (leftValue > leftMax) leftMax = leftValue;
      if (leftValue < leftMin) leftMin = leftValue;
      if (rightValue > rightMax) rightMax = rightValue;
      if (rightValue < rightMin) rightMin = rightValue;
    }
    const leftAbsPeak = Math.max(Math.abs(leftMax), Math.abs(leftMin));
    const rightAbsPeak = Math.max(Math.abs(rightMax), Math.abs(rightMin));
    leftUpper.push(Math.max(0, leftMax));
    leftLower.push(Math.abs(Math.min(0, leftMin)));
    rightUpper.push(Math.max(0, rightMax));
    rightLower.push(Math.abs(Math.min(0, rightMin)));
    if (leftAbsPeak > leftPeakMax) leftPeakMax = leftAbsPeak;
    if (rightAbsPeak > rightPeakMax) rightPeakMax = rightAbsPeak;
  }

  const globalPeak = Math.max(leftPeakMax, rightPeakMax);
  const producerStats = calculateProducerStats(buffer, globalPeak);
  return {
    left: {
      upper: normalizePeaks(leftUpper, globalPeak),
      lower: normalizePeaks(leftLower, globalPeak),
    },
    right: {
      upper: normalizePeaks(rightUpper, globalPeak),
      lower: normalizePeaks(rightLower, globalPeak),
    },
    leftDb: amplitudeToDb(leftPeakMax),
    rightDb: amplitudeToDb(rightPeakMax),
    integratedLufs: calculateIntegratedLufs(buffer),
    ...producerStats,
  };
}

function nativeWaveformAnalysis(file: AudioFile, waveform: AudioWaveformSummary): WaveformAnalysis {
  const leftPeak = waveformChannelPeak(waveform.left);
  const rightPeak = waveformChannelPeak(waveform.right);
  const globalPeak = Math.max(leftPeak, rightPeak);
  return {
    left: normalizeWaveformChannel(waveform.left, globalPeak),
    right: normalizeWaveformChannel(waveform.right, globalPeak),
    leftDb: finiteOrFallback(file.leftPeakDbFS, amplitudeToDb(leftPeak)),
    rightDb: finiteOrFallback(file.rightPeakDbFS, amplitudeToDb(rightPeak)),
    integratedLufs: file.integratedLufs ?? Number.NEGATIVE_INFINITY,
    rmsDb: file.rmsDbFS ?? Number.NEGATIVE_INFINITY,
    truePeakDb: file.truePeakDbTP ?? Number.NEGATIVE_INFINITY,
    crestDb: file.crestFactorDb ?? Number.NEGATIVE_INFINITY,
    dcOffset: file.dcOffset ?? 0,
    clippingCount: file.clippingCount ?? 0,
    clippingRatio: file.clippingRatio ?? 0,
    stereoCorrelation: file.stereoCorrelation ?? Number.NaN,
  };
}

function waveformChannelPeak(channel: WaveformChannelAnalysis) {
  return Math.max(0, ...channel.upper, ...channel.lower);
}

function finiteOrFallback(value: number | undefined, fallback: number) {
  return value != null && Number.isFinite(value) ? value : fallback;
}

function normalizeWaveformChannel(channel: WaveformChannelAnalysis, globalPeak: number): WaveformChannelAnalysis {
  return {
    upper: normalizePeaks(channel.upper, globalPeak),
    lower: normalizePeaks(channel.lower, globalPeak),
  };
}

function emptyWaveformAnalysis(): WaveformAnalysis {
  return {
    left: { upper: [], lower: [] },
    right: { upper: [], lower: [] },
    leftDb: Number.NEGATIVE_INFINITY,
    rightDb: Number.NEGATIVE_INFINITY,
    integratedLufs: Number.NEGATIVE_INFINITY,
    rmsDb: Number.NEGATIVE_INFINITY,
    truePeakDb: Number.NEGATIVE_INFINITY,
    crestDb: Number.NEGATIVE_INFINITY,
    dcOffset: 0,
    clippingCount: 0,
    clippingRatio: 0,
    stereoCorrelation: Number.NaN,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function normalizePeaks(peaks: number[], globalPeak: number) {
  if (globalPeak <= 0) return peaks.map(() => 0);
  return peaks.map((peak) => Math.min(1, peak / globalPeak));
}

function amplitudeToDb(amplitude: number) {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return Number.NEGATIVE_INFINITY;
  return Math.max(-120, 20 * Math.log10(Math.min(1, amplitude)));
}

function formatDb(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-inf dBFS";
  if (value <= -120) return "-inf dBFS";
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded.toFixed(1)} dBFS`;
}

function calculateProducerStats(buffer: AudioBuffer, samplePeak: number) {
  const channelCount = Math.min(buffer.numberOfChannels, 2);
  const channels = Array.from({ length: channelCount }, (_, index) => buffer.getChannelData(index));
  if (channels.length === 0 || buffer.length === 0) {
    return {
      rmsDb: Number.NEGATIVE_INFINITY,
      truePeakDb: Number.NEGATIVE_INFINITY,
      crestDb: Number.NEGATIVE_INFINITY,
      dcOffset: 0,
      clippingCount: 0,
      clippingRatio: 0,
      stereoCorrelation: Number.NaN,
    };
  }

  let sumSquares = 0;
  let sum = 0;
  let clippingCount = 0;
  const sampleCount = buffer.length * channels.length;

  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      const value = channel[i] ?? 0;
      sumSquares += value * value;
      sum += value;
      if (Math.abs(value) >= 0.999) clippingCount += 1;
    }
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, sampleCount));
  const samplePeakDb = amplitudeToDbUnbounded(samplePeak);
  const rmsDb = amplitudeToDbUnbounded(rms);
  const truePeakDb = amplitudeToDbUnbounded(estimateTruePeak(channels));
  return {
    rmsDb,
    truePeakDb,
    crestDb: Number.isFinite(samplePeakDb) && Number.isFinite(rmsDb) ? samplePeakDb - rmsDb : Number.NEGATIVE_INFINITY,
    dcOffset: Math.abs(sum / Math.max(1, sampleCount)),
    clippingCount,
    clippingRatio: clippingCount / Math.max(1, sampleCount),
    stereoCorrelation: calculateStereoCorrelation(buffer),
  };
}

function amplitudeToDbUnbounded(amplitude: number) {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return Number.NEGATIVE_INFINITY;
  return Math.max(-120, 20 * Math.log10(amplitude));
}

function estimateTruePeak(channels: Float32Array[]) {
  let truePeak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      const peak = Math.abs(channel[i] ?? 0);
      if (peak > truePeak) truePeak = peak;
    }
    for (let i = 0; i < channel.length - 1; i += 1) {
      const y0 = channel[Math.max(0, i - 1)] ?? 0;
      const y1 = channel[i] ?? 0;
      const y2 = channel[i + 1] ?? 0;
      const y3 = channel[Math.min(channel.length - 1, i + 2)] ?? 0;
      for (let step = 1; step < 4; step += 1) {
        const interpolated = catmullRom(y0, y1, y2, y3, step / 4);
        const peak = Math.abs(interpolated);
        if (peak > truePeak) truePeak = peak;
      }
    }
  }
  return truePeak;
}

function catmullRom(y0: number, y1: number, y2: number, y3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * y1)
    + (-y0 + y2) * t
    + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2
    + (-y0 + 3 * y1 - 3 * y2 + y3) * t3
  );
}

function calculateStereoCorrelation(buffer: AudioBuffer) {
  if (buffer.numberOfChannels < 2 || buffer.length === 0) return Number.NaN;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let sumLeftRight = 0;
  let sumLeftSquare = 0;
  let sumRightSquare = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const leftValue = left[i] ?? 0;
    const rightValue = right[i] ?? 0;
    sumLeftRight += leftValue * rightValue;
    sumLeftSquare += leftValue * leftValue;
    sumRightSquare += rightValue * rightValue;
  }
  const denominator = Math.sqrt(sumLeftSquare * sumRightSquare);
  if (denominator <= 0) return Number.NaN;
  return Math.max(-1, Math.min(1, sumLeftRight / denominator));
}

function calculateIntegratedLufs(buffer: AudioBuffer) {
  const sampleRate = buffer.sampleRate;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || buffer.length === 0) return Number.NEGATIVE_INFINITY;

  const shelf = biquadCoefficients("highshelf", sampleRate, 1681.9744509555319, 0.7071752369554196, 3.999843853973347);
  const highpass = biquadCoefficients("highpass", sampleRate, 38.13547087602444, 0.5003270373238773);
  const channelCount = Math.min(buffer.numberOfChannels, 2);
  const weightedChannels: Float32Array[] = [];

  for (let channel = 0; channel < channelCount; channel += 1) {
    weightedChannels.push(applyBiquad(applyBiquad(buffer.getChannelData(channel), shelf), highpass));
  }
  if (weightedChannels.length === 0) return Number.NEGATIVE_INFINITY;

  const blockSize = Math.max(1, Math.round(sampleRate * 0.4));
  const hopSize = Math.max(1, Math.round(sampleRate * 0.1));
  if (buffer.length < blockSize) return loudnessFromMeanSquare(blockMeanSquare(weightedChannels, 0, buffer.length));

  const blockPowers: number[] = [];
  for (let start = 0; start + blockSize <= buffer.length; start += hopSize) {
    const meanSquare = blockMeanSquare(weightedChannels, start, start + blockSize);
    if (loudnessFromMeanSquare(meanSquare) >= -70) blockPowers.push(meanSquare);
  }
  if (blockPowers.length === 0) return Number.NEGATIVE_INFINITY;

  const ungatedMean = average(blockPowers);
  const relativeGate = loudnessFromMeanSquare(ungatedMean) - 10;
  const gatedPowers = blockPowers.filter((power) => loudnessFromMeanSquare(power) >= relativeGate);
  if (gatedPowers.length === 0) return Number.NEGATIVE_INFINITY;
  return loudnessFromMeanSquare(average(gatedPowers));
}

type BiquadCoefficients = { b0: number; b1: number; b2: number; a1: number; a2: number };

function biquadCoefficients(
  type: "highpass" | "highshelf",
  sampleRate: number,
  frequency: number,
  q: number,
  gainDb = 0,
): BiquadCoefficients {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);

  if (type === "highpass") {
    const alpha = sin / (2 * q);
    const a0 = 1 + alpha;
    return {
      b0: ((1 + cos) / 2) / a0,
      b1: (-(1 + cos)) / a0,
      b2: ((1 + cos) / 2) / a0,
      a1: (-2 * cos) / a0,
      a2: (1 - alpha) / a0,
    };
  }

  const a = 10 ** (gainDb / 40);
  const alpha = sin / (2 * q);
  const sqrtA = Math.sqrt(a);
  const a0 = (a + 1) - (a - 1) * cos + 2 * sqrtA * alpha;
  return {
    b0: (a * ((a + 1) + (a - 1) * cos + 2 * sqrtA * alpha)) / a0,
    b1: (-2 * a * ((a - 1) + (a + 1) * cos)) / a0,
    b2: (a * ((a + 1) + (a - 1) * cos - 2 * sqrtA * alpha)) / a0,
    a1: (2 * ((a - 1) - (a + 1) * cos)) / a0,
    a2: ((a + 1) - (a - 1) * cos - 2 * sqrtA * alpha) / a0,
  };
}

function applyBiquad(input: Float32Array, coeffs: BiquadCoefficients) {
  const output = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x0 = input[i] ?? 0;
    const y0 = coeffs.b0 * x0 + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2;
    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

function blockMeanSquare(channels: Float32Array[], start: number, end: number) {
  const safeEnd = Math.max(start + 1, end);
  let sum = 0;
  for (const channel of channels) {
    for (let i = start; i < safeEnd; i += 1) {
      const value = channel[i] ?? 0;
      sum += value * value;
    }
  }
  return sum / Math.max(1, safeEnd - start);
}

function loudnessFromMeanSquare(meanSquare: number) {
  if (!Number.isFinite(meanSquare) || meanSquare <= 0) return Number.NEGATIVE_INFINITY;
  return -0.691 + 10 * Math.log10(meanSquare);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function formatLufs(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-inf LUFS";
  return `${value.toFixed(1)} LUFS`;
}

function formatTruePeak(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-inf dBTP";
  if (value <= -120) return "-inf dBTP";
  return `${value.toFixed(1)} dBTP`;
}

function formatDbDelta(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  return `${value.toFixed(1)} dB`;
}

function formatPercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  return `${(value * 100).toFixed(value < 0.001 ? 3 : 2)}%`;
}

function formatClipCount(count?: number, ratio?: number) {
  if (typeof count !== "number" || !Number.isFinite(count)) return "–";
  if (count <= 0) return "0";
  return `${count.toLocaleString()} (${formatPercent(ratio)})`;
}

function formatCorrelation(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Mono / unknown";
  return value.toFixed(2);
}

type AudioReferenceTone = "neutral" | "warning" | "danger";

function audioReferenceState(file: AudioFile): {
  label: string;
  detail: string;
  title: string;
  body: string;
  icon: string;
  tone: AudioReferenceTone;
  className: string;
} {
  const path = file.path?.trim() ?? "";
  if (!path) {
    return {
      label: "Missing",
      detail: "Missing reference path",
      title: "Missing Audio Reference",
      body: "This library entry does not have a file path to reveal or preview.",
      icon: "ph:warning-diamond",
      tone: "danger",
      className: "referenceDanger",
    };
  }
  if (path.startsWith("data:")) {
    return {
      label: "Library",
      detail: "Beat library audio",
      title: "Library Audio",
      body: "This audio is stored in Beat's library data.",
      icon: "ph:database",
      tone: "neutral",
      className: "referenceManaged",
    };
  }
  if (/^https?:/i.test(path)) {
    return {
      label: "Remote",
      detail: "Remote URL reference",
      title: "Remote Audio Reference",
      body: "Preview depends on the referenced URL remaining reachable.",
      icon: "ph:link",
      tone: "warning",
      className: "referenceWarning",
    };
  }
  if (path.includes("/Beat/Audio Files/")) {
    return {
      label: "Library",
      detail: "Beat audio library file",
      title: "Library Audio File",
      body: "Beat owns this library copy.",
      icon: "ph:folder-simple",
      tone: "neutral",
      className: "referenceManaged",
    };
  }
  if (path.startsWith("/")) {
    return {
      label: "Library",
      detail: "Beat audio library file",
      title: "Library Audio File",
      body: "Beat owns this imported audio entry.",
      icon: "ph:folder-simple",
      tone: "neutral",
      className: "referenceManaged",
    };
  }
  return {
    label: "Asset",
    detail: "Library asset reference",
    title: "Audio Asset",
    body: "This entry uses a non-file library reference.",
    icon: "ph:file-audio",
    tone: "neutral",
    className: "referenceManaged",
  };
}

function canRevealAudioReference(file: AudioFile) {
  const path = file.path?.trim() ?? "";
  return isNative() && Boolean(path) && !/^(data:|blob:|https?:)/i.test(path);
}

function copyableAudioReference(file: AudioFile) {
  const path = file.path?.trim() ?? "";
  if (!path) return "";
  return path.startsWith("data:") ? file.name : path;
}

function formatSource(path: string) {
  if (path.startsWith("data:")) return "Browser import";
  if (path.includes("/Beat/Audio Files/")) return "Beat audio library";
  if (path.startsWith("/")) return "Beat audio library";
  return "Audio asset";
}

function formatImportSource(file: AudioFile) {
  const source = file.importSource?.trim();
  return source || "Unassigned";
}

function formatPlaybackResolution(file: AudioFile) {
  const sampleRate = file.sampleRate ? `${Math.round(file.sampleRate).toLocaleString()} Hz` : "Unknown Hz";
  const bitDepth = file.bitDepth && file.bitDepth > 0 ? `${file.bitDepth}-bit` : "bit depth unknown";
  return `${sampleRate} / ${bitDepth}`;
}

function formatUsage(fileId: string, tracks: Track[]) {
  const count = tracks.reduce((sum, track) => (
    sum
    + (track.audioFileId === fileId ? 1 : 0)
    + track.segments.filter((segment) => (
      (segment.payload.kind === "audio" || segment.payload.kind === "mixed") && segment.payload.audioFileId === fileId
    )).length
  ), 0);
  return count > 0 ? `${count} project reference${count === 1 ? "" : "s"}` : "No open project";
}

function selectedReferencedAudioFiles(files: AudioFile[], selectedIds: Set<string>, tracks: Track[], instruments: Instrument[]) {
  return files.filter((file) => selectedIds.has(file.id) && (
    audioFileIdUsedByProject(file.id, tracks)
    || audioFileIdUsedByInstrument(file.id, instruments)
  ));
}

function audioFileIdUsedByProject(fileId: string, tracks: Track[]) {
  return tracks.some((track) => (
    track.audioFileId === fileId
    || track.segments.some((segment) => (
      (segment.payload.kind === "audio" || segment.payload.kind === "mixed")
      && segment.payload.audioFileId === fileId
    ))
  ));
}

function audioFileIdUsedByInstrument(fileId: string, instruments: Instrument[]) {
  return instruments.some((instrument) => instrument.sampleIds.includes(fileId));
}

function formatInstrumentUsage(file: AudioFile, instruments: Instrument[]) {
  const names = instruments.filter((instrument) => (
    instrument.sampleIds.includes(file.id)
    || instrument.sampleUrl === file.path
    || instrument.sampleUrls?.includes(file.path)
    || instrument.sampleMap?.some((zone) => zone.path === file.path)
  )).map((instrument) => instrument.name);
  if (names.length === 0) return "Not used";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function formatExtension(name: string) {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toUpperCase() : "Unknown";
}
