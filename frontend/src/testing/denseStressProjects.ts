import { analyzeMidiForRemix, midiRemixOptions, remixMidiNotes } from "../features/MidiEditor/midiRemix";
import { roundMidiNotesToNearest } from "../features/MidiEditor/midiNoteRounding";
import { migrateBeatDocument } from "../persistence/beatDocument";
import { defaultTrackEffectParams, EFFECT_OPTIONS } from "../state/effects";
import { projectWithRenderedMidiArpeggiations } from "../state/midiNoteGroups";
import type { BeatProjectDocument } from "../ipc/schema";
import type { Instrument, MidiNote, Project, Track, TrackEffect } from "../state/types";

export interface DenseStressBuildResult {
  document: BeatProjectDocument;
  metrics: DenseStressProjectMetrics;
}

export interface DenseStressProjectMetrics {
  name: string;
  tier: "normal" | "dense-midi" | "combined-extreme";
  bpm: number;
  tracks: number;
  segments: number;
  midiNotes: number;
  renderedArpeggioNotes: number;
  drumRows: number;
  drumCells: number;
  instruments: number;
  trackEffects: number;
  instrumentEffects: number;
  busEffects: number;
  automationPoints: number;
  roundedMovedNotes: number;
  roundedExtendedNotes: number;
  remixedChangedNotes: number;
  remixedAddedNotes: number;
  transformMs: number;
}

export interface DenseStressOperationMetrics {
  name: string;
  parseAndMigrateMs: number;
  arpeggiationRenderMs: number;
  roundAllMs: number;
  remixAllMs: number;
  serializeMs: number;
  totalMs: number;
  sourceNotes: number;
  renderedArpeggioNotes: number;
  roundedMovedNotes: number;
  roundedExtendedNotes: number;
  remixedChangedNotes: number;
  remixedAddedNotes: number;
  remixedSegments: number;
  serializedBytes: number;
  exceededThirtySecondBudget: boolean;
}

const TIME_SIGNATURE: Project["timeSignature"] = { num: 4, denom: 4, boldBeats: [1] };
const EFFECT_KINDS = EFFECT_OPTIONS.map((option) => option.value);
const DRUM_NAMES = [
  "Kick 1", "Kick 2", "Sub Kick", "Snare Center", "Snare Rim", "Clap", "Rimshot",
  "Closed Hat 1", "Closed Hat 2", "Open Hat", "Pedal Hat", "Ride", "Ride Bell", "Crash",
  "Splash", "China", "Low Tom", "Mid Tom", "High Tom", "Floor Tom", "Cowbell", "Tambourine",
  "Shaker", "Triangle",
];

