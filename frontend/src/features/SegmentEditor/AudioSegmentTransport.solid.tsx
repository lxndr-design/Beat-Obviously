import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { registerGlobalAudioStop, stopAllBrowserAudio } from "../../audio/globalAudioSafety";
import { pauseTransport } from "../../audio/transportActions";
import { isNative, send } from "../../ipc/bridge";
import type { AudioWaveformSummary } from "../../ipc/schema";
import { Button, HoverInfo, Icon, LoadingIndicator } from "../../solid-ui";
import { useTransportStore } from "../../state/store";
import type { AudioFile, Segment } from "../../state/types";
import styles from "./AudioSegmentTransport.module.css";

interface Props {
  segment: Segment;
  file?: AudioFile;
  bpm: number;
  speed?: number;
  onPositionChange?: (beat: number | null) => void;
}

export function AudioSegmentTransport(props: Props) {
  const [playing, setPlaying] = createSignal(false);
  const [positionBeat, setPositionBeat] = createSignal(0);
  const [waveform, setWaveform] = createSignal<AudioWaveformSummary | null>(null);
  const [loadingWaveform, setLoadingWaveform] = createSignal(false);
  const [error, setError] = createSignal("");
  let audioContext: AudioContext | null = null;
  let browserSource: AudioBufferSourceNode | null = null;
  let browserGain: GainNode | null = null;
  let playbackStartedAtMs = 0;
  let playbackStartedBeat = 0;
  let playbackToken = 0;
  let animationFrame: number | null = null;
  let previousSignature = "";

  const payload = createMemo(() => props.segment.payload.kind === "audio" ? props.segment.payload : null);
  const lengthBeats = createMemo(() => Math.max(0.001, props.segment.lengthBeats));
  const playbackSpeed = createMemo(() => Math.max(0.1, Math.min(4, props.speed ?? 1)));
  const secondsPerBeat = createMemo(() => 60 / Math.max(1, props.bpm));
  const sourceStartBeat = createMemo(() => Math.max(0, props.segment.sourceStartBeat ?? 0));
  const displayWaveform = createMemo(() => waveformSlice(
    waveform(),
    sourceStartBeat() * secondsPerBeat(),
    lengthBeats() * secondsPerBeat(),
  ));
  const positionPercent = createMemo(() => Math.max(0, Math.min(100, (positionBeat() / lengthBeats()) * 100)));

  onCleanup(registerGlobalAudioStop(stopPlayback));
  onCleanup(() => {
    stopPreviewAudio();
    if (audioContext) void audioContext.close();
  });

  createEffect(() => {
    const file = props.file;
    let cancelled = false;
    setWaveform(null);
    setError("");
    if (!file?.path) return;
    setLoadingWaveform(true);
    void loadWaveform(file)
      .then((next) => {
        if (!cancelled) setWaveform(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause, "Waveform unavailable."));
      })
      .finally(() => {
        if (!cancelled) setLoadingWaveform(false);
      });
    onCleanup(() => { cancelled = true; });
  });

  createEffect(() => {
    const signature = JSON.stringify({
      fileId: props.file?.id ?? "",
      lengthBeats: props.segment.lengthBeats,
      sourceStartBeat: props.segment.sourceStartBeat ?? 0,
      fadeInBeats: props.segment.fadeInBeats ?? 0,
      fadeOutBeats: props.segment.fadeOutBeats ?? 0,
      gainDb: payload()?.gainDb ?? 0,
      bpm: props.bpm,
      speed: playbackSpeed(),
    });
    restartOnContentChange(signature);
  });

  function restartOnContentChange(signature: string) {
    if (!previousSignature) {
      previousSignature = signature;
      return;
    }
    if (previousSignature === signature) return;
    previousSignature = signature;
    const nextBeat = Math.min(positionBeat(), Math.max(0, lengthBeats() - 0.000001));
    setPositionBeat(nextBeat);
    if (playing()) void startAt(nextBeat, false);
  }

  function prepareExclusivePreview() {
    if (useTransportStore.getState().playing) pauseTransport();
    else stopAllBrowserAudio();
  }

  async function startAt(requestedBeat: number, exclusive = true) {
    const file = props.file;
    const currentPayload = payload();
    if (!file || !currentPayload) {
      setError("This segment has no available audio source.");
      return;
    }
    if (exclusive) prepareExclusivePreview();
    stopPreviewAudio();
    const token = playbackToken;
    const beat = Math.max(0, Math.min(requestedBeat, Math.max(0, lengthBeats() - 0.000001)));
    setError("");

    if (isNative()) {
      try {
        const accepted = await send({
          kind: "engine.previewAudioSegment",
          trackId: props.segment.trackId,
          audioFileId: currentPayload.audioFileId,
          sourceStartBeat: sourceStartBeat(),
          positionBeat: beat,
          lengthBeats: lengthBeats(),
          fadeInBeats: props.segment.fadeInBeats ?? 0,
          fadeOutBeats: props.segment.fadeOutBeats ?? 0,
          gainDb: currentPayload.gainDb ?? 0,
        });
        if (token !== playbackToken) return;
        if (accepted === false) throw new Error("The project engine could not start this audio segment.");
        beginClock(beat);
      } catch (cause) {
        if (token !== playbackToken) return;
        setPlaying(false);
        setError(errorMessage(cause, "Audio preview could not be started."));
        props.onPositionChange?.(null);
      }
      return;
    }

    try {
      await startBrowserPreview(file, beat, token);
      if (token === playbackToken) beginClock(beat);
    } catch (cause) {
      if (token !== playbackToken) return;
      setPlaying(false);
      setError(errorMessage(cause, "Audio preview could not be started."));
      props.onPositionChange?.(null);
    }
  }

  function beginClock(beat: number) {
    playbackStartedAtMs = performance.now();
    playbackStartedBeat = beat;
    setPositionBeat(beat);
    setPlaying(true);
    props.onPositionChange?.(beat);
    scheduleProgressFrame();
  }

  function scheduleProgressFrame() {
    if (animationFrame != null) cancelAnimationFrame(animationFrame);
    const tick = () => {
      if (!playing()) return;
      const elapsedSeconds = (performance.now() - playbackStartedAtMs) / 1000;
      const beat = playbackStartedBeat + elapsedSeconds / secondsPerBeat() * playbackSpeed();
      if (beat >= lengthBeats()) {
        setPositionBeat(0);
        props.onPositionChange?.(0);
        void startAt(0, false);
        return;
      }
      setPositionBeat(beat);
      props.onPositionChange?.(beat);
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
  }

  function stopPreviewAudio() {
    playbackToken += 1;
    if (animationFrame != null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    if (isNative()) void send({ kind: "engine.stopAudioPreview", trackId: props.segment.trackId });
    try { browserSource?.stop(); } catch { /* Already stopped. */ }
    try { browserSource?.disconnect(); } catch { /* Already disconnected. */ }
    try { browserGain?.disconnect(); } catch { /* Already disconnected. */ }
    browserSource = null;
    browserGain = null;
  }

  function stopPlayback() {
    setPlaying(false);
    stopPreviewAudio();
    props.onPositionChange?.(null);
  }

  function togglePlayback() {
    if (playing()) stopPlayback();
    else void startAt(positionBeat());
  }

  function restart() {
    setPositionBeat(0);
    void startAt(0);
  }

  function seekFromPointer(event: PointerEvent) {
    const bounds = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
    const beat = Math.max(0, Math.min(lengthBeats(), ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * lengthBeats()));
    setPositionBeat(beat);
    props.onPositionChange?.(beat);
    if (playing()) void startAt(beat, false);
  }

  async function startBrowserPreview(file: AudioFile, beat: number, token: number) {
    const context = getAudioContext();
    if (context.state === "suspended") await context.resume();
    const buffer = await loadAudioBuffer(context, file);
    if (token !== playbackToken) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const speed = playbackSpeed();
    const offsetSeconds = (sourceStartBeat() + beat) * secondsPerBeat();
    if (offsetSeconds >= buffer.duration) throw new Error("The segment trim begins beyond the available audio source.");
    const remainingSourceSeconds = (lengthBeats() - beat) * secondsPerBeat();
    const sourceDurationSeconds = Math.max(0.001, Math.min(remainingSourceSeconds, buffer.duration - offsetSeconds));
    const outputDurationSeconds = sourceDurationSeconds / speed;
    source.buffer = buffer;
    source.playbackRate.value = speed;
    scheduleBrowserGain(gain.gain, context.currentTime, beat, outputDurationSeconds, currentGain(), props.segment.fadeInBeats ?? 0, props.segment.fadeOutBeats ?? 0, lengthBeats(), secondsPerBeat(), speed);
    source.connect(gain);
    gain.connect(context.destination);
    source.start(context.currentTime + 0.001, offsetSeconds, sourceDurationSeconds);
    browserSource = source;
    browserGain = gain;
  }

  function currentGain() {
    return Math.pow(10, Math.max(-96, Math.min(24, payload()?.gainDb ?? 0)) / 20);
  }

  function getAudioContext() {
    if (audioContext) return audioContext;
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    audioContext = new Ctor();
    return audioContext;
  }

  return (
    <div class={styles.root} data-audio-segment-transport>
      <button
        type="button"
        class={styles.waveform}
        onPointerDown={seekFromPointer}
        aria-label={`Audio preview position ${formatBeat(positionBeat())} of ${formatBeat(lengthBeats())} beats`}
      >
        <span class={styles.centerLine} aria-hidden />
        <Show when={displayWaveform()} fallback={<span class={styles.waveformState}>{loadingWaveform() ? <LoadingIndicator size="sm" label="Loading waveform" /> : "Waveform unavailable"}</span>}>
          {(channels) => (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path d={waveformPath(channels().left, 25, 21)} />
              <path d={waveformPath(channels().right, 75, 21)} />
            </svg>
          )}
        </Show>
        <span class={styles.playhead} style={{ left: `${positionPercent()}%` }} aria-hidden />
        <span class={`${styles.channelLabel} ${styles.leftLabel}`}>L</span>
        <span class={`${styles.channelLabel} ${styles.rightLabel}`}>R</span>
      </button>
      <div class={styles.controls}>
        <HoverInfo content="Play from start">
          <Button iconOnly size="xs" onClick={restart} aria-label="Play audio segment from start">
            <Icon name="ph:skip-back-fill" size={18} decorative />
          </Button>
        </HoverInfo>
        <HoverInfo content={playing() ? "Pause" : "Play"}>
          <Button iconOnly size="xs" variant={playing() ? "primary" : "default"} onClick={togglePlayback} aria-label={playing() ? "Pause audio segment" : "Play audio segment"}>
            <Icon name={playing() ? "ph:pause-fill" : "ph:play-fill"} size={18} decorative />
          </Button>
        </HoverInfo>
        <span class={styles.time}>{formatBeat(positionBeat())} / {formatBeat(lengthBeats())} beats</span>
        <span class={styles.source} title={props.file?.path}>{props.file?.name ?? "Missing audio source"}</span>
      </div>
      <Show when={error()}><div class={styles.error} role="status">{error()}</div></Show>
    </div>
  );
}

async function loadWaveform(file: AudioFile): Promise<AudioWaveformSummary> {
  if (isNative()) {
    const response = await send({ kind: "audio.waveform", path: nativePath(file.path), bucketCount: 256 });
    if (response.waveform) return response.waveform;
    throw new Error(response.error ?? "Waveform unavailable.");
  }
  const context = new ((window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext)();
  try {
    const buffer = await loadAudioBuffer(context, file);
    return analyzeBuffer(buffer, 256);
  } finally {
    void context.close();
  }
}

async function loadAudioBuffer(context: AudioContext, file: AudioFile): Promise<AudioBuffer> {
  let url = playableUrl(file.path);
  if (isNative()) {
    const response = await send({ kind: "audio.previewData", path: nativePath(file.path) });
    if (!response.audioDataUrl) throw new Error(response.error ?? "Native audio data unavailable.");
    url = response.audioDataUrl;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Audio request failed (${response.status}).`);
  return context.decodeAudioData(await response.arrayBuffer());
}

function nativePath(path: string) {
  if (!path.startsWith("file:")) return path;
  try { return decodeURIComponent(new URL(path).pathname); } catch { return path; }
}

function playableUrl(path: string) {
  if (/^(data:|blob:|https?:|file:)/.test(path)) return path;
  if (path.startsWith("/")) return `file://${path.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
  return path;
}

function waveformSlice(summary: AudioWaveformSummary | null, startSeconds: number, durationSeconds: number) {
  if (!summary || summary.bucketCount <= 0 || summary.durationSeconds <= 0) return null;
  const start = Math.max(0, Math.min(summary.bucketCount - 1, Math.floor((startSeconds / summary.durationSeconds) * summary.bucketCount)));
  const end = Math.max(start + 1, Math.min(summary.bucketCount, Math.ceil(((startSeconds + durationSeconds) / summary.durationSeconds) * summary.bucketCount)));
  const envelope = (upper: number[], lower: number[]) => upper.slice(start, end).map((value, index) => Math.max(Math.abs(value), Math.abs(lower[start + index] ?? 0)));
  const left = envelope(summary.left.upper, summary.left.lower);
  const right = envelope(summary.right.upper, summary.right.lower);
  if (left.length === 0 && right.length === 0) return null;
  return { left, right: right.length > 0 ? right : left };
}

function waveformPath(peaks: number[], center: number, amplitude: number) {
  if (peaks.length === 0) return "";
  return peaks.map((peak, index) => {
    const x = peaks.length === 1 ? 50 : (index / (peaks.length - 1)) * 100;
    const height = Math.max(0, Math.min(1, peak)) * amplitude;
    return `M${x.toFixed(3)} ${(center - height).toFixed(3)} L${x.toFixed(3)} ${(center + height).toFixed(3)}`;
  }).join(" ");
}

function analyzeBuffer(buffer: AudioBuffer, bucketCount: number): AudioWaveformSummary {
  const analyze = (data: Float32Array) => {
    const upper: number[] = [];
    const lower: number[] = [];
    const bucketSize = Math.max(1, Math.ceil(data.length / bucketCount));
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      let high = 0;
      let low = 0;
      for (let index = bucket * bucketSize; index < Math.min(data.length, (bucket + 1) * bucketSize); index += 1) {
        high = Math.max(high, data[index] ?? 0);
        low = Math.min(low, data[index] ?? 0);
      }
      upper.push(high);
      lower.push(low);
    }
    return { upper, lower };
  };
  const left = analyze(buffer.getChannelData(0));
  const right = analyze(buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)));
  return { left, right, sampleRate: buffer.sampleRate, durationSeconds: buffer.duration, lengthInSamples: buffer.length, channelCount: buffer.numberOfChannels, bucketCount };
}

