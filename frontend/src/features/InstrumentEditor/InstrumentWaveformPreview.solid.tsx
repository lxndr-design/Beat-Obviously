import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { Button, HoverInfo, Icon } from "../../solid-ui";
import {
  cachedInstrumentSampleBuffer,
  createInstrumentBufferSource,
  createSynthRenderState,
  modulationAtTime,
  preloadInstrumentSample,
  previewFrequency,
  primaryInstrumentSampleUrl,
  renderInstrumentSample,
  renderInstrumentSamples,
  type SynthRenderState,
} from "../../audio/synthPreview";
import { useContextualHotkeyStore } from "../../hotkeys/contextualHotkeys";
import type { Instrument } from "../../state/types";
import styles from "./InstrumentWaveformPreview.module.css";

export interface InstrumentWaveformPreviewProps {
  instrument: Instrument;
  hotkeyScopeId?: string;
  spanFull?: boolean;
}

const SAMPLE_COUNT = 512;
const WAVEFORM_WINDOW_SECONDS = 0.055;
const PREVIEW_SECONDS = 3;

type SampleEnvelope = Array<{ min: number; max: number }>;

export function InstrumentWaveformPreviewSolid(props: InstrumentWaveformPreviewProps) {
  return <InstrumentWaveformPreviewSolidRuntime state={() => props} />;
}

