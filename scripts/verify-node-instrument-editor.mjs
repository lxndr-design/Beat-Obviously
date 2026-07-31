#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-node-instrument-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const EXPECTED_NODE_KINDS = [
  "instrument",
  "oscillator",
  "oscillatorMerge",
  "noise",
  "mixer",
  "panWidth",
  "filter",
  "gain",
  "unison",
  "constant",
  "cvScale",
  "cvCombiner",
  "gateTrigger",
  "velocity",
  "keytrack",
  "modWheel",
  "midiControl",
  "macro",
  "random",
  "lfo",
  "wavetableLfo",
  "envelope",
  "drive",
  "resonator",
  "shaper",
  "distortion",
  "delay",
  "chorus",
  "reverb",
  "phaser",
  "flanger",
  "compressor",
  "bitcrush",
  "meterScope",
  "output",
];

const HIDDEN_COMPATIBILITY_NODE_KINDS = new Set([
  "oscillatorMerge",
  "shaper",
  "distortion",
  "modWheel",
  "lfo",
  "envelope",
  "velocity",
  "keytrack",
  "midiControl",
  "macro",
  "random",
  "constant",
]);

const EXPECTED_BROWSER_NODE_KINDS = EXPECTED_NODE_KINDS
  .filter((kind) => kind !== "output" && !HIDDEN_COMPATIBILITY_NODE_KINDS.has(kind));

