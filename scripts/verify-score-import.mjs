#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { build } from "../frontend/node_modules/esbuild/lib/main.js";
import { strToU8, zipSync } from "../frontend/node_modules/fflate/esm/browser.js";

const repoRoot = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const frontendSchema = read("frontend/src/ipc/schema.ts");
const backendSchema = read("backend/Source/Ipc/Schema.h");
const bridge = read("backend/Source/Ipc/MessageBridge.cpp");
const pdfRenderer = read("backend/Source/Score/PdfPageRenderer.cpp");
const parserSource = read("frontend/src/scoreImport/musicXmlImport.ts");
const action = read("frontend/src/scoreImport/scoreImportAction.ts");
const standards = read("frontend/src/ai/standardsCorpus.ts");
const homrRunner = read("scripts/run-homr-for-beat.py");
const homrSetup = read("scripts/setup-score-recognition.sh");
const homrLock = read("scripts/requirements/score-recognition-macos-py311.lock");

assert(frontendSchema.includes('kind: "score.import"'), "frontend IPC must expose score import");
assert(backendSchema.includes("SCORE_IMPORT"), "native IPC must expose score import");
assert(backendSchema.includes("SCORE_IMPORT_LIBRARY"), "native IPC must expose bulk local standards import");
assert(bridge.includes("findAudiverisLaunch"), "PDF/image score import must use the optional Audiveris adapter");
assert(bridge.includes("findHomrLaunch"), "score import must discover homr as an optional secondary OMR adapter");
assert(bridge.includes('getEnvironmentVariable("BEAT_HOMR"'), "homr discovery must support an explicit executable override");
assert(bridge.includes("runHomr(homr, homrInput"), "pages that remain unreadable after refined Audiveris recovery must fall back to homr");
assert(bridge.includes("refinement.file.existsAsFile() ? refinement.file : rendered.file"), "homr must prefer the same refined page while retaining a raw-render fallback");
assert(bridge.includes('encodedPageScore(homrResult.scoreFile, firstPage, firstPage, "homr")'), "recovered page provenance must identify homr output");
assert(frontendSchema.includes('"audiveris" | "homr" | "hybrid"'), "frontend score provenance must distinguish primary, secondary, and hybrid OCR");
assert(homrRunner.includes("((value - 1) % 16) + 1"), "the homr runner must keep playback-only MIDI channel metadata valid for orchestral scores");
assert(homrSetup.includes("score-recognition-macos-py311.lock"), "homr setup must install the complete reviewed score-recognition lock");
assert(homrLock.includes("homr==0.7.0"), "score-recognition lock must pin the reviewed homr release");
assert(homrLock.includes("opencv-python==4.14.0.94") && homrLock.includes("opencv-python-headless==4.14.0.94"), "score-recognition OpenCV distributions must share the supported build");
assert((statSync(join(repoRoot, "scripts/setup-score-recognition.sh")).mode & 0o111) !== 0, "score-recognition setup script must be executable");
assert(bridge.includes('arguments.add("-Djava.awt.headless=true")'), "the packaged macOS Audiveris app must run through its real headless Java process");
assert(bridge.includes('arguments.add("-transcribe")'), "Audiveris must transcribe before MusicXML export");
assert(bridge.includes('arguments.add("-export")'), "Audiveris must export MusicXML");
assert(bridge.includes("std::thread outputReader"), "Audiveris output must be drained while OCR runs so large logs cannot fill the child-process pipe");
assert(bridge.includes("outputReader.join()"), "the Audiveris output reader must finish before its captured log is consumed");
assert(bridge.includes('findScoreOcrArtifact(directory, "*.omr")'), "successful Audiveris imports must retain their editable OMR project");
assert(!bridge.includes('arguments.add("-save")'), "Audiveris 5.11 must not combine -save with -transcribe because it can abort valid exports");
assert(bridge.includes('getChildFile("Score OCR")'), "OCR projects and logs must live in Beat's managed review library");
assert(backendSchema.includes("SCORE_OPEN_OCR_REVIEW"), "native IPC must open retained Audiveris review projects");
assert(frontendSchema.includes('kind: "score.revealArtifacts"'), "frontend IPC must reveal retained OCR diagnostics");
assert(frontendSchema.includes("pageScores?"), "adaptive PDF recovery must return readable page ranges");
assert(bridge.includes("recoverPdfRange"), "failed whole-book PDFs must bisect into page-range retries");
assert(bridge.includes("renderPdfPageToPng(source, firstPage, renderedPage, 400.0)"), "single failed pages must retry near Audiveris's recommended small-notation resolution");
assert(bridge.includes("refineScorePageForOcr(rendered.file, refinedPage)"), "failed pages must receive interline-aware cropping and contrast normalization");
assert(pdfRenderer.includes("targetInterlinePixels / interline"), "score-page refinement must scale toward measured staff spacing rather than a fixed upscale");
assert(pdfRenderer.includes("projectedStaffLineCenters"), "score-page refinement must estimate staff geometry from the rendered page");
assert(pdfRenderer.includes("CGPDFDocumentGetNumberOfPages"), "macOS PDF recovery must use the native PDF page tree rather than guessed page counts");
assert(action.includes('kind: "drumpad"'), "percussion notation must map to audible drumpad tracks");
assert(action.includes("includedSegmentNotes"), "unresolved OCR measures must be optionally excludable without collapsing the timeline");
assert(action.includes('kind: "score.importLibrary"'), "local standards import must support multi-score selection");
assert(parserSource.includes("usablePartRatio"), "import quality must measure usable part coverage");
assert(parserSource.includes("timingIntegrityRatio"), "import quality must measure timing integrity");
assert(parserSource.includes("repeatCoverageRatio"), "import quality must report preserved repeated material");
assert(!parserSource.includes("noteCount"), "raw MIDI note totals must not be an import success metric");
assert(!standards.includes("noteCount"), "standards profiles must describe musical structure rather than raw note totals");
assert(standards.includes('"user-provided-local"'), "user-owned fakebooks must stay local-only");
assert(standards.includes('entry.referenceStatus !== "needs-review"'), "unreviewed OMR drafts must not drive generation");
assert(standards.includes("noLicenseConflict"), "bundled corpus admission must enforce per-score license conflict metadata");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Verifier Standard</work-title></work>
  <identification><creator type="composer">Beat Test</creator></identification>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part>
    <score-part id="P2"><part-name>Drum Kit</part-name><midi-instrument id="P2-I1"><midi-channel>10</midi-channel><midi-unpitched>36</midi-unpitched></midi-instrument></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction><sound tempo="120"/></direction><harmony><root><root-step>C</root-step></root><kind text="maj7">major-seventh</kind></harmony>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><tie type="start"/><voice>1</voice></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><tie type="stop"/><voice>1</voice></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice></note>
    </measure>
    <measure number="3">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice></note>
    </measure>
    <measure number="4">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><unpitched><display-step>C</display-step><display-octave>2</display-octave></unpitched><duration>16</duration></note></measure>
    <measure number="2"><note><unpitched><display-step>C</display-step><display-octave>2</display-octave></unpitched><duration>16</duration></note></measure>
    <measure number="3"><note><unpitched><display-step>C</display-step><display-octave>2</display-octave></unpitched><duration>16</duration></note></measure>
    <measure number="4"><note><unpitched><display-step>C</display-step><display-octave>2</display-octave></unpitched><duration>16</duration></note></measure>
  </part>
