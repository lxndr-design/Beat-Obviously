#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-drum-generation-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/ai/drumBeatGenerator.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outdir=${outDir}`,
    ],
    { stdio: "inherit" },
  );

  const drums = await import(pathToFileURL(join(outDir, "drumBeatGenerator.js")));
  const instruments = [
    instrument("kick", "Kick"),
    instrument("snare", "Snare"),
    instrument("hat", "Closed Hat"),
    instrument("open-hat", "Open Hat"),
    instrument("crash", "Crash"),
    instrument("rim", "Rim"),
    instrument("tom-mid", "Mid Tom"),
    instrument("tom-low", "Low Tom"),
    instrument("tom-high", "High Tom"),
    instrument("ride", "Ride"),
    instrument("cowbell", "Cowbell"),
    instrument("amen", "Uploaded Amen Break", { userCreated: true, sampleUrl: "/samples/amen.wav", descriptors: ["amen", "breakbeat", "chopped"] }),
    instrument("shaker", "Uploaded Pop Shaker", { userCreated: true, sampleUrl: "/samples/shaker.wav", descriptors: ["shaker"] }),
    instrument("vinyl-perc", "Vinyl Percussion", { userCreated: true, sampleUrl: "/samples/vinyl-perc.wav", descriptors: ["vinyl", "percussion"] }),
  ];
  const opts = {
    genre: "funk",
    instruments,
    stepCount: 16,
    lengthBeats: 16,
    speed: 4,
    timeSignature: { num: 4, denom: 4, boldBeats: [1, 3] },
    complexity: 50,
    variationSeed: 4242,
  };

  const beat = drums.generateLocalDrumBeat(opts);
  assert.equal(beat.rows.length >= 3, true);
  assert.equal(beat.lengthBeats, 16);
  assert.equal(beat.stepCount, 16);
  assertVelocityShape(beat.rows, "local beat");

  const sanitized = drums.sanitizeGeneratedDrumBeat({
    rows: [
      { instrumentId: "kick", name: "Kick", steps: hitSteps([1, 5, 9, 13], 16, 80) },
      { instrumentId: "snare", name: "Snare", steps: hitSteps([5, 13], 16, 80) },
      { instrumentId: "hat", name: "Hat", steps: hitSteps([1, 3, 5, 7, 9, 11, 13, 15], 16, 80) },
    ],
    stepCount: 16,
    lengthBeats: 16,
    speed: 4,
    swingPercent: 50,
  }, opts);
  assert.ok(sanitized);
  assertVelocityShape(sanitized.rows, "sanitized model beat");

  const sanitizedExtended = drums.sanitizeGeneratedDrumBeat({
    rows: [
      { instrumentId: "kick", name: "Kick", steps: hitSteps([1, 33, 65, 97], 128, 92) },
      { instrumentId: "snare", name: "Snare", steps: hitSteps([17, 49, 81, 113], 128, 96) },
      { instrumentId: "hat", name: "Hat", steps: hitSteps([1, 9, 17, 25, 33, 41, 49, 57, 65, 73, 81, 89, 97, 105, 113, 121], 128, 54) },
    ],
    stepCount: 128,
    lengthBeats: 128,
    speed: 6,
    swingPercent: 50,
  }, { ...opts, genre: "breakcore", lengthBeats: 128, stepCount: 128, speed: 4, complexity: 95 });
  assert.ok(sanitizedExtended);
  assert.equal(sanitizedExtended.lengthBeats, 128, "sanitized 128-cell model beat should keep its grid length");
  assert.equal(sanitizedExtended.speed, 4, "sanitizer should cap long model beats to a playable grid speed");

  const breakcoreLow = breakcoreBatch(drums, opts, "low", 10, [510, 511, 512]);
  const breakcoreMid = breakcoreBatch(drums, opts, "mid", 50, [550, 551, 552]);
  const breakcoreHigh = breakcoreBatch(drums, opts, "high", 95, [595, 596, 597]);
  const breakcoreLong = breakcoreBatch(drums, { ...opts, lengthBeats: 64, stepCount: 64, speed: 4 }, "long", 95, [695, 696, 697]);
  const breakcoreExtended = breakcoreBatch(drums, { ...opts, lengthBeats: 128, stepCount: 128, speed: 4 }, "extended", 95, [795, 796, 797]);
  assertBatchDuration(breakcoreLow);
  assertBatchDuration(breakcoreMid);
  assertBatchDuration(breakcoreHigh);
  assertBatchDuration(breakcoreLong, 16);
  assertBatchDuration(breakcoreExtended, 32);
  assert.equal(minRows(breakcoreLow) <= minRows(breakcoreMid), true, "mid complexity should not use fewer rows than low");
  assert.equal(minRows(breakcoreMid) <= minRows(breakcoreHigh), true, "high complexity should not use fewer rows than mid");
  assert.equal(maxRows(breakcoreHigh) <= 7, true, "high complexity may add texture rows but should remain editable");
  assert.equal(avgHits(breakcoreLow) < avgHits(breakcoreHigh), true, "high complexity should add hit density");
  assert.equal(breakcoreContainsTom(drums, opts, 50), false, "ideal Breakcore should not add tom rows");
  assert.equal(maxHits(breakcoreHigh) <= 120, true, "high complexity should stay spaced, not saturate every cell");
  assert.equal(maxSpeed(breakcoreHigh) <= 6, true, "generated speed should stay inside the 1-6 range");
  assert.equal(maxSpeed(breakcoreLong) <= 4, true, "long high-complexity Breakcore should not force max speed");
  assert.equal(maxSpeed(breakcoreExtended) <= 4, true, "128-cell Breakcore should use length for detail, not max speed");
  assert.equal(maxLength(breakcoreExtended), 128, "drum generator should support 128-cell loops");
  assert.equal(uniqueRows(breakcoreHigh) > 1 || uniqueHits(breakcoreHigh) > 1, true, "different seeds should vary the assembled groove profile");
  assertGenreAnchors(drums, opts);

  console.log(JSON.stringify({
    ok: true,
    localRows: beat.rows.length,
    sanitizedRows: sanitized.rows.length,
    breakcore: [
      batchSummary(breakcoreLow),
      batchSummary(breakcoreMid),
      batchSummary(breakcoreHigh),
      batchSummary(breakcoreLong),
      batchSummary(breakcoreExtended),
    ],
  }));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

