import { nanoid } from "nanoid";
import type { SynthPatchSnapshot } from "./types";

export const SYNTH_PRESET_SCHEMA_VERSION = 1;
export type SynthPresetKind = "instrument";

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

export interface CreateSynthPresetOptions {
  id?: string;
  name: string;
  patch: SynthPatchSnapshot;
  tags?: unknown[];
  favorite?: unknown;
  existing?: Partial<SynthPresetRecord> | null;
  now?: number;
}

export function createSynthPresetRecord(options: CreateSynthPresetOptions): SynthPresetRecord {
  const now = safeTimestamp(options.now, Date.now());
  const name = sanitizePresetName(options.name, "Aether Preset");
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
  if (!isRecord(value) || !isRecord(value.patch)) return null;
  const name = sanitizePresetName(value.name, "Aether Preset");
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

function sanitizePresetName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : fallback;
}

function sanitizePresetId(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 96);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "aether";
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

function clonePatch(patch: SynthPatchSnapshot): SynthPatchSnapshot {
  if (typeof structuredClone === "function") return structuredClone(patch);
  return JSON.parse(JSON.stringify(patch)) as SynthPatchSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
