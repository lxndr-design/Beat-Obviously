export interface InstrumentPresetSearchEntry {
  id: string;
  name: string;
  tags: readonly string[];
  favorite: boolean;
}

export interface InstrumentPresetSearchFilters {
  search?: string;
  favoritesOnly?: boolean;
}

export function filterInstrumentPresetEntries<T extends InstrumentPresetSearchEntry>(
  entries: readonly T[],
  filters: InstrumentPresetSearchFilters,
): T[] {
  const tokens = instrumentPresetSearchTokens(filters.search ?? "");
  return entries.filter((entry) => {
    if (filters.favoritesOnly && !entry.favorite) return false;
    return matchesInstrumentPresetSearch(entry, tokens);
  });
}

export function matchesInstrumentPresetSearch(
  entry: Pick<InstrumentPresetSearchEntry, "name" | "tags">,
  search: string | readonly string[],
): boolean {
  const tokens = typeof search === "string" ? instrumentPresetSearchTokens(search) : search;
  if (tokens.length === 0) return true;
  const text = normalizeInstrumentPresetSearch([entry.name, ...entry.tags].join(" "));
  return tokens.every((token) => text.includes(token));
}

export function instrumentPresetSearchTokens(value: string): string[] {
  return normalizeInstrumentPresetSearch(value).split(/\s+/).filter(Boolean);
}

function normalizeInstrumentPresetSearch(value: string): string {
  return value.trim().toLowerCase();
}
