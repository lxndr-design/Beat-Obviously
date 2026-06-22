import type { MidiAutomationLane, MidiAutomationTarget, MidiNote } from "../state/types";

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
): MidiNote[] {
  if (target === "pitch") return notes;
  const targets = new Set(indices.filter((index) => notes[index]));
  if (targets.size === 0) return notes;
  const meta = aetherNoteAutomationTargetMeta(target);
  const start = clamp(startValue, meta.min, meta.max);
  const end = clamp(endValue, meta.min, meta.max);
  return notes.map((note, index) => {
    if (!targets.has(index)) return note;
    const lane: MidiAutomationLane = {
      target,
      points: [
        { beat: note.startBeat, value: start },
        { beat: note.startBeat + Math.max(0.001, note.lengthBeats), value: end },
      ],
    };
    const lanes = (note.automation ?? []).filter((candidate) => candidate.target !== target);
    return {
      ...note,
      automation: [...lanes, lane],
    };
  });
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

export function selectedMidiNoteAutomationValueRange(
  notes: MidiNote[],
  indices: number[],
  target: MidiAutomationTarget,
): { startValue: number; endValue: number; activeCount: number } {
  const defaultValue = aetherNoteAutomationDefaultValue(target);
  if (target === "pitch") return { startValue: defaultValue, endValue: defaultValue, activeCount: 0 };
  const selectedNotes = indices.map((index) => notes[index]).filter(Boolean) as MidiNote[];
  const lanes = selectedNotes
    .map((note) => note.automation?.find((lane) => lane.target === target && lane.points.length > 0))
    .filter(Boolean) as MidiAutomationLane[];
  if (lanes.length === 0) return { startValue: defaultValue, endValue: defaultValue, activeCount: 0 };
  const starts = lanes.map((lane) => lane.points[0]?.value ?? defaultValue);
  const ends = lanes.map((lane) => lane.points[lane.points.length - 1]?.value ?? starts[starts.length - 1] ?? defaultValue);
  return {
    startValue: average(starts, defaultValue),
    endValue: average(ends, defaultValue),
    activeCount: lanes.length,
  };
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
