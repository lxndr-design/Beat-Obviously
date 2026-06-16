export const GRID_TICK_BEATS = 1;

export interface SegmentSnapSettings {
  timeSignatureBeats: number;
  timelineSmartGrid: boolean;
  timelineSubdivision: number;
}

export function snapStepBeats(shift: boolean, settings: SegmentSnapSettings): number {
  if (shift) return Math.max(1, settings.timeSignatureBeats);
  return settings.timelineSmartGrid ? 4 / settings.timelineSubdivision : GRID_TICK_BEATS;
}

export function snapBeat(beat: number, shift: boolean, settings: SegmentSnapSettings): number {
  if (!shift) return Math.max(0, beat);
  const step = snapStepBeats(shift, settings);
  return Math.max(0, Math.round(beat / step) * step);
}

export function snapDragBeat(beat: number, shift: boolean, settings: SegmentSnapSettings): number {
  if (!shift) return Math.max(0, beat);
  const step = settings.timelineSmartGrid ? 4 / settings.timelineSubdivision : GRID_TICK_BEATS;
  return Math.max(0, Math.round(beat / step) * step);
}

export function snapLen(lengthBeats: number, shift: boolean, settings: SegmentSnapSettings): number {
  if (!shift) return Math.max(GRID_TICK_BEATS, lengthBeats);
  const step = snapStepBeats(shift, settings);
  return Math.max(GRID_TICK_BEATS, Math.round(lengthBeats / step) * step);
}

export function snapFadeLen(lengthBeats: number, maxLengthBeats: number, shift: boolean, settings: SegmentSnapSettings): number {
  if (!shift) return clampFadeLen(lengthBeats, maxLengthBeats);
  const step = snapStepBeats(shift, settings);
  return Math.max(0, Math.min(maxLengthBeats, Math.round(lengthBeats / step) * step));
}

export function clampFadeLen(lengthBeats: number, maxLengthBeats: number): number {
  return Math.max(0, Math.min(maxLengthBeats, lengthBeats));
}
