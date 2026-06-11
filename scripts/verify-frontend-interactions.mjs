#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-frontend-interactions-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/testing/interactionRunner.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outfile=${join(outDir, "interactionRunner.js")}`,
    ],
    { stdio: "inherit" },
  );

  const runner = await import(pathToFileURL(join(outDir, "interactionRunner.js")));

  assert.equal(runner.snapBeat(1.12, 0.25), 1, "snapBeat should snap to nearest grid");
  assert.equal(runner.snapBeat(1.13, 0.25), 1.25, "snapBeat should round upward past the midpoint");

  assert.deepEqual(
    runner.previewSegmentDrag({
      originStartBeat: 4,
      originLengthBeats: 2,
      pointerDeltaPx: 54,
      beatsToPx: 24,
      projectLengthBeats: 64,
      gridBeats: 0.25,
    }),
    { startBeat: 6.25, deltaBeats: 2.25 },
    "drag preview should convert pixels to snapped beats",
  );

  assert.deepEqual(
    runner.previewSegmentDrag({
      originStartBeat: 63,
      originLengthBeats: 4,
      pointerDeltaPx: 1000,
      beatsToPx: 24,
      projectLengthBeats: 64,
      gridBeats: 0.25,
    }),
    { startBeat: 60, deltaBeats: -3 },
    "drag preview should clamp against project end",
  );

  assert.deepEqual(
    runner.previewSegmentResize({
      edge: "start",
      originStartBeat: 8,
      originLengthBeats: 4,
      pointerDeltaPx: 90,
      beatsToPx: 24,
      projectLengthBeats: 64,
      gridBeats: 0.25,
    }),
    { startBeat: 11.75, lengthBeats: 0.25 },
    "start resize should preserve a minimum segment length",
  );

  assert.deepEqual(
    runner.previewSegmentResize({
      edge: "end",
      originStartBeat: 60,
      originLengthBeats: 2,
      pointerDeltaPx: 400,
      beatsToPx: 24,
      projectLengthBeats: 64,
      gridBeats: 0.25,
    }),
    { startBeat: 60, lengthBeats: 4 },
    "end resize should clamp against project end",
  );

  assert.deepEqual(
    runner.previewLoopClampDrag({
      marker: "start",
      startBeat: 4,
      endBeat: 8,
      pointerBeat: 9,
      projectLengthBeats: 64,
    }),
    { startBeat: 7.75, endBeat: 8 },
    "start loop clamp should never pass the end clamp",
  );

  assert.deepEqual(
    runner.previewLoopClampDrag({
      marker: "end",
      startBeat: 4,
      endBeat: 8,
      pointerBeat: 2,
      projectLengthBeats: 64,
    }),
    { startBeat: 4, endBeat: 4.25 },
    "end loop clamp should never pass the start clamp",
  );

  assert.deepEqual(
    runner.previewMarqueeFromPointers({
      startClientX: 240,
      startClientY: 620,
      currentClientX: 120,
      currentClientY: 500,
      containerLeft: 100,
      containerTop: 200,
      timelineBottom: 560,
    }),
    {
      left: 120,
      top: 500,
      right: 240,
      bottom: 560,
      style: { left: 20, top: 300, width: 120, height: 60 },
    },
    "marquee preview should clamp to the editable timeline body",
  );

  assert.equal(runner.shouldCloseModal({ reason: "backdrop", dirty: true }), false);
  assert.equal(runner.shouldCloseModal({ reason: "backdrop", dirty: false }), false);
  assert.equal(runner.shouldCloseModal({ reason: "escape", dirty: true }), false);
  assert.equal(runner.shouldCloseModal({ reason: "escape", dirty: false }), true);
  assert.equal(runner.shouldCloseModal({ reason: "button", dirty: true }), true);

  const plugin = (id, patch = {}) => ({
    id,
    name: id,
    vendor: "Beat",
    kind: "renderer",
    format: "decent-sampler",
    status: "installed",
    instrumentMode: "rendered-audio",
    description: id,
    capabilities: [],
    ...patch,
  });

  assert.deepEqual(
    runner.previewPluginHydrationMerge({
      factory: [plugin("factory", { factory: true })],
      persisted: [plugin("ds-lorenzo", { sourcePath: "/packs/Lorenzo.dspreset" })],
      current: [plugin("current-session")],
      project: [plugin("project-local"), plugin("ds-lorenzo", { sourcePath: "/packs/Lorenzo.dspreset" })],
    }),
    ["factory", "ds-lorenzo", "current-session", "project-local"],
    "plugin hydration should preserve global DS adapters and dedupe matching project adapters",
  );

  const hydratedPlugins = runner.previewPluginHydrationAdapters({
    factory: [],
    persisted: [
      plugin("stale-ds", {
        kind: "synth",
        format: "decent-sampler",
        instrumentMode: "fallback-aether",
        capabilities: [{ id: "bad", kind: "instrument", label: "Create Aether", realtime: true, offline: true, fallbackMode: "aether" }],
      }),
    ],
    current: [],
    project: [],
  });
  assert.equal(hydratedPlugins[0].kind, "renderer", "DecentSampler plugins should normalize to renderer packages");
  assert.equal(hydratedPlugins[0].instrumentMode, "live-instrument", "DecentSampler plugins should use Beat sampler instruments, not Aether fallback");
  assert.equal(hydratedPlugins[0].capabilities[0].realtime, true, "DecentSampler packages should advertise realtime Beat sampler compatibility");
  assert.equal(hydratedPlugins[0].capabilities[0].fallbackMode, "pass-through", "DecentSampler capabilities should not retain Aether fallback");

  const migratedStalePlugins = runner.previewPluginHydrationAdapters({
    factory: [],
    persisted: [
      plugin("stale-bridge-ds", {
        name: "Lorenzos Drums DecentSampler",
        vendor: "External",
        kind: "synth",
        format: "bridge",
        sourceFileName: "283049_LorenzosDrums_LorenzoWood_v1_DecentSampler.zip",
        instrumentMode: "fallback-aether",
      }),
    ],
    current: [],
    project: [],
  });
  assert.equal(migratedStalePlugins[0].format, "decent-sampler", "stale DecentSampler bridge records should migrate to DS packages");
  assert.equal(migratedStalePlugins[0].kind, "renderer", "stale DecentSampler bridge records should not remain synths");
  assert.equal(migratedStalePlugins[0].instrumentMode, "live-instrument", "stale DecentSampler bridge records should not open the Aether synth path");
  assert.equal(migratedStalePlugins[0].capabilities[0].realtime, true, "migrated DecentSampler adapters should keep realtime sampler capability");

  const dsEffects = runner.previewDecentSamplerEffects({
    name: "Synthetic DS",
    path: "/packs/synthetic.dspreset",
    uiControlDetails: [
      {
        kind: "labeled-knob",
        label: "Tone",
        value: 18000,
        bindings: [{ type: "effect", level: "instrument", parameter: "FX_FILTER_FREQUENCY", position: 0 }],
      },
      {
        kind: "labeled-knob",
        label: "Space",
        value: 0.42,
        bindings: [{ type: "effect", level: "instrument", parameter: "FX_REVERB_WET_LEVEL", position: 1 }],
      },
    ],
    effects: [
      { type: "lowpass_4pl", position: 0, frequency: 22000, resonance: 0.2 },
      { type: "reverb", position: 1, wetLevel: 0, roomSize: 0.85, damping: 0.2 },
    ],
    sampleUrls: [],
    samples: [],
    audioFiles: [],
  });
  assert.equal(dsEffects.length, 2, "DecentSampler effects should map into native Beat instrument FX");
  assert.equal(dsEffects[0].kind, "lowpass", "DecentSampler lowpass should stay lowpass, not synth fallback");
  assert.equal(dsEffects[0].params.cutoffHz, 18000, "bound DS filter control should override static effect frequency");
  assert.equal(dsEffects[1].kind, "reverb", "DecentSampler reverb should stay reverb");
  assert.equal(dsEffects[1].params.mix, 42, "bound DS reverb wet control should map to Beat mix percent");
  assert.equal(dsEffects[1].params.roomSize, 85, "DS room size should map to Beat room percent");

  console.log("Frontend interaction runner verifier passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
