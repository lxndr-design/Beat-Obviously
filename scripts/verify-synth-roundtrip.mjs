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
      join(repoRoot, "frontend/src/state/effectPresets.ts"),
      join(repoRoot, "frontend/src/state/synthPresets.ts"),
      join(repoRoot, "frontend/src/audio/synthPreview.ts"),
      join(repoRoot, "frontend/src/ai/aiService.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outdir=${outDir}`,
    ],
    { stdio: "inherit" },
  );

  const synthStore = await import(pathToFileURL(join(outDir, "state/synthStore.js")));
  const effectPresets = await import(pathToFileURL(join(outDir, "state/effectPresets.js")));
  const synthPresets = await import(pathToFileURL(join(outDir, "state/synthPresets.js")));
  const synthPreview = await import(pathToFileURL(join(outDir, "audio/synthPreview.js")));
  const aiService = await import(pathToFileURL(join(outDir, "ai/aiService.js")));

  const draft = synthStore.normalizeSynthDraftPatch({
    name: "Roundtrip Probe",
    parameters: {
      "osc.a.enabled": true,
      "osc.a.wavetable": "basic.pulse",
      "osc.a.position": 0.42,
      "osc.a.warp": 0.58,
      "osc.a.warpMode": "fold",
      "osc.a.octave": -1,
      "osc.a.semitone": 7,
      "osc.a.fine": -14,
      "osc.a.level": 0.74,
      "osc.a.pan": -0.35,
      "osc.a.phase": 0.33,
      "osc.a.randomPhase": 0.2,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.triangle",
      "osc.b.position": 0.81,
      "osc.b.warp": 0.36,
      "osc.b.warpMode": "pinch",
      "osc.b.octave": 1,
      "osc.b.semitone": -5,
      "osc.b.fine": 23,
      "osc.b.level": 0.33,
      "osc.b.pan": 0.45,
      "osc.b.phase": 0.66,
      "osc.b.randomPhase": 0.1,
      "unison.enabled": true,
      "unison.voices": 5,
      "unison.detune": 0.27,
      "unison.blend": 0.61,
      maxVoices: 6,
      "mono.enabled": true,
      "legato.enabled": true,
      "filter.enabled": true,
      "filter.type": "highpass",
      "filter.cutoff": 1370,
      "filter.keytrack": 0.62,
      "filter.resonance": 0.43,
      "filter.drive": 0.19,
      "amp.level": 0.66,
      "amp.pan": -0.24,
      "env.1.attack": 0.012,
      "env.1.attackCurve": "exp",
      "env.1.decay": 0.34,
      "env.1.decayCurve": "s-curve",
      "env.1.sustain": 0.57,
      "env.1.release": 0.78,
      "env.1.releaseCurve": "log",
      "env.1.loop": true,
      "env.2.attack": 0.01,
      "env.2.attackCurve": "exp",
      "env.2.decay": 0.09,
      "env.2.decayCurve": "s-curve",
      "env.2.sustain": 0,
      "env.2.release": 0.16,
      "env.2.releaseCurve": "log",
      "env.2.loop": true,
      "lfo.1.enabled": true,
      "lfo.1.rate": 4.5,
      "lfo.1.sync": true,
      "lfo.1.syncedRate": "1/8",
      "lfo.1.smoothing": 0.35,
      "lfo.1.randomPhase": 0.42,
      "lfo.1.shape": "triangle",
      "lfo.1.phase": 0.25,
      "lfo.1.retrigger": false,
      "lfo.1.oneShot": true,
      "lfo.2.enabled": true,
      "lfo.2.rate": 0.75,
      "lfo.2.sync": true,
      "lfo.2.syncedRate": "1/2",
      "lfo.2.smoothing": 0.6,
      "lfo.2.randomPhase": 0.25,
      "lfo.2.shape": "square",
      "lfo.2.phase": 0.5,
      "lfo.2.retrigger": true,
      "lfo.2.oneShot": false,
      "macro.1": 0.5,
      "future.experimental": "preserve-me",
    },
    modulation: [
      { id: "route", source: "lfo.1", target: "osc.a.position", amount: -0.21, bipolar: false, enabled: true },
      { id: "route", source: "lfo.1", target: "osc.a.fine", amount: 0.4, bipolar: true, enabled: true },
      { id: "route_lfo2_b_pan", source: "lfo.2", target: "osc.b.pan", amount: -0.25, bipolar: true, enabled: true },
      { id: "filter_env", source: "env.1", target: "filter.cutoff", amount: 0.31, bipolar: false, enabled: true },
      { id: "env2_res", source: "env.2", target: "filter.resonance", amount: 0.2, bipolar: false, enabled: true },
      { id: "keytrack_level", source: "keytrack", target: "osc.a.level", amount: 0.2, bipolar: false, enabled: true },
      { id: "modwheel_pan", source: "modWheel", target: "amp.pan", amount: 0.35, bipolar: true, enabled: true },
      { id: "macro_cutoff", source: "macro.1", target: "filter.cutoff", amount: 0.12, bipolar: false, enabled: true },
      { id: "velocity_amp", source: "velocity", target: "amp.level", amount: 0.25, bipolar: false, enabled: true },
      { id: "disabled_macro", source: "macro.1", target: "amp.level", amount: -1, bipolar: false, enabled: false },
    ],
    effects: {
      filters: [
        {
          id: "aether-fx-drive",
          kind: "saturator",
          bypassed: false,
          params: { drive: 36, mix: 72 },
        },
        {
          id: "aether-fx-space",
          kind: "delay",
          bypassed: true,
          latencySamples: 128,
          params: { timeMs: 375, feedback: 31, mix: 14 },
        },
      ],
    },
    metadata: {
      tags: ["roundtrip", "probe"],
      icon: "ph:planet",
      macros: {
        "macro.1": { id: "macro.1", label: "Brightness", min: 0.2, max: 0.8, curve: "ease-in" },
      },
    },
  });

  assert.equal(draft.parameters["future.experimental"], "preserve-me");
  assert.equal(new Set(draft.modulation.map((route) => route.id)).size, draft.modulation.length);
  assert.equal(draft.metadata.macros["macro.1"].label, "Brightness");
  assert.equal(Math.abs(synthStore.macroOutputValue(draft, "macro.1") - 0.35) < 0.000001, true);
  assert.equal(synthStore.modulationSourceLabel(draft, "macro.1"), "Brightness");
  assert.equal(synthStore.macroAssignmentsForId(draft, "macro.1").length, 1);
  const macroLaneState = synthStore.macroLaneStateForId(draft, "macro.1");
  assert.deepEqual({
    ...macroLaneState,
    outputValue: Number(macroLaneState.outputValue.toFixed(6)),
  }, {
    id: "macro.1",
    label: "Brightness",
    rawValue: 0.5,
    outputValue: 0.35,
    rangeStart: 0.2,
    rangeEnd: 0.8,
    curve: "ease-in",
    assignmentCount: 1,
    targetLabels: ["Filter Cutoff"],
  });
  assert.deepEqual(synthStore.macroConflictSummaryForId(draft, "macro.1"), {
    count: 1,
    label: "Filter Cutoff with Amp Env",
  });
  assert.deepEqual(synthStore.macroConflictDetailsForId(draft, "macro.1"), [
    {
      target: "filter.cutoff",
      targetLabel: "Filter Cutoff",
      competingSources: ["Amp Env"],
      behavior: "summed",
      label: "Filter Cutoff with Amp Env",
    },
  ]);
  assert.deepEqual(synthStore.macroConflictSummaryForId(draft, "macro.2"), {
    count: 0,
    label: "",
  });
  assert.deepEqual(synthStore.macroConflictDetailsForId(draft, "macro.2"), []);
  assert.equal(draft.metadata.wavemaps["user.custom"].schemaVersion, 1);
  assert.equal(draft.metadata.customWavetables["user.custom"].frames.length, 4);
  assert.equal(draft.effects.filters.length, 2);
  assert.equal(draft.effects.filters[0].kind, "saturator");
  assert.equal(draft.effects.filters[0].params.drive, 36);
  assert.equal(draft.effects.filters[0].params.mix, 72);
  assert.equal(draft.effects.filters[1].kind, "delay");
  assert.equal(draft.effects.filters[1].bypassed, true);
  assert.equal(draft.effects.filters[1].latencySamples, 128);
  assert.deepEqual(synthStore.modulationSummaryForTarget(draft, "osc.a.position"), {
    count: 1,
    amount: -0.21,
    label: "LFO 1 -21",
  });
  assert.deepEqual(synthStore.modulationSummaryForTarget(draft, "filter.cutoff"), {
    count: 2,
    amount: 0.352,
    label: "2 routes +35",
  });
  assert.deepEqual(synthStore.modulationSummaryForSource(draft, "macro.1"), {
    count: 1,
    amount: 0.042,
    label: "Filter Cutoff +4",
  });
  assert.deepEqual(synthStore.modulationSummaryForSource(draft, "lfo.2"), {
    count: 1,
    amount: -0.25,
    label: "OSC B Pan -25",
  });
  assert.deepEqual(synthStore.modulationSummaryForSource(draft, "env.2"), {
    count: 1,
    amount: 0.2,
    label: "Filter Res +20",
  });
  assert.deepEqual(synthStore.modulationSummaryForSource(draft, "keytrack"), {
    count: 1,
    amount: 0.2,
    label: "OSC A Level +20",
  });
  assert.deepEqual(synthStore.modulationSummaryForSource(draft, "modWheel"), {
    count: 1,
    amount: 0.35,
    label: "Amp Pan +35",
  });
  assert.equal(synthStore.MODULATION_SOURCE_LABELS.velocity, "Velocity");
  assert.deepEqual(synthStore.modulationSummaryForSource(draft, "velocity"), {
    count: 1,
    amount: 0.25,
    label: "Amp Level +25",
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

  const userPreset = synthPresets.createSynthPresetRecord({
    name: "  Verifier Aether Preset  ",
    patch: draft,
    tags: ["lead", "lead", "", "macro"],
    now: 1234,
  });
  assert.equal(userPreset.schemaVersion, 1);
  assert.equal(userPreset.kind, "instrument");
  assert.equal(userPreset.name, "Verifier Aether Preset");
  assert.deepEqual(userPreset.tags, ["lead", "macro"]);
  assert.equal(userPreset.createdAt, 1234);
  assert.equal(userPreset.updatedAt, 1234);
  assert.equal(userPreset.id.startsWith("preset:verifier-aether-preset:"), true);
  assert.deepEqual(userPreset.patch, draft);
  userPreset.patch.name = "Mutated Copy";
  assert.equal(draft.name, "Roundtrip Probe");

  const migratedPreset = synthPresets.normalizeSynthPresetRecord({
    id: "legacy",
    name: "Legacy Preset",
    patch: draft,
    tags: ["legacy"],
    updatedAt: 5678,
  });
  assert.equal(migratedPreset.schemaVersion, 1);
  assert.equal(migratedPreset.kind, "instrument");
  assert.equal(migratedPreset.createdAt, 5678);
  assert.equal(migratedPreset.updatedAt, 5678);

  const fxPreset = effectPresets.createAetherEffectPresetRecord({
    name: "  Wide FX Chain  ",
    chain: draft.effects,
    tags: ["aether", "aether", "fx"],
    now: 2468,
  });
  assert.equal(fxPreset.schemaVersion, 1);
  assert.equal(fxPreset.kind, "instrument-fx-chain");
  assert.equal(fxPreset.name, "Wide FX Chain");
  assert.deepEqual(fxPreset.tags, ["aether", "fx"]);
  assert.equal(fxPreset.createdAt, 2468);
  assert.equal(fxPreset.updatedAt, 2468);
  assert.equal(fxPreset.id.startsWith("fx-preset:wide-fx-chain:"), true);
  assert.equal(fxPreset.chain.filters.length, 2);
  assert.equal(fxPreset.chain.filters[0].kind, "saturator");
  assert.equal(fxPreset.chain.filters[1].bypassed, true);
  fxPreset.chain.filters[0].params.drive = 1;
  assert.equal(draft.effects.filters[0].params.drive, 36);

  const migratedFxPreset = effectPresets.normalizeAetherEffectPresetRecord({
    id: "legacy-fx",
    name: "Legacy FX",
    chain: { filters: [{ kind: "delay", params: { timeMs: 510 } }] },
    updatedAt: 9753,
  });
  assert.equal(migratedFxPreset.schemaVersion, 1);
  assert.equal(migratedFxPreset.kind, "instrument-fx-chain");
  assert.equal(migratedFxPreset.createdAt, 9753);
  assert.equal(migratedFxPreset.chain.filters[0].params.timeMs, 510);
  assert.equal(migratedFxPreset.chain.filters[0].params.feedback, 25);

  const patch = synthStore.synthDraftToInstrumentPatch(draft);
  assert.equal(patch.name, "Roundtrip Probe");
  assert.equal(patch.icon, "ph:planet");
  assert.equal(patch.kind, "wavetable");
  assert.equal(patch.filterType, "highpass");
  assert.equal(patch.filterKeytrack, 0.62);
  assert.equal(patch.aether.oscB.enabled, true);
  assert.equal(patch.aether.oscA.pan, -0.35);
  assert.equal(patch.aether.oscB.pan, 0.45);
  assert.equal(patch.aether.oscA.phase, 0.33);
  assert.equal(patch.aether.oscA.randomPhase, 0.2);
  assert.equal(patch.aether.oscA.wavetable.warp, 0.58);
  assert.equal(patch.aether.oscA.wavetable.warpMode, "fold");
  assert.equal(patch.aether.oscB.phase, 0.66);
  assert.equal(patch.aether.oscB.randomPhase, 0.1);
  assert.equal(patch.aether.oscB.wavetable.warp, 0.36);
  assert.equal(patch.aether.oscB.wavetable.warpMode, "pinch");
  assert.equal(patch.aether.oscB.wavetable.bank, "organ");
  assert.equal(patch.wavetable.unison, 5);
  assert.equal(patch.maxVoices, 6);
  assert.equal(patch.mono, true);
  assert.equal(patch.legato, true);
  assert.equal(patch.aether.oscA.wavetable.unison, 5);
  assert.equal(patch.aether.oscB.wavetable.unison, 5);
  assert.equal(patch.lfo2Waveform, "square");
  assert.equal(patch.lfo2RateHz, 0.75);
  assert.equal(patch.lfo2Enabled, true);
  assert.equal(patch.lfoSync, true);
  assert.equal(patch.lfoSyncedRate, "1/8");
  assert.equal(patch.lfoSmoothing, 0.35);
  assert.equal(patch.lfoRandomPhase, 0.42);
  assert.equal(patch.lfo2Sync, true);
  assert.equal(patch.lfo2SyncedRate, "1/2");
  assert.equal(patch.lfo2Smoothing, 0.6);
  assert.equal(patch.lfo2RandomPhase, 0.25);
  assert.equal(patch.lfoPhase, 0.25);
  assert.equal(patch.lfo2Phase, 0.5);
  assert.equal(patch.lfoRetrigger, false);
  assert.equal(patch.lfo2Retrigger, true);
  assert.equal(patch.lfoOneShot, true);
  assert.equal(patch.lfo2OneShot, false);
  assert.equal(patch.lfoPositionBipolar, false);
  assert.equal(patch.lfoPitchBipolar, true);
  assert.equal(patch.envelope.attackCurve, "exp");
  assert.equal(patch.envelope.decayCurve, "s-curve");
  assert.equal(patch.envelope.releaseCurve, "log");
  assert.equal(patch.envelope.loop, true);
  assert.equal(patch.synthPatch.parameters["env.1.loop"], true);
  assert.equal(patch.synthPatch.parameters["env.2.loop"], true);
  assert.equal(patch.synthPatch.parameters["future.experimental"], "preserve-me");
  assert.equal(patch.synthPatch.metadata.icon, "ph:planet");
  assert.equal(patch.effects.filters.length, 2);
  assert.equal(patch.effects.filters[0].params.drive, 36);
  assert.equal(patch.synthPatch.effects.filters[1].params.timeMs, 375);

  const loadedEffectDraft = synthStore.synthDraftFromInstrument({
    id: "loaded-aether",
    sampleIds: [],
    userCreated: true,
    ...patch,
    effects: {
      filters: [
        {
          id: "loaded-fx",
          kind: "reverb",
          bypassed: false,
          params: { roomSize: 63, damping: 18, mix: 27 },
        },
      ],
    },
  });
  assert.equal(loadedEffectDraft.effects.filters.length, 1);
  assert.equal(loadedEffectDraft.effects.filters[0].id, "loaded-fx");
  assert.equal(loadedEffectDraft.effects.filters[0].kind, "reverb");
  assert.equal(loadedEffectDraft.effects.filters[0].params.roomSize, 63);

  const linearAttack = synthStore.synthDraftToPreviewInstrument({
    ...draft,
    parameters: { ...draft.parameters, "amp.level": 0, "env.1.attack": 0.2, "env.1.attackCurve": "linear" },
    modulation: [{ id: "attack_probe", source: "env.1", target: "amp.level", amount: 1, bipolar: false, enabled: true }],
  });
  const expAttack = synthStore.synthDraftToPreviewInstrument({
    ...draft,
    parameters: { ...draft.parameters, "amp.level": 0, "env.1.attack": 0.2, "env.1.attackCurve": "exp" },
    modulation: [{ id: "attack_probe", source: "env.1", target: "amp.level", amount: 1, bipolar: false, enabled: true }],
  });
  const linearAttackSamples = new Float32Array(3200);
  const expAttackSamples = new Float32Array(3200);
  synthPreview.renderInstrumentSamples(linearAttack, linearAttackSamples, 48000, synthPreview.previewFrequency(linearAttack), "audio", true);
  synthPreview.renderInstrumentSamples(expAttack, expAttackSamples, 48000, synthPreview.previewFrequency(expAttack), "audio", true);
  const headEnergy = (samples) => samples.slice(0, 1200).reduce((sum, sample) => sum + sample * sample, 0);
  assert.ok(headEnergy(expAttackSamples) < headEnergy(linearAttackSamples) * 0.85, "expected exponential attack curve to soften preview attack");

  const env1LoopPreview = synthStore.synthDraftToPreviewInstrument({
    ...draft,
    parameters: {
      ...draft.parameters,
      "amp.level": 0.9,
      "env.1.attack": 0.015,
      "env.1.decay": 0.04,
      "env.1.sustain": 0,
      "env.1.release": 0.05,
      "env.1.loop": true,
      "env.2.loop": false,
    },
    modulation: [],
  });
  const env1NoLoopPreview = synthStore.synthDraftToPreviewInstrument({
    ...env1LoopPreview.synthPatch,
    parameters: { ...env1LoopPreview.synthPatch.parameters, "env.1.loop": false },
  });
  const env1LoopSamples = new Float32Array(24000);
  const env1NoLoopSamples = new Float32Array(24000);
  synthPreview.renderInstrumentSamples(env1LoopPreview, env1LoopSamples, 48000, synthPreview.previewFrequency(env1LoopPreview), "audio", true);
  synthPreview.renderInstrumentSamples(env1NoLoopPreview, env1NoLoopSamples, 48000, synthPreview.previewFrequency(env1NoLoopPreview), "audio", true);
  const rmsRange = (samples, start, end) => {
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, end - start));
  };
  assert.ok(
    rmsRange(env1LoopSamples, 12000, 18000) > rmsRange(env1NoLoopSamples, 12000, 18000) * 2,
    "expected Env 1 loop mode to keep amp energy after the first decay cycle",
  );

  const keytrackClosed = synthStore.synthDraftToPreviewInstrument({
    ...draft,
    parameters: { ...draft.parameters, "filter.enabled": true, "filter.type": "lowpass", "filter.cutoff": 260, "filter.keytrack": 0 },
    modulation: [],
  });
  const keytrackOpen = synthStore.synthDraftToPreviewInstrument({
    ...draft,
    parameters: { ...draft.parameters, "filter.enabled": true, "filter.type": "lowpass", "filter.cutoff": 260, "filter.keytrack": 1 },
    modulation: [],
  });
  const closedKeytrackSamples = new Float32Array(4096);
  const openKeytrackSamples = new Float32Array(4096);
  const highPreviewFrequency = synthPreview.SYNTH_PREVIEW_BASE_HZ * 4;
  synthPreview.renderInstrumentSamples(keytrackClosed, closedKeytrackSamples, 48000, highPreviewFrequency, "audio", true);
  synthPreview.renderInstrumentSamples(keytrackOpen, openKeytrackSamples, 48000, highPreviewFrequency, "audio", true);
  const bufferRms = (samples) => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  assert.ok(bufferRms(openKeytrackSamples) > bufferRms(closedKeytrackSamples) * 1.12, "expected filter keytracking to open high-note preview cutoff");

  const velocityPreview = synthStore.synthDraftToPreviewInstrument({
    ...draft,
    parameters: { ...draft.parameters, "amp.level": 0 },
    modulation: [{ id: "velocity_probe", source: "velocity", target: "amp.level", amount: 1, bipolar: false, enabled: true }],
  });
  const lowVelocityOffset = synthPreview.modulationAtTime(velocityPreview, 0.25, 1, 120, 32 / 127).targetOffsets["amp.level"];
  const highVelocityOffset = synthPreview.modulationAtTime(velocityPreview, 0.25, 1, 120, 1).targetOffsets["amp.level"];
  assert.ok(highVelocityOffset > lowVelocityOffset * 3, "expected velocity modulation source to scale target offsets");
  const lowVelocitySamples = new Float32Array(4096);
  const highVelocitySamples = new Float32Array(4096);
  synthPreview.renderInstrumentSamples(
    velocityPreview,
    lowVelocitySamples,
    48000,
    synthPreview.previewFrequency(velocityPreview),
    "audio",
    true,
    undefined,
    undefined,
    undefined,
    120,
    32,
  );
  synthPreview.renderInstrumentSamples(
    velocityPreview,
    highVelocitySamples,
    48000,
    synthPreview.previewFrequency(velocityPreview),
    "audio",
    true,
    undefined,
    undefined,
    undefined,
    120,
    127,
  );
  assert.ok(bufferRms(highVelocitySamples) > bufferRms(lowVelocitySamples) * 3, "expected note velocity to drive preview loudness through modulation");

  const keytrackPreview = synthStore.synthDraftToPreviewInstrument({
    ...draft,
    parameters: { ...draft.parameters, "amp.level": 0 },
    modulation: [{ id: "keytrack_probe", source: "keytrack", target: "amp.level", amount: 1, bipolar: false, enabled: true }],
  });
  assert.ok(
    synthPreview.modulationAtTime(keytrackPreview, 0.25, 1, 120, 1, 0.8).targetOffsets["amp.level"]
      > synthPreview.modulationAtTime(keytrackPreview, 0.25, 1, 120, 1, 0.25).targetOffsets["amp.level"] * 3,
    "expected keytrack modulation source to scale with normalized MIDI key",
  );
  const lowKeytrackSamples = new Float32Array(4096);
  const highKeytrackSamples = new Float32Array(4096);
  synthPreview.renderInstrumentSamples(keytrackPreview, lowKeytrackSamples, 48000, synthPreview.midiFrequency(36), "audio", true);
  synthPreview.renderInstrumentSamples(keytrackPreview, highKeytrackSamples, 48000, synthPreview.midiFrequency(96), "audio", true);
  assert.ok(bufferRms(highKeytrackSamples) > bufferRms(lowKeytrackSamples) * 1.8, "expected keytrack-routed preview render to respond to played pitch");

  const modWheelPreview = synthStore.synthDraftToPreviewInstrument({
    ...draft,
    parameters: { ...draft.parameters, "amp.level": 0 },
    modulation: [{ id: "modwheel_probe", source: "modWheel", target: "amp.level", amount: 1, bipolar: false, enabled: true }],
  });
  assert.ok(
    synthPreview.modulationAtTime(modWheelPreview, 0.25, 1, 120, 1, 0.6, 0.9).targetOffsets["amp.level"]
      > synthPreview.modulationAtTime(modWheelPreview, 0.25, 1, 120, 1, 0.6, 0.2).targetOffsets["amp.level"] * 3,
    "expected mod wheel modulation source to scale target offsets",
  );
  const lowModWheelSamples = new Float32Array(4096);
  const highModWheelSamples = new Float32Array(4096);
  synthPreview.renderInstrumentSamples(
    modWheelPreview,
    lowModWheelSamples,
    48000,
    synthPreview.previewFrequency(modWheelPreview),
    "audio",
    true,
    undefined,
    undefined,
    undefined,
    120,
    127,
    0.15,
  );
  synthPreview.renderInstrumentSamples(
    modWheelPreview,
    highModWheelSamples,
    48000,
    synthPreview.previewFrequency(modWheelPreview),
    "audio",
    true,
    undefined,
    undefined,
    undefined,
    120,
    127,
    0.95,
  );
  assert.ok(bufferRms(highModWheelSamples) > bufferRms(lowModWheelSamples) * 4, "expected mod wheel-routed preview render to respond to wheel value");

  const pitchBendPreview = {
    id: "pitch-bend-preview",
    name: "Pitch Bend Preview",
    kind: "wavetable",
    waveform: "wavetable",
    envelope: { attackMs: 1, decayMs: 10, sustain: 1, releaseMs: 20 },
    knobs: { cutoff: 1, resonance: 0, drive: 0, color: 0.5 },
    filterType: "lowpass",
    detuneCents: 0,
    octave: 0,
    subOscLevel: 0,
    glideMs: 0,
    ampLevel: 0.9,
    ampPan: 0,
    lfoWaveform: "sine",
    lfoRateHz: 1,
    lfoDepth: 0,
    lfoToPitch: 0,
    lfoToFilter: 0,
    envToFilter: 0,
    sampleIds: [],
    userCreated: true,
    aether: {
      oscA: {
        enabled: true,
        level: 1,
        pan: 0,
        waveform: "sine",
        octave: 0,
        semitone: 0,
        fineCents: 0,
        phase: 0,
        randomPhase: 0,
        wavetable: { bank: "basic.sine", position: 0, warp: 0, warpMode: "shape", unison: 1, detuneCents: 0, blend: 0 },
      },
      oscB: {
        enabled: false,
        level: 0,
        pan: 0,
        waveform: "sine",
        octave: 0,
        semitone: 0,
        fineCents: 0,
        phase: 0,
        randomPhase: 0,
        wavetable: { bank: "basic.sine", position: 0, warp: 0, warpMode: "shape", unison: 1, detuneCents: 0, blend: 0 },
      },
      sub: { enabled: false, level: 0, octave: -1, waveform: "sine" },
      noise: { enabled: false, level: 0, color: 0.5 },
    },
  };
  const pitchBaseSamples = new Float32Array(48000);
  const pitchBentSamples = new Float32Array(48000);
  synthPreview.renderInstrumentSamples(pitchBendPreview, pitchBaseSamples, 48000, 440, "audio", false);
  synthPreview.renderInstrumentSamples(pitchBendPreview, pitchBentSamples, 48000, 440, "audio", false, undefined, undefined, undefined, 120, 127, 0, 2);
  const baseFrequencyEstimate = estimateFrequencyFromZeroCrossings(pitchBaseSamples, 48000);
  const bentFrequencyEstimate = estimateFrequencyFromZeroCrossings(pitchBentSamples, 48000);
  assert.ok(baseFrequencyEstimate > 430 && baseFrequencyEstimate < 450, `expected base pitch near 440 Hz, got ${baseFrequencyEstimate}`);
  assert.ok(
    bentFrequencyEstimate / baseFrequencyEstimate > 1.115 && bentFrequencyEstimate / baseFrequencyEstimate < 1.13,
    `expected +2 semitone bend ratio, got ${bentFrequencyEstimate / baseFrequencyEstimate}`,
  );

  const glidePreview = { ...pitchBendPreview, glideMs: 120 };
  const glideSamples = new Float32Array(48000);
  synthPreview.renderInstrumentSamples(glidePreview, glideSamples, 48000, 440, "audio", false, 880);
  const earlyGlideFrequency = estimateFrequencyFromZeroCrossings(glideSamples, 48000, 1200, 3600);
  const lateGlideFrequency = estimateFrequencyFromZeroCrossings(glideSamples, 48000, 12000, 18000);
  assert.ok(earlyGlideFrequency > 430 && earlyGlideFrequency < 620, `expected glide to begin near source pitch, got ${earlyGlideFrequency}`);
  assert.ok(lateGlideFrequency > 820 && lateGlideFrequency < 910, `expected glide to finish near target pitch, got ${lateGlideFrequency}`);

  const env2Preview = synthStore.synthDraftToPreviewInstrument({
    ...draft,
    parameters: {
      ...draft.parameters,
      "amp.level": 0,
      "env.1.attack": 0.001,
      "env.1.decay": 0.01,
      "env.1.sustain": 1,
      "env.1.release": 0.05,
      "env.1.loop": false,
      "env.2.attack": 0.01,
      "env.2.decay": 0.08,
      "env.2.sustain": 0,
      "env.2.loop": false,
    },
    modulation: [{ id: "env2_probe", source: "env.2", target: "amp.level", amount: 1, bipolar: false, enabled: true }],
  });
  const env2EarlyOffset = synthPreview.modulationAtTime(env2Preview, 0.02, 0.5, 120, 1).targetOffsets["amp.level"];
  const env2LateOffset = synthPreview.modulationAtTime(env2Preview, 0.25, 0.5, 120, 1).targetOffsets["amp.level"];
  assert.ok(env2EarlyOffset > env2LateOffset + 0.5, "expected Env 2 modulation source to follow its own decay contour");
  const env2Samples = new Float32Array(24000);
  synthPreview.renderInstrumentSamples(env2Preview, env2Samples, 48000, synthPreview.previewFrequency(env2Preview), "audio", true);
  assert.ok(rmsRange(env2Samples, 1200, 3600) > rmsRange(env2Samples, 16000, 22000) * 3, "expected Env 2 routed preview render to decay independently of Amp Env");

  const env2LinearAttack = synthStore.synthDraftToPreviewInstrument({
    ...draft,
    parameters: {
      ...draft.parameters,
      "amp.level": 0,
      "env.1.attack": 0.001,
      "env.1.decay": 0.01,
      "env.1.sustain": 1,
      "env.1.release": 0.05,
      "env.1.loop": false,
      "env.2.attack": 0.08,
      "env.2.attackCurve": "linear",
      "env.2.decay": 0.1,
      "env.2.sustain": 1,
      "env.2.loop": false,
    },
    modulation: [{ id: "env2_attack_probe", source: "env.2", target: "amp.level", amount: 1, bipolar: false, enabled: true }],
  });
  const env2ExpAttack = synthStore.synthDraftToPreviewInstrument({
    ...env2LinearAttack.synthPatch,
    parameters: { ...env2LinearAttack.synthPatch.parameters, "env.2.attackCurve": "exp" },
  });
  assert.ok(
    synthPreview.modulationAtTime(env2ExpAttack, 0.04, 0.5, 120, 1).targetOffsets["amp.level"]
      < synthPreview.modulationAtTime(env2LinearAttack, 0.04, 0.5, 120, 1).targetOffsets["amp.level"] * 0.6,
    "expected Env 2 exponential attack to soften modulation onset",
  );
  const env2LinearAttackSamples = new Float32Array(6000);
  const env2ExpAttackSamples = new Float32Array(6000);
  synthPreview.renderInstrumentSamples(env2LinearAttack, env2LinearAttackSamples, 48000, synthPreview.previewFrequency(env2LinearAttack), "audio", true);
  synthPreview.renderInstrumentSamples(env2ExpAttack, env2ExpAttackSamples, 48000, synthPreview.previewFrequency(env2ExpAttack), "audio", true);
  assert.ok(
    rmsRange(env2ExpAttackSamples, 1000, 2600) < rmsRange(env2LinearAttackSamples, 1000, 2600) * 0.7,
    "expected Env 2 attack curve to affect rendered preview audio",
  );

  const env2LoopPreview = synthStore.synthDraftToPreviewInstrument({
    ...draft,
    parameters: {
      ...draft.parameters,
      "amp.level": 0,
      "env.1.attack": 0.001,
      "env.1.decay": 0.01,
      "env.1.sustain": 1,
      "env.1.release": 0.05,
      "env.1.loop": false,
      "env.2.attack": 0.015,
      "env.2.decay": 0.04,
      "env.2.sustain": 0,
      "env.2.release": 0.05,
      "env.2.loop": true,
    },
    modulation: [{ id: "env2_loop_probe", source: "env.2", target: "amp.level", amount: 1, bipolar: false, enabled: true }],
  });
  const env2NoLoopPreview = synthStore.synthDraftToPreviewInstrument({
    ...env2LoopPreview.synthPatch,
    parameters: { ...env2LoopPreview.synthPatch.parameters, "env.2.loop": false },
  });
  const env2LoopSamples = new Float32Array(24000);
  const env2NoLoopSamples = new Float32Array(24000);
  synthPreview.renderInstrumentSamples(env2LoopPreview, env2LoopSamples, 48000, synthPreview.previewFrequency(env2LoopPreview), "audio", true);
  synthPreview.renderInstrumentSamples(env2NoLoopPreview, env2NoLoopSamples, 48000, synthPreview.previewFrequency(env2NoLoopPreview), "audio", true);
  assert.ok(
    rmsRange(env2LoopSamples, 12000, 18000) > rmsRange(env2NoLoopSamples, 12000, 18000) * 2,
    "expected Env 2 loop mode to keep modulating after the first decay cycle",
  );

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
    wavetable: { bank: "fm", position: 0.25, warp: 0.5, warpMode: "fold", unison: 5, detuneCents: 24, blend: 0.7 },
    aether: {
      oscA: {
        enabled: true,
        level: 0.8,
        pan: 0,
        waveform: "wavetable",
        octave: 0,
        semitone: 0,
        fineCents: 0,
        wavetable: { bank: "fm", position: 0.25, warp: 0.5, warpMode: "fold", unison: 5, detuneCents: 24, blend: 0.7 },
      },
      oscB: {
        enabled: false,
        level: 0.2,
        pan: 0,
        waveform: "wavetable",
        octave: 1,
        semitone: 0,
        fineCents: 0,
        wavetable: { bank: "organ", position: 0.8, warp: 0.3, warpMode: "pinch", unison: 1, detuneCents: 0, blend: 0 },
      },
      sub: { enabled: false, level: 0, octave: -1, waveform: "sine" },
      noise: { enabled: false, level: 0, color: 0.5 },
    },
  });
  assert.equal(legacyAether.parameters["unison.enabled"], true);
  assert.equal(legacyAether.parameters["unison.voices"], 5);
  assert.equal(legacyAether.parameters["osc.a.warp"], 0.5);
  assert.equal(legacyAether.parameters["osc.a.warpMode"], "fold");
  assert.equal(legacyAether.parameters["osc.b.position"], 0.8);
  assert.equal(legacyAether.parameters["osc.b.warpMode"], "pinch");

  const warpShape = synthPreview.renderWavetablePreviewSamples({
    ...patch,
    wavetable: { ...patch.wavetable, warp: 0.8, warpMode: "shape" },
    aether: {
      ...patch.aether,
      oscA: { ...patch.aether.oscA, wavetable: { ...patch.aether.oscA.wavetable, warp: 0.8, warpMode: "shape" } },
    },
  }, 256, "a");
  const warpFold = synthPreview.renderWavetablePreviewSamples({
    ...patch,
    wavetable: { ...patch.wavetable, warp: 0.8, warpMode: "fold" },
    aether: {
      ...patch.aether,
      oscA: { ...patch.aether.oscA, wavetable: { ...patch.aether.oscA.wavetable, warp: 0.8, warpMode: "fold" } },
    },
  }, 256, "a");
  const warpPinch = synthPreview.renderWavetablePreviewSamples({
    ...patch,
    wavetable: { ...patch.wavetable, warp: 0.8, warpMode: "pinch" },
    aether: {
      ...patch.aether,
      oscA: { ...patch.aether.oscA, wavetable: { ...patch.aether.oscA.wavetable, warp: 0.8, warpMode: "pinch" } },
    },
  }, 256, "a");
  const diffFold = warpShape.reduce((sum, sample, index) => sum + Math.abs(sample - warpFold[index]), 0) / warpShape.length;
  const diffPinch = warpShape.reduce((sum, sample, index) => sum + Math.abs(sample - warpPinch[index]), 0) / warpShape.length;
  assert.ok(diffFold > 0.002, `expected fold warp mode to change preview, got ${diffFold}`);
  assert.ok(diffPinch > 0.002, `expected pinch warp mode to change preview, got ${diffPinch}`);

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
          schemaVersion: 1,
          id: "user.custom",
          name: "Verifier Custom",
          kind: "harmonic-sketch",
          interpolation: "linear",
          morph: 0.62,
          source: { kind: "drawn", label: "Verifier sketch" },
          frames: [
            { brightness: 0.12, even: 0.04, fold: 0.0, formant: 0.06, notch: 0.04, skew: -0.24, tilt: -0.55, focus: 0.18, phase: 0, partials: [0.82, 0.12, 0.0, 0.36] },
            { brightness: 0.38, even: 0.18, fold: 0.2, formant: 0.22, notch: 0.12, skew: -0.08, tilt: -0.15, focus: 0.36, phase: 0.25, partials: [0.22, 0.74, 0.18, 0.0, 0.46] },
            { brightness: 0.66, even: 0.55, fold: 0.42, formant: 0.48, notch: 0.28, skew: 0.18, tilt: 0.3, focus: 0.58, phase: -0.16, partials: [0.0, 0.18, 0.68, 0.1, 0.0, 0.52] },
            { brightness: 0.95, even: 0.86, fold: 0.68, formant: 0.62, notch: 0.42, skew: 0.32, tilt: 0.62, focus: 0.74, phase: 0.36, partials: [0.08, 0.0, 0.22, 0.64, 0.18, 0.0, 0.44] },
          ],
        },
      },
    },
  });
  const customPatch = synthStore.synthDraftToInstrumentPatch(customDraft);
  assert.equal(customPatch.wavetable.bank, "custom");
  assert.equal(customPatch.wavetable.customId, "user.custom");
  assert.equal(customPatch.aether.oscA.wavetable.bank, "custom");
  assert.equal(customPatch.synthPatch.metadata.wavemaps["user.custom"].source.label, "Verifier sketch");
  assert.equal(customPatch.synthPatch.metadata.wavemaps["user.custom"].morph, 0.62);
  assert.equal(customPatch.synthPatch.metadata.customWavetables["user.custom"].frames[3].fold, 0.68);
  assert.equal(customPatch.synthPatch.metadata.customWavetables["user.custom"].frames[2].formant, 0.48);
  assert.equal(customPatch.synthPatch.metadata.customWavetables["user.custom"].frames[2].notch, 0.28);
  assert.equal(customPatch.synthPatch.metadata.customWavetables["user.custom"].frames[2].partials[2], 0.68);
  assert.equal(customPatch.synthPatch.metadata.customWavetables["user.custom"].frames[2].partials.length, 16);
  assert.equal(customPatch.synthPatch.metadata.customWavetables["user.custom"].frames[2].skew, 0.18);
  assert.equal(customPatch.synthPatch.metadata.customWavetables["user.custom"].frames[2].tilt, 0.3);
  assert.equal(customPatch.synthPatch.metadata.customWavetables["user.custom"].frames[2].focus, 0.58);
  assert.deepEqual(synthStore.normalizeSynthDraftPatch(JSON.parse(JSON.stringify(customPatch.synthPatch))), customDraft);

  synthStore.useSynthStore.getState().resetDraft();
  synthStore.useSynthStore.getState().setParameter("osc.a.wavetable", "user.custom");
  const frameBeforeEdit = { ...synthStore.useSynthStore.getState().draft.metadata.wavemaps["user.custom"].frames[1] };
  synthStore.useSynthStore.getState().updateCustomWavetableFrame("user.custom", 1, { brightness: 0.91 });
  synthStore.useSynthStore.getState().updateWavemapMetadata("user.custom", {
    interpolation: "smooth",
    morph: 0.41,
    source: { kind: "generated", label: "Verifier generated wavemap" },
  });
  const frameAfterEdit = synthStore.useSynthStore.getState().draft.metadata.wavemaps["user.custom"].frames[1];
  assert.equal(frameAfterEdit.brightness, 0.91);
  assert.equal(frameAfterEdit.even, frameBeforeEdit.even);
  assert.equal(frameAfterEdit.fold, frameBeforeEdit.fold);
  assert.equal(frameAfterEdit.formant, frameBeforeEdit.formant);
  assert.equal(frameAfterEdit.notch, frameBeforeEdit.notch);
  assert.deepEqual(frameAfterEdit.partials, frameBeforeEdit.partials);
  assert.equal(frameAfterEdit.skew, frameBeforeEdit.skew);
  assert.equal(frameAfterEdit.tilt, frameBeforeEdit.tilt);
  assert.equal(frameAfterEdit.focus, frameBeforeEdit.focus);
  assert.equal(frameAfterEdit.phase, frameBeforeEdit.phase);
  assert.equal(synthStore.useSynthStore.getState().draft.metadata.wavemaps["user.custom"].interpolation, "smooth");
  assert.equal(synthStore.useSynthStore.getState().draft.metadata.wavemaps["user.custom"].morph, 0.41);
  assert.equal(synthStore.useSynthStore.getState().draft.metadata.customWavetables["user.custom"].source.label, "Verifier generated wavemap");

  const mixedEraWavemapDraft = synthStore.normalizeSynthDraftPatch({
    name: "Mixed Era Wavemap Probe",
    metadata: {
      wavemaps: {
        "user.modern": {
          schemaVersion: 1,
          id: "user.modern",
          name: "Modern Current",
          kind: "harmonic-sketch",
          interpolation: "linear",
          morph: 0.12,
          source: { kind: "generated", label: "Modern wavemap" },
          frames: [
            { brightness: 0.33, even: 0.22, fold: 0.11, formant: 0.1, notch: 0.05, skew: 0.1, tilt: 0.2, focus: 0.3, phase: 0.4 },
          ],
        },
      },
      customWavetables: {
        "user.modern": {
          name: "Stale Legacy Copy",
          frames: [{ brightness: 0.01 }],
        },
        "user.legacy-only": {
          name: "  Legacy Only  ",
          kind: "resynthesized",
          interpolation: "smooth",
          morph: 0.77,
          source: { kind: "imported-audio", label: "Legacy File", path: " /tmp/legacy.wav " },
          frames: [
            { brightness: 2, even: -1, partials: [1, 0.5] },
            { id: "legacy-frame-b", label: "Legacy B", position: 0.42, phase: 2 },
          ],
        },
      },
    },
  });
  assert.equal(mixedEraWavemapDraft.metadata.wavemaps["user.modern"].name, "Modern Current");
  assert.equal(mixedEraWavemapDraft.metadata.wavemaps["user.modern"].frames.length, 4);
  assert.equal(mixedEraWavemapDraft.metadata.wavemaps["user.legacy-only"].schemaVersion, 1);
  assert.equal(mixedEraWavemapDraft.metadata.wavemaps["user.legacy-only"].name, "Legacy Only");
  assert.equal(mixedEraWavemapDraft.metadata.wavemaps["user.legacy-only"].kind, "resynthesized");
  assert.equal(mixedEraWavemapDraft.metadata.wavemaps["user.legacy-only"].source.kind, "imported-audio");
  assert.equal(mixedEraWavemapDraft.metadata.wavemaps["user.legacy-only"].source.path, "/tmp/legacy.wav");
  assert.equal(mixedEraWavemapDraft.metadata.wavemaps["user.legacy-only"].frames.length, 4);
  assert.equal(mixedEraWavemapDraft.metadata.wavemaps["user.legacy-only"].frames[0].brightness, 1);
  assert.equal(mixedEraWavemapDraft.metadata.wavemaps["user.legacy-only"].frames[0].even, 0);
  assert.equal(mixedEraWavemapDraft.metadata.wavemaps["user.legacy-only"].frames[0].partials.length, 16);
  assert.equal(mixedEraWavemapDraft.metadata.wavemaps["user.legacy-only"].frames[1].phase, 1);
  assert.deepEqual(
    mixedEraWavemapDraft.metadata.wavemaps["user.legacy-only"],
    mixedEraWavemapDraft.metadata.customWavetables["user.legacy-only"],
  );

  const drawnPartials = synthStore.drawHarmonicPartialLine([0, 0, 0, 0, 0, 0], 1, 0.25, 5, 0.75);
  assert.equal(drawnPartials.length, 16);
  assert.equal(drawnPartials[1], 0.25);
  assert.equal(drawnPartials[3], 0.5);
  assert.equal(drawnPartials[5], 0.75);
  assert.equal(drawnPartials[0], 0);
  assert.equal(drawnPartials[6], 0);
  const reversePartials = synthStore.drawHarmonicPartialLine([], 4, 1.2, 2, -0.5);
  assert.equal(reversePartials[4], 1);
  assert.equal(reversePartials[3], 0.5);
  assert.equal(reversePartials[2], 0);
  const smoothedPartials = synthStore.smoothHarmonicPartials([0, 1, 0, 0], 1);
  assert.equal(smoothedPartials.length, 16);
  assert.equal(smoothedPartials[0], 0.25);
  assert.equal(smoothedPartials[1], 0.5);
  assert.equal(smoothedPartials[2], 0.25);
  assert.equal(smoothedPartials[3], 0);
  assert.deepEqual(synthStore.smoothHarmonicPartials([0, 1, 0, 0], 0).slice(0, 4), [0, 1, 0, 0]);
  const flatPartials = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const tiltedHighPartials = synthStore.tiltHarmonicPartials(flatPartials, 0.55);
  const tiltedLowPartials = synthStore.tiltHarmonicPartials(flatPartials, -0.55);
  assert.equal(tiltedHighPartials.length, 16);
  assert.ok(tiltedHighPartials[15] > tiltedHighPartials[0], "positive partial tilt should emphasize high harmonics");
  assert.ok(tiltedLowPartials[0] > tiltedLowPartials[15], "negative partial tilt should emphasize low harmonics");
  assert.deepEqual(synthStore.tiltHarmonicPartials([0.1, 0.2, 0.3, 0.4], 0).slice(0, 4), [0.1, 0.2, 0.3, 0.4]);
  const fundamentalPartials = synthStore.createHarmonicPartialPreset("fundamental");
  assert.equal(fundamentalPartials.length, 16);
  assert.equal(fundamentalPartials[0], 1);
  assert.equal(fundamentalPartials.slice(1).every((value) => value === 0), true);
  const oddPartials = synthStore.createHarmonicPartialPreset("odd");
  assert.ok(oddPartials[0] > oddPartials[2] && oddPartials[2] > oddPartials[4], "odd additive preset should decay across odd harmonics");
  assert.equal(oddPartials[1], 0);
  const evenPartials = synthStore.createHarmonicPartialPreset("even");
  assert.equal(evenPartials[0], 0);
  assert.ok(evenPartials[1] > evenPartials[3], "even additive preset should decay across even harmonics");

  const constrainedWavemap = synthStore.normalizeWavemapFrames(synthStore.createDefaultCustomWavetable("user.constraint"));
  assert.equal(synthStore.constrainWavemapFramePosition(constrainedWavemap, 0, 0.5), 0);
  assert.equal(synthStore.constrainWavemapFramePosition(constrainedWavemap, 3, 0.5), 1);
  assert.equal(synthStore.constrainWavemapFramePosition(constrainedWavemap, 1, -1), 0.01);
  assert.ok(Math.abs(synthStore.constrainWavemapFramePosition(constrainedWavemap, 1, 0.99) - 0.6567) < 0.001);
  assert.ok(Math.abs(synthStore.constrainWavemapFramePosition(constrainedWavemap, 2, 0.01) - 0.3433) < 0.001);
  assert.equal(synthStore.constrainWavemapFramePosition(constrainedWavemap, 2, 2), 0.99);
  const drawnWaveformFrame = synthStore.deriveWavemapFrameFromDrawnWaveform(
    { id: "user.custom.frame.drawn", label: "Drawn", position: 0.5, brightness: 0.2, even: 0.1, fold: 0.05, formant: 0.08, notch: 0.04, skew: 0, tilt: 0, focus: 0.2, phase: 0 },
    Float32Array.from({ length: 256 }, (_, index) => Math.sin((index / 256) * Math.PI * 2 * 3)),
  );
  assert.equal(drawnWaveformFrame.id, "user.custom.frame.drawn");
  assert.equal(drawnWaveformFrame.label, "Drawn");
  assert.equal(drawnWaveformFrame.position, 0.5);
  assert.equal(drawnWaveformFrame.partials.length, 16);
  assert.ok(drawnWaveformFrame.partials[2] > 0.9, "drawn waveform should derive the dominant third harmonic");
  assert.ok(drawnWaveformFrame.partials[0] < 0.2, "drawn waveform should not collapse into the fundamental");
  assert.ok(drawnWaveformFrame.formant > 0.08, "drawn waveform should update frame spectral controls");
  assert.equal(drawnWaveformFrame.analysis.dominantHarmonic, 3);
  assert.ok(drawnWaveformFrame.analysis.rms > 0.6, "drawn waveform should persist frame RMS analysis");
  assert.ok(drawnWaveformFrame.analysis.peak > 0.9, "drawn waveform should persist frame peak analysis");
  assert.ok(drawnWaveformFrame.analysis.spectralCentroid > 2.5, "drawn waveform should persist spectral centroid analysis");
  const phaseShiftedFrame = synthStore.deriveWavemapFrameFromDrawnWaveform(
    { id: "user.custom.frame.phase", label: "Phase", position: 0.25, brightness: 0.2, even: 0.1, fold: 0.05, formant: 0.08, notch: 0.04, skew: 0, tilt: 0, focus: 0.2, phase: 0 },
    Float32Array.from({ length: 256 }, (_, index) => Math.sin((index / 256) * Math.PI * 2 * 3 + Math.PI / 2)),
  );
  assert.ok(phaseShiftedFrame.partials[2] > 0.9, "phase-shifted drawn waveform should keep the same dominant harmonic");
  assert.equal(phaseShiftedFrame.analysis.dominantHarmonic, 3);
  assert.ok(Math.abs(phaseShiftedFrame.phase - drawnWaveformFrame.phase) > 0.32, "drawn waveform phase should track dominant harmonic phase");

  const resynthSamples = Float32Array.from({ length: 4096 }, (_, index) => {
    const phase = index / 4096;
    return Math.sin(phase * Math.PI * 2 * 9) * 0.7 + Math.sin(phase * Math.PI * 2 * 23 + 0.4) * 0.28;
  });
  const selectionSamples = Float32Array.from({ length: 4096 }, (_, index) => {
    if (index === 384) return 1;
    if (index > 2380 && index < 3200) return Math.sin(index * 0.19) * 0.72;
    return Math.sin(index * 0.05) * 0.08;
  });
  const transientSelection = synthStore.selectWavemapAudioWindow(selectionSamples, { mode: "transient", windowRatio: 0.25 });
  assert.equal(transientSelection.samples.length, 1024);
  assert.ok(transientSelection.sourceStartSample <= 384 && transientSelection.sourceEndSample > 384, "transient selection should include the strongest attack");
  assert.ok(transientSelection.peakSample > 0.9, "transient selection should report the selected peak");
  const sustainSelection = synthStore.selectWavemapAudioWindow(selectionSamples, { mode: "sustain", windowRatio: 0.25 });
  assert.equal(sustainSelection.samples.length, 1024);
  assert.ok(sustainSelection.sourceStartSample > transientSelection.sourceStartSample, "sustain selection should choose the later steady-energy window");
  assert.ok(sustainSelection.rms > transientSelection.rms * 0.5, "sustain selection should preserve meaningful RMS energy");
  const manualSelection = synthStore.selectWavemapAudioWindow(selectionSamples, { mode: "manual", startRatio: 0.25, endRatio: 0.5 });
  assert.equal(manualSelection.sourceStartSample, 1024);
  assert.equal(manualSelection.sourceEndSample, 2048);
  assert.equal(manualSelection.samples.length, 1024);
  const normalizedManualRange = synthStore.normalizeWavemapManualRange(75, 25);
  assert.deepEqual(
    normalizedManualRange,
    { startRatio: 0.25, endRatio: 0.75, startPercent: 25, endPercent: 75 },
    "manual wavemap range should sort UI percentages into stable ratios",
  );
  const clampedManualRange = synthStore.normalizeWavemapManualRange(-10, 160);
  assert.deepEqual(
    clampedManualRange,
    { startRatio: 0, endRatio: 1, startPercent: 0, endPercent: 100 },
    "manual wavemap range should clamp UI percentages to the audio extent",
  );
  const minimumManualRange = synthStore.normalizeWavemapManualRange(42, 42);
  assert.equal(minimumManualRange.startPercent, 42, "manual wavemap range should preserve the requested start when possible");
  assert.equal(minimumManualRange.endPercent, 43, "manual wavemap range should enforce a visible minimum span");
  const swappedManualSelection = synthStore.selectWavemapAudioWindow(selectionSamples, {
    mode: "manual",
    startRatio: normalizedManualRange.startRatio,
    endRatio: normalizedManualRange.endRatio,
  });
  assert.equal(swappedManualSelection.sourceStartSample, 1024);
  assert.equal(swappedManualSelection.sourceEndSample, 3072);
  assert.equal(swappedManualSelection.samples.length, 2048);
  const transientWavemap = synthStore.createWavemapFromAudioSamples(
    "user.resynth.transient.verify",
    "Transient Resynth",
    transientSelection.samples,
    48000,
    {
      kind: "imported-audio",
      label: "Transient Source",
      sourceSampleCount: selectionSamples.length,
      sourceStartSample: transientSelection.sourceStartSample,
      sourceEndSample: transientSelection.sourceEndSample,
    },
  );
  assert.equal(transientWavemap.source.sourceStartSample, transientSelection.sourceStartSample);
  assert.equal(transientWavemap.source.sourceEndSample, transientSelection.sourceEndSample);
  assert.equal(transientWavemap.frames[0].analysis.sourceStartSample, transientSelection.sourceStartSample);
  assert.equal(transientWavemap.frames.at(-1).analysis.sourceEndSample, transientSelection.sourceEndSample);
  const resynthWavemap = synthStore.createWavemapFromAudioSamples(
    "user.resynth.verify",
    "Verifier Resynth",
    resynthSamples,
    48000,
    { kind: "imported-audio", label: "Verifier Audio", path: "/tmp/verifier.wav", sampleRate: 48000, channelCount: 2, bitDepth: 24, sourceSampleCount: 4096, sourceStartSample: 10, sourceEndSample: 4106 },
  );
  assert.equal(resynthWavemap.kind, "resynthesized");
  assert.equal(resynthWavemap.interpolation, "smooth");
  assert.equal(resynthWavemap.source.kind, "imported-audio");
  assert.equal(resynthWavemap.source.path, "/tmp/verifier.wav");
  assert.equal(resynthWavemap.source.sampleRate, 48000);
  assert.equal(resynthWavemap.source.channelCount, 2);
  assert.equal(resynthWavemap.source.bitDepth, 24);
  assert.equal(resynthWavemap.source.sourceSampleCount, 4096);
  assert.equal(resynthWavemap.source.analyzedSampleCount, 4096);
  assert.equal(resynthWavemap.source.frameCount, 4);
  assert.equal(resynthWavemap.source.sourceStartSample, 10);
  assert.equal(resynthWavemap.source.sourceEndSample, 4106);
  assert.equal(resynthWavemap.frames.length, 4);
  assert.equal(resynthWavemap.frames.every((frame) => frame.id?.startsWith("user.resynth.verify.frame.")), true);
  assert.equal(resynthWavemap.frames.every((frame) => Array.isArray(frame.partials) && frame.partials.length === 16), true);
  assert.equal(resynthWavemap.frames[0].analysis.sourceStartSample, 10);
  assert.equal(resynthWavemap.frames.at(-1).analysis.sourceEndSample, 4106);
  assert.equal(resynthWavemap.frames.every((frame) => frame.analysis && frame.analysis.sourceEndSample > frame.analysis.sourceStartSample), true);
  assert.equal(resynthWavemap.frames.every((frame) => frame.analysis && frame.analysis.peak > 0 && frame.analysis.rms > 0), true);
  assert.ok(resynthWavemap.frames.some((frame) => frame.analysis.dominantHarmonic >= 1), "expected resynthesis to persist dominant harmonic analysis");
  const resynthAnalysisSummary = synthStore.summarizeWavemapAnalysis(resynthWavemap);
  assert.equal(resynthAnalysisSummary.frameCount, 4);
  assert.equal(resynthAnalysisSummary.analyzedFrameCount, 4);
  assert.equal(resynthAnalysisSummary.sourceStartSample, 10);
  assert.equal(resynthAnalysisSummary.sourceEndSample, 4106);
  assert.ok(resynthAnalysisSummary.averageRms > 0, "expected wavemap analysis summary to average RMS");
  assert.ok(resynthAnalysisSummary.peak > 0, "expected wavemap analysis summary to expose peak");
  assert.ok(resynthAnalysisSummary.averageZeroCrossRate > 0, "expected wavemap analysis summary to expose zero-cross rate");
  assert.ok(resynthAnalysisSummary.averageSpectralCentroid > 0, "expected wavemap analysis summary to expose centroid");
  assert.ok(resynthAnalysisSummary.dominantHarmonic >= 1, "expected wavemap analysis summary to expose dominant harmonic");
  assert.ok(
    resynthWavemap.frames.some((frame) => Math.max(...frame.partials) > 0.9 && frame.partials.some((partial) => partial > 0.15)),
    "expected resynthesis to populate harmonic partial bins",
  );

  synthStore.useSynthStore.getState().resetDraft();
  synthStore.useSynthStore.getState().setWavemap(resynthWavemap);
  assert.deepEqual(
    synthStore.useSynthStore.getState().draft.metadata.wavemaps[resynthWavemap.id],
    synthStore.useSynthStore.getState().draft.metadata.customWavetables[resynthWavemap.id],
  );
  const flatWavemap = synthStore.normalizeSynthDraftPatch({
    metadata: {
      wavemaps: {
        "user.flat": {
          ...resynthWavemap,
          id: "user.flat",
          frames: resynthWavemap.frames.map((frame, index) => ({
            ...frame,
            id: `user.flat.frame.${index + 1}`,
            brightness: 0.4,
            even: 0.3,
            fold: 0.2,
            formant: 0.1,
            notch: 0.05,
            skew: 0,
            tilt: 0,
            focus: 0.35,
            phase: 0,
          })),
        },
      },
    },
  }).metadata.wavemaps["user.flat"];
  const normalizedFlat = synthStore.normalizeWavemapFrames(flatWavemap);
  assert.equal(normalizedFlat.source.kind, "generated");
  assert.equal(normalizedFlat.frames[0].position, 0);
  assert.equal(normalizedFlat.frames[3].position, 1);
  assert.ok(normalizedFlat.frames[3].brightness > normalizedFlat.frames[0].brightness, "expected normalized wavemap to add frame contrast");
  assert.ok(normalizedFlat.frames[3].fold > normalizedFlat.frames[0].fold, "expected normalized wavemap to spread fold values");
  assert.ok(normalizedFlat.frames[3].formant > normalizedFlat.frames[0].formant, "expected normalized wavemap to spread formant values");
  assert.ok(normalizedFlat.frames[3].notch > normalizedFlat.frames[0].notch, "expected normalized wavemap to spread notch values");
  assert.ok(normalizedFlat.frames[3].skew > normalizedFlat.frames[0].skew, "expected normalized wavemap to spread skew values");
  assert.ok(normalizedFlat.frames[3].tilt > normalizedFlat.frames[0].tilt, "expected normalized wavemap to spread tilt values");
  assert.ok(normalizedFlat.frames[3].focus > normalizedFlat.frames[0].focus, "expected normalized wavemap to spread focus values");
  const evolvedA = synthStore.evolveWavemapFrames(normalizedFlat, 12345, 0.5);
  const evolvedB = synthStore.evolveWavemapFrames(normalizedFlat, 12345, 0.5);
  const evolvedC = synthStore.evolveWavemapFrames(normalizedFlat, 54321, 0.5);
  assert.deepEqual(evolvedA.frames, evolvedB.frames);
  assert.notDeepEqual(evolvedA.frames, evolvedC.frames);
  assert.equal(evolvedA.frames.every((frame) =>
    frame.brightness >= 0 && frame.brightness <= 1
    && frame.even >= 0 && frame.even <= 1
    && frame.fold >= 0 && frame.fold <= 1
    && frame.formant >= 0 && frame.formant <= 1
    && frame.notch >= 0 && frame.notch <= 1
    && frame.skew >= -1 && frame.skew <= 1
    && frame.tilt >= -1 && frame.tilt <= 1
    && frame.focus >= 0 && frame.focus <= 1
    && frame.phase >= -1 && frame.phase <= 1
  ), true);

  const resynthDraft = synthStore.normalizeSynthDraftPatch({
    name: "Resynth Probe",
    parameters: {
      "osc.a.wavetable": "user.resynth.verify",
      "osc.a.position": 0.5,
      "osc.a.level": 0.86,
      "filter.cutoff": 12000,
      "amp.level": 0.75,
    },
    modulation: [],
    metadata: {
      tags: ["resynth"],
      wavemaps: { [resynthWavemap.id]: resynthWavemap },
    },
  });
  assert.deepEqual(resynthDraft.metadata.wavemaps[resynthWavemap.id], resynthDraft.metadata.customWavetables[resynthWavemap.id]);
  const resynthPatch = synthStore.synthDraftToInstrumentPatch(resynthDraft);
  assert.equal(resynthPatch.wavetable.customId, "user.resynth.verify");
  assert.equal(resynthPatch.synthPatch.metadata.wavemaps["user.resynth.verify"].source.label, "Verifier Audio");
  assert.equal(resynthPatch.synthPatch.metadata.wavemaps["user.resynth.verify"].source.sourceSampleCount, 4096);
  assert.equal(resynthPatch.synthPatch.metadata.wavemaps["user.resynth.verify"].frames[0].analysis.dominantHarmonic >= 1, true);
  const resynthPreview = synthStore.synthDraftToPreviewInstrument(resynthDraft);
  const resynthRendered = new Float32Array(16000);
  synthPreview.renderInstrumentSamples(resynthPreview, resynthRendered, 48000, synthPreview.previewFrequency(resynthPreview), "audio", true);
  let resynthEnergy = 0;
  for (const sample of resynthRendered) {
    assert.equal(Number.isFinite(sample), true);
    resynthEnergy += sample * sample;
  }
  assert.ok(Math.sqrt(resynthEnergy / resynthRendered.length) > 0.008, "expected resynthesized wavemap to render audible output");

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

  const unmorphedDraft = synthStore.normalizeSynthDraftPatch({
    ...customDraft,
    metadata: {
      ...customDraft.metadata,
      wavemaps: {
        "user.custom": {
          ...customDraft.metadata.wavemaps["user.custom"],
          morph: 0,
        },
      },
      customWavetables: {
        "user.custom": {
          ...customDraft.metadata.customWavetables["user.custom"],
          morph: 0,
        },
      },
    },
  });
  const unmorphedPreview = synthStore.synthDraftToPreviewInstrument(unmorphedDraft);
  const unmorphedSamples = new Float32Array(customSamples.length);
  synthPreview.renderInstrumentSamples(unmorphedPreview, unmorphedSamples, 48000, synthPreview.previewFrequency(unmorphedPreview), "audio", true);
  const morphDiff = customSamples.reduce((sum, sample, index) => sum + Math.abs(sample - unmorphedSamples[index]), 0) / customSamples.length;
  assert.ok(morphDiff > 0.0002, `expected wavemap morph to alter custom wavetable preview, got ${morphDiff}`);

  const anchoredFrames = customDraft.metadata.wavemaps["user.custom"].frames.map((frame, index) => ({
    ...frame,
    position: [0, 0.08, 0.92, 1][index],
  }));
  const anchoredDraft = synthStore.normalizeSynthDraftPatch({
    ...customDraft,
    metadata: {
      ...customDraft.metadata,
      wavemaps: {
        "user.custom": {
          ...customDraft.metadata.wavemaps["user.custom"],
          frames: anchoredFrames,
        },
      },
      customWavetables: {
        "user.custom": {
          ...customDraft.metadata.customWavetables["user.custom"],
          frames: anchoredFrames,
        },
      },
    },
  });
  const anchoredPreview = synthStore.synthDraftToPreviewInstrument(anchoredDraft);
  const anchoredSamples = new Float32Array(customSamples.length);
  synthPreview.renderInstrumentSamples(anchoredPreview, anchoredSamples, 48000, synthPreview.previewFrequency(anchoredPreview), "audio", true);
  const anchorDiff = customSamples.reduce((sum, sample, index) => sum + Math.abs(sample - anchoredSamples[index]), 0) / customSamples.length;
  assert.ok(anchorDiff > 0.0002, `expected frame scan anchors to alter custom wavetable preview, got ${anchorDiff}`);

  const unskewedDraft = synthStore.normalizeSynthDraftPatch({
    ...customDraft,
    metadata: {
      ...customDraft.metadata,
      wavemaps: {
        "user.custom": {
          ...customDraft.metadata.wavemaps["user.custom"],
          frames: customDraft.metadata.wavemaps["user.custom"].frames.map((frame) => ({ ...frame, skew: 0 })),
        },
      },
    },
  });
  const unskewedPreview = synthStore.synthDraftToPreviewInstrument(unskewedDraft);
  const unskewedSamples = new Float32Array(customSamples.length);
  synthPreview.renderInstrumentSamples(unskewedPreview, unskewedSamples, 48000, synthPreview.previewFrequency(unskewedPreview), "audio", true);
  const skewDiff = customSamples.reduce((sum, sample, index) => sum + Math.abs(sample - unskewedSamples[index]), 0) / customSamples.length;
  assert.ok(skewDiff > 0.0004, `expected skew to alter custom wavetable preview, got ${skewDiff}`);

  const untiltedDraft = synthStore.normalizeSynthDraftPatch({
    ...customDraft,
    metadata: {
      ...customDraft.metadata,
      wavemaps: {
        "user.custom": {
          ...customDraft.metadata.wavemaps["user.custom"],
          frames: customDraft.metadata.wavemaps["user.custom"].frames.map((frame) => ({ ...frame, tilt: 0 })),
        },
      },
    },
  });
  const untiltedPreview = synthStore.synthDraftToPreviewInstrument(untiltedDraft);
  const untiltedSamples = new Float32Array(customSamples.length);
  synthPreview.renderInstrumentSamples(untiltedPreview, untiltedSamples, 48000, synthPreview.previewFrequency(untiltedPreview), "audio", true);
  const tiltDiff = customSamples.reduce((sum, sample, index) => sum + Math.abs(sample - untiltedSamples[index]), 0) / customSamples.length;
  assert.ok(tiltDiff > 0.0004, `expected tilt to alter custom wavetable preview, got ${tiltDiff}`);

  const unfocusedDraft = synthStore.normalizeSynthDraftPatch({
    ...customDraft,
    metadata: {
      ...customDraft.metadata,
      wavemaps: {
        "user.custom": {
          ...customDraft.metadata.wavemaps["user.custom"],
          frames: customDraft.metadata.wavemaps["user.custom"].frames.map((frame) => ({ ...frame, focus: 0 })),
        },
      },
    },
  });
  const unfocusedPreview = synthStore.synthDraftToPreviewInstrument(unfocusedDraft);
  const unfocusedSamples = new Float32Array(customSamples.length);
  synthPreview.renderInstrumentSamples(unfocusedPreview, unfocusedSamples, 48000, synthPreview.previewFrequency(unfocusedPreview), "audio", true);
  const focusDiff = customSamples.reduce((sum, sample, index) => sum + Math.abs(sample - unfocusedSamples[index]), 0) / customSamples.length;
  assert.ok(focusDiff > 0.0004, `expected focus to alter custom wavetable preview, got ${focusDiff}`);

  const unformantedDraft = synthStore.normalizeSynthDraftPatch({
    ...customDraft,
    metadata: {
      ...customDraft.metadata,
      wavemaps: {
        "user.custom": {
          ...customDraft.metadata.wavemaps["user.custom"],
          frames: customDraft.metadata.wavemaps["user.custom"].frames.map((frame) => ({ ...frame, formant: 0 })),
        },
      },
    },
  });
  const unformantedPreview = synthStore.synthDraftToPreviewInstrument(unformantedDraft);
  const unformantedSamples = new Float32Array(customSamples.length);
  synthPreview.renderInstrumentSamples(unformantedPreview, unformantedSamples, 48000, synthPreview.previewFrequency(unformantedPreview), "audio", true);
  const formantDiff = customSamples.reduce((sum, sample, index) => sum + Math.abs(sample - unformantedSamples[index]), 0) / customSamples.length;
  assert.ok(formantDiff > 0.0004, `expected formant to alter custom wavetable preview, got ${formantDiff}`);

  const unnotchedDraft = synthStore.normalizeSynthDraftPatch({
    ...customDraft,
    metadata: {
      ...customDraft.metadata,
      wavemaps: {
        "user.custom": {
          ...customDraft.metadata.wavemaps["user.custom"],
          frames: customDraft.metadata.wavemaps["user.custom"].frames.map((frame) => ({ ...frame, notch: 0 })),
        },
      },
    },
  });
  const unnotchedPreview = synthStore.synthDraftToPreviewInstrument(unnotchedDraft);
  const unnotchedSamples = new Float32Array(customSamples.length);
  synthPreview.renderInstrumentSamples(unnotchedPreview, unnotchedSamples, 48000, synthPreview.previewFrequency(unnotchedPreview), "audio", true);
  const notchDiff = customSamples.reduce((sum, sample, index) => sum + Math.abs(sample - unnotchedSamples[index]), 0) / customSamples.length;
  assert.ok(notchDiff > 0.0004, `expected notch to alter custom wavetable preview, got ${notchDiff}`);

  const undrawnDraft = synthStore.normalizeSynthDraftPatch({
    ...customDraft,
    metadata: {
      ...customDraft.metadata,
      wavemaps: {
        "user.custom": {
          ...customDraft.metadata.wavemaps["user.custom"],
          frames: customDraft.metadata.wavemaps["user.custom"].frames.map((frame) => ({ ...frame, partials: [] })),
        },
      },
    },
  });
  const undrawnPreview = synthStore.synthDraftToPreviewInstrument(undrawnDraft);
  const undrawnSamples = new Float32Array(customSamples.length);
  synthPreview.renderInstrumentSamples(undrawnPreview, undrawnSamples, 48000, synthPreview.previewFrequency(undrawnPreview), "audio", true);
  const drawnDiff = customSamples.reduce((sum, sample, index) => sum + Math.abs(sample - undrawnSamples[index]), 0) / customSamples.length;
  assert.ok(drawnDiff > 0.0004, `expected drawn partials to alter custom wavetable preview, got ${drawnDiff}`);

  const smoothCustomDraft = synthStore.normalizeSynthDraftPatch({
    ...customDraft,
    metadata: {
      ...customDraft.metadata,
      wavemaps: {
        "user.custom": {
          ...customDraft.metadata.wavemaps["user.custom"],
          interpolation: "smooth",
        },
      },
    },
  });
  const smoothCustomPreview = synthStore.synthDraftToPreviewInstrument(smoothCustomDraft);
  const smoothCustomSamples = new Float32Array(customSamples.length);
  synthPreview.renderInstrumentSamples(smoothCustomPreview, smoothCustomSamples, 48000, synthPreview.previewFrequency(smoothCustomPreview), "audio", true);
  const interpolationDiff = customSamples.reduce((sum, sample, index) => sum + Math.abs(sample - smoothCustomSamples[index]), 0) / customSamples.length;
  assert.ok(interpolationDiff > 0.0004, `expected smooth wavemap interpolation to alter custom wavetable preview, got ${interpolationDiff}`);

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
      "lfo.1.sync": false,
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

  const macroNoteAutomationDraft = synthStore.normalizeSynthDraftPatch({
    name: "Macro Note Automation Probe",
    parameters: {
      "osc.a.enabled": true,
      "osc.a.wavetable": "basic.sine",
      "osc.a.level": 0.45,
      "amp.level": 0.18,
      "macro.1": 0,
    },
    modulation: [
      { id: "macro_note_level", source: "macro.1", target: "amp.level", amount: 0.72, bipolar: false, enabled: true },
    ],
  });
  const macroNoteAutomationPreview = synthStore.synthDraftToPreviewInstrument(macroNoteAutomationDraft);
  const macroBaseOffsets = synthPreview.modulationAtTime(macroNoteAutomationPreview, 0.25, 1).targetOffsets;
  const macroAutomatedOffsets = synthPreview.modulationAtTime(macroNoteAutomationPreview, 0.25, 1, 120, 1, 0.5, 0, { "macro.1": 1 }).targetOffsets;
  assert.ok(Math.abs((macroBaseOffsets["amp.level"] ?? 0)) < 0.000001, "base macro should not offset amp when macro value is zero");
  assert.ok((macroAutomatedOffsets["amp.level"] ?? 0) > 0.7, "macro note automation should drive macro-routed preview targets");
  const macroLivePreviewDraft = synthStore.normalizeSynthDraftPatch({
    ...macroNoteAutomationDraft,
    parameters: {
      ...macroNoteAutomationDraft.parameters,
      "macro.1": 1,
    },
  });
  const macroLivePreview = synthStore.synthDraftToPreviewInstrument(macroLivePreviewDraft);
  const macroLiveOffsets = synthPreview.modulationAtTime(macroLivePreview, 0.25, 1).targetOffsets;
  assert.ok(Math.abs((macroLivePreview.ampLevel ?? 0) - 0.18) < 0.000001, "macro routes should not be baked into browser preview base amp level");
  assert.ok(Math.abs((macroLiveOffsets["amp.level"] ?? 0) - 0.72) < 0.000001, "macro routes should remain live dynamic preview offsets");
  const macroBaseSamples = new Float32Array(12000);
  const macroAutomatedSamples = new Float32Array(12000);
  synthPreview.renderInstrumentSamples(macroNoteAutomationPreview, macroBaseSamples, 48000, synthPreview.previewFrequency(macroNoteAutomationPreview), "audio", true);
  synthPreview.renderInstrumentSamples(
    macroNoteAutomationPreview,
    macroAutomatedSamples,
    48000,
    synthPreview.previewFrequency(macroNoteAutomationPreview),
    "audio",
    true,
    undefined,
    undefined,
    [{ target: "macro.1", points: [{ timeS: 0, value: 1 }, { timeS: 0.25, value: 1 }] }],
  );
  assert.ok(bufferRms(macroAutomatedSamples) > bufferRms(macroBaseSamples) * 1.8, "macro note automation should audibly affect browser preview renders");
  const macroLinearRampSamples = new Float32Array(12000);
  const macroHoldRampSamples = new Float32Array(12000);
  synthPreview.renderInstrumentSamples(
    macroNoteAutomationPreview,
    macroLinearRampSamples,
    48000,
    synthPreview.previewFrequency(macroNoteAutomationPreview),
    "audio",
    true,
    undefined,
    undefined,
    [{ target: "macro.1", points: [{ timeS: 0, value: 0, curve: "linear" }, { timeS: 0.25, value: 1 }] }],
  );
  synthPreview.renderInstrumentSamples(
    macroNoteAutomationPreview,
    macroHoldRampSamples,
    48000,
    synthPreview.previewFrequency(macroNoteAutomationPreview),
    "audio",
    true,
    undefined,
    undefined,
    [{ target: "macro.1", points: [{ timeS: 0, value: 0, curve: "hold" }, { timeS: 0.25, value: 1 }] }],
  );
  assert.ok(
    bufferRms(macroLinearRampSamples) > bufferRms(macroHoldRampSamples) * 1.8,
    "browser preview should honor note automation curve metadata",
  );

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

  const syncedLfoDraft = synthStore.normalizeSynthDraftPatch({
    name: "Synced LFO Probe",
    parameters: {
      "osc.a.enabled": true,
      "osc.a.wavetable": "basic.sine",
      "osc.a.level": 0.6,
      "osc.b.enabled": true,
      "osc.b.wavetable": "basic.sine",
      "osc.b.level": 0.6,
      "lfo.1.enabled": true,
      "lfo.1.sync": true,
      "lfo.1.syncedRate": "1/4",
      "lfo.1.rate": 2,
      "lfo.1.shape": "sine",
    },
    modulation: [
      { id: "sync_position", source: "lfo.1", target: "osc.b.position", amount: 0.5, bipolar: true, enabled: true },
    ],
  });
  const syncedPreview = synthStore.synthDraftToPreviewInstrument(syncedLfoDraft);
  const fastTempo = synthPreview.modulationAtTime(syncedPreview, 0.125, 1, 120).targetOffsets["osc.b.position"];
  const slowTempo = synthPreview.modulationAtTime(syncedPreview, 0.125, 1, 60).targetOffsets["osc.b.position"];
  assert.ok(Math.abs(fastTempo - slowTempo) > 0.05, "tempo-synced LFO should change modulation phase when BPM changes");
  const absolutePreview = {
    ...syncedPreview,
    lfoSync: false,
    synthPatch: {
      ...syncedPreview.synthPatch,
      parameters: { ...syncedPreview.synthPatch.parameters, "lfo.1.sync": false },
    },
  };
  const absoluteFast = synthPreview.modulationAtTime(absolutePreview, 0.125, 1, 120).targetOffsets["osc.b.position"];
  const absoluteSlow = synthPreview.modulationAtTime(absolutePreview, 0.125, 1, 60).targetOffsets["osc.b.position"];
  assert.ok(Math.abs(absoluteFast - absoluteSlow) < 0.000001, "absolute-rate LFO should not change modulation phase when BPM changes");

  const hardSquareDraft = synthStore.normalizeSynthDraftPatch({
    name: "LFO Smoothing Probe",
    parameters: {
      "osc.a.enabled": true,
      "osc.a.wavetable": "basic.sine",
      "osc.a.level": 0.5,
      "lfo.1.enabled": true,
      "lfo.1.sync": false,
      "lfo.1.rate": 1,
      "lfo.1.shape": "square",
      "lfo.1.smoothing": 0,
    },
    modulation: [
      { id: "square_level", source: "lfo.1", target: "osc.a.level", amount: 0.5, bipolar: true, enabled: true },
    ],
  });
  const smoothSquareDraft = synthStore.normalizeSynthDraftPatch({
    ...hardSquareDraft,
    parameters: { ...hardSquareDraft.parameters, "lfo.1.smoothing": 1 },
  });
  const hardSquare = synthStore.synthDraftToPreviewInstrument(hardSquareDraft);
  const smoothSquare = synthStore.synthDraftToPreviewInstrument(smoothSquareDraft);
  const hardLevel = synthPreview.modulationAtTime(hardSquare, 0, 1, 120).targetOffsets["osc.a.level"];
  const smoothLevel = synthPreview.modulationAtTime(smoothSquare, 0, 1, 120).targetOffsets["osc.a.level"];
  assert.ok(Math.abs(hardLevel - 0.5) < 0.000001, "unsmoothed square LFO should keep hard high state");
  assert.ok(Math.abs(smoothLevel) < 0.000001, "fully smoothed square LFO should blend to sine at quarter-cycle zero crossing");

  const fixedPhaseDraft = synthStore.normalizeSynthDraftPatch({
    name: "LFO Random Probe",
    parameters: {
      "osc.a.enabled": true,
      "osc.a.wavetable": "basic.sine",
      "osc.a.level": 0.5,
      "lfo.1.enabled": true,
      "lfo.1.sync": false,
      "lfo.1.rate": 1,
      "lfo.1.shape": "sine",
      "lfo.1.randomPhase": 0,
    },
    modulation: [
      { id: "random_level", source: "lfo.1", target: "osc.a.level", amount: 0.5, bipolar: true, enabled: true },
    ],
  });
  const randomizedPhaseDraft = synthStore.normalizeSynthDraftPatch({
    ...fixedPhaseDraft,
    parameters: { ...fixedPhaseDraft.parameters, "lfo.1.randomPhase": 1 },
  });
  const fixedPhase = synthStore.synthDraftToPreviewInstrument(fixedPhaseDraft);
  const randomizedPhase = synthStore.synthDraftToPreviewInstrument(randomizedPhaseDraft);
  const fixedLevel = synthPreview.modulationAtTime(fixedPhase, 0, 1, 120).targetOffsets["osc.a.level"];
  const randomizedLevel = synthPreview.modulationAtTime(randomizedPhase, 0, 1, 120).targetOffsets["osc.a.level"];
  assert.ok(Math.abs(fixedLevel) < 0.000001, "zero random phase should start sine LFO at fixed phase");
  assert.ok(Math.abs(randomizedLevel - fixedLevel) > 0.01, "random phase amount should offset preview LFO phase deterministically");

  globalThis.fetch = async () => {
    throw new Error("force local instrument generation fallback");
  };
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  };
  const generated = await aiService.LocalAiService.generateInstrument({
    prompt: "wide evolving glass bass pad with gentle motion",
    targetKind: "wavetable",
    variationSeed: 4242,
    instruments: [],
    audioFiles: [],
    current: {
      id: "generated-current",
      name: "Generated Current",
      kind: "wavetable",
      envelope: { attackMs: 5, decayMs: 100, sustain: 0.7, releaseMs: 200 },
      knobs: { cutoff: 0.6, resonance: 0.2, drive: 0.1, color: 0.5 },
      filterType: "lowpass",
      waveform: "wavetable",
      detuneCents: 0,
      octave: 0,
      subOscLevel: 0,
      glideMs: 0,
      ampLevel: 1,
      ampPan: 0,
      lfoWaveform: "sine",
      lfoRateHz: 4,
      lfoDepth: 0,
      lfoSync: false,
      lfoRetrigger: true,
      lfoPositionBipolar: true,
      lfoPitchBipolar: true,
      lfoFilterBipolar: true,
      lfoToPitch: 0,
      lfoToFilter: 0,
      envToFilter: 0,
      sampleIds: [],
      userCreated: true,
    },
  });
  assert.equal(generated.source, "local");
  assert.equal(generated.patch.kind, "wavetable");
  assert.equal(generated.patch.waveform, "wavetable");
  assert.ok(generated.patch.aether?.oscA.enabled, "generated Aether patch should enable oscillator A");
  assert.ok(generated.patch.synthPatch, "generated Aether patch should include canonical synthPatch");
  assert.deepEqual(
    synthStore.normalizeSynthDraftPatch(JSON.parse(JSON.stringify(generated.patch.synthPatch))),
    generated.patch.synthPatch,
  );
  const generatedPreview = synthStore.synthDraftToPreviewInstrument(generated.patch.synthPatch);
  const generatedSamples = new Float32Array(16000);
  synthPreview.renderInstrumentSamples(generatedPreview, generatedSamples, 48000, synthPreview.previewFrequency(generatedPreview), "audio", true);
  let generatedEnergy = 0;
  let generatedPeak = 0;
  for (const sample of generatedSamples) {
    assert.equal(Number.isFinite(sample), true);
    generatedEnergy += sample * sample;
    generatedPeak = Math.max(generatedPeak, Math.abs(sample));
  }
  assert.ok(Math.sqrt(generatedEnergy / generatedSamples.length) > 0.005, "expected generated Aether patch to be audible");
  assert.ok(generatedPeak > 0.02, "expected generated Aether patch to have a visible peak");

  const generatedVariant = await aiService.LocalAiService.generateInstrument({
    prompt: "wide evolving glass bass pad with gentle motion",
    targetKind: "wavetable",
    variationSeed: 9876,
    instruments: [],
    audioFiles: [],
    current: {
      id: "generated-current",
      name: "Generated Current",
      kind: "wavetable",
      envelope: { attackMs: 5, decayMs: 100, sustain: 0.7, releaseMs: 200 },
      knobs: { cutoff: 0.6, resonance: 0.2, drive: 0.1, color: 0.5 },
      filterType: "lowpass",
      waveform: "wavetable",
      detuneCents: 0,
      octave: 0,
      subOscLevel: 0,
      glideMs: 0,
      ampLevel: 1,
      ampPan: 0,
      lfoWaveform: "sine",
      lfoRateHz: 4,
      lfoDepth: 0,
      lfoSync: false,
      lfoRetrigger: true,
      lfoPositionBipolar: true,
      lfoPitchBipolar: true,
      lfoFilterBipolar: true,
      lfoToPitch: 0,
      lfoToFilter: 0,
      envToFilter: 0,
      sampleIds: [],
      userCreated: true,
    },
  });
  assert.equal(generatedVariant.source, "local");
  assert.notDeepEqual(generatedVariant.patch.aether, generated.patch.aether, "same prompt with different seeds should change oscillator architecture");
  assert.notDeepEqual(generatedVariant.patch.envelope, generated.patch.envelope, "same prompt with different seeds should change envelope contour");

  const melody = await aiService.LocalAiService.generatePattern({ lengthBeats: 8, role: "melody", key: "C minor", style: "main melody", variationSeed: 101 });
  const bass = await aiService.LocalAiService.generatePattern({ lengthBeats: 8, role: "bass", key: "C minor", style: "bassline", variationSeed: 102 });
  const chords = await aiService.LocalAiService.generatePattern({ lengthBeats: 8, role: "chords", key: "C minor", style: "chorus progression", variationSeed: 103 });
  assertMidiPart(melody, 8, "melody");
  assertMidiPart(bass, 8, "bass");
  assertMidiPart(chords, 8, "chords");
  assert.equal(new Set(bass.map((note) => note.pitch)).size >= 2, true, "bassline should follow a progression, not one repeated note");
  assert.equal(chords.length >= 6, true, "chord generation should create a compact chord progression");

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

