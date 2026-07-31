const PREFERENCE_SCHEMA_VERSION = 1;

interface InstrumentPresetPreferenceDocument {
  schemaVersion: typeof PREFERENCE_SCHEMA_VERSION;
  favoriteIds: string[];
}

export interface InstrumentPresetPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readInstrumentPresetFavoriteIds(
  key: string,
  storage: InstrumentPresetPreferenceStorage | null = browserStorage(),
): Set<string> {
  if (!storage) return new Set();
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "null") as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== PREFERENCE_SCHEMA_VERSION || !Array.isArray(parsed.favoriteIds)) return new Set();
    return new Set(parsed.favoriteIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0));
  } catch {
    return new Set();
  }
}

export function writeInstrumentPresetFavoriteIds(
  key: string,
  favoriteIds: Iterable<string>,
  storage: InstrumentPresetPreferenceStorage | null = browserStorage(),
): void {
  if (!storage) return;
  const document: InstrumentPresetPreferenceDocument = {
    schemaVersion: PREFERENCE_SCHEMA_VERSION,
    favoriteIds: Array.from(new Set(favoriteIds)).filter(Boolean).sort(),
  };
  try {
    storage.setItem(key, JSON.stringify(document));
  } catch {
    // Per-user preferences remain optional when storage is unavailable.
  }
}

export function toggledInstrumentPresetFavoriteIds(favoriteIds: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(favoriteIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function browserStorage(): InstrumentPresetPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
