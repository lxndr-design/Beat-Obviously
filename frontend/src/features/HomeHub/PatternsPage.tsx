import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ActionFooter, Button, HoverInfo, Icon, MarqueeText } from "../../components";
import { useComponentStore, type BeatComponent, type DrumComponent, type MidiComponent } from "../../state/components";
import { normalizeDrumCell } from "../../state/drumSteps";
import { useInstrumentStore, useProjectStore, useUiStore } from "../../state/store";
import type { Instrument } from "../../state/types";
import { playComponentPreview, stopComponentPlayback, type ComponentPlayback } from "../ComponentLibrary/ComponentLibraryPanel";
import { AssetBrowserRibbon, AssetPageShell, AssetStateMessage } from "./AssetPageShell";
import styles from "./PatternsPage.module.css";

type PatternKind = "midi" | "drum";

export function PatternsPage() {
  const components = useComponentStore((s) => s.components);
  const instruments = useInstrumentStore((s) => s.instruments);
  const bpm = useProjectStore((s) => s.project.bpm);
  const openEditor = useUiStore((s) => s.openEditor);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loopPreview, setLoopPreview] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewSpeed, setPreviewSpeed] = useState<1 | 2 | 3>(1);
  const playbackRef = useRef<ComponentPlayback | null>(null);
  const progressFrameRef = useRef<number | null>(null);
  const loopPreviewRef = useRef(loopPreview);

  const sorted = useMemo(
    () => [...components].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [components],
  );
  const active = sorted.find((component) => component.id === activeId) ?? sorted[0] ?? null;
  const activeReferenceIssue = active ? patternReferenceIssue(active, instruments) : null;

  useEffect(() => {
    if (activeId && !components.some((component) => component.id === activeId)) setActiveId(null);
  }, [activeId, components]);

  useEffect(() => () => {
    stopProgress();
    stopComponentPlayback(playbackRef.current);
  }, []);

  useEffect(() => {
    loopPreviewRef.current = loopPreview;
  }, [loopPreview]);

  function stopPreview() {
    stopProgress();
    stopComponentPlayback(playbackRef.current);
    playbackRef.current = null;
    setPlayingId(null);
  }

  function playPreview(component: BeatComponent, speed = previewSpeed) {
    stopProgress(false);
    stopComponentPlayback(playbackRef.current);
    startProgress(component, speed);
    playbackRef.current = playComponentPreview(component, instruments, bpm, () => {
      stopProgress(false);
      playbackRef.current = null;
      setPlayingId(null);
      if (loopPreviewRef.current) playPreview(component, speed);
      else setPreviewProgress(1);
    }, speed, 0);
    setPlayingId(component.id);
  }

  function stopProgress(reset = true) {
    if (progressFrameRef.current !== null) {
      cancelAnimationFrame(progressFrameRef.current);
      progressFrameRef.current = null;
    }
    if (reset) setPreviewProgress(0);
  }

  function startProgress(component: BeatComponent, speed = previewSpeed) {
    const started = performance.now();
    const durationMs = Math.max(120, (patternDurationSeconds(component, bpm) / speed) * 1000);
    setPreviewProgress(0);
    const tick = () => {
      const raw = Math.min(1, (performance.now() - started) / durationMs);
      setPreviewProgress(raw);
      if (raw < 1) progressFrameRef.current = requestAnimationFrame(tick);
    };
    progressFrameRef.current = requestAnimationFrame(tick);
  }

  function togglePreview(component: BeatComponent) {
    if (playingId === component.id) {
      stopPreview();
      return;
    }

    playPreview(component);
  }

  function cyclePreviewSpeed() {
    const nextSpeed = previewSpeed === 1 ? 2 : previewSpeed === 2 ? 3 : 1;
    setPreviewSpeed(nextSpeed);
    if (active && playingId === active.id) playPreview(active, nextSpeed);
  }

  function editActive() {
    if (!active) return;
    openEditor({ kind: "component", componentId: active.id });
  }

  return (
    <AssetPageShell
      browserLabel="Pattern browser"
      previewLabel="Pattern preview"
      previewClassName={styles.preview}
      browser={
        <>
        <AssetBrowserRibbon label="Patterns" count={components.length} />
        <div className={styles.table}>
          <div className={styles.headerRow}>
            <span>Name</span>
            <span>Status</span>
            <span>Type</span>
            <span>Length</span>
            <span>Items</span>
          </div>
          <div className={styles.rows}>
            {sorted.length === 0 ? (
              <div className={styles.emptyRow}>
                <AssetStateMessage
                  icon="ph:grid-four"
                  title="No Patterns"
                  body="Save MIDI or beat clips to build the project pattern library."
                />
              </div>
            ) : sorted.map((component) => {
              const issue = patternReferenceIssue(component, instruments);
              return (
                <button
                  key={component.id}
                  type="button"
                  className={`${styles.row} ${active?.id === component.id ? styles.rowActive : ""}`}
                  onClick={() => setActiveId(component.id)}
                  onDoubleClick={() => openEditor({ kind: "component", componentId: component.id })}
                >
                  <span className={styles.nameCell}>
                    <Icon name={componentIcon(component)} size={14} decorative />
                    <MarqueeText text={component.name} />
                  </span>
                  <span className={`${styles.referenceChip} ${issue ? styles.referenceWarning : styles.referenceManaged}`}>
                    {issue ? "Missing" : "Ready"}
                  </span>
                  <span>{componentLabel(component)}</span>
                  <span>{componentLength(component)}</span>
                  <span>{componentItemCount(component)}</span>
                </button>
              );
            })}
          </div>
        </div>
        </>
      }
      preview={
        <>
        {!active ? (
          <div className={styles.emptyPreview}>
            <AssetStateMessage
              icon="ph:grid-four"
              title="Select a Pattern"
              body="Choose a pattern to preview, inspect, or edit."
            />
          </div>
        ) : (
          <div className={styles.previewBody}>
            {activeReferenceIssue ? (
              <AssetStateMessage
                icon="ph:warning"
                title="Missing Instrument Reference"
                body={activeReferenceIssue}
                tone="warning"
              />
            ) : null}
            <PatternSegmentPreview component={active} instruments={instruments} progress={previewProgress} />
            <div className={styles.previewTitle}>
              <span className={styles.previewName}>
                <MarqueeText text={active.name} />
              </span>
              <span>{componentLabel(active)}</span>
            </div>
            <div className={styles.playbackBar} aria-hidden="true">
              <div className={styles.playbackBarFill} style={{ transform: `scaleX(${previewProgress})` }} />
              <div className={styles.playbackKnob} style={{ left: `${previewProgress * 100}%` }} />
            </div>
            <div className={styles.previewControls}>
              <HoverInfo content="Restart pattern">
                <Button iconOnly size="md" onClick={() => playPreview(active)} aria-label="Restart pattern">
                  <Icon name="ph:skip-back" size={14} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content={playingId === active.id ? "Pause pattern" : "Play pattern"}>
                <Button iconOnly size="md" selected={playingId === active.id} onClick={() => togglePreview(active)} aria-label={playingId === active.id ? "Pause pattern" : "Play pattern"}>
                  <Icon name={playingId === active.id ? "ph:pause-fill" : "ph:play-fill"} size={14} decorative />
                </Button>
              </HoverInfo>
              <HoverInfo content="Preview speed">
                <Button iconOnly size="md" onClick={cyclePreviewSpeed} aria-label={`Preview speed ${previewSpeed}x`}>
                  <span className={styles.timeButtonText}>{previewSpeed}x</span>
                </Button>
              </HoverInfo>
              <HoverInfo content="Loop pattern">
                <Button iconOnly size="md" selected={loopPreview} onClick={() => setLoopPreview((current) => !current)} aria-label="Loop pattern">
                  <Icon name="ph:repeat" size={14} decorative />
                </Button>
              </HoverInfo>
            </div>
            <ActionFooter className={styles.previewActions}>
              <Button className={styles.previewActionButton} variant="primary" onClick={editActive}>
                <Icon name="ph:pencil-simple" size={14} decorative />
                Edit Pattern
              </Button>
            </ActionFooter>
            <dl className={styles.details}>
              <div>
                <dt>Type</dt>
                <dd>{componentLabel(active)}</dd>
              </div>
              <div>
                <dt>Length</dt>
                <dd>{componentLength(active)}</dd>
              </div>
              <div>
                <dt>Contents</dt>
                <dd>{componentItemCount(active)}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{active.factory ? "Factory" : "User"}</dd>
              </div>
              <div>
                <dt>References</dt>
                <dd>{activeReferenceIssue ?? "All instruments available"}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(active.createdAt)}</dd>
              </div>
              <div>
                <dt>Editor</dt>
                <dd>{editorLabel(active)}</dd>
              </div>
            </dl>
          </div>
        )}
        </>
      }
    />
  );
}

