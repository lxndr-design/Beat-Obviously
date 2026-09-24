import type { Instrument } from "./types";

/**
 * Aether remains readable by the audio engine so older projects keep sounding
 * the same, but it is no longer a user-selectable instrument engine. Keep this
 * predicate at the UI boundary instead of deleting legacy instruments from the
 * store: timeline playback still resolves those instruments by id.
 */
export function isLegacyAetherInstrument(instrument: Instrument): boolean {
  if (instrument.nodeGraph || instrument.aurum || isLumenInstrument(instrument)) return false;
  if (instrument.kind === "sampler" || instrument.waveform === "sample") return false;
  if (instrument.sampleUrl || instrument.sampleUrls?.length || instrument.sampleMap?.length) return false;

  return instrument.kind === "synth"
    || instrument.kind === "hybrid"
    || instrument.kind === "wavetable"
    || Boolean(instrument.aether)
    || instrument.synthPatch?.instrumentType === "wavetable-synth"
    || instrument.synthPatch?.namespace === "synth";
}

export function isLumenInstrument(instrument: Instrument): boolean {
  return instrument.synthPatch?.instrumentType === "lumen-hybrid-synth"
    || instrument.synthPatch?.namespace === "lumen";
}

export function userAccessibleInstruments(instruments: readonly Instrument[]): Instrument[] {
  return instruments.filter((instrument) => !isLegacyAetherInstrument(instrument));
}