const RELEASE_RULE_COVERED_NODE_KINDS = new Set(EXPECTED_NODE_KINDS);

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/features/NodeInstrumentEditor/nodeGraph.ts"),
      join(repoRoot, "frontend/src/state/synthStore.ts"),
      join(repoRoot, "frontend/src/audio/synthPreview.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outdir=${outDir}`,
    ],
    { stdio: "inherit" },
  );

  const nodeGraph = await import(pathToFileURL(join(outDir, "features/NodeInstrumentEditor/nodeGraph.js")));
  const synthStore = await import(pathToFileURL(join(outDir, "state/synthStore.js")));
  const synthPreview = await import(pathToFileURL(join(outDir, "audio/synthPreview.js")));

  const instrument = {
    id: "node-test",
    name: "Node Verifier",
    kind: "wavetable",
    envelope: { attackMs: 5, decayMs: 120, sustain: 0.7, releaseMs: 260 },
    knobs: { cutoff: 0.54, resonance: 0.22, drive: 0.08, color: 0.72 },
    filterType: "lowpass",
    waveform: "wavetable",
    sampleIds: [],
    userCreated: true,
  };

  assertNodeReleaseRules(nodeGraph);

  const outputOnlyGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  assert.equal(outputOnlyGraph.schemaVersion, 1);
  assert.equal(outputOnlyGraph.nodes.length, 1, "output-only nodepath graphs should contain only Instrument Out");
  assert.equal(outputOnlyGraph.nodes[0].kind, "output");
  assert.equal(outputOnlyGraph.nodes[0].label, "Instrument Out");
  assert.equal(outputOnlyGraph.cables.length, 0, "output-only nodepath graphs should stay silent");

  const starterGraph = nodeGraph.createStarterInstrumentNodeGraph(instrument);
  assert.equal(starterGraph.schemaVersion, 1);
  assert.deepEqual(
    starterGraph.nodes.map((node) => node.kind),
    ["oscillator", "output"],
    "new nodepath instruments should start with a basic oscillator connected to the protected output",
  );
  assert.deepEqual(
    starterGraph.cables.map((cable) => [cable.fromNodeId, cable.fromPortId, cable.toNodeId, cable.toPortId]),
    [[starterGraph.nodes[0].id, "audio-out", starterGraph.nodes[1].id, "audio-in"]],
    "starter nodepath graph should route oscillator audio into Instrument Out",
  );
  assert.equal(nodeGraph.analyzeInstrumentNodeGraph(starterGraph).length, 0, "starter nodepath graph should have no warnings");
  const starterPreviewPatch = nodeGraph.compileNodeGraphToInstrumentPatch(starterGraph, instrument);
  assert.equal(starterPreviewPatch.synthPatch.parameters["osc.a.enabled"], true, "starter nodepath graph should compile to an audible oscillator");

  const duplicateOutputGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  duplicateOutputGraph.nodes.push(nodeGraph.createInstrumentNode("output", 1200, 420, "Second Output"));
  duplicateOutputGraph.cables.push({
    id: "bad-output-cable",
    fromNodeId: duplicateOutputGraph.nodes[1].id,
    fromPortId: "audio-out",
    toNodeId: duplicateOutputGraph.nodes[0].id,
    toPortId: "audio-in",
  });
  const normalizedDuplicateOutput = nodeGraph.normalizeInstrumentNodeGraph(duplicateOutputGraph, instrument);
  assert.equal(
    normalizedDuplicateOutput.nodes.filter((node) => node.kind === "output").length,
    1,
    "node graphs must normalize down to exactly one protected Instrument Out node",
  );
  assert.equal(normalizedDuplicateOutput.cables.length, 0, "cables attached to removed output nodes must be removed");

  const outputOnlyPatch = nodeGraph.compileNodeGraphToInstrumentPatch(outputOnlyGraph, instrument);
  assert.equal(outputOnlyPatch.nodeGraph.nodes.length, 1);
  assert.equal(outputOnlyPatch.synthPatch.parameters["osc.a.enabled"], false);
  assert.equal(outputOnlyPatch.synthPatch.parameters["osc.b.enabled"], false);
  assert.equal(outputOnlyPatch.synthPatch.parameters["amp.level"], 0);
  assert.equal(outputOnlyPatch.synthPatch.effects.filters.length, 0);

  assert.deepEqual(
    nodeGraph.NODE_GRAPH_TEMPLATES.map((template) => template.id),
    ["basic-oscillator", "filtered-mono", "moving-texture", "snare-hit", "tom-hit", "crash-hit"],
    "Nodemap should expose oscillator, filtered, texture, and three percussive proof templates",
  );

  for (const template of nodeGraph.NODE_GRAPH_TEMPLATES) {
    const templateGraph = nodeGraph.createNodeGraphTemplate(template.id, instrument);
    assert.equal(
      templateGraph.nodes.filter((node) => node.kind === "output").length,
      1,
      `template ${template.id} should contain exactly one Instrument Out`,
    );
    assert.ok(
      templateGraph.cables.some((cable) => templateGraph.nodes.find((node) => node.id === cable.toNodeId)?.kind === "output"),
      `template ${template.id} should route audio into Instrument Out`,
    );
    assert.equal(nodeGraph.analyzeInstrumentNodeGraph(templateGraph).length, 0, `template ${template.id} should not have graph warnings`);
  }
  const snareTemplate = nodeGraph.createNodeGraphTemplate("snare-hit", instrument);
  const snarePatch = nodeGraph.compileNodeGraphToInstrumentPatch(snareTemplate, instrument);
  assert.ok(
    templateKinds(snareTemplate).includes("noise") && templateKinds(snareTemplate).includes("shaper"),
    "snare template should use noise rattle plus a drive stage",
  );
  assert.equal(snarePatch.synthPatch.parameters["filter.type"], "bandpass", "snare template should use a bandpass snap filter");
  assert.equal(snarePatch.synthPatch.parameters["env.1.sustain"], 0, "snare template should not sustain like a synth pad");
  assert.ok(snarePatch.aether.noise.level >= 0.7, "snare template should keep noise rattle prominent");

  const tomTemplate = nodeGraph.createNodeGraphTemplate("tom-hit", instrument);
  const tomPatch = nodeGraph.compileNodeGraphToInstrumentPatch(tomTemplate, instrument);
  assert.ok(
    templateKinds(tomTemplate).includes("noise") && templateKinds(tomTemplate).includes("mixer"),
    "tom template should include a small attack click blended into the resonant body",
  );
  assert.equal(tomPatch.synthPatch.parameters["filter.type"], "lowpass", "tom template should use a lowpass drum-body filter");
  assert.equal(tomPatch.synthPatch.parameters["env.1.sustain"], 0, "tom template should decay like a drum instead of sustaining");
  assert.ok(tomPatch.synthPatch.parameters["filter.cutoff"] <= 700, "tom template should stay in a lower drum-body range");

  const crashTemplate = nodeGraph.createNodeGraphTemplate("crash-hit", instrument);
  const crashPatch = nodeGraph.compileNodeGraphToInstrumentPatch(crashTemplate, instrument);
  assert.ok(!templateKinds(crashTemplate).includes("lfo"), "crash template should not include oscillating filter motion");
  assert.ok(!templateKinds(crashTemplate).includes("chorus"), "crash template should not rely on chorus motion");
  assert.ok(crashPatch.synthPatch.parameters["filter.cutoff"] <= 2600, "crash template should not be filtered into only wispy high air");
  assert.deepEqual(
    crashPatch.synthPatch.effects.filters.map((effect) => effect.kind),
    ["saturator", "reverb"],
    "crash template should compile to static edge and tail effects, not moving modulation effects",
  );

  const disconnectedGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  disconnectedGraph.nodes.push(nodeGraph.createInstrumentNode("oscillator", 120, 120, "Loose Oscillator"));
  assert.deepEqual(
    nodeGraph.analyzeInstrumentNodeGraph(disconnectedGraph).map((issue) => issue.id),
    ["silent-output", `unconnected-${disconnectedGraph.nodes[1].id}`],
    "graph warnings should identify silent output and unconnected nodes",
  );
  const disconnectedPatch = nodeGraph.compileNodeGraphToInstrumentPatch(disconnectedGraph, instrument);
  assert.equal(disconnectedPatch.synthPatch.parameters["osc.a.enabled"], false);
  assert.equal(disconnectedPatch.synthPatch.parameters["osc.b.enabled"], false);
  assert.equal(disconnectedPatch.synthPatch.parameters["amp.level"], 0);
  const silentPreview = synthStore.synthDraftToPreviewInstrument(disconnectedPatch.synthPatch);
  const silentSamples = new Float32Array(12000);
  synthPreview.renderInstrumentSamples(silentPreview, silentSamples, 48000, synthPreview.previewFrequency(silentPreview), "audio", true);
  const silentStats = stats(silentSamples);
  assert.ok(silentStats.rms < 0.000001, `expected disconnected node graph to be silent, got rms ${silentStats.rms}`);
  assert.ok(silentStats.peak < 0.000001, `expected disconnected node graph to have no peak, got ${silentStats.peak}`);

  const instrumentSourceGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  const sourceNode = nodeGraph.createInstrumentNode("instrument", 120, 120, "Existing Instrument");
  const sourceOutput = instrumentSourceGraph.nodes.find((node) => node.kind === "output");
  instrumentSourceGraph.nodes.push(sourceNode);
  instrumentSourceGraph.cables.push({
    id: "source-to-output",
    fromNodeId: sourceNode.id,
    fromPortId: "audio-out",
    toNodeId: sourceOutput.id,
    toPortId: "audio-in",
  });
  const sourcePatch = nodeGraph.compileNodeGraphToInstrumentPatch(instrumentSourceGraph, instrument);
  assert.equal(sourcePatch.synthPatch.parameters["osc.a.enabled"], true, "Instrument node should create an audible source when connected to Instrument Out");

  const noiseGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  const noiseNode = nodeGraph.createInstrumentNode("noise", 120, 120, "Noise Source");
  const noiseGain = nodeGraph.createInstrumentNode("gain", 360, 120, "Noise Volume");
  const noiseOutput = noiseGraph.nodes.find((node) => node.kind === "output");
  noiseNode.parameters.level = 0.44;
  noiseNode.parameters.color = 0.72;
  noiseGain.parameters.level = 0.63;
  noiseGraph.nodes.push(noiseNode, noiseGain);
  noiseGraph.cables.push(
    cablePatch("noise-to-gain", noiseNode, "audio-out", noiseGain, "audio-in"),
    cablePatch("gain-to-noise-output", noiseGain, "audio-out", noiseOutput, "audio-in"),
  );
  const noisePatch = nodeGraph.compileNodeGraphToInstrumentPatch(noiseGraph, instrument);
  assert.equal(noisePatch.synthPatch.parameters["osc.a.enabled"], false);
  assert.equal(noisePatch.synthPatch.parameters["osc.b.enabled"], false);
  assert.equal(noisePatch.synthPatch.parameters["amp.level"], 0.63);
  assert.deepEqual(noisePatch.aether.noise, { enabled: true, level: 0.44, color: 0.72 });

  const invalidCableGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  const invalidOsc = nodeGraph.createInstrumentNode("oscillator", 80, 80, "Invalid Osc");
  const invalidLfo = nodeGraph.createInstrumentNode("lfo", 320, 80, "Invalid LFO");
  const invalidOutput = invalidCableGraph.nodes.find((node) => node.kind === "output");
  invalidCableGraph.nodes.push(invalidOsc, invalidLfo);
  invalidCableGraph.cables.push(
    {
      id: "audio-to-control",
      fromNodeId: invalidOsc.id,
      fromPortId: "audio-out",
      toNodeId: invalidLfo.id,
      toPortId: "cv-out",
    },
    {
      id: "self-cable",
      fromNodeId: invalidOsc.id,
      fromPortId: "audio-out",
      toNodeId: invalidOsc.id,
      toPortId: "pitch",
    },
    {
      id: "duplicate-1",
      fromNodeId: invalidOsc.id,
      fromPortId: "audio-out",
      toNodeId: invalidOutput.id,
      toPortId: "audio-in",
    },
    {
      id: "duplicate-2",
      fromNodeId: invalidOsc.id,
      fromPortId: "audio-out",
      toNodeId: invalidOutput.id,
      toPortId: "audio-in",
    },
  );
  assert.equal(
    nodeGraph.cableIsValid(invalidCableGraph, {
      fromNodeId: invalidOsc.id,
      fromPortId: "audio-out",
      toNodeId: invalidOutput.id,
      toPortId: "audio-in",
    }),
    true,
    "audio output to audio input should be valid",
  );
  assert.equal(
    nodeGraph.cableIsValid(invalidCableGraph, {
      fromNodeId: invalidLfo.id,
      fromPortId: "cv-out",
      toNodeId: invalidOsc.id,
      toPortId: "pitch",
    }),
    true,
    "control output to pitch CV input should be valid",
  );
  assert.equal(
    nodeGraph.cableIsValid(invalidCableGraph, {
      fromNodeId: invalidOsc.id,
      fromPortId: "audio-out",
      toNodeId: invalidOsc.id,
      toPortId: "pitch",
    }),
    false,
    "audio output to pitch CV input should be invalid",
  );
  assert.equal(
    nodeGraph.cableIsValid(invalidCableGraph, {
      fromNodeId: invalidLfo.id,
      fromPortId: "cv-out",
      toNodeId: invalidOutput.id,
      toPortId: "audio-in",
    }),
    false,
    "control output to audio input should be invalid",
  );
  const normalizedInvalidCableGraph = nodeGraph.normalizeInstrumentNodeGraph(invalidCableGraph, instrument);
  assert.deepEqual(
    normalizedInvalidCableGraph.cables.map((cable) => cable.id),
    ["duplicate-1"],
    "normalization should prune self, wrong-direction/wrong-signal, and duplicate cables",
  );

  const graph = nodeGraph.createDefaultInstrumentNodeGraph(instrument);
  assert.equal(graph.schemaVersion, 1);
  assert.equal(graph.nodes.length >= 6, true, "default graph should create useful starter nodes");
  assert.equal(graph.cables.length >= 5, true, "default graph should connect an audible path");

  const oscA = graph.nodes.find((node) => node.label === "Oscillator A");
  const oscB = graph.nodes.find((node) => node.label === "Oscillator B");
  const oscillatorMerge = graph.nodes.find((node) => node.kind === "oscillatorMerge");
  const filter = graph.nodes.find((node) => node.kind === "filter");
  const gain = graph.nodes.find((node) => node.kind === "gain");
  assert.ok(oscA, "missing oscillator A");
  assert.ok(oscB, "missing oscillator B");
  assert.ok(oscillatorMerge, "missing oscillator merge node");
  assert.ok(filter, "missing filter node");
  assert.ok(gain, "missing gain node");

  assert.equal(
    graph.cables.some((cable) => cable.fromNodeId === oscA.id && cable.toNodeId === oscillatorMerge.id && cable.toPortId === "osc-a"),
    true,
    "Oscillator A should route through Oscillator Merge",
  );
  assert.equal(
    graph.cables.some((cable) => cable.fromNodeId === oscB.id && cable.toNodeId === oscillatorMerge.id && cable.toPortId === "osc-b"),
    true,
    "Oscillator B should route through Oscillator Merge",
  );
  const mixer = nodeGraph.createInstrumentNode("mixer", 920, 80, "Multi Source Mixer");
  graph.nodes.push(mixer);
  assert.equal(
    nodeGraph.cableIsValid(graph, {
      fromNodeId: oscA.id,
      fromPortId: "audio-out",
      toNodeId: filter.id,
      toPortId: "audio-in",
    }),
    false,
    "occupied single-input ports should reject a second incoming cable",
  );
  assert.equal(
    nodeGraph.cableIsValid(graph, {
      fromNodeId: oscB.id,
      fromPortId: "audio-out",
      toNodeId: mixer.id,
      toPortId: "in-1",
    }),
    true,
    "Mixer inputs should accept stacked incoming cables",
  );
  graph.cables.push(
    {
      id: "multi-input-from-osc-a",
      fromNodeId: oscA.id,
      fromPortId: "audio-out",
      toNodeId: mixer.id,
      toPortId: "in-1",
    },
    {
      id: "multi-output-to-mixer",
      fromNodeId: oscB.id,
      fromPortId: "audio-out",
      toNodeId: mixer.id,
      toPortId: "in-1",
    },
    {
      id: "single-input-filter-extra",
      fromNodeId: oscA.id,
      fromPortId: "audio-out",
      toNodeId: filter.id,
      toPortId: "audio-in",
    },
  );
  const multiNormalized = nodeGraph.normalizeInstrumentNodeGraph(graph, instrument);
  assert.equal(
    multiNormalized.cables.filter((cable) => cable.fromNodeId === oscB.id && cable.fromPortId === "audio-out").length >= 2,
    true,
    "one output port should support multiple outgoing cables",
  );
  assert.equal(
    multiNormalized.cables.filter((cable) => cable.toNodeId === mixer.id && cable.toPortId === "in-1").length >= 2,
    true,
    "Mixer inputs should support multiple incoming cables",
  );
  assert.equal(
    multiNormalized.cables.filter((cable) => cable.toNodeId === filter.id && cable.toPortId === "audio-in").length,
    1,
    "single-input nodes should prune extra incoming cables during normalization",
  );

  const effectGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  const effectOsc = nodeGraph.createInstrumentNode("oscillator", 90, 120, "Effect Oscillator");
  const shaper = nodeGraph.createInstrumentNode("shaper", 330, 120, "Drive Stage");
  const distortion = nodeGraph.createInstrumentNode("distortion", 570, 120, "Distortion Stage");
  const delay = nodeGraph.createInstrumentNode("delay", 810, 120, "Delay Stage");
  const chorus = nodeGraph.createInstrumentNode("chorus", 1050, 120, "Chorus Stage");
  const reverb = nodeGraph.createInstrumentNode("reverb", 1290, 120, "Reverb Stage");
  const phaser = nodeGraph.createInstrumentNode("phaser", 1530, 120, "Phaser Stage");
  const flanger = nodeGraph.createInstrumentNode("flanger", 1770, 120, "Flanger Stage");
  const compressor = nodeGraph.createInstrumentNode("compressor", 2010, 120, "Compressor Stage");
  const bitcrush = nodeGraph.createInstrumentNode("bitcrush", 2250, 120, "Bitcrush Stage");
  const effectOutput = effectGraph.nodes.find((node) => node.kind === "output");
  shaper.parameters.drive = 0.73;
  shaper.parameters.mix = 0.62;
  distortion.parameters.drive = 0.81;
  distortion.parameters.shape = 0.47;
  distortion.parameters.trim = 7.5;
  distortion.parameters.mix = 0.52;
  delay.parameters.time = 0.37;
  delay.parameters.feedback = 0.41;
  delay.parameters.mix = 0.29;
  chorus.parameters.rate = 1.25;
  chorus.parameters.depth = 0.52;
  chorus.parameters.mix = 0.33;
  reverb.parameters.room = 0.66;
  reverb.parameters.damping = 0.44;
  reverb.parameters.mix = 0.21;
  phaser.parameters.rate = 0.77;
  phaser.parameters.center = 1234;
  phaser.parameters.depth = 2.4;
  phaser.parameters.feedback = -0.32;
  phaser.parameters.mix = 0.58;
  flanger.parameters.rate = 0.42;
  flanger.parameters.depth = 3.6;
  flanger.parameters.delay = 4.8;
  flanger.parameters.feedback = 0.51;
  flanger.parameters.mix = 0.64;
  compressor.parameters.threshold = -24;
  compressor.parameters.ratio = 6.5;
  compressor.parameters.attack = 7.5;
  compressor.parameters.release = 180;
  compressor.parameters.makeup = 3;
  compressor.parameters.mix = 0.92;
  bitcrush.parameters.bits = 6;
  bitcrush.parameters.rate = 0.38;
  bitcrush.parameters.mix = 0.41;
  effectGraph.nodes.push(effectOsc, shaper, distortion, delay, chorus, reverb, phaser, flanger, compressor, bitcrush);
  effectGraph.cables.push(
    cablePatch("effect-osc-shaper", effectOsc, "audio-out", shaper, "audio-in"),
    cablePatch("effect-shaper-distortion", shaper, "audio-out", distortion, "audio-in"),
    cablePatch("effect-distortion-delay", distortion, "audio-out", delay, "audio-in"),
    cablePatch("effect-delay-chorus", delay, "audio-out", chorus, "audio-in"),
    cablePatch("effect-chorus-reverb", chorus, "audio-out", reverb, "audio-in"),
    cablePatch("effect-reverb-phaser", reverb, "audio-out", phaser, "audio-in"),
    cablePatch("effect-phaser-flanger", phaser, "audio-out", flanger, "audio-in"),
    cablePatch("effect-flanger-compressor", flanger, "audio-out", compressor, "audio-in"),
    cablePatch("effect-compressor-bitcrush", compressor, "audio-out", bitcrush, "audio-in"),
    cablePatch("effect-bitcrush-output", bitcrush, "audio-out", effectOutput, "audio-in"),
  );
  const effectPatch = nodeGraph.compileNodeGraphToInstrumentPatch(effectGraph, instrument);
  assert.deepEqual(
    effectPatch.synthPatch.effects.filters.map((effect) => effect.kind),
    ["saturator", "distortion", "delay", "chorus", "reverb", "phaser", "flanger", "compressor", "bitcrush"],
    "routed Nodemap effect nodes should compile into Aether instrument FX",
  );
  assert.equal(effectPatch.synthPatch.effects.filters[0].params.drive, 73);
  assert.equal(effectPatch.synthPatch.effects.filters[0].params.mix, 62);
  assert.equal(effectPatch.synthPatch.effects.filters[1].params.drive, 81);
  assert.equal(effectPatch.synthPatch.effects.filters[1].params.shape, 47);
  assert.equal(effectPatch.synthPatch.effects.filters[1].params.trimDb, 7.5);
  assert.equal(effectPatch.synthPatch.effects.filters[1].params.mix, 52);
  assert.equal(effectPatch.synthPatch.effects.filters[2].params.timeMs, 370);
  assert.equal(effectPatch.synthPatch.effects.filters[2].params.feedback, 41);
  assert.equal(effectPatch.synthPatch.effects.filters[3].params.rateHz, 1.25);

  const expandedCatalogGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  const catalogOsc = nodeGraph.createInstrumentNode("oscillator", 90, 120, "Catalog Oscillator");
  const catalogPan = nodeGraph.createInstrumentNode("panWidth", 330, 120, "Pan / Width");
  const catalogDrive = nodeGraph.createInstrumentNode("drive", 570, 120, "Drive");
  const catalogResonator = nodeGraph.createInstrumentNode("resonator", 810, 120, "Resonator");
  const catalogMeter = nodeGraph.createInstrumentNode("meterScope", 1050, 120, "Meter / Scope");
  const catalogGain = nodeGraph.createInstrumentNode("gain", 1290, 120, "Gain / VCA");
  const catalogLfo = nodeGraph.createInstrumentNode("wavetableLfo", 90, 380, "Wavetable LFO");
  const catalogConstant = nodeGraph.createInstrumentNode("constant", 330, 380, "Pan Offset");
  const catalogCombiner = nodeGraph.createInstrumentNode("cvCombiner", 570, 380, "Pan Mod Combiner");
  const catalogMidi = nodeGraph.createInstrumentNode("midiControl", 810, 380, "MIDI Control");
  const catalogGate = nodeGraph.createInstrumentNode("gateTrigger", 1050, 380, "Gate / Trigger");
  const catalogOutput = expandedCatalogGraph.nodes.find((node) => node.kind === "output");
  catalogPan.parameters.pan = -0.15;
  catalogDrive.parameters.mode = "overdrive";
  catalogDrive.parameters.drive = 0.36;
  catalogDrive.parameters.mix = 0.44;
  catalogResonator.parameters.frequency = 660;
  catalogResonator.parameters.feedback = 0.42;
  catalogResonator.parameters.mix = 0.31;
  catalogGain.parameters.level = 0.71;
  catalogLfo.parameters.amount = 0.2;
  catalogConstant.parameters.value = 0.25;
  catalogCombiner.parameters.weightA = 0.5;
  catalogCombiner.parameters.weightB = 0.4;
  catalogCombiner.parameters.offset = 0.05;
  catalogMidi.parameters.amount = 0.12;
  expandedCatalogGraph.nodes.push(
    catalogOsc,
    catalogPan,
    catalogDrive,
    catalogResonator,
    catalogMeter,
    catalogGain,
    catalogLfo,
    catalogConstant,
    catalogCombiner,
    catalogMidi,
    catalogGate,
  );
  expandedCatalogGraph.cables.push(
    cablePatch("catalog-osc-pan", catalogOsc, "audio-out", catalogPan, "audio-in"),
    cablePatch("catalog-pan-drive", catalogPan, "audio-out", catalogDrive, "audio-in"),
    cablePatch("catalog-drive-resonator", catalogDrive, "audio-out", catalogResonator, "audio-in"),
    cablePatch("catalog-resonator-meter", catalogResonator, "audio-out", catalogMeter, "audio-in"),
    cablePatch("catalog-meter-gain", catalogMeter, "audio-out", catalogGain, "audio-in"),
    cablePatch("catalog-gain-output", catalogGain, "audio-out", catalogOutput, "audio-in"),
    cablePatch("catalog-lfo-combiner", catalogLfo, "cv-out", catalogCombiner, "cv-a"),
    cablePatch("catalog-constant-combiner", catalogConstant, "cv-out", catalogCombiner, "cv-b"),
    cablePatch("catalog-combiner-pan", catalogCombiner, "cv-out", catalogPan, "pan-cv"),
    cablePatch("catalog-midi-filter", catalogMidi, "cv-out", catalogDrive, "drive-cv"),
    cablePatch("catalog-gate-resonator", catalogGate, "gate-out", catalogResonator, "decay-cv"),
  );
  const catalogPatch = nodeGraph.compileNodeGraphToInstrumentPatch(expandedCatalogGraph, instrument);
  assert.equal(catalogPatch.synthPatch.parameters["amp.level"], 0.71, "expanded catalog Gain / VCA should compile into amp level");
  assert.ok(
    typeof catalogPatch.synthPatch.parameters["amp.pan"] === "number"
      && catalogPatch.synthPatch.parameters["amp.pan"] > -0.1
      && catalogPatch.synthPatch.parameters["amp.pan"] < 0.2,
    "Pan / Width and CV Combiner should compile into bounded pan behavior",
  );
  assert.deepEqual(
    catalogPatch.synthPatch.effects.filters.map((effect) => effect.kind),
    ["saturator", "phaser"],
    "expanded Drive and Resonator nodes should compile into current Aether FX equivalents while Meter / Scope stays pass-through",
  );
  assert.ok(
    catalogPatch.synthPatch.modulation.some((route) => route.source === "lfo.1" && route.target === "amp.pan")
      && catalogPatch.synthPatch.modulation.some((route) => route.source === "modWheel" && route.target === "filter.drive") === false,
    "Wavetable LFO should compile as a dynamic modulation source and unsupported FX CV should remain harmless",
  );
  assert.equal(effectPatch.synthPatch.effects.filters[3].params.depthMs, 13);
  assert.equal(effectPatch.synthPatch.effects.filters[4].params.roomSize, 66);
  assert.equal(effectPatch.synthPatch.effects.filters[4].params.damping, 44);
  assert.equal(effectPatch.synthPatch.effects.filters[5].params.centerHz, 1234);
  assert.equal(effectPatch.synthPatch.effects.filters[5].params.feedback, -32);
  assert.equal(effectPatch.synthPatch.effects.filters[6].params.depthMs, 3.6);
  assert.equal(effectPatch.synthPatch.effects.filters[6].params.feedback, 51);
  assert.equal(effectPatch.synthPatch.effects.filters[7].params.thresholdDb, -24);
  assert.equal(effectPatch.synthPatch.effects.filters[7].params.ratio, 6.5);
  assert.equal(effectPatch.synthPatch.effects.filters[8].params.bits, 6);
  assert.equal(effectPatch.synthPatch.effects.filters[8].params.rate, 38);

  const bypassedEffectGraph = nodeGraph.normalizeInstrumentNodeGraph(effectGraph, instrument);
  bypassedEffectGraph.cables = bypassedEffectGraph.cables.filter((cable) => cable.fromNodeId !== delay.id && cable.toNodeId !== delay.id);
  const bypassedEffectPatch = nodeGraph.compileNodeGraphToInstrumentPatch(bypassedEffectGraph, instrument);
  assert.deepEqual(
    bypassedEffectPatch.synthPatch.effects.filters.map((effect) => effect.kind),
    [],
    "effect nodes that are not routed to Instrument Out should not compile into engine FX",
  );

  oscA.parameters.wavetable = "basic.saw";
  oscA.parameters.warp = 0.41;
  oscA.parameters.warpMode = "fold";
  oscA.parameters.semitone = 5;
  oscA.parameters.phase = 0.28;
  oscA.parameters.randomPhase = 0.12;
  oscA.parameters.level = 0.82;
  oscB.parameters.wavetable = "basic.triangle";
  oscB.parameters.level = 0.46;
  oscB.parameters.octave = 1;
  oscB.parameters.semitone = -2;
  oscB.parameters.fine = -9;
  filter.parameters.type = "lowpass";
  filter.parameters.cutoff = 5800;
  filter.parameters.resonance = 0.34;
  filter.parameters.drive = 0.18;
  gain.parameters.level = 0.74;
  gain.parameters.pan = -0.18;
  oscillatorMerge.parameters.levelA = 1;
  oscillatorMerge.parameters.levelB = 0.75;

  const patch = nodeGraph.compileNodeGraphToInstrumentPatch(graph, instrument);
  assert.equal(patch.nodeGraph.nodes.length, graph.nodes.length);
  assert.equal(patch.kind, "wavetable");
  assert.equal(patch.synthPatch.parameters["osc.a.enabled"], true);
  assert.equal(patch.synthPatch.parameters["osc.b.enabled"], true);
  assert.equal(patch.synthPatch.parameters["osc.a.wavetable"], "basic.saw");
  assert.equal(patch.synthPatch.parameters["osc.a.warp"], 0.41);
  assert.equal(patch.synthPatch.parameters["osc.a.warpMode"], "fold");
  assert.equal(patch.synthPatch.parameters["osc.a.semitone"], 5);
  assert.equal(patch.synthPatch.parameters["osc.a.phase"], 0.28);
  assert.equal(patch.synthPatch.parameters["osc.a.randomPhase"], 0.12);
  assert.equal(patch.synthPatch.parameters["osc.a.level"], 0.82);
  assert.ok(Math.abs(patch.synthPatch.parameters["osc.b.level"] - 0.345) < 0.000001, "Oscillator Merge should scale Oscillator B level");
  assert.equal(patch.synthPatch.parameters["osc.b.wavetable"], "basic.triangle");
  assert.equal(patch.synthPatch.parameters["osc.b.semitone"], -2);
  assert.equal(patch.synthPatch.parameters["filter.cutoff"], 5800);
  assert.equal(patch.synthPatch.parameters["amp.level"], 0.74);
  assert.deepEqual(
    patch.synthPatch.modulation.map((route) => [route.source, route.target, Number(route.amount.toFixed(3)), route.bipolar]),
    [
      ["env.1", "amp.level", 0.25, false],
      ["lfo.1", "filter.cutoff", 0.25, true],
    ],
    "default Nodemap CV cables should compile into explicit Aether modulation routes",
  );

  const cvGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  const cvOsc = nodeGraph.createInstrumentNode("oscillator", 80, 120, "CV Osc");
  const cvFilter = nodeGraph.createInstrumentNode("filter", 320, 120, "CV Filter");
  const cvGain = nodeGraph.createInstrumentNode("gain", 560, 120, "CV Gain");
  const cvLfo = nodeGraph.createInstrumentNode("lfo", 80, 360, "CV LFO");
  const cvEnv = nodeGraph.createInstrumentNode("envelope", 320, 360, "CV Envelope");
  const cvConstant = nodeGraph.createInstrumentNode("constant", 560, 360, "CV Constant");
  const cvOutput = cvGraph.nodes.find((node) => node.kind === "output");
  cvLfo.parameters.amount = -0.37;
  cvEnv.parameters.attack = 0.03;
  cvConstant.parameters.value = -0.42;
  cvGraph.nodes.push(cvOsc, cvFilter, cvGain, cvLfo, cvEnv, cvConstant);
  cvGraph.cables.push(
    cablePatch("cv-osc-filter", cvOsc, "audio-out", cvFilter, "audio-in"),
    cablePatch("cv-filter-gain", cvFilter, "audio-out", cvGain, "audio-in"),
    cablePatch("cv-gain-output", cvGain, "audio-out", cvOutput, "audio-in"),
    cablePatch("cv-lfo-pitch", cvLfo, "cv-out", cvOsc, "pitch"),
    cablePatch("cv-env-level", cvEnv, "cv-out", cvGain, "level-cv"),
    cablePatch("cv-constant-pan", cvConstant, "cv-out", cvGain, "pan-cv"),
  );
  const cvPatch = nodeGraph.compileNodeGraphToInstrumentPatch(cvGraph, instrument);
  assert.equal(cvPatch.synthPatch.parameters["amp.pan"], -0.42, "Constant CV should write static pan offset");
  assert.equal(cvPatch.synthPatch.parameters["env.1.attack"], 0.03, "Envelope node params should still compile when used as CV");
  assert.deepEqual(
    cvPatch.synthPatch.modulation.map((route) => [route.id, route.source, route.target, Number(route.amount.toFixed(3)), route.bipolar]),
    [
      ["node_cv-lfo-pitch", "lfo.1", "osc.a.fine", -0.37, true],
      ["node_cv-env-level", "env.1", "amp.level", 0.25, false],
    ],
    "CV cables should compile into deterministic Aether modulation routes",
  );

  const cvConflictGraph = nodeGraph.normalizeInstrumentNodeGraph(cvGraph, instrument);
  const cvConflictConstant = nodeGraph.createInstrumentNode("constant", 680, 360, "Second Constant");
  cvConflictConstant.id = "cv-second-constant";
  cvConflictGraph.nodes.push(cvConflictConstant);
  cvConflictGraph.cables.push(cablePatch("cv-second-pan", cvConflictConstant, "cv-out", cvGain, "pan-cv"));
  assert.deepEqual(
    nodeGraph.analyzeInstrumentNodeGraph(cvConflictGraph)
      .filter((issue) => issue.id.startsWith("control-conflict"))
      .map((issue) => issue.message),
    ["CV Gain Pan has 2 CV routes; dynamic routes are summed and static CV may override base values."],
    "graph warnings should identify stacked CV routes to the same target input",
  );

  const portAmountGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  const portAmountOsc = nodeGraph.createInstrumentNode("oscillator", 80, 120, "Port Amount Osc");
  const portAmountFilter = nodeGraph.createInstrumentNode("filter", 320, 120, "Port Amount Filter");
  const portAmountGain = nodeGraph.createInstrumentNode("gain", 560, 120, "Port Amount Gain");
  const portAmountLfo = nodeGraph.createInstrumentNode("lfo", 80, 360, "Port Amount LFO");
  const portAmountConstant = nodeGraph.createInstrumentNode("constant", 320, 360, "Port Amount Constant");
  const portAmountOutput = portAmountGraph.nodes.find((node) => node.kind === "output");
  portAmountLfo.parameters.amount = 0.6;
  portAmountFilter.parameters.cutoffCvAmount = -0.25;
  portAmountConstant.parameters.value = 0.8;
  portAmountGain.parameters.panCvAmount = -0.5;
  portAmountGraph.nodes.push(portAmountOsc, portAmountFilter, portAmountGain, portAmountLfo, portAmountConstant);
  portAmountGraph.cables.push(
    cablePatch("port-osc-filter", portAmountOsc, "audio-out", portAmountFilter, "audio-in"),
    cablePatch("port-filter-gain", portAmountFilter, "audio-out", portAmountGain, "audio-in"),
    cablePatch("port-gain-output", portAmountGain, "audio-out", portAmountOutput, "audio-in"),
    cablePatch("port-lfo-filter", portAmountLfo, "cv-out", portAmountFilter, "cutoff-cv"),
    cablePatch("port-constant-pan", portAmountConstant, "cv-out", portAmountGain, "pan-cv"),
  );
  const portAmountPatch = nodeGraph.compileNodeGraphToInstrumentPatch(portAmountGraph, instrument);
  assert.equal(portAmountPatch.synthPatch.parameters["amp.pan"], -0.4, "target port amount should scale and invert static Constant CV");
  assert.deepEqual(
    portAmountPatch.synthPatch.modulation.map((route) => [route.id, route.source, route.target, Number(route.amount.toFixed(3)), route.bipolar]),
    [["node_port-lfo-filter", "lfo.1", "filter.cutoff", -0.15, true]],
    "target port amount should scale and invert dynamic CV modulation routes",
  );

  const scaledCvGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  const scaledOsc = nodeGraph.createInstrumentNode("oscillator", 80, 120, "Scaled CV Osc");
  const scaledFilter = nodeGraph.createInstrumentNode("filter", 320, 120, "Scaled CV Filter");
  const scaledGain = nodeGraph.createInstrumentNode("gain", 560, 120, "Scaled CV Gain");
  const scaledLfo = nodeGraph.createInstrumentNode("lfo", 80, 360, "Scaled CV LFO");
  const scaledConstant = nodeGraph.createInstrumentNode("constant", 320, 360, "Scaled Constant");
  const lfoScale = nodeGraph.createInstrumentNode("cvScale", 320, 520, "Inverting Scale");
  const constantScale = nodeGraph.createInstrumentNode("cvScale", 560, 520, "Offset Scale");
  const scaledOutput = scaledCvGraph.nodes.find((node) => node.kind === "output");
  scaledLfo.parameters.amount = -0.4;
  lfoScale.parameters.amount = -0.5;
  lfoScale.parameters.offset = 0;
  scaledConstant.parameters.value = 0.5;
  constantScale.parameters.amount = -1;
  constantScale.parameters.offset = 0.25;
  scaledCvGraph.nodes.push(scaledOsc, scaledFilter, scaledGain, scaledLfo, scaledConstant, lfoScale, constantScale);
  scaledCvGraph.cables.push(
    cablePatch("scaled-osc-filter", scaledOsc, "audio-out", scaledFilter, "audio-in"),
    cablePatch("scaled-filter-gain", scaledFilter, "audio-out", scaledGain, "audio-in"),
    cablePatch("scaled-gain-output", scaledGain, "audio-out", scaledOutput, "audio-in"),
    cablePatch("scaled-lfo-scale", scaledLfo, "cv-out", lfoScale, "cv-in"),
    cablePatch("scaled-scale-filter", lfoScale, "cv-out", scaledFilter, "cutoff-cv"),
    cablePatch("scaled-constant-scale", scaledConstant, "cv-out", constantScale, "cv-in"),
    cablePatch("scaled-scale-pan", constantScale, "cv-out", scaledGain, "pan-cv"),
  );
  const scaledCvPatch = nodeGraph.compileNodeGraphToInstrumentPatch(scaledCvGraph, instrument);
  assert.equal(scaledCvPatch.synthPatch.parameters["amp.pan"], -0.25, "CV Scale should transform static Constant CV values before applying them");
  assert.deepEqual(
    scaledCvPatch.synthPatch.modulation.map((route) => [route.id, route.source, route.target, Number(route.amount.toFixed(3)), route.bipolar]),
    [["node_scaled-lfo-scale_scaled-scale-filter", "lfo.1", "filter.cutoff", 0.2, true]],
    "CV Scale should attenuate and invert dynamic CV modulation routes",
  );

  const performanceCvGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  const performanceOsc = nodeGraph.createInstrumentNode("oscillator", 80, 120, "Performance Osc");
  const performanceFilter = nodeGraph.createInstrumentNode("filter", 320, 120, "Performance Filter");
  const performanceUnison = nodeGraph.createInstrumentNode("unison", 560, 120, "Performance Unison");
  const performanceGain = nodeGraph.createInstrumentNode("gain", 800, 120, "Performance Gain");
  const velocityNode = nodeGraph.createInstrumentNode("velocity", 80, 360, "Velocity CV");
  const keytrackNode = nodeGraph.createInstrumentNode("keytrack", 280, 360, "Keytrack CV");
  const modWheelNode = nodeGraph.createInstrumentNode("modWheel", 480, 360, "Mod Wheel CV");
  const pressureNode = nodeGraph.createInstrumentNode("midiControl", 560, 430, "Pressure CV");
  const timbreNode = nodeGraph.createInstrumentNode("midiControl", 640, 430, "Timbre CV");
  const macroNode = nodeGraph.createInstrumentNode("macro", 680, 360, "Macro CV");
  const randomNode = nodeGraph.createInstrumentNode("random", 880, 360, "Random CV");
  const performanceOutput = performanceCvGraph.nodes.find((node) => node.kind === "output");
  performanceOsc.parameters.position = 0.22;
  performanceOsc.parameters.pan = -0.12;
  performanceFilter.parameters.resonance = 0.24;
  performanceFilter.parameters.drive = 0.16;
  performanceUnison.parameters.voices = 6;
  performanceUnison.parameters.detune = 0.19;
  performanceUnison.parameters.spread = 0.48;
  velocityNode.parameters.amount = 0.42;
  keytrackNode.parameters.amount = -0.31;
  modWheelNode.parameters.amount = 0.27;
  pressureNode.parameters.source = "aftertouch";
  pressureNode.parameters.amount = 0.24;
  timbreNode.parameters.source = "cc";
  timbreNode.parameters.cc = 74;
  timbreNode.parameters.amount = -0.22;
  macroNode.parameters.source = "macro.3";
  macroNode.parameters.amount = -0.18;
  randomNode.parameters.seed = 42;
  randomNode.parameters.amount = 0.5;
  randomNode.parameters.offset = 0.1;
  performanceCvGraph.nodes.push(performanceOsc, performanceFilter, performanceUnison, performanceGain, velocityNode, keytrackNode, modWheelNode, pressureNode, timbreNode, macroNode, randomNode);
  performanceCvGraph.cables.push(
    cablePatch("perf-osc-filter", performanceOsc, "audio-out", performanceFilter, "audio-in"),
    cablePatch("perf-filter-unison", performanceFilter, "audio-out", performanceUnison, "audio-in"),
    cablePatch("perf-unison-gain", performanceUnison, "audio-out", performanceGain, "audio-in"),
    cablePatch("perf-gain-output", performanceGain, "audio-out", performanceOutput, "audio-in"),
    cablePatch("perf-velocity-level", velocityNode, "cv-out", performanceGain, "level-cv"),
    cablePatch("perf-keytrack-cutoff", keytrackNode, "cv-out", performanceFilter, "cutoff-cv"),
    cablePatch("perf-keytrack-drive", keytrackNode, "cv-out", performanceFilter, "drive-cv"),
    cablePatch("perf-modwheel-resonance", modWheelNode, "cv-out", performanceFilter, "resonance-cv"),
    cablePatch("perf-pressure-pan", pressureNode, "cv-out", performanceOsc, "pan-cv"),
    cablePatch("perf-timbre-level", timbreNode, "cv-out", performanceOsc, "level-cv"),
    cablePatch("perf-macro-position", macroNode, "cv-out", performanceOsc, "position-cv"),
    cablePatch("perf-random-spread", randomNode, "cv-out", performanceUnison, "spread-cv"),
  );
  const performanceCvPatch = nodeGraph.compileNodeGraphToInstrumentPatch(performanceCvGraph, instrument);
  assert.equal(performanceCvPatch.synthPatch.parameters["osc.a.position"], 0.22, "oscillator Position should compile into the Aether wavemap position");
  assert.equal(performanceCvPatch.synthPatch.parameters["osc.a.pan"], -0.12, "oscillator Pan should compile into the Aether oscillator pan");
  assert.equal(performanceCvPatch.synthPatch.parameters["filter.resonance"], 0.24, "filter resonance should compile from the routed Filter node");
  assert.equal(performanceCvPatch.synthPatch.parameters["filter.drive"], 0.16, "filter drive should compile from the routed Filter node");
  assert.equal(performanceCvPatch.synthPatch.parameters["unison.enabled"], true, "routed Unison node should enable Aether unison");
  assert.equal(performanceCvPatch.synthPatch.parameters["unison.voices"], 6, "routed Unison node should set voice count");
  assert.equal(performanceCvPatch.synthPatch.parameters["unison.detune"], 0.19, "routed Unison node should set detune");
  assert.deepEqual(
    performanceCvPatch.synthPatch.modulation.map((route) => [route.id, route.source, route.target, Number(route.amount.toFixed(3)), route.bipolar]),
    [
      ["node_perf-velocity-level", "velocity", "amp.level", 0.42, false],
      ["node_perf-keytrack-cutoff", "keytrack", "filter.cutoff", -0.31, false],
      ["node_perf-keytrack-drive", "keytrack", "filter.drive", -0.31, false],
      ["node_perf-modwheel-resonance", "modWheel", "filter.resonance", 0.27, false],
      ["node_perf-pressure-pan", "pressure", "osc.a.pan", 0.24, true],
      ["node_perf-timbre-level", "timbre", "osc.a.level", -0.22, false],
      ["node_perf-macro-position", "macro.3", "osc.a.position", -0.18, false],
    ],
    "performance CV nodes should compile into native Aether modulation sources",
  );
  assert.ok(
    typeof performanceCvPatch.synthPatch.parameters["unison.spread"] === "number"
      && performanceCvPatch.synthPatch.parameters["unison.spread"] >= 0
      && performanceCvPatch.synthPatch.parameters["unison.spread"] <= 1,
    "Random CV should compile into a bounded deterministic static unison spread offset",
  );
  const randomSpreadA = performanceCvPatch.synthPatch.parameters["unison.spread"];
  randomNode.parameters.seed = 43;
  const performanceCvPatchB = nodeGraph.compileNodeGraphToInstrumentPatch(performanceCvGraph, instrument);
  assert.notEqual(
    Number(performanceCvPatchB.synthPatch.parameters["unison.spread"]).toFixed(5),
    Number(randomSpreadA).toFixed(5),
    "Random CV seed changes should produce a different deterministic static offset",
  );

  const preview = synthStore.synthDraftToPreviewInstrument(patch.synthPatch);
  const samples = new Float32Array(48000);
  synthPreview.renderInstrumentSamples(preview, samples, 48000, synthPreview.previewFrequency(preview), "audio", true);
  const firstStats = stats(samples);
  assert.ok(firstStats.rms > 0.01, `expected audible node graph rms, got ${firstStats.rms}`);
  assert.ok(firstStats.peak > 0.05, `expected visible node graph peak, got ${firstStats.peak}`);

  const mixerWeightGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  const mixerOscA = nodeGraph.createInstrumentNode("oscillator", 80, 120, "Mixer Osc A");
  const mixerOscB = nodeGraph.createInstrumentNode("oscillator", 80, 320, "Mixer Osc B");
  const weightedMixer = nodeGraph.createInstrumentNode("mixer", 340, 220, "Weighted Mixer");
  const mixerWeightOutput = mixerWeightGraph.nodes.find((node) => node.kind === "output");
  mixerOscA.parameters.level = 0.8;
  mixerOscB.parameters.level = 0.5;
  mixerOscB.parameters.wavetable = "basic.triangle";
  weightedMixer.parameters.level1 = 0.25;
  weightedMixer.parameters.level2 = 0.75;
  mixerWeightGraph.nodes.push(mixerOscA, mixerOscB, weightedMixer);
  mixerWeightGraph.cables.push(
    cablePatch("weighted-a", mixerOscA, "audio-out", weightedMixer, "in-1"),
    cablePatch("weighted-b", mixerOscB, "audio-out", weightedMixer, "in-2"),
    cablePatch("weighted-output", weightedMixer, "audio-out", mixerWeightOutput, "audio-in"),
  );
  const weightedMixerPatch = nodeGraph.compileNodeGraphToInstrumentPatch(mixerWeightGraph, instrument);
  assert.equal(weightedMixerPatch.synthPatch.parameters["osc.a.level"], 0.2, "Mixer input 1 should scale Oscillator A");
  assert.equal(weightedMixerPatch.synthPatch.parameters["osc.b.level"], 0.375, "Mixer input 2 should scale Oscillator B");
  const weightedMixerPreview = synthStore.synthDraftToPreviewInstrument(weightedMixerPatch.synthPatch);
  const weightedMixerSamples = new Float32Array(48000);
  synthPreview.renderInstrumentSamples(weightedMixerPreview, weightedMixerSamples, 48000, synthPreview.previewFrequency(weightedMixerPreview), "audio", true);
  weightedMixer.parameters.level2 = 0;
  const mutedMixerPatch = nodeGraph.compileNodeGraphToInstrumentPatch(mixerWeightGraph, instrument);
  assert.equal(mutedMixerPatch.synthPatch.parameters["osc.b.level"], 0, "Mixer input 2 should mute Oscillator B when no direct path exists");
  const mutedMixerPreview = synthStore.synthDraftToPreviewInstrument(mutedMixerPatch.synthPatch);
  const mutedMixerSamples = new Float32Array(48000);
  synthPreview.renderInstrumentSamples(mutedMixerPreview, mutedMixerSamples, 48000, synthPreview.previewFrequency(mutedMixerPreview), "audio", true);
  const mixerDiff = rmsDiff(weightedMixerSamples, mutedMixerSamples);
  assert.ok(mixerDiff > 0.01, `expected mixer level changes to alter render, got diff ${mixerDiff}`);

  const darkerGraph = nodeGraph.normalizeInstrumentNodeGraph(patch.nodeGraph, { ...instrument, ...patch });
  const darkerFilter = darkerGraph.nodes.find((node) => node.kind === "filter");
  assert.ok(darkerFilter, "missing darker filter node");
  darkerFilter.parameters.cutoff = 900;
  darkerFilter.parameters.resonance = 0.72;
  const darkerPatch = nodeGraph.compileNodeGraphToInstrumentPatch(darkerGraph, { ...instrument, ...patch });
  const darkerPreview = synthStore.synthDraftToPreviewInstrument(darkerPatch.synthPatch);
  const darkerSamples = new Float32Array(48000);
  synthPreview.renderInstrumentSamples(darkerPreview, darkerSamples, 48000, synthPreview.previewFrequency(darkerPreview), "audio", true);
  const darkerStats = stats(darkerSamples);
  const diff = rmsDiff(samples, darkerSamples);
  assert.ok(darkerStats.rms > 0.002, `expected altered node graph to remain audible, got ${darkerStats.rms}`);
  assert.ok(diff > 0.001, `expected node parameter changes to alter render, got diff ${diff}`);

  const cycleGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  const cycleA = nodeGraph.createInstrumentNode("mixer", 140, 140, "Cycle A");
  const cycleB = nodeGraph.createInstrumentNode("mixer", 390, 140, "Cycle B");
  const cycleOsc = nodeGraph.createInstrumentNode("oscillator", 140, 360, "Cycle Source");
  const cycleOutput = cycleGraph.nodes.find((node) => node.kind === "output");
  cycleGraph.nodes.push(cycleA, cycleB, cycleOsc);
  cycleGraph.cables.push(
    cablePatch("cycle-source-a", cycleOsc, "audio-out", cycleA, "in-1"),
    cablePatch("cycle-a-b", cycleA, "audio-out", cycleB, "in-1"),
    cablePatch("cycle-b-a", cycleB, "audio-out", cycleA, "in-2"),
    cablePatch("cycle-b-output", cycleB, "audio-out", cycleOutput, "audio-in"),
  );
  const cyclePatch = nodeGraph.compileNodeGraphToInstrumentPatch(cycleGraph, instrument);
  assert.equal(cyclePatch.synthPatch.parameters["osc.a.enabled"], true, "cycle-safe traversal should still find routed source nodes");
  const cyclePreview = synthStore.synthDraftToPreviewInstrument(cyclePatch.synthPatch);
  const cycleSamples = new Float32Array(6000);
  synthPreview.renderInstrumentSamples(cyclePreview, cycleSamples, 48000, synthPreview.previewFrequency(cyclePreview), "audio", true);
  assert.ok(stats(cycleSamples).rms > 0.001, "cycle-safe graph should render without hanging or going silent");

  const largeGraph = createLargeNodeGraph(nodeGraph);
  assert.equal(largeGraph.nodes.length, 100, "large graph fixture should cover 100 nodes");
  assert.equal(largeGraph.cables.length, 300, "large graph fixture should cover 300 cables");
  assert.equal(
    largeGraph.cables.filter((cable) => cable.fromPortId === "cv-out").length,
    50,
    "large graph fixture should cover 50 control routes",
  );
  const largeStart = performance.now();
  let largePatch = null;
  for (let i = 0; i < 20; i += 1) {
    largePatch = nodeGraph.compileNodeGraphToInstrumentPatch(largeGraph, instrument);
  }
  const largeMs = performance.now() - largeStart;
  assert.ok(largePatch.synthPatch.modulation.length >= 10, "large graph should compile a dense set of control routes");
  assert.ok(largePatch.synthPatch.parameters["osc.a.enabled"], "large graph should still find an audible source");
  assert.ok(largeMs < 1500, `large graph compile benchmark regressed: ${largeMs.toFixed(2)}ms for 20 compiles`);
  const largePreview = synthStore.synthDraftToPreviewInstrument(largePatch.synthPatch);
  const largePreviewSamples = new Float32Array(12000);
  const largePreviewStart = performance.now();
  for (let i = 0; i < 3; i += 1) {
    synthPreview.renderInstrumentSamples(largePreview, largePreviewSamples, 48000, synthPreview.previewFrequency(largePreview), "audio", true);
  }
  const largePreviewMs = performance.now() - largePreviewStart;
  const largePreviewStats = stats(largePreviewSamples);
  assert.ok(largePreviewStats.rms > 0.00005, `large graph preview should stay finite and non-silent, got rms ${largePreviewStats.rms}`);
  assert.ok(largePreviewMs < 1500, `large graph preview benchmark regressed: ${largePreviewMs.toFixed(2)}ms for 3 renders`);

  console.log(JSON.stringify({
    ok: true,
    nodes: graph.nodes.length,
    cables: graph.cables.length,
    rms: firstStats.rms,
    peak: firstStats.peak,
    alteredRms: darkerStats.rms,
    diff,
    largeGraphMs: Number(largeMs.toFixed(2)),
    largePreviewMs: Number(largePreviewMs.toFixed(2)),
    largePreviewRms: largePreviewStats.rms,
    releaseRuleNodes: EXPECTED_NODE_KINDS.length,
  }, null, 2));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

