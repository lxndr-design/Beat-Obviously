#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const SOURCE_REVISION = "6dd651d55dde97fd4028699be9d4481f26917891";
const REPOSITORY = "sgossner/VSCO-2-CE";
const repoRoot = join(import.meta.dirname, "..");
const publicRoot = join(repoRoot, "frontend/public/samples/vsco-score");
const generatedTarget = join(repoRoot, "frontend/src/state/factoryScoreSamplerManifest.generated.ts");
const dryRun = process.argv.includes("--dry-run");
const sustainedEnvelope = { attackMs: 20, decayMs: 1600, sustain: 0.82, releaseMs: 480 };

const instruments = [
  scoreInstrument("piccolo", "VSCO Piccolo Sustain", "PiccoloSus.sfz", "Woodwinds/Piccolo/Sus", "woodwinds", "piccolo", [72, 108]),
  scoreInstrument("flute", "VSCO Flute Sustain", "FluteSusVib.sfz", "Woodwinds/Flute/susvib", "woodwinds", "flute", [60, 96]),
  scoreInstrument("oboe", "VSCO Oboe Sustain", "OboeSusVib.sfz", "Woodwinds/Oboe/Vib", "woodwinds", "oboe", [58, 91]),
  scoreInstrument("clarinet", "VSCO Clarinet Sustain", "ClarinetSus.sfz", "Woodwinds/Clarinet/susLong", "woodwinds", "clarinet", [50, 94]),
  scoreInstrument("bassoon", "VSCO Bassoon Sustain", "BassoonSus.sfz", "Woodwinds/Bassoon/sus", "woodwinds", "bassoon", [34, 77]),
  scoreInstrument("french-horn", "VSCO French Horn Sustain", "FHornSus.sfz", "Brass/F Horn/sus", "brass", "french_horn", [33, 77], { attackMs: 22, releaseMs: 520 }),
  scoreInstrument("trumpet", "VSCO Trumpet Sustain", "TrumpetSus.sfz", "Brass/Trumpet/sus", "brass", "trumpet", [54, 86], { attackMs: 12, releaseMs: 360 }),
  scoreInstrument("trombone", "VSCO Trombone Sustain", "TromboneSus.sfz", "Brass/Tenor Trombone/sus", "brass", "trombone", [34, 74], { attackMs: 16, releaseMs: 420 }),
  scoreInstrument("tuba", "VSCO Tuba Sustain", "TubaSus.sfz", "Brass/Tuba/sus", "brass", "tuba", [32, 67], { attackMs: 18, releaseMs: 480 }),
  scoreInstrument("violin-section", "VSCO Violin Section Sustain", "ViolinEnsSusVib.sfz", "Strings/Violin Section/susVib", "strings", "violin_section", [55, 103], { attackMs: 30, releaseMs: 680 }),
  scoreInstrument("viola-section", "VSCO Viola Section Sustain", "ViolaEnsSusVib.sfz", "Strings/Viola Section/susvib", "strings", "viola_section", [48, 91], { attackMs: 34, releaseMs: 720 }),
  scoreInstrument("cello-section", "VSCO Cello Section Sustain", "CelloEnsSusVib.sfz", "Strings/Cello Section/susvib", "strings", "cello_section", [36, 79], { attackMs: 36, releaseMs: 760 }),
  scoreInstrument("contrabass-section", "VSCO Contrabass Sustain", "ContrabassSusVB.sfz", "Strings/Solo Contrabass/SusVib", "strings", "double_bass", [28, 64], { attackMs: 38, releaseMs: 820 }),
  scoreInstrument("harp", "VSCO Concert Harp", "Harp.sfz", "Strings/Harp", "strings", "harp", [31, 103], { attackMs: 2, decayMs: 5200, sustain: 0.18, releaseMs: 1200 }, true),
  scoreInstrument("glockenspiel", "VSCO Glockenspiel", "Glockenspiel.sfz", "Percussion/Glock", "mallets", "glockenspiel", [67, 96], { attackMs: 1, decayMs: 2600, sustain: 0, releaseMs: 900 }, true),
  scoreInstrument("timpani", "VSCO Timpani", "Timpani.sfz", "Percussion/Timpani", "orchestral_percussion", "timpani", [36, 53], { attackMs: 1, decayMs: 1800, sustain: 0, releaseMs: 700 }, true, 5),
  directScoreInstrument("gong", "VSCO Gong", "orchestral_percussion", "gong", { attackMs: 1, decayMs: 5200, sustain: 0, releaseMs: 1800 }, [
    { path: "Percussion/gongHit_p.wav", loVel: 1, hiVel: 39 },
    { path: "Percussion/gongHit_mf.wav", loVel: 40, hiVel: 79 },
    { path: "Percussion/gongHit_f.wav", loVel: 80, hiVel: 109 },
    { path: "Percussion/gongHit_fff.wav", loVel: 110, hiVel: 127 },
  ]),
];

