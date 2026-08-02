import type { Instrument, InstrumentSampleZone } from "./types";

export const SALAMANDER_COMPACT_GRAND_ID = "factory-salamander-compact-grand";
export const SALAMANDER_COMPACT_GRAND_NAME = "Salamander Compact Grand";

export const SALAMANDER_COMPACT_ROOTS = [
  { label: "A0", midi: 21, loNote: 21, hiNote: 22 },
  { label: "C1", midi: 24, loNote: 23, hiNote: 29 },
  { label: "C2", midi: 36, loNote: 30, hiNote: 41 },
  { label: "C3", midi: 48, loNote: 42, hiNote: 53 },
  { label: "C4", midi: 60, loNote: 54, hiNote: 65 },
  { label: "C5", midi: 72, loNote: 66, hiNote: 77 },
  { label: "C6", midi: 84, loNote: 78, hiNote: 89 },
  { label: "C7", midi: 96, loNote: 90, hiNote: 101 },
  { label: "C8", midi: 108, loNote: 102, hiNote: 108 },
] as const;

export const SALAMANDER_COMPACT_VELOCITIES = [
  { layer: 2, loVel: 1, hiVel: 31, label: "pp" },
  { layer: 6, loVel: 32, hiVel: 63, label: "mp" },
  { layer: 10, loVel: 64, hiVel: 95, label: "mf" },
  { layer: 14, loVel: 96, hiVel: 127, label: "ff" },
] as const;

export function salamanderCompactSampleMap(): InstrumentSampleZone[] {
  return SALAMANDER_COMPACT_ROOTS.flatMap((root) => (
    SALAMANDER_COMPACT_VELOCITIES.map((velocity) => ({
      id: `salamander-${root.label.toLowerCase()}-v${velocity.layer}`,
      path: `/samples/salamander-compact/${root.label}v${velocity.layer}.flac`,
      name: `${root.label} ${velocity.label}`,
      rootNote: root.midi,
      loNote: root.loNote,
      hiNote: root.hiNote,
      loVel: velocity.loVel,
      hiVel: velocity.hiVel,
      volumeDb: 0,
      pan: 0,
      tuning: 0,
      seqPosition: 0,
      oneShot: false,
    }))
  ));
}

export function createSalamanderCompactGrand(setId: string): Instrument {
  const sampleMap = salamanderCompactSampleMap();
  const sampleUrls = sampleMap.map((zone) => zone.path);
  return {
    id: SALAMANDER_COMPACT_GRAND_ID,
    name: SALAMANDER_COMPACT_GRAND_NAME,
    icon: "ph:piano-keys",
    kind: "sampler",
    envelope: { attackMs: 2, decayMs: 12000, sustain: 0.88, releaseMs: 1400 },
    knobs: { cutoff: 1, resonance: 0.04, drive: 0, color: 0.52 },
    filterType: "lowpass",
    waveform: "sample",
    maxVoices: 32,
    mono: false,
    legato: false,
    ampLevel: 0.9,
    ampPan: 0,
    sampleIds: [],
    sampleUrl: sampleUrls[18],
    sampleUrls,
    sampleMap,
    samplerComplexity: "performance",
    setId,
    taxonomy: { categoryId: "keyboards", instrumentId: "grand_piano" },
    source: {
      kind: "factory",
      label: "Salamander Grand Piano V3 (compact Beat mapping)",
      url: "https://github.com/sfzinstruments/SalamanderGrandPiano",
      license: "CC BY 3.0",
      edited: true,
    },
    descriptors: [
      "piano",
      "grand piano",
      "acoustic piano",
      "keys",
      "multisample",
      "velocity-layered",
      "natural decay",
      "stereo",
    ],
    userCreated: false,
  };
}
