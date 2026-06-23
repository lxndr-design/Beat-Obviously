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
  assert.equal(migrated.project.tracks[0].recordArmed, true, "track record-arm state should survive document migration");
  assert.equal(migrated.project.tracks[0].inputMonitoring, true, "track input monitoring should survive document migration");
  assert.equal(migrated.project.tracks[0].inputDeviceId, "builtin-input", "track input device id should survive document migration");
  assert.equal(migrated.project.tracks[0].inputChannelStart, 1024, "track input channel start should clamp to the supported range");
  assert.equal(migrated.project.tracks[0].inputChannelCount, 1, "track input channel count should clamp to at least one channel");
  assert.equal(migrated.project.tracks[0].recordGainDb, 24, "track record gain should clamp to the supported range");
  assert.deepEqual(
    migrated.project.recordingInput,
    {
      inputDeviceId: "builtin-input",
      inputDeviceName: "Built-in Microphone",
      inputChannelStart: 1024,
      inputChannelCount: 1,
      calibrationSampleRate: 768000,
      measuredRoundTripSamples: 1920000,
      reportedInputLatencySamples: 0,
      reportedOutputLatencySamples: 512,
      userLatencyAdjustmentSamples: -1920000,
    },
    "project recording input profile should roundtrip with backend-compatible clamps",
  );
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
  const migratedMidiPayload = migrated.project.tracks[0].segments[0].payload;
  assert.equal(migratedMidiPayload.kind, "midi");
  assert.deepEqual(
    migratedMidiPayload.notes[0].automation?.[0].points.map((point) => [point.beat, point.value, point.curve]),
    [
      [0, 1200, "smoothstep"],
      [2, 4200, "easeOut"],
    ],
    "MIDI note automation curve metadata should survive document migration",
  );
  assert.equal(migrated.instruments?.[0].source?.pluginId, "plug-decent-kit");
  assert.equal(migrated.instruments?.[0].sampleMap?.[0].loopEnabled, true);
  assert.equal(migrated.instruments?.[0].sampleMap?.[0].durationSeconds, 0.42);
  assert.equal(migrated.instruments?.[0].sampleMap?.[0].loLengthSeconds, 0);
  assert.equal(migrated.instruments?.[0].sampleMap?.[0].hiLengthSeconds, 0.5);
  const migratedAetherInstrument = migrated.instruments?.find((instrument) => instrument.id === "inst-aether-preset");
  assert.equal(migratedAetherInstrument?.kind, "wavetable", "Aether preset instruments should survive document migration");
  assert.equal(migratedAetherInstrument?.effects?.filters?.[0]?.kind, "saturator", "instrument-owned Aether FX should roundtrip");
  assert.equal(migratedAetherInstrument?.effects?.filters?.[0]?.params.drive, 37, "instrument-owned Aether FX params should roundtrip");
  assert.equal(migratedAetherInstrument?.synthPatch?.metadata.macros?.["macro.1"]?.label, "Glow", "macro definitions should roundtrip");
  assert.equal(migratedAetherInstrument?.synthPatch?.modulation?.[0]?.source, "macro.1", "macro routes should roundtrip");
  assert.equal(
    migratedAetherInstrument?.synthPatch?.metadata.wavemaps?.["user.scan"]?.frames?.[0]?.analysis?.spectralCentroid,
    0.42,
    "wavemap analysis metadata should roundtrip",
  );
  assert.equal(
    migratedAetherInstrument?.synthPatch?.metadata.customWavetables?.["user.legacy-only"]?.frames?.[0]?.formant,
    0.69,
    "legacy-only custom wavemap metadata should survive document migration",
  );
  assert.equal(
    migratedAetherInstrument?.aether?.oscB.wavetable.customId,
    "user.legacy-only",
    "legacy-only Aether oscillator custom wavemap references should roundtrip",
  );
  assert.equal(
    migratedAetherInstrument?.aether?.oscA.wavetable.customId,
    "user.scan",
    "Aether oscillator custom wavemap references should roundtrip",
  );
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

  const changedRecordingInput = structuredClone(migrated);
  changedRecordingInput.project.recordingInput.userLatencyAdjustmentSamples += 32;
  assert.notEqual(
    beatDocumentFingerprint(migrated),
    beatDocumentFingerprint(changedRecordingInput),
    "document dirty fingerprint should include recording latency calibration",
  );

  const changedAetherMacro = structuredClone(migrated);
  changedAetherMacro.instruments.find((instrument) => instrument.id === "inst-aether-preset").synthPatch.metadata.macros["macro.1"].label = "Heat";
  assert.notEqual(
    beatDocumentFingerprint(migrated),
    beatDocumentFingerprint(changedAetherMacro),
    "document dirty fingerprint should include Aether preset macro edits",
  );

  const changedAetherFx = structuredClone(migrated);
  changedAetherFx.instruments.find((instrument) => instrument.id === "inst-aether-preset").effects.filters[0].params.drive += 5;
  assert.notEqual(
    beatDocumentFingerprint(migrated),
    beatDocumentFingerprint(changedAetherFx),
    "document dirty fingerprint should include instrument-owned Aether FX edits",
  );

  const changedAetherWavemap = structuredClone(migrated);
  changedAetherWavemap.instruments.find((instrument) => instrument.id === "inst-aether-preset").synthPatch.metadata.wavemaps["user.scan"].frames[0].analysis.spectralCentroid += 0.1;
  assert.notEqual(
    beatDocumentFingerprint(migrated),
    beatDocumentFingerprint(changedAetherWavemap),
    "document dirty fingerprint should include custom wavemap analysis edits",
  );

  const changedLegacyAetherWavemap = structuredClone(migrated);
  changedLegacyAetherWavemap.instruments.find((instrument) => instrument.id === "inst-aether-preset").synthPatch.metadata.customWavetables["user.legacy-only"].frames[0].formant += 0.05;
  assert.notEqual(
    beatDocumentFingerprint(migrated),
    beatDocumentFingerprint(changedLegacyAetherWavemap),
    "document dirty fingerprint should include legacy-only custom wavemap edits",
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
      recordingInput: {
        inputDeviceId: "builtin-input",
        inputDeviceName: "Built-in Microphone",
        inputChannelStart: 9999,
        inputChannelCount: -2,
        calibrationSampleRate: 999999,
        measuredRoundTripSamples: 9999999,
        reportedInputLatencySamples: -4,
        reportedOutputLatencySamples: 512,
        userLatencyAdjustmentSamples: -9999999,
      },
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
          recordArmed: true,
          inputMonitoring: true,
          inputDeviceId: "builtin-input",
          inputChannelStart: 9999,
          inputChannelCount: -2,
          recordGainDb: 99,
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
                          { beat: 0, value: 1200, curve: "smoothstep" },
                          { beat: 2, value: 4200, curve: "easeOut" },
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
      makeAetherPresetInstrument(),
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

function makeAetherPresetInstrument() {
  const wavetable = {
    bank: "custom",
    customId: "user.scan",
    position: 0.64,
    warp: 0.38,
    warpMode: "fold",
    unison: 5,
    detuneCents: 18,
    blend: 0.72,
  };
  const wavemap = {
    schemaVersion: 1,
    id: "user.scan",
    name: "Verifier Scan",
    kind: "resynthesized",
    interpolation: "smooth",
    morph: 0.3,
    source: {
      kind: "resynthesized",
      label: "Verifier Sweep",
      audioFileId: "audio-wavemap",
      path: "/Wavemaps/Sweep.wav",
      sampleRate: 48000,
      channelCount: 1,
      bitDepth: 24,
      sourceSampleCount: 96000,
      analyzedSampleCount: 48000,
      frameCount: 2,
      sourceStartSample: 128,
      sourceEndSample: 48128,
      createdAt: 1780600000100,
    },
    frames: [
      {
        id: "frame-a",
        label: "Bright",
        position: 0,
        brightness: 0.7,
        even: 0.2,
        fold: 0.45,
        formant: 0.33,
        notch: 0.1,
        skew: -0.2,
        tilt: 0.25,
        focus: 0.55,
        phase: 0.15,
        partials: [0.9, 0.4, 0.2, 0.1],
        analysis: {
          sourceStartSample: 128,
          sourceEndSample: 24128,
          rms: 0.18,
          peak: 0.8,
          zeroCrossRate: 0.11,
          roughness: 0.27,
          asymmetry: -0.04,
          spectralCentroid: 0.42,
          dominantHarmonic: 3,
          dominantPhase: 0.61,
        },
      },
      {
        id: "frame-b",
        label: "Hollow",
        position: 1,
        brightness: 0.38,
        even: 0.55,
        fold: 0.2,
        formant: 0.7,
        notch: 0.28,
        skew: 0.35,
        tilt: -0.18,
        focus: 0.74,
        phase: 0.5,
        partials: [0.6, 0.15, 0.5, 0.2],
        analysis: {
          sourceStartSample: 24128,
          sourceEndSample: 48128,
          rms: 0.14,
          peak: 0.62,
          zeroCrossRate: 0.16,
          roughness: 0.31,
          asymmetry: 0.08,
          spectralCentroid: 0.57,
          dominantHarmonic: 5,
          dominantPhase: 0.2,
        },
      },
    ],
  };
  const legacyOnlyWavemap = {
    name: "Legacy Only",
    kind: "resynthesized",
    interpolation: "smooth",
    morph: 0.77,
    source: {
      kind: "imported-audio",
      label: "Legacy Sweep",
      path: "/Wavemaps/LegacySweep.wav",
      sampleRate: 48000,
      channelCount: 1,
      sourceSampleCount: 48000,
      analyzedSampleCount: 24000,
      frameCount: 1,
    },
    frames: [
      {
        id: "legacy-frame-a",
        label: "Legacy",
        position: 0,
        brightness: 0.82,
        even: 0.21,
        fold: 0.17,
        formant: 0.69,
        notch: 0.27,
        skew: -0.42,
        tilt: -0.19,
        focus: 0.58,
        phase: -0.31,
        partials: [0.9, 0.7, 0.5],
      },
    ],
  };
  const effects = {
    filters: [
      {
        id: "aether-sat",
        kind: "saturator",
        bypassed: false,
        params: { drive: 37, mix: 71 },
      },
      {
        id: "aether-delay",
        kind: "delay",
        bypassed: true,
        params: { timeMs: 390, feedback: 31, mix: 18 },
      },
    ],
  };
  const synthPatch = {
    schemaVersion: 1,
    instrumentType: "wavetable-synth",
    namespace: "synth",
    name: "Verifier Aether Preset",
    parameters: {
      "osc.a.enabled": true,
      "osc.a.wavetable": "user.scan",
      "osc.a.position": 0.64,
      "osc.a.warp": 0.38,
      "osc.a.warpMode": "fold",
      "osc.a.phase": 0.22,
      "osc.b.enabled": true,
      "osc.b.wavetable": "user.legacy-only",
      "osc.b.level": 0.28,
      "filter.enabled": true,
      "filter.cutoff": 5200,
      "filter.resonance": 0.34,
      "amp.level": 0.82,
    },
    modulation: [
      {
        id: "macro-glow-cutoff",
        source: "macro.1",
        target: "filter.cutoff",
        amount: 0.42,
        bipolar: false,
        enabled: true,
      },
      {
        id: "lfo-scan",
        source: "lfo.1",
        target: "osc.a.position",
        amount: 0.18,
        bipolar: true,
        enabled: true,
      },
    ],
    effects,
    metadata: {
      createdBy: "Beat",
      tags: ["verifier", "aether"],
      icon: "ph:cube",
      macros: {
        "macro.1": { id: "macro.1", label: "Glow", min: 0, max: 1, curve: "s-curve" },
        "macro.2": { id: "macro.2", label: "Motion", min: 0, max: 1, curve: "linear" },
        "macro.3": { id: "macro.3", label: "Edge", min: 0, max: 1, curve: "ease-in" },
        "macro.4": { id: "macro.4", label: "Air", min: 0, max: 1, curve: "ease-out" },
      },
      wavemaps: { "user.scan": wavemap },
      customWavetables: { "user.scan": wavemap, "user.legacy-only": legacyOnlyWavemap },
    },
  };
  return {
    id: "inst-aether-preset",
    name: "Verifier Aether Preset",
    icon: "ph:cube",
    kind: "wavetable",
    envelope: { attackMs: 8, decayMs: 140, sustain: 0.72, releaseMs: 260 },
    knobs: { cutoff: 0.6, resonance: 0.34, drive: 0.25, color: 0.64 },
    filterType: "lowpass",
    filterKeytrack: 0.4,
    waveform: "wavetable",
    detuneCents: 4,
    octave: 0,
    subOscLevel: 0.15,
    glideMs: 22,
    maxVoices: 10,
    mono: false,
    legato: false,
    ampLevel: 0.82,
    ampPan: -0.1,
    wavetable,
    aether: {
      oscA: {
        enabled: true,
        level: 0.84,
        pan: -0.12,
        waveform: "wavetable",
        octave: 0,
        semitone: 0,
        fineCents: 4,
        phase: 0.22,
        randomPhase: 0.1,
        wavetable,
      },
      oscB: {
        enabled: true,
        level: 0.28,
        pan: 0.24,
        waveform: "triangle",
        octave: 1,
        semitone: -7,
        fineCents: -3,
        phase: 0.4,
        randomPhase: 0.2,
        wavetable: { ...wavetable, bank: "custom", customId: "user.legacy-only", position: 0.25, warp: 0.12, warpMode: "shape" },
      },
      sub: { enabled: true, level: 0.18, octave: -1, waveform: "sine" },
      noise: { enabled: true, level: 0.08, color: 0.6 },
    },
    lfoWaveform: "triangle",
    lfoRateHz: 2,
    lfoDepth: 0.18,
    lfoSync: true,
    lfoSyncedRate: "1/8",
    lfoSmoothing: 0.15,
    lfoRandomPhase: 0.2,
    lfoPhase: 0.1,
    lfoRetrigger: true,
    lfoOneShot: false,
    envToFilter: 0.3,
    effects,
    synthPatch,
    sampleIds: [],
    setId: "set-user-imports",
    source: {
      kind: "generated",
      label: "Aether preset fixture",
      importedAt: 1780600000200,
    },
    userCreated: true,
  };
}
