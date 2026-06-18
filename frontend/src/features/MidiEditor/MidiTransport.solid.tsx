import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { Button, HoverInfo, Icon } from "../../solid-ui";
import {
  createInstrumentBufferSource,
  createInstrumentCurveBufferSource,
  noteFrequency,
  type SynthAutomationLane,
  type SynthAutomationTarget,
} from "../../audio/synthPreview";
import { createSynthWorkletPreviewNode } from "../../audio/synthWorkletPreview";
import { useContextualHotkeyStore } from "../../hotkeys/contextualHotkeys";
import type { Instrument, MidiAutomationLane, MidiAutomationTarget, MidiNote } from "../../state/types";
import styles from "./MidiTransport.module.css";

export interface MidiTransportProps {
  notes: MidiNote[];
  gainDb?: number;
  lengthBeats: number;
  bpm: number;
  instrument?: Instrument;
  hotkeyScopeId?: string;
  onPositionChange?: (beat: number | null) => void;
}

export function MidiTransportSolid(props: MidiTransportProps) {
  return <MidiTransportSolidRuntime state={() => props} />;
}

function MidiTransportSolidRuntime(props: { state: Accessor<MidiTransportProps> }) {
  const [playing, setPlaying] = createSignal(false);
  let ctx: AudioContext | null = null;
  let startMs: number | null = null;
  let startBeat = 0;
  let positionBeat = 0;
  let scheduled = new Set<string>();
  let activeSources = new Set<PreviewAudioHandle>();
  let activeGains = new Set<GainNode>();
  let stopToken = 0;
  let raf: number | null = null;

  function getCtx(): AudioContext {
    if (!ctx) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      ctx = new Ctor();
    }
    return ctx;
  }

  function scheduleNote(note: MidiNote, atTimeS: number, durS: number, vel: number, target?: MidiNote) {
    const audioCtx = getCtx();
    const synth = props.state().instrument ?? fallbackInstrument;
    const frequency = note.frequencyHz ?? noteFrequency(note.pitch, synth);
    const targetFrequency = target ? target.frequencyHz ?? noteFrequency(target.pitch, synth) : undefined;
    const curve = midiCurveToFrequencies(note, synth, durS);
    const automation = midiAutomationToSynthLanes(note, durS);

    if (synth.aether) {
      const scheduleToken = stopToken;
      void createSynthWorkletPreviewNode(
        audioCtx,
        synth,
        durS + 0.05,
        frequency,
        () => undefined,
        {
          startTimeS: atTimeS,
          targetFrequency,
          curve: curve.length > 1 ? curve : undefined,
          automation,
        },
      )
        .then((worklet) => {
          if (scheduleToken !== stopToken) {
            worklet?.stop();
            return;
          }
          if (worklet) {
            connectPreviewNode(audioCtx, worklet.node, worklet.stop, atTimeS, durS, vel);
            return;
          }
          scheduleBufferPreview(audioCtx, synth, frequency, targetFrequency, curve, automation, atTimeS, durS, vel);
        })
        .catch(() => {
          if (scheduleToken !== stopToken) return;
          scheduleBufferPreview(audioCtx, synth, frequency, targetFrequency, curve, automation, atTimeS, durS, vel);
        });
      return;
    }

    scheduleBufferPreview(audioCtx, synth, frequency, targetFrequency, curve, automation, atTimeS, durS, vel);
  }

  function scheduleBufferPreview(
    audioCtx: AudioContext,
    synth: Instrument,
    frequency: number,
    targetFrequency: number | undefined,
    curve: Array<{ timeS: number; frequency: number }>,
    automation: SynthAutomationLane[],
    atTimeS: number,
    durS: number,
    vel: number,
  ) {
    const source = curve.length > 1 || automation.length > 0
      ? createInstrumentCurveBufferSource(audioCtx, synth, durS + 0.05, frequency, curve, atTimeS, automation)
      : createInstrumentBufferSource(audioCtx, synth, durS + 0.05, frequency, targetFrequency, vel);
    connectPreviewNode(
      audioCtx,
      source,
      () => {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      },
      atTimeS,
      durS,
      vel,
      source,
    );
  }

  function connectPreviewNode(
    audioCtx: AudioContext,
    node: AudioNode,
    stop: () => void,
    atTimeS: number,
    durS: number,
    vel: number,
    source?: AudioBufferSourceNode,
  ) {
    const startTimeS = Math.max(atTimeS, audioCtx.currentTime + 0.001);
    const gain = audioCtx.createGain();
    const peak = (vel / 127) * 0.3;
    const release = Math.min(0.2, durS * 0.5);
    gain.gain.setValueAtTime(0, startTimeS);
    gain.gain.linearRampToValueAtTime(peak, startTimeS + 0.005);
    gain.gain.setValueAtTime(peak, startTimeS + Math.max(0, durS - release));
    gain.gain.linearRampToValueAtTime(0, startTimeS + durS);
    gain.connect(audioCtx.destination);

    const handle: PreviewAudioHandle = { node, stop };
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

    node.connect(gain);
    activeSources.add(handle);
    activeGains.add(gain);
    if (source) {
      source.onended = cleanup;
      source.start(startTimeS);
      source.stop(startTimeS + durS + 0.05);
    } else {
      window.setTimeout(cleanup, Math.ceil((startTimeS - audioCtx.currentTime + durS + 0.1) * 1000));
    }
  }

  function stopPreviewAudio() {
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

  function play() {
    const audioCtx = getCtx();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    startMs = performance.now();
    startBeat = positionBeat;
    scheduled = new Set();
    props.state().onPositionChange?.(positionBeat);
    setPlaying(true);
  }

  function pause() {
    setPlaying(false);
    stopPreviewAudio();
    props.state().onPositionChange?.(null);
  }

  function restart() {
    positionBeat = 0;
    stopPreviewAudio();
    startMs = performance.now();
    startBeat = 0;
    scheduled = new Set();
    props.state().onPositionChange?.(0);
    setPlaying(true);
  }

  createEffect(() => {
    const scopeId = props.state().hotkeyScopeId ?? "";
    if (!scopeId) return;
    const handler = () => {
      if (playing()) pause();
      else play();
    };
    useContextualHotkeyStore.getState().register(scopeId, "space", handler);
    onCleanup(() => useContextualHotkeyStore.getState().unregister(scopeId, "space"));
  });

  createEffect(() => {
    const state = props.state();
    if (!playing()) {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      state.onPositionChange?.(null);
      return;
    }

    function tick() {
      const latest = props.state();
      const now = performance.now();
      const elapsedSec = (now - (startMs ?? now)) / 1000;
      const beatsPerSec = latest.bpm / 60;
      let pos = startBeat + elapsedSec * beatsPerSec;
      if (pos >= latest.lengthBeats) {
        startMs = now;
        startBeat = 0;
        scheduled.clear();
        pos = 0;
      }
      positionBeat = pos;
      latest.onPositionChange?.(pos);

      const audioCtx = getCtx();
      const lookaheadBeats = 0.25 * beatsPerSec;
      latest.notes.forEach((note, index) => {
        const key = `${note.pitch}:${note.startBeat}:${note.lengthBeats}`;
        if (scheduled.has(key)) return;
        if (note.startBeat >= pos && note.startBeat <= pos + lookaheadBeats) {
          const target = connectedLaterNote(latest.notes, index);
          const noteDelaySec = (note.startBeat - pos) / beatsPerSec;
          const durBeats = target ? Math.max(0.03, target.startBeat - note.startBeat) : note.lengthBeats;
          const durSec = durBeats / beatsPerSec;
          scheduleNote(note, audioCtx.currentTime + noteDelaySec, durSec, applyGainToVelocity(note.velocity, latest.gainDb ?? 0), target);
          scheduled.add(key);
        }
      });

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    onCleanup(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    });
  });

  onCleanup(() => {
    stopPreviewAudio();
    if (ctx) void ctx.close();
  });

  return (
    <div class={styles.controls}>
      <HoverInfo content="Play from start">
        <Button iconOnly size="xs" onClick={restart} aria-label="Play from start">
          <Icon name="ph:skip-back-fill" size={16} decorative />
        </Button>
      </HoverInfo>
      <HoverInfo content={playing() ? "Pause" : "Play"}>
        <Button
          iconOnly
          size="xs"
          variant={playing() ? "primary" : "default"}
          onClick={playing() ? pause : play}
          aria-label={playing() ? "Pause" : "Play"}
        >
          <Icon name={playing() ? "ph:pause-fill" : "ph:play-fill"} size={16} decorative />
        </Button>
      </HoverInfo>
    </div>
  );
}

