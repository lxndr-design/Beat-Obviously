import type { DecentSamplerUiControl } from "../ipc/schema";
import { db } from "../persistence/dexie";
import type { AetherEffectPresetRecord } from "../state/effectPresets";
import {
  createDefaultCustomWavetable,
  createDefaultSynthDraft,
  synthDraftToInstrumentPatch,
  useSynthStore,
  type SynthDraftPatch,
  type SynthModulationRoute,
  type SynthParameterId,
} from "../state/synthStore";
import { createSynthPresetRecord, type SynthPresetRecord } from "../state/synthPresets";
import {
  TEMPORARY_DS_INSTRUMENT_SET_ID,
  USER_INSTRUMENT_SET_ID,
  createEmptyProject,
  useInstrumentStore,
  usePluginStore,
  useProjectStore,
  useUiStore,
  useViewStore,
} from "../state/store";
import type { MidiAutomationTarget, PluginAdapter } from "../state/types";
import { compileNodeGraphToInstrumentPatch, createDefaultInstrumentNodeGraph } from "../features/NodeInstrumentEditor/nodeGraph";

type DevDecentSamplerFixture = "lorenzo" | "wide";
type DevAetherAutomationEditor = "arrangement" | "track" | "segment" | "note";
type DevAetherAutomationPointEditor = Exclude<DevAetherAutomationEditor, "arrangement">;

const DEV_MIXED_ERA_AETHER_PRESET_ID = "dev-mixed-era-aether";
const DEV_MIXED_ERA_AETHER_INSTRUMENT_ID = "dev-mixed-era-aether-host";
const DEV_MIXED_ERA_AETHER_FX_PRESET_ID = "dev-mixed-era-aether-fx";
const DEV_MIXED_ERA_AETHER_FX_INSTRUMENT_ID = "dev-mixed-era-aether-fx-host";
const DEV_AETHER_PRESET_LIBRARY_FAVORITE_ID = "dev-aether-preset-library-favorite";
const DEV_AETHER_PRESET_LIBRARY_PLAIN_ID = "dev-aether-preset-library-plain";
const DEV_AETHER_PRESET_LIBRARY_INSTRUMENT_ID = "dev-aether-preset-library-host";
const DEV_AETHER_PRESET_SAVE_DELETE_NAME = "Browser Saved Lead";
const DEV_AETHER_OSCILLATOR_INSTRUMENT_ID = "dev-aether-oscillator-host";
const DEV_AETHER_OSCILLATOR_INSTRUMENT_ID_MARKER = "Aether oscillator editor dev fixture";
const DEV_AETHER_FX_RACK_INSTRUMENT_ID = "dev-aether-fx-rack-host";
const DEV_AETHER_FX_RACK_INSTRUMENT_ID_MARKER = "Aether FX rack editor dev fixture";
const DEV_AETHER_MACRO_INSTRUMENT_ID = "dev-aether-macro-host";
const DEV_AETHER_MACRO_INSTRUMENT_ID_MARKER = "Aether macro browser dev fixture";
const DEV_AETHER_WAVEMAP_INSTRUMENT_ID = "dev-aether-wavemap-editor-host";
const DEV_AETHER_WAVEMAP_INSTRUMENT_ID_MARKER = "Aether wavemap editor dev fixture";
const DEV_AETHER_WAVEMAP_ID = "user.browser-wavemap";
const DEV_AETHER_ENVELOPE_INSTRUMENT_ID = "dev-aether-envelope-host";
const DEV_AETHER_ENVELOPE_INSTRUMENT_ID_MARKER = "Aether envelope editor dev fixture";
const DEV_AETHER_AMP_FILTER_INSTRUMENT_ID = "dev-aether-amp-filter-host";
const DEV_AETHER_AMP_FILTER_INSTRUMENT_ID_MARKER = "Aether amp/filter editor dev fixture";
const DEV_AETHER_LFO_INSTRUMENT_ID = "dev-aether-lfo-host";
const DEV_AETHER_LFO_INSTRUMENT_ID_MARKER = "Aether LFO editor dev fixture";
const DEV_AETHER_PERFORMANCE_INSTRUMENT_ID = "dev-aether-performance-host";
const DEV_AETHER_PERFORMANCE_INSTRUMENT_ID_MARKER = "Aether performance editor dev fixture";
const DEV_AETHER_AUTOMATION_INSTRUMENT_ID_MARKER = "Aether automation dev fixture";
const DEV_AETHER_AUTOMATION_TRACK_ID = "dev-aether-automation-track";
const DEV_AETHER_AUTOMATION_SEGMENT_ID = "dev-aether-automation-segment";
const USER_PRESET_PREFIX = "user:";

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
      installAetherPresetLibraryFixture: () => Promise<{
        favoritePresetId: string;
        plainPresetId: string;
        instrumentId: string;
      }>;
      readAetherPresetLibraryFixtureState: () => Promise<DevAetherPresetLibraryFixtureState>;
      installAetherMacroFixture: () => Promise<{
        instrumentId: string;
      }>;
      readAetherMacroFixtureState: () => DevAetherMacroFixtureState;
      exerciseAetherOscillatorEditorFlow: () => Promise<DevAetherOscillatorExerciseState>;
      exerciseAetherFxRackEditorFlow: () => Promise<DevAetherFxRackExerciseState>;
      exerciseAetherMacroAssignmentEditorFlow: () => Promise<DevAetherMacroAssignmentExerciseState>;
      exerciseAetherWavemapEditorFlow: () => Promise<DevAetherWavemapEditorFixtureState>;
      exerciseAetherWavemapPointerDrawFlow: () => Promise<DevAetherWavemapPointerDrawExerciseState>;
      exerciseAetherWavemapImportFlow: () => Promise<DevAetherWavemapImportExerciseState>;
      exerciseAetherEnvelopeHandleFlow: () => Promise<DevAetherEnvelopeHandleExerciseState>;
      exerciseAetherAmpFilterEditorFlow: () => Promise<DevAetherAmpFilterExerciseState>;
      exerciseAetherLfoEditorFlow: () => Promise<DevAetherLfoExerciseState>;
      exerciseAetherPerformanceEditorFlow: () => Promise<DevAetherPerformanceExerciseState>;
      exerciseAetherPresetLibraryFavoriteFlow: () => Promise<{
        installed: DevAetherPresetLibraryFixtureState;
        filtered: DevAetherPresetLibraryFixtureState;
        selected: DevAetherPresetLibraryFixtureState;
        toggled: DevAetherPresetLibraryFixtureState;
      }>;
      exerciseAetherPresetRestoreInitFlow: () => Promise<DevAetherPresetRestoreInitExerciseState>;
      exerciseAetherPresetSaveDeleteFlow: () => Promise<DevAetherPresetSaveDeleteExerciseState>;
      installAetherAutomationFixture: () => {
        trackId: string;
        segmentId: string;
        instrumentId: string;
      };
      openAetherAutomationFixtureEditor: (editor: DevAetherAutomationEditor) => Promise<DevAetherAutomationFixtureState>;
      readAetherAutomationFixtureState: () => DevAetherAutomationFixtureState;
      exerciseAetherAutomationPointEditorFlow: () => Promise<DevAetherAutomationPointExerciseState>;
      exerciseAetherDirectAutomationPointEditorFlow: () => Promise<DevAetherDirectAutomationPointExerciseState>;
      exerciseAetherArrangementAutomationDragFlow: () => Promise<DevAetherArrangementAutomationDragExerciseState>;
      exerciseAetherNoteAutomationDragFlow: () => Promise<DevAetherNoteAutomationDragExerciseState>;
      exerciseAetherSegmentAutomationDragFlow: () => Promise<DevAetherSegmentAutomationDragExerciseState>;
      exerciseAetherTrackAutomationDragFlow: () => Promise<DevAetherTrackAutomationDragExerciseState>;
    };
  }
}

interface DevAutomationPanelState {
  exists: boolean;
  text: string;
  buttonLabels: string[];
  rangeCount: number;
  disabledControlCount: number;
}

interface DevAetherAutomationFixtureState {
  trackId: string | null;
  segmentId: string | null;
  instrumentId: string | null;
  openEditors: string[];
  trackLaneTargets: MidiAutomationTarget[];
  segmentLaneTargets: MidiAutomationTarget[];
  noteLaneTargets: MidiAutomationTarget[];
  arrangementLane: {
    exists: boolean;
    target: string | null;
    text: string;
    pointCount: number;
  };
  panels: {
    note: DevAutomationPanelState;
    segment: DevAutomationPanelState;
    track: DevAutomationPanelState;
  };
}

interface DevAutomationPointSnapshot {
  beat: number;
  value: number;
  curve: string | null;
}

interface DevAutomationPointEditorExercise {
  editor: DevAetherAutomationPointEditor;
  target: MidiAutomationTarget;
  before: DevAutomationPointSnapshot[];
  curveBefore: string | null;
  curveAfter: string | null;
  afterAdd: DevAutomationPointSnapshot[];
  afterEdit: DevAutomationPointSnapshot[];
  afterQuantize: DevAutomationPointSnapshot[];
  afterSnap: DevAutomationPointSnapshot[];
  afterSelect: DevAutomationPointSnapshot[];
  afterCopy: DevAutomationPointSnapshot[];
  afterPaste: DevAutomationPointSnapshot[];
  afterRemove: DevAutomationPointSnapshot[];
  afterClear: DevAutomationPointSnapshot[];
  selectedPointCount: number;
  pointPanelText: string;
}

interface DevAetherAutomationPointExerciseState {
  track: DevAutomationPointEditorExercise;
  segment: DevAutomationPointEditorExercise;
  note: DevAutomationPointEditorExercise;
}

interface DevAetherDirectAutomationPointExerciseState {
  target: MidiAutomationTarget;
  track: DevAutomationPointEditorExercise;
  segment: DevAutomationPointEditorExercise;
  note: DevAutomationPointEditorExercise;
}

interface DevAetherArrangementAutomationPointSnapshot {
  beat: number;
  value: number;
  curve: string | null;
}

interface DevAetherArrangementAutomationDragExerciseState {
  before: DevAetherArrangementAutomationPointSnapshot[];
  afterFreeDrag: DevAetherArrangementAutomationPointSnapshot[];
  afterShiftDrag: DevAetherArrangementAutomationPointSnapshot[];
  arrangementLane: DevAetherAutomationFixtureState["arrangementLane"];
}

interface DevAetherNoteAutomationHandleState {
  exists: boolean;
  label: string | null;
  left: string | null;
}

interface DevAetherNoteAutomationDragExerciseState {
  before: DevAutomationPointSnapshot[];
  afterStartDrag: DevAutomationPointSnapshot[];
  afterMidDrag: DevAutomationPointSnapshot[];
  afterEndDrag: DevAutomationPointSnapshot[];
  handles: {
    start: DevAetherNoteAutomationHandleState;
    mid: DevAetherNoteAutomationHandleState;
    end: DevAetherNoteAutomationHandleState;
  };
  pointPanelText: string;
}

interface DevAetherSegmentAutomationHandleState {
  exists: boolean;
  label: string | null;
  left: string | null;
}

interface DevAetherSegmentAutomationDragExerciseState {
  before: DevAutomationPointSnapshot[];
  afterStartDrag: DevAutomationPointSnapshot[];
  afterMidDrag: DevAutomationPointSnapshot[];
  afterEndDrag: DevAutomationPointSnapshot[];
  handles: {
    start: DevAetherSegmentAutomationHandleState;
    mid: DevAetherSegmentAutomationHandleState;
    end: DevAetherSegmentAutomationHandleState;
  };
  pointPanelText: string;
}

interface DevAetherTrackAutomationHandleState {
  exists: boolean;
  label: string | null;
  left: string | null;
}

interface DevAetherTrackAutomationDragExerciseState {
  before: DevAutomationPointSnapshot[];
  afterStartDrag: DevAutomationPointSnapshot[];
  afterMidDrag: DevAutomationPointSnapshot[];
  afterEndDrag: DevAutomationPointSnapshot[];
  handles: {
    start: DevAetherTrackAutomationHandleState;
    mid: DevAetherTrackAutomationHandleState;
    end: DevAetherTrackAutomationHandleState;
  };
  pointPanelText: string;
}

interface DevAetherPresetLibraryFixtureState {
  favoritePresetId: string;
  plainPresetId: string;
  instrumentId: string | null;
  favoriteRecordFavorite: boolean | null;
  plainRecordFavorite: boolean | null;
  selectedPresetValue: string;
  sortValue: string;
  optionLabels: string[];
  enabledOptionLabels: string[];
  selectedInfoText: string;
  presetStatsText: string;
  favoritesFilterText: string | null;
  selectedFavoriteToggleText: string | null;
  auditionButtonText: string | null;
  auditionButtonDisabled: boolean | null;
  draftName: string;
  filterCutoff: number | null;
  oscAPosition: number | null;
  instrumentEffectCount: number;
}

interface DevAetherPresetRestoreInitExerciseState {
  installed: DevAetherPresetLibraryFixtureState;
  loaded: DevAetherPresetLibraryFixtureState;
  restored: DevAetherPresetLibraryFixtureState;
}

interface DevAetherPresetSaveDeleteExerciseState {
  installed: DevAetherPresetLibraryFixtureState;
  afterSave: DevAetherPresetLibraryFixtureState;
  afterDelete: DevAetherPresetLibraryFixtureState;
  savedPresetId: string | null;
  savedPresetName: string;
  savedRecordExistedAfterSave: boolean;
  savedRecordExistsAfterDelete: boolean;
}

interface DevAetherMacroFixtureState {
  instrumentId: string | null;
  macroPanelText: string;
  brightness: {
    cardText: string;
    laneText: string;
    assignmentsText: string;
    conflictText: string;
    conflictDetails: string[];
  };
}

interface DevModulationRouteSnapshot {
  id: string;
  source: string;
  target: string;
  amount: number;
  enabled: boolean;
  rowText: string;
}

interface DevAetherMacroAssignmentExerciseState {
  before: DevModulationRouteSnapshot[];
  afterAdd: DevModulationRouteSnapshot[];
  afterEdit: DevModulationRouteSnapshot[];
  afterDisable: DevModulationRouteSnapshot[];
  macroAfterEdit: DevAetherMacroFixtureState;
  macroAfterDisable: DevAetherMacroFixtureState;
  matrixText: string;
}

interface DevAetherOscillatorSnapshot {
  instrumentId: string | null;
  oscAEnabled: boolean;
  oscAWavetable: string | null;
  oscAWarpMode: string | null;
  oscAPosition: number | null;
  oscAWarp: number | null;
  oscALevel: number | null;
  oscAPan: number | null;
  oscAFine: number | null;
  oscBEnabled: boolean;
  oscBWavetable: string | null;
  oscBWarpMode: string | null;
  oscBLevel: number | null;
  oscBPan: number | null;
  oscBRowText: string;
  oscBHasWavetableControls: boolean;
  oscBPowerButtonLabel: string | null;
  unisonEnabled: boolean;
  unisonVoices: number | null;
  unisonDetune: number | null;
  unisonBlend: number | null;
  unisonSpread: number | null;
  mono: boolean;
  legato: boolean;
  panelText: string;
}

interface DevAetherOscillatorExerciseState {
  instrumentId: string | null;
  before: DevAetherOscillatorSnapshot;
  afterEdit: DevAetherOscillatorSnapshot;
  afterDisable: DevAetherOscillatorSnapshot;
  afterReenable: DevAetherOscillatorSnapshot;
}

interface DevAetherFxRackSnapshot {
  instrumentId: string | null;
  effectKinds: string[];
  bypassed: boolean[];
  params: Array<Record<string, number>>;
  detailsText: string;
  blockTexts: string[];
}

