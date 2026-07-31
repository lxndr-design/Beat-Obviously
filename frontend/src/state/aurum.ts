import type { AurumFilterConfig, AurumOperatorConfig, AurumSynthConfig, Instrument, ModulationRemapCurve, SharedModulationRoute } from "./types";

export const AURUM_OPERATOR_COUNT = 6;
export const AURUM_OUTPUT_COLUMN = AURUM_OPERATOR_COUNT;
export const AURUM_OUTPUT_BUS_COUNT = 3;
export const AURUM_FILTER_A_BUS = 0;
export const AURUM_FILTER_B_BUS = 1;
export const AURUM_DIRECT_BUS = 2;
export const AURUM_HARMONIC_COUNT = 16;
export const AURUM_RESPONSE_CURVE_POINT_COUNT = 5;
export const AURUM_MODULATION_MAX_ROUTES = 8;
export const AURUM_MODULATION_SOURCES = ["lfo.1", "env.1", "macro.1", "macro.2", "velocity", "keytrack", "modWheel", "pressure"] as const;
export const AURUM_V11_MODULATION_TARGETS = ["amp.level", "amp.pan"] as const;
export const AURUM_V12_MODULATION_TARGETS = [
  ...AURUM_V11_MODULATION_TARGETS,
  ...Array.from({ length: AURUM_OPERATOR_COUNT }, (_, index) => [
    `aurum.op.${index + 1}.level`,
    `aurum.op.${index + 1}.pan`,
  ]).flat(),
  "aurum.filter.a.cutoff",
  "aurum.filter.b.cutoff",
] as const;
export const AURUM_OPERATOR_MODULATION_TARGETS = Array.from({ length: AURUM_OPERATOR_COUNT }, (_, index) => [
  `aurum.op.${index + 1}.level`,
  `aurum.op.${index + 1}.pan`,
]).flat();
export const AURUM_FILTER_MODULATION_TARGETS = [
  "aurum.filter.a.cutoff", "aurum.filter.a.resonance", "aurum.filter.a.drive",
  "aurum.filter.b.cutoff", "aurum.filter.b.resonance", "aurum.filter.b.drive",
] as const;
export const AURUM_MODULATION_TARGETS: readonly string[] = [
  ...AURUM_V11_MODULATION_TARGETS,
  ...AURUM_OPERATOR_MODULATION_TARGETS,
  ...AURUM_FILTER_MODULATION_TARGETS,
];

export function aurumOperatorModulationTarget(index: number, parameter: "level" | "pan") {
  return `aurum.op.${Math.max(0, Math.min(AURUM_OPERATOR_COUNT - 1, Math.trunc(index))) + 1}.${parameter}`;
}

export function aurumFilterCutoffModulationTarget(index: number) {
  return `aurum.filter.${index <= 0 ? "a" : "b"}.cutoff`;
}

export function aurumFilterModulationTarget(index: number, parameter: "cutoff" | "resonance" | "drive") {
  return `aurum.filter.${index <= 0 ? "a" : "b"}.${parameter}`;
}

export function aurumModulationTargetLabel(target: string) {
  const operator = /^aurum\.op\.([1-6])\.(level|pan)$/.exec(target);
  if (operator) return `OP ${operator[1]} ${operator[2] === "level" ? "Level" : "Pan"}`;
  const filter = /^aurum\.filter\.([ab])\.(cutoff|resonance|drive)$/.exec(target);
  if (filter) return `Filter ${filter[1].toUpperCase()} ${filter[2][0].toUpperCase()}${filter[2].slice(1)}`;
  return target;
}

type AurumLegacyFilter = Pick<AurumFilterConfig, "type" | "cutoff" | "resonance" | "drive">;

const DEFAULT_FILTER_A: AurumFilterConfig = {
  enabled: true,
  type: "lowpass",
  cutoff: 0.78,
  resonance: 0.12,
  drive: 0.08,
};

const DEFAULT_FILTER_B: AurumFilterConfig = {
  enabled: false,
  type: "highpass",
  cutoff: 0.18,
  resonance: 0.08,
  drive: 0,
};

