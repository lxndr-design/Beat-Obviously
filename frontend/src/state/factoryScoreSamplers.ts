import { createSalamanderCompactGrand } from "./factoryPiano";
import { BEAR_SAX_SAMPLE_MAP, BEAR_SAX_SOURCE_REVISION } from "./factorySaxSamplerManifest.generated";
import { VSCO_SCORE_SAMPLER_MANIFEST, VSCO_SCORE_SOURCE_REVISION } from "./factoryScoreSamplerManifest.generated";
import type { Instrument, InstrumentSampleZone } from "./types";

export const FACTORY_SCORE_SAMPLER_SET_ID = "orchestra-pit";

type ScoreSamplerKey = keyof typeof VSCO_SCORE_SAMPLER_MANIFEST;

const SCORE_SAMPLER_KEYS = Object.keys(VSCO_SCORE_SAMPLER_MANIFEST) as ScoreSamplerKey[];

const SAX_VARIANTS = {
  soprano: { name: "Bear Soprano Saxophone", taxonomyId: "soprano_saxophone", offset: 24, loNote: 48, hiNote: 88 },
  tenor: { name: "Bear Tenor Saxophone", taxonomyId: "tenor_saxophone", offset: 12, loNote: 36, hiNote: 76 },
  baritone: { name: "Bear Baritone Saxophone", taxonomyId: "baritone_saxophone", offset: 0, loNote: 24, hiNote: 60 },
} as const;

type SaxVariant = keyof typeof SAX_VARIANTS;

const UNPITCHED_SCORE_SAMPLES = {
  "bass-drum": { name: "VSCO Orchestral Bass Drum", path: "/samples/vsco-ce/bass-drum.wav" },
  cymbal: { name: "VSCO Suspended Cymbal", path: "/samples/vsco-ce/suspended-cymbal.wav" },
  crash: { name: "Pearl Crash Cymbal", path: "/samples/pearl-master-studio/crash-01.wav" },
  ride: { name: "Pearl Ride Cymbal", path: "/samples/pearl-master-studio/ride-01.wav" },
  "closed-hat": { name: "Pearl Closed Hi-Hat", path: "/samples/pearl-master-studio/hihat-closed.wav" },
  "open-hat": { name: "Pearl Open Hi-Hat", path: "/samples/pearl-master-studio/hihat-open.wav" },
  "low-tom": { name: "Pearl Low Tom", path: "/samples/pearl-master-studio/tom-03.wav" },
  "mid-tom": { name: "Pearl Mid Tom", path: "/samples/pearl-master-studio/tom-02.wav" },
  "high-tom": { name: "Pearl High Tom", path: "/samples/pearl-master-studio/tom-01.wav" },
  triangle: { name: "VSCO Triangle", path: "/samples/vsco-ce/triangle-hit.wav" },
  snare: { name: "Pearl Orchestral Snare", path: "/samples/pearl-master-studio/snare-01.wav" },
  tambourine: { name: "CR-78 Tambourine", path: "/samples/cr78/tamb-short.wav" },
  castanets: { name: "Score Castanets", path: "/samples/tr505/tr505-rim.wav" },
} as const;

type UnpitchedScoreSamplerKey = keyof typeof UNPITCHED_SCORE_SAMPLES;

export function createFactoryScoreSamplerBank(setId = FACTORY_SCORE_SAMPLER_SET_ID): Instrument[] {
  return [
    ...SCORE_SAMPLER_KEYS.map((key) => createMappedScoreSampler(key, `factory-vsco-score-${key}`, setId)),
    ...Object.keys(SAX_VARIANTS).map((variant) => createSaxScoreSampler(
      variant as SaxVariant,
      `factory-bear-sax-score-${variant}`,
      setId,
    )),
  ];
}