</score-partwise>`;

const compiled = await build({
  stdin: {
    resolveDir: join(repoRoot, "frontend/src"),
    sourcefile: "score-check.ts",
    loader: "ts",
    contents: `
      export { parseAndMergeMusicXmlPages, parseMusicXmlSource } from "./scoreImport/musicXmlImport.ts";
      export { createStandardGenerationProfile, mayBundleStandard } from "./ai/standardsCorpus.ts";
    `,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const encoded = Buffer.from(compiled.outputFiles[0].text).toString("base64");
const { parseAndMergeMusicXmlPages, parseMusicXmlSource, createStandardGenerationProfile, mayBundleStandard } = await import(`data:text/javascript;base64,${encoded}`);

const direct = parseMusicXmlSource({ name: "standard.musicxml", bytes: strToU8(xml) });
assert.equal(direct.title, "Verifier Standard");
assert.equal(direct.composer, "Beat Test");
assert.equal(direct.bpm, 120);
assert.equal(direct.parts.length, 2);
assert.equal(direct.parts[1].percussion, true);
assert.equal(direct.quality.status, "ready");
assert.equal(direct.quality.totalMeasureCount, 8);
assert.equal(direct.quality.verifiedMeasureCount, 8);
assert.equal(direct.quality.reviewMeasureCount, 0);
assert.ok(direct.quality.repeatCoverageRatio > 0, "exact repeated measures should become loop coverage");
assert.ok(direct.parts.some((part) => part.segments.some((segment) => segment.repeats > 0)), "repeated score blocks should become nondestructive loops");
const tiedC = direct.parts[0].measures[0].notes.find((note) => note.pitch === 60);
assert.equal(tiedC.lengthBeats, 6, "tied notes across measures should remain one sustained note");
const profile = createStandardGenerationProfile(direct, { sourceName: "standard.musicxml", license: "user-provided-local" }, ["all"]);
assert.equal(profile.localOnly, true);
assert.equal(profile.referenceStatus, "verified");
assert.deepEqual(profile.generationUses, ["all"]);
assert.ok(profile.referenceMaterial?.leadMelody.length, "local references must retain the recognized lead line");
assert.deepEqual(profile.referenceMaterial?.chordProgression, [{ beat: 0, symbol: "Cmaj7" }], "local references must retain beat-aligned chord symbols");
assert.deepEqual(profile.chordVocabulary, ["rootmaj7"]);
assert.ok(profile.phraseLengthsBeats.length > 0);
assert.equal(mayBundleStandard(profile.source), false, "user-owned local charts must never enter the bundled catalog");
assert.equal(mayBundleStandard({ sourceName: "pd.mxl", sourceUrl: "https://example.test/pd", license: "Public Domain", noLicenseConflict: true }), true);
assert.equal(mayBundleStandard({ sourceName: "conflict.mxl", sourceUrl: "https://example.test/conflict", license: "CC0-1.0", noLicenseConflict: false }), false);

const mxl = zipSync({
  "META-INF/container.xml": strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'),
  "score.musicxml": strToU8(xml),
});
const compressed = parseMusicXmlSource({ name: "standard.mxl", bytes: mxl });
assert.equal(compressed.title, direct.title, "MXL and MusicXML must parse to the same score identity");
assert.deepEqual(compressed.parts.map((part) => part.percussion), direct.parts.map((part) => part.percussion));

const splitAttributesTempoXml = `<?xml version="1.0"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
  <measure number="1">
    <attributes><divisions>8</divisions><staves>2</staves></attributes>
    <attributes><key><fifths>4</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <direction><direction-type><metronome><beat-unit>eighth</beat-unit><per-minute>144</per-minute></metronome></direction-type></direction>
    <note><pitch><step>D</step><alter>1</alter><octave>5</octave></pitch><duration>8</duration></note>
  </measure>
