import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { ActionFooter, Button, HoverInfo, Icon, MarqueeText } from "../../solid-ui";
import { useComponentStore, type BeatComponent, type DrumComponent, type MidiComponent } from "../../state/components";
import {
  drumPlaybackDurationBeats,
  drumPlaybackDurationSeconds,
  drumPlaybackStepLengthBeats,
  drumTimingOffsetBeats,
  normalizeDrumCell,
} from "../../state/drumSteps";
import { useInstrumentStore, useProjectStore, useUiStore } from "../../state/store";
import type { Instrument } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { playComponentPreview, stopComponentPlayback, type ComponentPlayback } from "../ComponentLibrary/ComponentLibraryPanel.solid";
import { AssetBrowserRibbon, AssetPageShell, AssetStateMessage } from "./AssetPageShell.solid";
import styles from "./PatternsPage.module.css";

type PatternKind = "midi" | "drum";

export function PatternsPage() {
  const components = createStoreSelector(useComponentStore, (s) => s.components);
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const bpm = createStoreSelector(useProjectStore, (s) => s.project.bpm);
  const openEditor = useUiStore.getState().openEditor;
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [playingId, setPlayingId] = createSignal<string | null>(null);
  const [loopPreview, setLoopPreview] = createSignal(false);
  const [previewProgress, setPreviewProgress] = createSignal(0);
  const [previewSpeed, setPreviewSpeed] = createSignal<1 | 2 | 3>(1);
  let playback: ComponentPlayback | null = null;
  let progressFrame: number | null = null;

  const sorted = createMemo(() => [...components()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
  const active = createMemo(() => sorted().find((component) => component.id === activeId()) ?? sorted()[0] ?? null);
  const activeReferenceIssue = createMemo(() => active() ? patternReferenceIssue(active()!, instruments()) : null);

  createEffect(() => {
    if (activeId() && !components().some((component) => component.id === activeId())) setActiveId(null);
  });

  onCleanup(() => {
    stopProgress();
    stopComponentPlayback(playback);
  });

  function stopPreview() {
    stopProgress();
    stopComponentPlayback(playback);
    playback = null;
    setPlayingId(null);
  }

  function playPreview(component: BeatComponent, playbackRate = previewSpeed()) {
    stopProgress(false);
    stopComponentPlayback(playback);
    startProgress(component, playbackRate);
    playback = playComponentPreview(component, instruments(), bpm(), () => {
      stopProgress(false);
      playback = null;
      setPlayingId(null);
      if (loopPreview()) playPreview(component, playbackRate);
      else setPreviewProgress(1);
    }, playbackRate, 0);
    setPlayingId(component.id);
  }

  function stopProgress(reset = true) {
    if (progressFrame !== null) {
      cancelAnimationFrame(progressFrame);
      progressFrame = null;
    }
    if (reset) setPreviewProgress(0);
  }

  function startProgress(component: BeatComponent, playbackRate = previewSpeed()) {
    const started = performance.now();
    const durationMs = Math.max(120, patternDurationSeconds(component, bpm(), playbackRate) * 1000);
    setPreviewProgress(0);
    const tick = () => {
      const raw = Math.min(1, (performance.now() - started) / durationMs);
      setPreviewProgress(raw);
      if (raw < 1) progressFrame = requestAnimationFrame(tick);
    };
    progressFrame = requestAnimationFrame(tick);
  }

  function togglePreview(component: BeatComponent) {
    if (playingId() === component.id) {
      stopPreview();
      return;
    }
    playPreview(component);
  }

  function cyclePreviewSpeed() {
    const nextSpeed = previewSpeed() === 1 ? 2 : previewSpeed() === 2 ? 3 : 1;
    setPreviewSpeed(nextSpeed);
    const currentActive = active();
    if (currentActive && playingId() === currentActive.id) playPreview(currentActive, nextSpeed);
  }

  function editActive() {
    const currentActive = active();
    if (currentActive) openEditor({ kind: "component", componentId: currentActive.id });
  }

  return (
    <AssetPageShell
      browserLabel="Pattern browser"
      previewLabel="Pattern preview"
      previewClassName={styles.preview}
      browser={
        <>
          <AssetBrowserRibbon label="Patterns" count={components().length} />
          <div class={styles.table}>
            <div class={styles.headerRow}>
              <span>Name</span>
              <span>Status</span>
              <span>Type</span>
              <span>Length</span>
              <span>Items</span>
            </div>
            <div class={styles.rows}>
              <Show
                when={sorted().length > 0}
                fallback={
                  <div class={styles.emptyRow}>
                    <AssetStateMessage
                      icon="ph:grid-four"
                      title="No Patterns"
                      body="Save MIDI or beat clips to build the project pattern library."
                    />
                  </div>
                }
              >
                <For each={sorted()}>
                  {(component) => {
                    const issue = () => patternReferenceIssue(component, instruments());
                    return (
                      <Button
                        variant="ghost"
                        selected={active()?.id === component.id}
                        class={styles.row}
                        onClick={() => setActiveId(component.id)}
                        onDblClick={() => openEditor({ kind: "component", componentId: component.id })}
                      >
                        <span class={styles.nameCell}>
                          <Icon name={componentIcon(component)} size={18} decorative />
                          <MarqueeText text={component.name} />
                        </span>
                        <span class={`${styles.referenceChip} ${issue() ? styles.referenceWarning : styles.referenceManaged}`}>
                          {issue() ? "Missing" : "Ready"}
                        </span>
                        <span>{componentLabel(component)}</span>
                        <span>{componentLength(component)}</span>
                        <span>{componentItemCount(component)}</span>
                      </Button>
                    );
                  }}
                </For>
              </Show>
            </div>
          </div>
        </>
      }
      preview={
        <Show
          when={active()}
          fallback={
            <div class={styles.emptyPreview}>
              <AssetStateMessage
                icon="ph:grid-four"
                title="Select a Pattern"
                body="Choose a pattern to preview, inspect, or edit."
              />
            </div>
          }
        >
          {(currentActive) => (
            <div class={styles.previewBody}>
              <Show when={activeReferenceIssue()}>
                <AssetStateMessage
                  icon="ph:warning"
                  title="Missing Instrument Reference"
                  body={activeReferenceIssue() ?? undefined}
                  tone="warning"
                />
              </Show>
              <PatternSegmentPreview component={currentActive()} instruments={instruments()} progress={previewProgress()} />
              <div class={styles.previewTitle}>
                <span class={styles.previewName}>
                  <MarqueeText text={currentActive().name} />
                </span>
                <span>{componentLabel(currentActive())}</span>
              </div>
              <div class={styles.playbackBar} aria-hidden="true">
                <div class={styles.playbackBarFill} style={{ transform: `scaleX(${previewProgress()})` }} />
                <div class={styles.playbackKnob} style={{ left: `${previewProgress() * 100}%` }} />
              </div>
              <div class={styles.previewControls}>
                <HoverInfo content="Restart pattern">
                  <Button iconOnly size="md" onClick={() => playPreview(currentActive())} aria-label="Restart pattern">
                    <Icon name="ph:skip-back" size={18} decorative />
                  </Button>
                </HoverInfo>
                <HoverInfo content={playingId() === currentActive().id ? "Pause pattern" : "Play pattern"}>
                  <Button
                    iconOnly
                    size="md"
                    selected={playingId() === currentActive().id}
                    onClick={() => togglePreview(currentActive())}
                    aria-label={playingId() === currentActive().id ? "Pause pattern" : "Play pattern"}
                  >
                    <Icon name={playingId() === currentActive().id ? "ph:pause-fill" : "ph:play-fill"} size={18} decorative />
                  </Button>
                </HoverInfo>
                <HoverInfo content="Preview speed">
                  <Button iconOnly size="md" onClick={cyclePreviewSpeed} aria-label={`Preview speed ${previewSpeed()}x`}>
                    <span class={styles.timeButtonText}>{previewSpeed()}x</span>
                  </Button>
                </HoverInfo>
                <HoverInfo content="Loop pattern">
                  <Button iconOnly size="md" selected={loopPreview()} onClick={() => setLoopPreview((current) => !current)} aria-label="Loop pattern">
                    <Icon name="ph:repeat" size={18} decorative />
                  </Button>
                </HoverInfo>
              </div>
              <ActionFooter className={styles.previewActions}>
                <Button className={styles.previewActionButton} variant="primary" onClick={editActive}>
                  <Icon name="ph:pencil-simple" size={18} decorative />
                  Edit Pattern
                </Button>
              </ActionFooter>
              <dl class={styles.details}>
                <div>
                  <dt>Type</dt>
                  <dd>{componentLabel(currentActive())}</dd>
                </div>
                <div>
                  <dt>Length</dt>
                  <dd>{componentLength(currentActive())}</dd>
                </div>
                <div>
                  <dt>Contents</dt>
                  <dd>{componentItemCount(currentActive())}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{currentActive().factory ? "Factory" : "User"}</dd>
                </div>
                <div>
                  <dt>References</dt>
                  <dd>{activeReferenceIssue() ?? "All instruments available"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(currentActive().createdAt)}</dd>
                </div>
                <div>
                  <dt>Editor</dt>
                  <dd>{editorLabel(currentActive())}</dd>
                </div>
              </dl>
            </div>
          )}
        </Show>
      }
    />
  );
}

function PatternSegmentPreview(props: {
  component: BeatComponent;
  instruments: Instrument[];
  progress: number;
}) {
  const kind = () => componentKind(props.component);
  const drumRows = () => kind() === "drum" ? (props.component as DrumComponent).rows : [];
  const rowCount = () => kind() === "drum"
    ? drumRows().length
    : Math.min(8, Math.max(2, (props.component as MidiComponent).notes.length));
  const stageMinHeight = () => kind() === "drum"
    ? Math.max(126, Math.min(248, 76 + rowCount() * 28))
    : 260;
  const blockHeight = () => kind() === "drum"
    ? Math.max(76, Math.min(212, 28 + rowCount() * 25))
    : 220;
  const stepWidth = () => kind() === "drum" && (props.component as DrumComponent).stepCount > 32 ? 18 : 24;
  const contentWidth = () => kind() === "drum"
    ? 0
    : Math.max(480, Math.round((props.component as MidiComponent).lengthBeats * 48));
  const stageStyle = (): JSX.CSSProperties => ({
    "--pattern-stage-min": `${stageMinHeight()}px`,
    "--pattern-block-height": `${blockHeight()}px`,
    "--pattern-progress": `${Math.max(0, Math.min(1, props.progress))}`,
    "--pattern-label-width": kind() === "drum" ? "144px" : "0px",
    "--pattern-step-width": `${stepWidth()}px`,
    "--pattern-content-width": `${contentWidth()}px`,
  });

  return (
    <div class={styles.segmentStage} style={stageStyle()}>
      <div class={styles.segmentBlock}>
        <div class={styles.segmentHeader}>
          <span>{props.component.name}</span>
          <Icon name={componentIcon(props.component)} size={18} decorative />
        </div>
        <Show when={kind() === "midi"}>
          <div class={styles.segmentPlayhead} aria-hidden />
        </Show>
        <Show
          when={kind() === "drum"}
          fallback={<MidiPatternPreview component={props.component as MidiComponent} />}
        >
          <DrumPatternPreview component={props.component as DrumComponent} instruments={props.instruments} progress={props.progress} />
        </Show>
      </div>
    </div>
  );
}

function MidiPatternPreview(props: { component: MidiComponent }) {
  const notes = () => props.component.notes.slice(0, 256);
  const minPitch = () => notes().length ? Math.min(...notes().map((note) => note.pitch)) : 48;
  const maxPitch = () => notes().length ? Math.max(...notes().map((note) => note.pitch)) : 72;
  const pitchSpan = () => Math.max(1, maxPitch() - minPitch());

  return (
    <div class={styles.previewGrid}>
      <div class={styles.midiPreviewContent}>
        <For each={notes()}>
          {(note, index) => {
            const left = () => (note.startBeat / Math.max(1, props.component.lengthBeats)) * 100;
            const width = () => (note.lengthBeats / Math.max(1, props.component.lengthBeats)) * 100;
            const top = () => (1 - (note.pitch - minPitch()) / pitchSpan()) * 72 + 8;
            return (
              <span
                class={styles.noteBlock}
                style={{
                  left: `${Math.max(0, Math.min(98, left()))}%`,
                  width: `${Math.max(1.5, Math.min(100 - left(), width()))}%`,
                  top: `${top()}%`,
                }}
                data-index={index()}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}

function DrumPatternPreview(props: {
  component: DrumComponent;
  instruments: Instrument[];
  progress: number;
}) {
  const effectiveLength = () => drumPlaybackDurationBeats(props.component.lengthBeats, props.component.speed);
  const columns = () => Math.max(1, props.component.stepCount);
  const contentWidth = () => Math.max(280, Math.round(effectiveLength() * 96));
  const clampedProgress = () => Math.max(0, Math.min(1, props.progress));

  return (
    <div class={styles.drumMatrix}>
      <div class={styles.drumLabels}>
        <For each={props.component.rows}>
          {(row) => (
            <span class={styles.drumMatrixLabel} title={instrumentDisplayName(row.instrumentId, row.name, props.instruments)}>
              {instrumentDisplayName(row.instrumentId, row.name, props.instruments)}
            </span>
          )}
        </For>
      </div>
      <div class={styles.drumStepsViewport}>
        <div class={styles.drumStepsContent} style={{ width: `${contentWidth()}px` }}>
          <span class={styles.drumStepPlayhead} style={{ left: `${clampedProgress() * contentWidth()}px` }} aria-hidden />
          <For each={props.component.rows}>
            {(row, rowIndex) => (
              <div class={styles.drumMatrixRow}>
                <For each={Array.from({ length: columns() }, (_, stepIndex) => stepIndex)}>
                  {(stepIndex) => {
                    const cell = () => normalizeDrumCell(row.steps[stepIndex]);
                    const x = () => {
                      const stepLength = drumPlaybackStepLengthBeats(props.component.lengthBeats, props.component.stepCount, props.component.speed);
                      const beat = Math.max(
                        0,
                        Math.min(
                          effectiveLength(),
                          stepIndex * stepLength + drumTimingOffsetBeats(stepIndex, stepLength, props.component.swingPercent, cell().leanPercent),
                        ),
                      );
                      return (beat / effectiveLength()) * 100;
                    };
                    return (
                      <span
                        class={`${styles.drumMatrixCell} ${cell().on ? styles.drumMatrixCellOn : ""}`}
                        style={{
                          left: `${x()}%`,
                          opacity: cell().on ? `${0.4 + Math.max(0, Math.min(127, cell().velocity ?? 96)) / 210}` : "0.18",
                        }}
                        data-row={rowIndex()}
                        data-step={stepIndex}
                      />
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

function instrumentDisplayName(instrumentId: string | undefined, fallback: string, instruments: Instrument[]): string {
  return instruments.find((instrument) => instrument.id === instrumentId)?.name ?? fallback;
}

function componentKind(component: BeatComponent): PatternKind {
  return component.kind === "drum" ? "drum" : "midi";
}

function componentIcon(component: BeatComponent): string {
  return componentKind(component) === "drum" ? "ph:music-notes-simple" : "ph:piano-keys";
}

function componentLabel(component: BeatComponent): string {
  return componentKind(component) === "drum" ? "Beat" : "MIDI";
}

function editorLabel(component: BeatComponent): string {
  return componentKind(component) === "drum" ? "Beat editor" : "MIDI editor";
}

function componentLength(component: BeatComponent): string {
  const beats = component.kind === "drum"
    ? drumPlaybackDurationBeats(component.lengthBeats, component.speed)
    : component.lengthBeats;
  return `${formatNumber(beats)} beats`;
}

function componentItemCount(component: BeatComponent): string {
  if (component.kind === "drum") {
    const hits = component.rows.reduce((sum, row) => sum + row.steps.filter((step) => normalizeDrumCell(step).on).length, 0);
    return `${hits} hit${hits === 1 ? "" : "s"}`;
  }
  const count = component.notes.length;
  return `${count} note${count === 1 ? "" : "s"}`;
}

function patternDurationSeconds(component: BeatComponent, bpm: number, playbackRate = 1): number {
  const secondsPerBeat = 60 / Math.max(1, bpm);
  return component.kind === "drum"
    ? drumPlaybackDurationSeconds(component.lengthBeats, bpm, component.speed, playbackRate)
    : Math.max(0.1, (component.lengthBeats * secondsPerBeat) / Math.max(0.25, playbackRate));
}

function patternReferenceIssue(component: BeatComponent, instruments: Instrument[]): string | null {
  const known = new Set(instruments.map((instrument) => instrument.id));
  if (component.kind === "drum") {
    const missingRows = component.rows.filter((row) => row.instrumentId && !known.has(row.instrumentId));
    if (missingRows.length === 0) return null;
    const names = missingRows.map((row) => row.name).slice(0, 2).join(", ");
    return `${missingRows.length} drum row${missingRows.length === 1 ? "" : "s"} reference missing instrument${missingRows.length === 1 ? "" : "s"}${names ? `: ${names}` : ""}.`;
  }
  if (component.instrumentId && !known.has(component.instrumentId)) {
    return "This MIDI pattern references an instrument that is no longer in the library.";
  }
  return null;
}

function formatDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(ms));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
