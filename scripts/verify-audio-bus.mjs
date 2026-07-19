#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-audio-bus-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

try {
  const appSource = readFileSync(join(repoRoot, "frontend/src/App.solid.tsx"), "utf8");
  const panelSource = readFileSync(join(repoRoot, "frontend/src/features/AudioBusPanel/AudioBusPanel.solid.tsx"), "utf8");
  assert.ok(appSource.includes("<AudioBusPanel />"), "main editor should mount the Bus/Master tab panel");
  assert.ok(!appSource.includes("<MasterEqPanel />"), "main editor should not bypass the Bus/Master tab panel");
  assert.ok(panelSource.includes('role="tablist"') && panelSource.includes('role="tab"') && panelSource.includes('role="tabpanel"'), "Bus/Master navigation should expose accessible tab semantics");
  assert.ok(panelSource.includes('aria-label="Create audio bus"') && panelSource.includes("addAudioBus()"), "Bus panel should expose creation");
  assert.ok(panelSource.includes("removeReturnBus(props.bus.id)") && panelSource.includes("appConfirm"), "Bus deletion should require confirmation and use reference-safe cleanup");
  assert.ok(panelSource.includes('event.key === "ArrowRight"') && panelSource.includes('event.key === "ArrowLeft"'), "Bus tabs should support keyboard navigation");
  assert.ok(panelSource.includes("canSetAudioBusOutput") && panelSource.includes("setAudioBusOutput"), "Bus output menus should use cycle-safe routing APIs");
  assert.ok(panelSource.includes("canSetAudioBusSend") && panelSource.includes("upsertAudioBusSend"), "Bus send controls should use cycle-safe routing APIs");
  assert.ok(panelSource.includes("moveReturnBusEffect") && panelSource.includes("removeReturnBusEffect"), "Bus insert rack should support reorder and removal");
  assert.ok(panelSource.includes('label="Mode"') && panelSource.includes("channelLayout"), "Bus panel should expose mono/stereo channel mode");

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
  const drumBus = state().addAudioBus({ name: " Drum Bus ", trackIds: [trackId, "missing-track"] });
  const rhythmBus = state().addReturnBus("Rhythm Bus");
  const reverbBus = state().addReturnBus("Reverb Bus");

  assert.equal(state().project.tracks[0].outputBusId, drumBus, "bus creation should atomically route selected tracks");
  assert.equal(state().project.returnBuses.find((bus) => bus.id === drumBus)?.name, "Drum Bus");
  assert.equal(state().setTrackOutputBus(trackId, "missing-bus"), false, "new primary routes must target an existing bus");
  assert.equal(state().project.tracks[0].outputBusId, drumBus, "rejected primary routes must not mutate state");
  assert.equal(state().upsertTrackSend(trackId, "missing-bus", { gainDb: 0 }), false, "new track sends must target an existing bus");
  assert.equal(state().upsertTrackSend(trackId, reverbBus, { gainDb: 999, pan: -999, preFader: true }), true);
  assert.deepEqual(
    state().project.tracks[0].sends?.find((send) => send.busId === reverbBus),
    { busId: reverbBus, gainDb: 24, pan: -1, enabled: true, preFader: true },
    "track send values should be normalized at the store boundary",
  );
  assert.equal(state().setAudioBusOutput(drumBus, rhythmBus), true);
  assert.equal(state().setAudioBusOutput(drumBus, "missing-bus"), false, "new bus outputs must target an existing bus");
  assert.equal(state().upsertAudioBusSend(drumBus, "missing-bus", { enabled: true }), false, "new bus sends must target an existing bus");
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

  state().updateReturnBus(drumBus, {
    id: "mutated-id",
    schemaVersion: 99,
    name: "  ",
    channelLayout: "invalid",
    inputTrimDb: Number.NaN,
    gainDb: 99,
    pan: -99,
    mixerOrder: -5,
    outputBusId: reverbBus,
    sends: [],
  });
  const normalizedBus = state().project.returnBuses.find((bus) => bus.id === drumBus);
  assert.equal(normalizedBus?.id, drumBus, "stable bus ids must not be mutable through generic updates");
  assert.equal(normalizedBus?.schemaVersion, 1, "bus schema versions must not be mutable through generic updates");
  assert.equal(normalizedBus?.name, "Bus");
  assert.equal(normalizedBus?.channelLayout, "stereo");
  assert.equal(normalizedBus?.inputTrimDb, 0);
  assert.equal(normalizedBus?.gainDb, 24);
  assert.equal(normalizedBus?.pan, -1);
  assert.equal(normalizedBus?.mixerOrder, 0);
  assert.equal(normalizedBus?.outputBusId, rhythmBus, "generic updates must not bypass routing validation");
  assert.equal(normalizedBus?.sends?.length, 1, "generic updates must not replace validated sends");

  state().removeReturnBus(drumBus);
  assert.equal(state().project.tracks[0].outputEnabled, false, "deleted primary destinations must disconnect explicitly");
  assert.equal(state().project.tracks[0].outputBusId, undefined);
  assert.equal(state().project.returnBuses.some((bus) => bus.sends?.some((send) => send.busId === drumBus)), false);

  console.log("Audio bus frontend contract passed");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