export function defaultAurumOperator(index: number): AurumOperatorConfig {
  return {
    id: `op-${index + 1}`,
    name: `OP ${index + 1}`,
    enabled: index < 2,
    waveform: "sine",
    ratio: index === 1 ? 2 : 1,
    coarse: 0,
    fineCents: 0,
    level: index === 0 ? 0.78 : 0.55,
    pan: 0,
    phase: 0,
    wavefold: 0,
    harmonics: Array.from({ length: AURUM_HARMONIC_COUNT }, (_, harmonic) => harmonic === 0 ? 1 : 0),
    envelope: {
      attackMs: index === 1 ? 2 : 5,
      decayMs: index === 1 ? 420 : 900,
      sustain: index === 1 ? 0 : 0.72,
      releaseMs: index === 1 ? 180 : 360,
    },
    pitchEnvelope: { attackMs: 0, decayMs: 250, sustain: 0, releaseMs: 120 },
    pitchEnvelopeSemitones: 0,
    phaseEnvelope: { attackMs: 0, decayMs: 180, sustain: 0, releaseMs: 100 },
    phaseEnvelopeDegrees: 0,
    velocityCurve: Array(AURUM_RESPONSE_CURVE_POINT_COUNT).fill(1),
    keytrackCurve: Array(AURUM_RESPONSE_CURVE_POINT_COUNT).fill(1),
  };
}

export function defaultAurumConfig(): AurumSynthConfig {
  const matrix = Array.from({ length: AURUM_OPERATOR_COUNT }, () => Array(AURUM_OPERATOR_COUNT + 1).fill(0));
  const rmMatrix = Array.from({ length: AURUM_OPERATOR_COUNT }, () => Array(AURUM_OPERATOR_COUNT).fill(0));
  matrix[0][AURUM_OUTPUT_COLUMN] = 0.86;
  matrix[1][0] = 0.42;
  return {
    version: 13,
    operators: Array.from({ length: AURUM_OPERATOR_COUNT }, (_, index) => defaultAurumOperator(index)),
    matrix,
    rmMatrix,
    unison: 1,
    detuneCents: 8,
    stereoSpread: 0.35,
    oversampling: 2,
    filters: [{ ...DEFAULT_FILTER_A }, { ...DEFAULT_FILTER_B }],
    filterRouting: "serial",
    outputSends: matrix.map((row) => [row[AURUM_OUTPUT_COLUMN], 0, 0]),
    modulation: [],
    macroValues: Array(8).fill(0),
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
    pitchBendRangeSemitones: 2,
    ampLevel: 0.82,
    ampPan: 0,
    aurum: defaultAurumConfig(),
    sampleIds: [],
    source: { kind: "created", label: "Made in Beat / Aurum" },
    descriptors: ["fm", "operator", "digital"],
    userCreated: true,
  };
}

export function normalizedAurumConfig(config: AurumSynthConfig | undefined, legacyFilter?: AurumLegacyFilter): AurumSynthConfig {
  const fallback = defaultAurumConfig();
  if (!config) return fallback;
  const incomingVersion = config.version as number;
  const legacyFilterA = legacyFilter ? { enabled: true, ...legacyFilter } : fallback.filters[0];
  const incomingFilters = incomingVersion >= 8 ? config.filters : undefined;
  return {
    ...fallback,
    ...config,
    version: 13,
    operators: fallback.operators.map((operator, index) => {
      const incoming = config.operators?.[index];
      return {
        ...operator,
        ...incoming,
        pan: clampBipolar(incoming?.pan ?? operator.pan),
        wavefold: clamp01(incoming?.wavefold ?? operator.wavefold),
        envelope: { ...operator.envelope, ...incoming?.envelope },
        pitchEnvelope: { ...operator.pitchEnvelope, ...incoming?.pitchEnvelope },
        pitchEnvelopeSemitones: clampRange(incoming?.pitchEnvelopeSemitones ?? operator.pitchEnvelopeSemitones, -48, 48),
        phaseEnvelope: { ...operator.phaseEnvelope, ...incoming?.phaseEnvelope },
        phaseEnvelopeDegrees: clampRange(incoming?.phaseEnvelopeDegrees ?? operator.phaseEnvelopeDegrees, -180, 180),
        velocityCurve: normalizeResponseCurve(incoming?.velocityCurve, operator.velocityCurve),
        keytrackCurve: normalizeResponseCurve(incoming?.keytrackCurve, operator.keytrackCurve),
        harmonics: operator.harmonics.map((value, harmonic) => clamp01(incoming?.harmonics?.[harmonic] ?? value)),
      };
    }),
    matrix: fallback.matrix.map((row, source) => row.map((value, target) => clampBipolar(config.matrix[source]?.[target] ?? value))),
    rmMatrix: fallback.rmMatrix.map((row, source) => row.map((value, target) => clampBipolar(config.rmMatrix?.[source]?.[target] ?? value))),
    oversampling: normalizeOversampling(config.oversampling ?? ((config.version as number) >= 7 ? fallback.oversampling : 1)),
    filters: [
      normalizeFilter(incomingFilters?.[0], legacyFilterA),
      normalizeFilter(incomingFilters?.[1], fallback.filters[1]),
    ],
    filterRouting: config.filterRouting === "parallel" ? "parallel" : "serial",
    outputSends: fallback.outputSends.map((row, source) => row.map((value, bus) => clampBipolar(
      incomingVersion >= 9
        ? config.outputSends?.[source]?.[bus] ?? value
        : bus === AURUM_FILTER_A_BUS || (bus === AURUM_FILTER_B_BUS && config.filterRouting === "parallel")
          ? config.matrix?.[source]?.[AURUM_OUTPUT_COLUMN] ?? value
          : 0,
    ))),
    modulation: normalizeAurumModulationRoutes(
      incomingVersion >= 11 ? config.modulation : [],
      incomingVersion >= 13
        ? AURUM_MODULATION_TARGETS
        : incomingVersion >= 12
          ? AURUM_V12_MODULATION_TARGETS
          : AURUM_V11_MODULATION_TARGETS,
    ),
    macroValues: Array.from({ length: 8 }, (_, index) => clamp01(incomingVersion >= 11 ? config.macroValues?.[index] ?? 0 : 0)),
  };
}

