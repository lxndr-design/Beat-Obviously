import { nanoid as nano } from "nanoid";
import type { DrumRow, Instrument, Segment } from "./types";

const DRUM_CATEGORY_IDS = new Set(["drum_machines_grooveboxes"]);
const DRUM_NAME_PATTERN = /\b(drum|kit|kick|snare|tom|hi[- ]?hat|hihat|cymbal|ride|crash|splash|clap|rimshot|cross stick|tabla|dhol|dholak|bodhran|cajon|timbales?|congas?|bongos?|djembe|taiko|tambourine|shaker|maracas|cowbell|guiro|cabasa|surdo|pandeiro|udu|shekere|percussion)\b/i;

interface InstrumentSegmentOptions {
  drum?: boolean;
  lengthBeats?: number;
  name?: string;
  startBeat?: number;
}

export function instrumentUsesDrumSegment(instrument: Instrument): boolean {
  if (DRUM_CATEGORY_IDS.has(instrument.taxonomy?.categoryId ?? "")) return true;
  const sampleNames = (instrument.sampleMap ?? []).map((zone) => zone.name ?? zone.path);
  const haystack = [
    instrument.name,
    instrument.taxonomy?.instrumentId,
    instrument.source?.label,
    ...(instrument.descriptors ?? []),
    ...(instrument.libraryMetadata?.tags ?? []),
    ...sampleNames,
  ].filter(Boolean).join(" ");
  return DRUM_NAME_PATTERN.test(haystack);
}

export function createInstrumentSegmentPatch(
  instrument: Instrument,
  options: InstrumentSegmentOptions = {},
): Partial<Segment> {
  const lengthBeats = Math.max(0.25, options.lengthBeats ?? 4);
  const drum = options.drum ?? instrumentUsesDrumSegment(instrument);
  return {
    name: options.name ?? (drum ? `${instrument.name} Loop` : instrument.name),
    startBeat: Math.max(0, options.startBeat ?? 0),
    lengthBeats,
    repeats: 0,
    layer: 0,
    muted: false,
    instrumentId: instrument.id,
    payload: drum
      ? {
          kind: "drum",
          rows: createInstrumentDrumRows(instrument),
          stepCount: 16,
          speed: 4,
          sourceLengthBeats: lengthBeats,
          defaultPitchHz: defaultInstrumentPitchHz(instrument),
        }
      : { kind: "midi", notes: [] },
  };
}

export function createInstrumentDrumRows(instrument: Instrument): DrumRow[] {
  const zones = instrument.sampleMap ?? [];
  const namedDrumZones = zones.filter((zone) => DRUM_NAME_PATTERN.test(zone.name ?? zone.path));
  const candidates = (namedDrumZones.length > 0 ? namedDrumZones : zones).slice(0, 16);
  const rows = new Map<string, DrumRow>();

  for (const zone of candidates) {
    const rootNote = clampMidiNote(zone.rootNote);
    const name = conciseZoneName(zone.name ?? zone.path, rootNote);
    const key = `${name.toLowerCase()}:${rootNote}`;
    if (rows.has(key)) continue;
    rows.set(key, {
      id: nano(),
      instrumentId: instrument.id,
      name,
      steps: Array.from({ length: 16 }, () => ({
        on: false,
        pitchHz: midiToFrequency(rootNote),
        velocity: Math.max(1, Math.min(127, Math.round((zone.loVel + zone.hiVel) / 2) || 110)),
      })),
    });
  }

  if (rows.size > 0) return Array.from(rows.values());
  const rootNote = defaultInstrumentRootNote(instrument);
  return [{
    id: nano(),
    instrumentId: instrument.id,
    name: instrument.name,
    steps: Array.from({ length: 16 }, () => ({
      on: false,
      pitchHz: midiToFrequency(rootNote),
      velocity: 110,
    })),
  }];
}

function defaultInstrumentPitchHz(instrument: Instrument): number {
  return midiToFrequency(defaultInstrumentRootNote(instrument));
}

function defaultInstrumentRootNote(instrument: Instrument): number {
  const firstZone = instrument.sampleMap?.find((zone) => Number.isFinite(zone.rootNote));
  return clampMidiNote(firstZone?.rootNote ?? 60);
}

function clampMidiNote(note: number): number {
  return Math.max(0, Math.min(127, Math.round(note)));
}

function midiToFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function conciseZoneName(name: string, rootNote: number): string {
  const fileName = name.split(/[\\/]/).pop()?.replace(/\.[a-z0-9]+$/i, "") ?? name;
  return (fileName.trim() || `Drum ${rootNote}`).slice(0, 42);
}
