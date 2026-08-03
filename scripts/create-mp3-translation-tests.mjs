#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { build } from "../frontend/node_modules/esbuild/lib/main.js";

const repoRoot = join(import.meta.dirname, "..");
const workRoot = join(repoRoot, "generated-tests/mp3-translations/work");
const outputRoot = join(repoRoot, "generated-tests/mp3-translations");
const python = join(repoRoot, ".venv-transcription/bin/python");
const transkunPython = join(repoRoot, ".venv-transkun/bin/python");
const savedAt = Date.now();

const pianoSources = [
  {
    name: "Mp3_translation_test_1_(classical-piano)",
    composer: "Beethoven",
    bpm: 123.05,
    durationSeconds: 34.961,
    csv: "Classicals.de - Beethoven - Diabelli Variations, Op. 120 - 11 - Variation 10. Presto (C major)_basic_pitch.csv",
    profile: "presto",
  },
  {
    name: "Mp3_translation_test_2_(romantic-piano)",
    composer: "Liszt",
    bpm: 95.70,
    durationSeconds: 244.010,
    midi: "piano-liszt-transkun.mid",
    recoveryCsv: "piano-liszt-recovery/Classicals.de - Liszt, Franz - Consolation No. 3 in D Flat Major - S. 172_basic_pitch.csv",
    profile: "romantic",
  },
  {
    name: "Mp3_translation_test_3_(impressionist-piano)",
    composer: "Ravel",
    bpm: 143.55,
    durationSeconds: 317.256,
    midi: "piano-ravel-transkun.mid",
    recoveryCsv: "piano-ravel-recovery/Classicals.de - Ravel - Jeux d'eau - M. 30_basic_pitch.csv",
    profile: "impressionist",
  },
];

const breakcoreSource = {
  name: "Mp3_translation_test_4_(breakcore)",
  bpm: 235,
  durationSeconds: 264.046,
};

