import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { ActionFooter, appConfirm, Button, FloatingSelect, HoverInfo, Icon, MarqueeText } from "../../solid-ui";
import {
  cachedInstrumentSampleBuffer,
  createInstrumentSampleBufferSource,
  createInstrumentBufferSource,
  instrumentSampleUrls,
  preloadInstrumentSample,
  preloadInstrumentSampleUrl,
  previewFrequency,
  renderedInstrumentBuffer,
} from "../../audio/synthPreview";
import { isNative, send } from "../../ipc/bridge";
import type { AudioRenderAnalysis, AudioWaveformSummary } from "../../ipc/schema";
import { listProjects } from "../../persistence/dexie";
import {
  firstInstrumentTaxonomyIdForCategory,
  INSTRUMENT_TAXONOMY_CATEGORY_OPTIONS,
  instrumentTaxonomyOptionsForCategory,
  taxonomyAssignmentForInstrumentId,
} from "../../state/instrumentTaxonomy";
import { TEMPORARY_DS_INSTRUMENT_SET_ID, useInstrumentStore, useProjectStore } from "../../state/store";
import type { Instrument, InstrumentSet, Project } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { AssetPageShell, AssetStateMessage } from "./AssetPageShell.solid";
import styles from "./InstrumentsPage.module.css";

const PREVIEW_SECONDS = 2.0;
type SampleGrouping = "length" | "volume" | "hit" | "pitch" | "single";
type SampleVariable = Exclude<SampleGrouping, "single">;

const SAMPLE_VARIABLE_OPTIONS: Array<{ mode: SampleVariable; label: string }> = [
  { mode: "length", label: "Length" },
  { mode: "volume", label: "Volume" },
  { mode: "hit", label: "Hit" },
  { mode: "pitch", label: "Pitch" },
];
const CATEGORY_OPTIONS = [
  { value: "", label: "Unassigned" },
  ...INSTRUMENT_TAXONOMY_CATEGORY_OPTIONS,
];

type RefValue<T> = { current: T };
type PlaybackPointerEvent = PointerEvent & { currentTarget: HTMLDivElement };
type InstrumentUsageSummary = {
  projectCount: number;
  segmentCount: number;
  trackCount: number;
  projectLabel: string;
  segmentLabel: string;
};
type InstrumentRenderState = {
    waveform: AudioWaveformSummary | null;
    analysis: AudioRenderAnalysis | null;
    audioDataUrl?: string;
    loading: boolean;
    error?: string;
};

