#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const matrix = JSON.parse(read("docs/audio/lumen-serum2-capability-matrix.json"));

assert.equal(matrix.schema, "beat.lumen-serum2-capability-matrix.v1");
assert.equal(matrix.comparisonMode, "feature-contract");
assert.equal(matrix.directAudioComparison.status, "blocked-no-local-reference-renderer");
assert.ok(matrix.rows.length >= 18, "Lumen benchmark must cover the hybrid source, routing, modulation, sequencing, workflow, and verification surfaces");
assert.equal(new Set(matrix.rows.map((row) => row.id)).size, matrix.rows.length, "capability IDs must be unique");
for (const id of ["oscillator.types", "sample.playback", "granular.engine", "spectral.engine", "modulation.workflow", "sequencing.arp-clip", "compatibility.aether", "performance.equivalent-patch"]) {
  assert.ok(matrix.rows.some((row) => row.id === id), `missing Lumen benchmark row: ${id}`);
}
assert.equal(
  matrix.rows.find((row) => row.id === "performance.equivalent-patch")?.status,
  "measured-pass",
  "the equivalent-patch performance row must stay aligned with the executable gate",
);
for (const url of matrix.reference.urls) {
  const parsed = new URL(url);
  assert.ok(parsed.hostname === "xferrecords.com" || parsed.hostname.endsWith(".xferrecords.com"), `non-canonical reference host: ${parsed.hostname}`);
}

const types = read("frontend/src/state/types.ts");
const store = read("frontend/src/state/synthStore.ts");
const library = read("frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx");
const instrumentsPage = read("frontend/src/features/HomeHub/InstrumentsPage.solid.tsx");
const host = read("frontend/src/features/EditorHost/EditorHost.solid.tsx");
const params = read("backend/Source/Audio/Parameters/ParameterIds.h");
const contract = read("backend/Source/Audio/Parameters/SynthPatchContract.cpp");
const oscillatorPanel = read("frontend/src/features/Synth/OscillatorPanel/OscillatorPanel.solid.tsx");
const synthEditor = read("frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx");
const clipAdapter = read("frontend/src/features/Synth/lumenClipPianoRoll.ts");

