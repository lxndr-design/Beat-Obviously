/**
 * Shared geometry constants for the sequencer grid.
 * Every dimension on the timeline/tracks/segments derives from these.
 * Multiples of 8 (px-per-beat = 64) keep the 8px grid alignment.
 */
export const BEATS_TO_PX = 64; // 1 beat = 64px (8 * 8 grid units)
export const TRACK_HEADER_WIDTH = 160; // 20 * 8
export const SEGMENT_LAYER_OFFSET_PX = 8;
export const MIN_SEGMENT_PX = 32;