export function InstrumentsPage() {
  const instruments = createStoreSelector(useInstrumentStore, (state) => state.instruments);
  const sets = createStoreSelector(useInstrumentStore, (state) => state.instrumentSets);
  const loading = createStoreSelector(useInstrumentStore, (state) => state.loading);
  const project = createStoreSelector(useProjectStore, (state) => state.project);
  const projectBpm = createStoreSelector(useProjectStore, (state) => state.project.bpm);
  const updateInstrument = useInstrumentStore.getState().updateInstrument;
  const removeInstrument = useInstrumentStore.getState().removeInstrument;
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [playingId, setPlayingId] = createSignal<string | null>(null);
  const [loopPreview, setLoopPreview] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [taxonomyCategoryOpen, setTaxonomyCategoryOpen] = createSignal(false);
  const [taxonomyInstrumentOpen, setTaxonomyInstrumentOpen] = createSignal(false);
  const [samplePreviewIndex, setSamplePreviewIndex] = createSignal<Record<string, number>>({}, { equals: false });
  const [usageByInstrument, setUsageByInstrument] = createSignal<Record<string, InstrumentUsageSummary>>({}, { equals: false });
  const [previewProgress, setPreviewProgress] = createSignal(0);
  const [scrubbing, setScrubbing] = createSignal(false);
  const [renderState, setRenderState] = createSignal<InstrumentRenderState>({ waveform: null, analysis: null, loading: false }, { equals: false });
  const previewRef: RefValue<{ source: AudioBufferSourceNode; gain: GainNode } | null> = { current: null };
  const previewContextRef: RefValue<AudioContext | null> = { current: null };
  const nativePreviewBufferRef: RefValue<Map<string, AudioBuffer>> = { current: new Map() };
  const sampleCursorRef: RefValue<Map<string, number>> = { current: new Map() };
  const progressFrameRef: RefValue<number | null> = { current: null };
  let playbackBarRef: HTMLDivElement | undefined;
  const progressRef: RefValue<{ startTime: number; duration: number; loop: boolean }> = { current: {
    startTime: 0,
    duration: PREVIEW_SECONDS,
    loop: false,
  } };
  const requestRef: RefValue<number> = { current: 0 };

  const visibleInstruments = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    if (!query) return instruments();
    return instruments().filter((instrument) => instrument.name.toLowerCase().includes(query));
  });
  const activeInstrument = createMemo(() => visibleInstruments().find((instrument) => instrument.id === activeId()) ?? visibleInstruments()[0] ?? null);
  const activeSampleUrls = createMemo(() => activeInstrument() ? instrumentSampleUrls(activeInstrument()!) : []);
  const activeReference = createMemo(() => activeInstrument() ? instrumentReferenceState(activeInstrument()!) : null);
  const activeUsage = createMemo(() => activeInstrument() ? usageByInstrument()[activeInstrument()!.id] ?? instrumentUsageSummary(activeInstrument()!.id, [project()]) : null);
  const activeSampleUrl = createMemo(() => activeInstrument() && !isSustainedPreview(activeInstrument()!) && activeSampleUrls().length > 0
    ? activeSampleUrls()[(samplePreviewIndex()[activeInstrument()!.id] ?? 0) % activeSampleUrls().length]
    : undefined);
  const grouped = createMemo(
    () => sets().map((set) => ({
      set,
      instruments: visibleInstruments().filter((instrument) => (instrument.setId ?? "user-instruments") === set.id),
    })).filter((group) => group.instruments.length > 0),
  );

  createEffect(() => {
    if (activeId() && visibleInstruments().some((instrument) => instrument.id === activeId())) return;
    setActiveId(visibleInstruments()[0]?.id ?? null);
  });

  createEffect(() => {
    activeId();
    setTaxonomyCategoryOpen(false);
    setTaxonomyInstrumentOpen(false);
  });

  createEffect(() => {
    const currentProject = project();
    let cancelled = false;
    void listProjects()
      .then((projects) => {
        if (cancelled) return;
        const projectsById = new Map(projects.map((savedProject) => [savedProject.id, savedProject]));
        projectsById.set(currentProject.id, currentProject);
        setUsageByInstrument(buildInstrumentUsageMap([...projectsById.values()]));
      })
      .catch(() => {
        if (!cancelled) setUsageByInstrument(buildInstrumentUsageMap([currentProject]));
      });
    onCleanup(() => {
      cancelled = true;
    });
  });

  onCleanup(() => stopPreview());

  createEffect(() => {
    const instrument = activeInstrument();
    const sampleUrl = activeSampleUrl();
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setRenderState({ waveform: null, analysis: null, loading: Boolean(instrument) });
    if (!instrument) return;

    if (sampleUrl) {
      const ctx = getPreviewContext(previewContextRef);
      void loadSampleWaveform(ctx, sampleUrl, sampleZoneForUrl(instrument, sampleUrl, 112))
        .then((waveform) => {
          if (requestRef.current !== requestId) return;
          setRenderState({ waveform, analysis: null, loading: false });
        })
        .catch((error) => {
          if (requestRef.current !== requestId) return;
          const fallbackWaveform = renderedFallbackWaveform(previewContextRef, instrument, projectBpm());
          setRenderState({
            waveform: fallbackWaveform,
            analysis: null,
            loading: false,
            error: fallbackWaveform ? undefined : error instanceof Error ? error.message : "Sample preview unavailable.",
          });
        });
      return;
    }

    void send({
      kind: "instrument.renderPreview",
      instrument,
      note: 60,
      velocity: 112,
      bpm: projectBpm(),
      durationBeats: 2,
      bucketCount: 128,
      includeAudio: isSustainedPreview(instrument),
    })
      .then((response) => {
        if (requestRef.current !== requestId) return;
        const fallbackWaveform = response.waveform && response.waveform.left.upper.length > 0
          ? null
          : renderedFallbackWaveform(previewContextRef, instrument, projectBpm());
        setRenderState({
          waveform: response.waveform && response.waveform.left.upper.length > 0 ? response.waveform : fallbackWaveform,
          analysis: response.analysis ?? null,
          audioDataUrl: response.audioDataUrl,
          loading: false,
          error: response.error,
        });
      })
      .catch((error) => {
        if (requestRef.current !== requestId) return;
        setRenderState({
          waveform: null,
          analysis: null,
          loading: false,
          error: error instanceof Error ? error.message : "Preview unavailable.",
        });
      });
  });

  function stopPreview() {
    stopProgress();
    const preview = previewRef.current;
    previewRef.current = null;
    try {
      preview?.source.stop();
    } catch {
      // Already stopped.
    }
    preview?.source.disconnect();
    preview?.gain.disconnect();
    setPlayingId(null);
  }

  function stopProgress(reset = true) {
    if (progressFrameRef.current !== null) {
      cancelAnimationFrame(progressFrameRef.current);
      progressFrameRef.current = null;
    }
    if (reset) setPreviewProgress(0);
  }

  function startProgress(ctx: AudioContext, duration: number, loop: boolean, initialProgress = 0) {
    stopProgress(false);
    const safeDuration = Math.max(0.001, duration);
    progressRef.current = {
      startTime: ctx.currentTime - clamp01(initialProgress) * safeDuration,
      duration: safeDuration,
      loop,
    };
    setPreviewProgress(clamp01(initialProgress));

    const tick = () => {
      const state = progressRef.current;
      const elapsed = Math.max(0, ctx.currentTime - state.startTime);
      const raw = state.loop ? (elapsed % state.duration) / state.duration : Math.min(1, elapsed / state.duration);
      setPreviewProgress(raw);
      if (state.loop || raw < 1) progressFrameRef.current = requestAnimationFrame(tick);
    };
    progressFrameRef.current = requestAnimationFrame(tick);
  }

  function toggleLoopPreview(instrument: Instrument) {
    setLoopPreview((current) => {
      const next = !current;
      toggleLoopPreviewForSource(previewRef.current, instrument, next);
      if (!isSustainedPreview(instrument)) progressRef.current = { ...progressRef.current, loop: next };
      return next;
    });
  }

  function progressFromPointer(clientX: number) {
    const rect = playbackBarRef?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return previewProgress();
    return clamp01((clientX - rect.left) / rect.width);
  }

  function onPlaybackBarPointerDown(event: PlaybackPointerEvent) {
    if (!activeInstrument()) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrubbing(true);
    const progress = progressFromPointer(event.clientX);
    setPreviewProgress(progress);
    if (playingId() === activeInstrument()!.id) void restartPreviewAt(activeInstrument()!, progress);
  }

  function onPlaybackBarPointerMove(event: PlaybackPointerEvent) {
    if (!scrubbing() || !activeInstrument()) return;
    const progress = progressFromPointer(event.clientX);
    setPreviewProgress(progress);
  }

  function onPlaybackBarPointerUp(event: PlaybackPointerEvent) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const progress = progressFromPointer(event.clientX);
    setScrubbing(false);
    if (activeInstrument() && playingId() === activeInstrument()!.id) void restartPreviewAt(activeInstrument()!, progress);
  }

  async function restartPreviewAt(instrument: Instrument, progress: number) {
    stopPreview();
    await playPreview(instrument, progress);
  }

  async function playPreview(instrument: Instrument, initialProgress = 0) {
    if (playingId() === instrument.id && initialProgress <= 0) {
      stopPreview();
      return;
    }
    stopPreview();
    const ctx = getPreviewContext(previewContextRef);
    if (ctx.state === "suspended") await ctx.resume();
    await preloadInstrumentSample(ctx, instrument).catch(() => undefined);

    const sampleUrls = instrumentSampleUrls(instrument);
    const isSustained = isSustainedPreview(instrument);
    let source: AudioBufferSourceNode | null = null;
    if (!isSustained && sampleUrls.length > 0) {
      const index = sampleCursorRef.current.get(instrument.id) ?? (samplePreviewIndex()[instrument.id] ?? 0);
      const sampleUrl = sampleUrls[index % sampleUrls.length];
      setSamplePreviewIndex((current) => ({ ...current, [instrument.id]: index % sampleUrls.length }));
      sampleCursorRef.current.set(instrument.id, (index + 1) % sampleUrls.length);
      source = createInstrumentSampleBufferSource(ctx, instrument, sampleUrl, previewFrequency(instrument), 112);
    }
    source ??= createInstrumentBufferSource(ctx, instrument, PREVIEW_SECONDS, previewFrequency(instrument), undefined, 112, projectBpm());
    if (isSustained && activeInstrument()?.id === instrument.id && renderState().audioDataUrl) {
      source = await nativePreviewSource(ctx, nativePreviewBufferRef.current, instrument.id, renderState().audioDataUrl!) ?? source;
    }
    const shouldLoop = isSustained || loopPreview();
    source.loop = shouldLoop;
    const gain = ctx.createGain();
    gain.gain.value = 0.24;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.onended = () => {
      if (previewRef.current?.source === source) {
        previewRef.current = null;
        gain.disconnect();
        setPlayingId(null);
        stopProgress();
      }
    };
    previewRef.current = { source, gain };
    setPlayingId(instrument.id);
    const duration = source.buffer?.duration ?? PREVIEW_SECONDS;
    const offset = clamp01(initialProgress) * duration;
    source.start(0, Math.min(Math.max(0, offset), Math.max(0, duration - 0.001)));
    startProgress(ctx, duration, shouldLoop, initialProgress);
  }

  async function deleteActiveInstrument() {
    const instrument = activeInstrument();
    if (!instrument?.userCreated) return;
    const usage = activeUsage() ?? instrumentUsageSummary(instrument.id, [project()]);
    const useText = usage.segmentCount > 0
      ? ` It is used by ${usage.segmentCount} segment${usage.segmentCount === 1 ? "" : "s"} in the current project.`
      : "";
    if (!await appConfirm(`Delete "${instrument.name}" from the Beat library?${useText}`)) return;
    removeInstrument(instrument.id);
    const fallback = visibleInstruments().find((candidate) => candidate.id !== instrument.id)?.id ?? null;
    setActiveId(fallback);
  }

  return (
    <AssetPageShell
      variant="instrument"
      browserLabel="Instrument browser"
      previewLabel="Instrument preview"
      previewClassName={styles.preview}
      browser={
        <>
        <div class={styles.actions}>
          <Button
            iconOnly
            size="sm"
            selected={searchOpen() || searchQuery().length > 0}
            onClick={() => setSearchOpen((value) => !value)}
            aria-label="Search instruments by name"
          >
            <Icon name="ph:magnifying-glass" size={14} decorative />
          </Button>
          {(searchOpen() || searchQuery().length > 0) && (
            <input
              class={styles.searchInput}
              value={searchQuery()}
              onInput={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchQuery("");
                  setSearchOpen(false);
                }
              }}
              placeholder="Name"
              autofocus
            />
          )}
          <span class={styles.count}>{visibleInstruments().length}</span>
        </div>
        <div class={styles.rows}>
          {loading() && instruments().length === 0 ? (
            <div class={styles.emptyRow}>
              <AssetStateMessage
                icon="ph:circle-notch"
                title="Loading Instruments"
                body="Restoring the project instrument library."
                tone="loading"
              />
            </div>
          ) : grouped().length === 0 ? (
            <div class={styles.emptyRow}>
              <AssetStateMessage
                icon="ph:piano-keys"
                title={searchQuery() ? "No Matching Instruments" : "No Instruments"}
                body={searchQuery() ? "Clear search to show the full library." : "Create or import instruments to fill the project library."}
              />
            </div>
          ) : grouped().map((group) => (
            <div class={styles.group}>
              <div class={styles.groupHeader}>
                <span>{instrumentSetDisplayName(group.set)}</span>
                <strong>{group.instruments.length}</strong>
              </div>
              {group.instruments.map((instrument) => (
                <div
                  class={`${styles.row} ${activeInstrument()?.id === instrument.id ? styles.rowActive : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveId(instrument.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setActiveId(instrument.id);
                  }}
                >
                  <Icon name={instrument.icon || "ph:piano-keys"} size={14} decorative />
                  <MarqueeText className={styles.rowName} text={instrument.name} />
                  <span class={styles.rowMeta}>
                    <span class={styles.rowType}>{formatInstrumentType(instrument)}</span>
                    <button
                      type="button"
                      class={`${styles.rowPlay} ${playingId() === instrument.id ? styles.rowPlayActive : ""}`}
                      aria-label={`Preview ${instrument.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void playPreview(instrument);
                      }}
                    >
                      <Icon name={playingId() === instrument.id ? "ph:pause-fill" : "ph:play-fill"} size={12} decorative />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        </>
      }
      preview={
        <>
        {activeInstrument() ? (
          <div class={styles.previewBody}>
            {activeReference() && activeReference()!.tone !== "neutral" ? (
              <AssetStateMessage
                icon={activeReference()!.icon}
                title={activeReference()!.title}
                body={activeReference()!.body}
                tone={activeReference()!.tone}
              />
            ) : null}
            <div class={styles.waveformStage}>
              <div class={styles.waveformGrid} />
              <InstrumentWaveform waveform={renderState().waveform} />
              <div class={styles.playhead} style={{ left: `${previewProgress() * 100}%` }} />
              {renderState().loading && (
                <AssetStateMessage
                  icon="ph:circle-notch"
                  title="Rendering Preview"
                  body="Preparing waveform and analysis."
                  tone="loading"
                />
              )}
              {renderState().error && (
                <AssetStateMessage
                  icon="ph:warning"
                  title="Preview Unavailable"
                  body={renderState().error}
                  tone="warning"
                />
              )}
            </div>
            <div class={styles.previewName}>
              <Icon name={activeInstrument()!.icon || "ph:piano-keys"} size={16} decorative />
              <MarqueeText text={activeInstrument()!.name} />
            </div>
            <div
              ref={playbackBarRef}
              class={`${styles.playbackBar} ${scrubbing() ? styles.playbackBarScrubbing : ""}`}
              onPointerDown={onPlaybackBarPointerDown}
              onPointerMove={onPlaybackBarPointerMove}
              onPointerUp={onPlaybackBarPointerUp}
              onPointerCancel={onPlaybackBarPointerUp}
              role="slider"
              aria-label="Instrument preview playback position"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(previewProgress() * 100)}
            >
              <div class={styles.playbackBarFill} style={{ transform: `scaleX(${previewProgress()})` }} />
              <div class={styles.playbackKnob} style={{ left: `${previewProgress() * 100}%` }} />
            </div>
            <div class={styles.previewControls}>
              <HoverInfo content="Play / pause">
                <Button
                  iconOnly
                  selected={playingId() === activeInstrument()!.id}
                  onClick={() => void playPreview(activeInstrument()!)}
                  aria-label="Play or pause instrument preview"
                >
                  <Icon name={playingId() === activeInstrument()!.id ? "ph:pause-fill" : "ph:play-fill"} size={14} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Loop sample preview">
                <Button iconOnly selected={loopPreview()} onClick={() => toggleLoopPreview(activeInstrument()!)} aria-label="Loop sample preview">
                  <Icon name="ph:repeat" size={14} decorative />
                </Button>
              </HoverInfo>
            </div>
            <div class={styles.taxonomyRow}>
              <FloatingSelect
                className={styles.taxonomySelect}
                label="Category"
                layout="inline"
                value={activeInstrument()!.taxonomy?.categoryId ?? ""}
                ariaLabel="Instrument category"
                options={CATEGORY_OPTIONS}
                open={taxonomyCategoryOpen()}
                onOpenChange={setTaxonomyCategoryOpen}
                onChange={(value) => {
                  const instrumentId = value ? firstInstrumentTaxonomyIdForCategory(value) : "";
                  updateInstrument(activeInstrument()!.id, { taxonomy: instrumentId ? taxonomyAssignmentForInstrumentId(instrumentId) : undefined });
                }}
              />
              <FloatingSelect
                className={styles.taxonomySelect}
                label="Instrument"
                layout="inline"
                value={activeInstrument()!.taxonomy?.instrumentId ?? ""}
                ariaLabel="Instrument taxonomy"
                options={taxonomyInstrumentOptions(activeInstrument()!)}
                open={taxonomyInstrumentOpen()}
                onOpenChange={setTaxonomyInstrumentOpen}
                onChange={(value) => {
                  updateInstrument(activeInstrument()!.id, { taxonomy: value ? taxonomyAssignmentForInstrumentId(value) : undefined });
                }}
              />
            </div>
            <dl class={styles.details}>
              <Info label="Engine" value={formatEngine(activeInstrument()!)} />
              <Info label="Type" value={formatInstrumentType(activeInstrument()!)} />
              <Info label="Source" value={activeInstrument()!.source?.label ?? "Made in Beat"} />
              <Info label="Reference" value={activeReference()?.detail ?? "Unknown"} />
              <Info label="Used In" value={activeUsage()?.projectLabel ?? "0 projects"} />
              <Info label="Segments" value={activeUsage()?.segmentLabel ?? "0 segments"} />
              <Info label="Preview Mode" value={isSustainedPreview(activeInstrument()!) ? "Sustain until pause" : loopPreview() ? "Looping sample" : "One-shot sample"} />
              <Info label="Preview Source" value={activeSampleUrl() ? sampleName(activeSampleUrl()!) : "Rendered instrument"} />
              <Info label="Waveform" value={activeInstrument()!.waveform} />
              <Info label="Filter" value={activeInstrument()!.filterType ?? "lowpass"} />
              <Info label="Envelope" value={formatEnvelope(activeInstrument()!)} />
              <Info label="Samples" value={formatSampleCount(activeInstrument()!)} />
              <Info label="Integrated Loudness" value={formatLufs(renderState().analysis?.integratedLufs)} />
              <Info label="True Peak" value={formatTruePeak(renderState().analysis?.truePeakDbTP)} />
              <Info label="RMS" value={formatDb(renderState().analysis?.rmsDbFS)} />
              <Info label="Descriptors" value={activeInstrument()!.descriptors?.join(", ") || "–"} />
            </dl>
            {!isSustainedPreview(activeInstrument()!) && (
              <SampleStructure instrument={activeInstrument()!} activeSampleUrl={activeSampleUrl()} />
            )}
            <ActionFooter class={styles.instrumentActions}>
              <Button
                size="sm"
                variant="danger"
                disabled={!activeInstrument()!.userCreated}
                title={activeInstrument()!.userCreated ? "Delete this library instrument" : "Factory instruments cannot be deleted"}
                onClick={() => void deleteActiveInstrument()}
              >
                Delete
              </Button>
            </ActionFooter>
          </div>
        ) : (
          <div class={styles.emptyPreview}>
            <AssetStateMessage
              icon="ph:piano-keys"
              title="Select an Instrument"
              body="Choose an instrument to inspect sound source, preview, and samples."
            />
          </div>
        )}
        </>
      }
    />
  );
}

function instrumentSetDisplayName(set: InstrumentSet): string {
  if (!set.factory || set.id === TEMPORARY_DS_INSTRUMENT_SET_ID) return set.name;
  return `Factory ${set.name}`;
}

function InstrumentWaveform(props: { waveform: AudioWaveformSummary | null }) {
  const left = createMemo(() => props.waveform ? waveformPath(channelEnvelope(props.waveform.left), 50, -42) : null);
  const right = createMemo(() => props.waveform ? waveformPath(channelEnvelope(props.waveform.right), 50, 42) : null);
  return (
    props.waveform && props.waveform.left.upper.length > 0 ? (
      <svg class={styles.waveformSvg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon class={styles.waveformFill} points={left()!.fill} />
        <polyline class={styles.waveformTrace} points={left()!.trace} />
        <polygon class={styles.waveformFill} points={right()!.fill} />
        <polyline class={styles.waveformTrace} points={right()!.trace} />
      </svg>
    ) : null
  );
}

function channelEnvelope(channel: { upper: number[]; lower: number[] }) {
  return channel.upper.map((peak, index) => Math.max(Math.abs(peak), Math.abs(channel.lower[index] ?? 0)));
}

function waveformPath(peaks: number[], centerY: number, amplitude: number) {
  const trace = peaks.map((peak, index) => {
    const x = peaks.length === 1 ? 50 : (index / (peaks.length - 1)) * 100;
    return `${x.toFixed(3)},${(centerY + peak * amplitude).toFixed(3)}`;
  });
  const center = peaks.map((_, index) => {
    const x = peaks.length === 1 ? 50 : (index / (peaks.length - 1)) * 100;
    return `${x.toFixed(3)},${centerY.toFixed(3)}`;
  });
  return { trace: trace.join(" "), fill: [...center, ...trace.slice().reverse()].join(" ") };
}

function Info(props: { label: string; value: string }) {
  return (
    <div>
      <dt>{props.label}</dt>
      <dd title={props.value}>{props.value}</dd>
    </div>
  );
}

type InstrumentReferenceTone = "neutral" | "warning" | "danger";

function instrumentReferenceState(instrument: Instrument): {
  label: string;
  detail: string;
  title: string;
  body: string;
  icon: string;
  tone: InstrumentReferenceTone;
  className: string;
} {
  if (instrument.source?.kind === "plugin" && instrument.source.fallbackEngine) {
    return {
      label: "Fallback",
      detail: `${instrument.source.label} via ${instrument.source.fallbackEngine}`,
      title: "Plugin Fallback Active",
      body: "This plugin-sourced instrument is using Beat's fallback engine for preview.",
      icon: "ph:warning",
      tone: "warning",
      className: "referenceWarning",
    };
  }

  const sampleUrls = instrumentSampleUrls(instrument);
  const expectsSamples = instrument.kind === "sampler" || instrument.waveform === "sample" || (instrument.sampleMap?.length ?? 0) > 0;
  if (expectsSamples && sampleUrls.length === 0) {
    return {
      label: "Missing",
      detail: "No sample reference",
      title: "Missing Sample Reference",
      body: "This sampler instrument has no sample path to preview.",
      icon: "ph:warning-diamond",
      tone: "danger",
      className: "referenceDanger",
    };
  }

  if (sampleUrls.some((path) => sampleReferenceState(path).tone === "warning")) {
    return {
      label: "Library",
      detail: "Beat library sample",
      title: "Library Sample",
      body: "This sampler instrument uses sample assets registered in Beat's library.",
      icon: "ph:folder-simple",
      tone: "neutral",
      className: "referenceManaged",
    };
  }

  if (sampleUrls.some((path) => path.startsWith("data:"))) {
    return {
      label: "Embedded",
      detail: "Embedded sample data",
      title: "Embedded Sample",
      body: "This instrument stores sample data inside the library entry.",
      icon: "ph:database",
      tone: "neutral",
      className: "referenceManaged",
    };
  }

  if (sampleUrls.length > 0) {
    return {
      label: "Library",
      detail: "Beat library sample",
      title: "Library Samples",
      body: "Samples are referenced from the Beat library.",
      icon: "ph:folder-simple",
      tone: "neutral",
      className: "referenceManaged",
    };
  }

  return {
    label: instrument.source?.kind === "factory" ? "Factory" : instrument.source?.kind === "plugin" ? "Plugin" : "Library",
    detail: instrument.source?.label ?? "Generated in Beat",
    title: "Library Instrument",
    body: "This instrument renders from stored synth settings.",
    icon: "ph:piano-keys",
    tone: "neutral",
    className: "referenceManaged",
  };
}

function sampleReferenceState(path: string): { label: string; tone: InstrumentReferenceTone; className: string } {
  const trimmed = path.trim();
  if (!trimmed) return { label: "Missing", tone: "danger", className: "referenceDanger" };
  if (trimmed.startsWith("data:")) return { label: "Embedded", tone: "neutral", className: "referenceManaged" };
  if (trimmed.includes("/Beat/Audio Files/")) return { label: "Library", tone: "neutral", className: "referenceManaged" };
  if (trimmed.startsWith("/") || /^https?:/i.test(trimmed)) return { label: "Library", tone: "neutral", className: "referenceManaged" };
  return { label: "Asset", tone: "neutral", className: "referenceManaged" };
}

function SampleStructure(props: { instrument: Instrument; activeSampleUrl?: string }) {
  const updateInstrument = useInstrumentStore.getState().updateInstrument;
  const [draftOrder, setDraftOrder] = createSignal<string[]>(sampleOrder(props.instrument), { equals: false });
  const [draftVariables, setDraftVariables] = createSignal<SampleVariable[]>(inferSampleVariables(props.instrument), { equals: false });
  const [draftGrouping, setDraftGrouping] = createSignal<SampleGrouping>(primarySampleGrouping(props.instrument));
  const [draftZoneEdits, setDraftZoneEdits] = createSignal<Record<string, Partial<NonNullable<Instrument["sampleMap"]>[number]>>>({}, { equals: false });
  const [editingValue, setEditingValue] = createSignal<{ path: string; value: string } | null>(null, { equals: false });

  createEffect(() => {
    const instrument = props.instrument;
    setDraftOrder(sampleOrder(instrument));
    const variables = inferSampleVariables(instrument);
    setDraftVariables(variables);
    setDraftGrouping(variables[0] ?? "single");
    setDraftZoneEdits({});
    setEditingValue(null);
  });

  const draftInstrument = createMemo(
    () => materializeSampleDraft(props.instrument, draftOrder(), draftVariables(), draftZoneEdits()),
  );
  const activeGrouping = createMemo<SampleGrouping>(() => draftVariables().includes(draftGrouping() as SampleVariable) ? draftGrouping() : draftVariables()[0] ?? "single");
  const groups = createMemo(() => sampleStructureGroups(draftInstrument(), activeGrouping()));
  const structure = createMemo(() => sampleStructureLabels(draftInstrument(), draftVariables()));
  const originalVariables = createMemo(() => inferSampleVariables(props.instrument));
  const originalDraftInstrument = createMemo(() => materializeSampleDraft(props.instrument, sampleOrder(props.instrument), originalVariables()));
  const pendingPatch = createMemo(() => editingValue() ? parseSampleValueEdit(editingValue()!.value, activeGrouping()) : null);
  const pendingZone = createMemo(() => editingValue()
    ? draftInstrument().sampleMap?.find((zone) => zone.path === editingValue()!.path)
    : undefined);
  const effectiveZoneEdits = createMemo(() => editingValue() && pendingPatch() && samplePatchChangesZone(pendingZone(), pendingPatch()!)
    ? {
        ...draftZoneEdits(),
        [editingValue()!.path]: {
          ...(draftZoneEdits()[editingValue()!.path] ?? {}),
          ...pendingPatch()!,
        },
      }
    : draftZoneEdits());
  const effectiveDraftInstrument = createMemo(() => materializeSampleDraft(props.instrument, draftOrder(), draftVariables(), effectiveZoneEdits()));
  const dirty = createMemo(() => sampleDraftSignature(effectiveDraftInstrument()) !== sampleDraftSignature(originalDraftInstrument()));

  function saveDraft() {
    const committedEdits = committedZoneEdits();
    const next = materializeSampleDraft(props.instrument, draftOrder(), draftVariables(), committedEdits);
    updateInstrument(props.instrument.id, {
      sampleUrl: next.sampleUrls?.[0] ?? next.sampleUrl,
      sampleUrls: next.sampleUrls,
      sampleMap: next.sampleMap,
      source: props.instrument.source ? { ...props.instrument.source, edited: true } : props.instrument.source,
    });
  }

  function revertDraft() {
    setDraftOrder(sampleOrder(props.instrument));
    const variables = inferSampleVariables(props.instrument);
    setDraftVariables(variables);
    setDraftGrouping(variables[0] ?? "single");
    setDraftZoneEdits({});
    setEditingValue(null);
  }

  function beginValueEdit(row: SampleStructureRow) {
    setEditingValue({
      path: row.path,
      value: editableValueForZone(row.zone, activeGrouping()),
    });
  }

  function commitEditedValue() {
    const currentEdit = editingValue();
    if (!currentEdit) return;
    const patch = parseSampleValueEdit(currentEdit.value, activeGrouping());
    const currentZone = draftInstrument().sampleMap?.find((zone) => zone.path === currentEdit.path);
    if (patch && samplePatchChangesZone(currentZone, patch)) {
      setDraftZoneEdits((current) => ({
        ...current,
        [currentEdit.path]: {
          ...(current[currentEdit.path] ?? {}),
          ...patch,
        },
      }));
    }
    setEditingValue(null);
  }

  function committedZoneEdits() {
    const currentEdit = editingValue();
    if (!currentEdit) return draftZoneEdits();
    const patch = parseSampleValueEdit(currentEdit.value, activeGrouping());
    if (!patch) return draftZoneEdits();
    const currentZone = draftInstrument().sampleMap?.find((zone) => zone.path === currentEdit.path);
    if (!samplePatchChangesZone(currentZone, patch))
    {
      setEditingValue(null);
      return draftZoneEdits();
    }
    const next = {
      ...draftZoneEdits(),
      [currentEdit.path]: {
        ...(draftZoneEdits()[currentEdit.path] ?? {}),
        ...patch,
      },
    };
    setDraftZoneEdits(next);
    setEditingValue(null);
    return next;
  }

  function addVariable() {
    const missing = SAMPLE_VARIABLE_OPTIONS.find((option) => !draftVariables().includes(option.mode));
    if (!missing) return;
    setDraftVariables((current) => [...current, missing.mode]);
    setDraftGrouping(missing.mode);
    setEditingValue(null);
  }

  function removeVariable(variable: SampleGrouping) {
    if (variable === "single") return;
    setDraftVariables((current) => {
      const next = current.filter((item) => item !== variable);
      setDraftGrouping(next[0] ?? "single");
      return next;
    });
    setEditingValue(null);
  }

  return (
    groups().length > 0 ? <section class={styles.sampleStructure} aria-label="Associated audio files">
      <div class={styles.sampleStructureHeader}>
        <span>Associated Audio Files</span>
        <strong>{structure().join(" / ")}</strong>
      </div>
      <div class={styles.sampleGrouping} aria-label="Sample variables">
        {draftVariables().length === 0 ? (
          <span class={styles.sampleGroupingEmpty}>No variables</span>
        ) : draftVariables().map((variable) => {
          const option = SAMPLE_VARIABLE_OPTIONS.find((item) => item.mode === variable);
          return (
          <button
            type="button"
            class={variable === activeGrouping() ? styles.sampleGroupingActive : ""}
            onClick={() => setDraftGrouping(variable)}
          >
            {option?.label ?? variable}
          </button>
          );
        })}
        <button class={styles.sampleAddVariable} type="button" onClick={addVariable} disabled={draftVariables().length >= SAMPLE_VARIABLE_OPTIONS.length}>
          + Variable
        </button>
      </div>
      {groups().map((group) => (
        <div class={styles.sampleGroup}>
          <div class={styles.sampleGroupHeader}>
            <span>{group.title}</span>
            <strong>{group.rows.length}</strong>
            {group.mode !== "single" ? (
              <button class={styles.sampleRemoveVariable} type="button" onClick={() => removeVariable(group.mode as SampleGrouping)}>
                Remove variable
              </button>
            ) : null}
          </div>
          <div class={styles.sampleRows}>
            {group.rows.map((row) => (
                <div
                  class={`${styles.sampleRow} ${row.path === props.activeSampleUrl ? styles.sampleRowActive : ""}`}
                >
                  <MarqueeText text={row.name} />
                  {row.editable ? (
                    <span
                      class={styles.sampleValue}
                      onDblClick={(event) => {
                        event.stopPropagation();
                        beginValueEdit(row);
                      }}
                    >
                      {editingValue()?.path === row.path ? (
                        <input
                          class={styles.sampleValueInput}
                          value={editingValue()!.value}
                          autofocus
                          onClick={(event) => event.stopPropagation()}
                          onInput={(event) => setEditingValue({ path: row.path, value: event.currentTarget.value })}
                          onBlur={commitEditedValue}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitEditedValue();
                            if (event.key === "Escape") setEditingValue(null);
                          }}
                        />
                      ) : row.meta}
                    </span>
                  ) : null}
                </div>
            ))}
          </div>
        </div>
      ))}
      <ActionFooter class={styles.sampleActions}>
        <Button class={`${styles.sampleActionButton} ${styles.sampleSecondaryAction}`} disabled={!dirty()} onClick={revertDraft}>Revert</Button>
        <Button class={`${styles.sampleActionButton} ${styles.samplePrimaryAction}`} variant="primary" disabled={!dirty()} onClick={saveDraft}>Save</Button>
      </ActionFooter>
    </section> : null
  );
}

interface SampleStructureRow {
  path: string;
  name: string;
  meta: string;
  editable: boolean;
  zone?: NonNullable<Instrument["sampleMap"]>[number];
}

function sampleOrder(instrument: Instrument): string[] {
  return instrumentSampleUrls(instrument);
}

function sampleStructureRows(instrument: Instrument): SampleStructureRow[] {
  const zonesByPath = new Map<string, NonNullable<Instrument["sampleMap"]>>();
  for (const zone of instrument.sampleMap ?? []) {
    const zones = zonesByPath.get(zone.path) ?? [];
    zones.push(zone);
    zonesByPath.set(zone.path, zones);
  }

  return instrumentSampleUrls(instrument).map((path, index) => {
    const zones = zonesByPath.get(path) ?? [];
    const zone = zones[0];
    return {
      path,
      name: sampleDisplayName(path, zones, index),
      meta: samplePrimaryMeta(zone, index),
      editable: true,
      zone,
    };
  });
}

function sampleStructureGroups(instrument: Instrument, grouping: SampleGrouping = primarySampleGrouping(instrument)) {
  const rows = sampleStructureRows(instrument);
  if (rows.length === 0) return [];
  const groups: Array<{ mode: SampleGrouping; title: string; rows: SampleStructureRow[] }> = [];

  if (grouping === "length") {
    groups.push({
      mode: "length",
      title: "Length Layers",
      rows: [...rows].sort((a, b) => (a.zone?.durationSeconds ?? 0) - (b.zone?.durationSeconds ?? 0)).map((row) => ({
        ...row,
        meta: formatLengthLayer(row.zone),
        editable: true,
      })),
    });
  }

  if (grouping === "volume") {
    groups.push({
      mode: "volume",
      title: "Volume Layers",
      rows: rows.map((row) => ({ ...row, meta: formatVelocityLayer(row.zone), editable: true })),
    });
  }

  if (grouping === "hit") {
    groups.push({
      mode: "hit",
      title: "Hit Variants",
      rows: [...rows].sort((a, b) => (a.zone?.seqPosition ?? 0) - (b.zone?.seqPosition ?? 0)).map((row, index) => ({
        ...row,
        meta: `Variant ${index + 1}`,
        editable: false,
      })),
    });
  }

  if (grouping === "pitch") {
    groups.push({
      mode: "pitch",
      title: "Pitch Zones",
      rows: rows.map((row) => ({ ...row, meta: formatPitchZone(row.zone), editable: true })),
    });
  }

  return groups.length > 0 ? groups : [{ mode: "single", title: rows.length > 1 ? "Samples" : "Single Sample", rows }];
}

function sampleStructureLabels(instrument: Instrument, variables = inferSampleVariables(instrument)) {
  if (variables.length > 0) {
    return variables.map((variable) => {
      if (variable === "length") return "length variable";
      if (variable === "volume") return "volume variable";
      if (variable === "hit") return "hit variance";
      return "pitch zones";
    });
  }
  return [(instrument.sampleUrls?.length ?? 0) > 1 ? "ordered samples" : "single sample"];
}

function inferSampleVariables(instrument: Instrument): SampleVariable[] {
  const zones = instrument.sampleMap ?? [];
  const variables: SampleVariable[] = [];
  if (hasLengthLayers(zones)) variables.push("length");
  if (hasVelocityLayers(zones)) variables.push("volume");
  if (hasHitVariants(instrument)) variables.push("hit");
  if (hasPitchZones(zones)) variables.push("pitch");
  return variables;
}

function primarySampleGrouping(instrument: Instrument): SampleGrouping {
  return inferSampleVariables(instrument)[0] ?? "single";
}

function materializeSampleDraft(
  instrument: Instrument,
  order: string[],
  variables: SampleVariable[],
  edits: Record<string, Partial<NonNullable<Instrument["sampleMap"]>[number]>> = {},
): Instrument {
  const sampleUrls = uniqueOrder(order.length > 0 ? order : sampleOrder(instrument));
  const zonesByPath = new Map<string, NonNullable<Instrument["sampleMap"]>[number][]>();
  for (const zone of instrument.sampleMap ?? []) {
    const zones = zonesByPath.get(zone.path) ?? [];
    zones.push(zone);
    zonesByPath.set(zone.path, zones);
  }
  const nextMap = sampleUrls.flatMap((path, index) => {
    const zones = zonesByPath.get(path);
    const sourceZones = zones && zones.length > 0 ? zones : [defaultSampleZone(path)];
    return sourceZones.map((zone) => ({
      ...applySampleVariables(zone, index, sampleUrls.length, variables),
      ...(edits[path] ?? {}),
    }));
  });
  return {
    ...instrument,
    sampleUrl: sampleUrls[0],
    sampleUrls,
    sampleMap: nextMap,
  };
}

function editableValueForZone(zone: SampleStructureRow["zone"], grouping: SampleGrouping) {
  if (!zone) return "";
  if (grouping === "length") return zone.durationSeconds ? zone.durationSeconds.toFixed(2) : "";
  if (grouping === "volume") return `${zone.loVel}-${zone.hiVel}`;
  if (grouping === "hit") return `${Math.max(1, zone.seqPosition + 1)}`;
  if (grouping === "pitch") return `${zone.loNote}-${zone.hiNote}/${zone.rootNote}`;
  return zone.name?.trim() || "";
}

function parseSampleValueEdit(value: string, grouping: SampleGrouping): Partial<NonNullable<Instrument["sampleMap"]>[number]> | null {
  const trimmed = value.trim();
  if (grouping === "length") {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return { durationSeconds: seconds };
  }
  if (grouping === "volume") {
    const match = trimmed.match(/^(\d{1,3})\s*-\s*(\d{1,3})$/);
    if (!match) return null;
    const loVel = clampInteger(Number(match[1]), 0, 127);
    const hiVel = clampInteger(Number(match[2]), 0, 127);
    return { loVel: Math.min(loVel, hiVel), hiVel: Math.max(loVel, hiVel) };
  }
  if (grouping === "hit") {
    const hit = Number(trimmed);
    if (!Number.isFinite(hit)) return null;
    return { seqPosition: Math.max(0, Math.round(hit) - 1) };
  }
  if (grouping === "pitch") {
    const match = trimmed.match(/^(\d{1,3})\s*-\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?$/);
    if (!match) return null;
    const loNote = clampInteger(Number(match[1]), 0, 127);
    const hiNote = clampInteger(Number(match[2]), 0, 127);
    const rootNote = match[3] ? clampInteger(Number(match[3]), 0, 127) : clampInteger(Math.round((loNote + hiNote) / 2), 0, 127);
    return { loNote: Math.min(loNote, hiNote), hiNote: Math.max(loNote, hiNote), rootNote };
  }
  return trimmed ? { name: trimmed } : null;
}

function clampInteger(value: number, low: number, high: number) {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, Math.round(value)));
}

