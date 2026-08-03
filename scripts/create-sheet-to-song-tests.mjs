#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { build } from "../frontend/node_modules/esbuild/lib/main.js";

const repoRoot = join(import.meta.dirname, "..");
const outputDirectory = join(repoRoot, "generated-tests");

const fixtures = [
  {
    name: "sheet_to_song_1",
    title: "Ravel - Jeux d'Eau",
    // The printed metronome mark is eighth-note = 144; Beat stores quarter-note BPM.
    bpm: 72,
    source: join(repoRoot, "tmp/pdfs/sheet-to-song-omr/jeux/IMSLP03175.mxl"),
    reviewedNotes: join(repoRoot, "tmp/pdfs/sheet-to-song-omr/jeux/Ravel_-_Jeux_dEau.notes.tsv"),
    reviewedMeasures: join(repoRoot, "tmp/pdfs/sheet-to-song-omr/jeux/Ravel_-_Jeux_dEau.measures.tsv"),
    piano: true,
    accompaniment: true,
    partNames: ["Piano"],
  },
  {
    name: "sheet_to_song_2",
    title: "Ravel - La Valse",
    // Viennese-waltz pulse is approximately 66 measures/minute in 3/4; Beat's BPM is quarter-note based.
    bpm: 198,
    sourceDirectory: join(repoRoot, "tmp/pdfs/sheet-to-song-omr/valse/chunks"),
    partNames: [
      "Piccolo", "Flutes", "Oboes", "English Horn", "Clarinets in A", "Bass Clarinet",
      "Bassoons", "Contrabassoon", "Horns in F", "Trumpets", "Trombones", "Tuba",
      "Timpani", "Triangle", "Tambourine", "Snare Drum", "Cymbals and Bass Drum",
      "Castanets", "Tam-tam", "Glockenspiel", "Crotales", "Harp I", "Harp II",
      "Violins I", "Violins II", "Violas", "Cellos", "Double Basses",
    ],
  },
  {
    name: "sheet_to_song_3",
    title: "Ravel - Daphnis et Chloe, Suite No. 1",
    bpm: 72,
    sourceDirectory: join(repoRoot, "tmp/pdfs/sheet-to-song-omr/daphnis/page-mxl"),
    partNames: [
      "Piccolo", "Flutes", "Alto Flute", "Oboes", "English Horn", "E-flat Clarinet",
      "Clarinets", "Bass Clarinet", "Bassoons", "Contrabassoon", "Horns", "Trumpets",
      "Trombones", "Tuba", "Timpani", "Tam-tam", "Celesta", "Harp I", "Harp II",
      "Violins I", "Violins II", "Violas", "Cellos", "Double Basses",
    ],
  },
  {
    name: "sheet_to_song_4",
    title: "Ravel - Bolero",
    bpm: 72,
    sourceDirectory: join(repoRoot, "tmp/pdfs/sheet-to-song-omr/bolero/chunks"),
    partNames: [
      "Piccolo", "Flutes", "Oboes", "English Horn", "Clarinets", "Bass Clarinet",
      "Bassoons", "Contrabassoon", "Horns", "Trumpets", "Soprano Saxophone",
      "Tenor Saxophone", "Trombones", "Tuba", "Timpani", "Snare Drum", "Cymbals",
      "Tam-tam", "Celesta", "Harp", "Violins I", "Violins II", "Violas", "Cellos",
      "Double Basses",
    ],
  },
];

