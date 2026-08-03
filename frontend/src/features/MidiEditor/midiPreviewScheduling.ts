const DEFAULT_LATE_TOLERANCE_SECONDS = 0.05;

/**
 * Returns the non-negative preview delay for a note inside the current
 * scheduling window. A small late tolerance prevents notes exactly at the
 * playhead (especially beat zero) from being lost before the first RAF tick.
 */
export function midiPreviewDelaySeconds(
  noteStartBeat: number,
  positionBeat: number,
  lookaheadBeats: number,
  beatsPerSecond: number,
  lateToleranceSeconds = DEFAULT_LATE_TOLERANCE_SECONDS,
): number | null {
  const safeBeatsPerSecond = Math.max(0.001, beatsPerSecond);
  const lateToleranceBeats = Math.max(1 / 64, safeBeatsPerSecond * Math.max(0, lateToleranceSeconds));
  if (noteStartBeat < positionBeat - lateToleranceBeats || noteStartBeat > positionBeat + lookaheadBeats) return null;
  return Math.max(0, (noteStartBeat - positionBeat) / safeBeatsPerSecond);
}
