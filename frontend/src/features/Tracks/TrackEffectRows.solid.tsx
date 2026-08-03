import { createMemo, createSignal, For, Show } from "solid-js";
import { createStoreSelector } from "../../solid-utils/store";
import { createContextMenu, Icon, type ContextMenuItem } from "../../solid-ui";
import {
  EFFECT_KIND_ORDER,
  EFFECT_META,
  clampEffectParamValue,
  effectAutomationBeatFromDrag,
  effectAutomationPointDisplayLeft,
  effectAutomationPopoverDisplayLeft,
  effectAutomationSelectionKey,
  effectValueToLaneY,
  formatEffectParamValue,
  visibleEffectAutomationPoints,
  type EffectMeta,
  type EffectParamMeta,
} from "../../automation/trackEffects";
import { AUTOMATION_CURVES, automationCurveLabel, evaluateAutomationCurve } from "../../automation/curves";
import { useProjectStore, useUiStore, useViewStore } from "../../state/store";
import styles from "./TrackEffectRows.module.css";
import { TimepointHandle, TimepointValuePopover } from "./TimepointLane.solid";
import type { Id, TrackEffect, TrackEffectAutomationPoint } from "../../state/types";

const TIMEPOINT_HANDLE_Y = 11;

function effectMeta(effect: TrackEffect): EffectMeta {
  const kind = String(effect.kind);
  return (EFFECT_META as Partial<Record<string, EffectMeta>>)[kind] ?? {
    label: `Unsupported effect (${kind || "unknown"})`,
    params: [],
  };
}

interface EffectRowsProps {
  trackId: Id;
  expandedEffectIds: Set<Id>;
  onToggleEffect: (effectId: Id) => void;
  scrollLeft?: number;
}

export function TrackEffectHeaderRows(props: EffectRowsProps) {
  const track = createStoreSelector(useProjectStore, (state) => state.project.tracks.find((candidate) => candidate.id === props.trackId));
  return (
    <Show when={track()?.effects.filters.length}>
      <For each={(track()?.effects.filters ?? []).map((effect) => effect.id)}>
        {(effectId) => (
          <Show when={track()?.effects.filters.find((effect) => effect.id === effectId)}>
            {(effect) => (
              <EffectRowGroupHeader
                trackId={props.trackId}
                effect={effect()}
                expanded={props.expandedEffectIds.has(effectId)}
                onToggle={() => props.onToggleEffect(effectId)}
              />
            )}
          </Show>
        )}
      </For>
    </Show>
  );
}

export function TrackEffectLaneRows(props: EffectRowsProps) {
  const track = createStoreSelector(useProjectStore, (state) => state.project.tracks.find((candidate) => candidate.id === props.trackId));
  const lengthBeats = createStoreSelector(useProjectStore, (state) => state.project.lengthBeats);
  const bpm = createStoreSelector(useProjectStore, (state) => state.project.bpm);
  const beatsToPx = createStoreSelector(useViewStore, (state) => state.beatsToPx);

  return (
    <Show when={track()?.effects.filters.length}>
      <For each={(track()?.effects.filters ?? []).map((effect) => effect.id)}>
        {(effectId) => (
          <Show when={track()?.effects.filters.find((effect) => effect.id === effectId)}>
            {(effect) => (
              <EffectRowGroupLane
                trackId={props.trackId}
                effect={effect()}
                expanded={props.expandedEffectIds.has(effectId)}
                onToggle={() => props.onToggleEffect(effectId)}
                lengthBeats={lengthBeats()}
                bpm={bpm()}
                beatsToPx={beatsToPx()}
                scrollLeft={props.scrollLeft ?? 0}
              />
            )}
          </Show>
        )}
      </For>
    </Show>
  );
}