function assertNodeReleaseRules(nodeGraph) {
  const definitions = nodeGraph.NODE_DEFINITIONS;
  assert.ok(definitions, "Nodemap node definitions must be exported for release-rule verification");
  assert.deepEqual(
    Object.keys(definitions).sort(),
    [...EXPECTED_NODE_KINDS].sort(),
    "Every InstrumentNodeKind must have exactly one Nodemap node definition",
  );

  const groupedNodeKinds = nodeGraph.NODE_BROWSER_GROUPS.flatMap((group) => group.nodeKinds);
  assert.deepEqual(
    [...nodeGraph.CV_SOURCE_NODE_KINDS].sort(),
    ["constant", "envelope", "keytrack", "lfo", "macro", "midiControl", "modWheel", "random", "velocity"],
    "The consolidated CV Source picker must retain every compatibility-stable CV source type",
  );
  assert.deepEqual(
    nodeGraph.CV_SOURCE_NODE_OPTIONS.map((option) => option.value).sort(),
    [...nodeGraph.CV_SOURCE_NODE_KINDS].sort(),
    "The consolidated CV Source picker must expose every supported CV source exactly once",
  );
  assert.equal(new Set(groupedNodeKinds).size, groupedNodeKinds.length, "Node browser groups must not duplicate node kinds");
  assert.equal(groupedNodeKinds.includes("output"), false, "Instrument Out is protected and must not be user-creatable from the browser");
  assert.deepEqual(
    [...groupedNodeKinds].sort(),
    EXPECTED_BROWSER_NODE_KINDS.sort(),
    "Every current catalog node must appear exactly once in the grouped node browser while hidden compatibility aliases stay out",
  );
  assert.deepEqual(
    EXPECTED_NODE_KINDS.filter((kind) => !groupedNodeKinds.includes(kind) && kind !== "output").sort(),
    [...HIDDEN_COMPATIBILITY_NODE_KINDS].sort(),
    "Only documented compatibility aliases should be hidden from the Nodemap browser",
  );

  assert.deepEqual(
    definitions.envelope.inputs,
    [],
    "Envelope is a CV source and should not advertise fake CV inputs",
  );
  assert.deepEqual(
    definitions.envelope.outputs,
    [{ id: "cv-out", label: "CV", kind: "output", signal: "control" }],
    "Envelope should expose one control-voltage output",
  );
  const multiInputPorts = Object.entries(definitions)
    .flatMap(([kind, definition]) => definition.inputs
      .filter((port) => port.acceptsMultiple)
      .map((port) => `${kind}.${port.id}`))
    .sort();
  assert.deepEqual(
    multiInputPorts,
    ["mixer.in-1", "mixer.in-2", "mixer.in-3", "output.audio-in"],
    "Only Mixer inputs and Instrument Out should accept multiple incoming cables",
  );
  const declaredControlInputs = Object.entries(definitions)
    .flatMap(([kind, definition]) => definition.inputs.map((port) => `${kind}.${port.id}:${port.signal}`))
    .filter((entry) => entry.endsWith(":control"))
    .map((entry) => entry.replace(/:control$/, ""))
    .sort();
  assert.deepEqual(
    declaredControlInputs,
    [
      "cvCombiner.cv-a",
      "cvCombiner.cv-b",
      "cvCombiner.cv-c",
      "cvScale.cv-in",
      "drive.drive-cv",
      "drive.mix-cv",
      "drive.tone-cv",
      "filter.cutoff-cv",
      "filter.drive-cv",
      "filter.resonance-cv",
      "gain.level-cv",
      "gain.pan-cv",
      "gateTrigger.gate-in",
      "gateTrigger.trigger-in",
      "instrument.level-cv",
      "instrument.pitch",
      "noise.level-cv",
      "oscillator.level-cv",
      "oscillator.pan-cv",
      "oscillator.pitch",
      "oscillator.position-cv",
      "panWidth.pan-cv",
      "panWidth.width-cv",
      "resonator.decay-cv",
      "resonator.mix-cv",
      "resonator.pitch-cv",
      "unison.detune-cv",
      "unison.spread-cv",
      "wavetableLfo.position-cv",
      "wavetableLfo.reset",
    ],
    "Nodemap should expose explicit CV-input targets for pitch, level, pan, filter, unison, noise, instrument, utility, gate, and catalog routing",
  );

  for (const kind of EXPECTED_NODE_KINDS) {
    const definition = definitions[kind];
    assert.ok(definition, `${kind} must have a node definition`);
    assert.equal(typeof definition.label, "string", `${kind} must have a user-facing label`);
    assert.ok(definition.label.trim().length > 0, `${kind} must have a non-empty label`);
    assert.equal(typeof definition.description, "string", `${kind} must have a user-facing description`);
    assert.ok(definition.description.trim().length >= 20, `${kind} description is too thin for production`);
    assert.doesNotMatch(
      definition.description,
      /\b(todo|placeholder|stub|reserved|deferred|later)\b/i,
      `${kind} description must not describe production behavior as deferred or placeholder-level`,
    );
    assert.ok(Array.isArray(definition.inputs), `${kind} must declare visible input ports`);
    assert.ok(Array.isArray(definition.outputs), `${kind} must declare visible output ports`);
    assert.ok(Array.isArray(definition.parameters), `${kind} must declare a parameter list`);
    assert.ok(definition.defaults && typeof definition.defaults === "object", `${kind} must declare parameter defaults`);

    if (kind === "output") {
      assert.ok(definition.inputs.length > 0, "Instrument Out must expose at least one visible input");
      assert.equal(definition.outputs.length, 0, "Instrument Out must not expose output ports");
    } else {
      assert.ok(definition.outputs.length > 0, `${kind} must expose at least one visible output`);
    }

    const created = nodeGraph.createInstrumentNode(kind, 12, 34);
    assert.deepEqual(created.inputs, definition.inputs, `${kind} created-node inputs must match definition inputs`);
    assert.deepEqual(created.outputs, definition.outputs, `${kind} created-node outputs must match definition outputs`);
    assert.deepEqual(created.parameters, definition.defaults, `${kind} created-node defaults must match definition defaults`);

    const portKeys = new Set();
    for (const port of [...definition.inputs, ...definition.outputs]) {
      assert.equal(typeof port.id, "string", `${kind} ports must have ids`);
      assert.ok(port.id.trim().length > 0, `${kind} ports must have non-empty ids`);
      assert.equal(typeof port.label, "string", `${kind} port ${port.id} must have a label`);
      assert.ok(port.label.trim().length > 0, `${kind} port ${port.id} must have a non-empty label`);
      assert.ok(["input", "output"].includes(port.kind), `${kind} port ${port.id} must declare input/output direction`);
      assert.ok(["audio", "control"].includes(port.signal), `${kind} port ${port.id} must declare audio/control signal`);
      const portKey = `${port.kind}:${port.id}`;
      assert.equal(portKeys.has(portKey), false, `${kind} has duplicate ${port.kind} port id ${port.id}`);
      portKeys.add(portKey);
    }

    const parameterIds = new Set();
    for (const parameter of definition.parameters) {
      assert.equal(typeof parameter.id, "string", `${kind} parameters must have ids`);
      assert.ok(parameter.id.trim().length > 0, `${kind} parameters must have non-empty ids`);
      assert.equal(parameterIds.has(parameter.id), false, `${kind} has duplicate parameter id ${parameter.id}`);
      parameterIds.add(parameter.id);
      assert.equal(typeof parameter.label, "string", `${kind}.${parameter.id} must have a label`);
      assert.ok(parameter.label.trim().length > 0, `${kind}.${parameter.id} must have a non-empty label`);
      assert.ok(["number", "select", "boolean"].includes(parameter.kind), `${kind}.${parameter.id} must have a supported parameter kind`);
      assert.ok(Object.hasOwn(definition.defaults, parameter.id), `${kind}.${parameter.id} must have a default value`);

      const defaultValue = definition.defaults[parameter.id];
      if (parameter.kind === "number") {
        assert.equal(typeof defaultValue, "number", `${kind}.${parameter.id} default must be numeric`);
        assert.equal(Number.isFinite(defaultValue), true, `${kind}.${parameter.id} default must be finite`);
        if (typeof parameter.min === "number") assert.ok(defaultValue >= parameter.min, `${kind}.${parameter.id} default is below min`);
        if (typeof parameter.max === "number") assert.ok(defaultValue <= parameter.max, `${kind}.${parameter.id} default is above max`);
      } else if (parameter.kind === "boolean") {
        assert.equal(typeof defaultValue, "boolean", `${kind}.${parameter.id} default must be boolean`);
      } else {
        assert.equal(typeof defaultValue, "string", `${kind}.${parameter.id} default must be string`);
        assert.ok(Array.isArray(parameter.options) && parameter.options.length > 0, `${kind}.${parameter.id} select must expose options`);
        assert.ok(parameter.options.some((option) => option.value === defaultValue), `${kind}.${parameter.id} default must match one select option`);
      }
    }

    for (const key of Object.keys(definition.defaults)) {
      assert.ok(parameterIds.has(key), `${kind} default ${key} does not have a visible parameter control`);
    }

    assert.ok(
      RELEASE_RULE_COVERED_NODE_KINDS.has(kind),
      `${kind} must be covered by verifier/browser/runtime proof before release`,
    );
  }
}

