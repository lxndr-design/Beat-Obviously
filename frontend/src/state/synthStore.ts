import { create } from "zustand";

export const SYNTH_PATCH_SCHEMA_VERSION = 1;
export const SYNTH_PARAMETER_NAMESPACE = "synth";
export const SYNTH_INSTRUMENT_TYPE = "wavetable-synth";

export type WavetableId =
  | "basic.sine"
  | "basic.saw"
  | "basic.square"
  | "basic.triangle"
  | "basic.pulse"
  | `user.${string}`;

export type OscillatorKey = "a" | "b";
export type OscillatorParamSuffix =
  | "enabled"
  | "wavetable"
  | "position"
  | "octave"
  | "semitone"
  | "fine"
  | "level"
  | "pan"
  | "phase"
  | "randomPhase";

export type SynthParameterId =
  | `osc.${OscillatorKey}.${OscillatorParamSuffix}`
  | "unison.enabled"
  | "unison.voices"
  | "unison.detune"
  | "unison.blend"
  | "unison.spread"
  | "filter.enabled"
  | "filter.type"
  | "filter.cutoff"
  | "filter.resonance"
  | "filter.drive"
  | "amp.level"
  | "amp.pan"
  | "env.1.attack"
  | "env.1.decay"
  | "env.1.sustain"
  | "env.1.release"
  | "env.2.attack"
  | "env.2.decay"
  | "env.2.sustain"
  | "env.2.release"
  | "lfo.1.enabled"
  | "lfo.1.rate"
  | "lfo.1.sync"
  | "lfo.1.syncedRate"
  | "lfo.1.shape"
  | "lfo.1.phase"
  | "lfo.1.bipolar"
  | "macro.1"
  | "macro.2"
  | "macro.3"
  | "macro.4";

export type SynthParameterValue = boolean | number | string;

export type ModulationSourceId =
  | "env.1"
  | "env.2"
  | "lfo.1"
  | "lfo.2"
  | "velocity"
  | "keytrack"
  | "modWheel"
  | "macro.1"
  | "macro.2"
  | "macro.3"
  | "macro.4";

export type ModulationTargetId =
  | "osc.a.position"
  | "osc.a.fine"
  | "osc.a.level"
  | "osc.a.pan"
  | "osc.b.position"
  | "osc.b.fine"
  | "osc.b.level"
  | "osc.b.pan"
  | "filter.cutoff"
  | "filter.resonance"
  | "filter.drive"
  | "amp.level"
  | "amp.pan"
  | "unison.detune"
  | "unison.spread";

export interface SynthModulationRoute {
  id: string;
  source: ModulationSourceId;
  target: ModulationTargetId;
  amount: number;
  bipolar: boolean;
  enabled: boolean;
}

export interface SynthDraftPatch {
  schemaVersion: typeof SYNTH_PATCH_SCHEMA_VERSION;
  instrumentType: typeof SYNTH_INSTRUMENT_TYPE;
  namespace: typeof SYNTH_PARAMETER_NAMESPACE;
  name: string;
  parameters: Record<SynthParameterId, SynthParameterValue> & Record<string, SynthParameterValue>;
  modulation: SynthModulationRoute[];
  metadata: {
    createdBy: "Beat";
    tags: string[];
  };
}

interface SynthStoreState {
  draft: SynthDraftPatch;
  selectedOscillator: OscillatorKey;
  setSelectedOscillator: (id: OscillatorKey) => void;
  setDraft: (patch: SynthDraftPatch) => void;
  resetDraft: () => void;
  setParameter: (id: SynthParameterId, value: SynthParameterValue) => void;
  setNumericParameter: (id: SynthParameterId, value: number) => void;
  setBooleanParameter: (id: SynthParameterId, value: boolean) => void;
  setName: (name: string) => void;
  updateModulationRoute: (id: string, patch: Partial<SynthModulationRoute>) => void;
  addModulationRoute: (route?: Partial<SynthModulationRoute>) => void;
  removeModulationRoute: (id: string) => void;
}

export const FACTORY_WAVETABLES: Array<{ id: WavetableId; label: string }> = [
  { id: "basic.sine", label: "Sine" },
  { id: "basic.saw", label: "Saw" },
  { id: "basic.square", label: "Square" },
  { id: "basic.triangle", label: "Triangle" },
  { id: "basic.pulse", label: "Pulse" },
];

