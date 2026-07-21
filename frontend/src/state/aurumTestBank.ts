import { AURUM_DIRECT_BUS, AURUM_FILTER_A_BUS, AURUM_FILTER_B_BUS, AURUM_OPERATOR_COUNT, AURUM_OUTPUT_BUS_COUNT, AURUM_OUTPUT_COLUMN, createAurumInstrument } from "./aurum";
import type { AurumOperatorConfig, AurumSynthConfig, Instrument } from "./types";

export const AURUM_TEST_INSTRUMENT_NAMES = [
  "Aurum_Bass_01",
  "Aurum_Bell_01",
  "Aurum_Keys_01",
  "Aurum_Pad_01",
  "Aurum_Lead_01",
  "Aurum_Percussion_01",
  "Aurum_Organ_01",
  "Aurum_FX_01",
] as const;

export function createAurumTestInstruments(setId: string): Instrument[] {
  return [
    makeBass(setId),
    makeBell(setId),
    makeKeys(setId),
    makePad(setId),
    makeLead(setId),
    makePercussion(setId),
    makeOrgan(setId),
    makeFx(setId),
  ];
}

function makeBase(name: typeof AURUM_TEST_INSTRUMENT_NAMES[number], setId: string, descriptors: string[]) {
  const instrument = createAurumInstrument(`factory-${name.toLowerCase().replaceAll("_", "-")}`, name);
  instrument.setId = setId;
  instrument.source = { kind: "factory", label: "Beat / Aurum MVP test bank" };
  instrument.userCreated = false;
  instrument.descriptors = ["aurum", "test", ...descriptors];
  instrument.ampLevel = 0.76;
  instrument.maxVoices = 16;
  instrument.aurum = blankAurum(instrument.aurum!);
  return instrument;
}

function blankAurum(config: AurumSynthConfig): AurumSynthConfig {
  return {
    ...config,
    operators: config.operators.map((operator) => ({ ...cloneOperator(operator), enabled: false })),
    matrix: Array.from({ length: AURUM_OPERATOR_COUNT }, () => Array(AURUM_OPERATOR_COUNT + 1).fill(0)),
    rmMatrix: Array.from({ length: AURUM_OPERATOR_COUNT }, () => Array(AURUM_OPERATOR_COUNT).fill(0)),
    outputSends: Array.from({ length: AURUM_OPERATOR_COUNT }, () => Array(AURUM_OUTPUT_BUS_COUNT).fill(0)),
  };
}

function setOperator(config: AurumSynthConfig, index: number, patch: Partial<AurumOperatorConfig>) {
  config.operators[index] = {
    ...config.operators[index],
    ...patch,
    envelope: { ...config.operators[index].envelope, ...patch.envelope },
    pitchEnvelope: { ...config.operators[index].pitchEnvelope, ...patch.pitchEnvelope },
    phaseEnvelope: { ...config.operators[index].phaseEnvelope, ...patch.phaseEnvelope },
    harmonics: patch.harmonics ? [...patch.harmonics] : [...config.operators[index].harmonics],
    velocityCurve: patch.velocityCurve ? [...patch.velocityCurve] : [...config.operators[index].velocityCurve],
    keytrackCurve: patch.keytrackCurve ? [...patch.keytrackCurve] : [...config.operators[index].keytrackCurve],
  };
}

function fm(config: AurumSynthConfig, source: number, target: number, depth: number) {
  config.matrix[source][target] = depth;
}

function rm(config: AurumSynthConfig, source: number, target: number, depth: number) {
  config.rmMatrix[source][target] = depth;
}

function output(config: AurumSynthConfig, source: number, bus: number, depth: number) {
  config.outputSends[source][bus] = depth;
  if (bus === AURUM_FILTER_A_BUS) config.matrix[source][AURUM_OUTPUT_COLUMN] = depth;
}

