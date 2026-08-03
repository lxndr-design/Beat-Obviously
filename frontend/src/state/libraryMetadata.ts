import { getLocalCollaborationIdentity } from "../collaboration/localIdentity";
import type { LibraryItemMetadata } from "./types";

export interface NormalizeLibraryMetadataOptions {
  factory?: boolean;
  createdAt?: number;
  updatedAt?: number;
  description?: string;
  tags?: string[];
  license?: string;
  provenance?: string;
  forkedFromId?: string;
}

export function normalizeLibraryMetadata(
  value: LibraryItemMetadata | undefined,
  options: NormalizeLibraryMetadataOptions = {},
): LibraryItemMetadata {
  const identity = getLocalCollaborationIdentity();
  const createdAt = validTimestamp(value?.createdAt) ?? validTimestamp(options.createdAt) ?? Date.now();
  const updatedAt = Math.max(createdAt, validTimestamp(value?.updatedAt) ?? validTimestamp(options.updatedAt) ?? createdAt);
  const creatorName = value?.creator?.displayName?.trim() || (options.factory ? "Beat" : identity.displayName);
  const creatorId = value?.creator?.id?.trim() || (options.factory ? "beat.factory" : identity.actorId);
  return {
    schemaVersion: 1,
    creator: {
      id: creatorId,
      displayName: creatorName.slice(0, 80),
      kind: value?.creator?.kind ?? (options.factory ? "factory" : "user"),
    },
    createdAt,
    updatedAt,
    version: Math.max(1, Math.round(finiteNumber(value?.version, 1))),
    description: optionalText(value?.description ?? options.description, 500),
    tags: normalizeTags(value?.tags?.length ? value.tags : options.tags),
    license: optionalText(value?.license ?? options.license, 120),
    provenance: optionalText(value?.provenance ?? options.provenance, 500),
    visibility: value?.visibility === "public" || value?.visibility === "unlisted" ? value.visibility : "private",
    publishedAt: validTimestamp(value?.publishedAt),
    forkedFromId: optionalText(value?.forkedFromId ?? options.forkedFromId, 160),
  };
}

export function touchLibraryMetadata(
  value: LibraryItemMetadata | undefined,
  options: NormalizeLibraryMetadataOptions = {},
): LibraryItemMetadata {
  const normalized = normalizeLibraryMetadata(value, options);
  return { ...normalized, updatedAt: Date.now() };
}

export function parseLibraryTags(value: string): string[] {
  return normalizeTags(value.split(/[;,]/g));
}

function normalizeTags(tags: string[] | undefined): string[] {
  return Array.from(new Set((tags ?? [])
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)))
    .slice(0, 32);
}

function optionalText(value: string | undefined, maximumLength: number): string | undefined {
  const text = value?.trim();
  return text ? text.slice(0, maximumLength) : undefined;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function validTimestamp(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
