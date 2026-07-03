import type { Instrument } from "./types";

const DEV_FIXTURE_INSTRUMENT_IDS = new Set([
  "dev-mixed-era-aether-host",
  "dev-mixed-era-aether-fx-host",
  "dev-aether-preset-library-host",
  "dev-aether-oscillator-host",
  "dev-aether-fx-rack-host",
  "dev-aether-macro-host",
  "dev-aether-wavemap-editor-host",
  "dev-aether-envelope-host",
  "dev-aether-amp-filter-host",
  "dev-aether-lfo-host",
  "dev-aether-performance-host",
]);

const DEV_FIXTURE_SOURCE_LABELS = new Set([
  "Aether oscillator editor dev fixture",
  "Aether FX rack editor dev fixture",
  "Aether macro browser dev fixture",
  "Aether wavemap editor dev fixture",
  "Aether envelope editor dev fixture",
  "Aether amp/filter editor dev fixture",
  "Aether LFO editor dev fixture",
  "Aether performance editor dev fixture",
  "Aether automation dev fixture",
]);

const DEV_FIXTURE_NAMES = new Set([
  "Mixed Era Browser Host",
  "Mixed Era FX Browser Host",
  "Preset Library Browser Host",
  "Oscillator Browser Host",
  "FX Rack Browser Host",
  "Macro Browser Host",
  "Wavemap Browser Host",
  "Envelope Browser Host",
  "Amp Filter Browser Host",
  "LFO Browser Host",
  "Performance Browser Host",
  "Aether Automation Fixture",
]);

export function isDevFixtureInstrument(instrument: Instrument): boolean {
  if (DEV_FIXTURE_INSTRUMENT_IDS.has(instrument.id)) return true;
  if (instrument.source?.label && DEV_FIXTURE_SOURCE_LABELS.has(instrument.source.label)) return true;
  const tags = instrument.synthPatch?.metadata.tags ?? [];
  return DEV_FIXTURE_NAMES.has(instrument.name) && tags.includes("dev");
}

export function pruneDevFixtureInstruments(instruments: Instrument[]): Instrument[] {
  return instruments.filter((instrument) => !isDevFixtureInstrument(instrument));
}
