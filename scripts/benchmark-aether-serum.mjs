#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const bundleDir = join(tmpdir(), `beat-aether-serum-benchmark-bundle-${Date.now()}`);
const requestedOutput = process.argv.find((arg) => arg.startsWith("--output-dir="))?.slice("--output-dir=".length);
const outputDir = resolve(requestedOutput || join(tmpdir(), "beat-aether-serum-benchmark"));
const BENCHMARK_NAMES = [
  "Benchmark - Future Bass Strings",
  "Benchmark - Progressive House Strings",
];
const FROZEN_AUDITION_HASHES = {
  "Benchmark - Future Bass Strings": {
    float: "df257e579097f5988c06c32201daf796ee9352a8b5c21fdc8bd039520d23c366",
    wav: "eaf6aeff4a3d604312d0575e2c8d90555eaa7a89aff1bc65ad57e2db792e437c",
  },
  "Benchmark - Progressive House Strings": {
    float: "a30b0196e0d2d4d153ccd0370cddcd3f54009b5c5581ddcf2ef049033da248f6",
    wav: "17a26d0df7702e6525485fd7669757bfee81ef05ed65cdc705368449882f8ea8",
  },
};
const SAMPLE_RATES = [44100, 48000, 96000];
const NOTES = [48, 60, 84];
const VELOCITIES = [72, 118];
const MATRIX_DURATION_S = 0.32;
const AUDITION_DURATION_S = 2.4;

mkdirSync(bundleDir, { recursive: true });
mkdirSync(outputDir, { recursive: true });

function midiFrequency(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function hashStereo(left, right) {
  const interleaved = Buffer.allocUnsafe(left.length * 8);
  for (let index = 0; index < left.length; index += 1) {
    interleaved.writeFloatLE(left[index], index * 8);
    interleaved.writeFloatLE(right[index], index * 8 + 4);
  }
  return createHash("sha256").update(interleaved).digest("hex");
}

function measure(left, right) {
  let sumSquares = 0;
  let sum = 0;
  let peak = 0;
  let maximumStep = 0;
  let sideSquares = 0;
  let midSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index];
    const r = right[index];
    if (!Number.isFinite(l) || !Number.isFinite(r)) throw new Error("Benchmark produced non-finite audio");
    sumSquares += l * l + r * r;
    sum += l + r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    if (index > 0) maximumStep = Math.max(maximumStep, Math.abs(l - left[index - 1]), Math.abs(r - right[index - 1]));
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    midSquares += mid * mid;
    sideSquares += side * side;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, left.length * 2));
  return {
    rms: round(rms),
    peak: round(peak),
    dcMean: round(sum / Math.max(1, left.length * 2), 9),
    maximumAdjacentStep: round(maximumStep),
    stereoSideToMid: round(Math.sqrt(sideSquares / Math.max(midSquares, 1e-20))),
  };
}

function nyquistBandEnergyRatio(samples, start, size = 2048) {
  const length = Math.min(size, samples.length - start);
  if (length < 128) return 0;
  const windowed = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (length - 1));
    windowed[index] = samples[start + index] * window;
  }
  let total = 0;
  let high = 0;
  const firstHighBin = Math.floor((length / 2) * 0.85);
  for (let bin = 1; bin < length / 2; bin += 1) {
    let real = 0;
    let imag = 0;
    for (let index = 0; index < length; index += 1) {
      const phase = (2 * Math.PI * bin * index) / length;
      real += windowed[index] * Math.cos(phase);
      imag -= windowed[index] * Math.sin(phase);
    }
    const energy = real * real + imag * imag;
    total += energy;
    if (bin >= firstHighBin) high += energy;
  }
  return total > 0 ? high / total : 0;
}

