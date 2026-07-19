#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-aether-preset-audit-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const REQUIRED_FAMILIES = [
  "Arp Pluck",
  "Atmosphere",
  "Bass",
  "Bass / Crunch",
  "Bell",
  "Chord Stab",
  "Keys / Synth Piano",
  "Lead",
  "Lo-Fi Pad",
  "Mallet",
  "Pad",
  "Poly Keys",
  "Sub Bass",
  "Synth String",
  "Vocal Pad",
  "Vocal Pluck",
];
const REQUIRED_BENCHMARK_PRESETS = [
  "Benchmark - Future Bass Strings",
  "Benchmark - Progressive House Strings",
];
const MIN_RMS = 0.005;
const MIN_PEAK = 0.02;
const MAX_PEAK = 0.99;
const WORKLET_DECAY_PRESETS = new Set(["Block Felt Piano", "Toy Xylophone", "Frozen Bell Stack"]);
let workletProcessorCache = null;

function numericParam(preset, id, fallback = 0) {
  const value = preset.patch?.parameters?.[id];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boolParam(preset, id, fallback = false) {
  const value = preset.patch?.parameters?.[id];
  return typeof value === "boolean" ? value : fallback;
}

function auditSampleCount(preset, sampleRate) {
  const attack = numericParam(preset, "env.1.attack", 0);
  const decay = numericParam(preset, "env.1.decay", 0.3);
  const sustain = numericParam(preset, "env.1.sustain", 0.6);
  const release = numericParam(preset, "env.1.release", 0.3);
  const seconds = sustain <= 0.04
    ? Math.min(2.5, Math.max(0.6, attack + decay + release + 0.15))
    : attack > 0.8 || release > 1.5
    ? Math.min(4.5, Math.max(1.8, attack + 1.2))
    : 1.2;
  return Math.max(24000, Math.round(seconds * sampleRate));
}

function assertFactoryAcousticBehavior(preset) {
  const fail = (message) => {
    throw new Error(`${preset.id} ${message}`);
  };
  switch (preset.name) {
    case "Block Felt Piano":
      if (numericParam(preset, "env.1.sustain", 1) > 0.04) fail("must decay like a hit, not sustain like a pad");
      if (numericParam(preset, "env.1.decay", 9) > 1.5) fail("has too long a piano hit decay");
      if (numericParam(preset, "env.1.release", 9) > 0.5) fail("has too long a piano hit release");
      break;
    case "Toy Xylophone":
      if (numericParam(preset, "env.1.sustain", 1) > 0.03) fail("must have no held sustain");
      if (numericParam(preset, "env.1.decay", 9) > 0.6) fail("has too long a mallet decay");
      if (numericParam(preset, "env.1.release", 9) > 0.2) fail("has too long a mallet release");
      break;
    case "Frozen Bell Stack":
      if (numericParam(preset, "env.1.sustain", 1) > 0.03) fail("must ring down without held sustain");
      if (numericParam(preset, "env.1.release", 9) > 0.8) fail("has too much tail for a preview hit");
      if (boolParam(preset, "lfo.1.enabled", true)) fail("must not use slow LFO wobble in the default hit");
      break;
    case "Resin Violin Lead":
      if (numericParam(preset, "env.1.sustain", 0) < 0.75) fail("needs string-like sustain");
      if (numericParam(preset, "env.1.attack", 0) < 0.04 || numericParam(preset, "env.1.attack", 1) > 0.16) fail("needs a bowed attack window");
      if (!preset.patch.modulation.some((route) => route.source === "lfo.1" && route.target === "osc.a.fine" && route.enabled)) fail("needs an active vibrato route");
      break;
    case "Velvet Choir Pad":
      if (numericParam(preset, "amp.level", 0) < 0.7) fail("is too quiet for the factory pad bank");
      if (numericParam(preset, "filter.cutoff", 0) < 7000) fail("is too muted for the choir pad default");
      break;
    default:
      break;
  }
}

function loadAetherWorkletProcessor() {
  if (workletProcessorCache) return workletProcessorCache;
  let Processor = null;
  const context = vm.createContext({
    sampleRate: 48000,
    currentFrame: 0,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { onmessage: null, postMessage() {} };
      }
    },
    registerProcessor(_name, processorClass) {
      Processor = processorClass;
    },
    console,
    Float32Array,
    Map,
    Math,
    Number,
    RegExp,
    String,
  });
  const source = readFileSync(join(repoRoot, "frontend/public/worklets/aether-preview-worklet.js"), "utf8");
  vm.runInContext(source, context, { filename: "aether-preview-worklet.js" });
  if (!Processor) throw new Error("Aether preview worklet did not register a processor");
  workletProcessorCache = { Processor, context };
  return workletProcessorCache;
}