function scoreInstrument(
  key,
  name,
  sfz,
  sourcePrefix,
  categoryId,
  instrumentId,
  pitchRange,
  envelope = {},
  oneShot = false,
  maxRoots = 8,
) {
  return { key, name, sfz, sourcePrefix, categoryId, instrumentId, pitchRange, envelope: { ...sustainedEnvelope, ...envelope }, oneShot, maxRoots };
}

function directScoreInstrument(key, name, categoryId, instrumentId, envelope, directSamples) {
  return { key, name, categoryId, instrumentId, envelope, oneShot: true, directSamples };
}

const treeResponse = await fetch(`https://api.github.com/repos/${REPOSITORY}/git/trees/${SOURCE_REVISION}?recursive=1`);
if (!treeResponse.ok) throw new Error(`Could not read the pinned VSCO tree (${treeResponse.status}).`);
const tree = (await treeResponse.json()).tree ?? [];
const wavEntries = tree.filter((entry) => /\.wav$/i.test(entry.path ?? ""));
const manifest = {};
const checksums = [];
let totalBytes = 0;

for (const instrument of instruments) {
  let selected;
  if (instrument.directSamples) {
    selected = instrument.directSamples.map((sample) => ({
      sample: sample.path,
      rootNote: 60,
      loNote: 0,
      hiNote: 127,
      loVel: sample.loVel,
      hiVel: sample.hiVel,
      seqPosition: 1,
    }));
  } else {
    const sfzUrl = rawUrl(instrument.sfz);
    const sfzResponse = await fetch(sfzUrl);
    if (!sfzResponse.ok) throw new Error(`Could not download ${instrument.sfz} (${sfzResponse.status}).`);
    const regions = parseRegions(await sfzResponse.text());
    selected = selectHighDefinitionZones(regions, instrument.maxRoots, instrument.pitchRange);
  }
  const outputDirectory = join(publicRoot, instrument.key);
  const zones = [];

  for (const region of selected) {
    const entry = instrument.directSamples
      ? resolveDirectSampleEntry(wavEntries, region.sample)
      : resolveSampleEntry(wavEntries, instrument.sourcePrefix, region.sample);
    totalBytes += Number(entry.size ?? 0);
    const fileName = basename(entry.path);
    const destination = join(outputDirectory, fileName);
    if (!dryRun) {
      mkdirSync(dirname(destination), { recursive: true });
      if (!existsSync(destination) || statSync(destination).size !== entry.size) {
        const response = await fetch(rawUrl(entry.path));
        if (!response.ok) throw new Error(`Could not download ${entry.path} (${response.status}).`);
        writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
      }
      const bytes = readFileSync(destination);
      checksums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${instrument.key}/${fileName}`);
    }
    zones.push({
      id: `vsco-${instrument.key}-${region.rootNote}-${region.loVel}`,
      path: `/samples/vsco-score/${instrument.key}/${fileName}`,
      name: `${instrument.name} ${midiName(region.rootNote)} ${velocityName(region.loVel, region.hiVel)}`,
      rootNote: region.rootNote,
      loNote: region.loNote,
      hiNote: region.hiNote,
      loVel: region.loVel,
      hiVel: region.hiVel,
      volumeDb: 0,
      pan: 0,
      tuning: 0,
      seqPosition: 0,
      oneShot: instrument.oneShot,
    });
  }

  manifest[instrument.key] = {
    name: instrument.name,
    categoryId: instrument.categoryId,
    instrumentId: instrument.instrumentId,
    envelope: instrument.envelope,
    sampleMap: zones,
  };
  console.log(`${instrument.name}: ${zones.length} zones, ${(selected.reduce((sum, region) => {
    const entry = instrument.directSamples
      ? resolveDirectSampleEntry(wavEntries, region.sample)
      : resolveSampleEntry(wavEntries, instrument.sourcePrefix, region.sample);
    return sum + Number(entry.size ?? 0);
  }, 0) / 1048576).toFixed(1)} MB`);
}

console.log(`Selected ${(totalBytes / 1048576).toFixed(1)} MB of recorded orchestral samples.`);
if (!dryRun) {
  mkdirSync(publicRoot, { recursive: true });
  writeFileSync(join(publicRoot, "SHA256SUMS"), `${checksums.sort().join("\n")}\n`, "utf8");
  writeFileSync(join(publicRoot, "LICENSE.txt"), [
    "VS Chamber Orchestra: Community Edition",
    `Pinned source: https://github.com/${REPOSITORY}/tree/${SOURCE_REVISION}`,
    "License: CC0 1.0 Universal",
    "Beat packages a pitch- and velocity-mapped subset for offline score playback.",
    "",
  ].join("\n"), "utf8");
  writeFileSync(generatedTarget, generatedModule(manifest), "utf8");
  console.log(`Wrote ${generatedTarget}`);
}