export const DEFAULT_SYNTH_PARAMETERS: Record<SynthParameterId, SynthParameterValue> = {
  "osc.a.enabled": true,
  "osc.a.wavetable": "basic.saw",
  "osc.a.position": 0,
  "osc.a.octave": 0,
  "osc.a.semitone": 0,
  "osc.a.fine": 0,
  "osc.a.level": 0.8,
  "osc.a.pan": 0,
  "osc.a.phase": 0,
  "osc.a.randomPhase": 0.25,
  "osc.b.enabled": false,
  "osc.b.wavetable": "basic.square",
  "osc.b.position": 0,
  "osc.b.octave": 0,
  "osc.b.semitone": 0,
  "osc.b.fine": 0,
  "osc.b.level": 0.6,
  "osc.b.pan": 0,
  "osc.b.phase": 0,
  "osc.b.randomPhase": 0.25,
  "unison.enabled": false,
  "unison.voices": 1,
  "unison.detune": 0.12,
  "unison.blend": 0.75,
  "unison.spread": 0.5,
  "filter.enabled": true,
  "filter.type": "lowpass",
  "filter.cutoff": 18000,
  "filter.resonance": 0.1,
  "filter.drive": 0,
  "amp.level": 0.8,
  "amp.pan": 0,
  "env.1.attack": 0.005,
  "env.1.decay": 0.15,
  "env.1.sustain": 0.8,
  "env.1.release": 0.25,
  "env.2.attack": 0.01,
  "env.2.decay": 0.3,
  "env.2.sustain": 0,
  "env.2.release": 0.2,
  "lfo.1.enabled": true,
  "lfo.1.rate": 1,
  "lfo.1.sync": true,
  "lfo.1.syncedRate": "1/4",
  "lfo.1.shape": "sine",
  "lfo.1.phase": 0,
  "lfo.1.bipolar": true,
  "macro.1": 0,
  "macro.2": 0,
  "macro.3": 0,
  "macro.4": 0,
};

export const SYNTH_PARAMETER_LABELS: Record<SynthParameterId, string> = {
  "osc.a.enabled": "OSC A Enabled",
  "osc.a.wavetable": "OSC A Table",
  "osc.a.position": "OSC A Pos",
  "osc.a.octave": "OSC A Oct",
  "osc.a.semitone": "OSC A Semi",
  "osc.a.fine": "OSC A Fine",
  "osc.a.level": "OSC A Level",
  "osc.a.pan": "OSC A Pan",
  "osc.a.phase": "OSC A Phase",
  "osc.a.randomPhase": "OSC A Random",
  "osc.b.enabled": "OSC B Enabled",
  "osc.b.wavetable": "OSC B Table",
  "osc.b.position": "OSC B Pos",
  "osc.b.octave": "OSC B Oct",
  "osc.b.semitone": "OSC B Semi",
  "osc.b.fine": "OSC B Fine",
  "osc.b.level": "OSC B Level",
  "osc.b.pan": "OSC B Pan",
  "osc.b.phase": "OSC B Phase",
  "osc.b.randomPhase": "OSC B Random",
  "unison.enabled": "Unison Enabled",
  "unison.voices": "Unison Voices",
  "unison.detune": "Unison Detune",
  "unison.blend": "Unison Blend",
  "unison.spread": "Unison Spread",
  "filter.enabled": "Filter Enabled",
  "filter.type": "Filter Type",
  "filter.cutoff": "Filter Cutoff",
  "filter.resonance": "Filter Res",
  "filter.drive": "Filter Drive",
  "amp.level": "Amp Level",
  "amp.pan": "Amp Pan",
  "env.1.attack": "Env 1 Attack",
  "env.1.decay": "Env 1 Decay",
  "env.1.sustain": "Env 1 Sustain",
  "env.1.release": "Env 1 Release",
  "env.2.attack": "Env 2 Attack",
  "env.2.decay": "Env 2 Decay",
  "env.2.sustain": "Env 2 Sustain",
  "env.2.release": "Env 2 Release",
  "lfo.1.enabled": "LFO 1 Enabled",
  "lfo.1.rate": "LFO 1 Rate",
  "lfo.1.sync": "LFO 1 Sync",
  "lfo.1.syncedRate": "LFO 1 Sync Rate",
  "lfo.1.shape": "LFO 1 Shape",
  "lfo.1.phase": "LFO 1 Phase",
  "lfo.1.bipolar": "LFO 1 Bipolar",
  "macro.1": "Macro 1",
  "macro.2": "Macro 2",
  "macro.3": "Macro 3",
  "macro.4": "Macro 4",
};

export const MODULATION_SOURCE_LABELS: Record<ModulationSourceId, string> = {
  "env.1": "Env 1",
  "env.2": "Env 2",
  "lfo.1": "LFO 1",
  "lfo.2": "LFO 2",
  velocity: "Velocity",
  keytrack: "Keytrack",
  modWheel: "Mod Wheel",
  "macro.1": "Macro 1",
  "macro.2": "Macro 2",
  "macro.3": "Macro 3",
  "macro.4": "Macro 4",
};

