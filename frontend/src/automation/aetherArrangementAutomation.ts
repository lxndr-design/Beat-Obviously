import {
  AETHER_NOTE_AUTOMATION_TARGETS,
  type AetherNoteAutomationTargetMeta,
  aetherNoteAutomationDefaultValue,
  aetherNoteAutomationTargetLabel,
  aetherNoteAutomationTargetMeta,
  formatAetherNoteAutomationValue,
} from "./aetherNoteAutomation";
import type { AutomationCurve, MidiAutomationLane, MidiAutomationTarget, Segment, Track } from "../state/types";

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
  return automationTargetCount(segment.automation);
}

export function segmentHasAutomationTarget(segment: Segment | undefined, target: AetherArrangementAutomationTarget): boolean {
  if (!segment) return false;
  return hasAutomationTarget(segment.automation, target);
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
  const lane = makeArrangementAutomationLane(
    segment.automation,
    target,
    segment.lengthBeats,
    startValue,
    endValue,
    midValue,
  );
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

export function insertSegmentAutomationPoint(
  segment: Segment,
  target: AetherArrangementAutomationTarget,
  beat: number,
  value: number,
): Segment {
  return mutateSegmentAutomationLane(segment, target, (lane) =>
    insertAutomationPoint(lane, target, beat, value, segment.lengthBeats)
  );
}

export function updateSegmentAutomationPoint(
  segment: Segment,
  target: AetherArrangementAutomationTarget,
  pointIndex: number,
  beat: number,
  value: number,
): Segment {
  return mutateSegmentAutomationLane(segment, target, (lane) =>
    updateAutomationPoint(lane, target, pointIndex, beat, value, segment.lengthBeats)
  );
}

export function removeSegmentAutomationPoint(
  segment: Segment,
  target: AetherArrangementAutomationTarget,
  pointIndex: number,
): Segment {
  return mutateSegmentAutomationLane(segment, target, (lane) => removeAutomationPoint(lane, pointIndex));
}

export function quantizeSegmentAutomationPoints(
  segment: Segment,
  target: AetherArrangementAutomationTarget,
  gridBeats: number,
): Segment {
  if (!segment.automation?.some((lane) => lane.target === target)) return segment;
  return mutateSegmentAutomationLane(segment, target, (lane) =>
    quantizeAutomationLaneBeats(lane, segment.lengthBeats, gridBeats)
  );
}

export function snapSegmentAutomationPointValues(
  segment: Segment,
  target: AetherArrangementAutomationTarget,
): Segment {
  if (!segment.automation?.some((lane) => lane.target === target)) return segment;
  return mutateSegmentAutomationLane(segment, target, (lane) => snapAutomationLaneValues(lane, target));
}

export function segmentAutomationSummary(segment: Segment | undefined, target: AetherArrangementAutomationTarget): string {
  if (!segment) return "No segment";
  return segmentHasAutomationTarget(segment, target) ? "1/1 segment" : "0/1 segment";
}

export function segmentAutomationValueRange(
  segment: Segment | undefined,
  target: AetherArrangementAutomationTarget,
): { startValue: number; midValue: number; endValue: number; active: boolean; midCount: number } {
  return automationValueRange(segment?.automation, target);
}

export function segmentAutomationCurve(
  segment: Segment | undefined,
  target: AetherArrangementAutomationTarget,
): AutomationCurve {
  const lane = segment?.automation?.find((candidate) => candidate.target === target && candidate.points.length > 0);
  return laneAutomationCurve(lane) ?? "linear";
}

export function trackAutomationTargetCount(track: Track | undefined): number {
  if (!track) return 0;
  return automationTargetCount(track.automation);
}

export function trackHasAutomationTarget(track: Track | undefined, target: AetherArrangementAutomationTarget): boolean {
  if (!track) return false;
  return hasAutomationTarget(track.automation, target);
}

export function upsertTrackAutomationTarget(
  track: Track,
  target: AetherArrangementAutomationTarget,
  projectLengthBeats: number,
): Track {
  const lane = defaultArrangementAutomationLane(projectLengthBeats, target);
  const lanes = (track.automation ?? []).filter((candidate) => candidate.target !== target);
  return {
    ...track,
    automation: [...lanes, lane],
  };
}

export function clearTrackAutomationTarget(
  track: Track,
  target: AetherArrangementAutomationTarget,
): Track {
  const automation = (track.automation ?? []).filter((lane) => lane.target !== target);
  return {
    ...track,
    automation: automation.length > 0 ? automation : undefined,
  };
}

export function setTrackAutomationTargetValues(
  track: Track,
  target: AetherArrangementAutomationTarget,
  projectLengthBeats: number,
  startValue: number,
  endValue: number,
  midValue?: number,
): Track {
  const lane = makeArrangementAutomationLane(
    track.automation,
    target,
    projectLengthBeats,
    startValue,
    endValue,
    midValue,
  );
  const lanes = (track.automation ?? []).filter((candidate) => candidate.target !== target);
  return {
    ...track,
    automation: [...lanes, lane],
  };
}

export function setTrackAutomationTargetCurve(
  track: Track,
  target: AetherArrangementAutomationTarget,
  curve: AutomationCurve,
): Track {
  const existingLane = track.automation?.find((candidate) => candidate.target === target);
  if (!existingLane) return track;
  const lanes = (track.automation ?? []).filter((candidate) => candidate.target !== target);
  return {
    ...track,
    automation: [
      ...lanes,
      {
        ...existingLane,
        points: existingLane.points.map((point) => ({ ...point, curve })),
      },
    ],
  };
}

export function insertTrackAutomationPoint(
  track: Track,
  target: AetherArrangementAutomationTarget,
  projectLengthBeats: number,
  beat: number,
  value: number,
): Track {
  return mutateTrackAutomationLane(track, target, projectLengthBeats, (lane) =>
    insertAutomationPoint(lane, target, beat, value, projectLengthBeats)
  );
}

export function updateTrackAutomationPoint(
  track: Track,
  target: AetherArrangementAutomationTarget,
  projectLengthBeats: number,
  pointIndex: number,
  beat: number,
  value: number,
): Track {
  return mutateTrackAutomationLane(track, target, projectLengthBeats, (lane) =>
    updateAutomationPoint(lane, target, pointIndex, beat, value, projectLengthBeats)
  );
}

export function removeTrackAutomationPoint(
  track: Track,
  target: AetherArrangementAutomationTarget,
  pointIndex: number,
): Track {
  return mutateTrackAutomationLane(track, target, undefined, (lane) => removeAutomationPoint(lane, pointIndex));
}

export function quantizeTrackAutomationPoints(
  track: Track,
  target: AetherArrangementAutomationTarget,
  projectLengthBeats: number,
  gridBeats: number,
): Track {
  if (!track.automation?.some((lane) => lane.target === target)) return track;
  return mutateTrackAutomationLane(track, target, projectLengthBeats, (lane) =>
    quantizeAutomationLaneBeats(lane, projectLengthBeats, gridBeats)
  );
}

export function snapTrackAutomationPointValues(
  track: Track,
  target: AetherArrangementAutomationTarget,
): Track {
  if (!track.automation?.some((lane) => lane.target === target)) return track;
  return mutateTrackAutomationLane(track, target, undefined, (lane) => snapAutomationLaneValues(lane, target));
}

export function trackAutomationSummary(track: Track | undefined, target: AetherArrangementAutomationTarget): string {
  if (!track) return "No track";
  return trackHasAutomationTarget(track, target) ? "1/1 track" : "0/1 track";
}

export function trackAutomationValueRange(
  track: Track | undefined,
  target: AetherArrangementAutomationTarget,
): { startValue: number; midValue: number; endValue: number; active: boolean; midCount: number } {
  return automationValueRange(track?.automation, target);
}

export function trackAutomationCurve(
  track: Track | undefined,
  target: AetherArrangementAutomationTarget,
): AutomationCurve {
  const lane = track?.automation?.find((candidate) => candidate.target === target && candidate.points.length > 0);
  return laneAutomationCurve(lane) ?? "linear";
}

export function clipTrackAutomation(
  automation: MidiAutomationLane[] | undefined,
  projectLengthBeats: number,
): MidiAutomationLane[] | undefined {
  return clipAutomation(automation, projectLengthBeats);
}

export function clipSegmentAutomation(
  automation: MidiAutomationLane[] | undefined,
  lengthBeats: number,
): MidiAutomationLane[] | undefined {
  return clipAutomation(automation, lengthBeats);
}

function automationTargetCount(automation: MidiAutomationLane[] | undefined): number {
  return new Set((automation ?? []).filter((lane) => lane.points.length > 0).map((lane) => lane.target)).size;
}

function hasAutomationTarget(
  automation: MidiAutomationLane[] | undefined,
  target: AetherArrangementAutomationTarget,
): boolean {
  return Boolean(automation?.some((lane) => lane.target === target && lane.points.length > 0));
}

function automationValueRange(
  automation: MidiAutomationLane[] | undefined,
  target: AetherArrangementAutomationTarget,
): { startValue: number; midValue: number; endValue: number; active: boolean; midCount: number } {
  const defaultValue = aetherNoteAutomationDefaultValue(target);
  const lane = automation?.find((candidate) => candidate.target === target && candidate.points.length > 0);
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

function mutateSegmentAutomationLane(
  segment: Segment,
  target: AetherArrangementAutomationTarget,
  mutator: (lane: MidiAutomationLane) => MidiAutomationLane | null,
): Segment {
  const existingLane = segment.automation?.find((candidate) => candidate.target === target);
  const lane = existingLane ?? defaultSegmentAutomationLane(segment, target);
  const nextLane = mutator(lane);
  const lanes = (segment.automation ?? []).filter((candidate) => candidate.target !== target);
  return {
    ...segment,
    automation: nextLane ? [...lanes, nextLane] : lanes.length > 0 ? lanes : undefined,
  };
}

function mutateTrackAutomationLane(
  track: Track,
  target: AetherArrangementAutomationTarget,
  projectLengthBeats: number | undefined,
  mutator: (lane: MidiAutomationLane) => MidiAutomationLane | null,
): Track {
  const existingLane = track.automation?.find((candidate) => candidate.target === target);
  const lane = existingLane ?? defaultArrangementAutomationLane(projectLengthBeats ?? 1, target);
  const nextLane = mutator(lane);
  const lanes = (track.automation ?? []).filter((candidate) => candidate.target !== target);
  return {
    ...track,
    automation: nextLane ? [...lanes, nextLane] : lanes.length > 0 ? lanes : undefined,
  };
}

function makeArrangementAutomationLane(
  automation: MidiAutomationLane[] | undefined,
  target: AetherArrangementAutomationTarget,
  lengthBeats: number,
  startValue: number,
  endValue: number,
  midValue?: number,
): MidiAutomationLane {
  const meta = aetherNoteAutomationTargetMeta(target);
  const start = clamp(startValue, meta.min, meta.max);
  const end = clamp(endValue, meta.min, meta.max);
  const mid = midValue == null || !Number.isFinite(midValue)
    ? undefined
    : clamp(midValue, meta.min, meta.max);
  const existingLane = automation?.find((candidate) => candidate.target === target);
  const curve = laneAutomationCurve(existingLane);
  const safeLength = Math.max(0.001, lengthBeats);
  return {
    target,
    points: [
      automationPoint(0, start, curve),
      ...(mid == null ? [] : [automationPoint(safeLength / 2, mid, curve)]),
      automationPoint(safeLength, end, curve),
    ],
  };
}

function defaultArrangementAutomationLane(lengthBeats: number, target: AetherArrangementAutomationTarget): MidiAutomationLane {
  const value = aetherNoteAutomationDefaultValue(target);
  return {
    target,
    points: [
      { beat: 0, value },
      { beat: Math.max(0.001, lengthBeats), value },
    ],
  };
}

function clipAutomation(
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
  return defaultArrangementAutomationLane(segment.lengthBeats, target);
}

function insertAutomationPoint(
  lane: MidiAutomationLane,
  target: AetherArrangementAutomationTarget,
  beat: number,
  value: number,
  lengthBeats: number,
): MidiAutomationLane {
  const curve = laneAutomationCurve(lane);
  const point = automationPoint(clampBeat(beat, lengthBeats), clampTargetValue(target, value), curve);
  return {
    ...lane,
    points: normalizeAutomationPoints([...lane.points, point]),
  };
}

function updateAutomationPoint(
  lane: MidiAutomationLane,
  target: AetherArrangementAutomationTarget,
  pointIndex: number,
  beat: number,
  value: number,
  lengthBeats: number,
): MidiAutomationLane {
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= lane.points.length) return lane;
  return {
    ...lane,
    points: normalizeAutomationPoints(lane.points.map((point, index) =>
      index === pointIndex
        ? { ...point, beat: clampBeat(beat, lengthBeats), value: clampTargetValue(target, value) }
        : { ...point },
    )),
  };
}

function removeAutomationPoint(lane: MidiAutomationLane, pointIndex: number): MidiAutomationLane | null {
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= lane.points.length) return lane;
  const points = lane.points.filter((_, index) => index !== pointIndex).map((point) => ({ ...point }));
  return points.length > 0 ? { ...lane, points } : null;
}

