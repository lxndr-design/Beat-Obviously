import { nanoid } from "nanoid";
import type { TrackEffectChain } from "./types";
import { EFFECT_LABELS, normalizeTrackEffectChain, type EffectKind } from "./effects";

export const AETHER_EFFECT_PRESET_SCHEMA_VERSION = 1;
export type AetherEffectPresetKind = "instrument-fx-chain";

export interface AetherEffectPresetRecord {
  schemaVersion: typeof AETHER_EFFECT_PRESET_SCHEMA_VERSION;
  kind: AetherEffectPresetKind;
  id: string;
  name: string;
  chain: TrackEffectChain;
  tags: string[];
  category: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAetherEffectPresetOptions {
  id?: string;
  name: string;
  chain: TrackEffectChain;
  tags?: unknown[];
  category?: unknown;
  description?: unknown;
  existing?: Partial<AetherEffectPresetRecord> | null;
  now?: number;
}

export function createAetherEffectPresetRecord(options: CreateAetherEffectPresetOptions): AetherEffectPresetRecord {
  const now = safeTimestamp(options.now, Date.now());
  const name = sanitizePresetName(options.name, "Aether FX Preset");
  const chain = normalizeTrackEffectChain(options.chain);
  return {
    schemaVersion: AETHER_EFFECT_PRESET_SCHEMA_VERSION,
    kind: "instrument-fx-chain",
    id: sanitizePresetId(options.id, name),
    name,
    chain,
    tags: sanitizeTags(options.tags),
    category: sanitizePresetName(options.category, deriveEffectPresetCategory(chain)),
    description: sanitizePresetDescription(options.description, deriveEffectPresetDescription(chain)),
    createdAt: safeTimestamp(options.existing?.createdAt, now),
    updatedAt: now,
  };
}

export function normalizeAetherEffectPresetRecord(value: unknown): AetherEffectPresetRecord | null {
  if (!isRecord(value) || !isRecord(value.chain)) return null;
  const name = sanitizePresetName(value.name, "Aether FX Preset");
  const chain = normalizeTrackEffectChain(value.chain);
  const updatedAt = safeTimestamp(value.updatedAt, Date.now());
  return {
    schemaVersion: AETHER_EFFECT_PRESET_SCHEMA_VERSION,
    kind: "instrument-fx-chain",
    id: sanitizePresetId(value.id, name),
    name,
    chain,
    tags: sanitizeTags(value.tags),
    category: sanitizePresetName(value.category, deriveEffectPresetCategory(chain)),
    description: sanitizePresetDescription(value.description, deriveEffectPresetDescription(chain)),
    createdAt: safeTimestamp(value.createdAt, updatedAt),
    updatedAt,
  };
}

function sanitizePresetName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : fallback;
}

function sanitizePresetDescription(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : fallback;
}

function sanitizePresetId(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 96);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "aether-fx";
  return `fx-preset:${slug}:${nanoid(8)}`;
}

function sanitizeTags(value: unknown): string[] {
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

function deriveEffectPresetCategory(chain: TrackEffectChain): string {
  const activeKinds = chain.filters.filter((effect) => !effect.bypassed).map((effect) => effect.kind);
  const kinds = activeKinds.length > 0 ? activeKinds : chain.filters.map((effect) => effect.kind);
  if (kinds.length === 0) return "Empty";
  if (kinds.length > 2) return "Chain";
  if (kinds.some((kind) => kind === "reverb" || kind === "delay")) return "Space";
  if (kinds.some((kind) => kind === "chorus" || kind === "phaser" || kind === "flanger")) return "Motion";
  if (kinds.some((kind) => kind === "lowpass" || kind === "highpass")) return "Tone";
  if (kinds.some((kind) => kind === "compressor")) return "Dynamics";
  if (kinds.some((kind) => kind === "saturator" || kind === "distortion" || kind === "bitcrush")) return "Color";
  return "Instrument FX";
}

function deriveEffectPresetDescription(chain: TrackEffectChain): string {
  const labels = chain.filters.map((effect) => {
    const label = EFFECT_LABELS[effect.kind as EffectKind] ?? effect.kind;
    return effect.bypassed ? `${label} bypassed` : label;
  });
  if (labels.length === 0) return "Empty instrument FX chain.";
  const bypassed = chain.filters.filter((effect) => effect.bypassed).length;
  const suffix = bypassed > 0 ? ` / ${bypassed} bypassed` : "";
  return `${labels.length} ${labels.length === 1 ? "effect" : "effects"}: ${labels.join(" -> ")}${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
