import type { Id, TrackEffect, TrackEffectAutomationPoint } from "../state/types";

export type EffectKind = TrackEffect["kind"];

export interface EffectParamMeta {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  scale?: "linear" | "log";
}

export interface EffectMeta {
  label: string;
  params: EffectParamMeta[];
}

export const EFFECT_META: Record<EffectKind, EffectMeta> = {
  reverb: {
    label: "Reverb",
    params: [
      { key: "roomSize", label: "Room", unit: "%", min: 0, max: 100 },
      { key: "damping", label: "Damp", unit: "%", min: 0, max: 100 },
      { key: "mix", label: "Mix", unit: "%", min: 0, max: 100 },
    ],
  },
  delay: {
    label: "Delay",
    params: [
      { key: "timeMs", label: "Time", unit: "ms", min: 1, max: 2000, scale: "log" },
      { key: "feedback", label: "Feedback", unit: "%", min: 0, max: 100 },
      { key: "mix", label: "Mix", unit: "%", min: 0, max: 100 },
    ],
  },
  lowpass: {
    label: "Lowpass",
    params: [
      { key: "cutoffHz", label: "Cutoff", unit: "Hz", min: 20, max: 20000, scale: "log" },
      { key: "resonance", label: "Res", unit: "%", min: 0, max: 100 },
    ],
  },
  highpass: {
    label: "Highpass",
    params: [
      { key: "cutoffHz", label: "Cutoff", unit: "Hz", min: 20, max: 20000, scale: "log" },
      { key: "resonance", label: "Res", unit: "%", min: 0, max: 100 },
    ],
  },
  saturator: {
    label: "Saturator",
    params: [
      { key: "drive", label: "Drive", unit: "%", min: 0, max: 100 },
      { key: "mix", label: "Mix", unit: "%", min: 0, max: 100 },
    ],
  },
  distortion: {
    label: "Distortion",
    params: [
      { key: "drive", label: "Drive", unit: "%", min: 0, max: 100 },
      { key: "shape", label: "Shape", unit: "%", min: 0, max: 100 },
      { key: "trimDb", label: "Trim", unit: "dB", min: 0, max: 18 },
      { key: "mix", label: "Mix", unit: "%", min: 0, max: 100 },
    ],
  },
  bitcrush: {
    label: "Bitcrush",
    params: [
      { key: "bits", label: "Bits", unit: "bit", min: 1, max: 16 },
      { key: "rate", label: "Rate", unit: "%", min: 0, max: 100 },
      { key: "mix", label: "Mix", unit: "%", min: 0, max: 100 },
    ],
  },
  compressor: {
    label: "Compressor",
    params: [
      { key: "thresholdDb", label: "Thresh", unit: "dB", min: -60, max: 0 },
      { key: "ratio", label: "Ratio", unit: ":1", min: 1, max: 40 },
      { key: "attackMs", label: "Attack", unit: "ms", min: 0.1, max: 200, scale: "log" },
      { key: "releaseMs", label: "Release", unit: "ms", min: 1, max: 2000, scale: "log" },
      { key: "makeupDb", label: "Makeup", unit: "dB", min: -24, max: 24 },
      { key: "mix", label: "Mix", unit: "%", min: 0, max: 100 },
    ],
  },
  chorus: {
    label: "Chorus",
    params: [
      { key: "rateHz", label: "Rate", unit: "Hz", min: 0.02, max: 12, scale: "log" },
      { key: "depthMs", label: "Depth", unit: "ms", min: 0, max: 25 },
      { key: "delayMs", label: "Delay", unit: "ms", min: 1, max: 35 },
      { key: "feedback", label: "Feed", unit: "%", min: -85, max: 85 },
      { key: "mix", label: "Mix", unit: "%", min: 0, max: 100 },
    ],
  },
  phaser: {
    label: "Phaser",
    params: [
      { key: "rateHz", label: "Rate", unit: "Hz", min: 0.02, max: 12, scale: "log" },
      { key: "centerHz", label: "Center", unit: "Hz", min: 80, max: 8000, scale: "log" },
      { key: "depthOct", label: "Depth", unit: "oct", min: 0, max: 4 },
      { key: "feedback", label: "Feed", unit: "%", min: -85, max: 85 },
      { key: "mix", label: "Mix", unit: "%", min: 0, max: 100 },
    ],
  },
  flanger: {
    label: "Flanger",
    params: [
      { key: "rateHz", label: "Rate", unit: "Hz", min: 0.02, max: 12, scale: "log" },
      { key: "depthMs", label: "Depth", unit: "ms", min: 0, max: 8 },
      { key: "delayMs", label: "Delay", unit: "ms", min: 0.1, max: 15 },
      { key: "feedback", label: "Feed", unit: "%", min: -85, max: 85 },
      { key: "mix", label: "Mix", unit: "%", min: 0, max: 100 },
    ],
  },
  plugin: {
    label: "Plugin",
    params: [
      { key: "mix", label: "Mix", unit: "%", min: 0, max: 100 },
    ],
  },
};

