import type { Instrument, InstrumentSampleZone, MidiNote } from "./types";

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function zoneIdentitySource(zone: InstrumentSampleZone, index: number): string {
  return [
    index,
    zone.path,
    zone.name ?? "",
    zone.rootNote,
    zone.loNote,
    zone.hiNote,
    zone.loVel,
    zone.hiVel,
    zone.seqPosition,
    zone.startSample ?? "",
    zone.endSample ?? "",
  ].join("|");
}

export function sampleZoneStableId(zone: InstrumentSampleZone, index: number): string {
  return zone.id ?? `zone_${stableHash(zoneIdentitySource(zone, index))}`;
}

export function normalizeSampleMap(sampleMap?: InstrumentSampleZone[]): InstrumentSampleZone[] | undefined {
  if (!sampleMap?.length) return sampleMap;
  return sampleMap.map((zone, index) => ({
    ...zone,
    id: sampleZoneStableId(zone, index),
  }));
}

export function sampleZoneDisplayName(zone: InstrumentSampleZone, index: number): string {
  if (zone.name?.trim()) return zone.name.trim();
  const filename = zone.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "");
  if (filename?.trim()) return filename.trim();
  return `Sample zone ${index + 1}`;
}

export function isSampleBackedInstrument(instrument?: Instrument): boolean {
  if (!instrument) return false;
  return instrument.kind === "sampler"
    || instrument.waveform === "sample"
    || Boolean(instrument.sampleUrl)
    || Boolean(instrument.sampleUrls?.length)
    || Boolean(instrument.sampleMap?.length);
}

export function midiNoteSampleLabel(instrument: Instrument | undefined, note: MidiNote): string | undefined {
  if (note.sampleLabel) return note.sampleLabel;
  if (!instrument) return undefined;
  const zones = instrument.sampleMap ?? [];
  const zone = zones.find((candidate, index) => sampleZoneStableId(candidate, index) === note.sampleZoneId)
    ?? zones.find((candidate) => candidate.path === note.samplePath);
  if (!zone) return note.samplePath?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "");
  return sampleZoneDisplayName(zone, zones.indexOf(zone));
}