interface DevAetherFxRackExerciseState {
  instrumentId: string | null;
  before: DevAetherFxRackSnapshot;
  afterAdd: DevAetherFxRackSnapshot;
  afterParamEdit: DevAetherFxRackSnapshot;
  afterMove: DevAetherFxRackSnapshot;
  afterBypass: DevAetherFxRackSnapshot;
  afterRemove: DevAetherFxRackSnapshot;
}

interface DevAetherWavemapEditorFixtureState {
  instrumentId: string | null;
  selectedWavetable: string;
  editorText: string;
  analysisText: string;
  manualRangeText: string;
  interpolation: string | null;
  morph: number | null;
  firstPartials: number[];
  firstFrameBrightness: number | null;
  visibleModes: {
    details: boolean;
    additive: boolean;
    manual: boolean;
    smooth: boolean;
  };
}

interface DevAetherEnvelopeSnapshot {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  attackCurve: string;
  decayCurve: string;
  releaseCurve: string;
  cardText: string;
  handleLabels: {
    attack: string | null;
    decaySustain: string | null;
    release: string | null;
  };
  curveLabels: {
    attack: string | null;
    decay: string | null;
    release: string | null;
  };
}

interface DevAetherEnvelopeHandleExerciseState {
  instrumentId: string | null;
  before: DevAetherEnvelopeSnapshot;
  afterAttackDrag: DevAetherEnvelopeSnapshot;
  afterDecaySustainDrag: DevAetherEnvelopeSnapshot;
  afterReleaseDrag: DevAetherEnvelopeSnapshot;
  afterCurveCycle: DevAetherEnvelopeSnapshot;
}

interface DevAetherLfoSnapshot {
  instrumentId: string | null;
  enabled: boolean;
  sync: boolean;
  syncedRate: string | null;
  rate: number | null;
  shape: string | null;
  phase: number | null;
  smoothing: number | null;
  randomPhase: number | null;
  retrigger: boolean;
  oneShot: boolean;
  laneText: string;
  panelText: string;
}

interface DevAetherLfoExerciseState {
  instrumentId: string | null;
  before: DevAetherLfoSnapshot;
  afterEdit: DevAetherLfoSnapshot;
}

interface DevAetherAmpFilterSnapshot {
  instrumentId: string | null;
  filterEnabled: boolean;
  filterType: string | null;
  cutoff: number | null;
  resonance: number | null;
  keytrack: number | null;
  drive: number | null;
  ampLevel: number | null;
  ampPan: number | null;
  env1Loop: boolean;
  env2Loop: boolean;
  panelText: string;
}

interface DevAetherAmpFilterExerciseState {
  instrumentId: string | null;
  before: DevAetherAmpFilterSnapshot;
  afterEdit: DevAetherAmpFilterSnapshot;
}

interface DevAetherPerformanceSnapshot {
  instrumentId: string | null;
  voices: number | null;
  glideMs: number | null;
  mono: boolean;
  legato: boolean;
  panelText: string;
  readoutText: string;
  readoutCount: number;
}

interface DevAetherPerformanceExerciseState {
  instrumentId: string | null;
  before: DevAetherPerformanceSnapshot;
  afterEdit: DevAetherPerformanceSnapshot;
}

interface DevAetherWavemapFrameSnapshot {
  brightness: number | null;
  even: number | null;
  fold: number | null;
  formant: number | null;
  notch: number | null;
  skew: number | null;
  tilt: number | null;
  focus: number | null;
  phase: number | null;
  partials: number[];
  analysis: {
    rms: number | null;
    peak: number | null;
    zeroCrossRate: number | null;
    roughness: number | null;
    spectralCentroid: number | null;
  };
}

interface DevAetherWavemapPointerDrawExerciseState {
  before: DevAetherWavemapFrameSnapshot;
  afterDraw: DevAetherWavemapFrameSnapshot;
  editor: DevAetherWavemapEditorFixtureState;
  drawSurface: {
    exists: boolean;
    label: string | null;
    pathChanged: boolean;
  };
}

interface DevAetherWavemapSourceSnapshot {
  sourceKind: string | null;
  sourceLabel: string | null;
  audioFileId: string | null;
  sampleRate: number | null;
  channelCount: number | null;
  bitDepth: number | null;
  sourceSampleCount: number | null;
  sourceStartSample: number | null;
  sourceEndSample: number | null;
  frameCount: number;
}

interface DevAetherWavemapImportExerciseState {
  before: DevAetherWavemapSourceSnapshot;
  afterImport: DevAetherWavemapSourceSnapshot;
  editor: DevAetherWavemapEditorFixtureState;
  firstFrame: DevAetherWavemapFrameSnapshot;
  manualRangeText: string;
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

  const installAetherPresetLibraryFixture = async () => {
    const instrumentStore = useInstrumentStore.getState();
    const existingInstrument = instrumentStore.instruments.find((instrument) => instrument.id === DEV_AETHER_PRESET_LIBRARY_INSTRUMENT_ID);
    if (existingInstrument?.userCreated) instrumentStore.removeInstrument(existingInstrument.id);
    const staleSaveDeleteRecords = (await db.synthPresets.where("name").equals(DEV_AETHER_PRESET_SAVE_DELETE_NAME).toArray()).map((record) => record.id);
    await db.synthPresets.bulkDelete([DEV_AETHER_PRESET_LIBRARY_FAVORITE_ID, DEV_AETHER_PRESET_LIBRARY_PLAIN_ID]);
    if (staleSaveDeleteRecords.length > 0) await db.synthPresets.bulkDelete(staleSaveDeleteRecords);
    await db.synthPresets.bulkPut([
      createAetherPresetLibraryFixtureRecord({
        id: DEV_AETHER_PRESET_LIBRARY_FAVORITE_ID,
        name: "Favorite Browser Lead",
        tags: ["browser-smoke", "favorite", "lead"],
        favorite: true,
        cutoff: 0.72,
      }) as unknown as SynthPresetRecord,
      createAetherPresetLibraryFixtureRecord({
        id: DEV_AETHER_PRESET_LIBRARY_PLAIN_ID,
        name: "Plain Browser Pad",
        tags: ["browser-smoke", "plain", "pad"],
        favorite: false,
        cutoff: 0.38,
      }) as unknown as SynthPresetRecord,
    ]);

    const hostDraft = createDefaultSynthDraft();
    const hostPatch: SynthDraftPatch = {
      ...hostDraft,
      name: "Preset Library Browser Host",
      metadata: {
        ...hostDraft.metadata,
        tags: [...new Set([...hostDraft.metadata.tags, "dev", "preset-library"])],
      },
    };
    const nextInstrumentId = instrumentStore.addInstrument({
      ...synthDraftToInstrumentPatch(hostPatch),
      id: DEV_AETHER_PRESET_LIBRARY_INSTRUMENT_ID,
      name: hostPatch.name,
      userCreated: true,
    });
    useSynthStore.getState().bindInstrument(nextInstrumentId);
    useSynthStore.getState().setDraft(hostPatch);
    useUiStore.getState().openEditor({ kind: "synthInstrument", instrumentId: nextInstrumentId });
    await waitForPresetOption("Favorite Browser Lead");
    return {
      favoritePresetId: DEV_AETHER_PRESET_LIBRARY_FAVORITE_ID,
      plainPresetId: DEV_AETHER_PRESET_LIBRARY_PLAIN_ID,
      instrumentId: nextInstrumentId,
    };
  };

  const readAetherPresetLibraryFixtureState = async (): Promise<DevAetherPresetLibraryFixtureState> => {
    const draft = useSynthStore.getState().draft;
    const favoriteRecord = await db.synthPresets.get(DEV_AETHER_PRESET_LIBRARY_FAVORITE_ID);
    const plainRecord = await db.synthPresets.get(DEV_AETHER_PRESET_LIBRARY_PLAIN_ID);
    const presetSelect = findFieldSelect("Preset");
    const sortSelect = findFieldSelect("Sort");
    const options = Array.from(presetSelect?.options ?? []);
    return {
      favoritePresetId: DEV_AETHER_PRESET_LIBRARY_FAVORITE_ID,
      plainPresetId: DEV_AETHER_PRESET_LIBRARY_PLAIN_ID,
      instrumentId: useSynthStore.getState().boundInstrumentId,
      favoriteRecordFavorite: favoriteRecord?.favorite ?? null,
      plainRecordFavorite: plainRecord?.favorite ?? null,
      selectedPresetValue: presetSelect?.value ?? "",
      sortValue: sortSelect?.value ?? "",
      optionLabels: options.map((option) => option.label),
      enabledOptionLabels: options.filter((option) => !option.disabled && option.value).map((option) => option.label),
      selectedInfoText: normalizeText(document.querySelector<HTMLElement>('[aria-label="Selected Aether preset details"]')?.textContent ?? ""),
      presetStatsText: normalizeText(document.querySelector<HTMLElement>('[aria-label="Aether preset library summary"]')?.textContent ?? ""),
      favoritesFilterText: normalizeText(findButton("Toggle preset favorites filter")?.textContent ?? "") || null,
      selectedFavoriteToggleText: normalizeText(findButton("Toggle selected Aether preset favorite")?.textContent ?? "") || null,
      auditionButtonText: normalizeText(findButton("Audition selected Aether preset")?.textContent ?? "") || null,
      auditionButtonDisabled: findButton("Audition selected Aether preset")?.disabled ?? null,
      draftName: draft.name,
      filterCutoff: typeof draft.parameters["filter.cutoff"] === "number" ? draft.parameters["filter.cutoff"] : null,
      oscAPosition: typeof draft.parameters["osc.a.position"] === "number" ? draft.parameters["osc.a.position"] : null,
      instrumentEffectCount: draft.effects.filters.length,
    };
  };

  const exerciseAetherPresetLibraryFavoriteFlow = async () => {
    await installAetherPresetLibraryFixture();
    const installed = await readAetherPresetLibraryFixtureState();
    setFieldSelectValue("Sort", "favorite");
    await nextFrame();
    clickButton("Toggle preset favorites filter");
    await nextFrame();
    const filtered = await readAetherPresetLibraryFixtureState();
    setFieldSelectValue("Preset", `${USER_PRESET_PREFIX}${DEV_AETHER_PRESET_LIBRARY_FAVORITE_ID}`);
    await nextFrame();
    const selected = await readAetherPresetLibraryFixtureState();
    clickButton("Toggle selected Aether preset favorite");
    await waitForPresetFavorite(DEV_AETHER_PRESET_LIBRARY_FAVORITE_ID, false);
    const toggled = await readAetherPresetLibraryFixtureState();
    return { installed, filtered, selected, toggled };
  };

  const exerciseAetherPresetRestoreInitFlow = async (): Promise<DevAetherPresetRestoreInitExerciseState> => {
    await installAetherPresetLibraryFixture();
    const installed = await readAetherPresetLibraryFixtureState();
    setFieldSelectValue("Preset", `${USER_PRESET_PREFIX}${DEV_AETHER_PRESET_LIBRARY_PLAIN_ID}`);
    await nextFrame();
    const loaded = await readAetherPresetLibraryFixtureState();
    clickButton("Restore Init");
    await nextFrame();
    const restored = await readAetherPresetLibraryFixtureState();
    const state: DevAetherPresetRestoreInitExerciseState = { installed, loaded, restored };
    writeAetherPresetRestoreInitExerciseMarker(state);
    return state;
  };

  const exerciseAetherPresetSaveDeleteFlow = async (): Promise<DevAetherPresetSaveDeleteExerciseState> => {
    await installAetherPresetLibraryFixture();
    const installed = await readAetherPresetLibraryFixtureState();
    clickButton("Save As");
    await completePromptDialog("Preset name", DEV_AETHER_PRESET_SAVE_DELETE_NAME);
    await waitForPresetOption(DEV_AETHER_PRESET_SAVE_DELETE_NAME);
    const savedRecord = await waitForSynthPresetNamed(DEV_AETHER_PRESET_SAVE_DELETE_NAME);
    const afterSave = await readAetherPresetLibraryFixtureState();
    clickButton("Delete");
    if (savedRecord) await waitForSynthPresetDeleted(savedRecord.id);
    await nextFrame();
    const afterDelete = await readAetherPresetLibraryFixtureState();
    const state: DevAetherPresetSaveDeleteExerciseState = {
      installed,
      afterSave,
      afterDelete,
      savedPresetId: savedRecord?.id ?? null,
      savedPresetName: DEV_AETHER_PRESET_SAVE_DELETE_NAME,
      savedRecordExistedAfterSave: Boolean(savedRecord),
      savedRecordExistsAfterDelete: savedRecord ? Boolean(await db.synthPresets.get(savedRecord.id)) : true,
    };
    writeAetherPresetSaveDeleteExerciseMarker(state);
    return state;
  };

  const installAetherOscillatorFixtureBase = async () => {
    const instrumentStore = useInstrumentStore.getState();
    for (const instrument of instrumentStore.instruments) {
      if ((instrument.id === DEV_AETHER_OSCILLATOR_INSTRUMENT_ID || instrument.source?.label === DEV_AETHER_OSCILLATOR_INSTRUMENT_ID_MARKER) && instrument.userCreated) {
        instrumentStore.removeInstrument(instrument.id);
      }
    }

    const baseDraft = createDefaultSynthDraft();
    const patch: SynthDraftPatch = {
      ...baseDraft,
      name: "Oscillator Browser Host",
      parameters: {
        ...baseDraft.parameters,
        "osc.a.enabled": true,
        "osc.a.wavetable": "basic.saw",
        "osc.a.warpMode": "shape",
        "osc.a.position": 0.12,
        "osc.a.warp": 0.2,
        "osc.a.level": 0.8,
        "osc.a.pan": 0,
        "osc.a.fine": 0,
        "osc.b.enabled": false,
        "osc.b.wavetable": "basic.square",
        "osc.b.warpMode": "shape",
        "osc.b.level": 0.6,
        "osc.b.pan": 0,
        "unison.enabled": false,
        "unison.voices": 1,
        "unison.detune": 0.12,
        "unison.blend": 0.75,
        "unison.spread": 0.5,
        "mono.enabled": false,
        "legato.enabled": false,
      },
      metadata: {
        ...baseDraft.metadata,
        tags: [...new Set([...baseDraft.metadata.tags, "dev", "oscillator-browser"])],
      },
    };

    const nextInstrumentId = instrumentStore.addInstrument({
      ...synthDraftToInstrumentPatch(patch),
      id: DEV_AETHER_OSCILLATOR_INSTRUMENT_ID,
      name: patch.name,
      source: { kind: "created", label: DEV_AETHER_OSCILLATOR_INSTRUMENT_ID_MARKER },
      userCreated: true,
    });
    useSynthStore.getState().bindInstrument(nextInstrumentId);
    useSynthStore.getState().setDraft(patch);
    useUiStore.getState().openEditor({ kind: "synthInstrument", instrumentId: nextInstrumentId });
    await waitForEditorPanel("Oscillator");
    return { instrumentId: nextInstrumentId };
  };

