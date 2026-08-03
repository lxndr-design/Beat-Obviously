#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { build } from "../frontend/node_modules/esbuild/lib/main.js";

const [sourceArg, manifestArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !manifestArg) {
  console.error("Usage: node scripts/import-standards-corpus.mjs SCORE_DIRECTORY metadata.json [catalog.json]");
  console.error("Only Public Domain, CC0-1.0, and CC-BY-4.0 entries with non-conflicting provenance can enter the bundled catalog.");
  process.exit(1);
}

const repoRoot = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(sourceArg);
const manifestPath = resolve(manifestArg);
const outputPath = resolve(outputArg ?? join(repoRoot, "frontend/src/ai/standardsCatalog.generated.json"));
const metadata = JSON.parse(readFileSync(manifestPath, "utf8"));
const entries = Array.isArray(metadata) ? metadata : metadata.entries;
if (!Array.isArray(entries)) throw new Error("Standards metadata must be an array or { entries: [] }.");

const temporaryDirectory = mkdtempSync(join(tmpdir(), "beat-standards-import-"));
const bundlePath = join(temporaryDirectory, "standards-import.mjs");

try {
  await build({
    stdin: {
      resolveDir: join(repoRoot, "frontend/src"),
      sourcefile: "standards-import.ts",
      loader: "ts",
      contents: `
        export { parseMusicXmlSource } from "./scoreImport/musicXmlImport.ts";
        export { createStandardGenerationProfile, validateBundledStandards } from "./ai/standardsCorpus.ts";
      `,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundlePath,
  });
  const api = await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`);
  const profiles = [];
  const skipped = [];

  for (const item of entries) {
    const relativePath = String(item.path ?? "");
    const filePath = resolve(sourceDirectory, relativePath);
    if (!filePath.startsWith(`${sourceDirectory}/`) || !existsSync(filePath)) {
      skipped.push({ path: relativePath, reason: "missing score" });
      continue;
    }
    if (!/\.(musicxml|mxl|xml)$/i.test(filePath)) {
      skipped.push({ path: relativePath, reason: "not MusicXML/MXL" });
      continue;
    }
    const source = {
      sourceName: relative(sourceDirectory, filePath),
      sourceUrl: item.sourceUrl,
      license: item.license,
      licenseUrl: item.licenseUrl,
      noLicenseConflict: item.noLicenseConflict ?? item.no_license_conflict,
    };
    try {
      const plan = api.parseMusicXmlSource({ name: basename(filePath), bytes: new Uint8Array(readFileSync(filePath)) });
      const allowedUses = new Set(["all", "pop", "rap", "dnb", "jazz", "reggae", "classical", "electronic"]);
      const generationUses = Array.isArray(item.generationUses)
        ? item.generationUses.filter((use) => allowedUses.has(use))
        : ["all"];
      const profile = api.createStandardGenerationProfile(plan, source, generationUses);
      if (item.title) profile.title = item.title;
      if (item.composer) profile.composer = item.composer;
      profiles.push(profile);
    } catch (error) {
      skipped.push({ path: relativePath, reason: error instanceof Error ? error.message : "parse failed" });
    }
  }

  const validation = api.validateBundledStandards(profiles);
  for (const rejected of validation.rejected) skipped.push({ path: rejected.id, reason: rejected.reason });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceManifest: basename(manifestPath),
    entries: validation.accepted,
    skipped,
  }, null, 2)}\n`);
  console.log(`Standards catalog: ${validation.accepted.length} accepted, ${skipped.length} skipped -> ${outputPath}`);
  if (skipped.length > 0) console.log(skipped.map((entry) => `- ${entry.path}: ${entry.reason}`).join("\n"));
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