function assertMidiPart(notes, lengthBeats, label) {
  assert.equal(notes.length > 0, true, `${label} should generate notes`);
  for (const note of notes) {
    assert.equal(Number.isFinite(note.pitch), true, `${label} pitch should be finite`);
    assert.equal(note.pitch >= 0 && note.pitch <= 127, true, `${label} pitch should stay in MIDI range`);
    assert.equal(note.velocity >= 1 && note.velocity <= 127, true, `${label} velocity should stay in MIDI range`);
    assert.equal(note.startBeat >= 0 && note.startBeat < lengthBeats, true, `${label} note should start inside loop`);
    assert.equal(note.startBeat + note.lengthBeats <= lengthBeats + 0.0001, true, `${label} note should end inside loop`);
  }
}

function estimateFrequencyFromZeroCrossings(samples, sampleRate, startSample = 0, endSample = samples.length) {
  let crossings = 0;
  let first = -1;
  let last = -1;
  const start = Math.max(0, Math.min(samples.length - 1, startSample + Math.floor(sampleRate * 0.005)));
  const end = Math.max(start + 1, Math.min(samples.length, endSample));
  for (let i = start + 1; i < end; i += 1) {
    if (samples[i - 1] <= 0 && samples[i] > 0) {
      if (first < 0) first = i;
      last = i;
      crossings += 1;
    }
  }
  if (crossings < 2 || last <= first) return 0;
  return ((crossings - 1) * sampleRate) / (last - first);
}