</part></score-partwise>`;
const splitAttributesTempo = parseMusicXmlSource({ name: "split-attributes.musicxml", bytes: strToU8(splitAttributesTempoXml) });
assert.deepEqual(splitAttributesTempo.timeSignature, { numerator: 4, denominator: 4 }, "all attributes blocks in a measure must be read");
assert.equal(splitAttributesTempo.bpm, 72, "eighth-note metronome marks must convert to quarter-note BPM");
assert.equal(splitAttributesTempo.keySignatureFifths, 4, "the key signature must remain available to harmony-aware accompaniment generation");
assert.equal(splitAttributesTempo.parts[0].measures[0].notes[0].pitch, 75, "explicit sharp pitches must survive split attributes");

const pickupRepeatXml = `<?xml version="1.0"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Bb Clarinet</part-name></score-part></part-list><part id="P1">
  <measure number="0" implicit="yes"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><transpose><chromatic>-2</chromatic></transpose></attributes><barline location="left"><repeat direction="forward"/></barline><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure>
  <measure number="1"><note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration></note><barline location="right"><repeat direction="backward" times="3"/></barline></measure>
</part></score-partwise>`;
const pickupRepeat = parseMusicXmlSource({ name: "pickup.musicxml", bytes: strToU8(pickupRepeatXml) });
assert.equal(pickupRepeat.parts[0].measures[0].lengthBeats, 1, "implicit pickup measures must retain their observed duration");
assert.equal(pickupRepeat.parts[0].measures[0].notes[0].pitch, 58, "transposing instruments must import at sounding pitch");
assert.equal(pickupRepeat.parts[0].segments[0].repeats, 2, "explicit three-play repeat barlines must become a nondestructive loop");
assert.ok(pickupRepeat.quality.repeatCoverageRatio <= 1, "repeat coverage must remain a bounded structural ratio");

const timingReviewXml = `<?xml version="1.0"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Review Piano</part-name></score-part></part-list><part id="P1">
  <measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>B</step><octave>3</octave></pitch><duration>16</duration></note></measure>
  <measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration></note></measure>
  <measure number="3"><print new-page="yes" page-number="2"/><note><pitch><step>D</step><octave>4</octave></pitch><duration>20</duration></note></measure>
  <measure number="4"><backup><duration>4</duration></backup><note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration></note></measure>
