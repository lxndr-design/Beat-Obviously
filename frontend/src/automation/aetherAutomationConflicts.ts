import type { MidiAutomationTarget } from "../state/types";

export type AetherAutomationConflictSourceKind =
  | "live"
  | "project"
  | "track"
  | "segment"
  | "note"
  | "macro";

export type AetherAutomationConflictOperation = "baseline" | "write" | "add";

export interface AetherAutomationConflictSource {
  kind: AetherAutomationConflictSourceKind;
  target: MidiAutomationTarget;
  label?: string;
  value?: number;
  active?: boolean;
  operation?: AetherAutomationConflictOperation;
}

export interface AetherAutomationConflictLayer extends Required<Omit<AetherAutomationConflictSource, "value">> {
  value?: number;
  priority: number;
}

export interface AetherAutomationConflictReport {
  target: MidiAutomationTarget;
  activeSources: AetherAutomationConflictLayer[];
  winner: AetherAutomationConflictLayer | null;
  suppressed: AetherAutomationConflictLayer[];
  additive: AetherAutomationConflictLayer[];
  summary: string;
  hasConflict: boolean;
}

export const AETHER_AUTOMATION_PRECEDENCE: Record<AetherAutomationConflictSourceKind, number> = {
  live: 0,
  project: 10,
  track: 20,
  segment: 30,
  note: 40,
  macro: 50,
};

const SOURCE_LABELS: Record<AetherAutomationConflictSourceKind, string> = {
  live: "Live knob",
  project: "Project lane",
  track: "Track lane",
  segment: "Segment lane",
  note: "Note lane",
  macro: "Macro route",
};

export function aetherAutomationPrecedenceOrder(): AetherAutomationConflictSourceKind[] {
  return ["live", "project", "track", "segment", "note", "macro"];
}

export function aetherAutomationConflictReport(
  target: MidiAutomationTarget,
  sources: AetherAutomationConflictSource[],
): AetherAutomationConflictReport {
  const activeSources = sources
    .filter((source) => source.target === target && source.active !== false)
    .map((source) => normalizeSource(source));
  const additive = activeSources.filter((source) => source.operation === "add");
  const writers = activeSources.filter((source) => source.operation !== "add");
  const winner = writers.reduce<AetherAutomationConflictLayer | null>((best, source) => {
    if (!best) return source;
    return source.priority >= best.priority ? source : best;
  }, null);
  const suppressed = winner ? writers.filter((source) => source !== winner) : [];
  const hasConflict = suppressed.length > 0 || additive.length > 1 || (Boolean(winner) && additive.length > 0);

  return {
    target,
    activeSources,
    winner,
    suppressed,
    additive,
    summary: summarizeConflict(target, winner, suppressed, additive),
    hasConflict,
  };
}

function normalizeSource(source: AetherAutomationConflictSource): AetherAutomationConflictLayer {
  const operation = source.operation ?? defaultOperation(source.kind);
  return {
    kind: source.kind,
    target: source.target,
    label: source.label?.trim() || SOURCE_LABELS[source.kind],
    active: source.active ?? true,
    operation,
    value: source.value,
    priority: operation === "add" ? AETHER_AUTOMATION_PRECEDENCE.macro : AETHER_AUTOMATION_PRECEDENCE[source.kind],
  };
}

function defaultOperation(kind: AetherAutomationConflictSourceKind): AetherAutomationConflictOperation {
  if (kind === "macro") return "add";
  if (kind === "live") return "baseline";
  return "write";
}

function summarizeConflict(
  target: MidiAutomationTarget,
  winner: AetherAutomationConflictLayer | null,
  suppressed: AetherAutomationConflictLayer[],
  additive: AetherAutomationConflictLayer[],
): string {
  if (!winner && additive.length === 0) return `${target}: no active automation`;
  if (!winner) return `${target}: ${additive.length} modulation route${additive.length === 1 ? "" : "s"} sum`;

  const suppressedLabel = suppressed.length > 0
    ? ` over ${suppressed.map((source) => source.label).join(", ")}`
    : "";
  const additiveLabel = additive.length > 0
    ? ` + ${additive.length} macro route${additive.length === 1 ? "" : "s"}`
    : "";
  return `${target}: ${winner.label} wins${suppressedLabel}${additiveLabel}`;
}
