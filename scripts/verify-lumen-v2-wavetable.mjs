#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const bundleDir = join(tmpdir(), `beat-lumen-v2-wavetable-${Date.now()}`);
const slots = ["a", "b", "c"];
const sampleRates = [44100, 48000, 96000];
const frequency = 220;

function meanAbsoluteDelta(a, b) {
  assert.equal(a.length, b.length);
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += Math.abs(a[index] - b[index]);
  return sum / a.length;
}

function stereoDelta(a, b) {
  return (meanAbsoluteDelta(a.left, b.left) + meanAbsoluteDelta(a.right, b.right)) * 0.5;
}

function stereoMetrics(render) {
  let sumSquares = 0;
  let peak = 0;
  let maximumStep = 0;
  for (let index = 0; index < render.left.length; index += 1) {
    const left = render.left[index];
    const right = render.right[index];
    assert.ok(Number.isFinite(left) && Number.isFinite(right), `non-finite output at sample ${index}`);
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
    sumSquares += left * left + right * right;
    if (index > 0) {
      maximumStep = Math.max(
        maximumStep,
        Math.abs(left - render.left[index - 1]),
        Math.abs(right - render.right[index - 1]),
      );
    }
  }
  return {
    rms: Math.sqrt(sumSquares / Math.max(1, render.left.length * 2)),
    peak,
    maximumStep,
  };
}

function estimateFrequency(samples, sampleRate, expected) {
  const start = Math.floor(samples.length * 0.2);
  let bestFrequency = expected;
  let bestPower = -1;
  for (let candidate = expected - 1; candidate <= expected + 1.0001; candidate += 0.01) {
    const delta = Math.PI * 2 * candidate / sampleRate;
    let sine = 0;
    let cosine = 0;
    for (let index = start; index < samples.length; index += 1) {
      sine += samples[index] * Math.sin(delta * index);
      cosine += samples[index] * Math.cos(delta * index);
    }
    const power = sine * sine + cosine * cosine;
    if (power > bestPower) {
      bestPower = power;
      bestFrequency = candidate;
    }
  }
  return bestFrequency;
}

function centsBetween(actual, expected) {
  return 1200 * Math.log2(actual / expected);
}

function parametersForSlots(overrides = {}) {
  return {
    "osc.a.enabled": true,
    "osc.a.wavetable": "basic.saw",
    "osc.a.position": 0.14,
    "osc.a.warp": 0.18,
    "osc.a.warpMode": "shape",
    "osc.a.phaseMode": "retrigger",
    "osc.a.phase": 0.11,
    "osc.a.randomPhase": 0,
    "osc.a.unison.voices": 1,
    "osc.a.unison.detune": 0.12,
    "osc.a.unison.spread": 0.2,
    "osc.a.level": 0.38,
    "osc.a.pan": -0.35,
    "osc.a.route": "direct",
    "osc.b.enabled": true,
    "osc.b.wavetable": "basic.square",
    "osc.b.position": 0.53,
    "osc.b.warp": 0.37,
    "osc.b.warpMode": "pinch",
    "osc.b.phaseMode": "retrigger",
    "osc.b.phase": 0.29,
    "osc.b.randomPhase": 0,
    "osc.b.unison.voices": 2,
    "osc.b.unison.detune": 0.17,
    "osc.b.unison.spread": 0.55,
    "osc.b.level": 0.31,
    "osc.b.pan": 0.15,
    "osc.b.route": "direct",
    "osc.c.enabled": true,
    "osc.c.wavetable": "basic.triangle",
    "osc.c.position": 0.81,
    "osc.c.warp": 0.62,
    "osc.c.warpMode": "mirror",
    "osc.c.phaseMode": "retrigger",
    "osc.c.phase": 0.47,
    "osc.c.randomPhase": 0,
    "osc.c.unison.voices": 3,
    "osc.c.unison.detune": 0.23,
    "osc.c.unison.spread": 0.78,
    "osc.c.level": 0.34,
    "osc.c.pan": 0.48,
    "osc.c.route": "direct",
    "filter.enabled": false,
    "filter.2.enabled": false,
    "aether.sub.enabled": false,
    "aether.noise.enabled": false,
    "aether.sample.1.enabled": false,
    "aether.granular.2.enabled": false,
    "aether.runtimeWarp": 0,
    "aether.runtimeWarp2": 0,
    "aether.interaction.mode": "off",
    "aether.interaction.amount": 0,
    "amp.level": 0.72,
    "amp.pan": 0,
    ...overrides,
  };
}

