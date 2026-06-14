#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;

const options = parseArgs(process.argv.slice(2));
const outDir = join(tmpdir(), `beat-dense-midi-benchmark-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

try {
  const bundleStart = now();
  execFileSync(
    join(repoRoot, "frontend", "node_modules", ".bin", "esbuild"),
    [
      join(repoRoot, "frontend/src/state/store.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outfile=${join(outDir, "store.js")}`,
    ],
    { stdio: options.quiet ? "ignore" : "inherit" },
  );
  const bundleMs = elapsed(bundleStart);

  const importStart = now();
  const store = await import(pathToFileURL(join(outDir, "store.js")));
  const importMs = elapsed(importStart);

  const runs = [];
  for (let run = 0; run < options.runs; run++) {
    runs.push(runDenseMidiBenchmark(store, options));
  }

  const result = {
    config: {
      tracks: options.tracks,
      segmentsPerTrack: options.segmentsPerTrack,
      notesPerSegment: options.notesPerSegment,
      runs: options.runs,
      projectLengthBeats: projectLengthBeats(options),
    },
    counts: {
      segments: options.tracks * options.segmentsPerTrack,
      notes: options.tracks * options.segmentsPerTrack * options.notesPerSegment,
    },
    overhead: {
      bundleMs,
      importMs,
    },
    runs,
    summary: summarizeRuns(runs),
  };

  if (options.json) {
    console.log(JSON.stringify(roundNumbers(result), null, 2));
  } else {
    printHumanSummary(result);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

function runDenseMidiBenchmark(store, options) {
  maybeGc();
  const memoryBefore = process.memoryUsage();
  const totalStart = now();

  const setupStart = now();
  const projectStore = store.useProjectStore.getState();
  projectStore.loadProject(store.createEmptyProject());
  store.useProjectStore.getState().setLengthBeats(projectLengthBeats(options));
  store.useProjectStore.temporal.getState().clear();
  const trackIds = [store.useProjectStore.getState().project.tracks[0].id];
  for (let trackIndex = 1; trackIndex < options.tracks; trackIndex++) {
    trackIds.push(store.useProjectStore.getState().addTrack({
      name: `Dense MIDI ${trackIndex + 1}`,
      kind: "midi",
    }));
  }
  const setupMs = elapsed(setupStart);

  const segmentIds = [];
  let noteGenerationMs = 0;
  let segmentInsertMs = 0;
  const creationStart = now();
  for (const [trackIndex, trackId] of trackIds.entries()) {
    for (let segmentIndex = 0; segmentIndex < options.segmentsPerTrack; segmentIndex++) {
      const noteStart = now();
      const notes = makeDenseMidiNotes(trackIndex, segmentIndex, options.notesPerSegment);
      noteGenerationMs += elapsed(noteStart);

      const insertStart = now();
      segmentIds.push(store.useProjectStore.getState().addSegment(trackId, {
        name: `Dense ${trackIndex + 1}-${segmentIndex + 1}`,
        startBeat: segmentIndex * 4,
        lengthBeats: 4,
        payload: { kind: "midi", notes },
      }));
      segmentInsertMs += elapsed(insertStart);
    }
  }
  const creationMs = elapsed(creationStart);

  const firstScanStart = now();
  let project = store.useProjectStore.getState().project;
  const initialStats = projectStats(project);
  assert.equal(initialStats.tracks, options.tracks, "dense MIDI benchmark should create requested track count");
  assert.equal(initialStats.segments, options.tracks * options.segmentsPerTrack, "dense MIDI benchmark should create requested segment count");
  assert.equal(initialStats.notes, options.tracks * options.segmentsPerTrack * options.notesPerSegment, "dense MIDI benchmark should create requested note count");
  assert.equal(initialStats.inBounds, true, "dense MIDI benchmark should create in-bounds segments");
  const firstScanMs = elapsed(firstScanStart);

  const nudgeStart = now();
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "nudge",
    segmentIds,
    deltaBeats: 0.25,
  });
  const nudgeMs = elapsed(nudgeStart);

  const quantizeStart = now();
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "quantize",
    segmentIds,
    gridBeats: 0.25,
  });
  const quantizeMs = elapsed(quantizeStart);

  const finalScanStart = now();
  project = store.useProjectStore.getState().project;
  const finalStats = projectStats(project);
  assert.equal(finalStats.segments, initialStats.segments, "dense MIDI edits should preserve segment count");
  assert.equal(finalStats.notes, initialStats.notes, "dense MIDI edits should preserve note count");
  assert.equal(finalStats.inBounds, true, "dense MIDI edits should keep segments in bounds");
  const finalScanMs = elapsed(finalScanStart);

  const totalMs = elapsed(totalStart);
  const memoryAfter = process.memoryUsage();

  return {
    setupMs,
    creationMs,
    noteGenerationMs,
    segmentInsertMs,
    firstScanMs,
    nudgeMs,
    quantizeMs,
    finalScanMs,
    totalMs,
    throughput: {
      notesCreatedPerMs: initialStats.notes / Math.max(creationMs, 0.001),
      segmentsCreatedPerMs: initialStats.segments / Math.max(creationMs, 0.001),
      segmentsNudgedPerMs: initialStats.segments / Math.max(nudgeMs, 0.001),
      segmentsQuantizedPerMs: initialStats.segments / Math.max(quantizeMs, 0.001),
    },
    memory: memoryDelta(memoryBefore, memoryAfter),
    historyPastStates: store.useProjectStore.temporal.getState().pastStates.length,
    stats: finalStats,
  };
}

