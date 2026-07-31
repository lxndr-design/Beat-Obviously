import { createAurumPresetRecord, type AurumPresetRecord } from "./synthPresets";
import { createAurumTestInstruments } from "./aurumTestBank";
import type { Instrument } from "./types";

export const AURUM_FACTORY_PRESET_FAVORITES_KEY = "beat.instrument-presets.aurum-factory-favorites.v1";
export const AURUM_FACTORY_PRESET_BANK_VERSION = 2;

export type AurumFactoryPresetFamily = "bass" | "bell" | "keys" | "pad" | "lead" | "percussion" | "fx";

export interface AurumFactoryPresetRecord extends AurumPresetRecord {
  bankVersion: typeof AURUM_FACTORY_PRESET_BANK_VERSION;
  source: "factory";
  family: AurumFactoryPresetFamily;
  description: string;
  immutable: true;
  audition: {
    midiNote: number;
    velocity: number;
    durationSeconds: number;
    listeningNote: string;
  };
  regression: {
    sampleRate: 48000;
    frames: 16384;
    peakRange: readonly [number, number];
    rmsRange: readonly [number, number];
    fullAudition?: {
      peakRange: readonly [number, number];
      rmsRange: readonly [number, number];
    };
  };
}

interface FactoryPresetSpec {
  sourceIndex: number;
  id: string;
  name: string;
  family: AurumFactoryPresetFamily;
  tags: string[];
  description: string;
  audition: AurumFactoryPresetRecord["audition"];
  regression: AurumFactoryPresetRecord["regression"];
  curate: (instrument: Instrument) => void;
}

const FACTORY_CREATED_AT = Date.UTC(2026, 6, 27);

const SPECS: FactoryPresetSpec[] = [
  {
    sourceIndex: 0,
    id: "factory.aurum.substructure.v2",
    name: "Substructure",
    family: "bass",
    tags: ["aurum", "factory", "v13", "modulation", "bass", "mono", "sub", "warm"],
    description: "Focused mono FM bass with a controlled transient and short glide.",
    audition: { midiNote: 36, velocity: 112, durationSeconds: 1.8, listeningNote: "Check the centered sub fundamental, defined attack, and clean glide tail." },
    regression: { sampleRate: 48000, frames: 16384, peakRange: [0.46, 0.57], rmsRange: [0.28, 0.35] },
    curate: (instrument) => {
      instrument.ampLevel = 0.72;
      instrument.glideMs = 34;
      instrument.aurum!.filters[0].cutoff = 0.3;
    },
  },
  {
    sourceIndex: 1,
    id: "factory.aurum.glass-current.v2",
    name: "Glass Current",
    family: "bell",
    tags: ["aurum", "factory", "v13", "modulation", "bell", "glass", "inharmonic", "bright"],
    description: "Velocity-sensitive inharmonic bell with a long, open decay.",
    audition: { midiNote: 72, velocity: 104, durationSeconds: 3.2, listeningNote: "Listen for separated metallic partials and a smooth decay without unstable ringing." },
    regression: { sampleRate: 48000, frames: 16384, peakRange: [0.16, 0.2], rmsRange: [0.067, 0.083] },
    curate: (instrument) => {
      instrument.ampLevel = 0.68;
      instrument.aurum!.operators[2].fineCents = 7;
      instrument.aurum!.filters[0].resonance = 0.24;
    },
  },
  {
    sourceIndex: 2,
    id: "factory.aurum.tine-circuit.v2",
    name: "Tine Circuit",
    family: "keys",
    tags: ["aurum", "factory", "v13", "modulation", "keys", "tines", "stereo", "electric"],
    description: "Playable stereo tine keys with split carriers and a restrained bite.",
    audition: { midiNote: 60, velocity: 96, durationSeconds: 2.2, listeningNote: "Check that the initial tine speaks clearly and the stereo body stays balanced." },
    regression: { sampleRate: 48000, frames: 16384, peakRange: [0.124, 0.153], rmsRange: [0.033, 0.041] },
    curate: (instrument) => {
      instrument.ampLevel = 0.7;
      instrument.aurum!.unison = 1;
      instrument.aurum!.operators[2].level = 0.38;
    },
  },
  {
    sourceIndex: 3,
    id: "factory.aurum.slow-aurora.v2",
    name: "Slow Aurora",
    family: "pad",
    tags: ["aurum", "factory", "v13", "modulation", "pad", "additive", "wide", "ambient"],
    description: "Slow additive pad with wide parallel filtering and a soft upper haze.",
    audition: { midiNote: 55, velocity: 88, durationSeconds: 4.2, listeningNote: "Allow the attack to bloom; verify width without a hollow center or harsh upper partials." },
    regression: {
      sampleRate: 48000,
      frames: 16384,
      peakRange: [0.007, 0.009],
      rmsRange: [0.0023, 0.0029],
      fullAudition: { peakRange: [0.054, 0.067], rmsRange: [0.0098, 0.0121] },
    },
    curate: (instrument) => {
      instrument.ampLevel = 0.62;
      instrument.aurum!.unison = 4;
      instrument.aurum!.detuneCents = 14;
    },
  },
  {
    sourceIndex: 4,
    id: "factory.aurum.vector-lead.v2",
    name: "Vector Lead",
    family: "lead",
    tags: ["aurum", "factory", "v13", "modulation", "lead", "mono", "feedback", "wavefold"],
    description: "Articulate mono lead balancing feedback edge with controlled wavefold.",
    audition: { midiNote: 67, velocity: 108, durationSeconds: 2, listeningNote: "Listen for an immediate pitch center, expressive edge, and a release without feedback chirps." },
    regression: { sampleRate: 48000, frames: 16384, peakRange: [0.233, 0.285], rmsRange: [0.107, 0.131] },
    curate: (instrument) => {
      instrument.ampLevel = 0.66;
      instrument.glideMs = 52;
      instrument.aurum!.operators[0].wavefold = 0.28;
    },
  },
  {
    sourceIndex: 5,
    id: "factory.aurum.kinetic-hit.v2",
    name: "Kinetic Hit",
    family: "percussion",
    tags: ["aurum", "factory", "v13", "modulation", "percussion", "hit", "transient", "pitch-envelope"],
    description: "Compact synthesized hit with a tuned pitch drop and crisp FM transient.",
    audition: { midiNote: 48, velocity: 118, durationSeconds: 1.2, listeningNote: "Check the single clean transient, audible pitch drop, and short noise-free tail." },
    regression: { sampleRate: 48000, frames: 16384, peakRange: [0.54, 0.66], rmsRange: [0.058, 0.072] },
    curate: (instrument) => {
      instrument.ampLevel = 0.74;
      instrument.aurum!.operators[0].pitchEnvelopeSemitones = 14;
      instrument.aurum!.filters[0].drive = 0.09;
    },
  },
  {
    sourceIndex: 7,
    id: "factory.aurum.broken-orbit.v2",
    name: "Broken Orbit",
    family: "fx",
    tags: ["aurum", "factory", "v13", "modulation", "fx", "ring-mod", "bipolar", "experimental"],
    description: "Stereo ring-modulated effect texture with asymmetric filtered motion.",
    audition: { midiNote: 52, velocity: 100, durationSeconds: 3, listeningNote: "Listen for deliberate stereo asymmetry and motion while confirming the output remains bounded." },
    regression: { sampleRate: 48000, frames: 16384, peakRange: [0.105, 0.129], rmsRange: [0.023, 0.029] },
    curate: (instrument) => {
      instrument.ampLevel = 0.58;
      instrument.aurum!.rmMatrix[1][0] = 0.72;
      instrument.aurum!.detuneCents = 17;
    },
  },
];

