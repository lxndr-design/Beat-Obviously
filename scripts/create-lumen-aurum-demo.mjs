#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const songNumber = 1;
const songName = `Test_song_${songNumber}`;
const outputRoot = resolve(process.argv[2] ?? join(tmpdir(), songName));
const reviewRoot = join(outputRoot, "Review");
const bundleRoot = join(tmpdir(), `beat-lumen-aurum-demo-${Date.now()}`);
const sampleRate = 48000;
const bpm = 128;
const lengthBeats = 128;
const durationSeconds = lengthBeats * 60 / bpm;
const sampleCount = Math.round(durationSeconds * sampleRate);
const beatSeconds = 60 / bpm;
const referenceHashes = {
  project: "290954dc0847de702f613fd1575f6b3a9ba2fc4e2e76aa7596a3863532e5726e",
  preview: "5ee4d18183155cd1b44638fa85cd687c3a312667c6b9fc88ead2b84b926680a4",
};

mkdirSync(outputRoot, { recursive: true });
mkdirSync(reviewRoot, { recursive: true });
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

  const lumenPresets = Object.fromEntries(
    synthStore.FACTORY_SYNTH_PRESETS
      .filter((preset) => preset.tags.includes("mvp-test"))
      .map((preset) => [preset.name, preset]),
  );
  const aurumInstruments = Object.fromEntries(
    aurumBank.createAurumTestInstruments("aurum-test").map((instrument) => [instrument.name, instrument]),
  );
  const aetherPreset = synthStore.FACTORY_SYNTH_PRESETS.find((preset) => preset.id === "factory.factory-reese");
  if (!aetherPreset) throw new Error("Missing demo instrument: Factory Reese");
  const requiredLumen = ["Lumen_SubBass_02", "Lumen_ArpPluck_02", "Lumen_WidePad_02", "Lumen_MonoLead_02", "Lumen_DigitalKeys_02"];
  const requiredAurum = ["Aurum_Bass_01", "Aurum_Keys_01", "Aurum_Bell_01", "Aurum_Organ_01"];
  for (const name of [...requiredLumen, ...requiredAurum]) {
    if (!lumenPresets[name] && !aurumInstruments[name]) throw new Error(`Missing demo instrument: ${name}`);
  }

  const customLumen = Object.fromEntries([
    makeLumenVariant(lumenPresets.Lumen_WidePad_02, "test-song-1-lumen-dawn-pad", "Lumen Dawn Veil", {
      "osc.a.unison.voices": 3, "osc.a.unison.detune": 0.08, "osc.a.unison.spread": 0.62,
      "osc.b.level": 0.24, "osc.c.level": 0.08, "filter.cutoff": 2800, "filter.drive": 0.02,
      "amp.level": 0.42, "maxVoices": 12, "env.1.attack": 1.1, "env.1.decay": 1.6,
      "env.1.sustain": 0.72, "env.1.release": 3.2, "lfo.1.rate": 0.14,
    }, [
      effect("lumen-dawn-chorus", "chorus", { rateHz: 0.12, depthMs: 7, delayMs: 15, feedback: 2, mix: 18 }),
      effect("lumen-dawn-reverb", "reverb", { roomSize: 72, damping: 52, mix: 26 }),
    ]),
    makeLumenVariant(lumenPresets.Lumen_WidePad_02, "test-song-1-lumen-disco-strings", "Lumen Disco Strings", {
      "osc.a.wavetable": "basic.saw", "osc.a.level": 0.56, "osc.a.unison.voices": 2,
      "osc.a.unison.detune": 0.065, "osc.a.unison.spread": 0.56, "osc.b.wavetable": "basic.pulse",
      "osc.b.level": 0.3, "osc.c.wavetable": "basic.saw", "osc.c.level": 0.12,
      "filter.cutoff": 7200, "filter.resonance": 0.14, "filter.drive": 0.08,
      "filter.2.enabled": true, "filter.2.type": "highpass", "filter.2.cutoff": 240,
      "amp.level": 0.55, "maxVoices": 12, "env.1.attack": 0.018, "env.1.decay": 0.34,
      "env.1.sustain": 0.74, "env.1.release": 0.24,
    }, [
      effect("lumen-strings-chorus", "chorus", { rateHz: 0.42, depthMs: 6, delayMs: 11, feedback: 2, mix: 24 }),
      effect("lumen-strings-highpass", "highpass", { cutoffHz: 220, resonance: 2 }),
    ]),
    makeLumenVariant(lumenPresets.Lumen_ArpPluck_02, "test-song-1-lumen-glass-pluck", "Lumen Glass Pluck", {
      "osc.a.wavetable": "basic.triangle", "osc.a.level": 0.62, "osc.b.wavetable": "basic.sine",
      "osc.b.level": 0.3, "osc.c.level": 0.08, "filter.cutoff": 6100, "filter.resonance": 0.18,
      "filter.2.cutoff": 1200, "amp.level": 0.58, "env.1.attack": 0.002, "env.1.decay": 0.12,
      "env.1.sustain": 0.03, "env.1.release": 0.16,
    }, [effect("lumen-glass-delay", "delay", { timeMs: 234.375, feedback: 24, mix: 18 })]),
    makeLumenVariant(lumenPresets.Lumen_SubBass_02, "test-song-1-lumen-wobble-bass", "Lumen Wobble Bass", {
      "osc.a.wavetable": "basic.saw", "osc.a.level": 0.54, "osc.a.warp": 0.48,
      "osc.a.unison.voices": 2, "osc.a.unison.detune": 0.045, "osc.a.unison.spread": 0.22,
      "osc.b.wavetable": "basic.square", "osc.b.level": 0.34, "osc.c.wavetable": "basic.sine",
      "osc.c.level": 0.2, "filter.cutoff": 980, "filter.resonance": 0.32, "filter.drive": 0.34,
      "amp.level": 0.62, "maxVoices": 4, "glide.ms": 34, "env.1.attack": 0.003,
      "env.1.decay": 0.18, "env.1.sustain": 0.76, "env.1.release": 0.09,
      "lfo.1.enabled": true, "lfo.1.sync": true, "lfo.1.syncedRate": "1/8", "lfo.1.shape": "triangle",
    }, [
      effect("lumen-wobble-saturator", "saturator", { drive: 28, mix: 42 }),
      effect("lumen-wobble-compressor", "compressor", { thresholdDb: -20, ratio: 3.2, attackMs: 12, releaseMs: 90, makeupDb: 1, mix: 82 }),
    ], [{ id: "lumen-wobble-filter", source: "lfo.1", target: "filter.cutoff", amount: 0.5, bipolar: true, enabled: true }]),
    makeLumenVariant(lumenPresets.Lumen_MonoLead_02, "test-song-1-lumen-growl-bass", "Lumen Growl Bass", {
      "osc.a.wavetable": "basic.pulse", "osc.a.level": 0.58, "osc.a.warp": 0.62,
      "osc.a.warpMode": "sync", "osc.b.wavetable": "basic.saw", "osc.b.level": 0.42,
      "osc.b.octave": -1, "osc.c.wavetable": "basic.square", "osc.c.level": 0.2, "osc.c.octave": -1,
      "filter.cutoff": 1420, "filter.resonance": 0.38, "filter.drive": 0.42,
      "filter.2.enabled": false, "amp.level": 0.58, "maxVoices": 4, "glide.ms": 52,
      "env.1.attack": 0.004, "env.1.decay": 0.16, "env.1.sustain": 0.8, "env.1.release": 0.08,
      "lfo.1.enabled": true, "lfo.1.sync": true, "lfo.1.syncedRate": "1/16", "lfo.1.shape": "sine",
    }, [effect("lumen-growl-distortion", "distortion", { drive: 34, shape: 48, trimDb: -2, mix: 38 })], [
      { id: "lumen-growl-filter", source: "lfo.1", target: "filter.cutoff", amount: 0.42, bipolar: true, enabled: true },
      { id: "lumen-growl-warp", source: "lfo.1", target: "osc.a.warp", amount: 0.22, bipolar: true, enabled: true },
    ]),
    makeLumenVariant(lumenPresets.Lumen_MonoLead_02, "test-song-1-lumen-drop-lead", "Lumen Neon Drop Lead", {
      "osc.a.unison.voices": 3, "osc.a.unison.detune": 0.08, "osc.a.unison.spread": 0.58,
      "osc.b.level": 0.22, "osc.c.level": 0.12, "filter.cutoff": 4300, "filter.resonance": 0.2,
      "filter.drive": 0.12, "amp.level": 0.56, "maxVoices": 4, "glide.ms": 74,
      "env.1.attack": 0.006, "env.1.decay": 0.22, "env.1.sustain": 0.7, "env.1.release": 0.18,
    }, [
      effect("lumen-neon-saturator", "saturator", { drive: 20, mix: 28 }),
      effect("lumen-neon-delay", "delay", { timeMs: 187.5, feedback: 20, mix: 14 }),
    ]),
    makeLumenVariant(lumenPresets.Lumen_SubBass_02, "test-song-1-lumen-pulse-bass", "Lumen Pulse Bassline", {
      "osc.a.wavetable": "basic.saw", "osc.a.level": 0.46, "osc.a.octave": -1,
      "osc.b.wavetable": "basic.triangle", "osc.b.level": 0.36, "osc.b.octave": -1,
      "osc.c.wavetable": "basic.square", "osc.c.level": 0.1, "osc.c.octave": 0,
      "filter.cutoff": 1580, "filter.resonance": 0.2, "filter.drive": 0.22,
      "amp.level": 0.64, "maxVoices": 4, "mono.enabled": true, "legato.enabled": true,
      "glide.ms": 28, "env.1.attack": 0.003, "env.1.decay": 0.12,
      "env.1.sustain": 0.72, "env.1.release": 0.08,
    }, [
      effect("lumen-pulse-bass-sat", "saturator", { drive: 18, mix: 30 }),
      effect("lumen-pulse-bass-comp", "compressor", { thresholdDb: -19, ratio: 2.6, attackMs: 14, releaseMs: 100, makeupDb: 0.5, mix: 78 }),
    ]),
    makeLumenVariant(lumenPresets.Lumen_MonoLead_02, "test-song-1-lumen-anthem-lead", "Lumen Anthem Lead", {
      "osc.a.wavetable": "basic.saw", "osc.a.level": 0.58, "osc.a.unison.voices": 2,
      "osc.a.unison.detune": 0.055, "osc.a.unison.spread": 0.42,
      "osc.b.wavetable": "basic.square", "osc.b.level": 0.28,
      "osc.c.wavetable": "basic.triangle", "osc.c.level": 0.18, "osc.c.octave": 1,
      "filter.cutoff": 6200, "filter.resonance": 0.16, "filter.drive": 0.1,
      "filter.2.enabled": true, "filter.2.type": "highpass", "filter.2.cutoff": 360,
      "amp.level": 0.68, "maxVoices": 4, "mono.enabled": true, "legato.enabled": true,
      "glide.ms": 54, "env.1.attack": 0.004, "env.1.decay": 0.2,
      "env.1.sustain": 0.78, "env.1.release": 0.16,
    }, [
      effect("lumen-anthem-chorus", "chorus", { rateHz: 0.28, depthMs: 4, delayMs: 10, feedback: 1, mix: 12 }),
      effect("lumen-anthem-delay", "delay", { timeMs: 234.375, feedback: 18, mix: 11 }),
    ]),
    makeLumenVariant(lumenPresets.Lumen_DigitalKeys_02, "test-song-1-lumen-ribbon-harmony", "Lumen Ribbon Harmony", {
      "osc.a.wavetable": "basic.triangle", "osc.a.level": 0.48, "osc.a.unison.voices": 2,
      "osc.a.unison.detune": 0.036, "osc.a.unison.spread": 0.62,
      "osc.b.wavetable": "basic.saw", "osc.b.level": 0.22, "osc.b.octave": -1,
      "osc.c.wavetable": "basic.sine", "osc.c.level": 0.2, "osc.c.octave": 1,
      "filter.cutoff": 5100, "filter.resonance": 0.12, "filter.drive": 0.04,
      "filter.2.enabled": true, "filter.2.type": "highpass", "filter.2.cutoff": 520,
      "amp.level": 0.52, "maxVoices": 12, "mono.enabled": false, "legato.enabled": false,
      "env.1.attack": 0.022, "env.1.decay": 0.34, "env.1.sustain": 0.58, "env.1.release": 0.46,
      "lfo.1.enabled": true, "lfo.1.sync": true, "lfo.1.syncedRate": "1/2", "lfo.1.shape": "sine",
    }, [
      effect("lumen-ribbon-chorus", "chorus", { rateHz: 0.19, depthMs: 6, delayMs: 14, feedback: 2, mix: 24 }),
      effect("lumen-ribbon-delay", "delay", { timeMs: 351.5625, feedback: 20, mix: 13 }),
      effect("lumen-ribbon-reverb", "reverb", { roomSize: 58, damping: 52, mix: 18 }),
    ], [{ id: "lumen-ribbon-motion", source: "lfo.1", target: "filter.cutoff", amount: 0.12, bipolar: true, enabled: true }]),
    makeLumenVariant(lumenPresets.Lumen_DigitalKeys_02, "test-song-1-lumen-disco-brass", "Lumen Disco Brass", {
      "osc.a.wavetable": "basic.saw", "osc.a.level": 0.54, "osc.a.unison.voices": 2,
      "osc.a.unison.detune": 0.045, "osc.a.unison.spread": 0.38,
      "osc.b.wavetable": "basic.pulse", "osc.b.level": 0.3, "osc.c.wavetable": "basic.square",
      "osc.c.level": 0.12, "filter.cutoff": 4700, "filter.resonance": 0.22, "filter.drive": 0.16,
      "filter.2.enabled": true, "filter.2.type": "highpass", "filter.2.cutoff": 320,
      "amp.level": 0.58, "maxVoices": 10, "env.1.attack": 0.008, "env.1.decay": 0.2,
      "env.1.sustain": 0.42, "env.1.release": 0.16,
    }, [
      effect("lumen-brass-sat", "saturator", { drive: 14, mix: 22 }),
      effect("lumen-brass-chorus", "chorus", { rateHz: 0.38, depthMs: 3, delayMs: 9, feedback: 1, mix: 11 }),
    ]),
    makeLumenVariant(lumenPresets.Lumen_DigitalKeys_02, "test-song-1-lumen-star-counterlead", "Lumen Star Counterlead", {
      "osc.a.wavetable": "basic.triangle", "osc.a.level": 0.52,
      "osc.b.wavetable": "basic.sine", "osc.b.level": 0.3, "osc.b.octave": 1,
      "osc.c.wavetable": "basic.pulse", "osc.c.level": 0.1, "osc.c.octave": 2,
      "filter.cutoff": 7800, "filter.resonance": 0.12, "filter.drive": 0.02,
      "filter.2.enabled": true, "filter.2.type": "highpass", "filter.2.cutoff": 820,
      "amp.level": 0.56, "maxVoices": 8, "env.1.attack": 0.003, "env.1.decay": 0.3,
      "env.1.sustain": 0.22, "env.1.release": 0.42,
    }, [
      effect("lumen-star-delay", "delay", { timeMs: 281.25, feedback: 26, mix: 18 }),
      effect("lumen-star-reverb", "reverb", { roomSize: 46, damping: 54, mix: 14 }),
    ]),
    makeLumenVariant(lumenPresets.Lumen_WidePad_02, "test-song-1-lumen-air-choir", "Lumen Air Choir", {
      "osc.a.wavetable": "basic.triangle", "osc.a.level": 0.42, "osc.a.unison.voices": 2,
      "osc.a.unison.detune": 0.05, "osc.a.unison.spread": 0.52,
      "osc.b.wavetable": "basic.sine", "osc.b.level": 0.3,
      "osc.c.wavetable": "basic.saw", "osc.c.level": 0.06, "filter.cutoff": 3900,
      "filter.resonance": 0.08, "filter.drive": 0.01, "amp.level": 0.4, "maxVoices": 10,
      "env.1.attack": 0.52, "env.1.decay": 1.2, "env.1.sustain": 0.7, "env.1.release": 2.4,
    }, [
      effect("lumen-choir-chorus", "chorus", { rateHz: 0.14, depthMs: 7, delayMs: 16, feedback: 2, mix: 20 }),
      effect("lumen-choir-reverb", "reverb", { roomSize: 76, damping: 44, mix: 30 }),
    ]),
  ].map((record) => [record.name, record]));

  const stems = new Map();
  const stem = (name) => {
    const value = { left: new Float32Array(sampleCount), right: new Float32Array(sampleCount) };
    stems.set(name, value);
    return value;
  };
  const lumenSub = stem("Lumen Sub");
  const lumenArp = stem("Lumen Glass Pluck");
  const lumenPad = stem("Lumen Dawn Veil");
  const lumenStrings = stem("Lumen Disco Strings");
  const lumenWobble = stem("Lumen Wobble Bass");
  const lumenGrowl = stem("Lumen Growl Bass");
  const lumenLead = stem("Lumen Neon Drop Lead");
  const lumenPulseBass = stem("Lumen Pulse Bassline");
  const lumenAnthem = stem("Lumen Anthem Lead");
  const lumenRibbon = stem("Lumen Ribbon Harmony");
  const lumenBrass = stem("Lumen Disco Brass");
  const lumenCounterlead = stem("Lumen Star Counterlead");
  const lumenChoir = stem("Lumen Air Choir");
  const aurumBass = stem("Aurum_Bass_01");
  const aurumKeys = stem("Aurum_Keys_01");
  const aurumBell = stem("Aurum_Bell_01");
  const aurumOrgan = stem("Aurum_Organ_01");
  const sampleDrums = stem("LM2_Pearl_Drum_Kit");
  const aetherAcid = stem("Aether_Acid_Line");
  const aetherTexture = stem("Aether_Reese_Texture");

  const drumKit = {
    kick: demoSamplerInstrument("demo-lm2-kick", "LM-2 Kick", "/samples/lm2/kick.wav"),
    snare: demoSamplerInstrument("demo-lm2-snare", "LM-2 Snare", "/samples/lm2/snare-m.wav"),
    clap: demoSamplerInstrument("demo-lm2-clap", "LM-2 Clap", "/samples/lm2/clap.wav"),
    closedHat: demoSamplerInstrument("demo-lm2-closed-hat", "LM-2 Closed Hat", "/samples/lm2/hihat-closed-short.wav", { releaseMs: 55 }),
    openHat: demoSamplerInstrument("demo-lm2-open-hat", "LM-2 Open Hat", "/samples/lm2/hihat-open.wav", { decayMs: 180, releaseMs: 180 }),
    crash: demoSamplerInstrument("demo-pearl-crash", "Pearl Crash", "/samples/pearl-master-studio/crash-01.wav", { decayMs: 520, releaseMs: 900 }),
    tom: demoSamplerInstrument("demo-pearl-mid-tom", "Pearl Mid Tom", "/samples/pearl-master-studio/tom-02.wav", { decayMs: 220, releaseMs: 260 }),
  };
  const drumSamples = Object.fromEntries(Object.entries(drumKit).map(([role, instrument]) => [
    role,
    readPcm16Wav(join(repoRoot, "frontend/public", instrument.sampleUrl.replace(/^\//, "")), sampleRate),
  ]));

  const renderedNoteCache = new Map();
  const note = (preview, instrument, target, pitch, startBeat, length, gain = 1, pan = 0, pitchCurve = undefined) => {
    const renderSeconds = Math.max(0.18, length * beatSeconds + Math.min(1.8, Number(instrument.envelope?.releaseMs ?? 180) / 1000));
    const count = Math.min(sampleCount, Math.ceil(renderSeconds * sampleRate));
    const cacheKey = pitchCurve ? null : `${instrument.id}:${pitch}:${count}`;
    let rendered = cacheKey ? renderedNoteCache.get(cacheKey) : undefined;
    if (!rendered) {
      const left = new Float32Array(count);
      const right = new Float32Array(count);
      const frequency = 440 * 2 ** ((pitch - 69) / 12);
      const renderCurve = pitchCurve?.map((point) => ({
        timeS: point.beat * beatSeconds,
        frequency: 440 * 2 ** ((point.pitch - 69) / 12),
      }));
      preview.renderInstrumentStereoSamples(instrument, left, right, sampleRate, frequency, "audio", true, undefined, renderCurve);
      rendered = { left, right };
      if (cacheKey) renderedNoteCache.set(cacheKey, rendered);
    }
    const offset = Math.round(startBeat * beatSeconds * sampleRate);
    const leftGain = gain * Math.sqrt((1 - Math.max(-1, Math.min(1, pan))) * 0.5);
    const rightGain = gain * Math.sqrt((1 + Math.max(-1, Math.min(1, pan))) * 0.5);
    const fade = Math.min(96, Math.floor(count / 8));
    for (let index = 0; index < count && offset + index < sampleCount; index += 1) {
      const head = fade > 0 ? Math.min(1, index / fade) : 1;
      const tail = fade > 0 ? Math.min(1, (count - 1 - index) / fade) : 1;
      const window = Math.max(0, Math.min(head, tail));
      target.left[offset + index] += rendered.left[index] * leftGain * window;
      target.right[offset + index] += rendered.right[index] * rightGain * window;
    }
  };

  const lumenRecord = (name) => customLumen[name] ?? lumenPresets[name];
  const lumenInstrument = (name) => {
    const record = lumenRecord(name);
    return { ...synthStore.synthDraftToPreviewInstrument(record.patch), id: record.id, name: record.name };
  };
  const aetherInstrument = synthStore.synthDraftToPreviewInstrument(aetherPreset.patch);
  const progression = [
    { root: 50, chord: [50, 53, 57, 60, 64], guide: [65, 69] }, // Dm9: F and A guide tones
    { root: 46, chord: [46, 50, 53, 57, 60], guide: [69, 72] }, // Bbmaj9: A and C
    { root: 53, chord: [53, 57, 60, 64, 67], guide: [69, 72] }, // Fmaj9: A and C
    { root: 48, chord: [48, 52, 55, 60, 62], guide: [67, 74] }, // Cadd9/G: G and D
  ];
  // A deliberately singable two-bar hook. The second phrase retains the opening six-note cell
  // and changes only its cadence so every return is audible as the same theme.
  const motif = [74, 77, 81, 84, 81, 79, 77, 76, 74, 69, 72, 74];
  const motifVariation = [74, 77, 81, 84, 81, 79, 81, 79, 77, 76, 74, 72];
  const motifStarts = [0, 1, 1.5, 2, 3, 3.5, 4, 4.75, 5, 6.5, 7, 7.5];
  const motifLengths = [0.82, 0.38, 0.38, 0.82, 0.38, 0.38, 0.68, 0.18, 1.18, 0.38, 0.38, 0.46];
  const chorusMotif = [...motif, ...motifVariation];
  const chorusStarts = [...motifStarts, ...motifStarts.map((beat) => beat + 8)];
  const chorusLengths = [...motifLengths, ...motifLengths];
  const basslinePatternA = [[0, 0, 0.62], [0.75, 7, 0.34], [1.5, 12, 0.42], [2.25, 7, 0.34], [3, 5, 0.28], [3.5, 7, 0.38]];
  const basslinePatternB = [[0, 0, 0.78], [1, 12, 0.38], [1.5, 7, 0.34], [2.25, 10, 0.3], [2.75, 7, 0.42], [3.5, 2, 0.38]];
  const basslineBarEvents = (bar, finalPeak = false) => {
    const root = progression[bar % 4].root - 12;
    const pattern = bar % 2 === 0 ? basslinePatternA : basslinePatternB;
    const events = pattern.map(([offset, interval, length], index) => ({ offset, pitch: root + interval, length, velocity: 92 + (index % 3) * 7 }));
    if (finalPeak) events.push({ offset: 3.82, pitch: root + 12, length: 0.14, velocity: 112 });
    return events;
  };
  const acidPitches = [38, 38, 41, 45, 43, 41, 48, 45];
  const renderChord = (instrument, target, pitches, startBeat, length, gain, transpose = 0, panSpread = 0.18) =>
    pitches.forEach((pitch, voice) => note(synthPreview, instrument, target, pitch + transpose, startBeat, length,
      gain * (1 - voice * 0.055), pitches.length > 1 ? -panSpread + (voice / (pitches.length - 1)) * panSpread * 2 : 0));
  const renderArpBar = (bar, division, gain) => {
    const chord = progression[bar % 4].chord.map((pitch) => pitch + 12);
    const pattern = division === 16
      ? [0, 2, 1, 3, 2, 4, 3, 1, 2, 0, 3, 4, 2, 1, 3, 2]
      : [0, 2, 1, 3, 2, 1, 4, 2];
    pattern.forEach((voice, step) => note(synthPreview, lumenInstrument("Lumen Glass Pluck"), lumenArp,
      chord[voice], bar * 4 + step * (4 / pattern.length), step % 4 === 3 ? 0.32 : 0.16,
      gain + (step % 4) * 0.006, step % 2 ? 0.28 : -0.28));
  };

  // Gentle opening: wide space and isolated harmonic gestures, with no drums or bass for eight beats.
  for (let bar = 0; bar < 4; bar += 1) {
    const entry = progression[bar % 4];
    renderChord(lumenInstrument("Lumen Dawn Veil"), lumenPad, entry.chord.slice(0, bar < 2 ? 3 : 5), bar * 4, 3.78, 0.075 + bar * 0.008);
    if (bar >= 2) renderChord(aurumInstruments.Aurum_Keys_01, aurumKeys, entry.chord.slice(1, 4), bar * 4 + 1.5, 1.7, 0.065, 12);
  }

  // Pulse section: intermittent support leaves holes around the motif instead of filling every bar.
  for (let bar = 4; bar < 8; bar += 1) {
    const entry = progression[bar % 4];
    if (bar % 2 === 0) renderChord(aurumInstruments.Aurum_Keys_01, aurumKeys, entry.chord.slice(0, 4), bar * 4, 2.8, 0.095, 12);
    const guides = bar % 2 ? [...entry.guide].reverse() : entry.guide;
    guides.forEach((pitch, voice) => note(synthPreview, aurumInstruments.Aurum_Organ_01, aurumOrgan,
      pitch - (voice ? 0 : 12), bar * 4 + 0.5 + voice * 2, 1.05, 0.052, voice ? 0.22 : -0.22));
  }

  // Disco lift: short off-beat fake-string bows, walking octave bass and four-on-the-floor samples.
  for (let bar = 8; bar < 12; bar += 1) {
    const entry = progression[bar % 4];
    [0.5, 1.5, 2.5, 3.5].forEach((offset, stab) => renderChord(lumenInstrument("Lumen Disco Strings"), lumenStrings,
      entry.chord.slice(stab % 2, stab % 2 + 3), bar * 4 + offset, stab === 3 ? 0.32 : 0.42, 0.085, 12, 0.3));
    if (bar % 2 === 1) renderChord(aurumInstruments.Aurum_Keys_01, aurumKeys, entry.chord.slice(0, 3), bar * 4, 0.58, 0.07, 12);
    [0, 2].forEach((offset, stab) => renderChord(lumenInstrument("Lumen Disco Brass"), lumenBrass,
      entry.chord.slice(stab, stab + 3), bar * 4 + offset, stab === 0 ? 0.42 : 0.3, 0.068, 12, 0.24));
  }

  // Build: the arp doubles in density, then everything falls away for the final pre-drop bar.
  for (let bar = 12; bar < 15; bar += 1) {
    const entry = progression[bar % 4];
    renderChord(lumenInstrument("Lumen Disco Strings"), lumenStrings, entry.chord.slice(0, 4), bar * 4, 0.62, 0.075 + (bar - 12) * 0.012, 12);
    renderArpBar(bar, bar === 12 ? 8 : 16, 0.068 + (bar - 12) * 0.008);
    renderChord(lumenInstrument("Lumen Disco Brass"), lumenBrass, entry.chord.slice(0, 3), bar * 4 + 2, 0.28, 0.06 + (bar - 12) * 0.008, 12);
  }
  renderChord(lumenInstrument("Lumen Dawn Veil"), lumenPad, [57, 60, 64, 69], 60, 2.65, 0.05);
  for (const [beat, pitch] of [[62.5, 69], [63, 72], [63.5, 77]])
    note(synthPreview, lumenInstrument("Lumen Glass Pluck"), lumenArp, pitch, beat, 0.22, 0.09, 0.18);

  // First drop: bass patches trade phrases; the harmony is punched, never a continuous pad blanket.
  for (let bar = 16; bar < 20; bar += 1) {
    const entry = progression[bar % 4];
    renderChord(aurumInstruments.Aurum_Keys_01, aurumKeys, entry.chord.slice(0, 4), bar * 4, 0.64, 0.085, 12);
    renderChord(aurumInstruments.Aurum_Keys_01, aurumKeys, entry.chord.slice(1, 4), bar * 4 + 2.75, 0.38, 0.07, 12);
    if (bar % 2 === 0) renderChord(lumenInstrument("Lumen Disco Brass"), lumenBrass, entry.chord.slice(0, 3), bar * 4 + 1.5, 0.28, 0.055, 12);
  }

  // Breakdown and rebuild: a genuine low-density valley before the larger final peak.
  for (let bar = 20; bar < 24; bar += 1) {
    const entry = progression[bar % 4];
    renderChord(lumenInstrument("Lumen Dawn Veil"), lumenPad, entry.chord.slice(0, bar < 22 ? 3 : 5), bar * 4, 3.72, bar < 22 ? 0.08 : 0.1);
    renderChord(lumenInstrument("Lumen Air Choir"), lumenChoir, entry.chord.slice(1, 4), bar * 4, 3.7, bar < 22 ? 0.045 : 0.06, 12, 0.3);
    if (bar >= 22) renderArpBar(bar, 8, 0.055 + (bar - 22) * 0.012);
  }

  // Final peak: chord punctuation, disco-string flashes and fast arpeggio bursts alternate with bass call/response.
  for (let bar = 24; bar < 30; bar += 1) {
    const entry = progression[bar % 4];
    [0, 1.5, 2.75].forEach((offset, stab) => renderChord(aurumInstruments.Aurum_Keys_01, aurumKeys,
      entry.chord.slice(stab % 2, stab % 2 + 4), bar * 4 + offset, [0.58, 0.38, 0.64][stab], 0.075, 12));
    if (bar >= 26) [0.5, 2.5].forEach((offset) => renderChord(lumenInstrument("Lumen Disco Strings"), lumenStrings,
      entry.chord.slice(1, 4), bar * 4 + offset, 0.32, 0.07, 12, 0.32));
    if (bar % 2 === 0) [0.75, 3].forEach((offset) => renderChord(lumenInstrument("Lumen Disco Brass"), lumenBrass,
      entry.chord.slice(0, 3), bar * 4 + offset, 0.26, 0.06, 12, 0.22));
    if (bar >= 28) renderChord(lumenInstrument("Lumen Air Choir"), lumenChoir, entry.chord.slice(1, 4), bar * 4, 3.65, 0.046, 12, 0.3);
    if (bar === 26 || bar === 27) renderArpBar(bar, 16, 0.072);
    if (bar === 28) renderArpBar(bar, 8, 0.064);
  }

  // Graceful resolution: Bbmaj9 opens into a final Dm(add9); only the air pad and keys remain.
  renderChord(lumenInstrument("Lumen Dawn Veil"), lumenPad, progression[1].chord, 120, 3.72, 0.075);
  renderChord(lumenInstrument("Lumen Dawn Veil"), lumenPad, [50, 53, 57, 64, 69], 124, 3.85, 0.085);
  renderChord(lumenInstrument("Lumen Air Choir"), lumenChoir, [57, 60, 64], 120, 3.7, 0.04, 12, 0.28);
  renderChord(lumenInstrument("Lumen Air Choir"), lumenChoir, [57, 64, 69], 124, 3.8, 0.045, 12, 0.28);
  renderChord(aurumInstruments.Aurum_Keys_01, aurumKeys, [50, 53, 57, 64], 124, 3.65, 0.055, 12);

  // Sample-based drums mirror the form: silence, light pulse, disco lift, vacuum, two distinct drops, then silence.
  renderDrumSection(sampleDrums, drumSamples, 16, 4, "grooveA", sampleRate);
  renderDrumSection(sampleDrums, drumSamples, 32, 4, "disco", sampleRate);
  renderDrumSection(sampleDrums, drumSamples, 48, 3, "build", sampleRate);
  renderDrumSection(sampleDrums, drumSamples, 60, 1, "vacuum", sampleRate);
  renderDrumSection(sampleDrums, drumSamples, 64, 4, "dubstep", sampleRate);
  renderDrumSection(sampleDrums, drumSamples, 80, 2, "break", sampleRate);
  renderDrumSection(sampleDrums, drumSamples, 88, 2, "build", sampleRate);
  renderDrumSection(sampleDrums, drumSamples, 96, 6, "final", sampleRate);
  for (const beat of [32, 64, 96]) placeSample(sampleDrums, drumSamples.crash, beat, beat === 96 ? 0.5 : 0.4, 0.04, sampleRate);
  for (const beat of [44, 76, 92, 116]) renderDrumSection(sampleDrums, drumSamples, beat, 1, "fill", sampleRate);

  // A recurring two-bar bass hook carries the song. Roots follow the harmony, but the A/B rhythm
  // and interval contour remain identifiable in every section and gain one pickup at the final peak.
  const renderPulseBassBar = (bar, gain, finalPeak = false) => basslineBarEvents(bar, finalPeak).forEach((entry, index) =>
    note(synthPreview, lumenInstrument("Lumen Pulse Bassline"), lumenPulseBass, entry.pitch, bar * 4 + entry.offset,
      entry.length, gain * (1 + (index % 3) * 0.05), index % 2 ? 0.04 : -0.04,
      index === 5 ? [{ beat: 0, pitch: entry.pitch }, { beat: entry.length * 0.7, pitch: entry.pitch }, { beat: entry.length, pitch: entry.pitch + 2 }] : undefined));
  for (let bar = 4; bar < 15; bar += 1) {
    renderPulseBassBar(bar, bar < 8 ? 0.078 : bar < 12 ? 0.09 : 0.1);
    if (bar >= 8 && bar < 12) {
      const root = progression[bar % 4].root - 12;
      note(synthPreview, aurumInstruments.Aurum_Bass_01, aurumBass, root, bar * 4, 1.6, 0.065);
      note(synthPreview, aurumInstruments.Aurum_Bass_01, aurumBass, root + 12, bar * 4 + 2, 0.72, 0.052);
    }
  }
  const renderDropBassBar = (bar, finalPeak = false) => {
    const root = progression[bar % 4].root - 24;
    note(synthPreview, lumenInstrument("Lumen_SubBass_02"), lumenSub, root, bar * 4, 3.72, finalPeak ? 0.11 : 0.095);
    const wobble = [[0, root + 12, 0.72], [1, root + 19, 0.42], [2.25, root + 12, 0.62], [3.25, root + 22, 0.42]];
    const growl = finalPeak
      ? [[0.75, root + 24, 0.38], [1.5, root + 19, 0.3], [2.75, root + 22, 0.3], [3.65, root + 24, 0.22]]
      : [[1.5, root + 24, 0.36], [3, root + 19, 0.32]];
    wobble.forEach(([offset, pitch, length], index) => note(synthPreview, lumenInstrument("Lumen Wobble Bass"), lumenWobble,
      pitch, bar * 4 + offset, length, finalPeak ? 0.11 : 0.095, index % 2 ? 0.08 : -0.08));
    growl.forEach(([offset, pitch, length], index) => note(synthPreview, lumenInstrument("Lumen Growl Bass"), lumenGrowl,
      pitch, bar * 4 + offset, length, finalPeak ? 0.105 : 0.09, index % 2 ? -0.1 : 0.1,
      index === growl.length - 1 ? [{ beat: 0, pitch }, { beat: length * 0.65, pitch }, { beat: length, pitch: pitch + 2 }] : undefined));
  };
  for (let bar = 16; bar < 20; bar += 1) { renderDropBassBar(bar, false); renderPulseBassBar(bar, 0.06); }
  for (let bar = 22; bar < 24; bar += 1) renderPulseBassBar(bar, 0.075);
  for (let bar = 24; bar < 30; bar += 1) { renderDropBassBar(bar, true); renderPulseBassBar(bar, 0.07, true); }

  const leadTimingOffsets = [0, 0.018, -0.012, 0.026, -0.018, 0.01, 0, -0.022, 0.015, -0.01, 0.024, -0.015];
  const leadDynamics = [1, 0.84, 0.91, 1.06, 0.78, 0.88, 1.02, 0.82, 0.94, 0.76, 0.9, 0.86];
  const leadLengthShape = [1.05, 0.88, 0.94, 1.08, 0.82, 0.9, 1.04, 0.76, 1.08, 0.84, 0.92, 1.02];
  const renderLeadPhrase = (instrumentName, target, source, starts, lengths, startBeat, transpose, gain, pan = 0.08, expression = {}) =>
    source.forEach((pitch, index) => {
      const length = lengths[index] * leadLengthShape[index % leadLengthShape.length] * (expression.lengthScale ?? 1);
      const renderedPitch = pitch + transpose;
      const nextPitch = source[Math.min(index + 1, source.length - 1)] + transpose;
      const curve = index % 6 === 5
        ? [{ beat: 0, pitch: renderedPitch }, { beat: length * 0.62, pitch: renderedPitch }, { beat: length, pitch: nextPitch }]
        : index % 8 === 0
          ? [{ beat: 0, pitch: renderedPitch }, { beat: length * 0.58, pitch: renderedPitch + 0.1 }, { beat: length, pitch: renderedPitch }]
          : undefined;
      note(synthPreview, lumenInstrument(instrumentName), target, renderedPitch,
        startBeat + starts[index] + leadTimingOffsets[index % leadTimingOffsets.length], length,
        gain * leadDynamics[index % leadDynamics.length] * (expression.gainScale?.[index % expression.gainScale.length] ?? 1),
        pan + (index % 2 ? 0.018 : -0.022), curve);
    });

  const harmonyIntervals = {
    whisper: [-9, -8, -9, -8, -9, -8, -9, -8, -9, -8, -9, -8],
    thirds: [-3, -4, -3, -4, -3, -4, -3, -4, -3, -4, -3, -4],
    sixths: [-9, -8, -9, -8, -9, -8, -9, -8, -9, -8, -9, -8],
    open: [-12, -7, -12, -7, -12, -7, -12, -7, -12, -7, -12, -7],
    tension: [-3, 1, -4, 2, -3, -4, -8, 1, -3, -4, 2, -3],
    octave: [-12, -12, -12, -12, -12, -12, -12, -12, -12, -12, -12, -12],
    chordal: [-3, -4, -3, -4, -3, -4, -8, 1, -3, -4, 2, -3],
  };
  const harmonyIndices = {
    whisper: new Set([0, 3, 6, 8, 11]),
    thirds: new Set([0, 2, 3, 5, 6, 8, 10, 11]),
    sixths: new Set([0, 1, 3, 4, 6, 7, 8, 10, 11]),
    open: new Set([0, 3, 6, 8, 11]),
    tension: new Set([0, 1, 2, 3, 4, 6, 7, 8, 10, 11]),
    octave: new Set([0, 3, 5]),
    chordal: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  };
  const renderHarmonyPhrase = (source, starts, lengths, startBeat, transpose, gain, profile) =>
    source.forEach((pitch, index) => {
      if (!harmonyIndices[profile].has(index % 12)) return;
      const interval = harmonyIntervals[profile][index % 12];
      const harmonyPitch = pitch + transpose + interval;
      const length = lengths[index] * (profile === "whisper" ? 1.18 : profile === "tension" && interval > 0 ? 0.72 : 1.02);
      const tensionCurve = interval > 0 && interval <= 2
        ? [{ beat: 0, pitch: harmonyPitch }, { beat: length * 0.52, pitch: harmonyPitch }, { beat: length, pitch: pitch + transpose }]
        : undefined;
      note(synthPreview, lumenInstrument("Lumen Ribbon Harmony"), lumenRibbon, harmonyPitch,
        startBeat + starts[index] - leadTimingOffsets[index % leadTimingOffsets.length] * 0.55, length,
        gain * (0.82 + (index % 4) * 0.055), -0.2 + (index % 2 ? 0.055 : -0.045), tensionCurve);
      if (profile === "chordal" && [0, 3, 8].includes(index % 12))
        note(synthPreview, lumenInstrument("Lumen Ribbon Harmony"), lumenRibbon, pitch + transpose - 7,
          startBeat + starts[index] + 0.012, length * 1.08, gain * 0.62, -0.3);
    });

  // Main lead: its prominence changes by section while the opening cell remains recognizable.
  renderLeadPhrase("Lumen Anthem Lead", lumenAnthem, motif, motifStarts, motifLengths, 8, -12, 0.046);
  renderLeadPhrase("Lumen Anthem Lead", lumenAnthem, motif, motifStarts, motifLengths, 24, 0, 0.088);
  renderLeadPhrase("Lumen Anthem Lead", lumenAnthem, motifVariation, motifStarts, motifLengths, 40, 0, 0.072);
  renderLeadPhrase("Lumen Anthem Lead", lumenAnthem, motif, motifStarts, motifLengths, 64, 0, 0.112);
  renderLeadPhrase("Lumen Anthem Lead", lumenAnthem, motifVariation, motifStarts, motifLengths, 72, 0, 0.084);
  renderLeadPhrase("Lumen Anthem Lead", lumenAnthem, motif.slice(0, 6), motifStarts.slice(0, 6), motifLengths.slice(0, 6), 84, -12, 0.054, 0.08, { lengthScale: 1.24 });
  renderLeadPhrase("Lumen Anthem Lead", lumenAnthem, motif, motifStarts, motifLengths, 96, 0, 0.098);
  renderLeadPhrase("Lumen Anthem Lead", lumenAnthem, motifVariation, motifStarts, motifLengths, 104, 0, 0.142);
  renderLeadPhrase("Lumen Anthem Lead", lumenAnthem, motifVariation, motifStarts, motifLengths, 112, 0, 0.106);

  // The Ribbon voice changes relationship to the Anthem voice section by section: fragment, thirds,
  // sixths, open intervals, resolving seconds, low octave, and finally chordal harmony.
  renderHarmonyPhrase(motif, motifStarts, motifLengths, 8, -12, 0.024, "whisper");
  renderHarmonyPhrase(motif, motifStarts, motifLengths, 24, 0, 0.038, "thirds");
  renderHarmonyPhrase(motifVariation, motifStarts, motifLengths, 40, 0, 0.052, "sixths");
  renderHarmonyPhrase(motif, motifStarts, motifLengths, 64, 0, 0.046, "open");
  renderHarmonyPhrase(motifVariation, motifStarts, motifLengths, 72, 0, 0.064, "tension");
  renderHarmonyPhrase(motif.slice(0, 6), motifStarts.slice(0, 6), motifLengths.slice(0, 6), 84, -12, 0.032, "octave");
  renderHarmonyPhrase(motif, motifStarts, motifLengths, 96, 0, 0.052, "thirds");
  renderHarmonyPhrase(motifVariation, motifStarts, motifLengths, 104, 0, 0.068, "sixths");
  renderHarmonyPhrase(motifVariation, motifStarts, motifLengths, 112, 0, 0.074, "chordal");
  [[74, 120, 1.2], [77, 121.5, 0.42], [81, 122, 0.82], [79, 123, 0.72], [77, 124, 1.4], [74, 126, 1.8]].forEach(([pitch, beat, length], index) =>
    note(synthPreview, lumenInstrument("Lumen Anthem Lead"), lumenAnthem, pitch - 12, beat, length, 0.062, index % 2 ? 0.08 : -0.08));
  [[53, 120, 1.3], [57, 121.5, 0.48], [60, 122, 0.88], [59, 123, 0.78], [57, 124, 1.5], [53, 126, 1.9], [50, 126, 1.9]]
    .forEach(([pitch, beat, length], index) => note(synthPreview, lumenInstrument("Lumen Ribbon Harmony"), lumenRibbon,
      pitch, beat + (index % 2 ? 0.018 : 0), length, 0.026 * (1 - index * 0.035), -0.22 + (index % 2 ? 0.04 : -0.03)));

  // Short counter-answers remain separate from the dual lead; the Neon patch shadows only selected
  // peak entrances so it behaves like a texture change rather than a permanently doubled melody.
  const answerPitches = [81, 79, 77, 74];
  const answerStarts = [0, 0.75, 1.5, 2.5];
  for (const startBeat of [20, 36, 44, 76, 108, 116])
    renderLeadPhrase("Lumen Star Counterlead", lumenCounterlead, answerPitches, answerStarts, [0.5, 0.5, 0.72, 0.92], startBeat, 0, startBeat >= 108 ? 0.082 : 0.068, -0.2);
  for (const startBeat of [64, 96, 112])
    renderLeadPhrase("Lumen Neon Drop Lead", lumenLead, motif.slice(0, 4), motifStarts.slice(0, 4), motifLengths.slice(0, 4), startBeat, -12, 0.034, 0.22);

  for (const startBeat of [48, 88]) acidPitches.forEach((pitch, index) => {
    const nextPitch = acidPitches[(index + 1) % acidPitches.length];
    note(synthPreview, aetherInstrument, aetherAcid, pitch, startBeat + index * 2, 1.85, 0.1, -0.08, [
      { beat: 0, pitch }, { beat: 1.25, pitch }, { beat: 1.85, pitch: nextPitch },
    ]);
  });
  for (const [start, root, gain] of [[0, 38, 0.045], [80, 34, 0.06], [120, 38, 0.035]])
    note(synthPreview, aetherInstrument, aetherTexture, root, start, start === 80 ? 15.5 : 7.5, gain, -0.24);

  // Bell answers land on extensions rather than doubling the lead.
  for (const [beat, pitch, length] of [[14, 76, 0.9], [30, 72, 0.65], [46, 79, 0.8], [63.5, 81, 0.3], [71.5, 84, 0.8], [76, 79, 0.55], [84, 74, 1.2], [92, 72, 0.7], [103.5, 81, 0.7], [108, 84, 0.55], [111.5, 79, 0.85], [116, 86, 0.75], [124, 74, 1.25]])
    note(synthPreview, aurumInstruments.Aurum_Bell_01, aurumBell, pitch, beat, length, 0.085, 0.3);

  const normalize = (value, targetPeak, allowBoost = false) => {
    let peak = 0;
    for (let index = 0; index < sampleCount; index += 1) peak = Math.max(peak, Math.abs(value.left[index]), Math.abs(value.right[index]));
    const gain = peak > 0 && (allowBoost || peak > targetPeak) ? targetPeak / peak : 1;
    if (gain !== 1) for (let index = 0; index < sampleCount; index += 1) { value.left[index] *= gain; value.right[index] *= gain; }
    return peak;
  };

  const audioFiles = [];
  for (const [name, value] of stems) {
    const target = name.includes("Bass") || name.includes("SubBass") ? 0.42 : name.includes("Lead") ? 0.48 : 0.38;
    normalize(value, target);
  }

  const lumenNames = [...requiredLumen, ...Object.keys(customLumen)];
  const instruments = lumenNames.map((name) => ({
    ...synthStore.synthDraftToInstrumentPatch(lumenRecord(name).patch),
    id: lumenRecord(name).id,
    name,
    icon: "ph:sparkle",
    kind: "wavetable",
    waveform: "wavetable",
    sampleIds: [],
    setId: "lumen-test",
    source: { kind: "created", label: "Made in Beat / Lumen" },
    descriptors: ["lumen", "mvp-test", "demo"],
    userCreated: false,
  }));
  instruments.push(...requiredAurum.map((name) => structuredClone(aurumInstruments[name])));
  instruments.push(...Object.values(drumKit).map((instrument) => structuredClone(instrument)));
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
  const chordClipNotes = (startBar, barCount, style = "held") => Array.from({ length: barCount }, (_, localBar) => {
    const entry = progression[(startBar + localBar) % 4];
    if (style === "stabs") {
      const drop = (startBar + localBar >= 16 && startBar + localBar < 20) || (startBar + localBar >= 24 && startBar + localBar < 30);
      const offsets = drop ? [0, 1.5, 2.75, 3.5] : [0, 2.5];
      return offsets.flatMap((offset, stabIndex) => {
        const firstVoice = stabIndex % 2;
        return entry.chord.slice(firstVoice, firstVoice + (drop ? 4 : 3)).map((pitch, voice) =>
          midiNote(pitch + 12, localBar * 4 + offset, [0.72, 0.38, 0.68, 0.26][stabIndex], 88 - stabIndex * 5 - voice * 3));
      });
    }
    return entry.chord.map((pitch, voice) => midiNote(pitch + (style === "pad" ? 0 : 12), localBar * 4, 3.72 - voice * 0.025, 64 + voice * 4));
  }).flat();
  const bassClipNotes = (startBar, barCount, chorus = false) => Array.from({ length: barCount }, (_, localBar) => {
    const root = progression[(startBar + localBar) % 4].root - 12;
    const nextRoot = progression[(startBar + localBar + 1) % 4].root - 12;
    const approach = nextRoot > root ? nextRoot - 2 : nextRoot + 2;
    const pattern = chorus
      ? [[0, root, 0.82, 108], [0.75, root + 7, 0.42, 82], [1.5, root + 12, 0.58, 94], [2.25, root + 7, 0.46, 86], [3, root, 0.42, 92], [3.5, approach, 0.32, 76]]
      : [[0, root, 1.15, 101], [1.5, root + 7, 0.58, 80], [2.5, root + 12, 0.62, 91], [3.5, approach, 0.34, 74]];
    return pattern.map(([offset, pitch, length, velocity], index) => midiNote(pitch, localBar * 4 + offset, length, velocity, {
      ...(index === pattern.length - 1 ? {
        curve: [{ beat: 0, pitch }, { beat: length * 0.55, pitch }, { beat: length, pitch: nextRoot }],
      } : {}),
    }));
  }).flat();
  const subClipNotes = (startBar, barCount) => Array.from({ length: barCount }, (_, localBar) => {
    const root = progression[(startBar + localBar) % 4].root - 24;
    return [midiNote(root, localBar * 4, 3.7, 82)];
  }).flat();
  const basslineClipNotes = (startBar, barCount, finalPeak = false) => Array.from({ length: barCount }, (_, localBar) =>
    basslineBarEvents(startBar + localBar, finalPeak).map((entry, index) => midiNote(entry.pitch, localBar * 4 + entry.offset,
      entry.length, entry.velocity, {
        ...(index === 5 ? {
          curve: [{ beat: 0, pitch: entry.pitch }, { beat: entry.length * 0.7, pitch: entry.pitch }, { beat: entry.length, pitch: entry.pitch + 2 }],
          ...(localBar < barCount - 1 ? {
            connectToIndex: (localBar + 1) * (finalPeak ? 7 : 6),
          } : {}),
        } : {}),
        automation: [automationLane("filter.cutoff", [[0, 0.28, "linear"], [entry.length, finalPeak ? 0.78 : 0.58, "easeOut"]])],
      }))).flat();
  const arpClipNotes = (startBar, barCount, dense = false) => Array.from({ length: barCount }, (_, localBar) => {
    const chord = progression[(startBar + localBar) % 4].chord.map((pitch) => pitch + 12);
    const pattern = dense ? [0, 2, 1, 3, 2, 4, 3, 1, 2, 0, 3, 4, 2, 1, 3, 2] : [0, 2, 1, 3, 2, 1, 4, 2];
    return pattern.map((voice, step) => midiNote(chord[voice], localBar * 4 + step * (4 / pattern.length), step % 4 === 3 ? 0.38 : 0.18, 64 + (step % 4) * 7));
  }).flat();
  const motifClipNotes = (source, transpose = 0, addExpression = false, expression = {}) => {
    const isChorus = source.length === chorusMotif.length;
    const starts = isChorus ? chorusStarts : motifStarts;
    const lengths = isChorus ? chorusLengths : motifLengths;
    return source.map((pitch, index) => {
      const length = lengths[index] * leadLengthShape[index % leadLengthShape.length] * (expression.lengthScale ?? 1);
      const velocity = Math.max(1, Math.min(127, Math.round((80 + (index % 5) * 6)
        * leadDynamics[index % leadDynamics.length] * (expression.velocityScale ?? 1))));
      return midiNote(pitch + transpose, starts[index] + leadTimingOffsets[index % leadTimingOffsets.length], length, velocity, {
      ...(addExpression && index % 5 === 4 ? {
        curve: [{ beat: 0, pitch: pitch + transpose }, { beat: length * 0.58, pitch: pitch + transpose }, { beat: length, pitch: source[Math.min(index + 1, source.length - 1)] + transpose }],
      } : {}),
      ...(addExpression ? { automation: [automationLane("macro.1", [[0, 0.18 + (index % 3) * 0.06, "linear"], [length, 0.62 + (index % 4) * 0.07, "easeOut"]])] } : {}),
      });
    });
  };
  const harmonyClipNotes = (source, profile, transpose = 0) => {
    const starts = source.length === chorusMotif.length ? chorusStarts : motifStarts;
    const lengths = source.length === chorusMotif.length ? chorusLengths : motifLengths;
    return source.flatMap((pitch, index) => {
      if (!harmonyIndices[profile].has(index % 12)) return [];
      const interval = harmonyIntervals[profile][index % 12];
      const harmonyPitch = pitch + transpose + interval;
      const length = lengths[index] * (profile === "whisper" ? 1.18 : profile === "tension" && interval > 0 ? 0.72 : 1.02);
      const startBeat = starts[index] - leadTimingOffsets[index % leadTimingOffsets.length] * 0.55;
      const tensionCurve = interval > 0 && interval <= 2
        ? [{ beat: 0, pitch: harmonyPitch }, { beat: length * 0.52, pitch: harmonyPitch }, { beat: length, pitch: pitch + transpose }]
        : undefined;
      const notes = [midiNote(harmonyPitch, startBeat, length, 64 + (index % 4) * 7, {
        ...(tensionCurve ? { curve: tensionCurve } : {}),
        automation: [automationLane("filter.cutoff", [[0, 0.24 + (index % 3) * 0.08, "linear"], [length, 0.5 + (index % 4) * 0.08, "easeOut"]])],
      })];
      if (profile === "chordal" && [0, 3, 8].includes(index % 12))
        notes.push(midiNote(pitch + transpose - 7, startBeat + 0.012, length * 1.08, 58 + (index % 3) * 5));
      return notes;
    });
  };
  const counterAnswerNotes = (transpose = 0) => [81, 79, 77, 74].map((pitch, index) => midiNote(
    pitch + transpose, [0, 0.75, 1.5, 2.5][index], [0.5, 0.5, 0.72, 0.92][index], 88 - index * 4,
    { automation: [automationLane("macro.1", [[0, 0.24, "linear"], [[0.5, 0.5, 0.72, 0.92][index], 0.7, "easeOut"]])] },
  ));
  const brassStabNotes = (startBar, barCount, dense = false) => Array.from({ length: barCount }, (_, localBar) => {
    const entry = progression[(startBar + localBar) % 4];
    const offsets = dense ? [0, 1.5, 3] : [0, 2];
    return offsets.flatMap((offset, stab) => entry.chord.slice(stab % 2, stab % 2 + 3).map((pitch, voice) =>
      midiNote(pitch + 12, localBar * 4 + offset, dense ? 0.26 : 0.38, 94 - voice * 5 + stab * 3)));
  }).flat();
  const countervoiceClipNotes = (startBar, barCount) => Array.from({ length: barCount }, (_, localBar) => {
    const entry = progression[(startBar + localBar) % 4];
    const line = localBar % 2 === 0 ? entry.guide : [...entry.guide].reverse();
    return line.map((pitch, voice) => midiNote(pitch - (voice === 0 ? 12 : 0), localBar * 4 + voice * 2,
      voice === 0 ? 1.82 : 1.42, 66 + voice * 8, {
        automation: [automationLane("macro.1", [[0, 0.22, "linear"], [voice === 0 ? 1.82 : 1.42, 0.52, "easeOut"]])],
      }));
  }).flat();
  const acidClipNotes = () => acidPitches.map((pitch, index) => {
    const nextPitch = acidPitches[(index + 1) % acidPitches.length];
    return midiNote(pitch, index * 2, 1.9, 82 + (index % 3) * 12, {
      connectToIndex: index < acidPitches.length - 1 ? index + 1 : undefined,
      curve: [{ beat: 0, pitch }, { beat: 1.25, pitch }, { beat: 1.9, pitch: nextPitch }],
      automation: [automationLane("filter.cutoff", [[0, 0.18, "easeIn"], [1.25, 0.82, "smoothstep"], [1.9, 0.34, "easeOut"]])],
    });
  });
  const namedMidiSegment = (id, name, trackId, instrumentId, startBeat, length, notes, automation) => ({
    ...midiSegment(id, trackId, instrumentId, startBeat, length, notes, automation), name,
  });

  const discoStringNotes = (startBar, barCount, intensity = 1) => Array.from({ length: barCount }, (_, localBar) => {
    const entry = progression[(startBar + localBar) % 4];
    return [0.5, 1.5, 2.5, 3.5].flatMap((offset, stab) => entry.chord.slice(stab % 2, stab % 2 + 3).map((pitch, voice) =>
      midiNote(pitch + 12, localBar * 4 + offset, stab === 3 ? 0.3 : 0.4, Math.round((80 + stab * 5 - voice * 3) * intensity))));
  }).flat();
  const shortChordNotes = (startBar, barCount, drop = false) => Array.from({ length: barCount }, (_, localBar) => {
    const entry = progression[(startBar + localBar) % 4];
    const offsets = drop ? [0, 1.5, 2.75] : localBar % 2 === 0 ? [0] : [1.5];
    return offsets.flatMap((offset, stab) => entry.chord.slice(stab % 2, stab % 2 + (drop ? 4 : 3)).map((pitch, voice) =>
      midiNote(pitch + 12, localBar * 4 + offset, drop ? [0.58, 0.36, 0.62][stab] : 1.85, 78 + stab * 6 - voice * 3)));
  }).flat();
  const dropBassNotes = (startBar, barCount, role, finalPeak = false) => Array.from({ length: barCount }, (_, localBar) => {
    const root = progression[(startBar + localBar) % 4].root - 12;
    const pattern = role === "wobble"
      ? [[0, root, 0.72], [1, root + 7, 0.42], [2.25, root, 0.62], [3.25, root + 10, 0.42]]
      : finalPeak
        ? [[0.75, root + 12, 0.38], [1.5, root + 7, 0.3], [2.75, root + 10, 0.3], [3.65, root + 12, 0.22]]
        : [[1.5, root + 12, 0.36], [3, root + 7, 0.32]];
    return pattern.map(([offset, pitch, length], index) => midiNote(pitch, localBar * 4 + offset, length,
      (finalPeak ? 104 : 94) - index * 4, {
        ...(role === "growl" && index === pattern.length - 1 ? {
          curve: [{ beat: 0, pitch }, { beat: length * 0.65, pitch }, { beat: length, pitch: pitch + 2 }],
        } : {}),
        automation: [automationLane(role === "growl" ? "osc.a.warp" : "filter.cutoff", [[0, 0.22, "easeIn"], [length, finalPeak ? 0.86 : 0.68, "easeOut"]])],
      }));
  }).flat();
  const notesWithin = (notes, length) => notes.filter((entry) => entry.startBeat < length).map((entry) => ({
    ...entry, lengthBeats: Math.min(entry.lengthBeats, Math.max(0.05, length - entry.startBeat)),
  }));

  const midiTracks = [
    track("track-aurum-keys", "Aurum Chord Pulse", "midi", aurumInstruments.Aurum_Keys_01.id, [
      namedMidiSegment("keys-intro-answer", "Gentle Keys Answer", "track-aurum-keys", aurumInstruments.Aurum_Keys_01.id, 8, 8, shortChordNotes(2, 2)),
      namedMidiSegment("keys-pulse-a", "Sparse Pulse A", "track-aurum-keys", aurumInstruments.Aurum_Keys_01.id, 16, 8, shortChordNotes(4, 2)),
      namedMidiSegment("keys-pulse-b", "Sparse Pulse B", "track-aurum-keys", aurumInstruments.Aurum_Keys_01.id, 24, 8, shortChordNotes(6, 2)),
      namedMidiSegment("keys-disco-answer", "Disco Chord Answers", "track-aurum-keys", aurumInstruments.Aurum_Keys_01.id, 32, 16, shortChordNotes(8, 4)),
      namedMidiSegment("keys-drop-one", "First Drop Punches", "track-aurum-keys", aurumInstruments.Aurum_Keys_01.id, 64, 16, shortChordNotes(16, 4, true), [automationLane("macro.1", [[0, 0.36, "linear"], [12, 0.68, "smoothstep"], [16, 0.42, "easeOut"]])]),
      namedMidiSegment("keys-rebuild", "Rebuild Chords", "track-aurum-keys", aurumInstruments.Aurum_Keys_01.id, 88, 8, shortChordNotes(22, 2)),
      namedMidiSegment("keys-final-a", "Final Peak Punches A", "track-aurum-keys", aurumInstruments.Aurum_Keys_01.id, 96, 12, shortChordNotes(24, 3, true)),
      namedMidiSegment("keys-final-b", "Final Peak Punches B", "track-aurum-keys", aurumInstruments.Aurum_Keys_01.id, 108, 12, shortChordNotes(27, 3, true), [automationLane("macro.1", [[0, 0.52, "linear"], [8, 0.82, "cubic"], [12, 0.42, "easeOut"]])]),
      namedMidiSegment("keys-resolution", "D Minor Resolution", "track-aurum-keys", aurumInstruments.Aurum_Keys_01.id, 124, 4,
        [50, 53, 57, 64].map((pitch, voice) => midiNote(pitch + 12, 0, 3.72 - voice * 0.02, 66 + voice * 3))),
    ], -5, { ...musicRoute, pan: 0.12, effects: [
      effect("fx-aurum-keys-phaser", "phaser", { rateHz: 0.24, centerHz: 920, depthOct: 1.25, feedback: 16, mix: 20 }),
      effect("fx-aurum-keys-highpass", "highpass", { cutoffHz: 140, resonance: 3 }),
    ] }),
    track("track-aurum-organ", "Aurum Guide-Tone Countervoice", "midi", aurumInstruments.Aurum_Organ_01.id, [
      namedMidiSegment("organ-pulse", "Low Guide-Tone Pulse", "track-aurum-organ", aurumInstruments.Aurum_Organ_01.id, 16, 16, countervoiceClipNotes(4, 4)),
      namedMidiSegment("organ-disco", "Disco Inner Voices", "track-aurum-organ", aurumInstruments.Aurum_Organ_01.id, 40, 8, countervoiceClipNotes(10, 2)),
      namedMidiSegment("organ-build", "Contrary Build", "track-aurum-organ", aurumInstruments.Aurum_Organ_01.id, 48, 12, countervoiceClipNotes(12, 3), [automationLane("macro.1", [[0, 0.18, "linear"], [12, 0.58, "cubic"]])]),
      namedMidiSegment("organ-drop-answer", "Drop Guide Answers", "track-aurum-organ", aurumInstruments.Aurum_Organ_01.id, 72, 8, countervoiceClipNotes(18, 2)),
      namedMidiSegment("organ-final-answer", "Final Contrary Voice", "track-aurum-organ", aurumInstruments.Aurum_Organ_01.id, 104, 16, countervoiceClipNotes(26, 4), [automationLane("macro.1", [[0, 0.28, "linear"], [16, 0.68, "smoothstep"]])]),
    ], -10, { ...musicRoute, pan: -0.2, effects: [
      effect("fx-organ-chorus", "chorus", { rateHz: 0.32, depthMs: 4, delayMs: 12, feedback: 1, mix: 16 }),
      effect("fx-organ-highpass", "highpass", { cutoffHz: 220, resonance: 2 }),
    ] }),
    track("track-lumen-pad", "Lumen Dawn Veil", "midi", customLumen["Lumen Dawn Veil"].id, [
      namedMidiSegment("pad-dawn-a", "Dawn: Three Voices", "track-lumen-pad", customLumen["Lumen Dawn Veil"].id, 0, 8,
        Array.from({ length: 2 }, (_, bar) => progression[bar].chord.slice(0, 3).map((pitch, voice) => midiNote(pitch, bar * 4, 3.78 - voice * 0.02, 52 + voice * 4))).flat(),
        [automationLane("macro.1", [[0, 0.1, "easeIn"], [8, 0.24, "smoothstep"]])]),
      namedMidiSegment("pad-dawn-b", "Dawn: Full Voicing", "track-lumen-pad", customLumen["Lumen Dawn Veil"].id, 8, 8, chordClipNotes(2, 2, "pad")),
      namedMidiSegment("pad-vacuum", "Pre-Drop Air", "track-lumen-pad", customLumen["Lumen Dawn Veil"].id, 60, 3,
        [57, 60, 64, 69].map((pitch, voice) => midiNote(pitch, 0, 2.72 - voice * 0.02, 50 + voice * 3))),
      namedMidiSegment("pad-break-a", "Breakdown Hollow", "track-lumen-pad", customLumen["Lumen Dawn Veil"].id, 80, 8,
        Array.from({ length: 2 }, (_, bar) => progression[bar].chord.slice(0, 3).map((pitch, voice) => midiNote(pitch, bar * 4, 3.72, 52 + voice * 3))).flat()),
      namedMidiSegment("pad-break-b", "Breakdown Opens", "track-lumen-pad", customLumen["Lumen Dawn Veil"].id, 88, 8, chordClipNotes(22, 2, "pad"), [automationLane("macro.1", [[0, 0.18, "linear"], [8, 0.52, "cubic"]])]),
      namedMidiSegment("pad-resolve-bb", "Release to Bbmaj9", "track-lumen-pad", customLumen["Lumen Dawn Veil"].id, 120, 4,
        progression[1].chord.map((pitch, voice) => midiNote(pitch, 0, 3.72 - voice * 0.02, 54 + voice * 3))),
      namedMidiSegment("pad-resolve-dm", "Resolve to Dm add9", "track-lumen-pad", customLumen["Lumen Dawn Veil"].id, 124, 4,
        [50, 53, 57, 64, 69].map((pitch, voice) => midiNote(pitch, 0, 3.82 - voice * 0.02, 58 + voice * 3))),
    ], -5.5, { ...musicRoute, effects: [
      effect("fx-lumen-pad-chorus", "chorus", { rateHz: 0.16, depthMs: 8, delayMs: 15, feedback: 3, mix: 20 }),
      effect("fx-lumen-pad-lowpass", "lowpass", { cutoffHz: 5200, resonance: 8 }, [automationLane("cutoffHz", [[0, 1800, "easeIn"], [16, 4200, "smoothstep"], [80, 2400, "easeOut"], [96, 6200, "cubic"], [128, 1600, "easeOut"]], true)]),
    ] }),
    track("track-lumen-strings", "Lumen Disco Strings", "midi", customLumen["Lumen Disco Strings"].id, [
      namedMidiSegment("strings-disco-a", "Disco Strings A", "track-lumen-strings", customLumen["Lumen Disco Strings"].id, 32, 8, discoStringNotes(8, 2, 0.9)),
      namedMidiSegment("strings-disco-b", "Disco Strings B", "track-lumen-strings", customLumen["Lumen Disco Strings"].id, 40, 8, discoStringNotes(10, 2, 1)),
      namedMidiSegment("strings-build-a", "String Build A", "track-lumen-strings", customLumen["Lumen Disco Strings"].id, 48, 4, discoStringNotes(12, 1, 0.9)),
      namedMidiSegment("strings-build-b", "String Build B", "track-lumen-strings", customLumen["Lumen Disco Strings"].id, 52, 4, discoStringNotes(13, 1, 1)),
      namedMidiSegment("strings-build-c", "String Build C", "track-lumen-strings", customLumen["Lumen Disco Strings"].id, 56, 4, discoStringNotes(14, 1, 1.08), [automationLane("filter.cutoff", [[0, 0.34, "easeIn"], [4, 0.88, "cubic"]])]),
      namedMidiSegment("strings-peak-a", "Peak String Flash A", "track-lumen-strings", customLumen["Lumen Disco Strings"].id, 104, 8, discoStringNotes(26, 2, 0.92)),
      namedMidiSegment("strings-peak-b", "Peak String Flash B", "track-lumen-strings", customLumen["Lumen Disco Strings"].id, 112, 8, discoStringNotes(28, 2, 1.04)),
    ], -8, { ...musicRoute, pan: 0.14, effects: [effect("fx-strings-phaser", "phaser", { rateHz: 0.3, centerHz: 1200, depthOct: 0.8, feedback: 8, mix: 12 })] }),
    track("track-lumen-brass", "Lumen Disco Brass", "midi", customLumen["Lumen Disco Brass"].id, [
      namedMidiSegment("brass-disco-a", "Disco Brass Hook A", "track-lumen-brass", customLumen["Lumen Disco Brass"].id, 32, 8, brassStabNotes(8, 2)),
      namedMidiSegment("brass-disco-b", "Disco Brass Hook B", "track-lumen-brass", customLumen["Lumen Disco Brass"].id, 40, 8, brassStabNotes(10, 2)),
      namedMidiSegment("brass-build-a", "Brass Build A", "track-lumen-brass", customLumen["Lumen Disco Brass"].id, 48, 4, brassStabNotes(12, 1)),
      namedMidiSegment("brass-build-b", "Brass Build B", "track-lumen-brass", customLumen["Lumen Disco Brass"].id, 52, 4, brassStabNotes(13, 1, true)),
      namedMidiSegment("brass-build-c", "Brass Build C", "track-lumen-brass", customLumen["Lumen Disco Brass"].id, 56, 4, brassStabNotes(14, 1, true), [automationLane("filter.cutoff", [[0, 0.36, "linear"], [4, 0.86, "cubic"]])]),
      namedMidiSegment("brass-drop-a", "Drop Brass Punctuation A", "track-lumen-brass", customLumen["Lumen Disco Brass"].id, 64, 8, brassStabNotes(16, 2, true)),
      namedMidiSegment("brass-drop-b", "Drop Brass Punctuation B", "track-lumen-brass", customLumen["Lumen Disco Brass"].id, 72, 8, brassStabNotes(18, 2, true)),
      namedMidiSegment("brass-final-a", "Peak Brass A", "track-lumen-brass", customLumen["Lumen Disco Brass"].id, 96, 8, brassStabNotes(24, 2, true)),
      namedMidiSegment("brass-final-b", "Peak Brass B", "track-lumen-brass", customLumen["Lumen Disco Brass"].id, 104, 8, brassStabNotes(26, 2, true)),
      namedMidiSegment("brass-final-c", "Peak Brass C", "track-lumen-brass", customLumen["Lumen Disco Brass"].id, 112, 8, brassStabNotes(28, 2, true)),
    ], -7, { ...musicRoute, pan: 0.18, effects: [
      effect("fx-brass-sat", "saturator", { drive: 12, mix: 18 }),
      effect("fx-brass-highpass", "highpass", { cutoffHz: 260, resonance: 3 }),
    ] }),
    track("track-lumen-choir", "Lumen Air Choir", "midi", customLumen["Lumen Air Choir"].id, [
      namedMidiSegment("choir-break-a", "Choir Valley A", "track-lumen-choir", customLumen["Lumen Air Choir"].id, 80, 8, chordClipNotes(20, 2, "pad")),
      namedMidiSegment("choir-break-b", "Choir Valley Opens", "track-lumen-choir", customLumen["Lumen Air Choir"].id, 88, 8, chordClipNotes(22, 2, "pad"), [automationLane("macro.1", [[0, 0.16, "linear"], [8, 0.56, "cubic"]])]),
      namedMidiSegment("choir-peak", "Choir Above Final Peak", "track-lumen-choir", customLumen["Lumen Air Choir"].id, 112, 8, chordClipNotes(28, 2, "pad")),
      namedMidiSegment("choir-release", "Choir Release", "track-lumen-choir", customLumen["Lumen Air Choir"].id, 120, 8,
        [[57, 0, 3.7], [60, 0, 3.7], [64, 0, 3.7], [57, 4, 3.8], [64, 4, 3.8], [69, 4, 3.8]].map(([pitch, start, length], index) => midiNote(pitch, start, length, 52 + index * 2))),
    ], -10, { ...musicRoute, pan: -0.12, effects: [
      effect("fx-choir-lowpass", "lowpass", { cutoffHz: 4800, resonance: 5 }),
      effect("fx-choir-reverb", "reverb", { roomSize: 72, damping: 46, mix: 24 }),
    ] }),
    track("track-lumen-arp", "Lumen Glass Arpeggio", "midi", customLumen["Lumen Glass Pluck"].id, [
      namedMidiSegment("arp-pulse", "Sparse Glass Pulse", "track-lumen-arp", customLumen["Lumen Glass Pluck"].id, 24, 8, arpClipNotes(6, 2)),
      namedMidiSegment("arp-build-8", "Build Eighths", "track-lumen-arp", customLumen["Lumen Glass Pluck"].id, 48, 4, arpClipNotes(12, 1)),
      namedMidiSegment("arp-build-16-a", "Build Sixteenths A", "track-lumen-arp", customLumen["Lumen Glass Pluck"].id, 52, 4, arpClipNotes(13, 1, true)),
      namedMidiSegment("arp-build-16-b", "Build Sixteenths B", "track-lumen-arp", customLumen["Lumen Glass Pluck"].id, 56, 4, arpClipNotes(14, 1, true), [automationLane("macro.1", [[0, 0.24, "linear"], [4, 0.82, "cubic"]])]),
      namedMidiSegment("arp-pre-drop", "Three Note Pickup", "track-lumen-arp", customLumen["Lumen Glass Pluck"].id, 62.5, 1.5,
        [[69, 0, 0.2], [72, 0.5, 0.2], [77, 1, 0.28]].map(([pitch, start, length]) => midiNote(pitch, start, length, 88 + start * 10))),
      namedMidiSegment("arp-rebuild", "Rebuild Glass", "track-lumen-arp", customLumen["Lumen Glass Pluck"].id, 88, 8, arpClipNotes(22, 2)),
      namedMidiSegment("arp-peak-a", "Peak Burst A", "track-lumen-arp", customLumen["Lumen Glass Pluck"].id, 104, 4, arpClipNotes(26, 1, true)),
      namedMidiSegment("arp-peak-b", "Peak Burst B", "track-lumen-arp", customLumen["Lumen Glass Pluck"].id, 108, 4, arpClipNotes(27, 1, true)),
      namedMidiSegment("arp-peak-release", "Peak Burst Release", "track-lumen-arp", customLumen["Lumen Glass Pluck"].id, 112, 4, arpClipNotes(28, 1)),
    ], -6, { ...musicRoute, pan: -0.18, effects: [effect("fx-lumen-arp-delay", "delay", { timeMs: 234.375, feedback: 30, mix: 20 }, [automationLane("mix", [[24, 10, "hold"], [64, 28, "cubic"], [80, 12, "easeOut"], [112, 32, "smoothstep"]], true)])] }),
    track("track-aurum-bass", "Aurum Main Bass", "midi", aurumInstruments.Aurum_Bass_01.id, [
      namedMidiSegment("bass-pulse", "Simple Pulse Bass", "track-aurum-bass", aurumInstruments.Aurum_Bass_01.id, 16, 16, bassClipNotes(4, 4)),
      namedMidiSegment("bass-disco", "Octave Disco Bass", "track-aurum-bass", aurumInstruments.Aurum_Bass_01.id, 32, 16, bassClipNotes(8, 4, true)),
      namedMidiSegment("bass-build", "Ascending Build Bass", "track-aurum-bass", aurumInstruments.Aurum_Bass_01.id, 48, 12, bassClipNotes(12, 3, true), [automationLane("macro.1", [[0, 0.2, "linear"], [12, 0.72, "cubic"]])]),
    ], -7, { outputBusId: "bus-bass", effects: [
      effect("fx-aurum-bass-sat", "saturator", { drive: 20, mix: 62 }),
      effect("fx-aurum-bass-comp", "compressor", { thresholdDb: -21, ratio: 3.4, attackMs: 16, releaseMs: 130, makeupDb: 1, mix: 100 }),
    ] }),
    track("track-lumen-pulse-bass", "Lumen Recurring Bassline", "midi", customLumen["Lumen Pulse Bassline"].id, [
      namedMidiSegment("pulse-bass-verse-a", "Bass Hook A", "track-lumen-pulse-bass", customLumen["Lumen Pulse Bassline"].id, 16, 8, basslineClipNotes(4, 2)),
      namedMidiSegment("pulse-bass-verse-b", "Bass Hook A Return", "track-lumen-pulse-bass", customLumen["Lumen Pulse Bassline"].id, 24, 8, basslineClipNotes(6, 2)),
      namedMidiSegment("pulse-bass-disco-a", "Bass Hook Disco A", "track-lumen-pulse-bass", customLumen["Lumen Pulse Bassline"].id, 32, 8, basslineClipNotes(8, 2)),
      namedMidiSegment("pulse-bass-disco-b", "Bass Hook Disco A Prime", "track-lumen-pulse-bass", customLumen["Lumen Pulse Bassline"].id, 40, 8, basslineClipNotes(10, 2)),
      namedMidiSegment("pulse-bass-build-a", "Bass Hook Build", "track-lumen-pulse-bass", customLumen["Lumen Pulse Bassline"].id, 48, 8, basslineClipNotes(12, 2), [automationLane("filter.cutoff", [[0, 0.3, "linear"], [8, 0.66, "cubic"]])]),
      namedMidiSegment("pulse-bass-build-b", "Bass Hook Build Turn", "track-lumen-pulse-bass", customLumen["Lumen Pulse Bassline"].id, 56, 4, basslineClipNotes(14, 1), [automationLane("filter.cutoff", [[0, 0.5, "linear"], [4, 0.84, "cubic"]])]),
      namedMidiSegment("pulse-bass-drop-a", "Bass Hook Drop A", "track-lumen-pulse-bass", customLumen["Lumen Pulse Bassline"].id, 64, 8, basslineClipNotes(16, 2)),
      namedMidiSegment("pulse-bass-drop-b", "Bass Hook Drop A Prime", "track-lumen-pulse-bass", customLumen["Lumen Pulse Bassline"].id, 72, 8, basslineClipNotes(18, 2)),
      namedMidiSegment("pulse-bass-rebuild", "Bass Hook Rebuild", "track-lumen-pulse-bass", customLumen["Lumen Pulse Bassline"].id, 88, 8, basslineClipNotes(22, 2)),
      namedMidiSegment("pulse-bass-final-a", "Bass Hook Peak A", "track-lumen-pulse-bass", customLumen["Lumen Pulse Bassline"].id, 96, 8, basslineClipNotes(24, 2, true)),
      namedMidiSegment("pulse-bass-final-b", "Bass Hook Peak A Prime", "track-lumen-pulse-bass", customLumen["Lumen Pulse Bassline"].id, 104, 8, basslineClipNotes(26, 2, true)),
      namedMidiSegment("pulse-bass-final-c", "Bass Hook Peak B", "track-lumen-pulse-bass", customLumen["Lumen Pulse Bassline"].id, 112, 8, basslineClipNotes(28, 2, true)),
    ], -5, { outputBusId: "bus-bass", pan: -0.04, effects: [
      effect("fx-pulse-bass-eq", "lowpass", { cutoffHz: 2800, resonance: 6 }),
      effect("fx-pulse-bass-comp", "compressor", { thresholdDb: -20, ratio: 2.8, attackMs: 15, releaseMs: 110, makeupDb: 0.5, mix: 82 }),
    ] }),
    track("track-lumen-sub", "Lumen Drop Sub", "midi", lumenPresets.Lumen_SubBass_02.id, [
      namedMidiSegment("sub-drop-one", "First Drop Foundation", "track-lumen-sub", lumenPresets.Lumen_SubBass_02.id, 64, 16, subClipNotes(16, 4)),
      namedMidiSegment("sub-final-a", "Final Sub A", "track-lumen-sub", lumenPresets.Lumen_SubBass_02.id, 96, 12, subClipNotes(24, 3)),
      namedMidiSegment("sub-final-b", "Final Sub B", "track-lumen-sub", lumenPresets.Lumen_SubBass_02.id, 108, 12, subClipNotes(27, 3)),
    ], -7.5, { outputBusId: "bus-bass", effects: [effect("fx-lumen-sub-lowpass", "lowpass", { cutoffHz: 180, resonance: 4 })] }),
    track("track-lumen-wobble", "Lumen Wobble Bass", "midi", customLumen["Lumen Wobble Bass"].id, [
      ...Array.from({ length: 4 }, (_, index) => namedMidiSegment(`wobble-drop-${index + 1}`, `Wobble Phrase ${index + 1}`,
        "track-lumen-wobble", customLumen["Lumen Wobble Bass"].id, 64 + index * 4, 4, dropBassNotes(16 + index, 1, "wobble"),
        [automationLane("filter.cutoff", [[0, 0.2 + index * 0.04, "easeIn"], [4, 0.64 + index * 0.04, "easeOut"]])])),
      ...Array.from({ length: 6 }, (_, index) => namedMidiSegment(`wobble-final-${index + 1}`, `Peak Wobble ${index + 1}`,
        "track-lumen-wobble", customLumen["Lumen Wobble Bass"].id, 96 + index * 4, 4, dropBassNotes(24 + index, 1, "wobble", true),
        [automationLane("filter.cutoff", [[0, 0.34, "easeIn"], [2, index % 2 ? 0.82 : 0.68, "smoothstep"], [4, 0.28, "easeOut"]])])),
    ], -5.5, { outputBusId: "bus-bass", pan: -0.06, effects: [effect("fx-wobble-highpass", "highpass", { cutoffHz: 52, resonance: 2 })] }),
    track("track-lumen-growl", "Lumen Growl Responses", "midi", customLumen["Lumen Growl Bass"].id, [
      ...Array.from({ length: 4 }, (_, index) => namedMidiSegment(`growl-drop-${index + 1}`, `Growl Answer ${index + 1}`,
        "track-lumen-growl", customLumen["Lumen Growl Bass"].id, 64 + index * 4, 4, dropBassNotes(16 + index, 1, "growl"))),
      ...Array.from({ length: 6 }, (_, index) => namedMidiSegment(`growl-final-${index + 1}`, `Peak Growl ${index + 1}`,
        "track-lumen-growl", customLumen["Lumen Growl Bass"].id, 96 + index * 4, 4, dropBassNotes(24 + index, 1, "growl", true),
        [automationLane("osc.a.warp", [[0, 0.3, "linear"], [2, index % 2 ? 0.9 : 0.72, "cubic"], [4, 0.38, "easeOut"]])])),
    ], -6.5, {
      outputBusId: "bus-bass",
      pan: 0.08,
      effects: [
        effect("fx-growl-highpass", "highpass", { cutoffHz: 420, resonance: 12 }),
        effect("fx-growl-lowpass", "lowpass", { cutoffHz: 3200, resonance: 22 }),
      ],
    }),
    track("track-lumen-anthem", "Lumen Anthem Lead", "midi", customLumen["Lumen Anthem Lead"].id, [
      namedMidiSegment("anthem-tease", "Hook A Teaser", "track-lumen-anthem", customLumen["Lumen Anthem Lead"].id, 8, 8, motifClipNotes(motif, -12, true, { velocityScale: 0.62 })),
      namedMidiSegment("anthem-statement", "Hook A Statement", "track-lumen-anthem", customLumen["Lumen Anthem Lead"].id, 24, 8, motifClipNotes(motif, 0, true, { velocityScale: 0.9 })),
      namedMidiSegment("anthem-disco-return", "Hook A Prime Disco", "track-lumen-anthem", customLumen["Lumen Anthem Lead"].id, 40, 8, motifClipNotes(motifVariation, 0, true, { velocityScale: 0.74 })),
      namedMidiSegment("anthem-drop-a", "Hook A Drop", "track-lumen-anthem", customLumen["Lumen Anthem Lead"].id, 64, 8, motifClipNotes(motif, 0, true, { velocityScale: 1 })),
      namedMidiSegment("anthem-drop-b", "Hook A Prime Drop", "track-lumen-anthem", customLumen["Lumen Anthem Lead"].id, 72, 8, motifClipNotes(motifVariation, 0, true, { velocityScale: 0.76 })),
      namedMidiSegment("anthem-break-fragment", "Hook Fragment in Half Time", "track-lumen-anthem", customLumen["Lumen Anthem Lead"].id, 84, 4, notesWithin(motifClipNotes(motif, -12, true, { velocityScale: 0.6, lengthScale: 1.24 }), 4)),
      namedMidiSegment("anthem-peak-a", "Hook A Final", "track-lumen-anthem", customLumen["Lumen Anthem Lead"].id, 96, 8, motifClipNotes(motif, 0, true, { velocityScale: 0.84 })),
      namedMidiSegment("anthem-peak-b", "Hook A Prime Final", "track-lumen-anthem", customLumen["Lumen Anthem Lead"].id, 104, 8, motifClipNotes(motifVariation, 0, true, { velocityScale: 1.06 })),
      namedMidiSegment("anthem-peak-c", "Hook B Final Answer", "track-lumen-anthem", customLumen["Lumen Anthem Lead"].id, 112, 8, motifClipNotes(motifVariation, 0, true, { velocityScale: 0.82 }), [automationLane("macro.1", [[0, 0.42, "linear"], [6, 0.9, "cubic"], [8, 0.54, "easeOut"]])]),
      namedMidiSegment("anthem-resolution", "Hook Cadence Resolution", "track-lumen-anthem", customLumen["Lumen Anthem Lead"].id, 120, 8,
        [[62, 0, 1.2], [65, 1.5, 0.42], [69, 2, 0.82], [67, 3, 0.72], [65, 4, 1.4], [62, 6, 1.8]].map(([pitch, start, length], index) =>
          midiNote(pitch, start, length, 74 - index * 3, { curve: index === 5 ? [{ beat: 0, pitch }, { beat: 1.1, pitch }, { beat: length, pitch: 62 }] : undefined }))),
    ], -4, { ...musicRoute, pan: 0.08, automation: [automationLane("filter.cutoff", [[8, 0.24, "linear"], [24, 0.58, "smoothstep"], [40, 0.42, "easeOut"], [64, 0.78, "smoothstep"], [80, 0.3, "easeOut"], [104, 0.94, "cubic"], [112, 0.68, "easeOut"], [120, 0.32, "easeOut"]])], effects: [
      effect("fx-anthem-delay", "delay", { timeMs: 234.375, feedback: 18, mix: 12 }),
      effect("fx-anthem-reverb", "reverb", { roomSize: 42, damping: 58, mix: 10 }),
    ] }),
    track("track-lumen-ribbon", "Lumen Ribbon Harmony Lead", "midi", customLumen["Lumen Ribbon Harmony"].id, [
      namedMidiSegment("ribbon-tease", "Ribbon Fragment Below", "track-lumen-ribbon", customLumen["Lumen Ribbon Harmony"].id, 8, 8,
        harmonyClipNotes(motif, "whisper", -12), [automationLane("filter.cutoff", [[0, 0.16, "linear"], [8, 0.28, "easeOut"]])]),
      namedMidiSegment("ribbon-statement", "Ribbon Thirds", "track-lumen-ribbon", customLumen["Lumen Ribbon Harmony"].id, 24, 8,
        harmonyClipNotes(motif, "thirds"), [automationLane("filter.cutoff", [[0, 0.3, "linear"], [8, 0.52, "smoothstep"]])]),
      namedMidiSegment("ribbon-disco", "Ribbon Sixth Harmony", "track-lumen-ribbon", customLumen["Lumen Ribbon Harmony"].id, 40, 8,
        harmonyClipNotes(motifVariation, "sixths"), [automationLane("macro.1", [[0, 0.38, "linear"], [8, 0.7, "cubic"]])]),
      namedMidiSegment("ribbon-drop-open", "Open Drop Harmony", "track-lumen-ribbon", customLumen["Lumen Ribbon Harmony"].id, 64, 8,
        harmonyClipNotes(motif, "open"), [automationLane("filter.cutoff", [[0, 0.28, "linear"], [8, 0.56, "easeOut"]])]),
      namedMidiSegment("ribbon-drop-tension", "Resolving Second Harmony", "track-lumen-ribbon", customLumen["Lumen Ribbon Harmony"].id, 72, 8,
        harmonyClipNotes(motifVariation, "tension"), [automationLane("filter.cutoff", [[0, 0.52, "linear"], [6, 0.86, "cubic"], [8, 0.44, "easeOut"]])]),
      namedMidiSegment("ribbon-break-low", "Low Octave Fragment", "track-lumen-ribbon", customLumen["Lumen Ribbon Harmony"].id, 84, 4,
        notesWithin(harmonyClipNotes(motif.slice(0, 6), "octave", -12), 4), [automationLane("macro.1", [[0, 0.18, "linear"], [4, 0.3, "easeOut"]])]),
      namedMidiSegment("ribbon-peak-thirds", "Peak Thirds", "track-lumen-ribbon", customLumen["Lumen Ribbon Harmony"].id, 96, 8,
        harmonyClipNotes(motif, "thirds"), [automationLane("filter.cutoff", [[0, 0.42, "linear"], [8, 0.7, "smoothstep"]])]),
      namedMidiSegment("ribbon-peak-sixths", "Peak Sixth Exchange", "track-lumen-ribbon", customLumen["Lumen Ribbon Harmony"].id, 104, 8,
        harmonyClipNotes(motifVariation, "sixths"), [automationLane("macro.1", [[0, 0.54, "linear"], [8, 0.84, "cubic"]])]),
      namedMidiSegment("ribbon-peak-chords", "Chordal Lead Crown", "track-lumen-ribbon", customLumen["Lumen Ribbon Harmony"].id, 112, 8,
        harmonyClipNotes(motifVariation, "chordal"), [automationLane("filter.cutoff", [[0, 0.64, "linear"], [5, 0.94, "cubic"], [8, 0.5, "easeOut"]])]),
      namedMidiSegment("ribbon-resolution", "Ribbon Resolves Home", "track-lumen-ribbon", customLumen["Lumen Ribbon Harmony"].id, 120, 8,
        [[53, 0, 1.3], [57, 1.5, 0.48], [60, 2, 0.88], [59, 3, 0.78], [57, 4, 1.5], [53, 6, 1.9], [50, 6, 1.9]]
          .map(([pitch, start, length], index) => midiNote(pitch, start + (index % 2 ? 0.018 : 0), length, 62 - index * 2)),
        [automationLane("filter.cutoff", [[0, 0.3, "linear"], [8, 0.14, "easeOut"]])]),
    ], -7, { ...musicRoute, pan: -0.2, effects: [
      effect("fx-ribbon-chorus", "chorus", { rateHz: 0.19, depthMs: 6, delayMs: 14, feedback: 2, mix: 22 }),
      effect("fx-ribbon-reverb", "reverb", { roomSize: 56, damping: 52, mix: 17 }),
    ] }),
    track("track-lumen-shadow-lead", "Lumen Drop Lead Shadow", "midi", customLumen["Lumen Neon Drop Lead"].id, [
      ...[64, 96, 112].map((startBeat, index) => namedMidiSegment(`shadow-cell-${index + 1}`, `Hook Opening Shadow ${index + 1}`,
        "track-lumen-shadow-lead", customLumen["Lumen Neon Drop Lead"].id, startBeat, 4,
        notesWithin(motifClipNotes(motif.slice(0, 4), -12, true, { velocityScale: 0.58 }), 4))),
    ], -11, { ...musicRoute, pan: 0.22, effects: [effect("fx-shadow-delay", "delay", { timeMs: 187.5, feedback: 16, mix: 9 })] }),
    track("track-lumen-counterlead", "Lumen Star Counterlead", "midi", customLumen["Lumen Star Counterlead"].id, [
      ...[20, 36, 44, 76, 108, 116].map((startBeat, index) => namedMidiSegment(`counter-answer-${index + 1}`, `Four-Note Answer ${index + 1}`,
        "track-lumen-counterlead", customLumen["Lumen Star Counterlead"].id, startBeat, 4, counterAnswerNotes(index >= 4 ? 0 : index === 3 ? -12 : 0))),
    ], -7, { ...musicRoute, pan: -0.24, effects: [
      effect("fx-counterlead-delay", "delay", { timeMs: 281.25, feedback: 24, mix: 16 }),
      effect("fx-counterlead-highpass", "highpass", { cutoffHz: 780, resonance: 3 }),
    ] }),
    track("track-aurum-bell", "Aurum Countermelody", "midi", aurumInstruments.Aurum_Bell_01.id, [
      namedMidiSegment("bell-answers", "Bell Answers", "track-aurum-bell", aurumInstruments.Aurum_Bell_01.id, 0, 128,
        [[14, 76, 0.9], [30, 72, 0.65], [46, 79, 0.8], [63.5, 81, 0.3], [71.5, 84, 0.8], [76, 79, 0.55], [84, 74, 1.2], [92, 72, 0.7], [103.5, 81, 0.7], [108, 84, 0.55], [111.5, 79, 0.85], [116, 86, 0.75], [124, 74, 1.25]].map(([beat, pitch, length]) => midiNote(pitch, beat, length, 82 + (Math.round(beat) % 4) * 4, {
          curve: [{ beat: 0, pitch }, { beat: length * 0.72, pitch }, { beat: length, pitch: pitch + (beat % 2 ? -2 : 2) }],
        }))),
    ], -7, { ...musicRoute, pan: 0.3, effects: [effect("fx-bell-reverb", "reverb", { roomSize: 64, damping: 40, mix: 28 })] }),
    track("track-aether-acid", "Aether Connected Motion", "midi", aetherPreset.id, [
      namedMidiSegment("acid-build", "Connected Build", "track-aether-acid", aetherPreset.id, 48, 12, notesWithin(acidClipNotes(), 12), [automationLane("macro.1", [[0, 0.2, "linear"], [10, 0.86, "cubic"], [12, 0.32, "easeOut"]])]),
      namedMidiSegment("acid-rebuild", "Connected Rebuild", "track-aether-acid", aetherPreset.id, 88, 8, notesWithin(acidClipNotes(), 8), [automationLane("macro.1", [[0, 0.26, "linear"], [8, 0.74, "cubic"]])]),
    ], -6, { ...musicRoute, pan: -0.08, effects: [effect("fx-aether-acid-dist", "distortion", { drive: 26, shape: 40, trimDb: 3, mix: 22 })] }),
    track("track-aether-texture", "Aether Reese Texture", "midi", aetherPreset.id, [
      namedMidiSegment("texture-intro", "Intro Drone", "track-aether-texture", aetherPreset.id, 0, 8, [midiNote(38, 0, 7.6, 58)]),
      namedMidiSegment("texture-break", "Breakdown Drone", "track-aether-texture", aetherPreset.id, 80, 16, [midiNote(34, 0, 15.6, 64)]),
      namedMidiSegment("texture-outro", "Outro Drone", "track-aether-texture", aetherPreset.id, 120, 8, [midiNote(38, 0, 7.6, 52)]),
    ], -11, { ...musicRoute, pan: -0.22, effects: [effect("fx-texture-chorus", "chorus", { rateHz: 0.12, depthMs: 11, delayMs: 18, feedback: 4, mix: 30 })] }),
    track("track-sample-drums", "LM-2 + Pearl Beat Loops", "midi", drumKit.kick.id, [
      drumSegment("drums-pulse", "Light Pulse Loop", "track-sample-drums", drumKit, 16, 16, "grooveA", 54),
      drumSegment("drums-disco", "Four-on-the-Floor Disco", "track-sample-drums", drumKit, 32, 16, "disco", 52),
      drumSegment("drums-build", "Accelerating Build", "track-sample-drums", drumKit, 48, 12, "build", 55),
      drumSegment("drums-vacuum", "Pre-Drop Vacuum", "track-sample-drums", drumKit, 60, 4, "vacuum", 50),
      drumSegment("drums-drop-a", "Half-Time Dubstep Drop", "track-sample-drums", drumKit, 64, 16, "dubstep", 57),
      drumSegment("drums-break", "Sparse Breakdown", "track-sample-drums", drumKit, 80, 8, "break", 50),
      drumSegment("drums-rebuild", "Rebuild Loop", "track-sample-drums", drumKit, 88, 8, "build", 56),
      drumSegment("drums-final", "Final Drop Drive", "track-sample-drums", drumKit, 96, 24, "final", 58),
    ], -3.5, { outputBusId: "bus-drums", sends: [spaceSend(-23, 0.08, true)], effects: [effect("fx-sample-drums-eq", "highpass", { cutoffHz: 28, resonance: 1 })] }),
    track("track-sample-fills", "Sample Transition Fills", "midi", drumKit.tom.id, [
      drumSegment("fill-verse", "Verse Turnaround", "track-sample-fills", drumKit, 44, 4, "fill", 54),
      drumSegment("fill-drop-one", "Drop Pickup", "track-sample-fills", drumKit, 60, 4, "fill", 56),
      drumSegment("fill-drop-exit", "Drop Exit Fill", "track-sample-fills", drumKit, 76, 4, "fill", 57),
      drumSegment("fill-final-drop", "Final Drop Pickup", "track-sample-fills", drumKit, 92, 4, "fill", 57),
      drumSegment("fill-outro", "Outro Turnaround", "track-sample-fills", drumKit, 116, 4, "fill", 55),
    ], -6.5, { outputBusId: "bus-drums", pan: 0.12, effects: [effect("fx-fills-delay", "delay", { timeMs: 93.75, feedback: 14, mix: 10 })] }),
  ];

  const mix = { left: new Float32Array(sampleCount), right: new Float32Array(sampleCount) };
  for (const value of stems.values()) {
    for (let index = 0; index < sampleCount; index += 1) {
      mix.left[index] += value.left[index];
      mix.right[index] += value.right[index];
    }
  }
  const preNormalizePeak = normalize(mix, 0.82, true);
  const previewPath = join(reviewRoot, `${songName}_Preview.wav`);
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
      schemaVersion: 1, id: "bus-drums", name: "Drum Group", channelLayout: "stereo", outputEnabled: true,
      inputTrimDb: -1, gainDb: -2, pan: 0, mute: false, solo: false, soloSafe: false, mixerOrder: 1,
      sends: [{ busId: "bus-space", gainDb: -24, pan: 0.05, enabled: true, preFader: true }],
      effects: { filters: [
        effect("fx-bus-drums-comp", "compressor", { thresholdDb: -16, ratio: 2.4, attackMs: 22, releaseMs: 130, makeupDb: 0.5, mix: 38 }),
        effect("fx-bus-drums-sat", "saturator", { drive: 8, mix: 12 }),
      ] },
    },
    {
      schemaVersion: 1, id: "bus-bass", name: "Bass Group", channelLayout: "stereo", outputEnabled: true,
      inputTrimDb: -1, gainDb: -2.5, pan: 0, mute: false, solo: false, soloSafe: false, mixerOrder: 2,
      sends: [{ busId: "bus-space", gainDb: -28, pan: 0, enabled: true, preFader: false }],
      effects: { filters: [
        effect("fx-bus-bass-lowpass", "lowpass", { cutoffHz: 4200, resonance: 5 }),
        effect("fx-bus-bass-comp", "compressor", { thresholdDb: -20, ratio: 3.2, attackMs: 22, releaseMs: 150, makeupDb: 0.5, mix: 86 }),
      ] },
    },
    {
      schemaVersion: 1, id: "bus-space", name: "Shared Space", channelLayout: "stereo", outputEnabled: true,
      inputTrimDb: 0, gainDb: -5, pan: 0, mute: false, solo: false, soloSafe: true, mixerOrder: 3,
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
      id: "test-song-1",
      name: songName,
      bpm,
      timeSignature: { num: 4, denom: 4, boldBeats: [1] },
      lengthBeats,
      tracks: midiTracks,
      returnBuses,
      masterEqAutomation: [
        { atBeat: 0, bandsDb: [-1.5, -0.5, 0, 0.5, 1, 0.5, -0.5] },
        { atBeat: 48, bandsDb: [-1, 0, 0.5, 1, 1.5, 1, 0] },
        { atBeat: 64, bandsDb: [-0.5, 0.5, 1, 1.5, 1.5, 0.5, -0.5] },
        { atBeat: 80, bandsDb: [-1.5, -0.5, 0, 0.5, 1, 0.5, -1] },
        { atBeat: 96, bandsDb: [-0.5, 0.5, 1, 1.5, 2, 1, 0] },
        { atBeat: 120, bandsDb: [-1.5, -0.5, 0, 0, 0.5, 0, -1.5] },
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
      { id: "lumen-test", name: "Lumen Test Instruments", factory: false },
      { id: "aurum-test", name: "Aurum Test", factory: true },
      { id: "aether-demo", name: "Aether Demo", factory: true },
      { id: "demo-sample-drums", name: "Demo Sample Drums", factory: true },
    ],
    audioFiles,
    components: [
      {
        id: "component-anthem-hook-a", kind: "midi", name: "Anthem Hook A",
        notes: motifClipNotes(motif), lengthBeats: 8, createdAt: 1784680000000,
        folderId: "demo-song-patterns",
      },
      {
        id: "component-anthem-hook-a-prime", kind: "midi", name: "Anthem Hook A Prime",
        notes: motifClipNotes(motifVariation), lengthBeats: 8, createdAt: 1784680000000,
        folderId: "demo-song-patterns",
      },
      {
        id: "component-bass-hook-ab", kind: "midi", name: "Recurring Bass Hook A B",
        notes: basslineClipNotes(0, 2), lengthBeats: 8, createdAt: 1784680000000,
        folderId: "demo-song-patterns",
      },
      {
        id: "component-final-drive", kind: "drum", name: "Final Drive Beat",
        rows: structuredClone(midiTracks.find((entry) => entry.id === "track-sample-drums").segments.at(-1).payload.rows),
        stepCount: 16, speed: 1, lengthBeats: 4, swingPercent: 58,
        timeSignature: { num: 4, denom: 4, boldBeats: [1] }, createdAt: 1784680000000,
        folderId: "demo-song-patterns",
      },
    ],
    componentFolders: [{ id: "demo-song-patterns", name: "Test Song Patterns" }],
    plugins: [],
  };
  const projectPath = join(outputRoot, `${songName}.beat`);
  const migratedDocument = beatDocument.migrateBeatDocument(document);
  const featureCoverage = validateFeatureCoverage(migratedDocument);
  const projectJson = `${JSON.stringify(document, null, 2)}\n`;
  writeFileSync(projectPath, projectJson);

  const metrics = analyze(mix.left, mix.right);
  const projectSha256 = sha256(Buffer.from(projectJson));
  const previewSha256 = sha256(readFileSync(previewPath));
  const structure = [
    { name: "Gentle Dawn", startBeat: 0, endBeat: 16 },
    { name: "Sparse Pulse", startBeat: 16, endBeat: 32 },
    { name: "Disco String Lift", startBeat: 32, endBeat: 48 },
    { name: "Accelerating Build", startBeat: 48, endBeat: 60 },
    { name: "Pre-Drop Vacuum", startBeat: 60, endBeat: 64 },
    { name: "First Dubstep Drop", startBeat: 64, endBeat: 80 },
    { name: "Breakdown", startBeat: 80, endBeat: 88 },
    { name: "Rebuild", startBeat: 88, endBeat: 96 },
    { name: "Final Dubstep Peak", startBeat: 96, endBeat: 120 },
    { name: "Graceful Resolution", startBeat: 120, endBeat: 128 },
  ];
  const sectionMetrics = Object.fromEntries(structure.map((section) => [section.name,
    analyze(mix.left.subarray(Math.round(section.startBeat * beatSeconds * sampleRate), Math.round(section.endBeat * beatSeconds * sampleRate)),
      mix.right.subarray(Math.round(section.startBeat * beatSeconds * sampleRate), Math.round(section.endBeat * beatSeconds * sampleRate)))]));
  const energyArcOk = sectionMetrics["Final Dubstep Peak"].rms > sectionMetrics["Disco String Lift"].rms
    && sectionMetrics["Final Dubstep Peak"].rms > sectionMetrics["First Dubstep Drop"].rms
    && sectionMetrics["Pre-Drop Vacuum"].rms < sectionMetrics["Accelerating Build"].rms * 0.72
    && sectionMetrics["Gentle Dawn"].rms < sectionMetrics["Final Dubstep Peak"].rms * 0.3
    && sectionMetrics["Graceful Resolution"].rms < sectionMetrics["Final Dubstep Peak"].rms * 0.3;
  const report = {
    ok: metrics.finite && metrics.rms > 0.01 && metrics.peak <= 0.9 && energyArcOk
      && (!referenceHashes.project || projectSha256 === referenceHashes.project)
      && (!referenceHashes.preview || previewSha256 === referenceHashes.preview),
    projectPath,
    previewPath,
    sampleRate,
    bpm,
    lengthBeats,
    durationSeconds,
    tracks: document.project.tracks.map((entry) => entry.name),
    engines: ["aether", "aurum", "lumen"],
    structure,
    energyArcOk,
    sectionMetrics,
    featureCoverage,
    projectSha256,
    previewSha256,
    metrics: { ...metrics, preNormalizePeak },
  };
  writeFileSync(join(reviewRoot, "demo-report.json"), JSON.stringify(report, null, 2));
  if (!report.ok) throw new Error(`Demo validation failed: ${JSON.stringify({
    metrics: report.metrics,
    energyArcOk,
    sectionMetrics,
    featureCoverage,
    projectSha256,
    previewSha256,
    referenceHashes,
  })}`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(bundleRoot, { recursive: true, force: true });
}

function makeLumenVariant(baseRecord, id, name, parameterOverrides, effects, modulation = []) {
  if (!baseRecord?.patch) throw new Error(`Cannot create Lumen variant ${name}: missing base preset`);
  const patch = structuredClone(baseRecord.patch);
  patch.name = name;
  patch.parameters = { ...patch.parameters, ...parameterOverrides };
  patch.effects = { filters: structuredClone(effects) };
  patch.modulation = [...structuredClone(patch.modulation ?? []), ...structuredClone(modulation)];
  patch.metadata = { ...patch.metadata, source: "Test_song_1", editable: true };
  return { id, name, patch, category: baseRecord.category, tags: ["created", "lumen", "test-song-1"] };
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

function drumSegment(id, name, trackId, kit, startBeat, sectionLengthBeats, variant = "grooveA", swingPercent = 56) {
  const loopLengthBeats = 4;
  const totalPlays = sectionLengthBeats / loopLengthBeats;
  if (!Number.isInteger(totalPlays) || totalPlays < 1) {
    throw new Error(`Drum loop ${name} must fill a positive whole number of ${loopLengthBeats}-beat plays`);
  }
  const cell = (velocity, leanPercent = 0) => ({ on: true, velocity, leanPercent });
  const steps = (entries) => Array.from({ length: 16 }, (_, index) => entries.get(index) ?? false);
  const selected = drumPattern(variant);
  const cells = (rows) => new Map(rows.map(([step, velocity, lean]) => [step, cell(velocity, lean)]));
  return {
    id, trackId, instrumentId: kit.kick.id, name, startBeat, lengthBeats: loopLengthBeats, repeats: totalPlays - 1, layer: 0,
    payload: {
      kind: "drum", stepCount: 16, speed: 1, sourceLengthBeats: loopLengthBeats, swingPercent,
      timeSignature: { num: 4, denom: 4, boldBeats: [1] },
      rows: [
        { id: `${id}-kick`, instrumentId: kit.kick.id, name: kit.kick.name, steps: steps(cells(selected.kick)) },
        { id: `${id}-snare`, instrumentId: kit.snare.id, name: kit.snare.name, steps: steps(cells(selected.snare)) },
        { id: `${id}-clap`, instrumentId: kit.clap.id, name: kit.clap.name, steps: steps(cells(selected.clap)) },
        { id: `${id}-closed-hat`, instrumentId: kit.closedHat.id, name: kit.closedHat.name, steps: steps(cells(selected.closedHat)) },
        { id: `${id}-open-hat`, instrumentId: kit.openHat.id, name: kit.openHat.name, steps: steps(cells(selected.openHat)) },
        { id: `${id}-tom`, instrumentId: kit.tom.id, name: kit.tom.name, steps: steps(cells(selected.tom)) },
        { id: `${id}-crash`, instrumentId: kit.crash.id, name: kit.crash.name, steps: steps(cells(selected.crash)) },
      ],
    },
  };
}

function drumPattern(variant) {
  const patterns = {
    grooveA: {
      kick: [[0, 122, -2], [7, 88, 3], [8, 116, -1], [11, 82, 4]],
      snare: [[4, 108, 0], [12, 116, 2]], clap: [[12, 58, 4]],
      closedHat: [[2, 68, -4], [6, 78, 4], [10, 70, -3], [14, 84, 6], [15, 50, 10]],
      openHat: [[7, 54, 5]], tom: [], crash: [],
    },
    disco: {
      kick: [[0, 94, 0], [4, 88, 0], [8, 92, 0], [12, 90, 0]],
      snare: [[4, 82, 0], [12, 88, 1]], clap: [[4, 54, 1], [12, 58, 2]],
      closedHat: [[2, 54, -2], [6, 60, 2], [10, 56, -1], [14, 66, 3]],
      openHat: [[6, 50, 2], [14, 56, 4]], tom: [], crash: [],
    },
    build: {
      kick: [[0, 118, 0], [4, 96, 0], [8, 112, 0], [12, 102, 0]],
      snare: [[4, 106, 0], [12, 116, 1], [13, 64, 2], [14, 78, 3]], clap: [[12, 66, 2], [14, 52, 4]],
      closedHat: [[0, 56, -2], [2, 66, 0], [4, 62, -1], [6, 72, 2], [8, 68, -1], [10, 78, 2], [12, 74, 0], [13, 66, 2], [14, 86, 4]],
      openHat: [[10, 58, 2]], tom: [[13, 62, 1], [14, 76, 3]], crash: [],
    },
    chorus: {
      kick: [[0, 124, -1], [3, 84, 2], [4, 104, 0], [8, 120, -1], [10, 90, 2], [12, 110, 1]],
      snare: [[4, 116, 0], [12, 122, 2]], clap: [[4, 72, 1], [12, 78, 3]],
      closedHat: Array.from({ length: 16 }, (_, i) => [i, i % 4 === 2 ? 82 : i % 2 ? 54 : 68, i % 2 ? 4 : -2]),
      openHat: [[6, 68, 4], [14, 76, 6]], tom: [], crash: [],
    },
    dubstep: {
      kick: [[0, 126, -1], [3, 86, 2], [7, 104, 3], [10, 92, 2], [15, 82, 5]],
      snare: [[8, 124, 1]], clap: [[8, 82, 2]],
      closedHat: [[2, 56, -3], [4, 64, 1], [6, 72, 3], [10, 62, -1], [12, 74, 2], [14, 86, 5], [15, 52, 7]],
      openHat: [[7, 62, 4], [14, 74, 5]], tom: [[13, 52, 3]], crash: [],
    },
    vacuum: {
      kick: [], snare: [[14, 68, 1], [15, 92, 3]], clap: [[15, 54, 4]],
      closedHat: [[12, 50, 0], [13, 60, 1], [14, 72, 2], [15, 88, 3]],
      openHat: [], tom: [[14, 72, 2], [15, 98, 4]], crash: [],
    },
    break: {
      kick: [[0, 110, 0], [10, 78, 4]], snare: [[8, 104, 1]], clap: [[8, 54, 3]],
      closedHat: [[2, 52, -3], [6, 60, 3], [11, 48, 6], [14, 62, 5]],
      openHat: [[14, 48, 6]], tom: [[15, 46, 6]], crash: [],
    },
    final: {
      kick: [[0, 126, -1], [3, 90, 2], [4, 106, 0], [7, 84, 3], [8, 122, -1], [10, 94, 2], [12, 112, 1], [15, 86, 5]],
      snare: [[4, 120, 0], [12, 124, 2], [14, 66, 5]], clap: [[4, 76, 1], [12, 82, 3]],
      closedHat: Array.from({ length: 16 }, (_, i) => [i, i % 4 === 2 ? 90 : i % 2 ? 60 : 74, i % 2 ? 4 : -3]),
      openHat: [[6, 72, 4], [14, 82, 6]], tom: [[15, 58, 5]], crash: [],
    },
    fill: {
      kick: [[0, 98, 0], [8, 106, 0]], snare: [[12, 72, 1], [14, 88, 3]], clap: [],
      closedHat: [[2, 48, -2], [6, 54, 2], [10, 62, 3]], openHat: [[15, 64, 5]],
      tom: [[8, 66, 0], [10, 76, 1], [12, 86, 2], [13, 92, 3], [14, 102, 4]], crash: [],
    },
  };
  return patterns[variant] ?? patterns.grooveA;
}

function demoSamplerInstrument(id, name, sampleUrl, envelopePatch = {}) {
  const pearl = sampleUrl.includes("pearl-master-studio");
  return {
    id,
    name,
    kind: "sampler",
    envelope: { attackMs: 1, decayMs: 110, sustain: 0, releaseMs: 110, ...envelopePatch },
    knobs: { cutoff: 0.88, resonance: 0.08, drive: 0, color: 0.62 },
    waveform: "sample",
    sampleIds: [],
    sampleUrl,
    setId: "demo-sample-drums",
    source: pearl
      ? { kind: "factory", label: "Oramics sampled / Pearl Master Studio", url: "https://oramics.github.io/sampled/DRUMS/pearl-master-studio/", license: "Creative Commons Attribution 3.0" }
      : { kind: "factory", label: "Oramics sampled / LM-2", url: "https://oramics.github.io/sampled/DM/LM-2/", license: "Public Domain" },
    descriptors: ["sample", "drum", "demo"],
    userCreated: false,
  };
}

function readPcm16Wav(path, targetRate) {
  const buffer = readFileSync(path);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE")
    throw new Error(`Unsupported WAV container: ${path}`);
  let channels = 0;
  let sourceRate = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = -1;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkData = offset + 8;
    if (chunkId === "fmt ") {
      audioFormat = buffer.readUInt16LE(chunkData);
      channels = buffer.readUInt16LE(chunkData + 2);
      sourceRate = buffer.readUInt32LE(chunkData + 4);
      bitsPerSample = buffer.readUInt16LE(chunkData + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkData;
      dataSize = Math.min(chunkSize, buffer.length - chunkData);
    }
    offset = chunkData + chunkSize + (chunkSize % 2);
  }
  if (audioFormat !== 1 || bitsPerSample !== 16 || channels < 1 || channels > 2 || dataOffset < 0 || sourceRate <= 0)
    throw new Error(`Expected mono/stereo PCM16 WAV: ${path}`);
  const sourceFrames = Math.floor(dataSize / (channels * 2));
  const targetFrames = Math.max(1, Math.round(sourceFrames * targetRate / sourceRate));
  const left = new Float32Array(targetFrames);
  const right = new Float32Array(targetFrames);
  const sampleAt = (frame, channel) => buffer.readInt16LE(dataOffset + (frame * channels + Math.min(channel, channels - 1)) * 2) / 32768;
  for (let frame = 0; frame < targetFrames; frame += 1) {
    const sourcePosition = Math.min(sourceFrames - 1, frame * sourceRate / targetRate);
    const index = Math.floor(sourcePosition);
    const next = Math.min(sourceFrames - 1, index + 1);
    const fraction = sourcePosition - index;
    left[frame] = sampleAt(index, 0) + (sampleAt(next, 0) - sampleAt(index, 0)) * fraction;
    right[frame] = sampleAt(index, 1) + (sampleAt(next, 1) - sampleAt(index, 1)) * fraction;
  }
  return { left, right };
}

function placeSample(target, sample, startBeat, gain, pan, rate) {
  const offset = Math.max(0, Math.round(startBeat * 60 / bpm * rate));
  const leftGain = gain * Math.sqrt((1 - Math.max(-1, Math.min(1, pan))) * 0.5);
  const rightGain = gain * Math.sqrt((1 + Math.max(-1, Math.min(1, pan))) * 0.5);
  for (let index = 0; index < sample.left.length && offset + index < target.left.length; index += 1) {
    target.left[offset + index] += sample.left[index] * leftGain;
    target.right[offset + index] += sample.right[index] * rightGain;
  }
}

function renderDrumSection(target, samples, startBeat, bars, variant, rate) {
  const pattern = drumPattern(variant);
  const settings = {
    kick: [0.64, 0], snare: [0.48, -0.04], clap: [0.3, 0.08],
    closedHat: [0.22, 0.16], openHat: [0.24, 0.2], tom: [0.4, 0.1], crash: [0.46, 0.04],
  };
  for (let bar = 0; bar < bars; bar += 1) {
    for (const [role, hits] of Object.entries(pattern)) {
      const sample = samples[role];
      if (!sample) continue;
      const [gain, pan] = settings[role];
      for (const [step, velocity, leanPercent] of hits) {
        const leanBeats = (leanPercent / 100) * 0.25;
        placeSample(target, sample, startBeat + bar * 4 + step * 0.25 + leanBeats, gain * velocity / 127, pan, rate);
      }
    }
  }
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
  const { project, instruments, components = [] } = document;
  const supportedEffectKinds = new Set([
    "bitcrush", "lowpass", "highpass", "saturator", "distortion", "reverb",
    "delay", "compressor", "chorus", "phaser", "flanger", "plugin",
  ]);
  const effects = [
    ...project.tracks.flatMap((entry) => entry.effects?.filters ?? []),
    ...project.returnBuses.flatMap((entry) => entry.effects?.filters ?? []),
    ...instruments.flatMap((entry) => entry.effects?.filters ?? []),
  ];
  const midiNotes = project.tracks.flatMap((entry) => entry.segments.flatMap((segment) => segment.payload.kind === "midi" ? segment.payload.notes : []));
  const drumSegments = project.tracks.flatMap((entry) => entry.segments).filter((segment) => segment.payload.kind === "drum");
  const drumCells = drumSegments.flatMap((segment) => segment.payload.rows.flatMap((row) => row.steps)).filter((step) => step && typeof step === "object" && step.on);
  const instrumentById = new Map(instruments.map((entry) => [entry.id, entry]));
  const primaryLead = project.tracks.find((entry) => entry.id === "track-lumen-anthem");
  const harmonyLead = project.tracks.find((entry) => entry.id === "track-lumen-ribbon");
  const primaryLeadNotes = primaryLead?.segments.flatMap((segment) => segment.payload.kind === "midi" ? segment.payload.notes : []) ?? [];
  const harmonyLeadNotes = harmonyLead?.segments.flatMap((segment) => segment.payload.kind === "midi" ? segment.payload.notes : []) ?? [];
  const expressiveLeadNotes = [...primaryLeadNotes, ...harmonyLeadNotes];
  const leadHarmonyClusters = harmonyLead?.segments.reduce((sum, segment) => {
    if (segment.payload.kind !== "midi") return sum;
    const groups = new Map();
    for (const entry of segment.payload.notes) {
      const key = Math.round(entry.startBeat * 20);
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return sum + [...groups.values()].filter((count) => count > 1).length;
  }, 0) ?? 0;
  const activeSegmentCountAtBeat = (beat) => project.tracks.flatMap((entry) => entry.segments).filter((segment) => {
    const plays = Math.max(1, Number(segment.repeats ?? 0) + 1);
    return beat >= segment.startBeat && beat < segment.startBeat + segment.lengthBeats * plays;
  }).length;
  const coverage = {
    independentEngines: {
      aether: instruments.some((entry) => entry.synthPatch?.instrumentType === "wavetable-synth" && !entry.aurum),
      aurum: instruments.some((entry) => entry.aurum),
      lumen: instruments.some((entry) => entry.synthPatch?.instrumentType === "lumen-hybrid-synth"),
    },
    audioBuses: project.returnBuses.length,
    editableTracks: project.tracks.length,
    arrangementClips: project.tracks.flatMap((entry) => entry.segments).length,
    shortArrangementClips: project.tracks.flatMap((entry) => entry.segments).filter((entry) => entry.lengthBeats <= 8).length,
    distinctTrackInstruments: new Set(project.tracks.map((entry) => entry.instrumentId).filter(Boolean)).size,
    customLumenInstruments: instruments.filter((entry) => entry.id.startsWith("test-song-1-lumen-") && entry.synthPatch?.instrumentType === "lumen-hybrid-synth").length,
    recurringLeadSegments: project.tracks.find((entry) => entry.id === "track-lumen-anthem")?.segments.length ?? 0,
    dualLeadSegments: harmonyLead?.segments.length ?? 0,
    leadHarmonyClusters,
    resolvingLeadDissonances: harmonyLeadNotes.filter((entry) => (entry.curve?.length ?? 0) > 1
      && Math.abs(entry.curve[0].pitch - entry.curve.at(-1).pitch) <= 2).length,
    humanizedLeadStarts: expressiveLeadNotes.filter((entry) => Math.abs(entry.startBeat * 4 - Math.round(entry.startBeat * 4)) > 0.001).length,
    distinctLeadVelocities: new Set(expressiveLeadNotes.map((entry) => entry.velocity)).size,
    recurringBassSegments: project.tracks.find((entry) => entry.id === "track-lumen-pulse-bass")?.segments.length ?? 0,
    nestedBusSends: project.returnBuses.flatMap((entry) => entry.sends ?? []).length,
    trackSends: project.tracks.flatMap((entry) => entry.sends ?? []).length,
    trackAndBusEffects: effects.length,
    unsupportedEffectKinds: [...new Set(effects.map((entry) => entry.kind).filter((kind) => !supportedEffectKinds.has(kind)))],
    automatedEffects: effects.filter((entry) => (entry.automation?.length ?? 0) > 0).length,
    pitchCurveNotes: midiNotes.filter((entry) => (entry.curve?.length ?? 0) > 1).length,
    midiNotes: midiNotes.length,
    distinctNoteLengths: new Set(midiNotes.map((entry) => Number(entry.lengthBeats).toFixed(3))).size,
    legatoLinks: midiNotes.filter((entry) => Number.isInteger(entry.connectToIndex)).length,
    noteAutomationLanes: midiNotes.reduce((sum, entry) => sum + (entry.automation?.length ?? 0), 0),
    segmentAutomationLanes: project.tracks.flatMap((entry) => entry.segments).reduce((sum, entry) => sum + (entry.automation?.length ?? 0), 0),
    trackAutomationLanes: project.tracks.reduce((sum, entry) => sum + (entry.automation?.length ?? 0), 0),
    drumLoops: drumSegments.length,
    drumLoopPlays: drumSegments.reduce((sum, entry) => sum + entry.repeats + 1, 0),
    drumSwingValues: drumSegments.map((entry) => entry.payload.swingPercent),
    drumLeanCells: drumCells.filter((entry) => Number(entry.leanPercent) !== 0).length,
    drumVelocityCells: drumCells.filter((entry) => Number.isFinite(entry.velocity)).length,
    sampleDrumRows: drumSegments.reduce((sum, segment) => sum + segment.payload.rows.filter((row) => instrumentById.get(row.instrumentId)?.kind === "sampler").length, 0),
    aurumPercussionReferences: project.tracks.flatMap((entry) => entry.segments).filter((segment) => segment.instrumentId === "factory-aurum-percussion-01").length,
    peakConcurrentSegments: Math.max(...Array.from({ length: project.lengthBeats * 4 }, (_, index) => activeSegmentCountAtBeat(index / 4))),
    reusableMidiPatterns: components.filter((entry) => (entry.kind ?? "midi") === "midi" && !entry.instrumentId).length,
    reusableDrumPatterns: components.filter((entry) => entry.kind === "drum").length,
    namedSections: new Set(project.tracks.flatMap((entry) => entry.segments).map((entry) => entry.name).filter(Boolean)).size,
    durationSeconds: project.lengthBeats * 60 / project.bpm,
    masterEqFrames: project.masterEqAutomation.length,
    masterCompressor: project.masterChain.compressorEnabled,
  };
  const failures = [
    ...Object.entries(coverage.independentEngines).filter(([, value]) => !value).map(([engine]) => `missing ${engine} engine`),
    ...(coverage.audioBuses >= 4 ? [] : ["missing audio-bus topology"]),
    ...(coverage.editableTracks >= 18 && coverage.arrangementClips >= 100 && coverage.shortArrangementClips >= 80 ? [] : ["insufficient stress-test arrangement density"]),
    ...(coverage.distinctTrackInstruments >= 16 && coverage.customLumenInstruments >= 12 ? [] : ["insufficient instrument variety"]),
    ...(coverage.recurringLeadSegments >= 9 && coverage.dualLeadSegments >= 9 && coverage.leadHarmonyClusters >= 3
      && coverage.resolvingLeadDissonances >= 3 && coverage.humanizedLeadStarts >= 40 && coverage.distinctLeadVelocities >= 12
      && coverage.recurringBassSegments >= 10
      ? [] : ["missing recurring dual-lead harmony, dissonance, or bass theme"]),
    ...(coverage.nestedBusSends > 0 && coverage.trackSends > 0 ? [] : ["missing bus or track sends"]),
    ...(coverage.trackAndBusEffects >= 20 && coverage.automatedEffects >= 2 ? [] : ["insufficient effect coverage"]),
    ...(coverage.unsupportedEffectKinds.length === 0 ? [] : [`unsupported effect kinds: ${coverage.unsupportedEffectKinds.join(", ")}`]),
    ...(coverage.pitchCurveNotes > 0 && coverage.legatoLinks > 0 ? [] : ["missing MIDI pitch-curve or legato coverage"]),
    ...(coverage.midiNotes >= 1000 && coverage.distinctNoteLengths >= 20 && coverage.peakConcurrentSegments >= 12 ? [] : ["insufficient melodic, rhythmic, or concurrent arrangement complexity"]),
    ...(coverage.noteAutomationLanes > 0 && coverage.segmentAutomationLanes > 0 && coverage.trackAutomationLanes > 0 ? [] : ["missing MIDI automation scope"]),
    ...(coverage.drumLoops >= 5 && coverage.drumLoopPlays >= 26 && coverage.drumLeanCells > 0 && coverage.drumVelocityCells > 0 ? [] : ["missing repeated drum-loop timing coverage"]),
    ...(coverage.sampleDrumRows > 0 && coverage.aurumPercussionReferences === 0 ? [] : ["drums must use sample instruments without Aurum_Percussion_01"]),
    ...(coverage.reusableMidiPatterns >= 3 && coverage.reusableDrumPatterns > 0 ? [] : ["missing reusable MIDI or drum patterns"]),
    ...(coverage.namedSections >= 7 && Math.abs(coverage.durationSeconds - 60) < 0.001 ? [] : ["missing one-minute song structure"]),
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
