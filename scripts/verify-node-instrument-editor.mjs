#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-node-instrument-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

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

  const starterGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  assert.equal(starterGraph.schemaVersion, 1);
  assert.equal(starterGraph.nodes.length, 1, "new nodepath instruments should start with only output");
  assert.equal(starterGraph.nodes[0].kind, "output");
  assert.equal(starterGraph.nodes[0].label, "Instrument Out");
  assert.equal(starterGraph.cables.length, 0, "new nodepath instruments should not create starter cables");

  const starterPatch = nodeGraph.compileNodeGraphToInstrumentPatch(starterGraph, instrument);
  assert.equal(starterPatch.nodeGraph.nodes.length, 1);
  assert.equal(starterPatch.synthPatch.parameters["osc.a.enabled"], false);
  assert.equal(starterPatch.synthPatch.parameters["osc.b.enabled"], false);
  assert.equal(starterPatch.synthPatch.parameters["amp.level"], 0);

  const disconnectedGraph = nodeGraph.createOutputOnlyInstrumentNodeGraph();
  disconnectedGraph.nodes.push(nodeGraph.createInstrumentNode("oscillator", 120, 120, "Loose Oscillator"));
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

  const graph = nodeGraph.createDefaultInstrumentNodeGraph(instrument);
  assert.equal(graph.schemaVersion, 1);
  assert.equal(graph.nodes.length >= 6, true, "default graph should create useful starter nodes");
  assert.equal(graph.cables.length >= 5, true, "default graph should connect an audible path");

  const oscA = graph.nodes.find((node) => node.label === "Oscillator A");
  const oscB = graph.nodes.find((node) => node.label === "Oscillator B");
  const filter = graph.nodes.find((node) => node.kind === "filter");
  const gain = graph.nodes.find((node) => node.kind === "gain");
  assert.ok(oscA, "missing oscillator A");
  assert.ok(oscB, "missing oscillator B");
  assert.ok(filter, "missing filter node");
  assert.ok(gain, "missing gain node");

  const mixer = graph.nodes.find((node) => node.kind === "mixer");
  assert.ok(mixer, "missing mixer node");
  graph.cables.push(
    {
      id: "multi-output-to-filter",
      fromNodeId: oscA.id,
      fromPortId: "audio-out",
      toNodeId: filter.id,
      toPortId: "audio-in",
    },
    {
      id: "multi-input-from-osc-b",
      fromNodeId: oscB.id,
      fromPortId: "audio-out",
      toNodeId: filter.id,
      toPortId: "audio-in",
    },
  );
  const multiNormalized = nodeGraph.normalizeInstrumentNodeGraph(graph, instrument);
  assert.equal(
    multiNormalized.cables.filter((cable) => cable.fromNodeId === oscA.id && cable.fromPortId === "audio-out").length >= 2,
    true,
    "one output port should support multiple outgoing cables",
  );
  assert.equal(
    multiNormalized.cables.filter((cable) => cable.toNodeId === filter.id && cable.toPortId === "audio-in").length >= 3,
    true,
    "one input port should support multiple incoming cables",
  );

  oscA.parameters.waveform = "saw";
  oscA.parameters.level = 0.82;
  oscB.parameters.waveform = "triangle";
  oscB.parameters.level = 0.46;
  oscB.parameters.octave = 1;
  oscB.parameters.fine = -9;
  filter.parameters.type = "lowpass";
  filter.parameters.cutoff = 5800;
  filter.parameters.resonance = 0.34;
  filter.parameters.drive = 0.18;
  gain.parameters.level = 0.74;
  gain.parameters.pan = -0.18;

  const patch = nodeGraph.compileNodeGraphToInstrumentPatch(graph, instrument);
  assert.equal(patch.nodeGraph.nodes.length, graph.nodes.length);
  assert.equal(patch.kind, "wavetable");
  assert.equal(patch.synthPatch.parameters["osc.a.enabled"], true);
  assert.equal(patch.synthPatch.parameters["osc.b.enabled"], true);
  assert.equal(patch.synthPatch.parameters["osc.b.wavetable"], "basic.triangle");
  assert.equal(patch.synthPatch.parameters["filter.cutoff"], 5800);
  assert.equal(patch.synthPatch.parameters["amp.level"], 0.74);

  const preview = synthStore.synthDraftToPreviewInstrument(patch.synthPatch);
  const samples = new Float32Array(48000);
  synthPreview.renderInstrumentSamples(preview, samples, 48000, synthPreview.previewFrequency(preview), "audio", true);
  const firstStats = stats(samples);
  assert.ok(firstStats.rms > 0.01, `expected audible node graph rms, got ${firstStats.rms}`);
  assert.ok(firstStats.peak > 0.05, `expected visible node graph peak, got ${firstStats.peak}`);

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

  console.log(JSON.stringify({
    ok: true,
    nodes: graph.nodes.length,
    cables: graph.cables.length,
    rms: firstStats.rms,
    peak: firstStats.peak,
    alteredRms: darkerStats.rms,
    diff,
  }, null, 2));
} finally {
  rmSync(outDir, { recursive: true, force: true });
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