function scheduleBrowserGain(parameter: AudioParam, startTime: number, startBeat: number, durationSeconds: number, gain: number, fadeInBeats: number, fadeOutBeats: number, lengthBeats: number, secondsPerBeat: number, speed: number) {
  const envelopeAt = (beat: number) => {
    const fadeIn = fadeInBeats > 0 ? Math.min(1, beat / fadeInBeats) : 1;
    const fadeOut = fadeOutBeats > 0 ? Math.min(1, (lengthBeats - beat) / fadeOutBeats) : 1;
    return Math.max(0, Math.min(fadeIn, fadeOut));
  };
  parameter.setValueAtTime(gain * envelopeAt(startBeat), startTime);
  if (fadeInBeats > startBeat) parameter.linearRampToValueAtTime(gain, startTime + (fadeInBeats - startBeat) * secondsPerBeat / speed);
  const fadeOutStart = lengthBeats - fadeOutBeats;
  if (fadeOutBeats > 0 && fadeOutStart > startBeat && fadeOutStart < lengthBeats) parameter.setValueAtTime(gain, startTime + (fadeOutStart - startBeat) * secondsPerBeat / speed);
  if (fadeOutBeats > 0) parameter.linearRampToValueAtTime(0, startTime + durationSeconds);
}

function formatBeat(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
