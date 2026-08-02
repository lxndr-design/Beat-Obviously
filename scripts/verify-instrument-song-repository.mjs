#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const requireFromFrontend = createRequire(new URL("../frontend/package.json", import.meta.url));
const { buildSync } = requireFromFrontend("esbuild");

const root = new URL("..", import.meta.url).pathname;
const temp = mkdtempSync(join(tmpdir(), "beat-instrument-song-repository-"));
const output = join(temp, "instrumentSongAssociations.mjs");

try {
  buildSync({
    entryPoints: [join(root, "frontend/src/state/instrumentSongAssociations.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const api = await import(`${new URL(`file://${output}`).href}?v=${Date.now()}`);
  const project = {
    id: "song-1",
    name: "Glass Harbor",
    bpm: 120,
    timeSignature: { num: 4, denom: 4, boldBeats: [1] },
    lengthBeats: 16,
    returnBuses: [],
    masterEqAutomation: [],
    masterChain: {},
    recordingInput: {},
    tracks: [
      {
        id: "track-1",
        name: "Main Keys",
        instrumentId: "keys",
        segments: [
          { instrumentId: "lead", payload: { kind: "midi", notes: [] } },
          { payload: { kind: "drum", rows: [{ instrumentId: "kick" }, { instrumentId: "snare" }] } },
          { payload: { kind: "drumpad", lanes: [{ instrumentId: "hat" }], hits: [] } },
        ],
      },
    ],
  };

  const associations = api.projectInstrumentAssociations(project);
  assert.deepEqual(new Set(associations.map((entry) => entry.instrumentId)), new Set(["keys", "lead", "kick", "snare", "hat"]));
  assert.ok(associations.every((entry) => entry.title === "Glass Harbor"));
  assert.ok(associations.every((entry) => entry.trackNames.includes("Main Keys")));
  assert.deepEqual(api.projectInstrumentIds(project), new Set(["keys", "lead", "kick", "snare", "hat"]));

  const instrument = {
    id: "keys",
    name: "Soft Glass",
    kind: "wavetable",
    waveform: "wavetable",
    source: { kind: "created", label: "Made in Beat" },
    descriptors: ["soft", "keys"],
  };
  const linked = api.associateInstrumentWithSong(instrument, {
    projectId: "song-1",
    title: "Glass Harbor",
    linkedAt: 10,
    trackNames: ["Main Keys"],
  });
  const renamed = api.associateInstrumentWithSong(linked, {
    projectId: "song-1",
    title: "Glass Harbor Finale",
    linkedAt: 20,
    trackNames: ["Layered Keys"],
  });
  assert.equal(renamed.songAssociations.length, 1, "one project must remain one relationship after rename");
  assert.equal(renamed.songAssociations[0].title, "Glass Harbor Finale");
  assert.deepEqual(renamed.songAssociations[0].trackNames, ["Main Keys", "Layered Keys"]);
  assert.match(api.instrumentRepositorySearchText(renamed), /glass harbor finale/);
  assert.deepEqual(api.instrumentSongTitles(renamed), ["Glass Harbor Finale"]);

  const source = (path) => readFileSync(join(root, path), "utf8");
  assert.match(source("frontend/src/persistence/beatDocument.ts"), /filter\(\(instrument\) => associations\.has\(instrument\.id\)\)/, "project documents should embed only song instruments");
  assert.match(source("frontend/src/persistence/beatDocument.ts"), /mergeProjectInstruments\(instruments, migrated\.project/, "opening a song should merge instruments into the repository");
  assert.match(source("frontend/src/App.solid.tsx"), /associateProjectInstruments\(project\)/, "startup should backfill song metadata");
  assert.match(source("frontend/src/ai/generateSongAction.ts"), /associateProjectInstruments\(useProjectStore\.getState\(\)\.project\)/, "generated songs should register instrument relationships");
  assert.match(source("frontend/src/features/HomeHub/InstrumentsPage.solid.tsx"), /Search name, song, engine, set/, "full instrument browser should advertise song search");
  assert.match(source("frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx"), /instrumentRepositorySearchText/, "sidebar instrument search should include repository metadata");

  console.log("Instrument/song repository verifier passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
