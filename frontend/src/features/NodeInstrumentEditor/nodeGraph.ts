import type {
  Instrument,
  InstrumentNode,
  InstrumentNodeCable,
  InstrumentNodeGraph,
  InstrumentNodeKind,
  InstrumentNodeParameterValue,
  InstrumentNodePort,
} from "../../state/types";
import {
  createDefaultSynthDraft,
  synthDraftFromInstrument,
  synthDraftToInstrumentPatch,
  type SynthDraftPatch,
  type SynthParameterId,
} from "../../state/synthStore";

export interface NodeParameterSpec {
  id: string;
  label: string;
  kind: "number" | "select" | "boolean";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
}

interface NodeDefinition {
  label: string;
  icon: string;
  inputs: InstrumentNodePort[];
  outputs: InstrumentNodePort[];
  parameters: NodeParameterSpec[];
  defaults: Record<string, InstrumentNodeParameterValue>;
}

const AUDIO_IN: InstrumentNodePort = { id: "audio-in", label: "Audio", kind: "input", signal: "audio" };
const AUDIO_OUT: InstrumentNodePort = { id: "audio-out", label: "Audio", kind: "output", signal: "audio" };

export const NODE_DEFINITIONS: Record<InstrumentNodeKind, NodeDefinition> = {
  oscillator: {
    label: "Oscillator",
    icon: "ph:wave-sine",
    inputs: [
      { id: "pitch", label: "Pitch", kind: "input", signal: "control" },
      { id: "level-cv", label: "Level", kind: "input", signal: "control" },
    ],
    outputs: [AUDIO_OUT],
    parameters: [
      {
        id: "waveform",
        label: "Waveform",
        kind: "select",
        options: [
          { value: "saw", label: "Saw" },
          { value: "sine", label: "Sine" },
          { value: "square", label: "Square" },
          { value: "triangle", label: "Triangle" },
          { value: "wavetable", label: "Wavetable" },
        ],
      },
      { id: "level", label: "Level", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "octave", label: "Octave", kind: "number", min: -3, max: 3, step: 1 },
      { id: "fine", label: "Fine", kind: "number", min: -100, max: 100, step: 1, unit: "ct" },
    ],
    defaults: { waveform: "saw", level: 0.8, octave: 0, fine: 0 },
  },
  noise: {
    label: "Noise",
    icon: "ph:grains",
    inputs: [{ id: "level-cv", label: "Level", kind: "input", signal: "control" }],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "level", label: "Level", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "color", label: "Color", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { level: 0.12, color: 0.45 },
  },
  mixer: {
    label: "Mixer",
    icon: "ph:sliders-horizontal",
    inputs: [
      { id: "in-1", label: "In 1", kind: "input", signal: "audio" },
      { id: "in-2", label: "In 2", kind: "input", signal: "audio" },
      { id: "in-3", label: "In 3", kind: "input", signal: "audio" },
    ],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "level1", label: "Input 1", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "level2", label: "Input 2", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "level3", label: "Input 3", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { level1: 1, level2: 0.55, level3: 0.25 },
  },
  filter: {
    label: "Filter",
    icon: "ph:funnel",
    inputs: [
      AUDIO_IN,
      { id: "cutoff-cv", label: "Cutoff", kind: "input", signal: "control" },
    ],
    outputs: [AUDIO_OUT],
    parameters: [
      {
        id: "type",
        label: "Type",
        kind: "select",
        options: [
          { value: "lowpass", label: "Lowpass" },
          { value: "highpass", label: "Highpass" },
          { value: "bandpass", label: "Bandpass" },
        ],
      },
      { id: "cutoff", label: "Cutoff", kind: "number", min: 20, max: 20000, step: 50, unit: "Hz" },
      { id: "resonance", label: "Resonance", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "drive", label: "Drive", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { type: "lowpass", cutoff: 8400, resonance: 0.18, drive: 0.06 },
  },
  gain: {
    label: "Volume",
    icon: "ph:speaker-high",
    inputs: [
      AUDIO_IN,
      { id: "level-cv", label: "Level", kind: "input", signal: "control" },
      { id: "pan-cv", label: "Pan", kind: "input", signal: "control" },
    ],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "level", label: "Level", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "pan", label: "Pan", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: { level: 0.8, pan: 0 },
  },
  lfo: {
    label: "LFO",
    icon: "ph:pulse",
    inputs: [],
    outputs: [{ id: "cv-out", label: "CV", kind: "output", signal: "control" }],
    parameters: [
      {
        id: "shape",
        label: "Shape",
        kind: "select",
        options: [
          { value: "sine", label: "Sine" },
          { value: "triangle", label: "Triangle" },
          { value: "saw", label: "Saw" },
          { value: "square", label: "Square" },
        ],
      },
      { id: "rate", label: "Rate", kind: "number", min: 0.05, max: 20, step: 0.05, unit: "Hz" },
      { id: "amount", label: "Amount", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: { shape: "sine", rate: 1, amount: 0.25 },
  },
  envelope: {
    label: "Envelope",
    icon: "ph:chart-line",
    inputs: [],
    outputs: [{ id: "cv-out", label: "CV", kind: "output", signal: "control" }],
    parameters: [
      { id: "attack", label: "Attack", kind: "number", min: 0, max: 5, step: 0.005, unit: "s" },
      { id: "decay", label: "Decay", kind: "number", min: 0, max: 5, step: 0.005, unit: "s" },
      { id: "sustain", label: "Sustain", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "release", label: "Release", kind: "number", min: 0, max: 8, step: 0.005, unit: "s" },
    ],
    defaults: { attack: 0.005, decay: 0.16, sustain: 0.78, release: 0.28 },
  },
  output: {
    label: "Instrument Out",
    icon: "ph:waveform",
    inputs: [AUDIO_IN],
    outputs: [],
    parameters: [{ id: "level", label: "Level", kind: "number", min: 0, max: 1, step: 0.01 }],
    defaults: { level: 1 },
  },
};

export function nodeDefinition(kind: InstrumentNodeKind): NodeDefinition {
  return NODE_DEFINITIONS[kind];
}

export function createInstrumentNode(kind: InstrumentNodeKind, x: number, y: number, label?: string): InstrumentNode {
  const definition = NODE_DEFINITIONS[kind];
  return {
    id: makeGraphId(kind),
    kind,
    label: label ?? definition.label,
    x,
    y,
    inputs: structuredClone(definition.inputs),
    outputs: structuredClone(definition.outputs),
    parameters: structuredClone(definition.defaults),
  };
}

export function createDefaultInstrumentNodeGraph(instrument?: Instrument): InstrumentNodeGraph {
  const oscA = createInstrumentNode("oscillator", 120, 120, "Oscillator A");
  const oscB = createInstrumentNode("oscillator", 120, 320, "Oscillator B");
  const lfo = createInstrumentNode("lfo", 120, 540, "LFO 1");
  const envelope = createInstrumentNode("envelope", 410, 540, "Amp Envelope");
  const mixer = createInstrumentNode("mixer", 430, 220);
  const filter = createInstrumentNode("filter", 720, 220);
  const gain = createInstrumentNode("gain", 1010, 220);
  const output = createInstrumentNode("output", 1300, 260);

  if (instrument) {
    oscA.parameters.waveform = waveformFromInstrument(instrument, "a");
    oscA.parameters.level = readNumber(instrument.synthPatch?.parameters["osc.a.level"], instrument.knobs.color, 0.8);
    oscB.parameters.waveform = waveformFromInstrument(instrument, "b");
    oscB.parameters.level = readNumber(instrument.synthPatch?.parameters["osc.b.level"], 0.4, 0.4);
    filter.parameters.type = instrument.filterType ?? "lowpass";
    filter.parameters.cutoff = cutoffFromKnob(instrument.knobs.cutoff);
    filter.parameters.resonance = instrument.knobs.resonance;
    filter.parameters.drive = instrument.knobs.drive;
    gain.parameters.level = instrument.ampLevel ?? 0.8;
    gain.parameters.pan = instrument.ampPan ?? 0;
    envelope.parameters.attack = instrument.envelope.attackMs / 1000;
    envelope.parameters.decay = instrument.envelope.decayMs / 1000;
    envelope.parameters.sustain = instrument.envelope.sustain;
    envelope.parameters.release = instrument.envelope.releaseMs / 1000;
  }

  return {
    schemaVersion: 1,
    nodes: [oscA, oscB, lfo, envelope, mixer, filter, gain, output],
    cables: [
      cable(oscA, "audio-out", mixer, "in-1"),
      cable(oscB, "audio-out", mixer, "in-2"),
      cable(mixer, "audio-out", filter, "audio-in"),
      cable(filter, "audio-out", gain, "audio-in"),
      cable(gain, "audio-out", output, "audio-in"),
      cable(envelope, "cv-out", gain, "level-cv"),
      cable(lfo, "cv-out", filter, "cutoff-cv"),
    ],
  };
}

export function createOutputOnlyInstrumentNodeGraph(): InstrumentNodeGraph {
  return {
    schemaVersion: 1,
    nodes: [createInstrumentNode("output", 760, 320)],
    cables: [],
  };
}

export function normalizeInstrumentNodeGraph(graph: InstrumentNodeGraph | undefined, instrument?: Instrument): InstrumentNodeGraph {
  if (!graph || graph.schemaVersion !== 1 || !Array.isArray(graph.nodes)) {
    return createDefaultInstrumentNodeGraph(instrument);
  }
  const nodeIds = new Set<string>();
  const nodes = graph.nodes
    .filter((node) => NODE_DEFINITIONS[node.kind])
    .map((node) => {
      const definition = NODE_DEFINITIONS[node.kind];
      nodeIds.add(node.id);
      return {
        ...node,
        x: finiteOr(node.x, 120),
        y: finiteOr(node.y, 120),
        inputs: structuredClone(definition.inputs),
        outputs: structuredClone(definition.outputs),
        parameters: { ...structuredClone(definition.defaults), ...(node.parameters ?? {}) },
      };
    });
  const cables = (graph.cables ?? []).filter((item) =>
    nodeIds.has(item.fromNodeId)
      && nodeIds.has(item.toNodeId)
      && Boolean(portFor(nodes, item.fromNodeId, item.fromPortId, "output"))
      && Boolean(portFor(nodes, item.toNodeId, item.toPortId, "input")),
  );
  return { schemaVersion: 1, nodes, cables };
}

export function cableIsValid(graph: InstrumentNodeGraph, cablePatch: Omit<InstrumentNodeCable, "id">): boolean {
  if (cablePatch.fromNodeId === cablePatch.toNodeId) return false;
  const from = portFor(graph.nodes, cablePatch.fromNodeId, cablePatch.fromPortId, "output");
  const to = portFor(graph.nodes, cablePatch.toNodeId, cablePatch.toPortId, "input");
  return Boolean(from && to && from.signal === to.signal);
}

export function compileNodeGraphToInstrumentPatch(graph: InstrumentNodeGraph, instrument: Instrument): Partial<Instrument> {
  const normalized = normalizeInstrumentNodeGraph(graph, instrument);
  const draft = instrument.synthPatch
    ? synthDraftFromInstrument(instrument)
    : createDefaultSynthDraft();
  const audibleNodeIds = upstreamAudioNodeIds(normalized);
  const audibleNodes = normalized.nodes.filter((node) => audibleNodeIds.has(node.id));
  const oscillators = audibleNodes.filter((node) => node.kind === "oscillator");
  applyOscillatorNode(draft, "a", oscillators[0]);
  applyOscillatorNode(draft, "b", oscillators[1]);

  const filter = audibleNodes.find((node) => node.kind === "filter");
  if (filter) {
    draft.parameters["filter.enabled"] = true;
    draft.parameters["filter.type"] = String(filter.parameters.type ?? "lowpass");
    draft.parameters["filter.cutoff"] = numericParameter(filter, "cutoff", 8400);
    draft.parameters["filter.resonance"] = numericParameter(filter, "resonance", 0.18);
    draft.parameters["filter.drive"] = numericParameter(filter, "drive", 0.06);
  } else {
    draft.parameters["filter.enabled"] = false;
  }

  const gain = audibleNodes.find((node) => node.kind === "gain");
  if (gain) {
    draft.parameters["amp.level"] = numericParameter(gain, "level", 0.8);
    draft.parameters["amp.pan"] = numericParameter(gain, "pan", 0);
  } else if (oscillators.length === 0) {
    draft.parameters["amp.level"] = 0;
    draft.parameters["amp.pan"] = 0;
  }

  const controlNodeIds = upstreamControlNodeIds(normalized, audibleNodeIds);
  const controlNodes = normalized.nodes.filter((node) => controlNodeIds.has(node.id));
  const envelope = controlNodes.find((node) => node.kind === "envelope");
  if (envelope) {
    draft.parameters["env.1.attack"] = numericParameter(envelope, "attack", 0.005);
    draft.parameters["env.1.decay"] = numericParameter(envelope, "decay", 0.16);
    draft.parameters["env.1.sustain"] = numericParameter(envelope, "sustain", 0.78);
    draft.parameters["env.1.release"] = numericParameter(envelope, "release", 0.28);
  }

  const lfo = controlNodes.find((node) => node.kind === "lfo");
  if (lfo) {
    draft.parameters["lfo.1.enabled"] = true;
    draft.parameters["lfo.1.shape"] = String(lfo.parameters.shape ?? "sine");
    draft.parameters["lfo.1.rate"] = numericParameter(lfo, "rate", 1);
  } else {
    draft.parameters["lfo.1.enabled"] = false;
  }

  return {
    ...synthDraftToInstrumentPatch({ ...draft, name: instrument.name }),
    nodeGraph: normalized,
  };
}

function upstreamAudioNodeIds(graph: InstrumentNodeGraph): Set<string> {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const reachable = new Set<string>();
  const queue = graph.cables
    .filter((cable) => {
      const target = nodesById.get(cable.toNodeId);
      const port = portFor(graph.nodes, cable.toNodeId, cable.toPortId, "input");
      return target?.kind === "output" && port?.signal === "audio";
    })
    .map((cable) => cable.fromNodeId);

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const cable of graph.cables) {
      if (cable.toNodeId === nodeId) {
        const fromPort = portFor(graph.nodes, cable.fromNodeId, cable.fromPortId, "output");
        const toPort = portFor(graph.nodes, cable.toNodeId, cable.toPortId, "input");
        if (fromPort?.signal === "audio" && toPort?.signal === "audio") queue.push(cable.fromNodeId);
      }
    }
  }

  return reachable;
}

function upstreamControlNodeIds(graph: InstrumentNodeGraph, audibleNodeIds: Set<string>): Set<string> {
  const reachable = new Set<string>();
  const queue = graph.cables
    .filter((cable) => {
      const fromPort = portFor(graph.nodes, cable.fromNodeId, cable.fromPortId, "output");
      const toPort = portFor(graph.nodes, cable.toNodeId, cable.toPortId, "input");
      return audibleNodeIds.has(cable.toNodeId) && fromPort?.signal === "control" && toPort?.signal === "control";
    })
    .map((cable) => cable.fromNodeId);

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const cable of graph.cables) {
      if (cable.toNodeId === nodeId) {
        const fromPort = portFor(graph.nodes, cable.fromNodeId, cable.fromPortId, "output");
        const toPort = portFor(graph.nodes, cable.toNodeId, cable.toPortId, "input");
        if (fromPort?.signal === "control" && toPort?.signal === "control") queue.push(cable.fromNodeId);
      }
    }
  }

  return reachable;
}

