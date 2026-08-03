#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = join(import.meta.dirname, "..");
const temporaryBundle = join(tmpdir(), `beat-dense-operations-${Date.now()}.mjs`);

try {
  execFileSync(join(repoRoot, "frontend/node_modules/.bin/esbuild"), [
    join(repoRoot, "frontend/src/testing/denseStressProjects.ts"),
    "--bundle", "--format=esm", "--platform=node", `--outfile=${temporaryBundle}`,
  ], { stdio: "ignore" });
  const benchmark = await import(pathToFileURL(temporaryBundle));
  const projects = [];
  for (const index of [1, 2, 3]) {
    global.gc?.();
    const memoryBefore = process.memoryUsage();
    const serialized = readFileSync(join(repoRoot, "generated-tests", `dense_${index}.beat`), "utf8");
    const metrics = benchmark.benchmarkDenseStressDocumentOperations(serialized);
    const memoryAfter = process.memoryUsage();
    projects.push({
      ...metrics,
      heapUsedDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
      rssDeltaBytes: memoryAfter.rss - memoryBefore.rss,
    });
  }
  const result = { generatedAt: new Date().toISOString(), projects };
  writeFileSync(join(repoRoot, "generated-tests/dense-operation-metrics.json"), JSON.stringify(result, null, 2));
  console.table(projects.map((metric) => ({
    project: metric.name,
    notes: metric.sourceNotes,
    renderedArpNotes: metric.renderedArpeggioNotes,
    parseMs: Number(metric.parseAndMigrateMs.toFixed(1)),
    arpRenderMs: Number(metric.arpeggiationRenderMs.toFixed(1)),
    roundAllMs: Number(metric.roundAllMs.toFixed(1)),
    remixAllMs: Number(metric.remixAllMs.toFixed(1)),
    serializeMs: Number(metric.serializeMs.toFixed(1)),
    totalMs: Number(metric.totalMs.toFixed(1)),
    rssDeltaMB: Number((metric.rssDeltaBytes / 1024 / 1024).toFixed(1)),
    timedOut: metric.exceededThirtySecondBudget,
  })));
  if (projects.some((metric) => metric.exceededThirtySecondBudget)) process.exitCode = 1;
} finally {
  rmSync(temporaryBundle, { force: true });
}