export const MODULATION_TARGET_LABELS: Record<ModulationTargetId, string> = {
  "osc.a.position": "OSC A Pos",
  "osc.a.fine": "OSC A Fine",
  "osc.a.level": "OSC A Level",
  "osc.a.pan": "OSC A Pan",
  "osc.b.position": "OSC B Pos",
  "osc.b.fine": "OSC B Fine",
  "osc.b.level": "OSC B Level",
  "osc.b.pan": "OSC B Pan",
  "filter.cutoff": "Filter Cutoff",
  "filter.resonance": "Filter Res",
  "filter.drive": "Filter Drive",
  "amp.level": "Amp Level",
  "amp.pan": "Amp Pan",
  "unison.detune": "Unison Detune",
  "unison.spread": "Unison Spread",
};

export function createDefaultSynthDraft(): SynthDraftPatch {
  return {
    schemaVersion: SYNTH_PATCH_SCHEMA_VERSION,
    instrumentType: SYNTH_INSTRUMENT_TYPE,
    namespace: SYNTH_PARAMETER_NAMESPACE,
    name: "Init",
    parameters: { ...DEFAULT_SYNTH_PARAMETERS },
    modulation: [
      {
        id: "route_1",
        source: "lfo.1",
        target: "osc.a.position",
        amount: 0.35,
        bipolar: true,
        enabled: true,
      },
      {
        id: "route_2",
        source: "env.1",
        target: "filter.cutoff",
        amount: 0.3,
        bipolar: false,
        enabled: true,
      },
    ],
    metadata: { createdBy: "Beat", tags: [] },
  };
}

export function getNumberParam(draft: SynthDraftPatch, id: SynthParameterId): number {
  const value = draft.parameters[id];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function getBooleanParam(draft: SynthDraftPatch, id: SynthParameterId): boolean {
  return draft.parameters[id] === true;
}

export function getStringParam(draft: SynthDraftPatch, id: SynthParameterId): string {
  const value = draft.parameters[id];
  return typeof value === "string" ? value : "";
}

export const useSynthStore = create<SynthStoreState>((set) => ({
  draft: createDefaultSynthDraft(),
  selectedOscillator: "a",
  setSelectedOscillator: (id) => set({ selectedOscillator: id }),
  setDraft: (draft) => set({ draft }),
  resetDraft: () => set({ draft: createDefaultSynthDraft(), selectedOscillator: "a" }),
  setParameter: (id, value) =>
    set((state) => ({
      draft: {
        ...state.draft,
        parameters: { ...state.draft.parameters, [id]: value },
      },
    })),
  setNumericParameter: (id, value) =>
    set((state) => ({
      draft: {
        ...state.draft,
        parameters: { ...state.draft.parameters, [id]: sanitizeNumber(value, id) },
      },
    })),
  setBooleanParameter: (id, value) =>
    set((state) => ({
      draft: {
        ...state.draft,
        parameters: { ...state.draft.parameters, [id]: value },
      },
    })),
  setName: (name) => set((state) => ({ draft: { ...state.draft, name } })),
  updateModulationRoute: (id, patch) =>
    set((state) => ({
      draft: {
        ...state.draft,
        modulation: state.draft.modulation.map((route) => (route.id === id ? { ...route, ...patch } : route)),
      },
    })),
  addModulationRoute: (route) =>
    set((state) => ({
      draft: {
        ...state.draft,
        modulation: [
          ...state.draft.modulation,
          {
            id: createRouteId(state.draft.modulation),
            source: "macro.1",
            target: "filter.cutoff",
            amount: 0.1,
            bipolar: false,
            enabled: true,
            ...route,
          },
        ],
      },
    })),
  removeModulationRoute: (id) =>
    set((state) => ({
      draft: {
        ...state.draft,
        modulation: state.draft.modulation.filter((route) => route.id !== id),
      },
    })),
}));

function sanitizeNumber(value: number, id: SynthParameterId): number {
  const fallback = DEFAULT_SYNTH_PARAMETERS[id];
  if (!Number.isFinite(value)) return typeof fallback === "number" ? fallback : 0;
  if (id.endsWith(".enabled") || id === "filter.type" || id.endsWith(".wavetable")) return value;
  if (id === "filter.cutoff") return Math.max(20, Math.min(20000, value));
  if (id.includes(".octave")) return Math.max(-4, Math.min(4, Math.round(value)));
  if (id.includes(".semitone")) return Math.max(-12, Math.min(12, Math.round(value)));
  if (id.includes(".fine")) return Math.max(-100, Math.min(100, value));
  if (id === "unison.voices") return Math.max(1, Math.min(16, Math.round(value)));
  if (id.includes(".pan")) return Math.max(-1, Math.min(1, value));
  if (id.includes(".attack") || id.includes(".decay") || id.includes(".release")) return Math.max(0, Math.min(30, value));
  return Math.max(0, Math.min(1, value));
}

function createRouteId(routes: SynthModulationRoute[]): string {
  const used = new Set(routes.map((route) => route.id));
  let index = routes.length + 1;
  let id = `route_${index}`;
  while (used.has(id)) {
    index += 1;
    id = `route_${index}`;
  }
  return id;
}
