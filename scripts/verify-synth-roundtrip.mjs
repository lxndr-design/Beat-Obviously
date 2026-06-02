#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-synth-roundtrip-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

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
    { stdio: "inherit" },
  );

  const synthStore = await import(pathToFileURL(join(outDir, "state/synthStore.js")));
  const synthPreview = await import(pathToFileURL(join(outDir, "audio/synthPreview.js")));

  const draft = synthStore.normalizeSynthDraftPatch({
    name: "Roundtrip Probe",
    parameters: {
      "osc.a.enabled": true,
      "osc.a.wavetable": "basic.pulse",
      "osc.a.position": 0.42,
      "osc.a.octave": -1,
      "osc.a.semitone": 7,
      "osc.a.fine": -14,
      "osc.a.level": 0.74,
      "osc.a.pan": -0.35,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.triangle",
      "osc.b.position": 0.81,
      "osc.b.octave": 1,
      "osc.b.semitone": -5,
      "osc.b.fine": 23,
      "osc.b.level": 0.33,
      "osc.b.pan": 0.45,
      "unison.enabled": true,
      "unison.voices": 5,
      "unison.detune": 0.27,
      "unison.blend": 0.61,
      "filter.enabled": true,
      "filter.type": "highpass",
      "filter.cutoff": 1370,
      "filter.resonance": 0.43,
      "filter.drive": 0.19,
      "amp.level": 0.66,
      "amp.pan": -0.24,
      "env.1.attack": 0.012,
      "env.1.decay": 0.34,
      "env.1.sustain": 0.57,
      "env.1.release": 0.78,
      "lfo.1.enabled": true,
      "lfo.1.rate": 4.5,
      "lfo.1.sync": false,
      "lfo.1.shape": "triangle",
      "macro.1": 0.5,
      "future.experimental": "preserve-me",
    },
    modulation: [
      { id: "route", source: "lfo.1", target: "osc.a.position", amount: -0.21, bipolar: false, enabled: true },
      { id: "route", source: "lfo.1", target: "osc.a.fine", amount: 0.4, bipolar: true, enabled: true },
      { id: "filter_env", source: "env.1", target: "filter.cutoff", amount: 0.31, bipolar: false, enabled: true },
      { id: "macro_cutoff", source: "macro.1", target: "filter.cutoff", amount: 0.12, bipolar: false, enabled: true },
      { id: "disabled_macro", source: "macro.1", target: "amp.level", amount: -1, bipolar: false, enabled: false },
    ],
    metadata: { tags: ["roundtrip", "probe"], icon: "ph:planet" },
  });

  assert.equal(draft.parameters["future.experimental"], "preserve-me");
  assert.equal(new Set(draft.modulation.map((route) => route.id)).size, draft.modulation.length);
  assert.equal(draft.metadata.customWavetables["user.custom"].frames.length, 4);
  assert.deepEqual(synthStore.modulationSummaryForTarget(draft, "osc.a.position"), {
    count: 1,
    amount: -0.21,
    label: "LFO 1 -21",
  });
  assert.deepEqual(synthStore.modulationSummaryForTarget(draft, "filter.cutoff"), {
    count: 2,
    amount: 0.43,
    label: "2 routes +43",
  });
  assert.deepEqual(synthStore.modulationSummaryForSource(draft, "macro.1"), {
    count: 1,
    amount: 0.12,
    label: "Filter Cutoff +12",
  });
  assert.ok(synthStore.FACTORY_SYNTH_PRESETS.length >= 5);
  assert.equal(
    new Set(synthStore.FACTORY_SYNTH_PRESETS.map((preset) => preset.id)).size,
    synthStore.FACTORY_SYNTH_PRESETS.length,
  );
  for (const preset of synthStore.FACTORY_SYNTH_PRESETS) {
    assert.equal(preset.patch.name, preset.name);
    assert.deepEqual(synthStore.normalizeSynthDraftPatch(JSON.parse(JSON.stringify(preset.patch))), preset.patch);
    const presetPreview = synthStore.synthDraftToPreviewInstrument(preset.patch);
    const presetSamples = new Float32Array(12000);
    synthPreview.renderInstrumentSamples(presetPreview, presetSamples, 48000, synthPreview.previewFrequency(presetPreview), "audio", true);
    let presetEnergy = 0;
    let presetPeak = 0;
    for (const sample of presetSamples) {
      assert.equal(Number.isFinite(sample), true);
      presetEnergy += sample * sample;
      presetPeak = Math.max(presetPeak, Math.abs(sample));
    }
    assert.ok(Math.sqrt(presetEnergy / presetSamples.length) > 0.005, `expected audible factory preset ${preset.id}`);
    assert.ok(presetPeak > 0.02, `expected factory preset peak for ${preset.id}`);
  }

  const patch = synthStore.synthDraftToInstrumentPatch(draft);
  assert.equal(patch.name, "Roundtrip Probe");
  assert.equal(patch.icon, "ph:planet");
  assert.equal(patch.kind, "wavetable");
  assert.equal(patch.filterType, "highpass");
  assert.equal(patch.aether.oscB.enabled, true);
  assert.equal(patch.aether.oscA.pan, -0.35);
  assert.equal(patch.aether.oscB.pan, 0.45);
  assert.equal(patch.aether.oscB.wavetable.bank, "organ");
  assert.equal(patch.wavetable.unison, 5);
  assert.equal(patch.aether.oscA.wavetable.unison, 5);
  assert.equal(patch.aether.oscB.wavetable.unison, 5);
  assert.equal(patch.lfoPositionBipolar, false);
  assert.equal(patch.lfoPitchBipolar, true);
  assert.equal(patch.synthPatch.parameters["future.experimental"], "preserve-me");
  assert.equal(patch.synthPatch.metadata.icon, "ph:planet");

  const stereoProbe = {
    id: "stereo-probe",
    name: "Stereo Probe",
    kind: "wavetable",
    envelope: { attackMs: 1, decayMs: 1, sustain: 1, releaseMs: 1 },
    knobs: { cutoff: 1, resonance: 0, drive: 0, color: 0.5 },
    waveform: "wavetable",
    sampleIds: [],
    ...patch,
    ampPan: 0,
    aether: {
      ...patch.aether,
      oscA: { ...patch.aether.oscA, enabled: true, level: 1, pan: -1 },
      oscB: { ...patch.aether.oscB, enabled: true, level: 1, pan: 1 },
    },
  };
  const left = new Float32Array(4096);
  const right = new Float32Array(4096);
  synthPreview.renderInstrumentStereoSamples(
    stereoProbe,
    left,
    right,
    48000,
    synthPreview.previewFrequency(stereoProbe),
    "audio",
    true,
  );
  let stereoDelta = 0;
  let stereoEnergy = 0;
  for (let i = 0; i < left.length; i++) {
    assert.equal(Number.isFinite(left[i]), true);
    assert.equal(Number.isFinite(right[i]), true);
    stereoDelta += Math.abs(left[i] - right[i]);
    stereoEnergy += left[i] * left[i] + right[i] * right[i];
  }
  assert.ok(stereoEnergy > 0.001, "expected stereo probe to render audible output");
  assert.ok(stereoDelta / left.length > 0.0001, "expected oscillator pan to affect stereo render");

  const serialized = JSON.parse(JSON.stringify(patch.synthPatch));
  const loadedDraft = synthStore.normalizeSynthDraftPatch(serialized);
  assert.deepEqual(loadedDraft, draft);

  const restoredFromPatchedInstrument = synthStore.synthDraftFromInstrument({
    id: "roundtrip",
    name: "Roundtrip Probe",
    kind: "wavetable",
    envelope: { attackMs: 1, decayMs: 1, sustain: 1, releaseMs: 1 },
    knobs: { cutoff: 0.5, resonance: 0.5, drive: 0.5, color: 0.5 },
    waveform: "wavetable",
    sampleIds: [],
    ...patch,
  });
  assert.deepEqual(restoredFromPatchedInstrument, draft);

  const legacyNoMod = synthStore.synthDraftFromInstrument({
    id: "legacy",
    name: "Legacy Plain Saw",
    kind: "synth",
    envelope: { attackMs: 5, decayMs: 120, sustain: 0.4, releaseMs: 180 },
    knobs: { cutoff: 0.5, resonance: 0.2, drive: 0.1, color: 0.4 },
    waveform: "saw",
    sampleIds: [],
  });
  assert.equal(legacyNoMod.modulation.length, 0);

  const legacyAether = synthStore.synthDraftFromInstrument({
    id: "legacy-aether",
    name: "Legacy Dual",
    kind: "wavetable",
    envelope: { attackMs: 5, decayMs: 120, sustain: 0.4, releaseMs: 180 },
    knobs: { cutoff: 0.5, resonance: 0.2, drive: 0.1, color: 0.4 },
    waveform: "wavetable",
    sampleIds: [],
    wavetable: { bank: "fm", position: 0.25, warp: 0, unison: 5, detuneCents: 24, blend: 0.7 },
    aether: {
      oscA: {
        enabled: true,
        level: 0.8,
        pan: 0,
        waveform: "wavetable",
        octave: 0,
        semitone: 0,
        fineCents: 0,
        wavetable: { bank: "fm", position: 0.25, warp: 0, unison: 5, detuneCents: 24, blend: 0.7 },
      },
      oscB: {
        enabled: false,
        level: 0.2,
        pan: 0,
        waveform: "wavetable",
        octave: 1,
        semitone: 0,
        fineCents: 0,
        wavetable: { bank: "organ", position: 0.8, warp: 0, unison: 1, detuneCents: 0, blend: 0 },
      },
      sub: { enabled: false, level: 0, octave: -1, waveform: "sine" },
      noise: { enabled: false, level: 0, color: 0.5 },
    },
  });
  assert.equal(legacyAether.parameters["unison.enabled"], true);
  assert.equal(legacyAether.parameters["unison.voices"], 5);
  assert.equal(legacyAether.parameters["osc.b.position"], 0.8);

  const customDraft = synthStore.normalizeSynthDraftPatch({
    name: "Custom Table Probe",
    parameters: {
      "osc.a.wavetable": "user.custom",
      "osc.a.position": 0.74,
      "osc.a.level": 0.82,
      "filter.cutoff": 8400,
      "amp.level": 0.72,
    },
    modulation: [],
    metadata: {
      tags: ["custom", "wavetable"],
      customWavetables: {
        "user.custom": {
          id: "user.custom",
          name: "Verifier Custom",
          frames: [
            { brightness: 0.12, even: 0.04, fold: 0.0, phase: 0 },
            { brightness: 0.38, even: 0.18, fold: 0.2, phase: 0.25 },
            { brightness: 0.66, even: 0.55, fold: 0.42, phase: -0.16 },
            { brightness: 0.95, even: 0.86, fold: 0.68, phase: 0.36 },
          ],
        },
      },
    },
  });
  const customPatch = synthStore.synthDraftToInstrumentPatch(customDraft);
  assert.equal(customPatch.wavetable.bank, "custom");
  assert.equal(customPatch.wavetable.customId, "user.custom");
  assert.equal(customPatch.aether.oscA.wavetable.bank, "custom");
  assert.equal(customPatch.synthPatch.metadata.customWavetables["user.custom"].frames[3].fold, 0.68);
  assert.deepEqual(synthStore.normalizeSynthDraftPatch(JSON.parse(JSON.stringify(customPatch.synthPatch))), customDraft);

  synthStore.useSynthStore.getState().resetDraft();
  synthStore.useSynthStore.getState().setParameter("osc.a.wavetable", "user.custom");
  const frameBeforeEdit = { ...synthStore.useSynthStore.getState().draft.metadata.customWavetables["user.custom"].frames[1] };
  synthStore.useSynthStore.getState().updateCustomWavetableFrame("user.custom", 1, { brightness: 0.91 });
  const frameAfterEdit = synthStore.useSynthStore.getState().draft.metadata.customWavetables["user.custom"].frames[1];
  assert.equal(frameAfterEdit.brightness, 0.91);
  assert.equal(frameAfterEdit.even, frameBeforeEdit.even);
  assert.equal(frameAfterEdit.fold, frameBeforeEdit.fold);
  assert.equal(frameAfterEdit.phase, frameBeforeEdit.phase);

  const customPreview = synthStore.synthDraftToPreviewInstrument(customDraft);
  const customSamples = new Float32Array(24000);
  synthPreview.renderInstrumentSamples(customPreview, customSamples, 48000, synthPreview.previewFrequency(customPreview), "audio", true);
  let customEnergy = 0;
  let customPeak = 0;
  for (const sample of customSamples) {
    assert.equal(Number.isFinite(sample), true);
    customEnergy += sample * sample;
    customPeak = Math.max(customPeak, Math.abs(sample));
  }
  const customRms = Math.sqrt(customEnergy / customSamples.length);
  assert.ok(customRms > 0.01, `expected audible custom wavetable rms, got ${customRms}`);
  assert.ok(customPeak > 0.05, `expected audible custom wavetable peak, got ${customPeak}`);

  const dynamicModDraft = synthStore.normalizeSynthDraftPatch({
    name: "Dynamic Matrix Probe",
    parameters: {
      "osc.a.enabled": true,
      "osc.a.wavetable": "basic.saw",
      "osc.a.position": 0.1,
      "osc.a.level": 0.2,
      "osc.a.pan": -0.2,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.pulse",
      "osc.b.position": 0.15,
      "osc.b.level": 0.82,
      "osc.b.pan": 0.2,
      "unison.enabled": true,
      "unison.voices": 3,
      "unison.detune": 0.12,
      "unison.spread": 0.24,
      "filter.cutoff": 12000,
      "filter.resonance": 0.12,
      "filter.drive": 0.05,
      "amp.level": 0.7,
      "lfo.1.enabled": true,
      "lfo.1.rate": 1,
      "lfo.1.shape": "sine",
    },
    modulation: [
      { id: "lfo_b_position", source: "lfo.1", target: "osc.b.position", amount: 0.5, bipolar: false, enabled: true },
      { id: "lfo_b_level", source: "lfo.1", target: "osc.b.level", amount: -0.25, bipolar: false, enabled: true },
      { id: "lfo_a_pan", source: "lfo.1", target: "osc.a.pan", amount: 0.22, bipolar: false, enabled: true },
      { id: "lfo_b_pan", source: "lfo.1", target: "osc.b.pan", amount: -0.18, bipolar: true, enabled: true },
      { id: "lfo_res", source: "lfo.1", target: "filter.resonance", amount: 0.18, bipolar: false, enabled: true },
      { id: "env_drive", source: "env.1", target: "filter.drive", amount: 0.22, bipolar: false, enabled: true },
      { id: "lfo_unison", source: "lfo.1", target: "unison.detune", amount: 0.08, bipolar: false, enabled: true },
      { id: "lfo_spread", source: "lfo.1", target: "unison.spread", amount: 0.32, bipolar: false, enabled: true },
    ],
  });
  const dynamicPreview = synthStore.synthDraftToPreviewInstrument(dynamicModDraft);
  assert.equal(dynamicPreview.wavetable.blend, 0.24);
  assert.equal(dynamicPreview.aether.oscA.wavetable.blend, 0.24);
  const dynamicOffsets = synthPreview.modulationAtTime(dynamicPreview, 0.25, 1).targetOffsets;
  assert.ok(Math.abs(dynamicOffsets["osc.b.position"] - 0.5) < 0.000001);
  assert.ok(Math.abs(dynamicOffsets["osc.b.level"] + 0.25) < 0.000001);
  assert.ok(Math.abs(dynamicOffsets["osc.a.pan"] - 0.22) < 0.000001);
  assert.ok(Math.abs(dynamicOffsets["osc.b.pan"] + 0.18) < 0.000001);
  assert.ok(Math.abs(dynamicOffsets["filter.resonance"] - 0.18) < 0.000001);
  assert.ok(Math.abs(dynamicOffsets["unison.detune"] - 8) < 0.000001);
  assert.ok(Math.abs(dynamicOffsets["unison.spread"] - 0.32) < 0.000001);

  const disabledDynamicDraft = synthStore.normalizeSynthDraftPatch({
    ...dynamicModDraft,
    modulation: dynamicModDraft.modulation.map((route) => ({ ...route, enabled: false })),
  });
  const dynamicSamples = new Float32Array(24000);
  const disabledDynamicSamples = new Float32Array(24000);
  synthPreview.renderInstrumentSamples(dynamicPreview, dynamicSamples, 48000, synthPreview.previewFrequency(dynamicPreview), "audio", true);
  const disabledDynamicPreview = synthStore.synthDraftToPreviewInstrument(disabledDynamicDraft);
  synthPreview.renderInstrumentSamples(disabledDynamicPreview, disabledDynamicSamples, 48000, synthPreview.previewFrequency(disabledDynamicPreview), "audio", true);
  let dynamicDiff = 0;
  for (let i = 0; i < dynamicSamples.length; i++) {
    assert.equal(Number.isFinite(dynamicSamples[i]), true);
    assert.equal(Number.isFinite(disabledDynamicSamples[i]), true);
    const delta = dynamicSamples[i] - disabledDynamicSamples[i];
    dynamicDiff += delta * delta;
  }
  const dynamicDiffRms = Math.sqrt(dynamicDiff / dynamicSamples.length);
  assert.ok(dynamicDiffRms > 0.001, `expected expanded modulation routes to alter render, got diff ${dynamicDiffRms}`);

  const preview = synthStore.synthDraftToPreviewInstrument(loadedDraft);
  const samples = new Float32Array(48000);
  synthPreview.renderInstrumentSamples(preview, samples, 48000, synthPreview.previewFrequency(preview), "audio", true);
  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    assert.equal(Number.isFinite(sample), true);
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  assert.ok(rms > 0.01, `expected audible preview rms, got ${rms}`);
  assert.ok(peak > 0.05, `expected audible preview peak, got ${peak}`);

  console.log(JSON.stringify({ ok: true, routes: draft.modulation.length, rms, peak }, null, 2));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
