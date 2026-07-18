export const DRUMPAD_HIT_PREVIEW_SECONDS = 0.18;
export const MIN_DRUMPAD_HIT_LENGTH_BEATS = 0.03125;

export function drumpadHitLengthBeats(bpm: number): number {
  return Math.max(MIN_DRUMPAD_HIT_LENGTH_BEATS, DRUMPAD_HIT_PREVIEW_SECONDS * (Math.max(1, bpm) / 60));
}

export function drumpadHitDurationSeconds(lengthBeats: number, bpm: number): number {
  return Math.max(0.03, Math.max(0, lengthBeats) / (Math.max(1, bpm) / 60));
}

export function preservedDrumpadRecordingView(
  visibleStartBeat: number,
  visibleLengthBeats: number,
  timelineLengthBeats: number,
): { startBeat: number; lengthBeats: number } {
  const timelineLength = Math.max(1, timelineLengthBeats);
  const lengthBeats = Math.min(timelineLength, Math.max(1, visibleLengthBeats));
  return {
    startBeat: Math.max(0, Math.min(visibleStartBeat, timelineLength - lengthBeats)),
    lengthBeats,
  };
}
