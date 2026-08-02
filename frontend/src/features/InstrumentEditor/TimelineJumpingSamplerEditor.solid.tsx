import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { appAlert, Button, FloatingSelect, Icon, LoadingIndicator, Modal, NumberInput, TextInput } from "../../solid-ui";
import {
  cachedInstrumentSampleBuffer,
  getBrowserPreviewAudioContext,
  preloadInstrumentSampleUrl,
  startInstrumentSampleZoneAudition,
  type InstrumentPreviewAuditionHandle,
} from "../../audio/synthPreview";
import {
  createTimelineJumpingZone,
  formatTimelineSeconds,
  midiPitchLabel,
  nextTimelineJumpingPitch,
  normalizeTimelineJumpingZone,
  timelineJumpingZoneSeconds,
} from "../../state/timelineJumpingSampler";
import type { AudioFile, Instrument, InstrumentSampleZone } from "../../state/types";
import styles from "./TimelineJumpingSamplerEditor.module.css";

interface Props {
  instrument: Instrument;
  audioFiles: AudioFile[];
  onImportAudio: () => Promise<AudioFile[] | void>;
  onRegisterAudioFiles: (files: AudioFile[]) => void;
  onChange: (patch: Partial<Instrument>) => void;
}

interface WaveformData {
  peaks: number[];
  durationSeconds: number;
  sampleRate: number;
  lengthInSamples: number;
}

const MIDI_PITCH_OPTIONS = Array.from({ length: 128 }, (_, pitch) => ({
  value: String(pitch),
  label: `${midiPitchLabel(pitch)} · ${pitch}`,
}));

