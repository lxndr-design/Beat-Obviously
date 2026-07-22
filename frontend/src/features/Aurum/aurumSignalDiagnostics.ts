import type { AurumSynthConfig } from "../../state/types";
import { AURUM_DIRECT_BUS, AURUM_FILTER_A_BUS, AURUM_FILTER_B_BUS, AURUM_OPERATOR_COUNT } from "../../state/aurum";

const ACTIVE_THRESHOLD = 0.001;

export type AurumOperatorSignalState = "carrier" | "modulator" | "disconnected" | "silent" | "disabled";

export interface AurumOperatorSignalDiagnostic {
  state: AurumOperatorSignalState;
  outputBuses: number[];
  targets: number[];
}

export interface AurumSignalDiagnostics {
  operators: AurumOperatorSignalDiagnostic[];
  activeBuses: boolean[];
  activeOperatorCount: number;
  disconnectedOperatorCount: number;
  silent: boolean;
}

export function analyzeAurumSignalFlow(config: AurumSynthConfig): AurumSignalDiagnostics {
  const signalEnabled = config.operators.map((operator) => operator.enabled && operator.level > ACTIVE_THRESHOLD);
  const outputBuses = config.operators.map((_, source) => [AURUM_FILTER_A_BUS, AURUM_FILTER_B_BUS, AURUM_DIRECT_BUS]
    .filter((bus) => signalEnabled[source] && Math.abs(config.outputSends[source]?.[bus] ?? 0) > ACTIVE_THRESHOLD));
  const targets = config.operators.map((_, source) => Array.from({ length: AURUM_OPERATOR_COUNT }, (__, target) => target)
    .filter((target) => signalEnabled[source]
      && signalEnabled[target]
      && (Math.abs(config.matrix[source]?.[target] ?? 0) > ACTIVE_THRESHOLD
        || Math.abs(config.rmMatrix[source]?.[target] ?? 0) > ACTIVE_THRESHOLD)));

  const reachesOutput = outputBuses.map((buses) => buses.length > 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (let source = 0; source < AURUM_OPERATOR_COUNT; source += 1) {
      if (reachesOutput[source] || !signalEnabled[source]) continue;
      if (targets[source].some((target) => reachesOutput[target])) {
        reachesOutput[source] = true;
        changed = true;
      }
    }
  }

  const operators = config.operators.map((operator, index): AurumOperatorSignalDiagnostic => ({
    outputBuses: outputBuses[index],
    targets: targets[index],
    state: !operator.enabled
      ? "disabled"
      : operator.level <= ACTIVE_THRESHOLD
        ? "silent"
        : outputBuses[index].length > 0
          ? "carrier"
          : reachesOutput[index]
            ? "modulator"
            : "disconnected",
  }));
  const activeBuses = [AURUM_FILTER_A_BUS, AURUM_FILTER_B_BUS, AURUM_DIRECT_BUS]
    .map((bus) => outputBuses.some((buses) => buses.includes(bus)));

  return {
    operators,
    activeBuses,
    activeOperatorCount: operators.filter((operator) => operator.state === "carrier" || operator.state === "modulator").length,
    disconnectedOperatorCount: operators.filter((operator) => operator.state === "disconnected" || operator.state === "silent").length,
    silent: !activeBuses.some(Boolean),
  };
}