function sampleRateResidual(reference48, reference96) {
  const length = Math.min(reference48.length, Math.floor(reference96.length / 2));
  let signalSquares = 0;
  let residualSquares = 0;
  let peak = 0;
  for (let index = 0; index < length; index += 1) {
    const downsampled = (reference96[index * 2] + reference96[Math.min(reference96.length - 1, index * 2 + 1)]) * 0.5;
    const residual = reference48[index] - downsampled;
    signalSquares += reference48[index] * reference48[index];
    residualSquares += residual * residual;
    peak = Math.max(peak, Math.abs(residual));
  }
  const rms = Math.sqrt(residualSquares / Math.max(1, length));
  const signalRms = Math.sqrt(signalSquares / Math.max(1, length));
  return {
    rms: round(rms),
    peak: round(peak),
    relativeDb: round(20 * Math.log10(Math.max(rms, 1e-12) / Math.max(signalRms, 1e-12)), 3),
  };
}

function downsampleFourToOne(reference192, radius = 32) {
  const outputLength = Math.floor(reference192.length / 4);
  const output = new Float64Array(outputLength);
  const cutoff = 0.1175;
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const center = outputIndex * 4;
    let weighted = 0;
    let weightSum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const sourceIndex = center + offset;
      if (sourceIndex < 0 || sourceIndex >= reference192.length) continue;
      const sinc = offset === 0
        ? 2 * cutoff
        : Math.sin(2 * Math.PI * cutoff * offset) / (Math.PI * offset);
      const window = 0.5 + 0.5 * Math.cos((Math.PI * offset) / (radius + 1));
      const weight = sinc * window;
      weighted += reference192[sourceIndex] * weight;
      weightSum += weight;
    }
    output[outputIndex] = weightSum !== 0 ? weighted / weightSum : 0;
  }
  return output;
}

function referenceSubtractedResidual(reference48, reference192, sampleRate = 48000) {
  const downsampledLeft = downsampleFourToOne(reference192.left);
  const downsampledRight = downsampleFourToOne(reference192.right);
  const edge = 16;
  const analysisStart = Math.max(edge, Math.floor(sampleRate * 0.08));
  const analysisEnd = Math.min(reference48.left.length, downsampledLeft.length) - edge;
  let signalSquares = 0;
  let residualSquares = 0;
  let peak = 0;
  for (let index = analysisStart; index < analysisEnd; index += 1) {
    for (const [direct, downsampled] of [
      [reference48.left, downsampledLeft],
      [reference48.right, downsampledRight],
    ]) {
      const residual = direct[index] - downsampled[index];
      signalSquares += direct[index] * direct[index];
      residualSquares += residual * residual;
      peak = Math.max(peak, Math.abs(residual));
    }
  }
  const samples = Math.max(1, (analysisEnd - analysisStart) * 2);
  const rms = Math.sqrt(residualSquares / samples);
  const signalRms = Math.sqrt(signalSquares / samples);
  return {
    method: "modulation/filter/FX-isolated oscillator stack at 48 kHz minus deterministic 192 kHz render decimated 4:1 with a 65-tap Hann-windowed sinc low-pass",
    note: 84,
    velocity: 118,
    direct48Hash: hashStereo(reference48.left, reference48.right),
    reference192Hash: hashStereo(reference192.left, reference192.right),
    analysisStartSeconds: round(analysisStart / sampleRate, 6),
    comparedSamples: samples,
    rms: round(rms),
    peak: round(peak),
    residualToSignalRatio: round(residualSquares / Math.max(signalSquares, 1e-20), 9),
    relativeDb: round(20 * Math.log10(Math.max(rms, 1e-12) / Math.max(signalRms, 1e-12)), 3),
  };
}

function writeStereoWav(path, left, right, sampleRate) {
  const dataBytes = left.length * 4;
  const wav = Buffer.allocUnsafe(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < left.length; index += 1) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[index])) * 32767), 44 + index * 4);
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[index])) * 32767), 46 + index * 4);
  }
  writeFileSync(path, wav);
  return createHash("sha256").update(wav).digest("hex");
}

function renderNote(renderStereo, instrument, sampleRate, note, velocity, durationS) {
  const count = Math.round(sampleRate * durationS);
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  const started = performance.now();
  renderStereo(instrument, left, right, sampleRate, midiFrequency(note), "audio", true, undefined, undefined, undefined, 128, velocity);
  return { left, right, wallMs: performance.now() - started };
}

