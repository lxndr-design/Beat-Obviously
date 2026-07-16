#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-aether-benchmark-renders-${Date.now()}`);
const benchmarkIds = [
  "factory.benchmark-future-bass-strings",
  "factory.benchmark-progressive-house-strings",
];
const sampleRates = [44100, 48000, 96000];

// These hashes freeze the production frontend render path for the two imported
// benchmark instruments. Changes must be investigated and documented before
// updating them; the verifier intentionally has no record/update mode.
const expectedHashes = {
  "factory.benchmark-future-bass-strings@44100": "83ea6ab647f7f5edc7a4149e92636161505e9b89f0ae4685e1caf824c3a47c8d",
  "factory.benchmark-future-bass-strings@48000": "270a4e390e6bd0795b582484d7bb70de15aceb215e7e5ff3b8ec674a354c5137",
  "factory.benchmark-future-bass-strings@96000": "0a7322e18956696b93a308ff7e9a54b0d228ebc04b5a7cdf9812d261e33dc6b9",
  "factory.benchmark-progressive-house-strings@44100": "7c2b033c5213ea88bc7b7663fdd2bfc9900cfee15f529c67bf458256a3f65631",
  "factory.benchmark-progressive-house-strings@48000": "f61237b9fec7a1e91acd0f60f233c2e94604be34599647cb50a73389698dfaad",
  "factory.benchmark-progressive-house-strings@96000": "9a2d40fe8535b9567bb9c5d4d56c33874224d11f42844fc57b3651fbeeb77afe",
};

function renderMetrics(samples) {
  let sum = 0;
  let sumSquares = 0;
  let peak = 0;
  let maxDiscontinuity = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    assert.equal(Number.isFinite(sample), true, `non-finite sample at ${index}`);
    sum += sample;
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
    if (index > 0) maxDiscontinuity = Math.max(maxDiscontinuity, Math.abs(sample - samples[index - 1]));
  }
  const tailStart = Math.floor(samples.length * 0.75);
  let tailSquares = 0;
  for (let index = tailStart; index < samples.length; index += 1)
    tailSquares += samples[index] * samples[index];
  return {
    rms: Math.sqrt(sumSquares / samples.length),
    peak,
    dcMean: sum / samples.length,
    maxDiscontinuity,
    tailRms: Math.sqrt(tailSquares / (samples.length - tailStart)),
    sha256: createHash("sha256")
      .update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
      .digest("hex"),
  };
}

mkdirSync(outDir, { recursive: true });
try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(esbuild, [
    join(repoRoot, "frontend/src/state/synthStore.ts"),
    join(repoRoot, "frontend/src/audio/synthPreview.ts"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outdir=${outDir}`,
  ], { stdio: "inherit" });

  const synthStore = await import(pathToFileURL(join(outDir, "state/synthStore.js")));
  const synthPreview = await import(pathToFileURL(join(outDir, "audio/synthPreview.js")));
  const rows = [];
  const hashMismatches = [];

  for (const id of benchmarkIds) {
    const preset = synthStore.FACTORY_SYNTH_PRESETS.find((candidate) => candidate.id === id);
    assert.ok(preset, `missing benchmark preset ${id}`);
    assert.match(preset.name, /^Benchmark - /);
    const instrument = synthStore.synthDraftToPreviewInstrument(preset.patch);

    for (const sampleRate of sampleRates) {
      const sampleCount = sampleRate * 2;
      const first = new Float32Array(sampleCount);
      const second = new Float32Array(sampleCount);
      const frequency = synthPreview.previewFrequency(instrument);
      synthPreview.renderInstrumentSamples(instrument, first, sampleRate, frequency, "audio", true);
      synthPreview.renderInstrumentSamples(instrument, second, sampleRate, frequency, "audio", true);
      const firstMetrics = renderMetrics(first);
      const secondMetrics = renderMetrics(second);
      const key = `${id}@${sampleRate}`;

      assert.equal(firstMetrics.sha256, secondMetrics.sha256, `${key} repeated render hash drift`);
      assert.ok(firstMetrics.rms > 0.005, `${key} RMS is not audibly above silence: ${firstMetrics.rms}`);
      assert.ok(firstMetrics.peak > 0.02, `${key} peak is not audibly above silence: ${firstMetrics.peak}`);
      assert.ok(firstMetrics.peak < 0.99, `${key} peak is too close to full scale: ${firstMetrics.peak}`);
      assert.ok(firstMetrics.tailRms > 0.001, `${key} sustained-string tail is silent: ${firstMetrics.tailRms}`);
      assert.ok(Math.abs(firstMetrics.dcMean) < 0.05, `${key} DC mean is unexpectedly high: ${firstMetrics.dcMean}`);
      assert.ok(firstMetrics.maxDiscontinuity < 1.0, `${key} adjacent-sample discontinuity is unexpectedly high: ${firstMetrics.maxDiscontinuity}`);
      if (expectedHashes[key] !== firstMetrics.sha256)
        hashMismatches.push({ key, expected: expectedHashes[key] ?? null, actual: firstMetrics.sha256 });
      rows.push({ id, name: preset.name, sampleRate, sampleCount, frequency, ...firstMetrics });
    }
  }

  for (const sampleRate of sampleRates) {
    const hashes = rows.filter((row) => row.sampleRate === sampleRate).map((row) => row.sha256);
    assert.equal(new Set(hashes).size, benchmarkIds.length, `benchmark instruments collapsed to identical output at ${sampleRate} Hz`);
  }

  console.log(JSON.stringify({ ok: true, rows }, null, 2));
  assert.deepEqual(hashMismatches, [], `benchmark render hash changes require review:\n${JSON.stringify(hashMismatches, null, 2)}`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
