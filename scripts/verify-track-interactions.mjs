#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-track-interactions-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/features/Tracks/segmentMath.ts"),
      join(repoRoot, "frontend/src/features/Tracks/arrangementAutomationLane.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outdir=${outDir}`,
    ],
    { stdio: "inherit" },
  );

  const math = await import(pathToFileURL(join(outDir, "segmentMath.js")));
  const automationLane = await import(pathToFileURL(join(outDir, "arrangementAutomationLane.js")));
  const smart = { timeSignatureBeats: 4, timelineSmartGrid: true, timelineSubdivision: 4 };
  const dense = { timeSignatureBeats: 3, timelineSmartGrid: true, timelineSubdivision: 8 };
  const fixed = { timeSignatureBeats: 4, timelineSmartGrid: false, timelineSubdivision: 4 };

  assert.equal(math.GRID_TICK_BEATS, 1);
  assert.equal(math.snapDragBeat(3.375, false, smart), 3.375, "default segment body drag must stay free");
  assert.equal(math.snapDragBeat(-0.5, false, smart), 0, "free drag still clamps before beat zero");
  assert.equal(math.snapDragBeat(3.49, true, smart), 3, "shift body drag snaps to smart timeline grid");
  assert.equal(math.snapDragBeat(3.49, true, dense), 3.5, "shift body drag honors configured subdivision");
  assert.equal(math.snapDragBeat(3.49, true, fixed), 3, "shift body drag falls back to beat grid without smart grid");

  assert.equal(math.snapStepBeats(false, smart), 1);
  assert.equal(math.snapStepBeats(false, dense), 0.5);
  assert.equal(math.snapStepBeats(true, dense), 3, "shift resize/fade uses full measure");
  assert.equal(math.snapBeat(2.6, false, smart), 2.6, "default resize-left drag must stay free");
  assert.equal(math.snapBeat(2.6, true, dense), 3);
  assert.equal(math.snapLen(0.2, false, smart), 1, "resize keeps a minimum one-beat segment");
  assert.equal(math.snapLen(2.2, false, smart), 2.2, "default resize-right drag must stay free");
  assert.equal(math.snapLen(2.2, true, smart), 4);
  assert.equal(math.snapFadeLen(1.7, 4, false, dense), 1.7, "default fade drag must stay free");
  assert.equal(math.snapFadeLen(1.7, 4, true, dense), 3);
  assert.equal(math.snapFadeLen(6, 4, false, smart), 4, "fade length is clamped to segment length");
  assert.equal(math.clampFadeLen(-1, 4), 0);
  assert.equal(math.clampFadeLen(5, 4), 4);

  const automationTrack = {
    automation: [{
      target: "macro.1",
      points: [
        { beat: 0, value: 0.2, curve: "linear" },
        { beat: 4, value: 0.5, curve: "smoothstep" },
        { beat: 8, value: 0.8, curve: "easeOut" },
      ],
    }],
  };
  const preview = automationLane.arrangementAutomationPreview(automationTrack, 8, 64);
  assert.ok(preview, "arrangement automation preview should render active Aether lanes");
  assert.equal(preview.target, "macro.1");
  assert.equal(preview.points.length, 3);
  assert.equal(preview.points[1].index, 1, "preview points retain source point indexes");
  assert.equal(preview.points[1].x, 256);
  assert.equal(automationLane.arrangementAutomationAddPointBeat(8), 4, "arrangement automation add uses the project midpoint");
  assert.equal(automationLane.arrangementAutomationAddPointBeat(0), 0.0005, "arrangement automation add keeps zero-length projects bounded");
  assert.equal(automationLane.arrangementAutomationRemovePointIndex(preview.points, 1), 1, "arrangement automation remove uses the active point when present");
  assert.equal(automationLane.arrangementAutomationRemovePointIndex(preview.points, 99), 2, "arrangement automation remove falls back to the last rendered point");
  assert.equal(automationLane.arrangementAutomationRemovePointIndex([], 0), null, "arrangement automation remove is empty-lane safe");

  const freeAutomationDrag = automationLane.arrangementAutomationDragValue({
    clientX: 193,
    clientY: 8,
    laneLeft: 0,
    previewTop: 0,
    projectLengthBeats: 8,
    beatsToPx: 64,
    height: 22,
    target: "macro.1",
    shiftKey: false,
    timelineSmartGrid: true,
    timelineSubdivision: 4,
  });
  assert.equal(freeAutomationDrag.beat, 193 / 64, "arrangement automation point drag stays free by default");
  assert.ok(freeAutomationDrag.value > 0.5 && freeAutomationDrag.value < 0.8, "drag value maps Y into the target range");

  const snappedAutomationDrag = automationLane.arrangementAutomationDragValue({
    ...freeAutomationDrag,
    clientX: 193,
    clientY: 8,
    laneLeft: 0,
    previewTop: 0,
    projectLengthBeats: 8,
    beatsToPx: 64,
    height: 22,
    target: "macro.1",
    shiftKey: true,
    timelineSmartGrid: true,
    timelineSubdivision: 4,
  });
  assert.equal(snappedAutomationDrag.beat, 3, "shift arrangement automation drag snaps to the timeline subdivision");

  console.log(JSON.stringify({
    ok: true,
    freeDragBeat: math.snapDragBeat(3.375, false, smart),
    shiftDragBeat: math.snapDragBeat(3.49, true, dense),
    shiftResizeStep: math.snapStepBeats(true, dense),
    automationPointCount: preview.points.length,
    automationAddBeat: automationLane.arrangementAutomationAddPointBeat(8),
    automationRemoveFallback: automationLane.arrangementAutomationRemovePointIndex(preview.points, 99),
    freeAutomationBeat: freeAutomationDrag.beat,
    shiftAutomationBeat: snappedAutomationDrag.beat,
  }, null, 2));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
