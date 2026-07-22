#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outputRoot = resolve(process.argv[2] ?? join(tmpdir(), "Lumus_Aurum_30s_Demo"));
const bundleRoot = join(tmpdir(), `beat-lumus-aurum-demo-${Date.now()}`);
const sampleRate = 48000;
const bpm = 128;
const lengthBeats = 64;
const durationSeconds = lengthBeats * 60 / bpm;
const sampleCount = Math.round(durationSeconds * sampleRate);
const beatSeconds = 60 / bpm;
const referenceHashes = {
  project: "512942ded8a8c6d582b2a4fafcc691afa73d2b65ec99cdc6dccfc814619858dd",
  preview: "18709a1467a244e31abce94f219d617c3c03d0b12c1817fb53ac0f981a5e5678",
};

mkdirSync(outputRoot, { recursive: true });
mkdirSync(bundleRoot, { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(esbuild, [
    join(repoRoot, "frontend/src/state/synthStore.ts"),
    join(repoRoot, "frontend/src/state/aurumTestBank.ts"),
    join(repoRoot, "frontend/src/audio/synthPreview.ts"),
    join(repoRoot, "frontend/src/persistence/beatDocument.ts"),
    "--bundle", "--format=esm", "--platform=node", "--external:juce-framework-frontend", `--outdir=${bundleRoot}`,
  ], { stdio: "inherit" });

  const synthStore = await import(pathToFileURL(join(bundleRoot, "state/synthStore.js")));
  const aurumBank = await import(pathToFileURL(join(bundleRoot, "state/aurumTestBank.js")));
  const synthPreview = await import(pathToFileURL(join(bundleRoot, "audio/synthPreview.js")));
  const beatDocument = await import(pathToFileURL(join(bundleRoot, "persistence/beatDocument.js")));

  const lumusPresets = Object.fromEntries(
    synthStore.FACTORY_SYNTH_PRESETS
      .filter((preset) => preset.tags.includes("mvp-test"))
      .map((preset) => [preset.name, preset]),
  );
  const aurumInstruments = Object.fromEntries(
    aurumBank.createAurumTestInstruments("aurum-test").map((instrument) => [instrument.name, instrument]),
  );
  const aetherPreset = synthStore.FACTORY_SYNTH_PRESETS.find((preset) => preset.id === "factory.factory-reese");
  if (!aetherPreset) throw new Error("Missing demo instrument: Factory Reese");
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
  const aetherAcid = stem("Aether_Acid_Line");

  const note = (preview, instrument, target, pitch, startBeat, length, gain = 1, pan = 0, pitchCurve = undefined) => {
    const renderSeconds = Math.max(0.18, length * beatSeconds + Math.min(1.8, Number(instrument.envelope?.releaseMs ?? 180) / 1000));
    const count = Math.min(sampleCount, Math.ceil(renderSeconds * sampleRate));
    const left = new Float32Array(count);
    const right = new Float32Array(count);
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    const renderCurve = pitchCurve?.map((point) => ({
      timeS: point.beat * beatSeconds,
      frequency: 440 * 2 ** ((point.pitch - 69) / 12),
    }));
    preview.renderInstrumentStereoSamples(instrument, left, right, sampleRate, frequency, "audio", true, undefined, renderCurve);
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

  const lumusInstrument = (name) => synthStore.synthDraftToPreviewInstrument(lumusPresets[name].patch);
  const aetherInstrument = synthStore.synthDraftToPreviewInstrument(aetherPreset.patch);
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
    for (const pitch of entry.chord) note(synthPreview, aurumInstruments.Aurum_Keys_01, aurumKeys, pitch + 12, barBeat, 2.8, bar < 4 ? 0.24 : 0.16);
  }

  // Aurum percussion and bass enter after four bars and leave room for the outro.
  for (let beat = 16; beat < 60; beat += 1) {
    const accent = beat % 4 === 0 ? 0.42 : beat % 2 === 0 ? 0.28 : 0.18;
    note(synthPreview, aurumInstruments.Aurum_Percussion_01, aurumPerc, beat % 4 === 2 ? 43 : 36, beat, 0.22, accent);
    if (beat % 2 === 1) note(synthPreview, aurumInstruments.Aurum_Percussion_01, aurumPerc, 67, beat + 0.5, 0.12, 0.1, 0.24);
  }
  for (let bar = 4; bar < 15; bar += 1) {
    const root = progression[bar % progression.length].root - 12;
    for (const offset of [0, 1.5, 2.5]) note(synthPreview, aurumInstruments.Aurum_Bass_01, aurumBass, root, bar * 4 + offset, 0.72, 0.24);
  }

  // Lumus supplies the wider harmonic layer, explicit arp figure, sub support, and final lead.
  for (let bar = 2; bar < 16; bar += 1) {
    const entry = progression[bar % progression.length];
    for (const pitch of entry.chord) note(synthPreview, lumusInstrument("Lumus_WidePad_01"), lumusPad, pitch, bar * 4, 3.7, bar < 4 ? 0.14 : 0.2);
  }
  for (let bar = 4; bar < 14; bar += 1) {
    const chord = progression[bar % progression.length].chord.map((pitch) => pitch + 12);
    const pattern = [0, 1, 2, 1, 0, 1, 2, 1];
    pattern.forEach((index, step) => note(synthPreview, lumusInstrument("Lumus_ArpPluck_01"), lumusArp, chord[index], bar * 4 + step * 0.5, 0.32, 0.16, step % 2 ? 0.18 : -0.18));
  }
  for (let bar = 8; bar < 15; bar += 1) {
    const root = progression[bar % progression.length].root - 24;
    note(synthPreview, lumusInstrument("Lumus_SubBass_01"), lumusSub, root, bar * 4, 1.8, 0.2);
    note(synthPreview, lumusInstrument("Lumus_SubBass_01"), lumusSub, root + 7, bar * 4 + 2, 1.7, 0.16);
  }
  const melody = [60, 63, 67, 70, 67, 63, 65, 67, 72, 70, 67, 63, 60, 58, 55, 60];
  melody.forEach((pitch, index) => note(synthPreview, lumusInstrument("Lumus_MonoLead_01"), lumusLead, pitch, 48 + index, index === melody.length - 1 ? 1.8 : 0.72, 0.2));

  // Aether provides a mono-legato acid line with audible pitch curves.
  const acidPitches = [36, 36, 39, 43, 41, 39, 46, 43];
  acidPitches.forEach((pitch, index) => {
    const nextPitch = acidPitches[(index + 1) % acidPitches.length];
    note(synthPreview, aetherInstrument, aetherAcid, pitch, 40 + index * 2, 1.8, 0.12, -0.08, [
      { beat: 0, pitch },
      { beat: 1.25, pitch },
      { beat: 1.8, pitch: nextPitch },
    ]);
  });

  // Sparse Aurum bell answers mark the lift without obscuring the lead.
  for (const [beat, pitch] of [[32, 72], [36, 75], [40, 79], [44, 77], [48, 72], [52, 75]])
    note(synthPreview, aurumInstruments.Aurum_Bell_01, aurumBell, pitch, beat, 0.7, 0.14, 0.28);

  const normalize = (value, targetPeak) => {
    let peak = 0;
    for (let index = 0; index < sampleCount; index += 1) peak = Math.max(peak, Math.abs(value.left[index]), Math.abs(value.right[index]));
    const gain = peak > targetPeak && peak > 0 ? targetPeak / peak : 1;
    if (gain !== 1) for (let index = 0; index < sampleCount; index += 1) { value.left[index] *= gain; value.right[index] *= gain; }
    return peak * gain;
  };

  const audioFiles = [];
  for (const [name, value] of stems) {
    const target = name.includes("Bass") || name.includes("SubBass") ? 0.42 : name.includes("Lead") ? 0.48 : 0.38;
    normalize(value, target);
  }

  const lumusNames = requiredLumus;
  const instruments = lumusNames.map((name) => ({
    ...synthStore.synthDraftToInstrumentPatch(lumusPresets[name].patch),
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
  instruments.push(...requiredAurum.map((name) => structuredClone(aurumInstruments[name])));
  instruments.push({
    ...synthStore.synthDraftToInstrumentPatch(aetherPreset.patch),
    id: aetherPreset.id,
    name: "Aether Legato Reese",
    setId: "aether-demo",
    source: { kind: "factory", label: "Beat / Aether" },
    descriptors: ["aether", "mono", "legato", "demo"],
    userCreated: false,
  });

  const spaceSend = (gainDb, pan = 0, preFader = false) => ({ busId: "bus-space", gainDb, pan, enabled: true, preFader });
  const musicRoute = { outputBusId: "bus-music", sends: [spaceSend(-14)] };
  const midiTracks = [
    track("track-lumus-pad", "Lumus Pad", "midi", lumusPresets.Lumus_WidePad_01.id, [
      midiSegment("segment-lumus-pad", "track-lumus-pad", lumusPresets.Lumus_WidePad_01.id, 8, 56,
        Array.from({ length: 14 }, (_, bar) => progression[(bar + 2) % 4].chord.map((pitch) => midiNote(pitch, bar * 4, 3.75, 78))).flat(), [
          automationLane("macro.1", [[0, 0.22, "easeIn"], [28, 0.68, "smoothstep"], [56, 0.34, "easeOut"]]),
        ]),
    ], -2.5, { ...musicRoute, effects: [
      effect("fx-lumus-pad-chorus", "chorus", { rateHz: 0.22, depthMs: 8, delayMs: 15, feedback: 3, mix: 24 }),
      effect("fx-lumus-pad-lowpass", "lowpass", { cutoffHz: 6800, resonance: 12 }, [automationLane("cutoffHz", [[0, 2800, "easeIn"], [32, 9200, "smoothstep"], [64, 4200, "easeOut"]], true)]),
    ] }),
    track("track-lumus-arp", "Lumus Arp", "midi", lumusPresets.Lumus_ArpPluck_01.id, [
      midiSegment("segment-lumus-arp", "track-lumus-arp", lumusPresets.Lumus_ArpPluck_01.id, 16, 40,
        Array.from({ length: 10 }, (_, bar) => {
          const chord = progression[bar % 4].chord.map((pitch) => pitch + 12);
          return [0, 1, 2, 1, 0, 1, 2, 1].map((index, step) => midiNote(chord[index], bar * 4 + step * 0.5, 0.34, 72 + step * 5));
        }).flat()),
    ], -4, { ...musicRoute, pan: -0.16, effects: [
      effect("fx-lumus-arp-delay", "delay", { timeMs: 234.375, feedback: 31, mix: 22 }, [automationLane("mix", [[16, 8, "hold"], [40, 28, "cubic"], [56, 12, "easeOut"]], true)]),
    ] }),
    track("track-lumus-sub", "Lumus Sub", "midi", lumusPresets.Lumus_SubBass_01.id, [
      midiSegment("segment-lumus-sub", "track-lumus-sub", lumusPresets.Lumus_SubBass_01.id, 32, 28,
        Array.from({ length: 7 }, (_, bar) => {
          const root = progression[bar % 4].root - 24;
          return [midiNote(root, bar * 4, 1.8, 92), midiNote(root + 7, bar * 4 + 2, 1.7, 76)];
        }).flat()),
    ], -5, { effects: [effect("fx-lumus-sub-comp", "compressor", { thresholdDb: -22, ratio: 4, attackMs: 18, releaseMs: 140, makeupDb: 1, mix: 100 })] }),
    track("track-lumus-lead", "Lumus Lead", "midi", lumusPresets.Lumus_MonoLead_01.id, [
      midiSegment("segment-lumus-lead", "track-lumus-lead", lumusPresets.Lumus_MonoLead_01.id, 48, 16,
        melody.map((pitch, index) => midiNote(pitch, index, index === melody.length - 1 ? 1.8 : 0.72, 86 + (index % 4) * 5, {
          curve: index % 4 === 3 ? [{ beat: 0, pitch }, { beat: 0.45, pitch }, { beat: 0.72, pitch: melody[Math.min(index + 1, melody.length - 1)] }] : undefined,
          automation: [automationLane("macro.1", [[0, 0.28, "linear"], [0.72, 0.82, "easeOut"]])],
        }))),
    ], -3, { ...musicRoute, pan: 0.12, effects: [effect("fx-lumus-lead-delay", "delay", { timeMs: 187.5, feedback: 24, mix: 18 })] }),

    track("track-aurum-keys", "Aurum Keys", "midi", aurumInstruments.Aurum_Keys_01.id, [
      midiSegment("segment-aurum-keys", "track-aurum-keys", aurumInstruments.Aurum_Keys_01.id, 0, 64,
        Array.from({ length: 16 }, (_, bar) => progression[bar % 4].chord.map((pitch) => midiNote(pitch + 12, bar * 4, 2.8, bar < 4 ? 68 : 76))).flat()),
    ], -4.5, { ...musicRoute, pan: 0.14, effects: [effect("fx-aurum-keys-phaser", "phaser", { rateHz: 0.28, centerHz: 960, depthOct: 1.4, feedback: 18, mix: 22 })] }),
    track("track-aurum-bass", "Aurum Bass", "midi", aurumInstruments.Aurum_Bass_01.id, [
      midiSegment("segment-aurum-bass", "track-aurum-bass", aurumInstruments.Aurum_Bass_01.id, 16, 44,
        Array.from({ length: 11 }, (_, bar) => {
          const root = progression[bar % 4].root - 12;
          return [0, 1.5, 2.5].map((offset, index) => midiNote(root, bar * 4 + offset, index === 0 ? 0.9 : 0.65, 84 + index * 8));
        }).flat()),
    ], -5, { effects: [effect("fx-aurum-bass-sat", "saturator", { drive: 22, mix: 68 })] }),
    track("track-aurum-bell", "Aurum Bell", "midi", aurumInstruments.Aurum_Bell_01.id, [
      midiSegment("segment-aurum-bell", "track-aurum-bell", aurumInstruments.Aurum_Bell_01.id, 32, 24,
        [[0, 72], [4, 75], [8, 79], [12, 77], [16, 72], [20, 75]].map(([beat, pitch]) => midiNote(pitch, beat, 0.7, 90))),
    ], -5, { ...musicRoute, pan: 0.3, effects: [effect("fx-aurum-bell-reverb", "reverb", { roomSize: 62, damping: 38, mix: 26 })] }),
    track("track-aurum-drums", "Aurum Swing Loop", "midi", aurumInstruments.Aurum_Percussion_01.id, [
      drumSegment("segment-aurum-drums", "track-aurum-drums", aurumInstruments.Aurum_Percussion_01.id),
    ], -3.5, { outputBusId: "bus-drums", sends: [spaceSend(-20, 0.12, true)], effects: [
      effect("fx-aurum-drums-bit", "bitcrush", { bits: 12, rate: 82, mix: 14 }),
    ] }),
    track("track-aether-acid", "Aether Legato Acid", "midi", aetherPreset.id, [
      midiSegment("segment-aether-acid", "track-aether-acid", aetherPreset.id, 40, 16,
        acidPitches.map((pitch, index) => {
          const nextPitch = acidPitches[(index + 1) % acidPitches.length];
          return midiNote(pitch, index * 2, 1.9, 82 + (index % 3) * 12, {
            connectToIndex: index < acidPitches.length - 1 ? index + 1 : undefined,
            curve: [{ beat: 0, pitch }, { beat: 1.25, pitch }, { beat: 1.9, pitch: nextPitch }],
            automation: [automationLane("filter.cutoff", [[0, 0.18, "easeIn"], [1.25, 0.82, "smoothstep"], [1.9, 0.34, "easeOut"]])],
          });
        }), [automationLane("macro.1", [[0, 0.2, "linear"], [8, 0.86, "cubic"], [16, 0.36, "easeOut"]])]),
    ], -4, { sends: [spaceSend(-18)], automation: [automationLane("filter.cutoff", [[40, 0.24, "easeIn"], [48, 0.78, "smoothstep"], [56, 0.42, "easeOut"]])], effects: [
      effect("fx-aether-acid-dist", "distortion", { drive: 28, shape: 42, trimDb: 3, mix: 24 }),
    ] }),
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

  const returnBuses = [
    {
      schemaVersion: 1, id: "bus-music", name: "Music Group", channelLayout: "stereo", outputEnabled: true,
      inputTrimDb: -1, gainDb: -1.5, pan: 0, mute: false, solo: false, soloSafe: false, mixerOrder: 0,
      sends: [{ busId: "bus-space", gainDb: -16, pan: 0, enabled: true, preFader: false }],
      effects: { filters: [
        effect("fx-bus-music-chorus", "chorus", { rateHz: 0.16, depthMs: 5, delayMs: 14, feedback: 2, mix: 12 }),
        effect("fx-bus-music-comp", "compressor", { thresholdDb: -18, ratio: 2.2, attackMs: 28, releaseMs: 180, makeupDb: 0.5, mix: 72 }),
      ] },
    },
    {
      schemaVersion: 1, id: "bus-drums", name: "Drum Crush", channelLayout: "stereo", outputEnabled: true,
      inputTrimDb: 0, gainDb: -2, pan: 0, mute: false, solo: false, soloSafe: false, mixerOrder: 1,
      sends: [{ busId: "bus-space", gainDb: -22, pan: 0.08, enabled: true, preFader: true }],
      effects: { filters: [
        effect("fx-bus-drums-comp", "compressor", { thresholdDb: -24, ratio: 6, attackMs: 8, releaseMs: 90, makeupDb: 2, mix: 72 }),
        effect("fx-bus-drums-sat", "saturator", { drive: 28, mix: 38 }),
      ] },
    },
    {
      schemaVersion: 1, id: "bus-space", name: "Shared Space", channelLayout: "stereo", outputEnabled: true,
      inputTrimDb: 0, gainDb: -5, pan: 0, mute: false, solo: false, soloSafe: true, mixerOrder: 2,
      sends: [], effects: { filters: [
        effect("fx-bus-space-delay", "delay", { timeMs: 375, feedback: 34, mix: 26 }),
        effect("fx-bus-space-reverb", "reverb", { roomSize: 68, damping: 42, mix: 38 }),
        effect("fx-bus-space-highpass", "highpass", { cutoffHz: 180, resonance: 4 }),
      ] },
    },
  ];

  const document = {
    schemaVersion: 1,
    savedAt: 1784680000000,
    project: {
      id: "lumus-aurum-30s-demo",
      name: "Aether + Aurum + Lumus - Feature Demo",
      bpm,
      timeSignature: { num: 4, denom: 4, boldBeats: [1] },
      lengthBeats,
      tracks: midiTracks,
      returnBuses,
      masterEqAutomation: [
        { atBeat: 0, bandsDb: [-1.5, -0.5, 0, 0.5, 1, 0.5, -0.5] },
        { atBeat: 32, bandsDb: [-1, 0, 0.5, 1, 1.5, 1, 0] },
        { atBeat: 60, bandsDb: [-1.5, -0.5, 0, 0, 0.5, 0, -1] },
      ],
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
    instrumentSets: [
      { id: "lumus-test", name: "Lumus Test", factory: true },
      { id: "aurum-test", name: "Aurum Test", factory: true },
      { id: "aether-demo", name: "Aether Demo", factory: true },
    ],
    audioFiles,
    components: [],
    componentFolders: [],
    plugins: [],
  };
  const projectPath = join(outputRoot, "Lumus_Aurum_30s_Demo.beat");
  const migratedDocument = beatDocument.migrateBeatDocument(document);
  const featureCoverage = validateFeatureCoverage(migratedDocument);
  const projectJson = `${JSON.stringify(document, null, 2)}\n`;
  writeFileSync(projectPath, projectJson);

  const metrics = analyze(mix.left, mix.right);
  const projectSha256 = sha256(Buffer.from(projectJson));
  const previewSha256 = sha256(readFileSync(previewPath));
  const report = {
    ok: metrics.finite && metrics.rms > 0.01 && metrics.peak <= 0.9
      && projectSha256 === referenceHashes.project && previewSha256 === referenceHashes.preview,
    projectPath,
    previewPath,
    sampleRate,
    bpm,
    lengthBeats,
    durationSeconds,
    tracks: document.project.tracks.map((entry) => entry.name),
    engines: ["aether", "aurum", "lumus"],
    featureCoverage,
    projectSha256,
    previewSha256,
    metrics: { ...metrics, preNormalizePeak },
  };
  writeFileSync(join(outputRoot, "demo-report.json"), JSON.stringify(report, null, 2));
  if (!report.ok) throw new Error(`Demo validation failed: ${JSON.stringify({ metrics: report.metrics, projectSha256, previewSha256, referenceHashes })}`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(bundleRoot, { recursive: true, force: true });
}

function midiNote(pitch, startBeat, lengthBeats, velocity, options = {}) {
  return { pitch, velocity, startBeat, lengthBeats, ...options };
}

function midiSegment(id, trackId, instrumentId, startBeat, lengthBeats, notes, automation = undefined) {
  return {
    id, trackId, instrumentId, startBeat, lengthBeats, repeats: 0, layer: 0,
    ...(automation ? { automation } : {}),
    payload: { kind: "midi", notes, gainDb: 0 },
  };
}

function drumSegment(id, trackId, instrumentId) {
  const cell = (velocity, leanPercent = 0, pitchHz = undefined) => ({ on: true, velocity, leanPercent, ...(pitchHz ? { pitchHz } : {}) });
  const steps = (entries) => Array.from({ length: 16 }, (_, index) => entries.get(index) ?? false);
  return {
    id, trackId, instrumentId, name: "Swing 16-Step Loop", startBeat: 16, lengthBeats: 44, repeats: 0, layer: 0,
    payload: {
      kind: "drum", stepCount: 16, speed: 4, sourceLengthBeats: 4, swingPercent: 58,
      timeSignature: { num: 4, denom: 4, boldBeats: [1] },
      rows: [
        { id: "drum-kick", instrumentId, name: "Aurum Kick", steps: steps(new Map([[0, cell(122, -2)], [4, cell(108, 0)], [8, cell(118, -1)], [12, cell(112, 1)]])) },
        { id: "drum-snare", instrumentId, name: "Aurum Snare", steps: steps(new Map([[4, cell(116, 0)], [12, cell(122, 2)]])) },
        { id: "drum-hat", instrumentId, name: "Aurum Hat", steps: steps(new Map([[2, cell(72, -4)], [6, cell(88, 5)], [10, cell(76, -3)], [14, cell(96, 7)], [15, cell(64, 12)]])) },
      ],
    },
  };
}

function track(id, name, kind, instrumentId, segments, gainDb = 0, options = {}) {
  const { effects = [], ...trackOptions } = options;
  return {
    id, name, kind, ...(instrumentId ? { instrumentId } : {}), gainDb, pan: 0, mute: false, solo: false,
    recordArmed: false, inputMonitoring: false, inputDeviceId: "", inputChannelStart: 0, inputChannelCount: 1,
    recordGainDb: 0, sends: [], effects: { filters: effects }, segments, rowHeight: "normal", ...trackOptions,
  };
}

function effect(id, kind, params, automation = undefined) {
  return { id, kind, bypassed: false, params, ...(automation ? { automation } : {}) };
}

function automationLane(target, rows, effectParameter = false) {
  const points = rows.map(([beat, value, curve = "linear"], index) => ({
    ...(effectParameter ? { id: `${target}-${beat}-${index}` } : {}), beat, value, curve,
  }));
  return effectParameter ? { param: target, points } : { target, points };
}

function validateFeatureCoverage(document) {
  const { project, instruments } = document;
  const effects = [
    ...project.tracks.flatMap((entry) => entry.effects?.filters ?? []),
    ...project.returnBuses.flatMap((entry) => entry.effects?.filters ?? []),
    ...instruments.flatMap((entry) => entry.effects?.filters ?? []),
  ];
  const midiNotes = project.tracks.flatMap((entry) => entry.segments.flatMap((segment) => segment.payload.kind === "midi" ? segment.payload.notes : []));
  const drumSegments = project.tracks.flatMap((entry) => entry.segments).filter((segment) => segment.payload.kind === "drum");
  const drumCells = drumSegments.flatMap((segment) => segment.payload.rows.flatMap((row) => row.steps)).filter((step) => step && typeof step === "object" && step.on);
  const coverage = {
    independentEngines: {
      aether: instruments.some((entry) => entry.synthPatch?.instrumentType === "wavetable-synth" && !entry.aurum),
      aurum: instruments.some((entry) => entry.aurum),
      lumus: instruments.some((entry) => entry.synthPatch?.instrumentType === "lumus-hybrid-synth"),
    },
    audioBuses: project.returnBuses.length,
    nestedBusSends: project.returnBuses.flatMap((entry) => entry.sends ?? []).length,
    trackSends: project.tracks.flatMap((entry) => entry.sends ?? []).length,
    trackAndBusEffects: effects.length,
    automatedEffects: effects.filter((entry) => (entry.automation?.length ?? 0) > 0).length,
    pitchCurveNotes: midiNotes.filter((entry) => (entry.curve?.length ?? 0) > 1).length,
    legatoLinks: midiNotes.filter((entry) => Number.isInteger(entry.connectToIndex)).length,
    noteAutomationLanes: midiNotes.reduce((sum, entry) => sum + (entry.automation?.length ?? 0), 0),
    segmentAutomationLanes: project.tracks.flatMap((entry) => entry.segments).reduce((sum, entry) => sum + (entry.automation?.length ?? 0), 0),
    trackAutomationLanes: project.tracks.reduce((sum, entry) => sum + (entry.automation?.length ?? 0), 0),
    drumLoops: drumSegments.length,
    drumSwingValues: drumSegments.map((entry) => entry.payload.swingPercent),
    drumLeanCells: drumCells.filter((entry) => Number(entry.leanPercent) !== 0).length,
    drumVelocityCells: drumCells.filter((entry) => Number.isFinite(entry.velocity)).length,
    masterEqFrames: project.masterEqAutomation.length,
    masterCompressor: project.masterChain.compressorEnabled,
  };
  const failures = [
    ...Object.entries(coverage.independentEngines).filter(([, value]) => !value).map(([engine]) => `missing ${engine} engine`),
    ...(coverage.audioBuses >= 3 ? [] : ["missing audio-bus topology"]),
    ...(coverage.nestedBusSends > 0 && coverage.trackSends > 0 ? [] : ["missing bus or track sends"]),
    ...(coverage.trackAndBusEffects >= 12 && coverage.automatedEffects >= 2 ? [] : ["insufficient effect coverage"]),
    ...(coverage.pitchCurveNotes > 0 && coverage.legatoLinks > 0 ? [] : ["missing MIDI pitch-curve or legato coverage"]),
    ...(coverage.noteAutomationLanes > 0 && coverage.segmentAutomationLanes > 0 && coverage.trackAutomationLanes > 0 ? [] : ["missing MIDI automation scope"]),
    ...(coverage.drumLoops > 0 && coverage.drumLeanCells > 0 && coverage.drumVelocityCells > 0 ? [] : ["missing drum-loop timing coverage"]),
    ...(coverage.masterEqFrames > 1 && coverage.masterCompressor ? [] : ["missing master processing coverage"]),
  ];
  if (failures.length > 0) throw new Error(`Feature demo coverage failed: ${failures.join(", ")}`);
  return coverage;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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