export function buildDenseStressProject(index: 1 | 2 | 3, audioPath: string): DenseStressBuildResult {
  const started = performance.now();
  const config = index === 1
    ? { tier: "normal" as const, bpm: 128, length: 64, midiTracks: 4, drumTracks: 1, segments: 4, notes: 28, drumRows: 10, effects: 4 }
    : index === 2
      ? { tier: "dense-midi" as const, bpm: 300, length: 96, midiTracks: 10, drumTracks: 2, segments: 12, notes: 96, drumRows: 20, effects: 8 }
      : { tier: "combined-extreme" as const, bpm: 300, length: 128, midiTracks: 16, drumTracks: 4, segments: 16, notes: 144, drumRows: 24, effects: EFFECT_KINDS.length };
  const name = `dense_${index}`;
  const savedAt = Date.now() + index;
  const random = seededRandom(0xd3e000 + index);
  const instruments: Instrument[] = [];
  const tracks: Track[] = [];
  let roundedMovedNotes = 0;
  let roundedExtendedNotes = 0;
  let remixedChangedNotes = 0;
  let remixedAddedNotes = 0;

  for (let trackIndex = 0; trackIndex < config.midiTracks; trackIndex += 1) {
    const instrument = makeSynthInstrument(name, trackIndex, savedAt, config.effects, index === 1);
    instruments.push(instrument);
    const trackId = `${name}-midi-track-${trackIndex + 1}`;
    const segments = [];
    for (let segmentIndex = 0; segmentIndex < config.segments; segmentIndex += 1) {
      const lengthBeats = index === 1 ? 8 : 4 + (segmentIndex % 4) * 0.5;
      let notes = makeDenseMidiNotes(random, trackIndex, segmentIndex, config.notes, lengthBeats, index);
      if (segmentIndex % 4 === 1) {
        const rounded = roundMidiNotesToNearest(notes, index === 1 ? 0.25 : 0.0625, lengthBeats);
        notes = rounded.notes;
        roundedMovedNotes += rounded.movedNoteCount;
        roundedExtendedNotes += rounded.extendedNoteCount;
      }
      if (segmentIndex % 4 === 2) {
        const analysis = analyzeMidiForRemix(notes, lengthBeats, TIME_SIGNATURE, {
          segmentName: `${trackIndex % 3 === 0 ? "Bass" : "Melody"} stress motif`,
          trackName: `Dense voice ${trackIndex + 1}`,
          instrumentName: instrument.name,
        });
        const option = midiRemixOptions(analysis.kind)[segmentIndex % midiRemixOptions(analysis.kind).length];
        if (option) {
          const remixed = remixMidiNotes(notes, analysis, option.value, lengthBeats);
          notes = remixed.notes;
          remixedChangedNotes += remixed.changedNoteCount;
          remixedAddedNotes += remixed.addedNoteCount;
        }
      }
      segments.push({
        id: `${trackId}-segment-${segmentIndex + 1}`,
        trackId,
        name: `${segmentIndex % 4 === 1 ? "Rounded" : segmentIndex % 4 === 2 ? "Remixed" : "Dense"} ${segmentIndex + 1}`,
        instrumentId: instrument.id,
        startBeat: segmentIndex * (config.length / config.segments),
        lengthBeats,
        repeats: 0,
        layer: segmentIndex % 3,
        muted: false,
        automation: makeMidiAutomation(lengthBeats, segmentIndex),
        payload: { kind: "midi" as const, notes, gainDb: -6 - (trackIndex % 3) },
      });
    }
    tracks.push(makeTrack({
      id: trackId,
      name: `${index === 1 ? "Normal" : "Dense"} MIDI ${trackIndex + 1}`,
      instrumentId: instrument.id,
      segments,
      effects: makeEffectChain(`${trackId}-fx`, config.effects, config.length),
      sends: makeSends(name, trackIndex),
      gainDb: -12,
      pan: config.midiTracks > 1 ? -0.85 + 1.7 * trackIndex / (config.midiTracks - 1) : 0,
    }));
  }

  const drumInstruments = DRUM_NAMES.slice(0, config.drumRows).map((drumName, drumIndex) => {
    const instrument = makeDrumInstrument(name, drumName, drumIndex, savedAt, Math.min(config.effects, 4));
    instruments.push(instrument);
    return instrument;
  });
  for (let drumTrackIndex = 0; drumTrackIndex < config.drumTracks; drumTrackIndex += 1) {
    const trackId = `${name}-drum-track-${drumTrackIndex + 1}`;
    const segments = Array.from({ length: config.segments }, (_, segmentIndex) => {
      const stepCount = index === 1 ? 16 : 64;
      const speed = index === 1 ? 4 : 6;
      return {
        id: `${trackId}-segment-${segmentIndex + 1}`,
        trackId,
        name: `Dense ${config.drumRows}-voice drums ${segmentIndex + 1}`,
        startBeat: segmentIndex * (config.length / config.segments),
        lengthBeats: stepCount / speed,
        repeats: 0,
        layer: segmentIndex % 2,
        muted: false,
        payload: {
          kind: "drum" as const,
          rows: drumInstruments.map((instrument, rowIndex) => ({
            id: `${trackId}-row-${segmentIndex}-${rowIndex}`,
            name: instrument.name,
            instrumentId: instrument.id,
            steps: Array.from({ length: stepCount }, (_, stepIndex) => ({
              on: (stepIndex + rowIndex * 3 + segmentIndex) % Math.max(2, 7 - (rowIndex % 5)) === 0,
              velocity: 48 + ((stepIndex * 11 + rowIndex * 17 + segmentIndex * 7) % 80),
              leanPercent: -35 + ((stepIndex * 13 + rowIndex * 9) % 71),
              pitchHz: 45 + rowIndex * 27 + (stepIndex % 4) * 3,
            })),
          })),
          stepCount,
          speed: speed as 4 | 6,
          sourceLengthBeats: stepCount,
          swingPercent: index === 1 ? 52 : 58 + (segmentIndex % 4) * 4,
          timeSignature: TIME_SIGNATURE,
        },
      };
    });
    tracks.push(makeTrack({
      id: trackId,
      name: `Dense Drum Array ${drumTrackIndex + 1}`,
      segments,
      effects: makeEffectChain(`${trackId}-fx`, config.effects, config.length),
      sends: makeSends(name, config.midiTracks + drumTrackIndex),
      gainDb: -10,
      pan: drumTrackIndex % 2 === 0 ? -0.15 : 0.15,
    }));
  }

  if (index === 3) {
    const instrument = makeSynthInstrument(name, 99, savedAt, EFFECT_KINDS.length, false);
    instruments.push(instrument);
    const trackId = `${name}-mixed-track`;
    tracks.push(makeTrack({
      id: trackId,
      name: "Mixed audio + MIDI collision",
      instrumentId: instrument.id,
      segments: Array.from({ length: 8 }, (_, segmentIndex) => ({
        id: `${trackId}-segment-${segmentIndex + 1}`,
        trackId,
        name: `Mixed layer ${segmentIndex + 1}`,
        instrumentId: instrument.id,
        startBeat: segmentIndex * 8,
        lengthBeats: 8,
        repeats: 1,
        layer: segmentIndex % 4,
        muted: false,
        fadeInBeats: 0.125,
        fadeOutBeats: 0.25,
        payload: {
          kind: "mixed" as const,
          audioFileId: `${name}-audio`,
          notes: makeDenseMidiNotes(random, 99, segmentIndex, 96, 8, index),
          gainDb: -15,
        },
      })),
      effects: makeEffectChain(`${trackId}-fx`, EFFECT_KINDS.length, config.length),
      sends: makeSends(name, 99),
      gainDb: -14,
      pan: 0,
    }));
  }

  const project: Project = {
    id: `${name}-project`,
    name,
    bpm: config.bpm,
    timeSignature: TIME_SIGNATURE,
    lengthBeats: config.length,
    tracks,
    returnBuses: makeBuses(name, config.effects, config.length),
    masterEqAutomation: Array.from({ length: 8 }, (_, pointIndex) => ({
      atBeat: pointIndex * (config.length / 7),
      bandsDb: Array.from({ length: 7 }, (_, band) => -6 + ((band * 3 + pointIndex * 2) % 13)),
    })),
    masterChain: {
      inputGainDb: -8,
      compressorEnabled: true,
      compressorThresholdDb: -18,
      compressorRatio: index === 3 ? 8 : 3,
      compressorAttackMs: 2,
      compressorReleaseMs: 180,
      compressorMakeupDb: 1,
      compressorMix: 100,
      outputGainDb: -2,
    },
    recordingInput: {
      inputDeviceId: "",
      inputDeviceName: "",
      inputChannelStart: 0,
      inputChannelCount: 2,
      calibrationSampleRate: 0,
      measuredRoundTripSamples: 0,
      reportedInputLatencySamples: 0,
      reportedOutputLatencySamples: 0,
      userLatencyAdjustmentSamples: 0,
    },
  };
  const document = migrateBeatDocument({
    schemaVersion: 1,
    savedAt,
    project,
    instruments,
    audioFiles: index === 3 ? [{
      id: `${name}-audio`, name: "Dense pulse.wav", path: audioPath,
      durationSeconds: 2, sampleRate: 48000, channels: 2,
    }] : [],
    components: [], componentFolders: [], plugins: [],
  });
  const rendered = projectWithRenderedMidiArpeggiations(document.project);
  const metrics = collectMetrics(document, rendered, {
    tier: config.tier,
    roundedMovedNotes,
    roundedExtendedNotes,
    remixedChangedNotes,
    remixedAddedNotes,
    transformMs: performance.now() - started,
  });
  return { document, metrics };
}

