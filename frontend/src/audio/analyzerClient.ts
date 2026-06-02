import { onEvent } from "../ipc/bridge";
import { useAnalyzerStore } from "../state/analyzerStore";

/**
 * Subscribes frontend analyzer state to backend meter/analyzer events.
 */
export function startAnalyzerClient(): () => void {
  return onEvent((event) => {
    if (event.kind === "analyzer.spectrum") {
      useAnalyzerStore.getState().setMasterSnapshot({
        sequence: event.sequence,
        rms: clamp01(event.rms),
        peak: clamp01(event.peak),
        bands: event.bands.map(clamp01),
      });
      return;
    }

    if (event.kind === "engine.renderTiming") {
      useAnalyzerStore.getState().setRenderTiming({
        sequence: event.sequence,
        blockSamples: Math.max(0, Math.round(event.blockSamples)),
        sampleRate: positiveNumber(event.sampleRate),
        scheduleMs: positiveNumber(event.scheduleMs),
        synthMs: positiveNumber(event.synthMs),
        samplesMs: positiveNumber(event.samplesMs),
        fxMs: positiveNumber(event.fxMs),
        analyzerMs: positiveNumber(event.analyzerMs),
        copyMs: positiveNumber(event.copyMs),
        totalMs: positiveNumber(event.totalMs),
        loadPercent: positiveNumber(event.loadPercent),
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

function positiveNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
