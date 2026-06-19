import {
  createInstrumentBufferSource,
  createInstrumentCurveBufferSource,
  hasCachedInstrumentSample,
  noteFrequency,
  preloadInstrumentSample,
  primaryInstrumentSampleUrl,
  type SynthAutomationTarget,
  type SynthAutomationLane,
} from "./synthPreview";
import { createSynthWorkletPreviewNode } from "./synthWorkletPreview";
import type { Instrument, MidiAutomationLane, MidiAutomationTarget, MidiNote } from "../state/types";

let ctx: AudioContext | null = null;
interface TimelineAudioHandle {
  node: AudioNode;
  stop: () => void;
}

const activeSources = new Set<TimelineAudioHandle>();
const activeGains = new Set<GainNode>();
let stopToken = 0;

export function getTimelineAudioContext(): AudioContext {
  if (!ctx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

export function primeTimelineAudio() {
  const audio = getTimelineAudioContext();
  if (audio.state === "suspended") void audio.resume();
}

export function stopTimelineAudio() {
  stopToken += 1;
  for (const source of Array.from(activeSources)) {
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
    source.node.disconnect();
  }
  for (const gain of activeGains) gain.disconnect();
  activeSources.clear();
  activeGains.clear();
}

export function scheduleTimelineMidiNote(
  note: MidiNote,
  instrument: Instrument,
  atTimeS: number,
  durationS: number,
  targetNote?: MidiNote,
  bpm = 120,
) {
  const audio = getTimelineAudioContext();
  if (audio.state === "suspended") void audio.resume();

  const baseFrequency = note.frequencyHz ?? noteFrequency(note.pitch, instrument);
  const curve = midiCurveToFrequencies(note, instrument, durationS);
  const automation = midiAutomationToSynthLanes(note, durationS);
  const targetFrequency = targetNote ? targetNote.frequencyHz ?? noteFrequency(targetNote.pitch, instrument) : undefined;
  const playbackDuration = Math.max(0.03, durationS);
  const scheduleToken = stopToken;
  if (!instrument.aether && primaryInstrumentSampleUrl(instrument) && !hasCachedInstrumentSample(instrument)) {
    void preloadInstrumentSample(audio, instrument)
      .then(() => {
        if (scheduleToken !== stopToken) return;
        scheduleBufferSource(
          audio,
          instrument,
          baseFrequency,
          targetFrequency,
          curve,
          automation,
          Math.max(atTimeS, audio.currentTime + 0.001),
          durationS,
          note.velocity,
          bpm,
        );
      })
      .catch(() => undefined);
    return;
  }

  if (instrument.aether) {
    void createSynthWorkletPreviewNode(
      audio,
      instrument,
      durationS + 0.05,
      baseFrequency,
      () => undefined,
      {
        startTimeS: atTimeS,
        targetFrequency,
        curve: curve.length > 1 ? curve : undefined,
        automation,
        bpm,
      },
    )
      .then((worklet) => {
        if (scheduleToken !== stopToken) {
          worklet?.stop();
          return;
        }
        if (worklet) {
          connectScheduledNode(audio, worklet.node, worklet.stop, atTimeS, playbackDuration, note.velocity);
          return;
        }
        scheduleBufferSource(audio, instrument, baseFrequency, targetFrequency, curve, automation, atTimeS, durationS, note.velocity, bpm);
      })
      .catch(() => {
        if (scheduleToken !== stopToken) return;
        scheduleBufferSource(audio, instrument, baseFrequency, targetFrequency, curve, automation, atTimeS, durationS, note.velocity, bpm);
      });
    return;
  }

  scheduleBufferSource(audio, instrument, baseFrequency, targetFrequency, curve, automation, atTimeS, durationS, note.velocity, bpm);
}

function scheduleBufferSource(
  audio: AudioContext,
  instrument: Instrument,
  baseFrequency: number,
  targetFrequency: number | undefined,
  curve: Array<{ timeS: number; frequency: number }>,
  automation: SynthAutomationLane[],
  atTimeS: number,
  durationS: number,
  velocity: number,
  bpm: number,
) {
  const source = curve.length > 1 || automation.length > 0
    ? createInstrumentCurveBufferSource(audio, instrument, durationS + 0.05, baseFrequency, curve, atTimeS, automation, bpm)
    : createInstrumentBufferSource(audio, instrument, durationS + 0.05, baseFrequency, targetFrequency, velocity, bpm);
  const playbackDuration = source.buffer
    ? Math.max(durationS, Math.min(1.5, source.buffer.duration / source.playbackRate.value))
    : durationS;
  connectScheduledNode(
    audio,
    source,
    () => {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    },
    atTimeS,
    playbackDuration,
    velocity,
    source,
  );
}

function connectScheduledNode(
  audio: AudioContext,
  node: AudioNode,
  stop: () => void,
  atTimeS: number,
  playbackDuration: number,
  velocity: number,
  source?: AudioBufferSourceNode,
) {
  const startTimeS = Math.max(atTimeS, audio.currentTime + 0.001);
  const gain = audio.createGain();
  const peak = (velocity / 127) * 0.28;
  const release = Math.min(0.16, playbackDuration * 0.5);
  gain.gain.setValueAtTime(0, startTimeS);
  gain.gain.linearRampToValueAtTime(peak, startTimeS + 0.005);
  gain.gain.setValueAtTime(peak, startTimeS + Math.max(0, playbackDuration - release));
  gain.gain.linearRampToValueAtTime(0, startTimeS + playbackDuration);
  gain.connect(audio.destination);

  node.connect(gain);
  const handle: TimelineAudioHandle = { node, stop };
  const cleanup = () => {
    activeSources.delete(handle);
    activeGains.delete(gain);
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      gain.disconnect();
    } catch {
      // Already disconnected.
    }
  };
  if (source) {
    source.onended = cleanup;
    source.start(startTimeS);
    source.stop(startTimeS + playbackDuration + 0.05);
  } else {
    window.setTimeout(cleanup, Math.ceil((startTimeS - audio.currentTime + playbackDuration + 0.1) * 1000));
  }
  activeSources.add(handle);
  activeGains.add(gain);
}

function midiCurveToFrequencies(note: MidiNote, instrument: Instrument, durationS: number): Array<{ timeS: number; frequency: number }> {
  if (!note.curve || note.curve.length < 2 || note.lengthBeats <= 0) return [];
  const beatStart = note.startBeat;
  const beatEnd = note.startBeat + note.lengthBeats;
  return note.curve
    .filter((point) => point.beat >= beatStart && point.beat <= beatEnd)
    .map((point) => ({
      timeS: ((point.beat - beatStart) / Math.max(0.001, note.lengthBeats)) * durationS,
      frequency: noteFrequency(point.pitch, instrument),
    }));
}

function midiAutomationToSynthLanes(note: MidiNote, durationS: number): SynthAutomationLane[] {
  if (!note.automation?.length || note.lengthBeats <= 0) return [];
  return note.automation
    .filter((lane): lane is MidiAutomationLane & { target: SynthAutomationTarget } => isSynthAutomationTarget(lane.target) && Array.isArray(lane.points) && lane.points.length > 0)
    .map((lane) => ({
      target: lane.target,
      points: lane.points
        .filter((point) => point.beat >= note.startBeat && point.beat <= note.startBeat + note.lengthBeats)
        .map((point) => ({
          timeS: ((point.beat - note.startBeat) / Math.max(0.001, note.lengthBeats)) * durationS,
          value: point.value,
        })),
    }))
    .filter((lane) => lane.points.length > 0);
}

function isSynthAutomationTarget(target: MidiAutomationTarget): target is SynthAutomationTarget {
  return target !== "pitch";
}
