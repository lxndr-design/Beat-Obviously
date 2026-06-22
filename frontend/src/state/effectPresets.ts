import { nanoid } from "nanoid";
import type { TrackEffectChain } from "./types";
import { normalizeTrackEffectChain } from "./effects";

export const AETHER_EFFECT_PRESET_SCHEMA_VERSION = 1;
export type AetherEffectPresetKind = "instrument-fx-chain";

export interface AetherEffectPresetRecord {
  schemaVersion: typeof AETHER_EFFECT_PRESET_SCHEMA_VERSION;
  kind: AetherEffectPresetKind;
  id: string;
  name: string;
  chain: TrackEffectChain;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateAetherEffectPresetOptions {
  id?: string;
  name: string;
  chain: TrackEffectChain;
  tags?: unknown[];
  existing?: Partial<AetherEffectPresetRecord> | null;
  now?: number;
}

export function createAetherEffectPresetRecord(options: CreateAetherEffectPresetOptions): AetherEffectPresetRecord {
  const now = safeTimestamp(options.now, Date.now());
  const name = sanitizePresetName(options.name, "Aether FX Preset");
  return {
    schemaVersion: AETHER_EFFECT_PRESET_SCHEMA_VERSION,
    kind: "instrument-fx-chain",
    id: sanitizePresetId(options.id, name),
    name,
    chain: normalizeTrackEffectChain(options.chain),
    tags: sanitizeTags(options.tags),
    createdAt: safeTimestamp(options.existing?.createdAt, now),
    updatedAt: now,
  };
}

export function normalizeAetherEffectPresetRecord(value: unknown): AetherEffectPresetRecord | null {
  if (!isRecord(value) || !isRecord(value.chain)) return null;
  const name = sanitizePresetName(value.name, "Aether FX Preset");
  const updatedAt = safeTimestamp(value.updatedAt, Date.now());
  return {
    schemaVersion: AETHER_EFFECT_PRESET_SCHEMA_VERSION,
    kind: "instrument-fx-chain",
    id: sanitizePresetId(value.id, name),
    name,
    chain: normalizeTrackEffectChain(value.chain),
    tags: sanitizeTags(value.tags),
    createdAt: safeTimestamp(value.createdAt, updatedAt),
    updatedAt,
  };
}

function sanitizePresetName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : fallback;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
