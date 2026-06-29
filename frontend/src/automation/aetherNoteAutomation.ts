import type { AutomationCurve, MidiAutomationLane, MidiAutomationTarget, MidiNote } from "../state/types";
import {
  aetherAutomationConflictReport,
  aetherAutomationEffectiveBadge,
  type AetherAutomationConflictSource,
  type AetherAutomationEffectiveBadge,
} from "./aetherAutomationConflicts";

export interface AetherNoteAutomationTargetMeta {
  target: MidiAutomationTarget;
  label: string;
  group: "Pitch" | "Wavemap" | "Filter" | "Amp" | "Macro";
  defaultValue: number;
  min: number;
  max: number;
  step: number;
}

export const AETHER_NOTE_AUTOMATION_TARGETS: AetherNoteAutomationTargetMeta[] = [
  { target: "pitch", label: "Pitch", group: "Pitch", defaultValue: 0, min: -12, max: 12, step: 0.01 },
  { target: "osc.a.position", label: "Wave A", group: "Wavemap", defaultValue: 0.5, min: 0, max: 1, step: 0.01 },
  { target: "osc.b.position", label: "Wave B", group: "Wavemap", defaultValue: 0.5, min: 0, max: 1, step: 0.01 },
  { target: "filter.cutoff", label: "Cutoff", group: "Filter", defaultValue: 0.7, min: 0, max: 1, step: 0.01 },
  { target: "filter.resonance", label: "Res", group: "Filter", defaultValue: 0.2, min: 0, max: 1, step: 0.01 },
  { target: "filter.drive", label: "Drive", group: "Filter", defaultValue: 0.12, min: 0, max: 1, step: 0.01 },
  { target: "amp.level", label: "Level", group: "Amp", defaultValue: 0.82, min: 0, max: 1, step: 0.01 },
  { target: "amp.pan", label: "Pan", group: "Amp", defaultValue: 0, min: -1, max: 1, step: 0.01 },
  { target: "macro.1", label: "Macro 1", group: "Macro", defaultValue: 0.5, min: 0, max: 1, step: 0.01 },
  { target: "macro.2", label: "Macro 2", group: "Macro", defaultValue: 0.5, min: 0, max: 1, step: 0.01 },
  { target: "macro.3", label: "Macro 3", group: "Macro", defaultValue: 0.5, min: 0, max: 1, step: 0.01 },
  { target: "macro.4", label: "Macro 4", group: "Macro", defaultValue: 0.5, min: 0, max: 1, step: 0.01 },
];

const TARGET_LABELS = new Map(AETHER_NOTE_AUTOMATION_TARGETS.map((meta) => [meta.target, meta.label]));
const TARGET_DEFAULTS = new Map(AETHER_NOTE_AUTOMATION_TARGETS.map((meta) => [meta.target, meta.defaultValue]));
const TARGET_META = new Map(AETHER_NOTE_AUTOMATION_TARGETS.map((meta) => [meta.target, meta]));

export function aetherNoteAutomationTargetLabel(target: MidiAutomationTarget): string {
  return TARGET_LABELS.get(target) ?? target;
}

export function aetherNoteAutomationDefaultValue(target: MidiAutomationTarget): number {
  return TARGET_DEFAULTS.get(target) ?? 0;
}

export function aetherNoteAutomationTargetMeta(target: MidiAutomationTarget): AetherNoteAutomationTargetMeta {
  return TARGET_META.get(target) ?? { target, label: target, group: "Macro", defaultValue: 0, min: 0, max: 1, step: 0.01 };
}

export function formatAetherNoteAutomationValue(target: MidiAutomationTarget, value: number): string {
  if (target === "pitch") return `${formatSigned(value)} st`;
  if (target.endsWith(".pan")) return `${formatSigned(Math.round(value * 100))}`;
  return `${Math.round(value * 100)}%`;
}

export function normalizeAetherNoteAutomationValue(target: MidiAutomationTarget, value: number): number {
  const meta = aetherNoteAutomationTargetMeta(target);
  const span = Math.max(0.000001, meta.max - meta.min);
  return clamp((value - meta.min) / span, 0, 1);
}

export function denormalizeAetherNoteAutomationValue(target: MidiAutomationTarget, normalized: number): number {
  const meta = aetherNoteAutomationTargetMeta(target);
  const value = meta.min + clamp(normalized, 0, 1) * (meta.max - meta.min);
  return Math.round(value / meta.step) * meta.step;
}

export function midiNoteHasAutomationTarget(note: MidiNote | undefined, target: MidiAutomationTarget): boolean {
  if (!note) return false;
  if (target === "pitch") return Boolean(note.curve && note.curve.length >= 2);
  return Boolean(note.automation?.some((lane) => lane.target === target && lane.points.length > 0));
}

