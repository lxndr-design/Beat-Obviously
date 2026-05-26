import { useEffect, useRef, useState } from "react";
import { Button, Icon, HoverInfo } from "../../components";
import { createInstrumentBufferSource, noteFrequency } from "../../audio/synthPreview";
import { useContextualHotkey } from "../../hotkeys/contextualHotkeys";
import type { Instrument, MidiNote } from "../../state/types";

export interface MidiTransportProps {
  notes: MidiNote[];
  lengthBeats: number;
  bpm: number;
  /** Optional bound instrument — its waveform is used by the in-modal synth. */
  instrument?: Instrument;
  hotkeyScopeId?: string;
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
export function MidiTransport({ notes, lengthBeats, bpm, instrument, hotkeyScopeId }: MidiTransportProps) {
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const startMsRef = useRef<number | null>(null);
  const startBeatRef = useRef<number>(0);
  const positionBeatRef = useRef<number>(0);
  const scheduledRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number | null>(null);

  function getCtx(): AudioContext {
    if (!ctxRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      ctxRef.current = new Ctor();
    }
    return ctxRef.current;
  }

  function scheduleNote(n: MidiNote, atTimeS: number, durS: number, vel: number) {
    const ctx = getCtx();
    const gain = ctx.createGain();
    const synth = instrument ?? fallbackInstrument;

    const peak = (vel / 127) * 0.3;
    const release = Math.min(0.2, durS * 0.5);
    gain.gain.setValueAtTime(0, atTimeS);
    gain.gain.linearRampToValueAtTime(peak, atTimeS + 0.005);
    gain.gain.setValueAtTime(peak, atTimeS + Math.max(0, durS - release));
    gain.gain.linearRampToValueAtTime(0, atTimeS + durS);
    gain.connect(ctx.destination);

    const source = createInstrumentBufferSource(ctx, synth, durS + 0.05, noteFrequency(n.pitch, synth));
    source.connect(gain);
    source.start(atTimeS);
    source.stop(atTimeS + durS + 0.05);
  }

  function play() {
    const ctx = getCtx();
    if (ctx.state === "suspended") void ctx.resume();
    startMsRef.current = performance.now();
    startBeatRef.current = positionBeatRef.current;
    scheduledRef.current.clear();
    setPlaying(true);
  }
  function pause() {
    setPlaying(false);
  }
  function restart() {
    positionBeatRef.current = 0;
    startMsRef.current = performance.now();
    startBeatRef.current = 0;
    scheduledRef.current.clear();
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

      // Schedule any not-yet-scheduled notes whose start is within ~250ms.
      const ctx = getCtx();
      const lookaheadBeats = (0.25 * beatsPerSec);
      for (const n of notes) {
        const key = `${n.pitch}:${n.startBeat}:${n.lengthBeats}`;
        if (scheduledRef.current.has(key)) continue;
        if (n.startBeat >= pos && n.startBeat <= pos + lookaheadBeats) {
          const noteDelaySec = (n.startBeat - pos) / beatsPerSec;
          const durSec = n.lengthBeats / beatsPerSec;
          scheduleNote(n, ctx.currentTime + noteDelaySec, durSec, n.velocity);
          scheduledRef.current.add(key);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, notes, lengthBeats, bpm, instrument]);

  // Stop the audio context when the modal closes.
  useEffect(
    () => () => {
      if (ctxRef.current) void ctxRef.current.close();
    },
    [],
  );

  return (
    <div style={{ display: "inline-flex", gap: 8 }}>
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