function applySampleVariables(
  zone: NonNullable<Instrument["sampleMap"]>[number],
  index: number,
  total: number,
  variables: SampleVariable[],
) {
  const next = { ...zone };
  if (variables.includes("hit")) {
    next.seqPosition = index;
  } else {
    next.seqPosition = 0;
  }

  if (!variables.includes("length")) {
    delete next.durationSeconds;
    delete next.loLengthSeconds;
    delete next.hiLengthSeconds;
  }

  if (variables.includes("volume")) {
    const width = 128 / Math.max(1, total);
    next.loVel = Math.max(0, Math.round(index * width));
    next.hiVel = Math.min(127, Math.round((index + 1) * width) - 1);
  } else {
    next.loVel = 0;
    next.hiVel = 127;
  }

  if (variables.includes("length")) {
    const duration = next.durationSeconds ?? 0;
    next.loLengthSeconds = index === 0 ? 0 : Math.max(0, duration * 0.5);
    next.hiLengthSeconds = index === total - 1 ? undefined : Math.max(0.001, duration || index + 1);
  }

  if (!variables.includes("pitch")) {
    next.loNote = 0;
    next.hiNote = 127;
  }
  return next;
}

function defaultSampleZone(path: string): NonNullable<Instrument["sampleMap"]>[number] {
  return {
    path,
    rootNote: 60,
    loNote: 0,
    hiNote: 127,
    loVel: 0,
    hiVel: 127,
    volumeDb: 0,
    pan: 0,
    tuning: 0,
    seqPosition: 0,
  };
}

