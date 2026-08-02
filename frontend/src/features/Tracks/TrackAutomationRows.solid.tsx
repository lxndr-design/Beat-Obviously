import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import {
  AETHER_ARRANGEMENT_AUTOMATION_TARGETS,
  aetherArrangementAutomationTargetLabel,
  aetherArrangementAutomationTargetMeta,
  clearTrackAutomationTarget,
  formatAetherArrangementAutomationValue,
  insertTrackAutomationPoint,
  updateTrackAutomationPoint,
  upsertTrackAutomationTarget,
  type AetherArrangementAutomationTarget,
} from "../../automation/aetherArrangementAutomation";
import { evaluateAutomationCurve } from "../../automation/curves";
import { createStoreSelector } from "../../solid-utils/store";
import { Button, FloatingSelect, HoverInfo, Icon } from "../../solid-ui";
import { useProjectStore, useSettingsStore, useUiStore, useViewStore } from "../../state/store";
import type { Id, MidiAutomationLane, Track } from "../../state/types";
import styles from "./TrackAutomationRows.module.css";

const GROUP_ROW_HEIGHT = 27;
const VALUE_ROW_HEIGHT = 44;

interface TrackAutomationRowsProps {
  trackId: Id;
  expanded: boolean;
  onToggle: () => void;
}

export function TrackAutomationHeaderRows(props: TrackAutomationRowsProps) {
  const track = createStoreSelector(useProjectStore, (state) => state.project.tracks.find((candidate) => candidate.id === props.trackId));
  const lengthBeats = createStoreSelector(useProjectStore, (state) => state.project.lengthBeats);
  const [addOpen, setAddOpen] = createSignal(false);
  const activeTargets = createMemo(() => activeTrackAutomationTargets(track()));
  const availableOptions = createMemo(() => {
    const active = new Set(activeTargets());
    return [
      { value: "", label: active.size === AETHER_ARRANGEMENT_AUTOMATION_TARGETS.length ? "All parameters added" : "+ Add lane", disabled: true },
      ...AETHER_ARRANGEMENT_AUTOMATION_TARGETS
        .filter((candidate) => !active.has(candidate.target))
        .map((candidate) => ({ value: candidate.target, label: candidate.label })),
    ];
  });

  function addLane(value: string) {
    const current = track();
    if (!current || !value) return;
    const next = upsertTrackAutomationTarget(current, value as AetherArrangementAutomationTarget, lengthBeats());
    useProjectStore.getState().updateTrack(props.trackId, { automation: next.automation });
  }

  function removeLane(target: AetherArrangementAutomationTarget) {
    const current = track();
    if (!current) return;
    const next = clearTrackAutomationTarget(current, target);
    useProjectStore.getState().updateTrack(props.trackId, { automation: next.automation });
  }

  function openFullEditor(target?: AetherArrangementAutomationTarget) {
    useUiStore.getState().openEditor({ kind: "trackAutomation", trackId: props.trackId, target });
  }

  return (
    <Show when={props.expanded && track()}>
      <div class={styles.groupHeader} data-track-automation-header={props.trackId}>
        <button type="button" class={styles.disclosure} onClick={props.onToggle} aria-label="Hide automation lanes">
          <Icon name="ph:caret-down" size={18} decorative />
        </button>
        <button type="button" class={styles.groupTitle} onDblClick={() => openFullEditor()}>
          Instrument automation
        </button>
        <FloatingSelect
          className={styles.addSelect}
          triggerClassName={styles.addSelectTrigger}
          layout="bare"
          value=""
          options={availableOptions()}
          open={addOpen()}
          disabled={availableOptions().length <= 1}
          searchable
          searchPlaceholder="Find parameter"
          ariaLabel="Add instrument automation lane"
          onOpenChange={setAddOpen}
          onChange={addLane}
        />
      </div>
      <For each={activeTargets()}>
        {(target) => (
          <div class={styles.valueHeader} data-track-automation-value-header={target}>
            <span class={styles.valueHeaderIcon}><Icon name="ph:arrow-elbow-down-right" size={18} decorative /></span>
            <button type="button" class={styles.valueHeaderTitle} onDblClick={() => openFullEditor(target)}>
              {aetherArrangementAutomationTargetLabel(target)}
            </button>
            <HoverInfo content={`Remove ${aetherArrangementAutomationTargetLabel(target)} automation`}>
              <Button
                iconOnly
                size="xs"
                variant="ghost"
                aria-label={`Remove ${aetherArrangementAutomationTargetLabel(target)} automation lane`}
                onClick={() => removeLane(target)}
              >
                <Icon name="ph:x" size={18} decorative />
              </Button>
            </HoverInfo>
          </div>
        )}
      </For>
    </Show>
  );
}

