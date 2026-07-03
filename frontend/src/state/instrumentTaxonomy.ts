import taxonomy from "../data/instrument_library_taxonomy.json";
import type { Instrument, InstrumentTaxonomyAssignment } from "./types";

interface TaxonomyCategory {
  id: string;
  name: string;
  sort_order?: number;
}

interface TaxonomyInstrument {
  id: string;
  name: string;
  primary_category_id: string;
  primary_sort_order?: number;
  tags?: string[];
}

const categories = (taxonomy.categories as TaxonomyCategory[])
  .filter((category) => category.id && category.name)
  .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));

const categoryById = new Map(categories.map((category) => [category.id, category]));

const taxonomyInstruments = (taxonomy.instruments as TaxonomyInstrument[])
  .filter((instrument) => instrument.id && instrument.name && categoryById.has(instrument.primary_category_id))
  .sort((a, b) => {
    const categoryA = categoryById.get(a.primary_category_id);
    const categoryB = categoryById.get(b.primary_category_id);
    const categorySort = (categoryA?.sort_order ?? 0) - (categoryB?.sort_order ?? 0);
    if (categorySort !== 0) return categorySort;
    return (a.primary_sort_order ?? 0) - (b.primary_sort_order ?? 0) || a.name.localeCompare(b.name);
  });

const instrumentById = new Map(taxonomyInstruments.map((instrument) => [instrument.id, instrument]));

export const INSTRUMENT_TAXONOMY_CATEGORY_OPTIONS = categories.map((category) => ({
  value: category.id,
  label: category.name,
}));

export const INSTRUMENT_TAXONOMY_OPTIONS = [
  { value: "", label: "Unassigned" },
  ...taxonomyInstruments.map((instrument) => {
    const category = categoryById.get(instrument.primary_category_id);
    return {
      value: instrument.id,
      label: `${category?.name ?? "Instrument"} / ${instrument.name}`,
    };
  }),
];

export function instrumentTaxonomyOptionsForCategory(categoryId: string) {
  return taxonomyInstruments
    .filter((instrument) => instrument.primary_category_id === categoryId)
    .map((instrument) => ({
      value: instrument.id,
      label: instrument.name,
    }));
}

export function firstInstrumentTaxonomyIdForCategory(categoryId: string): string {
  return taxonomyInstruments.find((instrument) => instrument.primary_category_id === categoryId)?.id ?? "";
}

export function taxonomyAssignmentForInstrumentId(instrumentId: string): InstrumentTaxonomyAssignment | undefined {
  const entry = instrumentById.get(instrumentId);
  if (!entry) return undefined;
  return {
    categoryId: entry.primary_category_id,
    instrumentId: entry.id,
  };
}

export function taxonomyAssignmentLabel(assignment?: InstrumentTaxonomyAssignment): string {
  if (!assignment?.instrumentId) return "Unassigned";
  const entry = instrumentById.get(assignment.instrumentId);
  if (!entry) return "Unassigned";
  const category = categoryById.get(entry.primary_category_id);
  return `${category?.name ?? "Instrument"} / ${entry.name}`;
}

export function normalizeInstrumentTaxonomy(instrument: Instrument): InstrumentTaxonomyAssignment | undefined {
  const assigned = instrument.taxonomy?.instrumentId
    ? taxonomyAssignmentForInstrumentId(instrument.taxonomy.instrumentId)
    : undefined;
  if (assigned) return assigned;
  return inferInstrumentTaxonomy(instrument);
}

export function inferInstrumentTaxonomy(instrument: Pick<Instrument, "name" | "kind" | "waveform" | "descriptors">): InstrumentTaxonomyAssignment | undefined {
  const haystack = [
    instrument.name,
    instrument.kind,
    instrument.waveform,
    ...(instrument.descriptors ?? []),
  ].join(" ").toLowerCase();
  let best: { score: number; entry: TaxonomyInstrument } | undefined;

  for (const entry of taxonomyInstruments) {
    const category = categoryById.get(entry.primary_category_id);
    const tokens = [
      entry.name,
      entry.id,
      category?.name,
      ...(entry.tags ?? []),
    ].filter(Boolean).map((value) => String(value).toLowerCase());

    let score = 0;
    for (const token of tokens) {
      const normalized = token.replace(/_/g, " ");
      if (normalized && haystack.includes(normalized)) score += normalized === entry.name.toLowerCase() ? 6 : 2;
    }

    if (!best || score > best.score) best = { score, entry };
  }

  if (!best || best.score <= 0) return undefined;
  return taxonomyAssignmentForInstrumentId(best.entry.id);
}
