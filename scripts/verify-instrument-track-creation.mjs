import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createInstrumentSegmentPatch,
  instrumentUsesDrumSegment,
} from "../frontend/src/state/instrumentTrackCreation.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseInstrument = {
  id: "test-piano",
  name: "Warm Piano",
  kind: "sampler",
  waveform: "sample",
  sampleIds: [],
  knobs: { cutoff: 0.5, resonance: 0.2, drive: 0.1, color: 0.5 },
  envelope: { attackMs: 1, decayMs: 100, sustain: 0.8, releaseMs: 200 },
  userCreated: true,
};

const midiSegment = createInstrumentSegmentPatch(baseInstrument);
assert.equal(instrumentUsesDrumSegment(baseInstrument), false);
assert.equal(midiSegment.payload?.kind, "midi");
assert.equal(midiSegment.instrumentId, baseInstrument.id);

const drumInstrument = {
  ...baseInstrument,
  id: "test-kit",
  name: "Studio Kit",
  taxonomy: { categoryId: "percussion", instrumentId: "rock_kit" },
  sampleMap: [{
    path: "/samples/kick.wav",
    name: "Kick",
    rootNote: 36,
    loNote: 36,
    hiNote: 36,
    loVel: 1,
    hiVel: 127,
    volumeDb: 0,
    pan: 0,
    tuning: 0,
    seqPosition: 1,
  }],
};
const drumSegment = createInstrumentSegmentPatch(drumInstrument);
assert.equal(instrumentUsesDrumSegment(drumInstrument), true);
assert.equal(drumSegment.payload?.kind, "drum");
assert.equal(drumSegment.payload?.kind === "drum" ? drumSegment.payload.rows.length : 0, 1);
assert.equal(drumSegment.payload?.kind === "drum" ? drumSegment.payload.stepCount : 0, 16);
assert.equal(drumSegment.payload?.kind === "drum" ? drumSegment.payload.rows[0].instrumentId : "", drumInstrument.id);

const librarySource = fs.readFileSync(path.join(root, "frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx"), "utf8");
assert.match(librarySource, /label: "New Track"/);
assert.match(librarySource, /createInstrumentSegmentPatch\(instrument, \{ drum \}\)/);
assert.match(librarySource, /runProjectHistoryGroup/);

const editorSource = fs.readFileSync(path.join(root, "frontend/src/features/InstrumentEditor/InstrumentEditorModal.solid.tsx"), "utf8");
assert.match(editorSource, /label="Taxonomy Category"/);
assert.match(editorSource, /label="Subcategory"/);
assert.match(editorSource, /label="Tags"/);
assert.doesNotMatch(editorSource, /label="Structure"/);

const repositorySource = fs.readFileSync(path.join(root, "frontend/src/features/HomeHub/InstrumentsPage.solid.tsx"), "utf8");
assert.match(repositorySource, /aria-label="Taxonomy"/);
assert.match(repositorySource, /label="Subcategory"/);
assert.match(repositorySource, /label="Tags"/);

const metadataSource = fs.readFileSync(path.join(root, "frontend/src/state/libraryMetadata.ts"), "utf8");
assert.match(metadataSource, /value\?\.tags \?\? options\.tags/);

console.log("Instrument track creation and taxonomy verification passed.");
