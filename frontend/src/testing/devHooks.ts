import type { DecentSamplerUiControl } from "../ipc/schema";
import { db } from "../persistence/dexie";
import type { AetherEffectPresetRecord } from "../state/effectPresets";
import { createDefaultSynthDraft, synthDraftToInstrumentPatch, useSynthStore, type SynthDraftPatch } from "../state/synthStore";
import type { SynthPresetRecord } from "../state/synthPresets";
import { TEMPORARY_DS_INSTRUMENT_SET_ID, useInstrumentStore, usePluginStore, useUiStore } from "../state/store";
import type { PluginAdapter } from "../state/types";
import { compileNodeGraphToInstrumentPatch, createDefaultInstrumentNodeGraph } from "../features/NodeInstrumentEditor/nodeGraph";

type DevDecentSamplerFixture = "lorenzo" | "wide";

const DEV_MIXED_ERA_AETHER_PRESET_ID = "dev-mixed-era-aether";
const DEV_MIXED_ERA_AETHER_INSTRUMENT_ID = "dev-mixed-era-aether-host";
const DEV_MIXED_ERA_AETHER_FX_PRESET_ID = "dev-mixed-era-aether-fx";
const DEV_MIXED_ERA_AETHER_FX_INSTRUMENT_ID = "dev-mixed-era-aether-fx-host";

declare global {
  interface Window {
    __beatTestHooks?: {
      installDecentSamplerFixture: (fixture?: DevDecentSamplerFixture) => {
        pluginId: string;
        instrumentId: string;
      };
      installNodeInstrumentFixture: () => {
        instrumentId: string;
      };
      installMixedEraAetherPresetFixture: () => Promise<{
        presetId: string;
        instrumentId: string;
      }>;
      installMixedEraAetherFxPresetFixture: () => Promise<{
        presetId: string;
        instrumentId: string;
      }>;
      readMixedEraAetherPresetFixtureState: () => {
        name: string;
        selectedOscA: string;
        selectedOscB: string;
        modernName: string | null;
        modernFormant: number | null;
        legacyOnlyName: string | null;
        legacyOnlyKind: string | null;
        legacyOnlyFormant: number | null;
        legacyOnlyPartials: number;
        legacyAliasMatches: boolean;
      };
      readMixedEraAetherFxPresetFixtureState: () => {
        name: string;
        effectKinds: string[];
        firstMix: number | null;
        firstRoomSize: number | null;
        secondFeedback: number | null;
        secondMix: number | null;
        secondBypassed: boolean | null;
      };
    };
  }
}

let installed = false;

