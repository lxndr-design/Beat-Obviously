#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-document-roundtrip-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/persistence/beatDocument.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      "--external:juce-framework-frontend",
      `--outfile=${join(outDir, "beatDocument.js")}`,
    ],
    { stdio: "inherit" },
  );

  const { beatDocumentFingerprint, migrateBeatDocument, replaceBeatDocumentAssetPath } = await import(
    pathToFileURL(join(outDir, "beatDocument.js"))
  );

  const document = makeRepresentativeDocument();
  const migrated = migrateBeatDocument(document);

  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.project.bpm, 300, "document migration should clamp invalid-high BPM");
  assert.deepEqual(
    migrated.project.timeSignature,
    { num: 7, denom: 4, boldBeats: [1, 4] },
    "document migration should sanitize time signatures",
  );
  assert.equal(migrated.project.tracks.length, 1, "document migration should keep valid tracks");
  assert.equal(migrated.project.tracks[0].gainDb, 24, "track gain should clamp to the supported range");
  assert.equal(migrated.project.tracks[0].pan, -1, "track pan should clamp to the supported range");
  assert.equal(migrated.project.tracks[0].effects.filters[0].kind, "plugin");
  assert.equal(migrated.project.tracks[0].effects.filters[0].pluginId, "plug-decent-kit");
  assert.deepEqual(
    migrated.project.tracks[0].effects.filters[1].automation?.[0].points.map((point) => [point.beat, point.value, point.curve]),
    [
      [1, 20, "linear"],
      [12, 55, "cubic"],
    ],
    "effect automation lanes should survive document migration",
  );
  assert.equal(migrated.instruments?.[0].source?.pluginId, "plug-decent-kit");
  assert.equal(migrated.instruments?.[0].sampleMap?.[0].loopEnabled, true);
  assert.equal(migrated.instruments?.[0].sampleMap?.[0].durationSeconds, 0.42);
  assert.equal(migrated.instruments?.[0].sampleMap?.[0].loLengthSeconds, 0);
  assert.equal(migrated.instruments?.[0].sampleMap?.[0].hiLengthSeconds, 0.5);
  assert.equal(migrated.instrumentSets?.[0].name, "User Imports");
  assert.equal(migrated.audioFiles?.[0].sampleRate, 48000);
  assert.equal(migrated.components?.[0].kind, "drum");
  assert.equal(migrated.plugins?.[0].version, "1.2.3");
  assert.equal(migrated.plugins?.[0].sourceFileName, "PercussionPalette.zip");
  assert.equal(migrated.assets?.length, 3, "migration should synthesize a project asset manifest");
  assert.deepEqual(
    migrated.assets.map((asset) => [asset.kind, asset.path, asset.policy]),
    [
      ["audio", "/Samples/Kick.wav", "external"],
      ["plugin", "PercussionPalette.zip", "plugin"],
      ["sample", "/Samples/Kick.wav", "external"],
    ],
    "asset manifest should track audio files, sample zones, and plugin packages",
  );
  assert.deepEqual(
    migrated.assets.find((asset) => asset.kind === "sample")?.references,
    ["instrument:inst-plugin:sampleUrls:0", "instrument:inst-plugin:sampleMap:0"],
    "sample asset references should merge duplicate sample URL and zone references",
  );

  const savedAtOnlyChanged = structuredClone(migrated);
  savedAtOnlyChanged.savedAt += 100_000;
  assert.equal(
    beatDocumentFingerprint(migrated),
    beatDocumentFingerprint(savedAtOnlyChanged),
    "document dirty fingerprint should ignore savedAt",
  );

  const changedPlugin = structuredClone(migrated);
  changedPlugin.plugins[0].status = "missing";
  assert.notEqual(
    beatDocumentFingerprint(migrated),
    beatDocumentFingerprint(changedPlugin),
    "document dirty fingerprint should include plugin adapter state",
  );

  const relinked = replaceBeatDocumentAssetPath(migrated, "/Samples/Kick.wav", "/Relinked/Kick.wav");
  assert.equal(relinked.audioFiles[0].path, "/Relinked/Kick.wav", "relink should update audio library paths");
  assert.deepEqual(relinked.instruments[0].sampleUrls, ["/Relinked/Kick.wav"], "relink should update instrument sample URL lists");
  assert.equal(relinked.instruments[0].sampleMap[0].path, "/Relinked/Kick.wav", "relink should update sample-map zone paths");
  assert.equal(relinked.instruments[0].sampleMap[0].durationSeconds, 0.42, "relink should preserve sample-zone length metadata");
  assert.equal(relinked.instruments[0].sampleMap[0].loLengthSeconds, 0, "relink should preserve lower note-length band");
  assert.equal(relinked.instruments[0].sampleMap[0].hiLengthSeconds, 0.5, "relink should preserve upper note-length band");
  assert.equal(relinked.instruments[0].sampleMap[0].seqPosition, 1, "relink should preserve hit-variant ordering");
  assert.equal(relinked.instruments[0].source.pluginId, "plug-decent-kit", "relink should preserve plugin provenance");
  assert.deepEqual(
    relinked.assets.map((asset) => [asset.kind, asset.path, asset.policy]),
    [
      ["audio", "/Relinked/Kick.wav", "external"],
      ["plugin", "PercussionPalette.zip", "plugin"],
      ["sample", "/Relinked/Kick.wav", "external"],
    ],
    "relink should rebuild the asset manifest around the new path",
  );
  assert.deepEqual(
    relinked.assets.find((asset) => asset.kind === "sample")?.references,
    ["instrument:inst-plugin:sampleUrls:0", "instrument:inst-plugin:sampleMap:0"],
    "relink should preserve merged sample asset references",
  );

  assert.throws(
    () => migrateBeatDocument({ ...document, schemaVersion: 999 }),
    /Unsupported Beat project schema/,
    "unsupported schemas should fail before hydration",
  );
  assert.throws(
    () => migrateBeatDocument({ ...document, project: { ...document.project, tracks: [] } }),
    /does not contain any tracks/,
    "trackless documents should fail before hydration",
  );

  console.log("Beat document roundtrip verifier passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

function makeRepresentativeDocument() {
  return {
    schemaVersion: 1,
    savedAt: 1780600000000,
    project: {
      id: "project-doc",
      name: "Document Coverage",
      bpm: 999,
      timeSignature: { num: 7, denom: 3, boldBeats: [1, 4, 99, 4] },
      lengthBeats: 128,
      masterEqAutomation: [
        { atBeat: 0, bandsDb: [0, 1, -1, 2, -2, 3, -3] },
        { atBeat: 64, bandsDb: [1, 1, 0, 0, -1, -1, 2] },
      ],
      tracks: [
        {
          id: "track-a",
          name: "Plugin Track",
          kind: "midi",
          instrumentId: "inst-plugin",
          gainDb: 99,
          pan: -4,
          mute: false,
          solo: false,
          rowHeight: "normal",
          effects: {
            filters: [
              {
                id: "effect-plugin",
                kind: "plugin",
                bypassed: false,
                pluginId: "plug-decent-kit",
                pluginName: "Percussion Palette",
                pluginFormat: "decent-sampler",
                params: { mix: 100 },
                automation: [],
              },
              {
                id: "effect-reverb",
                kind: "reverb",
                bypassed: false,
                params: { roomSize: 40, damping: 35, mix: 20 },
                automation: [
                  {
                    param: "mix",
                    points: [
                      { id: "tp-a", beat: 1, value: 20, curve: "linear" },
                      { id: "tp-b", beat: 12, value: 55, curve: "cubic" },
                    ],
                  },
                ],
              },
            ],
          },
          segments: [
            {
              id: "seg-midi",
              trackId: "track-a",
              name: "Aether Line",
              instrumentId: "inst-plugin",
              startBeat: 4,
              lengthBeats: 8,
              fadeInBeats: 0.25,
              fadeOutBeats: 0.5,
              repeats: 0,
              layer: 0,
              payload: {
                kind: "midi",
                gainDb: -3,
                notes: [
                  {
                    pitch: 60,
                    velocity: 100,
                    startBeat: 0,
                    lengthBeats: 2,
                    curve: [
                      { beat: 0, pitch: 60 },
                      { beat: 2, pitch: 67 },
                    ],
                    automation: [
                      {
                        target: "filter.cutoff",
                        points: [
                          { beat: 0, value: 1200 },
                          { beat: 2, value: 4200 },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    instruments: [
      {
        id: "inst-plugin",
        name: "Percussion Palette Kit",
        icon: "ph:drum",
        kind: "sampler",
        envelope: { attackMs: 1, decayMs: 80, sustain: 0.8, releaseMs: 120 },
        knobs: { cutoff: 0.5, resonance: 0.2, drive: 0.1, color: 0.4 },
        waveform: "sample",
        sampleIds: ["audio-kick"],
        sampleUrls: ["/Samples/Kick.wav"],
        sampleMap: [
          {
            path: "/Samples/Kick.wav",
            name: "Kick",
            rootNote: 36,
            loNote: 0,
            hiNote: 60,
            loVel: 1,
            hiVel: 127,
            volumeDb: -2,
            pan: 0,
            tuning: 0,
            seqPosition: 1,
            loopEnabled: true,
            loopStart: 128,
            loopEnd: 2048,
            oneShot: false,
            durationSeconds: 0.42,
            loLengthSeconds: 0,
            hiLengthSeconds: 0.5,
          },
        ],
        setId: "set-user-imports",
        source: {
          kind: "plugin",
          label: "Percussion Palette",
          pluginId: "plug-decent-kit",
          fallbackEngine: "aether",
          importedAt: 1780600000000,
        },
        userCreated: true,
      },
    ],
    instrumentSets: [{ id: "set-user-imports", name: "User Imports", collapsed: false }],
    audioFiles: [
      {
        id: "audio-kick",
        name: "Kick.wav",
        path: "/Samples/Kick.wav",
        durationSeconds: 0.82,
        sampleRate: 48000,
      },
    ],
    components: [
      {
        id: "component-break",
        kind: "drum",
        name: "Break Edit",
        rows: [{ id: "row-kick", name: "Kick", steps: [{ on: true, velocity: 118 }] }],
        stepCount: 16,
        speed: 2,
        lengthBeats: 8,
        swingPercent: 53,
        createdAt: 1780600000000,
      },
    ],
    plugins: [
      {
        id: "plug-decent-kit",
        name: "Percussion Palette",
        vendor: "Pianobook",
        version: "1.2.3",
        kind: "synth",
        format: "decent-sampler",
        status: "installed",
        instrumentMode: "fallback-aether",
        description: "Imported DecentSampler package.",
        sourceFileName: "PercussionPalette.zip",
        installedAt: 1780600000000,
      },
    ],
  };
}
