import { useRef, useState } from "react";
import { Icon, useContextMenu, type ContextMenuItem } from "../../components";
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

export function TrackEffectHeaderRows({ trackId, expandedEffectIds, onToggleEffect }: EffectRowsProps) {
  const track = useProjectStore((s) => s.project.tracks.find((candidate) => candidate.id === trackId));
  if (!track || track.effects.filters.length === 0) return null;

  return (
    <>
      {track.effects.filters.map((effect) => (
        <EffectRowGroupHeader
          key={effect.id}
          trackId={trackId}
          effect={effect}
          expanded={expandedEffectIds.has(effect.id)}
          onToggle={() => onToggleEffect(effect.id)}
        />
      ))}
    </>
  );
}

export function TrackEffectLaneRows({ trackId, expandedEffectIds, onToggleEffect }: EffectRowsProps) {
  const track = useProjectStore((s) => s.project.tracks.find((candidate) => candidate.id === trackId));
  const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
  const bpm = useProjectStore((s) => s.project.bpm);
  const beatsToPx = useViewStore((s) => s.beatsToPx);
  if (!track || track.effects.filters.length === 0) return null;

  return (
    <>
      {track.effects.filters.map((effect) => (
        <EffectRowGroupLane
          key={effect.id}
          trackId={trackId}
          effect={effect}
          expanded={expandedEffectIds.has(effect.id)}
          onToggle={() => onToggleEffect(effect.id)}
          lengthBeats={lengthBeats}
          bpm={bpm}
          beatsToPx={beatsToPx}
        />
      ))}
    </>
  );
}

function EffectRowGroupHeader({
  trackId,
  effect,
  expanded,
  onToggle,
}: {
  trackId: Id;
  effect: TrackEffect;
  expanded: boolean;
  onToggle: () => void;
}) {
  const updateTrack = useProjectStore((s) => s.updateTrack);
  const setTrackEffectKind = useProjectStore((s) => s.setTrackEffectKind);
  const meta = EFFECT_META[effect.kind];

  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    {
      label: "Change Effect...",
      icon: "ph:swap",
      submenu: EFFECT_KIND_ORDER.map((kind) => ({
        label: EFFECT_META[kind].label,
        icon: kind === effect.kind ? "ph:check" : undefined,
        onSelect: () => setTrackEffectKind(trackId, effect.id, kind),
      })),
    },
    {
      label: "Reset",
      icon: "ph:arrow-counter-clockwise",
      separatorBefore: true,
      onSelect: () => setTrackEffectKind(trackId, effect.id, effect.kind),
    },
    {
      label: "Remove",
      icon: "ph:trash",
      separatorBefore: true,
      onSelect: () => {
        const projectTrack = useProjectStore.getState().project.tracks.find((candidate) => candidate.id === trackId);
        if (!projectTrack) return;
        updateTrack(trackId, {
          effects: {
            ...projectTrack.effects,
            filters: projectTrack.effects.filters.filter((candidate) => candidate.id !== effect.id),
          },
        });
      },
    },
  ]);

  return (
    <>
      <div
        className={`${styles.effectHeader} ${expanded ? styles.effectHeaderExpanded : ""}`}
        onContextMenu={onContextMenu}
        onClick={(event) => {
          if (event.button !== 0 || event.ctrlKey) return;
          event.stopPropagation();
          onToggle();
        }}
        data-track-effect-header-id={effect.id}
      >
        <span className={styles.effectHeaderIcon}>
          <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} size={12} decorative />
        </span>
        <span className={styles.effectHeaderTitle}>{effect.kind === "plugin" && effect.pluginName ? effect.pluginName : meta.label}</span>
        {menu}
      </div>
      {expanded && meta.params.map((param) => (
        <ValueHeaderRow key={`${effect.id}:${param.key}`} effect={effect} param={param} />
      ))}
    </>
  );
}

