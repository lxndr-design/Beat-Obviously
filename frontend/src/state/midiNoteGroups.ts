import type {
  MidiArpeggiation,
  MidiArpeggiationNoteValue,
  MidiArpeggiationSequence,
  MidiArpeggiationTimingType,
  MidiNote,
  Project,
} from "./types";

export const MIDI_ARPEGGIATION_LOOP_MIN = 1;
export const MIDI_ARPEGGIATION_LOOP_MAX = 64;
export const MIDI_ARPEGGIATION_NOTE_VALUES: MidiArpeggiationNoteValue[] = [1, 2, 4, 8, 16, 32, 64];

export function midiGroupIndices(notes: MidiNote[], indices: number[]): number[] {
  const valid = uniqueValidIndices(notes, indices);
  const groupIds = new Set(valid.map((index) => notes[index].groupId).filter(Boolean));
  if (groupIds.size === 0) return valid;
  notes.forEach((note, index) => {
    if (note.groupId && groupIds.has(note.groupId)) valid.push(index);
  });
  return [...new Set(valid)].sort((a, b) => a - b);
}

export function midiSelectionIsSingleGroup(notes: MidiNote[], indices: number[]): boolean {
  const expanded = midiGroupIndices(notes, indices);
  if (expanded.length < 2) return false;
  const groupId = notes[expanded[0]]?.groupId;
  return Boolean(groupId && expanded.every((index) => notes[index]?.groupId === groupId));
}

export function midiSelectionCanArpeggiate(notes: MidiNote[], indices: number[]): boolean {
  const expanded = midiGroupIndices(notes, indices);
  return new Set(expanded.map((index) => notes[index]?.pitch)).size >= 2;
}

export function midiSelectionArpeggiation(notes: MidiNote[], indices: number[]): MidiArpeggiation | undefined {
  const expanded = midiGroupIndices(notes, indices);
  if (expanded.length === 0) return undefined;
  const groupId = notes[expanded[0]]?.groupId;
  if (!groupId || !expanded.every((index) => notes[index]?.groupId === groupId)) return undefined;
  return notes[expanded[0]]?.arpeggiation;
}

export function groupMidiNotes(
  notes: MidiNote[],
  indices: number[],
  groupId = createMidiGroupId(),
): { notes: MidiNote[]; indices: number[]; groupId?: string } {
  const selected = midiGroupIndices(notes, indices);
  if (selected.length < 2) return { notes, indices: selected };
  const next = notes.map((note) => ({ ...note }));
  const selectedSet = new Set(selected);
  const displacedGroupIds = new Set(
    selected.map((index) => next[index].groupId).filter((id): id is string => Boolean(id)),
  );
  for (const index of selected) {
    next[index] = { ...next[index], groupId, arpeggiation: undefined };
  }
  normalizeMidiGroups(next, displacedGroupIds, selectedSet);
  return { notes: next, indices: selected, groupId };
}

export function setMidiArpeggiation(
  notes: MidiNote[],
  indices: number[],
  settings: Pick<MidiArpeggiation, "loops" | "sequence" | "timingType" | "noteValue">,
  groupId = createMidiGroupId(),
): { notes: MidiNote[]; indices: number[]; groupId?: string } {
  const expanded = midiGroupIndices(notes, indices);
  if (!midiSelectionCanArpeggiate(notes, expanded)) return { notes, indices: expanded };
  const alreadyGrouped = midiSelectionIsSingleGroup(notes, expanded);
  const grouped = alreadyGrouped
    ? { notes: notes.map((note) => ({ ...note })), indices: expanded, groupId: notes[expanded[0]]?.groupId }
    : groupMidiNotes(notes, expanded, groupId);
  if (!grouped.groupId || grouped.indices.length < 2) return grouped;
  const arpeggiation: MidiArpeggiation = {
    schemaVersion: 1,
    loops: clampInteger(settings.loops, MIDI_ARPEGGIATION_LOOP_MIN, MIDI_ARPEGGIATION_LOOP_MAX),
    sequence: normalizeMidiArpeggiationSequence(settings.sequence),
    timingType: normalizeMidiArpeggiationTimingType(settings.timingType),
    noteValue: normalizeMidiArpeggiationNoteValue(settings.noteValue),
  };
  for (const index of grouped.indices) {
    grouped.notes[index] = { ...grouped.notes[index], arpeggiation: { ...arpeggiation } };
  }
  return grouped;
}

