import type { MidiNote } from "../state/types";
import type { ImportedHarmonyEvent, ImportedScorePlan } from "../scoreImport/musicXmlImport";
import bundledCatalog from "./standardsCatalog.generated.json";

export type StandardLicense = "Public Domain" | "CC0-1.0" | "CC-BY-4.0" | "user-provided-local";
export type StandardGenerationUse = "all" | "pop" | "rap" | "dnb" | "jazz" | "reggae" | "classical" | "electronic";

export interface StandardProvenance {
  sourceName: string;
  sourceUrl?: string;
  license: StandardLicense;
  licenseUrl?: string;
  noLicenseConflict?: boolean;
}

export interface StandardGenerationProfile {
  id: string;
  title: string;
  composer?: string;
  source: StandardProvenance;
  localOnly: boolean;
  referenceStatus: "verified" | "needs-review";
  generationUses: StandardGenerationUse[];
  meter: { numerator: number; denominator: number };
  bpm?: number;
  form: "aaba" | "sectional";
  lengthBeats: number;
  phraseLengthsBeats: number[];
  harmonicRhythmBeats: number[];
  chordVocabulary: string[];
  melodicDurationPalette: number[];
  melodicIntervalPalette: number[];
  referenceMaterial?: {
    leadMelody: MidiNote[];
    chordProgression: ImportedHarmonyEvent[];
  };
}

const STORAGE_KEY = "beat.standards-corpus.v1";
const REDISTRIBUTABLE_LICENSES = new Set<StandardLicense>(["Public Domain", "CC0-1.0", "CC-BY-4.0"]);

export function createStandardGenerationProfile(
  plan: ImportedScorePlan,
  source: StandardProvenance,
  generationUses: StandardGenerationUse[] = [],
  referenceStatus: StandardGenerationProfile["referenceStatus"] = "verified",
): StandardGenerationProfile {
  const melodyPart = plan.parts
    .filter((part) => !part.percussion && part.pitchRange)
    .sort((left, right) => right.measures.length - left.measures.length)[0];
  const harmonyPart = plan.parts
    .filter((part) => part.measures.some((measure) => measure.harmony.length > 0))
    .sort((left, right) => right.measures.flatMap((measure) => measure.harmony).length - left.measures.flatMap((measure) => measure.harmony).length)[0];
  const harmonyEvents = harmonyPart?.measures.flatMap((measure) => measure.harmony.map((event) => ({
    beat: measure.startBeat + event.beat,
    symbol: event.symbol,
  }))).sort((left, right) => left.beat - right.beat) ?? [];
  const melody = melodyPart?.measures.flatMap((measure) => measure.notes).sort((left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch) ?? [];
  const measureLengths = melodyPart?.measures.map((measure) => measure.lengthBeats) ?? [];
  const form = measureLengths.length >= 28 && measureLengths.length <= 36 ? "aaba" : "sectional";
  const phraseLengthsBeats = phraseLengthsFromMeasures(measureLengths, form);
  return {
    id: stableId(`${plan.title}|${plan.composer ?? ""}|${source.sourceName}`),
    title: plan.title,
    composer: plan.composer,
    source,
    localOnly: source.license === "user-provided-local",
    referenceStatus,
    generationUses,
    meter: plan.timeSignature,
    bpm: plan.bpm,
    form,
    lengthBeats: plan.lengthBeats,
    phraseLengthsBeats,
    harmonicRhythmBeats: harmonyEvents.map((event, index) => roundBeat((harmonyEvents[index + 1]?.beat ?? plan.lengthBeats) - event.beat)).filter((length) => length > 0),
    chordVocabulary: [...new Set(harmonyEvents.map((event) => normalizeChordQuality(event.symbol)).filter(Boolean))],
    melodicDurationPalette: [...new Set(melody.map((note) => roundBeat(note.lengthBeats)))].sort((left, right) => left - right).slice(0, 24),
    melodicIntervalPalette: [...new Set(melody.slice(1).map((note, index) => Math.max(-12, Math.min(12, note.pitch - melody[index].pitch))))].sort((left, right) => left - right),
    referenceMaterial: source.license === "user-provided-local" ? {
      leadMelody: melody.map((note) => ({
        pitch: note.pitch,
        velocity: note.velocity,
        startBeat: roundBeat(note.startBeat),
        lengthBeats: roundBeat(note.lengthBeats),
      })),
      chordProgression: harmonyEvents.map((event) => ({ beat: roundBeat(event.beat), symbol: event.symbol })),
    } : undefined,
  };
}

export function registerLocalStandard(
  plan: ImportedScorePlan,
  generationUses: StandardGenerationUse[] = ["all"],
  referenceStatus: StandardGenerationProfile["referenceStatus"] = "verified",
) {
  const profile = createStandardGenerationProfile(plan, {
    sourceName: plan.sourceName,
    license: "user-provided-local",
  }, generationUses, referenceStatus);
  const entries = loadLocalStandards().filter((entry) => entry.id !== profile.id);
  entries.push(profile);
  saveLocalStandards(entries);
  return profile;
}

export function loadLocalStandards(): StandardGenerationProfile[] {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isGenerationProfile) : [];
  } catch {
    return [];
  }
}