function renderAudition(renderStereo, instrument, sampleRate) {
  const count = Math.round(sampleRate * AUDITION_DURATION_S);
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  const chord = [48, 55, 60, 64];
  const started = performance.now();
  for (const note of chord) {
    const rendered = renderNote(renderStereo, instrument, sampleRate, note, 108, AUDITION_DURATION_S);
    for (let index = 0; index < count; index += 1) {
      left[index] += rendered.left[index] * 0.24;
      right[index] += rendered.right[index] * 0.24;
    }
  }
  return { left, right, wallMs: performance.now() - started };
}

function makeOscillatorAliasProbeInstrument(instrument) {
  const probe = structuredClone(instrument);
  probe.envelope = { attackMs: 0, decayMs: 0, sustain: 1, releaseMs: 0 };
  probe.knobs = { ...probe.knobs, cutoff: 1, resonance: 0, drive: 0 };
  probe.filterKeytrack = 0;
  probe.lfoDepth = 0;
  probe.lfoToPitch = 0;
  probe.lfoToFilter = 0;
  probe.envToFilter = 0;
  probe.lfo2Enabled = false;
  probe.effects = [];
  if (probe.aether?.oscA) probe.aether.oscA.randomPhase = 0;
  if (probe.aether?.oscB) probe.aether.oscB.randomPhase = 0;
  if (probe.synthPatch) {
    probe.synthPatch.modulation = [];
    probe.synthPatch.effects = [];
    Object.assign(probe.synthPatch.parameters, {
      "env.1.attack": 0,
      "env.1.decay": 0,
      "env.1.sustain": 1,
      "env.1.release": 0,
      "filter.enabled": false,
      "filter.cutoff": 20000,
      "filter.resonance": 0,
      "filter.drive": 0,
      "lfo.1.enabled": false,
      "lfo.2.enabled": false,
      "osc.a.random": 0,
      "osc.b.random": 0,
    });
  }
  return probe;
}

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(esbuild, [
    join(repoRoot, "frontend/src/state/synthStore.ts"),
    join(repoRoot, "frontend/src/audio/synthPreview.ts"),
    "--bundle", "--format=esm", "--platform=node", `--outdir=${bundleDir}`,
  ], { stdio: "pipe" });
  const store = await import(pathToFileURL(join(bundleDir, "state/synthStore.js")));
  const previewApi = await import(pathToFileURL(join(bundleDir, "audio/synthPreview.js")));
  const presets = BENCHMARK_NAMES.map((name) => store.FACTORY_SYNTH_PRESETS.find((preset) => preset.name === name));
  if (presets.some((preset) => !preset)) throw new Error("One or more required benchmark factory presets are missing");

  const report = {
    schemaVersion: 2,
    benchmark: "Aether Serum-class reference instruments",
    comparisonBoundary: "Beat-authored Aether presets only; no third-party presets or audio are used",
    outputDir,
    sampleRates: SAMPLE_RATES,
    notes: NOTES,
    velocities: VELOCITIES,
    presets: [],
  };

  for (const preset of presets) {
    const instrument = store.synthDraftToPreviewInstrument(preset.patch);
    const matrix = [];
    const equivalence = new Map();
    for (const sampleRate of SAMPLE_RATES) {
      for (const note of NOTES) {
        for (const velocity of VELOCITIES) {
          const rendered = renderNote(previewApi.renderInstrumentStereoSamples, instrument, sampleRate, note, velocity, MATRIX_DURATION_S);
          const metrics = measure(rendered.left, rendered.right);
          if (metrics.rms < 0.005 || metrics.peak < 0.02 || metrics.peak >= 0.99) {
            throw new Error(`${preset.name} ${sampleRate} Hz note ${note} velocity ${velocity} failed audibility/headroom bounds`);
          }
          const key = `${sampleRate}:${note}:${velocity}`;
          if ((sampleRate === 48000 || sampleRate === 96000) && note === 60 && velocity === 118) equivalence.set(sampleRate, rendered.left);
          matrix.push({
            sampleRate,
            note,
            velocity,
            hash: hashStereo(rendered.left, rendered.right),
            wallMs: round(rendered.wallMs, 3),
            realtimeFactor: round((MATRIX_DURATION_S * 1000) / Math.max(rendered.wallMs, 0.001), 3),
            ...metrics,
            nyquistBandEnergyRatio: note === 84 && velocity === 118
              ? round(nyquistBandEnergyRatio(rendered.left, Math.floor(sampleRate * 0.08)), 9)
              : undefined,
          });
        }
      }
    }

    const aliasProbeInstrument = makeOscillatorAliasProbeInstrument(instrument);
    const directAliasProbe48 = renderNote(
      previewApi.renderInstrumentStereoSamples,
      aliasProbeInstrument,
      48000,
      84,
      118,
      MATRIX_DURATION_S,
    );
    const highRateAliasReference = renderNote(
      previewApi.renderInstrumentStereoSamples,
      aliasProbeInstrument,
      192000,
      84,
      118,
      MATRIX_DURATION_S,
    );
    const repeatedDirectAliasProbe48 = renderNote(
      previewApi.renderInstrumentStereoSamples,
      aliasProbeInstrument,
      48000,
      84,
      118,
      MATRIX_DURATION_S,
    );
    const repeatedHighRateAliasReference = renderNote(
      previewApi.renderInstrumentStereoSamples,
      aliasProbeInstrument,
      192000,
      84,
      118,
      MATRIX_DURATION_S,
    );
    if (hashStereo(directAliasProbe48.left, directAliasProbe48.right)
        !== hashStereo(repeatedDirectAliasProbe48.left, repeatedDirectAliasProbe48.right)
        || hashStereo(highRateAliasReference.left, highRateAliasReference.right)
          !== hashStereo(repeatedHighRateAliasReference.left, repeatedHighRateAliasReference.right)) {
      throw new Error(`${preset.name} oscillator alias probe is not deterministic`);
    }

    const audition = renderAudition(previewApi.renderInstrumentStereoSamples, instrument, 48000);
    const repeated = renderAudition(previewApi.renderInstrumentStereoSamples, instrument, 48000);
    const auditionHash = hashStereo(audition.left, audition.right);
    const repeatedHash = hashStereo(repeated.left, repeated.right);
    if (auditionHash !== repeatedHash) throw new Error(`${preset.name} audition render is not deterministic`);
    const wavName = `${preset.id.replace(/[^a-z0-9.-]+/gi, "-")}.wav`;
    const wavHash = writeStereoWav(join(outputDir, wavName), audition.left, audition.right, 48000);
    const auditionMetrics = measure(audition.left, audition.right);
    if (auditionMetrics.stereoSideToMid < 0.05) {
      throw new Error(`${preset.name} collapsed to dual-mono instead of preserving unison width`);
    }
    const frozen = FROZEN_AUDITION_HASHES[preset.name];
    if (!frozen || auditionHash !== frozen.float || wavHash !== frozen.wav) {
      throw new Error(`${preset.name} changed its frozen benchmark render; investigate and document the change before updating hashes (float=${auditionHash}, wav=${wavHash})`);
    }
    report.presets.push({
      id: preset.id,
      name: preset.name,
      category: preset.category,
      audition: {
        sampleRate: 48000,
        notes: [48, 55, 60, 64],
        velocity: 108,
        floatHash: auditionHash,
        wavFile: wavName,
        wavHash,
        deterministicRepeat: true,
        wallMs: round(audition.wallMs, 3),
        realtimeFactor: round((AUDITION_DURATION_S * 1000) / Math.max(audition.wallMs, 0.001), 3),
        ...auditionMetrics,
      },
      sampleRateEquivalence48To96: sampleRateResidual(equivalence.get(48000), equivalence.get(96000)),
      referenceSubtractedOscillatorAliasProbe: referenceSubtractedResidual(
        directAliasProbe48,
        highRateAliasReference,
      ),
      matrix,
    });
  }

  const reportPath = join(outputDir, "aether-serum-benchmark.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, reportPath, presets: report.presets }, null, 2));
} finally {
  rmSync(bundleDir, { recursive: true, force: true });
}