function makeBass(setId: string) {
  const instrument = makeBase("Aurum_Bass_01", setId, ["bass", "fm", "low"]);
  const config = instrument.aurum!;
  setOperator(config, 0, { enabled: true, ratio: 0.5, level: 0.9, envelope: { attackMs: 2, decayMs: 320, sustain: 0.72, releaseMs: 220 } });
  setOperator(config, 1, { enabled: true, ratio: 1, level: 0.72, envelope: { attackMs: 0, decayMs: 260, sustain: 0.18, releaseMs: 130 } });
  setOperator(config, 2, { enabled: true, waveform: "triangle", ratio: 2, level: 0.48, envelope: { attackMs: 0, decayMs: 170, sustain: 0, releaseMs: 90 } });
  fm(config, 1, 0, 0.58);
  fm(config, 2, 1, 0.24);
  fm(config, 2, 2, 0.12);
  output(config, 0, AURUM_FILTER_A_BUS, 0.92);
  config.filters = [
    { enabled: true, type: "lowpass", cutoff: 0.34, resonance: 0.18, drive: 0.22 },
    { enabled: false, type: "highpass", cutoff: 0.08, resonance: 0, drive: 0 },
  ];
  config.unison = 1;
  instrument.mono = true;
  instrument.legato = true;
  instrument.glideMs = 42;
  return instrument;
}

function makeBell(setId: string) {
  const instrument = makeBase("Aurum_Bell_01", setId, ["bell", "fm", "inharmonic"]);
  const config = instrument.aurum!;
  setOperator(config, 0, { enabled: true, ratio: 1, level: 0.76, envelope: { attackMs: 1, decayMs: 2400, sustain: 0, releaseMs: 1800 }, velocityCurve: [0.3, 0.48, 0.68, 0.86, 1] });
  setOperator(config, 1, { enabled: true, ratio: 2.71, level: 0.7, envelope: { attackMs: 0, decayMs: 1750, sustain: 0, releaseMs: 1200 } });
  setOperator(config, 2, { enabled: true, ratio: 5.43, level: 0.44, envelope: { attackMs: 0, decayMs: 930, sustain: 0, releaseMs: 640 } });
  setOperator(config, 3, { enabled: true, ratio: 8.1, level: 0.26, envelope: { attackMs: 0, decayMs: 420, sustain: 0, releaseMs: 260 } });
  fm(config, 1, 0, 0.46);
  fm(config, 2, 0, 0.25);
  fm(config, 3, 1, 0.16);
  output(config, 0, AURUM_FILTER_A_BUS, 0.72);
  output(config, 0, AURUM_DIRECT_BUS, 0.18);
  config.filters[0] = { enabled: true, type: "bandpass", cutoff: 0.72, resonance: 0.28, drive: 0.04 };
  config.oversampling = 4;
  return instrument;
}

function makeKeys(setId: string) {
  const instrument = makeBase("Aurum_Keys_01", setId, ["keys", "fm", "stereo"]);
  const config = instrument.aurum!;
  setOperator(config, 0, { enabled: true, waveform: "triangle", ratio: 1, level: 0.7, pan: -0.22, envelope: { attackMs: 4, decayMs: 620, sustain: 0.58, releaseMs: 460 } });
  setOperator(config, 1, { enabled: true, waveform: "triangle", ratio: 1.005, level: 0.68, pan: 0.22, envelope: { attackMs: 6, decayMs: 680, sustain: 0.54, releaseMs: 500 } });
  setOperator(config, 2, { enabled: true, ratio: 2, level: 0.42, envelope: { attackMs: 0, decayMs: 360, sustain: 0.12, releaseMs: 220 } });
  setOperator(config, 3, { enabled: true, ratio: 3, level: 0.32, envelope: { attackMs: 0, decayMs: 280, sustain: 0.08, releaseMs: 180 } });
  fm(config, 2, 0, 0.3);
  fm(config, 3, 1, 0.22);
  output(config, 0, AURUM_FILTER_A_BUS, 0.58);
  output(config, 1, AURUM_FILTER_B_BUS, 0.58);
  config.filters = [
    { enabled: true, type: "lowpass", cutoff: 0.68, resonance: 0.13, drive: 0.06 },
    { enabled: true, type: "bandpass", cutoff: 0.58, resonance: 0.18, drive: 0.03 },
  ];
  config.filterRouting = "parallel";
  config.unison = 2;
  config.detuneCents = 5;
  config.stereoSpread = 0.28;
  return instrument;
}

