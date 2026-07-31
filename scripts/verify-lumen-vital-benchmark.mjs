#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const matrix = JSON.parse(read("docs/audio/lumen-vital-capability-matrix.json"));

assert.equal(matrix.schema, "beat.lumen-vital-capability-matrix.v1");
assert.equal(matrix.comparisonMode, "feature-contract");
assert.equal(matrix.reference.binaryVersion, null);
assert.equal(matrix.reference.sourceSnapshot, "636ca0ef517a4db087a6a08a6a8a5e704e21f836");
assert.equal(matrix.directAudioComparison.status, "blocked-no-local-reference-renderer");
assert.equal(matrix.rows.find((row) => row.id === "modulation.stereo-remap")?.status, "partial",
  "bounded route remapping must be recorded without claiming stereo or arbitrary-curve parity");
assert.equal(matrix.rows.find((row) => row.id === "wavetable.spectral-warping")?.status, "partial",
  "prepared harmonic-domain warp modes must be recorded without claiming a full spectral source engine");
assert.ok(matrix.rows.length >= 18, "Vital benchmark must cover synthesis, modulation, workflow, performance, and provenance");
assert.equal(new Set(matrix.rows.map((row) => row.id)).size, matrix.rows.length, "capability IDs must be unique");

for (const url of matrix.reference.urls) {
  const parsed = new URL(url);
  assert.ok(parsed.hostname === "vital.audio" || parsed.hostname === "github.com", `non-canonical Vital reference host: ${parsed.hostname}`);
}

for (const id of [
  "wavetable.spectral-warping",
  "modulation.audio-rate",
  "modulation.stereo-remap",
  "sample.hybrid-depth",
  "expression.mpe",
  "tuning.microtonal-files",
  "performance.direct-reference",
  "licensing.provenance",
]) {
  assert.ok(matrix.rows.some((row) => row.id === id), `missing Vital benchmark row: ${id}`);
}

const synthStore = read("frontend/src/state/synthStore.ts");
const limits = read("frontend/src/audio/aetherLimits.ts");
const parameterPolicy = read("backend/Source/Audio/Parameters/ParameterPolicy.h");
const dynamicModulation = read("backend/Source/Audio/Modulation/DynamicModulation.h");
const instrumentVoice = read("backend/Source/Audio/InstrumentVoice.cpp");
const aetherRenderer = read("backend/Source/Audio/Oscillator/AetherTableStackRenderer.h");
const wavetableFactory = read("backend/Source/Audio/Wavetable/WavetableFactory.cpp");
const ledger = read("docs/audio/external-source-ledger.md");
const sourceAudit = read("docs/audio/lumen-vital-source-audit.md");
const integration = read("docs/audio/lumen-vital-integration-2026-07-28.md");

assert.ok(synthStore.includes('LUMEN_INSTRUMENT_TYPE = "lumen-hybrid-synth"'));
assert.ok(synthStore.includes('LUMEN_PARAMETER_NAMESPACE = "lumen"'));
assert.ok(synthStore.includes('{ value: "granular", label: "Granular" }') || synthStore.includes('"granular"'));
assert.ok(synthStore.includes('"lumen.clip.enabled"'));
assert.ok(limits.includes("AETHER_MAX_UNISON_VOICES = 16"));
assert.ok(parameterPolicy.includes("audioRate"), "the benchmark must stay aligned with Beat's explicit parameter-rate taxonomy");
assert.ok(dynamicModulation.includes("struct PreparedState"));
assert.ok(dynamicModulation.includes("PreparedTarget prepareTarget"));
assert.ok(dynamicModulation.includes("applyRemapCurve"), "native modulation must evaluate prepared route response curves");
assert.ok(instrumentVoice.includes("cachedPreparedDynamicModulation"));
assert.ok(instrumentVoice.includes("runtimeWarpNeedsWork"));
assert.ok(aetherRenderer.includes("Result renderPrepared("));
assert.ok(wavetableFactory.includes("spectralWarpedAmplitude"));
assert.ok(wavetableFactory.includes("WavetableWarpMode::SpectralSmear"));
assert.ok(ledger.includes("Vital `636ca0ef517a4db087a6a08a6a8a5e704e21f836` | GPLv3"));
assert.ok(ledger.includes("Before any Vital-derived line enters Beat:"));
assert.ok(ledger.includes("## Vital source-architecture benchmark review"));
assert.ok(ledger.includes("it was not built, executed, linked, copied, modified, imported, or added as a Beat dependency"));
assert.equal(matrix.sourceArchitectureAudit.status, "reviewed-no-import");
assert.equal(matrix.sourceArchitectureAudit.document, "docs/audio/lumen-vital-source-audit.md");
for (const requirement of [
  "Prepared modulation execution plan",
  "Source-stage spectral warp buffers",
  "Sparse block render kernels",
  "SIMD unison/voice kernel",
  "reviewed Vital files are GPLv3 source",
]) {
  assert.ok(sourceAudit.includes(requirement), `source audit is missing requirement: ${requirement}`);
}
for (const requirement of [
  "Prepared sparse modulation",
  "Active warp-lane execution",
  "removes no instrument type",
  "8/8 output-equivalent rows",
  "not a before/after performance claim",
]) {
  assert.ok(integration.includes(requirement), `integration record is missing requirement: ${requirement}`);
}

console.log(`Lumen/Vital feature-contract verification passed (${matrix.rows.length} benchmark rows; direct renderer blocked).`);