  const exerciseAetherOscillatorEditorFlow = async (): Promise<DevAetherOscillatorExerciseState> => {
    await installAetherOscillatorFixtureBase();
    const before = readAetherOscillatorSnapshot();
    clickRadioInRegion("Oscillator A row", "Wavetable", "Triangle");
    clickRadioInRegion("Oscillator A row", "Warp mode", "Mirror warp mode");
    await setKnobValueInRegion("Oscillator A row", "Position", "0.33");
    await setKnobValueInRegion("Oscillator A row", "Warp", "0.58");
    await setKnobValueInRegion("Oscillator A row", "Level", "0.67");
    await setKnobValueInRegion("Oscillator A row", "Pan", "-0.24");
    await setKnobValueInRegion("Oscillator A row", "Fine", "14");
    clickPanelButton("Oscillator B row", "Enable Oscillator B");
    await nextFrame();
    clickRadioInRegion("Oscillator B row", "Wavetable", "Pulse");
    clickRadioInRegion("Oscillator B row", "Warp mode", "Fold warp mode");
    await setKnobValueInRegion("Oscillator B row", "Level", "0.41");
    await setKnobValueInRegion("Oscillator B row", "Pan", "0.28");
    clickPanelButton("Voice stack row", "Enable mono voice mode");
    await nextFrame();
    clickPanelButton("Voice stack row", "Enable legato retune mode");
    clickPanelButton("Voice stack row", "Enable voice stack");
    await nextFrame();
    await setKnobValueInRegion("Voice stack row", "Voices", "5");
    await setKnobValueInRegion("Voice stack row", "Detune", "0.23");
    await setKnobValueInRegion("Voice stack row", "Blend", "0.64");
    await setKnobValueInRegion("Voice stack row", "Spread", "0.79");
    await nextFrame();
    const afterEdit = readAetherOscillatorSnapshot();
    clickPanelButton("Oscillator B row", "Disable Oscillator B");
    await nextFrame();
    const afterDisable = readAetherOscillatorSnapshot();
    clickPanelButton("Oscillator B row", "Enable Oscillator B");
    await nextFrame();
    const state: DevAetherOscillatorExerciseState = {
      instrumentId: useSynthStore.getState().boundInstrumentId,
      before,
      afterEdit,
      afterDisable,
      afterReenable: readAetherOscillatorSnapshot(),
    };
    writeAetherOscillatorExerciseMarker(state);
    return state;
  };

  const installAetherFxRackFixtureBase = async () => {
    const instrumentStore = useInstrumentStore.getState();
    for (const instrument of instrumentStore.instruments) {
      if ((instrument.id === DEV_AETHER_FX_RACK_INSTRUMENT_ID || instrument.source?.label === DEV_AETHER_FX_RACK_INSTRUMENT_ID_MARKER) && instrument.userCreated) {
        instrumentStore.removeInstrument(instrument.id);
      }
    }

    const baseDraft = createDefaultSynthDraft();
    const patch: SynthDraftPatch = {
      ...baseDraft,
      name: "FX Rack Browser Host",
      effects: { filters: [] },
      metadata: {
        ...baseDraft.metadata,
        tags: [...new Set([...baseDraft.metadata.tags, "dev", "fx-rack-browser"])],
      },
    };

    const nextInstrumentId = instrumentStore.addInstrument({
      ...synthDraftToInstrumentPatch(patch),
      id: DEV_AETHER_FX_RACK_INSTRUMENT_ID,
      name: patch.name,
      source: { kind: "created", label: DEV_AETHER_FX_RACK_INSTRUMENT_ID_MARKER },
      userCreated: true,
    });
    useSynthStore.getState().bindInstrument(nextInstrumentId);
    useSynthStore.getState().setDraft(patch);
    useUiStore.getState().openEditor({ kind: "synthInstrument", instrumentId: nextInstrumentId });
    await waitForEditorPanel("Aether instrument effects");
    return { instrumentId: nextInstrumentId };
  };

  const exerciseAetherFxRackEditorFlow = async (): Promise<DevAetherFxRackExerciseState> => {
    await installAetherFxRackFixtureBase();
    const before = readAetherFxRackSnapshot();
    setSelectByAriaLabel("Add instrument effect", "saturator");
    await nextFrame();
    setSelectByAriaLabel("Add instrument effect", "delay");
    await nextFrame();
    const afterAdd = readAetherFxRackSnapshot();
    setNumberInputInEffectBlock("Saturator", "Drive", "47");
    setNumberInputInEffectBlock("Saturator", "Mix", "66");
    setNumberInputInEffectBlock("Delay", "Time", "375");
    setNumberInputInEffectBlock("Delay", "Feed", "42");
    setNumberInputInEffectBlock("Delay", "Mix", "23");
    await nextFrame();
    const afterParamEdit = readAetherFxRackSnapshot();
    clickButtonInEffectBlock("Delay", "Move Delay earlier");
    await nextFrame();
    const afterMove = readAetherFxRackSnapshot();
    setEffectBlockEnabled("Saturator", false);
    await nextFrame();
    const afterBypass = readAetherFxRackSnapshot();
    clickButtonInEffectBlock("Delay", "Remove Delay");
    await nextFrame();
    const state: DevAetherFxRackExerciseState = {
      instrumentId: useSynthStore.getState().boundInstrumentId,
      before,
      afterAdd,
      afterParamEdit,
      afterMove,
      afterBypass,
      afterRemove: readAetherFxRackSnapshot(),
    };
    writeAetherFxRackExerciseMarker(state);
    return state;
  };

  const installAetherMacroFixture = async () => {
    const instrumentStore = useInstrumentStore.getState();
    for (const instrument of instrumentStore.instruments) {
      if ((instrument.id === DEV_AETHER_MACRO_INSTRUMENT_ID || instrument.source?.label === DEV_AETHER_MACRO_INSTRUMENT_ID_MARKER) && instrument.userCreated) {
        instrumentStore.removeInstrument(instrument.id);
      }
    }

    const baseDraft = createDefaultSynthDraft();
    const macroRoutes: SynthModulationRoute[] = [
      {
        id: "dev-macro-brightness-cutoff",
        source: "macro.1",
        target: "filter.cutoff",
        amount: 0.35,
        bipolar: false,
        enabled: true,
      },
      {
        id: "dev-macro-brightness-resonance",
        source: "macro.1",
        target: "filter.resonance",
        amount: 0.22,
        bipolar: false,
        enabled: true,
      },
      {
        id: "dev-lfo-cutoff-conflict",
        source: "lfo.1",
        target: "filter.cutoff",
        amount: -0.18,
        bipolar: true,
        enabled: true,
      },
    ];
    const patch: SynthDraftPatch = {
      ...baseDraft,
      name: "Macro Browser Host",
      parameters: {
        ...baseDraft.parameters,
        "macro.1": 0.65,
        "lfo.1.enabled": 1,
        "lfo.1.rate": 0.35,
      },
      modulation: macroRoutes,
      metadata: {
        ...baseDraft.metadata,
        tags: [...new Set([...baseDraft.metadata.tags, "dev", "macro-browser"])],
        macros: {
          ...baseDraft.metadata.macros,
          "macro.1": {
            id: "macro.1",
            label: "Brightness",
            min: 0.2,
            max: 0.8,
            curve: "ease-in",
          },
        },
      },
    };

    const nextInstrumentId = instrumentStore.addInstrument({
      ...synthDraftToInstrumentPatch(patch),
      id: DEV_AETHER_MACRO_INSTRUMENT_ID,
      name: patch.name,
      source: { kind: "created", label: DEV_AETHER_MACRO_INSTRUMENT_ID_MARKER },
      userCreated: true,
    });
    useSynthStore.getState().bindInstrument(nextInstrumentId);
    useSynthStore.getState().setDraft(patch);
    useUiStore.getState().openEditor({ kind: "synthInstrument", instrumentId: nextInstrumentId });
    await waitForMacroControl("Brightness");
    writeAetherMacroFixtureMarker();
    return { instrumentId: nextInstrumentId };
  };

  const readAetherMacroFixtureState = (): DevAetherMacroFixtureState => {
    const state = readMacroFixtureDomState("Brightness");
    writeAetherMacroFixtureMarker(state);
    return state;
  };

  const exerciseAetherMacroAssignmentEditorFlow = async (): Promise<DevAetherMacroAssignmentExerciseState> => {
    await installAetherMacroFixture();
    await waitForEditorPanel("Modulation matrix");
    const before = readModulationRouteSnapshots();

    clickPanelButtonByText("Modulation matrix", "Add");
    await nextFrame();
    const afterAdd = readModulationRouteSnapshots();
    const routeNumber = afterAdd.length;

    setRouteSource(routeNumber, "macro.1");
    await nextFrame();
    await setRouteTarget(routeNumber, "amp.pan");
    setRouteStrength(routeNumber, "0.44");
    await nextFrame();
    const afterEdit = readModulationRouteSnapshots();
    const macroAfterEdit = readAetherMacroFixtureState();

    toggleRouteEnabled(routeNumber);
    await nextFrame();
    const afterDisable = readModulationRouteSnapshots();
    const macroAfterDisable = readAetherMacroFixtureState();

    const state: DevAetherMacroAssignmentExerciseState = {
      before,
      afterAdd,
      afterEdit,
      afterDisable,
      macroAfterEdit,
      macroAfterDisable,
      matrixText: normalizeText(findElementByAriaLabel("Modulation matrix")?.textContent ?? ""),
    };
    writeAetherMacroAssignmentExerciseMarker(state);
    return state;
  };

  const installAetherWavemapEditorFixtureBase = async () => {
    const instrumentStore = useInstrumentStore.getState();
    for (const instrument of instrumentStore.instruments) {
      if ((instrument.id === DEV_AETHER_WAVEMAP_INSTRUMENT_ID || instrument.source?.label === DEV_AETHER_WAVEMAP_INSTRUMENT_ID_MARKER) && instrument.userCreated) {
        instrumentStore.removeInstrument(instrument.id);
      }
    }

    const baseDraft = createDefaultSynthDraft();
    const wavemap = createBrowserWavemapFixture();
    const patch: SynthDraftPatch = {
      ...baseDraft,
      name: "Wavemap Browser Host",
      parameters: {
        ...baseDraft.parameters,
        "osc.a.wavetable": DEV_AETHER_WAVEMAP_ID,
        "osc.a.position": 0.42,
        "osc.a.warp": 0.24,
      },
      metadata: {
        ...baseDraft.metadata,
        tags: [...new Set([...baseDraft.metadata.tags, "dev", "wavemap-browser"])],
        wavemaps: {
          ...(baseDraft.metadata.wavemaps ?? {}),
          [DEV_AETHER_WAVEMAP_ID]: wavemap,
        },
        customWavetables: {
          ...(baseDraft.metadata.customWavetables ?? {}),
          [DEV_AETHER_WAVEMAP_ID]: wavemap,
        },
      },
    };

    const nextInstrumentId = instrumentStore.addInstrument({
      ...synthDraftToInstrumentPatch(patch),
      id: DEV_AETHER_WAVEMAP_INSTRUMENT_ID,
      name: patch.name,
      source: { kind: "created", label: DEV_AETHER_WAVEMAP_INSTRUMENT_ID_MARKER },
      userCreated: true,
    });
    useSynthStore.getState().bindInstrument(nextInstrumentId);
    useSynthStore.getState().setDraft(patch);
    useUiStore.getState().openEditor({ kind: "synthInstrument", instrumentId: nextInstrumentId });
    await waitForEditorPanel("Oscillator A wavemap frames");
    return { instrumentId: nextInstrumentId };
  };

  const exerciseAetherWavemapEditorFlow = async (): Promise<DevAetherWavemapEditorFixtureState> => {
    await installAetherWavemapEditorFixtureBase();
    clickPanelButton("Oscillator A wavemap frames", "Details wavemap analysis");
    clickPanelButton("Oscillator A wavemap frames", "Additive wavemap editing");
    clickPanelButton("Oscillator A wavemap frames", "Manual audio resynthesis window");
    await nextFrame();
    setNumberInputInPanel("Manual audio resynthesis range", "Start", "20");
    setNumberInputInPanel("Manual audio resynthesis range", "End", "65");
    await nextFrame();
    clickPanelButtonByText("Harmonic partial tools", "Odd");
    await nextFrame();
    clickPanelButtonByText("Oscillator A wavemap frames", "Smooth");
    await nextFrame();
    const state = readAetherWavemapEditorFixtureState();
    writeAetherWavemapEditorFixtureMarker(state);
    return state;
  };

  const exerciseAetherWavemapPointerDrawFlow = async (): Promise<DevAetherWavemapPointerDrawExerciseState> => {
    await installAetherWavemapEditorFixtureBase();
    clickPanelButton("Oscillator A wavemap frames", "Freehand wavemap editing");
    await nextFrame();

    const before = readAetherWavemapFirstFrameSnapshot();
    const pathBefore = readFirstWavemapDrawPath();
    const drawSurface = findFirstWavemapDrawSurface();
    dragFirstWavemapDrawSurface();
    await nextFrame();

    const afterDraw = readAetherWavemapFirstFrameSnapshot();
    const pathAfter = readFirstWavemapDrawPath();
    const state: DevAetherWavemapPointerDrawExerciseState = {
      before,
      afterDraw,
      editor: readAetherWavemapEditorFixtureState(),
      drawSurface: {
        exists: Boolean(drawSurface),
        label: drawSurface?.getAttribute("aria-label") ?? null,
        pathChanged: Boolean(pathBefore && pathAfter && pathBefore !== pathAfter),
      },
    };
    writeAetherWavemapPointerDrawExerciseMarker(state);
    return state;
  };

  const exerciseAetherWavemapImportFlow = async (): Promise<DevAetherWavemapImportExerciseState> => {
    await installAetherWavemapEditorFixtureBase();
    clickPanelButton("Oscillator A wavemap frames", "Manual audio resynthesis window");
    await nextFrame();
    setNumberInputInPanel("Manual audio resynthesis range", "Start", "18");
    setNumberInputInPanel("Manual audio resynthesis range", "End", "72");
    await nextFrame();

    const before = readAetherWavemapSourceSnapshot();
    window.__beatDevAudioImportQueue = [createDevWavemapAudioFile()];
    clickPanelButtonByText("Oscillator A wavemap frames", "Import Audio");
    await waitForAetherWavemapSourceKind("imported-audio");
    const state: DevAetherWavemapImportExerciseState = {
      before,
      afterImport: readAetherWavemapSourceSnapshot(),
      editor: readAetherWavemapEditorFixtureState(),
      firstFrame: readAetherWavemapFirstFrameSnapshot(),
      manualRangeText: normalizeText(findElementByAriaLabel("Manual audio resynthesis range")?.textContent ?? ""),
    };
    writeAetherWavemapImportExerciseMarker(state);
    return state;
  };

  const installAetherEnvelopeFixtureBase = async () => {
    const instrumentStore = useInstrumentStore.getState();
    for (const instrument of instrumentStore.instruments) {
      if ((instrument.id === DEV_AETHER_ENVELOPE_INSTRUMENT_ID || instrument.source?.label === DEV_AETHER_ENVELOPE_INSTRUMENT_ID_MARKER) && instrument.userCreated) {
        instrumentStore.removeInstrument(instrument.id);
      }
    }

    const baseDraft = createDefaultSynthDraft();
    const patch: SynthDraftPatch = {
      ...baseDraft,
      name: "Envelope Browser Host",
      parameters: {
        ...baseDraft.parameters,
        "env.1.attack": 0.08,
        "env.1.decay": 0.28,
        "env.1.sustain": 0.62,
        "env.1.release": 0.46,
        "env.1.attackCurve": "exp",
        "env.1.decayCurve": "s-curve",
        "env.1.releaseCurve": "log",
      },
      metadata: {
        ...baseDraft.metadata,
        tags: [...new Set([...baseDraft.metadata.tags, "dev", "envelope-browser"])],
      },
    };

    const nextInstrumentId = instrumentStore.addInstrument({
      ...synthDraftToInstrumentPatch(patch),
      id: DEV_AETHER_ENVELOPE_INSTRUMENT_ID,
      name: patch.name,
      source: { kind: "created", label: DEV_AETHER_ENVELOPE_INSTRUMENT_ID_MARKER },
      userCreated: true,
    });
    useSynthStore.getState().bindInstrument(nextInstrumentId);
    useSynthStore.getState().setDraft(patch);
    useUiStore.getState().openEditor({ kind: "synthInstrument", instrumentId: nextInstrumentId });
    await waitForEnvelopeHandle("env.1", "attack");
    return { instrumentId: nextInstrumentId };
  };