function makePad(setId: string) {
  const instrument = makeBase("Aurum_Pad_01", setId, ["pad", "additive", "wide"]);
  const config = instrument.aurum!;
  setOperator(config, 0, { enabled: true, waveform: "additive", level: 0.58, pan: -0.3, harmonics: harmonicSeries("saw"), envelope: { attackMs: 720, decayMs: 1800, sustain: 0.78, releaseMs: 2600 } });
  setOperator(config, 1, { enabled: true, waveform: "additive", ratio: 0.5, level: 0.5, pan: 0.3, harmonics: harmonicSeries("odd"), envelope: { attackMs: 980, decayMs: 2200, sustain: 0.72, releaseMs: 3100 } });
  setOperator(config, 2, { enabled: true, ratio: 2, level: 0.25, envelope: { attackMs: 450, decayMs: 1600, sustain: 0.3, releaseMs: 1900 } });
  fm(config, 2, 0, 0.14);
  output(config, 0, AURUM_FILTER_A_BUS, 0.52);
  output(config, 1, AURUM_FILTER_B_BUS, 0.52);
  config.filters = [
    { enabled: true, type: "lowpass", cutoff: 0.48, resonance: 0.18, drive: 0.05 },
    { enabled: true, type: "highpass", cutoff: 0.16, resonance: 0.12, drive: 0 },
  ];
  config.filterRouting = "parallel";
  config.unison = 5;
  config.detuneCents = 18;
  config.stereoSpread = 0.82;
  return instrument;
}

function makeLead(setId: string) {
  const instrument = makeBase("Aurum_Lead_01", setId, ["lead", "feedback", "wavefold"]);
  const config = instrument.aurum!;
  setOperator(config, 0, { enabled: true, waveform: "saw", level: 0.72, wavefold: 0.36, envelope: { attackMs: 3, decayMs: 280, sustain: 0.66, releaseMs: 260 } });
  setOperator(config, 1, { enabled: true, ratio: 2, level: 0.56, envelope: { attackMs: 0, decayMs: 210, sustain: 0.22, releaseMs: 140 } });
  setOperator(config, 2, { enabled: true, waveform: "square", ratio: 3, level: 0.28, wavefold: 0.18, envelope: { attackMs: 0, decayMs: 120, sustain: 0, releaseMs: 80 } });
  fm(config, 1, 0, 0.42);
  fm(config, 2, 1, 0.18);
  fm(config, 1, 1, 0.2);
  output(config, 0, AURUM_FILTER_A_BUS, 0.72);
  output(config, 0, AURUM_DIRECT_BUS, 0.18);
  config.filters = [
    { enabled: true, type: "lowpass", cutoff: 0.62, resonance: 0.3, drive: 0.2 },
    { enabled: true, type: "highpass", cutoff: 0.08, resonance: 0.08, drive: 0.04 },
  ];
  config.filterRouting = "serial";
  config.unison = 3;
  config.detuneCents = 12;
  config.stereoSpread = 0.5;
  instrument.mono = true;
  instrument.legato = true;
  instrument.glideMs = 68;
  return instrument;
}

function makePercussion(setId: string) {
  const instrument = makeBase("Aurum_Percussion_01", setId, ["percussion", "pitch-envelope", "transient"]);
  const config = instrument.aurum!;
  setOperator(config, 0, { enabled: true, ratio: 1, level: 0.88, envelope: { attackMs: 0, decayMs: 115, sustain: 0, releaseMs: 75 }, pitchEnvelope: { attackMs: 0, decayMs: 68, sustain: 0, releaseMs: 30 }, pitchEnvelopeSemitones: 18 });
  setOperator(config, 1, { enabled: true, ratio: 3.5, level: 0.72, envelope: { attackMs: 0, decayMs: 42, sustain: 0, releaseMs: 24 } });
  setOperator(config, 2, { enabled: true, waveform: "additive", ratio: 6, level: 0.34, harmonics: harmonicSeries("odd"), envelope: { attackMs: 0, decayMs: 24, sustain: 0, releaseMs: 18 } });
  fm(config, 1, 0, 0.62);
  fm(config, 2, 0, 0.3);
  output(config, 0, AURUM_FILTER_A_BUS, 0.88);
  config.filters[0] = { enabled: true, type: "bandpass", cutoff: 0.64, resonance: 0.34, drive: 0.12 };
  config.oversampling = 4;
  return instrument;
}

