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
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outdir=${outDir}`,
    ],
    { stdio: "inherit" },
  );

  const math = await import(pathToFileURL(join(outDir, "segmentMath.js")));
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

  console.log(JSON.stringify({
    ok: true,
    freeDragBeat: math.snapDragBeat(3.375, false, smart),
    shiftDragBeat: math.snapDragBeat(3.49, true, dense),
    shiftResizeStep: math.snapStepBeats(true, dense),
  }, null, 2));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