export function benchmarkDenseStressDocumentOperations(serializedDocument: string): DenseStressOperationMetrics {
  const totalStarted = performance.now();
  const parseStarted = performance.now();
  const document = migrateBeatDocument(JSON.parse(serializedDocument));
  const parseAndMigrateMs = performance.now() - parseStarted;
  const sourceNotes = countDocumentNotes(document);

  let renderedArpeggioNotes = 0;
  const arpStarted = performance.now();
  {
    const rendered = projectWithRenderedMidiArpeggiations(document.project);
    renderedArpeggioNotes = rendered.tracks.flatMap((track) => track.segments).reduce((sum, segment) => (
      sum + ((segment.payload.kind === "midi" || segment.payload.kind === "mixed") ? segment.payload.notes.length : 0)
    ), 0);
  }
  const arpeggiationRenderMs = performance.now() - arpStarted;

  const working = structuredClone(document);
  let roundedMovedNotes = 0;
  let roundedExtendedNotes = 0;
  const roundStarted = performance.now();
  for (const track of working.project.tracks) {
    for (const segment of track.segments) {
      if (segment.payload.kind !== "midi" && segment.payload.kind !== "mixed") continue;
      const rounded = roundMidiNotesToNearest(segment.payload.notes, 0.0625, segment.lengthBeats);
      segment.payload.notes = rounded.notes;
      roundedMovedNotes += rounded.movedNoteCount;
      roundedExtendedNotes += rounded.extendedNoteCount;
    }
  }
  const roundAllMs = performance.now() - roundStarted;

  let remixedChangedNotes = 0;
  let remixedAddedNotes = 0;
  let remixedSegments = 0;
  const remixStarted = performance.now();
  for (const track of working.project.tracks) {
    for (const segment of track.segments) {
      if ((segment.payload.kind !== "midi" && segment.payload.kind !== "mixed")
        || segment.payload.notes.length < 2) continue;
      const analysis = analyzeMidiForRemix(segment.payload.notes, segment.lengthBeats, working.project.timeSignature, {
        segmentName: segment.name,
        trackName: track.name,
      });
      const option = midiRemixOptions(analysis.kind)[0];
      if (!option) continue;
      const remixed = remixMidiNotes(segment.payload.notes, analysis, option.value, segment.lengthBeats);
      segment.payload.notes = remixed.notes;
      remixedChangedNotes += remixed.changedNoteCount;
      remixedAddedNotes += remixed.addedNoteCount;
      remixedSegments += 1;
    }
  }
  const remixAllMs = performance.now() - remixStarted;

  const serializeStarted = performance.now();
  const serialized = JSON.stringify(working);
  const serializeMs = performance.now() - serializeStarted;
  const totalMs = performance.now() - totalStarted;
  return {
    name: document.project.name,
    parseAndMigrateMs,
    arpeggiationRenderMs,
    roundAllMs,
    remixAllMs,
    serializeMs,
    totalMs,
    sourceNotes,
    renderedArpeggioNotes,
    roundedMovedNotes,
    roundedExtendedNotes,
    remixedChangedNotes,
    remixedAddedNotes,
    remixedSegments,
    serializedBytes: new TextEncoder().encode(serialized).byteLength,
    exceededThirtySecondBudget: totalMs > 30_000,
  };
}