export function installBeatDevHooks() {
  if (installed) return;
  installed = true;

  const installDecentSamplerFixture = (fixture: DevDecentSamplerFixture = "lorenzo") => {
    const pluginId = `dev-ds-${fixture}`;
    const instrumentId = `dev-ds-${fixture}-template`;
    const pluginStore = usePluginStore.getState();
    const instrumentStore = useInstrumentStore.getState();

    for (const plugin of pluginStore.plugins) {
      if (plugin.sourcePath === "/dev-fixtures/lorenzos-drums.dspreset" || plugin.id === pluginId) {
        pluginStore.removePlugin(plugin.id);
      }
    }
    for (const instrument of instrumentStore.instruments) {
      if (instrument.source?.url === "/dev-fixtures/lorenzos-drums.dspreset" || instrument.id === instrumentId) {
        instrumentStore.removeInstrument(instrument.id);
      }
    }

    const imageDataUrl = decentSamplerFixtureImage();
    const controls = decentSamplerFixtureControls();
    const nextInstrumentId = instrumentStore.addInstrument({
      id: instrumentId,
      name: "Lorenzos Drums V1 Template",
      icon: "ph:piano-keys",
      kind: "sampler",
      waveform: "sample",
      setId: TEMPORARY_DS_INSTRUMENT_SET_ID,
      sampleUrls: [
        "/samples/dev-ds/kick.wav",
        "/samples/dev-ds/snare.wav",
        "/samples/dev-ds/hat.wav",
      ],
      sampleMap: [
        sampleZone("Kick", 36),
        sampleZone("Snare", 38),
        sampleZone("Hat", 42),
      ],
      descriptors: ["decentsampler", "decent-sampler", "drum", "kick", "snare"],
      source: {
        kind: "plugin",
        label: "DecentSampler compatibility: Lorenzos Drums V1",
        url: "/dev-fixtures/lorenzos-drums.dspreset",
        importedAt: Date.now(),
        pluginId,
      },
      userCreated: true,
    });

    const nextPluginId = pluginStore.addPlugin({
      id: pluginId,
      name: "Lorenzos Drums V1",
      vendor: "DecentSampler",
      version: "1.0.0",
      kind: "renderer",
      format: "decent-sampler",
      status: "installed",
      instrumentMode: "live-instrument",
      sourceFileName: "lorenzos-drums-dev-fixture.dspreset",
      sourcePath: "/dev-fixtures/lorenzos-drums.dspreset",
      uiImageDataUrl: imageDataUrl,
      uiWidth: 812,
      uiHeight: 375,
      sampleCount: 335,
      uiControlCount: controls.length,
      associatedInstrumentId: nextInstrumentId,
      defaultEditorKind: "midi",
      installedAt: Date.now(),
      description: "Development DecentSampler fixture for exercising package UI and instanced instrument flows.",
      uiControlDetails: controls,
    } as Partial<PluginAdapter> & { uiControlDetails: DecentSamplerUiControl[] });

    pluginStore.updatePlugin(nextPluginId, { associatedInstrumentId: nextInstrumentId });
    useUiStore.getState().openEditor({ kind: "plugin", pluginId: nextPluginId });
    return { pluginId: nextPluginId, instrumentId: nextInstrumentId };
  };

  const installNodeInstrumentFixture = () => {
    const instrumentId = "dev-node-synth";
    const instrumentStore = useInstrumentStore.getState();
    const existing = instrumentStore.instruments.find((instrument) => instrument.id === instrumentId);
    if (existing?.userCreated) instrumentStore.removeInstrument(existing.id);

    const nextInstrumentId = instrumentStore.addInstrument({
      id: instrumentId,
      name: "Node Graph Synth",
      icon: "ph:graph",
      kind: "wavetable",
      waveform: "wavetable",
      filterType: "lowpass",
      envelope: { attackMs: 8, decayMs: 180, sustain: 0.66, releaseMs: 360 },
      knobs: { cutoff: 0.54, resonance: 0.26, drive: 0.12, color: 0.78 },
      sampleIds: [],
      userCreated: true,
      source: { kind: "created", label: "Node editor dev fixture" },
    });
    const instrument = instrumentStore.instruments.find((candidate) => candidate.id === nextInstrumentId);
    if (!instrument) return { instrumentId: nextInstrumentId };

    const graph = createDefaultInstrumentNodeGraph(instrument);
    const oscB = graph.nodes.find((node) => node.label === "Oscillator B");
    if (oscB) {
      oscB.parameters.waveform = "triangle";
      oscB.parameters.level = 0.42;
      oscB.parameters.octave = 1;
      oscB.parameters.fine = -8;
    }
    const lfo = graph.nodes.find((node) => node.kind === "lfo");
    if (lfo) {
      lfo.parameters.shape = "triangle";
      lfo.parameters.rate = 0.75;
      lfo.parameters.amount = 0.34;
    }
    const filter = graph.nodes.find((node) => node.kind === "filter");
    if (filter) {
      filter.parameters.cutoff = 6200;
      filter.parameters.resonance = 0.32;
      filter.parameters.drive = 0.14;
    }
    instrumentStore.updateInstrument(nextInstrumentId, compileNodeGraphToInstrumentPatch(graph, instrument));
    useUiStore.getState().openEditor({ kind: "synthInstrument", instrumentId: nextInstrumentId });
    return { instrumentId: nextInstrumentId };
  };

  const installMixedEraAetherPresetFixture = async () => {
    const instrumentStore = useInstrumentStore.getState();
    const existingInstrument = instrumentStore.instruments.find((instrument) => instrument.id === DEV_MIXED_ERA_AETHER_INSTRUMENT_ID);
    if (existingInstrument?.userCreated) instrumentStore.removeInstrument(existingInstrument.id);
    await db.synthPresets.delete(DEV_MIXED_ERA_AETHER_PRESET_ID);
    await db.synthPresets.put(createMixedEraAetherPresetFixture() as unknown as SynthPresetRecord);

    const hostDraft = createDefaultSynthDraft();
    const hostPatch: SynthDraftPatch = {
      ...hostDraft,
      name: "Mixed Era Browser Host",
      metadata: {
        ...hostDraft.metadata,
        tags: [...new Set([...hostDraft.metadata.tags, "dev", "mixed-era"])],
      },
    };
    const nextInstrumentId = instrumentStore.addInstrument({
      ...synthDraftToInstrumentPatch(hostPatch),
      id: DEV_MIXED_ERA_AETHER_INSTRUMENT_ID,
      name: hostPatch.name,
      userCreated: true,
    });
    useSynthStore.getState().bindInstrument(nextInstrumentId);
    useSynthStore.getState().setDraft(hostPatch);
    useUiStore.getState().openEditor({ kind: "synthInstrument", instrumentId: nextInstrumentId });
    return { presetId: DEV_MIXED_ERA_AETHER_PRESET_ID, instrumentId: nextInstrumentId };
  };

  const installMixedEraAetherFxPresetFixture = async () => {
    const instrumentStore = useInstrumentStore.getState();
    const existingInstrument = instrumentStore.instruments.find((instrument) => instrument.id === DEV_MIXED_ERA_AETHER_FX_INSTRUMENT_ID);
    if (existingInstrument?.userCreated) instrumentStore.removeInstrument(existingInstrument.id);
    await db.effectPresets.delete(DEV_MIXED_ERA_AETHER_FX_PRESET_ID);
    await db.effectPresets.put(createMixedEraAetherFxPresetFixture() as unknown as AetherEffectPresetRecord);

    const hostDraft = createDefaultSynthDraft();
    const hostPatch: SynthDraftPatch = {
      ...hostDraft,
      name: "Mixed Era FX Browser Host",
      effects: { filters: [] },
      metadata: {
        ...hostDraft.metadata,
        tags: [...new Set([...hostDraft.metadata.tags, "dev", "mixed-era", "fx"])],
      },
    };
    const nextInstrumentId = instrumentStore.addInstrument({
      ...synthDraftToInstrumentPatch(hostPatch),
      id: DEV_MIXED_ERA_AETHER_FX_INSTRUMENT_ID,
      name: hostPatch.name,
      userCreated: true,
    });
    useSynthStore.getState().bindInstrument(nextInstrumentId);
    useSynthStore.getState().setDraft(hostPatch);
    useUiStore.getState().openEditor({ kind: "synthInstrument", instrumentId: nextInstrumentId });
    return { presetId: DEV_MIXED_ERA_AETHER_FX_PRESET_ID, instrumentId: nextInstrumentId };
  };

  const readMixedEraAetherPresetFixtureState = () => {
    const draft = useSynthStore.getState().draft;
    const modern = draft.metadata.wavemaps?.["user.modern"] ?? null;
    const legacyOnly = draft.metadata.wavemaps?.["user.legacy-only"] ?? null;
    const legacyOnlyAlias = draft.metadata.customWavetables?.["user.legacy-only"] ?? null;
    return {
      name: draft.name,
      selectedOscA: String(draft.parameters["osc.a.wavetable"] ?? ""),
      selectedOscB: String(draft.parameters["osc.b.wavetable"] ?? ""),
      modernName: modern?.name ?? null,
      modernFormant: modern?.frames?.[0]?.formant ?? null,
      legacyOnlyName: legacyOnly?.name ?? null,
      legacyOnlyKind: legacyOnly?.kind ?? null,
      legacyOnlyFormant: legacyOnly?.frames?.[0]?.formant ?? null,
      legacyOnlyPartials: legacyOnly?.frames?.[0]?.partials?.length ?? 0,
      legacyAliasMatches: JSON.stringify(legacyOnly) === JSON.stringify(legacyOnlyAlias),
    };
  };

  const readMixedEraAetherFxPresetFixtureState = () => {
    const draft = useSynthStore.getState().draft;
    const first = draft.effects.filters[0] ?? null;
    const second = draft.effects.filters[1] ?? null;
    return {
      name: draft.name,
      effectKinds: draft.effects.filters.map((effect) => effect.kind),
      firstMix: first?.params.mix ?? null,
      firstRoomSize: first?.params.roomSize ?? null,
      secondFeedback: second?.params.feedback ?? null,
      secondMix: second?.params.mix ?? null,
      secondBypassed: second?.bypassed ?? null,
    };
  };

  window.__beatTestHooks = {
    ...(window.__beatTestHooks ?? {}),
    installDecentSamplerFixture,
    installNodeInstrumentFixture,
    installMixedEraAetherPresetFixture,
    installMixedEraAetherFxPresetFixture,
    readMixedEraAetherPresetFixtureState,
    readMixedEraAetherFxPresetFixtureState,
  };

  document.addEventListener("beat:install-decent-sampler-fixture", (event) => {
    const fixture = event instanceof CustomEvent ? event.detail?.fixture : undefined;
    installDecentSamplerFixture(fixture === "wide" ? "wide" : "lorenzo");
  });

  const fixture = new URLSearchParams(window.location.search).get("beatDevFixture");
  if (fixture === "ds-lorenzo" || fixture === "ds-wide") {
    window.setTimeout(() => {
      installDecentSamplerFixture(fixture === "ds-wide" ? "wide" : "lorenzo");
    }, 0);
  } else if (fixture === "node-instrument") {
    window.setTimeout(() => {
      installNodeInstrumentFixture();
    }, 0);
  } else if (fixture === "aether-mixed-preset") {
    window.setTimeout(() => {
      void installMixedEraAetherPresetFixture();
    }, 0);
  } else if (fixture === "aether-mixed-fx-preset") {
    window.setTimeout(() => {
      void installMixedEraAetherFxPresetFixture();
    }, 0);
  }
}