function uniqueOrder(paths: string[]) {
  return paths.filter((path, index) => path && paths.indexOf(path) === index);
}

function samplePatchChangesZone(
  zone: NonNullable<Instrument["sampleMap"]>[number] | undefined,
  patch: Partial<NonNullable<Instrument["sampleMap"]>[number]>,
) {
  return Object.entries(patch).some(([key, value]) => {
    const current = zone?.[key as keyof NonNullable<Instrument["sampleMap"]>[number]];
    return current !== value;
  });
}

function sampleDraftSignature(instrument: Instrument) {
  return JSON.stringify({
    sampleUrl: instrument.sampleUrl ?? "",
    sampleUrls: instrumentSampleUrls(instrument),
    sampleMap: (instrument.sampleMap ?? []).map((zone) => ({
      path: zone.path ?? "",
      name: zone.name ?? "",
      rootNote: zone.rootNote ?? 60,
      loNote: zone.loNote ?? 0,
      hiNote: zone.hiNote ?? 127,
      loVel: zone.loVel ?? 0,
      hiVel: zone.hiVel ?? 127,
      volumeDb: zone.volumeDb ?? 0,
      pan: zone.pan ?? 0,
      tuning: zone.tuning ?? 0,
      seqPosition: zone.seqPosition ?? 0,
      durationSeconds: zone.durationSeconds ?? null,
      loLengthSeconds: zone.loLengthSeconds ?? null,
      hiLengthSeconds: zone.hiLengthSeconds ?? null,
    })),
  });
}