  const exerciseAetherEnvelopeHandleFlow = async (): Promise<DevAetherEnvelopeHandleExerciseState> => {
    await installAetherEnvelopeFixtureBase();
    const before = readAetherEnvelopeSnapshot("env.1");
    dragEnvelopeHandle("env.1", "attack", 0.18, 0.08);
    await nextFrame();
    const afterAttackDrag = readAetherEnvelopeSnapshot("env.1");
    dragEnvelopeHandle("env.1", "decay-sustain", 0.42, 0.74);
    await nextFrame();
    const afterDecaySustainDrag = readAetherEnvelopeSnapshot("env.1");
    dragEnvelopeHandle("env.1", "release", 0.68, 0.96);
    await nextFrame();
    const afterReleaseDrag = readAetherEnvelopeSnapshot("env.1");
    clickEnvelopeCurve("env.1", "attack");
    clickEnvelopeCurve("env.1", "decay");
    clickEnvelopeCurve("env.1", "release");
    await nextFrame();
    const afterCurveCycle = readAetherEnvelopeSnapshot("env.1");
    const state: DevAetherEnvelopeHandleExerciseState = {
      instrumentId: useSynthStore.getState().boundInstrumentId,
      before,
      afterAttackDrag,
      afterDecaySustainDrag,
      afterReleaseDrag,
      afterCurveCycle,
    };
    writeAetherEnvelopeHandleExerciseMarker(state);
    return state;
  };

  const installAetherAmpFilterFixtureBase = async () => {
    const instrumentStore = useInstrumentStore.getState();
    for (const instrument of instrumentStore.instruments) {
      if ((instrument.id === DEV_AETHER_AMP_FILTER_INSTRUMENT_ID || instrument.source?.label === DEV_AETHER_AMP_FILTER_INSTRUMENT_ID_MARKER) && instrument.userCreated) {
        instrumentStore.removeInstrument(instrument.id);
      }
    }

    const baseDraft = createDefaultSynthDraft();
    const patch: SynthDraftPatch = {
      ...baseDraft,
      name: "Amp Filter Browser Host",
      parameters: {
        ...baseDraft.parameters,
        "filter.enabled": true,
        "filter.type": "lowpass",
        "filter.cutoff": 4200,
        "filter.resonance": 0.14,
        "filter.keytrack": 0.18,
        "filter.drive": 0.08,
        "amp.level": 0.72,
        "amp.pan": 0,
        "env.1.loop": false,
        "env.2.loop": false,
      },
      metadata: {
        ...baseDraft.metadata,
        tags: [...new Set([...baseDraft.metadata.tags, "dev", "amp-filter-browser"])],
      },
    };

    const nextInstrumentId = instrumentStore.addInstrument({
      ...synthDraftToInstrumentPatch(patch),
      id: DEV_AETHER_AMP_FILTER_INSTRUMENT_ID,
      name: patch.name,
      source: { kind: "created", label: DEV_AETHER_AMP_FILTER_INSTRUMENT_ID_MARKER },
      userCreated: true,
    });
    useSynthStore.getState().bindInstrument(nextInstrumentId);
    useSynthStore.getState().setDraft(patch);
    useUiStore.getState().openEditor({ kind: "synthInstrument", instrumentId: nextInstrumentId });
    await waitForEditorPanel("Amp and filter");
    return { instrumentId: nextInstrumentId };
  };

  const exerciseAetherAmpFilterEditorFlow = async (): Promise<DevAetherAmpFilterExerciseState> => {
    await installAetherAmpFilterFixtureBase();
    const before = readAetherAmpFilterSnapshot();
    clickRadioInPanel("Amp and filter", "Filter", "Highpass");
    await setKnobValueInPanel("Amp and filter", "Cutoff", "8600");
    await setKnobValueInPanel("Amp and filter", "Res", "0.47");
    await setKnobValueInPanel("Amp and filter", "Key", "0.61");
    await setKnobValueInPanel("Amp and filter", "Drive", "0.29");
    await setKnobValueInPanel("Amp and filter", "Level", "0.66");
    await setKnobValueInPanel("Amp and filter", "Pan", "-0.32");
    clickPanelButtonByText("Amp and filter", "Env 1 Loop");
    clickPanelButtonByText("Amp and filter", "Env 2 Loop");
    await nextFrame();
    const state: DevAetherAmpFilterExerciseState = {
      instrumentId: useSynthStore.getState().boundInstrumentId,
      before,
      afterEdit: readAetherAmpFilterSnapshot(),
    };
    writeAetherAmpFilterExerciseMarker(state);
    return state;
  };

  const installAetherLfoFixtureBase = async () => {
    const instrumentStore = useInstrumentStore.getState();
    for (const instrument of instrumentStore.instruments) {
      if ((instrument.id === DEV_AETHER_LFO_INSTRUMENT_ID || instrument.source?.label === DEV_AETHER_LFO_INSTRUMENT_ID_MARKER) && instrument.userCreated) {
        instrumentStore.removeInstrument(instrument.id);
      }
    }

    const baseDraft = createDefaultSynthDraft();
    const patch: SynthDraftPatch = {
      ...baseDraft,
      name: "LFO Browser Host",
      parameters: {
        ...baseDraft.parameters,
        "lfo.1.enabled": true,
        "lfo.1.rate": 2.4,
        "lfo.1.sync": false,
        "lfo.1.syncedRate": "1/4",
        "lfo.1.smoothing": 0.05,
        "lfo.1.randomPhase": 0,
        "lfo.1.shape": "sine",
        "lfo.1.phase": 0.1,
        "lfo.1.retrigger": true,
        "lfo.1.oneShot": false,
      },
      metadata: {
        ...baseDraft.metadata,
        tags: [...new Set([...baseDraft.metadata.tags, "dev", "lfo-browser"])],
      },
    };

    const nextInstrumentId = instrumentStore.addInstrument({
      ...synthDraftToInstrumentPatch(patch),
      id: DEV_AETHER_LFO_INSTRUMENT_ID,
      name: patch.name,
      source: { kind: "created", label: DEV_AETHER_LFO_INSTRUMENT_ID_MARKER },
      userCreated: true,
    });
    useSynthStore.getState().bindInstrument(nextInstrumentId);
    useSynthStore.getState().setDraft(patch);
    useUiStore.getState().openEditor({ kind: "synthInstrument", instrumentId: nextInstrumentId });
    await waitForEditorPanel("LFO 1");
    return { instrumentId: nextInstrumentId };
  };

  const exerciseAetherLfoEditorFlow = async (): Promise<DevAetherLfoExerciseState> => {
    await installAetherLfoFixtureBase();
    const before = readAetherLfoSnapshot(1);
    clickRadioInPanel("LFO 1", "LFO 1 Shape", "Square");
    await setKnobValueInPanel("LFO 1", "Rate", "7.5");
    await setKnobValueInPanel("LFO 1", "Phase", "0.33");
    await setKnobValueInPanel("LFO 1", "Smooth", "0.42");
    await setKnobValueInPanel("LFO 1", "Random", "0.58");
    clickPanelButton("LFO 1", "Enable LFO 1 tempo sync");
    await nextFrame();
    clickRadioInPanel("LFO 1", "LFO 1 Sync Rate", "Sixteenth note");
    clickPanelButton("LFO 1", "Enable LFO 1 one-shot");
    clickPanelButton("LFO 1", "Disable LFO 1 retrigger");
    await nextFrame();
    const state: DevAetherLfoExerciseState = {
      instrumentId: useSynthStore.getState().boundInstrumentId,
      before,
      afterEdit: readAetherLfoSnapshot(1),
    };
    writeAetherLfoExerciseMarker(state);
    return state;
  };

  const installAetherPerformanceFixtureBase = async () => {
    const instrumentStore = useInstrumentStore.getState();
    for (const instrument of instrumentStore.instruments) {
      if ((instrument.id === DEV_AETHER_PERFORMANCE_INSTRUMENT_ID || instrument.source?.label === DEV_AETHER_PERFORMANCE_INSTRUMENT_ID_MARKER) && instrument.userCreated) {
        instrumentStore.removeInstrument(instrument.id);
      }
    }

    const baseDraft = createDefaultSynthDraft();
    const patch: SynthDraftPatch = {
      ...baseDraft,
      name: "Performance Browser Host",
      parameters: {
        ...baseDraft.parameters,
        maxVoices: 12,
        "glide.ms": 90,
        "mono.enabled": false,
        "legato.enabled": false,
      },
      metadata: {
        ...baseDraft.metadata,
        tags: [...new Set([...baseDraft.metadata.tags, "dev", "performance-browser"])],
      },
    };

    const nextInstrumentId = instrumentStore.addInstrument({
      ...synthDraftToInstrumentPatch(patch),
      id: DEV_AETHER_PERFORMANCE_INSTRUMENT_ID,
      name: patch.name,
      source: { kind: "created", label: DEV_AETHER_PERFORMANCE_INSTRUMENT_ID_MARKER },
      userCreated: true,
    });
    useSynthStore.getState().bindInstrument(nextInstrumentId);
    useSynthStore.getState().setDraft(patch);
    useUiStore.getState().openEditor({ kind: "synthInstrument", instrumentId: nextInstrumentId });
    await waitForEditorPanel("Performance controls");
    return { instrumentId: nextInstrumentId };
  };

  const exerciseAetherPerformanceEditorFlow = async (): Promise<DevAetherPerformanceExerciseState> => {
    await installAetherPerformanceFixtureBase();
    const before = readAetherPerformanceSnapshot();
    setNumberInputInPanel("Performance controls", "Voices", "5");
    setNumberInputInPanel("Performance controls", "Glide", "240");
    setSwitchInPanel("Performance controls", "Mono", true);
    setSwitchInPanel("Performance controls", "Legato", true);
    await nextFrame();
    const state: DevAetherPerformanceExerciseState = {
      instrumentId: useSynthStore.getState().boundInstrumentId,
      before,
      afterEdit: readAetherPerformanceSnapshot(),
    };
    writeAetherPerformanceExerciseMarker(state);
    return state;
  };

  const installAetherAutomationFixture = () => {
    const instrumentStore = useInstrumentStore.getState();
    for (const instrument of instrumentStore.instruments) {
      if (instrument.source?.label === DEV_AETHER_AUTOMATION_INSTRUMENT_ID_MARKER && instrument.userCreated) {
        instrumentStore.removeInstrument(instrument.id);
      }
    }

    const baseDraft = createDefaultSynthDraft();
    const draft = {
      ...baseDraft,
      name: "Aether Automation Fixture",
      metadata: {
        ...baseDraft.metadata,
        tags: ["dev", "automation", "aether"],
      },
    };
    const instrumentId = instrumentStore.addInstrument({
      ...synthDraftToInstrumentPatch(draft),
      name: draft.name,
      setId: USER_INSTRUMENT_SET_ID,
      source: { kind: "created", label: DEV_AETHER_AUTOMATION_INSTRUMENT_ID_MARKER },
      userCreated: true,
    });

    const project = createEmptyProject();
    project.id = "dev-aether-automation-project";
    project.name = "Aether Automation Fixture";
    project.lengthBeats = 64;
    project.bpm = 124;
    const track = project.tracks[0];
    track.id = DEV_AETHER_AUTOMATION_TRACK_ID;
    track.name = "Aether Automation Track";
    track.kind = "midi";
    track.instrumentId = instrumentId;
    track.automation = [
      {
        target: "macro.1",
        points: [
          { beat: 0, value: 0.22, curve: "linear" },
          { beat: 32, value: 0.58, curve: "smoothstep" },
          { beat: 64, value: 0.88, curve: "easeIn" },
        ],
      },
    ];
    track.segments = [
      {
        id: DEV_AETHER_AUTOMATION_SEGMENT_ID,
        trackId: DEV_AETHER_AUTOMATION_TRACK_ID,
        name: "Aether Automation Segment",
        instrumentId,
        startBeat: 4,
        lengthBeats: 8,
        repeats: 0,
        layer: 0,
        automation: [
          {
            target: "macro.1",
            points: [
              { beat: 0, value: 0.18, curve: "linear" },
              { beat: 2, value: 0.52, curve: "smoothstep" },
              { beat: 8, value: 0.76, curve: "easeOut" },
            ],
          },
        ],
        payload: {
          kind: "midi",
          notes: [
            {
              pitch: 60,
              velocity: 104,
              startBeat: 0,
              lengthBeats: 2,
              automation: [
                {
                  target: "macro.1",
                  points: [
                    { beat: 0, value: 0.12, curve: "linear" },
                    { beat: 0.75, value: 0.48, curve: "smoothstep" },
                    { beat: 2, value: 0.82, curve: "easeIn" },
                  ],
                },
              ],
            },
          ],
        },
      },
    ];

    useProjectStore.getState().loadProject(project);
    useUiStore.setState({
      openEditors: [],
      selectedTrackIds: [],
      selectedSegmentIds: [],
      selectedTrackEffectAutomationPointKeys: [],
    });
    writeAetherAutomationFixtureMarker();
    return { trackId: track.id, segmentId: DEV_AETHER_AUTOMATION_SEGMENT_ID, instrumentId };
  };

  const openAetherAutomationFixtureEditor = async (editor: DevAetherAutomationEditor) => {
    const fixture = ensureAetherAutomationFixture();
    useUiStore.setState({ openEditors: [] });
    if (editor === "arrangement") {
      document.dispatchEvent(new CustomEvent("beat:dev-open-arrangement"));
      await nextFrame();
      writeAetherAutomationFixtureMarker();
      return readAetherAutomationFixtureState();
    }
    if (editor === "track") {
      useUiStore.getState().openEditor({ kind: "track", trackId: fixture.trackId });
    } else {
      useUiStore.getState().openEditor({ kind: "segment", segmentId: fixture.segmentId });
    }
    await waitForEditorPanel(editor === "track" ? "Aether track automation lanes" : "Aether segment automation lanes");
    if (editor === "track") {
      clickPanelButton("Aether track automation lanes", "Macro 1 track automation lane");
      await nextFrame();
    } else {
      clickPanelButton("Aether segment automation lanes", "Macro 1 segment automation lane");
      await nextFrame();
    }
    if (editor === "note") {
      clickFirstMidiNote();
      await waitForEditorPanel("Aether note automation lanes");
      clickPanelButton("Aether note automation lanes", "Macro 1 automation lane");
      await nextFrame();
    }
    writeAetherAutomationFixtureMarker();
    return readAetherAutomationFixtureState();
  };

  const exerciseAetherAutomationPointEditorFlow = async (): Promise<DevAetherAutomationPointExerciseState> => {
    installAetherAutomationFixture();
    const state: DevAetherAutomationPointExerciseState = {
      track: await exerciseAutomationPointEditor("track", 12.375, 0.63),
      segment: await exerciseAutomationPointEditor("segment", 3.375, 0.64),
      note: await exerciseAutomationPointEditor("note", 1.375, 0.65),
    };
    writeAetherAutomationPointExerciseMarker(state);
    return state;
  };

  const exerciseAetherDirectAutomationPointEditorFlow = async (): Promise<DevAetherDirectAutomationPointExerciseState> => {
    installAetherAutomationFixture();
    const target: MidiAutomationTarget = "filter.cutoff";
    const state: DevAetherDirectAutomationPointExerciseState = {
      target,
      track: await exerciseAutomationPointEditor("track", 18.625, 0.71, target),
      segment: await exerciseAutomationPointEditor("segment", 4.625, 0.72, target),
      note: await exerciseAutomationPointEditor("note", 1.625, 0.73, target),
    };
    writeAetherDirectAutomationPointExerciseMarker(state);
    return state;
  };

  const exerciseAetherArrangementAutomationDragFlow = async (): Promise<DevAetherArrangementAutomationDragExerciseState> => {
    installAetherAutomationFixture();
    await openAetherAutomationFixtureEditor("arrangement");
    await waitForArrangementAutomationLane();
    const before = readArrangementAutomationTrackPoints();

    dragArrangementAutomationPoint(1, 33.375, 0.71, false);
    await nextFrame();
    const afterFreeDrag = readArrangementAutomationTrackPoints();

    dragArrangementAutomationPoint(1, 34.62, 0.41, true);
    await nextFrame();
    const afterShiftDrag = readArrangementAutomationTrackPoints();

    const state: DevAetherArrangementAutomationDragExerciseState = {
      before,
      afterFreeDrag,
      afterShiftDrag,
      arrangementLane: readArrangementAutomationLaneState(),
    };
    writeAetherArrangementAutomationDragExerciseMarker(state);
    return state;
  };

