#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-timeline-jumping-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

function read(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function includes(path, text, message) {
  assert.ok(read(path).includes(text), `${message} (${relative(repoRoot, join(repoRoot, path))})`);
}

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(esbuild, [
    join(repoRoot, "frontend/src/state/timelineJumpingSampler.ts"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${join(outDir, "timelineJumpingSampler.js")}`,
  ], { stdio: "inherit" });

  const timeline = await import(pathToFileURL(join(outDir, "timelineJumpingSampler.js")));
  const source = { path: "/tmp/song.mp3", sampleRate: 48_000, durationSeconds: 120 };
  const first = timeline.createTimelineJumpingZone({ source, pitch: 48, startSeconds: 12.5, endSeconds: 18, seqPosition: 0 });
  assert.equal(first.path, source.path, "jump should retain the single source audio path");
  assert.equal(first.rootNote, 48, "pad pitch should be stored as the zone root");
  assert.equal(first.loNote, 48, "jump should match only its assigned pitch");
  assert.equal(first.hiNote, 48, "jump should not spill into adjacent pitches");
  assert.equal(first.tuning, 0, "pitch rows must not transpose timeline audio");
  assert.equal(first.startSample, 600_000, "start time should become a sample-accurate source offset");
  assert.equal(first.endSample, 864_000, "end time should become a sample-accurate clip boundary");
  assert.equal(first.oneShot, false, "note length should be allowed to release a timeline slice");
  assert.equal(timeline.nextTimelineJumpingPitch([first]), 49, "new pads should advance to the next unused keyboard pitch");
  assert.equal(timeline.midiPitchLabel(60), "C4", "pitch labels should follow Beat's C4=60 convention");

  const moved = timeline.normalizeTimelineJumpingZone(first, source, { rootNote: 72, startSample: 960_000 });
  assert.equal(moved.rootNote, 72);
  assert.equal(moved.loNote, 72);
  assert.equal(moved.hiNote, 72);
  assert.equal(moved.startSample, 960_000);
  assert.equal(moved.path, source.path);

  includes("frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx", "Create Timeline Jumper", "instrument library should expose the sampler variant");
  includes("frontend/src/features/InstrumentEditor/InstrumentEditorModal.solid.tsx", "Timeline Jumping", "sampler editor should expose the mode switch");
  includes("frontend/src/features/InstrumentEditor/TimelineJumpingSamplerEditor.solid.tsx", "New Pitch Here", "timeline editor should create keyboard pads at the playhead");
  includes("frontend/src/features/InstrumentEditor/TimelineJumpingSamplerEditor.solid.tsx", "Set Selected Start", "timeline editor should edit clip starts from the waveform");
  includes("frontend/src/features/InstrumentEditor/TimelineJumpingSamplerEditor.solid.tsx", "Set Selected End", "timeline editor should edit clip ends from the waveform");
  includes("frontend/src/audio/synthPreview.ts", "isTimelineJumpingInstrument(instrument)", "browser playback should enforce strict pitch mapping");
  includes("backend/Source/Ipc/MessageBridge.cpp", "samplerComplexity", "native IPC should preserve the sampler mode");
  includes("backend/Source/Audio/AudioEngine.cpp", "instrument.strictPitchMapping", "native playback should keep unassigned rows silent");
  includes("frontend/src/state/store.ts", "samplerComplexity: instrument.samplerComplexity", "instrument snapshots should preserve the sampler mode");
  includes("frontend/src/features/InstrumentEditor/InstrumentEditorModal.solid.tsx", "samplerComplexity: snapshot.samplerComplexity", "revert should restore the saved sampler mode");

  console.log("Timeline Jumping sampler verifier passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
