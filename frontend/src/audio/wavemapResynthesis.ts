import { isNative, send } from "../ipc/bridge";
import type { AudioFile, WavemapDefinition } from "../state/types";
import { createWavemapFromAudioSamples } from "../state/synthStore";

const MAX_RESYNTH_SAMPLES = 262_144;

export async function resynthesizeAudioFileToWavemap(
  audioFile: AudioFile,
  wavemapId: string,
  name = `${stripAudioExtension(audioFile.name)} Wavemap`,
): Promise<WavemapDefinition> {
  if (isNative() && audioFile.path && !audioFile.path.startsWith("data:")) {
    const response = await send({
      kind: "instrument.resynthesizeWavemap",
      audioFile,
      wavemapId,
      name,
    });
    if (response.wavemap) return response.wavemap;
    throw new Error(response.error ?? "Audio file could not be resynthesized.");
  }

  const decoded = await decodeAudioFileToMonoSamples(audioFile);
  return createWavemapFromAudioSamples(wavemapId, name, decoded.samples, decoded.sampleRate, {
    kind: "imported-audio",
    label: stripAudioExtension(audioFile.name),
    audioFileId: audioFile.id,
    path: audioFile.path,
    sampleRate: decoded.sampleRate,
    channelCount: decoded.channelCount,
    bitDepth: audioFile.bitDepth,
    sourceSampleCount: decoded.sourceLength,
    sourceStartSample: 0,
    sourceEndSample: decoded.sourceLength,
  });
}

async function decodeAudioFileToMonoSamples(audioFile: AudioFile) {
  if (!audioFile.path) {
    throw new Error("Audio file is missing a readable path.");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  if (!Ctor) {
    throw new Error("This browser cannot decode audio files.");
  }

  const response = await fetch(audioFile.path);
  if (!response.ok) {
    throw new Error(`Audio file could not be loaded (${response.status}).`);
  }

  const ctx = new Ctor();
  try {
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    const sampleCount = Math.max(1, Math.min(buffer.length, MAX_RESYNTH_SAMPLES));
    const step = buffer.length / sampleCount;
    const channels = Math.max(1, buffer.numberOfChannels);
    const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
    const samples = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      const sourceIndex = Math.min(buffer.length - 1, Math.floor(index * step));
      let sum = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        sum += channelData[channel]?.[sourceIndex] ?? 0;
      }
      samples[index] = Math.max(-1, Math.min(1, sum / channels));
    }
    return {
      samples,
      sampleRate: buffer.sampleRate,
      channelCount: channels,
      sourceLength: buffer.length,
    };
  } finally {
    await ctx.close();
  }
}

function stripAudioExtension(name: string) {
  return name.replace(/\.(wav|aif|aiff|mp3|flac|ogg|m4a)$/i, "") || "Audio";
}