const bundle = await build({
  stdin: {
    resolveDir: join(repoRoot, "frontend/src"),
    sourcefile: "sheet-to-song-document.ts",
    loader: "ts",
    contents: `
      import { parseMusicXmlSource, type ImportedScorePart, type ImportedScorePlan } from "./scoreImport/musicXmlImport.ts";
      import { migrateBeatDocument } from "./persistence/beatDocument.ts";
      import { createSalamanderCompactGrand } from "./state/factoryPiano.ts";
      import { createFactoryScoreInstrument } from "./state/factoryScoreSamplers.ts";
      import { generateScoreAccompaniment } from "./scoreImport/scoreAccompaniment.ts";
      import type { Instrument, Track } from "./state/types.ts";

      export function parseScore(name: string, bytes: Uint8Array) {
        return parseMusicXmlSource({ name, bytes });
      }

      export function combineScorePages(plans: ImportedScorePlan[]): ImportedScorePlan {
        if (plans.length === 0) throw new Error("No readable score pages were supplied.");
        const offsets: number[] = [];
        let offset = 0;
        for (const plan of plans) {
          offsets.push(offset);
          offset += plan.lengthBeats;
        }
        const partCount = Math.max(...plans.map((plan) => plan.parts.length));
        const parts = Array.from({ length: partCount }, (_, partIndex): ImportedScorePart => {
          const pageParts = plans.map((plan) => plan.parts[partIndex]).filter(Boolean);
          const representative = pageParts.find((part) => part.pitchRange) ?? pageParts[0];
          const measures = plans.flatMap((plan, pageIndex) => {
            const part = plan.parts[partIndex];
            return (part?.measures ?? []).map((measure) => ({
              ...measure,
              startBeat: measure.startBeat + offsets[pageIndex],
              notes: measure.notes.map((note) => ({ ...note, startBeat: note.startBeat + offsets[pageIndex] })),
            }));
          });
          const segments = plans.flatMap((plan, pageIndex) => {
            const part = plan.parts[partIndex];
            return (part?.segments ?? []).map((segment) => ({
              ...segment,
              startBeat: segment.startBeat + offsets[pageIndex],
              notes: segment.notes.map((note) => ({ ...note })),
            }));
          });
          const pitches = measures.flatMap((measure) => measure.notes.map((note) => note.pitch));
          return {
            ...representative,
            id: "page-part-" + (partIndex + 1),
            measures,
            segments,
            pitchRange: pitches.length ? [Math.min(...pitches), Math.max(...pitches)] : undefined,
            warningCodes: [...new Set(pageParts.flatMap((part) => part.warningCodes))],
          };
        });
        return {
          ...plans[0],
          sourceName: plans.map((plan) => plan.sourceName).join(", "),
          lengthBeats: offset,
          parts,
          warnings: [...new Set(plans.flatMap((plan) => plan.warnings))],
          quality: {
            usablePartRatio: parts.filter((part) => part.pitchRange).length / Math.max(1, parts.length),
            timingIntegrityRatio: Math.min(...plans.map((plan) => plan.quality.timingIntegrityRatio)),
            playablePartRatio: parts.filter((part) => part.pitchRange).length / Math.max(1, parts.length),
            repeatCoverageRatio: plans.reduce((sum, plan) => sum + plan.quality.repeatCoverageRatio, 0) / plans.length,
            status: "review",
          },
        };
      }

      export function buildSheetDocument(
        name: string,
        title: string,
        plan: ImportedScorePlan,
        suppliedNames: string[],
        piano: boolean,
        addAccompaniment: boolean,
        bpmOverride: number | undefined,
        savedAt: number,
      ) {
        const sourceParts = !piano && suppliedNames.length > 0 ? plan.parts.slice(0, suppliedNames.length) : plan.parts;
        const playable = sourceParts.filter((part) => part.pitchRange && part.measures.some((measure) => measure.notes.length));
        const sourcePartIndex = new Map(plan.parts.map((part, index) => [part, index]));
        const parts = piano ? [mergePianoParts(selectPianoSourceParts(playable), plan.lengthBeats)] : playable;
        const instruments: Instrument[] = parts.map((part, index) => piano
          ? { ...createSalamanderCompactGrand("factory-keys"), createdAt: savedAt, updatedAt: savedAt }
          : {
              ...createFactoryScoreInstrument(
                resolvedPartName(part, suppliedNames, sourcePartIndex.get(part) ?? index),
                stableId(name, "score-sampler", index),
                "orchestra-pit",
              ),
              createdAt: savedAt,
              updatedAt: savedAt,
            });
        const tracks: Track[] = parts.map((part, index) => {
          const trackId = stableId(name, "track", index);
          const partName = piano ? "Piano" : resolvedPartName(part, suppliedNames, sourcePartIndex.get(part) ?? index);
          const instrumentId = instruments[index].id;
          return {
            id: trackId,
            name: partName,
            kind: "midi" as const,
            instrumentId,
            gainDb: part.percussion ? -4 : 0,
            pan: orchestralPan(partName, index),
            mute: false,
            solo: false,
            recordArmed: false,
            inputMonitoring: false,
            inputDeviceId: "",
            inputChannelStart: 0,
            inputChannelCount: 2,
            recordGainDb: 0,
            outputEnabled: true,
            effects: { filters: [] },
            rowHeight: "normal" as const,
            segments: part.segments.filter((segment) => segment.notes.length).map((segment, segmentIndex) => ({
              id: stableId(name, "segment", index, segmentIndex),
              trackId,
              name: segment.name.replace(part.name, partName),
              startBeat: segment.startBeat,
              lengthBeats: segment.lengthBeats,
              repeats: segment.repeats,
              layer: 0,
              muted: false,
              instrumentId,
              payload: { kind: "midi" as const, notes: segment.notes.map((note) => ({ ...note })), gainDb: 0 },
            })),
          };
        });
        if (addAccompaniment && parts.length > 0) {
          const sourceNotes = parts[0].segments.flatMap((segment) => segment.notes.map((note) => ({
            ...note,
            startBeat: note.startBeat + segment.startBeat,
          })));
          const bassInstrument = {
            ...createFactoryScoreInstrument("Double Basses", stableId(name, "accompaniment-bass"), "orchestra-pit"),
            createdAt: savedAt,
            updatedAt: savedAt,
          };
          const drumDefinitions = [
            ["kick", "Orchestral Bass Drum"],
            ["snare", "Snare Drum"],
            ["cymbal", "Cymbal"],
            ["closedHat", "Closed Hi-Hat"],
            ["openHat", "Open Hi-Hat"],
            ["ride", "Ride Cymbal"],
            ["crash", "Crash Cymbal"],
            ["lowTom", "Low Tom"],
            ["midTom", "Mid Tom"],
            ["highTom", "High Tom"],
          ] as const;
          const drumInstruments = Object.fromEntries(drumDefinitions.map(([role, partName], index) => [role, {
            ...createFactoryScoreInstrument(partName, stableId(name, "accompaniment-drum", index), "orchestra-pit"),
            createdAt: savedAt,
            updatedAt: savedAt,
          }])) as Record<(typeof drumDefinitions)[number][0], Instrument>;
          const accompaniment = generateScoreAccompaniment({
            notes: sourceNotes,
            lengthBeats: plan.lengthBeats,
            bpm: Math.max(20, Math.min(400, bpmOverride ?? plan.bpm ?? 72)),
            timeSignature: {
              num: plan.timeSignature.numerator,
              denom: plan.timeSignature.denominator,
              boldBeats: [1],
            },
            keySignatureFifths: plan.keySignatureFifths,
            drumInstruments,
          });
          instruments.push(bassInstrument, ...Object.values(drumInstruments));

          const bassTrackId = stableId(name, "track", "generated-bass");
          tracks.push({
            id: bassTrackId,
            name: "Generated Bass - " + accompaniment.key.label,
            kind: "midi" as const,
            instrumentId: bassInstrument.id,
            gainDb: -3,
            pan: 0,
            mute: false,
            solo: false,
            recordArmed: false,
            inputMonitoring: false,
            inputDeviceId: "",
            inputChannelStart: 0,
            inputChannelCount: 2,
            recordGainDb: 0,
            outputEnabled: true,
            effects: { filters: [] },
            rowHeight: "normal" as const,
            segments: accompaniment.bassPhrases.map((phrase, index) => ({
              id: stableId(name, "bass-segment", index),
              trackId: bassTrackId,
              name: bassSectionName(accompaniment.chords.filter((chord) => chord.startBeat >= phrase.startBeat && chord.startBeat < phrase.startBeat + phrase.lengthBeats * (phrase.repeats + 1)).map((chord) => chord.label)),
              startBeat: phrase.startBeat,
              lengthBeats: phrase.lengthBeats,
              repeats: phrase.repeats,
              layer: 0,
              muted: false,
              instrumentId: bassInstrument.id,
              payload: {
                kind: "midi" as const,
                gainDb: 0,
                notes: phrase.notes.map((note) => ({ ...note })),
              },
            })).filter((segment) => segment.payload.notes.length > 0),
          });

          const drumTrackId = stableId(name, "track", "generated-drums");
          tracks.push({
            id: drumTrackId,
            name: "Generated Tempo-Aware Drums",
            kind: "midi" as const,
            instrumentId: drumInstruments.kick.id,
            gainDb: -5,
            pan: 0,
            mute: false,
            solo: false,
            recordArmed: false,
            inputMonitoring: false,
            inputDeviceId: "",
            inputChannelStart: 0,
            inputChannelCount: 2,
            recordGainDb: 0,
            outputEnabled: true,
            effects: { filters: [] },
            rowHeight: "normal" as const,
            segments: accompaniment.drumPhrases.map((phrase, index) => ({
              id: stableId(name, "drum-segment", index),
              trackId: drumTrackId,
              name: "Drums - " + phrase.style,
              startBeat: phrase.startBeat,
              lengthBeats: phrase.lengthBeats,
              repeats: phrase.repeats,
              layer: 0,
              muted: false,
              instrumentId: drumInstruments.kick.id,
              payload: {
                kind: "drum" as const,
                rows: phrase.rows.map((row, rowIndex) => ({
                  id: stableId(name, "drum-row", index, rowIndex),
                  instrumentId: drumInstruments[row.role].id,
                  name: row.name,
                  steps: row.steps.map((step) => typeof step === "boolean" ? step : { ...step }),
                })),
                stepCount: phrase.stepCount,
                speed: phrase.speed,
                sourceLengthBeats: phrase.sourceLengthBeats,
                swingPercent: phrase.swingPercent,
                timeSignature: {
                  num: plan.timeSignature.numerator,
                  denom: plan.timeSignature.denominator,
                  boldBeats: [1],
                },
              },
            })),
          });
        }

        function bassSectionName(chordLabels: string[]) {
          const preview = chordLabels.slice(0, 6).join(" – ");
          if (chordLabels.length === 0) return "Bass section";
          return chordLabels.length <= 6 ? "Bass · " + preview : "Bass · " + preview + " … (" + chordLabels.length + " changes)";
        }

        const document = {
          schemaVersion: 1 as const,
          savedAt,
          project: {
            id: stableId(name, "project"),
            name,
            bpm: Math.max(20, Math.min(400, bpmOverride ?? plan.bpm ?? (piano ? 144 : 72))),
            timeSignature: {
              num: plan.timeSignature.numerator,
              denom: plan.timeSignature.denominator,
              boldBeats: [1],
            },
            lengthBeats: plan.lengthBeats,
            tracks,
            returnBuses: [],
            masterEqAutomation: [],
            masterChain: {
              inputGainDb: 0,
              compressorEnabled: false,
              compressorThresholdDb: -18,
              compressorRatio: 2,
              compressorAttackMs: 20,
              compressorReleaseMs: 160,
              compressorMakeupDb: 0,
              compressorMix: 100,
              outputGainDb: 0,
            },
            recordingInput: {
              inputDeviceId: "",
              inputDeviceName: "",
              inputChannelStart: 0,
              inputChannelCount: 2,
              calibrationSampleRate: 0,
              measuredRoundTripSamples: 0,
              reportedInputLatencySamples: 0,
              reportedOutputLatencySamples: 0,
              userLatencyAdjustmentSamples: 0,
            },
          },
          instruments,
          audioFiles: [],
          components: [],
          componentFolders: [],
          plugins: [],
          assets: [],
        };
        return { document: migrateBeatDocument(document), summary: { sourceTitle: title, planTitle: plan.title, parts: tracks.map((track) => track.name), quality: plan.quality, warnings: plan.warnings } };
      }

      function mergePianoParts(parts: ImportedScorePart[], lengthBeats: number): ImportedScorePart {
        const notes = dedupeNotes(parts.flatMap((part) => part.measures.flatMap((measure) => measure.notes)));
        return {
          id: "piano",
          name: "Piano",
          percussion: false,
          measures: [],
          segments: [{ name: "Piano - OCR score", startBeat: 0, lengthBeats, repeats: 0, notes, measureNumbers: [] }],
          pitchRange: notes.length ? [Math.min(...notes.map((note) => note.pitch)), Math.max(...notes.map((note) => note.pitch))] : undefined,
          warningCodes: [...new Set(parts.flatMap((part) => part.warningCodes))],
        };
      }

      function selectPianoSourceParts(parts: ImportedScorePart[]) {
        const explicitlyNamed = parts.filter((part) => /(?:^|\\b)(?:piano|grand)(?:\\b|$)/i.test(part.name));
        if (explicitlyNamed.length > 0) return explicitlyNamed;
        // A single-staff OCR engine can emit anonymous Voice parts for one piano system.
        // Without an explicit Piano label, retain only the densest plausible part instead
        // of merging unrelated OCR hypotheses into fabricated polyphony.
        return [...parts].sort((left, right) => noteCount(right) - noteCount(left)).slice(0, 1);
      }

      function noteCount(part: ImportedScorePart) {
        return part.measures.reduce((sum, measure) => sum + measure.notes.length, 0);
      }

      function dedupeNotes(notes: ImportedScorePart["segments"][number]["notes"]) {
        const seen = new Set<string>();
        return notes.filter((note) => {
          const key = [note.pitch, note.startBeat, note.lengthBeats, note.velocity].join(":");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).sort((left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch);
      }

      function resolvedPartName(part: ImportedScorePart, suppliedNames: string[], index: number) {
        if (suppliedNames[index]) return suppliedNames[index];
        const readName = part.name.trim();
        if (readName && !/^part(?:\\s+|$)|^music$/i.test(readName)) return readName;
        return "Orchestral Part " + (index + 1);
      }

      function orchestralPan(name: string, index: number) {
        if (/violin i$/i.test(name)) return -0.45;
        if (/violin ii$/i.test(name)) return -0.2;
        if (/viola/i.test(name)) return 0.08;
        if (/cello/i.test(name)) return 0.28;
        if (/bass/i.test(name)) return 0.42;
        return Math.max(-0.3, Math.min(0.3, ((index % 5) - 2) * 0.12));
      }

      function stableId(name: string, ...parts: Array<string | number>) {
        return [name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), ...parts.map((part) => String(part).toLowerCase().replace(/[^a-z0-9]+/g, "-"))].join("-");
      }
    `,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  external: ["juce-framework-frontend"],
});

const encoded = Buffer.from(bundle.outputFiles[0].text).toString("base64");
const api = await import(`data:text/javascript;base64,${encoded}`);
mkdirSync(outputDirectory, { recursive: true });

const requestedFixtureNames = new Set(process.argv.slice(2));
const selectedFixtures = requestedFixtureNames.size > 0
  ? fixtures.filter((fixture) => requestedFixtureNames.has(fixture.name))
  : fixtures;
for (const requestedName of requestedFixtureNames) {
  assert(selectedFixtures.some((fixture) => fixture.name === requestedName), `Unknown sheet-to-song fixture: ${requestedName}`);
}

const savedAt = Date.now();
let written = 0;
for (const fixture of selectedFixtures) {
  const sourceFiles = fixture.sourceDirectory && existsSync(fixture.sourceDirectory)
    ? readdirSync(fixture.sourceDirectory).filter((name) => /\.(?:mxl|musicxml|xml)$/i.test(name)).sort().map((name) => join(fixture.sourceDirectory, name))
    : fixture.source && existsSync(fixture.source) ? [fixture.source] : [];
  if (sourceFiles.length === 0) {
    console.warn(`${fixture.name}: waiting for ${fixture.source ?? fixture.sourceDirectory}`);
    continue;
  }
  const pagePlans = sourceFiles.map((source) => api.parseScore(basename(source), new Uint8Array(readFileSync(source))));
  let plan = pagePlans.length === 1 ? pagePlans[0] : api.combineScorePages(pagePlans);
  if (fixture.reviewedNotes && fixture.reviewedMeasures
      && existsSync(fixture.reviewedNotes) && existsSync(fixture.reviewedMeasures)) {
    plan = applyReviewedPianoReference(plan, fixture.reviewedNotes, fixture.reviewedMeasures);
  }
  const { document, summary } = api.buildSheetDocument(
    fixture.name,
    fixture.title,
    plan,
    fixture.partNames,
    Boolean(fixture.piano),
    Boolean(fixture.accompaniment),
    fixture.bpm,
    savedAt,
  );
  const target = join(outputDirectory, `${fixture.name}.beat`);
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  const parsed = JSON.parse(readFileSync(target, "utf8"));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.project.name, fixture.name);
  assert.ok(parsed.project.tracks.length > 0);
  assert.ok(parsed.project.tracks.every((track) => track.instrumentId));
  assert.ok(parsed.project.tracks.every((track) => track.segments.some((segment) => segment.payload.kind === "drum"
    ? segment.payload.rows.some((row) => row.steps.some(Boolean))
    : segment.payload.notes?.length)));
  if (fixture.name === "sheet_to_song_1") verifyJeuxDEauOpening(parsed);
  console.log(`${fixture.name}: ${summary.sourceTitle}; ${parsed.project.tracks.length} playable parts, ${parsed.project.lengthBeats} beats, score quality ${summary.quality.status}`);
  console.log(`  ${summary.parts.join(" | ")}`);
  if (summary.warnings.length) console.log(`  warnings: ${summary.warnings.length}`);
  written += 1;
}
console.log(`Wrote ${written}/${selectedFixtures.length} sheet-to-song projects to ${outputDirectory}`);

