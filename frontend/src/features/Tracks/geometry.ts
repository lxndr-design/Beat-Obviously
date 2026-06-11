/**
 * Shared geometry constants for the sequencer grid.
 * Every dimension on the timeline/tracks/segments derives from these.
 * Multiples of 8 (px-per-beat = 64) keep the 8px grid alignment.
 */
export const BEATS_TO_PX = 64;  // 1 beat = 64px (8 * 8 grid units)
export const TRACK_HEADER_WIDTH = 160; // 20 * 8
export const SEGMENT_LAYER_OFFSET_PX = 8;
export const MIN_SEGMENT_PX = 32;

export interface TimelineRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TimelineMarqueeStyle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function beatToTimelineX(beat: number, beatsToPx = BEATS_TO_PX): number {
  return safeNumber(beat) * safeScale(beatsToPx);
}

export function timelineXToBeat(x: number, beatsToPx = BEATS_TO_PX): number {
  return safeNumber(x) / safeScale(beatsToPx);
}

export function timelineContentWidth(lengthBeats: number, beatsToPx = BEATS_TO_PX): number {
  return Math.max(0, safeNumber(lengthBeats)) * safeScale(beatsToPx);
}

export function normalizedTimelineRect(leftA: number, topA: number, leftB: number, topB: number): TimelineRect {
  const left = Math.min(leftA, leftB);
  const top = Math.min(topA, topB);
  const right = Math.max(leftA, leftB);
  const bottom = Math.max(topA, topB);
  return { left, top, right, bottom };
}

export function rectsOverlap(a: TimelineRect, b: TimelineRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

export function clampClientYToTimeline(clientY: number, timelineTop?: number): number {
  if (timelineTop == null || !Number.isFinite(timelineTop)) return clientY;
  return Math.min(clientY, timelineTop);
}

export function marqueeStyleFromClientPoints(
  startClientX: number,
  startClientY: number,
  currentClientX: number,
  currentClientY: number,
  innerLeft = 0,
  innerTop = 0,
  timelineTop?: number,
): TimelineMarqueeStyle {
  const startY = clampClientYToTimeline(startClientY, timelineTop);
  const currentY = clampClientYToTimeline(currentClientY, timelineTop);
  return {
    left: Math.min(startClientX, currentClientX) - innerLeft,
    top: Math.min(startY, currentY) - innerTop,
    width: Math.abs(currentClientX - startClientX),
    height: Math.abs(currentY - startY),
  };
}

function safeScale(value: number): number {
  return Math.max(1, safeNumber(value));
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