export function midiNoteAutomationTargetCount(note: MidiNote | undefined): number {
  if (!note) return 0;
  const laneCount = new Set((note.automation ?? []).filter((lane) => lane.points.length > 0).map((lane) => lane.target)).size;
  return laneCount + (note.curve && note.curve.length >= 2 ? 1 : 0);
}

export function upsertMidiNoteAutomationTarget(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
): MidiNote[] {
  const targets = new Set(indices.filter((index) => notes[index]));
  if (targets.size === 0) return notes;
  return notes.map((note, index) => {
    if (!targets.has(index)) return note;
    if (target === "pitch") return withDefaultPitchCurve(note);
    const lane = defaultMidiAutomationLane(note, target);
    const lanes = (note.automation ?? []).filter((candidate) => candidate.target !== target);
    return {
      ...note,
      automation: [...lanes, lane],
    };
  });
}

export function clearMidiNoteAutomationTarget(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
): MidiNote[] {
  const targets = new Set(indices.filter((index) => notes[index]));
  if (targets.size === 0) return notes;
  return notes.map((note, index) => {
    if (!targets.has(index)) return note;
    if (target === "pitch") {
      const { curve: _curve, ...rest } = note;
      return rest;
    }
    const automation = (note.automation ?? []).filter((lane) => lane.target !== target);
    return {
      ...note,
      automation: automation.length > 0 ? automation : undefined,
    };
  });
}

export function setMidiNoteAutomationTargetValues(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
  startValue: number,
  endValue: number,
  midValue?: number,
): MidiNote[] {
  if (target === "pitch") return notes;
  const targets = new Set(indices.filter((index) => notes[index]));
  if (targets.size === 0) return notes;
  const meta = aetherNoteAutomationTargetMeta(target);
  const start = clamp(startValue, meta.min, meta.max);
  const end = clamp(endValue, meta.min, meta.max);
  const mid = midValue == null || !Number.isFinite(midValue)
    ? undefined
    : clamp(midValue, meta.min, meta.max);
  return notes.map((note, index) => {
    if (!targets.has(index)) return note;
    const existingLane = note.automation?.find((candidate) => candidate.target === target);
    const curve = laneAutomationCurve(existingLane);
    const points = [
      automationPoint(note.startBeat, start, curve),
      ...(mid == null
        ? []
        : [automationPoint(note.startBeat + Math.max(0.001, note.lengthBeats) / 2, mid, curve)]),
      automationPoint(note.startBeat + Math.max(0.001, note.lengthBeats), end, curve),
    ];
    const lane: MidiAutomationLane = {
      target,
      points,
    };
    const lanes = (note.automation ?? []).filter((candidate) => candidate.target !== target);
    return {
      ...note,
      automation: [...lanes, lane],
    };
  });
}

export function setMidiNoteAutomationTargetCurve(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
  curve: AutomationCurve,
): MidiNote[] {
  if (target === "pitch") return notes;
  const targets = new Set(indices.filter((index) => notes[index]));
  if (targets.size === 0) return notes;
  return notes.map((note, index) => {
    if (!targets.has(index)) return note;
    const existingLane = note.automation?.find((candidate) => candidate.target === target);
    const lane = existingLane ?? defaultMidiAutomationLane(note, target);
    const lanes = (note.automation ?? []).filter((candidate) => candidate.target !== target);
    return {
      ...note,
      automation: [
        ...lanes,
        {
          ...lane,
          points: lane.points.map((point) => ({ ...point, curve })),
        },
      ],
    };
  });
}

export function insertMidiNoteAutomationPoint(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
  localBeat: number,
  value: number,
): MidiNote[] {
  if (target === "pitch") return notes;
  return mutateSelectedNoteAutomationLanes(notes, indices, target, (note, lane) =>
    insertNoteAutomationPoint(note, lane, target, localBeat, value)
  );
}

export function updateMidiNoteAutomationPoint(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
  pointIndex: number,
  localBeat: number,
  value: number,
): MidiNote[] {
  if (target === "pitch") return notes;
  return mutateSelectedNoteAutomationLanes(notes, indices, target, (note, lane) =>
    updateNoteAutomationPoint(note, lane, target, pointIndex, localBeat, value)
  );
}

export function removeMidiNoteAutomationPoint(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
  pointIndex: number,
): MidiNote[] {
  if (target === "pitch") return notes;
  return mutateSelectedNoteAutomationLanes(notes, indices, target, (_note, lane) =>
    removeAutomationPoint(lane, pointIndex)
  );
}