function InstrumentWaveformPreviewSolidRuntime(props: { state: Accessor<InstrumentWaveformPreviewProps> }) {
  let canvasRef: HTMLCanvasElement | undefined;
  let audioCtx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let sourceGain: GainNode | null = null;
  let loopSource: AudioBufferSourceNode | null = null;
  let loopNode: ScriptProcessorNode | null = null;
  let loopGain: GainNode | null = null;
  let loopState: SynthRenderState = createSynthRenderState();
  let progressFrame: number | null = null;
  let progressStart = 0;
  let progressDuration = PREVIEW_SECONDS;
  let latestInstrument = props.state().instrument;

  const [playing, setPlaying] = createSignal(false);
  const [looping, setLooping] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [sampleEnvelope, setSampleEnvelope] = createSignal<{ url: string; values: SampleEnvelope } | null>(null);

  const spanFull = createMemo(() => props.state().spanFull ?? true);
  const primarySampleUrlValue = createMemo(() => primaryInstrumentSampleUrl(props.state().instrument));
  const shouldDrawSample = createMemo(() => {
    const instrument = props.state().instrument;
    return (instrument.kind === "sampler" || instrument.waveform === "sample") && Boolean(primarySampleUrlValue());
  });

  createEffect(() => {
    latestInstrument = props.state().instrument;
  });

  createEffect(() => {
    const scopeId = props.state().hotkeyScopeId ?? "";
    if (!scopeId) return;
    const handler = () => void toggleLoop();
    useContextualHotkeyStore.getState().register(scopeId, "space", handler);
    onCleanup(() => useContextualHotkeyStore.getState().unregister(scopeId, "space"));
  });

  createEffect(() => {
    let cancelled = false;
    const instrument = props.state().instrument;
    const primarySampleUrl = primarySampleUrlValue();
    if (!shouldDrawSample() || !primarySampleUrl) {
      setSampleEnvelope(null);
      return;
    }

    const cached = cachedInstrumentSampleBuffer(primarySampleUrl);
    if (cached) {
      setSampleEnvelope({ url: primarySampleUrl, values: makeSampleEnvelope(cached) });
      return;
    }

    const ctx = getAudioContext();
    void preloadInstrumentSample(ctx, instrument)
      .then(() => {
        if (cancelled) return;
        const buffer = cachedInstrumentSampleBuffer(primarySampleUrl);
        setSampleEnvelope(buffer ? { url: primarySampleUrl, values: makeSampleEnvelope(buffer) } : null);
      })
      .catch(() => {
        if (!cancelled) setSampleEnvelope(null);
      });

    onCleanup(() => {
      cancelled = true;
    });
  });

  createEffect(() => {
    const canvas = canvasRef;
    const instrument = props.state().instrument;
    const primarySampleUrl = primarySampleUrlValue();
    const activeSampleEnvelope = sampleEnvelope()?.url === primarySampleUrl ? sampleEnvelope() : null;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(canvas);
    const fg = css.getPropertyValue("--color-fg").trim() || "#fff";
    const faint = css.getPropertyValue("--grid-line-faint").trim() || "rgba(255,255,255,0.12)";
    const w = rect.width;
    const h = rect.height;
    const mid = h / 2;

    ctx.strokeStyle = faint;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.strokeStyle = fg;
    if (shouldDrawSample() && activeSampleEnvelope) {
      drawSampleEnvelope(ctx, normalizeEnvelope(activeSampleEnvelope.values), w, h, mid);
    } else {
      const values = normalize(makeWaveform(instrument));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      values.forEach((value, index) => {
        const x = (index / (values.length - 1)) * w;
        const y = mid - value * (h * 0.38);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  });

  onCleanup(() => {
    stopPreview();
    stopLoop();
    if (audioCtx) void audioCtx.close();
  });

  function getAudioContext(): AudioContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!audioCtx) audioCtx = new Ctor();
    return audioCtx;
  }

  function stopPreview() {
    const currentSource = source;
    const currentGain = sourceGain;
    source = null;
    sourceGain = null;
    if (currentSource && currentGain) fadeOutSource(currentSource, currentGain);
    setPlaying(false);
    stopProgress();
  }

  function stopLoop() {
    const currentNode = loopNode;
    const currentGain = loopGain;
    const currentSource = loopSource;
    loopNode = null;
    loopGain = null;
    loopSource = null;
    if (currentSource && currentGain) fadeOutSource(currentSource, currentGain);
    else if (currentNode && currentGain) fadeOutNode(currentNode, currentGain);
    else if (currentNode) {
      currentNode.onaudioprocess = null;
      currentNode.disconnect();
    }
    setLooping(false);
    stopProgress();
  }

  async function playPreview() {
    if (playing()) {
      stopPreview();
      return;
    }

    stopPreview();
    stopLoop();
    const ctx = getAudioContext();
    const instrument = props.state().instrument;
    if (ctx.state === "suspended") void ctx.resume();
    await preloadInstrumentSample(ctx, instrument).catch(() => {
      // Synth fallback remains useful when a sample cannot be decoded.
    });

    const length = Math.ceil(ctx.sampleRate * PREVIEW_SECONDS);
    const nextSource = createInstrumentBufferSource(ctx, instrument, length / ctx.sampleRate, previewFrequency(instrument));
    const duration = nextSource.buffer
      ? Math.min(PREVIEW_SECONDS, Math.max(0.05, nextSource.buffer.duration / nextSource.playbackRate.value))
      : PREVIEW_SECONDS;
    const gain = ctx.createGain();
    gain.gain.value = 0.22;
    nextSource.connect(gain).connect(ctx.destination);
    nextSource.onended = () => {
      if (source === nextSource) {
        source = null;
        sourceGain = null;
        setPlaying(false);
      }
    };
    source = nextSource;
    sourceGain = gain;
    setPlaying(true);
    startProgress(ctx.currentTime, duration, false);
    nextSource.start();
    nextSource.stop(ctx.currentTime + duration + 0.02);
  }

  async function toggleLoop() {
    if (looping()) {
      stopLoop();
      return;
    }

    stopPreview();
    const ctx = getAudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    await preloadInstrumentSample(ctx, latestInstrument).catch(() => {
      // Synth fallback remains useful when a sample cannot be decoded.
    });

    const sampleInstrument = latestInstrument.sampleUrl ? latestInstrument : null;
    if (sampleInstrument) {
      const nextSource = createInstrumentBufferSource(
        ctx,
        sampleInstrument,
        PREVIEW_SECONDS,
        previewFrequency(sampleInstrument),
      );
      const duration = nextSource.buffer
        ? Math.min(PREVIEW_SECONDS, Math.max(0.05, nextSource.buffer.duration / nextSource.playbackRate.value))
        : PREVIEW_SECONDS;
      const gain = ctx.createGain();
      gain.gain.value = 0.2;
      nextSource.loop = true;
      nextSource.connect(gain).connect(ctx.destination);
      loopSource = nextSource;
      loopGain = gain;
      setLooping(true);
      startProgress(ctx.currentTime, duration, true);
      nextSource.start();
      return;
    }

    const node = ctx.createScriptProcessor(1024, 0, 1);
    const gain = ctx.createGain();
    gain.gain.value = 0.2;
    loopState = createSynthRenderState();

    node.onaudioprocess = (event) => {
      const output = event.outputBuffer.getChannelData(0);
      for (let i = 0; i < output.length; i += 1) {
        output[i] = renderInstrumentSample(
          latestInstrument,
          loopState,
          ctx.sampleRate,
          previewFrequency(latestInstrument),
          "audio",
          modulationAtTime(latestInstrument, (loopState.index / ctx.sampleRate) % PREVIEW_SECONDS, PREVIEW_SECONDS),
        );
      }
    };

    node.connect(gain).connect(ctx.destination);
    loopNode = node;
    loopGain = gain;
    setLooping(true);
    startProgress(ctx.currentTime, PREVIEW_SECONDS, true);
  }

  function startProgress(startTime: number, duration: number, repeat: boolean) {
    stopProgress(false);
    progressStart = startTime;
    progressDuration = Math.max(0.05, duration);
    const ctx = getAudioContext();
    const tick = () => {
      const elapsed = Math.max(0, ctx.currentTime - progressStart);
      const t = repeat
        ? (elapsed % progressDuration) / progressDuration
        : Math.min(1, elapsed / progressDuration);
      setProgress(t);
      if (repeat || t < 1) progressFrame = window.requestAnimationFrame(tick);
    };
    setProgress(0);
    progressFrame = window.requestAnimationFrame(tick);
  }

  function stopProgress(reset = true) {
    if (progressFrame != null) {
      window.cancelAnimationFrame(progressFrame);
      progressFrame = null;
    }
    if (reset) setProgress(0);
  }

  return (
    <section class={`${styles.preview} ${spanFull() ? styles.spanFull : ""}`} aria-label="Waveform preview">
      <div class={styles.header}>
        <span class={styles.label}>Waveform</span>
        <div class={styles.headerRight}>
          <span class={styles.meta}>{shouldDrawSample() ? "sample" : props.state().instrument.waveform}</span>
          <div class={styles.previewControls}>
            <HoverInfo content={playing() ? "Stop preview" : "Play preview"}>
              <Button
                iconOnly
                size="xs"
                variant={playing() ? "primary" : "default"}
                aria-label={playing() ? "Stop waveform preview" : "Play waveform preview"}
                onClick={() => void playPreview()}
              >
                <Icon name={playing() ? "ph:stop-fill" : "ph:play-fill"} size={12} decorative />
              </Button>
            </HoverInfo>
            <HoverInfo content={looping() ? "Stop loop" : "Loop preview"}>
              <Button
                iconOnly
                size="xs"
                variant={looping() ? "primary" : "default"}
                aria-label={looping() ? "Stop waveform loop" : "Play waveform loop"}
                onClick={() => void toggleLoop()}
              >
                <Icon name={looping() ? "ph:stop-fill" : "ph:repeat"} size={12} decorative />
              </Button>
            </HoverInfo>
          </div>
        </div>
      </div>
      <div class={styles.canvasWrap}>
        <Show when={playing() || looping()}>
          <span
            class={styles.playhead}
            style={{ left: `${Math.min(1, Math.max(0, progress())) * 100}%` }}
            aria-hidden
          />
        </Show>
        <canvas ref={canvasRef} class={styles.canvas} />
      </div>
    </section>
  );
}

function fadeOutSource(source: AudioBufferSourceNode, gain: GainNode) {
  const now = gain.context.currentTime;
  const fadeEnd = now + 0.035;
  source.onended = null;
  try {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, fadeEnd);
    source.stop(fadeEnd + 0.015);
  } catch {
    // Already stopped.
  }
  window.setTimeout(() => {
    try {
      source.disconnect();
      gain.disconnect();
    } catch {
      // Already disconnected.
    }
  }, 80);
}

