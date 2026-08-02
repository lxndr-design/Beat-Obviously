#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "../frontend/node_modules/esbuild/lib/main.js";

const repoRoot = join(import.meta.dirname, "..");
const outputDirectory = join(repoRoot, "generated-tests");

const fixtures = [
  { name: "Generated_test_1", genre: "electronic", speed: "passive", randomness: "low", seed: 81001 },
  { name: "Generated_test_2", genre: "jazz", speed: "slow", randomness: "medium", seed: 81002 },
  { name: "Generated_test_3", genre: "pop", speed: "medium", randomness: "medium", seed: 81003 },
  { name: "Generated_test_4", genre: "reggae", speed: "fast", randomness: "high", seed: 81004 },
  { name: "Generated_test_5", genre: "dnb", speed: "hyper", randomness: "high", seed: 81005 },
];

const bundle = await build({
  stdin: {
    resolveDir: join(repoRoot, "frontend/src/ai"),
    sourcefile: "generate-test-song-documents.ts",
    loader: "ts",
    contents: `
      import { generateSongPlan, type GenerateSongOptions, type GeneratedSongPlan, type SongVoicePlan } from "./songGenerator.ts";
      import { migrateBeatDocument } from "../persistence/beatDocument.ts";

      export function buildTestSongDocument(name: string, options: GenerateSongOptions, savedAt: number) {
        const plan = generateSongPlan(options);
        const instruments = plan.voices.map((voice, index) => buildInstrument(plan, voice, index, savedAt));
        const instrumentIds = new Map(plan.voices.map((voice, index) => [voice.role, instruments[index].id]));
        const tracks = plan.voices.map((voice, voiceIndex) => {
          const trackId = id(name, "track", voiceIndex);
          const instrumentId = instrumentIds.get(voice.role)!;
          return {
            id: trackId,
            name: voice.instrument.preferredName,
            kind: "midi" as const,
            instrumentId,
            gainDb: 0,
            pan: 0,
            mute: false,
            solo: false,
            recordArmed: false,
            inputMonitoring: false,
            inputDeviceId: "",
            inputChannelStart: 0,
            inputChannelCount: 2,
            recordGainDb: 0,
            outputEnabled: true,
            effects: { filters: [] },
            rowHeight: "normal" as const,
            segments: voice.segments
              .filter((segment) => segment.notes.length > 0)
              .map((segment, segmentIndex) => ({
                id: id(name, "segment", voiceIndex, segmentIndex),
                trackId,
                name: segment.name,
                startBeat: segment.startBeat,
                lengthBeats: segment.lengthBeats,
                repeats: segment.repeats,
                layer: 0,
                muted: false,
                instrumentId,
                payload: { kind: "midi" as const, notes: segment.notes.map((note) => ({ ...note })), gainDb: segment.gainDb },
              })),
          };
        });
        const document = {
          schemaVersion: 1 as const,
          savedAt,
          project: {
            id: id(name, "project"),
            name,
            bpm: plan.bpm,
            timeSignature: { num: 4, denom: 4, boldBeats: [1] },
            lengthBeats: plan.lengthBeats,
            tracks,
            returnBuses: [],
            masterEqAutomation: [],
            masterChain: {
              inputGainDb: 0,
              compressorEnabled: false,
              compressorThresholdDb: -18,
              compressorRatio: 2,
              compressorAttackMs: 20,
              compressorReleaseMs: 160,
              compressorMakeupDb: 0,
              compressorMix: 100,
              outputGainDb: 0,
            },
            recordingInput: {
              inputDeviceId: "",
              inputDeviceName: "",
              inputChannelStart: 0,
              inputChannelCount: 2,
              calibrationSampleRate: 0,
              measuredRoundTripSamples: 0,
              reportedInputLatencySamples: 0,
              reportedOutputLatencySamples: 0,
              userLatencyAdjustmentSamples: 0,
            },
          },
          instruments,
          audioFiles: [],
          components: [],
          componentFolders: [],
          plugins: [],
          assets: [],
        };
        return { document: migrateBeatDocument(document), plan };
      }

      function buildInstrument(plan: GeneratedSongPlan, voice: SongVoicePlan, index: number, savedAt: number) {
        const flavor = instrumentFlavor(plan.genre + "|" + plan.speed + "|" + plan.randomness + "|" + voice.role + "|" + index);
        const wavetable = { bank: "aether", position: 0.25 + flavor * 0.35, warp: 0.08 + flavor * 0.3, warpMode: "shape" as const, unison: voice.role === "lead" ? 3 : 1, detuneCents: 6 + flavor * 10, blend: 0.35 + flavor * 0.3 };
        const oscillatorWaveform = voice.instrument.fallback.waveform === "noise" ? "sine" : voice.instrument.fallback.waveform;
        return {
          id: id(plan.name, "instrument", index),
          name: "Generated · " + voice.instrument.preferredName,
          createdAt: savedAt,
          updatedAt: savedAt,
          icon: "ph:cube",
          kind: "wavetable" as const,
          envelope: {
            attackMs: voice.instrument.fallback.attackMs * (0.88 + flavor * 0.24),
            decayMs: Math.max(80, voice.instrument.fallback.releaseMs * (0.48 + flavor * 0.18)),
            sustain: voice.role === "rhythm" ? 0.12 + flavor * 0.12 : 0.64 + flavor * 0.18,
            releaseMs: voice.instrument.fallback.releaseMs * (0.86 + flavor * 0.28),
          },
          knobs: {
            cutoff: clamp01(voice.instrument.fallback.cutoff + (flavor - 0.5) * 0.16),
            resonance: clamp01(voice.instrument.fallback.resonance + (flavor - 0.5) * 0.1),
            drive: clamp01(voice.instrument.fallback.drive + flavor * 0.08),
            color: clamp01((voice.texture === "reed" ? 0.64 : voice.texture === "plucked" ? 0.42 : 0.5) + (flavor - 0.5) * 0.2),
          },
          filterType: "lowpass" as const,
          waveform: "wavetable" as const,
          detuneCents: 0,
          octave: 0,
          subOscLevel: voice.role === "bass" ? 0.42 : 0,
          glideMs: voice.role === "bass" ? 24 : 0,
          maxVoices: voice.role === "bass" ? 1 : 16,
          mono: voice.role === "bass",
          legato: voice.role === "bass",
          pitchBendRangeSemitones: 2,
          ampLevel: 1,
          ampPan: 0,
          lfoWaveform: index % 2 === 0 ? "sine" as const : "triangle" as const,
          lfoRateHz: plan.speed === "hyper" ? 10 + flavor * 6 : plan.speed === "passive" ? 0.08 + flavor * 0.3 : 1 + flavor * 4,
          lfoDepth: voice.role === "harmony" ? 0.08 + flavor * 0.12 : flavor * 0.06,
          lfoSync: false,
          lfoSyncedRate: "1/4",
          lfoSmoothing: 0,
          lfoRandomPhase: 0,
          lfoPhase: 0,
          lfoRetrigger: true,
          lfoOneShot: false,
          lfo2Waveform: "triangle" as const,
          lfo2RateHz: 0.5,
          lfo2Sync: false,
          lfo2SyncedRate: "1/2",
          lfo2Smoothing: 0,
          lfo2RandomPhase: 0,
          lfo2Enabled: false,
          lfo2Phase: 0,
          lfo2Retrigger: true,
          lfo2OneShot: false,
          lfoPositionBipolar: true,
          lfoPitchBipolar: true,
          lfoFilterBipolar: true,
          lfoToPitch: 0,
          lfoToFilter: 0,
          envToFilter: 0,
          wavetable,
          aether: {
            oscA: { enabled: voice.role !== "rhythm", level: 0.78, pan: 0, waveform: oscillatorWaveform, octave: 0, semitone: 0, fineCents: 0, phase: 0, randomPhase: 0.25, wavetable },
            oscB: { enabled: voice.role === "harmony", level: 0.26, pan: 0.12, waveform: "wavetable" as const, octave: 0, semitone: 7, fineCents: -4, phase: 0, randomPhase: 0.25, wavetable: { ...wavetable, bank: "glass", position: 0.2 } },
            sub: { enabled: voice.role === "bass", level: voice.role === "bass" ? 0.45 : 0.12, octave: -1, waveform: "sine" as const },
            noise: { enabled: voice.role === "rhythm", level: voice.role === "rhythm" ? 0.82 : 0.05, color: 0.45 },
            sampleSlot1: { schemaVersion: 5 as const, enabled: false, audioFileId: "", rootNote: 60, level: 0.8, pan: 0, route: "filter" as const, startRatio: 0, endRatio: 1, loopEnabled: false, loopStartRatio: 0, loopEndRatio: 1, fxSends: [0, 0] as [number, number], zones: [] },
            runtimeWarp: 0,
            runtimeWarpMode: "shape" as const,
          },
          sampleIds: [],
          setId: "user-instruments",
          taxonomy: { categoryId: "synth_electronic", instrumentId: "wavetable_synth" },
          source: { kind: "created" as const, label: "Start from Something test generation", edited: false },
          descriptors: [voice.role, voice.texture, plan.genre, plan.speed, plan.randomness, "generated-song", "generated-instrument", "aether", "wavetable"],
          userCreated: true,
        };
      }

      function id(name: string, ...parts: Array<string | number>) {
        return [name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), ...parts].join("-");
      }
      function clamp01(value: number) { return Math.max(0, Math.min(1, value)); }
      function instrumentFlavor(value: string) {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
        return (hash >>> 0) / 0xffffffff;
      }
    `,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  external: ["juce-framework-frontend"],
});

const encoded = Buffer.from(bundle.outputFiles[0].text).toString("base64");
const { buildTestSongDocument } = await import(`data:text/javascript;base64,${encoded}`);
mkdirSync(outputDirectory, { recursive: true });

const savedAt = Date.now();
for (const fixture of fixtures) {
  const { name, ...options } = fixture;
  const { document, plan } = buildTestSongDocument(name, options, savedAt);
  const target = join(outputDirectory, `${name}.beat`);
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const parsed = JSON.parse(readFileSync(target, "utf8"));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.project.name, name);
  assert.equal(parsed.project.tracks.length, 5);
  assert.equal(parsed.instruments.length, 5);
  assert.ok(parsed.project.tracks.every((track) => track.instrumentId && parsed.instruments.some((instrument) => instrument.id === track.instrumentId)));
  assert.ok(parsed.project.tracks.some((track) => track.segments.length > 0));
  assert.equal(parsed.project.bpm, plan.bpm);

  const noteCount = parsed.project.tracks.flatMap((track) => track.segments).flatMap((segment) => segment.payload.notes ?? []).length;
  console.log(`${name}: ${plan.speed} ${plan.genre}, ${plan.randomness} randomness, ${plan.bpm} BPM, ${plan.form}, ${noteCount} MIDI notes`);
}

console.log(`Wrote ${fixtures.length} validated Beat projects to ${outputDirectory}`);
