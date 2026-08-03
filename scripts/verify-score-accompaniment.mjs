#!/usr/bin/env node
import assert from "node:assert/strict";
import { join } from "node:path";
import { build } from "../frontend/node_modules/esbuild/lib/main.js";

const repoRoot = join(import.meta.dirname, "..");
const compiled = await build({
  stdin: {
    resolveDir: join(repoRoot, "frontend/src"),
    sourcefile: "score-accompaniment-check.ts",
    loader: "ts",
    contents: `export { generateScoreAccompaniment } from "./scoreImport/scoreAccompaniment.ts";`,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const encoded = Buffer.from(compiled.outputFiles[0].text).toString("base64");
const { generateScoreAccompaniment } = await import(`data:text/javascript;base64,${encoded}`);

const note = (pitch, startBeat, lengthBeats = 1, velocity = 92) => ({ pitch, startBeat, lengthBeats, velocity });
const cMajorToDMinor = [
  note(48, 0, 2), note(60, 0, 2), note(64, 0, 2), note(67, 0, 2),
  note(50, 2, 2), note(62, 2, 2), note(65, 2, 2), note(69, 2, 2),
];
const harmonic = generateScoreAccompaniment({
  notes: cMajorToDMinor,
  lengthBeats: 4,
  bpm: 100,
  timeSignature: { num: 4, denom: 4, boldBeats: [1] },
  keySignatureFifths: 0,
});
assert.equal(harmonic.key.label, "C major");
assert.deepEqual(harmonic.chords.map((chord) => chord.label), ["C", "Dm"], "major/minor chord quality must follow the actual score voices");
assert.deepEqual(harmonic.bassNotes.map((entry) => entry.pitch % 12), [0, 2], "bass roots must follow inferred chord roots");
assert.equal(harmonic.bassPhrases.length, 1, "a short bass idea should remain one editable phrase");

const sparse = generateScoreAccompaniment({
  notes: [note(60, 0, 4), note(64, 8, 4)],
  lengthBeats: 16,
  bpm: 62,
  timeSignature: { num: 4, denom: 4, boldBeats: [1] },
  keySignatureFifths: 0,
});
assert.ok(sparse.drumPhrases.every((phrase) => phrase.style === "ambient-pulse"), "slow sustained material should use sparse ambient percussion");
assert.ok(sparse.drumPhrases.every((phrase) => phrase.sourceLengthBeats / phrase.speed === phrase.lengthBeats), "drum source loops must preserve their source duration");
assert.ok(sparse.drumPhrases.some((phrase) => phrase.repeats > 0), "complete score sections should reuse compact drum loops");
assert.ok(sparse.drumPhrases.every((phrase) => phrase.swingPercent > 50), "slow accompaniment should retain a human, non-mechanical pulse");
assertDynamicPerformance(sparse.drumPhrases[0], "sparse orchestral accompaniment");

const denseNotes = Array.from({ length: 128 }, (_, index) => note(60 + (index % 8), index / 8, 0.1, 76 + index % 24));
const dense = generateScoreAccompaniment({
  notes: denseNotes,
  lengthBeats: 16,
  bpm: 174,
  timeSignature: { num: 4, denom: 4, boldBeats: [1] },
  keySignatureFifths: 0,
});
assert.ok(dense.drumPhrases.every((phrase) => phrase.style === "driving"), "fast dense melodic material should produce a driving drum feel");
assert.ok(dense.drumPhrases.every((phrase) => phrase.rows.some((row) => row.role === "snare" && row.steps.some(Boolean))), "generated drum phrases must contain audible backbeat structure");
assert.ok(dense.drumPhrases.every((phrase) => phrase.sourceLengthBeats / phrase.speed === phrase.lengthBeats), "fast drum grids must retain a valid loop duration");
assertDynamicPerformance(dense.drumPhrases[0], "driving accompaniment");

const continuous = generateScoreAccompaniment({
  notes: Array.from({ length: 96 }, (_, index) => note(60 + (index % 5), index * 0.5, 0.25, 96)),
  lengthBeats: 48,
  bpm: 96,
  timeSignature: { num: 4, denom: 4, boldBeats: [1] },
  keySignatureFifths: 0,
});
assert.equal(continuous.drumPhrases.length, 1, "identical adjacent grooves should compact into one loop segment");
assert.equal(continuous.drumPhrases[0].lengthBeats, 4, "the compact drum source should remain one bar rather than a giant grid");
assert.equal(continuous.drumPhrases[0].repeats, 11, "the one-bar source should play across the full 48-beat section");
assert.equal(continuous.drumPhrases[0].lengthBeats * (continuous.drumPhrases[0].repeats + 1), 48, "loop repetitions must cover the complete continuous section");

console.log("Score accompaniment verification passed: harmony, full-duration drum grids, dynamic accents, human timing, and tempo-aware styles are preserved.");

function assertDynamicPerformance(phrase, label) {
  const hits = phrase.rows.flatMap((row) => row.steps.filter((step) => typeof step === "object" && step?.on));
  const velocities = hits.map((step) => step.velocity).filter(Number.isFinite);
  assert.ok(phrase.rows.length >= 3, `${label} should orchestrate at least three percussion roles`);
  assert.ok(velocities.length > 0, `${label} should carry per-hit dynamics`);
  assert.ok(Math.max(...velocities) - Math.min(...velocities) >= 20, `${label} should contain audible accents and supporting strokes`);
  assert.ok(Math.min(...velocities) >= 42, `${label} should not generate effectively inaudible percussion hits`);
  assert.ok(phrase.swingPercent !== 50 || hits.some((step) => Number.isFinite(step.leanPercent) && step.leanPercent !== 0), `${label} should contain swing or microtiming instead of a rigid grid`);
}