export function selectSongGenerationReference(seed: number, genre: Exclude<StandardGenerationUse, "all">): StandardGenerationProfile | undefined {
  const entries = [...loadBundledStandards(), ...loadLocalStandards()]
    .filter((entry) => (entry.generationUses.includes("all") || entry.generationUses.includes(genre))
      && entry.referenceStatus !== "needs-review");
  if (entries.length === 0) return undefined;
  return entries[Math.abs(Math.floor(seed)) % entries.length];
}

export function loadBundledStandards(): StandardGenerationProfile[] {
  const entries = (bundledCatalog as { entries?: unknown }).entries;
  return Array.isArray(entries) ? entries.filter(isGenerationProfile) : [];
}

export function mayBundleStandard(source: StandardProvenance) {
  return REDISTRIBUTABLE_LICENSES.has(source.license)
    && source.license !== "user-provided-local"
    && source.noLicenseConflict !== false
    && Boolean(source.sourceUrl || source.license === "Public Domain");
}

export function validateBundledStandards(entries: StandardGenerationProfile[]) {
  const rejected: Array<{ id: string; reason: string }> = [];
  const accepted = entries.filter((entry) => {
    if (entry.localOnly) {
      rejected.push({ id: entry.id, reason: "local-only source" });
      return false;
    }
    if (!mayBundleStandard(entry.source)) {
      rejected.push({ id: entry.id, reason: "missing or conflicting redistribution provenance" });
      return false;
    }
    if (entry.referenceMaterial) {
      rejected.push({ id: entry.id, reason: "exact local reference material cannot enter the bundled catalog" });
      return false;
    }
    return true;
  });
  return { accepted, rejected };
}

function saveLocalStandards(entries: StandardGenerationProfile[]) {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function phraseLengthsFromMeasures(measureLengths: number[], form: StandardGenerationProfile["form"]) {
  if (measureLengths.length === 0) return [];
  if (form === "aaba" && measureLengths.length >= 28) {
    const phraseMeasures = Math.floor(measureLengths.length / 4);
    return [0, 1, 2, 3].map((phrase) => roundBeat(measureLengths
      .slice(phrase * phraseMeasures, phrase === 3 ? measureLengths.length : (phrase + 1) * phraseMeasures)
      .reduce((sum, length) => sum + length, 0)));
  }
  const phraseMeasures = 4;
  const phrases: number[] = [];
  for (let index = 0; index < measureLengths.length; index += phraseMeasures)
    phrases.push(roundBeat(measureLengths.slice(index, index + phraseMeasures).reduce((sum, length) => sum + length, 0)));
  return phrases;
}

function normalizeChordQuality(symbol: string) {
  return symbol.replace(/^[A-G](?:#|b)?/, "root").replace(/\/[A-G](?:#|b)?$/, "/bass");
}

function isGenerationProfile(value: unknown): value is StandardGenerationProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StandardGenerationProfile>;
  return typeof candidate.id === "string" && typeof candidate.title === "string"
    && typeof candidate.source?.sourceName === "string" && typeof candidate.source?.license === "string"
    && Array.isArray(candidate.generationUses)
    && Array.isArray(candidate.phraseLengthsBeats) && Array.isArray(candidate.melodicDurationPalette);
}

function stableId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `standard-${(hash >>> 0).toString(36)}`;
}

function roundBeat(value: number) {
  return Math.round(value * 192) / 192;
}
