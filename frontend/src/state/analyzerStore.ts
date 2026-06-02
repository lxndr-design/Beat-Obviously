import { create } from "zustand";

export const ANALYZER_BAND_COUNT = 64;

export interface AnalyzerSnapshot {
  sequence: number;
  rms: number;
  peak: number;
  bands: number[];
  updatedAt: number;
}

export interface RenderTimingSnapshot {
  sequence: number;
  blockSamples: number;
  sampleRate: number;
  scheduleMs: number;
  synthMs: number;
  samplesMs: number;
  fxMs: number;
  analyzerMs: number;
  copyMs: number;
  totalMs: number;
  loadPercent: number;
  updatedAt: number;
}

interface AnalyzerState {
  master: AnalyzerSnapshot;
  synth: AnalyzerSnapshot;
  renderTiming: RenderTimingSnapshot;
  setMasterSnapshot: (snapshot: Partial<AnalyzerSnapshot>) => void;
  setSynthSnapshot: (snapshot: Partial<AnalyzerSnapshot>) => void;
  setRenderTiming: (snapshot: Partial<RenderTimingSnapshot>) => void;
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
    samplesMs: 0,
    fxMs: 0,
    analyzerMs: 0,
    copyMs: 0,
    totalMs: 0,
    loadPercent: 0,
    updatedAt: 0,
  };
}

export const useAnalyzerStore = create<AnalyzerState>((set) => ({
  master: createEmptySnapshot(),
  synth: createEmptySnapshot(),
  renderTiming: createEmptyRenderTiming(),
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
  clear: () => set({ master: createEmptySnapshot(), synth: createEmptySnapshot(), renderTiming: createEmptyRenderTiming() }),
  clearSynth: () => set({ synth: createEmptySnapshot() }),
}));
