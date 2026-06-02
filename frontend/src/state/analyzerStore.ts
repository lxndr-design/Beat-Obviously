import { create } from "zustand";

export interface AnalyzerSnapshot {
  sequence: number;
  rms: number;
  peak: number;
  bands: number[];
  updatedAt: number;
}

interface AnalyzerState {
  master: AnalyzerSnapshot;
  setMasterSnapshot: (snapshot: Partial<AnalyzerSnapshot>) => void;
  clear: () => void;
}

function createEmptySnapshot(): AnalyzerSnapshot {
  return {
    sequence: 0,
    rms: 0,
    peak: 0,
    bands: Array.from({ length: 32 }, () => 0),
    updatedAt: 0,
  };
}

export const useAnalyzerStore = create<AnalyzerState>((set) => ({
  master: createEmptySnapshot(),
  setMasterSnapshot: (snapshot) =>
    set((state) => ({
      master: {
        ...state.master,
        ...snapshot,
        bands: snapshot.bands ? snapshot.bands.slice(0, 32) : state.master.bands,
        updatedAt: snapshot.updatedAt ?? Date.now(),
      },
    })),
  clear: () => set({ master: createEmptySnapshot() }),
}));
