import { useEffect, useRef, useState } from "react";
import { Button, HoverInfo, Icon } from "../../components";
import {
  createInstrumentBufferSource,
  createSynthRenderState,
  cachedInstrumentSampleBuffer,
  modulationAtTime,
  preloadInstrumentSample,
  primaryInstrumentSampleUrl,
  previewFrequency,
  renderInstrumentSample,
  renderInstrumentSamples,
  type SynthRenderState,
} from "../../audio/synthPreview";
import { useContextualHotkey } from "../../hotkeys/contextualHotkeys";
import type { Instrument } from "../../state/types";
import styles from "./InstrumentWaveformPreview.module.css";

interface Props {
  instrument: Instrument;
  hotkeyScopeId?: string;
  spanFull?: boolean;
}

const SAMPLE_COUNT = 512;
const WAVEFORM_WINDOW_SECONDS = 0.055;
const PREVIEW_SECONDS = 3;

type SampleEnvelope = Array<{ min: number; max: number }>;

export function InstrumentWaveformPreview({ instrument, hotkeyScopeId, spanFull = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const sourceGainRef = useRef<GainNode | null>(null);
  const loopSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const instrumentRef = useRef(instrument);
  const loopNodeRef = useRef<ScriptProcessorNode | null>(null);
  const loopGainRef = useRef<GainNode | null>(null);
  const loopStateRef = useRef<SynthRenderState>(createSynthRenderState());
  const progressFrameRef = useRef<number | null>(null);
  const progressStartRef = useRef(0);
  const progressDurationRef = useRef(PREVIEW_SECONDS);
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sampleEnvelope, setSampleEnvelope] = useState<{ url: string; values: SampleEnvelope } | null>(null);

  instrumentRef.current = instrument;

  useContextualHotkey(hotkeyScopeId ?? "", "space", () => void toggleLoop(), Boolean(hotkeyScopeId));

  const primarySampleUrl = primaryInstrumentSampleUrl(instrument);
  const shouldDrawSample = (instrument.kind === "sampler" || instrument.waveform === "sample") && Boolean(primarySampleUrl);

  useEffect(() => {
    let cancelled = false;
    if (!shouldDrawSample || !primarySampleUrl) {
      setSampleEnvelope(null);
      return;
    }

    const cached = cachedInstrumentSampleBuffer(primarySampleUrl);
    if (cached) {
      setSampleEnvelope({ url: primarySampleUrl, values: makeSampleEnvelope(cached) });
      return;
    }

    const ctx = getAudioContext();
    void preloadInstrumentSample(ctx, instrument).then(() => {
      if (cancelled) return;
      const buffer = cachedInstrumentSampleBuffer(primarySampleUrl);
      setSampleEnvelope(buffer ? { url: primarySampleUrl, values: makeSampleEnvelope(buffer) } : null);
    }).catch(() => {
      if (!cancelled) setSampleEnvelope(null);
    });

    return () => {
      cancelled = true;
    };
  }, [instrument, primarySampleUrl, shouldDrawSample]);

  useEffect(() => {
    const canvas = canvasRef.current;
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
    for (let i = 0; i <= 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.strokeStyle = fg;
    const activeSampleEnvelope = sampleEnvelope?.url === primarySampleUrl ? sampleEnvelope : null;
    if (shouldDrawSample && activeSampleEnvelope) {
      drawSampleEnvelope(ctx, normalizeEnvelope(activeSampleEnvelope.values), w, h, mid);
    } else {
      const values = normalize(makeWaveform(instrument));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = (i / (values.length - 1)) * w;
        const y = mid - v * (h * 0.38);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, [instrument, primarySampleUrl, sampleEnvelope, shouldDrawSample]);

  useEffect(
    () => () => {
      stopPreview();
      stopLoop();
      if (audioCtxRef.current) void audioCtxRef.current.close();
    },
    [],
  );

  function getAudioContext(): AudioContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!audioCtxRef.current) audioCtxRef.current = new Ctor();
    return audioCtxRef.current;
  }

  function stopPreview() {
    const source = sourceRef.current;
    const gain = sourceGainRef.current;
    sourceRef.current = null;
    sourceGainRef.current = null;
    if (source && gain) fadeOutSource(source, gain);
    setPlaying(false);
    stopProgress();
  }

  function stopLoop() {
    const node = loopNodeRef.current;
    const gain = loopGainRef.current;
    const source = loopSourceRef.current;
    loopNodeRef.current = null;
    loopGainRef.current = null;
    loopSourceRef.current = null;
    if (source && gain) fadeOutSource(source, gain);
    else if (node && gain) fadeOutNode(node, gain);
    else if (node) {
      node.onaudioprocess = null;
      node.disconnect();
    }
    setLooping(false);
    stopProgress();
  }

  async function playPreview() {
    if (playing) {
      stopPreview();
      return;
    }

    stopPreview();
    stopLoop();
    const ctx = getAudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    await preloadInstrumentSample(ctx, instrument).catch(() => {
      // Synth fallback remains useful when a sample cannot be decoded.
    });

    const length = Math.ceil(ctx.sampleRate * PREVIEW_SECONDS);
    const source = createInstrumentBufferSource(ctx, instrument, length / ctx.sampleRate, previewFrequency(instrument));
    const duration = source.buffer
      ? Math.min(PREVIEW_SECONDS, Math.max(0.05, source.buffer.duration / source.playbackRate.value))
      : PREVIEW_SECONDS;
    const gain = ctx.createGain();
    gain.gain.value = 0.22;
    source.connect(gain).connect(ctx.destination);
    source.onended = () => {
      if (sourceRef.current === source) {
        sourceRef.current = null;
        sourceGainRef.current = null;
        setPlaying(false);
      }
    };
    sourceRef.current = source;
    sourceGainRef.current = gain;
    setPlaying(true);
    startProgress(ctx.currentTime, duration, false);
    source.start();
    source.stop(ctx.currentTime + duration + 0.02);
  }

  async function toggleLoop() {
    if (looping) {
      stopLoop();
      return;
    }

    stopPreview();
    const ctx = getAudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    await preloadInstrumentSample(ctx, instrumentRef.current).catch(() => {
      // Synth fallback remains useful when a sample cannot be decoded.
    });

    const sampleInstrument = instrumentRef.current.sampleUrl ? instrumentRef.current : null;
    if (sampleInstrument) {
      const source = createInstrumentBufferSource(
        ctx,
        sampleInstrument,
        PREVIEW_SECONDS,
        previewFrequency(sampleInstrument),
      );
      const duration = source.buffer
        ? Math.min(PREVIEW_SECONDS, Math.max(0.05, source.buffer.duration / source.playbackRate.value))
        : PREVIEW_SECONDS;
      const gain = ctx.createGain();
      gain.gain.value = 0.2;
      source.loop = true;
      source.connect(gain).connect(ctx.destination);
      loopSourceRef.current = source;
      loopGainRef.current = gain;
      setLooping(true);
      startProgress(ctx.currentTime, duration, true);
      source.start();
      return;
    }

    const node = ctx.createScriptProcessor(1024, 0, 1);
    const gain = ctx.createGain();
    gain.gain.value = 0.2;
    loopStateRef.current = createSynthRenderState();

    node.onaudioprocess = (event) => {
      const output = event.outputBuffer.getChannelData(0);
      const state = loopStateRef.current;
      const currentInstrument = instrumentRef.current;
      for (let i = 0; i < output.length; i++) {
        output[i] = renderInstrumentSample(
          currentInstrument,
          state,
          ctx.sampleRate,
          previewFrequency(currentInstrument),
          "audio",
          modulationAtTime(currentInstrument, (state.index / ctx.sampleRate) % PREVIEW_SECONDS, PREVIEW_SECONDS),
        );
      }
    };

    node.connect(gain).connect(ctx.destination);
    loopNodeRef.current = node;
    loopGainRef.current = gain;
    setLooping(true);
    startProgress(ctx.currentTime, PREVIEW_SECONDS, true);
  }

  function startProgress(startTime: number, duration: number, repeat: boolean) {
    stopProgress(false);
    progressStartRef.current = startTime;
    progressDurationRef.current = Math.max(0.05, duration);
    const ctx = getAudioContext();
    const tick = () => {
      const elapsed = Math.max(0, ctx.currentTime - progressStartRef.current);
      const t = repeat
        ? (elapsed % progressDurationRef.current) / progressDurationRef.current
        : Math.min(1, elapsed / progressDurationRef.current);
      setProgress(t);
      if (repeat || t < 1) progressFrameRef.current = window.requestAnimationFrame(tick);
    };
    setProgress(0);
    progressFrameRef.current = window.requestAnimationFrame(tick);
  }

  function stopProgress(reset = true) {
    if (progressFrameRef.current != null) {
      window.cancelAnimationFrame(progressFrameRef.current);
      progressFrameRef.current = null;
    }
    if (reset) setProgress(0);
  }

  return (
    <section className={`${styles.preview} ${spanFull ? styles.spanFull : ""}`} aria-label="Waveform preview">
      <div className={styles.header}>
        <span className={styles.label}>Waveform</span>
        <div className={styles.headerRight}>
          <span className={styles.meta}>{shouldDrawSample ? "sample" : instrument.waveform}</span>
          <div className={styles.previewControls}>
            <HoverInfo content={playing ? "Stop preview" : "Play preview"}>
              <Button
                iconOnly
                size="xs"
                variant={playing ? "primary" : "default"}
                aria-label={playing ? "Stop waveform preview" : "Play waveform preview"}
            onClick={() => void playPreview()}
              >
                <Icon name={playing ? "ph:stop-fill" : "ph:play-fill"} size={12} decorative />
              </Button>
            </HoverInfo>
            <HoverInfo content={looping ? "Stop loop" : "Loop preview"}>
              <Button
                iconOnly
                size="xs"
                variant={looping ? "primary" : "default"}
                aria-label={looping ? "Stop waveform loop" : "Play waveform loop"}
                onClick={() => void toggleLoop()}
              >
                <Icon name={looping ? "ph:stop-fill" : "ph:repeat"} size={12} decorative />
              </Button>
            </HoverInfo>
          </div>
        </div>
      </div>
      <div className={styles.canvasWrap}>
        {(playing || looping) && (
          <span
            className={styles.playhead}
            style={{ left: `${Math.min(1, Math.max(0, progress)) * 100}%` }}
            aria-hidden
          />
        )}
        <canvas ref={canvasRef} className={styles.canvas} />
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
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const start = Math.floor((i / SAMPLE_COUNT) * length);
    const end = Math.max(start + 1, Math.floor(((i + 1) / SAMPLE_COUNT) * length));
    let min = 0;
    let max = 0;
    for (let channel = 0; channel < channels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let sample = start; sample < end; sample++) {
        const v = data[sample] ?? 0;
        if (v < min) min = v;
        if (v > max) max = v;
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
  values.forEach((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * width;
    const top = mid - v.max * amp;
    const bottom = mid - v.min * amp;
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  });
  ctx.stroke();
}

function normalizeEnvelope(values: SampleEnvelope): SampleEnvelope {
  let peak = 0;
  values.forEach((v) => {
    peak = Math.max(peak, Math.abs(v.min), Math.abs(v.max));
  });
  const scale = peak > 0.001 ? 1 / peak : 1;
  return values.map((v) => ({ min: v.min * scale, max: v.max * scale }));
}

function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const center = (min + max) / 2;
  const peak = Math.max(0.001, max - center, center - min);
  return values.map((v) => (v - center) / peak);
}