function makeOrgan(setId: string) {
  const instrument = makeBase("Aurum_Organ_01", setId, ["organ", "additive", "parallel"]);
  const config = instrument.aurum!;
  const ratios = [0.5, 1, 2, 3, 4, 6];
  const levels = [0.34, 0.62, 0.38, 0.24, 0.16, 0.1];
  for (let index = 0; index < AURUM_OPERATOR_COUNT; index += 1) {
    setOperator(config, index, {
      enabled: true,
      ratio: ratios[index],
      level: levels[index],
      pan: (index - 2.5) * 0.08,
      envelope: { attackMs: 8, decayMs: 0, sustain: 1, releaseMs: 180 },
    });
    output(config, index, AURUM_FILTER_A_BUS, levels[index] * 0.75);
  }
  config.filters[0] = { enabled: true, type: "lowpass", cutoff: 0.88, resonance: 0.08, drive: 0.04 };
  return instrument;
}

function makeFx(setId: string) {
  const instrument = makeBase("Aurum_FX_01", setId, ["fx", "rm", "bipolar", "experimental"]);
  const config = instrument.aurum!;
  setOperator(config, 0, { enabled: true, waveform: "square", ratio: 1, level: 0.62, pan: -0.7, wavefold: 0.52, envelope: { attackMs: 14, decayMs: 760, sustain: 0.38, releaseMs: 980 } });
  setOperator(config, 1, { enabled: true, waveform: "triangle", ratio: 1.414, level: 0.58, pan: 0.7, envelope: { attackMs: 4, decayMs: 520, sustain: 0.22, releaseMs: 720 } });
  setOperator(config, 2, { enabled: true, ratio: 3.17, level: 0.46, phase: 0.25, envelope: { attackMs: 0, decayMs: 380, sustain: 0.12, releaseMs: 440 } });
  setOperator(config, 3, { enabled: true, waveform: "additive", ratio: 0.375, level: 0.36, harmonics: harmonicSeries("odd"), envelope: { attackMs: 80, decayMs: 900, sustain: 0.48, releaseMs: 1200 } });
  fm(config, 2, 1, -0.48);
  fm(config, 3, 3, 0.26);
  rm(config, 1, 0, 0.9);
  rm(config, 2, 0, -0.65);
  output(config, 0, AURUM_FILTER_A_BUS, -0.58);
  output(config, 1, AURUM_FILTER_B_BUS, 0.54);
  output(config, 3, AURUM_DIRECT_BUS, 0.28);
  config.filters = [
    { enabled: true, type: "bandpass", cutoff: 0.52, resonance: 0.42, drive: 0.18 },
    { enabled: true, type: "highpass", cutoff: 0.28, resonance: 0.24, drive: 0.1 },
  ];
  config.filterRouting = "parallel";
  config.unison = 2;
  config.detuneCents = 21;
  config.stereoSpread = 0.72;
  return instrument;
}

function harmonicSeries(kind: "saw" | "odd") {
  return Array.from({ length: 16 }, (_, index) => kind === "odd" && index % 2 === 1 ? 0 : 1 / (index + 1));
}

function cloneOperator(operator: AurumOperatorConfig): AurumOperatorConfig {
  return {
    ...operator,
    envelope: { ...operator.envelope },
    pitchEnvelope: { ...operator.pitchEnvelope },
    phaseEnvelope: { ...operator.phaseEnvelope },
    harmonics: [...operator.harmonics],
    velocityCurve: [...operator.velocityCurve],
    keytrackCurve: [...operator.keytrackCurve],
  };
}
