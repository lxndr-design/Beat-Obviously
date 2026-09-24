import { nanoid } from "nanoid";
import { normalizedAurumConfig } from "./aurum";
import type { AdsrEnvelope, AurumSynthConfig, Instrument, SynthPatchSnapshot, TrackEffectChain } from "./types";

export const SYNTH_PRESET_SCHEMA_VERSION = 1;
export type SynthPresetKind = "instrument";
export const AURUM_PRESET_SCHEMA_VERSION = 1;
export type AurumPresetKind = "aurum-instrument";

export interface SynthPresetRecord {
  schemaVersion: typeof SYNTH_PRESET_SCHEMA_VERSION;
  kind: SynthPresetKind;
  id: string;
  name: string;
  patch: SynthPatchSnapshot;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Portable Aurum sound state. Library identity stays on the destination Instrument. */
export interface AurumPresetPatch {
  aurum: AurumSynthConfig;
  envelope: AdsrEnvelope;
  knobs: Instrument["knobs"];
  filterType: NonNullable<Instrument["filterType"]>;
  glideMs: number;
  maxVoices: number;
  mono: boolean;
  legato: boolean;
  pitchBendRangeSemitones: number;
  ampLevel: number;
  ampPan: number;
  effects?: TrackEffectChain;
}

export interface AurumPresetRecord {
  schemaVersion: typeof AURUM_PRESET_SCHEMA_VERSION;
  kind: AurumPresetKind;
  id: string;
  name: string;
  patch: AurumPresetPatch;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export type InstrumentPresetRecord = SynthPresetRecord | AurumPresetRecord;

export interface CreateSynthPresetOptions {
  id?: string;
  name: string;
  patch: SynthPatchSnapshot;
  tags?: unknown[];
  favorite?: unknown;
  existing?: Partial<SynthPresetRecord> | null;
  now?: number;
}

export interface CreateAurumPresetOptions {
  id?: string;
  name: string;
  instrument: Instrument;
  tags?: unknown[];
  favorite?: unknown;
  existing?: Partial<AurumPresetRecord> | null;
  now?: number;
}

export function createSynthPresetRecord(options: CreateSynthPresetOptions): SynthPresetRecord {
  const now = safeTimestamp(options.now, Date.now());
  const name = sanitizePresetName(options.name, "Synth Preset");
  return {
    schemaVersion: SYNTH_PRESET_SCHEMA_VERSION,
    kind: "instrument",
    id: sanitizePresetId(options.id, name),
    name,
    patch: clonePatch(options.patch),
    tags: sanitizePresetTags(options.tags ?? options.patch.metadata?.tags),
    favorite: sanitizeFavorite(options.favorite ?? options.existing?.favorite),
    createdAt: safeTimestamp(options.existing?.createdAt, now),
    updatedAt: now,
  };
}

export function normalizeSynthPresetRecord(value: unknown): SynthPresetRecord | null {
  if (!isRecord(value) || !isRecord(value.patch) || (value.kind !== undefined && value.kind !== "instrument")) return null;
  const name = sanitizePresetName(value.name, "Synth Preset");
  const updatedAt = safeTimestamp(value.updatedAt, Date.now());
  return {
    schemaVersion: SYNTH_PRESET_SCHEMA_VERSION,
    kind: "instrument",
    id: sanitizePresetId(value.id, name),
    name,
    patch: clonePatch(value.patch as unknown as SynthPatchSnapshot),
    tags: sanitizePresetTags(value.tags),
    favorite: sanitizeFavorite(value.favorite),
    createdAt: safeTimestamp(value.createdAt, updatedAt),
    updatedAt,
  };
}

export function createAurumPresetRecord(options: CreateAurumPresetOptions): AurumPresetRecord {
  if (!options.instrument.aurum) throw new Error("Aurum preset source is missing an Aurum patch.");
  const now = safeTimestamp(options.now, Date.now());
  const name = sanitizePresetName(options.name, "Aurum Preset");
  return {
    schemaVersion: AURUM_PRESET_SCHEMA_VERSION,
    kind: "aurum-instrument",
    id: sanitizePresetId(options.id, name, "aurum"),
    name,
    patch: aurumPresetPatchFromInstrument(options.instrument),
    tags: sanitizePresetTags(options.tags ?? options.instrument.descriptors),
    favorite: sanitizeFavorite(options.favorite ?? options.existing?.favorite),
    createdAt: safeTimestamp(options.existing?.createdAt, now),
    updatedAt: now,
  };
}

/**
 * Accepts v1 records and the pre-record prototype shape ({ instrument }).
 * Nested Aurum engine versions migrate through the canonical Aurum normalizer.
 */
export function normalizeAurumPresetRecord(value: unknown): AurumPresetRecord | null {
  if (!isRecord(value)) return null;
  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== undefined && schemaVersion !== 0 && schemaVersion !== AURUM_PRESET_SCHEMA_VERSION) return null;
  if (value.kind !== undefined && value.kind !== "aurum" && value.kind !== "aurum-instrument") return null;