function hasLengthLayers(zones: NonNullable<Instrument["sampleMap"]>) {
  return zones.some((zone) => zone.durationSeconds || zone.loLengthSeconds != null || zone.hiLengthSeconds != null);
}

function hasVelocityLayers(zones: NonNullable<Instrument["sampleMap"]>) {
  return zones.some((zone) => zone.loVel > 0 || zone.hiVel < 127 || Math.abs(zone.volumeDb) > 0.001);
}

function hasHitVariants(instrument: Instrument) {
  const zones = instrument.sampleMap ?? [];
  if (hasLengthLayers(zones)) return false;
  return zones.some((zone) => zone.seqPosition > 0) || (zones.length === 0 && (instrument.sampleUrls?.length ?? 0) > 1);
}

function hasPitchZones(zones: NonNullable<Instrument["sampleMap"]>) {
  return zones.some((zone) => zone.loNote > 0 || zone.hiNote < 127 || zone.rootNote !== 60);
}

function samplePrimaryMeta(zone: SampleStructureRow["zone"], index: number) {
  if (!zone) return `Sample ${index + 1}`;
  if (zone.durationSeconds) return formatSeconds(zone.durationSeconds);
  if (zone.hiVel < 127 || zone.loVel > 0) return formatVelocityLayer(zone);
  if (zone.seqPosition > 0) return `Hit ${zone.seqPosition + 1}`;
  return "Sample";
}

