import type { DecentSamplerUiControl } from "../ipc/schema";
import { db } from "../persistence/dexie";
import type { AetherEffectPresetRecord } from "../state/effectPresets";
import { createDefaultSynthDraft, synthDraftToInstrumentPatch, useSynthStore, type SynthDraftPatch } from "../state/synthStore";
import { createSynthPresetRecord, type SynthPresetRecord } from "../state/synthPresets";
import {
  TEMPORARY_DS_INSTRUMENT_SET_ID,
  USER_INSTRUMENT_SET_ID,
  createEmptyProject,
  useInstrumentStore,
  usePluginStore,
  useProjectStore,
  useUiStore,
} from "../state/store";
import type { MidiAutomationTarget, PluginAdapter } from "../state/types";
import { compileNodeGraphToInstrumentPatch, createDefaultInstrumentNodeGraph } from "../features/NodeInstrumentEditor/nodeGraph";

type DevDecentSamplerFixture = "lorenzo" | "wide";
type DevAetherAutomationEditor = "arrangement" | "track" | "segment" | "note";

const DEV_MIXED_ERA_AETHER_PRESET_ID = "dev-mixed-era-aether";
const DEV_MIXED_ERA_AETHER_INSTRUMENT_ID = "dev-mixed-era-aether-host";
const DEV_MIXED_ERA_AETHER_FX_PRESET_ID = "dev-mixed-era-aether-fx";
const DEV_MIXED_ERA_AETHER_FX_INSTRUMENT_ID = "dev-mixed-era-aether-fx-host";
const DEV_AETHER_PRESET_LIBRARY_FAVORITE_ID = "dev-aether-preset-library-favorite";
const DEV_AETHER_PRESET_LIBRARY_PLAIN_ID = "dev-aether-preset-library-plain";
const DEV_AETHER_PRESET_LIBRARY_INSTRUMENT_ID = "dev-aether-preset-library-host";
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
      exerciseAetherPresetLibraryFavoriteFlow: () => Promise<{
        installed: DevAetherPresetLibraryFixtureState;
        filtered: DevAetherPresetLibraryFixtureState;
        selected: DevAetherPresetLibraryFixtureState;
        toggled: DevAetherPresetLibraryFixtureState;
      }>;
      installAetherAutomationFixture: () => {
        trackId: string;
        segmentId: string;
        instrumentId: string;
      };
      openAetherAutomationFixtureEditor: (editor: DevAetherAutomationEditor) => Promise<DevAetherAutomationFixtureState>;
      readAetherAutomationFixtureState: () => DevAetherAutomationFixtureState;
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
  favoritesFilterText: string | null;
  selectedFavoriteToggleText: string | null;
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
    await db.synthPresets.bulkDelete([DEV_AETHER_PRESET_LIBRARY_FAVORITE_ID, DEV_AETHER_PRESET_LIBRARY_PLAIN_ID]);
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
      favoritesFilterText: normalizeText(findButton("Toggle preset favorites filter")?.textContent ?? "") || null,
      selectedFavoriteToggleText: normalizeText(findButton("Toggle selected Aether preset favorite")?.textContent ?? "") || null,
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
              { beat: 4, value: 0.52, curve: "smoothstep" },
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
                    { beat: 1, value: 0.48, curve: "smoothstep" },
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
    if (editor === "note") {
      clickFirstMidiNote();
      await waitForEditorPanel("Aether note automation lanes");
      clickPanelButton("Aether note automation lanes", "Macro 1 automation lane");
      await nextFrame();
    }
    writeAetherAutomationFixtureMarker();
    return readAetherAutomationFixtureState();
  };

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
    exerciseAetherPresetLibraryFavoriteFlow,
    installAetherAutomationFixture,
    openAetherAutomationFixtureEditor,
    readAetherAutomationFixtureState,
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
  } else if (fixture === "aether-automation") {
    window.setTimeout(() => {
      const editor = new URLSearchParams(window.location.search).get("beatAutomationEditor");
      void openAetherAutomationFixtureEditor(isAetherAutomationEditor(editor) ? editor : "segment");
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

function clickPanelButton(panelLabel: string, buttonLabel: string) {
  const panel = document.querySelector<HTMLElement>(`[aria-label="${panelLabel}"]`);
  const button = Array.from(panel?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [])
    .find((candidate) => candidate.getAttribute("aria-label") === buttonLabel);
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

async function waitForEditorPanel(label: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await nextFrame();
    if (document.querySelector(`[aria-label="${label}"]`)) return;
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

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