export function quantizeMidiNoteAutomationPoints(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
  gridBeats: number,
): MidiNote[] {
  if (target === "pitch") return notes;
  return mutateExistingSelectedNoteAutomationLanes(notes, indices, target, (note, lane) =>
    quantizeNoteAutomationLaneBeats(note, lane, gridBeats)
  );
}

export function snapMidiNoteAutomationPointValues(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
): MidiNote[] {
  if (target === "pitch") return notes;
  return mutateExistingSelectedNoteAutomationLanes(notes, indices, target, (_note, lane) =>
    snapAutomationLaneValues(lane, target)
  );
}

export function offsetMidiNoteAutomation(
  automation: MidiAutomationLane[] | undefined,
  beatDelta: number,
): MidiAutomationLane[] | undefined {
  if (!automation?.length || !Number.isFinite(beatDelta) || Math.abs(beatDelta) < 0.000001) return automation ? structuredClone(automation) : undefined;
  return automation.map((lane) => ({
    ...lane,
    points: lane.points.map((point) => ({
      ...point,
      beat: point.beat + beatDelta,
    })),
  }));
}

export function selectedMidiNoteAutomationSummary(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
): string {
  const selectedNotes = indices.map((index) => notes[index]).filter(Boolean) as MidiNote[];
  if (selectedNotes.length === 0) return "Select notes";
  const active = selectedNotes.filter((note) => midiNoteHasAutomationTarget(note, target)).length;
  return `${active}/${selectedNotes.length} notes`;
}

export function selectedMidiNoteAutomationEffectiveBadge(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
  inheritedSources: AetherAutomationConflictSource[] = [],
): AetherAutomationEffectiveBadge {
  const selectedNotes = indices.map((index) => notes[index]).filter(Boolean) as MidiNote[];
  const active = selectedNotes.filter((note) => midiNoteHasAutomationTarget(note, target)).length;
  const label = active === selectedNotes.length ? "Note lane" : `${active}/${selectedNotes.length} notes`;
  return aetherAutomationEffectiveBadge(aetherAutomationConflictReport(target, [
    ...inheritedSources,
    ...(active > 0 ? [{ kind: "note" as const, target, label }] : []),
  ]));
}

export function selectedMidiNoteAutomationValueRange(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
): { startValue: number; midValue: number; endValue: number; activeCount: number; midCount: number } {
  const defaultValue = aetherNoteAutomationDefaultValue(target);
  if (target === "pitch") return { startValue: defaultValue, midValue: defaultValue, endValue: defaultValue, activeCount: 0, midCount: 0 };
  const selectedNotes = indices.map((index) => notes[index]).filter(Boolean) as MidiNote[];
  const lanes = selectedNotes
    .map((note) => note.automation?.find((lane) => lane.target === target && lane.points.length > 0))
    .filter(Boolean) as MidiAutomationLane[];
  if (lanes.length === 0) return { startValue: defaultValue, midValue: defaultValue, endValue: defaultValue, activeCount: 0, midCount: 0 };
  const starts = lanes.map((lane) => lane.points[0]?.value ?? defaultValue);
  const ends = lanes.map((lane) => lane.points[lane.points.length - 1]?.value ?? starts[starts.length - 1] ?? defaultValue);
  const mids = lanes
    .map((lane) => midpointValue(lane))
    .filter((value): value is number => value != null && Number.isFinite(value));
  const startValue = average(starts, defaultValue);
  const endValue = average(ends, defaultValue);
  return {
    startValue,
    midValue: mids.length > 0 ? average(mids, defaultValue) : (startValue + endValue) / 2,
    endValue,
    activeCount: lanes.length,
    midCount: mids.length,
  };
}

export function selectedMidiNoteAutomationCurve(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
): AutomationCurve {
  if (target === "pitch") return "linear";
  const selectedNotes = indices.map((index) => notes[index]).filter(Boolean) as MidiNote[];
  for (const note of selectedNotes) {
    const lane = note.automation?.find((candidate) => candidate.target === target && candidate.points.length > 0);
    const curve = laneAutomationCurve(lane);
    if (curve) return curve;
  }
  return "linear";
}

function mutateSelectedNoteAutomationLanes(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
  mutator: (note: MidiNote, lane: MidiAutomationLane) => MidiAutomationLane | null,
): MidiNote[] {
  const targets = new Set(indices.filter((index) => notes[index]));
  if (targets.size === 0) return notes;
  return notes.map((note, index) => {
    if (!targets.has(index)) return note;
    const existingLane = note.automation?.find((candidate) => candidate.target === target);
    const lane = existingLane ?? defaultMidiAutomationLane(note, target);
    const nextLane = mutator(note, lane);
    const lanes = (note.automation ?? []).filter((candidate) => candidate.target !== target);
    return {
      ...note,
      automation: nextLane ? [...lanes, nextLane] : lanes.length > 0 ? lanes : undefined,
    };
  });
}

