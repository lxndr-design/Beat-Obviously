import {
  DEFAULT_DRUM_MIDI_PITCH,
  DEFAULT_DRUM_VELOCITY,
  drumPlaybackStepLengthBeats,
  drumTimingOffsetBeats,
  normalizeDrumCell,
} from "./drumSteps";
import { renderMidiArpeggiations } from "./midiNoteGroups";
import type { Id, MidiNote, Project, Segment } from "./types";

export const SEGMENT_EVENT_TICKS_PER_BEAT = 960;

export type CompiledSegmentEventKind = "midi" | "drum" | "drumpad";

/** A canonical, tick-addressed event shared by every note-based segment. */
export interface CompiledSegmentEvent {
  id: string;
  kind: CompiledSegmentEventKind;
  /** Stable editor order used to resolve events at the same tick. */
  sourceOrder: number;
  startTick: number;
  durationTicks: number;
  startBeat: number;
  lengthBeats: number;
  instrumentId?: Id;
  instrumentName?: string;
  note: MidiNote;
  /** Stable source id of a later note used as the glide target. */
  glideTargetId?: string;
}

export interface CompiledSegmentEvents {
  events: readonly CompiledSegmentEvent[];
  eventById: ReadonlyMap<string, CompiledSegmentEvent>;
  maxDurationTicks: number;
}

type RawEvent = Omit<CompiledSegmentEvent, "startTick" | "durationTicks" | "startBeat" | "lengthBeats" | "note"> & {
  rawStartBeat: number;
  rawLengthBeats: number;
  note: MidiNote;
};

const compiledCache = new WeakMap<Segment, CompiledSegmentEvents>();

/** Compile an editable payload into a clipped, stable, sorted event list. */
export function compileSegmentEvents(segment: Segment): CompiledSegmentEvents {
  const cached = compiledCache.get(segment);
  if (cached) return cached;

  const sourceStartBeat = finiteNonNegative(segment.sourceStartBeat, 0);
  const windowLengthBeats = finitePositive(segment.lengthBeats, 0.25);
  const clipped = rawEventsForSegment(segment).flatMap((event): CompiledSegmentEvent[] => {
    const rawEndBeat = event.rawStartBeat + event.rawLengthBeats;
    const startBeat = Math.max(0, event.rawStartBeat - sourceStartBeat);
    const endBeat = Math.min(windowLengthBeats, rawEndBeat - sourceStartBeat);
    if (endBeat - startBeat <= 1 / SEGMENT_EVENT_TICKS_PER_BEAT) return [];

    const shift = -sourceStartBeat;
    const note = shiftAndClipNote(event.note, shift, startBeat, endBeat - startBeat);
    return [{
      id: event.id,
      kind: event.kind,
      sourceOrder: event.sourceOrder,
      startTick: beatToTick(startBeat),
      durationTicks: Math.max(1, beatToTick(endBeat - startBeat)),
      startBeat,
      lengthBeats: endBeat - startBeat,
      instrumentId: event.instrumentId,
      instrumentName: event.instrumentName,
      note,
      glideTargetId: event.glideTargetId,
    }];
  });

  clipped.sort((a, b) =>
    a.startTick - b.startTick
    || a.sourceOrder - b.sourceOrder);

  const availableIds = new Set(clipped.map((event) => event.id));
  const events = Object.freeze(clipped.map((event) => ({
      ...event,
      glideTargetId: event.glideTargetId && availableIds.has(event.glideTargetId)
        ? event.glideTargetId
        : undefined,
    })));
  const result: CompiledSegmentEvents = {
    events,
    eventById: new Map(events.map((event) => [event.id, event])),
    maxDurationTicks: clipped.reduce((max, event) => Math.max(max, event.durationTicks), 0),
  };
  compiledCache.set(segment, result);
  return result;
}