function createMixedEraAetherPresetFixture() {
  const draft = createDefaultSynthDraft();
  return {
    id: DEV_MIXED_ERA_AETHER_PRESET_ID,
    name: "Mixed Era Browser Aether",
    patch: {
      ...draft,
      name: "Mixed Era Browser Aether",
      parameters: {
        ...draft.parameters,
        "osc.a.wavetable": "user.modern",
        "osc.b.enabled": true,
        "osc.b.wavetable": "user.legacy-only",
        "osc.b.level": 0.46,
      },
      metadata: {
        ...draft.metadata,
        tags: ["legacy", "mixed-era", "browser-smoke"],
        wavemaps: {
          "user.modern": {
            schemaVersion: 1,
            id: "user.modern",
            name: "Modern Current",
            kind: "harmonic-sketch",
            interpolation: "linear",
            morph: 0.12,
            source: { kind: "generated", label: "Modern wavemap" },
            frames: [
              { brightness: 0.42, even: 0.2, fold: 0.12, formant: 0.22, notch: 0.1, skew: 0.1, tilt: 0.2, focus: 0.4, phase: 0.1 },
            ],
          },
        },
        customWavetables: {
          "user.modern": {
            name: "Stale Legacy",
            frames: [{ brightness: 0.01, formant: 0.02 }],
          },
          "user.legacy-only": {
            name: "Legacy Only",
            kind: "resynthesized",
            interpolation: "smooth",
            morph: 0.77,
            source: { kind: "imported-audio", label: "Legacy File", path: "/tmp/legacy.wav" },
            frames: [
              { brightness: 0.82, even: 0.21, fold: 0.17, formant: 0.69, notch: 0.27, skew: -0.42, tilt: -0.19, focus: 0.58, phase: -0.31, partials: [0.9, 0.7, 0.5] },
            ],
          },
        },
      },
    },
    tags: ["legacy", "mixed-era"],
    updatedAt: 1_700_000_225_000,
  };
}