mkdirSync(bundleDir, { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(esbuild, [
    join(repoRoot, "frontend/src/state/synthStore.ts"),
    join(repoRoot, "frontend/src/audio/synthPreview.ts"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outdir=${bundleDir}`,
  ], { stdio: "pipe" });

  const store = await import(pathToFileURL(join(bundleDir, "state/synthStore.js")));
  const preview = await import(pathToFileURL(join(bundleDir, "audio/synthPreview.js")));

  function makeDraft(overrides = {}) {
    const initial = store.createDefaultLumenDraft();
    return store.normalizeSynthDraftPatch({
      ...initial,
      name: "Lumen V2 Wavetable Evidence",
      parameters: {
        ...initial.parameters,
        ...parametersForSlots(overrides),
      },
      effects: { filters: [] },
    });
  }

  function isolatedDraft(source, overrides = {}) {
    return makeDraft({
      ...Object.fromEntries(slots.map((slot) => [`osc.${slot}.enabled`, slot === source])),
      ...overrides,
    });
  }

  function renderDraft(draft, sampleRate = 48000, durationSeconds = 0.2, automation) {
    const length = Math.round(sampleRate * durationSeconds);
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    preview.renderInstrumentStereoSamples(
      store.synthDraftToPreviewInstrument(draft),
      left,
      right,
      sampleRate,
      frequency,
      "visual",
      false,
      undefined,
      undefined,
      automation,
      120,
      100,
    );
    return { left, right };
  }

  const threeSlotDraft = makeDraft();
  assert.equal(threeSlotDraft.instrumentType, "lumen-hybrid-synth");
  assert.equal(threeSlotDraft.namespace, "lumen");
  assert.deepEqual(threeSlotDraft.metadata.oscillators.map(({ id }) => id), slots);
  assert.deepEqual(threeSlotDraft.metadata.lumenSourceRack?.slots.map(({ id, mode }) => ({ id, mode })), [
    { id: "a", mode: "wavetable" },
    { id: "b", mode: "wavetable" },
    { id: "c", mode: "wavetable" },
  ]);

  const isolated = Object.fromEntries(slots.map((slot) => [slot, renderDraft(isolatedDraft(slot))]));
  for (const slot of slots) {
    const metrics = stereoMetrics(isolated[slot]);
    assert.ok(metrics.rms > 0.02, `Source ${slot.toUpperCase()} must be independently audible`);
    assert.ok(metrics.peak <= 1, `Source ${slot.toUpperCase()} must remain bounded`);
  }
  assert.ok(stereoDelta(isolated.a, isolated.b) > 0.02, "Sources A and B must retain distinct wavetable behavior");
  assert.ok(stereoDelta(isolated.a, isolated.c) > 0.02, "Sources A and C must retain distinct wavetable behavior");
  assert.ok(stereoDelta(isolated.b, isolated.c) > 0.02, "Sources B and C must retain distinct wavetable behavior");
  const combined = renderDraft(threeSlotDraft);
  assert.ok(stereoMetrics(combined).rms > 0.02, "The simultaneous A/B/C rack must be audible");
  for (const slot of slots)
    assert.ok(stereoDelta(combined, isolated[slot]) > 0.01, `The simultaneous rack must include more than Source ${slot.toUpperCase()}`);

  const phaseEvidence = {};
  for (const slot of slots) {
    const retrigger = isolatedDraft(slot, {
      [`osc.${slot}.phaseMode`]: "retrigger",
      [`osc.${slot}.phase`]: 0.17,
      [`osc.${slot}.randomPhase`]: 0.42,
    });
    const retriggerA = renderDraft(retrigger, 48000, 0.1);
    const retriggerB = renderDraft(retrigger, 48000, 0.1);
    assert.deepEqual(retriggerB.left, retriggerA.left, `Source ${slot.toUpperCase()} retrigger must restart deterministically`);
    assert.deepEqual(retriggerB.right, retriggerA.right, `Source ${slot.toUpperCase()} stereo retrigger must restart deterministically`);

    const shifted = renderDraft(isolatedDraft(slot, {
      [`osc.${slot}.phaseMode`]: "retrigger",
      [`osc.${slot}.phase`]: 0.61,
      [`osc.${slot}.randomPhase`]: 0,
    }), 48000, 0.1);
    const shiftedDelta = stereoDelta(retriggerA, shifted);
    assert.ok(shiftedDelta > 0.01, `Source ${slot.toUpperCase()} phase must alter its retriggered waveform`);

    const memoryA = renderDraft(isolatedDraft(slot, {
      [`osc.${slot}.phaseMode`]: "memory",
      [`osc.${slot}.phase`]: 0.17,
      [`osc.${slot}.randomPhase`]: 0.9,
    }), 48000, 0.1);
    const memoryB = renderDraft(isolatedDraft(slot, {
      [`osc.${slot}.phaseMode`]: "memory",
      [`osc.${slot}.phase`]: 0.83,
      [`osc.${slot}.randomPhase`]: 0,
    }), 48000, 0.1);
    assert.deepEqual(memoryB.left, memoryA.left, `Source ${slot.toUpperCase()} memory mode must not reapply retrigger phase`);
    assert.deepEqual(memoryB.right, memoryA.right, `Source ${slot.toUpperCase()} stereo memory mode must not reapply retrigger phase`);
    phaseEvidence[slot] = { shiftedDelta };
  }

  const unisonEvidence = {};
  for (const slot of slots) {
    const single = renderDraft(isolatedDraft(slot, {
      [`osc.${slot}.unison.voices`]: 1,
      [`osc.${slot}.unison.detune`]: 0,
      [`osc.${slot}.unison.spread`]: 0,
      [`osc.${slot}.pan`]: 0,
    }));
    const stacked = renderDraft(isolatedDraft(slot, {
      [`osc.${slot}.unison.voices`]: 5,
      [`osc.${slot}.unison.detune`]: 0.27,
      [`osc.${slot}.unison.spread`]: 0.88,
      [`osc.${slot}.pan`]: 0,
    }));
    const stackDelta = stereoDelta(single, stacked);
    const stereoWidth = meanAbsoluteDelta(stacked.left, stacked.right);
    assert.ok(stackDelta > 0.01, `Source ${slot.toUpperCase()} unison must alter the source render`);
    assert.ok(stereoWidth > 0.001, `Source ${slot.toUpperCase()} unison spread must produce stereo width`);
    unisonEvidence[slot] = { stackDelta, stereoWidth };
  }

  const warpEvidence = {};
  const warpModes = [
    "fold",
    "pinch",
    "mirror",
    "harmonic-shift",
    "harmonic-stretch",
    "spectral-smear",
    "spectral-skew",
    "spectral-filter",
  ];
  for (const slot of slots) {
    const dry = renderDraft(isolatedDraft(slot, {
      [`osc.${slot}.warp`]: 0,
      [`osc.${slot}.warpMode`]: "shape",
    }));
    const modeRenders = {};
    for (const mode of warpModes) {
      const neutral = renderDraft(isolatedDraft(slot, {
        [`osc.${slot}.warp`]: 0,
        [`osc.${slot}.warpMode`]: mode,
      }));
      assert.deepEqual(neutral.left, dry.left, `Source ${slot.toUpperCase()} ${mode} must be sample-exact at zero amount`);
      assert.deepEqual(neutral.right, dry.right, `Source ${slot.toUpperCase()} stereo ${mode} must be sample-exact at zero amount`);
      modeRenders[mode] = renderDraft(isolatedDraft(slot, {
        [`osc.${slot}.warp`]: 0.82,
        [`osc.${slot}.warpMode`]: mode,
      }));
      assert.ok(stereoDelta(dry, modeRenders[mode]) > 0.005, `Source ${slot.toUpperCase()} ${mode} warp must alter the source render`);
    }
    assert.ok(stereoDelta(modeRenders.fold, modeRenders.pinch) > 0.002, `Source ${slot.toUpperCase()} fold and pinch must remain distinct`);
    assert.ok(stereoDelta(modeRenders.pinch, modeRenders.mirror) > 0.002, `Source ${slot.toUpperCase()} pinch and mirror must remain distinct`);
    for (let index = 1; index < warpModes.length; index += 1)
      assert.ok(
        stereoDelta(modeRenders[warpModes[index - 1]], modeRenders[warpModes[index]]) > 0.001,
        `Source ${slot.toUpperCase()} ${warpModes[index - 1]} and ${warpModes[index]} must remain distinct`,
      );
    warpEvidence[slot] = Object.fromEntries(warpModes.map((mode) => [mode, stereoDelta(dry, modeRenders[mode])]));
  }

  const interactionBase = {
    "osc.a.enabled": true,
    "osc.b.enabled": true,
    "osc.c.enabled": false,
    "osc.a.pan": 0,
    "osc.b.pan": 0,
    "aether.interaction.amount": 0.72,
  };
  const interactionOff = renderDraft(makeDraft({ ...interactionBase, "aether.interaction.mode": "off" }));
  const interactionAm = renderDraft(makeDraft({ ...interactionBase, "aether.interaction.mode": "am" }));
  const interactionRing = renderDraft(makeDraft({ ...interactionBase, "aether.interaction.mode": "ring" }));
  assert.ok(stereoDelta(interactionOff, interactionAm) > 0.005, "Bounded A-by-B AM must alter the rack render");
  assert.ok(stereoDelta(interactionOff, interactionRing) > 0.005, "Bounded A-by-B ring modulation must alter the rack render");
  assert.ok(stereoDelta(interactionAm, interactionRing) > 0.002, "AM and ring interaction modes must remain distinct");
  const interactionWithC = renderDraft(makeDraft({
    ...interactionBase,
    "osc.c.enabled": true,
    "aether.interaction.mode": "ring",
  }));
  assert.ok(stereoDelta(interactionRing, interactionWithC) > 0.005, "Source C must remain audible alongside the bounded A-by-B interaction");

  const recalledDraft = store.normalizeSynthDraftPatch(
    store.synthDraftFromInstrument(store.synthDraftToPreviewInstrument(threeSlotDraft)),
  );
  assert.equal(recalledDraft.schemaVersion, store.LUMEN_PATCH_SCHEMA_VERSION);
  assert.equal(recalledDraft.instrumentType, "lumen-hybrid-synth");
  assert.equal(recalledDraft.namespace, "lumen");
  for (const slot of slots) {
    for (const suffix of ["enabled", "wavetable", "position", "warp", "warpMode", "phaseMode", "phase", "randomPhase", "unison.voices", "unison.detune", "unison.spread", "level", "pan", "route"]) {
      const id = `osc.${slot}.${suffix}`;
      assert.equal(recalledDraft.parameters[id], threeSlotDraft.parameters[id], `recall changed ${id}`);
    }
  }
  const recalled = renderDraft(recalledDraft);
  assert.deepEqual(recalled.left, combined.left, "Lumen browser recall must reproduce the A/B/C left render exactly");
  assert.deepEqual(recalled.right, combined.right, "Lumen browser recall must reproduce the A/B/C right render exactly");

  const rateEvidence = [];
  for (const sampleRate of sampleRates) {
    const sine = isolatedDraft("a", {
      "osc.a.wavetable": "basic.sine",
      "osc.a.position": 0,
      "osc.a.warp": 0,
      "osc.a.phase": 0,
      "osc.a.randomPhase": 0,
      "osc.a.unison.voices": 1,
      "osc.a.unison.detune": 0,
      "osc.a.unison.spread": 0,
      "osc.a.level": 0.5,
      "osc.a.pan": 0,
    });
    const rendered = renderDraft(sine, sampleRate, 0.5);
    const metrics = stereoMetrics(rendered);
    const measuredFrequency = estimateFrequency(rendered.left, sampleRate, frequency);
    const pitchErrorCents = centsBetween(measuredFrequency, frequency);
    assert.ok(Math.abs(pitchErrorCents) < 4, `${sampleRate} Hz pitch error ${pitchErrorCents} cents exceeds the browser V2 gate`);
    assert.ok(metrics.rms > 0.05 && metrics.peak <= 1, `${sampleRate} Hz render must remain finite, audible, and bounded`);
    rateEvidence.push({ sampleRate, measuredFrequency, pitchErrorCents, rms: metrics.rms });
  }
  const rateRmsValues = rateEvidence.map(({ rms }) => rms);
  assert.ok(Math.max(...rateRmsValues) / Math.min(...rateRmsValues) < 1.01, "Cross-rate sine RMS must remain within 1%");

  const automation = [
    { target: "osc.a.position", points: [{ timeS: 0, value: 0.05 }, { timeS: 0.24, value: 0.9, curve: "smoothstep" }] },
    { target: "osc.b.warp", points: [{ timeS: 0, value: 0.05 }, { timeS: 0.24, value: 0.85, curve: "easeIn" }] },
    { target: "osc.c.position", points: [{ timeS: 0, value: 0.9 }, { timeS: 0.24, value: 0.1, curve: "easeOut" }] },
    { target: "osc.c.level", points: [{ timeS: 0, value: 0.15 }, { timeS: 0.24, value: 0.5, curve: "linear" }] },
  ];
  const automationEvidence = [];
  for (const sampleRate of sampleRates) {
    const staticRender = renderDraft(threeSlotDraft, sampleRate, 0.25);
    const automatedA = renderDraft(threeSlotDraft, sampleRate, 0.25, automation);
    const automatedB = renderDraft(threeSlotDraft, sampleRate, 0.25, automation);
    assert.deepEqual(automatedB.left, automatedA.left, `${sampleRate} Hz automated left render must be deterministic`);
    assert.deepEqual(automatedB.right, automatedA.right, `${sampleRate} Hz automated right render must be deterministic`);
    const metrics = stereoMetrics(automatedA);
    const delta = stereoDelta(staticRender, automatedA);
    assert.ok(delta > 0.005, `${sampleRate} Hz automation must materially alter the rack render`);
    assert.ok(metrics.peak <= 1 && metrics.maximumStep < 1, `${sampleRate} Hz automation must stay bounded without full-scale discontinuities`);
    automationEvidence.push({ sampleRate, delta, rms: metrics.rms, peak: metrics.peak, maximumStep: metrics.maximumStep });
  }
  const automationRmsValues = automationEvidence.map(({ rms }) => rms);
  assert.ok(Math.max(...automationRmsValues) / Math.min(...automationRmsValues) < 1.08, "Cross-rate automated RMS must remain within 8%");

  const resynthesisSource = readFileSync(join(repoRoot, "frontend/src/audio/wavemapResynthesis.ts"), "utf8");
  const oscillatorPanelSource = readFileSync(join(repoRoot, "frontend/src/features/Synth/OscillatorPanel/OscillatorPanel.solid.tsx"), "utf8");
  const nativeBridgeSource = readFileSync(join(repoRoot, "backend/Source/Ipc/MessageBridge.cpp"), "utf8");
  assert.match(resynthesisSource, /export async function resynthesizeAudioFileToWavemap/);
  assert.match(resynthesisSource, /await send\(\{\s*kind: "instrument\.resynthesizeWavemap"/);
  assert.match(resynthesisSource, /await decodeAudioFileToMonoSamples/);
  const importEvidence = {
    asynchronousFrontendBoundary: true,
    productControlPresent: oscillatorPanelSource.includes("Import Audio")
      && oscillatorPanelSource.includes("resynthesizeAudioFileToWavemap")
      && oscillatorPanelSource.includes("useAudioFileStore"),
    nativeWorkerBoundaryPresent: /INSTRUMENT_RESYNTHESIZE_WAVEMAP[\s\S]{0,2400}(ThreadPool|callAsync|std::async)/.test(nativeBridgeSource),
  };
  assert.equal(importEvidence.productControlPresent, true, "Lumen must expose audio-library wavemap resynthesis through the oscillator product surface");
  assert.equal(importEvidence.nativeWorkerBoundaryPresent, false, "Update the V2 milestone docs when native wavetable analysis moves off the synchronous IPC handler");

  console.log(JSON.stringify({
    ok: true,
    scope: "lumen-v2-wavetable-browser-schema",
    threeSlot: {
      isolatedRms: Object.fromEntries(slots.map((slot) => [slot, stereoMetrics(isolated[slot]).rms])),
      simultaneousRms: stereoMetrics(combined).rms,
    },
    phaseEvidence,
    unisonEvidence,
    warpEvidence,
    interactions: {
      amDelta: stereoDelta(interactionOff, interactionAm),
      ringDelta: stereoDelta(interactionOff, interactionRing),
      sourceCWithRingDelta: stereoDelta(interactionRing, interactionWithC),
    },
    deterministicRecall: true,
    rateEvidence,
    automationEvidence,
    importEvidence,
    blockers: [
      "native wavetable analysis still runs inside the synchronous IPC handler",
      "browser memory-mode evidence does not replace native multi-note lifecycle coverage",
    ],
  }, null, 2));
} finally {
  rmSync(bundleDir, { recursive: true, force: true });
}