/** Binary-search a compiled segment instead of rescanning every source lane. */
export function eventsStartingInBeatWindow(
  compiled: CompiledSegmentEvents,
  startBeat: number,
  endBeat: number,
): readonly CompiledSegmentEvent[] {
  if (compiled.events.length === 0 || endBeat < startBeat) return [];
  const startTick = beatToTick(startBeat);
  const endTick = beatToTick(endBeat);
  let low = 0;
  let high = compiled.events.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compiled.events[mid].startTick < startTick) low = mid + 1;
    else high = mid;
  }
  const first = low;
  low = first;
  high = compiled.events.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compiled.events[mid].startTick <= endTick) low = mid + 1;
    else high = mid;
  }
  return compiled.events.slice(first, low);
}

/**
 * Engine/export projection. Editable drum data stays untouched; only the
 * transient engine copy is converted to the same normalized MIDI events.
 */
export function projectWithCompiledSegmentEvents(project: Project): Project {
  const next = structuredClone(project);
  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex += 1) {
    const sourceTrack = project.tracks[trackIndex];
    const targetTrack = next.tracks[trackIndex];
    for (let segmentIndex = 0; segmentIndex < sourceTrack.segments.length; segmentIndex += 1) {
      const sourceSegment = sourceTrack.segments[segmentIndex];
      const targetSegment = targetTrack.segments[segmentIndex];
      if (sourceSegment.payload.kind === "audio") continue;
      const compiled = compileSegmentEvents(sourceSegment);
      const indexById = new Map(compiled.events.map((event, index) => [event.id, index]));
      const notes = compiled.events.map((event) => ({
        ...structuredClone(event.note),
        instrumentId: event.instrumentId,
        connectToIndex: event.glideTargetId == null ? undefined : indexById.get(event.glideTargetId),
      }));

      if (sourceSegment.payload.kind === "mixed") {
        targetSegment.payload = { ...structuredClone(sourceSegment.payload), notes };
      } else {
        const gainDb = sourceSegment.payload.kind === "midi" || sourceSegment.payload.kind === "drumpad"
          ? sourceSegment.payload.gainDb
          : undefined;
        targetSegment.payload = { kind: "midi", notes, ...(gainDb == null ? {} : { gainDb }) };
        targetSegment.sourceStartBeat = 0;
      }
    }
  }
  return next;
}

