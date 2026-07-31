import type { MidiNote } from "../../state/types";
import type { LumenClipMetadata, LumenClipNote } from "../../state/synthStore";

export const LUMEN_CLIP_REFERENCE_PITCH = 60;
export const LUMEN_CLIP_BOTTOM_PITCH = LUMEN_CLIP_REFERENCE_PITCH - 48;
export const LUMEN_CLIP_TOP_PITCH = LUMEN_CLIP_REFERENCE_PITCH + 48;
export const LUMEN_CLIP_MAX_NOTES = 64;

export function lumenClipPitchLabel(pitch: number): string {
  const offset = Math.round(pitch) - LUMEN_CLIP_REFERENCE_PITCH;
  return offset === 0 ? "0" : offset > 0 ? `+${offset}` : String(offset);
}

export function lumenClipToMidiNotes(clip: LumenClipMetadata): MidiNote[] {
  return clip.notes.map((note) => ({
    pitch: LUMEN_CLIP_REFERENCE_PITCH + note.pitchOffset,
    velocity: Math.max(1, Math.min(127, Math.round(note.velocity * 127))),
    startBeat: note.startStep,
    lengthBeats: note.lengthSteps,
  }));
}

export function midiNotesToLumenClip(
  current: LumenClipMetadata,
  midiNotes: MidiNote[],
  requestedLengthSteps = current.lengthSteps,
): LumenClipMetadata {
  const lengthSteps = Math.max(1, Math.min(32, Math.round(requestedLengthSteps)));
  const notesByStartAndPitch = new Map<string, LumenClipNote>();
  for (const midiNote of midiNotes) {
    const startStep = Math.max(0, Math.min(lengthSteps - 1, Math.round(midiNote.startBeat)));
    const pitchOffset = Math.max(-48, Math.min(48, Math.round(midiNote.pitch) - LUMEN_CLIP_REFERENCE_PITCH));
    const lengthStepsForNote = Math.max(1, Math.min(
      lengthSteps - startStep,
      Math.round(midiNote.lengthBeats),
    ));
    const velocity = Math.max(1 / 127, Math.min(1, Math.round(midiNote.velocity) / 127));
    notesByStartAndPitch.set(`${startStep}:${pitchOffset}`, {
      startStep,
      pitchOffset,
      lengthSteps: lengthStepsForNote,
      velocity,
    });
  }
  const notes = [...notesByStartAndPitch.values()]
    .sort((left, right) => left.startStep - right.startStep || left.pitchOffset - right.pitchOffset)
    .slice(0, LUMEN_CLIP_MAX_NOTES);
  return { schemaVersion: 2, lengthSteps, notes };
}

/**
 * Import a reusable Beat MIDI pattern into the trigger-relative clip model.
 * The first chronological note is treated as the trigger root, preserving the
 * pattern's intervals, timing, lengths, and velocities without instrument data.
 */
export function midiPatternToLumenClip(midiNotes: MidiNote[], patternLengthBeats: number): LumenClipMetadata {
  if (midiNotes.length === 0) return { schemaVersion: 2, lengthSteps: 1, notes: [] };
  const ordered = [...midiNotes].sort((left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch);
  const firstBeat = Math.max(0, ordered[0].startBeat);
  const rootPitch = ordered[0].pitch;
  const furthestEnd = Math.max(patternLengthBeats, ...ordered.map((note) => note.startBeat + note.lengthBeats));
  const lengthSteps = Math.max(1, Math.min(32, Math.ceil(furthestEnd - firstBeat)));
  const relativeNotes = ordered.map((note) => ({
    ...note,
    pitch: LUMEN_CLIP_REFERENCE_PITCH + (note.pitch - rootPitch),
    startBeat: Math.max(0, note.startBeat - firstBeat),
  }));
  return midiNotesToLumenClip({ schemaVersion: 2, lengthSteps, notes: [] }, relativeNotes, lengthSteps);
}