export function normalizeAurumModulationRoutes(
  routes: SharedModulationRoute[] | undefined,
  allowedTargets: readonly string[] = AURUM_MODULATION_TARGETS,
): SharedModulationRoute[] {
  const ids = new Set<string>();
  const normalized: SharedModulationRoute[] = [];
  for (const route of Array.isArray(routes) ? routes : []) {
    if (!route || typeof route !== "object" || normalized.length >= AURUM_MODULATION_MAX_ROUTES) continue;
    const source = AURUM_MODULATION_SOURCES.includes(route.source as typeof AURUM_MODULATION_SOURCES[number]) ? route.source : null;
    const target = allowedTargets.includes(route.target) ? route.target : null;
    const id = typeof route.id === "string" ? route.id.trim().slice(0, 64) : "";
    if (!source || !target || !id || ids.has(id)) continue;
    ids.add(id);
    normalized.push({
      id,
      source,
      target,
      amount: clampBipolar(route.amount),
      bipolar: Boolean(route.bipolar),
      enabled: route.enabled !== false,
      curve: normalizeModulationRemapCurve(route.curve),
    });
  }
  return normalized;
}

function normalizeModulationRemapCurve(curve: unknown): ModulationRemapCurve {
  return curve === "ease-in" || curve === "ease-out" || curve === "s-curve" ? curve : "linear";
}

export function normalizedAurumConfigForInstrument(instrument: Instrument): AurumSynthConfig {
  return normalizedAurumConfig(instrument.aurum, {
    type: instrument.filterType ?? "lowpass",
    cutoff: instrument.knobs.cutoff,
    resonance: instrument.knobs.resonance,
    drive: instrument.knobs.drive,
  });
}

function normalizeFilter(filter: AurumFilterConfig | undefined, fallback: AurumFilterConfig): AurumFilterConfig {
  const type = filter?.type ?? fallback.type;
  return {
    enabled: filter?.enabled ?? fallback.enabled,
    type: type === "bandpass" || type === "highpass" ? type : "lowpass",
    cutoff: clamp01(filter?.cutoff ?? fallback.cutoff),
    resonance: clamp01(filter?.resonance ?? fallback.resonance),
    drive: clamp01(filter?.drive ?? fallback.drive),
  };
}

function normalizeOversampling(value: number): 1 | 2 | 4 {
  return value >= 4 ? 4 : value >= 2 ? 2 : 1;
}

function normalizeResponseCurve(values: number[] | undefined, fallback: number[]) {
  return Array.from({ length: AURUM_RESPONSE_CURVE_POINT_COUNT }, (_, index) => clamp01(values?.[index] ?? fallback[index] ?? 1));
}

export function evaluateAurumResponseCurve(values: number[], input: number) {
  const curve = normalizeResponseCurve(values, Array(AURUM_RESPONSE_CURVE_POINT_COUNT).fill(1));
  const position = clamp01(input) * (AURUM_RESPONSE_CURVE_POINT_COUNT - 1);
  const lower = Math.floor(position);
  const upper = Math.min(AURUM_RESPONSE_CURVE_POINT_COUNT - 1, lower + 1);
  const mix = position - lower;
  return curve[lower] + (curve[upper] - curve[lower]) * mix;
}

function clampBipolar(value: number) {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clampRange(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
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