  const source = isRecord(value.patch) ? value.patch : isRecord(value.instrument) ? value.instrument : null;
  if (!source || !isRecord(source.aurum)) return null;
  const rawAurum = source.aurum;
  if (!Array.isArray(rawAurum.operators) || !Array.isArray(rawAurum.matrix)) return null;

  const name = sanitizePresetName(value.name, "Aurum Preset");
  const updatedAt = safeTimestamp(value.updatedAt, Date.now());
  try {
    return {
      schemaVersion: AURUM_PRESET_SCHEMA_VERSION,
      kind: "aurum-instrument",
      id: sanitizePresetId(value.id, name, "aurum"),
      name,
      patch: aurumPresetPatchFromUnknown(source),
      tags: sanitizePresetTags(value.tags),
      favorite: sanitizeFavorite(value.favorite),
      createdAt: safeTimestamp(value.createdAt, updatedAt),
      updatedAt,
    };
  } catch {
    return null;
  }
}

/** Applies sound state without replacing project/library identity or provenance. */
export function applyAurumPresetRecord(instrument: Instrument, value: AurumPresetRecord | unknown): Instrument | null {
  if (!instrument.aurum) return null;
  const record = normalizeAurumPresetRecord(value);
  if (!record) return null;
  const patch = clonePatch(record.patch);
  return {
    ...instrument,
    kind: "synth",
    waveform: "sine",
    envelope: patch.envelope,
    knobs: patch.knobs,
    filterType: patch.filterType,
    glideMs: patch.glideMs,
    maxVoices: patch.maxVoices,
    mono: patch.mono,
    legato: patch.legato,
    pitchBendRangeSemitones: patch.pitchBendRangeSemitones,
    ampLevel: patch.ampLevel,
    ampPan: patch.ampPan,
    aurum: patch.aurum,
    effects: patch.effects,
  };
}

function aurumPresetPatchFromInstrument(instrument: Instrument): AurumPresetPatch {
  return aurumPresetPatchFromUnknown(instrument as unknown as Record<string, unknown>);
}

function aurumPresetPatchFromUnknown(source: Record<string, unknown>): AurumPresetPatch {
  const rawAurum = source.aurum as unknown as AurumSynthConfig;
  const knobs = isRecord(source.knobs) ? source.knobs : {};
  const legacyFilter: Pick<NonNullable<AurumSynthConfig["filters"]>[number], "type" | "cutoff" | "resonance" | "drive"> = {
    type: source.filterType === "bandpass" || source.filterType === "highpass" ? source.filterType : "lowpass",
    cutoff: boundedNumber(knobs.cutoff, 0.78, 0, 1),
    resonance: boundedNumber(knobs.resonance, 0.12, 0, 1),
    drive: boundedNumber(knobs.drive, 0.08, 0, 1),
  };
  const aurum = normalizedAurumConfig(rawAurum, legacyFilter);
  const primaryFilter = aurum.filters[0];
  return {
    aurum: clonePatch(aurum),
    envelope: normalizeEnvelope(source.envelope),
    knobs: {
      cutoff: primaryFilter.cutoff,
      resonance: primaryFilter.resonance,
      drive: primaryFilter.drive,
      color: boundedNumber(knobs.color, 0.5, 0, 1),
    },
    filterType: primaryFilter.type,
    glideMs: boundedNumber(source.glideMs, 0, 0, 500),
    maxVoices: Math.round(boundedNumber(source.maxVoices, 16, 1, 32)),
    mono: source.mono === true,
    legato: source.legato === true,
    pitchBendRangeSemitones: boundedNumber(source.pitchBendRangeSemitones, 2, 0, 24),
    ampLevel: boundedNumber(source.ampLevel, 0.82, 0, 1),
    ampPan: boundedNumber(source.ampPan, 0, -1, 1),
    effects: normalizeEffects(source.effects),
  };
}

function normalizeEnvelope(value: unknown): AdsrEnvelope {
  const envelope = isRecord(value) ? value : {};
  return {
    attackMs: boundedNumber(envelope.attackMs, 5, 0, 20_000),
    decayMs: boundedNumber(envelope.decayMs, 900, 0, 20_000),
    sustain: boundedNumber(envelope.sustain, 0.72, 0, 1),
    releaseMs: boundedNumber(envelope.releaseMs, 360, 0, 20_000),
  };
}

function normalizeEffects(value: unknown): TrackEffectChain | undefined {
  if (!isRecord(value) || !Array.isArray(value.filters)) return undefined;
  return clonePatch(value as unknown as TrackEffectChain);
}

function sanitizePresetName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : fallback;
}

function sanitizePresetId(value: unknown, name: string, fallbackSlug = "aether"): string {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 96);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallbackSlug;
  return `preset:${slug}:${nanoid(8)}`;
}

function sanitizePresetTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = item.trim().slice(0, 32);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 16) break;
  }
  return tags;
}

function safeTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function sanitizeFavorite(value: unknown): boolean {
  return value === true;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, number));
}

function clonePatch<T>(patch: T): T {
  if (typeof structuredClone === "function") return structuredClone(patch);
  return JSON.parse(JSON.stringify(patch)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