function formatLengthLayer(zone?: SampleStructureRow["zone"]) {
  if (!zone) return "Length";
  const duration = zone.durationSeconds ? formatSeconds(zone.durationSeconds) : "Length";
  if (zone.loLengthSeconds != null && zone.hiLengthSeconds != null) {
    return `${duration} · ${formatSeconds(zone.loLengthSeconds)}-${formatSeconds(zone.hiLengthSeconds)}`;
  }
  return duration;
}

function formatVelocityLayer(zone?: SampleStructureRow["zone"]) {
  if (!zone) return "Velocity";
  const range = `Vel ${zone.loVel}-${zone.hiVel}`;
  return Math.abs(zone.volumeDb) > 0.001 ? `${range} · ${zone.volumeDb > 0 ? "+" : ""}${zone.volumeDb.toFixed(1)} dB` : range;
}

function formatPitchZone(zone?: SampleStructureRow["zone"]) {
  if (!zone) return "Pitch";
  return `Note ${zone.loNote}-${zone.hiNote} · Root ${zone.rootNote}`;
}

function formatSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0.00s";
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toggleLoopPreviewForSource(preview: { source: AudioBufferSourceNode; gain: GainNode } | null, instrument: Instrument, loop: boolean) {
  if (!preview || isSustainedPreview(instrument)) return;
  preview.source.loop = loop;
}