export function createFactoryScoreInstrument(
  partName: string,
  instanceId: string,
  setId = FACTORY_SCORE_SAMPLER_SET_ID,
): Instrument {
  if (/piano|keyboard|keys/i.test(partName)) {
    return { ...createSalamanderCompactGrand(setId), id: instanceId };
  }
  const saxVariant = saxVariantForPartName(partName);
  if (saxVariant) return createSaxScoreSampler(saxVariant, instanceId, setId);
  const mappedKey = scoreSamplerKeyForPartName(partName);
  if (mappedKey) return createMappedScoreSampler(mappedKey, instanceId, setId);
  const unpitchedKey = unpitchedSamplerKeyForPartName(partName);
  if (unpitchedKey) return createUnpitchedScoreSampler(unpitchedKey, instanceId, setId);
  // Unknown orchestral labels remain sample-based and reviewable instead of silently
  // falling back to an unrelated oscillator patch.
  return createMappedScoreSampler("violin-section", instanceId, setId, `Unresolved score part - ${partName}`);
}

export function factoryScoreSamplerIdForPartName(partName: string): string | undefined {
  const saxVariant = saxVariantForPartName(partName);
  if (saxVariant) return `factory-bear-sax-score-${saxVariant}`;
  const mappedKey = scoreSamplerKeyForPartName(partName);
  return mappedKey ? `factory-vsco-score-${mappedKey}` : undefined;
}

export function scoreSamplerKeyForPartName(partName: string): ScoreSamplerKey | undefined {
  const name = partName.toLowerCase();
  if (/tam[- ]?tam|gong/.test(name)) return "gong";
  if (/timpani/.test(name)) return "timpani";
  if (/glock|celesta|crotale|tubular bell|xylophone/.test(name)) return "glockenspiel";
  if (/harp/.test(name)) return "harp";
  if (/\bcontrabass\b|double bass|string bass/.test(name)) return "contrabass-section";
  if (/cello/.test(name)) return "cello-section";
  if (/viola/.test(name)) return "viola-section";
  if (/violin|string/.test(name)) return "violin-section";
  if (/tuba/.test(name)) return "tuba";
  if (/trombone/.test(name)) return "trombone";
  if (/trumpet|cornet/.test(name)) return "trumpet";
  if (/contrabassoon|bassoon/.test(name)) return "bassoon";
  if (/bass clarinet|clarinet/.test(name)) return "clarinet";
  if (/english horn|cor anglais|oboe/.test(name)) return "oboe";
  if (/french horn|horns?\b|\bcor\b/.test(name)) return "french-horn";
  if (/piccolo/.test(name)) return "piccolo";
  if (/alto flute|flute/.test(name)) return "flute";
  return undefined;
}

function unpitchedSamplerKeyForPartName(partName: string): UnpitchedScoreSamplerKey | undefined {
  const name = partName.toLowerCase();
  if (/bass drum|kick/.test(name)) return "bass-drum";
  if (/closed (?:hi-?)?hat|closedhat/.test(name)) return "closed-hat";
  if (/open (?:hi-?)?hat|openhat/.test(name)) return "open-hat";
  if (/ride/.test(name)) return "ride";
  if (/crash/.test(name)) return "crash";
  if (/low tom/.test(name)) return "low-tom";
  if (/mid tom|middle tom/.test(name)) return "mid-tom";
  if (/high tom/.test(name)) return "high-tom";
  if (/cymbal/.test(name)) return "cymbal";
  if (/triangle/.test(name)) return "triangle";
  if (/snare|side drum/.test(name)) return "snare";
  if (/tambourine/.test(name)) return "tambourine";
  if (/castanet|woodblock/.test(name)) return "castanets";
  return undefined;
}

function saxVariantForPartName(partName: string): SaxVariant | undefined {
  const name = partName.toLowerCase();
  if (/soprano sax|sopranino sax/.test(name)) return "soprano";
  if (/baritone sax|bass sax|contrabass sax/.test(name)) return "baritone";
  if (/tenor sax|alto sax|saxophone|\bsax\b/.test(name)) return "tenor";
  return undefined;
}