function fadeOutNode(node: ScriptProcessorNode, gain: GainNode) {
  const now = gain.context.currentTime;
  const fadeEnd = now + 0.035;
  try {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, fadeEnd);
  } catch {
    // Ignore stopped nodes.
  }
  window.setTimeout(() => {
    try {
      node.onaudioprocess = null;
      node.disconnect();
      gain.disconnect();
    } catch {
      // Already disconnected.
    }
  }, 80);
}

function makeWaveform(instrument: Instrument): number[] {
  const out = new Array<number>(SAMPLE_COUNT);
  renderInstrumentSamples(
    instrument,
    out,
    SAMPLE_COUNT / WAVEFORM_WINDOW_SECONDS,
    previewFrequency(instrument),
    "visual",
  );
  return out;
}

function makeSampleEnvelope(buffer: AudioBuffer): SampleEnvelope {
  const channels = Math.max(1, buffer.numberOfChannels);
  const length = buffer.length;
  const out: SampleEnvelope = [];
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const start = Math.floor((i / SAMPLE_COUNT) * length);
    const end = Math.max(start + 1, Math.floor(((i + 1) / SAMPLE_COUNT) * length));
    let min = 0;
    let max = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let sample = start; sample < end; sample += 1) {
        const value = data[sample] ?? 0;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    out.push({ min, max });
  }
  return out;
}

function drawSampleEnvelope(
  ctx: CanvasRenderingContext2D,
  values: SampleEnvelope,
  width: number,
  height: number,
  mid: number,
) {
  const amp = height * 0.39;
  ctx.lineWidth = Math.max(1, width / Math.max(1, values.length));
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * width;
    const top = mid - value.max * amp;
    const bottom = mid - value.min * amp;
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  });
  ctx.stroke();
}

function normalizeEnvelope(values: SampleEnvelope): SampleEnvelope {
  let peak = 0;
  values.forEach((value) => {
    peak = Math.max(peak, Math.abs(value.min), Math.abs(value.max));
  });
  const scale = peak > 0.001 ? 1 / peak : 1;
  return values.map((value) => ({ min: value.min * scale, max: value.max * scale }));
}

function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const center = (min + max) / 2;
  const peak = Math.max(0.001, max - center, center - min);
  return values.map((value) => (value - center) / peak);
}

export interface MountedInstrumentWaveformPreviewSolid {
  update: (next: InstrumentWaveformPreviewProps) => void;
  dispose: () => void;
}

export function mountInstrumentWaveformPreviewSolid(
  host: HTMLElement,
  initialProps: InstrumentWaveformPreviewProps,
): MountedInstrumentWaveformPreviewSolid {
  const [state, setState] = createSignal(initialProps, { equals: false });
  const dispose = render(() => <InstrumentWaveformPreviewSolidRuntime state={state} />, host);
  return {
    update: setState,
    dispose,
  };
}