function countDocumentNotes(document: BeatProjectDocument): number {
  return document.project.tracks.flatMap((track) => track.segments).reduce((sum, segment) => (
    sum + ((segment.payload.kind === "midi" || segment.payload.kind === "mixed") ? segment.payload.notes.length : 0)
  ), 0);
}

function makeDenseMidiNotes(
  random: () => number,
  trackIndex: number,
  segmentIndex: number,
  count: number,
  segmentLength: number,
  tier: number,
): MidiNote[] {
  const notes: MidiNote[] = [];
  const chordSize = tier === 1 ? 4 : tier === 2 ? 12 : 20;
  for (let noteIndex = 0; noteIndex < count; noteIndex += 1) {
    const onsetIndex = Math.floor(noteIndex / chordSize);
    const startBeat = Math.min(segmentLength - 1 / 128, onsetIndex * (tier === 1 ? 0.25 : 0.0625) + (random() - 0.5) * 0.055);
    const lengthBeats = Math.max(1 / 128, Math.min(segmentLength - startBeat, 0.02 + random() * (tier === 1 ? 1.1 : 3.5)));
    const pitch = Math.max(12, Math.min(119, 28 + (trackIndex * 5 + noteIndex * 7 + segmentIndex * 3) % 76));
    const groupIndex = Math.floor(noteIndex / chordSize);
    const arpeggiated = tier > 1 && groupIndex % 3 === 0;
    const note: MidiNote = {
      pitch,
      velocity: 28 + ((noteIndex * 23 + trackIndex * 13 + segmentIndex * 5) % 100),
      startBeat: Math.max(0, startBeat),
      lengthBeats,
      connectToIndex: noteIndex + 1 < count && noteIndex % 5 === 0 ? noteIndex + 1 : undefined,
      curve: noteIndex % 4 === 0 ? [
        { beat: Math.max(0, startBeat), pitch },
        { beat: Math.max(0, startBeat) + lengthBeats * 0.45, pitch: pitch + (noteIndex % 2 ? -7.5 : 11.25) },
        { beat: Math.max(0, startBeat) + lengthBeats, pitch: pitch + (noteIndex % 3) - 1 },
      ] : undefined,
      automation: [
        { target: "amp.level", points: [
          { beat: Math.max(0, startBeat), value: 0.08 + random() * 0.5 },
          { beat: Math.max(0, startBeat) + lengthBeats, value: 0.55 + random() * 0.45, curve: "smoothstep" },
        ] },
        { target: "amp.pan", points: [
          { beat: Math.max(0, startBeat), value: -1 + random() * 2 },
          { beat: Math.max(0, startBeat) + lengthBeats, value: -1 + random() * 2, curve: "cubic" },
        ] },
      ],
      groupId: arpeggiated ? `arp-${trackIndex}-${segmentIndex}-${groupIndex}` : undefined,
      arpeggiation: arpeggiated ? {
        schemaVersion: 1,
        loops: 2 + (groupIndex % 5),
        sequence: (["up", "down", "up-down", "down-up", "played"] as const)[groupIndex % 5],
        timingType: groupIndex % 2 ? "loops" : "notes-per-beat",
        noteValue: ([4, 8, 16, 32, 64] as const)[groupIndex % 5],
      } : undefined,
    };
    notes.push(note);
  }
  return notes;
}

