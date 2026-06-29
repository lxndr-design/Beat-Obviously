import { FACTORY_SYNTH_PRESETS, type SynthFactoryPresetRecord } from "./synthStore";
import type { SynthPresetRecord } from "./synthPresets";
import type { Instrument } from "./types";

export type AetherPresetLibrarySource = "factory" | "user-preset" | "user-instrument";

export interface AetherPresetLibraryEntry {
  id: string;
  source: AetherPresetLibrarySource;
  sourceLabel: string;
  category: string;
  name: string;
  description: string;
  tags: string[];
}

export interface AetherPresetLibraryFilters {
  search?: string;
  category?: string;
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
  const searchTokens = normalizeSearch(filters.search ?? "").split(/\s+/).filter(Boolean);
  const category = normalizeSearch(filters.category ?? "");
  return entries.filter((entry) => {
    if (category && normalizeSearch(entry.category) !== category) return false;
    if (searchTokens.length === 0) return true;
    const text = searchablePresetText(entry);
    return searchTokens.every((token) => text.includes(token));
  });
}

export function aetherPresetLibraryCategories(entries: AetherPresetLibraryEntry[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.category).filter(Boolean))).sort((a, b) => a.localeCompare(b));
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
  };
}

function userPresetEntry(preset: SynthPresetRecord): AetherPresetLibraryEntry {
  const tags = preset.tags;
  return {
    id: preset.id,
    source: "user-preset",
    sourceLabel: "User preset",
    category: categoryFromTags(tags, "User"),
    name: preset.name,
    description: `${preset.patch.modulation.length} routes / ${preset.patch.effects?.filters.length ?? 0} instrument FX`,
    tags,
  };
}

function userInstrumentEntry(instrument: Instrument): AetherPresetLibraryEntry {
  const patch = instrument.synthPatch;
  const tags = patch?.metadata.tags ?? [];
  return {
    id: instrument.id,
    source: "user-instrument",
    sourceLabel: "User instrument",
    category: categoryFromTags(tags, instrument.kind === "wavetable" ? "Wavetable" : "Synth"),
    name: instrument.name,
    description: `${patch?.modulation.length ?? 0} routes / ${patch?.effects?.filters.length ?? 0} instrument FX`,
    tags,
  };
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
    entry.description,
    ...entry.tags,
  ].join(" "));
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}