function mutateExistingSelectedNoteAutomationLanes(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
  mutator: (note: MidiNote, lane: MidiAutomationLane) => MidiAutomationLane | null,
): MidiNote[] {
  const targets = new Set(indices.filter((index) => notes[index]));
  if (targets.size === 0) return notes;
  return notes.map((note, index) => {
    if (!targets.has(index)) return note;
    const existingLane = note.automation?.find((candidate) => candidate.target === target);
    if (!existingLane) return note;
    const nextLane = mutator(note, existingLane);
    const lanes = (note.automation ?? []).filter((candidate) => candidate.target !== target);
    return {
      ...note,
      automation: nextLane ? [...lanes, nextLane] : lanes.length > 0 ? lanes : undefined,
    };
  });
}

function insertNoteAutomationPoint(
  note: MidiNote,
  lane: MidiAutomationLane,
  target: MidiAutomationTarget,
  localBeat: number,
  value: number,
): MidiAutomationLane {
  const curve = laneAutomationCurve(lane);
  const point = automationPoint(note.startBeat + clampLocalBeat(localBeat, note), clampTargetValue(target, value), curve);
  return {
    ...lane,
    points: normalizeAutomationPoints([...lane.points, point]),
  };
}

function updateNoteAutomationPoint(
  note: MidiNote,
  lane: MidiAutomationLane,
  target: MidiAutomationTarget,
  pointIndex: number,
  localBeat: number,
  value: number,
): MidiAutomationLane {
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= lane.points.length) return lane;
  return {
    ...lane,
    points: normalizeAutomationPoints(lane.points.map((point, index) =>
      index === pointIndex
        ? { ...point, beat: note.startBeat + clampLocalBeat(localBeat, note), value: clampTargetValue(target, value) }
        : { ...point },
    )),
  };
}

function removeAutomationPoint(lane: MidiAutomationLane, pointIndex: number): MidiAutomationLane | null {
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= lane.points.length) return lane;
  const points = lane.points.filter((_, index) => index !== pointIndex).map((point) => ({ ...point }));
  return points.length > 0 ? { ...lane, points } : null;
}

function quantizeNoteAutomationLaneBeats(
  note: MidiNote,
  lane: MidiAutomationLane,
  gridBeats: number,
): MidiAutomationLane {
  const step = Number.isFinite(gridBeats) && gridBeats > 0 ? gridBeats : 0.25;
  return {
    ...lane,
    points: normalizeAutomationPoints(lane.points.map((point) => {
      const localBeat = clampLocalBeat(point.beat - note.startBeat, note);
      return {
        ...point,
        beat: note.startBeat + clampLocalBeat(Math.round(localBeat / step) * step, note),
      };
    })),
  };
}

function snapAutomationLaneValues(
  lane: MidiAutomationLane,
  target: MidiAutomationTarget,
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

function defaultMidiAutomationLane(note: MidiNote, target: MidiAutomationTarget): MidiAutomationLane {
  const value = aetherNoteAutomationDefaultValue(target);
  return {
    target,
    points: [
      { beat: note.startBeat, value },
      { beat: note.startBeat + Math.max(0.001, note.lengthBeats), value },
    ],
  };
}

function automationPoint(beat: number, value: number, curve: AutomationCurve | undefined): MidiAutomationLane["points"][number] {
  return curve ? { beat, value, curve } : { beat, value };
}

function clampLocalBeat(value: number, note: MidiNote): number {
  return Math.max(0, Math.min(Math.max(0.001, note.lengthBeats), Number.isFinite(value) ? value : 0));
}

function clampTargetValue(target: MidiAutomationTarget, value: number): number {
  const meta = aetherNoteAutomationTargetMeta(target);
  return clamp(value, meta.min, meta.max);
}

function snapTargetValue(target: MidiAutomationTarget, value: number): number {
  const meta = aetherNoteAutomationTargetMeta(target);
  const step = Number.isFinite(meta.step) && meta.step > 0 ? meta.step : 0.01;
  const snapped = Math.round(clamp(value, meta.min, meta.max) / step) * step;
  return clamp(Number(snapped.toFixed(6)), meta.min, meta.max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function average(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatSigned(value: number): string {
  if (Object.is(value, -0)) return "0";
  return value > 0 ? `+${value}` : `${value}`;
}

function withDefaultPitchCurve(note: MidiNote): MidiNote {
  if (note.curve && note.curve.length >= 2) return note;
  return {
    ...note,
    curve: [
      { beat: note.startBeat, pitch: note.pitch },
      { beat: note.startBeat + Math.max(0.001, note.lengthBeats), pitch: note.pitch },
    ],
  };
}