function makeMidiAutomation(length: number, seed: number) {
  return ["osc.a.position", "filter.cutoff", "macro.1", "unison.spread"].map((target, laneIndex) => ({
    target: target as "osc.a.position" | "filter.cutoff" | "macro.1" | "unison.spread",
    points: [
      { beat: 0, value: ((seed + laneIndex) % 4) * 0.2 },
      { beat: length * 0.5, value: 0.95 - laneIndex * 0.12, curve: "smoothstep" as const },
      { beat: length, value: 0.15 + laneIndex * 0.13, curve: "cubic" as const },
    ],
  }));
}

function makeSynthInstrument(name: string, index: number, savedAt: number, effectCount: number, normal: boolean): Instrument {
  const instrumentId = `${name}-instrument-${index + 1}`;
  return {
    id: instrumentId,
    name: `${normal ? "Normal" : "Maximum"} Aether ${index + 1}`,
    createdAt: savedAt,
    updatedAt: savedAt,
    icon: "ph:cube",
    kind: "wavetable",
    envelope: { attackMs: normal ? 8 : 0.5, decayMs: normal ? 180 : 3200, sustain: normal ? 0.72 : 0.96, releaseMs: normal ? 260 : 6000 },
    knobs: { cutoff: 0.78, resonance: normal ? 0.18 : 0.82, drive: normal ? 0.12 : 0.88, color: 0.68 },
    filterEnabled: true,
    filterType: "lowpass",
    waveform: "wavetable",
    detuneCents: index % 2 ? -8 : 8,
    octave: 0,
    subOscLevel: normal ? 0.08 : 0.45,
    glideMs: normal ? 0 : 180,
    maxVoices: normal ? 16 : 32,
    mono: false,
    legato: false,
    pitchBendRangeSemitones: 24,
    ampLevel: normal ? 0.75 : 0.42,
    ampPan: 0,
    lfoWaveform: "saw",
    lfoRateHz: normal ? 2 : 18,
    lfoDepth: normal ? 0.12 : 0.95,
    lfoSync: false,
    lfoSyncedRate: "1/64",
    lfoToPitch: normal ? 0.05 : 0.8,
    lfoToFilter: normal ? 0.15 : 0.9,
    envToFilter: normal ? 0.12 : 0.85,
    wavetable: { bank: (["aether", "glass", "vocal", "organ", "fm"] as const)[index % 5], position: 0.78, warp: normal ? 0.18 : 0.92, warpMode: "fold", unison: normal ? 3 : 8, detuneCents: normal ? 8 : 90, blend: normal ? 0.45 : 1 },
    effects: { filters: makeEffectChain(`${instrumentId}-fx`, effectCount, 128) },
    sampleIds: [],
    source: { kind: "created", label: "Dense stress generator" },
    descriptors: ["stress", normal ? "normal" : "maximum", "wavetable"],
    userCreated: true,
  };
}