export const EFFECT_KIND_ORDER: EffectKind[] = [
  "reverb",
  "delay",
  "chorus",
  "phaser",
  "flanger",
  "compressor",
  "lowpass",
  "highpass",
  "saturator",
  "distortion",
  "bitcrush",
  "plugin",
];

export function effectAutomationSelectionKey(
  trackId: Id,
  effectId: Id,
  paramKey: string,
  pointId: Id,
): string {
  return `${trackId}:${effectId}:${paramKey}:${pointId}`;
}

export function visibleEffectAutomationPoints(
  effect: TrackEffect,
  primary: EffectParamMeta,
  lengthBeats: number,
  bpm: number,
): TrackEffectAutomationPoint[] {
  const lane = effect.automation?.find((candidate) => candidate.param === primary.key);
  if (lane && lane.points.length > 0) return lane.points;
  const fallbackValue = effect.params[primary.key] ?? primary.min;
  return [
    {
      id: `${effect.id}:${primary.key}:default-one-second`,
      beat: defaultEffectPointBeat(bpm, lengthBeats),
      value: fallbackValue,
      curve: "linear",
    },
  ];
}

export function defaultEffectPointBeat(bpm: number, lengthBeats: number): number {
  const oneSecondBeat = Math.max(0, bpm) / 60;
  if (lengthBeats <= 0) return 0;
  if (lengthBeats <= oneSecondBeat) return Math.max(0, lengthBeats * 0.5);
  return Math.max(0, Math.min(lengthBeats, oneSecondBeat));
}

export function effectAutomationBeatFromDrag(
  startBeat: number,
  startClientX: number,
  currentClientX: number,
  beatsToPx: number,
  lengthBeats: number,
): number {
  const safeScale = Math.max(0.000001, beatsToPx);
  const beat = startBeat + (currentClientX - startClientX) / safeScale;
  return Math.max(0, Math.min(Math.max(0, lengthBeats), beat));
}

export function effectValueToLaneY(value: number, param: EffectParamMeta): number {
  const normalized = normalizeEffectParamValue(value, param);
  return 18 - normalized * 14;
}

export function normalizeEffectParamValue(value: number, param: EffectParamMeta): number {
  const clamped = clampEffectParamValue(Number.isFinite(value) ? value : param.min, param);
  if (param.scale === "log") {
    const min = Math.log10(Math.max(0.000001, param.min));
    const max = Math.log10(Math.max(0.000001, param.max));
    return (Math.log10(Math.max(0.000001, clamped)) - min) / Math.max(0.000001, max - min);
  }
  return (clamped - param.min) / Math.max(0.000001, param.max - param.min);
}

export function clampEffectParamValue(value: number, param: EffectParamMeta): number {
  return Math.max(param.min, Math.min(param.max, value));
}

export function formatEffectParamValue(value: number, param: EffectParamMeta): string {
  const rounded = param.unit === "Hz" || param.unit === "ms" || param.unit === "bit"
    ? Math.round(value)
    : Math.round(value * 10) / 10;
  return `${rounded}${param.unit}`;
}
