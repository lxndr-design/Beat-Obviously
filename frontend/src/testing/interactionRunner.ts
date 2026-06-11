import {
  clampClientYToTimeline,
  marqueeStyleFromClientPoints,
  timelineXToBeat,
  type TimelineRect,
} from "../features/Tracks/geometry";
import { decentSamplerEffects } from "../features/InstrumentLibrary/decentSamplerInstrument";
import type { DecentSamplerImport } from "../ipc/schema";
import { mergePluginAdaptersById, normalizePluginAdapter } from "../state/store";
import type { PluginAdapter, TrackEffect } from "../state/types";

export type SegmentResizeEdge = "start" | "end";
export type SegmentFadeEdge = "in" | "out";
export type LoopClampMarker = "start" | "end";
export type ArrangementSelectionDomain = "track" | "segment" | "effect-point";

export interface SegmentDragPreview {
  startBeat: number;
  deltaBeats: number;
}

export interface SegmentResizePreview {
  startBeat: number;
  lengthBeats: number;
}

export interface SegmentFadePreview {
  fadeInBeats: number;
  fadeOutBeats: number;
}

export interface LoopClampPreview {
  startBeat: number;
  endBeat: number;
}

export interface ArrangementSelection {
  selectedTrackIds: string[];
  selectedSegmentIds: string[];
  selectedTrackEffectAutomationPointKeys: string[];
}

export interface ModalClosePolicy {
  reason: "backdrop" | "escape" | "button";
  dirty: boolean;
  allowBackdropClose?: boolean;
}

const MIN_SEGMENT_LENGTH_BEATS = 0.25;

export function snapBeat(beat: number, gridBeats = 0.25): number {
  if (!Number.isFinite(beat)) return 0;
  const grid = gridBeats > 0 ? gridBeats : 0.25;
  return Math.round(beat / grid) * grid;
}

export function previewSegmentDrag({
  originStartBeat,
  originLengthBeats,
  pointerDeltaPx,
  beatsToPx,
  projectLengthBeats,
  gridBeats = 0.25,
}: {
  originStartBeat: number;
  originLengthBeats: number;
  pointerDeltaPx: number;
  beatsToPx: number;
  projectLengthBeats: number;
  gridBeats?: number;
}): SegmentDragPreview {
  const rawDelta = timelineXToBeat(pointerDeltaPx, beatsToPx);
  const deltaBeats = snapBeat(rawDelta, gridBeats);
  const maxStart = Math.max(0, projectLengthBeats - originLengthBeats);
  const startBeat = Math.max(0, Math.min(maxStart, snapBeat(originStartBeat + deltaBeats, gridBeats)));
  return { startBeat, deltaBeats: startBeat - originStartBeat };
}

export function previewSegmentResize({
  edge,
  originStartBeat,
  originLengthBeats,
  pointerDeltaPx,
  beatsToPx,
  projectLengthBeats,
  gridBeats = 0.25,
}: {
  edge: SegmentResizeEdge;
  originStartBeat: number;
  originLengthBeats: number;
  pointerDeltaPx: number;
  beatsToPx: number;
  projectLengthBeats: number;
  gridBeats?: number;
}): SegmentResizePreview {
  const deltaBeats = snapBeat(timelineXToBeat(pointerDeltaPx, beatsToPx), gridBeats);
  if (edge === "start") {
    const maxStart = originStartBeat + originLengthBeats - MIN_SEGMENT_LENGTH_BEATS;
    const startBeat = Math.max(0, Math.min(maxStart, snapBeat(originStartBeat + deltaBeats, gridBeats)));
    return {
      startBeat,
      lengthBeats: Math.max(MIN_SEGMENT_LENGTH_BEATS, originStartBeat + originLengthBeats - startBeat),
    };
  }

  const rawLength = originLengthBeats + deltaBeats;
  const maxLength = Math.max(MIN_SEGMENT_LENGTH_BEATS, projectLengthBeats - originStartBeat);
  return {
    startBeat: originStartBeat,
    lengthBeats: Math.max(MIN_SEGMENT_LENGTH_BEATS, Math.min(maxLength, snapBeat(rawLength, gridBeats))),
  };
}

export function previewSegmentFade({
  edge,
  originFadeInBeats = 0,
  originFadeOutBeats = 0,
  originLengthBeats,
  pointerDeltaPx,
  beatsToPx,
  gridBeats = 0.25,
}: {
  edge: SegmentFadeEdge;
  originFadeInBeats?: number;
  originFadeOutBeats?: number;
  originLengthBeats: number;
  pointerDeltaPx: number;
  beatsToPx: number;
  gridBeats?: number;
}): SegmentFadePreview {
  const deltaBeats = timelineXToBeat(pointerDeltaPx, beatsToPx);
  if (edge === "in") {
    return {
      fadeInBeats: snapFadeLength(originFadeInBeats + deltaBeats, originLengthBeats, gridBeats),
      fadeOutBeats: clampFadeLength(originFadeOutBeats, originLengthBeats),
    };
  }

  return {
    fadeInBeats: clampFadeLength(originFadeInBeats, originLengthBeats),
    fadeOutBeats: snapFadeLength(originFadeOutBeats - deltaBeats, originLengthBeats, gridBeats),
  };
}

