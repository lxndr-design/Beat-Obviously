#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-aether-preset-audit-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const REQUIRED_FAMILIES = [
  "Bass",
  "Drum",
  "FX",
  "Keys",
  "Lead",
  "Pad",
  "Percussion",
  "Pluck",
  "Template",
  "Texture",
  "Wavetable",
];
const MIN_RMS = 0.005;
const MIN_PEAK = 0.02;
const MAX_PEAK = 0.99;

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/state/synthStore.ts"),
      join(repoRoot, "frontend/src/audio/synthPreview.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outdir=${outDir}`,
    ],
    { stdio: "pipe" },
  );

  const synthStore = await import(pathToFileURL(join(outDir, "state/synthStore.js")));
  const synthPreview = await import(pathToFileURL(join(outDir, "audio/synthPreview.js")));
  const seenFamilies = new Set();
  const rows = synthStore.FACTORY_SYNTH_PRESETS.map((preset) => {
    if (!preset.id || !preset.name || !preset.category || !preset.family || !preset.role) {
      throw new Error(`${preset.id || preset.name || "unknown preset"} is missing required preset identity metadata`);
    }
    if (!preset.description || preset.description.trim().length < 32) {
      throw new Error(`${preset.id} is missing a release-grade description`);
    }
    if (!preset.auditionNote || preset.auditionNote.trim().length < 48) {
      throw new Error(`${preset.id} is missing a release-grade audition note`);
    }
    if (/\b(todo|placeholder|stub|generic|later)\b/i.test(preset.description) || /\b(todo|placeholder|stub|generic|later)\b/i.test(preset.auditionNote)) {
      throw new Error(`${preset.id} contains placeholder preset copy`);
    }
    seenFamilies.add(preset.family);
    const preview = synthStore.synthDraftToPreviewInstrument(preset.patch);
    const samples = new Float32Array(24000);
    synthPreview.renderInstrumentSamples(preview, samples, 48000, synthPreview.previewFrequency(preview), "audio", true);
    let sumSquares = 0;
    let peak = 0;
    for (const sample of samples) {
      if (!Number.isFinite(sample)) throw new Error(`${preset.id} rendered a non-finite sample`);
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    if (rms < MIN_RMS) {
      throw new Error(`${preset.id} rendered below minimum RMS: ${rms}`);
    }
    if (peak < MIN_PEAK) {
      throw new Error(`${preset.id} rendered below minimum peak: ${peak}`);
    }
    if (peak > MAX_PEAK) {
      throw new Error(`${preset.id} rendered too close to clipping: ${peak}`);
    }
    const macroLabels = ["macro.1", "macro.2", "macro.3", "macro.4"].map((id) => preset.patch.metadata.macros[id]?.label ?? "");
    const macroRouteCount = preset.patch.modulation.filter((route) => route.source.startsWith("macro.")).length;
    if (preset.id !== "factory.init") {
      if (new Set(macroLabels).size !== macroLabels.length || macroLabels.some((label) => label.trim().length < 3)) {
        throw new Error(`${preset.id} has weak or duplicate macro labels`);
      }
      if (macroLabels.join("|") === "Motion|Color|Shape|Space") {
        throw new Error(`${preset.id} is using the generic macro layout`);
      }
      if (macroRouteCount < 4) {
        throw new Error(`${preset.id} is missing factory macro route assignments`);
      }
    }
    return {
      id: preset.id,
      name: preset.name,
      family: preset.family,
      role: preset.role,
      category: preset.category,
      routes: preset.patch.modulation.length,
      macroLabels,
      macroRouteCount,
      fx: preset.patch.effects?.filters.length ?? 0,
      rms: Number(rms.toFixed(5)),
      peak: Number(peak.toFixed(5)),
      auditionNote: preset.auditionNote,
    };
  });
  const missingFamilies = REQUIRED_FAMILIES.filter((family) => !seenFamilies.has(family));
  if (missingFamilies.length > 0) {
    throw new Error(`Factory Aether presets are missing required families: ${missingFamilies.join(", ")}`);
  }

  console.log(JSON.stringify({
    ok: true,
    count: rows.length,
    thresholds: {
      minRms: MIN_RMS,
      minPeak: MIN_PEAK,
      maxPeak: MAX_PEAK,
    },
    families: [...new Set(rows.map((row) => row.family))].sort(),
    auditionLogComplete: true,
    presets: rows,
  }, null, 2));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
