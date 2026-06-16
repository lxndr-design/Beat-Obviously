import { createStore as create } from "zustand/vanilla";
import type { ProjectExportJobStatus } from "../ipc/schema";

interface ExportState {
  job: ProjectExportJobStatus | null;
  updatedAt: number;
  setJob: (job: ProjectExportJobStatus) => void;
  clear: () => void;
}

export const useExportStore = create<ExportState>((set) => ({
  job: null,
  updatedAt: 0,
  setJob: (job) => set({ job, updatedAt: Date.now() }),
  clear: () => set({ job: null, updatedAt: Date.now() }),
}));
