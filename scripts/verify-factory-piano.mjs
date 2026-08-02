#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-factory-piano-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

function read(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(esbuild, [
    join(repoRoot, "frontend/src/state/factoryPiano.ts"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${join(outDir, "factoryPiano.js")}`,
  ], { stdio: "inherit" });

  const factoryPiano = await import(pathToFileURL(join(outDir, "factoryPiano.js")));
  const piano = factoryPiano.createSalamanderCompactGrand("factory-keys");
  const zones = piano.sampleMap;

  assert.equal(piano.kind, "sampler", "factory grand must use sample playback");
  assert.equal(piano.samplerComplexity, "performance", "factory grand should expose the mapped-performance sampler editor");
  assert.equal(zones.length, 36, "compact grand should contain nine roots by four velocity layers");
  assert.equal(new Set(zones.map((zone) => zone.path)).size, 36, "every zone should use a distinct recorded sample");
  assert.equal(piano.sampleUrl, "/samples/salamander-compact/C4v10.flac", "central representative sample should be C4 mezzo-forte");
  assert.equal(piano.source.license, "CC BY 3.0", "factory attribution must retain the upstream license");
  assert.equal(piano.taxonomy.instrumentId, "grand_piano", "factory instrument should use the acoustic grand taxonomy");

  for (const velocity of [1, 31, 32, 63, 64, 95, 96, 127]) {
    for (let pitch = 21; pitch <= 108; pitch += 1) {
      const matches = zones.filter((zone) => (
        pitch >= zone.loNote && pitch <= zone.hiNote
        && velocity >= zone.loVel && velocity <= zone.hiVel
      ));
      assert.equal(matches.length, 1, `pitch ${pitch} velocity ${velocity} should resolve to exactly one zone`);
      assert.ok(Math.abs(matches[0].rootNote - pitch) <= 6, `pitch ${pitch} should never transpose one recording more than six semitones`);
    }
  }

  let totalBytes = 0;
  for (const zone of zones) {
    const assetPath = join(repoRoot, "frontend/public", zone.path);
    const stat = statSync(assetPath);
    totalBytes += stat.size;
    assert.ok(stat.size > 250_000, `${relative(repoRoot, assetPath)} should be a complete recording`);
    assert.equal(readFileSync(assetPath).subarray(0, 4).toString("ascii"), "fLaC", `${relative(repoRoot, assetPath)} should be FLAC audio`);
  }
  assert.ok(totalBytes > 45_000_000 && totalBytes < 65_000_000, "compact library should remain within its expected 45-65 MB budget");

  assert.match(read("frontend/src/state/store.ts"), /createSalamanderCompactGrand\(FACTORY_KEYS_SET_ID\)/, "instrument seeding should install the factory grand");
  assert.match(read("frontend/src/audio/audioToMidi.ts"), /SALAMANDER_COMPACT_GRAND_NAME/, "piano transcription should prefer the sampled grand");
  assert.match(read("frontend/src/audio/timelineAudio.ts"), /preloadInstrumentSamplesForPlayback/, "timeline playback should load only the required multisample zone");
  assert.match(read("frontend/src/App.solid.tsx"), /samplerComplexity === "performance"/, "startup should leave large performance maps for on-demand loading");
  assert.match(read("frontend/public/samples/salamander-compact/ATTRIBUTION.txt"), /derived mapping of Salamander Grand Piano V3/, "distribution should disclose the Beat adaptation");

  console.log(`Factory piano verifier passed (${zones.length} zones, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB).`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