function createSaxScoreSampler(variant: SaxVariant, id: string, setId: string): Instrument {
  const definition = SAX_VARIANTS[variant];
  const sourceRoots = [...new Set(BEAR_SAX_SAMPLE_MAP.map((zone) => zone.rootNote))].sort((left, right) => left - right);
  const targetRoots = sourceRoots.map((root) => root + definition.offset);
  const sampleMap = BEAR_SAX_SAMPLE_MAP.map((sourceZone) => {
    const rootIndex = sourceRoots.indexOf(sourceZone.rootNote);
    const targetRoot = targetRoots[rootIndex];
    const loNote = rootIndex === 0
      ? definition.loNote
      : Math.floor((targetRoots[rootIndex - 1] + targetRoot) / 2) + 1;
    const hiNote = rootIndex === targetRoots.length - 1
      ? definition.hiNote
      : Math.floor((targetRoot + targetRoots[rootIndex + 1]) / 2);
    return {
      ...sourceZone,
      id: `${sourceZone.id}-${variant}`,
      // Keep the recorded root so tenor/soprano variants are actually shifted
      // upward while their selection ranges follow the target register.
      loNote,
      hiNote,
    } as InstrumentSampleZone;
  });
  const sampleUrls = [...new Set(sampleMap.map((zone) => zone.path))];
  return {
    id,
    name: definition.name,
    icon: "ph:wind",
    kind: "sampler",
    envelope: { attackMs: 8, decayMs: 1800, sustain: 0.94, releaseMs: 260 },
    knobs: { cutoff: 0.97, resonance: 0.03, drive: 0, color: 0.56 },
    filterType: "lowpass",
    waveform: "sample",
    octave: 0,
    detuneCents: 0,
    subOscLevel: 0,
    glideMs: 0,
    maxVoices: 32,
    mono: false,
    legato: false,
    ampLevel: 0.88,
    ampPan: 0,
    sampleIds: [],
    sampleUrl: sampleUrls[Math.floor(sampleUrls.length / 2)],
    sampleUrls,
    sampleMap,
    samplerComplexity: "performance",
    setId,
    taxonomy: { categoryId: "woodwinds", instrumentId: definition.taxonomyId },
    source: {
      kind: "factory",
      label: `Bear Sax high-definition ${variant} mapping`,
      url: `https://github.com/sfzinstruments/karoryfer.bear-sax/tree/${BEAR_SAX_SOURCE_REVISION}`,
      license: "CC0-1.0",
      edited: true,
    },
    descriptors: [
      variant,
      "saxophone",
      "reed",
      "multisample",
      "velocity layered",
      "score import",
      "offline factory sample",
    ],
    userCreated: false,
  };
}

function createMappedScoreSampler(
  key: ScoreSamplerKey,
  id: string,
  setId: string,
  unresolvedLabel?: string,
): Instrument {
  const definition = VSCO_SCORE_SAMPLER_MANIFEST[key];
  const baseZones = definition.sampleMap.map((zone) => ({ ...zone })) as InstrumentSampleZone[];
  const sampleMap = key === "gong" ? expandUnpitchedZones(baseZones) : baseZones;
  const sampleUrls = [...new Set(sampleMap.map((zone) => zone.path))];
  return {
    id,
    name: unresolvedLabel ?? definition.name,
    icon: iconForCategory(definition.categoryId),
    kind: "sampler",
    envelope: { ...definition.envelope },
    knobs: { cutoff: 0.96, resonance: 0.04, drive: 0, color: colorForKey(key) },
    filterType: "lowpass",
    waveform: "sample",
    octave: 0,
    detuneCents: 0,
    subOscLevel: 0,
    glideMs: 0,
    maxVoices: /section/.test(key) ? 48 : 32,
    mono: false,
    legato: false,
    ampLevel: key === "gong" ? 0.76 : 0.88,
    ampPan: 0,
    sampleIds: [],
    sampleUrl: sampleUrls[Math.floor(sampleUrls.length / 2)],
    sampleUrls,
    sampleMap,
    samplerComplexity: "performance",
    setId,
    taxonomy: { categoryId: definition.categoryId, instrumentId: definition.instrumentId },
    source: {
      kind: "factory",
      label: "VSCO 2 Community Edition high-definition score mapping",
      url: `https://github.com/sgossner/VSCO-2-CE/tree/${VSCO_SCORE_SOURCE_REVISION}`,
      license: "CC0-1.0",
      edited: true,
    },
    descriptors: [
      key.replaceAll("-", " "),
      definition.name,
      "orchestral",
      "multisample",
      "velocity layered",
      "score import",
      "offline factory sample",
    ],
    userCreated: false,
  };
}

