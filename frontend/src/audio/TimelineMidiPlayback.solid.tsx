/** @jsxImportSource solid-js */
import { createEffect, onCleanup, untrack } from "solid-js";
import { createStoreSelector } from "../solid-utils/store";
import { useInstrumentStore, useProjectStore, useTransportStore } from "../state/store";
import { expandTrackSegments, isTrackAudible } from "../state/selectors";
import { getTimelineAudioContext, scheduleTimelineMidiNote, stopTimelineAudio } from "./timelineAudio";
import { useAnalyzerStore } from "../state/analyzerStore";
import type { Instrument, MidiNote } from "../state/types";
import { DEFAULT_DRUM_MIDI_PITCH, DEFAULT_DRUM_VELOCITY, drumTimingOffsetBeats, normalizeDrumCell } from "../state/drumSteps";

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

export function TimelineMidiPlaybackSolid() {
  const playing = createStoreSelector(useTransportStore, (s) => s.playing);
  const positionBeat = createStoreSelector(useTransportStore, (s) => s.positionBeat);
  const speed = createStoreSelector(useTransportStore, (s) => s.speed);
  const project = createStoreSelector(useProjectStore, (s) => s.project);
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const scheduled = new Set<string>();
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
      lastPlaying = false;
      lastPosition = currentPosition;
      stopTimelineAudio();
      return;
    }

    if (!lastPlaying || currentPosition < lastPosition) {
      scheduled.clear();
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
          if (seg.payload.kind === "drum") {
            const payloadSpeed = seg.payload.speed ?? 1;
            const effectiveLengthBeats = seg.lengthBeats / payloadSpeed;
            const stepLengthBeats = effectiveLengthBeats / Math.max(1, seg.payload.stepCount);
            for (const row of seg.payload.rows) {
              const instrument =
                currentInstruments.find((candidate) => candidate.id === row.instrumentId) ??
                currentInstruments.find((candidate) => candidate.name.toLowerCase() === row.name.toLowerCase()) ??
                fallbackInstrument;
              for (let step = 0; step < seg.payload.stepCount; step++) {
                const cell = normalizeDrumCell(row.steps[step]);
                if (!cell.on) continue;
                const noteStart = occ.startBeat
                  + step * stepLengthBeats
                  + drumTimingOffsetBeats(step, stepLengthBeats, seg.payload.swingPercent, cell.leanPercent);
                if (noteStart < currentBeat - 0.05 || noteStart > currentBeat + lookaheadBeats) continue;
                const key = `${seg.id}:${occ.repetition}:${row.id}:${step}`;
                if (scheduled.has(key)) continue;
                const delayS = Math.max(0, (noteStart - currentBeat) / beatsPerSecond);
                const velocity = applyGainToVelocity(cell.velocity ?? DEFAULT_DRUM_VELOCITY, track.gainDb);
                scheduleTimelineMidiNote(
                  {
                    pitch: DEFAULT_DRUM_MIDI_PITCH,
                    frequencyHz: cell.pitchHz ?? seg.payload.defaultPitchHz,
                    velocity,
                    startBeat: 0,
                    lengthBeats: Math.min(0.25, stepLengthBeats),
                  },
                  instrument,
                  audio.currentTime + delayS,
                  Math.max(0.05, Math.min(0.18, stepLengthBeats / beatsPerSecond)),
                );
                scheduled.add(key);
                trackPeak = Math.max(trackPeak, velocity / 127);
              }
            }
            continue;
          }
          if (seg.payload.kind !== "midi" && seg.payload.kind !== "mixed") continue;
          const payload = seg.payload;
          const instrument =
            currentInstruments.find((candidate) => candidate.id === seg.instrumentId) ??
            currentInstruments.find((candidate) => candidate.name.toLowerCase() === "lead saw") ??
            fallbackInstrument;

          payload.notes.forEach((note, noteIndex) => {
            const noteStart = occ.startBeat + note.startBeat;
            if (noteStart < currentBeat - 0.05 || noteStart > currentBeat + lookaheadBeats) return;
            const key = `${seg.id}:${occ.repetition}:${noteIndex}:${note.pitch}:${note.startBeat}:${note.lengthBeats}`;
            if (scheduled.has(key)) return;
            const transpose = seg.transpose ?? 0;
            const target = connectedLaterNote(payload.notes, noteIndex);
            const delayS = Math.max(0, (noteStart - currentBeat) / beatsPerSecond);
            const durationBeats = target ? Math.max(0.03, target.startBeat - note.startBeat) : note.lengthBeats;
            const durationS = Math.max(0.03, durationBeats / beatsPerSecond);
            const noteWithGain = applySegmentGainToNote(transposeNote(note, transpose), (payload.gainDb ?? 0) + track.gainDb);
            scheduleTimelineMidiNote(
              noteWithGain,
              instrument,
              audio.currentTime + delayS,
              durationS,
              target ? transposeNote(target, transpose) : undefined,
            );
            scheduled.add(key);
            trackPeak = Math.max(trackPeak, noteWithGain.velocity / 127);
          });
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
    stopTimelineAudio();
  });

  return null;
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
