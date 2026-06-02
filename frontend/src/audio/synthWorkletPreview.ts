import type { Instrument } from "../state/types";
import type { SynthAutomationLane } from "./synthPreview";

const AETHER_PREVIEW_WORKLET_URL = "/worklets/aether-preview-worklet.js";

const loadedContexts = new WeakSet<BaseAudioContext>();

export interface SynthWorkletPreviewNode {
  node: AudioWorkletNode;
  stop: () => void;
}

export interface SynthWorkletRenderOptions {
  startTimeS?: number;
  targetFrequency?: number;
  velocity?: number;
  curve?: Array<{ timeS: number; frequency: number }>;
  automation?: SynthAutomationLane[];
}

export async function createSynthWorkletPreviewNode(
  ctx: AudioContext,
  instrument: Instrument,
  durationS: number,
  frequency: number,
  onEnded: () => void,
  renderOptions: SynthWorkletRenderOptions = {},
): Promise<SynthWorkletPreviewNode | null> {
  if (!ctx.audioWorklet || typeof AudioWorkletNode === "undefined") return null;
  if (!loadedContexts.has(ctx)) {
    await ctx.audioWorklet.addModule(AETHER_PREVIEW_WORKLET_URL);
    loadedContexts.add(ctx);
  }

  const node = new AudioWorkletNode(ctx, "aether-preview-processor", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      instrument: structuredClone(instrument),
      durationS,
      frequency,
      startTimeS: renderOptions.startTimeS,
      targetFrequency: renderOptions.targetFrequency,
      velocity: renderOptions.velocity,
      curve: renderOptions.curve,
      automation: renderOptions.automation,
    },
  });

  let ended = false;
  node.port.onmessage = (event) => {
    if (event.data?.type !== "ended" || ended) return;
    ended = true;
    onEnded();
  };

  return {
    node,
    stop: () => {
      if (ended) return;
      ended = true;
      node.port.postMessage({ type: "stop" });
      onEnded();
    },
  };
}