function audioBufferWaveform(buffer: AudioBuffer, bucketCount: number): AudioWaveformSummary {
  const safeBucketCount = Math.max(1, Math.round(bucketCount));
  const bucketSize = Math.max(1, Math.floor(buffer.length / safeBucketCount));
  const leftData = buffer.getChannelData(0);
  const rightData = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : leftData;
  const left = { upper: [] as number[], lower: [] as number[] };
  const right = { upper: [] as number[], lower: [] as number[] };
  let peak = 0;

  for (let bucket = 0; bucket < safeBucketCount; bucket += 1) {
    const start = bucket * bucketSize;
    const end = Math.min(buffer.length, start + bucketSize);
    let leftMax = 0;
    let leftMin = 0;
    let rightMax = 0;
    let rightMin = 0;
    for (let i = start; i < end; i += 1) {
      const l = leftData[i] ?? 0;
      const r = rightData[i] ?? 0;
      if (l > leftMax) leftMax = l;
      if (l < leftMin) leftMin = l;
      if (r > rightMax) rightMax = r;
      if (r < rightMin) rightMin = r;
    }
    left.upper.push(Math.max(0, leftMax));
    left.lower.push(Math.abs(Math.min(0, leftMin)));
    right.upper.push(Math.max(0, rightMax));
    right.lower.push(Math.abs(Math.min(0, rightMin)));
    peak = Math.max(peak, Math.abs(leftMax), Math.abs(leftMin), Math.abs(rightMax), Math.abs(rightMin));
  }

  const normalize = (values: number[]) => peak > 0 ? values.map((value) => Math.min(1, value / peak)) : values.map(() => 0);
  return {
    left: { upper: normalize(left.upper), lower: normalize(left.lower) },
    right: { upper: normalize(right.upper), lower: normalize(right.lower) },
    sampleRate: buffer.sampleRate,
    durationSeconds: buffer.duration,
    lengthInSamples: buffer.length,
    channelCount: buffer.numberOfChannels,
    bucketCount: safeBucketCount,
  };
}

async function loadSampleWaveform(
  ctx: AudioContext,
  sampleUrl: string,
  zone?: NonNullable<Instrument["sampleMap"]>[number],
): Promise<AudioWaveformSummary> {
  const hasZoneSlice = Boolean(zone && (zone.startSample || zone.endSample));
  if (!hasZoneSlice && isNative() && sampleUrl.startsWith("/")) {
    const response = await send({ kind: "audio.waveform", path: sampleUrl, bucketCount: 128 });
    if (isUsableWaveform(response.waveform)) return response.waveform;
  }
  const fileWaveform = await sampleFileWaveform(sampleUrl, zone, 128).catch(() => null);
  if (fileWaveform) return fileWaveform;
  await preloadInstrumentSampleUrl(ctx, sampleUrl);
  const buffer = cachedInstrumentSampleBuffer(sampleUrl);
  if (!buffer) throw new Error("Sample waveform unavailable.");
  return audioBufferWaveform(sliceAudioBuffer(buffer, zone?.startSample, zone?.endSample), 128);
}

function isUsableWaveform(waveform: AudioWaveformSummary | null | undefined): waveform is AudioWaveformSummary {
  return Boolean(waveform && waveform.left.upper.length > 0 && waveform.right.upper.length > 0);
}

function sampleZoneForUrl(instrument: Instrument, sampleUrl: string, velocity = 127) {
  return (instrument.sampleMap ?? [])
    .filter((zone) => zone.path === sampleUrl)
    .find((zone) => velocity >= zone.loVel && velocity <= zone.hiVel)
    ?? (instrument.sampleMap ?? []).find((zone) => zone.path === sampleUrl);
}

async function sampleFileWaveform(
  sampleUrl: string,
  zone: NonNullable<Instrument["sampleMap"]>[number] | undefined,
  bucketCount: number,
): Promise<AudioWaveformSummary | null> {
  if (sampleUrl.startsWith("data:")) return null;
  const response = await fetch(sampleUrl);
  if (!response.ok) return null;
  return wavArrayBufferWaveform(await response.arrayBuffer(), zone?.startSample, zone?.endSample, bucketCount);
}

function wavArrayBufferWaveform(
  buffer: ArrayBuffer,
  startSample = 0,
  endSample = 0,
  bucketCount = 128,
): AudioWaveformSummary | null {
  const view = new DataView(buffer);
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") return null;

  let offset = 12;
  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let blockAlign = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const bodyOffset = offset + 8;
    if (id === "fmt " && bodyOffset + 16 <= view.byteLength) {
      format = view.getUint16(bodyOffset, true);
      channelCount = view.getUint16(bodyOffset + 2, true);
      sampleRate = view.getUint32(bodyOffset + 4, true);
      blockAlign = view.getUint16(bodyOffset + 12, true);
      bitsPerSample = view.getUint16(bodyOffset + 14, true);
    } else if (id === "data") {
      dataOffset = bodyOffset;
      dataSize = Math.min(size, Math.max(0, view.byteLength - bodyOffset));
      break;
    }
    offset = bodyOffset + size + (size % 2);
  }

  if (!dataOffset || !dataSize || !channelCount || !sampleRate || !blockAlign || !bitsPerSample) return null;
  if (format !== 1 && format !== 3) return null;

  const totalFrames = Math.floor(dataSize / blockAlign);
  if (totalFrames <= 0) return null;
  const start = Math.max(0, Math.min(totalFrames - 1, Math.floor(startSample || 0)));
  const end = endSample > start + 1
    ? Math.max(start + 2, Math.min(totalFrames, Math.floor(endSample)))
    : totalFrames;
  const frameCount = Math.max(1, end - start);
  const safeBucketCount = Math.max(1, Math.min(bucketCount, frameCount));
  const leftUpper = new Array<number>(safeBucketCount).fill(0);
  const leftLower = new Array<number>(safeBucketCount).fill(0);
  const rightUpper = new Array<number>(safeBucketCount).fill(0);
  const rightLower = new Array<number>(safeBucketCount).fill(0);

  for (let i = 0; i < frameCount; i++) {
    const frameIndex = start + i;
    const bucket = Math.min(safeBucketCount - 1, Math.floor((i / frameCount) * safeBucketCount));
    const left = readWavSample(view, dataOffset + frameIndex * blockAlign, bitsPerSample, format);
    const rightOffset = dataOffset + frameIndex * blockAlign + Math.floor(bitsPerSample / 8);
    const right = channelCount > 1 ? readWavSample(view, rightOffset, bitsPerSample, format) : left;
    leftUpper[bucket] = Math.max(leftUpper[bucket], left);
    leftLower[bucket] = Math.min(leftLower[bucket], left);
    rightUpper[bucket] = Math.max(rightUpper[bucket], right);
    rightLower[bucket] = Math.min(rightLower[bucket], right);
  }

  return {
    left: { upper: leftUpper, lower: leftLower },
    right: { upper: rightUpper, lower: rightLower },
    sampleRate,
    durationSeconds: frameCount / sampleRate,
    lengthInSamples: frameCount,
    channelCount,
    bucketCount: safeBucketCount,
  };
}