function ValueHeaderRow({ effect, param }: { effect: TrackEffect; param: EffectParamMeta }) {
  return (
    <div className={styles.valueHeader} data-track-effect-value-header-id={`${effect.id}:${param.key}`}>
      <span className={styles.valueHeaderIcon}>
        <Icon name="ph:arrow-elbow-down-right" size={12} decorative />
      </span>
      <span className={styles.valueHeaderTitle}>{param.label}</span>
      <span className={styles.valueHeaderValue}>
        {formatEffectParamValue(effect.params[param.key] ?? param.min, param)}
      </span>
    </div>
  );
}

function EffectRowGroupLane({
  trackId,
  effect,
  expanded,
  onToggle,
  lengthBeats,
  bpm,
  beatsToPx,
}: {
  trackId: Id;
  effect: TrackEffect;
  expanded: boolean;
  onToggle: () => void;
  lengthBeats: number;
  bpm: number;
  beatsToPx: number;
}) {
  const meta = EFFECT_META[effect.kind];
  const ghostPoints = meta.params.flatMap((param) =>
    visibleEffectAutomationPoints(effect, param, lengthBeats, bpm).map((point) => ({ point, param }))
  );

  return (
    <>
      <EffectSummaryLane
        effect={effect}
        expanded={expanded}
        onToggle={onToggle}
        lengthBeats={lengthBeats}
        beatsToPx={beatsToPx}
        ghostPoints={ghostPoints}
      />
      {expanded && meta.params.map((param) => (
        <TrackEffectValueLaneRow
          key={`${effect.id}:${param.key}`}
          trackId={trackId}
          effect={effect}
          param={param}
          lengthBeats={lengthBeats}
          bpm={bpm}
          beatsToPx={beatsToPx}
        />
      ))}
    </>
  );
}

function EffectSummaryLane({
  effect,
  expanded,
  onToggle,
  lengthBeats,
  beatsToPx,
  ghostPoints,
}: {
  effect: TrackEffect;
  expanded: boolean;
  onToggle: () => void;
  lengthBeats: number;
  beatsToPx: number;
  ghostPoints: Array<{ point: TrackEffectAutomationPoint; param: EffectParamMeta }>;
}) {
  return (
    <div
      className={`${styles.effectLane} ${styles.effectSummaryLane} ${expanded ? styles.effectLaneExpanded : ""}`}
      style={{ width: lengthBeats * beatsToPx }}
      onClick={(event) => {
        if (event.button !== 0 || event.ctrlKey) return;
        event.stopPropagation();
        onToggle();
      }}
      data-track-effect-lane-id={effect.id}
    >
      <BeatGrid lengthBeats={lengthBeats} beatsToPx={beatsToPx} />
      {ghostPoints.map(({ point, param }) => (
        <span
          key={`${point.id}:${param.key}`}
          className={styles.valueGuide}
          style={{
            left: 0,
            top: effectValueToLaneY(point.value, param),
            width: lengthBeats * beatsToPx,
          }}
        />
      ))}
      {ghostPoints.map(({ point, param }) => (
        <span
          key={`${point.id}:${param.key}:ghost`}
          className={`${styles.valueDiamond} ${styles.ghostDiamond}`}
          title={`${param.label} ${formatEffectParamValue(point.value, param)}`}
          style={{ left: point.beat * beatsToPx, top: TIMEPOINT_HANDLE_Y }}
        />
      ))}
    </div>
  );
}