function quantizeAutomationLaneBeats(
  lane: MidiAutomationLane,
  lengthBeats: number,
  gridBeats: number,
): MidiAutomationLane {
  const step = Number.isFinite(gridBeats) && gridBeats > 0 ? gridBeats : 0.25;
  return {
    ...lane,
    points: normalizeAutomationPoints(lane.points.map((point) => ({
      ...point,
      beat: clampBeat(Math.round(point.beat / step) * step, lengthBeats),
    }))),
  };
}

function snapAutomationLaneValues(
  lane: MidiAutomationLane,
  target: AetherArrangementAutomationTarget,
): MidiAutomationLane {
  return {
    ...lane,
    points: normalizeAutomationPoints(lane.points.map((point) => ({
      ...point,
      value: snapTargetValue(target, point.value),
    }))),
  };
}

function normalizeAutomationPoints(points: MidiAutomationLane["points"]): MidiAutomationLane["points"] {
  return points
    .map((point) => ({ ...point }))
    .sort((a, b) => a.beat - b.beat);
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

function clampBeat(value: number, lengthBeats: number): number {
  return Math.max(0, Math.min(Math.max(0.001, lengthBeats), Number.isFinite(value) ? value : 0));
}

function clampTargetValue(target: AetherArrangementAutomationTarget, value: number): number {
  const meta = aetherNoteAutomationTargetMeta(target);
  return clamp(value, meta.min, meta.max);
}

function snapTargetValue(target: AetherArrangementAutomationTarget, value: number): number {
  const meta = aetherNoteAutomationTargetMeta(target);
  const step = Number.isFinite(meta.step) && meta.step > 0 ? meta.step : 0.01;
  const snapped = Math.round(clamp(value, meta.min, meta.max) / step) * step;
  return clamp(Number(snapped.toFixed(6)), meta.min, meta.max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
