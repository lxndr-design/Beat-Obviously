import {
  AETHER_NOTE_AUTOMATION_TARGETS,
  type AetherNoteAutomationTargetMeta,
  aetherNoteAutomationDefaultValue,
  aetherNoteAutomationTargetLabel,
  aetherNoteAutomationTargetMeta,
  formatAetherNoteAutomationValue,
} from "./aetherNoteAutomation";
import type { AutomationCurve, MidiAutomationLane, MidiAutomationTarget, Segment } from "../state/types";

export type AetherArrangementAutomationTarget = Exclude<MidiAutomationTarget, "pitch">;
type AetherArrangementAutomationTargetMeta = Omit<AetherNoteAutomationTargetMeta, "target"> & {
  target: AetherArrangementAutomationTarget;
};

export const AETHER_ARRANGEMENT_AUTOMATION_TARGETS = AETHER_NOTE_AUTOMATION_TARGETS
  .filter((meta) => meta.target !== "pitch") as AetherArrangementAutomationTargetMeta[];

export {
  aetherNoteAutomationTargetLabel as aetherArrangementAutomationTargetLabel,
  aetherNoteAutomationTargetMeta as aetherArrangementAutomationTargetMeta,
  formatAetherNoteAutomationValue as formatAetherArrangementAutomationValue,
};

export function segmentAutomationTargetCount(segment: Segment | undefined): number {
  if (!segment) return 0;
  return new Set((segment.automation ?? []).filter((lane) => lane.points.length > 0).map((lane) => lane.target)).size;
}

export function segmentHasAutomationTarget(segment: Segment | undefined, target: AetherArrangementAutomationTarget): boolean {
  if (!segment) return false;
  return Boolean(segment.automation?.some((lane) => lane.target === target && lane.points.length > 0));
}

export function upsertSegmentAutomationTarget(
  segment: Segment,
  target: AetherArrangementAutomationTarget,
): Segment {
  const lane = defaultSegmentAutomationLane(segment, target);
  const lanes = (segment.automation ?? []).filter((candidate) => candidate.target !== target);
  return {
    ...segment,
    automation: [...lanes, lane],
  };
}

export function clearSegmentAutomationTarget(
  segment: Segment,
  target: AetherArrangementAutomationTarget,
): Segment {
  const automation = (segment.automation ?? []).filter((lane) => lane.target !== target);
  return {
    ...segment,
    automation: automation.length > 0 ? automation : undefined,
  };
}

export function setSegmentAutomationTargetValues(
  segment: Segment,
  target: AetherArrangementAutomationTarget,
  startValue: number,
  endValue: number,
  midValue?: number,
): Segment {
  const meta = aetherNoteAutomationTargetMeta(target);
  const start = clamp(startValue, meta.min, meta.max);
  const end = clamp(endValue, meta.min, meta.max);
  const mid = midValue == null || !Number.isFinite(midValue)
    ? undefined
    : clamp(midValue, meta.min, meta.max);
  const existingLane = segment.automation?.find((candidate) => candidate.target === target);
  const curve = laneAutomationCurve(existingLane);
  const lengthBeats = Math.max(0.001, segment.lengthBeats);
  const lane: MidiAutomationLane = {
    target,
    points: [
      automationPoint(0, start, curve),
      ...(mid == null ? [] : [automationPoint(lengthBeats / 2, mid, curve)]),
      automationPoint(lengthBeats, end, curve),
    ],
  };
  const lanes = (segment.automation ?? []).filter((candidate) => candidate.target !== target);
  return {
    ...segment,
    automation: [...lanes, lane],
  };
}

export function setSegmentAutomationTargetCurve(
  segment: Segment,
  target: AetherArrangementAutomationTarget,
  curve: AutomationCurve,
): Segment {
  const existingLane = segment.automation?.find((candidate) => candidate.target === target);
  if (!existingLane) return segment;
  const lanes = (segment.automation ?? []).filter((candidate) => candidate.target !== target);
  return {
    ...segment,
    automation: [
      ...lanes,
      {
        ...existingLane,
        points: existingLane.points.map((point) => ({ ...point, curve })),
      },
    ],
  };
}

export function segmentAutomationSummary(segment: Segment | undefined, target: AetherArrangementAutomationTarget): string {
  if (!segment) return "No segment";
  return segmentHasAutomationTarget(segment, target) ? "1/1 segment" : "0/1 segment";
}

export function segmentAutomationValueRange(
  segment: Segment | undefined,
  target: AetherArrangementAutomationTarget,
): { startValue: number; midValue: number; endValue: number; active: boolean; midCount: number } {
  const defaultValue = aetherNoteAutomationDefaultValue(target);
  const lane = segment?.automation?.find((candidate) => candidate.target === target && candidate.points.length > 0);
  if (!lane) return { startValue: defaultValue, midValue: defaultValue, endValue: defaultValue, active: false, midCount: 0 };
  const startValue = lane.points[0]?.value ?? defaultValue;
  const endValue = lane.points[lane.points.length - 1]?.value ?? startValue;
  const midValue = midpointValue(lane);
  return {
    startValue,
    midValue: midValue ?? (startValue + endValue) / 2,
    endValue,
    active: true,
    midCount: midValue == null ? 0 : 1,
  };
}

export function segmentAutomationCurve(
  segment: Segment | undefined,
  target: AetherArrangementAutomationTarget,
): AutomationCurve {
  const lane = segment?.automation?.find((candidate) => candidate.target === target && candidate.points.length > 0);
  return laneAutomationCurve(lane) ?? "linear";
}

export function clipSegmentAutomation(
  automation: MidiAutomationLane[] | undefined,
  lengthBeats: number,
): MidiAutomationLane[] | undefined {
  if (!automation?.length) return undefined;
  const safeLength = Math.max(0.001, lengthBeats);
  const lanes = automation
    .map((lane) => ({
      ...lane,
      points: lane.points
        .filter((point) => point.beat >= 0 && point.beat <= safeLength)
        .map((point) => ({ ...point })),
    }))
    .filter((lane) => lane.points.length > 0);
  return lanes.length > 0 ? lanes : undefined;
}

function defaultSegmentAutomationLane(segment: Segment, target: AetherArrangementAutomationTarget): MidiAutomationLane {
  const value = aetherNoteAutomationDefaultValue(target);
  return {
    target,
    points: [
      { beat: 0, value },
      { beat: Math.max(0.001, segment.lengthBeats), value },
    ],
  };
}

function midpointValue(lane: MidiAutomationLane): number | undefined {
  if (lane.points.length < 3) return undefined;
  return lane.points[Math.floor(lane.points.length / 2)]?.value;
}

function laneAutomationCurve(lane: MidiAutomationLane | undefined): AutomationCurve | undefined {
  return lane?.points.find((point) => point.curve)?.curve;
}

function automationPoint(beat: number, value: number, curve: AutomationCurve | undefined): MidiAutomationLane["points"][number] {
  return curve ? { beat, value, curve } : { beat, value };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
