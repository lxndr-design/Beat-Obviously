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
  const panelCss = readFileSync(join(repoRoot, "frontend/src/features/AudioBusPanel/AudioBusPanel.module.css"), "utf8");
  const masterEqSource = readFileSync(join(repoRoot, "frontend/src/features/Eq/MasterEqPanel.solid.tsx"), "utf8");
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
  assert.ok(panelSource.includes("BusInputRow") && panelSource.includes('title="Inputs"'), "Bus panel should identify routed track, bus, and send inputs");
  assert.ok(panelSource.includes("<Knob") && panelSource.includes('label="Input Trim"') && panelSource.includes('label="Fader"'), "Bus parameters should reuse the synth knob controls");
  assert.ok(panelSource.includes("SynthCurvePreview") && panelSource.includes("effectResponseSamples"), "Bus insert cards should reuse the Aether synth curve preview language");
  assert.ok(panelSource.includes("EFFECT_PARAM_SPECS") && panelSource.includes("patchParam"), "Bus insert cards should expose editable effect parameters");
  const masterPanelSource = panelSource.slice(panelSource.indexOf("function MasterEditorPanel"), panelSource.indexOf("interface BusEditorPanelProps"));
  assert.ok(masterPanelSource.includes('title="Inputs"') && masterPanelSource.includes('title="Parameters"') && masterPanelSource.includes("masterInserts"), "Master should use the same Inputs, Parameters, and Inserts workspace as Buses");
  assert.ok(!masterPanelSource.includes("styles.outputSection"), "Master workspace should not expose a redundant Output section");
  assert.ok(!masterEqSource.includes("Presets") && !masterEqSource.includes("FACTORY_PRESETS"), "Master EQ presets should not remain in the interface");
  assert.ok(panelSource.includes("index() === props.buses.length - 1") && panelSource.indexOf("<AddBusTabButton") < panelSource.indexOf('role="tab"', panelSource.indexOf("<For each={props.buses}")), "Create Bus should sit immediately before the final Bus tab");
  assert.ok(panelCss.includes(".ribbon::after") && panelCss.includes("border-bottom: var(--border-fg)"), "Bus tab ribbon should preserve a continuous bottom rule");
  assert.ok(panelSource.includes("styles.insertPower") && panelSource.includes('"ph:power-fill"') && panelSource.includes('"ph:power"'), "Insert bypass controls should reuse the existing selected power button");
  assert.ok(panelCss.includes("flex-direction: column") && panelCss.includes("overflow-y: auto") && panelCss.includes("overscroll-behavior: contain"), "Insert cards should form an independently scrollable vertical stack");
  assert.ok(panelCss.includes("width: 100%") && panelCss.includes("max-width: none"), "Insert cards should fill the insert-column width");

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

  const compressorId = state().addReturnBusEffect(drumBus, "compressor");
  const filterId = state().addReturnBusEffect(drumBus, "lowpass");
  state().updateReturnBusEffect(drumBus, compressorId, { params: { thresholdDb: -24, ratio: 6, attackMs: 8, releaseMs: 160, makeupDb: 1, mix: 100 } });
  assert.equal(state().project.returnBuses.find((bus) => bus.id === drumBus)?.effects.filters[0]?.params.thresholdDb, -24, "Bus insert parameter edits should persist");
  state().moveReturnBusEffect(drumBus, filterId, -1);
  assert.equal(state().project.returnBuses.find((bus) => bus.id === drumBus)?.effects.filters[0]?.id, filterId, "Bus insert cards should reorder the persisted chain");
  state().removeReturnBusEffect(drumBus, filterId);
  assert.deepEqual(state().project.returnBuses.find((bus) => bus.id === drumBus)?.effects.filters.map((effect) => effect.id), [compressorId], "Bus insert removal should retain unrelated effects");

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