export function previewLoopClampDrag({
  marker,
  startBeat,
  endBeat,
  pointerBeat,
  projectLengthBeats,
  minRangeBeats = 0.25,
  gridBeats = 0.25,
}: {
  marker: LoopClampMarker;
  startBeat: number;
  endBeat: number;
  pointerBeat: number;
  projectLengthBeats: number;
  minRangeBeats?: number;
  gridBeats?: number;
}): LoopClampPreview {
  const beat = Math.max(0, Math.min(projectLengthBeats, snapBeat(pointerBeat, gridBeats)));
  if (marker === "start") {
    return {
      startBeat: Math.min(beat, endBeat - minRangeBeats),
      endBeat,
    };
  }

  return {
    startBeat,
    endBeat: Math.max(beat, startBeat + minRangeBeats),
  };
}

export function previewMarqueeFromPointers({
  startClientX,
  startClientY,
  currentClientX,
  currentClientY,
  containerLeft,
  containerTop,
  timelineBottom,
}: {
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  containerLeft: number;
  containerTop: number;
  timelineBottom: number;
}): TimelineRect & { style: { left: number; top: number; width: number; height: number } } {
  const clampedStartY = clampClientYToTimeline(startClientY, timelineBottom);
  const clampedCurrentY = clampClientYToTimeline(currentClientY, timelineBottom);
  const left = Math.min(startClientX, currentClientX);
  const right = Math.max(startClientX, currentClientX);
  const top = Math.min(clampedStartY, clampedCurrentY);
  const bottom = Math.max(clampedStartY, clampedCurrentY);
  return {
    left,
    right,
    top,
    bottom,
    style: marqueeStyleFromClientPoints(
      startClientX,
      startClientY,
      currentClientX,
      currentClientY,
      containerLeft,
      containerTop,
      timelineBottom,
    ),
  };
}

export function selectArrangementItem({
  selection,
  domain,
  id,
  additive = false,
}: {
  selection: ArrangementSelection;
  domain: ArrangementSelectionDomain;
  id: string;
  additive?: boolean;
}): ArrangementSelection {
  const nextIds = (ids: string[]) => {
    if (!additive) return [id];
    return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id];
  };

  if (domain === "track") {
    return {
      selectedTrackIds: nextIds(selection.selectedTrackIds),
      selectedSegmentIds: [],
      selectedTrackEffectAutomationPointKeys: [],
    };
  }

  if (domain === "segment") {
    return {
      selectedTrackIds: [],
      selectedSegmentIds: nextIds(selection.selectedSegmentIds),
      selectedTrackEffectAutomationPointKeys: [],
    };
  }

  return {
    selectedTrackIds: [],
    selectedSegmentIds: [],
    selectedTrackEffectAutomationPointKeys: nextIds(selection.selectedTrackEffectAutomationPointKeys),
  };
}

export function clearArrangementSelection(): ArrangementSelection {
  return {
    selectedTrackIds: [],
    selectedSegmentIds: [],
    selectedTrackEffectAutomationPointKeys: [],
  };
}

export function shouldCloseModal(policy: ModalClosePolicy): boolean {
  if (policy.reason === "button") return true;
  if (policy.reason === "escape") return !policy.dirty;
  return Boolean(policy.allowBackdropClose) && !policy.dirty;
}

function snapFadeLength(value: number, lengthBeats: number, gridBeats: number): number {
  return clampFadeLength(snapBeat(value, gridBeats), lengthBeats);
}

function clampFadeLength(value: number, lengthBeats: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.max(0, lengthBeats), value));
}

export function previewPluginHydrationMerge({
  factory,
  persisted,
  current,
  project,
}: {
  factory: PluginAdapter[];
  persisted: PluginAdapter[];
  current: PluginAdapter[];
  project: PluginAdapter[];
}): string[] {
  return mergePluginAdaptersById(
    factory.map((plugin) => normalizePluginAdapter(plugin)),
    persisted.map((plugin) => normalizePluginAdapter(plugin)),
    current.map((plugin) => normalizePluginAdapter(plugin)),
    project.map((plugin) => normalizePluginAdapter(plugin)),
  ).map((plugin) => plugin.id);
}

export function previewPluginHydrationAdapters({
  factory,
  persisted,
  current,
  project,
}: {
  factory: PluginAdapter[];
  persisted: PluginAdapter[];
  current: PluginAdapter[];
  project: PluginAdapter[];
}): PluginAdapter[] {
  return mergePluginAdaptersById(
    factory.map((plugin) => normalizePluginAdapter(plugin)),
    persisted.map((plugin) => normalizePluginAdapter(plugin)),
    current.map((plugin) => normalizePluginAdapter(plugin)),
    project.map((plugin) => normalizePluginAdapter(plugin)),
  );
}

export function previewDecentSamplerEffects(preset: DecentSamplerImport): TrackEffect[] {
  return decentSamplerEffects(preset);
}
