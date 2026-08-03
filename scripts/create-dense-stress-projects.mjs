#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = join(import.meta.dirname, "..");
const outputDirectory = join(repoRoot, "generated-tests");
const assetDirectory = join(outputDirectory, "dense-assets");
const tempDirectory = join(tmpdir(), `beat-dense-projects-${Date.now()}`);
mkdirSync(outputDirectory, { recursive: true });
mkdirSync(assetDirectory, { recursive: true });
mkdirSync(tempDirectory, { recursive: true });

try {
  const bundlePath = join(tempDirectory, "denseStressProjects.js");
  execFileSync(join(repoRoot, "frontend/node_modules/.bin/esbuild"), [
    join(repoRoot, "frontend/src/testing/denseStressProjects.ts"),
    "--bundle", "--format=esm", "--platform=node", `--outfile=${bundlePath}`,
  ], { stdio: "inherit" });
  const audioPath = join(assetDirectory, "dense-pulse.wav");
  writePulseWav(audioPath);
  const builder = await import(pathToFileURL(bundlePath));
  const metrics = [];
  for (const index of [1, 2, 3]) {
    const started = performance.now();
    const result = builder.buildDenseStressProject(index, audioPath);
    const serialized = JSON.stringify(result.document, null, 2);
    const outputPath = join(outputDirectory, `dense_${index}.beat`);
    writeFileSync(outputPath, serialized);
    const parsed = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(parsed.project.name, `dense_${index}`);
    assert.ok(parsed.project.tracks.length > 0);
    metrics.push({ ...result.metrics, fileBytes: Buffer.byteLength(serialized), writeAndVerifyMs: performance.now() - started });
  }
  writeFileSync(join(outputDirectory, "dense-project-fixture-metrics.json"), JSON.stringify({ generatedAt: new Date().toISOString(), projects: metrics }, null, 2));
  console.table(metrics.map((metric) => ({
    project: metric.name,
    tier: metric.tier,
    bpm: metric.bpm,
    tracks: metric.tracks,
    segments: metric.segments,
    notes: metric.midiNotes,
    renderedArpNotes: metric.renderedArpeggioNotes,
    drumRows: metric.drumRows,
    drumCells: metric.drumCells,
    fx: metric.trackEffects + metric.instrumentEffects + metric.busEffects,
    automationPoints: metric.automationPoints,
    fileMB: Number((metric.fileBytes / 1024 / 1024).toFixed(2)),
    buildMs: Number(metric.writeAndVerifyMs.toFixed(1)),
  })));
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

function writePulseWav(path) {
  const sampleRate = 48000;
  const seconds = 2;
  const channels = 2;
  const frames = sampleRate * seconds;
  const dataBytes = frames * channels * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const envelope = Math.exp(-(frame % 6000) / 1800);
    const sample = Math.max(-1, Math.min(1, Math.sin(2 * Math.PI * 110 * frame / sampleRate) * envelope * 0.28));
    const intSample = Math.round(sample * 32767);
    buffer.writeInt16LE(intSample, 44 + frame * 4);
    buffer.writeInt16LE(intSample, 46 + frame * 4);
  }
  writeFileSync(path, buffer);
}