  const exerciseAetherNoteAutomationDragFlow = async (): Promise<DevAetherNoteAutomationDragExerciseState> => {
    installAetherAutomationFixture();
    await openAetherAutomationFixtureEditor("note");
    await waitForNoteAutomationHandle("start");
    const before = readAutomationPointPanelRows("Aether note automation points");

    dragNoteAutomationHandle("start", 0.31);
    await nextFrame();
    const afterStartDrag = readAutomationPointPanelRows("Aether note automation points");

    dragNoteAutomationHandle("mid", 0.76);
    await nextFrame();
    const afterMidDrag = readAutomationPointPanelRows("Aether note automation points");

    dragNoteAutomationHandle("end", 0.44);
    await nextFrame();
    const afterEndDrag = readAutomationPointPanelRows("Aether note automation points");

    const state: DevAetherNoteAutomationDragExerciseState = {
      before,
      afterStartDrag,
      afterMidDrag,
      afterEndDrag,
      handles: {
        start: readNoteAutomationHandleState("start"),
        mid: readNoteAutomationHandleState("mid"),
        end: readNoteAutomationHandleState("end"),
      },
      pointPanelText: readPanelState("Aether note automation points").text,
    };
    writeAetherNoteAutomationDragExerciseMarker(state);
    return state;
  };

  const exerciseAetherSegmentAutomationDragFlow = async (): Promise<DevAetherSegmentAutomationDragExerciseState> => {
    installAetherAutomationFixture();
    await openAetherAutomationFixtureEditor("segment");
    await waitForSegmentAutomationHandle("start");
    const before = readAutomationPointPanelRows("Aether segment automation points");

    dragSegmentAutomationHandle("start", 0.26);
    await nextFrame();
    const afterStartDrag = readAutomationPointPanelRows("Aether segment automation points");

    dragSegmentAutomationHandle("mid", 0.68);
    await nextFrame();
    const afterMidDrag = readAutomationPointPanelRows("Aether segment automation points");

    dragSegmentAutomationHandle("end", 0.43);
    await nextFrame();
    const afterEndDrag = readAutomationPointPanelRows("Aether segment automation points");

    const state: DevAetherSegmentAutomationDragExerciseState = {
      before,
      afterStartDrag,
      afterMidDrag,
      afterEndDrag,
      handles: {
        start: readSegmentAutomationHandleState("start"),
        mid: readSegmentAutomationHandleState("mid"),
        end: readSegmentAutomationHandleState("end"),
      },
      pointPanelText: readPanelState("Aether segment automation points").text,
    };
    writeAetherSegmentAutomationDragExerciseMarker(state);
    return state;
  };

  const exerciseAetherTrackAutomationDragFlow = async (): Promise<DevAetherTrackAutomationDragExerciseState> => {
    installAetherAutomationFixture();
    await openAetherAutomationFixtureEditor("track");
    await waitForTrackAutomationHandle("start");
    const before = readAutomationPointPanelRows("Aether track automation points");

    dragTrackAutomationHandle("start", 0.28);
    await nextFrame();
    const afterStartDrag = readAutomationPointPanelRows("Aether track automation points");

    dragTrackAutomationHandle("mid", 0.73);
    await nextFrame();
    const afterMidDrag = readAutomationPointPanelRows("Aether track automation points");

    dragTrackAutomationHandle("end", 0.39);
    await nextFrame();
    const afterEndDrag = readAutomationPointPanelRows("Aether track automation points");

    const state: DevAetherTrackAutomationDragExerciseState = {
      before,
      afterStartDrag,
      afterMidDrag,
      afterEndDrag,
      handles: {
        start: readTrackAutomationHandleState("start"),
        mid: readTrackAutomationHandleState("mid"),
        end: readTrackAutomationHandleState("end"),
      },
      pointPanelText: readPanelState("Aether track automation points").text,
    };
    writeAetherTrackAutomationDragExerciseMarker(state);
    return state;
  };

  async function exerciseAutomationPointEditor(
    editor: DevAetherAutomationPointEditor,
    beat: number,
    value: number,
    target: MidiAutomationTarget = "macro.1",
  ): Promise<DevAutomationPointEditorExercise> {
    await openAetherAutomationFixtureEditor(editor);
    const pointPanelLabel = aetherAutomationPointEditorLabel(editor);
    if (target !== "macro.1") {
      clickAetherAutomationTarget(editor, target);
      await nextFrame();
      clickPanelButtonByText(aetherAutomationLanePanelLabel(editor), "Add lane");
      await nextFrame();
    }
    const before = readAutomationPointPanelRows(pointPanelLabel);
    const curveBefore = readAutomationCurveControlLabel(editor);
    await chooseAutomationCurve(editor, "Smoothstep");
    const curveAfter = readAutomationCurveControlLabel(editor);
    clickPanelButtonByText(pointPanelLabel, "Add point");
    await nextFrame();
    const afterAdd = readAutomationPointPanelRows(pointPanelLabel);
    setLastAutomationPointField(pointPanelLabel, "Beat", String(beat));
    setLastAutomationPointField(pointPanelLabel, "Value", String(value));
    await nextFrame();
    const afterEdit = readAutomationPointPanelRows(pointPanelLabel);
    clickPanelButtonByText(pointPanelLabel, "Quantize");
    await nextFrame();
    const afterQuantize = readAutomationPointPanelRows(pointPanelLabel);
    clickPanelButtonByText(pointPanelLabel, "Snap values");
    await nextFrame();
    const afterSnap = readAutomationPointPanelRows(pointPanelLabel);
    const lastSelectablePointIndex = Math.max(0, afterSnap.length - 1);
    setAutomationPointSelection(pointPanelLabel, 0, true);
    if (lastSelectablePointIndex > 0) {
      setAutomationPointSelection(pointPanelLabel, lastSelectablePointIndex, true);
    }
    await nextFrame();
    const afterSelect = readAutomationPointPanelRows(pointPanelLabel);
    clickPanelButtonByText(pointPanelLabel, "Copy");
    await nextFrame();
    const afterCopy = readAutomationPointPanelRows(pointPanelLabel);
    clickPanelButtonByText(pointPanelLabel, "Paste");
    await nextFrame();
    const afterPaste = readAutomationPointPanelRows(pointPanelLabel);
    clickLastAutomationPointRemove(pointPanelLabel);
    await nextFrame();
    const afterRemove = readAutomationPointPanelRows(pointPanelLabel);
    clickPanelButtonByText(aetherAutomationLanePanelLabel(editor), "Clear");
    await nextFrame();
    const afterClear = readAutomationPointPanelRows(pointPanelLabel);
    return {
      editor,
      target,
      before,
      curveBefore,
      curveAfter,
      afterAdd,
      afterEdit,
      afterQuantize,
      afterSnap,
      afterSelect,
      afterCopy,
      afterPaste,
      afterRemove,
      afterClear,
      selectedPointCount: readAutomationPointSelectionCount(pointPanelLabel),
      pointPanelText: readPanelState(pointPanelLabel).text,
    };
  }

  const readAetherAutomationFixtureState = (): DevAetherAutomationFixtureState => {
    const project = useProjectStore.getState().project;
    const track = project.tracks.find((candidate) => candidate.id === DEV_AETHER_AUTOMATION_TRACK_ID) ?? null;
    const segment = track?.segments.find((candidate) => candidate.id === DEV_AETHER_AUTOMATION_SEGMENT_ID) ?? null;
    const firstNote = segment?.payload.kind === "midi" || segment?.payload.kind === "mixed"
      ? segment.payload.notes[0] ?? null
      : null;
    return {
      trackId: track?.id ?? null,
      segmentId: segment?.id ?? null,
      instrumentId: track?.instrumentId ?? segment?.instrumentId ?? null,
      openEditors: useUiStore.getState().openEditors.map((editor) => editor.kind),
      trackLaneTargets: (track?.automation ?? []).map((lane) => lane.target),
      segmentLaneTargets: (segment?.automation ?? []).map((lane) => lane.target),
      noteLaneTargets: (firstNote?.automation ?? []).map((lane) => lane.target),
      arrangementLane: readArrangementAutomationLaneState(),
      panels: {
        note: readPanelState("Aether note automation lanes"),
        segment: readPanelState("Aether segment automation lanes"),
        track: readPanelState("Aether track automation lanes"),
      },
    };
  };

  function ensureAetherAutomationFixture() {
    const project = useProjectStore.getState().project;
    const track = project.tracks.find((candidate) => candidate.id === DEV_AETHER_AUTOMATION_TRACK_ID);
    const segment = track?.segments.find((candidate) => candidate.id === DEV_AETHER_AUTOMATION_SEGMENT_ID);
    if (track && segment && track.instrumentId) return { trackId: track.id, segmentId: segment.id, instrumentId: track.instrumentId };
    return installAetherAutomationFixture();
  }

  window.__beatTestHooks = {
    ...(window.__beatTestHooks ?? {}),
    installDecentSamplerFixture,
    installNodeInstrumentFixture,
    installMixedEraAetherPresetFixture,
    installMixedEraAetherFxPresetFixture,
    readMixedEraAetherPresetFixtureState,
    readMixedEraAetherFxPresetFixtureState,
    installAetherPresetLibraryFixture,
    readAetherPresetLibraryFixtureState,
    installAetherMacroFixture,
    readAetherMacroFixtureState,
    exerciseAetherOscillatorEditorFlow,
    exerciseAetherFxRackEditorFlow,
    exerciseAetherMacroAssignmentEditorFlow,
    exerciseAetherWavemapEditorFlow,
    exerciseAetherWavemapPointerDrawFlow,
    exerciseAetherWavemapImportFlow,
    exerciseAetherEnvelopeHandleFlow,
    exerciseAetherAmpFilterEditorFlow,
    exerciseAetherLfoEditorFlow,
    exerciseAetherPerformanceEditorFlow,
    exerciseAetherPresetLibraryFavoriteFlow,
    exerciseAetherPresetRestoreInitFlow,
    exerciseAetherPresetSaveDeleteFlow,
    installAetherAutomationFixture,
    openAetherAutomationFixtureEditor,
    readAetherAutomationFixtureState,
    exerciseAetherAutomationPointEditorFlow,
    exerciseAetherDirectAutomationPointEditorFlow,
    exerciseAetherArrangementAutomationDragFlow,
    exerciseAetherNoteAutomationDragFlow,
    exerciseAetherSegmentAutomationDragFlow,
    exerciseAetherTrackAutomationDragFlow,
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
  } else if (fixture === "aether-preset-library") {
    window.setTimeout(() => {
      void installAetherPresetLibraryFixture();
    }, 0);
  } else if (fixture === "aether-preset-restore-init") {
    window.setTimeout(() => {
      void exerciseAetherPresetRestoreInitFlow();
    }, 0);
  } else if (fixture === "aether-preset-save-delete") {
    window.setTimeout(() => {
      void exerciseAetherPresetSaveDeleteFlow();
    }, 0);
  } else if (fixture === "aether-oscillator") {
    window.setTimeout(() => {
      void exerciseAetherOscillatorEditorFlow();
    }, 0);
  } else if (fixture === "aether-fx-rack") {
    window.setTimeout(() => {
      void exerciseAetherFxRackEditorFlow();
    }, 0);
  } else if (fixture === "aether-macro") {
    window.setTimeout(() => {
      void installAetherMacroFixture();
    }, 0);
  } else if (fixture === "aether-macro-assignment") {
    window.setTimeout(() => {
      void exerciseAetherMacroAssignmentEditorFlow();
    }, 0);
  } else if (fixture === "aether-wavemap-editor") {
    window.setTimeout(() => {
      void exerciseAetherWavemapEditorFlow();
    }, 0);
  } else if (fixture === "aether-wavemap-pointer-draw") {
    window.setTimeout(() => {
      void exerciseAetherWavemapPointerDrawFlow();
    }, 0);
  } else if (fixture === "aether-wavemap-import") {
    window.setTimeout(() => {
      void exerciseAetherWavemapImportFlow();
    }, 0);
  } else if (fixture === "aether-envelope-handles") {
    window.setTimeout(() => {
      void exerciseAetherEnvelopeHandleFlow();
    }, 0);
  } else if (fixture === "aether-amp-filter") {
    window.setTimeout(() => {
      void exerciseAetherAmpFilterEditorFlow();
    }, 0);
  } else if (fixture === "aether-lfo") {
    window.setTimeout(() => {
      void exerciseAetherLfoEditorFlow();
    }, 0);
  } else if (fixture === "aether-performance") {
    window.setTimeout(() => {
      void exerciseAetherPerformanceEditorFlow();
    }, 0);
  } else if (fixture === "aether-automation") {
    window.setTimeout(() => {
      const editor = new URLSearchParams(window.location.search).get("beatAutomationEditor");
      void openAetherAutomationFixtureEditor(isAetherAutomationEditor(editor) ? editor : "segment");
    }, 0);
  } else if (fixture === "aether-automation-points") {
    window.setTimeout(() => {
      void exerciseAetherAutomationPointEditorFlow();
    }, 0);
  } else if (fixture === "aether-direct-automation-points") {
    window.setTimeout(() => {
      void exerciseAetherDirectAutomationPointEditorFlow();
    }, 0);
  } else if (fixture === "aether-arrangement-automation-drag") {
    window.setTimeout(() => {
      void exerciseAetherArrangementAutomationDragFlow();
    }, 0);
  } else if (fixture === "aether-note-automation-drag") {
    window.setTimeout(() => {
      void exerciseAetherNoteAutomationDragFlow();
    }, 0);
  } else if (fixture === "aether-segment-automation-drag") {
    window.setTimeout(() => {
      void exerciseAetherSegmentAutomationDragFlow();
    }, 0);
  } else if (fixture === "aether-track-automation-drag") {
    window.setTimeout(() => {
      void exerciseAetherTrackAutomationDragFlow();
    }, 0);
  }
}

function isAetherAutomationEditor(value: string | null): value is DevAetherAutomationEditor {
  return value === "arrangement" || value === "track" || value === "segment" || value === "note";
}

function readArrangementAutomationLaneState() {
  const lane = document.querySelector<HTMLElement>("[data-aether-arrangement-automation]");
  return {
    exists: Boolean(lane),
    target: lane?.dataset.aetherArrangementAutomation ?? null,
    text: normalizeText(lane?.textContent ?? ""),
    pointCount: lane?.querySelectorAll("[class*='automationPoint']").length ?? 0,
  };
}

function readArrangementAutomationTrackPoints(): DevAetherArrangementAutomationPointSnapshot[] {
  const project = useProjectStore.getState().project;
  const track = project.tracks.find((candidate) => candidate.id === DEV_AETHER_AUTOMATION_TRACK_ID);
  const lane = track?.automation?.find((candidate) => candidate.target === "macro.1");
  return (lane?.points ?? []).map((point) => ({
    beat: point.beat,
    value: point.value,
    curve: point.curve ?? null,
  }));
}

