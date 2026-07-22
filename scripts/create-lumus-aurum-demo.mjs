#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const aurumRoot = process.env.AURUM_WORKTREE ?? "/private/tmp/beat-aurum";
const outputRoot = resolve(process.argv[2] ?? join(tmpdir(), "Lumus_Aurum_30s_Demo"));
const bundleRoot = join(tmpdir(), `beat-lumus-aurum-demo-${Date.now()}`);
const sampleRate = 48000;
const bpm = 128;
const lengthBeats = 64;
const durationSeconds = lengthBeats * 60 / bpm;
const sampleCount = Math.round(durationSeconds * sampleRate);
const beatSeconds = 60 / bpm;

mkdirSync(outputRoot, { recursive: true });
mkdirSync(join(bundleRoot, "lumus"), { recursive: true });
mkdirSync(join(bundleRoot, "aurum"), { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(esbuild, [
    join(repoRoot, "frontend/src/state/synthStore.ts"),
    join(repoRoot, "frontend/src/audio/synthPreview.ts"),
    "--bundle", "--format=esm", "--platform=node", `--outdir=${join(bundleRoot, "lumus")}`,
  ], { stdio: "inherit" });
  execFileSync(esbuild, [
    join(aurumRoot, "frontend/src/state/aurumTestBank.ts"),
    join(aurumRoot, "frontend/src/audio/synthPreview.ts"),
    "--bundle", "--format=esm", "--platform=node", `--outdir=${join(bundleRoot, "aurum")}`,
  ], { stdio: "inherit" });

  const lumusStore = await import(pathToFileURL(join(bundleRoot, "lumus/state/synthStore.js")));
  const lumusPreview = await import(pathToFileURL(join(bundleRoot, "lumus/audio/synthPreview.js")));
  const aurumBank = await import(pathToFileURL(join(bundleRoot, "aurum/state/aurumTestBank.js")));
  const aurumPreview = await import(pathToFileURL(join(bundleRoot, "aurum/audio/synthPreview.js")));

  const lumusPresets = Object.fromEntries(
    lumusStore.FACTORY_SYNTH_PRESETS
      .filter((preset) => preset.tags.includes("mvp-test"))
      .map((preset) => [preset.name, preset]),
  );
  const aurumInstruments = Object.fromEntries(
    aurumBank.createAurumTestInstruments("aurum-test").map((instrument) => [instrument.name, instrument]),
  );
  const requiredLumus = ["Lumus_SubBass_01", "Lumus_ArpPluck_01", "Lumus_WidePad_01", "Lumus_MonoLead_01"];
  const requiredAurum = ["Aurum_Bass_01", "Aurum_Keys_01", "Aurum_Bell_01", "Aurum_Percussion_01"];
  for (const name of [...requiredLumus, ...requiredAurum]) {
    if (!lumusPresets[name] && !aurumInstruments[name]) throw new Error(`Missing demo instrument: ${name}`);
  }

  const stems = new Map();
  const stem = (name) => {
    const value = { left: new Float32Array(sampleCount), right: new Float32Array(sampleCount) };
    stems.set(name, value);
    return value;
  };
  const lumusSub = stem("Lumus_SubBass_01");
  const lumusArp = stem("Lumus_ArpPluck_01");
  const lumusPad = stem("Lumus_WidePad_01");
  const lumusLead = stem("Lumus_MonoLead_01");
  const aurumBass = stem("Aurum_Bass_01");
  const aurumKeys = stem("Aurum_Keys_01");
  const aurumBell = stem("Aurum_Bell_01");
  const aurumPerc = stem("Aurum_Percussion_01");

  const note = (preview, instrument, target, pitch, startBeat, length, gain = 1, pan = 0) => {
    const renderSeconds = Math.max(0.18, length * beatSeconds + Math.min(1.8, Number(instrument.envelope?.releaseMs ?? 180) / 1000));
    const count = Math.min(sampleCount, Math.ceil(renderSeconds * sampleRate));
    const left = new Float32Array(count);
    const right = new Float32Array(count);
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    preview.renderInstrumentStereoSamples(instrument, left, right, sampleRate, frequency, "audio", true);
    const offset = Math.round(startBeat * beatSeconds * sampleRate);
    const leftGain = gain * Math.sqrt((1 - Math.max(-1, Math.min(1, pan))) * 0.5);
    const rightGain = gain * Math.sqrt((1 + Math.max(-1, Math.min(1, pan))) * 0.5);
    const fade = Math.min(96, Math.floor(count / 8));
    for (let index = 0; index < count && offset + index < sampleCount; index += 1) {
      const head = fade > 0 ? Math.min(1, index / fade) : 1;
      const tail = fade > 0 ? Math.min(1, (count - 1 - index) / fade) : 1;
      const window = Math.max(0, Math.min(head, tail));
      target.left[offset + index] += left[index] * leftGain * window;
      target.right[offset + index] += right[index] * rightGain * window;
    }
  };

  const lumusInstrument = (name) => lumusStore.synthDraftToPreviewInstrument(lumusPresets[name].patch);
  const progression = [
    { root: 48, chord: [48, 51, 55] },
    { root: 44, chord: [44, 48, 51] },
    { root: 51, chord: [51, 55, 58] },
    { root: 46, chord: [46, 50, 53] },
  ];

  // Aurum keys establish the intro and remain as a restrained rhythmic bed.
  for (let bar = 0; bar < 16; bar += 1) {
    const entry = progression[bar % progression.length];
    const barBeat = bar * 4;
    for (const pitch of entry.chord) note(aurumPreview, aurumInstruments.Aurum_Keys_01, aurumKeys, pitch + 12, barBeat, 2.8, bar < 4 ? 0.24 : 0.16);
  }

  // Aurum percussion and bass enter after four bars and leave room for the outro.
  for (let beat = 16; beat < 60; beat += 1) {
    const accent = beat % 4 === 0 ? 0.42 : beat % 2 === 0 ? 0.28 : 0.18;
    note(aurumPreview, aurumInstruments.Aurum_Percussion_01, aurumPerc, beat % 4 === 2 ? 43 : 36, beat, 0.22, accent);
    if (beat % 2 === 1) note(aurumPreview, aurumInstruments.Aurum_Percussion_01, aurumPerc, 67, beat + 0.5, 0.12, 0.1, 0.24);
  }
  for (let bar = 4; bar < 15; bar += 1) {
    const root = progression[bar % progression.length].root - 12;
    for (const offset of [0, 1.5, 2.5]) note(aurumPreview, aurumInstruments.Aurum_Bass_01, aurumBass, root, bar * 4 + offset, 0.72, 0.24);
  }

  // Lumus supplies the wider harmonic layer, explicit arp figure, sub support, and final lead.
  for (let bar = 2; bar < 16; bar += 1) {
    const entry = progression[bar % progression.length];
    for (const pitch of entry.chord) note(lumusPreview, lumusInstrument("Lumus_WidePad_01"), lumusPad, pitch, bar * 4, 3.7, bar < 4 ? 0.14 : 0.2);
  }
  for (let bar = 4; bar < 14; bar += 1) {
    const chord = progression[bar % progression.length].chord.map((pitch) => pitch + 12);
    const pattern = [0, 1, 2, 1, 0, 1, 2, 1];
    pattern.forEach((index, step) => note(lumusPreview, lumusInstrument("Lumus_ArpPluck_01"), lumusArp, chord[index], bar * 4 + step * 0.5, 0.32, 0.16, step % 2 ? 0.18 : -0.18));
  }
  for (let bar = 8; bar < 15; bar += 1) {
    const root = progression[bar % progression.length].root - 24;
    note(lumusPreview, lumusInstrument("Lumus_SubBass_01"), lumusSub, root, bar * 4, 1.8, 0.2);
    note(lumusPreview, lumusInstrument("Lumus_SubBass_01"), lumusSub, root + 7, bar * 4 + 2, 1.7, 0.16);
  }
  const melody = [60, 63, 67, 70, 67, 63, 65, 67, 72, 70, 67, 63, 60, 58, 55, 60];
  melody.forEach((pitch, index) => note(lumusPreview, lumusInstrument("Lumus_MonoLead_01"), lumusLead, pitch, 48 + index, index === melody.length - 1 ? 1.8 : 0.72, 0.2));

  // Sparse Aurum bell answers mark the lift without obscuring the lead.
  for (const [beat, pitch] of [[32, 72], [36, 75], [40, 79], [44, 77], [48, 72], [52, 75]])
    note(aurumPreview, aurumInstruments.Aurum_Bell_01, aurumBell, pitch, beat, 0.7, 0.14, 0.28);

  const normalize = (value, targetPeak) => {
    let peak = 0;
    for (let index = 0; index < sampleCount; index += 1) peak = Math.max(peak, Math.abs(value.left[index]), Math.abs(value.right[index]));
    const gain = peak > targetPeak && peak > 0 ? targetPeak / peak : 1;
    if (gain !== 1) for (let index = 0; index < sampleCount; index += 1) { value.left[index] *= gain; value.right[index] *= gain; }
    return peak * gain;
  };

  const aurumStemNames = new Set(requiredAurum);
  const audioFiles = [];
  const audioTracks = [];
  for (const [name, value] of stems) {
    const target = name.includes("Bass") || name.includes("SubBass") ? 0.42 : name.includes("Lead") ? 0.48 : 0.38;
    normalize(value, target);
    if (aurumStemNames.has(name)) {
      const fileName = `${name}.wav`;
      const path = join(outputRoot, fileName);
      writeStereoPcm16Wav(path, value.left, value.right, sampleRate);
      const id = `audio-${name.toLowerCase().replaceAll("_", "-")}`;
      audioFiles.push({
        id, name: fileName, path, durationSeconds, sampleRate, bitDepth: 16,
        importedAt: Date.now(), importSource: `Beat-authored ${name} locally rendered from the Aurum test bank`,
      });
      audioTracks.push(track(`track-${id}`, name.replace("_01", " Stem"), "audio", undefined, [{
        id: `segment-${id}`, trackId: `track-${id}`, name, startBeat: 0, lengthBeats, repeats: 0, layer: 0,
        fadeInBeats: 0.02, fadeOutBeats: 0.2, payload: { kind: "audio", audioFileId: id, gainDb: 0 },
      }]));
    }
  }

  const lumusNames = requiredLumus;
  const instruments = lumusNames.map((name) => ({
    ...lumusStore.synthDraftToInstrumentPatch(lumusPresets[name].patch),
    id: lumusPresets[name].id,
    name,
    icon: "ph:sparkle",
    kind: "wavetable",
    waveform: "wavetable",
    sampleIds: [],
    setId: "lumus-test",
    source: { kind: "created", label: "Made in Beat / Lumus" },
    descriptors: ["lumus", "mvp-test", "demo"],
    userCreated: false,
  }));
  const midiTracks = [
    track("track-lumus-pad", "Lumus Pad", "midi", lumusPresets.Lumus_WidePad_01.id, [
      midiSegment("segment-lumus-pad", "track-lumus-pad", lumusPresets.Lumus_WidePad_01.id, 8, 56,
        progression.flatMap((entry, chordIndex) => entry.chord.map((pitch) => midiNote(pitch, chordIndex * 4, 3.75, 78)))),
    ], -2.5),
    track("track-lumus-arp", "Lumus Arp", "midi", lumusPresets.Lumus_ArpPluck_01.id, [
      midiSegment("segment-lumus-arp", "track-lumus-arp", lumusPresets.Lumus_ArpPluck_01.id, 16, 40,
        Array.from({ length: 10 }, (_, bar) => progression[bar % 4].chord.map((pitch) => midiNote(pitch + 12, bar * 4, 3.8, 84))).flat()),
    ], -4),
    track("track-lumus-sub", "Lumus Sub", "midi", lumusPresets.Lumus_SubBass_01.id, [
      midiSegment("segment-lumus-sub", "track-lumus-sub", lumusPresets.Lumus_SubBass_01.id, 32, 28,
        Array.from({ length: 7 }, (_, bar) => {
          const root = progression[bar % 4].root - 24;
          return [midiNote(root, bar * 4, 1.8, 92), midiNote(root + 7, bar * 4 + 2, 1.7, 76)];
        }).flat()),
    ], -5),
    track("track-lumus-lead", "Lumus Lead", "midi", lumusPresets.Lumus_MonoLead_01.id, [
      midiSegment("segment-lumus-lead", "track-lumus-lead", lumusPresets.Lumus_MonoLead_01.id, 48, 16,
        melody.map((pitch, index) => midiNote(pitch, index, index === melody.length - 1 ? 1.8 : 0.72, 86 + (index % 4) * 5))),
    ], -3),
  ];

  const mix = { left: new Float32Array(sampleCount), right: new Float32Array(sampleCount) };
  for (const value of stems.values()) {
    for (let index = 0; index < sampleCount; index += 1) {
      mix.left[index] += value.left[index];
      mix.right[index] += value.right[index];
    }
  }
  const preNormalizePeak = normalize(mix, 0.88);
  const previewPath = join(outputRoot, "Lumus_Aurum_30s_Preview.wav");
  writeStereoPcm16Wav(previewPath, mix.left, mix.right, sampleRate);

  const document = {
    schemaVersion: 1,
    savedAt: Date.now(),
    project: {
      id: "lumus-aurum-30s-demo",
      name: "Lumus + Aurum - 30 Second Demo",
      bpm,
      timeSignature: { num: 4, denom: 4, boldBeats: [1] },
      lengthBeats,
      tracks: [...audioTracks, ...midiTracks],
      returnBuses: [],
      masterEqAutomation: [],
      masterChain: {
        inputGainDb: -2,
        compressorEnabled: true,
        compressorThresholdDb: -16,
        compressorRatio: 2,
        compressorAttackMs: 24,
        compressorReleaseMs: 180,
        compressorMakeupDb: 1,
        compressorMix: 72,
        outputGainDb: -1,
      },
      recordingInput: {
        inputDeviceId: "", inputDeviceName: "", inputChannelStart: 0, inputChannelCount: 2,
        calibrationSampleRate: 0, measuredRoundTripSamples: 0, reportedInputLatencySamples: 0,
        reportedOutputLatencySamples: 0, userLatencyAdjustmentSamples: 0,
      },
    },
    instruments,
    instrumentSets: [{ id: "lumus-test", name: "Lumus Test", factory: true }],
    audioFiles,
    components: [],
    componentFolders: [],
    plugins: [],
  };
  const projectPath = join(outputRoot, "Lumus_Aurum_30s_Demo.beat");
  writeFileSync(projectPath, JSON.stringify(document, null, 2));

  const metrics = analyze(mix.left, mix.right);
  const report = {
    ok: metrics.finite && metrics.rms > 0.01 && metrics.peak <= 0.9,
    projectPath,
    previewPath,
    sampleRate,
    bpm,
    lengthBeats,
    durationSeconds,
    tracks: document.project.tracks.map((entry) => entry.name),
    aurumStems: audioFiles.map((entry) => entry.path),
    metrics: { ...metrics, preNormalizePeak },
  };
  writeFileSync(join(outputRoot, "demo-report.json"), JSON.stringify(report, null, 2));
  if (!report.ok) throw new Error(`Demo render failed validation: ${JSON.stringify(report.metrics)}`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(bundleRoot, { recursive: true, force: true });
}

function midiNote(pitch, startBeat, lengthBeats, velocity) {
  return { pitch, velocity, startBeat, lengthBeats };
}

function midiSegment(id, trackId, instrumentId, startBeat, lengthBeats, notes) {
  return { id, trackId, instrumentId, startBeat, lengthBeats, repeats: 0, layer: 0, payload: { kind: "midi", notes, gainDb: 0 } };
}

function track(id, name, kind, instrumentId, segments, gainDb = 0) {
  return {
    id, name, kind, ...(instrumentId ? { instrumentId } : {}), gainDb, pan: 0, mute: false, solo: false,
    recordArmed: false, inputMonitoring: false, inputDeviceId: "", inputChannelStart: 0, inputChannelCount: 1,
    recordGainDb: 0, sends: [], effects: { filters: [] }, segments, rowHeight: "normal",
  };
}

function analyze(left, right) {
  let energy = 0;
  let peak = 0;
  let finite = true;
  let dcLeft = 0;
  let dcRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index];
    const r = right[index];
    finite &&= Number.isFinite(l) && Number.isFinite(r);
    energy += l * l + r * r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    dcLeft += l;
    dcRight += r;
  }
  return { finite, rms: Math.sqrt(energy / Math.max(1, left.length * 2)), peak, dcLeft: dcLeft / left.length, dcRight: dcRight / right.length };
}

function writeStereoPcm16Wav(path, left, right, rate) {
  const frames = Math.min(left.length, right.length);
  const dataBytes = frames * 4;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < frames; index += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[index])) * 32767), 44 + index * 4);
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[index])) * 32767), 46 + index * 4);
  }
  writeFileSync(path, buffer);
}