const bundle = await build({
  stdin: {
    resolveDir: join(repoRoot, "frontend/src/state"),
    sourcefile: "mp3-translation-runtime.ts",
    loader: "ts",
    contents: `
      import { createAurumTestInstruments } from "./aurumTestBank.ts";
      import { createTrackEffect } from "./effects.ts";
      import { migrateBeatDocument } from "../persistence/beatDocument.ts";
      import { fusePianoTranscriptions } from "../audio/pianoTranscriptionFusion.ts";
      export { createAurumTestInstruments, createTrackEffect, migrateBeatDocument, fusePianoTranscriptions };
    `,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  external: ["juce-framework-frontend"],
});
const runtimeUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const { createAurumTestInstruments, createTrackEffect, migrateBeatDocument, fusePianoTranscriptions } = await import(runtimeUrl);
const aurumBank = createAurumTestInstruments("user-instruments");

mkdirSync(outputRoot, { recursive: true });

const results = [];
for (const source of pianoSources) {
  let events;
  if (source.midi) {
    const primary = parseMidiNotes(join(workRoot, source.midi));
    const recovery = source.recoveryCsv ? parseBasicPitchCsv(join(workRoot, source.recoveryCsv)) : [];
    const fusion = fusePianoTranscriptions(primary, recovery);
    events = fusion.notes;
    console.log(`${source.name} fusion: ${fusion.primaryCount} Transkun + ${fusion.recoveredCount}/${fusion.recoveryCandidateCount} Basic Pitch recovery votes`);
  } else {
    events = parseBasicPitchCsv(join(workRoot, "piano", source.csv));
  }
  const notes = eventsToMidiNotes(events, source.bpm, false);
  const document = buildPianoDocument(source, notes);
  results.push(writeAndValidate(document, source.durationSeconds));
}

const drumAnalysis = JSON.parse(execFileSync(
  python,
  [join(repoRoot, "scripts/extract-drum-midi.py"), join(workRoot, "breakcore-stems/drums.wav")],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
));
const breakcoreInputs = {
  bass: parseBasicPitchCsv(join(workRoot, "breakcore-midi/bass/bass_basic_pitch.csv")),
  other: parseBasicPitchCsv(join(workRoot, "breakcore-midi/other/other_basic_pitch.csv")),
  vocals: parseBasicPitchCsv(join(workRoot, "breakcore-midi/vocals/vocals_basic_pitch.csv")),
  drums: drumAnalysis.events,
};
const breakcoreDocument = buildBreakcoreDocument(breakcoreSource, breakcoreInputs);
results.push(writeAndValidate(
  breakcoreDocument,
  breakcoreSource.durationSeconds,
));

for (const result of results) {
  console.log(`${result.name}: ${result.bpm.toFixed(2)} BPM, ${result.tracks} playable tracks, ${result.activeSpanBeats.toFixed(1)}-beat active span, MIDI ${result.pitchRange.join("–")}, ${result.effects} effects, ${result.automationLanes} automation lanes`);
}
console.log(`Wrote ${results.length} MIDI-only Beat projects to ${outputRoot}`);

function buildPianoDocument(source, notes) {
  const lowerInstrument = makeInstrument("Aurum_Keys_01", source.name, `${source.composer} Grand · Lower`, source.profile, "lower");
  const upperInstrument = makeInstrument("Aurum_Keys_01", source.name, `${source.composer} Grand · Upper`, source.profile, "upper");
  tunePiano(lowerInstrument, source.profile, "lower");
  tunePiano(upperInstrument, source.profile, "upper");

  const lowerNotes = notes.filter((note) => note.pitch < 60);
  const upperNotes = notes.filter((note) => note.pitch >= 60);
  const lengthBeats = source.durationSeconds * source.bpm / 60;
  const reverb = source.profile === "presto"
    ? { roomSize: 28, damping: 52, mix: 14 }
    : source.profile === "romantic"
      ? { roomSize: 68, damping: 43, mix: 30 }
      : { roomSize: 76, damping: 34, mix: 32 };
  const lowerEffects = [effect(`${source.name}-lower-reverb`, "reverb", reverb)];
  const upperEffects = [
    effect(`${source.name}-upper-reverb`, "reverb", reverb),
    ...(source.profile === "impressionist"
      ? [effect(`${source.name}-upper-delay`, "delay", { timeMs: 167, feedback: 14, mix: 8 })]
      : []),
  ];

  return baseDocument(source.name, source.bpm, lengthBeats, [lowerInstrument, upperInstrument], [
    midiTrack(source.name, "piano-lower", "Piano · Lower Register", lowerInstrument.id, lowerNotes, lengthBeats, lowerEffects, -0.08),
    midiTrack(source.name, "piano-upper", "Piano · Upper Register", upperInstrument.id, upperNotes, lengthBeats, upperEffects, 0.08),
  ], false);
}

function buildBreakcoreDocument(source, inputs) {
  const lengthBeats = source.durationSeconds * source.bpm / 60;
  const drumNotes = Object.fromEntries(["kick", "snare", "hat"].map((kind) => [
    kind,
    inputs.drums
      .filter((event) => event.kind === kind)
      .map((event) => eventToMidiNote(event, source.bpm, false)),
  ]));
  const bassNotes = eventsToMidiNotes(inputs.bass, source.bpm, true);
  const otherNotes = eventsToMidiNotes(inputs.other, source.bpm, true);
  const vocalNotes = eventsToMidiNotes(inputs.vocals, source.bpm, true);
  const bodyNotes = otherNotes.filter((note) => note.pitch < 66);
  const shardNotes = otherNotes.filter((note) => note.pitch >= 66);

  const kick = makeInstrument("Aurum_Percussion_01", source.name, "Aurum Breakcore Kick", "breakcore", "kick");
  const snare = makeInstrument("Aurum_Percussion_01", source.name, "Aurum Breakcore Snare", "breakcore", "snare");
  const hat = makeInstrument("Aurum_Percussion_01", source.name, "Aurum Breakcore Hats", "breakcore", "hat");
  tuneDrum(kick, "kick");
  tuneDrum(snare, "snare");
  tuneDrum(hat, "hat");
  const bass = makeInstrument("Aurum_Bass_01", source.name, "Aurum Transformed Reese", "breakcore", "bass");
  const body = makeInstrument("Aurum_FX_01", source.name, "Aurum Harmonic Body", "breakcore", "body");
  const shards = makeInstrument("Aurum_Lead_01", source.name, "Aurum Shards", "breakcore", "shards");
  const vocals = makeInstrument("Aurum_FX_01", source.name, "Aurum Vocal Fragments", "breakcore", "vocals");
  tuneBreakcoreInstrument(bass, "bass");
  tuneBreakcoreInstrument(body, "body");
  tuneBreakcoreInstrument(shards, "shards");
  tuneBreakcoreInstrument(vocals, "vocals");

  const sweepBeats = [0, 128, 256, 384, 512, 640, 768, 896, lengthBeats];
  const automationValues = [0.24, 0.76, 0.42, 0.9, 0.34, 0.68, 0.48, 0.84, 0.3];
  const bassTrackAutomation = [
    instrumentAutomation("filter.cutoff", sweepBeats, automationValues),
    instrumentAutomation("filter.drive", sweepBeats, automationValues.map((value) => Math.min(1, value + 0.08))),
    instrumentAutomation("macro.1", sweepBeats, automationValues.map((value) => 1 - value * 0.7)),
  ];

  const bassDistortion = effect(`${source.name}-bass-distortion`, "distortion", { drive: 72, shape: 68, trimDb: 8, mix: 78 }, [
    effectAutomation("drive", sweepBeats, automationValues.map((value) => 35 + value * 65)),
    effectAutomation("mix", sweepBeats, automationValues.map((value) => 42 + value * 48)),
  ]);
  const bassLowpass = effect(`${source.name}-bass-lowpass`, "lowpass", { cutoffHz: 2800, resonance: 34 }, [
    effectAutomation("cutoffHz", sweepBeats, automationValues.map((value) => 180 + value * 7200)),
    effectAutomation("resonance", sweepBeats, automationValues.map((value) => 12 + value * 48)),
  ]);
  const bodyCrusher = effect(`${source.name}-body-bitcrush`, "bitcrush", { bits: 7, rate: 44, mix: 46 }, [
    effectAutomation("rate", sweepBeats, automationValues.map((value) => 18 + value * 72)),
    effectAutomation("mix", sweepBeats, automationValues.map((value) => 22 + value * 66)),
  ]);
  const shardDelay = effect(`${source.name}-shards-delay`, "delay", { timeMs: 96, feedback: 42, mix: 31 }, [
    effectAutomation("feedback", sweepBeats, automationValues.map((value) => 18 + value * 68)),
    effectAutomation("mix", sweepBeats, automationValues.map((value) => 12 + value * 52)),
  ]);

  const tracks = [
    midiTrack(source.name, "kick", "Drums · Kick", kick.id, drumNotes.kick, lengthBeats, [effect(`${source.name}-kick-compressor`, "compressor", { thresholdDb: -22, ratio: 5.5, attackMs: 3, releaseMs: 70, makeupDb: 2, mix: 100 })], 0),
    midiTrack(source.name, "snare", "Drums · Snare", snare.id, drumNotes.snare, lengthBeats, [effect(`${source.name}-snare-saturator`, "saturator", { drive: 32, mix: 76 })], 0.05),
    midiTrack(source.name, "hats", "Drums · Hats", hat.id, drumNotes.hat, lengthBeats, [effect(`${source.name}-hat-highpass`, "highpass", { cutoffHz: 3200, resonance: 11 })], 0.12),
    midiTrack(source.name, "bass", "Bass · Transformed Reese", bass.id, bassNotes, lengthBeats, [bassDistortion, bassLowpass, effect(`${source.name}-bass-compressor`, "compressor", { thresholdDb: -25, ratio: 7, attackMs: 5, releaseMs: 90, makeupDb: 3, mix: 100 })], -0.04, bassTrackAutomation),
    midiTrack(source.name, "body", "Harmony · Distorted Body", body.id, bodyNotes, lengthBeats, [bodyCrusher, effect(`${source.name}-body-phaser`, "phaser", { rateHz: 1.3, centerHz: 1100, depthOct: 2.2, feedback: 38, mix: 43 })], -0.16),
    midiTrack(source.name, "shards", "Lead · Shards", shards.id, shardNotes, lengthBeats, [shardDelay, effect(`${source.name}-shards-reverb`, "reverb", { roomSize: 39, damping: 28, mix: 17 })], 0.18),
    midiTrack(source.name, "vocal-fragments", "Texture · Vocal Fragments", vocals.id, vocalNotes, lengthBeats, [effect(`${source.name}-vocal-bitcrush`, "bitcrush", { bits: 10, rate: 67, mix: 28 }), effect(`${source.name}-vocal-delay`, "delay", { timeMs: 128, feedback: 37, mix: 26 })], 0.1),
  ];
  return baseDocument(source.name, source.bpm, lengthBeats, [kick, snare, hat, bass, body, shards, vocals], tracks, true);
}

function baseDocument(name, bpm, lengthBeats, instruments, tracks, masterCompressed) {
  return migrateBeatDocument({
    schemaVersion: 1,
    savedAt,
    project: {
      id: id(name, "project"),
      name,
      bpm,
      timeSignature: { num: 4, denom: 4, boldBeats: [1] },
      lengthBeats,
      tracks,
      returnBuses: [],
      masterEqAutomation: [],
      masterChain: {
        inputGainDb: 0,
        compressorEnabled: masterCompressed,
        compressorThresholdDb: masterCompressed ? -14 : -18,
        compressorRatio: masterCompressed ? 2.8 : 2,
        compressorAttackMs: masterCompressed ? 9 : 20,
        compressorReleaseMs: masterCompressed ? 110 : 160,
        compressorMakeupDb: masterCompressed ? 1.5 : 0,
        compressorMix: 100,
        outputGainDb: masterCompressed ? -1 : 0,
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
    },
    instruments,
    instrumentSets: [],
    audioFiles: [],
    components: [],
    componentFolders: [],
    plugins: [],
    assets: [],
  });
}

function midiTrack(projectName, key, name, instrumentId, notes, lengthBeats, effects, pan = 0, automation = undefined) {
  const trackId = id(projectName, "track", key);
  return {
    id: trackId,
    name,
    kind: "midi",
    instrumentId,
    gainDb: 0,
    pan,
    mute: false,
    solo: false,
    recordArmed: false,
    inputMonitoring: false,
    inputDeviceId: "",
    inputChannelStart: 0,
    inputChannelCount: 2,
    recordGainDb: 0,
    outputEnabled: true,
    automation,
    effects: { filters: effects },
    rowHeight: "normal",
    segments: [{
      id: id(projectName, "segment", key),
      trackId,
      name,
      startBeat: 0,
      lengthBeats,
      repeats: 0,
      layer: 0,
      muted: false,
      instrumentId,
      payload: { kind: "midi", notes, gainDb: 0 },
    }],
  };
}

function makeInstrument(baseName, projectName, name, profile, role) {
  const base = aurumBank.find((instrument) => instrument.name === baseName);
  assert.ok(base, `Missing ${baseName}`);
  const instrument = structuredClone(base);
  instrument.id = id(projectName, "instrument", role);
  instrument.name = name;
  instrument.createdAt = savedAt;
  instrument.updatedAt = savedAt;
  instrument.setId = "user-instruments";
  instrument.source = { kind: "created", label: "MP3 translation test / Aurum", edited: true };
  instrument.descriptors = [...new Set([...(instrument.descriptors ?? []), "mp3-translation", profile, role])];
  instrument.userCreated = true;
  return instrument;
}

function tunePiano(instrument, profile, register) {
  const operators = instrument.aurum.operators;
  const config = {
    presto: { attack: 0.65, decay: 0.72, release: 0.62, cutoff: register === "lower" ? 0.57 : 0.76, drive: 0.08, spread: 0.2 },
    romantic: { attack: 1.35, decay: 1.22, release: 1.75, cutoff: register === "lower" ? 0.5 : 0.67, drive: 0.04, spread: 0.36 },
    impressionist: { attack: 0.82, decay: 1.05, release: 1.42, cutoff: register === "lower" ? 0.61 : 0.84, drive: 0.06, spread: 0.58 },
  }[profile];
  for (const operator of operators) {
    operator.envelope.attackMs *= config.attack;
    operator.envelope.decayMs *= config.decay;
    operator.envelope.releaseMs *= config.release;
  }
  instrument.aurum.filters[0].cutoff = config.cutoff;
  instrument.aurum.filters[0].drive = config.drive;
  instrument.aurum.stereoSpread = config.spread;
  instrument.ampLevel = register === "lower" ? 0.72 : 0.76;
}

function tuneDrum(instrument, kind) {
  const operators = instrument.aurum.operators;
  if (kind === "kick") {
    operators[0].ratio = 0.5;
    operators[0].pitchEnvelopeSemitones = 30;
    operators[0].envelope.decayMs = 145;
    instrument.aurum.filters[0] = { enabled: true, type: "lowpass", cutoff: 0.22, resonance: 0.16, drive: 0.28 };
  } else if (kind === "snare") {
    operators[0].ratio = 1.37;
    operators[1].ratio = 7.1;
    operators[2].ratio = 11.3;
    operators[0].envelope.decayMs = 105;
    instrument.aurum.filters[0] = { enabled: true, type: "bandpass", cutoff: 0.62, resonance: 0.3, drive: 0.24 };
  } else {
    operators[0].ratio = 9.2;
    operators[1].ratio = 13.7;
    operators[2].ratio = 17.1;
    for (const operator of operators) {
      operator.envelope.decayMs = Math.min(operator.envelope.decayMs, 42);
      operator.envelope.releaseMs = Math.min(operator.envelope.releaseMs, 28);
    }
    instrument.aurum.filters[0] = { enabled: true, type: "highpass", cutoff: 0.78, resonance: 0.18, drive: 0.1 };
  }
}

function tuneBreakcoreInstrument(instrument, role) {
  if (role === "bass") {
    instrument.mono = true;
    instrument.legato = true;
    instrument.glideMs = 56;
    instrument.aurum.filters[0].drive = 0.48;
    instrument.aurum.filters[0].resonance = 0.32;
    instrument.aurum.operators[0].wavefold = 0.34;
    instrument.aurum.operators[1].wavefold = 0.52;
  } else if (role === "body") {
    instrument.aurum.oversampling = 4;
    instrument.aurum.filters[0].drive = 0.44;
    instrument.aurum.stereoSpread = 0.68;
  } else if (role === "shards") {
    instrument.mono = false;
    instrument.legato = false;
    instrument.maxVoices = 16;
    instrument.aurum.unison = 4;
    instrument.aurum.detuneCents = 18;
    instrument.aurum.stereoSpread = 0.82;
  } else {
    instrument.aurum.operators[0].wavefold = 0.68;
    instrument.aurum.operators[1].ratio = 1.618;
    instrument.aurum.rmMatrix[1][0] = 0.82;
  }
}

function effect(effectId, kind, params, automation = undefined) {
  return createTrackEffect(kind, { id: id(effectId), params, automation });
}

function effectAutomation(param, beats, values) {
  return {
    param,
    points: beats.map((beat, index) => ({ id: id(param, index, beat), beat, value: values[index], curve: index % 2 === 0 ? "smoothstep" : "linear" })),
  };
}

function instrumentAutomation(target, beats, values) {
  return { target, points: beats.map((beat, index) => ({ beat, value: values[index], curve: index % 2 === 0 ? "smoothstep" : "linear" })) };
}

function parseBasicPitchCsv(path) {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  assert.equal(lines.shift(), "start_time_s,end_time_s,pitch_midi,velocity,pitch_bend", `Unexpected CSV header: ${basename(path)}`);
  return lines.filter(Boolean).map((line) => {
    const values = line.split(",").map(Number);
    return {
      startSeconds: values[0],
      endSeconds: values[1],
      pitch: values[2],
      velocity: values[3],
      pitchBends: values.slice(5),
    };
  }).sort((a, b) => a.startSeconds - b.startSeconds || a.pitch - b.pitch);
}

function parseMidiNotes(path) {
  return JSON.parse(execFileSync(
    transkunPython,
    [join(repoRoot, "scripts/read-midi-notes.py"), path],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  ));
}

function eventsToMidiNotes(events, bpm, preservePitchCurves) {
  return events.map((event) => eventToMidiNote(event, bpm, preservePitchCurves));
}

function eventToMidiNote(event, bpm, preservePitchCurves) {
  const secondsToBeats = bpm / 60;
  const startBeat = event.startSeconds * secondsToBeats;
  const lengthBeats = Math.max(0.015, (event.endSeconds - event.startSeconds) * secondsToBeats);
  const note = {
    pitch: clamp(Math.round(event.pitch), 0, 127),
    velocity: clamp(Math.round(event.velocity), 1, 127),
    startBeat,
    lengthBeats,
  };
  if (preservePitchCurves && Array.isArray(event.pitchBends) && event.pitchBends.length > 1) {
    const minimum = Math.min(...event.pitchBends);
    const maximum = Math.max(...event.pitchBends);
    if (maximum - minimum >= 2) {
      const sampleCount = Math.min(12, event.pitchBends.length);
      note.curve = Array.from({ length: sampleCount }, (_, index) => {
        const sourceIndex = Math.round(index * (event.pitchBends.length - 1) / Math.max(1, sampleCount - 1));
        return {
          beat: startBeat + lengthBeats * index / Math.max(1, sampleCount - 1),
          pitch: clamp(event.pitch + event.pitchBends[sourceIndex] / 3, 0, 127),
        };
      });
    }
  }
  return note;
}

function writeAndValidate(document, durationSeconds) {
  const target = join(outputRoot, `${document.project.name}.beat`);
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  const parsed = migrateBeatDocument(JSON.parse(readFileSync(target, "utf8")));
  const tracks = parsed.project.tracks;
  const notes = tracks.flatMap((track) => track.segments).flatMap((segment) => segment.payload.kind === "midi" ? segment.payload.notes : []);
  const effects = tracks.flatMap((track) => track.effects.filters);
  const automationLanes = tracks.reduce((count, track) => count + (track.automation?.length ?? 0), 0)
    + effects.reduce((count, item) => count + (item.automation?.length ?? 0), 0);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.audioFiles.length, 0);
  assert.equal(parsed.assets.length, 0);
  assert.equal(parsed.plugins.length, 0);
  assert.ok(tracks.every((track) => track.kind === "midi"));
  assert.ok(tracks.every((track) => track.segments.every((segment) => segment.payload.kind === "midi")));
  assert.ok(tracks.every((track) => parsed.instruments.some((instrument) => instrument.id === track.instrumentId)));
  assert.ok(tracks.every((track) => track.segments.some((segment) => segment.payload.kind === "midi" && segment.payload.notes.some((note) => note.lengthBeats > 0))), `${parsed.project.name} contains an empty or silent MIDI track`);
  assert.ok(notes.every((note) => note.pitch >= 0 && note.pitch <= 127 && note.velocity >= 1 && note.velocity <= 127));
  assert.ok(notes.every((note) => note.startBeat >= 0 && note.lengthBeats > 0));
  assert.ok(Math.abs(parsed.project.lengthBeats * 60 / parsed.project.bpm - durationSeconds) < 0.02);
  const serialized = readFileSync(target, "utf8");
  assert.ok(!serialized.includes(".mp3"));
  assert.ok(!serialized.includes(".wav"));
  const activeSpanBeats = Math.max(...notes.map((note) => note.startBeat + note.lengthBeats)) - Math.min(...notes.map((note) => note.startBeat));
  const pitchRange = [Math.min(...notes.map((note) => note.pitch)), Math.max(...notes.map((note) => note.pitch))];
  return { name: parsed.project.name, bpm: parsed.project.bpm, tracks: tracks.length, activeSpanBeats, pitchRange, effects: effects.length, automationLanes };
}

function id(...parts) {
  return parts.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