</part></score-partwise>`;
const timingReview = parseMusicXmlSource({ name: "timing-review.musicxml", bytes: strToU8(timingReviewXml) });
assert.equal(timingReview.parts[0].measures[1].timingStatus, "repaired", "short explicit measures should be padded with silence only");
assert.equal(timingReview.parts[0].measures[1].issues[0].code, "trailing-silence-padded");
assert.equal(timingReview.parts[0].measures[1].notes.length, 1, "timing repair must not invent MIDI notes");
assert.equal(timingReview.parts[0].measures[2].timingStatus, "review", "overfull measures must remain unresolved");
assert.equal(timingReview.parts[0].measures[2].lengthBeats, 4, "an overfull OCR measure must not shift every following measure");
assert.equal(timingReview.parts[0].measures[2].observedLengthBeats, 5);
assert.equal(timingReview.parts[0].measures[2].pageNumber, 2, "MusicXML page boundaries must reach the review UI");
assert.ok(timingReview.parts[0].measures[3].issues.some((issue) => issue.code === "cursor-underflow"));
assert.equal(timingReview.quality.repairedMeasureCount, 1);
assert.equal(timingReview.quality.reviewMeasureCount, 2);
assert.equal(timingReview.quality.status, "review");

const recovered = parseAndMergeMusicXmlPages([
  { source: { name: "recovered-2.mxl", bytes: mxl }, firstPage: 2, lastPage: 2 },
  { source: { name: "recovered-4.mxl", bytes: mxl }, firstPage: 4, lastPage: 4 },
]);
assert.equal(recovered.lengthBeats, direct.lengthBeats * 2, "recovered page ranges must remain sequential");
assert.equal(recovered.parts.length, direct.parts.length, "page-range parts must merge by orchestral staff order");
assert.ok(recovered.parts[0].measures.some((measure) => measure.pageNumber === 2));
assert.ok(recovered.parts[0].measures.some((measure) => measure.pageNumber === 4));
assert.ok(recovered.parts[0].measures[4].startBeat >= direct.lengthBeats, "later page ranges must retain their score offset");
assert.match(recovered.warnings[0], /recovered readable page ranges independently/);

const smokeXmlPath = process.env.BEAT_SCORE_IMPORT_SMOKE_XML;
if (smokeXmlPath) {
  const smoke = parseMusicXmlSource({ name: smokeXmlPath.split("/").at(-1) || "smoke.musicxml", bytes: readFileSync(smokeXmlPath) });
  assert.ok(smoke.parts.length > 0, "external OMR smoke output must contain at least one score part");
  assert.ok(smoke.quality.totalMeasureCount > 0, "external OMR smoke output must contain measurable notation");
  console.log(`External OMR smoke parsed: ${smoke.parts.length} parts, ${smoke.quality.totalMeasureCount} measures, ${smoke.quality.reviewMeasureCount} unresolved.`);
}

console.log("Score import verification passed: MusicXML/MXL parsing, Audiveris primary OCR, homr secondary OCR, hybrid provenance, pickups, transposition, ties, percussion mapping, concurrent log draining, retained OCR review artifacts, conservative timing repair, page-range bisection, 400 DPI interline-aware refinement, recovered-page merging, unresolved-measure isolation, loop preservation, and structural quality metrics are present.");
