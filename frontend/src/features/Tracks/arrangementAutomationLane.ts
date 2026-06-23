import {
  AETHER_ARRANGEMENT_AUTOMATION_TARGETS,
  aetherArrangementAutomationTargetLabel,
  aetherArrangementAutomationTargetMeta,
  formatAetherArrangementAutomationValue,
  trackAutomationTargetCount,
  type AetherArrangementAutomationTarget,
} from "../../automation/aetherArrangementAutomation";
import type { MidiAutomationLane, Track } from "../../state/types";

export interface ArrangementAutomationPreviewPoint {
  title: string;
  value: number;
  beat: number;
  index: number;
  x: number;
  y: number;
}

export interface ArrangementAutomationPreview {
  count: number;
  height: number;
  label: string;
  points: ArrangementAutomationPreviewPoint[];
  polyline: string;
  target: AetherArrangementAutomationTarget;
  width: number;
}

export interface ArrangementAutomationDragValue {
  beat: number;
  value: number;
}

export function arrangementAutomationAddPointBeat(projectLengthBeats: number): number {
  return Math.max(0.001, projectLengthBeats) / 2;
}

export function arrangementAutomationRemovePointIndex(
  points: Array<Pick<ArrangementAutomationPreviewPoint, "index">>,
  activePointIndex: number | null | undefined,
): number | null {
  if (points.length === 0) return null;
  if (activePointIndex != null && points.some((point) => point.index === activePointIndex)) return activePointIndex;
  return points[points.length - 1]?.index ?? null;
}

const ARRANGEMENT_AUTOMATION_TARGETS = new Set<AetherArrangementAutomationTarget>(
  AETHER_ARRANGEMENT_AUTOMATION_TARGETS.map((target) => target.target),
);
export const ARRANGEMENT_AUTOMATION_HEIGHT = 22;

export function arrangementAutomationPreview(
  track: Track | undefined,
  projectLengthBeats: number,
  beatsToPx: number,
): ArrangementAutomationPreview | null {
  const lane = firstVisibleArrangementAutomationLane(track?.automation);
  if (!lane) return null;
  const target = lane.target as AetherArrangementAutomationTarget;
  const width = Math.max(1, projectLengthBeats * beatsToPx);
  const height = ARRANGEMENT_AUTOMATION_HEIGHT;
  const points = lane.points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => Number.isFinite(point.beat) && Number.isFinite(point.value))
    .map(({ point, index }) => {
      const beat = clamp(point.beat, 0, Math.max(0.001, projectLengthBeats));
      const value = clampAutomationValue(target, point.value);
      const x = beat * Math.max(1, beatsToPx);
      const y = automationValueToY(target, value, height);
      return {
        title: `${aetherArrangementAutomationTargetLabel(target)} ${formatAetherArrangementAutomationValue(target, point.value)} @ ${beat.toFixed(2)}`,
        value,
        beat,
        index,
        x,
        y,
      };
    });
  if (points.length === 0) return null;
  return {
    count: trackAutomationTargetCount(track),
    height,
    label: aetherArrangementAutomationTargetLabel(target),
    points,
    polyline: points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
    target,
    width,
  };
}

export function arrangementAutomationDragValue({
  clientX,
  clientY,
  laneLeft,
  previewTop,
  projectLengthBeats,
  beatsToPx,
  height = ARRANGEMENT_AUTOMATION_HEIGHT,
  target,
  shiftKey,
  timelineSmartGrid,
  timelineSubdivision,
}: {
  clientX: number;
  clientY: number;
  laneLeft: number;
  previewTop: number;
  projectLengthBeats: number;
  beatsToPx: number;
  height?: number;
  target: AetherArrangementAutomationTarget;
  shiftKey: boolean;
  timelineSmartGrid: boolean;
  timelineSubdivision: number;
}): ArrangementAutomationDragValue {
  const rawBeat = clamp((clientX - laneLeft) / Math.max(1, beatsToPx), 0, Math.max(0.001, projectLengthBeats));
  const snapStep = timelineSmartGrid ? 4 / Math.max(1, timelineSubdivision) : 1;
  const beat = shiftKey ? clamp(Math.round(rawBeat / snapStep) * snapStep, 0, Math.max(0.001, projectLengthBeats)) : rawBeat;
  return {
    beat,
    value: automationYToValue(target, clientY - previewTop, height),
  };
}

function firstVisibleArrangementAutomationLane(
  automation: MidiAutomationLane[] | undefined,
): MidiAutomationLane | undefined {
  return automation?.find((lane) =>
    ARRANGEMENT_AUTOMATION_TARGETS.has(lane.target as AetherArrangementAutomationTarget)
    && lane.points.length > 0
  );
}

function automationValueToY(target: AetherArrangementAutomationTarget, value: number, height: number): number {
  const meta = aetherArrangementAutomationTargetMeta(target);
  const normalized = meta.max === meta.min ? 0.5 : (clamp(value, meta.min, meta.max) - meta.min) / (meta.max - meta.min);
  return height - 4 - normalized * (height - 8);
}

function automationYToValue(target: AetherArrangementAutomationTarget, y: number, height: number): number {
  const meta = aetherArrangementAutomationTargetMeta(target);
  const normalized = clamp((height - 4 - y) / Math.max(1, height - 8), 0, 1);
  return clampAutomationValue(target, meta.min + normalized * (meta.max - meta.min));
}

function clampAutomationValue(target: AetherArrangementAutomationTarget, value: number): number {
  const meta = aetherArrangementAutomationTargetMeta(target);
  return clamp(value, meta.min, meta.max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