function parseRegions(source) {
  return source.split(/<region>/i).slice(1).map((block) => {
    const values = Object.fromEntries([...block.matchAll(/^([a-z_]+)\s*=\s*([^\r\n/]+)/gim)].map((match) => [match[1], match[2].trim()]));
    return {
      sample: values.sample,
      loNote: numberValue(values.lokey ?? values.key),
      hiNote: numberValue(values.hikey ?? values.key),
      rootNote: numberValue(values.pitch_keycenter ?? values.key),
      loVel: numberValue(values.lovel ?? "0"),
      hiVel: numberValue(values.hivel ?? "127"),
      seqPosition: numberValue(values.seq_position ?? "1"),
    };
  }).filter((region) => region.sample && Number.isFinite(region.rootNote) && Number.isFinite(region.loNote) && Number.isFinite(region.hiNote));
}

function numberValue(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function selectHighDefinitionZones(regions, maxRoots, pitchRange) {
  const firstRoundRobin = regions.filter((region) => region.seqPosition <= 1);
  const roots = [...new Set(firstRoundRobin.map((region) => region.rootNote))].sort((left, right) => left - right);
  const selectedRoots = roots.length <= maxRoots
    ? roots
    : [...new Set(Array.from({ length: maxRoots }, (_, index) => roots[Math.round(index * (roots.length - 1) / (maxRoots - 1))]))];
  const zones = [];
  selectedRoots.forEach((rootNote, rootIndex) => {
    const candidates = firstRoundRobin.filter((region) => region.rootNote === rootNote)
      .sort((left, right) => left.loVel - right.loVel || left.hiVel - right.hiVel || left.sample.localeCompare(right.sample));
    const byVelocity = [...new Map(candidates.map((region) => [`${region.loVel}:${region.hiVel}`, region])).values()];
    const layers = byVelocity.length <= 3
      ? byVelocity
      : [byVelocity[0], byVelocity[Math.floor((byVelocity.length - 1) / 2)], byVelocity.at(-1)];
    const previousRoot = selectedRoots[rootIndex - 1];
    const nextRoot = selectedRoots[rootIndex + 1];
    const loNote = Math.max(
      pitchRange[0],
      rootIndex === 0 ? pitchRange[0] : Math.floor((previousRoot + rootNote) / 2) + 1,
    );
    const hiNote = Math.min(
      pitchRange[1],
      rootIndex === selectedRoots.length - 1 ? pitchRange[1] : Math.floor((rootNote + nextRoot) / 2),
    );
    if (loNote > hiNote) return;
    layers.forEach((region, layerIndex) => zones.push({
      ...region,
      loNote,
      hiNote,
      loVel: layerIndex === 0 ? 1 : Math.max(1, region.loVel),
      hiVel: layerIndex === layers.length - 1 ? 127 : Math.max(region.loVel, region.hiVel),
    }));
  });
  return zones;
}

function resolveSampleEntry(entries, prefix, sampleName) {
  const normalizedPrefix = `${prefix.toLowerCase()}/`;
  const matches = entries.filter((entry) => entry.path.toLowerCase().startsWith(normalizedPrefix)
    && basename(entry.path).toLowerCase() === basename(sampleName).toLowerCase());
  if (matches.length !== 1) throw new Error(`Expected one source for ${prefix}/${sampleName}; found ${matches.length}.`);
  return matches[0];
}

function resolveDirectSampleEntry(entries, sourcePath) {
  const match = entries.find((entry) => entry.path === sourcePath);
  if (!match) throw new Error(`Could not find pinned source sample ${sourcePath}.`);
  return match;
}

function rawUrl(path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${REPOSITORY}/${SOURCE_REVISION}/${encoded}`;
}

function midiName(note) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`;
}

function velocityName(loVel, hiVel) {
  if (hiVel <= 45) return "soft";
  if (loVel >= 85) return "forte";
  return "medium";
}

function generatedModule(value) {
  return `// Generated by scripts/fetch-vsco-score-samplers.mjs. Do not edit by hand.\n`
    + `export const VSCO_SCORE_SOURCE_REVISION = ${JSON.stringify(SOURCE_REVISION)};\n`
    + `export const VSCO_SCORE_SAMPLER_MANIFEST = ${JSON.stringify(value, null, 2)} as const;\n`;
}
