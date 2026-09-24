import { createEffect, onCleanup, untrack } from "solid-js";
import { createStoreSelector } from "../solid-utils/store";
import { useInstrumentStore, useProjectStore, useTransportStore, useUiStore } from "../state/store";
import { useSynthStore } from "../state/synthStore";
import { expandTrackSegments, isTrackAudible, trackGainDbIncludingParents } from "../state/selectors";
import { isNative } from "../ipc/bridge";
import { getTimelineAudioContext, scheduleTimelineMidiNote, stopTimelineAudio } from "./timelineAudio";
import { useAnalyzerStore } from "../state/analyzerStore";
import type { Instrument, MidiNote } from "../state/types";
import { compileSegmentEvents, eventsStartingInBeatWindow } from "../state/segmentEventCompiler";

const LOOKAHEAD_SECONDS = 0.12;

const fallbackInstrument: Instrument = {
  id: "timeline-fallback",
  name: "Timeline Preview",
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

export function TimelineMidiPlayback() {
  if (isNative()) return null;

  const playing = createStoreSelector(useTransportStore, (s) => s.playing);
  const positionBeat = createStoreSelector(useTransportStore, (s) => s.positionBeat);
  const speed = createStoreSelector(useTransportStore, (s) => s.speed);
  const project = createStoreSelector(useProjectStore, (s) => s.project);
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const scheduled = new Set<string>();
  const expressionTimers = new Set<number>();
  const activeExpressionNotes = new Map<string, Map<string, { velocity: number; keytrack: number }>>();
  let raf: number | null = null;
  let lastPlaying = false;
  let lastPosition = positionBeat();

  createEffect(() => {
    const currentPlaying = playing();
    const currentPosition = untrack(positionBeat);
    speed();
    project();
    instruments();

    if (!currentPlaying) {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      scheduled.clear();
      clearExpressionPlaybackState();
      lastPlaying = false;
      lastPosition = currentPosition;
      stopTimelineAudio();
      return;
    }

    if (!lastPlaying || currentPosition < lastPosition) {
      scheduled.clear();
      clearExpressionPlaybackState();
      stopTimelineAudio();
    }
    lastPlaying = true;
    lastPosition = currentPosition;

    function tick() {
      const transport = useTransportStore.getState();
      if (!transport.playing) {
        stopTimelineAudio();
        return;
      }

      const audio = getTimelineAudioContext();
      const { bpm, lengthBeats, tracks } = useProjectStore.getState().project;
      const currentInstruments = useInstrumentStore.getState().instruments;
      const beatsPerSecond = (bpm / 60) * transport.speed;
      const lookaheadBeats = LOOKAHEAD_SECONDS * beatsPerSecond;
      const currentBeat = transport.positionBeat;
      const trackMeters: Array<{
        id: string;
        rms: number;
        peak: number;
        leftRms: number;
        rightRms: number;
        leftPeak: number;
        rightPeak: number;
      }> = [];

      if (currentBeat < lastPosition || currentBeat > lengthBeats - 0.01) {
        scheduled.clear();
        clearExpressionPlaybackState();
      }
      lastPosition = currentBeat;

      for (const track of tracks) {
        if (!isTrackAudible(track)) {
          trackMeters.push({ id: track.id, peak: 0, rms: 0, leftPeak: 0, rightPeak: 0, leftRms: 0, rightRms: 0 });
          continue;
        }
        let trackPeak = 0;
        const occurrences = expandTrackSegments(track, lengthBeats);
        for (const occ of occurrences) {
          const seg = track.segments.find((candidate) => candidate.id === occ.segmentId);
          if (!seg || seg.muted) continue;
          if (seg.payload.kind === "audio") continue;
          const compiled = compileSegmentEvents(seg);
          const localWindowStart = currentBeat - occ.startBeat - 0.05;
          const localWindowEnd = currentBeat - occ.startBeat + lookaheadBeats;
          const events = eventsStartingInBeatWindow(compiled, localWindowStart, localWindowEnd);
          for (const event of events) {
            const noteStart = occ.startBeat + event.startBeat;
            const noteEnd = Math.min(occ.startBeat + occ.lengthBeats, noteStart + event.lengthBeats);
            if (noteEnd - noteStart <= 0.000001) continue;
            const key = `${seg.id}:${occ.repetition}:${event.id}`;
            if (scheduled.has(key)) continue;
            const instrument =
              currentInstruments.find((candidate) => candidate.id === event.instrumentId) ??
              currentInstruments.find((candidate) => event.instrumentName && candidate.name.toLowerCase() === event.instrumentName.toLowerCase()) ??
              currentInstruments.find((candidate) => candidate.id === seg.instrumentId) ??
              currentInstruments.find((candidate) => candidate.name.toLowerCase() === "lead saw") ??
              fallbackInstrument;
            const transpose = event.kind === "midi" ? seg.transpose ?? 0 : 0;
            const payloadGainDb = seg.payload.kind === "midi" || seg.payload.kind === "mixed" || seg.payload.kind === "drumpad"
              ? seg.payload.gainDb ?? 0
              : 0;
            const noteWithGain = applySegmentGainToNote(
              transposeNote(event.note, transpose),
              payloadGainDb + trackGainDbIncludingParents(track, tracks),
            );
            const targetEvent = event.glideTargetId ? compiled.eventById.get(event.glideTargetId) : undefined;
            const clippedTarget = targetEvent ? transposeNote(targetEvent.note, transpose) : undefined;
            const delayS = Math.max(0, (noteStart - currentBeat) / beatsPerSecond);
            const durationS = Math.max(0.03, (noteEnd - noteStart) / beatsPerSecond);
            scheduleTimelineMidiNote(
              noteWithGain,
              instrument,
              audio.currentTime + delayS,
              durationS,
              clippedTarget,
              bpm,
            );
            scheduled.add(key);
            scheduleExpressionActivity(instrument, key, noteWithGain.velocity, noteWithGain.pitch, delayS, durationS);
            useUiStore.getState().triggerSegmentPlayback(seg.id);
            trackPeak = Math.max(trackPeak, noteWithGain.velocity / 127);
          }
        }
        const trackRms = trackPeak * 0.707;
        trackMeters.push({
          id: track.id,
          peak: trackPeak,
          rms: trackRms,
          leftPeak: trackPeak,
          rightPeak: trackPeak,
          leftRms: trackRms,
          rightRms: trackRms,
        });
      }
      if (trackMeters.length) useAnalyzerStore.getState().setTrackMeters(trackMeters);

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    onCleanup(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    });
  });

  onCleanup(() => {
    if (raf) cancelAnimationFrame(raf);
    clearExpressionPlaybackState();
    stopTimelineAudio();
  });

  function scheduleExpressionActivity(
    instrument: Instrument,
    key: string,
    velocity: number,
    midiPitch: number,
    delayS: number,
    durationS: number,
  ) {
    if (!isAetherExpressionInstrument(instrument)) return;
    const instrumentId = instrument.id;
    const startTimer = window.setTimeout(() => {
      expressionTimers.delete(startTimer);
      const notes = activeExpressionNotes.get(instrumentId) ?? new Map<string, { velocity: number; keytrack: number }>();
      notes.set(key, {
        velocity: clamp01(velocity / 127),
        keytrack: keytrackFromMidiPitch(midiPitch),
      });
      activeExpressionNotes.set(instrumentId, notes);
      publishExpressionActivity(instrumentId);
      const stopTimer = window.setTimeout(() => {
        expressionTimers.delete(stopTimer);
        const currentNotes = activeExpressionNotes.get(instrumentId);
        currentNotes?.delete(key);
        if (currentNotes && currentNotes.size > 0) {
          publishExpressionActivity(instrumentId);
        } else {
          activeExpressionNotes.delete(instrumentId);
          useSynthStore.getState().clearInstrumentExpressionActivity(instrumentId);
        }
      }, Math.max(1, Math.ceil(durationS * 1000)));
      expressionTimers.add(stopTimer);
    }, Math.max(0, Math.ceil(delayS * 1000)));
    expressionTimers.add(startTimer);
  }

  function publishExpressionActivity(instrumentId: string) {
    const notes = activeExpressionNotes.get(instrumentId);
    if (!notes || notes.size === 0) {
      useSynthStore.getState().clearInstrumentExpressionActivity(instrumentId);
      return;
    }
    let velocity = 0;
    let keytrack = 0;
    for (const note of notes.values()) {
      velocity += note.velocity;
      keytrack += note.keytrack;
    }
    const activeNotes = notes.size;
    useSynthStore.getState().setInstrumentExpressionActivity(instrumentId, {
      source: "playback",
      activeNotes,
      pitchBendSemitones: 0,
      velocity: velocity / activeNotes,
      keytrack: keytrack / activeNotes,
      modWheel: 0,
      pressure: 0,
      timbre: 0,
    });
  }

  function clearExpressionPlaybackState() {
    for (const timer of expressionTimers) window.clearTimeout(timer);
    expressionTimers.clear();
    for (const instrumentId of activeExpressionNotes.keys()) {
      useSynthStore.getState().clearInstrumentExpressionActivity(instrumentId);
    }
    activeExpressionNotes.clear();
  }

  return null;
}

function isAetherExpressionInstrument(instrument: Instrument): boolean {
  return instrument.kind === "synth" || instrument.kind === "wavetable" || Boolean(instrument.synthPatch);
}

function keytrackFromMidiPitch(midiPitch: number): number {
  return clamp01(midiPitch / 127);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function transposeNote(note: MidiNote, transpose: number): MidiNote {
  const shift = Number.isFinite(transpose) ? transpose : 0;
  if (shift === 0) return note;
  return {
    ...note,
    pitch: Math.max(0, Math.min(127, note.pitch + shift)),
    curve: note.curve?.map((point) => ({ ...point, pitch: Math.max(0, Math.min(127, point.pitch + shift)) })),
  };
}

function applySegmentGainToNote(note: MidiNote, gainDb: number): MidiNote {
  if (Math.abs(gainDb) < 0.001) return note;
  return {
    ...note,
    velocity: applyGainToVelocity(note.velocity, gainDb),
  };
}

function applyGainToVelocity(velocity: number, gainDb: number): number {
  if (Math.abs(gainDb) < 0.001) return velocity;
  const gain = Math.pow(10, Math.max(-96, Math.min(24, gainDb)) / 20);
  return Math.max(0, Math.min(127, velocity * gain));
}