export function TrackAutomationLaneRows(props: TrackAutomationRowsProps) {
  const track = createStoreSelector(useProjectStore, (state) => state.project.tracks.find((candidate) => candidate.id === props.trackId));
  const lengthBeats = createStoreSelector(useProjectStore, (state) => state.project.lengthBeats);
  const timeSignature = createStoreSelector(useProjectStore, (state) => state.project.timeSignature);
  const beatsToPx = createStoreSelector(useViewStore, (state) => state.beatsToPx);
  const activeTargets = createMemo(() => activeTrackAutomationTargets(track()));

  function openFullEditor() {
    useUiStore.getState().openEditor({ kind: "trackAutomation", trackId: props.trackId });
  }

  return (
    <Show when={props.expanded && track()}>
      <div
        class={styles.groupLane}
        style={{ width: `${lengthBeats() * beatsToPx()}px` }}
        data-track-automation-summary={props.trackId}
        aria-label={`${track()?.name ?? "Track"} instrument automation summary`}
        onDblClick={openFullEditor}
      >
        <BeatGrid lengthBeats={lengthBeats()} beatsToPx={beatsToPx()} />
        <For each={activeTargets()}>
          {(target) => (
            <AutomationCurve
              lane={track()?.automation?.find((candidate) => candidate.target === target)}
              target={target}
              lengthBeats={lengthBeats()}
              beatsToPx={beatsToPx()}
              height={GROUP_ROW_HEIGHT}
              summary
            />
          )}
        </For>
        <Show when={activeTargets().length === 0}>
          <span class={styles.emptySummary}>Add a parameter from the track header</span>
        </Show>
      </div>
      <For each={activeTargets()}>
        {(target) => (
          <TrackAutomationValueLane
            trackId={props.trackId}
            target={target}
            lengthBeats={lengthBeats()}
            beatsToPx={beatsToPx()}
            beatsPerBar={timeSignature().num}
          />
        )}
      </For>
    </Show>
  );
}

