import { nanoid } from "nanoid";
import type { TrackEffect, TrackEffectChain } from "./types";

export type EffectKind = TrackEffect["kind"];

export interface EffectOption {
  value: EffectKind;
  label: string;
}

export interface EffectParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export const EFFECT_OPTIONS: EffectOption[] = [
  { value: "reverb", label: "Reverb / Room" },
  { value: "delay", label: "Delay" },
  { value: "chorus", label: "Chorus" },
  { value: "phaser", label: "Phaser" },
  { value: "flanger", label: "Flanger" },
  { value: "compressor", label: "Compressor" },
  { value: "lowpass", label: "Low-pass" },
  { value: "highpass", label: "High-pass" },
  { value: "saturator", label: "Saturator" },
  { value: "distortion", label: "Distortion" },
  { value: "bitcrush", label: "Bitcrush" },
  { value: "plugin", label: "Plugin" },
];

export const EFFECT_LABELS: Record<EffectKind, string> = {
  bitcrush: "Bitcrush",
  lowpass: "Low-pass",
  highpass: "High-pass",
  saturator: "Saturator",
  distortion: "Distortion",
  reverb: "Reverb / Room",
  delay: "Delay",
  chorus: "Chorus",
  phaser: "Phaser",
  flanger: "Flanger",
  compressor: "Compressor",
  plugin: "Plugin",
};

