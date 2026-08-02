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
import { registerGlobalAudioStop, stopAllBrowserAudio } from "../../audio/globalAudioSafety";
import { pauseTransport } from "../../audio/transportActions";
import { useContextualHotkeyStore } from "../../hotkeys/contextualHotkeys";
import { isNative, send } from "../../ipc/bridge";
import { useTransportStore } from "../../state/store";
import { renderMidiArpeggiations } from "../../state/midiNoteGroups";
import type { Instrument, MidiAutomationLane, MidiAutomationTarget, MidiNote } from "../../state/types";
import styles from "./MidiTransport.module.css";

export interface MidiTransportProps {
  notes: MidiNote[];
  gainDb?: number;
  lengthBeats: number;
  bpm: number;
  instrument?: Instrument;
  trackId?: string;
  transpose?: number;
  hotkeyScopeId?: string;
  captureSpaceKey?: boolean;
  onPositionChange?: (beat: number | null) => void;
}

export function MidiTransport(props: MidiTransportProps) {
  return <MidiTransportRuntime state={() => props} />;
}

function MidiTransportRuntime(props: { state: Accessor<MidiTransportProps> }) {
  onCleanup(registerGlobalAudioStop(stopPlayback));
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
  let playbackStateSignature = "";

  function getCtx(): AudioContext {
    if (!ctx) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      ctx = new Ctor();
    }
    return ctx;
  }

  function usesNativeTrackPreview(): boolean {
    const latest = props.state();
    return isNative() && Boolean(latest.trackId && latest.instrument?.id);
  }

  function scheduleNote(note: MidiNote, delayS: number, durS: number, vel: number, target?: MidiNote, forceBrowser = false) {
    const synth = props.state().instrument ?? fallbackInstrument;
    const transpose = props.state().transpose ?? 0;
    const previewNote = transposeMidiNote(note, transpose);
    if (usesNativeTrackPreview() && !forceBrowser) {
      const latest = props.state();
      const requestToken = stopToken;
      const requestStartedMs = performance.now();
      void send({
        kind: "engine.previewMidiNote",
        trackId: latest.trackId!,
        instrumentId: synth.id,
        pitch: previewNote.pitch,
        velocity: Math.round(vel),
        delaySeconds: Math.max(0, delayS),
        durationSeconds: Math.max(0.01, durS),
        note: previewNote,
        gainDb: latest.gainDb ?? 0,
        glideTargetPitch: target ? Math.max(0, Math.min(127, target.pitch + transpose)) : undefined,
        glideMs: synth.glideMs ?? 0,
      })
        .then((accepted) => {
          if (accepted !== false || requestToken !== stopToken) return;
          const elapsedS = (performance.now() - requestStartedMs) / 1000;
          scheduleNote(note, Math.max(0, delayS - elapsedS), durS, vel, target, true);
        })
        .catch(() => {
          if (requestToken !== stopToken) return;
          const elapsedS = (performance.now() - requestStartedMs) / 1000;
          scheduleNote(note, Math.max(0, delayS - elapsedS), durS, vel, target, true);
        });
      return;
    }

    const audioCtx = getCtx();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const atTimeS = audioCtx.currentTime + delayS;
    const frequency = note.frequencyHz ?? noteFrequency(previewNote.pitch, synth);
    const targetPitch = target ? Math.max(0, Math.min(127, target.pitch + transpose)) : undefined;
    const targetFrequency = target ? target.frequencyHz ?? noteFrequency(targetPitch!, synth) : undefined;
    const curve = midiCurveToFrequencies(note, synth, durS, transpose);
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
          bpm: props.state().bpm,
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
          scheduleBufferPreview(audioCtx, synth, frequency, targetFrequency, curve, automation, atTimeS, durS, vel, {
            sampleZoneId: note.sampleZoneId,
            samplePath: note.samplePath,
          });
        })
        .catch(() => {
          if (scheduleToken !== stopToken) return;
          scheduleBufferPreview(audioCtx, synth, frequency, targetFrequency, curve, automation, atTimeS, durS, vel, {
            sampleZoneId: note.sampleZoneId,
            samplePath: note.samplePath,
          });
        });
      return;
    }

    scheduleBufferPreview(audioCtx, synth, frequency, targetFrequency, curve, automation, atTimeS, durS, vel, {
      sampleZoneId: note.sampleZoneId,
      samplePath: note.samplePath,
    });
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
    sampleSelection?: { sampleZoneId?: string; samplePath?: string },
  ) {
    const source = curve.length > 1 || automation.length > 0
      ? createInstrumentCurveBufferSource(audioCtx, synth, durS + 0.05, frequency, curve, atTimeS, automation, props.state().bpm, vel, sampleSelection)
      : createInstrumentBufferSource(audioCtx, synth, durS + 0.05, frequency, targetFrequency, vel, props.state().bpm, sampleSelection);
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
    const latest = props.state();
    if (isNative() && latest.trackId)
      void send({ kind: "engine.stopMidiPreview", trackId: latest.trackId });
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

  function stopPlayback() {
    setPlaying(false);
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    stopPreviewAudio();
    props.state().onPositionChange?.(null);
  }

  function prepareExclusivePreview() {
    if (useTransportStore.getState().playing) pauseTransport();
    else stopAllBrowserAudio();
  }

  function play() {
    prepareExclusivePreview();
    if (!usesNativeTrackPreview()) {
      const audioCtx = getCtx();
      if (audioCtx.state === "suspended") void audioCtx.resume();
    }
    startMs = performance.now();
    startBeat = positionBeat;
    scheduled = new Set();
    props.state().onPositionChange?.(positionBeat);
    setPlaying(true);
  }

  function pause() {
    setPlaying(false);
    stopPreviewAudio();
    props.state().onPositionChange?.(positionBeat);
  }

  function restart() {
    prepareExclusivePreview();
    positionBeat = 0;
    stopPreviewAudio();
    startMs = performance.now();
    startBeat = 0;
    scheduled = new Set();
    props.state().onPositionChange?.(0);
    setPlaying(true);
  }

  function togglePlayback() {
    if (playing()) pause();
    else play();
  }

  createEffect(() => {
    const scopeId = props.state().hotkeyScopeId ?? "";
    if (!scopeId) return;
    useContextualHotkeyStore.getState().register(scopeId, "space", togglePlayback);
    onCleanup(() => useContextualHotkeyStore.getState().unregister(scopeId, "space"));
  });

  createEffect(() => {
    const latest = props.state();
    const signature = JSON.stringify({
      notes: latest.notes,
      lengthBeats: latest.lengthBeats,
      bpm: latest.bpm,
      instrumentId: latest.instrument?.id ?? "",
      transpose: latest.transpose ?? 0,
      gainDb: latest.gainDb ?? 0,
    });
    if (!playbackStateSignature) {
      playbackStateSignature = signature;
      return;
    }
    if (signature === playbackStateSignature) return;
    playbackStateSignature = signature;
    if (!playing()) return;
    positionBeat = Math.max(0, Math.min(positionBeat, Math.max(0, latest.lengthBeats - 0.000001)));
    stopPreviewAudio();
    scheduled.clear();
    startMs = performance.now();
    startBeat = positionBeat;
    latest.onPositionChange?.(positionBeat);
  });

  createEffect(() => {
    if (!props.state().captureSpaceKey) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== " " && event.key !== "Space" && event.key !== "Spacebar") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      togglePlayback();
    }
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));
  });

  createEffect(() => {
    if (!playing()) {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      return;
    }

    function tick() {
      const latest = props.state();
      const now = performance.now();
      const elapsedSec = (now - (startMs ?? now)) / 1000;
      const beatsPerSec = latest.bpm / 60;
      let pos = startBeat + elapsedSec * beatsPerSec;
      if (pos >= latest.lengthBeats) {
        stopPreviewAudio();
        startMs = now;
        startBeat = 0;
        scheduled.clear();
        pos = 0;
      }
      positionBeat = pos;
      latest.onPositionChange?.(pos);

      const lookaheadBeats = 0.25 * beatsPerSec;
      const previewNotes = renderMidiArpeggiations(latest.notes);
      previewNotes.forEach((note, index) => {
        const key = midiPreviewScheduleKey(note, index);
        if (scheduled.has(key)) return;
        if (note.startBeat >= pos && note.startBeat <= pos + lookaheadBeats) {
          const target = connectedLaterNote(previewNotes, index);
          const noteDelaySec = (note.startBeat - pos) / beatsPerSec;
          const durBeats = target ? Math.max(0.03, target.startBeat - note.startBeat) : note.lengthBeats;
          const durSec = durBeats / beatsPerSec;
          scheduleNote(note, noteDelaySec, durSec, applyGainToVelocity(note.velocity, latest.gainDb ?? 0), target);
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
    props.state().onPositionChange?.(null);
    if (ctx) void ctx.close();
  });

  return (
    <div class={styles.controls}>
      <HoverInfo content="Play from start">
        <Button iconOnly size="xs" onClick={restart} aria-label="Play from start">
          <Icon name="ph:skip-back-fill" size={18} decorative />
        </Button>
      </HoverInfo>
      <HoverInfo content={playing() ? "Pause" : "Play"}>
        <Button
          iconOnly
          size="xs"
          variant={playing() ? "primary" : "default"}
          onClick={togglePlayback}
          aria-label={playing() ? "Pause" : "Play"}
        >
          <Icon name={playing() ? "ph:pause-fill" : "ph:play-fill"} size={18} decorative />
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
  const target = note.connectToIndex == null ? undefined : notes[note.connectToIndex];
  if (!target || target.startBeat <= note.startBeat) return undefined;
  return target;
}

function midiCurveToFrequencies(note: MidiNote, instrument: Instrument, durationS: number, transpose = 0): Array<{ timeS: number; frequency: number }> {
  if (!note.curve || note.curve.length < 2 || note.lengthBeats <= 0) return [];
  const beatStart = note.startBeat;
  const beatEnd = note.startBeat + note.lengthBeats;
  return note.curve
    .filter((point) => point.beat >= beatStart && point.beat <= beatEnd)
    .map((point) => ({
      timeS: ((point.beat - beatStart) / Math.max(0.001, note.lengthBeats)) * durationS,
      frequency: noteFrequency(Math.max(0, Math.min(127, point.pitch + transpose)), instrument),
    }));
}

export function midiPreviewScheduleKey(note: MidiNote, index: number): string {
  return `${index}:${note.pitch}:${note.startBeat}:${note.lengthBeats}`;
}

export function transposeMidiNote(note: MidiNote, transpose: number): MidiNote {
  if (!transpose) return { ...note };
  return {
    ...note,
    pitch: Math.max(0, Math.min(127, note.pitch + transpose)),
    curve: note.curve?.map((point) => ({
      ...point,
      pitch: Math.max(0, Math.min(127, point.pitch + transpose)),
    })),
  };
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
          curve: point.curve,
        })),
    }))
    .filter((lane) => lane.points.length > 0);
}

function isSynthAutomationTarget(target: MidiAutomationTarget): target is Exclude<MidiAutomationTarget, "pitch"> {
  return target !== "pitch";
}