function createMixedEraAetherFxPresetFixture() {
  return {
    id: DEV_MIXED_ERA_AETHER_FX_PRESET_ID,
    name: "Mixed Era Browser FX",
    chain: {
      filters: [
        {
          kind: "reverb",
          params: { mix: 37 },
        },
        {
          kind: "delay",
          bypassed: true,
          params: { timeMs: 680 },
        },
      ],
    },
    tags: ["legacy", "mixed-era", "fx"],
    updatedAt: 1_700_000_325_000,
  };
}

function sampleZone(name: string, note: number) {
  return {
    path: `/samples/dev-ds/${name.toLowerCase()}.wav`,
    name,
    rootNote: note,
    loNote: note,
    hiNote: note,
    loVel: 1,
    hiVel: 127,
    volumeDb: 0,
    pan: 0,
    tuning: 0,
    seqPosition: 1,
  };
}

function decentSamplerFixtureControls(): DecentSamplerUiControl[] {
  return [
    control("labeled-knob", "Tone", 18, 252, 56, 56, "effect", "instrument", "FX_FILTER_FREQUENCY", 0, 20, 22000, 18000),
    control("labeled-knob", "Kick", 468, 82, 64, 64, "amp", "group", "AMP_VOLUME", 0, 0, 1, 1),
    control("labeled-knob", "Snare", 604, 178, 58, 58, "amp", "group", "AMP_VOLUME", 1, 0, 1, 0.82),
    control("labeled-knob", "Hats", 730, 178, 58, 58, "amp", "group", "AMP_VOLUME", 2, 0, 1, 0.72),
    control("labeled-knob", "Room", 682, 272, 58, 58, "effect", "instrument", "FX_REVERB_WET_LEVEL", 1, 0, 1, 0.42),
  ];
}