export function removeMidiArpeggiation(notes: MidiNote[], indices: number[]): MidiNote[] {
  const expanded = midiGroupIndices(notes, indices);
  if (expanded.length === 0) return notes;
  const affected = new Set(expanded);
  return notes.map((note, index) => affected.has(index) ? { ...note, arpeggiation: undefined } : note);
}

export function ungroupMidiNotes(notes: MidiNote[], indices: number[]): MidiNote[] {
  const expanded = midiGroupIndices(notes, indices);
  if (expanded.length === 0) return notes;
  const affected = new Set(expanded);
  return notes.map((note, index) =>
    affected.has(index) ? { ...note, groupId: undefined, arpeggiation: undefined } : note
  );
}

export function remapPastedMidiGroups(notes: MidiNote[], makeId = createMidiGroupId): MidiNote[] {
  const ids = new Map<string, string>();
  return notes.map((note) => {
    if (!note.groupId) return { ...note };
    const nextId = ids.get(note.groupId) ?? makeId();
    ids.set(note.groupId, nextId);
    return { ...note, groupId: nextId };
  });
}

export function renderMidiArpeggiations(notes: MidiNote[]): MidiNote[] {
  const groups = collectArpeggiatedGroups(notes);
  if (groups.size === 0) return notes;
  const rendered: MidiNote[] = [];
  const emitted = new Set<string>();
  notes.forEach((note) => {
    const groupId = note.groupId;
    const group = groupId ? groups.get(groupId) : undefined;
    if (!group) {
      rendered.push(note);
      return;
    }
    if (emitted.has(groupId!)) return;
    emitted.add(groupId!);
    rendered.push(...renderArpeggiatedGroup(group.notes, group.arpeggiation));
  });
  return rendered;
}

export function projectWithRenderedMidiArpeggiations(project: Project): Project {
  const next = structuredClone(project);
  for (const track of next.tracks) {
    for (const segment of track.segments) {
      if (segment.payload.kind !== "midi" && segment.payload.kind !== "mixed") continue;
      const rendered = renderMidiArpeggiations(segment.payload.notes);
      if (rendered !== segment.payload.notes) {
        segment.payload.notes = rendered;
      }
    }
  }
  return next;
}

export function midiGroupBounds(notes: MidiNote[]): Array<{
  groupId: string;
  arpeggiated: boolean;
  minStartBeat: number;
  maxEndBeat: number;
  minPitch: number;
  maxPitch: number;
}> {
  const groups = new Map<string, MidiNote[]>();
  for (const note of notes) {
    if (!note.groupId) continue;
    const members = groups.get(note.groupId) ?? [];
    members.push(note);
    groups.set(note.groupId, members);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([groupId, members]) => ({
      groupId,
      arpeggiated: members.some((note) => Boolean(note.arpeggiation)),
      minStartBeat: Math.min(...members.map((note) => note.startBeat)),
      maxEndBeat: Math.max(...members.map((note) => note.startBeat + note.lengthBeats)),
      minPitch: Math.min(...members.map((note) => note.pitch)),
      maxPitch: Math.max(...members.map((note) => note.pitch)),
    }));
}

