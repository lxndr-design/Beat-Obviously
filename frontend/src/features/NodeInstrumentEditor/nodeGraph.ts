import type {
  Instrument,
  InstrumentNode,
  InstrumentNodeCable,
  InstrumentNodeGraph,
  InstrumentNodeKind,
  InstrumentNodeParameterValue,
  InstrumentNodePort,
  TrackEffect,
} from "../../state/types";
import { normalizeTrackEffectChain } from "../../state/effects";
import {
  createDefaultSynthDraft,
  type ModulationSourceId,
  type ModulationTargetId,
  synthDraftFromInstrument,
  synthDraftToInstrumentPatch,
  type SynthModulationRoute,
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

export interface NodeGraphIssue {
  id: string;
  message: string;
  nodeId?: string;
}

export type NodeBrowserGroupId = "synth" | "effects" | "modulation" | "utility";

export interface NodeBrowserGroup {
  id: NodeBrowserGroupId;
  label: string;
  nodeKinds: InstrumentNodeKind[];
}

export type NodeGraphTemplateId = "basic-oscillator" | "filtered-mono" | "moving-texture" | "snare-hit" | "tom-hit" | "crash-hit";

export interface NodeGraphTemplate {
  id: NodeGraphTemplateId;
  label: string;
  description: string;
}

interface NodeDefinition {
  label: string;
  icon: string;
  description: string;
  inputs: InstrumentNodePort[];
  outputs: InstrumentNodePort[];
  parameters: NodeParameterSpec[];
  defaults: Record<string, InstrumentNodeParameterValue>;
}

const AUDIO_IN: InstrumentNodePort = { id: "audio-in", label: "Audio", kind: "input", signal: "audio" };
const SUM_AUDIO_IN: InstrumentNodePort = { id: "audio-in", label: "Audio", kind: "input", signal: "audio", acceptsMultiple: true };
const MIXER_INPUTS: InstrumentNodePort[] = [
  { id: "in-1", label: "In 1", kind: "input", signal: "audio", acceptsMultiple: true },
  { id: "in-2", label: "In 2", kind: "input", signal: "audio", acceptsMultiple: true },
  { id: "in-3", label: "In 3", kind: "input", signal: "audio", acceptsMultiple: true },
];
const AUDIO_OUT: InstrumentNodePort = { id: "audio-out", label: "Audio", kind: "output", signal: "audio" };

export const NODE_DEFINITIONS: Record<InstrumentNodeKind, NodeDefinition> = {
  instrument: {
    label: "Instrument",
    icon: "ph:piano-keys",
    description: "Uses the existing instrument patch as a sound source, then lets the graph reshape it before Instrument Out.",
    inputs: [
      { id: "pitch", label: "Pitch", kind: "input", signal: "control" },
      { id: "level-cv", label: "Level", kind: "input", signal: "control" },
    ],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "level", label: "Level", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "octave", label: "Octave", kind: "number", min: -3, max: 3, step: 1 },
      { id: "fine", label: "Fine", kind: "number", min: -100, max: 100, step: 1, unit: "ct" },
      { id: "pitchCvAmount", label: "Pitch CV", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "levelCvAmount", label: "Level CV", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: { level: 0.8, octave: 0, fine: 0, pitchCvAmount: 1, levelCvAmount: 1 },
  },
  oscillator: {
    label: "Oscillator",
    icon: "ph:wave-sine",
    description: "A pitched oscillator. Connect audio to Mixer, Filter, Volume, or Instrument Out. Pitch and Level accept CV sources.",
    inputs: [
      { id: "pitch", label: "Pitch", kind: "input", signal: "control" },
      { id: "level-cv", label: "Level", kind: "input", signal: "control" },
      { id: "position-cv", label: "Position", kind: "input", signal: "control" },
      { id: "pan-cv", label: "Pan", kind: "input", signal: "control" },
    ],
    outputs: [AUDIO_OUT],
    parameters: [
      {
        id: "wavetable",
        label: "Shape",
        kind: "select",
        options: [
          { value: "basic.saw", label: "Saw" },
          { value: "basic.sine", label: "Sine" },
          { value: "basic.square", label: "Square" },
          { value: "basic.triangle", label: "Triangle" },
          { value: "basic.pulse", label: "Pulse" },
        ],
      },
      {
        id: "warpMode",
        label: "Warp Mode",
        kind: "select",
        options: [
          { value: "shape", label: "Shape" },
          { value: "fold", label: "Fold" },
          { value: "pinch", label: "Pinch" },
          { value: "mirror", label: "Mirror" },
        ],
      },
      { id: "position", label: "Position", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "warp", label: "Warp", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "level", label: "Level", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "pan", label: "Pan", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "octave", label: "Oct", kind: "number", min: -4, max: 4, step: 1 },
      { id: "semitone", label: "Semi", kind: "number", min: -12, max: 12, step: 1 },
      { id: "fine", label: "Fine", kind: "number", min: -100, max: 100, step: 1, unit: "ct" },
      { id: "phase", label: "Phase", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "randomPhase", label: "Random", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "pitchCvAmount", label: "Pitch CV", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "levelCvAmount", label: "Level CV", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "positionCvAmount", label: "Position CV", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "panCvAmount", label: "Pan CV", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: {
      wavetable: "basic.saw",
      warpMode: "shape",
      position: 0,
      warp: 0.2,
      level: 0.8,
      pan: 0,
      octave: 0,
      semitone: 0,
      fine: 0,
      phase: 0,
      randomPhase: 0.25,
      pitchCvAmount: 1,
      levelCvAmount: 1,
      positionCvAmount: 1,
      panCvAmount: 1,
    },
  },
  oscillatorMerge: {
    label: "Oscillator Merge",
    icon: "ph:intersect-three",
    description: "Combines two single Oscillator nodes into one audio stream before filters, volume, effects, or Instrument Out.",
    inputs: [
      { id: "osc-a", label: "Osc A", kind: "input", signal: "audio" },
      { id: "osc-b", label: "Osc B", kind: "input", signal: "audio" },
    ],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "levelA", label: "Osc A", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "levelB", label: "Osc B", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { levelA: 1, levelB: 0.55 },
  },
  noise: {
    label: "Noise",
    icon: "ph:grains",
    description: "Broadband noise source for hats, breath, grit, transients, and texture layers.",
    inputs: [{ id: "level-cv", label: "Level", kind: "input", signal: "control" }],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "level", label: "Level", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "color", label: "Color", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "levelCvAmount", label: "Level CV", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: { level: 0.12, color: 0.45, levelCvAmount: 1 },
  },
  mixer: {
    label: "Mixer",
    icon: "ph:sliders-horizontal",
    description: "Combines multiple audio sources. Any input may accept more than one cable.",
    inputs: MIXER_INPUTS,
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
    icon: "ph:sparkle",
    description: "Lowpass, highpass, or bandpass filter with cutoff CV input.",
    inputs: [
      AUDIO_IN,
      { id: "cutoff-cv", label: "Cutoff", kind: "input", signal: "control" },
      { id: "resonance-cv", label: "Resonance", kind: "input", signal: "control" },
      { id: "drive-cv", label: "Drive", kind: "input", signal: "control" },
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
      { id: "cutoffCvAmount", label: "Cutoff CV", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "resonanceCvAmount", label: "Resonance CV", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "driveCvAmount", label: "Drive CV", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: { type: "lowpass", cutoff: 8400, resonance: 0.18, drive: 0.06, cutoffCvAmount: 1, resonanceCvAmount: 1, driveCvAmount: 1 },
  },
  gain: {
    label: "Volume",
    icon: "ph:sparkle",
    description: "Final gain and pan stage. Level and Pan can be modulated by CV.",
    inputs: [
      AUDIO_IN,
      { id: "level-cv", label: "Level", kind: "input", signal: "control" },
      { id: "pan-cv", label: "Pan", kind: "input", signal: "control" },
    ],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "level", label: "Level", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "pan", label: "Pan", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "levelCvAmount", label: "Level CV", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "panCvAmount", label: "Pan CV", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: { level: 0.8, pan: 0, levelCvAmount: 1, panCvAmount: 1 },
  },
  unison: {
    label: "Unison",
    icon: "ph:sparkle",
    description: "Audio passthrough that enables multiple Aether voices with detune and stereo spread. Detune and Spread accept CV.",
    inputs: [
      AUDIO_IN,
      { id: "detune-cv", label: "Detune", kind: "input", signal: "control" },
      { id: "spread-cv", label: "Spread", kind: "input", signal: "control" },
    ],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "voices", label: "Voices", kind: "number", min: 1, max: 16, step: 1 },
      { id: "detune", label: "Detune", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "spread", label: "Spread", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "detuneCvAmount", label: "Detune CV", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "spreadCvAmount", label: "Spread CV", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: { voices: 4, detune: 0.14, spread: 0.6, detuneCvAmount: 1, spreadCvAmount: 1 },
  },
  constant: {
    label: "Constant",
    icon: "ph:square",
    description: "A fixed CV value for inputs like Pitch, Level, Pan, or Cutoff.",
    inputs: [],
    outputs: [{ id: "cv-out", label: "CV", kind: "output", signal: "control" }],
    parameters: [{ id: "value", label: "Value", kind: "number", min: -1, max: 1, step: 0.01 }],
    defaults: { value: 0.5 },
  },
  cvScale: {
    label: "CV Scale",
    icon: "ph:arrows-in-line-horizontal",
    description: "Scales, inverts, offsets, or clamps a CV route before it reaches a target input.",
    inputs: [{ id: "cv-in", label: "CV", kind: "input", signal: "control" }],
    outputs: [{ id: "cv-out", label: "CV", kind: "output", signal: "control" }],
    parameters: [
      { id: "amount", label: "Amount", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "offset", label: "Offset", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "clamp", label: "Clamp", kind: "boolean" },
    ],
    defaults: { amount: 1, offset: 0, clamp: true },
  },
  velocity: {
    label: "Velocity",
    icon: "ph:pulse",
    description: "Performance CV from MIDI note velocity. Patch it to level, filter, pitch, or pan targets for playable response.",
    inputs: [],
    outputs: [{ id: "cv-out", label: "CV", kind: "output", signal: "control" }],
    parameters: [
      { id: "amount", label: "Amount", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: { amount: 0.35 },
  },
  keytrack: {
    label: "Keytrack",
    icon: "ph:piano-keys",
    description: "Performance CV based on note pitch. Patch it to filter cutoff, oscillator pitch, level, or pan targets.",
    inputs: [],
    outputs: [{ id: "cv-out", label: "CV", kind: "output", signal: "control" }],
    parameters: [
      { id: "amount", label: "Amount", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: { amount: 0.25 },
  },
  modWheel: {
    label: "Mod Wheel",
    icon: "ph:wave-triangle",
    description: "Performance CV from MIDI CC1/mod wheel. Patch it to expressive movement targets.",
    inputs: [],
    outputs: [{ id: "cv-out", label: "CV", kind: "output", signal: "control" }],
    parameters: [
      { id: "amount", label: "Amount", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: { amount: 0.3 },
  },
  macro: {
    label: "Macro",
    icon: "ph:sliders-horizontal",
    description: "A selected performance macro as graph CV. Use it to expose Nodemap controls in the broader instrument editor.",
    inputs: [],
    outputs: [{ id: "cv-out", label: "CV", kind: "output", signal: "control" }],
    parameters: [
      {
        id: "source",
        label: "Macro",
        kind: "select",
        options: [
          { value: "macro.1", label: "Macro 1" },
          { value: "macro.2", label: "Macro 2" },
          { value: "macro.3", label: "Macro 3" },
          { value: "macro.4", label: "Macro 4" },
        ],
      },
      { id: "amount", label: "Amount", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: { source: "macro.1", amount: 0.25 },
  },
  random: {
    label: "Random CV",
    icon: "ph:shooting-star",
    description: "Deterministic random static CV. Change Seed to create a new repeatable offset without adding hidden motion.",
    inputs: [],
    outputs: [{ id: "cv-out", label: "CV", kind: "output", signal: "control" }],
    parameters: [
      { id: "seed", label: "Seed", kind: "number", min: 0, max: 9999, step: 1 },
      { id: "amount", label: "Amount", kind: "number", min: -1, max: 1, step: 0.01 },
      { id: "offset", label: "Offset", kind: "number", min: -1, max: 1, step: 0.01 },
    ],
    defaults: { seed: 1, amount: 0.5, offset: 0 },
  },
  lfo: {
    label: "LFO",
    icon: "ph:wave-sine",
    description: "Repeating CV movement for pitch, level, pan, or filter cutoff.",
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
    description: "ADSR-style CV source, normally patched to Volume Level or Filter Cutoff.",
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
  shaper: {
    label: "Shaper",
    icon: "ph:sparkle",
    description: "Drive and shape stage for richer harmonics before filtering or output.",
    inputs: [AUDIO_IN],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "drive", label: "Drive", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { drive: 0.2, mix: 0.5 },
  },
  distortion: {
    label: "Distortion",
    icon: "ph:sparkle",
    description: "Heavier drive stage with shape, output trim, and dry/wet mix for aggressive harmonics.",
    inputs: [AUDIO_IN],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "drive", label: "Drive", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "shape", label: "Shape", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "trim", label: "Trim", kind: "number", min: 0, max: 18, step: 0.5, unit: "dB" },
      { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { drive: 0.55, shape: 0.35, trim: 6, mix: 0.45 },
  },
  delay: {
    label: "Delay",
    icon: "ph:sparkle",
    description: "Echo stage for rhythmic repeats. Routed delay nodes compile into instrument-owned Aether delay FX.",
    inputs: [AUDIO_IN],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "time", label: "Time", kind: "number", min: 0.01, max: 1.5, step: 0.01, unit: "s" },
      { id: "feedback", label: "Feedback", kind: "number", min: 0, max: 0.95, step: 0.01 },
      { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { time: 0.22, feedback: 0.28, mix: 0.18 },
  },
  chorus: {
    label: "Chorus",
    icon: "ph:sparkle",
    description: "Stereo modulation stage for width and movement. Routed chorus nodes compile into instrument-owned Aether chorus FX.",
    inputs: [AUDIO_IN],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "rate", label: "Rate", kind: "number", min: 0.05, max: 12, step: 0.05, unit: "Hz" },
      { id: "depth", label: "Depth", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { rate: 0.8, depth: 0.35, mix: 0.22 },
  },
  reverb: {
    label: "Reverb",
    icon: "ph:sparkle",
    description: "Room and tail stage for placing a Nodemap sound in space.",
    inputs: [AUDIO_IN],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "room", label: "Room", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "damping", label: "Damping", kind: "number", min: 0, max: 1, step: 0.01 },
      { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { room: 0.4, damping: 0.35, mix: 0.2 },
  },
  phaser: {
    label: "Phaser",
    icon: "ph:sparkle",
    description: "Sweeping phase movement stage for animated notches and motion.",
    inputs: [AUDIO_IN],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "rate", label: "Rate", kind: "number", min: 0.02, max: 12, step: 0.01, unit: "Hz" },
      { id: "center", label: "Center", kind: "number", min: 80, max: 8000, step: 1, unit: "Hz" },
      { id: "depth", label: "Depth", kind: "number", min: 0, max: 4, step: 0.1, unit: "oct" },
      { id: "feedback", label: "Feedback", kind: "number", min: -0.85, max: 0.85, step: 0.01 },
      { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { rate: 0.45, center: 900, depth: 1.8, feedback: 0.35, mix: 0.45 },
  },
  flanger: {
    label: "Flanger",
    icon: "ph:sparkle",
    description: "Short modulated delay for comb movement, width, and metallic sweep.",
    inputs: [AUDIO_IN],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "rate", label: "Rate", kind: "number", min: 0.02, max: 12, step: 0.01, unit: "Hz" },
      { id: "depth", label: "Depth", kind: "number", min: 0, max: 8, step: 0.1, unit: "ms" },
      { id: "delay", label: "Delay", kind: "number", min: 0.1, max: 15, step: 0.1, unit: "ms" },
      { id: "feedback", label: "Feedback", kind: "number", min: -0.85, max: 0.85, step: 0.01 },
      { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { rate: 0.28, depth: 2, delay: 2.5, feedback: 0.45, mix: 0.5 },
  },
  compressor: {
    label: "Compressor",
    icon: "ph:sparkle",
    description: "Dynamics stage for tightening or leveling a Nodemap patch.",
    inputs: [AUDIO_IN],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "threshold", label: "Threshold", kind: "number", min: -60, max: 0, step: 1, unit: "dB" },
      { id: "ratio", label: "Ratio", kind: "number", min: 1, max: 40, step: 0.1 },
      { id: "attack", label: "Attack", kind: "number", min: 0.1, max: 200, step: 0.1, unit: "ms" },
      { id: "release", label: "Release", kind: "number", min: 1, max: 2000, step: 1, unit: "ms" },
      { id: "makeup", label: "Makeup", kind: "number", min: -24, max: 24, step: 1, unit: "dB" },
      { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { threshold: -18, ratio: 4, attack: 10, release: 120, makeup: 0, mix: 1 },
  },
  bitcrush: {
    label: "Bitcrush",
    icon: "ph:sparkle",
    description: "Digital reduction stage for lower bit depth and sample-rate texture.",
    inputs: [AUDIO_IN],
    outputs: [AUDIO_OUT],
    parameters: [
      { id: "bits", label: "Bits", kind: "number", min: 1, max: 16, step: 1 },
      { id: "rate", label: "Rate", kind: "number", min: 0.01, max: 1, step: 0.01 },
      { id: "mix", label: "Mix", kind: "number", min: 0, max: 1, step: 0.01 },
    ],
    defaults: { bits: 8, rate: 0.5, mix: 0.35 },
  },
  output: {
    label: "Instrument Out",
    icon: "ph:waveform",
    description: "The single final output for the instrument. Nodes only make sound when audio reaches this node.",
    inputs: [SUM_AUDIO_IN],
    outputs: [],
    parameters: [{ id: "level", label: "Level", kind: "number", min: 0, max: 1, step: 0.01 }],
    defaults: { level: 1 },
  },
};

export const NODE_BROWSER_GROUPS: NodeBrowserGroup[] = [
  {
    id: "synth",
    label: "Synth",
    nodeKinds: ["oscillator", "noise", "instrument"],
  },
  {
    id: "effects",
    label: "Effects",
    nodeKinds: [
      "filter",
      "gain",
      "unison",
      "shaper",
      "distortion",
      "delay",
      "chorus",
      "reverb",
      "phaser",
      "flanger",
      "compressor",
      "bitcrush",
    ],
  },
  {
    id: "modulation",
    label: "Modulation",
    nodeKinds: ["lfo", "envelope", "velocity", "keytrack", "modWheel", "macro", "random", "constant", "cvScale"],
  },
  {
    id: "utility",
    label: "Utility",
    nodeKinds: ["oscillatorMerge", "mixer"],
  },
];

export const NODE_GRAPH_TEMPLATES: NodeGraphTemplate[] = [
  {
    id: "basic-oscillator",
    label: "Basic Oscillator",
    description: "One oscillator routed directly to Instrument Out.",
  },
  {
    id: "filtered-mono",
    label: "Filtered Mono",
    description: "Oscillator through filter and volume for a classic subtractive path.",
  },
  {
    id: "moving-texture",
    label: "Moving Texture",
    description: "Oscillator and noise mixed through filter, motion, shaper, and output.",
  },
  {
    id: "snare-hit",
    label: "Snare Hit",
    description: "Noise and body oscillator into a shaped, short percussive voice.",
  },
  {
    id: "tom-hit",
    label: "Tom Hit",
    description: "Low pitched body oscillator with a short decay and filtered output.",
  },
  {
    id: "crash-hit",
    label: "Crash Hit",
    description: "Bright noise source through highpass filtering, movement, and space.",
  },
];

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
  const merge = createInstrumentNode("oscillatorMerge", 430, 220);
  const filter = createInstrumentNode("filter", 720, 220);
  const gain = createInstrumentNode("gain", 1010, 220);
  const output = createInstrumentNode("output", 1300, 260);

  if (instrument) {
    oscA.parameters.wavetable = wavetableFromInstrument(instrument, "a");
    oscA.parameters.level = readNumber(instrument.synthPatch?.parameters["osc.a.level"], instrument.knobs.color, 0.8);
    oscB.parameters.wavetable = wavetableFromInstrument(instrument, "b");
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
    nodes: [oscA, oscB, lfo, envelope, merge, filter, gain, output],
    cables: [
      cable(oscA, "audio-out", merge, "osc-a"),
      cable(oscB, "audio-out", merge, "osc-b"),
      cable(merge, "audio-out", filter, "audio-in"),
      cable(filter, "audio-out", gain, "audio-in"),
      cable(gain, "audio-out", output, "audio-in"),
      cable(envelope, "cv-out", gain, "level-cv"),
      cable(lfo, "cv-out", filter, "cutoff-cv"),
    ],
  };
}

export function createStarterInstrumentNodeGraph(instrument?: Instrument): InstrumentNodeGraph {
  const oscillator = createInstrumentNode("oscillator", 140, 220, "Oscillator");
  const output = createInstrumentNode("output", 520, 240);
  if (instrument) {
    oscillator.parameters.wavetable = wavetableFromInstrument(instrument, "a");
    oscillator.parameters.level = readNumber(instrument.synthPatch?.parameters["osc.a.level"], instrument.knobs.color, 0.8);
  }
  return {
    schemaVersion: 1,
    nodes: [oscillator, output],
    cables: [cable(oscillator, "audio-out", output, "audio-in")],
  };
}

export function createOutputOnlyInstrumentNodeGraph(): InstrumentNodeGraph {
  return {
    schemaVersion: 1,
    nodes: [createInstrumentNode("output", 760, 320)],
    cables: [],
  };
}

export function createNodeGraphTemplate(id: NodeGraphTemplateId, instrument?: Instrument): InstrumentNodeGraph {
  if (id === "basic-oscillator") return createStarterInstrumentNodeGraph(instrument);
  if (id === "filtered-mono") {
    const oscillator = createInstrumentNode("oscillator", 120, 220, "Oscillator");
    const filter = createInstrumentNode("filter", 380, 220, "Filter");
    const gain = createInstrumentNode("gain", 640, 220, "Volume");
    const output = createInstrumentNode("output", 900, 240);
    if (instrument) {
      oscillator.parameters.wavetable = wavetableFromInstrument(instrument, "a");
      oscillator.parameters.level = readNumber(instrument.synthPatch?.parameters["osc.a.level"], instrument.knobs.color, 0.8);
      filter.parameters.type = instrument.filterType ?? "lowpass";
      filter.parameters.cutoff = cutoffFromKnob(instrument.knobs.cutoff);
      filter.parameters.resonance = instrument.knobs.resonance;
      filter.parameters.drive = instrument.knobs.drive;
      gain.parameters.level = instrument.ampLevel ?? 0.8;
      gain.parameters.pan = instrument.ampPan ?? 0;
    }
    return {
      schemaVersion: 1,
      nodes: [oscillator, filter, gain, output],
      cables: [
        cable(oscillator, "audio-out", filter, "audio-in"),
        cable(filter, "audio-out", gain, "audio-in"),
        cable(gain, "audio-out", output, "audio-in"),
      ],
    };
  }
  if (id === "moving-texture") return createMovingTextureTemplate();
  if (id === "snare-hit") return createSnareHitTemplate();
  if (id === "tom-hit") return createTomHitTemplate();
  return createCrashHitTemplate();
}

function createMovingTextureTemplate(): InstrumentNodeGraph {
  const oscillator = createInstrumentNode("oscillator", 100, 140, "Oscillator");
  const noise = createInstrumentNode("noise", 100, 340, "Noise");
  const mixer = createInstrumentNode("mixer", 360, 240, "Mixer");
  const filter = createInstrumentNode("filter", 620, 240, "Filter");
  const lfo = createInstrumentNode("lfo", 620, 500, "LFO");
  const shaper = createInstrumentNode("shaper", 880, 240, "Shaper");
  const gain = createInstrumentNode("gain", 1140, 240, "Volume");
  const output = createInstrumentNode("output", 1400, 260);
  oscillator.parameters.wavetable = "basic.triangle";
  oscillator.parameters.level = 0.72;
  noise.parameters.level = 0.18;
  mixer.parameters.level1 = 1;
  mixer.parameters.level2 = 0.35;
  filter.parameters.cutoff = 5200;
  filter.parameters.resonance = 0.3;
  lfo.parameters.rate = 0.32;
  lfo.parameters.amount = 0.4;
  shaper.parameters.drive = 0.18;
  shaper.parameters.mix = 0.34;
  return {
    schemaVersion: 1,
    nodes: [oscillator, noise, mixer, filter, lfo, shaper, gain, output],
    cables: [
      cable(oscillator, "audio-out", mixer, "in-1"),
      cable(noise, "audio-out", mixer, "in-2"),
      cable(mixer, "audio-out", filter, "audio-in"),
      cable(lfo, "cv-out", filter, "cutoff-cv"),
      cable(filter, "audio-out", shaper, "audio-in"),
      cable(shaper, "audio-out", gain, "audio-in"),
      cable(gain, "audio-out", output, "audio-in"),
    ],
  };
}

function createSnareHitTemplate(): InstrumentNodeGraph {
  const body = createInstrumentNode("oscillator", 100, 130, "Body");
  const noise = createInstrumentNode("noise", 100, 330, "Wire Noise");
  const mixer = createInstrumentNode("mixer", 360, 230, "Blend");
  const filter = createInstrumentNode("filter", 620, 230, "Snap Filter");
  const envelope = createInstrumentNode("envelope", 620, 490, "Hit Envelope");
  const shaper = createInstrumentNode("shaper", 880, 230, "Body Shaper");
  const gain = createInstrumentNode("gain", 1140, 230, "Level");
  const output = createInstrumentNode("output", 1400, 250);
  body.parameters.wavetable = "basic.sine";
  body.parameters.octave = -1;
  body.parameters.semitone = 2;
  body.parameters.warp = 0.08;
  body.parameters.level = 0.48;
  noise.parameters.level = 0.74;
  noise.parameters.color = 0.52;
  mixer.parameters.level1 = 0.42;
  mixer.parameters.level2 = 0.95;
  filter.parameters.type = "bandpass";
  filter.parameters.cutoff = 2450;
  filter.parameters.resonance = 0.28;
  filter.parameters.drive = 0.2;
  envelope.parameters.attack = 0.001;
  envelope.parameters.decay = 0.09;
  envelope.parameters.sustain = 0;
  envelope.parameters.release = 0.12;
  shaper.parameters.drive = 0.48;
  shaper.parameters.mix = 0.52;
  gain.parameters.level = 0.84;
  return {
    schemaVersion: 1,
    nodes: [body, noise, mixer, filter, envelope, shaper, gain, output],
    cables: [
      cable(body, "audio-out", mixer, "in-1"),
      cable(noise, "audio-out", mixer, "in-2"),
      cable(mixer, "audio-out", filter, "audio-in"),
      cable(filter, "audio-out", shaper, "audio-in"),
      cable(shaper, "audio-out", gain, "audio-in"),
      cable(envelope, "cv-out", gain, "level-cv"),
      cable(gain, "audio-out", output, "audio-in"),
    ],
  };
}

function createTomHitTemplate(): InstrumentNodeGraph {
  const body = createInstrumentNode("oscillator", 100, 170, "Drum Body");
  const click = createInstrumentNode("noise", 100, 370, "Stick Click");
  const mixer = createInstrumentNode("mixer", 360, 250, "Body Blend");
  const envelope = createInstrumentNode("envelope", 360, 510, "Decay Envelope");
  const filter = createInstrumentNode("filter", 620, 250, "Drum Filter");
  const shaper = createInstrumentNode("shaper", 880, 250, "Soft Drive");
  const gain = createInstrumentNode("gain", 1140, 250, "Level");
  const output = createInstrumentNode("output", 1400, 270);
  body.parameters.wavetable = "basic.sine";
  body.parameters.octave = -1;
  body.parameters.semitone = -7;
  body.parameters.fine = -12;
  body.parameters.warp = 0.05;
  body.parameters.level = 0.96;
  click.parameters.level = 0.16;
  click.parameters.color = 0.38;
  mixer.parameters.level1 = 1;
  mixer.parameters.level2 = 0.18;
  filter.parameters.type = "lowpass";
  filter.parameters.cutoff = 540;
  filter.parameters.resonance = 0.32;
  filter.parameters.drive = 0.14;
  envelope.parameters.attack = 0.002;
  envelope.parameters.decay = 0.26;
  envelope.parameters.sustain = 0;
  envelope.parameters.release = 0.16;
  shaper.parameters.drive = 0.34;
  shaper.parameters.mix = 0.28;
  gain.parameters.level = 0.9;
  return {
    schemaVersion: 1,
    nodes: [body, click, mixer, envelope, filter, shaper, gain, output],
    cables: [
      cable(body, "audio-out", mixer, "in-1"),
      cable(click, "audio-out", mixer, "in-2"),
      cable(mixer, "audio-out", filter, "audio-in"),
      cable(filter, "audio-out", shaper, "audio-in"),
      cable(shaper, "audio-out", gain, "audio-in"),
      cable(envelope, "cv-out", gain, "level-cv"),
      cable(gain, "audio-out", output, "audio-in"),
    ],
  };
}

function createCrashHitTemplate(): InstrumentNodeGraph {
  const noise = createInstrumentNode("noise", 100, 220, "Metal Noise");
  const filter = createInstrumentNode("filter", 360, 220, "High Filter");
  const shaper = createInstrumentNode("shaper", 620, 220, "Edge");
  const reverb = createInstrumentNode("reverb", 880, 220, "Short Tail");
  const envelope = createInstrumentNode("envelope", 880, 480, "Crash Decay");
  const gain = createInstrumentNode("gain", 1140, 220, "Level");
  const output = createInstrumentNode("output", 1400, 240);
  noise.parameters.level = 0.9;
  noise.parameters.color = 0.68;
  filter.parameters.type = "highpass";
  filter.parameters.cutoff = 2100;
  filter.parameters.resonance = 0.08;
  filter.parameters.drive = 0.16;
  shaper.parameters.drive = 0.42;
  shaper.parameters.mix = 0.32;
  reverb.parameters.room = 0.48;
  reverb.parameters.damping = 0.42;
  reverb.parameters.mix = 0.2;
  envelope.parameters.attack = 0.001;
  envelope.parameters.decay = 0.95;
  envelope.parameters.sustain = 0.04;
  envelope.parameters.release = 1.1;
  gain.parameters.level = 0.82;
  return {
    schemaVersion: 1,
    nodes: [noise, filter, shaper, reverb, envelope, gain, output],
    cables: [
      cable(noise, "audio-out", filter, "audio-in"),
      cable(filter, "audio-out", shaper, "audio-in"),
      cable(shaper, "audio-out", reverb, "audio-in"),
      cable(reverb, "audio-out", gain, "audio-in"),
      cable(envelope, "cv-out", gain, "level-cv"),
      cable(gain, "audio-out", output, "audio-in"),
    ],
  };
}

export function normalizeInstrumentNodeGraph(graph: InstrumentNodeGraph | undefined, instrument?: Instrument): InstrumentNodeGraph {
  const schemaVersion = Number(graph?.schemaVersion);
  if (!graph || !Number.isFinite(schemaVersion) || schemaVersion < 1 || !Array.isArray(graph.nodes)) {
    return createStarterInstrumentNodeGraph(instrument);
  }
  const nodeIds = new Set<string>();
  const normalizedNodes = graph.nodes
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
  const outputNodes = normalizedNodes.filter((node) => node.kind === "output");
  const output = outputNodes[0] ?? createInstrumentNode("output", 760, 320);
  const removedOutputIds = new Set(outputNodes.slice(1).map((node) => node.id));
  const nodes = [
    ...normalizedNodes.filter((node) => node.kind !== "output"),
    output,
  ];
  nodeIds.clear();
  for (const node of nodes) nodeIds.add(node.id);
  const cableKeys = new Set<string>();
  const singleInputKeys = new Set<string>();
  const cables = (graph.cables ?? []).filter((item) => {
    if (
      !nodeIds.has(item.fromNodeId)
      || !nodeIds.has(item.toNodeId)
      || item.fromNodeId === item.toNodeId
      || removedOutputIds.has(item.fromNodeId)
      || removedOutputIds.has(item.toNodeId)
    ) {
      return false;
    }
    const fromPort = portFor(nodes, item.fromNodeId, item.fromPortId, "output");
    const toPort = portFor(nodes, item.toNodeId, item.toPortId, "input");
    if (!fromPort || !toPort || fromPort.signal !== toPort.signal) return false;
    const key = `${item.fromNodeId}:${item.fromPortId}->${item.toNodeId}:${item.toPortId}`;
    if (cableKeys.has(key)) return false;
    cableKeys.add(key);
    if (!portAcceptsMultipleConnections(toPort)) {
      const inputKey = inputConnectionKey(item.toNodeId, item.toPortId);
      if (singleInputKeys.has(inputKey)) return false;
      singleInputKeys.add(inputKey);
    }
    return true;
  });
  return { schemaVersion: 1, nodes, cables };
}

export function cableIsValid(graph: InstrumentNodeGraph, cablePatch: Omit<InstrumentNodeCable, "id">): boolean {
  if (cablePatch.fromNodeId === cablePatch.toNodeId) return false;
  const from = portFor(graph.nodes, cablePatch.fromNodeId, cablePatch.fromPortId, "output");
  const to = portFor(graph.nodes, cablePatch.toNodeId, cablePatch.toPortId, "input");
  if (!from || !to || from.signal !== to.signal) return false;
  return inputCanAcceptCable(graph, cablePatch.toNodeId, cablePatch.toPortId, cablePatch);
}

export function portAcceptsMultipleConnections(port: InstrumentNodePort | undefined): boolean {
  return Boolean(port?.acceptsMultiple);
}

export function inputCanAcceptCable(
  graph: InstrumentNodeGraph,
  nodeId: string,
  portId: string,
  cablePatch?: Omit<InstrumentNodeCable, "id">,
): boolean {
  const port = portFor(graph.nodes, nodeId, portId, "input");
  if (!port) return false;
  if (portAcceptsMultipleConnections(port)) return true;
  return !graph.cables.some((cable) =>
    cable.toNodeId === nodeId
      && cable.toPortId === portId
      && existingCableOccupiesInput(graph, cable, port)
      && (!cablePatch
        || cable.fromNodeId !== cablePatch.fromNodeId
        || cable.fromPortId !== cablePatch.fromPortId
        || cable.toNodeId !== cablePatch.toNodeId
        || cable.toPortId !== cablePatch.toPortId),
  );
}

export function analyzeInstrumentNodeGraph(graph: InstrumentNodeGraph): NodeGraphIssue[] {
  const issues: NodeGraphIssue[] = [];
  const outputNodes = graph.nodes.filter((node) => node.kind === "output");
  const output = outputNodes[0];
  if (!output) {
    issues.push({ id: "missing-output", message: "Missing Instrument Out. The graph cannot produce sound." });
    return issues;
  }
  if (outputNodes.length > 1) {
    issues.push({ id: "duplicate-output", nodeId: output.id, message: "Only one Instrument Out is allowed; extra outputs will be repaired on save/load." });
  }

  const connectedAudioIds = upstreamAudioNodeIds(graph);
  if (connectedAudioIds.size === 0) {
    issues.push({ id: "silent-output", nodeId: output.id, message: "Nothing reaches Instrument Out, so this instrument is silent." });
  }
  for (const node of graph.nodes) {
    if (node.kind === "output") continue;
    const hasCable = graph.cables.some((cable) => cable.fromNodeId === node.id || cable.toNodeId === node.id);
    if (!hasCable) {
      issues.push({ id: `unconnected-${node.id}`, nodeId: node.id, message: `${node.label} is unconnected and will not affect sound.` });
    } else if (!connectedAudioIds.has(node.id) && node.outputs.some((port) => port.signal === "audio")) {
      issues.push({ id: `not-routed-${node.id}`, nodeId: node.id, message: `${node.label} is not routed to Instrument Out.` });
    }
  }

  const controlTargets = new Map<string, InstrumentNodeCable[]>();
  for (const cable of graph.cables) {
    const fromPort = portFor(graph.nodes, cable.fromNodeId, cable.fromPortId, "output");
    const toPort = portFor(graph.nodes, cable.toNodeId, cable.toPortId, "input");
    if (fromPort?.signal !== "control" || toPort?.signal !== "control") continue;
    const target = graph.nodes.find((node) => node.id === cable.toNodeId);
    if (!target || !connectedAudioIds.has(target.id)) continue;
    const key = `${cable.toNodeId}:${cable.toPortId}`;
    controlTargets.set(key, [...(controlTargets.get(key) ?? []), cable]);
  }
  for (const [key, cables] of controlTargets) {
    if (cables.length < 2) continue;
    const [nodeId, portId] = key.split(":");
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    const port = portFor(graph.nodes, nodeId, portId, "input");
    issues.push({
      id: `control-conflict-${key}`,
      nodeId,
      message: `${node?.label ?? "Node"} ${port?.label ?? portId} has ${cables.length} CV routes; dynamic routes are summed and static CV may override base values.`,
    });
  }

  return issues;
}

export function compileNodeGraphToInstrumentPatch(graph: InstrumentNodeGraph, instrument: Instrument): Partial<Instrument> {
  const normalized = normalizeInstrumentNodeGraph(graph, instrument);
  const hadSynthPatch = Boolean(instrument.synthPatch);
  const draft = instrument.synthPatch
    ? synthDraftFromInstrument(instrument)
    : createDefaultSynthDraft();
  if (!hadSynthPatch) draft.modulation = [];
  const audibleNodeIds = upstreamAudioNodeIds(normalized);
  const audibleNodes = normalized.nodes.filter((node) => audibleNodeIds.has(node.id));
  const oscillators = audibleNodes.filter((node) => node.kind === "oscillator");
  const instrumentSource = audibleNodes.find((node) => node.kind === "instrument");
  const noiseSource = audibleNodes.find((node) => node.kind === "noise");
  const oscillatorSlots = oscillatorSlotMap(oscillators, instrumentSource);
  applyOscillatorNode(draft, "a", oscillators[0] ?? instrumentSource, sourceAudioGainMultiplier(normalized, oscillators[0] ?? instrumentSource, audibleNodeIds));
  applyOscillatorNode(draft, "b", oscillators[1], sourceAudioGainMultiplier(normalized, oscillators[1], audibleNodeIds));

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
  } else if (oscillators.length === 0 && !noiseSource && !instrumentSource) {
    draft.parameters["amp.level"] = 0;
    draft.parameters["amp.pan"] = 0;
  }

  const unison = audibleNodes.find((node) => node.kind === "unison");
  if (unison) {
    draft.parameters["unison.enabled"] = true;
    draft.parameters["unison.voices"] = Math.round(numericParameter(unison, "voices", 4));
    draft.parameters["unison.detune"] = clamp01(numericParameter(unison, "detune", 0.14));
    draft.parameters["unison.spread"] = clamp01(numericParameter(unison, "spread", 0.6));
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

  applyControlCablesToDraft(normalized, draft, oscillatorSlots, audibleNodeIds);

  draft.effects = normalizeTrackEffectChain({ filters: compileNodeEffectChain(normalized, audibleNodes) });
  const patch = synthDraftToInstrumentPatch({ ...draft, name: instrument.name });
  if (noiseSource) {
    patch.aether = {
      ...patch.aether!,
      noise: {
        enabled: true,
        level: clamp01(numericParameter(noiseSource, "level", 0.12) * sourceAudioGainMultiplier(normalized, noiseSource, audibleNodeIds)),
        color: clamp01(numericParameter(noiseSource, "color", 0.45)),
      },
    };
  }

  return {
    ...patch,
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

function applyOscillatorNode(draft: SynthDraftPatch, id: "a" | "b", node: InstrumentNode | undefined, gainMultiplier = 1) {
  const prefix = `osc.${id}`;
  if (!node) {
    draft.parameters[`${prefix}.enabled` as SynthParameterId] = false;
    return;
  }
  draft.parameters[`${prefix}.enabled` as SynthParameterId] = true;
  draft.parameters[`${prefix}.wavetable` as SynthParameterId] = node.kind === "instrument"
    ? draft.parameters[`${prefix}.wavetable` as SynthParameterId] ?? "basic.saw"
    : wavetableForOscillatorNode(node);
  draft.parameters[`${prefix}.position` as SynthParameterId] = clamp01(numericParameter(node, "position", 0.5));
  draft.parameters[`${prefix}.warp` as SynthParameterId] = clamp01(numericParameter(node, "warp", 0.2));
  draft.parameters[`${prefix}.warpMode` as SynthParameterId] = warpModeForNode(node);
  draft.parameters[`${prefix}.level` as SynthParameterId] = clamp01(numericParameter(node, "level", id === "a" ? 0.8 : 0.45) * gainMultiplier);
  draft.parameters[`${prefix}.pan` as SynthParameterId] = clamp(numericParameter(node, "pan", 0), -1, 1);
  draft.parameters[`${prefix}.octave` as SynthParameterId] = Math.round(clamp(numericParameter(node, "octave", 0), -4, 4));
  draft.parameters[`${prefix}.semitone` as SynthParameterId] = Math.round(clamp(numericParameter(node, "semitone", 0), -12, 12));
  draft.parameters[`${prefix}.fine` as SynthParameterId] = clamp(numericParameter(node, "fine", 0), -100, 100);
  draft.parameters[`${prefix}.phase` as SynthParameterId] = clamp01(numericParameter(node, "phase", 0));
  draft.parameters[`${prefix}.randomPhase` as SynthParameterId] = clamp01(numericParameter(node, "randomPhase", 0.25));
}

function sourceAudioGainMultiplier(
  graph: InstrumentNodeGraph,
  node: InstrumentNode | undefined,
  audibleNodeIds: Set<string>,
): number {
  if (!node) return 1;
  const outgoingAudioCables = graph.cables.filter((cable) => {
    if (cable.fromNodeId !== node.id || !audibleNodeIds.has(cable.toNodeId)) return false;
    const fromPort = portFor(graph.nodes, cable.fromNodeId, cable.fromPortId, "output");
    const toPort = portFor(graph.nodes, cable.toNodeId, cable.toPortId, "input");
    return fromPort?.signal === "audio" && toPort?.signal === "audio";
  });
  if (outgoingAudioCables.length === 0) return 1;
  const summedGain = outgoingAudioCables.reduce((sum, cable) => {
    const target = graph.nodes.find((candidate) => candidate.id === cable.toNodeId);
    if (target?.kind === "mixer") return sum + mixerInputGain(target, cable.toPortId);
    if (target?.kind === "oscillatorMerge") return sum + oscillatorMergeInputGain(target, cable.toPortId);
    return sum + 1;
  }, 0);
  return clamp01(summedGain);
}

function mixerInputGain(node: InstrumentNode, inputPortId: string): number {
  if (inputPortId === "in-1") return clamp01(numericParameter(node, "level1", 1));
  if (inputPortId === "in-2") return clamp01(numericParameter(node, "level2", 0.55));
  if (inputPortId === "in-3") return clamp01(numericParameter(node, "level3", 0.25));
  return 1;
}

function oscillatorMergeInputGain(node: InstrumentNode, inputPortId: string): number {
  if (inputPortId === "osc-a") return clamp01(numericParameter(node, "levelA", 1));
  if (inputPortId === "osc-b") return clamp01(numericParameter(node, "levelB", 0.55));
  return 1;
}

function oscillatorSlotMap(oscillators: InstrumentNode[], instrumentSource: InstrumentNode | undefined): Map<string, "a" | "b"> {
  const slots = new Map<string, "a" | "b">();
  if (oscillators[0]) slots.set(oscillators[0].id, "a");
  else if (instrumentSource) slots.set(instrumentSource.id, "a");
  if (oscillators[1]) slots.set(oscillators[1].id, "b");
  return slots;
}

function applyControlCablesToDraft(
  graph: InstrumentNodeGraph,
  draft: SynthDraftPatch,
  oscillatorSlots: Map<string, "a" | "b">,
  audibleNodeIds: Set<string>,
) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeRoutes: SynthModulationRoute[] = [];

  for (const cable of graph.cables) {
    const fromPort = portFor(graph.nodes, cable.fromNodeId, cable.fromPortId, "output");
    const toPort = portFor(graph.nodes, cable.toNodeId, cable.toPortId, "input");
    if (fromPort?.signal !== "control" || toPort?.signal !== "control" || !audibleNodeIds.has(cable.toNodeId)) continue;

    const source = nodeById.get(cable.fromNodeId);
    const target = nodeById.get(cable.toNodeId);
    const targetId = target ? modulationTargetForInput(target, cable.toPortId, oscillatorSlots) : null;
    if (!source || !targetId) continue;
    const targetAmount = target ? targetCvAmount(target, cable.toPortId) : 1;

    if (source.kind === "cvScale") {
      const transform = multiplyCvTransform(cvTransformForNode(source), targetAmount);
      for (const inputCable of controlInputCables(graph, source.id)) {
        const inputSource = nodeById.get(inputCable.fromNodeId);
        if (!inputSource) continue;
        applyControlSourceToDraft(draft, nodeRoutes, inputSource, targetId, inputCable, transform, cable);
      }
      continue;
    }

    applyControlSourceToDraft(draft, nodeRoutes, source, targetId, cable, { amount: targetAmount, offset: 0, clamp: false });
  }

  const nodeRouteIds = new Set(nodeRoutes.map((route) => route.id));
  draft.modulation = [
    ...draft.modulation.filter((route) => !route.id.startsWith("node_") && !nodeRouteIds.has(route.id)),
    ...nodeRoutes,
  ];
}

function applyControlSourceToDraft(
  draft: SynthDraftPatch,
  routes: SynthModulationRoute[],
  source: InstrumentNode,
  targetId: ModulationTargetId,
  sourceCable: InstrumentNodeCable,
  transform: CvTransform,
  outputCable?: InstrumentNodeCable,
) {
  if (source.kind === "constant" || source.kind === "random") {
    applyConstantCvToDraft(draft, targetId, transformedCvValue(staticCvValueForNode(source), transform));
    return;
  }

  const sourceId = modulationSourceForNode(source);
  if (!sourceId) return;
  if (transform.offset !== 0) applyConstantCvToDraft(draft, targetId, transformedCvValue(0, { ...transform, amount: 0 }));
  routes.push({
    id: outputCable ? routeIdForCablePair(sourceCable, outputCable) : routeIdForCable(sourceCable),
    source: sourceId,
    target: targetId,
    amount: clamp(modulationAmountForNode(source, targetId) * transform.amount, -1, 1),
    bipolar: source.kind === "lfo" || targetId.endsWith(".pan") || targetId.endsWith(".fine"),
    enabled: true,
  });
}

interface CvTransform {
  amount: number;
  offset: number;
  clamp: boolean;
}

function cvTransformForNode(node: InstrumentNode): CvTransform {
  return {
    amount: clamp(numericParameter(node, "amount", 1), -1, 1),
    offset: clamp(numericParameter(node, "offset", 0), -1, 1),
    clamp: node.parameters.clamp !== false,
  };
}

function multiplyCvTransform(transform: CvTransform, amount: number): CvTransform {
  return {
    ...transform,
    amount: clamp(transform.amount * amount, -1, 1),
    offset: clamp(transform.offset * amount, -1, 1),
  };
}

function targetCvAmount(node: InstrumentNode, portId: string): number {
  if ((node.kind === "oscillator" || node.kind === "instrument") && portId === "pitch") return clamp(numericParameter(node, "pitchCvAmount", 1), -1, 1);
  if ((node.kind === "oscillator" || node.kind === "instrument" || node.kind === "noise" || node.kind === "gain") && portId === "level-cv") {
    return clamp(numericParameter(node, "levelCvAmount", 1), -1, 1);
  }
  if ((node.kind === "oscillator" || node.kind === "instrument") && portId === "position-cv") {
    return clamp(numericParameter(node, "positionCvAmount", 1), -1, 1);
  }
  if ((node.kind === "oscillator" || node.kind === "instrument" || node.kind === "gain") && portId === "pan-cv") {
    return clamp(numericParameter(node, "panCvAmount", 1), -1, 1);
  }
  if (node.kind === "filter" && portId === "cutoff-cv") return clamp(numericParameter(node, "cutoffCvAmount", 1), -1, 1);
  if (node.kind === "filter" && portId === "resonance-cv") return clamp(numericParameter(node, "resonanceCvAmount", 1), -1, 1);
  if (node.kind === "filter" && portId === "drive-cv") return clamp(numericParameter(node, "driveCvAmount", 1), -1, 1);
  if (node.kind === "gain" && portId === "pan-cv") return clamp(numericParameter(node, "panCvAmount", 1), -1, 1);
  if (node.kind === "unison" && portId === "detune-cv") return clamp(numericParameter(node, "detuneCvAmount", 1), -1, 1);
  if (node.kind === "unison" && portId === "spread-cv") return clamp(numericParameter(node, "spreadCvAmount", 1), -1, 1);
  return 1;
}

function transformedCvValue(value: number, transform: CvTransform): number {
  const next = value * transform.amount + transform.offset;
  return transform.clamp ? clamp(next, -1, 1) : next;
}

function controlInputCables(graph: InstrumentNodeGraph, nodeId: string): InstrumentNodeCable[] {
  return graph.cables.filter((cable) => {
    if (cable.toNodeId !== nodeId) return false;
    const fromPort = portFor(graph.nodes, cable.fromNodeId, cable.fromPortId, "output");
    const toPort = portFor(graph.nodes, cable.toNodeId, cable.toPortId, "input");
    return fromPort?.signal === "control" && toPort?.signal === "control";
  });
}

function modulationSourceForNode(node: InstrumentNode): ModulationSourceId | null {
  if (node.kind === "lfo") return "lfo.1";
  if (node.kind === "envelope") return "env.1";
  if (node.kind === "velocity") return "velocity";
  if (node.kind === "keytrack") return "keytrack";
  if (node.kind === "modWheel") return "modWheel";
  if (node.kind === "macro") return macroSourceForNode(node);
  return null;
}

function macroSourceForNode(node: InstrumentNode): ModulationSourceId | null {
  const source = String(node.parameters.source ?? "macro.1");
  if (source === "macro.1" || source === "macro.2" || source === "macro.3" || source === "macro.4") return source;
  return "macro.1";
}

function modulationTargetForInput(
  node: InstrumentNode,
  portId: string,
  oscillatorSlots: Map<string, "a" | "b">,
): ModulationTargetId | null {
  if ((node.kind === "oscillator" || node.kind === "instrument") && (portId === "pitch" || portId === "level-cv" || portId === "position-cv" || portId === "pan-cv")) {
    const slot = oscillatorSlots.get(node.id);
    if (!slot) return null;
    if (portId === "pitch") return `osc.${slot}.fine`;
    if (portId === "position-cv") return `osc.${slot}.position`;
    if (portId === "pan-cv") return `osc.${slot}.pan`;
    return `osc.${slot}.level`;
  }
  if (node.kind === "noise" && portId === "level-cv") return "amp.level";
  if (node.kind === "filter" && portId === "cutoff-cv") return "filter.cutoff";
  if (node.kind === "filter" && portId === "resonance-cv") return "filter.resonance";
  if (node.kind === "filter" && portId === "drive-cv") return "filter.drive";
  if (node.kind === "gain" && portId === "level-cv") return "amp.level";
  if (node.kind === "gain" && portId === "pan-cv") return "amp.pan";
  if (node.kind === "unison" && portId === "detune-cv") return "unison.detune";
  if (node.kind === "unison" && portId === "spread-cv") return "unison.spread";
  return null;
}

function modulationAmountForNode(node: InstrumentNode, target: ModulationTargetId): number {
  const amount = node.kind === "lfo"
    ? numericParameter(node, "amount", 0.25)
    : node.kind === "velocity"
      ? numericParameter(node, "amount", 0.35)
      : node.kind === "keytrack"
        ? numericParameter(node, "amount", 0.25)
        : node.kind === "modWheel"
          ? numericParameter(node, "amount", 0.3)
          : node.kind === "macro"
            ? numericParameter(node, "amount", 0.25)
    : target === "filter.cutoff"
      ? 0.3
      : 0.25;
  return clamp(amount, -1, 1);
}

function staticCvValueForNode(node: InstrumentNode): number {
  if (node.kind === "constant") return numericParameter(node, "value", 0.5);
  if (node.kind === "random") {
    const seed = Math.round(numericParameter(node, "seed", 1));
    const amount = clamp(numericParameter(node, "amount", 0.5), -1, 1);
    const offset = clamp(numericParameter(node, "offset", 0), -1, 1);
    return clamp(seededBipolar(seed) * amount + offset, -1, 1);
  }
  return 0;
}

function seededBipolar(seed: number): number {
  let value = Math.imul(seed || 1, 747796405) + 2891336453;
  value = Math.imul(value ^ (value >>> 16), 2246822519);
  value = Math.imul(value ^ (value >>> 13), 3266489917);
  return ((value >>> 0) / 0xffffffff) * 2 - 1;
}

function applyConstantCvToDraft(draft: SynthDraftPatch, target: ModulationTargetId, value: number) {
  if (target === "filter.cutoff") {
    draft.parameters[target] = Math.round(20 + clamp01((value + 1) / 2) * 19980);
    return;
  }
  if (target.endsWith(".fine")) {
    draft.parameters[target] = clamp(value * 100, -100, 100);
    return;
  }
  if (target.endsWith(".pan")) {
    draft.parameters[target] = clamp(value, -1, 1);
    return;
  }
  draft.parameters[target] = clamp01(value);
}

function routeIdForCable(cable: InstrumentNodeCable): string {
  return `node_${safeId(cable.id || `${cable.fromNodeId}_${cable.toNodeId}_${cable.toPortId}`)}`;
}

function routeIdForCablePair(sourceCable: InstrumentNodeCable, outputCable: InstrumentNodeCable): string {
  return `node_${safeId(`${sourceCable.id || sourceCable.fromNodeId}_${outputCable.id || outputCable.toNodeId}`)}`;
}

function compileNodeEffectChain(graph: InstrumentNodeGraph, audibleNodes: InstrumentNode[]): TrackEffect[] {
  const effects: TrackEffect[] = [];
  for (const node of audibleNodes) {
    if (!hasUpstreamAudioSource(graph, node.id)) continue;
    if (node.kind === "shaper") {
      effects.push({
        id: `node-fx-${node.id}`,
        kind: "saturator",
        bypassed: false,
        params: {
          drive: percentParameter(node, "drive", 0.2),
          mix: percentParameter(node, "mix", 0.5),
        },
      });
    }
    if (node.kind === "distortion") {
      effects.push({
        id: `node-fx-${node.id}`,
        kind: "distortion",
        bypassed: false,
        params: {
          drive: percentParameter(node, "drive", 0.55),
          shape: percentParameter(node, "shape", 0.35),
          trimDb: numericParameter(node, "trim", 6),
          mix: percentParameter(node, "mix", 0.45),
        },
      });
    }
    if (node.kind === "delay") {
      effects.push({
        id: `node-fx-${node.id}`,
        kind: "delay",
        bypassed: false,
        params: {
          timeMs: Math.round(numericParameter(node, "time", 0.22) * 1000),
          feedback: percentParameter(node, "feedback", 0.28),
          mix: percentParameter(node, "mix", 0.18),
        },
      });
    }
    if (node.kind === "chorus") {
      effects.push({
        id: `node-fx-${node.id}`,
        kind: "chorus",
        bypassed: false,
        params: {
          rateHz: numericParameter(node, "rate", 0.8),
          depthMs: numericParameter(node, "depth", 0.35) * 25,
          delayMs: 12,
          feedback: 8,
          mix: percentParameter(node, "mix", 0.22),
        },
      });
    }
    if (node.kind === "reverb") {
      effects.push({
        id: `node-fx-${node.id}`,
        kind: "reverb",
        bypassed: false,
        params: {
          roomSize: percentParameter(node, "room", 0.4),
          damping: percentParameter(node, "damping", 0.35),
          mix: percentParameter(node, "mix", 0.2),
        },
      });
    }
    if (node.kind === "phaser") {
      effects.push({
        id: `node-fx-${node.id}`,
        kind: "phaser",
        bypassed: false,
        params: {
          rateHz: numericParameter(node, "rate", 0.45),
          centerHz: numericParameter(node, "center", 900),
          depthOct: numericParameter(node, "depth", 1.8),
          feedback: signedPercentParameter(node, "feedback", 0.35),
          mix: percentParameter(node, "mix", 0.45),
        },
      });
    }
    if (node.kind === "flanger") {
      effects.push({
        id: `node-fx-${node.id}`,
        kind: "flanger",
        bypassed: false,
        params: {
          rateHz: numericParameter(node, "rate", 0.28),
          depthMs: numericParameter(node, "depth", 2),
          delayMs: numericParameter(node, "delay", 2.5),
          feedback: signedPercentParameter(node, "feedback", 0.45),
          mix: percentParameter(node, "mix", 0.5),
        },
      });
    }
    if (node.kind === "compressor") {
      effects.push({
        id: `node-fx-${node.id}`,
        kind: "compressor",
        bypassed: false,
        params: {
          thresholdDb: numericParameter(node, "threshold", -18),
          ratio: numericParameter(node, "ratio", 4),
          attackMs: numericParameter(node, "attack", 10),
          releaseMs: numericParameter(node, "release", 120),
          makeupDb: numericParameter(node, "makeup", 0),
          mix: percentParameter(node, "mix", 1),
        },
      });
    }
    if (node.kind === "bitcrush") {
      effects.push({
        id: `node-fx-${node.id}`,
        kind: "bitcrush",
        bypassed: false,
        params: {
          bits: numericParameter(node, "bits", 8),
          rate: percentParameter(node, "rate", 0.5),
          mix: percentParameter(node, "mix", 0.35),
        },
      });
    }
  }
  return effects;
}

function hasUpstreamAudioSource(graph: InstrumentNodeGraph, nodeId: string): boolean {
  const sourceKinds = new Set<InstrumentNodeKind>(["instrument", "oscillator", "noise"]);
  const visited = new Set<string>();
  const queue = graph.cables
    .filter((cable) => cable.toNodeId === nodeId)
    .filter((cable) => {
      const fromPort = portFor(graph.nodes, cable.fromNodeId, cable.fromPortId, "output");
      const toPort = portFor(graph.nodes, cable.toNodeId, cable.toPortId, "input");
      return fromPort?.signal === "audio" && toPort?.signal === "audio";
    })
    .map((cable) => cable.fromNodeId);

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);
    const node = graph.nodes.find((candidate) => candidate.id === currentId);
    if (node && sourceKinds.has(node.kind)) return true;
    for (const cable of graph.cables) {
      if (cable.toNodeId !== currentId) continue;
      const fromPort = portFor(graph.nodes, cable.fromNodeId, cable.fromPortId, "output");
      const toPort = portFor(graph.nodes, cable.toNodeId, cable.toPortId, "input");
      if (fromPort?.signal === "audio" && toPort?.signal === "audio") queue.push(cable.fromNodeId);
    }
  }

  return false;
}

function percentParameter(node: InstrumentNode, id: string, fallback: number): number {
  return Math.round(Math.max(0, Math.min(1, numericParameter(node, id, fallback))) * 100);
}

function signedPercentParameter(node: InstrumentNode, id: string, fallback: number): number {
  return Math.round(Math.max(-1, Math.min(1, numericParameter(node, id, fallback))) * 100);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
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

function inputConnectionKey(nodeId: string, portId: string): string {
  return `${nodeId}:${portId}`;
}

function existingCableOccupiesInput(
  graph: InstrumentNodeGraph,
  cable: InstrumentNodeCable,
  inputPort: InstrumentNodePort,
): boolean {
  if (cable.fromNodeId === cable.toNodeId) return false;
  const fromPort = portFor(graph.nodes, cable.fromNodeId, cable.fromPortId, "output");
  const toPort = portFor(graph.nodes, cable.toNodeId, cable.toPortId, "input");
  return Boolean(fromPort && toPort && toPort.id === inputPort.id && fromPort.signal === inputPort.signal && toPort.signal === inputPort.signal);
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wavetableFromInstrument(instrument: Instrument, oscillator: "a" | "b"): string {
  const value = instrument.synthPatch?.parameters[`osc.${oscillator}.wavetable`];
  if (typeof value === "string") return wavetableForOscillatorValue(value);
  return wavetableForOscillatorValue(instrument.waveform === "wavetable" ? "basic.saw" : instrument.waveform);
}

function wavetableForOscillatorNode(node: InstrumentNode): string {
  const value = node.parameters.wavetable ?? node.parameters.waveform ?? "basic.saw";
  return wavetableForOscillatorValue(String(value));
}

function wavetableForOscillatorValue(value: string): string {
  if (value === "wavetable") return "basic.saw";
  if (["sine", "saw", "square", "triangle", "pulse"].includes(value)) return `basic.${value}`;
  if (["basic.sine", "basic.saw", "basic.square", "basic.triangle", "basic.pulse"].includes(value)) return value;
  return "basic.saw";
}

function warpModeForNode(node: InstrumentNode): "shape" | "fold" | "pinch" | "mirror" {
  const value = node.parameters.warpMode;
  return value === "fold" || value === "pinch" || value === "mirror" ? value : "shape";
}

function cutoffFromKnob(value: number): number {
  return Math.round(120 + Math.max(0, Math.min(1, value)) * 17880);
}

function makeGraphId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
