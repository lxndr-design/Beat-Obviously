import {
  AURUM_FILTER_A_BUS,
  AURUM_OPERATOR_COUNT,
  AURUM_OUTPUT_BUS_COUNT,
  AURUM_OUTPUT_COLUMN,
  defaultAurumOperator,
} from "../../state/aurum";
import type { AurumOperatorConfig, AurumSynthConfig } from "../../state/types";

export type AurumAlgorithmTemplateId = "single" | "stack-2" | "stack-3" | "parallel-2" | "branch-4" | "feedback-2" | "six-carriers";

export interface AurumAlgorithmTemplate {
  id: AurumAlgorithmTemplateId;
  label: string;
  description: string;
}

export const AURUM_ALGORITHM_TEMPLATES: AurumAlgorithmTemplate[] = [
  { id: "single", label: "Single carrier", description: "OP 1 to Filter A" },
  { id: "stack-2", label: "2-op stack", description: "OP 2 modulates OP 1" },
  { id: "stack-3", label: "3-op stack", description: "OP 3 into OP 2 into OP 1" },
  { id: "parallel-2", label: "Dual carriers", description: "OP 1 and OP 2 in parallel" },
  { id: "branch-4", label: "Dual branches", description: "Two modulator-carrier pairs" },
  { id: "feedback-2", label: "Feedback pair", description: "2-op stack with OP 2 feedback" },
  { id: "six-carriers", label: "Six carriers", description: "All operators in parallel" },
];

type FmRoute = readonly [source: number, target: number, depth: number];
type OutputRoute = readonly [source: number, bus: number, depth: number];

const TEMPLATE_ROUTING: Record<AurumAlgorithmTemplateId, { active: number[]; fm: FmRoute[]; output: OutputRoute[] }> = {
  single: { active: [0], fm: [], output: [[0, AURUM_FILTER_A_BUS, 0.86]] },
  "stack-2": { active: [0, 1], fm: [[1, 0, 0.42]], output: [[0, AURUM_FILTER_A_BUS, 0.86]] },
  "stack-3": { active: [0, 1, 2], fm: [[2, 1, 0.42], [1, 0, 0.42]], output: [[0, AURUM_FILTER_A_BUS, 0.86]] },
  "parallel-2": { active: [0, 1], fm: [], output: [[0, AURUM_FILTER_A_BUS, 0.62], [1, AURUM_FILTER_A_BUS, 0.62]] },
  "branch-4": { active: [0, 1, 2, 3], fm: [[2, 0, 0.42], [3, 1, 0.42]], output: [[0, AURUM_FILTER_A_BUS, 0.56], [1, AURUM_FILTER_A_BUS, 0.56]] },
  "feedback-2": { active: [0, 1], fm: [[1, 0, 0.42], [1, 1, 0.18]], output: [[0, AURUM_FILTER_A_BUS, 0.86]] },
  "six-carriers": { active: [0, 1, 2, 3, 4, 5], fm: [], output: Array.from({ length: AURUM_OPERATOR_COUNT }, (_, source) => [source, AURUM_FILTER_A_BUS, 0.3] as const) },
};

export function copyAurumOperator(operator: AurumOperatorConfig): AurumOperatorConfig {
  return cloneOperator(operator);
}

export function pasteAurumOperator(config: AurumSynthConfig, index: number, copied: AurumOperatorConfig): AurumSynthConfig {
  const target = config.operators[index];
  if (!target) return config;
  return replaceOperator(config, index, operatorForSlot(copied, target));
}

export function initializeAurumOperator(config: AurumSynthConfig, index: number): AurumSynthConfig {
  const target = config.operators[index];
  if (!target) return config;
  return replaceOperator(config, index, operatorForSlot(defaultAurumOperator(index), target));
}

export function resetAurumOperator(config: AurumSynthConfig, index: number): AurumSynthConfig {
  if (!config.operators[index]) return config;
  const initialized = initializeAurumOperator(config, index);
  return {
    ...initialized,
    matrix: initialized.matrix.map((row, source) => row.map((value, target) => source === index || target === index ? 0 : value)),
    rmMatrix: initialized.rmMatrix.map((row, source) => row.map((value, target) => source === index || target === index ? 0 : value)),
    outputSends: initialized.outputSends.map((row, source) => source === index ? Array(AURUM_OUTPUT_BUS_COUNT).fill(0) : [...row]),
  };
}

export function swapAurumOperators(config: AurumSynthConfig, left: number, right: number): AurumSynthConfig {
  if (left === right || !config.operators[left] || !config.operators[right]) return config;
  const operators = config.operators.map(cloneOperator);
  const leftIdentity = operators[left];
  const rightIdentity = operators[right];
  operators[left] = operatorForSlot(config.operators[right], leftIdentity);
  operators[right] = operatorForSlot(config.operators[left], rightIdentity);
  return {
    ...config,
    operators,
    matrix: swapMatrixAxes(config.matrix, left, right),
    rmMatrix: swapMatrixAxes(config.rmMatrix, left, right),
    outputSends: swapRows(config.outputSends, left, right),
  };
}

export function applyAurumAlgorithmTemplate(config: AurumSynthConfig, id: AurumAlgorithmTemplateId): AurumSynthConfig {
  const template = TEMPLATE_ROUTING[id];
  const active = new Set(template.active);
  const matrix = Array.from({ length: AURUM_OPERATOR_COUNT }, () => Array(AURUM_OPERATOR_COUNT + 1).fill(0));
  const rmMatrix = Array.from({ length: AURUM_OPERATOR_COUNT }, () => Array(AURUM_OPERATOR_COUNT).fill(0));
  const outputSends = Array.from({ length: AURUM_OPERATOR_COUNT }, () => Array(AURUM_OUTPUT_BUS_COUNT).fill(0));
  for (const [source, target, depth] of template.fm) matrix[source][target] = depth;
  for (const [source, bus, depth] of template.output) {
    outputSends[source][bus] = depth;
    if (bus === AURUM_FILTER_A_BUS) matrix[source][AURUM_OUTPUT_COLUMN] = depth;
  }
  return {
    ...config,
    operators: config.operators.map((operator, index) => ({ ...cloneOperator(operator), enabled: active.has(index) })),
    matrix,
    rmMatrix,
    outputSends,
  };
}

function replaceOperator(config: AurumSynthConfig, index: number, operator: AurumOperatorConfig): AurumSynthConfig {
  return { ...config, operators: config.operators.map((candidate, candidateIndex) => candidateIndex === index ? operator : cloneOperator(candidate)) };
}

function operatorForSlot(source: AurumOperatorConfig, target: AurumOperatorConfig) {
  return { ...cloneOperator(source), id: target.id, name: target.name };
}

function cloneOperator(operator: AurumOperatorConfig): AurumOperatorConfig {
  return {
    ...operator,
    harmonics: [...operator.harmonics],
    envelope: { ...operator.envelope },
    pitchEnvelope: { ...operator.pitchEnvelope },
    phaseEnvelope: { ...operator.phaseEnvelope },
    velocityCurve: [...operator.velocityCurve],
    keytrackCurve: [...operator.keytrackCurve],
  };
}

function swapRows(matrix: number[][], left: number, right: number) {
  const rows = matrix.map((row) => [...row]);
  [rows[left], rows[right]] = [rows[right], rows[left]];
  return rows;
}

function swapMatrixAxes(matrix: number[][], left: number, right: number) {
  const rows = swapRows(matrix, left, right);
  return rows.map((row) => {
    const next = [...row];
    [next[left], next[right]] = [next[right], next[left]];
    return next;
  });
}