function TrackAutomationValueLane(props: {
  trackId: Id;
  target: AetherArrangementAutomationTarget;
  lengthBeats: number;
  beatsToPx: number;
  beatsPerBar: number;
}) {
  let laneElement: HTMLDivElement | undefined;
  let releaseDrag: (() => void) | undefined;
  const track = createStoreSelector(useProjectStore, (state) => state.project.tracks.find((candidate) => candidate.id === props.trackId));
  const timelineSmartGrid = createStoreSelector(useSettingsStore, (state) => state.timelineSmartGrid);
  const timelineSubdivision = createStoreSelector(useSettingsStore, (state) => state.timelineSubdivision);
  const [selectedPointIndex, setSelectedPointIndex] = createSignal<number | null>(null);
  const [draggingPointIndex, setDraggingPointIndex] = createSignal<number | null>(null);
  const lane = createMemo(() => track()?.automation?.find((candidate) => candidate.target === props.target));
  const meta = createMemo(() => aetherArrangementAutomationTargetMeta(props.target));
  onCleanup(() => releaseDrag?.());

  function updateAutomation(nextTrack: Track) {
    useProjectStore.getState().updateTrack(props.trackId, { automation: nextTrack.automation });
  }

  function pointerValue(clientX: number, clientY: number, snapTime: boolean) {
    const rect = laneElement?.getBoundingClientRect();
    if (!rect) return null;
    const rawBeat = clamp((clientX - rect.left) / Math.max(1, props.beatsToPx), 0, props.lengthBeats);
    const gridStep = timelineSmartGrid() ? 4 / Math.max(1, timelineSubdivision()) : 1;
    const beat = snapTime ? clamp(Math.round(rawBeat / gridStep) * gridStep, 0, props.lengthBeats) : rawBeat;
    const normalized = 1 - clamp((clientY - rect.top - 4) / Math.max(1, VALUE_ROW_HEIGHT - 8), 0, 1);
    const rawValue = meta().min + normalized * (meta().max - meta().min);
    const value = Math.round(rawValue / meta().step) * meta().step;
    return { beat, value: clamp(value, meta().min, meta().max) };
  }

  function addPoint(event: MouseEvent) {
    if ((event.target as Element).closest("[data-track-automation-point]")) return;
    event.preventDefault();
    event.stopPropagation();
    const current = track();
    const next = pointerValue(event.clientX, event.clientY, event.shiftKey);
    if (!current || !next) return;
    const nextTrack = insertTrackAutomationPoint(current, props.target, props.lengthBeats, next.beat, next.value);
    updateAutomation(nextTrack);
    const nextLane = nextTrack.automation?.find((candidate) => candidate.target === props.target);
    const nextIndex = nearestPointIndex(nextLane, next.beat, next.value);
    setSelectedPointIndex(nextIndex);
  }

  function startPointDrag(event: PointerEvent, pointIndex: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    releaseDrag?.();
    setSelectedPointIndex(pointIndex);
    setDraggingPointIndex(pointIndex);

    const move = (moveEvent: PointerEvent) => {
      const current = track();
      const currentLane = current?.automation?.find((candidate) => candidate.target === props.target);
      const next = pointerValue(moveEvent.clientX, moveEvent.clientY, moveEvent.shiftKey);
      if (!current || !currentLane || !next) return;
      const previousBeat = pointIndex > 0 ? (currentLane.points[pointIndex - 1]?.beat ?? 0) + 0.001 : 0;
      const followingBeat = pointIndex < currentLane.points.length - 1
        ? (currentLane.points[pointIndex + 1]?.beat ?? props.lengthBeats) - 0.001
        : props.lengthBeats;
      updateAutomation(updateTrackAutomationPoint(
        current,
        props.target,
        props.lengthBeats,
        pointIndex,
        clamp(next.beat, previousBeat, followingBeat),
        next.value,
      ));
    };
    const stop = (upEvent: PointerEvent) => {
      move(upEvent);
      setDraggingPointIndex(null);
      releaseDrag?.();
    };
    releaseDrag = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      releaseDrag = undefined;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  return (
    <div
      ref={laneElement}
      class={styles.valueLane}
      style={{ width: `${props.lengthBeats * props.beatsToPx}px` }}
      data-track-automation-lane={props.target}
      aria-label={`${aetherArrangementAutomationTargetLabel(props.target)} automation lane`}
      onDblClick={addPoint}
    >
      <BeatGrid lengthBeats={props.lengthBeats} beatsToPx={props.beatsToPx} />
      <AutomationCurve
        lane={lane()}
        target={props.target}
        lengthBeats={props.lengthBeats}
        beatsToPx={props.beatsToPx}
        height={VALUE_ROW_HEIGHT}
      />
      <For each={lane()?.points ?? []}>
        {(point, index) => (
          <button
            type="button"
            class={styles.point}
            classList={{
              [styles.pointSelected]: selectedPointIndex() === index(),
              [styles.pointDragging]: draggingPointIndex() === index(),
            }}
            style={{
              left: `${point.beat * props.beatsToPx}px`,
              top: `${automationValueToY(props.target, point.value, VALUE_ROW_HEIGHT)}px`,
            }}
            title={`${formatMusicalBeat(point.beat, props.beatsPerBar)} · ${formatAetherArrangementAutomationValue(props.target, point.value)}`}
            aria-label={`${aetherArrangementAutomationTargetLabel(props.target)} ${formatAetherArrangementAutomationValue(props.target, point.value)} at ${formatMusicalBeat(point.beat, props.beatsPerBar)}`}
            data-track-automation-point={`${props.target}:${index()}`}
            onPointerDown={(event) => startPointDrag(event, index())}
          />
        )}
      </For>
    </div>
  );
}

function AutomationCurve(props: {
  lane: MidiAutomationLane | undefined;
  target: AetherArrangementAutomationTarget;
  lengthBeats: number;
  beatsToPx: number;
  height: number;
  summary?: boolean;
}) {
  const points = createMemo(() => automationPolyline(props.lane, props.target, props.lengthBeats, props.beatsToPx, props.height));
  return (
    <svg
      class={`${styles.curve} ${props.summary ? styles.curveSummary : ""}`}
      viewBox={`0 0 ${Math.max(1, props.lengthBeats * props.beatsToPx)} ${props.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline class={styles.curveLine} points={points()} />
    </svg>
  );
}

function BeatGrid(props: { lengthBeats: number; beatsToPx: number }) {
  return (
    <For each={Array.from({ length: Math.floor(props.lengthBeats) + 1 }, (_, beat) => beat)}>
      {(beat) => (
        <span
          class={`${styles.gridLine} ${beat % 4 === 0 ? styles.gridLineMajor : ""}`}
          style={{ left: `${beat * props.beatsToPx}px` }}
        />
      )}
    </For>
  );
}

function activeTrackAutomationTargets(track: Track | undefined): AetherArrangementAutomationTarget[] {
  const active = new Set((track?.automation ?? []).filter((lane) => lane.points.length > 0).map((lane) => lane.target));
  return AETHER_ARRANGEMENT_AUTOMATION_TARGETS
    .filter((candidate) => active.has(candidate.target))
    .map((candidate) => candidate.target);
}

function automationPolyline(
  lane: MidiAutomationLane | undefined,
  target: AetherArrangementAutomationTarget,
  lengthBeats: number,
  beatsToPx: number,
  height: number,
): string {
  if (!lane?.points.length) return "";
  const sorted = [...lane.points].sort((a, b) => a.beat - b.beat);
  const rendered: Array<{ beat: number; value: number }> = [];
  const first = sorted[0]!;
  if (first.beat > 0) rendered.push({ beat: 0, value: first.value });
  rendered.push({ beat: first.beat, value: first.value });
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index]!;
    const end = sorted[index + 1]!;
    const steps = start.curve === "hold" ? 1 : 12;
    for (let step = 1; step <= steps; step += 1) {
      const mix = step / steps;
      rendered.push({
        beat: start.beat + (end.beat - start.beat) * mix,
        value: evaluateAutomationCurve(start.curve, start.value, end.value, mix),
      });
    }
  }
  const last = sorted[sorted.length - 1]!;
  if (last.beat < lengthBeats) rendered.push({ beat: lengthBeats, value: last.value });
  return rendered
    .map((point) => `${(point.beat * beatsToPx).toFixed(2)},${automationValueToY(target, point.value, height).toFixed(2)}`)
    .join(" ");
}

function automationValueToY(target: AetherArrangementAutomationTarget, value: number, height: number): number {
  const meta = aetherArrangementAutomationTargetMeta(target);
  const normalized = (clamp(value, meta.min, meta.max) - meta.min) / Math.max(0.000001, meta.max - meta.min);
  return 4 + (1 - normalized) * (height - 8);
}

function nearestPointIndex(lane: MidiAutomationLane | undefined, beat: number, value: number): number | null {
  if (!lane?.points.length) return null;
  return lane.points.reduce((best, point, index) => {
    const distance = Math.abs(point.beat - beat) + Math.abs(point.value - value);
    const bestPoint = lane.points[best]!;
    const bestDistance = Math.abs(bestPoint.beat - beat) + Math.abs(bestPoint.value - value);
    return distance < bestDistance ? index : best;
  }, 0);
}

function formatMusicalBeat(beat: number, beatsPerBar: number): string {
  const safeBeatsPerBar = Math.max(1, beatsPerBar);
  const bar = Math.floor(Math.max(0, beat) / safeBeatsPerBar) + 1;
  const beatInBar = Math.max(0, beat) % safeBeatsPerBar + 1;
  return `Bar ${bar} · Beat ${Number(beatInBar.toFixed(3))}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
