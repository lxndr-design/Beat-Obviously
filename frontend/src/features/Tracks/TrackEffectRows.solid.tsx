import { createMemo, createSignal, For, Show } from "solid-js";
import { createStoreSelector } from "../../solid-utils/store";
import { createContextMenu, Icon, type ContextMenuItem } from "../../solid-ui";
import {
  EFFECT_KIND_ORDER,
  EFFECT_META,
  clampEffectParamValue,
  effectAutomationSelectionKey,
  effectValueToLaneY,
  formatEffectParamValue,
  visibleEffectAutomationPoints,
  type EffectParamMeta,
} from "../../automation/trackEffects";
import { AUTOMATION_CURVES, automationCurveLabel, evaluateAutomationCurve } from "../../automation/curves";
import { useProjectStore, useUiStore, useViewStore } from "../../state/store";
import styles from "./TrackEffectRows.module.css";
import type { Id, TrackEffect, TrackEffectAutomationPoint } from "../../state/types";

const TIMEPOINT_HANDLE_Y = 11;

interface EffectRowsProps {
  trackId: Id;
  expandedEffectIds: Set<Id>;
  onToggleEffect: (effectId: Id) => void;
}

export function TrackEffectHeaderRows(props: EffectRowsProps) {
  const track = createStoreSelector(useProjectStore, (state) => state.project.tracks.find((candidate) => candidate.id === props.trackId));
  return (
    <Show when={track()?.effects.filters.length}>
      <For each={track()?.effects.filters ?? []}>
        {(effect) => (
          <EffectRowGroupHeader
            trackId={props.trackId}
            effect={effect}
            expanded={props.expandedEffectIds.has(effect.id)}
            onToggle={() => props.onToggleEffect(effect.id)}
          />
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
      <For each={track()?.effects.filters ?? []}>
        {(effect) => (
          <EffectRowGroupLane
            trackId={props.trackId}
            effect={effect}
            expanded={props.expandedEffectIds.has(effect.id)}
            onToggle={() => props.onToggleEffect(effect.id)}
            lengthBeats={lengthBeats()}
            bpm={bpm()}
            beatsToPx={beatsToPx()}
          />
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
  const meta = createMemo(() => EFFECT_META[props.effect.kind]);
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
          <Icon name={props.expanded ? "ph:caret-down" : "ph:caret-right"} size={12} decorative />
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
        <Icon name="ph:arrow-elbow-down-right" size={12} decorative />
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
}) {
  const meta = createMemo(() => EFFECT_META[props.effect.kind]);
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
          <span
            class={`${styles.valueDiamond} ${styles.ghostDiamond}`}
            title={`${param.label} ${formatEffectParamValue(point.value, param)}`}
            style={{ left: `${point.beat * props.beatsToPx}px`, top: `${TIMEPOINT_HANDLE_Y}px` }}
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
}) {
  let laneElement: HTMLDivElement | undefined;
  const [editor, setEditor] = createSignal<{ pointId?: Id; beat: number; value: string; left: number; top: number } | null>(null, { equals: false });
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
        useProjectStore.getState().upsertTrackEffectAutomationPoint(props.trackId, props.effect.id, props.param.key, {
          beat: pendingContextBeat(),
          value: props.effect.params[props.param.key] ?? props.param.min,
          curve: "linear",
        });
      },
    },
  ]);

  function beatAtClientX(clientX: number, target: HTMLElement): number {
    const rect = target.getBoundingClientRect();
    return Math.max(0, Math.min(props.lengthBeats, (clientX - rect.left) / props.beatsToPx));
  }

  function beatAtLaneClientX(clientX: number): number {
    if (!laneElement) return 0;
    return beatAtClientX(clientX, laneElement);
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

  function commitEditor() {
    const current = editor();
    if (!current) return;
    const parsed = Number(current.value);
    if (!Number.isFinite(parsed)) return;
    const existingPoint = points().find((point) => point.id === current.pointId);
    useProjectStore.getState().upsertTrackEffectAutomationPoint(props.trackId, props.effect.id, props.param.key, {
      id: current.pointId,
      beat: current.beat,
      value: clampEffectParamValue(parsed, props.param),
      curve: existingPoint?.curve ?? "linear",
    });
    setEditor(null);
  }

  function movePointToClientX(pointId: Id, value: number, clientX: number) {
    const existingPoint = points().find((point) => point.id === pointId);
    useProjectStore.getState().upsertTrackEffectAutomationPoint(props.trackId, props.effect.id, props.param.key, {
      id: pointId,
      beat: beatAtLaneClientX(clientX),
      value,
      curve: existingPoint?.curve ?? "linear",
    });
  }

  function startPointDrag(point: TrackEffectAutomationPoint, clientX: number) {
    let moved = false;
    const startClientX = clientX;
    const handleMouseMove = (event: MouseEvent) => {
      if (!moved && Math.abs(event.clientX - startClientX) < 2) return;
      moved = true;
      movePointToClientX(point.id, point.value, event.clientX);
    };
    const stopDrag = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDrag);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDrag);
  }

  return (
    <div
      ref={laneElement}
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
      <For each={points()}>
        {(point) => {
          const pointKey = () => effectAutomationSelectionKey(props.trackId, props.effect.id, props.param.key, point.id);
          return (
            <AutomationPointDiamond
              trackId={props.trackId}
              effect={props.effect}
              param={props.param}
              point={point}
              pointKey={pointKey()}
              selected={selectedPointKeys().includes(pointKey())}
              beatsToPx={props.beatsToPx}
              onSelect={(additive) => useUiStore.getState().selectTrackEffectAutomationPoint(pointKey(), additive)}
              onStartDrag={(clientX) => {
                setEditor(null);
                startPointDrag(point, clientX);
              }}
              onOpenEditor={() => openEditor(point.beat, point.value, point.id)}
            />
          );
        }}
      </For>
      <Show when={editor()}>
        {(current) => (
          <div
            class={styles.pointPopover}
            style={{ left: `${current().left}px`, top: `${current().top}px` }}
            onDblClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <input
              class={styles.pointInput}
              value={current().value}
              autofocus
              onInput={(event) => setEditor({ ...current(), value: event.currentTarget.value })}
              onBlur={commitEditor}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitEditor();
                if (event.key === "Escape") setEditor(null);
              }}
            />
            <span class={styles.pointUnit}>{props.param.unit}</span>
          </div>
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
  beatsToPx: number;
  onSelect: (additive: boolean) => void;
  onStartDrag: (clientX: number) => void;
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
      <span
        class={`${styles.valueDiamond} ${props.selected ? styles.valueDiamondSelected : ""}`}
        title={`${props.param.label} ${formatEffectParamValue(props.point.value, props.param)} · ${automationCurveLabel(props.point.curve ?? "linear")}`}
        style={{ left: `${props.point.beat * props.beatsToPx}px`, top: `${TIMEPOINT_HANDLE_Y}px` }}
        data-track-effect-automation-point-key={props.pointKey}
        onContextMenu={(event) => {
          useUiStore.getState().selectTrackEffectAutomationPoint(props.pointKey, false);
          menu.onContextMenu(event);
        }}
        onClick={(event) => {
          event.stopPropagation();
          props.onSelect(event.shiftKey);
        }}
        onMouseDown={(event) => {
          if (event.button !== 0 || event.ctrlKey) return;
          event.stopPropagation();
          props.onStartDrag(event.clientX);
        }}
        onDblClick={(event) => {
          event.stopPropagation();
          props.onOpenEditor();
        }}
      >
        <span class={styles.valueTooltip}>{formatEffectParamValue(props.point.value, props.param)}</span>
      </span>
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
