import type { Instrument } from "../state/types";

export type SynthRenderMode = "visual" | "audio";

export interface SynthRenderState {
  phase: number;
  index: number;
  low: number;
  band: number;
}

export const SYNTH_PREVIEW_BASE_HZ = 110;

const sampleBufferCache = new Map<string, AudioBuffer>();

export function createSynthRenderState(): SynthRenderState {
  return { phase: 0, index: 0, low: 0, band: 0 };
}

export function noteFrequency(midiPitch: number, instrument?: Instrument): number {
  const octave = instrument?.octave ?? 0;
  const detune = instrument?.detuneCents ?? 0;
  return 440 * Math.pow(2, (midiPitch - 69) / 12 + octave + detune / 1200);
}

export function previewFrequency(instrument: Instrument): number {
  const octave = instrument.octave ?? 0;
  const detune = instrument.detuneCents ?? 0;
  return SYNTH_PREVIEW_BASE_HZ * Math.pow(2, octave + detune / 1200);
}

export function renderInstrumentSamples(
  instrument: Instrument,
  out: ArrayLike<number> & { [index: number]: number },
  sampleRate: number,
  frequency: number,
  mode: SynthRenderMode,
  fade = false,
) {
  const state = createSynthRenderState();
  const durationS = out.length / sampleRate;

  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const amp = fade ? Math.min(1, t / 0.025, (durationS - t) / 0.08) : 1;
    out[i] = renderInstrumentSample(instrument, state, sampleRate, frequency, mode) * amp;
  }
}

export function createInstrumentBufferSource(
  ctx: AudioContext,
  instrument: Instrument,
  durationS: number,
  frequency: number,
): AudioBufferSourceNode {
  if (instrument.sampleUrl && sampleBufferCache.has(instrument.sampleUrl)) {
    const source = ctx.createBufferSource();
    source.buffer = sampleBufferCache.get(instrument.sampleUrl)!;
    source.playbackRate.value = Math.max(0.25, Math.min(4, frequency / noteFrequency(60, instrument)));
    return source;
  }

  const length = Math.max(1, Math.ceil(ctx.sampleRate * durationS));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  renderInstrumentSamples(instrument, buffer.getChannelData(0), ctx.sampleRate, frequency, "audio", true);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

export async function preloadInstrumentSample(ctx: AudioContext, instrument: Instrument): Promise<void> {
  if (!instrument.sampleUrl || sampleBufferCache.has(instrument.sampleUrl)) return;
  const response = await fetch(instrument.sampleUrl);
  if (!response.ok) throw new Error(`Failed to load sample: ${instrument.sampleUrl}`);
  const data = await response.arrayBuffer();
  const buffer = await ctx.decodeAudioData(data.slice(0));
  sampleBufferCache.set(instrument.sampleUrl, buffer);
}

export function renderInstrumentSample(
  instrument: Instrument,
  state: SynthRenderState,
  sampleRate: number,
  frequency: number,
  mode: SynthRenderMode,
): number {
  const cutoff = clamp01(instrument.knobs.cutoff);
  const resonance = clamp01(instrument.knobs.resonance);
  const drive = clamp01(instrument.knobs.drive);
  const color = clamp01(instrument.knobs.color);
  const sub = clamp01(instrument.subOscLevel ?? 0);

  let v = instrument.waveform === "noise"
    ? mode === "audio" ? Math.random() * 2 - 1 : whiteNoiseSample(state.index)
    : oscillatorSample(instrument.waveform, state.phase, color);

  if (sub > 0) {
    const subWave = oscillatorSample("square", state.phase * 0.5, 0.5);
    v = v * (1 - sub * 0.45) + subWave * sub * 0.45;
  }

  if (drive > 0) {
    const amount = 1 + drive * 10;
    v = Math.tanh(v * amount) / Math.tanh(amount);
  }

  const filtered = resonantLowpass(v, state, sampleRate, cutoff, resonance);
  state.phase += frequency / sampleRate;
  state.index += 1;
  return clamp(filtered, -1, 1);
}

function resonantLowpass(
  input: number,
  state: SynthRenderState,
  sampleRate: number,
  cutoff: number,
  resonance: number,
): number {
  const minHz = 50;
  const maxHz = Math.min(16000, sampleRate * 0.45);
  const cutoffHz = minHz * Math.pow(maxHz / minHz, cutoff);
  const f = 2 * Math.sin(Math.PI * cutoffHz / sampleRate);
  const damping = 1.45 - resonance * 1.25;

  state.low += f * state.band;
  const high = input - state.low - damping * state.band;
  state.band += f * high;

  const emphasized = state.low + state.band * resonance * 1.6;
  return clamp(emphasized, -1.2, 1.2);
}

function oscillatorSample(waveform: Instrument["waveform"], phase: number, color: number): number {
  const p = ((phase % 1) + 1) % 1;
  switch (waveform) {
    case "sine": {
      const second = Math.sin(p * Math.PI * 4) * (color - 0.5) * 0.35;
      return Math.sin(p * Math.PI * 2) * (1 - Math.abs(color - 0.5) * 0.2) + second;
    }
    case "triangle": {
      const skew = 0.5 + (color - 0.5) * 0.7;
      return p < skew ? -1 + (p / skew) * 2 : 1 - ((p - skew) / (1 - skew)) * 2;
    }
    case "square": {
      const width = 0.5 + (color - 0.5) * 0.8;
      return p < width ? 1 : -1;
    }
    case "saw": {
      const shaped = color < 0.5
        ? Math.pow(p, 1 + (0.5 - color) * 2)
        : 1 - Math.pow(1 - p, 1 + (color - 0.5) * 2);
      return shaped * 2 - 1;
    }
    case "sample":
      return (
        Math.sin(p * Math.PI * 2) * 0.55 +
        Math.sin(p * Math.PI * 6) * (0.15 + color * 0.25) +
        Math.sin(p * Math.PI * 10) * color * 0.15
      );
    case "noise":
    default:
      return 0;
  }
}

function whiteNoiseSample(index: number): number {
  let x = (index + 1) * 0x6d2b79f5;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return (((x ^ (x >>> 14)) >>> 0) / 4294967295) * 2 - 1;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