export const EFFECT_PARAM_SPECS: Record<EffectKind, EffectParamSpec[]> = {
  reverb: [
    { key: "roomSize", label: "Room", min: 0, max: 100, step: 1, unit: "%" },
    { key: "damping", label: "Damp", min: 0, max: 100, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  delay: [
    { key: "timeMs", label: "Time", min: 1, max: 2000, step: 1, unit: "ms" },
    { key: "feedback", label: "Feed", min: 0, max: 95, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  chorus: [
    { key: "rateHz", label: "Rate", min: 0.02, max: 12, step: 0.01, unit: "Hz" },
    { key: "depthMs", label: "Depth", min: 0, max: 25, step: 0.1, unit: "ms" },
    { key: "delayMs", label: "Delay", min: 1, max: 35, step: 0.1, unit: "ms" },
    { key: "feedback", label: "Feed", min: -85, max: 85, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  phaser: [
    { key: "rateHz", label: "Rate", min: 0.02, max: 12, step: 0.01, unit: "Hz" },
    { key: "centerHz", label: "Center", min: 80, max: 8000, step: 1, unit: "Hz" },
    { key: "depthOct", label: "Depth", min: 0, max: 4, step: 0.1, unit: "oct" },
    { key: "feedback", label: "Feed", min: -85, max: 85, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  flanger: [
    { key: "rateHz", label: "Rate", min: 0.02, max: 12, step: 0.01, unit: "Hz" },
    { key: "depthMs", label: "Depth", min: 0, max: 8, step: 0.1, unit: "ms" },
    { key: "delayMs", label: "Delay", min: 0.1, max: 15, step: 0.1, unit: "ms" },
    { key: "feedback", label: "Feed", min: -85, max: 85, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  compressor: [
    { key: "thresholdDb", label: "Thresh", min: -60, max: 0, step: 1, unit: "dB" },
    { key: "ratio", label: "Ratio", min: 1, max: 40, step: 0.1, unit: ":1" },
    { key: "attackMs", label: "Attack", min: 0.1, max: 200, step: 0.1, unit: "ms" },
    { key: "releaseMs", label: "Release", min: 1, max: 2000, step: 1, unit: "ms" },
    { key: "makeupDb", label: "Makeup", min: -24, max: 24, step: 1, unit: "dB" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  lowpass: [
    { key: "cutoffHz", label: "Cut", min: 20, max: 20000, step: 1, unit: "Hz" },
    { key: "resonance", label: "Res", min: 0, max: 100, step: 1, unit: "%" },
  ],
  highpass: [
    { key: "cutoffHz", label: "Cut", min: 20, max: 20000, step: 1, unit: "Hz" },
    { key: "resonance", label: "Res", min: 0, max: 100, step: 1, unit: "%" },
  ],
  saturator: [
    { key: "drive", label: "Drive", min: 0, max: 100, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  distortion: [
    { key: "drive", label: "Drive", min: 0, max: 100, step: 1, unit: "%" },
    { key: "shape", label: "Shape", min: 0, max: 100, step: 1, unit: "%" },
    { key: "trimDb", label: "Trim", min: 0, max: 18, step: 0.5, unit: "dB" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  bitcrush: [
    { key: "bits", label: "Bits", min: 1, max: 16, step: 1 },
    { key: "rate", label: "Rate", min: 1, max: 100, step: 1, unit: "%" },
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
  plugin: [
    { key: "mix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
  ],
};

export const EFFECT_DEFAULT_PARAMS: Record<EffectKind, Record<string, number>> = {
  reverb: { roomSize: 40, damping: 35, mix: 20 },
  delay: { timeMs: 250, feedback: 25, mix: 18 },
  chorus: { rateHz: 0.8, depthMs: 8, delayMs: 12, feedback: 8, mix: 35 },
  phaser: { rateHz: 0.45, centerHz: 900, depthOct: 1.8, feedback: 35, mix: 45 },
  flanger: { rateHz: 0.28, depthMs: 2, delayMs: 2.5, feedback: 45, mix: 50 },
  compressor: { thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 120, makeupDb: 0, mix: 100 },
  lowpass: { cutoffHz: 8000, resonance: 8 },
  highpass: { cutoffHz: 80, resonance: 0 },
  saturator: { drive: 20, mix: 100 },
  distortion: { drive: 55, shape: 35, trimDb: 6, mix: 45 },
  bitcrush: { bits: 8, rate: 50, mix: 35 },
  plugin: { mix: 100 },
};

export function defaultTrackEffectParams(kind: EffectKind): Record<string, number> {
  return { ...EFFECT_DEFAULT_PARAMS[kind] };
}

export function createTrackEffect(kind: EffectKind = "reverb", patch: Partial<TrackEffect> = {}): TrackEffect {
  return normalizeTrackEffect({
    id: patch.id ?? nanoid(),
    kind,
    bypassed: patch.bypassed ?? false,
    params: patch.params ?? defaultTrackEffectParams(kind),
    pluginId: patch.pluginId,
    pluginName: patch.pluginName,
    pluginFormat: patch.pluginFormat,
    latencySamples: patch.latencySamples,
    automation: patch.automation,
  });
}

export function normalizeTrackEffect(input: Partial<TrackEffect>): TrackEffect {
  const kind = isEffectKind(input.kind) ? input.kind : "reverb";
  const defaults = defaultTrackEffectParams(kind);
  const params: Record<string, number> = { ...defaults };
  if (input.params && typeof input.params === "object") {
    for (const [key, value] of Object.entries(input.params)) {
      if (Number.isFinite(value)) params[key] = Number(value);
    }
  }
  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id : nanoid(),
    kind,
    bypassed: input.bypassed === true,
    pluginId: input.pluginId,
    pluginName: input.pluginName,
    pluginFormat: input.pluginFormat,
    latencySamples: Number.isFinite(input.latencySamples) ? Math.max(0, Math.min(192000, Number(input.latencySamples))) : undefined,
    params,
    automation: Array.isArray(input.automation) ? structuredClone(input.automation) : undefined,
  };
}

export function normalizeTrackEffectChain(input: unknown): TrackEffectChain {
  if (!input || typeof input !== "object" || !Array.isArray((input as TrackEffectChain).filters)) {
    return { filters: [] };
  }
  return {
    filters: (input as TrackEffectChain).filters.map(normalizeTrackEffect),
  };
}

export function estimateEffectTailSeconds(effect: TrackEffect): number {
  if (effect.bypassed) return 0;
  if (effect.kind === "delay") {
    const timeMs = Math.max(1, effect.params.timeMs ?? EFFECT_DEFAULT_PARAMS.delay.timeMs);
    const feedback = Math.max(0, Math.min(95, effect.params.feedback ?? EFFECT_DEFAULT_PARAMS.delay.feedback)) / 100;
    const repeats = Math.max(1, Math.min(18, Math.ceil(feedback * 12)));
    return Math.min(8, (timeMs / 1000) * repeats);
  }
  if (effect.kind === "reverb") {
    const room = Math.max(0, Math.min(100, effect.params.roomSize ?? EFFECT_DEFAULT_PARAMS.reverb.roomSize)) / 100;
    return Math.min(8, 0.75 + room * 3);
  }
  return 0;
}

export function formatEffectTail(effect: TrackEffect): string {
  const seconds = estimateEffectTailSeconds(effect);
  if (seconds <= 0) return "Dry";
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms tail`;
  return `${seconds.toFixed(seconds < 2 ? 1 : 0)}s tail`;
}

export function formatEffectLatency(effect: TrackEffect): string {
  const latency = Number.isFinite(effect.latencySamples) ? Math.max(0, Number(effect.latencySamples)) : 0;
  return latency > 0 ? `${latency} smp` : "0 smp";
}

function isEffectKind(value: unknown): value is EffectKind {
  return typeof value === "string" && value in EFFECT_LABELS;
}
