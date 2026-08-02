#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const requireFromFrontend = createRequire(new URL("../frontend/package.json", import.meta.url));
const { buildSync } = requireFromFrontend("esbuild");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "beat-midi-remix-"));
const output = join(temporaryDirectory, "midiRemix.mjs");
const signature = { num: 4, denom: 4, boldBeats: [1] };
const note = (pitch, startBeat, lengthBeats = 0.4, velocity = 92, extra = {}) => ({ pitch, startBeat, lengthBeats, velocity, ...extra });

try {
  buildSync({
    entryPoints: [join(root, "frontend/src/features/MidiEditor/midiRemix.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const api = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

  const modifierArp = [60, 64, 67].map((pitch) => note(pitch, 0, 4, 96, {
    groupId: "arp-group",
    arpeggiation: { schemaVersion: 1, loops: 4, sequence: "up" },
  }));
  const modifierAnalysis = api.analyzeMidiForRemix(modifierArp, 4, signature);
  assert.equal(modifierAnalysis.kind, "arpeggio", "an existing arpeggiation modifier must classify as an arpeggio");
  assert.match(modifierAnalysis.chords.map((chord) => chord.label).join(" "), /C/, "arpeggiated C major must retain its chord identity");
  const sequenceRemix = api.remixMidiNotes(modifierArp, modifierAnalysis, "arp-sequence", 4);
  assert.ok(sequenceRemix.notes.every((entry) => entry.arpeggiation.sequence === "down"), "sequence remix should update the nondestructive modifier");
  assert.deepEqual(new Set(sequenceRemix.notes.map((entry) => entry.pitch)), new Set([60, 64, 67]), "sequence remix must not invent pitches");

  const drawnArp = Array.from({ length: 12 }, (_, index) => note([60, 64, 67][index % 3], index * 0.25, 0.2));
  const drawnArpAnalysis = api.analyzeMidiForRemix(drawnArp, 4, signature);
  assert.equal(drawnArpAnalysis.kind, "arpeggio", "a dense, regular sequence of chord tones should classify as an arpeggio");
  const invertedArp = api.remixMidiNotes(drawnArp, drawnArpAnalysis, "arp-inversion", 4);
  assert.deepEqual(pitchClasses(invertedArp.notes), pitchClasses(drawnArp), "voicing inversion must preserve chord pitch classes");
  const seventhArp = api.remixMidiNotes(drawnArp, drawnArpAnalysis, "arp-seventh", 4);
  assert.ok(seventhArp.addedNoteCount > 0, "seventh remix should add chord tones");

  const melodicPhrase = [
    note(60, 0, 0.45), note(62, 0.5, 0.45), note(65, 1, 0.8), note(64, 2, 0.8),
  ];
  const melodicLoop = [
    ...melodicPhrase,
    ...melodicPhrase.map((entry) => ({ ...entry, startBeat: entry.startBeat + 4 })),
  ];
  const loopAnalysis = api.analyzeMidiForRemix(melodicLoop, 8, signature, { segmentName: "Hook loop" });
  assert.equal(loopAnalysis.kind, "melodic-loop", "a repeated interval-and-rhythm phrase should classify as a melodic loop");
  assert.equal(loopAnalysis.motif?.repeated, true, "repeated melodic loops should report their motif repetition");

  const bassline = [note(36, 0, 1.5), note(36, 2, 1.4), note(41, 4, 1.5), note(43, 6, 1.5)];
  const bassAnalysis = api.analyzeMidiForRemix(bassline, 8, signature);
  assert.equal(bassAnalysis.kind, "bassline");
  assert.ok(bassAnalysis.chords.every((chord) => /root|center|5/.test(chord.label)), "single-note bass harmony should be described as roots or centers");
  const bassHarmony = api.remixMidiNotes(bassline, bassAnalysis, "bass-harmony", 8);
  assert.equal(bassHarmony.notes.length, bassline.length * 2);
  assert.ok(bassline.every((source) => bassHarmony.notes.some((entry) => sameCore(entry, source))), "bass harmony must retain the original bassline");
  const bassArp = api.remixMidiNotes(bassline, bassAnalysis, "bass-two-note-arp", 8);
  assert.ok(bassArp.notes.some((entry) => bassline.some((source) => entry.pitch === source.pitch + 7)), "two-note bass arpeggiation should add fifths");
  const bassRhythm = api.remixMidiNotes(bassline, bassAnalysis, "bass-rhythm", 8);
  assert.deepEqual(pitchClasses(bassRhythm.notes), pitchClasses(bassline), "bass rhythm remix must preserve pitch identity");

  const chords = [
    ...[60, 64, 67].map((pitch) => note(pitch, 0, 3.75)),
    ...[65, 69, 72].map((pitch) => note(pitch, 4, 3.75)),
    ...[67, 71, 74].map((pitch) => note(pitch, 8, 3.75)),
  ];
  const chordAnalysis = api.analyzeMidiForRemix(chords, 12, signature);
  assert.equal(chordAnalysis.kind, "chord-progression");
  assert.deepEqual(chordAnalysis.chords.map((chord) => chord.label), ["C", "F", "G"]);
  const invertedChords = api.remixMidiNotes(chords, chordAnalysis, "chord-inversion", 12);
  assert.deepEqual(pitchClasses(invertedChords.notes), pitchClasses(chords), "chord inversions must preserve chord pitch classes");
  const seventhChords = api.remixMidiNotes(chords, chordAnalysis, "chord-seventh", 12);
  assert.equal(seventhChords.addedNoteCount, 3, "each triad should receive one seventh");
  const chordComp = api.remixMidiNotes(chords, chordAnalysis, "chord-rhythm", 12);
  assert.ok(chordComp.notes.length > chords.length, "rhythmic comping should add related chord attacks");

  const melody = [
    note(64, 1, 0.5), note(67, 1.5, 0.5), note(69, 2, 1), note(67, 3.5, 0.5),
    note(65, 4, 1.5), note(64, 6, 0.5), note(62, 6.5, 0.5), note(64, 7, 1.5),
    note(71, 9, 0.5), note(69, 9.5, 1), note(67, 11, 0.75), note(64, 12, 2),
  ];
  const structuralMelodyAnalysis = api.analyzeMidiForRemix(melody, 16, signature);
  assert.equal(structuralMelodyAnalysis.kind, "melody-motif", "melody classification should not require naming hints");
  const melodyAnalysis = api.analyzeMidiForRemix(melody, 16, signature, { segmentName: "Bridge melody", trackName: "Lead" });
  assert.equal(melodyAnalysis.kind, "melody-motif");
  assert.equal(melodyAnalysis.label, "Bridge motif");
  assert.ok(melodyAnalysis.motif && melodyAnalysis.motif.endBeat > melodyAnalysis.motif.startBeat, "melody analysis should identify a bounded phrase");
  const invertedMelody = api.remixMidiNotes(melody, melodyAnalysis, "melody-inversion", 16);
  assert.equal(invertedMelody.notes.length, melody.length);
  assert.ok(invertedMelody.notes.every((entry) => pitchClasses(melody).includes(entry.pitch % 12)), "motif inversion must stay inside the source pitch vocabulary");
  assert.deepEqual(invertedMelody.notes.map((entry) => entry.startBeat), melody.map((entry) => entry.startBeat), "motif inversion must preserve rhythm");
  const melodyHarmony = api.remixMidiNotes(melody, melodyAnalysis, "melody-harmony", 16);
  assert.ok(melodyHarmony.notes.length > melody.length);
  assert.ok(melody.every((source) => melodyHarmony.notes.some((entry) => sameCore(entry, source))), "melody harmony must retain the source melody");
  const multivoice = api.remixMidiNotes(melody, melodyAnalysis, "melody-multivoice", 16);
  assert.ok(multivoice.notes.length > melody.length);
  const swung = api.remixMidiNotes(melody, melodyAnalysis, "melody-swing", 16);
  assert.deepEqual(swung.notes.map((entry) => entry.pitch), melody.map((entry) => entry.pitch));
  assert.ok(swung.notes.some((entry, index) => entry.startBeat !== melody[index].startBeat), "swing should move eligible offbeats");

  console.log("MIDI remix classification and transformation verifier passed.");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function pitchClasses(notes) {
  return [...new Set(notes.map((entry) => ((entry.pitch % 12) + 12) % 12))].sort((a, b) => a - b);
}

function sameCore(a, b) {
  return a.pitch === b.pitch && a.startBeat === b.startBeat && a.lengthBeats === b.lengthBeats && a.velocity === b.velocity;
}