function instrument(id, name, overrides = {}) {
  return {
    id,
    name,
    kind: "sampler",
    envelope: { attackMs: 1, decayMs: 80, sustain: 0, releaseMs: 80 },
    knobs: { cutoff: 1, resonance: 0, drive: 0, color: 0.5 },
    waveform: "sample",
    sampleIds: [],
    userCreated: false,
    ...overrides,
  };
}

function hitSteps(steps, count, velocity) {
  const out = Array.from({ length: count }, () => false);
  for (const step of steps) out[step - 1] = { on: true, velocity };
  return out;
}

function assertVelocityShape(rows, label) {
  const velocities = rows.flatMap((row) => row.steps
    .map((step) => typeof step === "object" && step?.on ? step.velocity : undefined)
    .filter((value) => typeof value === "number"));
  assert.equal(velocities.length > 0, true, `${label} should contain velocity-bearing hits`);
  assert.equal(Math.max(...velocities) > Math.min(...velocities), true, `${label} should vary hit volume`);
  assert.equal(Math.max(...velocities) >= 90, true, `${label} should include accented hits`);
  assert.equal(Math.min(...velocities) <= 80, true, `${label} should include lighter supporting hits`);
}

function hitCount(rows) {
  return rows.reduce((total, row) => total + row.steps.filter(Boolean).length, 0);
}

function summary(label, beat) {
  return {
    label,
    rows: beat.rows.length,
    speed: beat.speed,
    lengthBeats: beat.lengthBeats,
    durationBeats: beat.lengthBeats / beat.speed,
    hits: hitCount(beat.rows),
  };
}

function breakcoreBatch(drums, opts, label, complexity, seeds) {
  return seeds.map((variationSeed) => drums.generateLocalDrumBeat({
    ...opts,
    genre: "breakcore",
    complexity,
    variationSeed,
  })).map((beat) => summary(label, beat));
}

function breakcoreContainsTom(drums, opts, complexity) {
  const beat = drums.generateLocalDrumBeat({
    ...opts,
    genre: "breakcore",
    complexity,
    variationSeed: 850,
  });
  return beat.rows.some((row) => /tom/i.test(row.name));
}

function assertBatchDuration(batch, durationBeats = 4) {
  for (const beat of batch) assert.equal(beat.durationBeats, durationBeats, `${beat.label} complexity should preserve phrase duration`);
}

function minRows(batch) {
  return Math.min(...batch.map((beat) => beat.rows));
}

