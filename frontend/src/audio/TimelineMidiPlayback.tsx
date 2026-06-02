import { useEffect, useRef } from "react";
import { useInstrumentStore, useProjectStore, useTransportStore } from "../state/store";
import { expandTrackSegments, isTrackAudible } from "../state/selectors";
import { getTimelineAudioContext, scheduleTimelineMidiNote, stopTimelineAudio } from "./timelineAudio";
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

export function TimelineMidiPlayback() {
  const playing = useTransportStore((s) => s.playing);
  const positionBeat = useTransportStore((s) => s.positionBeat);
  const speed = useTransportStore((s) => s.speed);
  const project = useProjectStore((s) => s.project);
  const instruments = useInstrumentStore((s) => s.instruments);
  const scheduledRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number | null>(null);
  const lastPlayingRef = useRef(false);
  const lastPositionRef = useRef(positionBeat);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      scheduledRef.current.clear();
      lastPlayingRef.current = false;
      lastPositionRef.current = positionBeat;
      stopTimelineAudio();
      return;
    }

    if (!lastPlayingRef.current || positionBeat < lastPositionRef.current) {
      scheduledRef.current.clear();
      stopTimelineAudio();
    }
    lastPlayingRef.current = true;
    lastPositionRef.current = positionBeat;

    function tick() {
      const transport = useTransportStore.getState();
      if (!transport.playing) {
        stopTimelineAudio();
        return;
      }

      const audio = getTimelineAudioContext();
      const { bpm, lengthBeats, tracks } = useProjectStore.getState().project;
      const beatsPerSecond = (bpm / 60) * transport.speed;
      const lookaheadBeats = LOOKAHEAD_SECONDS * beatsPerSecond;
      const currentBeat = transport.positionBeat;

      if (currentBeat < lastPositionRef.current || currentBeat > lengthBeats - 0.01) {
        scheduledRef.current.clear();
      }
      lastPositionRef.current = currentBeat;

      for (const track of tracks) {
        if (!isTrackAudible(track)) continue;
        const occurrences = expandTrackSegments(track, lengthBeats);
        for (const occ of occurrences) {
          const seg = track.segments.find((s) => s.id === occ.segmentId);
          if (!seg || seg.muted) continue;
          if (seg.payload.kind === "drum") {
            const speed = seg.payload.speed ?? 1;
            const effectiveLengthBeats = seg.lengthBeats / speed;
            const stepLengthBeats = effectiveLengthBeats / Math.max(1, seg.payload.stepCount);
            for (const row of seg.payload.rows) {
              const instrument =
                instruments.find((i) => i.id === row.instrumentId) ??
                instruments.find((i) => i.name.toLowerCase() === row.name.toLowerCase()) ??
                fallbackInstrument;
              for (let step = 0; step < seg.payload.stepCount; step++) {
                const cell = normalizeDrumCell(row.steps[step]);
                if (!cell.on) continue;
                const noteStart = occ.startBeat
                  + step * stepLengthBeats
                  + drumTimingOffsetBeats(step, stepLengthBeats, seg.payload.swingPercent, cell.leanPercent);
                if (noteStart < currentBeat - 0.05 || noteStart > currentBeat + lookaheadBeats) continue;
                const key = `${seg.id}:${occ.repetition}:${row.id}:${step}`;
                if (scheduledRef.current.has(key)) continue;
                const delayS = Math.max(0, (noteStart - currentBeat) / beatsPerSecond);
                scheduleTimelineMidiNote(
                  {
                    pitch: DEFAULT_DRUM_MIDI_PITCH,
                    frequencyHz: cell.pitchHz ?? seg.payload.defaultPitchHz,
                    velocity: cell.velocity ?? DEFAULT_DRUM_VELOCITY,
                    startBeat: 0,
                    lengthBeats: Math.min(0.25, stepLengthBeats),
                  },
                  instrument,
                  audio.currentTime + delayS,
                  Math.max(0.05, Math.min(0.18, stepLengthBeats / beatsPerSecond)),
                );
                scheduledRef.current.add(key);
              }
            }
            continue;
          }
          if (seg.payload.kind !== "midi" && seg.payload.kind !== "mixed") continue;
          const payload = seg.payload;
          const instrument =
            instruments.find((i) => i.id === seg.instrumentId) ??
            instruments.find((i) => i.name.toLowerCase() === "lead saw") ??
            fallbackInstrument;

          payload.notes.forEach((note, noteIndex) => {
            const noteStart = occ.startBeat + note.startBeat;
            if (noteStart < currentBeat - 0.05 || noteStart > currentBeat + lookaheadBeats) return;
            const key = `${seg.id}:${occ.repetition}:${noteIndex}:${note.pitch}:${note.startBeat}:${note.lengthBeats}`;
            if (scheduledRef.current.has(key)) return;
            const transpose = seg.transpose ?? 0;
            const target = connectedLaterNote(payload.notes, noteIndex);
            const delayS = Math.max(0, (noteStart - currentBeat) / beatsPerSecond);
            const durationBeats = target ? Math.max(0.03, target.startBeat - note.startBeat) : note.lengthBeats;
            const durationS = Math.max(0.03, durationBeats / beatsPerSecond);
            scheduleTimelineMidiNote(
              transposeNote(note, transpose),
              instrument,
              audio.currentTime + delayS,
              durationS,
              target ? transposeNote(target, transpose) : undefined,
            );
            scheduledRef.current.add(key);
          });
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, speed, project, instruments]);

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