function control(
  kind: string,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  type: string,
  level: string,
  parameter: string,
  position: number,
  minValue: number,
  maxValue: number,
  value: number,
): DecentSamplerUiControl {
  return {
    kind,
    label,
    x,
    y,
    width,
    height,
    minValue,
    maxValue,
    value,
    bindings: [{ type, level, parameter, position }],
  };
}

function decentSamplerFixtureImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 812 375">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#061424"/>
        <stop offset="0.52" stop-color="#294054"/>
        <stop offset="1" stop-color="#050b13"/>
      </linearGradient>
    </defs>
    <rect width="812" height="375" fill="url(#bg)"/>
    <circle cx="144" cy="206" r="132" fill="#d2c9b6" opacity=".45"/>
    <circle cx="520" cy="126" r="116" fill="#e2dfd4" opacity=".48"/>
    <circle cx="602" cy="340" r="148" fill="#d6d7d1" opacity=".4"/>
    <rect x="452" y="78" width="320" height="230" fill="#071828" opacity=".72"/>
    <g fill="#fff" font-family="Helvetica,Arial,sans-serif" font-weight="700">
      <text x="74" y="172" font-size="28">LORENZO'S DRUMS V1</text>
      <text x="472" y="148" font-size="16">KICK</text>
      <text x="604" y="148" font-size="16">SNARE</text>
      <text x="708" y="148" font-size="16">HATS</text>
      <text x="472" y="250" font-size="14">KICK MIC</text>
      <text x="584" y="250" font-size="14">SNARE MIC</text>
    </g>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
