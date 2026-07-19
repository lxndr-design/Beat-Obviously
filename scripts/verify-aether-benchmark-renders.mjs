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
  "factory.benchmark-future-bass-strings@44100": "3b7a16c8a03c69167501836515a5e12a47eb049f1fb95c6c056a4a9dab5762dc",
  "factory.benchmark-future-bass-strings@48000": "6acf60e7ceb29c4090fe02de05f2e9ff9a8bca50d041d0f41e76b5a2a8aa0392",
  "factory.benchmark-future-bass-strings@96000": "abdfc817fe31489e70ab5ba5bf0cfe064f6ac650f93c711f43d5bf2de38d00c7",
  "factory.benchmark-progressive-house-strings@44100": "1397453a4578c86211206e4230a5a351ec467f14d459edc70ec63e1e407964a9",
  "factory.benchmark-progressive-house-strings@48000": "ad36495fa5321471891136df4e4485c8613368fb653f2518c4639746816fc000",
  "factory.benchmark-progressive-house-strings@96000": "d287fd1128f43f4c3b3b3ad11eb47203e8580be07277007bd229c881b4694bf8",
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
