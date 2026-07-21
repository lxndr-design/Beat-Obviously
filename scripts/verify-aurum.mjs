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
  assert.equal(instrument.aurum.version, 2, "Aurum RM patches must use schema version 2");
  assert.deepEqual(instrument.aurum.rmMatrix.map((row) => row.length), [6, 6, 6, 6, 6, 6], "Aurum RM matrix must expose six operator destinations");

  const baseline = new Float32Array(4096);
  preview.renderInstrumentSamples(instrument, baseline, 48000, 220, "visual", true);
  const peak = baseline.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
  assert.ok(peak > 0.01 && peak <= 1, `Aurum preview must be audible and bounded, got peak ${peak}`);

  const releasePatch = structuredClone(instrument);
  releasePatch.aurum.matrix = Array.from({ length: 6 }, () => Array(7).fill(0));
  releasePatch.aurum.operators.forEach((operator) => { operator.enabled = false; });
  releasePatch.aurum.operators[0].enabled = true;
  releasePatch.aurum.operators[0].level = 0.8;
  releasePatch.aurum.operators[0].envelope = { attackMs: 0, decayMs: 0, sustain: 1, releaseMs: 20 };
  releasePatch.aurum.operators[1].enabled = true;
  releasePatch.aurum.operators[1].level = 0;
  releasePatch.aurum.operators[1].envelope = { attackMs: 0, decayMs: 0, sustain: 1, releaseMs: 200 };
  releasePatch.aurum.matrix[0][6] = 1;
  const shortRelease = new Float32Array(24000);
  preview.renderInstrumentSamples(releasePatch, shortRelease, 48000, 220, "visual", true);
  releasePatch.aurum.operators[0].envelope.releaseMs = 200;
  const longRelease = new Float32Array(24000);
  preview.renderInstrumentSamples(releasePatch, longRelease, 48000, 220, "visual", true);
  const tailStart = 18000;
  const tailEnd = 21000;
  const shortTailEnergy = shortRelease.slice(tailStart, tailEnd).reduce((sum, sample) => sum + sample * sample, 0);
  const longTailEnergy = longRelease.slice(tailStart, tailEnd).reduce((sum, sample) => sum + sample * sample, 0);
  assert.ok(shortTailEnergy < 0.0001, `Short operator release must finish before the late tail, got energy ${shortTailEnergy}`);
  assert.ok(longTailEnergy > 0.01, `Long operator release must remain audible in the late tail, got energy ${longTailEnergy}`);

  const carrierOnly = structuredClone(instrument);
  carrierOnly.aurum.matrix[1][0] = 0;
  const dry = new Float32Array(4096);
  preview.renderInstrumentSamples(carrierOnly, dry, 48000, 220, "visual", true);
  const difference = baseline.reduce((sum, sample, index) => sum + Math.abs(sample - dry[index]), 0) / baseline.length;
  assert.ok(difference > 0.005, `FM routing must alter the rendered waveform, got mean difference ${difference}`);

  const negativeFm = structuredClone(instrument);
  negativeFm.aurum.matrix[1][0] = -instrument.aurum.matrix[1][0];
  const negativeFmSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(negativeFm, negativeFmSamples, 48000, 220, "visual", true);
  const bipolarFmDifference = baseline.reduce((sum, sample, index) => sum + Math.abs(sample - negativeFmSamples[index]), 0) / baseline.length;
  assert.ok(bipolarFmDifference > 0.005, `Negative FM must invert modulation phase, got mean difference ${bipolarFmDifference}`);

  const invertedOutput = structuredClone(instrument);
  invertedOutput.aurum.matrix[0][6] = -instrument.aurum.matrix[0][6];
  const invertedOutputSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(invertedOutput, invertedOutputSamples, 48000, 220, "visual", true);
  const inversionResidual = baseline.reduce((sum, sample, index) => sum + Math.abs(sample + invertedOutputSamples[index]), 0) / baseline.length;
  assert.ok(inversionResidual < 0.0001, `Negative output sends must phase-invert the rendered carrier, got residual ${inversionResidual}`);

  const dryRm = structuredClone(instrument);
  dryRm.aurum.matrix[1][0] = 0;
  const dryRmSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(dryRm, dryRmSamples, 48000, 220, "visual", false);
  const positiveRm = structuredClone(dryRm);
  positiveRm.aurum.rmMatrix[1][0] = 1;
  const positiveRmSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(positiveRm, positiveRmSamples, 48000, 220, "visual", false);
  const rmDifference = dryRmSamples.reduce((sum, sample, index) => sum + Math.abs(sample - positiveRmSamples[index]), 0) / dryRmSamples.length;
  assert.ok(rmDifference > 0.005, `Ring modulation routing must alter the carrier, got mean difference ${rmDifference}`);
  const negativeRm = structuredClone(dryRm);
  negativeRm.aurum.rmMatrix[1][0] = -1;
  const negativeRmSamples = new Float32Array(4096);
  preview.renderInstrumentSamples(negativeRm, negativeRmSamples, 48000, 220, "visual", false);
  const rmInversionResidual = positiveRmSamples.reduce((sum, sample, index) => sum + Math.abs(sample + negativeRmSamples[index]), 0) / positiveRmSamples.length;
  assert.ok(rmInversionResidual < 0.0001, `Negative full-depth RM must invert the ring-modulated carrier, got residual ${rmInversionResidual}`);

  const stereoPatch = structuredClone(instrument);
  stereoPatch.aurum.unison = 3;
  stereoPatch.aurum.detuneCents = 14;
  stereoPatch.aurum.stereoSpread = 0.8;
  const left = new Float32Array(4096);
  const right = new Float32Array(4096);
  preview.renderInstrumentStereoSamples(stereoPatch, left, right, 48000, 220, "visual", true);
  const stereoDifference = left.reduce((sum, sample, index) => sum + Math.abs(sample - right[index]), 0) / left.length;
  assert.ok(stereoDifference > 0.005, `Aurum spread must create stereo separation, got mean difference ${stereoDifference}`);

  const malformed = aurum.normalizedAurumConfig({ ...instrument.aurum, operators: instrument.aurum.operators.slice(0, 1), matrix: [[4, -4]], rmMatrix: [[4, -4]] });
  assert.equal(malformed.operators.length, 6, "Normalization must restore missing operators");
  assert.equal(malformed.matrix[0][0], 1, "Normalization must clamp matrix values");
  assert.equal(malformed.matrix[0][1], -1, "Normalization must preserve and clamp negative matrix values");
  assert.equal(malformed.matrix[5].length, 7, "Normalization must restore matrix geometry");
  assert.equal(malformed.rmMatrix[0][0], 1, "Normalization must clamp positive RM values");
  assert.equal(malformed.rmMatrix[0][1], -1, "Normalization must preserve and clamp negative RM values");
  assert.equal(malformed.rmMatrix[5].length, 6, "Normalization must restore RM matrix geometry");

  const legacyConfig = structuredClone(instrument.aurum);
  legacyConfig.version = 1;
  delete legacyConfig.rmMatrix;
  const migrated = aurum.normalizedAurumConfig(legacyConfig);
  assert.equal(migrated.version, 2, "Version 1 Aurum patches must migrate to schema version 2");
  assert.ok(migrated.rmMatrix.every((row) => row.length === 6 && row.every((value) => value === 0)), "Migrated patches must add an inactive RM matrix without changing sound");

  assert.equal(interaction.aurumTabIndexAfterKey(0, "ArrowRight"), 1, "Right arrow must advance from Main to OP 1");
  assert.equal(interaction.aurumTabIndexAfterKey(6, "ArrowRight"), 0, "Right arrow must wrap from OP 6 to Main");
  assert.equal(interaction.aurumTabIndexAfterKey(0, "ArrowLeft"), 6, "Left arrow must wrap from Main to OP 6");
  assert.equal(interaction.aurumTabIndexAfterKey(3, "Home"), 0, "Home must select Main");
  assert.equal(interaction.aurumTabIndexAfterKey(3, "End"), 6, "End must select OP 6");

  console.log("Aurum verifier passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
