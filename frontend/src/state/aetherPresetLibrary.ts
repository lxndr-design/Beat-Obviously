import { FACTORY_SYNTH_PRESETS, type SynthFactoryPresetRecord } from "./synthStore";
import { instrumentPresetSearchTokens } from "./instrumentPresetLibrary";
import type { SynthPresetRecord } from "./synthPresets";
import type { Instrument } from "./types";

export type AetherPresetLibrarySource = "factory" | "user-preset" | "user-instrument";
export type AetherPresetLibrarySort = "source" | "name" | "category" | "complexity" | "favorite";

export interface AetherPresetLibraryEntry {
  id: string;
  source: AetherPresetLibrarySource;
  sourceLabel: string;
  category: string;
  name: string;
  description: string;
  tags: string[];
  family: string;
  role: string;
  auditionNote: string;
  favorite: boolean;
  routeCount: number;
  effectCount: number;
}

export interface AetherPresetLibraryFilters {
  search?: string;
  category?: string;
  favoritesOnly?: boolean;
  sort?: AetherPresetLibrarySort;
}

export interface AetherPresetLibraryStats {
  total: number;
  favorites: number;
  factory: number;
  userPresets: number;
  userInstruments: number;
  categories: number;
}

export function buildAetherPresetLibraryEntries(
  userPresets: SynthPresetRecord[],
  userInstruments: Instrument[],
): AetherPresetLibraryEntry[] {
  return [
    ...FACTORY_SYNTH_PRESETS.map(factoryPresetEntry),
    ...userPresets.map(userPresetEntry),
    ...userInstruments.filter((instrument) => Boolean(instrument.synthPatch)).map(userInstrumentEntry),
  ];
}

export function filterAetherPresetLibraryEntries(
  entries: AetherPresetLibraryEntry[],
  filters: AetherPresetLibraryFilters,
): AetherPresetLibraryEntry[] {
  const searchTokens = instrumentPresetSearchTokens(filters.search ?? "");
  const category = normalizeSearch(filters.category ?? "");
  const filtered = entries.filter((entry) => {
    if (filters.favoritesOnly && !entry.favorite) return false;
    if (category && normalizeSearch(entry.category) !== category) return false;
    if (searchTokens.length === 0) return true;
    const text = searchablePresetText(entry);
    return searchTokens.every((token) => text.includes(token));
  });
  return sortAetherPresetLibraryEntries(filtered, filters.sort ?? "source");
}

export function sortAetherPresetLibraryEntries(
  entries: AetherPresetLibraryEntry[],
  sort: AetherPresetLibrarySort = "source",
): AetherPresetLibraryEntry[] {
  return [...entries].sort((a, b) => comparePresetEntries(a, b, sort));
}

export function aetherPresetLibraryCategories(entries: AetherPresetLibraryEntry[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function aetherPresetLibraryStats(entries: AetherPresetLibraryEntry[]): AetherPresetLibraryStats {
  return {
    total: entries.length,
    favorites: entries.filter((entry) => entry.favorite).length,
    factory: entries.filter((entry) => entry.source === "factory").length,
    userPresets: entries.filter((entry) => entry.source === "user-preset").length,
    userInstruments: entries.filter((entry) => entry.source === "user-instrument").length,
    categories: aetherPresetLibraryCategories(entries).length,
  };
}

function factoryPresetEntry(preset: SynthFactoryPresetRecord): AetherPresetLibraryEntry {
  return {
    id: preset.id,
    source: "factory",
    sourceLabel: "Factory",
    category: preset.category,
    name: preset.name,
    description: preset.description,
    tags: preset.tags.filter((tag) => tag !== "factory"),
    family: preset.family,
    role: preset.role,
    auditionNote: preset.auditionNote,
    favorite: false,
    routeCount: preset.patch.modulation.length,
    effectCount: preset.patch.effects?.filters.length ?? 0,
  };
}

function userPresetEntry(preset: SynthPresetRecord): AetherPresetLibraryEntry {
  const tags = preset.tags;
  const effectCount = preset.patch.effects?.filters.length ?? 0;
  const routeCount = preset.patch.modulation.length;
  return {
    id: preset.id,
    source: "user-preset",
    sourceLabel: "User preset",
    category: categoryFromTags(tags, "User"),
    name: preset.name,
    description: `${routeCount} routes / ${effectCount} instrument FX`,
    tags,
    family: categoryFromTags(tags, "User"),
    role: tags.find((tag) => tag !== "aether") ?? "user preset",
    auditionNote: "User preset; audition from the saved instrument context.",
    favorite: preset.favorite,
    routeCount,
    effectCount,
  };
}

function userInstrumentEntry(instrument: Instrument): AetherPresetLibraryEntry {
  const patch = instrument.synthPatch;
  const tags = patch?.metadata.tags ?? [];
  const routeCount = patch?.modulation.length ?? 0;
  const effectCount = patch?.effects?.filters.length ?? 0;
  return {
    id: instrument.id,
    source: "user-instrument",
    sourceLabel: "User instrument",
    category: categoryFromTags(tags, instrument.kind === "wavetable" ? "Wavetable" : "Synth"),
    name: instrument.name,
    description: `${routeCount} routes / ${effectCount} instrument FX`,
    tags,
    family: categoryFromTags(tags, instrument.kind === "wavetable" ? "Wavetable" : "Synth"),
    role: tags.find((tag) => tag !== "aether") ?? instrument.kind,
    auditionNote: "User instrument; audition against its saved source and current project context.",
    favorite: false,
    routeCount,
    effectCount,
  };
}

function comparePresetEntries(a: AetherPresetLibraryEntry, b: AetherPresetLibraryEntry, sort: AetherPresetLibrarySort): number {
  if (sort === "name") return compareByName(a, b);
  if (sort === "category") {
    return compareText(a.category, b.category) || compareByName(a, b);
  }
  if (sort === "complexity") {
    const aComplexity = a.routeCount + a.effectCount;
    const bComplexity = b.routeCount + b.effectCount;
    return bComplexity - aComplexity || compareByName(a, b);
  }
  if (sort === "favorite") {
    return Number(b.favorite) - Number(a.favorite) || sourceOrder(a.source) - sourceOrder(b.source) || compareByName(a, b);
  }
  return sourceOrder(a.source) - sourceOrder(b.source) || compareByName(a, b);
}

function compareByName(a: AetherPresetLibraryEntry, b: AetherPresetLibraryEntry): number {
  return compareText(a.name, b.name) || compareText(a.sourceLabel, b.sourceLabel) || compareText(a.id, b.id);
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function sourceOrder(source: AetherPresetLibrarySource): number {
  if (source === "factory") return 0;
  if (source === "user-preset") return 1;
  return 2;
}

function categoryFromTags(tags: string[], fallback: string): string {
  const tag = tags.find((candidate) => candidate.trim() && candidate.toLowerCase() !== "aether");
  if (!tag) return fallback;
  return tag.slice(0, 1).toUpperCase() + tag.slice(1);
}

function searchablePresetText(entry: AetherPresetLibraryEntry): string {
  return normalizeSearch([
    entry.name,
    entry.sourceLabel,
    entry.category,
    entry.family,
    entry.role,
    entry.auditionNote,
    entry.description,
    ...entry.tags,
  ].join(" "));
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}
