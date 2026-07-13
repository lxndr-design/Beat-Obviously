import { createStore as create } from "zustand/vanilla";

export const ANALYZER_BAND_COUNT = 64;

export interface AnalyzerSnapshot {
  sequence: number;
  rms: number;
  peak: number;
  rmsDbFS?: number;
  peakDbFS?: number;
  truePeakDbTP?: number;
  momentaryLufs?: number;
  bands: number[];
  updatedAt: number;
}

export interface RenderTimingSnapshot {
  sequence: number;
  blockSamples: number;
  sampleRate: number;
  scheduleMs: number;
  synthMs: number;
  voiceMs: number;
  modulationMs: number;
  samplesMs: number;
  fxMs: number;
  filterFxMs: number;
  analyzerMs: number;
  copyMs: number;
  totalMs: number;
  loadPercent: number;
  activeSynthVoices: number;
  activeSampleVoices: number;
  activeAudioClipVoices: number;
  routeCount: number;
  automationEventCount: number;
  wavetableCacheHits: number;
  wavetableCacheMisses: number;
  wavetableCacheSize: number;
  voiceRenderBlocks: number;
  voiceRenderSamples: number;
  oscillatorSamples: number;
  wavetableVoiceSamples: number;
  aetherOscASamples: number;
  aetherOscBSamples: number;
  aetherSubSamples: number;
  aetherNoiseSamples: number;
  filterSamples: number;
  filterDriveSamples: number;
  voiceNonlinearSamples: number;
  filterCoefficientUpdates: number;
  filterCutoffUpdates: number;
  filterResonanceUpdates: number;
  modulationSamples: number;
  realtimeRampSamples: number;
  oscillatorRateCalculations: number;
  wavetableFrequencyUpdates: number;
  wavetablePositionUpdates: number;
  routeEffectSamples: number;
  routeFilterEffectSamples: number;
  routeNonlinearEffectSamples: number;
  routeDelayEffectSamples: number;
  modulationWorkBudgetOverruns: number;
  nonlinearWorkBudgetOverruns: number;
  updatedAt: number;
}

export interface TrackMeterSnapshot {
  rms: number;
  peak: number;
  leftRms?: number;
  rightRms?: number;
  leftPeak?: number;
  rightPeak?: number;
  rmsDbFS?: number;
  peakDbFS?: number;
  truePeakDbTP?: number;
  momentaryLufs?: number;
  updatedAt: number;
}

interface AnalyzerState {
  master: AnalyzerSnapshot;
  synth: AnalyzerSnapshot;
  renderTiming: RenderTimingSnapshot;
  trackMeters: Record<string, TrackMeterSnapshot>;
  setMasterSnapshot: (snapshot: Partial<AnalyzerSnapshot>) => void;
  setSynthSnapshot: (snapshot: Partial<AnalyzerSnapshot>) => void;
  setRenderTiming: (snapshot: Partial<RenderTimingSnapshot>) => void;
  setTrackMeters: (meters: Array<{ id: string; rms: number; peak: number; leftRms?: number; rightRms?: number; leftPeak?: number; rightPeak?: number; rmsDbFS?: number; peakDbFS?: number; truePeakDbTP?: number; momentaryLufs?: number }>) => void;
  clear: () => void;
  clearSynth: () => void;
}

function createEmptySnapshot(): AnalyzerSnapshot {
  return {
    sequence: 0,
    rms: 0,
    peak: 0,
    bands: Array.from({ length: ANALYZER_BAND_COUNT }, () => 0),
    updatedAt: 0,
  };
}