assert.ok(types.includes('"wavetable-synth" | "lumen-hybrid-synth"'));
assert.ok(types.includes('"synth" | "lumen"'));
assert.ok(store.includes('LUMEN_INSTRUMENT_TYPE = "lumen-hybrid-synth"'));
assert.ok(store.includes('LUMEN_PARAMETER_NAMESPACE = "lumen"'));
assert.ok(store.includes('LEGACY_LUMUS_INSTRUMENT_TYPE = "lumus-hybrid-synth"'), "pre-Lumen projects must retain an explicit read compatibility identity");
assert.ok(store.includes('LEGACY_LUMUS_PARAMETER_NAMESPACE = "lumus"'));
assert.ok(store.includes("canonicalizeLegacyLumusPatch"), "frontend normalization must migrate legacy Lumus payloads before validation");
assert.ok(store.includes("createDefaultLumenDraft"));
assert.ok(store.includes("cloneAetherDraftAsLumen"));
assert.ok(store.includes('"lumen.clone.source-not-aether"'));
assert.ok(store.includes("LUMEN_PATCH_SCHEMA_VERSION = 16"));
assert.ok(store.includes('"lumen.arp.enabled"'));
assert.ok(store.includes('"lumen.arp.swing"'));
assert.ok(store.includes('"lumen.arp.key"'));
assert.ok(store.includes('"lumen.arp.scale"'));
assert.ok(store.includes('"lumen.clip.enabled"'));
assert.ok(store.includes("normalizeLumenClip"));
assert.ok(store.includes("lumenSampleSlots"));
assert.ok(store.includes('{ id: "c", name: "Source C" }'));
assert.ok(store.includes("normalizeLumenSourceRack"));
assert.ok(library.includes('label: "Create Lumen"'));
assert.ok(library.includes('label: "Clone as Lumen"'), "Aether library rows must expose the explicit source-preserving Lumen clone action");
assert.ok(library.includes('? "Lumen"'), "The track instrument browser must label legacy Lumen identities with the Lumen product name");
assert.ok(instrumentsPage.includes('function isLumenInstrument'));
assert.ok(instrumentsPage.includes('if (isLumenInstrument(instrument)) return "Lumen";'), "The home instrument browser must not present Lumen as Aether");
assert.ok(host.includes('title="Instrument - Lumen Engine"'));
assert.ok(params.includes('instrumentTypeLumenHybridSynth { "lumen-hybrid-synth" }'));
assert.ok(params.includes('legacyInstrumentTypeLumusHybridSynth { "lumus-hybrid-synth" }'));
assert.ok(params.includes('legacyLumusNamespace { "lumus" }'));
assert.ok(params.includes("lumenPatchSchemaVersion = 16"));
assert.ok(params.includes("lumenKeytrackedLfoPatchSchemaVersion = 16"));
assert.ok(params.includes("lumenArpeggiatorPatchSchemaVersion = 7"));
assert.ok(params.includes("lumenArpeggiatorSwingPatchSchemaVersion = 8"));
assert.ok(params.includes("lumenArpeggiatorScalePatchSchemaVersion = 9"));
assert.ok(params.includes("lumenClipPatchSchemaVersion = 10"));
assert.ok(params.includes("lumenPolyphonicClipPatchSchemaVersion = 11"));
assert.ok(params.includes("lumenSamplePlaybackPatchSchemaVersion = 12"));
assert.ok(params.includes("lumenSampleLoopTailPatchSchemaVersion = 13"));
assert.ok(params.includes("lumenSampleSlicePatchSchemaVersion = 14"));
assert.ok(params.includes("lumenSpectralWarpPatchSchemaVersion = 15"));
assert.ok(store.includes('direction: "forward"'));
assert.ok(store.includes("playbackRate: 1"));
assert.ok(store.includes('loopMode: "forward"'));
assert.ok(store.includes("releaseTailMs: 4"));
assert.ok(store.includes('selectedSliceId: ""'));
assert.ok(synthEditor.includes('label="Direction"'));
assert.ok(synthEditor.includes('label="Rate"'));
assert.ok(synthEditor.includes('label="Loop Mode"'));
assert.ok(synthEditor.includes('label="Release Tail"'));
assert.ok(synthEditor.includes('label="Slice"'));
assert.ok(synthEditor.includes('label="Slice Start"'));
assert.ok(contract.includes("InstrumentDefinition::SynthEngine::Lumen"));
assert.ok(contract.includes("canonicalizeLegacyLumusSynthPatch"), "native patch application must accept legacy Lumus documents");
assert.ok(contract.includes('customWavetables, "c", allowSpectralWarp, oscC'));
assert.ok(contract.includes('"osc.c.position"'));
assert.ok(contract.includes('"osc.c.unison.spread"'));
assert.ok(oscillatorPanel.includes('label="Route"'));
assert.ok(oscillatorPanel.includes("<FloatingSelect"), "Lumen route UI must reuse the existing selector component");
assert.ok(oscillatorPanel.includes("lumenSlotIndex"), "All three Lumen slots must share the source-mode selector path");
assert.ok(oscillatorPanel.includes('{ value: "granular", label: "Granular" }'), "All three Lumen slots must expose the bounded granular mode through the shared selector");
assert.ok(oscillatorPanel.includes('{ value: "multisample", label: "Multisample" }'), "All three Lumen slots must expose the bounded multisample policy mode");
assert.ok(oscillatorPanel.includes('{ value: "spectral-smear", label: "Spectral Smear" }'), "Lumen wavetable slots must expose the prepared spectral warp family");
assert.ok(synthEditor.includes('ariaLabel="Arpeggiator key"'));
assert.ok(synthEditor.includes('ariaLabel="Arpeggiator scale"'));
assert.ok(synthEditor.includes('{ value: "naturalMinor", label: "Natural Minor" }'));
assert.ok(synthEditor.includes('<FloatingSelect'), "Lumen key/scale UI must reuse the existing selector component");
assert.ok(synthEditor.includes('aria-label="Lumen clip sequencer"'));
assert.ok(synthEditor.includes('aria-label="Lumen clip piano roll"'));
assert.ok(synthEditor.includes('? "Lumen engine" : "Aether engine"'), "The shared synth editor region must announce the active engine identity");
assert.ok(synthEditor.includes("<PianoRoll"), "Lumen clip editing must reuse Beat's existing piano roll");
assert.ok(clipAdapter.includes("LUMEN_CLIP_MAX_NOTES = 64"));
assert.ok(clipAdapter.includes("LUMEN_CLIP_REFERENCE_PITCH - 48"));
assert.ok(clipAdapter.includes("LUMEN_CLIP_REFERENCE_PITCH + 48"));
assert.ok(synthEditor.includes('"Lumen instrument effects" : "Aether instrument effects"'), "The shared insert rack must expose the active synth identity");
assert.ok(synthEditor.includes('`${isLumen() ? "Lumen" : "Aether"} source FX buses`'), "The shared source-bus controls must expose Lumen rather than Aether branding");

console.log(`Lumen foundation verification passed (${matrix.rows.length} benchmark rows).`);