function makeDrumInstrument(name: string, drumName: string, index: number, savedAt: number, effectCount: number): Instrument {
  const paths = ["tr505/tr505-kick.wav", "tr505/tr505-snare.wav", "tr505/tr505-hihat-closed.wav", "lm2/crash.wav", "pearl-master-studio/ride-01.wav"];
  return {
    id: `${name}-drum-${index + 1}`,
    name: drumName,
    createdAt: savedAt,
    updatedAt: savedAt,
    kind: "sampler",
    envelope: { attackMs: 0.5 + index % 4, decayMs: 30 + index * 45, sustain: index % 6 === 0 ? 0.3 : 0, releaseMs: 25 + index * 85 },
    knobs: { cutoff: 0.35 + (index % 8) * 0.08, resonance: (index % 5) * 0.12, drive: (index % 7) * 0.08, color: (index % 9) / 8 },
    waveform: "sample",
    effects: { filters: makeEffectChain(`${name}-drum-${index + 1}-fx`, effectCount, 128) },
    sampleIds: [],
    sampleUrl: `/samples/${paths[index % paths.length]}`,
    source: { kind: "factory", label: "Dense test sample set" },
    descriptors: ["drum", "stress", drumName.toLowerCase()],
    userCreated: false,
  };
}

function makeEffectChain(prefix: string, count: number, projectLength: number): TrackEffect[] {
  return EFFECT_KINDS.slice(0, count).map((kind, index) => {
    const params = defaultTrackEffectParams(kind);
    for (const key of Object.keys(params)) {
      if (key === "mix") params[key] = 72 + index % 29;
      else if (key === "feedback") params[key] = 70 + index % 20;
      else if (key === "roomSize") params[key] = 88;
      else if (key === "rateHz") params[key] = 8 + index * 0.2;
    }
    const firstParam = Object.keys(params)[0];
    return {
      id: `${prefix}-${kind}-${index}`,
      kind,
      bypassed: false,
      pluginId: kind === "plugin" ? "dense-unavailable-plugin" : undefined,
      pluginName: kind === "plugin" ? "Unavailable stress placeholder" : undefined,
      latencySamples: kind === "plugin" ? 8192 : index * 64,
      params,
      automation: firstParam ? [{
        param: firstParam,
        points: [
          { id: `${prefix}-${index}-a`, beat: 0, value: params[firstParam] * 0.35, curve: "smoothstep" },
          { id: `${prefix}-${index}-b`, beat: projectLength * 0.5, value: params[firstParam], curve: "cubic" },
          { id: `${prefix}-${index}-c`, beat: projectLength, value: params[firstParam] * 0.55, curve: "easeOut" },
        ],
      }] : undefined,
    };
  });
}

function makeTrack(input: { id: string; name: string; instrumentId?: string; segments: Track["segments"]; effects: TrackEffect[]; sends: Track["sends"]; gainDb: number; pan: number }): Track {
  return {
    id: input.id,
    name: input.name,
    kind: input.segments.some((segment) => segment.payload.kind === "mixed") ? "mixed" : "midi",
    instrumentId: input.instrumentId,
    outputEnabled: true,
    gainDb: input.gainDb,
    pan: input.pan,
    mute: false,
    solo: false,
    recordArmed: false,
    inputMonitoring: false,
    inputDeviceId: "",
    inputChannelStart: 0,
    inputChannelCount: 2,
    recordGainDb: 0,
    sends: input.sends,
    automation: makeMidiAutomation(128, input.id.length),
    effects: { filters: input.effects },
    segments: input.segments,
    rowHeight: "compact",
  };
}

function makeSends(name: string, index: number) {
  return Array.from({ length: 4 }, (_, busIndex) => ({
    busId: `${name}-bus-${busIndex + 1}`,
    gainDb: -12 - ((index + busIndex) % 8),
    pan: -0.6 + busIndex * 0.4,
    enabled: true,
    preFader: (index + busIndex) % 2 === 0,
  }));
}