function TrackEffectValueLaneRow({
  trackId,
  effect,
  param,
  lengthBeats,
  bpm,
  beatsToPx,
}: {
  trackId: Id;
  effect: TrackEffect;
  param: EffectParamMeta;
  lengthBeats: number;
  bpm: number;
  beatsToPx: number;
}) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<{
    pointId?: Id;
    beat: number;
    value: string;
    left: number;
    top: number;
  } | null>(null);
  const upsertTrackEffectAutomationPoint = useProjectStore((s) => s.upsertTrackEffectAutomationPoint);
  const selectedPointKeys = useUiStore((s) => s.selectedTrackEffectAutomationPointKeys);
  const selectTrackEffectAutomationPoint = useUiStore((s) => s.selectTrackEffectAutomationPoint);
  const points = visibleEffectAutomationPoints(effect, param, lengthBeats, bpm);
  const [pendingContextBeat, setPendingContextBeat] = useState(0);
  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    {
      label: "+ Timepoint",
      icon: "ph:diamond",
      onSelect: () => {
        upsertTrackEffectAutomationPoint(trackId, effect.id, param.key, {
          beat: pendingContextBeat,
          value: effect.params[param.key] ?? param.min,
          curve: "linear",
        });
      },
    },
  ]);
  const line = points.length >= 2
    ? points.flatMap((point, index) => {
        const next = points[index + 1];
        if (!next) return [];
        const segmentCount = (point.curve ?? "linear") === "hold" ? 1 : 8;
        return Array.from({ length: segmentCount }, (_, segmentIndex) => {
          const t = segmentIndex / segmentCount;
          const nextT = (segmentIndex + 1) / segmentCount;
          const startValue = evaluateAutomationCurve(point.curve, point.value, next.value, t);
          const endValue = evaluateAutomationCurve(point.curve, point.value, next.value, nextT);
          return {
            x: (point.beat + (next.beat - point.beat) * t) * beatsToPx,
            y: effectValueToLaneY(startValue, param),
            x2: (point.beat + (next.beat - point.beat) * nextT) * beatsToPx,
            y2: effectValueToLaneY(endValue, param),
          };
        });
      })
    : [];

  function openEditor(beat: number, fallbackValue: number, pointId?: Id) {
    setEditor({
      pointId,
      beat,
      value: String(Math.round(fallbackValue * 100) / 100),
      left: beat * beatsToPx,
      top: TIMEPOINT_HANDLE_Y,
    });
  }

  function commitEditor() {
    if (!editor) return;
    const parsed = Number(editor.value);
    if (!Number.isFinite(parsed)) return;
    const existingPoint = points.find((point) => point.id === editor.pointId);
    upsertTrackEffectAutomationPoint(trackId, effect.id, param.key, {
      id: editor.pointId,
      beat: editor.beat,
      value: clampEffectParamValue(parsed, param),
      curve: existingPoint?.curve ?? "linear",
    });
    setEditor(null);
  }

  function beatAtClientX(clientX: number, target: HTMLElement): number {
    const rect = target.getBoundingClientRect();
    return Math.max(0, Math.min(lengthBeats, (clientX - rect.left) / beatsToPx));
  }

  function beatAtLaneClientX(clientX: number): number {
    const lane = laneRef.current;
    if (!lane) return 0;
    return beatAtClientX(clientX, lane);
  }

  function movePointToClientX(pointId: Id, value: number, clientX: number) {
    const existingPoint = points.find((point) => point.id === pointId);
    upsertTrackEffectAutomationPoint(trackId, effect.id, param.key, {
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
      ref={laneRef}
      className={`${styles.effectLane} ${styles.valueLane}`}
      style={{ width: lengthBeats * beatsToPx }}
      onContextMenu={(event) => {
        setPendingContextBeat(beatAtClientX(event.clientX, event.currentTarget));
        onContextMenu(event);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        const beat = beatAtClientX(event.clientX, event.currentTarget);
        openEditor(beat, effect.params[param.key] ?? param.min);
      }}
      data-track-effect-value-lane-id={`${effect.id}:${param.key}`}
    >
      <BeatGrid lengthBeats={lengthBeats} beatsToPx={beatsToPx} />
      {points.map((point, index) => {
        const next = points[index + 1];
        const startX = index === 0 ? 0 : point.beat * beatsToPx;
        const endX = next ? next.beat * beatsToPx : lengthBeats * beatsToPx;
        return (
          <span
            key={`${effect.id}:guide:${point.id}`}
            className={styles.valueGuide}
            style={{
              left: startX,
              top: effectValueToLaneY(point.value, param),
              width: Math.max(0, endX - startX),
            }}
          />
        );
      })}
      {line.map((segment, index) => {
        const dx = segment.x2 - segment.x;
        const dy = segment.y2 - segment.y;
        return (
          <span
            key={`${effect.id}:line:${index}`}
            className={styles.valueLine}
            style={{
              left: segment.x,
              top: segment.y,
              width: Math.hypot(dx, dy),
              transform: `rotate(${Math.atan2(dy, dx)}rad)`,
              transformOrigin: "left center",
            }}
          />
        );
      })}
      {points.map((point) => {
        const pointKey = effectAutomationSelectionKey(trackId, effect.id, param.key, point.id);
        const selected = selectedPointKeys.includes(pointKey);
        return (
          <AutomationPointDiamond
            key={point.id}
            trackId={trackId}
            effect={effect}
            param={param}
            point={point}
            pointKey={pointKey}
            selected={selected}
            beatsToPx={beatsToPx}
            onSelect={(additive) => selectTrackEffectAutomationPoint(pointKey, additive)}
            onStartDrag={(clientX) => {
              setEditor(null);
              startPointDrag(point, clientX);
            }}
            onOpenEditor={() => openEditor(point.beat, point.value, point.id)}
          />
        );
      })}
      {editor && (
        <div
          className={styles.pointPopover}
          style={{ left: editor.left, top: editor.top }}
          onDoubleClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <input
            className={styles.pointInput}
            value={editor.value}
            autoFocus
            onChange={(event) => setEditor({ ...editor, value: event.target.value })}
            onBlur={commitEditor}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitEditor();
              if (event.key === "Escape") setEditor(null);
            }}
          />
          <span className={styles.pointUnit}>{param.unit}</span>
        </div>
      )}
      {menu}
    </div>
  );
}