function readWavSample(view: DataView, byteOffset: number, bitsPerSample: number, format: number): number {
  if (byteOffset < 0 || byteOffset >= view.byteLength) return 0;
  if (format === 3 && bitsPerSample === 32 && byteOffset + 4 <= view.byteLength) {
    return clampAudioSample(view.getFloat32(byteOffset, true));
  }
  if (bitsPerSample === 8) return ((view.getUint8(byteOffset) - 128) / 128);
  if (bitsPerSample === 16 && byteOffset + 2 <= view.byteLength) return view.getInt16(byteOffset, true) / 32768;
  if (bitsPerSample === 24 && byteOffset + 3 <= view.byteLength) {
    const value = view.getUint8(byteOffset) | (view.getUint8(byteOffset + 1) << 8) | (view.getUint8(byteOffset + 2) << 16);
    return ((value & 0x800000) ? value | 0xff000000 : value) / 8388608;
  }
  if (bitsPerSample === 32 && byteOffset + 4 <= view.byteLength) return view.getInt32(byteOffset, true) / 2147483648;
  return 0;
}

function clampAudioSample(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let text = "";
  for (let i = 0; i < length && offset + i < view.byteLength; i++) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}

function sliceAudioBuffer(buffer: AudioBuffer, startSample = 0, endSample = 0): AudioBuffer {
  const start = Math.max(0, Math.min(buffer.length - 1, Math.floor(startSample || 0)));
  const end = endSample > start + 1
    ? Math.max(start + 2, Math.min(buffer.length, Math.floor(endSample)))
    : buffer.length;
  if (start === 0 && end === buffer.length) return buffer;
  const sliced = new AudioBuffer({
    length: Math.max(1, end - start),
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    sliced.copyToChannel(buffer.getChannelData(channel).slice(start, end), channel);
  }
  return sliced;
}

function renderedFallbackWaveform(ref: RefValue<AudioContext | null>, instrument: Instrument, bpm = 120): AudioWaveformSummary | null {
  try {
    const ctx = getPreviewContext(ref);
    return audioBufferWaveform(renderedInstrumentBuffer(ctx, instrument, PREVIEW_SECONDS, previewFrequency(instrument), undefined, bpm), 128);
  } catch {
    return null;
  }
}

async function nativePreviewSource(
  ctx: AudioContext,
  cache: Map<string, AudioBuffer>,
  instrumentId: string,
  audioDataUrl: string,
) {
  const key = `${instrumentId}:${audioDataUrl.length}`;
  let buffer = cache.get(key);
  if (!buffer) {
    const response = await fetch(audioDataUrl);
    buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    cache.set(key, buffer);
    while (cache.size > 12) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

function sampleDisplayName(sampleUrl: string, zones: NonNullable<Instrument["sampleMap"]> = [], index = 0) {
  const zoneName = zones.find((zone) => zone.name?.trim())?.name?.trim();
  if (zoneName) return zoneName;
  if (sampleUrl.startsWith("data:")) return `Sample ${index + 1}`;
  return sampleName(sampleUrl, index);
}

function sampleName(sampleUrl: string, index = 0) {
  if (sampleUrl.startsWith("data:")) return `Sample ${index + 1}`;
  const last = sampleUrl.split(/[\\/]/).filter(Boolean).pop() ?? sampleUrl;
  try {
    return decodeURIComponent(last);
  } catch {
    return last || `Sample ${index + 1}`;
  }
}

function isSustainedPreview(instrument: Instrument) {
  return instrument.kind === "synth" || instrument.kind === "wavetable" || Boolean(instrument.aether || instrument.synthPatch);
}

function formatEngine(instrument: Instrument) {
  if (instrument.nodeGraph) return "Nodemap";
  if (instrument.aether || instrument.kind === "wavetable") return "Aether";
  if (instrument.kind === "sampler") return "Sampler";
  if (instrument.kind === "synth") return "Basic";
  return titleCase(instrument.kind);
}

function formatInstrumentType(instrument: Instrument) {
  if (instrument.nodeGraph) return "Nodemap";
  if (instrument.kind === "sampler" || instrument.waveform === "sample") return "Sampler";
  if (instrument.aether || instrument.kind === "wavetable") return "Aether";
  if (instrument.kind === "synth") return "Basic";
  return titleCase(instrument.kind);
}

function taxonomyInstrumentOptions(instrument: Instrument) {
  const categoryId = instrument.taxonomy?.categoryId ?? "";
  return [
    { value: "", label: "Unassigned" },
    ...(categoryId ? instrumentTaxonomyOptionsForCategory(categoryId) : []),
  ];
}

function buildInstrumentUsageMap(projects: Project[]) {
  const instrumentIds = new Set<string>();
  for (const project of projects) {
    for (const track of project.tracks) {
      for (const segment of track.segments) {
        if (segment.instrumentId) instrumentIds.add(segment.instrumentId);
        if (segment.payload.kind === "drum") {
          for (const row of segment.payload.rows) {
            if (row.instrumentId) instrumentIds.add(row.instrumentId);
          }
        }
      }
    }
  }
  const usage: Record<string, InstrumentUsageSummary> = {};
  for (const instrumentId of instrumentIds) usage[instrumentId] = instrumentUsageSummary(instrumentId, projects);
  return usage;
}

function instrumentUsageSummary(instrumentId: string, projects: Project[]): InstrumentUsageSummary {
  let segmentCount = 0;
  const trackKeys = new Set<string>();
  const projectIds = new Set<string>();
  for (const project of projects) {
    for (const track of project.tracks) {
      for (const segment of track.segments) {
        const segmentUsesInstrument = segment.instrumentId === instrumentId;
        const drumUsesInstrument = segment.payload.kind === "drum"
          && segment.payload.rows.some((row) => row.instrumentId === instrumentId);
        if (!segmentUsesInstrument && !drumUsesInstrument) continue;
        segmentCount += 1;
        trackKeys.add(`${project.id}:${track.id}`);
        projectIds.add(project.id);
      }
    }
  }
  const projectCount = projectIds.size;
  return {
    projectCount,
    segmentCount,
    trackCount: trackKeys.size,
    projectLabel: `${projectCount} project${projectCount === 1 ? "" : "s"}`,
    segmentLabel: `${segmentCount} segment${segmentCount === 1 ? "" : "s"} / ${trackKeys.size} track${trackKeys.size === 1 ? "" : "s"}`,
  };
}

function titleCase(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function formatEnvelope(instrument: Instrument) {
  const { attackMs, decayMs, sustain, releaseMs } = instrument.envelope;
  return `A ${Math.round(attackMs)}ms / D ${Math.round(decayMs)}ms / S ${Math.round(sustain * 100)}% / R ${Math.round(releaseMs)}ms`;
}

function formatSampleCount(instrument: Instrument) {
  const count = instrument.sampleMap?.length ?? instrument.sampleUrls?.length ?? (instrument.sampleUrl ? 1 : 0);
  return count > 0 ? String(count) : "–";
}

function formatDb(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-inf dBFS";
  if (value <= -120) return "-inf dBFS";
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded.toFixed(1)} dBFS`;
}

function formatTruePeak(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-inf dBTP";
  return `${value.toFixed(1)} dBTP`;
}

function formatLufs(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-inf LUFS";
  return `${value.toFixed(1)} LUFS`;
}

function getPreviewContext(ref: RefValue<AudioContext | null>): AudioContext {
  if (ref.current) return ref.current;
  const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctor();
  ref.current = ctx;
  return ctx;
}
