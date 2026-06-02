import { useEffect, useRef, useState } from "react";
import { Button, Icon, HoverInfo } from "../../components";
import { createInstrumentBufferSource, createInstrumentCurveBufferSource, noteFrequency, type SynthAutomationLane, type SynthAutomationTarget } from "../../audio/synthPreview";
import { createSynthWorkletPreviewNode } from "../../audio/synthWorkletPreview";
import { useContextualHotkey } from "../../hotkeys/contextualHotkeys";
import type { Instrument, MidiAutomationLane, MidiAutomationTarget, MidiNote } from "../../state/types";
import styles from "./MidiTransport.module.css";

export interface MidiTransportProps {
  notes: MidiNote[];
  lengthBeats: number;
  bpm: number;
  /** Optional bound instrument — its waveform is used by the in-modal synth. */
  instrument?: Instrument;
  hotkeyScopeId?: string;
  onPositionChange?: (beat: number | null) => void;
}

/**
 * MidiTransport — in-modal playback for the segment.
 *
 *   - Auto-loops the segment.
 *   - Schedules notes via WebAudio (single oscillator per active note +
 *     gain envelope). Good enough for a preview; the real audio engine
 *     replaces this when wired through IPC.
 *   - Play / Pause / Restart buttons.
 */
export function MidiTransport({ notes, lengthBeats, bpm, instrument, hotkeyScopeId, onPositionChange }: MidiTransportProps) {
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const startMsRef = useRef<number | null>(null);
  const startBeatRef = useRef<number>(0);
  const positionBeatRef = useRef<number>(0);
  const scheduledRef = useRef<Set<string>>(new Set());
  const activeSourcesRef = useRef<Set<PreviewAudioHandle>>(new Set());
  const activeGainsRef = useRef<Set<GainNode>>(new Set());
  const stopTokenRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  function getCtx(): AudioContext {
    if (!ctxRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      ctxRef.current = new Ctor();
    }
    return ctxRef.current;
  }

  function scheduleNote(n: MidiNote, atTimeS: number, durS: number, vel: number, target?: MidiNote) {
    const ctx = getCtx();
    const synth = instrument ?? fallbackInstrument;
    const frequency = n.frequencyHz ?? noteFrequency(n.pitch, synth);
    const targetFrequency = target ? target.frequencyHz ?? noteFrequency(target.pitch, synth) : undefined;
    const curve = midiCurveToFrequencies(n, synth, durS);
    const automation = midiAutomationToSynthLanes(n, durS);

    if (synth.aether) {
      const scheduleToken = stopTokenRef.current;
      void createSynthWorkletPreviewNode(
        ctx,
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
          if (scheduleToken !== stopTokenRef.current) {
            worklet?.stop();
            return;
          }
          if (worklet) {
            connectPreviewNode(ctx, worklet.node, worklet.stop, atTimeS, durS, vel);
            return;
          }
          scheduleBufferPreview(ctx, synth, frequency, targetFrequency, curve, automation, atTimeS, durS, vel);
        })
        .catch(() => {
          if (scheduleToken !== stopTokenRef.current) return;
          scheduleBufferPreview(ctx, synth, frequency, targetFrequency, curve, automation, atTimeS, durS, vel);
        });
      return;
    }

    scheduleBufferPreview(ctx, synth, frequency, targetFrequency, curve, automation, atTimeS, durS, vel);
  }

  function scheduleBufferPreview(
    ctx: AudioContext,
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
      ? createInstrumentCurveBufferSource(ctx, synth, durS + 0.05, frequency, curve, atTimeS, automation)
      : createInstrumentBufferSource(ctx, synth, durS + 0.05, frequency, targetFrequency, vel);
    connectPreviewNode(
      ctx,
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
    ctx: AudioContext,
    node: AudioNode,
    stop: () => void,
    atTimeS: number,
    durS: number,
    vel: number,
    source?: AudioBufferSourceNode,
  ) {
    const startTimeS = Math.max(atTimeS, ctx.currentTime + 0.001);
    const gain = ctx.createGain();
    const peak = (vel / 127) * 0.3;
    const release = Math.min(0.2, durS * 0.5);
    gain.gain.setValueAtTime(0, startTimeS);
    gain.gain.linearRampToValueAtTime(peak, startTimeS + 0.005);
    gain.gain.setValueAtTime(peak, startTimeS + Math.max(0, durS - release));
    gain.gain.linearRampToValueAtTime(0, startTimeS + durS);
    gain.connect(ctx.destination);

    const handle: PreviewAudioHandle = { node, stop };
    const cleanup = () => {
      activeSourcesRef.current.delete(handle);
      activeGainsRef.current.delete(gain);
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
    activeSourcesRef.current.add(handle);
    activeGainsRef.current.add(gain);
    if (source) {
      source.onended = cleanup;
      source.start(startTimeS);
      source.stop(startTimeS + durS + 0.05);
    } else {
      window.setTimeout(cleanup, Math.ceil((startTimeS - ctx.currentTime + durS + 0.1) * 1000));
    }
  }

  function stopPreviewAudio() {
    stopTokenRef.current += 1;
    for (const source of Array.from(activeSourcesRef.current)) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.node.disconnect();
    }
    for (const gain of activeGainsRef.current) gain.disconnect();
    activeSourcesRef.current.clear();
    activeGainsRef.current.clear();
  }

  function play() {
    const ctx = getCtx();
    if (ctx.state === "suspended") void ctx.resume();
    startMsRef.current = performance.now();
    startBeatRef.current = positionBeatRef.current;
    scheduledRef.current.clear();
    onPositionChange?.(positionBeatRef.current);
    setPlaying(true);
  }
  function pause() {
    setPlaying(false);
    stopPreviewAudio();
    onPositionChange?.(null);
  }
  function restart() {
    positionBeatRef.current = 0;
    stopPreviewAudio();
    startMsRef.current = performance.now();
    startBeatRef.current = 0;
    scheduledRef.current.clear();
    onPositionChange?.(0);
    setPlaying(true);
  }

  useContextualHotkey(
    hotkeyScopeId ?? "",
    "space",
    () => {
      if (playing) pause();
      else play();
    },
    Boolean(hotkeyScopeId),
  );

  // Animation loop: advance playhead, schedule notes shortly before they
  // should sound, loop at end.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      onPositionChange?.(null);
      return;
    }
    function tick() {
      const now = performance.now();
      const elapsedSec = (now - (startMsRef.current ?? now)) / 1000;
      const beatsPerSec = bpm / 60;
      let pos = startBeatRef.current + elapsedSec * beatsPerSec;
      if (pos >= lengthBeats) {
        // Loop — reset the timing baseline.
        startMsRef.current = now;
        startBeatRef.current = 0;
        scheduledRef.current.clear();
        pos = 0;
      }
      positionBeatRef.current = pos;
      onPositionChange?.(pos);

      // Schedule any not-yet-scheduled notes whose start is within ~250ms.
      const ctx = getCtx();
      const lookaheadBeats = (0.25 * beatsPerSec);
      notes.forEach((n, index) => {
        const key = `${n.pitch}:${n.startBeat}:${n.lengthBeats}`;
        if (scheduledRef.current.has(key)) return;
        if (n.startBeat >= pos && n.startBeat <= pos + lookaheadBeats) {
          const target = connectedLaterNote(notes, index);
          const noteDelaySec = (n.startBeat - pos) / beatsPerSec;
          const durBeats = target ? Math.max(0.03, target.startBeat - n.startBeat) : n.lengthBeats;
          const durSec = durBeats / beatsPerSec;
          scheduleNote(n, ctx.currentTime + noteDelaySec, durSec, n.velocity, target);
          scheduledRef.current.add(key);
        }
      });

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, notes, lengthBeats, bpm, instrument, onPositionChange]);

  // Stop the audio context when the modal closes.
  useEffect(
    () => () => {
      stopPreviewAudio();
      if (ctxRef.current) void ctxRef.current.close();
    },
    [],
  );

  return (
    <div className={styles.controls}>
      <HoverInfo content="Restart">
        <Button iconOnly size="xs" onClick={restart} aria-label="Restart">
          <Icon name="ph:skip-back-fill" size={16} decorative />
        </Button>
      </HoverInfo>
      <HoverInfo content={playing ? "Pause" : "Play"}>
        <Button
          iconOnly
          size="xs"
          variant={playing ? "primary" : "default"}
          onClick={playing ? pause : play}
          aria-label={playing ? "Pause" : "Play"}
        >
          <Icon name={playing ? "ph:pause-fill" : "ph:play-fill"} size={16} decorative />
        </Button>
      </HoverInfo>
    </div>
  );
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
