import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { nanoid } from "nanoid";
import { appAlert, Button, Checkbox, FloatingSelect, Icon, Modal, Slider } from "../../solid-ui";
import { browserBlobToAudioFile } from "../../audio/audioImport";
import { isNative, send } from "../../ipc/bridge";
import type { AudioDeviceSnapshot, RecordingCaptureStats } from "../../ipc/schema";
import { useAudioFileStore, useInstrumentStore, useProjectStore } from "../../state/store";
import type { AudioFile, Id, Segment } from "../../state/types";
import styles from "./AudioRecordingModal.module.css";

interface Props {
  trackId: Id;
  trackName: string;
  startBeat: number;
  recordingGroupId: Id;
  bpm: number;
  inputDeviceId: string;
  inputDeviceName: string;
  inputChannelCount: number;
  takes: Array<{ segment: Segment; file?: AudioFile }>;
  onClose: () => void;
  onCommit: (take: {
    file: AudioFile;
    cropStartSeconds: number;
    cropEndSeconds: number;
    lengthBeats: number;
    sourceStartBeat: number;
    segmentId?: Id;
    recordedAt?: number;
  }) => void;
  onToggleTake: (segmentId: Id, enabled: boolean) => void;
  onInputDeviceChange: (input: { id: string; name: string; channelCount: number }) => void;
}