function dragArrangementAutomationPoint(pointIndex: number, beat: number, value: number, shiftKey: boolean) {
  const lane = document.querySelector<HTMLElement>("[data-track-lane-id]");
  const preview = document.querySelector<HTMLElement>("[data-aether-arrangement-automation]");
  const point = preview?.querySelector<HTMLElement>(`[data-aether-arrangement-automation-point="${pointIndex}"]`);
  const laneRect = lane?.getBoundingClientRect();
  const previewRect = preview?.getBoundingClientRect();
  const pointRect = point?.getBoundingClientRect();
  if (!point || !laneRect || !previewRect || !pointRect) return;

  const project = useProjectStore.getState().project;
  const beatsToPx = useViewStore.getState().beatsToPx;
  const x = laneRect.left + Math.max(0, Math.min(project.lengthBeats, beat)) * beatsToPx;
  const y = previewRect.top + automationValueToPreviewY(value, previewRect.height);
  const pointerInit = {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 7,
    pointerType: "mouse",
    clientX: pointRect.left + pointRect.width / 2,
    clientY: pointRect.top + pointRect.height / 2,
    shiftKey,
  };
  point.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
  window.dispatchEvent(new PointerEvent("pointermove", {
    ...pointerInit,
    clientX: x,
    clientY: y,
  }));
  window.dispatchEvent(new PointerEvent("pointerup", {
    ...pointerInit,
    clientX: x,
    clientY: y,
  }));
}

function automationValueToPreviewY(value: number, height: number): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return height - 4 - clamped * (height - 8);
}

function findNoteAutomationHandle(edge: "start" | "mid" | "end"): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[data-aether-note-automation-handle="${edge}"]`);
}

function readNoteAutomationHandleState(edge: "start" | "mid" | "end"): DevAetherNoteAutomationHandleState {
  const handle = findNoteAutomationHandle(edge);
  return {
    exists: Boolean(handle),
    label: handle?.getAttribute("aria-label") ?? null,
    left: handle?.style.left || null,
  };
}

function dragNoteAutomationHandle(edge: "start" | "mid" | "end", normalizedValue: number) {
  const handle = findNoteAutomationHandle(edge);
  const rail = handle?.parentElement;
  const handleRect = handle?.getBoundingClientRect();
  const railRect = rail?.getBoundingClientRect();
  if (!handle || !railRect || !handleRect || railRect.width <= 0) return;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(normalizedValue) ? normalizedValue : 0));
  const pointerInit = {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    pointerId: 23,
    pointerType: "mouse",
    clientX: handleRect.left + handleRect.width / 2,
    clientY: handleRect.top + handleRect.height / 2,
  };
  const targetX = railRect.left + railRect.width * clamped;
  const targetY = railRect.top + railRect.height / 2;
  handle.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
  handle.dispatchEvent(new PointerEvent("pointermove", {
    ...pointerInit,
    clientX: targetX,
    clientY: targetY,
  }));
  handle.dispatchEvent(new PointerEvent("pointerup", {
    ...pointerInit,
    buttons: 0,
    clientX: targetX,
    clientY: targetY,
  }));
}

function findSegmentAutomationHandle(edge: "start" | "mid" | "end"): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[data-aether-segment-automation-handle="${edge}"]`);
}

function readSegmentAutomationHandleState(edge: "start" | "mid" | "end"): DevAetherSegmentAutomationHandleState {
  const handle = findSegmentAutomationHandle(edge);
  return {
    exists: Boolean(handle),
    label: handle?.getAttribute("aria-label") ?? null,
    left: handle?.style.left || null,
  };
}

function dragSegmentAutomationHandle(edge: "start" | "mid" | "end", normalizedValue: number) {
  const handle = findSegmentAutomationHandle(edge);
  const rail = handle?.parentElement;
  const handleRect = handle?.getBoundingClientRect();
  const railRect = rail?.getBoundingClientRect();
  if (!handle || !railRect || !handleRect || railRect.width <= 0) return;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(normalizedValue) ? normalizedValue : 0));
  const pointerInit = {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    pointerId: 29,
    pointerType: "mouse",
    clientX: handleRect.left + handleRect.width / 2,
    clientY: handleRect.top + handleRect.height / 2,
  };
  const targetX = railRect.left + railRect.width * clamped;
  const targetY = railRect.top + railRect.height / 2;
  handle.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
  handle.dispatchEvent(new PointerEvent("pointermove", {
    ...pointerInit,
    clientX: targetX,
    clientY: targetY,
  }));
  handle.dispatchEvent(new PointerEvent("pointerup", {
    ...pointerInit,
    buttons: 0,
    clientX: targetX,
    clientY: targetY,
  }));
}