function createUnpitchedScoreSampler(key: UnpitchedScoreSamplerKey, id: string, setId: string): Instrument {
  const definition = UNPITCHED_SCORE_SAMPLES[key];
  const sourceZone: InstrumentSampleZone = {
    id: `score-${key}`,
    path: definition.path,
    name: definition.name,
    rootNote: 60,
    loNote: 0,
    hiNote: 127,
    loVel: 1,
    hiVel: 127,
    volumeDb: 0,
    pan: 0,
    tuning: 0,
    seqPosition: 0,
    oneShot: true,
  };
  const sampleMap = expandUnpitchedZones([sourceZone]);
  return {
    id,
    name: definition.name,
    icon: "ph:metronome",
    kind: "sampler",
    envelope: /closed-hat/.test(key)
      ? { attackMs: 1, decayMs: 180, sustain: 0, releaseMs: 90 }
      : /open-hat|ride|crash|cymbal/.test(key)
        ? { attackMs: 1, decayMs: 1800, sustain: 0, releaseMs: 1100 }
        : /tom/.test(key)
          ? { attackMs: 1, decayMs: 720, sustain: 0, releaseMs: 420 }
          : { attackMs: 1, decayMs: 1600, sustain: 0, releaseMs: 900 },
    knobs: { cutoff: 0.98, resonance: 0.02, drive: 0, color: 0.68 },
    filterType: "lowpass",
    waveform: "sample",
    maxVoices: 32,
    mono: false,
    legato: false,
    ampLevel: 0.84,
    ampPan: 0,
    sampleIds: [],
    sampleUrl: definition.path,
    sampleUrls: [definition.path],
    sampleMap,
    samplerComplexity: "performance",
    setId,
    taxonomy: { categoryId: "orchestral_percussion", instrumentId: key.replaceAll("-", "_") },
    source: {
      kind: "factory",
      label: definition.name,
      url: key === "castanets" ? "https://oramics.github.io/sampled/DM/TR-505/" : undefined,
      license: key === "castanets" ? "Public Domain" : undefined,
      edited: true,
    },
    descriptors: [key.replaceAll("-", " "), "orchestral percussion", "sample", "score import"],
    userCreated: false,
  };
}

function expandUnpitchedZones(zones: InstrumentSampleZone[]): InstrumentSampleZone[] {
  return Array.from({ length: 128 }, (_, pitch) => zones.map((zone) => ({
    ...zone,
    id: `${zone.id}-pitch-${pitch}`,
    rootNote: pitch,
    loNote: pitch,
    hiNote: pitch,
  }))).flat();
}

function iconForCategory(category: string) {
  if (category === "strings") return "ph:music-notes";
  if (category === "brass") return "ph:megaphone";
  if (category === "woodwinds") return "ph:wind";
  if (category === "mallets") return "ph:bell";
  return "ph:metronome";
}

function colorForKey(key: ScoreSamplerKey) {
  const index = SCORE_SAMPLER_KEYS.indexOf(key);
  return index < 0 ? 0.5 : index / Math.max(1, SCORE_SAMPLER_KEYS.length - 1);
}
