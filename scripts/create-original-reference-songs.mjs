#!/usr/bin/env node
// Generates two editable Beat projects: a source-derived piano-rock cover study
// and an original disco-funk reference arrangement.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outputRoot = resolve(process.argv[2] ?? join(tmpdir(), "beat-original-reference-songs"));
const bundleRoot = join(tmpdir(), `beat-original-song-bundle-${Date.now()}`);
const sampleRate = 48000;
const savedAt = Date.UTC(2026, 6, 30, 12, 0, 0);

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

  const factoryLumen = Object.fromEntries(
    synthStore.FACTORY_SYNTH_PRESETS
      .filter((preset) => preset.patch?.instrumentType === "lumen-hybrid-synth")
      .map((preset) => [preset.name, preset]),
  );
  const factoryAurum = Object.fromEntries(
    aurumBank.createAurumTestInstruments("aurum-test").map((instrument) => [instrument.name, instrument]),
  );

  for (const name of ["Lumen_DigitalKeys_02", "Lumen_WidePad_02", "Lumen_MonoLead_02", "Lumen_ArpPluck_02", "Lumen_SubBass_02"])
    if (!factoryLumen[name]) throw new Error(`Missing required Lumen preset: ${name}`);
  for (const name of ["Aurum_Bass_01", "Aurum_Bell_01", "Aurum_Organ_01"])
    if (!factoryAurum[name]) throw new Error(`Missing required Aurum instrument: ${name}`);

  const songSpecs = [
    buildClockworkSkies(factoryLumen, factoryAurum, synthStore),
    buildSeptemberCover(factoryLumen, factoryAurum, synthStore),
  ];
  const reports = [];

  for (const spec of songSpecs) {
    const songFolder = join(outputRoot, spec.name);
    const reviewFolder = join(songFolder, "Review");
    mkdirSync(reviewFolder, { recursive: true });

    const document = makeDocument(spec);
    const migrated = beatDocument.migrateBeatDocument(document);
    validateProject(migrated, spec);
    const projectJson = `${JSON.stringify(migrated, null, 2)}\n`;
    const projectPath = join(songFolder, `${spec.name}.beat`);
    writeFileSync(projectPath, projectJson);

    const previewPath = join(reviewFolder, `${spec.name}_Preview.wav`);
    const metrics = renderPreview(spec, synthPreview, previewPath);
    const drumTrack = Object.entries(metrics.tracks).find(([trackName]) => trackName.includes("Drums"));
    const musicTracks = Object.entries(metrics.tracks).filter(([trackName]) => !trackName.includes("Drums") && !trackName.includes("Bass"));
    const strongestMusicRms = Math.max(...musicTracks.map(([, value]) => value.rms));
    const drumToStrongestMusicRmsDb = 20 * Math.log10(Math.max(1e-9, drumTrack?.[1].rms ?? 0) / Math.max(1e-9, strongestMusicRms));
    const balance = {
      drumTrack: drumTrack?.[0] ?? "",
      strongestMusicRms,
      drumRms: drumTrack?.[1].rms ?? 0,
      drumToStrongestMusicRmsDb,
      ok: Number.isFinite(drumToStrongestMusicRmsDb) && drumToStrongestMusicRmsDb <= 3,
    };
    const report = {
      ok: metrics.finite && metrics.peak <= 0.86 && metrics.rms >= 0.035 && balance.ok,
      name: spec.name,
      title: spec.title,
      originality: spec.originality,
      projectPath,
      previewPath,
      bpm: spec.bpm,
      lengthBeats: spec.lengthBeats,
      durationSeconds: spec.lengthBeats * 60 / spec.bpm,
      tracks: spec.tracks.map((entry) => entry.name),
      trackCount: spec.tracks.length,
      segmentCount: spec.tracks.reduce((sum, entry) => sum + entry.segments.length, 0),
      midiNoteCount: spec.tracks.reduce((sum, entry) => sum + entry.segments.reduce(
        (inner, segment) => inner + (segment.payload.kind === "midi" ? segment.payload.notes.length : 0), 0), 0),
      drumLoopPlays: spec.tracks.reduce((sum, entry) => sum + entry.segments.reduce(
        (inner, segment) => inner + (segment.payload.kind === "drum" ? segment.repeats + 1 : 0), 0), 0),
      sections: spec.sections,
      balance,
      metrics,
      projectSha256: sha256(Buffer.from(projectJson)),
      previewSha256: sha256(readFileSync(previewPath)),
    };
    writeFileSync(join(reviewFolder, "song-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) throw new Error(`${spec.name} failed audio/project validation: ${JSON.stringify(report.metrics)}`);
    reports.push(report);
  }

  console.log(JSON.stringify({ ok: reports.every((entry) => entry.ok), outputRoot, songs: reports }, null, 2));
} finally {
  rmSync(bundleRoot, { recursive: true, force: true });
}

function buildClockworkSkies(factoryLumen, factoryAurum, synthStore) {
  const name = "Test_song_2";
  const songId = "test-song-2";
  const bpm = 129.2;
  const lengthBeats = bpm * 2;
  const registry = createRegistry(songId, factoryLumen, factoryAurum, synthStore);
  const keys = registry.lumen("Lumen_DigitalKeys_02", "clocks-piano", "Lumen E-flat Stage Piano", {
    "osc.a.wavetable": "basic.triangle", "osc.a.level": 0.64,
    "osc.b.wavetable": "basic.sine", "osc.b.level": 0.28,
    "osc.c.wavetable": "basic.saw", "osc.c.level": 0.045,
    "filter.cutoff": 4300, "filter.resonance": 0.08, "filter.drive": 0.025,
    "amp.level": 0.62, "maxVoices": 16,
    "env.1.attack": 0.002, "env.1.decay": 0.31, "env.1.sustain": 0.24, "env.1.release": 0.42,
  }, [
    effect("clocks-piano-chorus", "chorus", { rateHz: 0.16, depthMs: 1.2, delayMs: 8, feedback: 0, mix: 5 }),
    effect("clocks-piano-reverb", "reverb", { roomSize: 46, damping: 61, mix: 14 }),
  ]);
  const pad = registry.lumen("Lumen_WidePad_02", "clocks-strings", "Lumen Low String Bed", {
    "osc.a.wavetable": "basic.saw", "osc.a.level": 0.31, "osc.a.unison.voices": 2,
    "osc.a.unison.detune": 0.035, "osc.a.unison.spread": 0.5,
    "osc.b.wavetable": "basic.triangle", "osc.b.level": 0.34,
    "filter.cutoff": 2600, "filter.resonance": 0.07, "amp.level": 0.38, "maxVoices": 12,
    "env.1.attack": 0.48, "env.1.decay": 1.1, "env.1.sustain": 0.76, "env.1.release": 1.9,
  }, [effect("clocks-strings-reverb", "reverb", { roomSize: 62, damping: 58, mix: 20 })]);
  const lead = registry.lumen("Lumen_MonoLead_02", "clocks-voice", "Lumen Humanized Voice Lead", {
    "osc.a.wavetable": "basic.triangle", "osc.a.level": 0.52,
    "osc.b.wavetable": "basic.saw", "osc.b.level": 0.18,
    "osc.c.wavetable": "basic.sine", "osc.c.level": 0.2,
    "filter.cutoff": 3700, "filter.resonance": 0.16, "filter.drive": 0.03, "amp.level": 0.63,
    "mono.enabled": false, "maxVoices": 8,
    "env.1.attack": 0.026, "env.1.decay": 0.32, "env.1.sustain": 0.72, "env.1.release": 0.36,
  }, [
    effect("clocks-voice-delay", "delay", { timeMs: 232.2, feedback: 12, mix: 7 }),
    effect("clocks-voice-reverb", "reverb", { roomSize: 43, damping: 64, mix: 12 }),
  ]);
  const bass = registry.lumen("Lumen_SubBass_02", "clocks-bass", "Lumen Warm Root Bass", {
    "osc.a.wavetable": "basic.sine", "osc.a.octave": -1, "osc.a.level": 0.72,
    "osc.b.wavetable": "basic.triangle", "osc.b.octave": -1, "osc.b.level": 0.22,
    "osc.c.wavetable": "basic.saw", "osc.c.octave": -2, "osc.c.level": 0.045,
    "filter.cutoff": 760, "filter.resonance": 0.06, "filter.drive": 0.08,
    "mono.enabled": false, "legato.enabled": false, "glide.ms": 0,
    "env.1.attack": 0.01, "env.1.decay": 0.24, "env.1.sustain": 0.86, "env.1.release": 0.18,
    "amp.level": 0.65, "maxVoices": 4,
  }, [effect("clocks-bass-compressor", "compressor", { threshold: -20, ratio: 2.4, attackMs: 24, releaseMs: 130, makeup: 1, mix: 78 })]);
  const kit = registry.drumKit("clocks-kit", "acoustic");

  // Source-derived four-bar cycle: E-flat, B-flat minor, B-flat minor, F minor.
  // Each bar preserves the recognizable high-middle-low, high-middle-low,
  // high-middle eighth-note cell heard in the supplied recording.
  const harmony = [
    { chord: [51, 55, 58], bass: 51, riff: [75, 70, 67, 75, 70, 67, 75, 70] },
    { chord: [46, 49, 53], bass: 46, riff: [73, 68, 65, 73, 68, 65, 73, 68] },
    { chord: [46, 49, 53], bass: 46, riff: [73, 68, 65, 73, 68, 65, 73, 68] },
    { chord: [53, 56, 60], bass: 53, riff: [72, 68, 65, 72, 68, 65, 72, 68] },
  ];
  const pianoNotes = (startBar, bars, intensity = 1) => barsArray(bars).flatMap((localBar) => {
    const bar = harmony[(startBar + localBar) % harmony.length];
    return bar.riff.map((pitch, index) => midiNote(
      pitch,
      localBar * 4 + index * 0.5 + (index % 3 === 2 ? 0.008 : 0),
      index === 7 ? 0.43 : 0.39,
      Math.round((index === 0 || index === 3 || index === 6 ? 102 : 84) * intensity),
    ));
  });
  const padNotes = (startBar, bars, open = false) => barsArray(bars).flatMap((localBar) => {
    const bar = harmony[(startBar + localBar) % harmony.length];
    return bar.chord.map((pitch, voice) => midiNote(
      pitch + (open && voice === 2 ? 12 : 0),
      localBar * 4,
      3.78 - voice * 0.035,
      48 + voice * 4 + (open ? 5 : 0),
    ));
  });
  const bassNotes = (startBar, bars, active = false) => barsArray(bars).flatMap((localBar) => {
    const bar = harmony[(startBar + localBar) % harmony.length];
    if (!active) return [midiNote(bar.bass, localBar * 4, 3.72, 96)];
    return [
      midiNote(bar.bass, localBar * 4, 1.76, 104),
      midiNote(bar.bass, localBar * 4 + 2, 1.22, 92),
      midiNote(bar.bass + 7, localBar * 4 + 3.25, 0.46, 74),
    ];
  });
  const clocksVerseOne = [
    [0.5, 63, 2.25], [3.5, 61, 0.25], [4.75, 58, 0.5], [7.75, 61, 1.25],
    [9.5, 61, 1], [11.25, 60, 0.25], [11.75, 58, 0.5], [12.75, 56, 1],
    [15, 61, 0.25], [15.5, 63, 1.25], [17.25, 63, 1.25], [19.25, 61, 0.5],
    [19.75, 60, 0.75], [20.5, 58, 0.5], [21.5, 58, 0.25], [23.25, 61, 2.5],
    [26.5, 58, 0.25], [27, 60, 0.25], [27.75, 58, 0.5], [28.5, 56, 1],
    [30.5, 51, 0.5], [32.25, 63, 2], [35, 61, 0.25], [35.5, 60, 0.5],
    [36.5, 58, 1.25], [39.5, 61, 2], [42.25, 58, 0.5], [44.25, 56, 0.75],
    [48, 63, 2], [51.5, 60, 0.5], [52, 58, 1.5], [55, 61, 1],
    [56.75, 61, 1], [59, 58, 0.5], [60, 56, 1], [61.75, 54, 0.25], [62, 51, 1.5],
  ];
  const clocksRefrain = [
    [1, 64, 0.25], [1.25, 68, 3.75], [5, 65, 0.5], [5.5, 63, 3.5],
    [10, 67, 3.25], [13.25, 68, 0.5], [17, 68, 3.75], [20.75, 65, 0.5],
    [21.25, 63, 3.25], [25.75, 66, 0.5], [26.25, 67, 2.5], [29.25, 67, 0.25],
  ];
  const clocksVerseTwo = [
    [1.75, 61, 0.25], [3.75, 63, 1], [5, 61, 1], [6, 60, 0.25], [7, 58, 0.75],
    [9.5, 61, 3.25], [14.25, 57, 0.5], [15, 56, 1], [16.5, 53, 0.25],
    [17, 51, 0.5], [18.5, 63, 2], [22.25, 59, 0.25], [22.75, 58, 1.25],
    [25.25, 61, 1.5], [27.5, 61, 1.25], [29.75, 58, 1], [30.75, 56, 1],
  ];
  const sourceVoiceNotes = (source) => source.map(([startBeat, rawPitch, length], index) => {
    const pitch = rawPitch < 55 ? rawPitch + 12 : rawPitch;
    return midiNote(pitch, startBeat, length, 82 + index % 4 * 5, {
      ...(length > 1 ? { curve: [{ beat: 0, pitch }, { beat: length, pitch: pitch + (index % 2 ? -0.28 : 0.24) }] } : {}),
    });
  });

  const tracks = [
    track("clocks-piano-track", "E-flat Piano Ostinato", keys.id, [
      segment("clocks-piano-intro", "Solo Piano Intro", "clocks-piano-track", keys.id, 0, 8, pianoNotes(0, 8, 0.88)),
      segment("clocks-piano-band-intro", "Rhythm Section Entry", "clocks-piano-track", keys.id, 8, 8, pianoNotes(8, 8, 0.94)),
      segment("clocks-piano-verse-one", "Verse One Ostinato", "clocks-piano-track", keys.id, 16, 16, pianoNotes(16, 16, 0.96)),
      segment("clocks-piano-refrain", "Open Refrain Piano", "clocks-piano-track", keys.id, 32, 8, pianoNotes(32, 8, 1.04), [automationLane("macro.1", [[0, 0.28], [32, 0.58, "smoothstep"]])]),
      segment("clocks-piano-turn", "Instrumental Turn", "clocks-piano-track", keys.id, 40, 7, pianoNotes(40, 7, 0.92)),
      segment("clocks-piano-verse-two", "Verse Two Ostinato", "clocks-piano-track", keys.id, 47, 8, pianoNotes(47, 8, 0.97)),
      segment("clocks-piano-return", "Full Band Theme Return", "clocks-piano-track", keys.id, 55, 8, pianoNotes(55, 8, 1.03)),
      segment("clocks-piano-coda", "Piano Coda", "clocks-piano-track", keys.id, 63, 1, pianoNotes(63, 1, 0.84)),
    ], 7, { outputBusId: "bus-music", pan: -0.04, sends: [send("bus-space", -18)], effects: [
      effect("clocks-piano-highpass", "highpass", { cutoffHz: 118, resonance: 1.5 }),
    ] }),
    track("clocks-strings-track", "Low String and Organ Bed", pad.id, [
      segment("clocks-strings-entry", "Low Bed Entry", "clocks-strings-track", pad.id, 8, 8, padNotes(8, 8, false)),
      segment("clocks-strings-verse-one", "Verse One Bed", "clocks-strings-track", pad.id, 16, 16, padNotes(16, 16, false)),
      segment("clocks-strings-refrain", "Wide Refrain Bed", "clocks-strings-track", pad.id, 32, 8, padNotes(32, 8, true)),
      segment("clocks-strings-turn", "Instrumental Swell", "clocks-strings-track", pad.id, 40, 7, padNotes(40, 7, false)),
      segment("clocks-strings-verse-two", "Verse Two Bed", "clocks-strings-track", pad.id, 47, 8, padNotes(47, 8, false)),
      segment("clocks-strings-return", "Full Theme Bed", "clocks-strings-track", pad.id, 55, 8, padNotes(55, 8, true)),
      segment("clocks-strings-coda", "Coda Bed", "clocks-strings-track", pad.id, 63, 1, padNotes(63, 1, false)),
    ], -1, { outputBusId: "bus-music", pan: 0.08, sends: [send("bus-space", -13)] }),
    track("clocks-voice-track", "Synth Vocal Contour", lead.id, [
      segment("clocks-voice-verse-one", "Source Verse One Contour", "clocks-voice-track", lead.id, 16, 16, sourceVoiceNotes(clocksVerseOne)),
      segment("clocks-voice-refrain", "Source Refrain Contour", "clocks-voice-track", lead.id, 32, 8, sourceVoiceNotes(clocksRefrain)),
      segment("clocks-voice-verse-two", "Source Verse Two Contour", "clocks-voice-track", lead.id, 47, 8, sourceVoiceNotes(clocksVerseTwo)),
    ], 6, { outputBusId: "bus-music", pan: 0.06, sends: [send("bus-space", -14)] }),
    track("clocks-bass-track", "Warm Sustained Root Bass", bass.id, [
      segment("clocks-bass-entry", "Bass Entry", "clocks-bass-track", bass.id, 8, 8, bassNotes(8, 8, false)),
      segment("clocks-bass-verse-one", "Verse One Roots", "clocks-bass-track", bass.id, 16, 16, bassNotes(16, 16, false)),
      segment("clocks-bass-refrain", "Active Refrain Bass", "clocks-bass-track", bass.id, 32, 8, bassNotes(32, 8, true)),
      segment("clocks-bass-turn", "Instrumental Bass Lift", "clocks-bass-track", bass.id, 40, 7, bassNotes(40, 7, false)),
      segment("clocks-bass-verse-two", "Verse Two Roots", "clocks-bass-track", bass.id, 47, 8, bassNotes(47, 8, false)),
      segment("clocks-bass-return", "Full Theme Bass", "clocks-bass-track", bass.id, 55, 8, bassNotes(55, 8, true)),
      segment("clocks-bass-coda", "Bass Resolution", "clocks-bass-track", bass.id, 63, 1, bassNotes(63, 1, false)),
    ], -2, { outputBusId: "bus-music", effects: [effect("clocks-bass-lowpass", "lowpass", { cutoffHz: 1100, resonance: 2 })] }),
    track("clocks-drums-track", "Pearl Piano-Rock Drums", kit.kick.id, [
      drumSegment("clocks-drums-entry", "Measured Band Entry", "clocks-drums-track", kit, 8, 8, "rock-verse", 50),
      drumSegment("clocks-drums-verse-one", "Verse One Rock Loop", "clocks-drums-track", kit, 16, 16, "rock-verse", 50),
      drumSegment("clocks-drums-refrain", "Open Refrain Drums", "clocks-drums-track", kit, 32, 8, "rock-hook", 50),
      drumSegment("clocks-drums-turn", "Instrumental Drum Lift", "clocks-drums-track", kit, 40, 7, "rock-build", 50),
      drumSegment("clocks-drums-verse-two", "Verse Two Rock Loop", "clocks-drums-track", kit, 47, 8, "rock-verse", 50),
      drumSegment("clocks-drums-return", "Full Theme Drums", "clocks-drums-track", kit, 55, 8, "rock-final", 50),
      drumSegment("clocks-drums-coda", "One Bar Coda", "clocks-drums-track", kit, 63, 1, "rock-outro", 50),
    ], -12, { outputBusId: "bus-drums", effects: [effect("clocks-drums-comp", "compressor", { thresholdDb: -17, ratio: 2.1, attackMs: 25, releaseMs: 145, makeupDb: 0.25, mix: 36 })] }),
  ];

  const sections = [
    section("Solo Piano Intro", 0, 8), section("Rhythm Section Entry", 8, 16),
    section("Verse One", 16, 32), section("Open Refrain", 32, 40),
    section("Instrumental Turn", 40, 47), section("Verse Two", 47, 55),
    section("Full Theme Return", 55, 63), section("Piano Coda", 63, 64),
  ];
  return finishSpec({
    name, songId, title: "Clocks Cover Study", bpm, lengthBeats, registry, tracks, sections,
    originality: "Editable source-derived cover study reconstructed from the user-supplied recording; the source audio is analysis-only and is not embedded in the project.",
    components: [
      midiComponent("clocks-piano-cell", "E-flat Piano Ostinato", pianoNotes(0, 4, 1), 16, `${songId}-patterns`),
      midiComponent("clocks-vocal-contour", "Source Vocal Contour", sourceVoiceNotes(clocksVerseOne), 64, `${songId}-patterns`),
      drumComponent("clocks-rock-loop", "Piano-Rock Drum Loop", tracks.at(-1).segments[1], `${songId}-patterns`),
    ],
  });
}

function buildSeptemberCover(factoryLumen, factoryAurum, synthStore) {
  const name = "Test_song_3";
  const songId = "test-song-3";
  const bpm = 123;
  const lengthBeats = 246;
  const registry = createRegistry(songId, factoryLumen, factoryAurum, synthStore);
  const rhythm = registry.lumen("Lumen_ArpPluck_02", "september-rhythm", "Lumen Muted Funk Guitar", {
    "osc.a.wavetable": "basic.triangle", "osc.a.level": 0.5,
    "osc.b.wavetable": "basic.square", "osc.b.level": 0.16,
    "osc.c.wavetable": "basic.sine", "osc.c.level": 0.08,
    "filter.cutoff": 3600, "filter.resonance": 0.1, "filter.drive": 0.09,
    "lumen.arp.enabled": false, "amp.level": 0.54, "maxVoices": 12,
    "env.1.attack": 0.001, "env.1.decay": 0.085, "env.1.sustain": 0.015, "env.1.release": 0.075,
  }, [effect("september-rhythm-chorus", "chorus", { rateHz: 0.3, depthMs: 2, delayMs: 8, feedback: 1, mix: 7 })]);
  const brass = registry.lumen("Lumen_DigitalKeys_02", "september-horns", "Lumen September Horn Section", {
    "osc.a.wavetable": "basic.saw", "osc.a.level": 0.44, "osc.a.unison.voices": 2,
    "osc.a.unison.detune": 0.024, "osc.a.unison.spread": 0.24,
    "osc.b.wavetable": "basic.pulse", "osc.b.level": 0.26,
    "osc.c.wavetable": "basic.triangle", "osc.c.level": 0.12,
    "filter.cutoff": 3900, "filter.resonance": 0.13, "filter.drive": 0.08,
    "amp.level": 0.57, "maxVoices": 12,
    "env.1.attack": 0.008, "env.1.decay": 0.15, "env.1.sustain": 0.34, "env.1.release": 0.12,
  }, [effect("september-horns-sat", "saturator", { drive: 8, mix: 11 })]);
  const strings = registry.lumen("Lumen_WidePad_02", "september-strings", "Lumen Disco String Section", {
    "osc.a.wavetable": "basic.saw", "osc.a.level": 0.42, "osc.a.unison.voices": 3,
    "osc.a.unison.detune": 0.045, "osc.a.unison.spread": 0.62,
    "osc.b.wavetable": "basic.triangle", "osc.b.level": 0.22,
    "filter.cutoff": 5200, "filter.resonance": 0.07, "amp.level": 0.42, "maxVoices": 14,
    "env.1.attack": 0.02, "env.1.decay": 0.25, "env.1.sustain": 0.52, "env.1.release": 0.28,
  }, [effect("september-strings-chorus", "chorus", { rateHz: 0.27, depthMs: 4, delayMs: 10, feedback: 1, mix: 17 })]);
  const lead = registry.lumen("Lumen_MonoLead_02", "september-voice", "Lumen Soul Voice Lead", {
    "osc.a.wavetable": "basic.triangle", "osc.a.level": 0.56,
    "osc.b.wavetable": "basic.saw", "osc.b.level": 0.17,
    "osc.c.wavetable": "basic.sine", "osc.c.level": 0.18, "osc.c.octave": 0,
    "filter.cutoff": 4200, "filter.resonance": 0.1, "filter.drive": 0.025,
    "amp.level": 0.62, "mono.enabled": false, "maxVoices": 8,
    "env.1.attack": 0.018, "env.1.decay": 0.24, "env.1.sustain": 0.7, "env.1.release": 0.28,
  }, [
    effect("september-voice-delay", "delay", { timeMs: 238.1, feedback: 10, mix: 6 }),
    effect("september-voice-reverb", "reverb", { roomSize: 36, damping: 66, mix: 9 }),
  ]);
  const bass = registry.lumen("Lumen_SubBass_02", "september-bass", "Lumen Fingered Funk Bass", {
    "osc.a.wavetable": "basic.sine", "osc.a.octave": -1, "osc.a.level": 0.58,
    "osc.b.wavetable": "basic.triangle", "osc.b.octave": -1, "osc.b.level": 0.34,
    "osc.c.wavetable": "basic.saw", "osc.c.octave": -1, "osc.c.level": 0.065,
    "filter.cutoff": 1050, "filter.resonance": 0.08, "filter.drive": 0.12,
    "mono.enabled": false, "legato.enabled": false, "glide.ms": 0,
    "env.1.attack": 0.004, "env.1.decay": 0.16, "env.1.sustain": 0.7, "env.1.release": 0.09,
    "amp.level": 0.68, "maxVoices": 4,
  }, [effect("september-bass-comp", "compressor", { threshold: -20, ratio: 2.6, attackMs: 20, releaseMs: 105, makeup: 1, mix: 84 })]);
  const kit = registry.drumKit("september-kit");

  const chords = {
    dmaj7: { root: 50, notes: [50, 54, 57, 61] },
    csm7: { root: 49, notes: [49, 52, 56, 59] },
    bm7: { root: 47, notes: [47, 50, 54, 57] },
    bm9: { root: 47, notes: [47, 50, 54, 57, 61] },
    fsm9: { root: 42, notes: [42, 45, 49, 52, 56] },
    fsm7: { root: 42, notes: [42, 45, 49, 52] },
    cs7: { root: 49, notes: [49, 53, 56, 59] },
    e6: { root: 40, notes: [40, 44, 47, 49] },
    ga: { root: 45, notes: [55, 59, 62, 66] },
    gadd9a: { root: 45, notes: [55, 57, 59, 62] },
  };
  const twoBarWalkdown = [
    { bar: 0, at: 0, length: 2, chord: "dmaj7" }, { bar: 0, at: 2, length: 1, chord: "csm7" },
    { bar: 0, at: 3, length: 1, chord: "bm7" }, { bar: 1, at: 0, length: 2, chord: "csm7" },
    { bar: 1, at: 2, length: 1, chord: "fsm9" }, { bar: 1, at: 3, length: 1, chord: "fsm7" },
  ];
  const introForm = [
    ...Array.from({ length: 3 }, (_, repeat) => twoBarWalkdown.map((entry) => ({ ...entry, bar: entry.bar + repeat * 2 }))).flat(),
    ...Array.from({ length: 4 }, (_, bar) => ({ bar: bar + 6, at: 0, length: 4, chord: "ga" })),
  ];
  const verseForm = [
    ...twoBarWalkdown, ...twoBarWalkdown.map((entry) => ({ ...entry, bar: entry.bar + 2 })),
    { bar: 4, at: 0, length: 2, chord: "dmaj7" }, { bar: 4, at: 2, length: 1, chord: "csm7" },
    { bar: 4, at: 3, length: 1, chord: "bm7" }, { bar: 5, at: 0, length: 2, chord: "cs7" },
    { bar: 5, at: 2, length: 1, chord: "fsm9" }, { bar: 5, at: 3, length: 1, chord: "fsm7" },
    { bar: 6, at: 0, length: 4, chord: "ga" }, { bar: 7, at: 0, length: 3.5, chord: "ga" },
  ];
  const chorusForm = [
    ...Array.from({ length: 3 }, (_, repeat) => [
      { bar: repeat * 2, at: 0, length: 2, chord: "bm9" }, { bar: repeat * 2, at: 2, length: 2, chord: "e6" },
      { bar: repeat * 2 + 1, at: 0, length: 2, chord: "csm7" },
      { bar: repeat * 2 + 1, at: 2, length: 1, chord: "fsm9" }, { bar: repeat * 2 + 1, at: 3, length: 1, chord: "fsm7" },
    ]).flat(),
    { bar: 6, at: 0, length: 4, chord: "gadd9a" }, { bar: 7, at: 0, length: 4, chord: "gadd9a" },
  ];
  const forms = {
    intro: introForm,
    verse: verseForm,
    chorus: chorusForm,
    turn: chorusForm.slice(-2).map((entry) => ({ ...entry, bar: entry.bar - 6 })),
  };
  const eventsFor = (formName, bars) => {
    const form = forms[formName];
    const formBars = Math.max(...form.map((entry) => entry.bar)) + 1;
    return Array.from({ length: Math.ceil(bars / formBars) }, (_, repeat) => form.map((entry) => ({
      ...entry, bar: entry.bar + repeat * formBars,
    }))).flat().filter((entry) => entry.bar < bars);
  };
  const rhythmNotes = (formName, bars, open = false) => eventsFor(formName, bars).flatMap((entry, eventIndex) => {
    const chord = chords[entry.chord].notes.map((pitch) => pitch + 12);
    const hits = entry.length >= 3.5 ? [0.25, 0.75, 1.5, 2.25, 2.75, 3.5]
      : entry.length >= 2 ? [0.25, 0.75, 1.5] : [0.25, 0.72];
    return hits.filter((at) => at < entry.length).flatMap((at, hit) => chord.slice(1, 4).map((pitch, voice) => midiNote(
      pitch, entry.bar * 4 + entry.at + at + (hit % 2 ? 0.012 : 0), open ? 0.2 : 0.14,
      72 + (eventIndex + hit) % 4 * 6 - voice * 3,
    )));
  });
  const bassNotes = (formName, bars, active = true) => eventsFor(formName, bars).flatMap((entry, eventIndex) => {
    const root = chords[entry.chord].root + 12;
    const hits = entry.length >= 3.5 ? [0, 0.75, 1.5, 2.5, 3.25]
      : entry.length >= 2 ? [0, 0.75, 1.5] : [0, 0.72];
    return hits.filter((at) => at < entry.length).map((at, hit) => midiNote(
      root + (active && hit === 2 ? 12 : 0), entry.bar * 4 + entry.at + at,
      hit === 0 ? Math.min(0.58, entry.length - at) : 0.28,
      92 + (eventIndex + hit) % 4 * 5,
    ));
  });
  const brassNotes = (formName, bars, full = false) => eventsFor(formName, bars).flatMap((entry, index) => {
    if (entry.at !== 0 && !full) return [];
    const chord = chords[entry.chord].notes.slice(1, 4).map((pitch) => pitch + 12);
    const hits = full && entry.length >= 2 ? [0, Math.min(1.5, entry.length - 0.35)] : [0];
    return hits.flatMap((at, hit) => chord.map((pitch, voice) => midiNote(
      pitch, entry.bar * 4 + entry.at + at, hit ? 0.24 : 0.38, 86 + index % 3 * 5 - voice * 4,
    )));
  });
  const stringNotes = (formName, bars, offbeats = false) => eventsFor(formName, bars).flatMap((entry) => {
    const chord = chords[entry.chord].notes.slice(0, 4).map((pitch) => pitch + 12);
    if (!offbeats) return chord.map((pitch, voice) => midiNote(
      pitch, entry.bar * 4 + entry.at, Math.max(0.16, entry.length - 0.1 - voice * 0.015), 45 + voice * 4,
    ));
    return [0.5, 1.5, 2.5, 3.5].filter((at) => at < entry.length).flatMap((at) => chord.slice(1).map((pitch, voice) => midiNote(
      pitch + 12, entry.bar * 4 + entry.at + at, 0.22, 67 + voice * 4,
    )));
  });
  const septemberVerseOne = [
    [0.25, 59, 0.5], [0.75, 61, 1], [5.75, 66, 0.25], [8.25, 61, 1],
    [9.75, 61, 0.25], [12.75, 61, 0.25], [13.25, 64, 0.25], [14, 60, 0.5],
    [16, 61, 0.75], [21, 64, 0.5], [22.75, 59, 0.5], [23.5, 57, 0.5],
    [24, 59, 0.25], [24.5, 57, 3.5], [29.5, 55, 0.25], [31, 61, 0.25], [31.25, 59, 0.25],
  ];
  const septemberVerseTwo = [
    [0, 57, 0.25], [0.5, 61, 0.25], [3, 57, 0.25], [4.75, 64, 0.25],
    [5.75, 59, 0.5], [6.25, 57, 0.75], [8, 62, 0.25], [8.5, 61, 1],
    [11.25, 57, 0.25], [11.75, 59, 0.25], [12.75, 64, 0.25], [13, 66, 0.25],
    [13.75, 59, 0.5], [15, 60, 0.5], [15.5, 61, 1.25], [19.25, 58, 0.25],
    [20.5, 65, 0.5], [22.25, 57, 0.25], [23, 58, 0.5], [24.25, 57, 1.25],
    [29, 55, 0.25], [30.25, 71, 0.5], [31.75, 72, 0.25],
  ];
  const septemberChorus = [
    [0, 73, 0.75], [1.75, 73, 0.5], [2.75, 73, 0.5], [5.25, 71, 0.25],
    [6.75, 71, 0.75], [7.75, 73, 1], [9.5, 73, 0.5], [10.5, 73, 1],
    [13.25, 71, 0.25], [14.5, 71, 0.25], [15.5, 73, 1], [16.75, 74, 0.25],
    [17.25, 73, 0.75], [18.5, 73, 0.5], [19.5, 73, 0.25], [20, 74, 0.5],
    [20.5, 73, 0.25], [21, 71, 0.25], [22, 69, 0.25], [23.25, 71, 0.25],
    [23.75, 69, 4.5], [31.75, 57, 0.25],
  ];
  const sourceMelodyNotes = (source, maxBeats = 32) => source.filter(([startBeat]) => startBeat < maxBeats).map(([startBeat, rawPitch, rawLength], index) => {
    const pitch = rawPitch < 55 ? rawPitch + 12 : rawPitch;
    const length = Math.min(rawLength, maxBeats - startBeat);
    return midiNote(pitch, startBeat, length, 82 + index % 4 * 6, {
      ...(length > 1 ? { curve: [{ beat: 0, pitch }, { beat: length, pitch: pitch + (index % 2 ? -0.28 : 0.24) }] } : {}),
    });
  });

  const tracks = [
    track("september-rhythm-track", "Muted Sixteenth Funk Rhythm", rhythm.id, [
      segment("september-rhythm-intro", "Original Intro Walkdown", "september-rhythm-track", rhythm.id, 0, 10, rhythmNotes("intro", 10, false)),
      segment("september-rhythm-verse-one", "Verse One Walkdown", "september-rhythm-track", rhythm.id, 10, 8, rhythmNotes("verse", 8, false)),
      segment("september-rhythm-verse-two", "Verse Two Walkdown", "september-rhythm-track", rhythm.id, 18, 8, rhythmNotes("verse", 8, false)),
      segment("september-rhythm-chorus-one", "Chorus One Changes", "september-rhythm-track", rhythm.id, 26, 8, rhythmNotes("chorus", 8, true)),
      segment("september-rhythm-return", "Verse Walkdown Return", "september-rhythm-track", rhythm.id, 34, 8, rhythmNotes("verse", 8, false)),
      segment("september-rhythm-chorus-two", "Chorus Two Changes", "september-rhythm-track", rhythm.id, 42, 8, rhythmNotes("chorus", 8, true)),
      segment("september-rhythm-turn", "G over A Turn", "september-rhythm-track", rhythm.id, 50, 4, rhythmNotes("turn", 4, false)),
      segment("september-rhythm-final", "Extended Final Chorus", "september-rhythm-track", rhythm.id, 54, 7, rhythmNotes("chorus", 7, true)),
    ], 7, { outputBusId: "bus-music", pan: -0.2, sends: [send("bus-space", -19)], effects: [effect("september-rhythm-highpass", "highpass", { cutoffHz: 220, resonance: 2 })] }),
    track("september-horns-track", "Soul Horn Stabs", brass.id, [
      segment("september-horns-intro", "Intro Horn Invitations", "september-horns-track", brass.id, 6, 4, brassNotes("turn", 4, false)),
      segment("september-horns-chorus-one", "Chorus One Horns", "september-horns-track", brass.id, 26, 8, brassNotes("chorus", 8, true)),
      segment("september-horns-return", "Verse Horn Answers", "september-horns-track", brass.id, 34, 8, brassNotes("verse", 8, false)),
      segment("september-horns-chorus-two", "Chorus Two Horns", "september-horns-track", brass.id, 42, 8, brassNotes("chorus", 8, true)),
      segment("september-horns-turn", "Turn Horn Answers", "september-horns-track", brass.id, 50, 4, brassNotes("turn", 4, false)),
      segment("september-horns-final", "Final Chorus Horns", "september-horns-track", brass.id, 54, 7, brassNotes("chorus", 7, true)),
    ], 7, { outputBusId: "bus-music", pan: 0.16, sends: [send("bus-space", -16)] }),
    track("september-strings-track", "Disco String Counter-Rhythm", strings.id, [
      segment("september-strings-verse-one", "Verse One Sustains", "september-strings-track", strings.id, 10, 8, stringNotes("verse", 8, false)),
      segment("september-strings-verse-two", "Verse Two Sustains", "september-strings-track", strings.id, 18, 8, stringNotes("verse", 8, false)),
      segment("september-strings-chorus-one", "Chorus One Offbeats", "september-strings-track", strings.id, 26, 8, stringNotes("chorus", 8, true)),
      segment("september-strings-return", "Verse Return Sustains", "september-strings-track", strings.id, 34, 8, stringNotes("verse", 8, false)),
      segment("september-strings-chorus-two", "Chorus Two Offbeats", "september-strings-track", strings.id, 42, 8, stringNotes("chorus", 8, true)),
      segment("september-strings-final", "Final Chorus Strings", "september-strings-track", strings.id, 54, 7, stringNotes("chorus", 7, true)),
    ], 2, { outputBusId: "bus-music", pan: -0.08, sends: [send("bus-space", -13)] }),
    track("september-bass-track", "Fingered Syncopated Funk Bass", bass.id, [
      segment("september-bass-intro", "Intro Walkdown Bass", "september-bass-track", bass.id, 0, 10, bassNotes("intro", 10, false)),
      segment("september-bass-verse-one", "Verse One Bass", "september-bass-track", bass.id, 10, 8, bassNotes("verse", 8, true)),
      segment("september-bass-verse-two", "Verse Two Bass", "september-bass-track", bass.id, 18, 8, bassNotes("verse", 8, true)),
      segment("september-bass-chorus-one", "Chorus One Bass", "september-bass-track", bass.id, 26, 8, bassNotes("chorus", 8, true)),
      segment("september-bass-return", "Verse Return Bass", "september-bass-track", bass.id, 34, 8, bassNotes("verse", 8, true)),
      segment("september-bass-chorus-two", "Chorus Two Bass", "september-bass-track", bass.id, 42, 8, bassNotes("chorus", 8, true)),
      segment("september-bass-turn", "A Pedal Turn", "september-bass-track", bass.id, 50, 4, bassNotes("turn", 4, false)),
      segment("september-bass-final", "Final Chorus Bass", "september-bass-track", bass.id, 54, 7, bassNotes("chorus", 7, true)),
    ], 2, { outputBusId: "bus-music", effects: [effect("september-bass-lowpass", "lowpass", { cutoffHz: 1500, resonance: 2 })] }),
    track("september-voice-track", "Soul Synth Vocal", lead.id, [
      segment("september-voice-verse-one", "Source Verse One Contour", "september-voice-track", lead.id, 10, 8, sourceMelodyNotes(septemberVerseOne)),
      segment("september-voice-verse-two", "Source Verse Two Contour", "september-voice-track", lead.id, 18, 8, sourceMelodyNotes(septemberVerseTwo)),
      segment("september-voice-chorus-one", "Source Ba-dee-ya Contour", "september-voice-track", lead.id, 26, 8, sourceMelodyNotes(septemberChorus)),
      segment("september-voice-return", "Verse Contour Return", "september-voice-track", lead.id, 34, 8, sourceMelodyNotes(septemberVerseOne)),
      segment("september-voice-chorus-two", "Second Ba-dee-ya Contour", "september-voice-track", lead.id, 42, 8, sourceMelodyNotes(septemberChorus)),
      segment("september-voice-final", "Extended Final Vocal Hook", "september-voice-track", lead.id, 54, 7, sourceMelodyNotes(septemberChorus, 28)),
    ], 10, { outputBusId: "bus-music", pan: 0.04, sends: [send("bus-space", -12)] }),
    track("september-drums-track", "LM-2 and Pearl Disco Drums", kit.kick.id, [
      drumSegment("september-drums-intro", "Intro Percussion and Kick", "september-drums-track", kit, 0, 6, "disco-intro", 56),
      drumSegment("september-drums-band-entry", "Full Groove Entry", "september-drums-track", kit, 6, 4, "disco-build", 57),
      drumSegment("september-drums-verse-one", "Verse One Pocket", "september-drums-track", kit, 10, 8, "disco-pocket", 58),
      drumSegment("september-drums-verse-two", "Verse Two Pocket", "september-drums-track", kit, 18, 8, "disco-pocket", 58),
      drumSegment("september-drums-chorus-one", "Chorus One Open Groove", "september-drums-track", kit, 26, 8, "disco-hook", 59),
      drumSegment("september-drums-return", "Verse Return Pocket", "september-drums-track", kit, 34, 8, "disco-pocket", 58),
      drumSegment("september-drums-chorus-two", "Chorus Two Open Groove", "september-drums-track", kit, 42, 8, "disco-hook", 59),
      drumSegment("september-drums-turn", "Four Bar Percussion Turn", "september-drums-track", kit, 50, 4, "disco-break", 60),
      drumSegment("september-drums-final", "Extended Final Disco Drive", "september-drums-track", kit, 54, 7, "disco-final", 59),
    ], -12, { outputBusId: "bus-drums", effects: [effect("september-drums-comp", "compressor", { thresholdDb: -16, ratio: 2.1, attackMs: 27, releaseMs: 135, makeupDb: 0.25, mix: 36 })] }),
  ];

  const sections = [
    section("Intro Walkdown", 0, 6), section("G over A Band Entry", 6, 10),
    section("Verse One", 10, 18), section("Verse Two", 18, 26),
    section("Chorus One", 26, 34), section("Verse Return", 34, 42),
    section("Chorus Two", 42, 50), section("Percussion Turn", 50, 54),
    section("Extended Final Chorus", 54, 61),
  ];
  return finishSpec({
    name, songId, title: "September Cover Study", bpm, lengthBeats, registry, tracks, sections,
    originality: "Editable source-derived cover study reconstructed from the user-supplied recording; the source audio is analysis-only and is not embedded in the project.",
    components: [
      midiComponent("september-verse-walkdown", "September Verse Walkdown", rhythmNotes("verse", 8, false), 32, `${songId}-patterns`),
      midiComponent("september-chorus-contour", "Source September Chorus Contour", sourceMelodyNotes(septemberChorus), 32, `${songId}-patterns`),
      midiComponent("september-funk-bass", "September Funk Bass", bassNotes("chorus", 8, true), 32, `${songId}-patterns`),
      drumComponent("september-disco-loop", "September Disco Groove", tracks.at(-1).segments[3], `${songId}-patterns`),
    ],
  });
}

function buildSunlitAvenueLegacy(factoryLumen, factoryAurum, synthStore) {
  const name = "Test_song_3";
  const songId = "test-song-3";
  const bpm = 126;
  const lengthBeats = 252;
  const registry = createRegistry(songId, factoryLumen, factoryAurum, synthStore);
  const pluck = registry.lumen("Lumen_ArpPluck_02", "muted-chime", "Lumen Muted Chime", {
    "osc.a.wavetable": "basic.triangle", "osc.a.level": 0.5,
    "osc.b.wavetable": "basic.square", "osc.b.level": 0.22,
    "osc.c.wavetable": "basic.sine", "osc.c.level": 0.12,
    "filter.cutoff": 4700, "filter.resonance": 0.18, "filter.drive": 0.08,
    "amp.level": 0.52, "maxVoices": 10,
    "env.1.attack": 0.002, "env.1.decay": 0.11, "env.1.sustain": 0.03, "env.1.release": 0.12,
  }, [effect("muted-chime-chorus", "chorus", { rateHz: 0.36, depthMs: 3, delayMs: 9, feedback: 1, mix: 10 })]);
  const brass = registry.lumen("Lumen_DigitalKeys_02", "solar-brass", "Lumen Solar Brass", {
    "osc.a.wavetable": "basic.saw", "osc.a.level": 0.54, "osc.a.unison.voices": 2,
    "osc.a.unison.detune": 0.042, "osc.a.unison.spread": 0.34,
    "osc.b.wavetable": "basic.pulse", "osc.b.level": 0.3,
    "osc.c.wavetable": "basic.square", "osc.c.level": 0.1,
    "filter.cutoff": 4400, "filter.resonance": 0.2, "filter.drive": 0.12,
    "amp.level": 0.58, "maxVoices": 10,
    "env.1.attack": 0.006, "env.1.decay": 0.18, "env.1.sustain": 0.32, "env.1.release": 0.13,
  }, [effect("solar-brass-sat", "saturator", { drive: 12, mix: 16 })]);
  const strings = registry.lumen("Lumen_WidePad_02", "silk-strings", "Lumen Silk Strings", {
    "osc.a.wavetable": "basic.saw", "osc.a.level": 0.48, "osc.a.unison.voices": 3,
    "osc.a.unison.detune": 0.06, "osc.a.unison.spread": 0.66,
    "osc.b.wavetable": "basic.triangle", "osc.b.level": 0.24,
    "filter.cutoff": 6500, "filter.resonance": 0.1, "amp.level": 0.44, "maxVoices": 12,
    "env.1.attack": 0.024, "env.1.decay": 0.32, "env.1.sustain": 0.58, "env.1.release": 0.3,
  }, [effect("silk-strings-chorus", "chorus", { rateHz: 0.3, depthMs: 5, delayMs: 12, feedback: 2, mix: 20 })]);
  const lead = registry.lumen("Lumen_MonoLead_02", "gold-lead", "Lumen Gold Lead", {
    "osc.a.wavetable": "basic.triangle", "osc.a.level": 0.48,
    "osc.b.wavetable": "basic.saw", "osc.b.level": 0.28,
    "osc.c.wavetable": "basic.sine", "osc.c.level": 0.16, "osc.c.octave": 1,
    "filter.cutoff": 6100, "filter.resonance": 0.12, "filter.drive": 0.04,
    "amp.level": 0.58, "mono.enabled": false, "maxVoices": 8,
    "env.1.attack": 0.012, "env.1.decay": 0.22, "env.1.sustain": 0.64, "env.1.release": 0.3,
  }, [
    effect("gold-lead-delay", "delay", { timeMs: 250, feedback: 18, mix: 11 }),
    effect("gold-lead-reverb", "reverb", { roomSize: 38, damping: 62, mix: 10 }),
  ]);
  const clav = registry.aurum("Aurum_Organ_01");
  const bass = registry.aurum("Aurum_Bass_01");
  const kit = registry.drumKit("sunlit-kit");

  const progression = [
    [40, 43, 47, 50, 54], // Em9
    [36, 40, 43, 47, 50], // Cmaj9
    [43, 47, 50, 52, 55], // G6
    [38, 42, 45, 48, 52], // D9
  ];
  const pluckNotes = (startBar, bars, busy = false) => barsArray(bars).flatMap((localBar) => {
    const chord = progression[(startBar + localBar) % 4].map((pitch) => pitch + 12);
    const pattern = busy
      ? [[0, 0], [0.75, 2], [1.25, 1], [1.75, 4], [2.5, 2], [3, 3], [3.5, 1], [3.75, 4]]
      : [[0, 0], [0.75, 2], [1.5, 1], [2.5, 3], [3.25, 2]];
    return pattern.map(([at, voice], index) => midiNote(chord[voice], localBar * 4 + at + (index % 3 === 1 ? 0.014 : 0), busy ? 0.19 : 0.28, 76 + (index % 4) * 7));
  });
  const clavNotes = (startBar, bars, open = false) => barsArray(bars).flatMap((localBar) => {
    const chord = progression[(startBar + localBar) % 4].map((pitch) => pitch + 12);
    const hits = open ? [0.5, 1.75, 2.75, 3.5] : [0.75, 2.5, 3.25];
    return hits.flatMap((at, hit) => chord.slice(hit % 2, hit % 2 + 3).map((pitch, voice) =>
      midiNote(pitch, localBar * 4 + at, hit === hits.length - 1 ? 0.28 : 0.18, 78 + hit * 5 - voice * 4)));
  });
  const brassNotes = (startBar, bars, final = false) => barsArray(bars).flatMap((localBar) => {
    const chord = progression[(startBar + localBar) % 4].map((pitch) => pitch + 24);
    const hits = final ? [0, 1.5, 2.75, 3.5] : [0, 2.5];
    return hits.flatMap((at, hit) => chord.slice(hit % 2, hit % 2 + 3).map((pitch, voice) =>
      midiNote(pitch, localBar * 4 + at, final ? 0.3 : 0.42, 92 + hit * 5 - voice * 5)));
  });
  const stringNotes = (startBar, bars, stabs = true) => barsArray(bars).flatMap((localBar) => {
    const chord = progression[(startBar + localBar) % 4].map((pitch) => pitch + 12);
    if (!stabs) return chord.slice(0, 4).map((pitch, voice) => midiNote(pitch, localBar * 4, 3.7 - voice * 0.02, 52 + voice * 4));
    return [0.5, 1.5, 2.5, 3.5].flatMap((at, hit) => chord.slice(hit % 2, hit % 2 + 3).map((pitch, voice) =>
      midiNote(pitch + 12, localBar * 4 + at, 0.28, 74 + hit * 5 - voice * 3)));
  });
  const bassNotes = (startBar, bars, final = false) => barsArray(bars).flatMap((localBar) => {
    const root = progression[(startBar + localBar) % 4][0] - 12;
    const next = progression[(startBar + localBar + 1) % 4][0] - 12;
    const pattern = [
      [0, root, 0.58, 104], [0.75, root + 7, 0.34, 84], [1.25, root + 12, 0.42, 96],
      [2, root + 7, 0.34, 88], [2.75, root + 10, 0.32, 82], [3.25, next - 2, 0.42, 78],
    ];
    if (final) pattern.splice(4, 0, [2.5, root + 12, 0.2, 98]);
    return pattern.map(([at, pitch, length, velocity], index) => midiNote(pitch, localBar * 4 + at, length, velocity,
      index === pattern.length - 1 ? { curve: [{ beat: 0, pitch }, { beat: length, pitch: next }] } : {}));
  });
  const leadMotif = [71, 74, 76, 79, 76, 74, 71, 69, 67, 71, 74, 76];
  const leadStarts = [0, 0.5, 1.25, 2, 2.75, 3.25, 4, 4.75, 5.5, 6, 6.75, 7.25];
  const leadLengths = [0.38, 0.58, 0.42, 0.62, 0.36, 0.46, 0.6, 0.34, 0.38, 0.58, 0.34, 0.66];
  const leadPhrase = (variation = 0, harmony = false) => leadMotif.flatMap((pitch, index) => {
    const varied = pitch + (variation === 1 && index >= 7 ? (index % 3 === 0 ? 2 : -1) : variation === 2 && index >= 8 ? -2 : 0);
    const primary = midiNote(varied, leadStarts[index], leadLengths[index], 84 + index % 4 * 6, {
      ...(index === 5 || index === 11 ? { curve: [{ beat: 0, pitch: varied }, { beat: leadLengths[index], pitch: varied + 1 }] } : {}),
    });
    return harmony && index % 3 === 0
      ? [primary, midiNote(varied - 4, leadStarts[index] + 0.016, leadLengths[index] * 0.92, 62 + index % 4 * 3)]
      : [primary];
  });
  const leadRun = (bars, variation = 0, harmony = false) => barsArray(Math.ceil(bars / 2)).flatMap((phraseIndex) =>
    leadPhrase((variation + phraseIndex) % 3, harmony && phraseIndex > 0).map((entry) => ({
      ...entry, startBeat: entry.startBeat + phraseIndex * 8,
    }))).filter((entry) => entry.startBeat < bars * 4);

  const tracks = [
    track("sunlit-pluck-track", "Muted Chime Rhythm", pluck.id, [
      segment("sunlit-pluck-intro", "Muted Pickup", "sunlit-pluck-track", pluck.id, 0, 4, pluckNotes(0, 4, false)),
      segment("sunlit-pluck-groove-a", "Chime Groove A", "sunlit-pluck-track", pluck.id, 4, 12, pluckNotes(4, 12, false)),
      segment("sunlit-pluck-lift", "Busier Chime Lift", "sunlit-pluck-track", pluck.id, 16, 4, pluckNotes(16, 4, true)),
      segment("sunlit-pluck-hook-a", "Chime Hook A", "sunlit-pluck-track", pluck.id, 20, 8, pluckNotes(20, 8, true)),
      segment("sunlit-pluck-break", "Filtered Chime Break", "sunlit-pluck-track", pluck.id, 28, 8, pluckNotes(28, 8, false)),
      segment("sunlit-pluck-groove-b", "Chime Groove B", "sunlit-pluck-track", pluck.id, 36, 8, pluckNotes(36, 8, true)),
      segment("sunlit-pluck-final", "Final Chime Drive", "sunlit-pluck-track", pluck.id, 44, 12, pluckNotes(44, 12, true)),
      segment("sunlit-pluck-outro", "Last Chime", "sunlit-pluck-track", pluck.id, 56, 7, pluckNotes(56, 7, false)),
    ], 6, { outputBusId: "bus-music", pan: -0.24, sends: [send("bus-space", -18)] }),
    track("sunlit-clav-track", "Aurum Clavinet Rhythm", clav.id, [
      segment("sunlit-clav-a", "Clavinet Pocket A", "sunlit-clav-track", clav.id, 4, 12, clavNotes(4, 12, false)),
      segment("sunlit-clav-hook", "Open Clavinet Hook", "sunlit-clav-track", clav.id, 20, 8, clavNotes(20, 8, true)),
      segment("sunlit-clav-b", "Clavinet Pocket B", "sunlit-clav-track", clav.id, 36, 8, clavNotes(36, 8, false)),
      segment("sunlit-clav-final", "Final Clavinet Push", "sunlit-clav-track", clav.id, 44, 12, clavNotes(44, 12, true)),
    ], 1, { outputBusId: "bus-music", pan: 0.2, effects: [effect("sunlit-clav-highpass", "highpass", { cutoffHz: 260, resonance: 3 })] }),
    track("sunlit-brass-track", "Solar Brass Section", brass.id, [
      segment("sunlit-brass-lift", "Brass Invitation", "sunlit-brass-track", brass.id, 16, 4, brassNotes(16, 4, false)),
      segment("sunlit-brass-hook-a", "Solar Brass Hook A", "sunlit-brass-track", brass.id, 20, 8, brassNotes(20, 8, true)),
      segment("sunlit-brass-groove-b", "Brass Answers", "sunlit-brass-track", brass.id, 36, 8, brassNotes(36, 8, false)),
      segment("sunlit-brass-final", "Solar Brass Finale", "sunlit-brass-track", brass.id, 44, 12, brassNotes(44, 12, true)),
    ], 4, { outputBusId: "bus-music", pan: 0.14, sends: [send("bus-space", -16)] }),
    track("sunlit-strings-track", "Silk Disco Strings", strings.id, [
      segment("sunlit-strings-hook-a", "Silk Offbeats A", "sunlit-strings-track", strings.id, 20, 8, stringNotes(20, 8, true)),
      segment("sunlit-strings-break", "Silk Held Break", "sunlit-strings-track", strings.id, 28, 8, stringNotes(28, 8, false)),
      segment("sunlit-strings-groove-b", "Silk Offbeats B", "sunlit-strings-track", strings.id, 36, 8, stringNotes(36, 8, true)),
      segment("sunlit-strings-final", "Silk Finale", "sunlit-strings-track", strings.id, 44, 12, stringNotes(44, 12, true)),
      segment("sunlit-strings-outro", "Silk Release", "sunlit-strings-track", strings.id, 56, 7, stringNotes(56, 7, false)),
    ], 2, { outputBusId: "bus-music", pan: -0.1, sends: [send("bus-space", -13)] }),
    track("sunlit-bass-track", "Aurum Syncopated Bass", bass.id, [
      segment("sunlit-bass-a", "Bass Pocket A", "sunlit-bass-track", bass.id, 4, 12, bassNotes(4, 12, false)),
      segment("sunlit-bass-lift", "Bass Lift", "sunlit-bass-track", bass.id, 16, 4, bassNotes(16, 4, true)),
      segment("sunlit-bass-hook-a", "Bass Hook A", "sunlit-bass-track", bass.id, 20, 8, bassNotes(20, 8, true)),
      segment("sunlit-bass-break", "Bass Breakdown", "sunlit-bass-track", bass.id, 28, 8, bassNotes(28, 8, false)),
      segment("sunlit-bass-b", "Bass Pocket B", "sunlit-bass-track", bass.id, 36, 8, bassNotes(36, 8, true)),
      segment("sunlit-bass-final", "Final Bass Hook", "sunlit-bass-track", bass.id, 44, 12, bassNotes(44, 12, true)),
      segment("sunlit-bass-outro", "Bass Sign-Off", "sunlit-bass-track", bass.id, 56, 7, bassNotes(56, 7, false)),
    ], -3, { outputBusId: "bus-music", effects: [effect("sunlit-bass-comp", "compressor", { thresholdDb: -20, ratio: 2.8, attackMs: 18, releaseMs: 120, makeupDb: 0.5, mix: 82 })] }),
    track("sunlit-lead-track", "Gold Synth Voice", lead.id, [
      segment("sunlit-lead-a", "Gold Theme Introduction", "sunlit-lead-track", lead.id, 8, 8, leadRun(8, 0, false)),
      segment("sunlit-lead-lift", "Gold Theme Lift", "sunlit-lead-track", lead.id, 16, 4, leadRun(4, 1, false)),
      segment("sunlit-lead-hook-a", "Gold Main Hook", "sunlit-lead-track", lead.id, 20, 8, leadRun(8, 0, true)),
      segment("sunlit-lead-break", "Gold Half-Light", "sunlit-lead-track", lead.id, 28, 8, leadRun(8, 2, false)),
      segment("sunlit-lead-b", "Gold Theme Return", "sunlit-lead-track", lead.id, 36, 8, leadRun(8, 1, false)),
      segment("sunlit-lead-final-a", "Gold Finale A", "sunlit-lead-track", lead.id, 44, 8, leadRun(8, 0, true)),
      segment("sunlit-lead-final-b", "Gold Finale B", "sunlit-lead-track", lead.id, 52, 8, leadRun(8, 1, true)),
    ], 4, { outputBusId: "bus-music", pan: 0.06, sends: [send("bus-space", -12)] }),
    track("sunlit-drums-track", "LM-2 / Pearl Disco Drums", kit.kick.id, [
      drumSegment("sunlit-drum-intro", "Percussion Invitation", "sunlit-drums-track", kit, 0, 4, "disco-intro", 56),
      drumSegment("sunlit-drum-a", "Four-on-the-Floor A", "sunlit-drums-track", kit, 4, 12, "disco-pocket", 58),
      drumSegment("sunlit-drum-lift", "Disco Lift", "sunlit-drums-track", kit, 16, 4, "disco-build", 58),
      drumSegment("sunlit-drum-hook-a", "Open Disco Hook", "sunlit-drums-track", kit, 20, 8, "disco-hook", 59),
      drumSegment("sunlit-drum-break", "Percussion Breakdown", "sunlit-drums-track", kit, 28, 8, "disco-break", 61),
      drumSegment("sunlit-drum-b", "Four-on-the-Floor B", "sunlit-drums-track", kit, 36, 8, "disco-pocket", 58),
      drumSegment("sunlit-drum-final", "Final Disco Drive", "sunlit-drums-track", kit, 44, 12, "disco-final", 59),
      drumSegment("sunlit-drum-outro", "Disco Sign-Off", "sunlit-drums-track", kit, 56, 7, "disco-outro", 56),
    ], -12, { outputBusId: "bus-drums", effects: [effect("sunlit-drums-comp", "compressor", { thresholdDb: -16, ratio: 2.2, attackMs: 26, releaseMs: 130, makeupDb: 0.5, mix: 38 })] }),
  ];

  const sections = [
    section("Percussion Invitation", 0, 4), section("Pocket A", 4, 16), section("Lift", 16, 20),
    section("Sunlit Hook", 20, 28), section("Half-Light Breakdown", 28, 36), section("Pocket B", 36, 44),
    section("Full-Band Finale", 44, 56), section("Sign-Off", 56, 63),
  ];
  return finishSpec({
    name, songId, title: "Sunlit Avenue", bpm, lengthBeats, registry, tracks, sections,
    originality: "Original E-minor/G-major disco-funk song with a syncopated bass hook, muted chime rhythm, and original Gold synth melody; not a transcription.",
    components: [
      midiComponent("sunlit-gold-hook", "Gold Main Hook", leadPhrase(0, true), 8, `${songId}-patterns`),
      midiComponent("sunlit-bass-hook", "Sunlit Bass Hook", bassNotes(0, 2, true), 8, `${songId}-patterns`),
      drumComponent("sunlit-disco-loop", "Open Disco Hook", tracks.at(-1).segments[3], `${songId}-patterns`),
    ],
  });
}

function createRegistry(songId, factoryLumen, factoryAurum, synthStore) {
  const instruments = [];
  const previews = new Map();
  const lumen = (baseName, idSuffix, name, parameterOverrides, effects = [], modulation = []) => {
    const base = factoryLumen[baseName];
    if (!base?.patch) throw new Error(`Cannot create ${name}: missing ${baseName}`);
    const patch = structuredClone(base.patch);
    patch.name = name;
    patch.parameters = { ...patch.parameters, ...parameterOverrides };
    patch.effects = { filters: structuredClone(effects) };
    patch.modulation = [...structuredClone(patch.modulation ?? []), ...structuredClone(modulation)];
    patch.metadata = { ...patch.metadata, source: songId, editable: true };
    const id = `${songId}-lumen-${idSuffix}`;
    const instrument = {
      ...synthStore.synthDraftToInstrumentPatch(patch), id, name,
      icon: "ph:sparkle", kind: "wavetable", waveform: "wavetable", sampleIds: [],
      setId: `${songId}-lumen`, source: { kind: "created", label: `Made in Beat / ${songId}` },
      descriptors: ["lumen", "original-song", songId], userCreated: false,
    };
    instruments.push(instrument);
    previews.set(id, { ...synthStore.synthDraftToPreviewInstrument(patch), id, name });
    return instrument;
  };
  const aurum = (name) => {
    const source = factoryAurum[name];
    if (!source) throw new Error(`Missing Aurum instrument: ${name}`);
    const instrument = structuredClone(source);
    if (!instruments.some((entry) => entry.id === instrument.id)) instruments.push(instrument);
    previews.set(instrument.id, structuredClone(source));
    return instrument;
  };
  const drumKit = (prefix, style = "hybrid") => {
    const acoustic = style === "acoustic";
    const kit = {
      kick: acoustic
        ? sampler(`${songId}-${prefix}-kick`, "Pearl Kick", "/samples/pearl-master-studio/kick-01.wav")
        : sampler(`${songId}-${prefix}-kick`, "LM-2 Kick", "/samples/lm2/kick.wav"),
      snare: sampler(`${songId}-${prefix}-snare`, "Pearl Snare", "/samples/pearl-master-studio/snare-01.wav"),
      clap: sampler(`${songId}-${prefix}-clap`, "LM-2 Clap", "/samples/lm2/clap.wav"),
      closedHat: acoustic
        ? sampler(`${songId}-${prefix}-closed-hat`, "Pearl Closed Hat", "/samples/pearl-master-studio/hihat-closed.wav", { releaseMs: 55 })
        : sampler(`${songId}-${prefix}-closed-hat`, "LM-2 Closed Hat", "/samples/lm2/hihat-closed-short.wav", { releaseMs: 55 }),
      openHat: acoustic
        ? sampler(`${songId}-${prefix}-open-hat`, "Pearl Open Hat", "/samples/pearl-master-studio/hihat-open.wav", { decayMs: 180, releaseMs: 180 })
        : sampler(`${songId}-${prefix}-open-hat`, "LM-2 Open Hat", "/samples/lm2/hihat-open.wav", { decayMs: 180, releaseMs: 180 }),
      crash: sampler(`${songId}-${prefix}-crash`, "Pearl Crash", "/samples/pearl-master-studio/crash-01.wav", { decayMs: 520, releaseMs: 900 }),
      tom: sampler(`${songId}-${prefix}-tom`, "Pearl Mid Tom", "/samples/pearl-master-studio/tom-02.wav", { decayMs: 220, releaseMs: 260 }),
      ride: acoustic
        ? sampler(`${songId}-${prefix}-ride`, "Pearl Ride", "/samples/pearl-master-studio/ride-01.wav", { decayMs: 260, releaseMs: 320 })
        : sampler(`${songId}-${prefix}-ride`, "LM-2 Ride", "/samples/lm2/ride.wav", { decayMs: 260, releaseMs: 320 }),
      tamb: sampler(`${songId}-${prefix}-tamb`, "LM-2 Tambourine", "/samples/lm2/tamb.wav", { decayMs: 90, releaseMs: 100 }),
    };
    for (const instrument of Object.values(kit)) {
      instruments.push(instrument);
      previews.set(instrument.id, instrument);
    }
    return kit;
  };
  return { instruments, previews, lumen, aurum, drumKit };
}

function sampler(id, name, sampleUrl, envelopePatch = {}) {
  const pearl = sampleUrl.includes("pearl-master-studio");
  return {
    id, name, kind: "sampler",
    envelope: { attackMs: 1, decayMs: 110, sustain: 0, releaseMs: 110, ...envelopePatch },
    knobs: { cutoff: 0.9, resonance: 0.06, drive: 0, color: 0.62 },
    waveform: "sample", sampleIds: [], sampleUrl, setId: "original-song-drums",
    source: pearl
      ? { kind: "factory", label: "Oramics sampled / Pearl Master Studio", url: "https://oramics.github.io/sampled/DRUMS/pearl-master-studio/", license: "Creative Commons Attribution 3.0" }
      : { kind: "factory", label: "Oramics sampled / LM-2", url: "https://oramics.github.io/sampled/DM/LM-2/", license: "Public Domain" },
    descriptors: ["sample", "drum", "original-song"], userCreated: false,
  };
}

function finishSpec(spec) {
  return {
    ...spec,
    instruments: spec.registry.instruments,
    previews: spec.registry.previews,
    returnBuses: returnBuses(spec.songId),
    componentFolders: [{ id: `${spec.songId}-patterns`, name: `${spec.title} Patterns` }],
  };
}

function makeDocument(spec) {
  return {
    schemaVersion: 1,
    savedAt,
    project: {
      id: spec.songId, name: spec.name, bpm: spec.bpm,
      timeSignature: { num: 4, denom: 4, boldBeats: [1] },
      lengthBeats: spec.lengthBeats, tracks: spec.tracks, returnBuses: spec.returnBuses,
      masterEqAutomation: [
        { atBeat: 0, bandsDb: [-1, -0.5, 0, 0.5, 0.5, 0, -0.5] },
        { atBeat: spec.lengthBeats * 0.5, bandsDb: [-0.5, 0, 0.5, 1, 1, 0.5, -0.5] },
        { atBeat: spec.lengthBeats - 16, bandsDb: [-0.5, 0.5, 1, 1.2, 1, 0.5, -0.5] },
      ],
      masterChain: {
        inputGainDb: -2, compressorEnabled: true, compressorThresholdDb: -17,
        compressorRatio: 2, compressorAttackMs: 26, compressorReleaseMs: 170,
        compressorMakeupDb: 0.5, compressorMix: 68, outputGainDb: -1,
      },
      recordingInput: {
        inputDeviceId: "", inputDeviceName: "", inputChannelStart: 0, inputChannelCount: 2,
        calibrationSampleRate: 0, measuredRoundTripSamples: 0, reportedInputLatencySamples: 0,
        reportedOutputLatencySamples: 0, userLatencyAdjustmentSamples: 0,
      },
    },
    instruments: spec.instruments,
    instrumentSets: [
      { id: `${spec.songId}-lumen`, name: `${spec.title} Lumen Patches`, factory: false },
      { id: "aurum-test", name: "Aurum Test", factory: true },
      { id: "original-song-drums", name: "Original Song Drums", factory: true },
    ],
    audioFiles: [], components: spec.components, componentFolders: spec.componentFolders, plugins: [],
  };
}

function validateProject(document, spec) {
  if (document.project.lengthBeats !== spec.lengthBeats) throw new Error(`${spec.name}: migrated length changed`);
  if (document.project.tracks.length !== spec.tracks.length) throw new Error(`${spec.name}: migrated tracks changed`);
  const instrumentIds = new Set(document.instruments.map((entry) => entry.id));
  for (const trackEntry of document.project.tracks) {
    if (!instrumentIds.has(trackEntry.instrumentId)) throw new Error(`${spec.name}: missing track instrument ${trackEntry.instrumentId}`);
    for (const clip of trackEntry.segments) {
      const totalLength = clip.lengthBeats * (Number(clip.repeats ?? 0) + 1);
      if (clip.startBeat < 0 || clip.startBeat + totalLength > spec.lengthBeats + 0.001)
        throw new Error(`${spec.name}: clip ${clip.id} exceeds the arrangement`);
      if (clip.payload.kind === "midi") for (const noteEntry of clip.payload.notes) {
        if (noteEntry.startBeat < 0 || noteEntry.startBeat + noteEntry.lengthBeats > clip.lengthBeats + 0.001)
          throw new Error(`${spec.name}: note exceeds clip ${clip.id}`);
      }
      if (clip.payload.kind === "drum") for (const row of clip.payload.rows)
        if (!instrumentIds.has(row.instrumentId)) throw new Error(`${spec.name}: missing drum instrument ${row.instrumentId}`);
    }
  }
  const duration = document.project.lengthBeats * 60 / document.project.bpm;
  if (Math.abs(duration - 120) > 0.001) throw new Error(`${spec.name}: expected 120 seconds, got ${duration}`);
}

function renderPreview(spec, synthPreview, previewPath) {
  const sampleCount = Math.round(spec.lengthBeats * 60 / spec.bpm * sampleRate);
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  const noteCache = new Map();
  const sampleCache = new Map();
  const trackMetrics = {};

  for (const trackEntry of spec.tracks) {
    const trackTarget = { left: new Float32Array(sampleCount), right: new Float32Array(sampleCount) };
    const outputBus = spec.returnBuses.find((entry) => entry.id === trackEntry.outputBusId);
    const busGainDb = Number(outputBus?.inputTrimDb ?? 0) + Number(outputBus?.gainDb ?? 0);
    const trackGain = dbToGain(Number(trackEntry.gainDb ?? 0) + busGainDb);
    for (const clip of trackEntry.segments) {
      const plays = Math.max(1, Number(clip.repeats ?? 0) + 1);
      for (let play = 0; play < plays; play += 1) {
        const clipStart = clip.startBeat + play * clip.lengthBeats;
        if (clip.payload.kind === "midi") {
          const instrument = spec.previews.get(clip.instrumentId ?? trackEntry.instrumentId);
          if (!instrument) throw new Error(`${spec.name}: preview instrument missing for ${trackEntry.name}`);
          for (const entry of clip.payload.notes) renderSynthNote({
            target: trackTarget, instrument, entry, startBeat: clipStart + entry.startBeat,
            bpm: spec.bpm, sampleCount, synthPreview, noteCache,
            gain: trackGain * (entry.velocity / 127) * 0.13,
            pan: Math.max(-1, Math.min(1, Number(trackEntry.pan ?? 0))),
          });
        } else if (clip.payload.kind === "drum") {
          for (const row of clip.payload.rows) {
            const instrument = spec.instruments.find((entry) => entry.id === row.instrumentId);
            if (!instrument?.sampleUrl) continue;
            let sample = sampleCache.get(instrument.sampleUrl);
            if (!sample) {
              sample = readPcm16Wav(join(repoRoot, "frontend/public", instrument.sampleUrl.replace(/^\//, "")), sampleRate);
              sampleCache.set(instrument.sampleUrl, sample);
            }
            for (let step = 0; step < row.steps.length; step += 1) {
              const cell = row.steps[step];
              if (!cell || (typeof cell === "object" && !cell.on)) continue;
              const velocity = typeof cell === "object" ? Number(cell.velocity ?? 100) : 100;
              const leanPercent = typeof cell === "object" ? Number(cell.leanPercent ?? 0) : 0;
              const leanBeat = leanPercent / 100 * (clip.payload.sourceLengthBeats / clip.payload.stepCount);
              placeSample(trackTarget, sample, clipStart + step * clip.payload.sourceLengthBeats / clip.payload.stepCount + leanBeat,
                trackGain * velocity / 127 * 0.5, Number(trackEntry.pan ?? 0), spec.bpm);
            }
          }
        }
      }
    }
    trackMetrics[trackEntry.name] = analyze(trackTarget.left, trackTarget.right);
    for (let index = 0; index < sampleCount; index += 1) {
      left[index] += trackTarget.left[index];
      right[index] += trackTarget.right[index];
    }
  }

  let peak = 0;
  for (let index = 0; index < sampleCount; index += 1) peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
  const normalizeGain = peak > 0 ? 0.82 / peak : 1;
  if (normalizeGain !== 1) for (let index = 0; index < sampleCount; index += 1) {
    left[index] *= normalizeGain;
    right[index] *= normalizeGain;
  }
  writeStereoPcm16Wav(previewPath, left, right, sampleRate);
  return { ...analyze(left, right), tracks: trackMetrics };
}

function renderSynthNote({ target, instrument, entry, startBeat, bpm, sampleCount, synthPreview, noteCache, gain, pan }) {
  const beatSeconds = 60 / bpm;
  const releaseSeconds = Math.min(1.5, Number(instrument.envelope?.releaseMs ?? 180) / 1000);
  const count = Math.min(sampleCount, Math.ceil(Math.max(0.18, entry.lengthBeats * beatSeconds + releaseSeconds) * sampleRate));
  const hasCurve = (entry.curve?.length ?? 0) > 1;
  const cacheKey = hasCurve ? null : `${instrument.id}:${entry.pitch}:${count}`;
  let rendered = cacheKey ? noteCache.get(cacheKey) : undefined;
  if (!rendered) {
    const left = new Float32Array(count);
    const right = new Float32Array(count);
    const renderCurve = hasCurve ? entry.curve.map((point) => ({
      timeS: point.beat * beatSeconds,
      frequency: 440 * 2 ** ((point.pitch - 69) / 12),
    })) : undefined;
    synthPreview.renderInstrumentStereoSamples(
      instrument, left, right, sampleRate, 440 * 2 ** ((entry.pitch - 69) / 12), "audio", true, undefined, renderCurve,
    );
    rendered = { left, right };
    if (cacheKey) noteCache.set(cacheKey, rendered);
  }
  const offset = Math.max(0, Math.round(startBeat * beatSeconds * sampleRate));
  const leftGain = gain * Math.sqrt((1 - pan) * 0.5);
  const rightGain = gain * Math.sqrt((1 + pan) * 0.5);
  const fade = Math.min(96, Math.floor(count / 8));
  for (let index = 0; index < count && offset + index < sampleCount; index += 1) {
    const window = fade ? Math.min(1, index / fade, (count - 1 - index) / fade) : 1;
    target.left[offset + index] += rendered.left[index] * leftGain * Math.max(0, window);
    target.right[offset + index] += rendered.right[index] * rightGain * Math.max(0, window);
  }
}

function track(id, name, instrumentId, segments, gainDb = 0, options = {}) {
  const { effects = [], ...rest } = options;
  return {
    id, name, kind: "midi", instrumentId, gainDb, pan: 0, mute: false, solo: false,
    recordArmed: false, inputMonitoring: false, inputDeviceId: "", inputChannelStart: 0, inputChannelCount: 1,
    recordGainDb: 0, sends: [], effects: { filters: effects }, segments, rowHeight: "normal", ...rest,
  };
}

function segment(id, name, trackId, instrumentId, startBar, barCount, notes, automation = undefined) {
  return {
    id, name, trackId, instrumentId, startBeat: startBar * 4, lengthBeats: barCount * 4,
    repeats: 0, layer: 0, ...(automation ? { automation } : {}), payload: { kind: "midi", notes, gainDb: 0 },
  };
}

function drumSegment(id, name, trackId, kit, startBar, barCount, variant, swingPercent) {
  const lengthBeats = 4;
  const pattern = drumPattern(variant);
  const cell = (velocity, leanPercent = 0) => ({ on: true, velocity, leanPercent });
  const steps = (entries) => {
    const values = Array.from({ length: 16 }, () => false);
    for (const [step, velocity, lean] of entries) values[step] = cell(velocity, lean);
    return values;
  };
  return {
    id, name, trackId, instrumentId: kit.kick.id, startBeat: startBar * 4, lengthBeats,
    repeats: barCount - 1, layer: 0,
    payload: {
      kind: "drum", stepCount: 16, speed: 1, sourceLengthBeats: 4, swingPercent,
      timeSignature: { num: 4, denom: 4, boldBeats: [1] },
      rows: Object.entries(kit).map(([role, instrument]) => ({
        id: `${id}-${role}`, instrumentId: instrument.id, name: instrument.name, steps: steps(pattern[role] ?? []),
      })),
    },
  };
}

function drumPattern(name) {
  const patterns = {
    "rock-sparse": {
      kick: [[0, 110, 0], [8, 92, 0]], snare: [[4, 82, 0], [12, 96, 1]],
      closedHat: [[2, 54, -2], [6, 60, 2], [10, 58, -1], [14, 64, 3]], openHat: [], crash: [], tom: [], clap: [], ride: [], tamb: [],
    },
    "rock-verse": {
      kick: [[0, 120, -1], [7, 84, 2], [8, 112, 0], [11, 78, 3]], snare: [[4, 108, 0], [12, 116, 1]],
      closedHat: [[0, 62, -2], [2, 70, 0], [4, 64, -1], [6, 76, 2], [8, 66, -1], [10, 72, 1], [12, 68, 0], [14, 80, 3]],
      openHat: [[14, 46, 4]], crash: [], tom: [], clap: [[12, 42, 2]], ride: [], tamb: [],
    },
    "rock-build": {
      kick: [[0, 120, 0], [4, 86, 0], [8, 114, 0], [12, 94, 1]], snare: [[4, 108, 0], [12, 118, 1], [14, 72, 3], [15, 88, 4]],
      closedHat: Array.from({ length: 16 }, (_, step) => [step, step % 4 === 0 ? 78 : 58 + step % 3 * 5, step % 2 ? 2 : -1]),
      openHat: [[14, 62, 4]], crash: [], tom: [[15, 68, 4]], clap: [], ride: [], tamb: [],
    },
    "rock-hook": {
      kick: [[0, 126, -1], [3, 82, 2], [8, 118, 0], [10, 88, 2], [15, 78, 4]], snare: [[4, 118, 0], [12, 124, 1]],
      closedHat: [[2, 72, -2], [6, 82, 2], [10, 76, -1], [14, 90, 4]], openHat: [[6, 60, 3], [14, 70, 5]],
      crash: [[0, 88, 0]], tom: [], clap: [[4, 52, 1], [12, 58, 2]], ride: [[8, 48, 0]], tamb: [],
    },
    "rock-break": {
      kick: [[0, 110, 0], [10, 74, 4]], snare: [[8, 112, 1]], closedHat: [[2, 48, -3], [6, 54, 3], [14, 60, 5]],
      openHat: [[14, 44, 5]], crash: [], tom: [[15, 48, 5]], clap: [], ride: [], tamb: [],
    },
    "rock-final": {
      kick: [[0, 127, -1], [3, 88, 2], [7, 82, 3], [8, 122, 0], [10, 94, 2], [15, 88, 4]], snare: [[4, 122, 0], [12, 126, 1], [14, 68, 4]],
      closedHat: Array.from({ length: 16 }, (_, step) => [step, step % 4 === 2 ? 88 : step % 2 ? 58 : 72, step % 2 ? 3 : -2]),
      openHat: [[6, 70, 3], [14, 82, 5]], crash: [[0, 96, 0]], tom: [[15, 62, 5]], clap: [[4, 62, 1], [12, 68, 2]], ride: [[8, 58, 0]], tamb: [],
    },
    "rock-outro": {
      kick: [[0, 108, 0], [8, 90, 0]], snare: [[4, 96, 0], [12, 86, 1]], closedHat: [[2, 56, -2], [6, 62, 2], [10, 54, -1]],
      openHat: [[14, 48, 4]], crash: [], tom: [[14, 58, 3], [15, 72, 4]], clap: [], ride: [], tamb: [],
    },
    "disco-intro": {
      kick: [[0, 86, 0], [8, 82, 0]], snare: [[12, 72, 1]], closedHat: [[2, 52, -2], [6, 58, 2], [10, 54, -1], [14, 62, 3]],
      openHat: [], crash: [], tom: [], clap: [[12, 42, 2]], ride: [], tamb: [[6, 44, 2], [14, 52, 3]],
    },
    "disco-pocket": {
      kick: [[0, 102, 0], [4, 94, 0], [8, 100, 0], [12, 96, 0]], snare: [[4, 94, 0], [12, 102, 1]],
      closedHat: [[0, 54, -2], [2, 68, 0], [4, 56, -1], [6, 74, 2], [8, 58, -1], [10, 70, 1], [12, 60, 0], [14, 80, 3]],
      openHat: [[6, 58, 2], [14, 66, 4]], crash: [], tom: [], clap: [[4, 52, 1], [12, 58, 2]], ride: [], tamb: [[3, 44, 2], [7, 50, 3], [11, 46, 2], [15, 56, 4]],
    },
    "disco-build": {
      kick: [[0, 108, 0], [4, 98, 0], [8, 106, 0], [12, 102, 0]], snare: [[4, 98, 0], [12, 110, 1], [14, 62, 3], [15, 78, 4]],
      closedHat: Array.from({ length: 16 }, (_, step) => [step, step % 2 ? 62 : 54, step % 2 ? 2 : -1]),
      openHat: [[6, 62, 2], [14, 72, 4]], crash: [], tom: [[15, 58, 4]], clap: [[4, 54, 1], [12, 62, 2]], ride: [], tamb: [[3, 50, 2], [7, 56, 3], [11, 54, 2], [15, 64, 4]],
    },
    "disco-hook": {
      kick: [[0, 112, 0], [4, 104, 0], [8, 110, 0], [12, 106, 0]], snare: [[4, 108, 0], [12, 116, 1]],
      closedHat: [[0, 58, -2], [2, 76, 0], [4, 60, -1], [6, 84, 2], [8, 62, -1], [10, 78, 1], [12, 64, 0], [14, 90, 3]],
      openHat: [[2, 54, 1], [6, 72, 2], [10, 58, 2], [14, 80, 4]], crash: [[0, 72, 0]], tom: [], clap: [[4, 64, 1], [12, 72, 2]], ride: [],
      tamb: [[1, 44, 1], [3, 52, 2], [5, 46, 1], [7, 58, 3], [9, 48, 1], [11, 54, 2], [13, 50, 1], [15, 62, 4]],
    },
    "disco-break": {
      kick: [[0, 94, 0], [8, 88, 0]], snare: [[4, 78, 0], [12, 88, 1]], closedHat: [[2, 52, -2], [6, 58, 2], [10, 54, -1], [14, 64, 3]],
      openHat: [[14, 48, 4]], crash: [], tom: [], clap: [[12, 44, 2]], ride: [], tamb: [[3, 42, 2], [7, 46, 3], [11, 44, 2], [15, 50, 4]],
    },
    "disco-final": {
      kick: [[0, 116, 0], [4, 108, 0], [8, 114, 0], [12, 110, 0]], snare: [[4, 114, 0], [12, 120, 1]],
      closedHat: Array.from({ length: 16 }, (_, step) => [step, step % 2 ? 70 : 58, step % 2 ? 2 : -1]),
      openHat: [[2, 58, 1], [6, 76, 2], [10, 62, 2], [14, 84, 4]], crash: [[0, 82, 0]], tom: [[15, 54, 4]], clap: [[4, 68, 1], [12, 76, 2]],
      ride: [[8, 52, 0]], tamb: [[1, 48, 1], [3, 56, 2], [5, 50, 1], [7, 62, 3], [9, 52, 1], [11, 58, 2], [13, 54, 1], [15, 66, 4]],
    },
    "disco-outro": {
      kick: [[0, 96, 0], [4, 88, 0], [8, 92, 0]], snare: [[4, 86, 0], [12, 78, 1]], closedHat: [[2, 58, -2], [6, 64, 2], [10, 56, -1]],
      openHat: [[14, 50, 4]], crash: [], tom: [[14, 52, 3], [15, 62, 4]], clap: [[4, 46, 1]], ride: [], tamb: [[3, 44, 2], [7, 48, 3]],
    },
  };
  const result = patterns[name];
  if (!result) throw new Error(`Unknown drum pattern: ${name}`);
  return result;
}

function returnBuses(songId) {
  return [
    {
      schemaVersion: 1, id: "bus-music", name: "Music Group", channelLayout: "stereo", outputEnabled: true,
      inputTrimDb: 0, gainDb: 0, pan: 0, mute: false, solo: false, soloSafe: false, mixerOrder: 0,
      sends: [send("bus-space", -18)], effects: { filters: [
        effect(`${songId}-music-comp`, "compressor", { thresholdDb: -18, ratio: 2.1, attackMs: 28, releaseMs: 170, makeupDb: 0.5, mix: 65 }),
      ] },
    },
    {
      schemaVersion: 1, id: "bus-drums", name: "Drum Group", channelLayout: "stereo", outputEnabled: true,
      inputTrimDb: -2, gainDb: -5, pan: 0, mute: false, solo: false, soloSafe: false, mixerOrder: 1,
      sends: [send("bus-space", -24, 0.04, true)], effects: { filters: [
        effect(`${songId}-drum-comp`, "compressor", { thresholdDb: -16, ratio: 2.3, attackMs: 24, releaseMs: 130, makeupDb: 0.5, mix: 38 }),
      ] },
    },
    {
      schemaVersion: 1, id: "bus-space", name: "Shared Space", channelLayout: "stereo", outputEnabled: true,
      inputTrimDb: 0, gainDb: -6, pan: 0, mute: false, solo: false, soloSafe: true, mixerOrder: 2,
      sends: [], effects: { filters: [
        effect(`${songId}-space-delay`, "delay", { timeMs: 375, feedback: 28, mix: 22 }),
        effect(`${songId}-space-reverb`, "reverb", { roomSize: 62, damping: 48, mix: 34 }),
        effect(`${songId}-space-highpass`, "highpass", { cutoffHz: 190, resonance: 3 }),
      ] },
    },
  ];
}

function effect(id, kind, params) { return { id, kind, bypassed: false, params }; }
function send(busId, gainDb, pan = 0, preFader = false) { return { busId, gainDb, pan, enabled: true, preFader }; }
function midiNote(pitch, startBeat, lengthBeats, velocity, options = {}) { return { pitch, startBeat, lengthBeats, velocity, ...options }; }
function automationLane(target, rows) { return { target, points: rows.map(([beat, value, curve = "linear"]) => ({ beat, value, curve })) }; }
function barsArray(count) { return Array.from({ length: count }, (_, index) => index); }
function section(name, startBar, endBar) { return { name, startBeat: startBar * 4, endBeat: endBar * 4 }; }
function midiComponent(id, name, notes, lengthBeats, folderId) { return { id, kind: "midi", name, notes: structuredClone(notes), lengthBeats, createdAt: savedAt, folderId }; }
function drumComponent(id, name, source, folderId) {
  return {
    id, kind: "drum", name, rows: structuredClone(source.payload.rows), stepCount: source.payload.stepCount,
    speed: source.payload.speed, lengthBeats: source.payload.sourceLengthBeats,
    swingPercent: source.payload.swingPercent, timeSignature: structuredClone(source.payload.timeSignature), createdAt: savedAt, folderId,
  };
}
function dbToGain(db) { return 10 ** (Number(db) / 20); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function readPcm16Wav(path, targetRate) {
  const buffer = readFileSync(path);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error(`Unsupported WAV: ${path}`);
  let channels = 0; let sourceRate = 0; let bits = 0; let format = 0; let dataOffset = -1; let dataSize = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (id === "fmt ") {
      format = buffer.readUInt16LE(data); channels = buffer.readUInt16LE(data + 2);
      sourceRate = buffer.readUInt32LE(data + 4); bits = buffer.readUInt16LE(data + 14);
    } else if (id === "data") { dataOffset = data; dataSize = Math.min(size, buffer.length - data); }
    offset = data + size + size % 2;
  }
  if (format !== 1 || bits !== 16 || channels < 1 || channels > 2 || dataOffset < 0) throw new Error(`Expected PCM16 WAV: ${path}`);
  const sourceFrames = Math.floor(dataSize / channels / 2);
  const targetFrames = Math.max(1, Math.round(sourceFrames * targetRate / sourceRate));
  const left = new Float32Array(targetFrames); const right = new Float32Array(targetFrames);
  const sampleAt = (frame, channel) => buffer.readInt16LE(dataOffset + (frame * channels + Math.min(channel, channels - 1)) * 2) / 32768;
  for (let frame = 0; frame < targetFrames; frame += 1) {
    const position = Math.min(sourceFrames - 1, frame * sourceRate / targetRate);
    const index = Math.floor(position); const next = Math.min(sourceFrames - 1, index + 1); const fraction = position - index;
    left[frame] = sampleAt(index, 0) + (sampleAt(next, 0) - sampleAt(index, 0)) * fraction;
    right[frame] = sampleAt(index, 1) + (sampleAt(next, 1) - sampleAt(index, 1)) * fraction;
  }
  return { left, right };
}

function placeSample(target, sample, startBeat, gain, pan, bpm) {
  const offset = Math.max(0, Math.round(startBeat * 60 / bpm * sampleRate));
  const boundedPan = Math.max(-1, Math.min(1, pan));
  const leftGain = gain * Math.sqrt((1 - boundedPan) * 0.5);
  const rightGain = gain * Math.sqrt((1 + boundedPan) * 0.5);
  for (let index = 0; index < sample.left.length && offset + index < target.left.length; index += 1) {
    target.left[offset + index] += sample.left[index] * leftGain;
    target.right[offset + index] += sample.right[index] * rightGain;
  }
}

function analyze(left, right) {
  let peak = 0; let sum = 0; let finite = true;
  for (let index = 0; index < left.length; index += 1) {
    finite &&= Number.isFinite(left[index]) && Number.isFinite(right[index]);
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
    sum += left[index] ** 2 + right[index] ** 2;
  }
  return { finite, peak, rms: Math.sqrt(sum / Math.max(1, left.length * 2)), frames: left.length };
}

function writeStereoPcm16Wav(path, left, right, rate) {
  const dataBytes = left.length * 4;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 4, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < left.length; index += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[index])) * 32767), 44 + index * 4);
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[index])) * 32767), 46 + index * 4);
  }
  writeFileSync(path, buffer);
}