export const AURUM_FACTORY_PRESETS: readonly AurumFactoryPresetRecord[] = deepFreeze(createFactoryPresets());

export function aurumFactoryPresetById(id: string): AurumFactoryPresetRecord | null {
  return AURUM_FACTORY_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function isAurumFactoryPreset(record: AurumPresetRecord): record is AurumFactoryPresetRecord {
  return (record as Partial<AurumFactoryPresetRecord>).source === "factory"
    && (record as Partial<AurumFactoryPresetRecord>).immutable === true;
}

function createFactoryPresets(): AurumFactoryPresetRecord[] {
  const sources = createAurumTestInstruments("aurum-production-source");
  return SPECS.map((spec) => {
    const instrument = cloneInstrument(sources[spec.sourceIndex]);
    instrument.name = spec.name;
    instrument.setId = undefined;
    instrument.source = { kind: "factory", label: "Beat / Aurum Factory Bank v2" };
    instrument.descriptors = spec.tags.filter((tag) => tag !== "factory");
    spec.curate(instrument);
    return {
      ...createAurumPresetRecord({
        id: spec.id,
        name: spec.name,
        instrument,
        tags: spec.tags,
        now: FACTORY_CREATED_AT,
      }),
      bankVersion: AURUM_FACTORY_PRESET_BANK_VERSION,
      source: "factory",
      family: spec.family,
      description: spec.description,
      immutable: true,
      audition: { ...spec.audition },
      regression: {
        ...spec.regression,
        peakRange: [...spec.regression.peakRange] as [number, number],
        rmsRange: [...spec.regression.rmsRange] as [number, number],
        fullAudition: spec.regression.fullAudition
          ? {
              peakRange: [...spec.regression.fullAudition.peakRange] as [number, number],
              rmsRange: [...spec.regression.fullAudition.rmsRange] as [number, number],
            }
          : undefined,
      },
    };
  });
}

function cloneInstrument(instrument: Instrument): Instrument {
  return typeof structuredClone === "function" ? structuredClone(instrument) : JSON.parse(JSON.stringify(instrument));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