function renderWorkletSamples(instrument, sampleCount, sampleRate, frequency, durationS) {
  const { Processor, context } = loadAetherWorkletProcessor();
  context.sampleRate = sampleRate;
  context.currentFrame = 0;
  const processor = new Processor({
    processorOptions: {
      instrument,
      durationS,
      frequency,
      bpm: 120,
      velocity: 127,
    },
  });
  const samples = new Float32Array(sampleCount);
  let offset = 0;
  let chunks = 0;
  const maxChunks = Math.ceil(sampleCount / 128) + 4;
  while (offset < sampleCount) {
    chunks += 1;
    if (chunks > maxChunks) {
      throw new Error("Aether preview worklet exceeded its expected render window");
    }
    const left = new Float32Array(128);
    const right = new Float32Array(128);
    const keepAlive = processor.process([], [[left, right]]);
    const count = Math.min(left.length, sampleCount - offset);
    samples.set(left.subarray(0, count), offset);
    offset += count;
    context.currentFrame += left.length;
    if (!keepAlive && offset < sampleCount) break;
  }
  return samples;
}

function windowRms(samples, sampleRate, startS, endS) {
  const start = Math.max(0, Math.min(samples.length - 1, Math.floor(startS * sampleRate)));
  const end = Math.max(start + 1, Math.min(samples.length, Math.floor(endS * sampleRate)));
  let sumSquares = 0;
  for (let index = start; index < end; index += 1) {
    const sample = samples[index];
    if (!Number.isFinite(sample)) throw new Error("worklet rendered a non-finite sample");
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / (end - start));
}

