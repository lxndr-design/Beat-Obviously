#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-audio-bus-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

try {
  execFileSync(join(repoRoot, "frontend/node_modules/.bin/esbuild"), [
    join(repoRoot, "frontend/src/state/store.ts"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${join(outDir, "store.js")}`,
  ], { stdio: "inherit" });

  const store = await import(pathToFileURL(join(outDir, "store.js")));
  const state = () => store.useProjectStore.getState();
  const trackId = state().project.tracks[0].id;
  const drumBus = state().addReturnBus("Drum Bus");
  const rhythmBus = state().addReturnBus("Rhythm Bus");
  const reverbBus = state().addReturnBus("Reverb Bus");

  assert.equal(state().setTrackOutputBus(trackId, drumBus), true);
  assert.equal(state().setAudioBusOutput(drumBus, rhythmBus), true);
  assert.equal(state().setAudioBusOutput(rhythmBus, drumBus), false, "primary cycles must be rejected");
  assert.equal(state().upsertAudioBusSend(rhythmBus, drumBus, { enabled: true }), false, "send cycles must be rejected");
  assert.equal(state().upsertAudioBusSend(drumBus, reverbBus, {
    enabled: true,
    gainDb: -9,
    pan: 0.2,
    preFader: true,
  }), true);

  const project = state().project;
  assert.equal(project.returnBuses.length, 3);
  assert.equal(project.tracks[0].outputBusId, drumBus);
  assert.equal(project.returnBuses.find((bus) => bus.id === drumBus)?.outputBusId, rhythmBus);
  assert.equal(project.returnBuses.find((bus) => bus.id === drumBus)?.sends?.[0]?.preFader, true);

  state().removeReturnBus(drumBus);
  assert.equal(state().project.tracks[0].outputEnabled, false, "deleted primary destinations must disconnect explicitly");
  assert.equal(state().project.tracks[0].outputBusId, undefined);
  assert.equal(state().project.returnBuses.some((bus) => bus.sends?.some((send) => send.busId === drumBus)), false);

  console.log("Audio bus frontend contract passed");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