function applyGainToVelocity(velocity: number, gainDb: number): number {
  const gain = Math.pow(10, Math.max(-96, Math.min(24, gainDb)) / 20);
  return Math.max(0, Math.min(127, velocity * gain));
}

interface PreviewAudioHandle {
  node: AudioNode;
  stop: () => void;
}

const fallbackInstrument: Instrument = {
  id: "preview-fallback",
  name: "Preview",
  kind: "synth",
  envelope: { attackMs: 5, decayMs: 100, sustain: 0.7, releaseMs: 200 },
  knobs: { cutoff: 0.75, resonance: 0, drive: 0, color: 0.5 },
  waveform: "saw",
  detuneCents: 0,
  octave: 0,
  subOscLevel: 0,
  glideMs: 0,
  sampleIds: [],
  userCreated: false,
};

function connectedLaterNote(notes: MidiNote[], index: number): MidiNote | undefined {
  const note = notes[index];
  const direct = note.connectToIndex == null ? undefined : notes[note.connectToIndex];
  const incoming = notes.find((candidate) => candidate.connectToIndex === index);
  const target = [direct, incoming]
    .filter((candidate): candidate is MidiNote => Boolean(candidate))
    .sort((a, b) => a.startBeat - b.startBeat)[0];
  if (!target || target.startBeat <= note.startBeat) return undefined;
  return target;
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