export function TimelineJumpingSamplerEditor(props: Props) {
  const [audioPickerOpen, setAudioPickerOpen] = createSignal(false);
  const [selectedAudioId, setSelectedAudioId] = createSignal("");
  const [selectedZoneId, setSelectedZoneId] = createSignal<string | null>(null);
  const [playheadSeconds, setPlayheadSeconds] = createSignal(0);
  const [waveform, setWaveform] = createSignal<WaveformData | null>(null, { equals: false });
  const [waveformLoading, setWaveformLoading] = createSignal(false);
  const [auditionZoneId, setAuditionZoneId] = createSignal<string | null>(null);
  let auditionHandle: InstrumentPreviewAuditionHandle | null = null;

  const sourcePath = createMemo(() => props.instrument.sampleUrl
    ?? props.instrument.sampleMap?.[0]?.path
    ?? "");
  const sourceAudio = createMemo(() => props.audioFiles.find((file) => file.path === sourcePath()));
  const sourceMeta = createMemo(() => {
    const source = sourceAudio();
    const decoded = waveform();
    if (!sourcePath()) return null;
    return {
      path: sourcePath(),
      sampleRate: decoded?.sampleRate ?? source?.sampleRate ?? 44_100,
      durationSeconds: decoded?.durationSeconds ?? source?.durationSeconds ?? 0,
    };
  });
  const zones = createMemo(() => (props.instrument.sampleMap ?? [])
    .filter((zone) => zone.path === sourcePath())
    .slice()
    .sort((a, b) => a.rootNote - b.rootNote || (a.startSample ?? 0) - (b.startSample ?? 0)));
  const selectedZone = createMemo(() => zones().find((zone) => zone.id === selectedZoneId()) ?? null);

  createEffect(() => {
    const path = sourcePath();
    let cancelled = false;
    setWaveform(null);
    if (!path) return;
    setWaveformLoading(true);
    const ctx = getBrowserPreviewAudioContext();
    void preloadInstrumentSampleUrl(ctx, path)
      .then(() => {
        if (cancelled) return;
        const buffer = cachedInstrumentSampleBuffer(path);
        setWaveform(buffer ? summarizeWaveform(buffer, 256) : null);
      })
      .catch(() => {
        if (!cancelled) setWaveform(null);
      })
      .finally(() => {
        if (!cancelled) setWaveformLoading(false);
      });
    onCleanup(() => { cancelled = true; });
  });

  onCleanup(() => {
    auditionHandle?.stop();
    auditionHandle = null;
  });

  function chooseSource(file: AudioFile) {
    auditionHandle?.stop();
    auditionHandle = null;
    props.onRegisterAudioFiles([file]);
    props.onChange({
      sampleIds: [file.id],
      sampleUrl: file.path,
      sampleUrls: [file.path],
      sampleMap: [],
      samplerComplexity: "timeline-jumping",
    });
    setSelectedZoneId(null);
    setPlayheadSeconds(0);
    setSelectedAudioId("");
    setAudioPickerOpen(false);
  }

  async function importSource() {
    const imported = await props.onImportAudio();
    if (imported?.[0]) chooseSource(imported[0]);
  }

  function addPitchAtPlayhead() {
    const source = sourceMeta();
    if (!source) return;
    const pitch = nextTimelineJumpingPitch(zones());
    if (pitch == null) {
      void appAlert("All 128 MIDI pitches already have Timeline Jumping pads.");
      return;
    }
    const zone = createTimelineJumpingZone({
      source,
      pitch,
      startSeconds: playheadSeconds(),
      endSeconds: source.durationSeconds,
      seqPosition: zones().length,
    });
    const next = [...zones(), zone];
    props.onChange({ sampleMap: next, sampleUrl: source.path, sampleUrls: [source.path] });
    setSelectedZoneId(zone.id ?? null);
  }

  function patchZone(zone: InstrumentSampleZone, patch: NonNullable<Parameters<typeof normalizeTimelineJumpingZone>[2]>) {
    const source = sourceMeta();
    if (!source) return;
    if (patch.rootNote != null && zones().some((candidate) => candidate.id !== zone.id && candidate.rootNote === Math.round(patch.rootNote!))) {
      void appAlert(`${midiPitchLabel(patch.rootNote)} is already assigned to another jump.`);
      return;
    }
    const next = zones().map((candidate) => candidate.id === zone.id
      ? normalizeTimelineJumpingZone(candidate, source, patch)
      : candidate);
    props.onChange({ sampleMap: next });
  }

  function deleteZone(zone: InstrumentSampleZone) {
    auditionHandle?.stop();
    auditionHandle = null;
    props.onChange({ sampleMap: zones().filter((candidate) => candidate.id !== zone.id) });
    if (selectedZoneId() === zone.id) setSelectedZoneId(null);
  }

  async function audition(zone: InstrumentSampleZone) {
    if (auditionZoneId() === zone.id) {
      auditionHandle?.stop();
      auditionHandle = null;
      setAuditionZoneId(null);
      return;
    }
    auditionHandle?.stop();
    auditionHandle = null;
    setAuditionZoneId(zone.id ?? null);
    const source = sourceMeta();
    const clip = source ? timelineJumpingZoneSeconds(zone, source.sampleRate, source.durationSeconds) : null;
    try {
      auditionHandle = await startInstrumentSampleZoneAudition(
        props.instrument,
        { sampleZoneId: zone.id, samplePath: zone.path },
        Math.min(2.5, Math.max(0.12, clip ? clip.endSeconds - clip.startSeconds : 1)),
        0.24,
        120,
        112,
        () => {
          if (auditionZoneId() === zone.id) setAuditionZoneId(null);
          auditionHandle = null;
        },
      );
    } catch {
      if (auditionZoneId() === zone.id) setAuditionZoneId(null);
      auditionHandle = null;
      void appAlert("Could not audition this timeline jump.");
    }
  }

  function movePlayhead(event: PointerEvent) {
    const duration = sourceMeta()?.durationSeconds ?? 0;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
    setPlayheadSeconds(duration * ratio);
  }

  function setSelectedBoundary(boundary: "start" | "end") {
    const zone = selectedZone();
    const source = sourceMeta();
    if (!zone || !source) return;
    const sample = Math.round(playheadSeconds() * source.sampleRate);
    patchZone(zone, boundary === "start" ? { startSample: sample } : { endSample: sample });
  }

  const waveformPoints = createMemo(() => waveformPolygon(waveform()?.peaks ?? []));
  const duration = createMemo(() => sourceMeta()?.durationSeconds ?? 0);

  return (
    <div class={styles.editor}>
      <div class={styles.sourceRibbon}>
        <div class={styles.sourceIdentity}>
          <span class={styles.eyebrow}>Source Timeline</span>
          <strong>{sourceAudio()?.name ?? (sourcePath() ? sourcePath().split(/[\\/]/).pop() : "No audio selected")}</strong>
          <Show when={duration() > 0}><span>{formatTimelineSeconds(duration())}</span></Show>
        </div>
        <div class={styles.sourceActions}>
          <Button size="xs" onClick={() => setAudioPickerOpen(true)}>{sourcePath() ? "Change Audio" : "Select Audio"}</Button>
          <Button size="xs" onClick={() => void importSource()}>Import WAV/MP3</Button>
        </div>
      </div>

      <Show when={sourcePath()} fallback={
        <div class={styles.emptyState}>
          <Icon name="ph:waveform" size={18} decorative />
          <strong>Select a WAV or MP3</strong>
          <span>One source becomes many keyboard pads. Every pad remembers its own point on the timeline.</span>
        </div>
      }>
        <div class={styles.waveformPanel}>
          <button class={styles.waveform} type="button" onPointerDown={movePlayhead} aria-label="Set Timeline Jumping playhead">
            <span class={styles.centerLine} />
            <Show when={waveformPoints()} fallback={<span class={styles.waveformStatus}>{waveformLoading() ? <LoadingIndicator size="sm" label="Decoding waveform" /> : "Waveform unavailable"}</span>}>
              {(points) => (
                <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
                  <polygon points={points()} />
                </svg>
              )}
            </Show>
            <For each={zones()}>{(zone) => {
              const start = () => sourceMeta()
                ? timelineJumpingZoneSeconds(zone, sourceMeta()!.sampleRate, duration()).startSeconds
                : 0;
              return (
                <span
                  class={styles.jumpMarker}
                  data-selected={selectedZoneId() === zone.id ? "true" : "false"}
                  style={{ left: `${duration() > 0 ? (start() / duration()) * 100 : 0}%` }}
                  title={`${midiPitchLabel(zone.rootNote)} · ${formatTimelineSeconds(start())}`}
                >
                  {midiPitchLabel(zone.rootNote)}
                </span>
              );
            }}</For>
            <span class={styles.playhead} style={{ left: `${duration() > 0 ? (playheadSeconds() / duration()) * 100 : 0}%` }} />
          </button>
          <div class={styles.playheadBar}>
            <span>Playhead {formatTimelineSeconds(playheadSeconds())}</span>
            <div>
              <Button size="xs" onClick={() => setSelectedBoundary("start")} disabled={!selectedZone()}>Set Selected Start</Button>
              <Button size="xs" onClick={() => setSelectedBoundary("end")} disabled={!selectedZone()}>Set Selected End</Button>
              <Button size="xs" variant="primary" onClick={addPitchAtPlayhead}>New Pitch Here</Button>
            </div>
          </div>
        </div>

        <div class={styles.padHeader}>
          <span>Keyboard Pads</span>
          <span>{zones().length} jump{zones().length === 1 ? "" : "s"}</span>
        </div>
        <div class={styles.padList}>
          <Show when={zones().length > 0} fallback={<div class={styles.padEmpty}>Move the playhead, then choose “New Pitch Here”.</div>}>
            <For each={zones()}>{(zone) => {
              const times = () => sourceMeta()
                ? timelineJumpingZoneSeconds(zone, sourceMeta()!.sampleRate, duration())
                : { startSeconds: 0, endSeconds: 0 };
              const pitchOptions = () => MIDI_PITCH_OPTIONS.map((option) => ({
                ...option,
                disabled: Number(option.value) !== zone.rootNote
                  && zones().some((candidate) => candidate.rootNote === Number(option.value)),
              }));
              return (
                <div
                  class={styles.padRow}
                  data-selected={selectedZoneId() === zone.id ? "true" : "false"}
                  onPointerDown={() => setSelectedZoneId(zone.id ?? null)}
                >
                  <FloatingSelect
                    className={styles.pitchSelect}
                    layout="bare"
                    value={String(zone.rootNote)}
                    options={pitchOptions()}
                    searchable
                    searchPlaceholder="Find pitch"
                    ariaLabel={`Pitch for ${zone.name ?? "timeline jump"}`}
                    onChange={(value) => patchZone(zone, { rootNote: Number(value) })}
                  />
                  <TextInput
                    class={styles.padName}
                    label="Name"
                    layout="inline"
                    value={zone.name ?? `Pad ${midiPitchLabel(zone.rootNote)}`}
                    onInput={(event) => patchZone(zone, { name: event.currentTarget.value })}
                  />
                  <NumberInput
                    className={styles.timeInput}
                    label="Start"
                    layout="inline"
                    value={Number(times().startSeconds.toFixed(3))}
                    min={0}
                    max={duration()}
                    step={0.01}
                    unit="s"
                    onChange={(value) => patchZone(zone, { startSample: Math.round(value * (sourceMeta()?.sampleRate ?? 44_100)) })}
                  />
                  <NumberInput
                    className={styles.timeInput}
                    label="End"
                    layout="inline"
                    value={Number(times().endSeconds.toFixed(3))}
                    min={0}
                    max={duration()}
                    step={0.01}
                    unit="s"
                    onChange={(value) => patchZone(zone, { endSample: Math.round(value * (sourceMeta()?.sampleRate ?? 44_100)) })}
                  />
                  <Button
                    iconOnly
                    size="xs"
                    selected={auditionZoneId() === zone.id}
                    aria-label={`Audition ${zone.name ?? midiPitchLabel(zone.rootNote)}`}
                    onClick={() => void audition(zone)}
                  >
                    <Icon name={auditionZoneId() === zone.id ? "ph:stop-fill" : "ph:play-fill"} size={18} decorative />
                  </Button>
                  <Button iconOnly size="xs" aria-label={`Remove ${zone.name ?? midiPitchLabel(zone.rootNote)}`} onClick={() => deleteZone(zone)}>
                    <Icon name="ph:x" size={18} decorative />
                  </Button>
                </div>
              );
            }}</For>
          </Show>
        </div>
      </Show>

      <Show when={audioPickerOpen()}>
        <Modal
          open
          title="Choose Timeline Audio"
          width="md"
          onClose={() => setAudioPickerOpen(false)}
          footer={
            <>
              <Button onClick={() => setAudioPickerOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!selectedAudioId()}
                onClick={() => {
                  const file = props.audioFiles.find((candidate) => candidate.id === selectedAudioId());
                  if (file) chooseSource(file);
                }}
              >
                Use Audio
              </Button>
            </>
          }
        >
          <div class={styles.audioPicker}>
            <Show when={props.audioFiles.length > 0} fallback={<div class={styles.padEmpty}>No audio files have been imported yet.</div>}>
              <For each={props.audioFiles}>{(file) => (
                <Button
                  variant="ghost"
                  fullWidth
                  selected={selectedAudioId() === file.id}
                  className={styles.audioPickerRow}
                  onClick={() => setSelectedAudioId(file.id)}
                >
                  <span>{file.name}</span>
                  <span>{formatTimelineSeconds(file.durationSeconds)}</span>
                </Button>
              )}</For>
            </Show>
          </div>
        </Modal>
      </Show>
    </div>
  );
}

function summarizeWaveform(buffer: AudioBuffer, bucketCount: number): WaveformData {
  const peaks = Array.from({ length: bucketCount }, () => 0);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor((bucket / bucketCount) * buffer.length);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) / bucketCount) * buffer.length));
    const stride = Math.max(1, Math.floor((end - start) / 96));
    let peak = 0;
    for (let sample = start; sample < end; sample += stride)
      for (const channel of channels) peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
    peaks[bucket] = peak;
  }
  const max = Math.max(0.0001, ...peaks);
  return {
    peaks: peaks.map((peak) => peak / max),
    durationSeconds: buffer.duration,
    sampleRate: buffer.sampleRate,
    lengthInSamples: buffer.length,
  };
}

function waveformPolygon(peaks: number[]): string | null {
  if (peaks.length === 0) return null;
  const upper = peaks.map((peak, index) => `${(index / Math.max(1, peaks.length - 1)) * 100},${20 - peak * 17}`);
  const lower = peaks.slice().reverse().map((peak, reverseIndex) => {
    const index = peaks.length - 1 - reverseIndex;
    return `${(index / Math.max(1, peaks.length - 1)) * 100},${20 + peak * 17}`;
  });
  return [...upper, ...lower].join(" ");
}
