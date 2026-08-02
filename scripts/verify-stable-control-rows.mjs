#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const readSource = (path) => readFileSync(join(repoRoot, path), "utf8");

const audioBus = readSource("frontend/src/features/AudioBusPanel/AudioBusPanel.solid.tsx");
const mixer = readSource("frontend/src/features/Mixer/MixerPanel.solid.tsx");
const eqAutomation = readSource("frontend/src/features/EqAutomation/EqAutomationModal.solid.tsx");
const instrumentEditor = readSource("frontend/src/features/InstrumentEditor/InstrumentEditorModal.solid.tsx");
const aurumEditor = readSource("frontend/src/features/Aurum/AurumEditor.solid.tsx");
const aurumModulation = readSource("frontend/src/features/Aurum/AurumModulationBridge.solid.tsx");
const modulationMatrix = readSource("frontend/src/features/Synth/ModulationMatrix/ModulationMatrix.solid.tsx");
const synthEditor = readSource("frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx");
const trackList = readSource("frontend/src/features/Tracks/TrackList.solid.tsx");
const trackEffectRows = readSource("frontend/src/features/Tracks/TrackEffectRows.solid.tsx");

assert.equal(
  audioBus.match(/<Index each=\{inputSources\(\)\}>/g)?.length,
  2,
  "Master and Bus input controls should retain row instances while their levels change",
);
assert.match(
  audioBus,
  /<For each=\{props\.bus\.effects\.filters\.map\(\(effect\) => effect\.id\)\}>/,
  "Bus insert controls should be keyed by stable effect ids",
);
assert.match(
  audioBus,
  /<For each=\{\(props\.bus\.sends \?\? \[\]\)\.map\(\(send\) => send\.busId\)\}>/,
  "Bus send controls should be keyed by stable destination ids",
);
assert.match(
  mixer,
  /<For each=\{tracks\(\)\.map\(\(track\) => track\.id\)\}>/,
  "Mixer channel strips should be keyed by stable track ids",
);
assert.match(
  mixer,
  /<For each=\{returnBuses\(\)\.map\(\(bus\) => bus\.id\)\}>/,
  "Mixer return strips should be keyed by stable Bus ids",
);
assert.match(
  eqAutomation,
  /<Index each=\{points\(\)\}>/,
  "EQ automation point controls should retain their positional row while a value changes",
);
assert.match(
  instrumentEditor,
  /<Index each=\{properties\(\)\}>/,
  "Sampler property controls should retain their positional row while steps change",
);
assert.match(
  aurumEditor,
  /<Index each=\{aurum\(\)\.filters\}>/,
  "Aurum's fixed Filter A and B controls should retain their row instances",
);
assert.match(
  aurumModulation,
  /<For each=\{routes\(\)\.map\(\(route\) => route\.id\)\}>/,
  "Aurum modulation controls should be keyed by stable route ids",
);
assert.match(
  modulationMatrix,
  /<For each=\{routes\(\)\.map\(\(route\) => route\.id\)\}>/,
  "Modulation Matrix controls should be keyed by stable route ids",
);
assert.match(
  synthEditor,
  /<For each=\{effects\(\)\.map\(\(effect\) => effect\.id\)\}>/,
  "Instrument FX controls should be keyed by stable effect ids",
);
assert.equal(
  trackList.match(/<For each=\{tracks\(\)\.map\(\(track\) => track\.id\)\}>/g)?.length,
  2,
  "Track headers and lanes should be keyed by stable track ids",
);
assert.equal(
  trackEffectRows.match(/<For each=\{\(track\(\)\?\.effects\.filters \?\? \[\]\)\.map\(\(effect\) => effect\.id\)\}>/g)?.length,
  2,
  "Track effect header and automation rows should be keyed by stable effect ids",
);
assert.match(
  trackEffectRows,
  /<For each=\{points\(\)\.map\(\(point\) => point\.id\)\}>/,
  "Interactive track-effect automation points should be keyed by stable point ids",
);

console.log("Stable interactive control row verifier passed");
