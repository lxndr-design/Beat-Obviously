#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const matrix = JSON.parse(read("docs/audio/lumus-serum2-capability-matrix.json"));

assert.equal(matrix.schema, "beat.lumus-serum2-capability-matrix.v1");
assert.equal(matrix.comparisonMode, "feature-contract");
assert.equal(matrix.directAudioComparison.status, "blocked-no-local-reference-renderer");
assert.ok(matrix.rows.length >= 10, "Lumus benchmark must cover the complete foundation surface");
assert.equal(new Set(matrix.rows.map((row) => row.id)).size, matrix.rows.length, "capability IDs must be unique");
for (const url of matrix.reference.urls) {
  const parsed = new URL(url);
  assert.ok(parsed.hostname === "xferrecords.com" || parsed.hostname.endsWith(".xferrecords.com"), `non-canonical reference host: ${parsed.hostname}`);
}

const types = read("frontend/src/state/types.ts");
const store = read("frontend/src/state/synthStore.ts");
const library = read("frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx");
const host = read("frontend/src/features/EditorHost/EditorHost.solid.tsx");
const params = read("backend/Source/Audio/Parameters/ParameterIds.h");
const contract = read("backend/Source/Audio/Parameters/SynthPatchContract.cpp");

assert.ok(types.includes('"wavetable-synth" | "lumus-hybrid-synth"'));
assert.ok(types.includes('"synth" | "lumus"'));
assert.ok(store.includes('LUMUS_INSTRUMENT_TYPE = "lumus-hybrid-synth"'));
assert.ok(store.includes('LUMUS_PARAMETER_NAMESPACE = "lumus"'));
assert.ok(store.includes("createDefaultLumusDraft"));
assert.ok(library.includes('label: "Create Lumus"'));
assert.ok(host.includes('title="Instrument - Lumus Engine"'));
assert.ok(params.includes('instrumentTypeLumusHybridSynth { "lumus-hybrid-synth" }'));
assert.ok(contract.includes("InstrumentDefinition::SynthEngine::Lumus"));

console.log(`Lumus foundation verification passed (${matrix.rows.length} benchmark rows).`);