function findTrackAutomationHandle(edge: "start" | "mid" | "end"): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[data-aether-track-automation-handle="${edge}"]`);
}

function readTrackAutomationHandleState(edge: "start" | "mid" | "end"): DevAetherTrackAutomationHandleState {
  const handle = findTrackAutomationHandle(edge);
  return {
    exists: Boolean(handle),
    label: handle?.getAttribute("aria-label") ?? null,
    left: handle?.style.left || null,
  };
}

function dragTrackAutomationHandle(edge: "start" | "mid" | "end", normalizedValue: number) {
  const handle = findTrackAutomationHandle(edge);
  const rail = handle?.parentElement;
  const handleRect = handle?.getBoundingClientRect();
  const railRect = rail?.getBoundingClientRect();
  if (!handle || !railRect || !handleRect || railRect.width <= 0) return;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(normalizedValue) ? normalizedValue : 0));
  const pointerInit = {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    pointerId: 31,
    pointerType: "mouse",
    clientX: handleRect.left + handleRect.width / 2,
    clientY: handleRect.top + handleRect.height / 2,
  };
  const targetX = railRect.left + railRect.width * clamped;
  const targetY = railRect.top + railRect.height / 2;
  handle.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
  handle.dispatchEvent(new PointerEvent("pointermove", {
    ...pointerInit,
    clientX: targetX,
    clientY: targetY,
  }));
  handle.dispatchEvent(new PointerEvent("pointerup", {
    ...pointerInit,
    buttons: 0,
    clientX: targetX,
    clientY: targetY,
  }));
}

function readPanelState(label: string): DevAutomationPanelState {
  const panel = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  return {
    exists: Boolean(panel),
    text: normalizeText(panel?.textContent ?? ""),
    buttonLabels: Array.from(panel?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [])
      .map((button) => button.getAttribute("aria-label") ?? "")
      .filter(Boolean),
    rangeCount: panel?.querySelectorAll('input[type="range"]').length ?? 0,
    disabledControlCount: panel?.querySelectorAll("button:disabled,input:disabled,select:disabled").length ?? 0,
  };
}

function readMacroFixtureDomState(label: string): DevAetherMacroFixtureState {
  const card = findElementByAriaLabel(`${label} macro control`);
  const lane = findElementByAriaLabel(`${label} macro lane`, card);
  const assignments = findElementByAriaLabel(`${label} macro assignments`, card);
  const conflict = findElementByAriaLabel(`${label} macro conflict`, card);
  return {
    instrumentId: useSynthStore.getState().boundInstrumentId,
    macroPanelText: normalizeText(findElementByAriaLabel("Macros")?.textContent ?? ""),
    brightness: {
      cardText: normalizeText(card?.textContent ?? ""),
      laneText: normalizeText(lane?.textContent ?? ""),
      assignmentsText: normalizeText(assignments?.textContent ?? ""),
      conflictText: normalizeText(conflict?.textContent ?? ""),
      conflictDetails: Array.from(card?.querySelectorAll<HTMLElement>('[aria-label$="macro conflict detail"]') ?? [])
        .map((detail) => normalizeText(detail.textContent ?? ""))
        .filter(Boolean),
    },
  };
}

function readAetherPerformanceSnapshot(): DevAetherPerformanceSnapshot {
  const draft = useSynthStore.getState().draft;
  const panel = findElementByAriaLabel("Performance controls");
  const readouts = findElementByAriaLabel("Performance source readouts", panel);
  return {
    instrumentId: useSynthStore.getState().boundInstrumentId,
    voices: typeof draft.parameters.maxVoices === "number" ? draft.parameters.maxVoices : null,
    glideMs: typeof draft.parameters["glide.ms"] === "number" ? draft.parameters["glide.ms"] : null,
    mono: draft.parameters["mono.enabled"] === true,
    legato: draft.parameters["legato.enabled"] === true,
    panelText: normalizeText(panel?.textContent ?? ""),
    readoutText: normalizeText(readouts?.textContent ?? ""),
    readoutCount: readouts?.querySelectorAll("div").length ?? 0,
  };
}

function readAetherOscillatorSnapshot(): DevAetherOscillatorSnapshot {
  const draft = useSynthStore.getState().draft;
  const panel = findElementByAriaLabel("Oscillator");
  const oscBRow = findElementByAriaLabel("Oscillator B row", panel);
  const oscBPowerButton = oscBRow?.querySelector<HTMLButtonElement>('button[aria-label$="Oscillator B"]') ?? null;
  const readNumber = (id: SynthParameterId) => {
    const value = draft.parameters[id];
    return typeof value === "number" ? value : null;
  };
  const readString = (id: SynthParameterId) => {
    const value = draft.parameters[id];
    return typeof value === "string" ? value : null;
  };
  return {
    instrumentId: useSynthStore.getState().boundInstrumentId,
    oscAEnabled: draft.parameters["osc.a.enabled"] === true,
    oscAWavetable: readString("osc.a.wavetable"),
    oscAWarpMode: readString("osc.a.warpMode"),
    oscAPosition: readNumber("osc.a.position"),
    oscAWarp: readNumber("osc.a.warp"),
    oscALevel: readNumber("osc.a.level"),
    oscAPan: readNumber("osc.a.pan"),
    oscAFine: readNumber("osc.a.fine"),
    oscBEnabled: draft.parameters["osc.b.enabled"] === true,
    oscBWavetable: readString("osc.b.wavetable"),
    oscBWarpMode: readString("osc.b.warpMode"),
    oscBLevel: readNumber("osc.b.level"),
    oscBPan: readNumber("osc.b.pan"),
    oscBRowText: normalizeText(oscBRow?.textContent ?? ""),
    oscBHasWavetableControls: Boolean(findElementByAriaLabel("Wavetable", oscBRow)),
    oscBPowerButtonLabel: oscBPowerButton?.getAttribute("aria-label") ?? null,
    unisonEnabled: draft.parameters["unison.enabled"] === true,
    unisonVoices: readNumber("unison.voices"),
    unisonDetune: readNumber("unison.detune"),
    unisonBlend: readNumber("unison.blend"),
    unisonSpread: readNumber("unison.spread"),
    mono: draft.parameters["mono.enabled"] === true,
    legato: draft.parameters["legato.enabled"] === true,
    panelText: normalizeText(panel?.textContent ?? ""),
  };
}

function readAetherFxRackSnapshot(): DevAetherFxRackSnapshot {
  const draft = useSynthStore.getState().draft;
  const panel = findElementByAriaLabel("Aether instrument effects");
  const details = findElementByAriaLabel("Selected Aether FX preset details", panel);
  return {
    instrumentId: useSynthStore.getState().boundInstrumentId,
    effectKinds: draft.effects.filters.map((effect) => effect.kind),
    bypassed: draft.effects.filters.map((effect) => effect.bypassed),
    params: draft.effects.filters.map((effect) => ({ ...effect.params })),
    detailsText: normalizeText(details?.textContent ?? ""),
    blockTexts: findEffectBlocks().map((block) => normalizeText(block.textContent ?? "")),
  };
}

function readAetherLfoSnapshot(lfo: 1 | 2): DevAetherLfoSnapshot {
  const draft = useSynthStore.getState().draft;
  const prefix = `lfo.${lfo}` as const;
  const panel = findElementByAriaLabel("LFO");
  const lane = findElementByAriaLabel(`LFO ${lfo}`, panel);
  const readNumber = (suffix: "rate" | "phase" | "smoothing" | "randomPhase") => {
    const value = draft.parameters[`${prefix}.${suffix}` as SynthParameterId];
    return typeof value === "number" ? value : null;
  };
  return {
    instrumentId: useSynthStore.getState().boundInstrumentId,
    enabled: draft.parameters[`${prefix}.enabled` as SynthParameterId] === true,
    sync: draft.parameters[`${prefix}.sync` as SynthParameterId] === true,
    syncedRate: typeof draft.parameters[`${prefix}.syncedRate` as SynthParameterId] === "string"
      ? String(draft.parameters[`${prefix}.syncedRate` as SynthParameterId])
      : null,
    rate: readNumber("rate"),
    shape: typeof draft.parameters[`${prefix}.shape` as SynthParameterId] === "string"
      ? String(draft.parameters[`${prefix}.shape` as SynthParameterId])
      : null,
    phase: readNumber("phase"),
    smoothing: readNumber("smoothing"),
    randomPhase: readNumber("randomPhase"),
    retrigger: draft.parameters[`${prefix}.retrigger` as SynthParameterId] !== false,
    oneShot: draft.parameters[`${prefix}.oneShot` as SynthParameterId] === true,
    laneText: normalizeText(lane?.textContent ?? ""),
    panelText: normalizeText(panel?.textContent ?? ""),
  };
}

function readAetherAmpFilterSnapshot(): DevAetherAmpFilterSnapshot {
  const draft = useSynthStore.getState().draft;
  const panel = findElementByAriaLabel("Amp and filter");
  const readNumber = (id: SynthParameterId) => {
    const value = draft.parameters[id];
    return typeof value === "number" ? value : null;
  };
  return {
    instrumentId: useSynthStore.getState().boundInstrumentId,
    filterEnabled: draft.parameters["filter.enabled"] === true,
    filterType: typeof draft.parameters["filter.type"] === "string" ? String(draft.parameters["filter.type"]) : null,
    cutoff: readNumber("filter.cutoff"),
    resonance: readNumber("filter.resonance"),
    keytrack: readNumber("filter.keytrack"),
    drive: readNumber("filter.drive"),
    ampLevel: readNumber("amp.level"),
    ampPan: readNumber("amp.pan"),
    env1Loop: draft.parameters["env.1.loop"] === true,
    env2Loop: draft.parameters["env.2.loop"] === true,
    panelText: normalizeText(panel?.textContent ?? ""),
  };
}

function readModulationRouteSnapshots(): DevModulationRouteSnapshot[] {
  return useSynthStore.getState().draft.modulation.map((route) => {
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-modulation-route-id]"))
      .find((candidate) => candidate.dataset.modulationRouteId === route.id);
    return {
      id: route.id,
      source: route.source,
      target: route.target,
      amount: route.amount,
      enabled: route.enabled,
      rowText: normalizeText(row?.textContent ?? ""),
    };
  });
}

function routeControlRoot(routeNumber: number): HTMLElement | null {
  return findElementByAriaLabel(`Modulation route ${routeNumber}`);
}

function setRouteSource(routeNumber: number, source: string) {
  const select = routeControlRoot(routeNumber)?.querySelector<HTMLSelectElement>(`select[aria-label="Route ${routeNumber} source"]`);
  if (!select) return;
  select.value = source;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

async function setRouteTarget(routeNumber: number, target: string) {
  const trigger = routeControlRoot(routeNumber)?.querySelector<HTMLButtonElement>(`button[aria-label="Route ${routeNumber} target"]`);
  trigger?.click();
  await nextFrame();
  const option = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-modulation-target-option]"))
    .find((candidate) => candidate.dataset.modulationTargetOption === target);
  option?.click();
}

function setRouteStrength(routeNumber: number, value: string) {
  const input = routeControlRoot(routeNumber)?.querySelector<HTMLInputElement>(`input[aria-label="Route ${routeNumber} strength"]`);
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function toggleRouteEnabled(routeNumber: number) {
  const button = routeControlRoot(routeNumber)?.querySelector<HTMLButtonElement>(`button[aria-label="Route ${routeNumber} enabled"]`);
  button?.click();
}

function readAetherWavemapEditorFixtureState(): DevAetherWavemapEditorFixtureState {
  const draft = useSynthStore.getState().draft;
  const table = draft.metadata.wavemaps?.[DEV_AETHER_WAVEMAP_ID] ?? draft.metadata.customWavetables?.[DEV_AETHER_WAVEMAP_ID] ?? null;
  const editor = findElementByAriaLabel("Oscillator A wavemap frames");
  const analysis = findElementByAriaLabel("Wavemap analysis details", editor);
  const manualRange = findElementByAriaLabel("Manual audio resynthesis range", editor);
  const editorText = normalizeText(editor?.textContent ?? "");
  return {
    instrumentId: useSynthStore.getState().boundInstrumentId,
    selectedWavetable: String(draft.parameters["osc.a.wavetable"] ?? ""),
    editorText,
    analysisText: normalizeText(analysis?.textContent ?? ""),
    manualRangeText: normalizeText(manualRange?.textContent ?? ""),
    interpolation: table?.interpolation ?? null,
    morph: table?.morph ?? null,
    firstPartials: table?.frames?.[0]?.partials?.slice(0, 6) ?? [],
    firstFrameBrightness: table?.frames?.[0]?.brightness ?? null,
    visibleModes: {
      details: Boolean(analysis),
      additive: selectedButtonExists("Oscillator A wavemap frames", "Additive wavemap editing"),
      manual: Boolean(manualRange),
      smooth: table?.interpolation === "smooth",
    },
  };
}

function readAetherWavemapFirstFrameSnapshot(): DevAetherWavemapFrameSnapshot {
  const draft = useSynthStore.getState().draft;
  const table = draft.metadata.wavemaps?.[DEV_AETHER_WAVEMAP_ID] ?? draft.metadata.customWavetables?.[DEV_AETHER_WAVEMAP_ID] ?? null;
  const frame = table?.frames?.[0] ?? null;
  const analysis = frame?.analysis;
  return {
    brightness: frame?.brightness ?? null,
    even: frame?.even ?? null,
    fold: frame?.fold ?? null,
    formant: frame?.formant ?? null,
    notch: frame?.notch ?? null,
    skew: frame?.skew ?? null,
    tilt: frame?.tilt ?? null,
    focus: frame?.focus ?? null,
    phase: frame?.phase ?? null,
    partials: frame?.partials?.slice(0, 8) ?? [],
    analysis: {
      rms: analysis?.rms ?? null,
      peak: analysis?.peak ?? null,
      zeroCrossRate: analysis?.zeroCrossRate ?? null,
      roughness: analysis?.roughness ?? null,
      spectralCentroid: analysis?.spectralCentroid ?? null,
    },
  };
}

function readAetherWavemapSourceSnapshot(): DevAetherWavemapSourceSnapshot {
  const table = readAetherWavemapFixtureTable();
  const source = table?.source;
  return {
    sourceKind: source?.kind ?? null,
    sourceLabel: source?.label ?? null,
    audioFileId: source?.audioFileId ?? null,
    sampleRate: source?.sampleRate ?? null,
    channelCount: source?.channelCount ?? null,
    bitDepth: source?.bitDepth ?? null,
    sourceSampleCount: source?.sourceSampleCount ?? null,
    sourceStartSample: source?.sourceStartSample ?? null,
    sourceEndSample: source?.sourceEndSample ?? null,
    frameCount: table?.frames.length ?? 0,
  };
}

function readAetherWavemapFixtureTable() {
  const draft = useSynthStore.getState().draft;
  return draft.metadata.wavemaps?.[DEV_AETHER_WAVEMAP_ID] ?? draft.metadata.customWavetables?.[DEV_AETHER_WAVEMAP_ID] ?? null;
}

function findFirstWavemapDrawSurface(): SVGSVGElement | null {
  const editor = findElementByAriaLabel("Oscillator A wavemap frames");
  return Array.from(editor?.querySelectorAll<SVGSVGElement>('svg[aria-label="Draw waveform"]') ?? [])[0] ?? null;
}

function readFirstWavemapDrawPath(): string | null {
  return findFirstWavemapDrawSurface()?.querySelector<SVGPathElement>("path")?.getAttribute("d") ?? null;
}

function dragFirstWavemapDrawSurface() {
  const surface = findFirstWavemapDrawSurface();
  const rect = surface?.getBoundingClientRect();
  if (!surface || !rect || rect.width <= 0 || rect.height <= 0) return;
  const point = (xRatio: number, yRatio: number) => ({
    clientX: rect.left + rect.width * xRatio,
    clientY: rect.top + rect.height * yRatio,
  });
  const pointerBase = {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    pointerId: 11,
    pointerType: "mouse",
  };
  surface.dispatchEvent(new PointerEvent("pointerdown", {
    ...pointerBase,
    ...point(0.12, 0.82),
  }));
  surface.dispatchEvent(new PointerEvent("pointermove", {
    ...pointerBase,
    ...point(0.38, 0.24),
  }));
  surface.dispatchEvent(new PointerEvent("pointermove", {
    ...pointerBase,
    ...point(0.74, 0.68),
  }));
  surface.dispatchEvent(new PointerEvent("pointerup", {
    ...pointerBase,
    buttons: 0,
    ...point(0.74, 0.68),
  }));
}

function findElementByAriaLabel(label: string, root: ParentNode | null = document): HTMLElement | null {
  return Array.from(root?.querySelectorAll<HTMLElement>("[aria-label]") ?? [])
    .find((candidate) => candidate.getAttribute("aria-label") === label) ?? null;
}

function selectedButtonExists(panelLabel: string, buttonLabel: string): boolean {
  const panel = findElementByAriaLabel(panelLabel);
  const button = Array.from(panel?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((candidate) => normalizeText(candidate.getAttribute("aria-label") ?? candidate.textContent ?? "") === buttonLabel);
  return Boolean(button?.getAttribute("aria-pressed") === "true" || button?.className.includes("selected") || button?.dataset.selected === "true");
}

function clickPanelButton(panelLabel: string, buttonLabel: string) {
  const panel = document.querySelector<HTMLElement>(`[aria-label="${panelLabel}"]`);
  const button = Array.from(panel?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [])
    .find((candidate) => candidate.getAttribute("aria-label") === buttonLabel);
  button?.click();
}

function clickPanelButtonByText(panelLabel: string, buttonLabel: string) {
  const panel = document.querySelector<HTMLElement>(`[aria-label="${panelLabel}"]`);
  const button = Array.from(panel?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((candidate) => normalizeText(candidate.getAttribute("aria-label") ?? candidate.textContent ?? "") === buttonLabel);
  button?.click();
}

function setNumberInputInPanel(panelLabel: string, fieldLabel: string, value: string) {
  const panel = findElementByAriaLabel(panelLabel);
  const label = Array.from(panel?.querySelectorAll<HTMLLabelElement>("label") ?? [])
    .find((candidate) => normalizeText(candidate.querySelector("span")?.textContent ?? "") === fieldLabel);
  const input = label?.querySelector<HTMLInputElement>("input");
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

function setSelectByAriaLabel(label: string, value: string) {
  const select = findElementByAriaLabel(label) as HTMLSelectElement | null;
  if (!select) return;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function findEffectBlocks(): HTMLElement[] {
  const panel = findElementByAriaLabel("Aether instrument effects");
  return Array.from(panel?.querySelectorAll<HTMLElement>("article") ?? []);
}

function findEffectBlock(effectLabel: string): HTMLElement | null {
  return findEffectBlocks()
    .find((block) => normalizeText(block.textContent ?? "").includes(effectLabel)) ?? null;
}

function setNumberInputInEffectBlock(effectLabel: string, fieldLabel: string, value: string) {
  const block = findEffectBlock(effectLabel);
  const label = Array.from(block?.querySelectorAll<HTMLLabelElement>("label") ?? [])
    .find((candidate) => normalizeText(candidate.querySelector("span")?.textContent ?? "") === fieldLabel);
  const input = label?.querySelector<HTMLInputElement>("input");
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

function clickButtonInEffectBlock(effectLabel: string, buttonLabel: string) {
  const block = findEffectBlock(effectLabel);
  const button = Array.from(block?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((candidate) => normalizeText(candidate.getAttribute("aria-label") ?? candidate.textContent ?? "") === buttonLabel);
  button?.click();
}

function setEffectBlockEnabled(effectLabel: string, enabled: boolean) {
  const block = findEffectBlock(effectLabel);
  const button = block?.querySelector<HTMLButtonElement>('button[role="switch"]');
  if (!button || button.getAttribute("aria-checked") === String(enabled)) return;
  button.click();
}

function setSwitchInPanel(panelLabel: string, switchLabel: string, checked: boolean) {
  const panel = findElementByAriaLabel(panelLabel);
  const label = Array.from(panel?.querySelectorAll<HTMLLabelElement>("label") ?? [])
    .find((candidate) => normalizeText(candidate.querySelector("span")?.textContent ?? "") === switchLabel);
  const button = label?.querySelector<HTMLButtonElement>('button[role="switch"]');
  if (!button || button.getAttribute("aria-checked") === String(checked)) return;
  button.click();
}

function clickRadioInPanel(panelLabel: string, groupLabel: string, optionLabel: string) {
  const panel = findElementByAriaLabel(panelLabel);
  const group = findElementByAriaLabel(groupLabel, panel);
  const button = Array.from(group?.querySelectorAll<HTMLButtonElement>('button[role="radio"]') ?? [])
    .find((candidate) => candidate.getAttribute("aria-label") === optionLabel);
  button?.click();
}

function clickRadioInRegion(regionLabel: string, groupLabel: string, optionLabel: string) {
  const region = findElementByAriaLabel(regionLabel);
  const group = findElementByAriaLabel(groupLabel, region);
  const button = Array.from(group?.querySelectorAll<HTMLButtonElement>('button[role="radio"]') ?? [])
    .find((candidate) => candidate.getAttribute("aria-label") === optionLabel);
  button?.click();
}

async function setKnobValueInPanel(panelLabel: string, knobLabel: string, value: string) {
  const panel = findElementByAriaLabel(panelLabel);
  const button = Array.from(panel?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((candidate) => candidate.getAttribute("aria-label") === `Edit ${knobLabel}`);
  const frame = button?.parentElement;
  button?.click();
  await nextFrame();
  const input = frame?.querySelector<HTMLInputElement>("input");
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

async function setKnobValueInRegion(regionLabel: string, knobLabel: string, value: string) {
  const region = findElementByAriaLabel(regionLabel);
  const button = Array.from(region?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((candidate) => candidate.getAttribute("aria-label") === `Edit ${knobLabel}`);
  const frame = button?.parentElement;
  button?.click();
  await nextFrame();
  const input = frame?.querySelector<HTMLInputElement>("input");
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

function setLastAutomationPointField(panelLabel: string, fieldLabel: "Beat" | "Value", value: string) {
  const panel = document.querySelector<HTMLElement>(`[aria-label="${panelLabel}"]`);
  const rows = Array.from(panel?.querySelectorAll<HTMLElement>('[class*="automationPointRow"]') ?? []);
  const row = rows[rows.length - 1];
  const label = Array.from(row?.querySelectorAll<HTMLLabelElement>("label") ?? [])
    .find((candidate) => normalizeText(candidate.querySelector("span")?.textContent ?? "") === fieldLabel);
  const input = label?.querySelector<HTMLInputElement>("input");
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setAutomationPointSelection(panelLabel: string, rowIndex: number, selected: boolean) {
  const panel = document.querySelector<HTMLElement>(`[aria-label="${panelLabel}"]`);
  const rows = Array.from(panel?.querySelectorAll<HTMLElement>('[class*="automationPointRow"]') ?? []);
  const row = rows[rowIndex];
  const checkbox = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!checkbox || checkbox.checked === selected) return;
  checkbox.click();
}

function readAutomationPointSelectionCount(panelLabel: string): number {
  const panel = document.querySelector<HTMLElement>(`[aria-label="${panelLabel}"]`);
  return Array.from(panel?.querySelectorAll<HTMLInputElement>('[class*="automationPointRow"] input[type="checkbox"]') ?? [])
    .filter((input) => input.checked)
    .length;
}

function clickLastAutomationPointRemove(panelLabel: string) {
  const panel = document.querySelector<HTMLElement>(`[aria-label="${panelLabel}"]`);
  const rows = Array.from(panel?.querySelectorAll<HTMLElement>('[class*="automationPointRow"]') ?? []);
  const row = rows[rows.length - 1];
  const button = Array.from(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((candidate) => normalizeText(candidate.textContent ?? "") === "Remove");
  button?.click();
}

function findFieldSelect(label: string): HTMLSelectElement | null {
  return Array.from(document.querySelectorAll<HTMLLabelElement>("label"))
    .find((candidate) => normalizeText(candidate.querySelector<HTMLElement>(".ds-field-label")?.textContent ?? "") === label)
    ?.querySelector("select") ?? null;
}

function setFieldSelectValue(label: string, value: string) {
  const select = findFieldSelect(label);
  if (!select) return;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function findButton(label: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.getAttribute("aria-label") === label || normalizeText(button.textContent ?? "") === label) ?? null;
}

function clickButton(label: string) {
  findButton(label)?.click();
}

function clickFirstMidiNote() {
  const note = document.querySelector<HTMLElement>("[data-midi-note-index='0']");
  if (!note) return;
  const rect = note.getBoundingClientRect();
  const pointerInit = {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + Math.max(1, rect.width / 2),
    clientY: rect.top + Math.max(1, rect.height / 2),
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
  };
  note.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
  note.dispatchEvent(new PointerEvent("pointerup", pointerInit));
}

function writeAetherAutomationFixtureMarker() {
  const project = useProjectStore.getState().project;
  const track = project.tracks.find((candidate) => candidate.id === DEV_AETHER_AUTOMATION_TRACK_ID) ?? null;
  const segment = track?.segments.find((candidate) => candidate.id === DEV_AETHER_AUTOMATION_SEGMENT_ID) ?? null;
  const notes = segment?.payload.kind === "midi" || segment?.payload.kind === "mixed"
    ? segment.payload.notes
    : [];
  document.documentElement.dataset.beatAetherAutomationFixture = JSON.stringify({
    trackId: track?.id ?? null,
    segmentId: segment?.id ?? null,
    instrumentId: track?.instrumentId ?? segment?.instrumentId ?? null,
    trackLaneTargets: (track?.automation ?? []).map((lane) => lane.target),
    segmentLaneTargets: (segment?.automation ?? []).map((lane) => lane.target),
    noteLaneTargets: (notes[0]?.automation ?? []).map((lane) => lane.target),
    noteCount: notes.length,
    firstNote: notes[0]
      ? {
          pitch: notes[0].pitch,
          startBeat: notes[0].startBeat,
          lengthBeats: notes[0].lengthBeats,
          automationTargets: (notes[0].automation ?? []).map((lane) => lane.target),
        }
      : null,
    openEditors: useUiStore.getState().openEditors.map((editor) => editor.kind),
  });
}

function writeAetherAutomationPointExerciseMarker(state: DevAetherAutomationPointExerciseState) {
  document.documentElement.dataset.beatAetherAutomationPointExercise = JSON.stringify(state);
}

function writeAetherDirectAutomationPointExerciseMarker(state: DevAetherDirectAutomationPointExerciseState) {
  document.documentElement.dataset.beatAetherDirectAutomationPointExercise = JSON.stringify(state);
}

function writeAetherArrangementAutomationDragExerciseMarker(state: DevAetherArrangementAutomationDragExerciseState) {
  document.documentElement.dataset.beatAetherArrangementAutomationDragExercise = JSON.stringify(state);
}

function writeAetherNoteAutomationDragExerciseMarker(state: DevAetherNoteAutomationDragExerciseState) {
  document.documentElement.dataset.beatAetherNoteAutomationDragExercise = JSON.stringify(state);
}

function writeAetherSegmentAutomationDragExerciseMarker(state: DevAetherSegmentAutomationDragExerciseState) {
  document.documentElement.dataset.beatAetherSegmentAutomationDragExercise = JSON.stringify(state);
}

function writeAetherTrackAutomationDragExerciseMarker(state: DevAetherTrackAutomationDragExerciseState) {
  document.documentElement.dataset.beatAetherTrackAutomationDragExercise = JSON.stringify(state);
}

function writeAetherMacroFixtureMarker(state = readMacroFixtureDomState("Brightness")) {
  document.documentElement.dataset.beatAetherMacroFixture = JSON.stringify(state);
}

function writeAetherMacroAssignmentExerciseMarker(state: DevAetherMacroAssignmentExerciseState) {
  document.documentElement.dataset.beatAetherMacroAssignmentExercise = JSON.stringify(state);
}

function writeAetherOscillatorExerciseMarker(state: DevAetherOscillatorExerciseState) {
  document.documentElement.dataset.beatAetherOscillatorExercise = JSON.stringify(state);
}

function writeAetherFxRackExerciseMarker(state: DevAetherFxRackExerciseState) {
  document.documentElement.dataset.beatAetherFxRackExercise = JSON.stringify(state);
}

function writeAetherWavemapEditorFixtureMarker(state = readAetherWavemapEditorFixtureState()) {
  document.documentElement.dataset.beatAetherWavemapEditorFixture = JSON.stringify(state);
}

function writeAetherWavemapPointerDrawExerciseMarker(state: DevAetherWavemapPointerDrawExerciseState) {
  document.documentElement.dataset.beatAetherWavemapPointerDrawExercise = JSON.stringify(state);
}

function writeAetherWavemapImportExerciseMarker(state: DevAetherWavemapImportExerciseState) {
  document.documentElement.dataset.beatAetherWavemapImportExercise = JSON.stringify(state);
}

function writeAetherEnvelopeHandleExerciseMarker(state: DevAetherEnvelopeHandleExerciseState) {
  document.documentElement.dataset.beatAetherEnvelopeHandleExercise = JSON.stringify(state);
}

function writeAetherAmpFilterExerciseMarker(state: DevAetherAmpFilterExerciseState) {
  document.documentElement.dataset.beatAetherAmpFilterExercise = JSON.stringify(state);
}

function writeAetherLfoExerciseMarker(state: DevAetherLfoExerciseState) {
  document.documentElement.dataset.beatAetherLfoExercise = JSON.stringify(state);
}

function writeAetherPerformanceExerciseMarker(state: DevAetherPerformanceExerciseState) {
  document.documentElement.dataset.beatAetherPerformanceExercise = JSON.stringify(state);
}

function writeAetherPresetRestoreInitExerciseMarker(state: DevAetherPresetRestoreInitExerciseState) {
  document.documentElement.dataset.beatAetherPresetRestoreInitExercise = JSON.stringify(state);
}

function writeAetherPresetSaveDeleteExerciseMarker(state: DevAetherPresetSaveDeleteExerciseState) {
  document.documentElement.dataset.beatAetherPresetSaveDeleteExercise = JSON.stringify(state);
}

function findEnvelopeHandle(source: "env.1" | "env.2", kind: "attack" | "decay-sustain" | "release"): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[data-aether-envelope-editor="${source}"] [data-aether-envelope-handle="${kind}"]`);
}

