import { useEffect, useRef, useState } from "react";
import { Button, HoverInfo, Icon } from "../../components";
import {
  createInstrumentBufferSource,
  createSynthRenderState,
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
}

const SAMPLE_COUNT = 512;
const WAVEFORM_WINDOW_SECONDS = 0.055;
const PREVIEW_SECONDS = 3;

export function InstrumentWaveformPreview({ instrument, hotkeyScopeId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const instrumentRef = useRef(instrument);
  const loopNodeRef = useRef<ScriptProcessorNode | null>(null);
  const loopGainRef = useRef<GainNode | null>(null);
  const loopStateRef = useRef<SynthRenderState>(createSynthRenderState());
  const [playing, setPlaying] = useState(false);
  const [looping, setLooping] = useState(false);

  instrumentRef.current = instrument;

  useContextualHotkey(hotkeyScopeId ?? "", "space", toggleLoop, Boolean(hotkeyScopeId));

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

    const values = normalize(makeWaveform(instrument));
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = mid - v * (h * 0.38);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [instrument]);

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
    sourceRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    setPlaying(false);
  }

  function stopLoop() {
    const node = loopNodeRef.current;
    const gain = loopGainRef.current;
    loopNodeRef.current = null;
    loopGainRef.current = null;
    if (node) {
      node.onaudioprocess = null;
      node.disconnect();
    }
    if (gain) gain.disconnect();
    setLooping(false);
  }

  function playPreview() {
    if (playing) {
      stopPreview();
      return;
    }

    stopPreview();
    stopLoop();
    const ctx = getAudioContext();
    if (ctx.state === "suspended") void ctx.resume();

    const length = Math.ceil(ctx.sampleRate * PREVIEW_SECONDS);
    const source = createInstrumentBufferSource(ctx, instrument, length / ctx.sampleRate, previewFrequency(instrument));
    const gain = ctx.createGain();
    gain.gain.value = 0.22;
    source.connect(gain).connect(ctx.destination);
    source.onended = () => {
      if (sourceRef.current === source) {
        sourceRef.current = null;
        setPlaying(false);
      }
    };
    sourceRef.current = source;
    setPlaying(true);
    source.start();
  }

  function toggleLoop() {
    if (looping) {
      stopLoop();
      return;
    }

    stopPreview();
    const ctx = getAudioContext();
    if (ctx.state === "suspended") void ctx.resume();
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
        );
      }
    };

    node.connect(gain).connect(ctx.destination);
    loopNodeRef.current = node;
    loopGainRef.current = gain;
    setLooping(true);
  }

  return (
    <section className={`${styles.preview} ${styles.spanFull}`} aria-label="Waveform preview">
      <div className={styles.header}>
        <span className={styles.label}>Waveform</span>
        <div className={styles.headerRight}>
          <span className={styles.meta}>{instrument.waveform}</span>
          <div className={styles.previewControls}>
            <HoverInfo content={playing ? "Stop preview" : "Play preview"}>
              <Button
                iconOnly
                size="xs"
                variant={playing ? "primary" : "default"}
                aria-label={playing ? "Stop waveform preview" : "Play waveform preview"}
                onClick={playPreview}
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
                onClick={toggleLoop}
              >
                <Icon name={looping ? "ph:stop-fill" : "ph:repeat"} size={12} decorative />
              </Button>
            </HoverInfo>
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} className={styles.canvas} />
    </section>
  );
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

function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const center = (min + max) / 2;
  const peak = Math.max(0.001, max - center, center - min);
  return values.map((v) => (v - center) / peak);
}