function rawEventsForSegment(segment: Segment): RawEvent[] {
  if (segment.payload.kind === "midi" || segment.payload.kind === "mixed") {
    const notes = renderMidiArpeggiations(segment.payload.notes);
    const ids = notes.map((note, index) => `midi:${note.id || index}:${index}`);
    const firstIncomingByTarget = new Map<number, number>();
    notes.forEach((note, sourceIndex) => {
      const targetIndex = note.connectToIndex;
      if (targetIndex == null || targetIndex < 0 || targetIndex >= notes.length || firstIncomingByTarget.has(targetIndex)) return;
      firstIncomingByTarget.set(targetIndex, sourceIndex);
    });
    return notes.map((note, index) => {
      const targetIndex = connectedLaterNoteIndex(notes, index, firstIncomingByTarget);
      const target = targetIndex == null ? undefined : notes[targetIndex];
      return {
        id: ids[index],
        kind: "midi",
        sourceOrder: index,
        rawStartBeat: finiteNonNegative(note.startBeat, 0),
        rawLengthBeats: target
          ? Math.max(0.03, target.startBeat - note.startBeat)
          : finitePositive(note.lengthBeats, 1 / SEGMENT_EVENT_TICKS_PER_BEAT),
        instrumentId: note.instrumentId ?? segment.instrumentId,
        note,
        glideTargetId: targetIndex == null ? undefined : ids[targetIndex],
      };
    });
  }

  if (segment.payload.kind === "drum") {
    const sourceLengthBeats = Math.max(0.25, segment.payload.sourceLengthBeats ?? segment.payload.stepCount);
    const stepLengthBeats = drumPlaybackStepLengthBeats(sourceLengthBeats, segment.payload.stepCount, segment.payload.speed ?? 1);
    const events: RawEvent[] = [];
    let sourceOrder = 0;
    for (const row of segment.payload.rows) {
      for (let step = 0; step < segment.payload.stepCount; step += 1) {
        const cell = normalizeDrumCell(row.steps[step]);
        if (!cell.on) continue;
        const frequencyHz = cell.pitchHz ?? segment.payload.defaultPitchHz;
        const pitch = frequencyHz == null ? DEFAULT_DRUM_MIDI_PITCH : frequencyToMidi(frequencyHz);
        const rawStartBeat = step * stepLengthBeats
          + drumTimingOffsetBeats(step, stepLengthBeats, segment.payload.swingPercent, cell.leanPercent);
        const rawLengthBeats = Math.min(0.25, stepLengthBeats);
        const id = `drum:${row.id}:${step}`;
        events.push({
          id,
          kind: "drum",
          sourceOrder: sourceOrder++,
          rawStartBeat,
          rawLengthBeats,
          instrumentId: row.instrumentId ?? segment.instrumentId,
          instrumentName: row.name,
          note: {
            id,
            pitch,
            frequencyHz,
            velocity: cell.velocity ?? DEFAULT_DRUM_VELOCITY,
            startBeat: rawStartBeat,
            lengthBeats: rawLengthBeats,
          },
        });
      }
    }
    return events;
  }

  if (segment.payload.kind === "drumpad") {
    const laneById = new Map(segment.payload.lanes.map((lane) => [lane.id, lane]));
    return segment.payload.hits.flatMap((hit, index): RawEvent[] => {
      const lane = laneById.get(hit.laneId);
      if (!lane || lane.muted) return [];
      return [{
        id: `drumpad:${hit.id || index}:${index}`,
        kind: "drumpad",
        sourceOrder: index,
        rawStartBeat: finiteNonNegative(hit.startBeat, 0),
        rawLengthBeats: finitePositive(hit.lengthBeats, 1 / SEGMENT_EVENT_TICKS_PER_BEAT),
        instrumentId: lane.instrumentId ?? segment.instrumentId,
        instrumentName: lane.name,
        note: {
          id: hit.id,
          pitch: lane.pitch ?? DEFAULT_DRUM_MIDI_PITCH,
          velocity: hit.velocity,
          startBeat: hit.startBeat,
          lengthBeats: hit.lengthBeats,
        },
      }];
    });
  }

  return [];
}

function shiftAndClipNote(note: MidiNote, beatShift: number, startBeat: number, lengthBeats: number): MidiNote {
  const shiftPoint = <T extends { beat: number }>(point: T): T => ({ ...point, beat: point.beat + beatShift });
  return {
    ...note,
    startBeat,
    lengthBeats,
    curve: note.curve?.map(shiftPoint),
    automation: note.automation?.map((lane) => ({ ...lane, points: lane.points.map(shiftPoint) })),
  };
}

function connectedLaterNoteIndex(notes: MidiNote[], index: number, firstIncomingByTarget: ReadonlyMap<number, number>): number | undefined {
  const note = notes[index];
  const candidateIndices = [note.connectToIndex, firstIncomingByTarget.get(index)]
    .filter((candidate): candidate is number => candidate != null && candidate >= 0 && candidate < notes.length)
    .sort((a, b) => notes[a].startBeat - notes[b].startBeat);
  const targetIndex = candidateIndices[0];
  return targetIndex != null && notes[targetIndex].startBeat > note.startBeat ? targetIndex : undefined;
}

function beatToTick(beat: number): number {
  return Math.round(beat * SEGMENT_EVENT_TICKS_PER_BEAT);
}

function frequencyToMidi(frequencyHz: number): number {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return DEFAULT_DRUM_MIDI_PITCH;
  return Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(frequencyHz / 440))));
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : fallback;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0 ? value as number : fallback;
}
