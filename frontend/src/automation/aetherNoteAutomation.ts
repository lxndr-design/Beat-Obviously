import type { MidiAutomationLane, MidiAutomationTarget, MidiNote } from "../state/types";

export interface AetherNoteAutomationTargetMeta {
  target: MidiAutomationTarget;
  label: string;
  group: "Pitch" | "Wavemap" | "Filter" | "Amp" | "Macro";
  defaultValue: number;
}

export const AETHER_NOTE_AUTOMATION_TARGETS: AetherNoteAutomationTargetMeta[] = [
  { target: "pitch", label: "Pitch", group: "Pitch", defaultValue: 0 },
  { target: "osc.a.position", label: "Wave A", group: "Wavemap", defaultValue: 0.5 },
  { target: "osc.b.position", label: "Wave B", group: "Wavemap", defaultValue: 0.5 },
  { target: "filter.cutoff", label: "Cutoff", group: "Filter", defaultValue: 0.7 },
  { target: "filter.resonance", label: "Res", group: "Filter", defaultValue: 0.2 },
  { target: "filter.drive", label: "Drive", group: "Filter", defaultValue: 0.12 },
  { target: "amp.level", label: "Level", group: "Amp", defaultValue: 0.82 },
  { target: "amp.pan", label: "Pan", group: "Amp", defaultValue: 0 },
  { target: "macro.1", label: "Macro 1", group: "Macro", defaultValue: 0.5 },
  { target: "macro.2", label: "Macro 2", group: "Macro", defaultValue: 0.5 },
  { target: "macro.3", label: "Macro 3", group: "Macro", defaultValue: 0.5 },
  { target: "macro.4", label: "Macro 4", group: "Macro", defaultValue: 0.5 },
];

const TARGET_LABELS = new Map(AETHER_NOTE_AUTOMATION_TARGETS.map((meta) => [meta.target, meta.label]));
const TARGET_DEFAULTS = new Map(AETHER_NOTE_AUTOMATION_TARGETS.map((meta) => [meta.target, meta.defaultValue]));

export function aetherNoteAutomationTargetLabel(target: MidiAutomationTarget): string {
  return TARGET_LABELS.get(target) ?? target;
}

export function aetherNoteAutomationDefaultValue(target: MidiAutomationTarget): number {
  return TARGET_DEFAULTS.get(target) ?? 0;
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
