#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-aurum-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(esbuild, [
    join(repoRoot, "frontend/src/state/aurum.ts"),
    join(repoRoot, "frontend/src/audio/synthPreview.ts"),
    join(repoRoot, "frontend/src/features/Aurum/aurumEditorInteraction.ts"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outdir=${outDir}`,
  ], { stdio: "inherit" });

  const aurum = await import(pathToFileURL(join(outDir, "state/aurum.js")));
  const preview = await import(pathToFileURL(join(outDir, "audio/synthPreview.js")));
  const interaction = await import(pathToFileURL(join(outDir, "features/Aurum/aurumEditorInteraction.js")));
  const instrument = aurum.createAurumInstrument("aurum-verifier", "Aurum Verifier");

  assert.equal(instrument.aurum.operators.length, 6, "Aurum must expose six operators");
  assert.deepEqual(instrument.aurum.matrix.map((row) => row.length), [7, 7, 7, 7, 7, 7], "Aurum matrix must expose six destinations plus output");
  assert.equal(instrument.aurum.matrix[1][0], 0.42, "Default patch must route OP 2 into OP 1");
  assert.equal(instrument.aurum.matrix[0][6], 0.86, "Default patch must route OP 1 to output");

  const baseline = new Float32Array(4096);
  preview.renderInstrumentSamples(instrument, baseline, 48000, 220, "visual", true);
  const peak = baseline.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
  assert.ok(peak > 0.01 && peak <= 1, `Aurum preview must be audible and bounded, got peak ${peak}`);

  const carrierOnly = structuredClone(instrument);
  carrierOnly.aurum.matrix[1][0] = 0;
  const dry = new Float32Array(4096);
  preview.renderInstrumentSamples(carrierOnly, dry, 48000, 220, "visual", true);
  const difference = baseline.reduce((sum, sample, index) => sum + Math.abs(sample - dry[index]), 0) / baseline.length;
  assert.ok(difference > 0.005, `FM routing must alter the rendered waveform, got mean difference ${difference}`);

  const stereoPatch = structuredClone(instrument);
  stereoPatch.aurum.unison = 3;
  stereoPatch.aurum.detuneCents = 14;
  stereoPatch.aurum.stereoSpread = 0.8;
  const left = new Float32Array(4096);
  const right = new Float32Array(4096);
  preview.renderInstrumentStereoSamples(stereoPatch, left, right, 48000, 220, "visual", true);
  const stereoDifference = left.reduce((sum, sample, index) => sum + Math.abs(sample - right[index]), 0) / left.length;
  assert.ok(stereoDifference > 0.005, `Aurum spread must create stereo separation, got mean difference ${stereoDifference}`);

  const malformed = aurum.normalizedAurumConfig({ ...instrument.aurum, operators: instrument.aurum.operators.slice(0, 1), matrix: [[4]] });
  assert.equal(malformed.operators.length, 6, "Normalization must restore missing operators");
  assert.equal(malformed.matrix[0][0], 1, "Normalization must clamp matrix values");
  assert.equal(malformed.matrix[5].length, 7, "Normalization must restore matrix geometry");

  assert.equal(interaction.aurumTabIndexAfterKey(0, "ArrowRight"), 1, "Right arrow must advance from Main to OP 1");
  assert.equal(interaction.aurumTabIndexAfterKey(6, "ArrowRight"), 0, "Right arrow must wrap from OP 6 to Main");
  assert.equal(interaction.aurumTabIndexAfterKey(0, "ArrowLeft"), 6, "Left arrow must wrap from Main to OP 6");
  assert.equal(interaction.aurumTabIndexAfterKey(3, "Home"), 0, "Home must select Main");
  assert.equal(interaction.aurumTabIndexAfterKey(3, "End"), 6, "End must select OP 6");

  console.log("Aurum verifier passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