function makeDenseMidiNotes(trackIndex, segmentIndex, count) {
  return Array.from({ length: count }, (_, noteIndex) => ({
    pitch: 48 + ((trackIndex * 7 + noteIndex) % 36),
    velocity: 64 + ((segmentIndex + noteIndex) % 48),
    startBeat: (noteIndex % 25) * 0.16,
    lengthBeats: 0.08 + ((noteIndex % 4) * 0.04),
  }));
}

function projectStats(project) {
  const segments = project.tracks.flatMap((track) => track.segments);
  const notes = segments.reduce((sum, segment) => (
    sum + (segment.payload.kind === "midi" ? segment.payload.notes.length : 0)
  ), 0);
  return {
    tracks: project.tracks.length,
    segments: segments.length,
    notes,
    inBounds: segments.every((segment) =>
      Number.isFinite(segment.startBeat)
      && Number.isFinite(segment.lengthBeats)
      && segment.startBeat >= 0
      && segment.lengthBeats > 0
      && segment.startBeat + segment.lengthBeats <= project.lengthBeats
    ),
  };
}

function summarizeRuns(runs) {
  const keys = [
    "setupMs",
    "creationMs",
    "noteGenerationMs",
    "segmentInsertMs",
    "firstScanMs",
    "nudgeMs",
    "quantizeMs",
    "finalScanMs",
    "totalMs",
  ];
  const summary = {};
  for (const key of keys) {
    const values = runs.map((run) => run[key]);
    summary[key] = {
      min: Math.min(...values),
      median: median(values),
      max: Math.max(...values),
      avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    };
  }
  summary.memoryHeapUsedDeltaMB = summarizeMemory(runs, "heapUsedDeltaMB");
  summary.memoryRssDeltaMB = summarizeMemory(runs, "rssDeltaMB");
  return summary;
}

function summarizeMemory(runs, key) {
  const values = runs.map((run) => run.memory[key]);
  return {
    min: Math.min(...values),
    median: median(values),
    max: Math.max(...values),
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function printHumanSummary(result) {
  const { config, counts, overhead, summary, runs } = roundNumbers(result);
  console.log("Beat dense MIDI benchmark");
  console.log(`Config: ${config.tracks} tracks x ${config.segmentsPerTrack} segments/track x ${config.notesPerSegment} notes/segment`);
  console.log(`Load: ${counts.segments} segments, ${counts.notes} notes, ${config.runs} run(s), ${config.projectLengthBeats} project beats`);
  console.log(`Bundle/import overhead: ${overhead.bundleMs}ms / ${overhead.importMs}ms`);
  console.log("");
  console.table(runs.map((run, index) => ({
    run: index + 1,
    setupMs: run.setupMs,
    creationMs: run.creationMs,
    nudgeMs: run.nudgeMs,
    quantizeMs: run.quantizeMs,
    totalMs: run.totalMs,
    heapDeltaMB: run.memory.heapUsedDeltaMB,
    rssDeltaMB: run.memory.rssDeltaMB,
    notesPerMs: run.throughput.notesCreatedPerMs,
  })));
  console.log("Median timings:");
  console.table({
    setupMs: summary.setupMs.median,
    creationMs: summary.creationMs.median,
    noteGenerationMs: summary.noteGenerationMs.median,
    segmentInsertMs: summary.segmentInsertMs.median,
    nudgeMs: summary.nudgeMs.median,
    quantizeMs: summary.quantizeMs.median,
    finalScanMs: summary.finalScanMs.median,
    totalMs: summary.totalMs.median,
    heapDeltaMB: summary.memoryHeapUsedDeltaMB.median,
    rssDeltaMB: summary.memoryRssDeltaMB.median,
  });
  console.log("Result: PASS");
}

function parseArgs(args) {
  const options = {
    tracks: 10,
    segmentsPerTrack: 50,
    notesPerSegment: 100,
    runs: 3,
    json: false,
    quiet: false,
  };
  for (const arg of args) {
    if (arg === "--json") options.json = true;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg.startsWith("--tracks=")) options.tracks = positiveInt(arg, "tracks");
    else if (arg.startsWith("--segments-per-track=")) options.segmentsPerTrack = positiveInt(arg, "segments-per-track");
    else if (arg.startsWith("--notes-per-segment=")) options.notesPerSegment = positiveInt(arg, "notes-per-segment");
    else if (arg.startsWith("--runs=")) options.runs = positiveInt(arg, "runs");
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function positiveInt(arg, label) {
  const value = Number(arg.split("=")[1]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${label} must be a positive integer`);
  return value;
}

function projectLengthBeats(options) {
  return Math.max(64, Math.min(4096, options.segmentsPerTrack * 4 + 56));
}

function now() {
  return performance.now();
}

function elapsed(start) {
  return performance.now() - start;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function memoryDelta(before, after) {
  return {
    heapUsedBeforeMB: bytesToMb(before.heapUsed),
    heapUsedAfterMB: bytesToMb(after.heapUsed),
    heapUsedDeltaMB: bytesToMb(after.heapUsed - before.heapUsed),
    rssBeforeMB: bytesToMb(before.rss),
    rssAfterMB: bytesToMb(after.rss),
    rssDeltaMB: bytesToMb(after.rss - before.rss),
  };
}

function bytesToMb(bytes) {
  return bytes / 1024 / 1024;
}

function maybeGc() {
  if (typeof globalThis.gc === "function") globalThis.gc();
}

function roundNumbers(value) {
  if (typeof value === "number") return Number(value.toFixed(3));
  if (Array.isArray(value)) return value.map(roundNumbers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, roundNumbers(child)]));
  }
  return value;
}