function AutomationPointDiamond({
  trackId,
  effect,
  param,
  point,
  pointKey,
  selected,
  beatsToPx,
  onSelect,
  onStartDrag,
  onOpenEditor,
}: {
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
  const upsertTrackEffectAutomationPoint = useProjectStore((s) => s.upsertTrackEffectAutomationPoint);
  const removeTrackEffectAutomationPoint = useProjectStore((s) => s.removeTrackEffectAutomationPoint);
  const selectTrackEffectAutomationPoint = useUiStore((s) => s.selectTrackEffectAutomationPoint);
  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => [
    {
      label: "Curve",
      icon: "ph:bezier-curve",
      submenu: AUTOMATION_CURVES.map((curve) => ({
        label: automationCurveLabel(curve),
        icon: (point.curve ?? "linear") === curve ? "ph:check" : undefined,
        onSelect: () => {
          upsertTrackEffectAutomationPoint(trackId, effect.id, param.key, {
            id: point.id,
            beat: point.beat,
            value: point.value,
            curve,
          });
        },
      })),
    },
    {
      label: "Delete",
      icon: "ph:trash",
      separatorBefore: true,
      onSelect: () => removeTrackEffectAutomationPoint(trackId, effect.id, param.key, point.id),
    },
  ]);

  return (
    <>
      <span
        className={`${styles.valueDiamond} ${selected ? styles.valueDiamondSelected : ""}`}
        title={`${param.label} ${formatEffectParamValue(point.value, param)} · ${automationCurveLabel(point.curve ?? "linear")}`}
        style={{ left: point.beat * beatsToPx, top: TIMEPOINT_HANDLE_Y }}
        data-track-effect-automation-point-key={pointKey}
        onContextMenu={(event) => {
          selectTrackEffectAutomationPoint(pointKey, false);
          onContextMenu(event);
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(event.shiftKey);
        }}
        onMouseDown={(event) => {
          if (event.button !== 0 || event.ctrlKey) return;
          event.stopPropagation();
          onStartDrag(event.clientX);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onOpenEditor();
        }}
      >
        <span className={styles.valueTooltip}>{formatEffectParamValue(point.value, param)}</span>
      </span>
      {menu}
    </>
  );
}

function BeatGrid({ lengthBeats, beatsToPx }: { lengthBeats: number; beatsToPx: number }) {
  return (
    <>
      {Array.from({ length: lengthBeats + 1 }, (_, b) => (
        <div
          key={b}
          className={`${styles.gridLine} ${b % 4 === 0 ? styles.gridLineMajor : ""}`}
          style={{ left: b * beatsToPx }}
        />
      ))}
    </>
  );
}
