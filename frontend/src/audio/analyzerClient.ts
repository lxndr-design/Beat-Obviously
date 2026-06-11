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
        voiceMs: positiveNumber(event.voiceMs),
        modulationMs: positiveNumber(event.modulationMs),
        samplesMs: positiveNumber(event.samplesMs),
        fxMs: positiveNumber(event.fxMs),
        filterFxMs: positiveNumber(event.filterFxMs),
        analyzerMs: positiveNumber(event.analyzerMs),
        copyMs: positiveNumber(event.copyMs),
        totalMs: positiveNumber(event.totalMs),
        loadPercent: positiveNumber(event.loadPercent),
        activeSynthVoices: Math.max(0, Math.round(event.activeSynthVoices)),
        activeSampleVoices: Math.max(0, Math.round(event.activeSampleVoices)),
        activeAudioClipVoices: Math.max(0, Math.round(event.activeAudioClipVoices)),
        routeCount: Math.max(0, Math.round(event.routeCount)),
        automationEventCount: Math.max(0, Math.round(event.automationEventCount)),
        wavetableCacheHits: positiveNumber(event.wavetableCacheHits),
        wavetableCacheMisses: positiveNumber(event.wavetableCacheMisses),
        wavetableCacheSize: Math.max(0, Math.round(event.wavetableCacheSize)),
        voiceRenderBlocks: positiveNumber(event.voiceRenderBlocks),
        voiceRenderSamples: positiveNumber(event.voiceRenderSamples),
        oscillatorSamples: positiveNumber(event.oscillatorSamples),
        wavetableVoiceSamples: positiveNumber(event.wavetableVoiceSamples),
        aetherOscASamples: positiveNumber(event.aetherOscASamples),
        aetherOscBSamples: positiveNumber(event.aetherOscBSamples),
        aetherSubSamples: positiveNumber(event.aetherSubSamples),
        aetherNoiseSamples: positiveNumber(event.aetherNoiseSamples),
        filterSamples: positiveNumber(event.filterSamples),
        filterDriveSamples: positiveNumber(event.filterDriveSamples),
        filterCoefficientUpdates: positiveNumber(event.filterCoefficientUpdates),
        modulationSamples: positiveNumber(event.modulationSamples),
        realtimeRampSamples: positiveNumber(event.realtimeRampSamples),
        oscillatorRateCalculations: positiveNumber(event.oscillatorRateCalculations),
        wavetableFrequencyUpdates: positiveNumber(event.wavetableFrequencyUpdates),
        wavetablePositionUpdates: positiveNumber(event.wavetablePositionUpdates),
        routeEffectSamples: positiveNumber(event.routeEffectSamples),
        routeFilterEffectSamples: positiveNumber(event.routeFilterEffectSamples),
        routeNonlinearEffectSamples: positiveNumber(event.routeNonlinearEffectSamples),
        routeDelayEffectSamples: positiveNumber(event.routeDelayEffectSamples),
      });
      return;
    }

    if (event.kind !== "engine.levelMeters") return;
    useAnalyzerStore.getState().setTrackMeters(event.tracks);
    const master = event.tracks.find((track) => track.id === "master") ?? event.tracks[0];
    if (!master) return;
    const current = useAnalyzerStore.getState().master;
    useAnalyzerStore.getState().setMasterSnapshot({
      sequence: current.sequence + 1,
      rms: clamp01(master.rms),
      peak: clamp01(master.peak),
      rmsDbFS: finiteOrUndefined(master.rmsDbFS),
      peakDbFS: finiteOrUndefined(master.peakDbFS),
      truePeakDbTP: finiteOrUndefined(master.truePeakDbTP),
      momentaryLufs: finiteOrUndefined(master.momentaryLufs),
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

function finiteOrUndefined(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}