function applyOscillatorNode(draft: SynthDraftPatch, id: "a" | "b", node: InstrumentNode | undefined) {
  const prefix = `osc.${id}`;
  if (!node) {
    draft.parameters[`${prefix}.enabled` as SynthParameterId] = false;
    return;
  }
  draft.parameters[`${prefix}.enabled` as SynthParameterId] = true;
  draft.parameters[`${prefix}.wavetable` as SynthParameterId] = wavetableForWaveform(String(node.parameters.waveform ?? "saw"));
  draft.parameters[`${prefix}.level` as SynthParameterId] = numericParameter(node, "level", id === "a" ? 0.8 : 0.45);
  draft.parameters[`${prefix}.octave` as SynthParameterId] = numericParameter(node, "octave", 0);
  draft.parameters[`${prefix}.fine` as SynthParameterId] = numericParameter(node, "fine", 0);
}

function cable(from: InstrumentNode, fromPortId: string, to: InstrumentNode, toPortId: string): InstrumentNodeCable {
  return { id: makeGraphId("cable"), fromNodeId: from.id, fromPortId, toNodeId: to.id, toPortId };
}

function portFor(
  nodes: InstrumentNode[],
  nodeId: string,
  portId: string,
  kind: "input" | "output",
): InstrumentNodePort | undefined {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  const ports = kind === "input" ? node?.inputs : node?.outputs;
  return ports?.find((port) => port.id === portId && port.kind === kind);
}

function numericParameter(node: InstrumentNode, id: string, fallback: number): number {
  return readNumber(node.parameters[id], fallback, fallback);
}

function readNumber(value: unknown, fallback: number, nanFallback: number): number {
  if (typeof value !== "number") return fallback;
  return Number.isFinite(value) ? value : nanFallback;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function waveformFromInstrument(instrument: Instrument, oscillator: "a" | "b"): string {
  const value = instrument.synthPatch?.parameters[`osc.${oscillator}.wavetable`];
  if (typeof value === "string") return value.replace("basic.", "");
  return instrument.waveform === "wavetable" ? "wavetable" : instrument.waveform;
}

function wavetableForWaveform(value: string): string {
  if (value === "wavetable") return "basic.saw";
  if (["sine", "saw", "square", "triangle"].includes(value)) return `basic.${value}`;
  return "basic.saw";
}

function cutoffFromKnob(value: number): number {
  return Math.round(120 + Math.max(0, Math.min(1, value)) * 17880);
}

function makeGraphId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}