function makeBuses(name: string, effects: number, projectLength: number) {
  return Array.from({ length: 4 }, (_, busIndex) => ({
    schemaVersion: 1,
    id: `${name}-bus-${busIndex + 1}`,
    name: `Dense Bus ${busIndex + 1}`,
    outputBusId: busIndex < 3 ? `${name}-bus-${busIndex + 2}` : undefined,
    outputEnabled: true,
    inputTrimDb: -6 + busIndex,
    gainDb: -8 + busIndex,
    pan: -0.45 + busIndex * 0.3,
    mute: false,
    solo: false,
    soloSafe: busIndex === 3,
    mixerOrder: busIndex,
    sends: busIndex < 2 ? [{ busId: `${name}-bus-4`, gainDb: -18, pan: 0, enabled: true, preFader: false }] : [],
    effects: { filters: makeEffectChain(`${name}-bus-${busIndex + 1}-fx`, effects, projectLength) },
    automation: makeMidiAutomation(projectLength, busIndex),
  }));
}

function collectMetrics(
  document: BeatProjectDocument,
  renderedProject: Project,
  transform: Pick<DenseStressProjectMetrics, "tier" | "roundedMovedNotes" | "roundedExtendedNotes" | "remixedChangedNotes" | "remixedAddedNotes" | "transformMs">,
): DenseStressProjectMetrics {
  const segments = document.project.tracks.flatMap((track) => track.segments);
  const midiNotes = segments.reduce((sum, segment) => sum + ((segment.payload.kind === "midi" || segment.payload.kind === "mixed") ? segment.payload.notes.length : 0), 0);
  const renderedArpeggioNotes = renderedProject.tracks.flatMap((track) => track.segments).reduce((sum, segment) => sum + ((segment.payload.kind === "midi" || segment.payload.kind === "mixed") ? segment.payload.notes.length : 0), 0);
  const drumRows = segments.reduce((sum, segment) => sum + (segment.payload.kind === "drum" ? segment.payload.rows.length : 0), 0);
  const drumCells = segments.reduce((sum, segment) => sum + (segment.payload.kind === "drum" ? segment.payload.rows.reduce((rowSum, row) => rowSum + row.steps.length, 0) : 0), 0);
  const automationPoints = countAutomationPoints(document);
  return {
    name: document.project.name,
    ...transform,
    bpm: document.project.bpm,
    tracks: document.project.tracks.length,
    segments: segments.length,
    midiNotes,
    renderedArpeggioNotes,
    drumRows,
    drumCells,
    instruments: document.instruments?.length ?? 0,
    trackEffects: document.project.tracks.reduce((sum, track) => sum + track.effects.filters.length, 0),
    instrumentEffects: (document.instruments ?? []).reduce((sum, instrument) => sum + (instrument.effects?.filters.length ?? 0), 0),
    busEffects: document.project.returnBuses.reduce((sum, bus) => sum + bus.effects.filters.length, 0),
    automationPoints,
  };
}

function countAutomationPoints(document: BeatProjectDocument): number {
  let count = 0;
  for (const track of document.project.tracks) {
    count += track.automation?.reduce((sum, lane) => sum + lane.points.length, 0) ?? 0;
    count += track.effects.filters.reduce((sum, effect) => sum + (effect.automation?.reduce((laneSum, lane) => laneSum + lane.points.length, 0) ?? 0), 0);
    for (const segment of track.segments) {
      count += segment.automation?.reduce((sum, lane) => sum + lane.points.length, 0) ?? 0;
      if (segment.payload.kind === "midi" || segment.payload.kind === "mixed") {
        count += segment.payload.notes.reduce((sum, note) => sum + (note.automation?.reduce((laneSum, lane) => laneSum + lane.points.length, 0) ?? 0), 0);
      }
    }
  }
  for (const bus of document.project.returnBuses) {
    count += bus.automation?.reduce((sum, lane) => sum + lane.points.length, 0) ?? 0;
    count += bus.effects.filters.reduce((sum, effect) => sum + (effect.automation?.reduce((laneSum, lane) => laneSum + lane.points.length, 0) ?? 0), 0);
  }
  return count;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
