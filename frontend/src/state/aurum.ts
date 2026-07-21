import type { AurumOperatorConfig, AurumSynthConfig, Instrument } from "./types";

export const AURUM_OPERATOR_COUNT = 6;
export const AURUM_OUTPUT_COLUMN = AURUM_OPERATOR_COUNT;
export const AURUM_HARMONIC_COUNT = 16;

function defaultOperator(index: number): AurumOperatorConfig {
  return {
    id: `op-${index + 1}`,
    name: `OP ${index + 1}`,
    enabled: index < 2,
    waveform: "sine",
    ratio: index === 1 ? 2 : 1,
    coarse: 0,
    fineCents: 0,
    level: index === 0 ? 0.78 : 0.55,
    phase: 0,
    harmonics: Array.from({ length: AURUM_HARMONIC_COUNT }, (_, harmonic) => harmonic === 0 ? 1 : 0),
    envelope: {
      attackMs: index === 1 ? 2 : 5,
      decayMs: index === 1 ? 420 : 900,
      sustain: index === 1 ? 0 : 0.72,
      releaseMs: index === 1 ? 180 : 360,
    },
  };
}

export function defaultAurumConfig(): AurumSynthConfig {
  const matrix = Array.from({ length: AURUM_OPERATOR_COUNT }, () => Array(AURUM_OPERATOR_COUNT + 1).fill(0));
  const rmMatrix = Array.from({ length: AURUM_OPERATOR_COUNT }, () => Array(AURUM_OPERATOR_COUNT).fill(0));
  matrix[0][AURUM_OUTPUT_COLUMN] = 0.86;
  matrix[1][0] = 0.42;
  return {
    version: 3,
    operators: Array.from({ length: AURUM_OPERATOR_COUNT }, (_, index) => defaultOperator(index)),
    matrix,
    rmMatrix,
    unison: 1,
    detuneCents: 8,
    stereoSpread: 0.35,
  };
}

export function createAurumInstrument(id: string, name = "Aurum Patch"): Instrument {
  return {
    id,
    name,
    icon: "ph:circles-three-plus",
    kind: "synth",
    waveform: "sine",
    envelope: { attackMs: 5, decayMs: 900, sustain: 0.72, releaseMs: 360 },
    knobs: { cutoff: 0.78, resonance: 0.12, drive: 0.08, color: 0.5 },
    filterType: "lowpass",
    detuneCents: 0,
    octave: 0,
    subOscLevel: 0,
    glideMs: 0,
    maxVoices: 16,
    mono: false,
    legato: false,
    ampLevel: 0.82,
    ampPan: 0,
    aurum: defaultAurumConfig(),
    sampleIds: [],
    source: { kind: "created", label: "Made in Beat / Aurum" },
    descriptors: ["fm", "operator", "digital"],
    userCreated: true,
  };
}

export function normalizedAurumConfig(config: AurumSynthConfig | undefined): AurumSynthConfig {
  const fallback = defaultAurumConfig();
  if (!config) return fallback;
  return {
    ...fallback,
    ...config,
    version: 3,
    operators: fallback.operators.map((operator, index) => {
      const incoming = config.operators?.[index];
      return {
        ...operator,
        ...incoming,
        envelope: { ...operator.envelope, ...incoming?.envelope },
        harmonics: operator.harmonics.map((value, harmonic) => clamp01(incoming?.harmonics?.[harmonic] ?? value)),
      };
    }),
    matrix: fallback.matrix.map((row, source) => row.map((value, target) => clampBipolar(config.matrix[source]?.[target] ?? value))),
    rmMatrix: fallback.rmMatrix.map((row, source) => row.map((value, target) => clampBipolar(config.rmMatrix?.[source]?.[target] ?? value))),
  };
}

function clampBipolar(value: number) {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function drawAurumHarmonicLine(
  harmonics: number[],
  fromIndex: number,
  fromValue: number,
  toIndex: number,
  toValue: number,
) {
  const next = Array.from({ length: AURUM_HARMONIC_COUNT }, (_, index) => clamp01(harmonics[index] ?? 0));
  const start = Math.max(0, Math.min(AURUM_HARMONIC_COUNT - 1, Math.round(fromIndex)));
  const end = Math.max(0, Math.min(AURUM_HARMONIC_COUNT - 1, Math.round(toIndex)));
  const direction = start <= end ? 1 : -1;
  const distance = Math.max(1, Math.abs(end - start));
  for (let index = start; direction > 0 ? index <= end : index >= end; index += direction) {
    const t = Math.abs(index - start) / distance;
    next[index] = clamp01(fromValue + (toValue - fromValue) * t);
  }
  return next;
}