function findEnvelopeCurveButton(source: "env.1" | "env.2", segment: "attack" | "decay" | "release"): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[data-aether-envelope-editor="${source}"] [data-aether-envelope-curve="${segment}"]`);
}

function readAetherEnvelopeSnapshot(source: "env.1" | "env.2"): DevAetherEnvelopeSnapshot {
  const draft = useSynthStore.getState().draft;
  const read = (suffix: "attack" | "decay" | "sustain" | "release") => Number(draft.parameters[`${source}.${suffix}` as SynthParameterId] ?? 0);
  const readCurve = (suffix: "attackCurve" | "decayCurve" | "releaseCurve") => String(draft.parameters[`${source}.${suffix}` as SynthParameterId] ?? "");
  const card = document.querySelector<HTMLElement>(`[data-aether-envelope-editor="${source}"]`);
  return {
    attack: read("attack"),
    decay: read("decay"),
    sustain: read("sustain"),
    release: read("release"),
    attackCurve: readCurve("attackCurve"),
    decayCurve: readCurve("decayCurve"),
    releaseCurve: readCurve("releaseCurve"),
    cardText: normalizeText(card?.textContent ?? ""),
    handleLabels: {
      attack: findEnvelopeHandle(source, "attack")?.getAttribute("aria-label") ?? null,
      decaySustain: findEnvelopeHandle(source, "decay-sustain")?.getAttribute("aria-label") ?? null,
      release: findEnvelopeHandle(source, "release")?.getAttribute("aria-label") ?? null,
    },
    curveLabels: {
      attack: findEnvelopeCurveButton(source, "attack")?.getAttribute("aria-label") ?? null,
      decay: findEnvelopeCurveButton(source, "decay")?.getAttribute("aria-label") ?? null,
      release: findEnvelopeCurveButton(source, "release")?.getAttribute("aria-label") ?? null,
    },
  };
}

function clickEnvelopeCurve(source: "env.1" | "env.2", segment: "attack" | "decay" | "release") {
  findEnvelopeCurveButton(source, segment)?.click();
}

function dragEnvelopeHandle(source: "env.1" | "env.2", kind: "attack" | "decay-sustain" | "release", xRatio: number, yRatio: number) {
  const handle = findEnvelopeHandle(source, kind);
  const rail = handle?.parentElement?.querySelector<SVGSVGElement>("svg");
  const handleRect = handle?.getBoundingClientRect();
  const railRect = rail?.getBoundingClientRect();
  if (!handle || !railRect || !handleRect || railRect.width <= 0 || railRect.height <= 0) return;
  const pointerInit = {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    pointerId: 37,
    pointerType: "mouse",
    clientX: handleRect.left + handleRect.width / 2,
    clientY: handleRect.top + handleRect.height / 2,
  };
  const targetX = railRect.left + railRect.width * Math.max(0, Math.min(1, xRatio));
  const targetY = railRect.top + railRect.height * Math.max(0, Math.min(1, yRatio));
  handle.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
  handle.dispatchEvent(new PointerEvent("pointermove", {
    ...pointerInit,
    clientX: targetX,
    clientY: targetY,
  }));
  handle.dispatchEvent(new PointerEvent("pointerup", {
    ...pointerInit,
    buttons: 0,
    clientX: targetX,
    clientY: targetY,
  }));
}

function aetherAutomationPointEditorLabel(editor: DevAetherAutomationPointEditor): string {
  if (editor === "track") return "Aether track automation points";
  if (editor === "segment") return "Aether segment automation points";
  return "Aether note automation points";
}

function aetherAutomationLanePanelLabel(editor: DevAetherAutomationPointEditor): string {
  if (editor === "track") return "Aether track automation lanes";
  if (editor === "segment") return "Aether segment automation lanes";
  return "Aether note automation lanes";
}

function aetherAutomationTargetButtonLabel(editor: DevAetherAutomationPointEditor, target: MidiAutomationTarget): string {
  const label = target === "filter.cutoff"
    ? "Cutoff"
    : target === "amp.pan"
      ? "Pan"
      : target === "macro.1"
        ? "Macro 1"
        : String(target);
  if (editor === "track") return `${label} track automation lane`;
  if (editor === "segment") return `${label} segment automation lane`;
  return `${label} automation lane`;
}

function clickAetherAutomationTarget(editor: DevAetherAutomationPointEditor, target: MidiAutomationTarget) {
  clickPanelButton(aetherAutomationLanePanelLabel(editor), aetherAutomationTargetButtonLabel(editor, target));
}

function readAutomationPointPanelRows(panelLabel: string): DevAutomationPointSnapshot[] {
  const panel = document.querySelector<HTMLElement>(`[aria-label="${panelLabel}"]`);
  return Array.from(panel?.querySelectorAll<HTMLElement>('[class*="automationPointRow"]') ?? []).map((row) => {
    const readField = (fieldLabel: "Beat" | "Value") => {
      const label = Array.from(row.querySelectorAll<HTMLLabelElement>("label"))
        .find((candidate) => normalizeText(candidate.querySelector("span")?.textContent ?? "") === fieldLabel);
      return Number(label?.querySelector<HTMLInputElement>("input")?.value ?? 0);
    };
    return {
      beat: readField("Beat"),
      value: readField("Value"),
      curve: null,
    };
  });
}

function readAutomationCurveControlLabel(editor: DevAetherAutomationPointEditor): string | null {
  const triggerLabel = editor === "track"
    ? "Aether track automation curve"
    : editor === "segment"
      ? "Aether segment automation curve"
      : "Aether note automation curve";
  const panel = findElementByAriaLabel(aetherAutomationLanePanelLabel(editor));
  const trigger = findElementByAriaLabel(triggerLabel, panel);
  return normalizeText(trigger?.textContent ?? "") || null;
}

async function chooseAutomationCurve(editor: DevAetherAutomationPointEditor, optionLabel: string) {
  const triggerLabel = editor === "track"
    ? "Aether track automation curve"
    : editor === "segment"
      ? "Aether segment automation curve"
      : "Aether note automation curve";
  const panel = findElementByAriaLabel(aetherAutomationLanePanelLabel(editor));
  const trigger = findElementByAriaLabel(triggerLabel, panel) as HTMLButtonElement | null;
  trigger?.click();
  await nextFrame();
  const listboxes = Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]'));
  const listbox = listboxes[listboxes.length - 1] ?? null;
  const option = Array.from(listbox?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
    .find((candidate) => normalizeText(candidate.textContent ?? "") === optionLabel);
  option?.click();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await nextFrame();
    if (readAutomationCurveControlLabel(editor) === optionLabel) return;
  }
}

async function waitForEditorPanel(label: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await nextFrame();
    if (document.querySelector(`[aria-label="${label}"]`)) return;
  }
}

async function waitForArrangementAutomationLane() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await nextFrame();
    if (document.querySelector("[data-aether-arrangement-automation]")) return;
  }
}

async function waitForNoteAutomationHandle(edge: "start" | "mid" | "end") {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await nextFrame();
    if (findNoteAutomationHandle(edge)) return;
  }
}

async function waitForSegmentAutomationHandle(edge: "start" | "mid" | "end") {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await nextFrame();
    if (findSegmentAutomationHandle(edge)) return;
  }
}

async function waitForTrackAutomationHandle(edge: "start" | "mid" | "end") {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await nextFrame();
    if (findTrackAutomationHandle(edge)) return;
  }
}

async function waitForEnvelopeHandle(source: "env.1" | "env.2", kind: "attack" | "decay-sustain" | "release") {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await nextFrame();
    if (findEnvelopeHandle(source, kind)) return;
  }
}

async function waitForAetherWavemapSourceKind(kind: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await nextFrame();
    if (readAetherWavemapSourceSnapshot().sourceKind === kind) return;
  }
}

async function waitForMacroControl(label: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await nextFrame();
    if (findElementByAriaLabel(`${label} macro control`)) return;
  }
}

async function waitForPresetOption(label: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await nextFrame();
    const presetSelect = findFieldSelect("Preset");
    if (Array.from(presetSelect?.options ?? []).some((option) => option.label === label)) return;
  }
}

async function waitForPresetFavorite(id: string, favorite: boolean) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await nextFrame();
    if ((await db.synthPresets.get(id))?.favorite === favorite) return;
  }
}

async function waitForSynthPresetNamed(name: string): Promise<SynthPresetRecord | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await nextFrame();
    const record = await db.synthPresets.where("name").equals(name).first();
    if (record) return record;
  }
  return null;
}

async function waitForSynthPresetDeleted(id: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await nextFrame();
    if (!await db.synthPresets.get(id)) return;
  }
}

async function completePromptDialog(label: string, value: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await nextFrame();
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (!input) continue;
    input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    clickButton("Done");
    return;
  }
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function createBrowserWavemapFixture() {
  const base = createDefaultCustomWavetable(DEV_AETHER_WAVEMAP_ID);
  return {
    ...base,
    name: "Browser Wavemap",
    interpolation: "linear" as const,
    morph: 0.36,
    source: {
      kind: "resynthesized" as const,
      label: "Browser fixture audio",
      sampleRate: 48_000,
      channelCount: 2,
      bitDepth: 24,
      sourceSampleCount: 8192,
      analyzedSampleCount: 4096,
      frameCount: base.frames.length,
    },
    frames: base.frames.map((frame, index) => ({
      ...frame,
      partials: Array.from({ length: 16 }, (_, partialIndex) => partialIndex === 0 ? 0.7 - index * 0.08 : 0.05),
      analysis: {
        sourceStartSample: index * 1024,
        sourceEndSample: index * 1024 + 1024,
        rms: 0.22 + index * 0.04,
        peak: 0.72 + index * 0.03,
        zeroCrossRate: 0.08 + index * 0.02,
        roughness: 0.18 + index * 0.03,
        asymmetry: -0.12 + index * 0.07,
        spectralCentroid: 3.5 + index * 1.2,
        dominantHarmonic: 2 + index,
        dominantPhase: -0.2 + index * 0.1,
      },
    })),
  };
}

function createDevWavemapAudioFile() {
  const sampleRate = 44_100;
  const durationSeconds = 0.42;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / sampleRate;
    const sweep = 180 + 720 * (index / Math.max(1, sampleCount - 1));
    samples[index] = Math.max(-1, Math.min(1,
      0.54 * Math.sin(2 * Math.PI * sweep * t)
      + 0.22 * Math.sin(2 * Math.PI * 2.01 * sweep * t + 0.4)
      + 0.08 * Math.sin(2 * Math.PI * 5.2 * sweep * t + 1.2),
    ));
  }
  return {
    id: "dev-aether-import-audio",
    name: "dev-aether-import.wav",
    path: wavSamplesToDataUrl(samples, sampleRate),
    durationSeconds,
    sampleRate,
    bitDepth: 16,
    sizeBytes: 44 + sampleCount * 2,
    importedAt: 1_700_000_512_000,
  };
}

function wavSamplesToDataUrl(samples: Float32Array, sampleRate: number): string {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, Math.round(sample * 32767), true);
  }
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function createAetherPresetLibraryFixtureRecord({
  id,
  name,
  tags,
  favorite,
  cutoff,
}: {
  id: string;
  name: string;
  tags: string[];
  favorite: boolean;
  cutoff: number;
}) {
  const draft = createDefaultSynthDraft();
  const patch: SynthDraftPatch = {
    ...draft,
    name,
    parameters: {
      ...draft.parameters,
      "filter.cutoff": cutoff,
      "osc.a.position": favorite ? 0.68 : 0.24,
      "osc.a.warp": favorite ? 0.42 : 0.12,
    },
    metadata: {
      ...draft.metadata,
      tags,
    },
  };
  return createSynthPresetRecord({
    id,
    name,
    patch,
    tags,
    favorite,
    now: favorite ? 1_700_000_425_000 : 1_700_000_426_000,
  });
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
              {
                brightness: 0.42,
                even: 0.2,
                fold: 0.12,
                formant: 0.22,
                notch: 0.1,
                skew: 0.1,
                tilt: 0.2,
                focus: 0.4,
                phase: 0.1,
                analysis: {
                  sourceStartSample: 128,
                  sourceEndSample: 1152,
                  rms: 0.31,
                  peak: 0.88,
                  zeroCrossRate: 0.12,
                  roughness: 0.2,
                  asymmetry: 0.08,
                  spectralCentroid: 4.2,
                  dominantHarmonic: 5,
                  dominantPhase: 0.4,
                },
              },
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
              {
                brightness: 0.82,
                even: 0.21,
                fold: 0.17,
                formant: 0.69,
                notch: 0.27,
                skew: -0.42,
                tilt: -0.19,
                focus: 0.58,
                phase: -0.31,
                partials: [0.9, 0.7, 0.5],
                analysis: {
                  sourceStartSample: 2048,
                  sourceEndSample: 4096,
                  rms: 0.46,
                  peak: 0.91,
                  zeroCrossRate: 0.18,
                  roughness: 0.28,
                  asymmetry: -0.06,
                  spectralCentroid: 6.8,
                  dominantHarmonic: 7,
                  dominantPhase: -0.2,
                },
              },
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