function PatternSegmentPreview({
  component,
  instruments,
  progress,
}: {
  component: BeatComponent;
  instruments: Instrument[];
  progress: number;
}) {
  const kind = componentKind(component);
  const drumRows = kind === "drum" ? (component as DrumComponent).rows : [];
  const rowCount = kind === "drum"
    ? drumRows.length
    : Math.min(8, Math.max(2, (component as MidiComponent).notes.length));
  const stageMinHeight = kind === "drum"
    ? Math.max(126, Math.min(248, 76 + rowCount * 28))
    : 260;
  const blockHeight = kind === "drum"
    ? Math.max(76, Math.min(212, 28 + rowCount * 25))
    : 220;
  const stepWidth = kind === "drum" && (component as DrumComponent).stepCount > 32 ? 18 : 24;
  const contentWidth = kind === "drum"
    ? 0
    : Math.max(480, Math.round((component as MidiComponent).lengthBeats * 48));
  const style = {
    "--pattern-stage-min": `${stageMinHeight}px`,
    "--pattern-block-height": `${blockHeight}px`,
    "--pattern-progress": `${Math.max(0, Math.min(1, progress))}`,
    "--pattern-label-width": kind === "drum" ? "144px" : "0px",
    "--pattern-step-width": `${stepWidth}px`,
    "--pattern-content-width": `${contentWidth}px`,
  } as CSSProperties;
  return (
    <div className={styles.segmentStage} style={style}>
      <div className={styles.segmentBlock}>
        <div className={styles.segmentHeader}>
          <span>{component.name}</span>
          <Icon name={componentIcon(component)} size={16} decorative />
        </div>
        {kind === "midi" ? <div className={styles.segmentPlayhead} aria-hidden /> : null}
        {kind === "drum"
          ? <DrumPatternPreview component={component as DrumComponent} instruments={instruments} progress={progress} />
          : <MidiPatternPreview component={component as MidiComponent} />}
      </div>
    </div>
  );
}

