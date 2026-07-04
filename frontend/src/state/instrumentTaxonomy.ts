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
  const explicit = inferExplicitInstrumentTaxonomy(haystack);
  if (explicit) return explicit;

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

function inferExplicitInstrumentTaxonomy(haystack: string): InstrumentTaxonomyAssignment | undefined {
  const rules: Array<[RegExp, string]> = [
    [/\b(orchestral|concert)\s+bass\s+drum\b/, "concert_bass_drum"],
    [/\b(sub\s+kick|808)\b/, "808_bass"],
    [/\bkick\b/, "kick_drum"],
    [/\bsnare\b/, "snare"],
    [/\b(closed|open)?\s*hat\b|\bhi[- ]?hat\b|\bhihat\b/, "hi_hat"],
    [/\bsuspended\s+cymbal\b/, "suspended_cymbal"],
    [/\bsplash\b/, "splash_cymbal"],
    [/\bcrash\b/, "crash_cymbals"],
    [/\bride\b/, "ride_cymbal"],
    [/\bcymbal\b/, "cymbals"],
    [/\btom\b|\btoms\b/, "tom_toms"],
    [/\bclap\b/, "clap"],
    [/\brim\b|\brimshot\b/, "rimshot"],
    [/\bcowbell\b/, "cowbell"],
    [/\bconga\b/, "conga"],
    [/\btimbal\b/, "timbales"],
    [/\btambourine\b|\btamb\b/, "tambourine"],
    [/\bguiro\b/, "guiro"],
    [/\btriangle\b/, "triangle"],
    [/\bflute\b/, "concert_flute"],
    [/\bviolin\b/, "violin"],
    [/\btoy\s+xylophone\b/, "toy_xylophone"],
    [/\bxylophone\b/, "xylophone"],
    [/\bfelt\s+piano\b/, "felt_piano"],
    [/\bpiano\b|\bkeys\b/, "electric_piano"],
    [/\bchoir\b/, "synthetic_choir"],
    [/\bvocal\b|\bvoice\b|\bvowel\b|\btalk\b/, "synthetic_voice"],
    [/\breese\b/, "reese_bass"],
    [/\bsub\s+bass\b/, "sub_bass"],
    [/\bbass\b/, "synth_bass"],
    [/\bpad\b/, "pad_synth"],
    [/\blead\b/, "lead_synth"],
    [/\bpluck\b|\barp\b/, "digital_synth"],
    [/\bbell\b/, "glockenspiel"],
    [/\bmallet\b/, "xylophone"],
    [/\bdrone\b|\batmosphere\b|\btexture\b/, "textures"],
    [/\bmodular\b|\bnodemap\b/, "modular_synth"],
    [/\baether\b|\bwavemap\b|\bwavetable\b/, "wavetable_synth"],
    [/\bsampler\b|\bsample\b|\bdecent\s*sampler\b/, "sampler"],
    [/\bsynth\b/, "digital_synth"],
  ];

  for (const [pattern, instrumentId] of rules) {
    if (!pattern.test(haystack)) continue;
    const assignment = taxonomyAssignmentForInstrumentId(instrumentId);
    if (assignment) return assignment;
  }
  return undefined;
}
