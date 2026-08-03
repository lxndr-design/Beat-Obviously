#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-factory-score-samplers-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(esbuild, [
    join(repoRoot, "frontend/src/state/factoryScoreSamplers.ts"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${join(outDir, "factoryScoreSamplers.js")}`,
  ], { stdio: "inherit" });

  const factory = await import(pathToFileURL(join(outDir, "factoryScoreSamplers.js")));
  const bank = factory.createFactoryScoreSamplerBank();
  assert.equal(bank.length, 20, "the score bank should cover 17 orchestral families and three sax registers");
  assert.ok(bank.every((instrument) => instrument.kind === "sampler"), "every score-bank instrument must use sample playback");
  assert.ok(bank.every((instrument) => instrument.samplerComplexity === "performance"), "score samplers should use mapped-performance loading");
  assert.ok(bank.every((instrument) => instrument.source.license === "CC0-1.0"), "the multisample bank must retain its CC0 provenance");

  const mappings = new Map([
    ["Piccolo", "piccolo"],
    ["Alto Flute", "flute"],
    ["English Horn", "oboe"],
    ["E-flat Clarinet", "clarinet"],
    ["Contrabassoon", "bassoon"],
    ["Horns in F", "french_horn"],
    ["Trumpets", "trumpet"],
    ["Trombones", "trombone"],
    ["Tuba", "tuba"],
    ["Harp II", "harp"],
    ["Celesta", "glockenspiel"],
    ["Violins I", "violin_section"],
    ["Violas", "viola_section"],
    ["Cellos", "cello_section"],
    ["Double Basses", "double_bass"],
    ["Timpani", "timpani"],
    ["Tam-tam", "gong"],
    ["Soprano Saxophone", "soprano_saxophone"],
    ["Tenor Saxophone", "tenor_saxophone"],
    ["Baritone Saxophone", "baritone_saxophone"],
    ["Castanets", "castanets"],
  ]);
  for (const [partName, taxonomyId] of mappings) {
    const instrument = factory.createFactoryScoreInstrument(partName, `test-${taxonomyId}`);
    assert.equal(instrument.kind, "sampler", `${partName} must resolve to a sampler`);
    assert.equal(instrument.taxonomy.instrumentId, taxonomyId, `${partName} must resolve to the correct recorded family`);
    assert.ok(instrument.sampleMap.length >= 4, `${partName} should retain multiple mapped zones`);
  }

  const unpitchedMappings = new Map([
    ["Orchestral Bass Drum", "/samples/vsco-ce/bass-drum.wav"],
    ["Closed Hi-Hat", "/samples/pearl-master-studio/hihat-closed.wav"],
    ["Open Hi-Hat", "/samples/pearl-master-studio/hihat-open.wav"],
    ["Ride Cymbal", "/samples/pearl-master-studio/ride-01.wav"],
    ["Crash Cymbal", "/samples/pearl-master-studio/crash-01.wav"],
    ["Low Tom", "/samples/pearl-master-studio/tom-03.wav"],
    ["Mid Tom", "/samples/pearl-master-studio/tom-02.wav"],
    ["High Tom", "/samples/pearl-master-studio/tom-01.wav"],
  ]);
  for (const [partName, sampleUrl] of unpitchedMappings) {
    const instrument = factory.createFactoryScoreInstrument(partName, `test-${partName.toLowerCase().replaceAll(" ", "-")}`);
    assert.equal(instrument.kind, "sampler", `${partName} must resolve to a sampler`);
    assert.equal(instrument.sampleUrl, sampleUrl, `${partName} must resolve to its dedicated recorded hit`);
    assert.ok(statSync(join(repoRoot, "frontend/public", sampleUrl)).size > 20_000, `${partName} recording must be present`);
  }

  let uniqueAudioBytes = 0;
  const visited = new Set();
  for (const instrument of bank) {
    const zones = instrument.sampleMap;
    assert.ok(zones.length >= 4, `${instrument.name} should contain a mapped sample set`);
    const minPitch = Math.min(...zones.map((zone) => zone.loNote));
    const maxPitch = Math.max(...zones.map((zone) => zone.hiNote));
    for (const pitch of [minPitch, Math.round((minPitch + maxPitch) / 2), maxPitch]) {
      for (const velocity of [1, 40, 64, 96, 127]) {
        const matches = zones.filter((zone) => pitch >= zone.loNote && pitch <= zone.hiNote
          && velocity >= zone.loVel && velocity <= zone.hiVel);
        assert.equal(matches.length, 1, `${instrument.name} pitch ${pitch} velocity ${velocity} should resolve once`);
      }
    }
    for (const path of new Set(zones.map((zone) => zone.path))) {
      if (visited.has(path)) continue;
      visited.add(path);
      const asset = join(repoRoot, "frontend/public", path);
      const stat = statSync(asset);
      uniqueAudioBytes += stat.size;
      assert.ok(stat.size > 20_000, `${path} should be a complete recording`);
      assert.equal(readFileSync(asset).subarray(0, 4).toString("ascii"), "RIFF", `${path} should be WAV audio`);
    }
  }
  assert.ok(uniqueAudioBytes > 400 * 1024 * 1024, "the high-definition score bank should retain more than 400 MiB of recordings");
  assert.ok(uniqueAudioBytes < 480 * 1024 * 1024, "the curated score bank should stay below its 480 MiB package budget");

  const sheetBuilder = readFileSync(join(repoRoot, "scripts/create-sheet-to-song-tests.mjs"), "utf8");
  assert.match(sheetBuilder, /createFactoryScoreInstrument/, "sheet-to-song fixtures must use the same production sampler routing");
  assert.doesNotMatch(sheetBuilder, /kind:\s*"synth"\s+as const/, "sheet-to-song fixtures must not synthesize fake orchestra patches");

  console.log(`Factory score sampler verifier passed (${bank.length} families, ${visited.size} recordings, ${(uniqueAudioBytes / 1024 / 1024).toFixed(1)} MiB).`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
