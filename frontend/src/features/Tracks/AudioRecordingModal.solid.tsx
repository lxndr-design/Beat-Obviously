import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { appAlert, Button, Icon, Modal, Select, Slider } from "../../solid-ui";
import { browserBlobToAudioFile } from "../../audio/audioImport";
import { isNative } from "../../ipc/bridge";
import type { AudioFile, Id } from "../../state/types";
import styles from "./AudioRecordingModal.module.css";

interface Props {
  trackId: Id;
  trackName: string;
  startBeat: number;
  bpm: number;
  onClose: () => void;
  onCommit: (take: {
    file: AudioFile;
    cropStartSeconds: number;
    cropEndSeconds: number;
    lengthBeats: number;
    sourceStartBeat: number;
  }) => void;
}

export function AudioRecordingModal(props: Props) {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let timer: number | undefined;
  let audioElement: HTMLAudioElement | undefined;
  let audioUrl: string | null = null;

  const [devices, setDevices] = createSignal<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = createSignal("");
  const [recording, setRecording] = createSignal(false);
  const [recordedBlob, setRecordedBlob] = createSignal<Blob | null>(null);
  const [recordedName, setRecordedName] = createSignal("Recorded audio");
  const [durationSeconds, setDurationSeconds] = createSignal(0);
  const [elapsedSeconds, setElapsedSeconds] = createSignal(0);
  const [peaks, setPeaks] = createSignal<number[]>([]);
  const [cropStart, setCropStart] = createSignal(0);
  const [cropEnd, setCropEnd] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);

  const canRecord = createMemo(() => Boolean(
    !isNative()
    && typeof navigator !== "undefined"
    && navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === "function"
    && typeof MediaRecorder !== "undefined",
  ));
  const hasTake = createMemo(() => Boolean(recordedBlob()));
  const cropLength = createMemo(() => Math.max(0, cropEnd() - cropStart()));
  const cropLengthBeats = createMemo(() => Math.max(0.03125, cropLength() * (props.bpm / 60)));
  const sourceStartBeat = createMemo(() => Math.max(0, cropStart() * (props.bpm / 60)));

  onMount(() => {
    if (isNative()) return;
    void refreshDevices();
  });

  onCleanup(() => {
    stopTimer();
    stopPlayback();
    stopStream();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  });

  async function refreshDevices() {
    if (isNative()) return;
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const next = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
      setDevices(next);
      if (!deviceId() && next[0]?.deviceId) setDeviceId(next[0].deviceId);
    } catch {
      setDevices([]);
    }
  }

  async function startRecording() {
    if (isNative()) {
      await appAlert("Track recording needs the native recorder backend before it can capture audio in the app.");
      return;
    }
    if (!canRecord()) {
      await appAlert("Audio recording is not available in this browser.");
      return;
    }
    stopPlayback();
    stopStream();
    const constraints: MediaStreamConstraints = {
      audio: deviceId() ? { deviceId: { exact: deviceId() } } : true,
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      await refreshDevices();
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => void completeRecording();
      setElapsedSeconds(0);
      timer = window.setInterval(() => setElapsedSeconds((current) => current + 0.1), 100);
      recorder.start();
      setRecording(true);
    } catch (error) {
      stopStream();
      await appAlert(error instanceof Error ? error.message : "Could not start audio recording.");
    }
  }

  function stopRecording() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  async function completeRecording() {
    stopTimer();
    setRecording(false);
    const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
    recorder = null;
    stopStream();
    if (blob.size === 0) return;
    setRecordedBlob(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    setRecordedName(`Recording ${stamp}.webm`);
    await analyzeBlob(blob);
  }

  async function analyzeBlob(blob: Blob) {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(blob);
    if (isNative()) {
      setDurationSeconds(0);
      setCropStart(0);
      setCropEnd(0);
      setPeaks([]);
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = new Ctor();
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      await ctx.close();
      const duration = Math.max(0, buffer.duration);
      setDurationSeconds(duration);
      setCropStart(0);
      setCropEnd(duration);
      setPeaks(audioBufferPeaks(buffer, 160));
    } catch {
      setDurationSeconds(0);
      setCropStart(0);
      setCropEnd(0);
      setPeaks([]);
    }
  }

  function stopTimer() {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  }

  function stopStream() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function playCrop() {
    if (!audioUrl) return;
    stopPlayback();
    const next = new Audio(audioUrl);
    audioElement = next;
    next.currentTime = cropStart();
    next.addEventListener("timeupdate", stopAtCropEnd);
    next.addEventListener("ended", stopPlayback, { once: true });
    void next.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  function stopAtCropEnd() {
    if (!audioElement || audioElement.currentTime < cropEnd()) return;
    stopPlayback();
  }

  function stopPlayback() {
    if (audioElement) {
      audioElement.pause();
      audioElement.removeEventListener("timeupdate", stopAtCropEnd);
    }
    audioElement = undefined;
    setPlaying(false);
  }

  async function commit() {
    const blob = recordedBlob();
    if (!blob || cropLength() <= 0) return;
    if (isNative()) {
      await appAlert("Track recording needs the native recorder backend before it can save takes in the app.");
      return;
    }
    const file = await browserBlobToAudioFile(blob, recordedName());
    props.onCommit({
      file,
      cropStartSeconds: cropStart(),
      cropEndSeconds: cropEnd(),
      lengthBeats: cropLengthBeats(),
      sourceStartBeat: sourceStartBeat(),
    });
  }

  function setCropStartSafe(value: number) {
    stopPlayback();
    setCropStart(Math.max(0, Math.min(value, Math.max(0, cropEnd() - 0.05))));
  }

  function setCropEndSafe(value: number) {
    stopPlayback();
    setCropEnd(Math.min(durationSeconds(), Math.max(value, cropStart() + 0.05)));
  }

  return (
    <Modal
      open
      title={<><Icon name="ph:record-fill" size={14} decorative /> REC Audio</>}
      subtitle={`${props.trackName} · starts at beat ${formatNumber(props.startBeat)}`}
      width="md"
      onClose={props.onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" disabled={!hasTake() || cropLength() <= 0} onClick={() => void commit()}>Add take</Button>
        </>
      )}
    >
      <div class={styles.recorder}>
        <Select
          label="Device"
          value={deviceId()}
          disabled={recording()}
          onChange={(event) => setDeviceId(event.currentTarget.value)}
        >
          <For each={devices()} fallback={<option value="">Default input</option>}>
            {(device, index) => (
              <option value={device.deviceId}>{device.label || `Input ${index() + 1}`}</option>
            )}
          </For>
        </Select>

        <div class={styles.transportRow}>
          <Button
            variant={recording() ? "primary" : "default"}
            disabled={!canRecord()}
            onClick={() => recording() ? stopRecording() : void startRecording()}
          >
            <Icon name={recording() ? "ph:stop-fill" : "ph:record-fill"} size={14} decorative />
            {recording() ? "Stop" : "Record"}
          </Button>
          <Show when={hasTake()}>
            <Button variant="default" onClick={() => playing() ? stopPlayback() : playCrop()}>
              <Icon name={playing() ? "ph:stop-fill" : "ph:play-fill"} size={14} decorative />
              {playing() ? "Stop" : "Play"}
            </Button>
          </Show>
          <span class={styles.status}>{recording() ? `Recording ${formatTime(elapsedSeconds())}` : hasTake() ? `${formatTime(cropLength())} selected` : "Ready"}</span>
        </div>

        <div class={styles.waveformStage} aria-label="Recorded waveform">
          <Show when={peaks().length > 0} fallback={<span class={styles.emptyWaveform}>{recording() ? "Recording..." : "No take recorded"}</span>}>
            <svg class={styles.waveform} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <rect
                class={styles.cropWindow}
                x={`${cropStartRatio() * 100}`}
                y="0"
                width={`${Math.max(0, cropEndRatio() - cropStartRatio()) * 100}`}
                height="100"
              />
              <path d={waveformPath(peaks())} class={styles.waveformTrace} />
            </svg>
          </Show>
        </div>

        <Show when={hasTake()}>
          <div class={styles.cropGrid}>
            <Slider
              label="Crop start"
              value={cropStart()}
              min={0}
              max={Math.max(0.05, durationSeconds())}
              step={0.01}
              readout={formatTime(cropStart())}
              onChange={setCropStartSafe}
            />
            <Slider
              label="Crop end"
              value={cropEnd()}
              min={0}
              max={Math.max(0.05, durationSeconds())}
              step={0.01}
              readout={formatTime(cropEnd())}
              onChange={setCropEndSafe}
            />
          </div>
        </Show>
      </div>
    </Modal>
  );

  function cropStartRatio() {
    return durationSeconds() > 0 ? cropStart() / durationSeconds() : 0;
  }

  function cropEndRatio() {
    return durationSeconds() > 0 ? cropEnd() / durationSeconds() : 0;
  }
}

function audioBufferPeaks(buffer: AudioBuffer, count: number): number[] {
  const channel = buffer.getChannelData(0);
  const samplesPerBucket = Math.max(1, Math.floor(channel.length / count));
  const peaks: number[] = [];
  for (let bucket = 0; bucket < count; bucket += 1) {
    let peak = 0;
    const start = bucket * samplesPerBucket;
    const end = Math.min(channel.length, start + samplesPerBucket);
    for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    peaks.push(peak);
  }
  const max = Math.max(0.001, ...peaks);
  return peaks.map((peak) => peak / max);
}

function waveformPath(peaks: number[]): string {
  if (peaks.length === 0) return "";
  return peaks.map((peak, index) => {
    const x = (index / Math.max(1, peaks.length - 1)) * 100;
    const y1 = 50 - peak * 46;
    const y2 = 50 + peak * 46;
    return `M ${x.toFixed(2)} ${y1.toFixed(2)} L ${x.toFixed(2)} ${y2.toFixed(2)}`;
  }).join(" ");
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0.00s";
  return `${Math.max(0, seconds).toFixed(2)}s`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}
