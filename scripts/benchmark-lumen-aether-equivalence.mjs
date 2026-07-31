#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const bundleDir = join(tmpdir(), `beat-lumen-aether-equivalence-bundle-${Date.now()}`);
const reportDir = resolve(process.argv[2] || join(tmpdir(), "beat-lumen-aether-equivalence"));
const benchmarkIds = [
  "factory.benchmark-future-bass-strings",
  "factory.benchmark-progressive-house-strings",
];
const cases = [
  { sampleRate: 44100, blockSize: 128, voices: 1, durationS: 0.35 },
  { sampleRate: 48000, blockSize: 128, voices: 4, durationS: 0.35 },
  { sampleRate: 48000, blockSize: 512, voices: 8, durationS: 0.35 },
  { sampleRate: 96000, blockSize: 512, voices: 8, durationS: 0.35 },
];
const midiNotes = [48, 55, 60, 64, 67, 72, 76, 79];
const repetitions = 5;
const budget = {
  maxOutputSampleDelta: 0,
  maxActiveOscillatorLaneFrameDelta: 0,
  maxRowMedianWallRatio: 1.15,
  maxAggregateMedianWallRatio: 1.10,
};

function midiFrequency(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function hashStereo(left, right) {
  return createHash("sha256")
    .update(Buffer.from(left.buffer, left.byteOffset, left.byteLength))
    .update(Buffer.from(right.buffer, right.byteOffset, right.byteLength))
    .digest("hex");
}

function compareStereo(a, b) {
  assert.equal(a.left.length, b.left.length);
  assert.equal(a.right.length, b.right.length);
  let maxSampleDelta = 0;
  let differenceEnergy = 0;
  for (let index = 0; index < a.left.length; index += 1) {
    const leftDelta = Math.abs(a.left[index] - b.left[index]);
    const rightDelta = Math.abs(a.right[index] - b.right[index]);
    maxSampleDelta = Math.max(maxSampleDelta, leftDelta, rightDelta);
    differenceEnergy += leftDelta * leftDelta + rightDelta * rightDelta;
  }
  return { maxSampleDelta, differenceEnergy };
}

function renderWorkload(renderStereo, instrument, { sampleRate, blockSize, voices, durationS }) {
  const blockCount = Math.ceil((sampleRate * durationS) / blockSize);
  const sampleCount = blockCount * blockSize;
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  const voiceLeft = new Float32Array(blockSize);
  const voiceRight = new Float32Array(blockSize);
  const gain = 1 / voices;
  const started = performance.now();

  for (let block = 0; block < blockCount; block += 1) {
    const offset = block * blockSize;
    for (let voice = 0; voice < voices; voice += 1) {
      voiceLeft.fill(0);
      voiceRight.fill(0);
      renderStereo(
        instrument,
        voiceLeft,
        voiceRight,
        sampleRate,
        midiFrequency(midiNotes[voice]),
        "audio",
        false,
        undefined,
        undefined,
        undefined,
        128,
        108,
      );
      for (let sample = 0; sample < blockSize; sample += 1) {
        left[offset + sample] += voiceLeft[sample] * gain;
        right[offset + sample] += voiceRight[sample] * gain;
      }
    }
  }

  const wallMs = performance.now() - started;
  return {
    left,
    right,
    wallMs,
    work: {
      blockCount,
      renderCalls: blockCount * voices,
      submittedVoiceSampleFrames: sampleCount * voices,
      outputSampleFrames: sampleCount,
      outputChannelSamples: sampleCount * 2,
    },
  };
}

function instrumentVoiceSettings(instrument) {
  const oscillators = instrument.aether?.oscillators ?? [];
  return {
    maxVoices: instrument.maxVoices ?? null,
    oscillatorUnisonVoices: Object.fromEntries(oscillators.map((oscillator) => [oscillator.id, oscillator.wavetable?.unison ?? 1])),
    benchmarkMidiNotes: midiNotes,
    velocity: 108,
    bpm: 128,
  };
}

function rendererWorkTelemetry(instrument, commonWork) {
  const oscillators = instrument.aether?.oscillators ?? [];
  const enabledOscillators = oscillators.filter((oscillator) => oscillator.enabled && oscillator.level > 0);
  const activeOscillatorLanes = enabledOscillators.reduce(
    (sum, oscillator) => sum + (oscillator.waveform === "wavetable" ? oscillator.wavetable?.unison ?? 1 : 1),
    0,
  );
  return {
    configuredSourceSlots: oscillators.length,
    enabledSourceSlots: enabledOscillators.length,
    sourceDispatchChecks: commonWork.submittedVoiceSampleFrames * oscillators.length,
    activeOscillatorLanes,
    activeOscillatorLaneFrames: commonWork.submittedVoiceSampleFrames * activeOscillatorLanes,
  };
}

mkdirSync(bundleDir, { recursive: true });
mkdirSync(reportDir, { recursive: true });

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
  const rows = [];

  for (const id of benchmarkIds) {
    const preset = store.FACTORY_SYNTH_PRESETS.find((candidate) => candidate.id === id);
    assert.ok(preset, `missing frozen Aether benchmark patch ${id}`);
    const sourceBeforeClone = structuredClone(preset.patch);
    // The preview renderer deliberately seeds random-phase LFOs from the
    // instrument identity. Keep the source name for this equivalent-patch
    // measurement so identity-seeded modulation is held constant too.
    const lumenPatch = store.cloneAetherDraftAsLumen(preset.patch, preset.patch.name);
    assert.deepEqual(preset.patch, sourceBeforeClone, `${id} clone mutated the frozen Aether source`);
    assert.equal(lumenPatch.instrumentType, "lumen-hybrid-synth");
    assert.equal(lumenPatch.namespace, "lumen");
    assert.equal(lumenPatch.parameters["osc.c.enabled"], false);
    assert.equal(lumenPatch.parameters["lumen.arp.enabled"], false);
    assert.equal(lumenPatch.parameters["lumen.clip.enabled"], false);

    const aetherInstrument = store.synthDraftToPreviewInstrument(preset.patch);
    const lumenInstrument = store.synthDraftToPreviewInstrument(lumenPatch);
    const aetherVoiceSettings = instrumentVoiceSettings(aetherInstrument);
    const lumenVoiceSettings = instrumentVoiceSettings(lumenInstrument);
    assert.equal(lumenVoiceSettings.maxVoices, aetherVoiceSettings.maxVoices, `${id} clone changed max voices`);
    assert.deepEqual(
      Object.fromEntries(Object.entries(lumenVoiceSettings.oscillatorUnisonVoices).filter(([slot]) => slot !== "c")),
      aetherVoiceSettings.oscillatorUnisonVoices,
      `${id} clone changed equivalent A/B unison settings`,
    );

    for (const benchmarkCase of cases) {
      // Warm both paths outside the measured repetitions.
      renderWorkload(preview.renderInstrumentStereoSamples, aetherInstrument, benchmarkCase);
      renderWorkload(preview.renderInstrumentStereoSamples, lumenInstrument, benchmarkCase);

      const aetherWallMs = [];
      const lumenWallMs = [];
      let canonicalAether;
      let canonicalLumen;
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        const aetherFirst = repetition % 2 === 0;
        const first = renderWorkload(
          preview.renderInstrumentStereoSamples,
          aetherFirst ? aetherInstrument : lumenInstrument,
          benchmarkCase,
        );
        const second = renderWorkload(
          preview.renderInstrumentStereoSamples,
          aetherFirst ? lumenInstrument : aetherInstrument,
          benchmarkCase,
        );
        const aether = aetherFirst ? first : second;
        const lumen = aetherFirst ? second : first;
        aetherWallMs.push(aether.wallMs);
        lumenWallMs.push(lumen.wallMs);
        canonicalAether ??= aether;
        canonicalLumen ??= lumen;
      }

      assert.deepEqual(canonicalLumen.work, canonicalAether.work, `${id} submitted work differs`);
      const aetherRendererWork = rendererWorkTelemetry(aetherInstrument, canonicalAether.work);
      const lumenRendererWork = rendererWorkTelemetry(lumenInstrument, canonicalLumen.work);
      const activeOscillatorLaneFrameDelta = lumenRendererWork.activeOscillatorLaneFrames - aetherRendererWork.activeOscillatorLaneFrames;
      const equivalence = compareStereo(canonicalAether, canonicalLumen);
      const aetherHash = hashStereo(canonicalAether.left, canonicalAether.right);
      const lumenHash = hashStereo(canonicalLumen.left, canonicalLumen.right);
      const aetherMedianWallMs = median(aetherWallMs);
      const lumenMedianWallMs = median(lumenWallMs);
      rows.push({
        id,
        name: preset.name,
        sampleRate: benchmarkCase.sampleRate,
        blockSize: benchmarkCase.blockSize,
        voices: benchmarkCase.voices,
        renderedDurationS: round(canonicalAether.work.outputSampleFrames / benchmarkCase.sampleRate),
        voiceSettings: {
          aether: aetherVoiceSettings,
          lumen: lumenVoiceSettings,
        },
        work: {
          common: canonicalAether.work,
          aether: aetherRendererWork,
          lumen: lumenRendererWork,
          activeOscillatorLaneFrameDelta,
        },
        output: {
          aetherSha256: aetherHash,
          lumenSha256: lumenHash,
          hashIdentical: aetherHash === lumenHash,
          maxSampleDelta: equivalence.maxSampleDelta,
          differenceEnergy: equivalence.differenceEnergy,
        },
        timing: {
          repetitions,
          order: "alternating-aether-first/lumen-first",
          aetherWallMs: aetherWallMs.map((value) => round(value, 3)),
          lumenWallMs: lumenWallMs.map((value) => round(value, 3)),
          aetherMedianWallMs: round(aetherMedianWallMs, 3),
          lumenMedianWallMs: round(lumenMedianWallMs, 3),
          lumenToAetherMedianRatio: round(lumenMedianWallMs / aetherMedianWallMs),
        },
      });
    }
  }

  const aggregateRatio = rows.reduce((sum, row) => sum + row.timing.lumenMedianWallMs, 0)
    / rows.reduce((sum, row) => sum + row.timing.aetherMedianWallMs, 0);
  const failures = [];
  for (const row of rows) {
    if (!row.output.hashIdentical || row.output.maxSampleDelta > budget.maxOutputSampleDelta)
      failures.push(`${row.id} ${row.sampleRate}/${row.blockSize}/${row.voices}: output mismatch`);
    if (Math.abs(row.work.activeOscillatorLaneFrameDelta) > budget.maxActiveOscillatorLaneFrameDelta)
      failures.push(`${row.id} ${row.sampleRate}/${row.blockSize}/${row.voices}: active oscillator work differs`);
    if (row.timing.lumenToAetherMedianRatio > budget.maxRowMedianWallRatio)
      failures.push(`${row.id} ${row.sampleRate}/${row.blockSize}/${row.voices}: wall ratio ${row.timing.lumenToAetherMedianRatio}`);
  }
  if (aggregateRatio > budget.maxAggregateMedianWallRatio)
    failures.push(`aggregate wall ratio ${round(aggregateRatio)}`);

  const report = {
    schema: "beat.lumen-aether-equivalent-patch-benchmark.v1",
    measuredAt: new Date().toISOString(),
    comparisonBoundary: "Beat Aether patches cloned through cloneAetherDraftAsLumen and rendered by Beat's frontend offline preview path; no Serum 2 renderer, preset, audio, or parity claim is involved.",
    clonePath: "frontend/src/state/synthStore.ts#cloneAetherDraftAsLumen",
    renderer: "frontend/src/audio/synthPreview.ts#renderInstrumentStereoSamples",
    timingPolicy: "One warm-up per engine/case, five measured repetitions, alternating engine order, median wall time. Wall budgets include scheduler/JIT noise; submitted-work equality is exact.",
    workTelemetryDefinition: "Deterministic submitted work, not CPU instructions: callback-sized render calls, voice-sample frames, output frames, stereo channel samples, configured source dispatch checks, and active oscillator lane frames. Lumen retains one additional disabled Source C dispatch check while active A/B oscillator work remains equal.",
    budget,
    aggregate: {
      lumenToAetherMedianWallRatio: round(aggregateRatio),
      maxObservedRowMedianWallRatio: Math.max(...rows.map((row) => row.timing.lumenToAetherMedianRatio)),
      outputEquivalentRows: rows.filter((row) => row.output.hashIdentical).length,
      totalRows: rows.length,
    },
    rows,
    ok: failures.length === 0,
    failures,
  };
  const reportPath = join(reportDir, "lumen-aether-equivalence.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: report.ok, reportPath, aggregate: report.aggregate }, null, 2));
  assert.deepEqual(failures, [], `Lumen/Aether equivalent-patch gate failed:\n${failures.join("\n")}`);
} finally {
  rmSync(bundleDir, { recursive: true, force: true });
}