function MidiPatternPreview({ component }: { component: MidiComponent }) {
  const notes = component.notes.slice(0, 256);
  const minPitch = notes.length ? Math.min(...notes.map((note) => note.pitch)) : 48;
  const maxPitch = notes.length ? Math.max(...notes.map((note) => note.pitch)) : 72;
  const pitchSpan = Math.max(1, maxPitch - minPitch);

  return (
    <div className={styles.previewGrid}>
      <div className={styles.midiPreviewContent}>
        {notes.map((note, index) => {
          const left = (note.startBeat / Math.max(1, component.lengthBeats)) * 100;
          const width = (note.lengthBeats / Math.max(1, component.lengthBeats)) * 100;
          const top = (1 - (note.pitch - minPitch) / pitchSpan) * 72 + 8;
          return (
            <span
              // eslint-disable-next-line react/no-array-index-key
              key={`${note.startBeat}-${note.pitch}-${index}`}
              className={styles.noteBlock}
              style={{
                left: `${Math.max(0, Math.min(98, left))}%`,
                width: `${Math.max(1.5, Math.min(100 - left, width))}%`,
                top: `${top}%`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function DrumPatternPreview({
  component,
  instruments,
  progress,
}: {
  component: DrumComponent;
  instruments: Instrument[];
  progress: number;
}) {
  const columns = Math.max(1, component.stepCount);
  const stepWidth = columns > 32 ? 18 : 24;
  const clampedProgress = Math.max(0, Math.min(1, progress));
  return (
    <div className={styles.drumMatrix}>
      <div className={styles.drumLabels}>
        {component.rows.map((row) => (
          <span key={row.id} className={styles.drumMatrixLabel} title={instrumentDisplayName(row.instrumentId, row.name, instruments)}>
            {instrumentDisplayName(row.instrumentId, row.name, instruments)}
          </span>
        ))}
      </div>
      <div className={styles.drumStepsViewport}>
        <div className={styles.drumStepsContent} style={{ width: columns * stepWidth }}>
          <span className={styles.drumStepPlayhead} style={{ left: clampedProgress * columns * stepWidth }} aria-hidden />
          {component.rows.map((row, rowIndex) => (
            <div
              key={row.id}
              className={styles.drumMatrixRow}
              style={{ gridTemplateColumns: `repeat(${columns}, var(--pattern-step-width))` }}
            >
              {Array.from({ length: columns }, (_, stepIndex) => {
                const cell = normalizeDrumCell(row.steps[stepIndex]);
                return (
                  <span
                    // eslint-disable-next-line react/no-array-index-key
                    key={`${rowIndex}-${stepIndex}`}
                    className={`${styles.drumMatrixCell} ${cell.on ? styles.drumMatrixCellOn : ""}`}
                    style={cell.on ? { opacity: 0.4 + Math.max(0, Math.min(127, cell.velocity ?? 96)) / 210 } : undefined}
                  />
                );
              })}
            </div>
          ))}
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
  return componentKind(component) === "drum" ? "ph:drum" : "ph:piano-keys";
}

function componentLabel(component: BeatComponent): string {
  return componentKind(component) === "drum" ? "Beat" : "MIDI";
}

function editorLabel(component: BeatComponent): string {
  return componentKind(component) === "drum" ? "Beat editor" : "MIDI editor";
}

function componentLength(component: BeatComponent): string {
  const beats = component.kind === "drum"
    ? component.lengthBeats / Math.max(1, component.speed)
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

function patternDurationSeconds(component: BeatComponent, bpm: number): number {
  const secondsPerBeat = 60 / Math.max(1, bpm);
  return Math.max(0.1, (component.kind === "drum" ? component.lengthBeats / component.speed : component.lengthBeats) * secondsPerBeat);
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