function assertWorkletHitDecay(preset, workletSamples, sampleRate) {
  if (!WORKLET_DECAY_PRESETS.has(preset.name)) return null;
  const attack = numericParam(preset, "env.1.attack", 0.005);
  const decay = numericParam(preset, "env.1.decay", 0.3);
  const durationS = workletSamples.length / sampleRate;
  const earlyStart = Math.max(0.02, attack * 0.5);
  const earlyEnd = Math.min(durationS * 0.35, Math.max(earlyStart + 0.04, attack + decay * 0.35));
  const tailStart = Math.min(durationS * 0.82, Math.max(durationS * 0.48, attack + decay + 0.04));
  const tailEnd = Math.min(durationS * 0.94, tailStart + 0.14);
  const earlyRms = windowRms(workletSamples, sampleRate, earlyStart, earlyEnd);
  const tailRms = windowRms(workletSamples, sampleRate, tailStart, tailEnd);
  if (earlyRms < MIN_RMS) {
    throw new Error(`${preset.id} worklet transient window is too quiet: ${earlyRms}`);
  }
  if (tailRms > earlyRms * 0.45) {
    throw new Error(`${preset.id} worklet does not decay like a hit: early=${earlyRms} tail=${tailRms}`);
  }
  return {
    earlyRms: Number(earlyRms.toFixed(5)),
    tailRms: Number(tailRms.toFixed(5)),
  };
}

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
    { stdio: "pipe" },
  );

  const synthStore = await import(pathToFileURL(join(outDir, "state/synthStore.js")));
  const synthPreview = await import(pathToFileURL(join(outDir, "audio/synthPreview.js")));
  const seenFamilies = new Set();
  const rows = synthStore.FACTORY_SYNTH_PRESETS.map((preset) => {
    if (!preset.id || !preset.name || !preset.category || !preset.family || !preset.role) {
      throw new Error(`${preset.id || preset.name || "unknown preset"} is missing required preset identity metadata`);
    }
    if (!preset.description || preset.description.trim().length < 32) {
      throw new Error(`${preset.id} is missing a release-grade description`);
    }
    if (!preset.auditionNote || preset.auditionNote.trim().length < 48) {
      throw new Error(`${preset.id} is missing a release-grade audition note`);
    }
    if (/\b(todo|placeholder|stub|generic|later)\b/i.test(preset.description) || /\b(todo|placeholder|stub|generic|later)\b/i.test(preset.auditionNote)) {
      throw new Error(`${preset.id} contains placeholder preset copy`);
    }
    seenFamilies.add(preset.family);
    const preview = synthStore.synthDraftToPreviewInstrument(preset.patch);
    const sampleRate = 48000;
    const samples = new Float32Array(auditSampleCount(preset, sampleRate));
    synthPreview.renderInstrumentSamples(preview, samples, sampleRate, synthPreview.previewFrequency(preview), "audio", true);
    let workletDecay = null;
    if (WORKLET_DECAY_PRESETS.has(preset.name)) {
      const workletSampleRate = 12000;
      const workletSampleCount = auditSampleCount(preset, workletSampleRate);
      const workletDurationS = workletSampleCount / workletSampleRate;
      const workletSamples = renderWorkletSamples(
        preview,
        workletSampleCount,
        workletSampleRate,
        synthPreview.previewFrequency(preview),
        workletDurationS,
      );
      workletDecay = assertWorkletHitDecay(preset, workletSamples, workletSampleRate);
    }
    let sumSquares = 0;
    let peak = 0;
    for (const sample of samples) {
      if (!Number.isFinite(sample)) throw new Error(`${preset.id} rendered a non-finite sample`);
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    if (rms < MIN_RMS) {
      throw new Error(`${preset.id} rendered below minimum RMS: ${rms}`);
    }
    if (peak < MIN_PEAK) {
      throw new Error(`${preset.id} rendered below minimum peak: ${peak}`);
    }
    if (peak > MAX_PEAK) {
      throw new Error(`${preset.id} rendered too close to clipping: ${peak}`);
    }
    const macroLabels = ["macro.1", "macro.2", "macro.3", "macro.4"].map((id) => preset.patch.metadata.macros[id]?.label ?? "");
    const macroRouteCount = preset.patch.modulation.filter((route) => route.source.startsWith("macro.")).length;
    if (preset.id !== "factory.init") {
      if (new Set(macroLabels).size !== macroLabels.length || macroLabels.some((label) => label.trim().length < 3)) {
        throw new Error(`${preset.id} has weak or duplicate macro labels`);
      }
      if (macroLabels.join("|") === "Motion|Color|Shape|Space") {
        throw new Error(`${preset.id} is using the generic macro layout`);
      }
      if (macroRouteCount < 4) {
        throw new Error(`${preset.id} is missing factory macro route assignments`);
      }
    }
    assertFactoryAcousticBehavior(preset);
    return {
      id: preset.id,
      name: preset.name,
      family: preset.family,
      role: preset.role,
      category: preset.category,
      routes: preset.patch.modulation.length,
      macroLabels,
      macroRouteCount,
      fx: preset.patch.effects?.filters.length ?? 0,
      rms: Number(rms.toFixed(5)),
      peak: Number(peak.toFixed(5)),
      workletDecay,
      auditionNote: preset.auditionNote,
    };
  });
  const missingFamilies = REQUIRED_FAMILIES.filter((family) => !seenFamilies.has(family));
  if (missingFamilies.length > 0) {
    throw new Error(`Factory Aether presets are missing required families: ${missingFamilies.join(", ")}`);
  }
  const presetNames = new Set(rows.map((row) => row.name));
  const missingBenchmarks = REQUIRED_BENCHMARK_PRESETS.filter((name) => !presetNames.has(name));
  if (missingBenchmarks.length > 0) {
    throw new Error(`Factory Aether presets are missing required benchmark instruments: ${missingBenchmarks.join(", ")}`);
  }

  console.log(JSON.stringify({
    ok: true,
    count: rows.length,
    thresholds: {
      minRms: MIN_RMS,
      minPeak: MIN_PEAK,
      maxPeak: MAX_PEAK,
    },
    families: [...new Set(rows.map((row) => row.family))].sort(),
    auditionLogComplete: true,
    benchmarkPresetsComplete: true,
    presets: rows,
  }, null, 2));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
