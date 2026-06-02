import { onEvent } from "../ipc/bridge";
import { useAnalyzerStore } from "../state/analyzerStore";

type AnalyzerSpectrumEvent = {
  kind: "analyzer.spectrum";
  sequence: number;
  rms: number;
  peak: number;
  bands: number[];
};

/**
 * Subscribes frontend analyzer state to backend meter/analyzer events.
 * The current backend schema exposes level meters only; spectrum bins can be
 * added here once the IPC contract grows an analyzer snapshot event.
 */
export function startAnalyzerClient(): () => void {
  return onEvent((event) => {
    const analyzerEvent = event as typeof event | AnalyzerSpectrumEvent;
    if (analyzerEvent.kind === "analyzer.spectrum") {
      useAnalyzerStore.getState().setMasterSnapshot({
        sequence: analyzerEvent.sequence,
        rms: clamp01(analyzerEvent.rms),
        peak: clamp01(analyzerEvent.peak),
        bands: analyzerEvent.bands.map(clamp01),
      });
      return;
    }

    if (event.kind !== "engine.levelMeters") return;
    const master = event.tracks.find((track) => track.id === "master") ?? event.tracks[0];
    if (!master) return;
    const current = useAnalyzerStore.getState().master;
    useAnalyzerStore.getState().setMasterSnapshot({
      sequence: current.sequence + 1,
      rms: clamp01(master.rms),
      peak: clamp01(master.peak),
    });
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
