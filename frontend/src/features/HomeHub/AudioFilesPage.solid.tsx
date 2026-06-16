/** @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import { appAlert, appConfirm, appPrompt } from "../../components";
import { ActionFooter, Button, HoverInfo, Icon, MarqueeText } from "../../solid-ui";
import { importAudioFiles } from "../../audio/audioImport";
import { isNative, send } from "../../ipc/bridge";
import type { AudioWaveformSummary } from "../../ipc/schema";
import { useAudioFileStore, useInstrumentStore, useProjectStore } from "../../state/store";
import type { AudioFile, Instrument } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { AssetPageShellSolid, AssetStateMessageSolid } from "./AssetPageShell.solid";
import styles from "./AudioFilesPage.module.css";

type SortKey = "name" | "size" | "length" | "imported";
type SortDirection = "asc" | "desc";
type PreviewDirection = "forward" | "reverse";
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

export function AudioFilesPageSolid() {
  const files = createStoreSelector(useAudioFileStore, (s) => s.files);
  const addFile = useAudioFileStore.getState().addFile;
  const removeFile = useAudioFileStore.getState().removeFile;
  const updateFile = useAudioFileStore.getState().updateFile;
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const tracks = createStoreSelector(useProjectStore, (s) => s.project.tracks);
  const [selectMode, setSelectMode] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set(), { equals: false });
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [sort, setSort] = createSignal<{ key: SortKey; direction: SortDirection }>({ key: "name", direction: "asc" }, { equals: false });
  const [playingId, setPlayingId] = createSignal<string | null>(null);
  const [previewSpeed, setPreviewSpeed] = createSignal<1 | 2 | 3>(1);
  const [loopPreview, setLoopPreview] = createSignal(false);
  const [waveformAnalysis, setWaveformAnalysis] = createSignal<WaveformAnalysis | null>(null, { equals: false });
  const [previewProgress, setPreviewProgress] = createSignal(0);
  const [previewDirection, setPreviewDirection] = createSignal<PreviewDirection>("forward");
  const [scrubbing, setScrubbing] = createSignal(false);
  let previewRef: { ctx: AudioContext; source: AudioBufferSourceNode } | null = null;
  let progressFrame: number | null = null;
  let playbackBarRef: HTMLDivElement | undefined;
  const progressRef: { current: { startTime: number; duration: number; direction: PreviewDirection; loop: boolean } } = { current: {
    startTime: 0,
    duration: 1,
    direction: "forward",
    loop: false,
  } };
  const bufferCache = new Map<string, AudioBuffer>();

  const sortedFiles = createMemo(() => sortAudioFiles(files(), sort().key, sort().direction));
  const activeFile = createMemo(() => files().find((file) => file.id === activeId()) ?? files()[0] ?? null);
  const activeReference = createMemo(() => activeFile() ? audioReferenceState(activeFile()!) : null);
  const selectedCount = createMemo(() => selectedIds().size);
  const multipleSelected = createMemo(() => selectMode() && selectedCount() > 1);
  const previewFile = createMemo(() => multipleSelected() ? null : activeFile());

  createEffect(() => {
    const currentFiles = files();
    setSelectedIds((current) => new Set([...current].filter((id) => currentFiles.some((file) => file.id === id))));
    if (activeId() && !currentFiles.some((file) => file.id === activeId())) setActiveId(null);
  });

  onCleanup(() => stopPreview());

  createEffect(() => {
    for (const file of files()) {
      const patch = legacyAudioMetadataPatch(file);
      if (patch) updateFile(file.id, patch);
    }
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
    if (!currentPreviewFile) return;

    const loadBrowserAnalysis = () => {
      const ctx = getPreviewContext();
      return loadAudioBuffer(ctx, bufferCache, currentPreviewFile)
        .then((buffer) => {
          if (!cancelled) setWaveformAnalysis(analyzeAudioBuffer(buffer, 128));
        })
        .finally(() => {
          if (!previewRef || previewRef.ctx !== ctx) {
            void ctx.close().catch(() => undefined);
          }
        });
    };

    const loadNativeAnalysis = async () => {
      const response = await send({ kind: "audio.waveform", path: currentPreviewFile.path, bucketCount: 128 });
      if (!response.waveform) throw new Error(response.error ?? "Waveform unavailable.");
      if (!cancelled) setWaveformAnalysis(nativeWaveformAnalysis(currentPreviewFile, response.waveform));
    };

    void (isNative() && currentPreviewFile.path && !currentPreviewFile.path.startsWith("data:")
      ? loadNativeAnalysis().catch(() => loadBrowserAnalysis())
      : loadBrowserAnalysis())
      .then((buffer) => {
        void buffer;
      })
      .catch(() => {
        if (!cancelled) {
          setWaveformAnalysis({
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
          });
        }
      })

    onCleanup(() => {
      cancelled = true;
    });
  });

  async function onImport() {
    const imported = await importAudioFiles();
    for (const file of imported) addFile(normalizeImportedAudioFile(file));
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

  async function deleteSelected() {
    if (selectedIds().size === 0) return;
    if (!await appConfirm(`Delete ${selectedIds().size} audio file${selectedIds().size === 1 ? "" : "s"} from the Beat library?`)) return;
    stopPreview();
    const response = await send({ kind: "audio.delete", ids: [...selectedIds()], deleteFiles: true });
    response.deletedIds.forEach((id) => removeFile(id));
    if (response.failedIds.length > 0) {
      await appAlert(response.error ?? "Some audio files could not be deleted.");
    }
    setSelectedIds(new Set<string>());
    setSelectMode(false);
  }

  function stopPreview(resetProgress = true) {
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
    setPreviewDirection(direction);
    setPreviewProgress(initialProgress);
    setPlayingId(file.id);
    try {
      const ctx = getPreviewContext();
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createBufferSource();
      const sourceBuffer = await loadAudioBuffer(ctx, bufferCache, file);
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
      // eslint-disable-next-line no-console
      console.error("[Beat audio preview] Failed to preview audio file", { file, direction, error });
      setPlayingId(null);
      stopProgress();
      await appAlert("This audio file could not be previewed from the current page.");
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
    <AssetPageShellSolid
      variant="wide-browser"
      browserLabel="Audio file browser"
      previewLabel="Audio playback"
      previewClassName={styles.preview}
      browser={
        <>
        <div class={styles.actions}>
          <Show when={selectMode()}>
            <span class={styles.selectionCount}>{selectedCount()} selected</span>
          </Show>
          <Button variant={selectMode() ? "primary" : "default"} onClick={toggleSelectMode}>
            {selectMode() ? "Done" : "Select"}
          </Button>
          <Button onClick={() => void onImport()}>
            <Icon name="ph:plus" size={14} decorative />
            Import Audio
          </Button>
          <HoverInfo content="Delete selected audio files">
            <Button variant="danger" disabled={selectedCount() === 0} onClick={deleteSelected} aria-label="Delete selected audio files">
              <Icon name="ph:trash" size={14} decorative />
              Delete
            </Button>
          </HoverInfo>
        </div>

        <div class={`${styles.table} ${selectMode() ? styles.tableSelectMode : ""}`} role="table" aria-label="Audio files">
          <div class={styles.headerRow} role="row">
            <Show when={selectMode()}>
              <span class={styles.checkHeader} />
            </Show>
            <SortHeader label="Name" sortKey="name" current={sort()} onSort={toggleSort} />
            <span class={styles.staticHeader}>Status</span>
            <SortHeader label="Length" sortKey="length" current={sort()} onSort={toggleSort} />
            <SortHeader label="Size" sortKey="size" current={sort()} onSort={toggleSort} />
            <SortHeader label="Imported" sortKey="imported" current={sort()} onSort={toggleSort} />
          </div>

          <div class={styles.rows}>
            <Show
              when={sortedFiles().length > 0}
              fallback={
                <div class={styles.emptyRow}>
                <AssetStateMessageSolid
                  icon="ph:waveform"
                  title="No Audio Files"
                  body="Import audio to build the project library."
                >
                  <Button size="sm" onClick={() => void onImport()}>
                    <Icon name="ph:plus" size={14} decorative />
                    Import Audio
                  </Button>
                </AssetStateMessageSolid>
              </div>
              }
            >
            <For each={sortedFiles()}>
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
                          <Icon name="ph:check" size={12} decorative />
                        </Show>
                      </span>
                    </span>
                  </Show>
                  <MarqueeText className={styles.nameCell} text={file.name} />
                  <span class={`${styles.referenceChip} ${styles[reference.className]}`}>{reference.label}</span>
                  <span>{formatDuration(file.durationSeconds)}</span>
                  <span>{formatFileSize(file.sizeBytes)}</span>
                  <span>{formatImported(file.importedAt)}</span>
                </div>
              );
            }}
            </For>
            </Show>
          </div>
        </div>
        </>
      }
      preview={
        <>
        <Show
          when={!multipleSelected()}
          fallback={
          <div class={styles.previewBody}>
            <AssetStateMessageSolid
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
              <Button iconOnly disabled aria-label="Play from start"><Icon name="ph:skip-back" size={14} decorative /></Button>
              <Button iconOnly disabled aria-label="Play or pause"><Icon name="ph:play-fill" size={14} decorative /></Button>
              <Button iconOnly disabled aria-hidden="true">-</Button>
              <Button iconOnly disabled aria-label="Play backwards"><Icon name="ph:rewind-fill" size={14} decorative /></Button>
              <Button iconOnly disabled aria-label="Loop preview"><Icon name="ph:repeat" size={14} decorative /></Button>
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
              <Button size="sm" disabled>
                <Icon name="ph:folder-open" size={14} decorative />
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
              <AssetStateMessageSolid
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
              <AssetStateMessageSolid
                icon={activeReference()!.icon}
                title={activeReference()!.title}
                body={activeReference()!.body}
                tone={activeReference()!.tone}
              />
            </Show>
            <div class={styles.waveformStage}>
              <div class={styles.waveformLine} />
              <ScopeOverlay analysis={waveformAnalysis()} />
              <WaveformPreview analysis={waveformAnalysis()} />
              <div class={styles.playhead} style={{ left: `${previewProgress() * 100}%` }} />
              <Show when={!waveformAnalysis()}>
                <div class={styles.waveformStatus}>Loading Waveform</div>
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
                <Button iconOnly onClick={() => void playPreview(file(), "forward", { restart: true, progress: 0 })} aria-label="Play from start">
                  <Icon name="ph:skip-back" size={14} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Play / pause">
                <Button iconOnly selected={playingId() === file().id} onClick={() => void playPreview(file(), "forward", { progress: previewProgress() >= 1 ? 0 : previewProgress() })} aria-label="Play or pause">
                  <Icon name={playingId() === file().id ? "ph:pause-fill" : "ph:play-fill"} size={14} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Playback speed">
                <Button iconOnly onClick={cycleSpeed} aria-label={`Playback speed ${previewSpeed()}x`}>{previewSpeed()}x</Button>
              </HoverInfo>
              <HoverInfo content="Play backwards">
                <Button iconOnly selected={playingId() === file().id && previewDirection() === "reverse"} onClick={toggleReversePlayback} aria-label="Play backwards">
                  <Icon name="ph:rewind-fill" size={14} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Loop preview">
                <Button iconOnly selected={loopPreview()} onClick={toggleLoop} aria-label="Loop preview">
                  <Icon name="ph:repeat" size={14} decorative />
                </Button>
              </HoverInfo>
            </div>
            <dl class={styles.details}>
              <Info label="Source" value={formatSource(file().path)} />
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
                <Button size="sm" disabled={!canRevealAudioReference(file())} onClick={() => void viewInFolder(file())}>
                  <Icon name="ph:folder-open" size={14} decorative />
                  Reveal File
                </Button>
              </HoverInfo>
              <HoverInfo content="Copy the library reference">
                <Button size="sm" disabled={!copyableAudioReference(file())} onClick={() => void copyReference(file())}>
                  <Icon name="ph:copy" size={14} decorative />
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

function WaveformPreview({ analysis }: { analysis: WaveformAnalysis | null }) {
  if (!analysis) return <div class={styles.waveformLoading} />;
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
    <button type="button" class={`${styles.sortHeader} ${active ? styles.sortHeaderActive : ""}`} onClick={() => onSort(sortKey)}>
      <span>{label}</span>
      {active && <Icon name={current.direction === "asc" ? "ph:caret-up" : "ph:caret-down"} size={12} decorative />}
    </button>
  );
}

function normalizeImportedAudioFile(file: AudioFile): AudioFile {
  return {
    ...file,
    importedAt: file.importedAt ?? Date.now(),
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

function sortAudioFiles(files: AudioFile[], key: SortKey, direction: SortDirection) {
  const factor = direction === "asc" ? 1 : -1;
  return [...files].sort((a, b) => {
    if (key === "name") return factor * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
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
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
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
  const response = await fetch(playableAudioUrl(file.path));
  const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
  cache.set(file.path, buffer);
  return buffer;
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
  return {
    left: waveform.left,
    right: waveform.right,
    leftDb: file.leftPeakDbFS ?? Number.NEGATIVE_INFINITY,
    rightDb: file.rightPeakDbFS ?? Number.NEGATIVE_INFINITY,
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
      label: "Embedded",
      detail: "Embedded browser import",
      title: "Embedded Audio",
      body: "This file is stored inside the project library data instead of a revealable disk path.",
      icon: "ph:database",
      tone: "warning",
      className: "referenceWarning",
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
      label: "Managed",
      detail: "Beat audio library file",
      title: "Managed Audio File",
      body: "Beat owns this library copy.",
      icon: "ph:folder-simple",
      tone: "neutral",
      className: "referenceManaged",
    };
  }
  if (path.startsWith("/")) {
    return {
      label: "External",
      detail: "External file reference",
      title: "External Audio Reference",
      body: "This entry points outside the Beat library. Keep the source file in place.",
      icon: "ph:warning",
      tone: "warning",
      className: "referenceWarning",
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
  if (path.startsWith("/")) return "External file";
  return "Audio asset";
}

function formatPlaybackResolution(file: AudioFile) {
  const sampleRate = file.sampleRate ? `${Math.round(file.sampleRate).toLocaleString()} Hz` : "Unknown Hz";
  const bitDepth = file.bitDepth && file.bitDepth > 0 ? `${file.bitDepth}-bit` : "bit depth unknown";
  return `${sampleRate} / ${bitDepth}`;
}

function formatUsage(fileId: string, tracks: ReturnType<typeof useProjectStore.getState>["project"]["tracks"]) {
  const count = tracks.reduce((sum, track) => (
    sum + track.segments.filter((segment) => (
      (segment.payload.kind === "audio" || segment.payload.kind === "mixed") && segment.payload.audioFileId === fileId
    )).length
  ), 0);
  return count > 0 ? `${count} segment${count === 1 ? "" : "s"}` : "No open project";
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

export interface MountedAudioFilesPageSolid {
  dispose: () => void;
}

export function mountAudioFilesPageSolid(host: HTMLElement): MountedAudioFilesPageSolid {
  const dispose = render(() => <AudioFilesPageSolid />, host);
  return { dispose };
}
