#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-sampler-zones-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

function read(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function includes(path, text, message) {
  assert.ok(read(path).includes(text), `${message} (${relative(repoRoot, join(repoRoot, path))})`);
}

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/state/sampleZones.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outfile=${join(outDir, "sampleZones.js")}`,
    ],
    { stdio: "inherit" },
  );

  const sampleZones = await import(pathToFileURL(join(outDir, "sampleZones.js")));
  const sampleMap = sampleZones.normalizeSampleMap([
    {
      path: "/Samples/Kick.wav",
      name: "Kick soft",
      rootNote: 36,
      loNote: 36,
      hiNote: 36,
      loVel: 1,
      hiVel: 80,
      volumeDb: -3,
      pan: 0,
      tuning: 0,
      seqPosition: 0,
    },
    {
      path: "/Samples/Kick.wav",
      name: "Kick hard",
      rootNote: 36,
      loNote: 36,
      hiNote: 36,
      loVel: 81,
      hiVel: 127,
      volumeDb: 0,
      pan: 0,
      tuning: 0,
      seqPosition: 1,
    },
  ]);

  assert.equal(sampleMap.length, 2, "normalization should preserve duplicate zones on the same sample path");
  assert.ok(sampleMap[0].id, "normalization should repair missing sample-zone ids");
  assert.ok(sampleMap[1].id, "normalization should repair every missing sample-zone id");
  assert.notEqual(sampleMap[0].id, sampleMap[1].id, "duplicate sample paths must still receive distinct zone ids");
  assert.equal(sampleZones.sampleZoneDisplayName(sampleMap[1], 1), "Kick hard", "sample-zone names should remain user-facing labels");

  const instrument = { id: "sampler", kind: "sampler", waveform: "sample", sampleMap };
  assert.equal(sampleZones.isSampleBackedInstrument(instrument), true, "sampler-backed instruments should be detected from sampleMap");
  assert.equal(
    sampleZones.midiNoteSampleLabel(instrument, { pitch: 36, velocity: 127, startBeat: 0, lengthBeats: 1, sampleZoneId: sampleMap[1].id }),
    "Kick hard",
    "MIDI notes should resolve sample labels by selected zone id",
  );
  assert.equal(
    sampleZones.midiNoteSampleLabel(instrument, { pitch: 36, velocity: 127, startBeat: 0, lengthBeats: 1, samplePath: "/Samples/Kick.wav" }),
    "Kick soft",
    "legacy path-based MIDI sample labels should keep working",
  );

  includes("frontend/src/persistence/dexie.ts", "sampleZoneId", "document normalization should preserve note-level sample-zone ids");
  includes("frontend/src/persistence/dexie.ts", "samplePath", "document normalization should preserve note-level sample path fallback");
  includes("frontend/src/persistence/dexie.ts", "sampleLabel", "document normalization should preserve note-level sample labels");
  includes("frontend/src/audio/synthPreview.ts", "startInstrumentSampleZoneAudition", "sampler-zone audition should preload the selected zone before preview");
  includes("frontend/src/features/MidiEditor/PianoRoll.solid.tsx", "assignSampleZoneToSelection", "piano roll should expose sample-zone assignment");
  includes("frontend/src/features/MidiEditor/PianoRoll.solid.tsx", "midiNoteSampleLabel", "piano roll should display selected sample-zone labels");
  includes("frontend/src/features/MidiEditor/PianoRoll.solid.tsx", "missingSamplerZoneCount", "piano roll should warn when selected zone metadata is stale");
  includes("frontend/src/features/MidiEditor/PianoRoll.solid.tsx", "clearMissingSamplerZoneAssignments", "piano roll should repair stale sample-zone assignments");
  includes("frontend/src/features/InstrumentEditor/InstrumentEditorModal.solid.tsx", "auditionZone", "sampler editor should audition individual zones");
  includes("frontend/src/features/MidiEditor/MidiTransport.solid.tsx", "sampleZoneId: note.sampleZoneId", "MIDI editor audition should forward selected sample-zone ids");
  includes("frontend/src/audio/timelineAudio.ts", "sampleZoneId: note.sampleZoneId", "timeline playback should forward selected sample-zone ids");
  includes("frontend/src/audio/synthPreview.ts", "SamplePlaybackSelection", "synth preview should define explicit sample playback selection");
  includes("frontend/src/audio/synthPreview.ts", "selectedZone", "synth preview should resolve forced sample-zone playback");

  console.log("Sampler zone verifier passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