function EffectRowGroupHeader(props: {
  trackId: Id;
  effect: TrackEffect;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = createMemo(() => effectMeta(props.effect));
  const menu = createContextMenu((): ContextMenuItem[] => [
    {
      label: "Change Effect...",
      icon: "ph:swap",
      submenu: EFFECT_KIND_ORDER.map((kind) => ({
        label: EFFECT_META[kind].label,
        icon: kind === props.effect.kind ? "ph:check" : undefined,
        onSelect: () => useProjectStore.getState().setTrackEffectKind(props.trackId, props.effect.id, kind),
      })),
    },
    {
      label: "Reset",
      icon: "ph:arrow-counter-clockwise",
      separatorBefore: true,
      onSelect: () => useProjectStore.getState().setTrackEffectKind(props.trackId, props.effect.id, props.effect.kind),
    },
    {
      label: "Remove",
      icon: "ph:trash",
      separatorBefore: true,
      onSelect: () => {
        const projectTrack = useProjectStore.getState().project.tracks.find((candidate) => candidate.id === props.trackId);
        if (!projectTrack) return;
        useProjectStore.getState().updateTrack(props.trackId, {
          effects: {
            ...projectTrack.effects,
            filters: projectTrack.effects.filters.filter((candidate) => candidate.id !== props.effect.id),
          },
        });
      },
    },
  ]);

  return (
    <>
      <div
        class={`${styles.effectHeader} ${props.expanded ? styles.effectHeaderExpanded : ""}`}
        onContextMenu={menu.onContextMenu}
        onClick={(event) => {
          if (event.button !== 0 || event.ctrlKey) return;
          event.stopPropagation();
          props.onToggle();
        }}
        data-track-effect-header-id={props.effect.id}
      >
        <span class={styles.effectHeaderIcon}>
          <Icon name={props.expanded ? "ph:caret-down" : "ph:caret-right"} size={18} decorative />
        </span>
        <span class={styles.effectHeaderTitle}>{props.effect.kind === "plugin" && props.effect.pluginName ? props.effect.pluginName : meta().label}</span>
        {menu.menu()}
      </div>
      <Show when={props.expanded}>
        <For each={meta().params}>
          {(param) => <ValueHeaderRow effect={props.effect} param={param} />}
        </For>
      </Show>
    </>
  );
}

function ValueHeaderRow(props: { effect: TrackEffect; param: EffectParamMeta }) {
  return (
    <div class={styles.valueHeader} data-track-effect-value-header-id={`${props.effect.id}:${props.param.key}`}>
      <span class={styles.valueHeaderIcon}>
        <Icon name="ph:arrow-elbow-down-right" size={18} decorative />
      </span>
      <span class={styles.valueHeaderTitle}>{props.param.label}</span>
      <span class={styles.valueHeaderValue}>
        {formatEffectParamValue(props.effect.params[props.param.key] ?? props.param.min, props.param)}
      </span>
    </div>
  );
}

function EffectRowGroupLane(props: {
  trackId: Id;
  effect: TrackEffect;
  expanded: boolean;
  onToggle: () => void;
  lengthBeats: number;
  bpm: number;
  beatsToPx: number;
  scrollLeft: number;
}) {
  const meta = createMemo(() => effectMeta(props.effect));
  const ghostPoints = createMemo(() => meta().params.flatMap((param) =>
    visibleEffectAutomationPoints(props.effect, param, props.lengthBeats, props.bpm).map((point) => ({ point, param })),
  ));

  return (
    <>
      <EffectSummaryLane
        effect={props.effect}
        expanded={props.expanded}
        onToggle={props.onToggle}
        lengthBeats={props.lengthBeats}
        beatsToPx={props.beatsToPx}
        ghostPoints={ghostPoints()}
      />
      <Show when={props.expanded}>
        <For each={meta().params}>
          {(param) => (
            <TrackEffectValueLaneRow
              trackId={props.trackId}
              effect={props.effect}
              param={param}
              lengthBeats={props.lengthBeats}
              bpm={props.bpm}
              beatsToPx={props.beatsToPx}
              scrollLeft={props.scrollLeft}
            />
          )}
        </For>
      </Show>
    </>
  );
}

function EffectSummaryLane(props: {
  effect: TrackEffect;
  expanded: boolean;
  onToggle: () => void;
  lengthBeats: number;
  beatsToPx: number;
  ghostPoints: Array<{ point: TrackEffectAutomationPoint; param: EffectParamMeta }>;
}) {
  return (
    <div
      class={`${styles.effectLane} ${styles.effectSummaryLane} ${props.expanded ? styles.effectLaneExpanded : ""}`}
      style={{ width: `${props.lengthBeats * props.beatsToPx}px` }}
      onClick={(event) => {
        if (event.button !== 0 || event.ctrlKey) return;
        event.stopPropagation();
        props.onToggle();
      }}
      data-track-effect-lane-id={props.effect.id}
    >
      <BeatGrid lengthBeats={props.lengthBeats} beatsToPx={props.beatsToPx} />
      <For each={props.ghostPoints}>
        {({ point, param }) => (
          <span
            class={styles.valueGuide}
            style={{
              left: "0px",
              top: `${effectValueToLaneY(point.value, param)}px`,
              width: `${props.lengthBeats * props.beatsToPx}px`,
            }}
          />
        )}
      </For>
      <For each={props.ghostPoints}>
        {({ point, param }) => (
          <TimepointHandle
            title={`${param.label} ${formatEffectParamValue(point.value, param)}`}
            left={point.beat * props.beatsToPx}
            top={TIMEPOINT_HANDLE_Y}
            ghost
          />
        )}
      </For>
    </div>
  );
}

function TrackEffectValueLaneRow(props: {
  trackId: Id;
  effect: TrackEffect;
  param: EffectParamMeta;
  lengthBeats: number;
  bpm: number;
  beatsToPx: number;
  scrollLeft: number;
}) {
  const [editor, setEditor] = createSignal<{ pointId?: Id; beat: number; value: string; left: number; top: number } | null>(null, { equals: false });
  const [draggingPointId, setDraggingPointId] = createSignal<Id | null>(null);
  const [pendingContextBeat, setPendingContextBeat] = createSignal(0);
  const selectedPointKeys = createStoreSelector(useUiStore, (state) => state.selectedTrackEffectAutomationPointKeys);
  const points = createMemo(() => visibleEffectAutomationPoints(props.effect, props.param, props.lengthBeats, props.bpm));
  const line = createMemo(() => points().length >= 2
    ? points().flatMap((point, index) => {
        const next = points()[index + 1];
        if (!next) return [];
        const segmentCount = (point.curve ?? "linear") === "hold" ? 1 : 8;
        return Array.from({ length: segmentCount }, (_, segmentIndex) => {
          const t = segmentIndex / segmentCount;
          const nextT = (segmentIndex + 1) / segmentCount;
          const startValue = evaluateAutomationCurve(point.curve, point.value, next.value, t);
          const endValue = evaluateAutomationCurve(point.curve, point.value, next.value, nextT);
          return {
            x: (point.beat + (next.beat - point.beat) * t) * props.beatsToPx,
            y: effectValueToLaneY(startValue, props.param),
            x2: (point.beat + (next.beat - point.beat) * nextT) * props.beatsToPx,
            y2: effectValueToLaneY(endValue, props.param),
          };
        });
      })
    : []);
  const menu = createContextMenu((): ContextMenuItem[] => [
    {
      label: "+ Timepoint",
      icon: "ph:diamond",
      onSelect: () => {
        createPointAtBeat(pendingContextBeat(), props.effect.params[props.param.key] ?? props.param.min);
      },
    },
  ]);

  function beatAtClientX(clientX: number, target: HTMLElement): number {
    const rect = target.getBoundingClientRect();
    return Math.max(0, Math.min(props.lengthBeats, (clientX - rect.left) / props.beatsToPx));
  }

  function openEditor(beat: number, fallbackValue: number, pointId?: Id) {
    setEditor({
      pointId,
      beat,
      value: String(Math.round(fallbackValue * 100) / 100),
      left: beat * props.beatsToPx,
      top: TIMEPOINT_HANDLE_Y,
    });
  }

  function pointDisplayLeft(point: TrackEffectAutomationPoint) {
    return effectAutomationPointDisplayLeft(point.beat, props.beatsToPx, props.scrollLeft, points().length);
  }

  function editorDisplayLeft(current: { pointId?: Id; left: number }) {
    const point = current.pointId ? points().find((candidate) => candidate.id === current.pointId) : undefined;
    return effectAutomationPopoverDisplayLeft(point ? pointDisplayLeft(point) : current.left, props.scrollLeft);
  }

  function commitEditor() {
    const current = editor();
    if (!current) return;
    const parsed = Number(current.value);
    if (!Number.isFinite(parsed)) return;
    const value = clampEffectParamValue(parsed, props.param);
    if (!current.pointId) {
      createPointAtBeat(current.beat, value);
      setEditor(null);
      return;
    }
    const existingPoint = points().find((point) => point.id === current.pointId);
    useProjectStore.getState().upsertTrackEffectAutomationPoint(props.trackId, props.effect.id, props.param.key, {
      id: current.pointId,
      beat: current.beat,
      value,
      curve: existingPoint?.curve ?? "linear",
    });
    setEditor(null);
  }

  function createPointAtBeat(beat: number, value: number): Id {
    const persistedLane = props.effect.automation?.find((candidate) => candidate.param === props.param.key);
    const fallbackPoint = persistedLane?.points.length ? undefined : points()[0];
    let createdPointId: Id;
    if (fallbackPoint && Math.abs(fallbackPoint.beat - beat) < 0.0001) {
      createdPointId = useProjectStore.getState().upsertTrackEffectAutomationPoint(props.trackId, props.effect.id, props.param.key, {
        id: fallbackPoint.id,
        beat,
        value,
        curve: fallbackPoint.curve ?? "linear",
      });
    } else {
      if (fallbackPoint) {
        useProjectStore.getState().upsertTrackEffectAutomationPoint(props.trackId, props.effect.id, props.param.key, {
          id: fallbackPoint.id,
          beat: fallbackPoint.beat,
          value: fallbackPoint.value,
          curve: fallbackPoint.curve ?? "linear",
        });
      }
      createdPointId = useProjectStore.getState().upsertTrackEffectAutomationPoint(props.trackId, props.effect.id, props.param.key, {
        beat,
        value,
        curve: "linear",
      });
    }
    useUiStore.getState().selectTrackEffectAutomationPoint(
      effectAutomationSelectionKey(props.trackId, props.effect.id, props.param.key, createdPointId),
      false,
    );
    return createdPointId;
  }

  function movePointToBeat(pointId: Id, value: number, beat: number) {
    const existingPoint = points().find((point) => point.id === pointId);
    useProjectStore.getState().upsertTrackEffectAutomationPoint(props.trackId, props.effect.id, props.param.key, {
      id: pointId,
      beat,
      value,
      curve: existingPoint?.curve ?? "linear",
    });
  }

  function startPointDrag(point: TrackEffectAutomationPoint, pointerId: number, clientX: number) {
    let moved = false;
    const startClientX = clientX;
    setDraggingPointId(point.id);
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (!moved && Math.abs(event.clientX - startClientX) < 2) return;
      moved = true;
      movePointToBeat(
        point.id,
        point.value,
        effectAutomationBeatFromDrag(point.beat, startClientX, event.clientX, props.beatsToPx, props.lengthBeats),
      );
    };
    const stopDrag = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
      setDraggingPointId(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
  }

  return (
    <div
      class={`${styles.effectLane} ${styles.valueLane}`}
      style={{ width: `${props.lengthBeats * props.beatsToPx}px` }}
      onContextMenu={(event) => {
        setPendingContextBeat(beatAtClientX(event.clientX, event.currentTarget));
        menu.onContextMenu(event);
      }}
      onDblClick={(event) => {
        event.stopPropagation();
        const beat = beatAtClientX(event.clientX, event.currentTarget);
        openEditor(beat, props.effect.params[props.param.key] ?? props.param.min);
      }}
      data-track-effect-value-lane-id={`${props.effect.id}:${props.param.key}`}
    >
      <BeatGrid lengthBeats={props.lengthBeats} beatsToPx={props.beatsToPx} />
      <For each={points()}>
        {(point, index) => {
          const next = () => points()[index() + 1];
          const startX = () => index() === 0 ? 0 : point.beat * props.beatsToPx;
          const endX = () => next() ? next()!.beat * props.beatsToPx : props.lengthBeats * props.beatsToPx;
          return (
            <span
              class={styles.valueGuide}
              style={{
                left: `${startX()}px`,
                top: `${effectValueToLaneY(point.value, props.param)}px`,
                width: `${Math.max(0, endX() - startX())}px`,
              }}
            />
          );
        }}
      </For>
      <For each={line()}>
        {(segment) => {
          const dx = segment.x2 - segment.x;
          const dy = segment.y2 - segment.y;
          return (
            <span
              class={styles.valueLine}
              style={{
                left: `${segment.x}px`,
                top: `${segment.y}px`,
                width: `${Math.hypot(dx, dy)}px`,
                transform: `rotate(${Math.atan2(dy, dx)}rad)`,
                "transform-origin": "left center",
              }}
            />
          );
        }}
      </For>
      <For each={points().map((point) => point.id)}>
        {(pointId) => {
          const point = () => points().find((candidate) => candidate.id === pointId)!;
          const pointKey = () => effectAutomationSelectionKey(props.trackId, props.effect.id, props.param.key, pointId);
          return (
            <AutomationPointDiamond
              trackId={props.trackId}
              effect={props.effect}
              param={props.param}
              point={point()}
              pointKey={pointKey()}
              selected={selectedPointKeys().includes(pointKey())}
              dragging={draggingPointId() === pointId}
              beatsToPx={props.beatsToPx}
              displayLeft={pointDisplayLeft(point())}
              pinned={points().length === 1}
              onSelect={(additive) => useUiStore.getState().selectTrackEffectAutomationPoint(pointKey(), additive)}
              onStartDrag={(pointerId, clientX) => {
                setEditor(null);
                startPointDrag(point(), pointerId, clientX);
              }}
              onOpenEditor={() => openEditor(point().beat, point().value, pointId)}
            />
          );
        }}
      </For>
      <Show when={editor()}>
        {(current) => (
          <TimepointValuePopover
            left={editorDisplayLeft(current())}
            top={current().top}
            label={`${props.param.label} automation`}
            value={current().value}
            unit={props.param.unit}
            onInput={(value) => setEditor({ ...current(), value })}
            onCommit={commitEditor}
            onCancel={() => setEditor(null)}
          />
        )}
      </Show>
      {menu.menu()}
    </div>
  );
}

function AutomationPointDiamond(props: {
  trackId: Id;
  effect: TrackEffect;
  param: EffectParamMeta;
  point: TrackEffectAutomationPoint;
  pointKey: string;
  selected: boolean;
  dragging: boolean;
  beatsToPx: number;
  displayLeft: number;
  pinned: boolean;
  onSelect: (additive: boolean) => void;
  onStartDrag: (pointerId: number, clientX: number) => void;
  onOpenEditor: () => void;
}) {
  const menu = createContextMenu((): ContextMenuItem[] => [
    {
      label: "Curve",
      icon: "ph:bezier-curve",
      submenu: AUTOMATION_CURVES.map((curve) => ({
        label: automationCurveLabel(curve),
        icon: (props.point.curve ?? "linear") === curve ? "ph:check" : undefined,
        onSelect: () => {
          useProjectStore.getState().upsertTrackEffectAutomationPoint(props.trackId, props.effect.id, props.param.key, {
            id: props.point.id,
            beat: props.point.beat,
            value: props.point.value,
            curve,
          });
        },
      })),
    },
    {
      label: "Delete",
      icon: "ph:trash",
      separatorBefore: true,
      onSelect: () => useProjectStore.getState().removeTrackEffectAutomationPoint(props.trackId, props.effect.id, props.param.key, props.point.id),
    },
  ]);

  return (
    <>
      <TimepointHandle
        title={`${props.param.label} ${formatEffectParamValue(props.point.value, props.param)} · ${automationCurveLabel(props.point.curve ?? "linear")}`}
        displayValue={formatEffectParamValue(props.point.value, props.param)}
        left={props.displayLeft}
        top={TIMEPOINT_HANDLE_Y}
        selectionKey={props.pointKey}
        selected={props.selected}
        dragging={props.dragging}
        pinned={props.pinned}
        onContextMenu={(event) => {
          useUiStore.getState().selectTrackEffectAutomationPoint(props.pointKey, false);
          menu.onContextMenu(event);
        }}
        onSelect={props.onSelect}
        onStartDrag={props.onStartDrag}
        onOpenEditor={props.onOpenEditor}
      />
      {menu.menu()}
    </>
  );
}

function BeatGrid(props: { lengthBeats: number; beatsToPx: number }) {
  return (
    <For each={Array.from({ length: props.lengthBeats + 1 }, (_, beat) => beat)}>
      {(beat) => (
        <div
          class={`${styles.gridLine} ${beat % 4 === 0 ? styles.gridLineMajor : ""}`}
          style={{ left: `${beat * props.beatsToPx}px` }}
        />
      )}
    </For>
  );
}