export function AudioRecordingModal(props: Props) {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let timer: number | undefined;
  let audioElement: HTMLAudioElement | undefined;
  let audioUrl: string | null = null;

  const [devices, setDevices] = createSignal<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = createSignal(props.inputDeviceId);
  const [nativeDevices, setNativeDevices] = createSignal<AudioDeviceSnapshot | null>(null);
  const [deviceLoading, setDeviceLoading] = createSignal(false);
  const [recording, setRecording] = createSignal(false);
  const [recordingError, setRecordingError] = createSignal("");
  const [nativeTakeStats, setNativeTakeStats] = createSignal<RecordingCaptureStats | null>(null);
  const [recordedBlob, setRecordedBlob] = createSignal<Blob | null>(null);
  const [recordedName, setRecordedName] = createSignal("Recorded audio");
  const [durationSeconds, setDurationSeconds] = createSignal(0);
  const [elapsedSeconds, setElapsedSeconds] = createSignal(0);
  const [peaks, setPeaks] = createSignal<number[]>([]);
  const [cropStart, setCropStart] = createSignal(0);
  const [cropEnd, setCropEnd] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);

  const canRecord = createMemo(() => Boolean(
    isNative() || (
      typeof navigator !== "undefined"
      && navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === "function"
      && typeof MediaRecorder !== "undefined"
    ),
  ));
  const hasTake = createMemo(() => Boolean(recordedBlob()) || Boolean(nativeTakeStats()?.recordedSamples));
  const cropLength = createMemo(() => Math.max(0, cropEnd() - cropStart()));
  const cropLengthBeats = createMemo(() => Math.max(0.03125, cropLength() * (props.bpm / 60)));
  const sourceStartBeat = createMemo(() => Math.max(0, cropStart() * (props.bpm / 60)));

  onMount(() => {
    if (isNative()) void refreshNativeDevices();
    else void refreshDevices();
  });

  onCleanup(() => {
    stopTimer();
    stopPlayback();
    stopStream();
    if (isNative()) void send({ kind: "recording.cancel" }).catch(() => undefined);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  });

  async function refreshDevices() {
    if (isNative()) return;
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const next = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
      setDevices(next);
    } catch {
      setDevices([]);
    }
  }

  async function refreshNativeDevices() {
    setDeviceLoading(true);
    try {
      const response = await send({ kind: "audio.listDevices" });
      setNativeDevices(response.snapshot);
    } catch {
      setNativeDevices(null);
    } finally {
      setDeviceLoading(false);
    }
  }

  const deviceOptions = createMemo(() => {
    const fallback = [{ value: "", label: props.inputDeviceName ? `Default input · ${props.inputDeviceName}` : "Default input" }];
    if (isNative()) {
      const inputs = nativeDevices()?.devices.filter((device) => device.input) ?? [];
      return [
        ...fallback,
        ...inputs.map((device) => ({
          value: nativeDeviceValue(device.typeName, device.name),
          label: device.currentInput ? `${device.name} · Current` : device.name,
        })),
      ];
    }
    const seen = new Set<string>();
    return [
      ...fallback,
      ...devices().flatMap((device, index) => {
        if (!device.deviceId || device.deviceId === "default" || seen.has(device.deviceId)) return [];
        seen.add(device.deviceId);
        return [{ value: device.deviceId, label: device.label || `Connected input ${index + 1}` }];
      }),
    ];
  });

  async function selectDevice(value: string) {
    if (recording()) return;
    setRecordingError("");
    setDeviceId(value);
    if (!isNative()) {
      const device = devices().find((candidate) => candidate.deviceId === value);
      props.onInputDeviceChange({ id: value, name: device?.label ?? "", channelCount: props.inputChannelCount });
      return;
    }
    if (!value) {
      props.onInputDeviceChange({ id: "", name: "", channelCount: props.inputChannelCount });
      return;
    }
    const selected = parseNativeDeviceValue(value);
    if (!selected) return;
    setDeviceLoading(true);
    try {
      const response = await send({
        kind: "audio.selectInputDevice",
        typeName: selected.typeName,
        deviceName: selected.name,
        inputChannelCount: props.inputChannelCount,
      });
      setNativeDevices(response.snapshot);
      if (!response.ok) throw new Error(response.error ?? "Could not select input device.");
      props.onInputDeviceChange({ id: value, name: selected.name, channelCount: props.inputChannelCount });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not select input device.";
      setRecordingError(message);
      await appAlert(message);
      setDeviceId(props.inputDeviceId);
    } finally {
      setDeviceLoading(false);
    }
  }

  async function ensureNativeInputReady() {
    if (!isNative()) return;
    let snapshot = nativeDevices();
    if (!snapshot) {
      const response = await send({ kind: "audio.listDevices" });
      snapshot = response.snapshot;
      setNativeDevices(snapshot);
    }
    const persistedInput = deviceId() ? parseNativeDeviceValue(deviceId()) : null;
    const defaultInput = persistedInput
      ? { typeName: persistedInput.typeName, name: persistedInput.name }
      : snapshot.devices.find((device) => device.input && device.currentInput)
        ?? snapshot.devices.find((device) => device.input);
    if (!defaultInput) throw new Error("No connected audio input is available.");
    const response = await send({
      kind: "audio.selectInputDevice",
      typeName: defaultInput.typeName,
      deviceName: defaultInput.name,
      inputChannelCount: props.inputChannelCount,
    });
    setNativeDevices(response.snapshot);
    if (!response.ok) throw new Error(response.error ?? "Could not activate the default input.");
    props.onInputDeviceChange({ id: deviceId(), name: defaultInput.name, channelCount: props.inputChannelCount });
  }

  async function startRecording() {
    if (isNative()) {
      stopPlayback();
      setRecordingError("");
      setNativeTakeStats(null);
      setElapsedSeconds(0);
      try {
        await ensureNativeInputReady();
        const project = useProjectStore.getState().project;
        const planResponse = await send({
          kind: "recording.plan",
          project,
          instruments: useInstrumentStore.getState().instruments,
          audioFiles: useAudioFileStore.getState().files,
          trackId: props.trackId,
          startBeat: props.startBeat,
          maxDurationSeconds: 600,
          inputChannels: props.inputChannelCount,
          sampleRate: nativeDevices()?.sampleRate || undefined,
          bpm: props.bpm,
          requireRecordArm: false,
        });
        if (!planResponse.plan) throw new Error(planResponse.error ?? "Could not plan input recording.");
        const prepared = await send({
          kind: "recording.prepare",
          maxDurationSeconds: planResponse.plan.maxDurationSeconds,
          inputChannels: planResponse.plan.inputChannels,
        });
        if (!prepared.ok) throw new Error(prepared.error ?? "Could not prepare input recording.");
        const started = await send({ kind: "recording.start" });
        if (!started.stats.active) throw new Error("The input recorder did not start.");
        timer = window.setInterval(() => setElapsedSeconds((current) => current + 0.1), 100);
        setRecording(true);
      } catch (error) {
        stopTimer();
        setRecording(false);
        await send({ kind: "recording.cancel" }).catch(() => undefined);
        const message = error instanceof Error ? error.message : "Could not start audio recording.";
        setRecordingError(message);
        await appAlert(message);
      }
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
      setRecordingError("");
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
      const message = error instanceof Error ? error.message : "Could not start audio recording.";
      setRecordingError(message);
      await appAlert(message);
    }
  }

  async function stopRecording() {
    if (isNative()) {
      try {
        const response = await send({ kind: "recording.stop" });
        setNativeTakeStats(response.stats);
        if (response.stats.recordedSamples <= 0) {
          setRecordingError("No input audio was captured. Check macOS microphone permission and the selected input device, then try again.");
        } else {
          setRecordingError("");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not stop audio recording.";
        setRecordingError(message);
        await appAlert(message);
      } finally {
        stopTimer();
        setRecording(false);
      }
      return;
    }
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  async function completeRecording() {
    stopTimer();
    setRecording(false);
    const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
    recorder = null;
    stopStream();
    if (blob.size === 0) return;
    setRecordedBlob(() => blob);
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
    if (isNative()) {
      const stats = nativeTakeStats();
      if (!stats || stats.recordedSamples <= 0 || stats.durationSeconds <= 0) return;
      const takeNumber = props.takes.reduce((maximum, take) => Math.max(maximum, take.segment.recordingTakeNumber ?? 0), 0) + 1;
      const segmentId = nanoid();
      const audioFileId = nanoid();
      const recordedAt = Date.now();
      try {
        const response = await send({
          kind: "recording.commitTake",
          project: useProjectStore.getState().project,
          instruments: useInstrumentStore.getState().instruments,
          audioFiles: useAudioFileStore.getState().files,
          trackId: props.trackId,
          pathHint: "",
          startBeat: props.startBeat,
          name: `Live Record Take ${takeNumber}`,
          trackName: props.trackName,
          audioFileId,
          segmentId,
          bpm: props.bpm,
          gainDb: 0,
          compensateLatency: true,
          bitDepth: 24,
        });
        if (!response.audioFile || !response.segmentId || !response.lengthBeats) {
          throw new Error(response.error ?? "Could not save the recorded take.");
        }
        const committedSegment = response.track?.segments.find((segment) => segment.id === response.segmentId);
        props.onCommit({
          file: response.audioFile,
          cropStartSeconds: 0,
          cropEndSeconds: stats.durationSeconds,
          lengthBeats: response.lengthBeats,
          sourceStartBeat: committedSegment?.sourceStartBeat ?? 0,
          segmentId: response.segmentId,
          recordedAt,
        });
        setNativeTakeStats(null);
        setElapsedSeconds(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not save the recorded take.";
        setRecordingError(message);
        await appAlert(message);
      }
      return;
    }
    const blob = recordedBlob();
    if (!blob || cropLength() <= 0) return;
    const file = await browserBlobToAudioFile(blob, recordedName());
    props.onCommit({
      file,
      cropStartSeconds: cropStart(),
      cropEndSeconds: cropEnd(),
      lengthBeats: cropLengthBeats(),
      sourceStartBeat: sourceStartBeat(),
    });
    resetCurrentBrowserTake();
  }

  function resetCurrentBrowserTake() {
    stopPlayback();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    setRecordedBlob(null);
    setDurationSeconds(0);
    setElapsedSeconds(0);
    setCropStart(0);
    setCropEnd(0);
    setPeaks([]);
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
      title={<><Icon name="ph:record-fill" size={18} decorative /> Live Record</>}
      subtitle={`${props.trackName} · starts at beat ${formatNumber(props.startBeat)}`}
      width="lg"
      onClose={props.onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={props.onClose}>Done</Button>
          <Button variant="primary" disabled={!hasTake() || (!isNative() && cropLength() <= 0)} onClick={() => void commit()}>Add current take</Button>
        </>
      )}
    >
      <div class={styles.recorder}>
        <section class={styles.inputSection} aria-label="Recording input">
          <header class={styles.sectionHeader}>
            <span>Input</span>
            <span>{deviceLoading() ? "Scanning…" : formatInputChannelSummary(isNative() ? nativeDevices()?.inputChannelNames.length : undefined, props.inputChannelCount)}</span>
          </header>
          <FloatingSelect
            label="Device"
            value={deviceId()}
            disabled={recording() || deviceLoading()}
            options={deviceOptions()}
            onChange={(value) => void selectDevice(value)}
          />
          <p class={styles.deviceHint}>Default uses the current system input. Connected USB, Bluetooth, and aggregate inputs appear when reported by the operating system.</p>
        </section>

        <div class={styles.transportRow}>
          <Button
            variant={recording() ? "primary" : "default"}
            disabled={!canRecord()}
            onClick={() => recording() ? void stopRecording() : void startRecording()}
          >
            <Icon name={recording() ? "ph:stop-fill" : "ph:record-fill"} size={18} decorative />
            {recording() ? "Stop" : "Record"}
          </Button>
          <Show when={hasTake() && !isNative()}>
            <Button variant="default" onClick={() => playing() ? stopPlayback() : playCrop()}>
              <Icon name={playing() ? "ph:stop-fill" : "ph:play-fill"} size={18} decorative />
              {playing() ? "Stop" : "Play"}
            </Button>
          </Show>
          <span class={styles.status}>{recording()
            ? `Recording ${formatTime(elapsedSeconds())}`
            : nativeTakeStats()?.recordedSamples
              ? `${formatTime(nativeTakeStats()!.durationSeconds)} ready to add`
              : hasTake() ? `${formatTime(cropLength())} selected` : "Ready"}</span>
        </div>

        <Show when={recordingError()}>
          <div class={styles.recordingError} role="alert">{recordingError()}</div>
        </Show>

        <div class={styles.waveformStage} aria-label="Recorded waveform">
          <Show when={peaks().length > 0} fallback={<span class={styles.emptyWaveform}>{recording() ? "Recording…" : nativeTakeStats()?.recordedSamples ? "Take ready to add" : "No current take"}</span>}>
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

        <Show when={hasTake() && !isNative()}>
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

        <section class={styles.takesSection} aria-label="Recorded takes">
          <header class={styles.sectionHeader}>
            <span>Recorded Takes</span>
            <span>{props.takes.length}</span>
          </header>
          <Show when={props.takes.length > 0} fallback={<div class={styles.emptyTakes}>Each take recorded into this Live Record segment will appear here.</div>}>
            <div class={styles.takeList}>
              <For each={props.takes}>
                {(take) => (
                  <div class={`${styles.takeRow} ${take.segment.muted ? styles.takeRowDisabled : ""}`}>
                    <Checkbox
                      checked={!take.segment.muted}
                      aria-label={`Include take ${take.segment.recordingTakeNumber ?? 1} in layered playback`}
                      onChange={(enabled) => props.onToggleTake(take.segment.id, enabled)}
                    />
                    <span class={styles.takeIdentity}>
                      <strong>Take {take.segment.recordingTakeNumber ?? 1}</strong>
                      <span>{take.file?.name ?? take.segment.name ?? "Recorded audio"}</span>
                    </span>
                    <span class={styles.takeMeta}>
                      <span>{formatBeatLength(take.segment.lengthBeats)} beats</span>
                      <span>Layer {take.segment.layer + 1}</span>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>
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

function nativeDeviceValue(typeName: string, name: string): string {
  return `${encodeURIComponent(typeName)}::${encodeURIComponent(name)}`;
}

function parseNativeDeviceValue(value: string): { typeName: string; name: string } | null {
  const separator = value.indexOf("::");
  if (separator < 0) return null;
  try {
    return {
      typeName: decodeURIComponent(value.slice(0, separator)),
      name: decodeURIComponent(value.slice(separator + 2)),
    };
  } catch {
    return null;
  }
}

function formatInputChannelSummary(available: number | undefined, requested: number): string {
  const channels = available && available > 0 ? Math.min(available, Math.max(1, requested)) : Math.max(1, requested);
  return `${channels} ${channels === 1 ? "channel" : "channels"}`;
}

function formatBeatLength(beats: number): string {
  if (!Number.isFinite(beats)) return "0";
  return Number.isInteger(beats) ? String(beats) : beats.toFixed(2);
}