function createEmptyRenderTiming(): RenderTimingSnapshot {
  return {
    sequence: 0,
    blockSamples: 0,
    sampleRate: 0,
    scheduleMs: 0,
    synthMs: 0,
    voiceMs: 0,
    modulationMs: 0,
    samplesMs: 0,
    fxMs: 0,
    filterFxMs: 0,
    analyzerMs: 0,
    copyMs: 0,
    totalMs: 0,
    loadPercent: 0,
    activeSynthVoices: 0,
    activeSampleVoices: 0,
    activeAudioClipVoices: 0,
    routeCount: 0,
    automationEventCount: 0,
    wavetableCacheHits: 0,
    wavetableCacheMisses: 0,
    wavetableCacheSize: 0,
    voiceRenderBlocks: 0,
    voiceRenderSamples: 0,
    oscillatorSamples: 0,
    wavetableVoiceSamples: 0,
    aetherOscASamples: 0,
    aetherOscBSamples: 0,
    aetherSubSamples: 0,
    aetherNoiseSamples: 0,
    filterSamples: 0,
    filterDriveSamples: 0,
    voiceNonlinearSamples: 0,
    filterCoefficientUpdates: 0,
    filterCutoffUpdates: 0,
    filterResonanceUpdates: 0,
    modulationSamples: 0,
    realtimeRampSamples: 0,
    oscillatorRateCalculations: 0,
    wavetableFrequencyUpdates: 0,
    wavetablePositionUpdates: 0,
    routeEffectSamples: 0,
    routeFilterEffectSamples: 0,
    routeNonlinearEffectSamples: 0,
    routeDelayEffectSamples: 0,
    modulationWorkBudgetOverruns: 0,
    nonlinearWorkBudgetOverruns: 0,
    updatedAt: 0,
  };
}

export const useAnalyzerStore = create<AnalyzerState>((set) => ({
  master: createEmptySnapshot(),
  synth: createEmptySnapshot(),
  renderTiming: createEmptyRenderTiming(),
  trackMeters: {},
  setMasterSnapshot: (snapshot) =>
    set((state) => ({
      master: {
        ...state.master,
        ...snapshot,
        bands: snapshot.bands ? snapshot.bands.slice(0, ANALYZER_BAND_COUNT) : state.master.bands,
        updatedAt: snapshot.updatedAt ?? Date.now(),
      },
    })),
  setSynthSnapshot: (snapshot) =>
    set((state) => ({
      synth: {
        ...state.synth,
        ...snapshot,
        bands: snapshot.bands ? snapshot.bands.slice(0, ANALYZER_BAND_COUNT) : state.synth.bands,
        updatedAt: snapshot.updatedAt ?? Date.now(),
      },
    })),
  setRenderTiming: (snapshot) =>
    set((state) => ({
      renderTiming: {
        ...state.renderTiming,
        ...snapshot,
        updatedAt: snapshot.updatedAt ?? Date.now(),
      },
    })),
  setTrackMeters: (meters) =>
    set((state) => {
      const next = { ...state.trackMeters };
      const updatedAt = Date.now();
      for (const meter of meters) {
        if (!meter.id || meter.id === "master") continue;
        next[meter.id] = {
          rms: clamp01(meter.rms),
          peak: clamp01(meter.peak),
          leftRms: clampOptional01(meter.leftRms),
          rightRms: clampOptional01(meter.rightRms),
          leftPeak: clampOptional01(meter.leftPeak),
          rightPeak: clampOptional01(meter.rightPeak),
          rmsDbFS: finiteOrUndefined(meter.rmsDbFS),
          peakDbFS: finiteOrUndefined(meter.peakDbFS),
          truePeakDbTP: finiteOrUndefined(meter.truePeakDbTP),
          momentaryLufs: finiteOrUndefined(meter.momentaryLufs),
          updatedAt,
        };
      }
      return { trackMeters: next };
    }),
  clear: () => set({
    master: createEmptySnapshot(),
    synth: createEmptySnapshot(),
    renderTiming: createEmptyRenderTiming(),
    trackMeters: {},
  }),
  clearSynth: () => set({ synth: createEmptySnapshot() }),
}));

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampOptional01(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : undefined;
}

function finiteOrUndefined(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}