function maxRows(batch) {
  return Math.max(...batch.map((beat) => beat.rows));
}

function maxHits(batch) {
  return Math.max(...batch.map((beat) => beat.hits));
}

function maxSpeed(batch) {
  return Math.max(...batch.map((beat) => beat.speed));
}

function maxLength(batch) {
  return Math.max(...batch.map((beat) => beat.lengthBeats));
}

function avgHits(batch) {
  return batch.reduce((total, beat) => total + beat.hits, 0) / batch.length;
}

function uniqueRows(batch) {
  return new Set(batch.map((beat) => beat.rows)).size;
}

function uniqueHits(batch) {
  return new Set(batch.map((beat) => beat.hits)).size;
}

function batchSummary(batch) {
  return {
    label: batch[0]?.label,
    rows: range(batch.map((beat) => beat.rows)),
    speed: range(batch.map((beat) => beat.speed)),
    lengthBeats: range(batch.map((beat) => beat.lengthBeats)),
    durationBeats: range(batch.map((beat) => beat.durationBeats)),
    hits: range(batch.map((beat) => beat.hits)),
  };
}

function assertGenreAnchors(drums, opts) {
  const rock = drums.generateLocalDrumBeat({ ...opts, genre: "rock", lengthBeats: 16, stepCount: 16, speed: 4, complexity: 45, variationSeed: 900 });
  assertSteps(rowByName(rock, /kick/i), [1, 9], "Rock kick should anchor 1 and 3");
  assertSteps(rowByName(rock, /snare/i), [5, 13], "Rock snare should anchor 2 and 4");

  const house = drums.generateLocalDrumBeat({ ...opts, genre: "house", lengthBeats: 16, stepCount: 16, speed: 4, complexity: 45, variationSeed: 901 });
  assertSteps(rowByName(house, /kick/i), [1, 5, 9, 13], "House should keep four-on-the-floor kicks");
  assertSteps(rowByName(house, /clap|snare/i), [5, 13], "House clap should land on 2 and 4");
  assertSteps(rowByName(house, /open hat/i), [3, 7, 11, 15], "House open hats should land on offbeats");

  const reggae = drums.generateLocalDrumBeat({ ...opts, genre: "reggae", lengthBeats: 16, stepCount: 16, speed: 4, complexity: 45, variationSeed: 902 });
  assert.equal(stepOn(rowByName(reggae, /kick/i), 1), false, "Reggae one-drop should not add a kick on beat 1");
  assertSteps(rowByName(reggae, /kick/i), [9], "Reggae kick should emphasize beat 3");
  assertSteps(rowByName(reggae, /rim|snare/i), [9], "Reggae rim/snare should emphasize beat 3");

  const trap = drums.generateLocalDrumBeat({ ...opts, genre: "trap", lengthBeats: 16, stepCount: 16, speed: 4, complexity: 50, variationSeed: 903 });
  assert.equal(trap.speed, 4, "Trap should keep a playable base grid at ideal complexity");
  assertSteps(rowByName(trap, /snare/i), [9], "Trap snare should be half-time on beat 3");
  assert.equal(stepOn(rowByName(trap, /snare/i), 5), false, "Trap snare should not use beat 2");
  assert.equal(stepOn(rowByName(trap, /snare/i), 13), false, "Trap snare should not use beat 4");

  const drill = drums.generateLocalDrumBeat({ ...opts, genre: "drill", lengthBeats: 16, stepCount: 16, speed: 4, complexity: 50, variationSeed: 904 });
  assertSteps(rowByName(drill, /snare/i), [9], "Drill snare should be on beat 3");
  assert.equal(hitCount([rowByName(drill, /hat/i)]) >= 8, true, "Drill should include triplet hat motion");

  const dnb = drums.generateLocalDrumBeat({ ...opts, genre: "dnb", lengthBeats: 16, stepCount: 16, speed: 4, complexity: 50, variationSeed: 905 });
  assert.equal(dnb.speed <= 6, true, "DnB speed should stay inside the playable 1-6 range");
  assertSteps(rowByName(dnb, /snare/i), [6, 16], "DnB snare should hit beats 2 and 4 on the higher-resolution grid");
  assertSteps(rowByName(dnb, /kick/i), [1, 11], "DnB should include kick on 1 plus syncopation");

  const breakcore = drums.generateLocalDrumBeat({ ...opts, genre: "breakcore", lengthBeats: 16, stepCount: 16, speed: 4, complexity: 95, variationSeed: 906 });
  assert.equal(Boolean(rowByName(breakcore, /amen break/i)), true, "Breakcore should use an uploaded Amen/breakbeat instrument when available");

  const jazz = drums.generateLocalDrumBeat({ ...opts, genre: "jazz", lengthBeats: 16, stepCount: 16, speed: 4, complexity: 58, variationSeed: 907 });
  assert.ok(jazz.swingPercent >= 58, "Jazz should use an audible swung subdivision");
  assert.equal(hitCount([rowByName(jazz, /ride/i)]) >= 4, true, "Jazz should be led by a ride pattern");
  assertSteps(rowByName(jazz, /closed hat/i), [jazz.speed + 1, jazz.speed * 3 + 1], "Jazz hi-hat foot should mark beats 2 and 4");
  assertVelocityShape(jazz.rows, "jazz beat");

  const orchestralInstruments = [
    instrument("orchestral-bass-drum", "VSCO Orchestral Bass Drum", { descriptors: ["bass drum"] }),
    instrument("orchestral-snare", "Pearl Orchestral Snare"),
    instrument("closed-hat", "Pearl Closed Hi-Hat"),
    instrument("open-hat", "Pearl Open Hi-Hat"),
    instrument("ride-cymbal", "Pearl Ride Cymbal"),
    instrument("crash-cymbal", "Pearl Crash Cymbal"),
    instrument("low-tom", "Pearl Low Tom"),
    instrument("mid-tom", "Pearl Mid Tom"),
    instrument("high-tom", "Pearl High Tom"),
  ];
  const orchestral = drums.generateLocalDrumBeat({ ...opts, genre: "orchestral", instruments: orchestralInstruments, lengthBeats: 64, stepCount: 64, speed: 4, complexity: 58, variationSeed: 908 });
  assert.ok(rowByName(orchestral, /bass drum/i), "Orchestral bass drum labels should resolve as the kick role");
  assert.ok(orchestral.rows.length >= 3, "Orchestral percussion should distribute a phrase across multiple timbres");
  assert.equal(
    orchestral.rows.some((row) => /crash|cymbal|ride|hat/i.test(row.name) && stepOn(row, 1)),
    false,
    "Orchestral loops must not retrigger a cymbal at the start of every segment",
  );
  assertVelocityShape(orchestral.rows, "orchestral phrase");

  const remixSource = {
    rows: [
      { id: "kick", instrumentId: "kick", name: "Kick", steps: [{ on: true, velocity: 112 }, false, false, false, { on: true, velocity: 100 }, false, false, false] },
      { id: "hat", instrumentId: "hat", name: "Closed Hat", steps: [{ on: true, velocity: 68 }, false, { on: true, velocity: 62 }, false, { on: true, velocity: 66 }, false, { on: true, velocity: 60 }, false] },
      { id: "crash", instrumentId: "crash", name: "Suspended Cymbal", steps: [{ on: true, velocity: 86 }, false, false, false, false, false, false, false] },
    ],
    stepCount: 8,
    lengthBeats: 8,
    speed: 4,
    swingPercent: 54,
    variationSeed: 909,
  };
  const remixed = drums.remixDrumBeat(remixSource);
  assert.deepEqual(remixed.rows.map((row) => row.id), remixSource.rows.map((row) => row.id), "Remix should preserve row identity");
  assert.deepEqual(remixed.rows.map((row) => row.instrumentId), remixSource.rows.map((row) => row.instrumentId), "Remix should preserve instrument assignments");
  assert.equal(stepOn(rowByName(remixed, /cymbal/i), 1), false, "Remix should move an opening cymbal away from the loop boundary");
  assert.notDeepEqual(remixed.rows, remixSource.rows, "Remix should produce an audible pattern variation");
}

function rowByName(beat, pattern) {
  const row = beat.rows.find((candidate) => pattern.test(candidate.name));
  assert.ok(row, `Expected row matching ${pattern}`);
  return row;
}

function stepOn(row, stepOneBased) {
  const step = row.steps[stepOneBased - 1];
  return typeof step === "object" && step !== null ? Boolean(step.on) : Boolean(step);
}

function assertSteps(row, steps, message) {
  for (const step of steps) assert.equal(stepOn(row, step), true, `${message}: missing step ${step}`);
}

function range(values) {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10,
  };
}
