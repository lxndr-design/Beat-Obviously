#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-generation-diversity-${Date.now()}`);
const runsPerCategory = Number.parseInt(process.argv.find((arg) => arg.startsWith("--runs="))?.split("=")[1] ?? "20", 10);
const localOnly = !process.argv.includes("--ollama");
const reportPath = join(repoRoot, "docs", "generation-diversity-audit.md");

mkdirSync(outDir, { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/ai/aiService.ts"),
      join(repoRoot, "frontend/src/ai/drumBeatGenerator.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      "--splitting",
      `--outdir=${outDir}`,
    ],
    { stdio: "inherit" },
  );

  globalThis.localStorage = memoryStorage();
  if (localOnly) {
    globalThis.fetch = async () => {
      throw new Error("generation diversity audit is running local fallback only");
    };
  }
  console.info = () => {};

  const ai = await import(pathToFileURL(join(outDir, "aiService.js")));
  const drums = await import(pathToFileURL(join(outDir, "drumBeatGenerator.js")));
  const instruments = fixtureInstruments();
  const audioFiles = fixtureAudioFiles();

  const instrumentResults = [];
  for (const targetKind of ["synth", "wavetable", "hybrid", "sampler"]) {
    const prompt = instrumentPromptFor(targetKind);
    const outputs = [];
    for (let i = 0; i < runsPerCategory; i += 1) {
      const generated = await ai.LocalAiService.generateInstrument({
        prompt,
        current: baseInstrument(targetKind),
        targetKind,
        variationSeed: 10_000 + i,
        instruments,
        audioFiles,
      });
      outputs.push({ index: i, generated });
    }
    instrumentResults.push(summarizeInstrumentBatch(targetKind, prompt, outputs));
  }

  const beatResults = [];
  for (const genre of drums.DRUM_GENRES) {
    const outputs = [];
    for (let i = 0; i < runsPerCategory; i += 1) {
      outputs.push(drums.generateLocalDrumBeat({
        genre,
        instruments,
        stepCount: 16,
        lengthBeats: 16,
        speed: 4,
        timeSignature: { num: 4, denom: 4, boldBeats: [1, 3] },
        complexity: 60,
        variationSeed: 20_000 + i,
      }));
    }
    beatResults.push(summarizeBeatBatch(genre, outputs));
  }

  const midiResults = [];
  for (const role of ["melody", "bass", "chords", "arp", "countermelody"]) {
    const outputs = [];
    for (let i = 0; i < runsPerCategory; i += 1) {
      outputs.push(await ai.LocalAiService.generatePattern({
        lengthBeats: 8,
        role,
        key: role === "chords" ? "F major" : "C minor",
        style: midiStyleFor(role),
        variationSeed: 30_000 + i,
      }));
    }
    midiResults.push(summarizeMidiBatch(role, outputs));
  }

  const report = renderReport({
    runsPerCategory,
    mode: localOnly ? "local fallback/procedural layer" : "service path with Ollama allowed",
    instrumentResults,
    beatResults,
    midiResults,
  });
  writeFileSync(reportPath, report);
  const schemaFailures = instrumentResults.flatMap((result) => instrumentSchemaFailures(result));
  if (schemaFailures.length > 0) {
    throw new Error(`Instrument schema audit failed:\n${schemaFailures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  console.log(JSON.stringify({
    ok: true,
    mode: localOnly ? "local" : "ollama-allowed",
    runsPerCategory,
    reportPath,
    instruments: instrumentResults.map(({ category, uniqueFingerprints, pairwiseDistance, schemaCoverage, flags }) => ({
      category,
      uniqueFingerprints,
      pairwiseDistance,
      schemaCoverage,
      flags,
    })),
    beats: beatResults.map(({ category, uniqueFingerprints, rhythmDistance, flags }) => ({
      category,
      uniqueFingerprints,
      rhythmDistance,
      flags,
    })),
    midi: midiResults.map(({ category, uniqueFingerprints, eventDistance, flags }) => ({
      category,
      uniqueFingerprints,
      eventDistance,
      flags,
    })),
  }, null, 2));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
  };
}

function fixtureInstruments() {
  return [
    instrument("kick", "Punchy Kick", { descriptors: ["kick", "drum"], sampleUrl: "/samples/kick.wav" }),
    instrument("snare", "Snappy Snare", { descriptors: ["snare", "drum"], sampleUrl: "/samples/snare.wav" }),
    instrument("clap", "Analog Clap", { descriptors: ["clap"], sampleUrl: "/samples/clap.wav" }),
    instrument("hat", "Closed Hat", { descriptors: ["hat", "drum"], sampleUrl: "/samples/hat.wav" }),
    instrument("open-hat", "Open Hat", { descriptors: ["open hat"], sampleUrl: "/samples/open-hat.wav" }),
    instrument("crash", "Crash Cymbal", { descriptors: ["crash", "cymbal"], sampleUrl: "/samples/crash.wav" }),
    instrument("rim", "Rim Click", { descriptors: ["rim", "cross-stick"], sampleUrl: "/samples/rim.wav" }),
    instrument("low-tom", "Low Tom", { descriptors: ["tom"], sampleUrl: "/samples/low-tom.wav" }),
    instrument("mid-tom", "Mid Tom", { descriptors: ["tom"], sampleUrl: "/samples/mid-tom.wav" }),
    instrument("high-tom", "High Tom", { descriptors: ["tom"], sampleUrl: "/samples/high-tom.wav" }),
    instrument("ride", "Ride Cymbal", { descriptors: ["ride"], sampleUrl: "/samples/ride.wav" }),
    instrument("cowbell", "Cowbell", { descriptors: ["cowbell"], sampleUrl: "/samples/cowbell.wav" }),
    instrument("tambourine", "Tambourine", { descriptors: ["tambourine"], sampleUrl: "/samples/tambourine.wav" }),
    instrument("guiro", "Guiro", { descriptors: ["guiro", "percussion"], sampleUrl: "/samples/guiro.wav" }),
    instrument("conga-low", "Low Conga", { descriptors: ["conga", "percussion"], sampleUrl: "/samples/conga-low.wav" }),
    instrument("conga-high", "High Conga", { descriptors: ["conga", "percussion"], sampleUrl: "/samples/conga-high.wav" }),
    instrument("foley", "Foley Percussion", { descriptors: ["foley", "percussion", "texture"], sampleUrl: "/samples/foley-perc.wav" }),
    instrument("amen", "Uploaded Amen Break", { userCreated: true, descriptors: ["amen", "breakbeat", "chopped"], sampleUrl: "/samples/amen.wav" }),
    instrument("shaker", "Uploaded Pop Shaker", { userCreated: true, descriptors: ["shaker", "texture"], sampleUrl: "/samples/shaker.wav" }),
    instrument("flute", "Airy Flute Sample", { userCreated: true, descriptors: ["flute", "breath"], sampleUrl: "/samples/flute.wav" }),
    instrument("vocal", "Vocal Chop", { userCreated: true, descriptors: ["vocal", "voice", "chop"], sampleUrl: "/samples/vocal-chop.wav" }),
    instrument("glass", "Glass Bell Sample", { userCreated: true, descriptors: ["bell", "glass"], sampleUrl: "/samples/glass-bell.wav" }),
  ];
}

function fixtureAudioFiles() {
  return [
    { id: "audio-flute", name: "Loose flute phrase.wav", path: "/audio/flute-phrase.wav", durationSeconds: 3.2 },
    { id: "audio-vox", name: "Vocal texture.wav", path: "/audio/vocal-texture.wav", durationSeconds: 1.8 },
    { id: "audio-noise", name: "Noisy foley hit.wav", path: "/audio/noisy-foley.wav", durationSeconds: 0.7 },
  ];
}

function instrument(id, name, overrides = {}) {
  return {
    id,
    name,
    kind: "sampler",
    envelope: { attackMs: 2, decayMs: 100, sustain: 0.2, releaseMs: 120 },
    knobs: { cutoff: 0.7, resonance: 0.1, drive: 0.05, color: 0.5 },
    waveform: "sample",
    sampleIds: [],
    userCreated: false,
    ...overrides,
  };
}

function baseInstrument(targetKind) {
  return {
    id: `base-${targetKind}`,
    name: `Base ${targetKind}`,
    kind: targetKind,
    waveform: targetKind === "wavetable" ? "wavetable" : targetKind === "sampler" ? "sample" : "saw",
    envelope: { attackMs: 5, decayMs: 160, sustain: 0.55, releaseMs: 260 },
    knobs: { cutoff: 0.62, resonance: 0.12, drive: 0.08, color: 0.48 },
    detuneCents: 0,
    octave: 0,
    subOscLevel: 0,
    glideMs: 0,
    sampleIds: [],
    userCreated: false,
  };
}

function instrumentPromptFor(targetKind) {
  if (targetKind === "wavetable") return "novel wide aggressive evolving bass lead, strange oscillator movement";
  if (targetKind === "sampler") return "dusty sampled flute bell vocal texture with unusual attack";
  if (targetKind === "hybrid") return "hybrid punchy sampled transient with synthetic metallic tail";
  return "novel dynamic synth patch, not a preset, surprising macro identity";
}

function midiStyleFor(role) {
  if (role === "bass") return "syncopated bassline with a compact chorus hook";
  if (role === "chords") return "chorus chord progression with alternate voicings";
  if (role === "arp") return "evolving arpeggio pattern, dynamic rhythm";
  if (role === "countermelody") return "answering countermelody phrase";
  return "main melody hook, one phrase only";
}

function summarizeInstrumentBatch(category, prompt, outputs) {
  const patches = outputs.map((entry) => entry.generated.patch);
  const fingerprints = patches.map(instrumentFingerprint);
  const kinds = countBy(patches.map((patch) => patch.kind ?? "unknown"));
  const waveforms = countBy(patches.map((patch) => patch.waveform ?? "unknown"));
  const sampleUrls = countBy(patches.map((patch) => patch.sampleUrl ?? "none"));
  const prefixes = countBy(patches.map((patch) => String(patch.name ?? "").split(/\s+/)[0] || "none"));
  const numericVectors = patches.map(instrumentVector);
  const pairwiseDistance = avgPairwise(numericVectors, vectorDistance);
  const categoricalDistance = avgPairwise(fingerprints.map((fp) => fp.split("|")), jaccardArrayDistance);
  const schemaCoverage = instrumentSchemaCoverage(category, patches);
  const flags = [];
  if (new Set(fingerprints).size < Math.ceil(outputs.length * 0.8)) flags.push("low exact uniqueness");
  if (pairwiseDistance < 0.18) flags.push("low numeric movement");
  if (category === "hybrid" && Object.keys(waveforms).length < 3) flags.push("hybrid waveform converges");
  if (category === "sampler" && Object.keys(sampleUrls).filter((key) => key !== "none").length < 2) flags.push("sample choice converges");
  if (schemaCoverage.targetKindMatches !== schemaCoverage.total) flags.push("target kind mismatch");
  if (schemaCoverage.aetherEligible > 0 && schemaCoverage.aetherStackComplete !== schemaCoverage.aetherEligible) flags.push("incomplete Aether stack");
  if (schemaCoverage.aetherEligible > 0 && schemaCoverage.canonicalSynthPatch !== schemaCoverage.aetherEligible) flags.push("missing canonical synth patch");
  if (schemaCoverage.finiteCoreValues !== schemaCoverage.total) flags.push("non-finite core values");
  return {
    category,
    prompt,
    uniqueFingerprints: new Set(fingerprints).size,
    pairwiseDistance: round(pairwiseDistance),
    categoricalDistance: round(categoricalDistance),
    schemaCoverage,
    kinds,
    waveforms,
    sampleUrls,
    prefixes,
    ranges: {
      attackMs: range(patches.map((patch) => patch.envelope?.attackMs ?? 0)),
      releaseMs: range(patches.map((patch) => patch.envelope?.releaseMs ?? 0)),
      cutoff: range(patches.map((patch) => patch.knobs?.cutoff ?? 0)),
      drive: range(patches.map((patch) => patch.knobs?.drive ?? 0)),
      lfoDepth: range(patches.map((patch) => patch.lfoDepth ?? 0)),
      lfoToPitch: range(patches.map((patch) => patch.lfoToPitch ?? 0)),
      glideMs: range(patches.map((patch) => patch.glideMs ?? 0)),
    },
    examples: patches.slice(0, 3).map((patch) => ({
      name: patch.name,
      kind: patch.kind,
      waveform: patch.waveform,
      sampleUrl: patch.sampleUrl,
      envelope: patch.envelope,
      knobs: patch.knobs,
    })),
    flags,
  };
}

function instrumentSchemaFailures(result) {
  const coverage = result.schemaCoverage;
  const failures = [];
  if (coverage.targetKindMatches !== coverage.total) failures.push(`${result.category}: requested kind ${coverage.targetKindMatches}/${coverage.total}`);
  if (coverage.aetherEligible > 0 && coverage.aetherStackComplete !== coverage.aetherEligible) failures.push(`${result.category}: Aether stack ${coverage.aetherStackComplete}/${coverage.aetherEligible}`);
  if (coverage.aetherEligible > 0 && coverage.canonicalSynthPatch !== coverage.aetherEligible) failures.push(`${result.category}: canonical synth patch ${coverage.canonicalSynthPatch}/${coverage.aetherEligible}`);
  if (coverage.finiteCoreValues !== coverage.total) failures.push(`${result.category}: finite core values ${coverage.finiteCoreValues}/${coverage.total}`);
  return failures;
}

function instrumentSchemaCoverage(category, patches) {
  const expectedKind = category === "synth" ? "wavetable" : category;
  const aetherPatches = patches.filter((patch) => patch.kind === "wavetable");
  return {
    total: patches.length,
    targetKindMatches: patches.filter((patch) => patch.kind === expectedKind).length,
    aetherEligible: aetherPatches.length,
    aetherStackComplete: aetherPatches.filter((patch) => (
      patch.waveform === "wavetable"
      && patch.aether?.oscA?.enabled === true
      && patch.aether?.oscA?.wavetable
      && patch.wavetable
    )).length,
    canonicalSynthPatch: aetherPatches.filter((patch) => (
      patch.synthPatch
      && typeof patch.synthPatch === "object"
      && patch.synthPatch.parameters
      && typeof patch.synthPatch.parameters === "object"
      && patch.synthPatch.parameters["osc.a.enabled"] === true
    )).length,
    finiteCoreValues: patches.filter(hasFiniteInstrumentCore).length,
  };
}

function hasFiniteInstrumentCore(patch) {
  const values = [
    patch.envelope?.attackMs,
    patch.envelope?.decayMs,
    patch.envelope?.sustain,
    patch.envelope?.releaseMs,
    patch.knobs?.cutoff,
    patch.knobs?.resonance,
    patch.knobs?.drive,
    patch.knobs?.color,
    patch.detuneCents,
    patch.octave,
    patch.glideMs,
    patch.lfoRateHz,
    patch.lfoDepth,
  ];
  if (patch.kind === "wavetable") {
    values.push(
      patch.wavetable?.position,
      patch.wavetable?.warp,
      patch.wavetable?.unison,
      patch.aether?.oscA?.level,
      patch.aether?.oscA?.pan,
      patch.aether?.oscA?.fineCents,
    );
  }
  return values.every((value) => Number.isFinite(value));
}

function instrumentFingerprint(patch) {
  return [
    patch.kind,
    patch.waveform,
    patch.sampleUrl ?? "none",
    bucket(patch.envelope?.attackMs, 100),
    bucket(patch.envelope?.decayMs, 120),
    bucket((patch.envelope?.sustain ?? 0) * 100, 10),
    bucket(patch.envelope?.releaseMs, 160),
    bucket((patch.knobs?.cutoff ?? 0) * 100, 10),
    bucket((patch.knobs?.resonance ?? 0) * 100, 10),
    bucket((patch.knobs?.drive ?? 0) * 100, 10),
    bucket((patch.knobs?.color ?? 0) * 100, 10),
    patch.lfoWaveform ?? "none",
    bucket(patch.lfoRateHz, 2),
    bucket((patch.lfoDepth ?? 0) * 100, 10),
    patch.wavetable?.bank ?? "none",
    patch.aether?.oscA?.waveform ?? "none",
    patch.aether?.oscB?.enabled ? patch.aether?.oscB?.waveform ?? "oscB" : "no-oscB",
    patch.aether?.sub?.enabled ? patch.aether?.sub?.waveform ?? "sub" : "no-sub",
    patch.aether?.noise?.enabled ? "noise" : "no-noise",
  ].join("|");
}

function instrumentVector(patch) {
  return [
    normalize(patch.envelope?.attackMs ?? 0, 5000),
    normalize(patch.envelope?.decayMs ?? 0, 5000),
    patch.envelope?.sustain ?? 0,
    normalize(patch.envelope?.releaseMs ?? 0, 10000),
    patch.knobs?.cutoff ?? 0,
    patch.knobs?.resonance ?? 0,
    patch.knobs?.drive ?? 0,
    patch.knobs?.color ?? 0,
    normalize(Math.abs(patch.detuneCents ?? 0), 100),
    normalize((patch.octave ?? 0) + 3, 6),
    patch.subOscLevel ?? 0,
    normalize(patch.glideMs ?? 0, 500),
    normalize(patch.lfoRateHz ?? 0, 20),
    patch.lfoDepth ?? 0,
    normalize(patch.lfoToPitch ?? 0, 12),
    normalize((patch.lfoToFilter ?? 0) + 1, 2),
    normalize((patch.envToFilter ?? 0) + 1, 2),
    patch.wavetable?.position ?? 0,
    patch.wavetable?.warp ?? 0,
    normalize(patch.wavetable?.unison ?? 0, 16),
    patch.wavetable?.blend ?? 0,
  ];
}

function summarizeBeatBatch(category, beats) {
  const fingerprints = beats.map(beatFingerprint);
  const rhythmSets = beats.map(beatRhythmSet);
  const rhythmDistance = avgPairwise(rhythmSets, jaccardSetDistance);
  const rowCounts = beats.map((beat) => beat.rows.length);
  const hits = beats.map((beat) => hitCount(beat.rows));
  const speeds = beats.map((beat) => beat.speed);
  const swings = beats.map((beat) => beat.swingPercent);
  const rowNameSets = beats.map((beat) => beat.rows.map((row) => row.name).sort().join(", "));
  const velocitySpans = beats.map((beat) => {
    const velocities = beat.rows.flatMap((row) => row.steps.map((step) => typeof step === "object" && step?.on ? step.velocity ?? 0 : null).filter((value) => value != null));
    return velocities.length ? Math.max(...velocities) - Math.min(...velocities) : 0;
  });
  const flags = [];
  if (new Set(fingerprints).size < Math.ceil(beats.length * 0.8)) flags.push("low exact uniqueness");
  if (rhythmDistance < 0.35) flags.push("rhythm converges");
  if (range(hits).max - range(hits).min < 8) flags.push("hit density range narrow");
  if (new Set(rowNameSets).size < Math.ceil(beats.length * 0.5)) flags.push("instrumentation converges");
  return {
    category,
    uniqueFingerprints: new Set(fingerprints).size,
    rhythmDistance: round(rhythmDistance),
    rows: range(rowCounts),
    hits: range(hits),
    speed: range(speeds),
    swing: range(swings),
    velocitySpan: range(velocitySpans),
    uniqueRowSets: new Set(rowNameSets).size,
    commonRows: topCounts(rowNameSets),
    examples: beats.slice(0, 3).map((beat) => ({
      rows: beat.rows.map((row) => ({
        name: row.name,
        hits: row.steps.map((step, index) => step ? index + 1 : null).filter(Boolean),
      })),
      speed: beat.speed,
      swingPercent: beat.swingPercent,
    })),
    flags,
  };
}

function beatFingerprint(beat) {
  return beat.rows.map((row) => {
    const hits = row.steps.map((step, index) => step ? `${index + 1}:${typeof step === "object" ? bucket(step.velocity ?? 0, 12) : "x"}` : null).filter(Boolean);
    return `${row.name}=${hits.join(".")}`;
  }).sort().join("|");
}

function beatRhythmSet(beat) {
  return new Set(beat.rows.flatMap((row) => row.steps.map((step, index) => step ? `${row.name}:${index + 1}` : null).filter(Boolean)));
}

function summarizeMidiBatch(category, patterns) {
  const fingerprints = patterns.map(midiFingerprint);
  const eventSets = patterns.map(midiEventSet);
  const pitchSets = patterns.map((notes) => new Set(notes.map((note) => note.pitch)));
  const rhythmSets = patterns.map((notes) => new Set(notes.map((note) => `${round(note.startBeat)}:${round(note.lengthBeats)}`)));
  const eventDistance = avgPairwise(eventSets, jaccardSetDistance);
  const pitchDistance = avgPairwise(pitchSets, jaccardSetDistance);
  const rhythmDistance = avgPairwise(rhythmSets, jaccardSetDistance);
  const pitchSpans = patterns.map((notes) => notes.length ? Math.max(...notes.map((note) => note.pitch)) - Math.min(...notes.map((note) => note.pitch)) : 0);
  const activeSpans = patterns.map((notes) => notes.length ? Math.max(...notes.map((note) => note.startBeat + note.lengthBeats)) - Math.min(...notes.map((note) => note.startBeat)) : 0);
  const durationVariety = patterns.map((notes) => new Set(notes.map((note) => round(note.lengthBeats))).size);
  const flags = [];
  if (new Set(fingerprints).size < Math.ceil(patterns.length * 0.8)) flags.push("low exact uniqueness");
  if (eventDistance < 0.5) flags.push("event pattern converges");
  if (pitchDistance < 0.38) flags.push("pitch set converges");
  if (rhythmDistance < 0.38) flags.push("rhythm shape converges");
  return {
    category,
    uniqueFingerprints: new Set(fingerprints).size,
    eventDistance: round(eventDistance),
    pitchDistance: round(pitchDistance),
    rhythmDistance: round(rhythmDistance),
    pitchSpan: range(pitchSpans),
    activeSpan: range(activeSpans),
    durationVariety: range(durationVariety),
    examples: patterns.slice(0, 3).map((notes) => notes.map((note) => ({
      pitch: note.pitch,
      startBeat: note.startBeat,
      lengthBeats: note.lengthBeats,
      velocity: note.velocity,
    }))),
    flags,
  };
}

function midiFingerprint(notes) {
  return notes.map((note) => `${note.pitch}@${bucket(note.startBeat * 16, 1)}:${bucket(note.lengthBeats * 16, 1)}:${bucket(note.velocity, 10)}`).join("|");
}

function midiEventSet(notes) {
  return new Set(notes.map((note) => `${note.pitch}@${bucket(note.startBeat * 8, 1)}:${bucket(note.lengthBeats * 8, 1)}`));
}

function hitCount(rows) {
  return rows.reduce((total, row) => total + row.steps.filter(Boolean).length, 0);
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function topCounts(values) {
  return Object.entries(countBy(values))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([value, count]) => ({ value, count }));
}

function range(values) {
  return {
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    avg: round(values.reduce((total, value) => total + value, 0) / values.length),
  };
}

function bucket(value, size) {
  return Math.round((Number(value) || 0) / size) * size;
}

function normalize(value, max) {
  return Math.max(0, Math.min(1, (Number(value) || 0) / max));
}

function vectorDistance(a, b) {
  const length = Math.max(a.length, b.length);
  let total = 0;
  for (let i = 0; i < length; i += 1) total += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return total / length;
}

function jaccardArrayDistance(a, b) {
  return jaccardSetDistance(new Set(a), new Set(b));
}

function jaccardSetDistance(a, b) {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return 1 - intersection / union.size;
}

function avgPairwise(items, distance) {
  let total = 0;
  let count = 0;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      total += distance(items[i], items[j]);
      count += 1;
    }
  }
  return count ? total / count : 0;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function renderReport({ runsPerCategory, mode, instrumentResults, beatResults, midiResults }) {
  return `# Generation Diversity Audit

Mode: ${mode}
Runs per category: ${runsPerCategory}

Goal: measure divergence. Higher uniqueness and distance are better when the user repeatedly asks for a generated idea. This audit values dynamic range over strict convergence.

## Instrument Generation

${instrumentResults.map(renderInstrumentResult).join("\n\n")}

## Beat Generation

${beatResults.map(renderBeatResult).join("\n\n")}

## MIDI Generation

${midiResults.map(renderMidiResult).join("\n\n")}

## Readout

- Instrument generation is strongest when it can switch kind, wavetable stack, sample choice, envelope shape, and modulation at the same time.
- Beat generation is strongest when genre anchors stay intact but row count, texture rows, hit density, velocity spans, swing, and fills move materially between seeds.
- MIDI generation is strongest when one phrase changes rhythm, contour, voicing, pitch span, and note density while staying inside the selected role.
- Categories with flags should receive generator changes before UI changes; the UI can expose controls later, but the backend/procedural layer needs enough entropy first.
`;
}

function renderInstrumentResult(result) {
  return `### ${result.category}

- Prompt: ${result.prompt}
- Unique fingerprints: ${result.uniqueFingerprints}
- Numeric pairwise distance: ${result.pairwiseDistance}
- Categorical pairwise distance: ${result.categoricalDistance}
- Schema coverage: ${jsonInline(result.schemaCoverage)}
- Kinds: ${jsonInline(result.kinds)}
- Waveforms: ${jsonInline(result.waveforms)}
- Samples: ${jsonInline(result.sampleUrls)}
- Name prefixes: ${jsonInline(result.prefixes)}
- Ranges: ${jsonInline(result.ranges)}
- Flags: ${result.flags.length ? result.flags.join(", ") : "none"}
- Examples: ${jsonInline(result.examples)}
`;
}

function renderBeatResult(result) {
  return `### ${result.category}

- Unique fingerprints: ${result.uniqueFingerprints}
- Rhythm pairwise distance: ${result.rhythmDistance}
- Rows: ${jsonInline(result.rows)}
- Hits: ${jsonInline(result.hits)}
- Speed: ${jsonInline(result.speed)}
- Swing: ${jsonInline(result.swing)}
- Velocity span: ${jsonInline(result.velocitySpan)}
- Unique row sets: ${result.uniqueRowSets}
- Most common row sets: ${jsonInline(result.commonRows)}
- Flags: ${result.flags.length ? result.flags.join(", ") : "none"}
- Examples: ${jsonInline(result.examples)}
`;
}

function renderMidiResult(result) {
  return `### ${result.category}

- Unique fingerprints: ${result.uniqueFingerprints}
- Event pairwise distance: ${result.eventDistance}
- Pitch pairwise distance: ${result.pitchDistance}
- Rhythm pairwise distance: ${result.rhythmDistance}
- Pitch span: ${jsonInline(result.pitchSpan)}
- Active phrase span: ${jsonInline(result.activeSpan)}
- Duration-shape variety: ${jsonInline(result.durationVariety)}
- Flags: ${result.flags.length ? result.flags.join(", ") : "none"}
- Examples: ${jsonInline(result.examples)}
`;
}

function jsonInline(value) {
  return `\`${JSON.stringify(value)}\``;
}