function stats(samples) {
  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    assert.equal(Number.isFinite(sample), true);
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return { rms: Math.sqrt(sumSquares / samples.length), peak };
}

function rmsDiff(a, b) {
  let sumSquares = 0;
  for (let i = 0; i < a.length; i++) {
    const delta = a[i] - b[i];
    sumSquares += delta * delta;
  }
  return Math.sqrt(sumSquares / a.length);
}

function cablePatch(id, from, fromPortId, to, toPortId) {
  return { id, fromNodeId: from.id, fromPortId, toNodeId: to.id, toPortId };
}

function templateKinds(graph) {
  return graph.nodes.map((node) => node.kind);
}

function createLargeNodeGraph(nodeGraph) {
  const graph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  const output = graph.nodes.find((node) => node.kind === "output");
  output.id = "large-output";
  output.x = 1800;
  output.y = 420;

  const oscillators = Array.from({ length: 35 }, (_, index) => {
    const node = nodeGraph.createInstrumentNode("oscillator", 80 + (index % 5) * 120, 80 + Math.floor(index / 5) * 92, `Large Osc ${index + 1}`);
    node.id = `large-osc-${index}`;
    node.parameters.level = 0.25 + (index % 5) * 0.04;
    node.parameters.wavetable = index % 3 === 0 ? "basic.saw" : index % 3 === 1 ? "basic.square" : "basic.triangle";
    return node;
  });
  const filters = Array.from({ length: 20 }, (_, index) => {
    const node = nodeGraph.createInstrumentNode("filter", 760 + (index % 4) * 132, 80 + Math.floor(index / 4) * 110, `Large Filter ${index + 1}`);
    node.id = `large-filter-${index}`;
    node.parameters.cutoff = 800 + index * 320;
    node.parameters.resonance = (index % 8) / 12;
    return node;
  });
  const gains = Array.from({ length: 20 }, (_, index) => {
    const node = nodeGraph.createInstrumentNode("gain", 1280 + (index % 4) * 118, 80 + Math.floor(index / 4) * 110, `Large Gain ${index + 1}`);
    node.id = `large-gain-${index}`;
    node.parameters.level = 0.35 + (index % 6) * 0.06;
    return node;
  });
  const mixers = Array.from({ length: 10 }, (_, index) => {
    const node = nodeGraph.createInstrumentNode("mixer", 520 + (index % 2) * 120, 100 + index * 74, `Large Mixer ${index + 1}`);
    node.id = `large-mixer-${index}`;
    node.parameters.level1 = 0.2 + (index % 4) * 0.1;
    node.parameters.level2 = 0.35;
    node.parameters.level3 = 0.5;
    return node;
  });
  const lfos = Array.from({ length: 14 }, (_, index) => {
    const node = nodeGraph.createInstrumentNode("lfo", 1480 + (index % 2) * 120, 620 + Math.floor(index / 2) * 52, `Large LFO ${index + 1}`);
    node.id = `large-lfo-${index}`;
    node.parameters.amount = index % 2 === 0 ? 0.18 : -0.22;
    node.parameters.rate = 0.2 + index * 0.11;
    return node;
  });

  graph.nodes.push(...oscillators, ...filters, ...gains, ...mixers, ...lfos);

  const cables = [];
  const add = (id, from, fromPortId, to, toPortId) => {
    cables.push(cablePatch(id, from, fromPortId, to, toPortId));
  };

  for (let i = 0; i < 35; i += 1) {
    for (let j = 0; j < 5; j += 1) {
      const mixer = mixers[(i + j) % mixers.length];
      const port = j % 3 === 0 ? "in-1" : j % 3 === 1 ? "in-2" : "in-3";
      add(`large-audio-osc-${i}-${j}`, oscillators[i], "audio-out", mixer, port);
    }
  }
  for (let i = 0; i < mixers.length; i += 1) {
    add(`large-audio-mixer-filter-${i}`, mixers[i], "audio-out", filters[i % filters.length], "audio-in");
  }
  for (let i = 0; i < filters.length; i += 1) {
    add(`large-audio-filter-gain-${i}`, filters[i], "audio-out", gains[i % gains.length], "audio-in");
  }
  for (let i = 0; i < gains.length; i += 1) {
    add(`large-audio-gain-output-${i}`, gains[i], "audio-out", output, "audio-in");
  }
  for (let i = 0; i < 50; i += 1) {
    const lfo = lfos[i % lfos.length];
    const target = i % 2 === 0 ? filters[i % filters.length] : gains[i % gains.length];
    add(`large-cv-${i}`, lfo, "cv-out", target, i % 2 === 0 ? "cutoff-cv" : "level-cv");
  }
  for (let i = 0; cables.length < 300; i += 1) {
    add(`large-extra-${i}`, oscillators[i % oscillators.length], "audio-out", gains[(i * 7) % gains.length], "audio-in");
  }
  graph.cables = cables.slice(0, 300);
  return graph;
}