function renderArpeggiatedGroup(notes: MidiNote[], settings: MidiArpeggiation): MidiNote[] {
  if (notes.length < 2) return notes;
  const startBeat = Math.min(...notes.map((note) => note.startBeat));
  const endBeat = Math.max(...notes.map((note) => note.startBeat + note.lengthBeats));
  const loops = clampInteger(settings.loops, MIDI_ARPEGGIATION_LOOP_MIN, MIDI_ARPEGGIATION_LOOP_MAX);
  const ordered = notesForArpeggiationSequence(notes, settings.sequence);
  const timingType = normalizeMidiArpeggiationTimingType(settings.timingType);
  const noteValue = normalizeMidiArpeggiationNoteValue(settings.noteValue);
  const groupLength = Math.max(1 / 1024, endBeat - startBeat);
  const stepLength = timingType === "notes-per-beat"
    ? Math.max(1 / 1024, 4 / noteValue)
    : Math.max(1 / 1024, groupLength / Math.max(1, ordered.length * loops));
  const stepCount = timingType === "notes-per-beat"
    ? Math.max(1, Math.ceil(groupLength / stepLength - 1e-9))
    : Math.max(1, ordered.length * loops);
  const rendered: MidiNote[] = [];
  for (let step = 0; step < stepCount; step += 1) {
      const source = ordered[step % ordered.length];
      const nextStartBeat = startBeat + step * stepLength;
      const renderedLength = Math.max(1 / 1024, Math.min(stepLength, endBeat - nextStartBeat));
      const sourceLength = Math.max(1 / 1024, source.lengthBeats);
      const scaleBeat = (beat: number) =>
        nextStartBeat + ((beat - source.startBeat) / sourceLength) * renderedLength;
      rendered.push({
        ...source,
        pitch: source.pitch,
        frequencyHz: undefined,
        startBeat: nextStartBeat,
        lengthBeats: renderedLength,
        connectToIndex: undefined,
        groupId: undefined,
        arpeggiation: undefined,
        curve: undefined,
        automation: source.automation?.filter((lane) => lane.target !== "pitch").map((lane) => ({
          ...lane,
          points: lane.points.map((point) => ({ ...point, beat: scaleBeat(point.beat) })),
        })),
      });
  }
  return rendered;
}

function notesForArpeggiationSequence(notes: MidiNote[], sequence: MidiArpeggiationSequence): MidiNote[] {
  const played = notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => a.note.startBeat - b.note.startBeat || a.index - b.index)
    .map(({ note }) => note);
  if (sequence === "played") return played;
  const up = [...played].sort((a, b) => a.pitch - b.pitch || a.startBeat - b.startBeat);
  const down = [...up].reverse();
  if (sequence === "up") return up;
  if (sequence === "down") return down;
  if (sequence === "up-down") {
    return up.length === 2 ? [...up, up[0]] : [...up, ...down.slice(1, -1)];
  }
  return down.length === 2 ? [...down, down[0]] : [...down, ...up.slice(1, -1)];
}

function collectArpeggiatedGroups(notes: MidiNote[]) {
  const candidates = new Map<string, { notes: MidiNote[]; arpeggiation?: MidiArpeggiation }>();
  for (const note of notes) {
    if (!note.groupId) continue;
    const current = candidates.get(note.groupId) ?? { notes: [] };
    current.notes.push(note);
    current.arpeggiation ??= note.arpeggiation;
    candidates.set(note.groupId, current);
  }
  const groups = new Map<string, { notes: MidiNote[]; arpeggiation: MidiArpeggiation }>();
  for (const [groupId, group] of candidates) {
    if (group.notes.length >= 2 && group.arpeggiation) {
      groups.set(groupId, { notes: group.notes, arpeggiation: group.arpeggiation });
    }
  }
  return groups;
}

function normalizeMidiGroups(notes: MidiNote[], groupIds: Set<string>, protectedIndices = new Set<number>()) {
  for (const groupId of groupIds) {
    const members = notes
      .map((note, index) => ({ note, index }))
      .filter(({ note, index }) => !protectedIndices.has(index) && note.groupId === groupId);
    if (members.length >= 2) continue;
    for (const { index } of members) {
      notes[index] = { ...notes[index], groupId: undefined, arpeggiation: undefined };
    }
  }
}

function uniqueValidIndices(notes: MidiNote[], indices: number[]): number[] {
  return [...new Set(indices)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < notes.length)
    .sort((a, b) => a - b);
}

function normalizeMidiArpeggiationSequence(sequence: MidiArpeggiationSequence): MidiArpeggiationSequence {
  return ["up", "down", "up-down", "down-up", "played"].includes(sequence) ? sequence : "up";
}

function normalizeMidiArpeggiationTimingType(timingType: MidiArpeggiationTimingType | undefined): MidiArpeggiationTimingType {
  return timingType === "notes-per-beat" ? timingType : "loops";
}

function normalizeMidiArpeggiationNoteValue(noteValue: MidiArpeggiationNoteValue | undefined): MidiArpeggiationNoteValue {
  return MIDI_ARPEGGIATION_NOTE_VALUES.includes(noteValue ?? 16) ? noteValue ?? 16 : 16;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));
}

function createMidiGroupId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `midi-group-${crypto.randomUUID()}`;
  }
  return `midi-group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
