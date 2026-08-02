#!/usr/bin/env node
import assert from "node:assert/strict";
import { build } from "../frontend/node_modules/esbuild/lib/main.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const source = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

const homeSource = source("frontend/src/features/HomeHub/HomeHub.solid.tsx");
const modalSource = source("frontend/src/features/HomeHub/StartFromSomethingModal.solid.tsx");
const actionSource = source("frontend/src/ai/generateSongAction.ts");
const documentActionSource = source("frontend/src/persistence/documentActions.ts");
const storeSource = source("frontend/src/state/store.ts");

assert.match(homeSource, /Start from Something/);
assert.match(modalSource, /SONG_SPEEDS/);
assert.match(modalSource, /SONG_GENRES/);
assert.match(modalSource, /SONG_RANDOMNESS_LEVELS/);
assert.match(modalSource, /Create Unsaved Project/);
assert.match(actionSource, /addInstrument\(/, "every generated voice must receive a newly created instrument");
assert.doesNotMatch(actionSource, /findMatchingInstrument|saveCurrentDocument|project\.saveFile|createDirectory/);
assert.match(actionSource, /createNewDocument\(\)/);
assert.match(documentActionSource, /markUnsavedNewDocument\(\)/);
assert.match(storeSource, /markUnsavedNewDocument:[\s\S]{0,180}currentFilePath: null/);
const behavioralCheck = await build({
  stdin: {
    resolveDir: join(repoRoot, "frontend/src/ai"),
    sourcefile: "song-generation-check.ts",
    loader: "ts",
    contents: `
      import assert from "node:assert/strict";
      import {
        articulateBassHarmonicSpans,
        complicateMelody,
        deriveBassHarmonicSpans,
        generateSongPlan,
        invertMelody,
        simplifyMelody,
      } from "./songGenerator.ts";

      const plan = generateSongPlan({ style: "small jazz quartet in Bb major", key: "Bb major", seed: 421 });
      assert.equal(plan.form, "aaba");
      assert.equal(plan.sections.length, 4);
      assert.equal(plan.lengthBeats, 64);
      assert.ok(plan.seedMelody.some((note) => note.startBeat < 8));
      assert.ok(plan.seedMelody.some((note) => note.startBeat >= 8), "seed melody must contain two phrases");
      assert.deepEqual(plan.pitchNicheIssues, []);
      assert.deepEqual(Object.keys(plan.variations).sort(), ["chords", "complication", "extrapolation", "inversion", "simplification", "statement"].sort());

      const lead = plan.voices.find((voice) => voice.role === "lead");
      assert.ok(lead);
      assert.equal(lead.instrument.preferredName, "Tenor Sax");
      assert.equal(lead.instrument.acquisition?.license, "CC0-1.0");
      for (const voice of plan.voices) {
        for (const segment of voice.segments) {
          for (const note of segment.notes) {
            assert.ok(note.pitch >= voice.pitchRange[0] && note.pitch <= voice.pitchRange[1]);
          }
        }
      }

      const seed = plan.seedMelody;
      assert.equal(invertMelody(seed, seed[0].pitch)[0].pitch, seed[0].pitch);
      assert.ok(simplifyMelody(seed).length < seed.length);
      assert.ok(complicateMelody(seed, [60, 62, 64, 65, 67, 69, 71]).length > seed.length);

      const low = generateSongPlan({ genre: "jazz", speed: "medium", randomness: "low", seed: 421 });
      const lowLead = low.voices.find((voice) => voice.role === "lead");
      assert.equal(low.motifCount, 1);
      assert.ok((lowLead?.segments[0].repeats ?? 0) >= 1, "low-randomness adjacent identical A sections must use Beat's repeat count");

      const passive = generateSongPlan({ genre: "electronic", speed: "passive", randomness: "medium", seed: 22 });
      assert.equal(passive.bpm, 62);
      assert.ok(passive.voices.find((voice) => voice.role === "rhythm")?.segments.every((segment) => segment.notes.length === 0));
      assert.ok(passive.voices.find((voice) => voice.role === "lead")?.segments.flatMap((segment) => segment.notes).some((note) => note.lengthBeats >= 1.5));

      const mediumPop = generateSongPlan({ genre: "pop", speed: "medium", randomness: "medium", seed: 23 });
      assert.equal(mediumPop.bpm, 114);
      assert.equal(mediumPop.targetLoudnessLufs, -10);
      const popLeadNotes = mediumPop.voices.find((voice) => voice.role === "lead")?.segments.flatMap((segment) => segment.notes) ?? [];
      const popHarmonyNotes = mediumPop.voices.find((voice) => voice.role === "harmony")?.segments.flatMap((segment) => segment.notes) ?? [];
      const popBassNotes = mediumPop.voices.find((voice) => voice.role === "bass")?.segments.flatMap((segment) => segment.notes) ?? [];
      assert.ok(new Set(popLeadNotes.map((note) => note.lengthBeats)).size > new Set(popHarmonyNotes.map((note) => note.lengthBeats)).size,
        "lead must have more duration variance than the repeating accompaniment cell");
      assert.ok(new Set(popLeadNotes.map((note) => note.pitch)).size > new Set(popBassNotes.map((note) => note.pitch)).size,
        "lead must explore more pitches than bass");
      assert.ok(popBassNotes.some((note, index) => popBassNotes.slice(index + 1).some((other) => other.pitch === note.pitch && other.startBeat !== note.startBeat)),
        "bass must rhythmically retrigger a stable harmonic pitch");
      assert.ok(popBassNotes.reduce((sum, note) => sum + note.lengthBeats, 0) / popBassNotes.length
        > popLeadNotes.reduce((sum, note) => sum + note.lengthBeats, 0) / popLeadNotes.length,
        "bass articulations must be longer on average than melody notes");

      const bassSpans = deriveBassHarmonicSpans([
        { pitch: 48, velocity: 80, startBeat: 0, lengthBeats: 3.5 },
        { pitch: 52, velocity: 72, startBeat: 0, lengthBeats: 3.5 },
        { pitch: 48, velocity: 84, startBeat: 4, lengthBeats: 3.5 },
        { pitch: 55, velocity: 78, startBeat: 8, lengthBeats: 3.5 },
      ]);
      assert.deepEqual(bassSpans.map(({ pitch, startBeat, lengthBeats }) => ({ pitch, startBeat, lengthBeats })), [
        { pitch: 48, startBeat: 0, lengthBeats: 8 },
        { pitch: 55, startBeat: 8, lengthBeats: 8 },
      ], "adjacent repeated roots must be understood as one harmonic pitch span before articulation");
      const articulatedSpans = articulateBassHarmonicSpans(bassSpans, "medium");
      assert.deepEqual(articulatedSpans.map((note) => note.startBeat), [0, 2.5, 4, 6.5, 8, 10.5, 12, 14.5],
        "bass rhythm must repeat at a fixed four-beat cell without stretching to the harmonic span length");
      assert.deepEqual([...new Set(articulatedSpans.slice(0, 4).map((note) => note.pitch))], [36],
        "rhythmic retriggers inside one harmonic span must retain one pitch");

      const hyper = generateSongPlan({ genre: "dnb", speed: "hyper", randomness: "high", seed: 24 });
      assert.ok(hyper.bpm >= 184);
      assert.equal(hyper.motifCount, 3);
      assert.ok(hyper.rhythmShiftCount >= 2);
      assert.ok(hyper.keyShiftCount >= 2);
      const hyperRhythmNotes = hyper.voices.find((voice) => voice.role === "rhythm")?.segments.flatMap((segment) => segment.notes) ?? [];
      assert.ok(hyperRhythmNotes.length > 80, "hyper rhythm must be dense and chopped rather than a medium pulse at a higher BPM");
    `,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});

const encoded = Buffer.from(behavioralCheck.outputFiles[0].text).toString("base64");
await import(`data:text/javascript;base64,${encoded}`);
console.log("Song generation verification passed: role-specific melody, accompaniment, bass-span articulation, Start from Something settings, unsaved-file safeguards, instruments, forms, loops, and pitch niches are valid.");