function applyReviewedPianoReference(plan, notesPath, measuresPath) {
  const noteRows = parseTsv(readFileSync(notesPath, "utf8"));
  const measureRows = parseTsv(readFileSync(measuresPath, "utf8"));
  const notes = [];
  const openTies = new Map();
  for (const row of noteRows) {
    const pitch = Number(row.midi);
    const startBeat = parseFraction(row.quarterbeats);
    const lengthBeats = parseFraction(row.duration_qb);
    if (!Number.isFinite(pitch) || !Number.isFinite(startBeat) || !(lengthBeats > 0)) continue;
    const note = { pitch, velocity: 88, startBeat, lengthBeats };
    const tie = Number(row.tied);
    const tieKey = [row.staff, row.voice, pitch].join(":");
    const openTie = openTies.get(tieKey);
    if (openTie && (tie === 0 || tie === -1)) {
      openTie.lengthBeats = roundBeat(Math.max(openTie.lengthBeats, startBeat + lengthBeats - openTie.startBeat));
      if (tie === -1) openTies.delete(tieKey);
      continue;
    }
    notes.push(note);
    if (tie === 1) openTies.set(tieKey, note);
  }
  notes.sort((left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch);
  const lengthBeats = measureRows.reduce((end, row) => Math.max(end, parseFraction(row.quarterbeats) + Number(row.duration_qb || 0)), 0);
  const pitchRange = notes.length
    ? [Math.min(...notes.map((note) => note.pitch)), Math.max(...notes.map((note) => note.pitch))]
    : undefined;
  const piano = {
    id: "reviewed-piano",
    name: "Piano",
    percussion: false,
    measures: [{
      number: "1-88",
      pageNumber: 1,
      startBeat: 0,
      lengthBeats,
      expectedLengthBeats: lengthBeats,
      observedLengthBeats: lengthBeats,
      timingStatus: "ready",
      issues: [],
      notes,
      harmony: [],
      fingerprint: "reviewed-reference",
      repeatStart: false,
    }],
    segments: [{ name: "Piano - reviewed score", startBeat: 0, lengthBeats, repeats: 0, notes, measureNumbers: measureRows.map((row) => row.mn) }],
    pitchRange,
    warningCodes: [],
  };
  return {
    ...plan,
    bpm: 72,
    keySignatureFifths: 4,
    timeSignature: { numerator: 4, denominator: 4 },
    lengthBeats,
    parts: [piano],
    warnings: ["The unresolved OCR piano hypotheses were replaced by a local reviewed transcription for this test project."],
    quality: {
      usablePartRatio: 1,
      timingIntegrityRatio: 1,
      playablePartRatio: 1,
      repeatCoverageRatio: 0,
      totalMeasureCount: measureRows.length,
      verifiedMeasureCount: measureRows.length,
      repairedMeasureCount: 0,
      reviewMeasureCount: 0,
      status: "ready",
    },
  };
}

function parseTsv(source) {
  const [headerLine, ...lines] = source.trim().split(/\r?\n/);
  const headers = headerLine.split("\t");
  return lines.map((line) => Object.fromEntries(line.split("\t").map((value, index) => [headers[index], value])));
}

function parseFraction(value) {
  if (typeof value !== "string" || value.length === 0) return 0;
  const [numerator, denominator = "1"] = value.split("/");
  return Number(numerator) / Number(denominator);
}

function roundBeat(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function verifyJeuxDEauOpening(document) {
  assert.equal(document.project.bpm, 72, "Jeux d'Eau must interpret eighth-note = 144 as 72 quarter-note BPM");
  assert.equal(document.project.tracks.length, 3, "the project should contain piano plus exactly two generated accompaniment tracks");
  const piano = document.project.tracks.find((track) => track.name === "Piano");
  assert.ok(piano, "the solo-piano score must retain its piano track");
  const opening = piano.segments.flatMap((segment) => segment.payload.notes
    .map((note) => ({ ...note, startBeat: note.startBeat + segment.startBeat })))
    .filter((note) => note.startBeat < 4);
  assert.deepEqual(opening.slice(0, 8).map((note) => note.pitch), [64, 71, 75, 80, 68, 76, 87, 90], "opening pitches must retain the four-sharp key signature");
  assert.ok(opening.every((note) => note.lengthBeats <= 0.5), "the opening must not contain invented sustained notes");
  const bass = document.project.tracks.find((track) => track.name === "Generated Bass - E major");
  assert.ok(bass?.segments.some((segment) => segment.payload.notes.length > 0), "the score must produce an E-major-aware bassline");
  assert.ok(bass.segments.length > 1 && bass.segments.length <= 12, "bass accompaniment should use a small set of editable song regions");
  assert.ok(bass.segments.every((segment) => segment.lengthBeats <= 32), "bass accompaniment should remain split into editable eight-bar phrases");
  const eMajorPitchClasses = new Set([1, 3, 4, 6, 8, 9, 11]);
  assert.ok(bass.segments.flatMap((segment) => segment.payload.notes).every((note) => eMajorPitchClasses.has(note.pitch % 12)), "bass notes must remain inside the recognized E-major key");
  const drums = document.project.tracks.find((track) => track.name === "Generated Tempo-Aware Drums");
  assert.ok(drums?.segments.some((segment) => segment.name.includes("flowing-orchestral")), "slow dense piano material should select a flowing orchestral drum feel");
  assert.ok(drums.segments.length > 1 && drums.segments.length <= 12, `the score should use a small set of groove regions rather than one giant drum grid (received ${drums.segments.length})`);
  assert.ok(drums.segments.some((segment) => segment.repeats > 0), "repeated groove regions should use nondestructive segment loops");
  assert.ok(drums.segments.every((segment) => segment.payload.stepCount <= 64), "no drum source should exceed a compact four-bar grid");
  assertTimelineCoverage(drums.segments, document.project.lengthBeats, "drum loops");
  const drumHits = drums.segments.flatMap((segment) => segment.payload.rows.flatMap((row) => row.steps.filter((step) => typeof step === "object" && step?.on)));
  const drumVelocities = drumHits.map((step) => step.velocity).filter(Number.isFinite);
  const instrumentNames = new Map(document.instruments.map((instrument) => [instrument.id, instrument.name]));
  assert.ok(drums.segments.every((segment) => segment.payload.sourceLengthBeats / segment.payload.speed === segment.lengthBeats), "each drum loop grid must match its source duration");
  assert.ok(drums.segments.every((segment) => segment.payload.rows.length >= 3), "score accompaniment should orchestrate multiple percussion roles");
  assert.ok(
    drums.segments.every((segment) => segment.payload.rows.every((row) => {
      if (!/crash|cymbal|ride|hat/i.test(row.name)) return true;
      const opening = row.steps[0];
      return !(typeof opening === "object" && opening ? opening.on : opening);
    })),
    "repeated orchestral grooves must not retrigger a cymbal at every segment boundary",
  );
  assert.ok(Math.max(...drumVelocities) - Math.min(...drumVelocities) >= 20, "score drums should include clear accents and supporting strokes");
  assert.ok(Math.min(...drumVelocities) >= 42, "score drum samples should not contain effectively inaudible generated hits");
  assert.ok(
    drums.segments.every((segment) => segment.payload.rows.every((row) => instrumentNames.get(row.instrumentId) === row.name)),
    "score drum row labels must describe the exact sampler used by editor and arrangement playback",
  );
  assert.ok(drums.segments.some((segment) => segment.payload.swingPercent !== 50) || drumHits.some((step) => Number.isFinite(step.leanPercent) && step.leanPercent !== 0), "score drums should retain swing or human microtiming");
}

function assertTimelineCoverage(segments, expectedLength, label) {
  const sorted = [...segments].sort((left, right) => left.startBeat - right.startBeat);
  let cursor = 0;
  for (const segment of sorted) {
    assert.ok(Math.abs(segment.startBeat - cursor) < 0.0001, `${label} should not contain gaps or overlaps`);
    cursor = segment.startBeat + segment.lengthBeats * (segment.repeats + 1);
  }
  assert.ok(Math.abs(cursor - expectedLength) < 0.0001, `${label} should cover the complete score`);
}
