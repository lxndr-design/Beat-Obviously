import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import type { MidiNote } from "../state/types";

type OrderedXmlNode = Record<string, unknown>;

export interface ImportedScoreMeasure {
  number: string;
  pageNumber: number;
  startBeat: number;
  lengthBeats: number;
  expectedLengthBeats: number;
  observedLengthBeats: number;
  timingStatus: "ready" | "repaired" | "review";
  issues: ScoreMeasureIssue[];
  notes: MidiNote[];
  harmony: ImportedHarmonyEvent[];
  fingerprint: string;
  repeatStart: boolean;
  repeatEndTimes?: number;
}

export interface ScoreMeasureIssue {
  code: "cursor-underflow" | "invalid-event-duration" | "missing-note-duration" | "orphan-chord" | "orphan-tie-stop" | "dangling-tie" | "invalid-tuplet" | "measure-overflow" | "trailing-silence-padded" | "unmapped-pitch";
  severity: "repair" | "review";
  message: string;
}

export interface ImportedHarmonyEvent {
  beat: number;
  symbol: string;
}

export interface ImportedScoreSegment {
  name: string;
  startBeat: number;
  lengthBeats: number;
  repeats: number;
  notes: MidiNote[];
  measureNumbers: string[];
}

export interface ImportedScorePart {
  id: string;
  name: string;
  abbreviation?: string;
  midiProgram?: number;
  percussion: boolean;
  measures: ImportedScoreMeasure[];
  segments: ImportedScoreSegment[];
  pitchRange?: [number, number];
  warningCodes: string[];
}

export interface ScoreImportQuality {
  usablePartRatio: number;
  timingIntegrityRatio: number;
  playablePartRatio: number;
  repeatCoverageRatio: number;
  totalMeasureCount: number;
  verifiedMeasureCount: number;
  repairedMeasureCount: number;
  reviewMeasureCount: number;
  status: "ready" | "review" | "unusable";
}

export interface ImportedScorePlan {
  sourceName: string;
  title: string;
  composer?: string;
  bpm?: number;
  /** Circle-of-fifths key signature: positive values are sharps, negative values are flats. */
  keySignatureFifths?: number;
  timeSignature: { numerator: number; denominator: number };
  lengthBeats: number;
  parts: ImportedScorePart[];
  warnings: string[];
  quality: ScoreImportQuality;
}

export interface ScoreSource {
  name: string;
  bytes: Uint8Array;
}

export interface ScorePageSource {
  source: ScoreSource;
  firstPage: number;
  lastPage: number;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  trimValues: true,
});

const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export function parseMusicXmlSource(source: ScoreSource): ImportedScorePlan {
  const xml = decodeScoreXml(source);
  const root = parser.parse(xml) as OrderedXmlNode[];
  const score = namedChildren(root, "score-partwise")[0];
  if (!score) throw new Error("Beat currently imports MusicXML score-partwise files. Convert score-timewise files before importing.");

  const scoreChildren = childNodes(score);
  const partDefinitions = parsePartDefinitions(scoreChildren);
  const title = readFirstText(scoreChildren, ["work", "work-title"])
    || directText(firstNamed(scoreChildren, "movement-title"))
    || stripScoreExtension(source.name);
  const composer = readCreator(scoreChildren, "composer");
  const warnings: string[] = [];
  let detectedBpm: number | undefined;
  let detectedKeySignatureFifths: number | undefined;
  let detectedTimeSignature = { numerator: 4, denominator: 4 };

  const parts = namedChildren(scoreChildren, "part").map((partNode, partIndex): ImportedScorePart => {
    const id = attribute(partNode, "id") || `P${partIndex + 1}`;
    const definition = partDefinitions.get(id);
    const name = definition?.name || `Part ${partIndex + 1}`;
    const warningCodes: string[] = [];
    const measures: ImportedScoreMeasure[] = [];
    const tieStarts = new Map<string, MidiNote>();
    let divisions = 1;
    let transposeChromatic = 0;
    let timeSignature = detectedTimeSignature;
    let measureStart = 0;
    let sawUnpitched = false;
    let pageNumber = 1;

    for (const measureNode of namedChildren(childNodes(partNode), "measure")) {
      const measureChildren = childNodes(measureNode);
      const printNode = firstNamed(measureChildren, "print");
      if (printNode && attribute(printNode, "new-page") === "yes" && measures.length > 0) pageNumber += 1;
      const printedPageNumber = Number(attribute(printNode, "page-number"));
      if (Number.isFinite(printedPageNumber) && printedPageNumber > 0) pageNumber = Math.round(printedPageNumber);
      for (const attributesNode of namedChildren(measureChildren, "attributes")) {
        const attributesChildren = childNodes(attributesNode);
        const nextDivisions = numberText(firstNamed(attributesChildren, "divisions"));
        if (nextDivisions && nextDivisions > 0) divisions = nextDivisions;
        const timeNode = firstNamed(attributesChildren, "time");
        if (timeNode) {
          const timeChildren = childNodes(timeNode);
          const numerator = numberText(firstNamed(timeChildren, "beats"));
          const denominator = numberText(firstNamed(timeChildren, "beat-type"));
          if (numerator && denominator) {
            timeSignature = { numerator, denominator };
            if (measures.length === 0 && partIndex === 0) detectedTimeSignature = timeSignature;
          }
        }
        const keyNode = firstNamed(attributesChildren, "key");
        const fifths = keyNode ? numberText(firstNamed(childNodes(keyNode), "fifths")) : Number.NaN;
        if (Number.isFinite(fifths) && detectedKeySignatureFifths == null) detectedKeySignatureFifths = fifths;
        const transposeNode = firstNamed(attributesChildren, "transpose");
        if (transposeNode) transposeChromatic = numberText(firstNamed(childNodes(transposeNode), "chromatic"));
      }

      const tempo = findTempo(measureChildren);
      if (tempo && detectedBpm == null) detectedBpm = tempo;

      const expectedMeasureLength = timeSignature.numerator * (4 / timeSignature.denominator);
      const measureNumber = attribute(measureNode, "number") || String(measures.length + 1);
      const notes: MidiNote[] = [];
      const harmony: ImportedHarmonyEvent[] = [];
      const issues: ScoreMeasureIssue[] = [];
      let cursor = measureStart;
      let furthestCursor = measureStart;
      let previousNoteStart = measureStart;
      let hasPreviousTimedNote = false;

      for (const event of measureChildren) {
        const eventName = nodeName(event);
        if (eventName === "harmony") {
          const symbol = parseHarmony(event);
          if (symbol) harmony.push({ beat: roundBeat(cursor - measureStart), symbol });
          continue;
        }
        if (eventName === "backup" || eventName === "forward") {
          const duration = numberText(firstNamed(childNodes(event), "duration")) / divisions;
          if (!(duration > 0)) {
            issues.push({ code: "invalid-event-duration", severity: "review", message: `${eventName} has no usable duration.` });
            continue;
          }
          if (eventName === "backup" && cursor - duration < measureStart - 0.000001)
            issues.push({ code: "cursor-underflow", severity: "review", message: "A voice backup moves before the beginning of the measure." });
          cursor += eventName === "backup" ? -duration : duration;
          continue;
        }
        if (eventName !== "note") continue;

        const noteChildren = childNodes(event);
        const durationUnits = numberText(firstNamed(noteChildren, "duration"));
        const isGrace = Boolean(firstNamed(noteChildren, "grace"));
        const duration = durationUnits > 0 ? durationUnits / divisions : isGrace ? 0.0625 : 0;
        const isChord = Boolean(firstNamed(noteChildren, "chord"));
        if (!isGrace && duration <= 0)
          issues.push({ code: "missing-note-duration", severity: "review", message: "A sounded note or rest has no usable duration." });
        if (isChord && !hasPreviousTimedNote)
          issues.push({ code: "orphan-chord", severity: "review", message: "A chord member has no preceding onset to attach to." });
        const timeModification = firstNamed(noteChildren, "time-modification");
        if (timeModification) {
          const timeChildren = childNodes(timeModification);
          const actual = numberText(firstNamed(timeChildren, "actual-notes"));
          const normal = numberText(firstNamed(timeChildren, "normal-notes"));
          if (!(actual > 0 && normal > 0))
            issues.push({ code: "invalid-tuplet", severity: "review", message: "A tuplet is missing its actual-to-normal note ratio." });
        }
        const noteStart = isChord ? previousNoteStart : cursor;
        if (!isChord) previousNoteStart = noteStart;
        if (!isChord) {
          cursor += duration;
          hasPreviousTimedNote = true;
        }
        furthestCursor = Math.max(furthestCursor, noteStart + duration, cursor);
        if (firstNamed(noteChildren, "rest")) continue;

        const pitchNode = firstNamed(noteChildren, "pitch");
        const unpitchedNode = firstNamed(noteChildren, "unpitched");
        if (unpitchedNode) sawUnpitched = true;
        const writtenPitch = parsePitch(pitchNode ?? unpitchedNode);
        const pitch = writtenPitch == null ? undefined : writtenPitch + (unpitchedNode ? 0 : transposeChromatic);
        if (pitch == null || pitch < 0 || pitch > 127 || duration <= 0) {
          if (pitch == null) {
            warningCodes.push("unmapped-pitch");
            issues.push({ code: "unmapped-pitch", severity: "review", message: "A note could not be assigned a playable pitch." });
          }
          continue;
        }
        const voice = directText(firstNamed(noteChildren, "voice")) || "1";
        const staff = directText(firstNamed(noteChildren, "staff")) || "1";
        const tieTypes = namedChildren(noteChildren, "tie").map((tie) => attribute(tie, "type"));
        const tieKey = `${pitch}:${voice}:${staff}`;
        const existingTie = tieStarts.get(tieKey);
        if (existingTie && tieTypes.includes("stop")) {
          existingTie.lengthBeats = roundBeat(Math.max(existingTie.lengthBeats, noteStart + duration - existingTie.startBeat));
          if (!tieTypes.includes("start")) tieStarts.delete(tieKey);
          continue;
        }
        if (!existingTie && tieTypes.includes("stop"))
          issues.push({ code: "orphan-tie-stop", severity: "review", message: `A tie ending on MIDI pitch ${pitch} has no matching start.` });

        const velocity = parseVelocity(noteChildren);
        const imported: MidiNote = {
          pitch,
          velocity,
          startBeat: roundBeat(noteStart),
          lengthBeats: roundBeat(Math.max(0.015625, duration)),
        };
        notes.push(imported);
        if (tieTypes.includes("start")) tieStarts.set(tieKey, imported);
      }

      const observedLength = Math.max(0, furthestCursor - measureStart);
      const pickupOrImplicit = attribute(measureNode, "implicit") === "yes"
        || (measures.length === 0 && observedLength > 0 && observedLength < expectedMeasureLength);
      const timingTolerance = Math.max(0.015625, 1 / Math.max(1, divisions));
      const measureLength = pickupOrImplicit && observedLength > 0 ? observedLength : expectedMeasureLength;
      if (!pickupOrImplicit && observedLength > expectedMeasureLength + timingTolerance) {
        warningCodes.push("measure-overflow");
        issues.push({ code: "measure-overflow", severity: "review", message: `Voices occupy ${roundBeat(observedLength)} beats in a ${roundBeat(expectedMeasureLength)}-beat measure.` });
      } else if (!pickupOrImplicit && observedLength > 0 && observedLength < expectedMeasureLength - timingTolerance) {
        warningCodes.push("trailing-silence-padded");
        issues.push({ code: "trailing-silence-padded", severity: "repair", message: `Added ${roundBeat(expectedMeasureLength - observedLength)} beats of trailing silence; no notes were invented.` });
      }
      const timingStatus = issues.some((issue) => issue.severity === "review")
        ? "review"
        : issues.some((issue) => issue.severity === "repair") ? "repaired" : "ready";
      const localNotes = notes.map((note) => ({ ...note, startBeat: roundBeat(note.startBeat - measureStart) }));
      const repeat = parseMeasureRepeat(measureChildren);
      measures.push({
        number: measureNumber,
        pageNumber,
        startBeat: roundBeat(measureStart),
        lengthBeats: roundBeat(measureLength),
        expectedLengthBeats: roundBeat(expectedMeasureLength),
        observedLengthBeats: roundBeat(observedLength),
        timingStatus,
        issues,
        notes,
        harmony,
        fingerprint: fingerprintMeasure(localNotes, harmony, measureLength),
        repeatStart: repeat.start,
        repeatEndTimes: repeat.endTimes,
      });
      measureStart = roundBeat(measureStart + measureLength);
    }

    if (tieStarts.size > 0 && measures.length > 0) {
      const lastMeasure = measures[measures.length - 1];
      lastMeasure.issues.push({ code: "dangling-tie", severity: "review", message: `${tieStarts.size} tie ${tieStarts.size === 1 ? "start has" : "starts have"} no matching ending.` });
      lastMeasure.timingStatus = "review";
      warningCodes.push("dangling-tie");
    }

    const allNotes = measures.flatMap((measure) => measure.notes);
    if (allNotes.length === 0) warningCodes.push("empty-part");
    const pitches = allNotes.map((note) => note.pitch);
    const percussion = Boolean(definition?.percussion || sawUnpitched || /drum|percussion|kit/i.test(name));
    return {
      id,
      name,
      abbreviation: definition?.abbreviation,
      midiProgram: definition?.midiProgram,
      percussion,
      measures,
      segments: buildSegmentsFromMeasures(name, measures),
      pitchRange: pitches.length > 0 ? [Math.min(...pitches), Math.max(...pitches)] : undefined,
      warningCodes: [...new Set(warningCodes)],
    };
  });

  const lengthBeats = Math.max(0, ...parts.map((part) => part.measures.reduce((sum, measure) => sum + measure.lengthBeats, 0)));
  const quality = calculateScoreQuality(parts);
  warnings.push(...collectScoreWarnings(parts));
  if (parts.length === 0) warnings.push("The score does not contain any parts.");

  return {
    sourceName: source.name,
    title,
    composer,
    bpm: detectedBpm,
    keySignatureFifths: detectedKeySignatureFifths,
    timeSignature: detectedTimeSignature,
    lengthBeats,
    parts,
    warnings: [...new Set(warnings)],
    quality,
  };
}

export function parseAndMergeMusicXmlPages(pages: ScorePageSource[]): ImportedScorePlan {
  if (pages.length === 0) throw new Error("Adaptive score recovery did not produce any readable pages.");
  const ordered = [...pages].sort((left, right) => left.firstPage - right.firstPage);
  const plans = ordered.map((page) => ({ page, plan: parseMusicXmlSource(page.source) }));
  if (plans.length === 1) {
    const only = plans[0];
    only.plan.parts.forEach((part) => part.measures.forEach((measure) => {
      measure.pageNumber = mappedRecoveredPage(measure.pageNumber, only.page.firstPage, only.page.lastPage);
    }));
    return only.plan;
  }

  const parts: ImportedScorePart[] = [];
  let scoreCursor = 0;
  for (const { page, plan } of plans) {
    plan.parts.forEach((sourcePart, partIndex) => {
      let target = parts[partIndex];
      if (!target) {
        target = {
          ...sourcePart,
          measures: [],
          segments: [],
          warningCodes: [],
          pitchRange: undefined,
        };
        parts[partIndex] = target;
      } else if (partNameQuality(sourcePart.name) > partNameQuality(target.name)) {
        target.name = sourcePart.name;
        target.abbreviation = sourcePart.abbreviation;
      }
      target.percussion ||= sourcePart.percussion;
      target.midiProgram ??= sourcePart.midiProgram;
      target.warningCodes.push(...sourcePart.warningCodes);
      target.measures.push(...sourcePart.measures.map((measure) => ({
        ...measure,
        pageNumber: mappedRecoveredPage(measure.pageNumber, page.firstPage, page.lastPage),
        startBeat: roundBeat(measure.startBeat + scoreCursor),
        notes: measure.notes.map((note) => ({ ...note, startBeat: roundBeat(note.startBeat + scoreCursor) })),
        issues: measure.issues.map((issue) => ({ ...issue })),
        harmony: measure.harmony.map((event) => ({ ...event })),
      })));
    });
    scoreCursor = roundBeat(scoreCursor + plan.lengthBeats);
  }

  for (const part of parts.filter(Boolean)) {
    part.warningCodes = [...new Set(part.warningCodes)];
    part.segments = buildSegmentsFromMeasures(part.name, part.measures);
    const pitches = part.measures.flatMap((measure) => measure.notes.map((note) => note.pitch));
    part.pitchRange = pitches.length > 0 ? [Math.min(...pitches), Math.max(...pitches)] : undefined;
  }
  const compactParts = parts.filter(Boolean);
  const first = plans[0].plan;
  return {
    sourceName: ordered.map((page) => page.source.name).join(", "),
    title: first.title,
    composer: first.composer,
    bpm: plans.map(({ plan }) => plan.bpm).find((value) => value != null),
    keySignatureFifths: plans.map(({ plan }) => plan.keySignatureFifths).find((value) => value != null),
    timeSignature: first.timeSignature,
    lengthBeats: scoreCursor,
    parts: compactParts,
    warnings: [...new Set([
      "Whole-score OCR failed; Beat recovered readable page ranges independently. Cross-page ties and part names require review.",
      ...collectScoreWarnings(compactParts),
    ])],
    quality: calculateScoreQuality(compactParts),
  };
}

function calculateScoreQuality(parts: ImportedScorePart[]): ScoreImportQuality {
  const usableParts = parts.filter((part) => part.pitchRange != null);
  const allMeasures = parts.flatMap((part) => part.measures);
  const verifiedMeasures = allMeasures.filter((measure) => measure.timingStatus === "ready");
  const repairedMeasures = allMeasures.filter((measure) => measure.timingStatus === "repaired");
  const reviewMeasures = allMeasures.filter((measure) => measure.timingStatus === "review");
  const playableParts = usableParts.filter((part) => part.percussion || part.pitchRange!.every((pitch) => pitch >= 0 && pitch <= 127));
  const repeatedBeats = parts.reduce((sum, part) => sum + part.segments.reduce((partSum, segment) => partSum + (segment.repeats > 0 ? segment.lengthBeats : 0), 0), 0);
  const totalPartBeats = parts.reduce((sum, part) => sum + part.measures.reduce((partSum, measure) => partSum + measure.lengthBeats, 0), 0);
  const quality: ScoreImportQuality = {
    usablePartRatio: ratio(usableParts.length, parts.length),
    timingIntegrityRatio: ratio(verifiedMeasures.length + repairedMeasures.length, allMeasures.length),
    playablePartRatio: ratio(playableParts.length, parts.length),
    repeatCoverageRatio: ratio(repeatedBeats, totalPartBeats),
    totalMeasureCount: allMeasures.length,
    verifiedMeasureCount: verifiedMeasures.length,
    repairedMeasureCount: repairedMeasures.length,
    reviewMeasureCount: reviewMeasures.length,
    status: usableParts.length === 0 ? "unusable" : reviewMeasures.length > 0 || playableParts.length < usableParts.length ? "review" : "ready",
  };
  return quality;
}

function collectScoreWarnings(parts: ImportedScorePart[]) {
  const warnings: string[] = [];
  for (const part of parts) {
    if (part.warningCodes.includes("empty-part")) warnings.push(`${part.name} has no playable notes and will be omitted.`);
    if (part.warningCodes.includes("measure-overflow")) warnings.push(`${part.name} contains measures whose voices exceed the notated meter; review alignment after import.`);
    if (part.warningCodes.includes("trailing-silence-padded")) warnings.push(`${part.name} contains short measures padded with silence; no notes were generated.`);
    if (part.warningCodes.includes("dangling-tie")) warnings.push(`${part.name} contains tie starts without matching endings.`);
    if (part.warningCodes.includes("unmapped-pitch")) warnings.push(`${part.name} contains notes without a readable pitch.`);
  }
  return warnings;
}

function mappedRecoveredPage(value: number, firstPage: number, lastPage: number) {
  if (value >= firstPage && value <= lastPage) return value;
  return Math.min(lastPage, firstPage + Math.max(0, value - 1));
}

function partNameQuality(name: string) {
  const trimmed = name.trim();
  if (!trimmed || /^voice$|^part\s+\d+$|^\d+$/i.test(trimmed)) return 0;
  if (/^[\W_]+$/.test(trimmed)) return 0;
  return Math.min(10, trimmed.replace(/[^A-Za-z]/g, "").length);
}

function decodeScoreXml(source: ScoreSource): string {
  const zipped = source.name.toLowerCase().endsWith(".mxl") || (source.bytes[0] === 0x50 && source.bytes[1] === 0x4b);
  if (!zipped) return strFromU8(source.bytes);
  const files = unzipSync(source.bytes);
  let rootPath: string | undefined;
  const container = files["META-INF/container.xml"];
  if (container) {
    const containerRoot = parser.parse(strFromU8(container)) as OrderedXmlNode[];
    const containerNode = namedChildren(containerRoot, "container")[0];
    const rootfiles = containerNode ? namedChildren(childNodes(firstNamed(childNodes(containerNode), "rootfiles")), "rootfile") : [];
    rootPath = rootfiles.map((node) => attribute(node, "full-path")).find(Boolean);
  }
  rootPath ||= Object.keys(files).find((name) => /\.(musicxml|xml)$/i.test(name) && !name.startsWith("META-INF/"));
  if (!rootPath || !files[rootPath]) throw new Error("This MXL archive does not contain a MusicXML score.");
  return strFromU8(files[rootPath]);
}

function parsePartDefinitions(nodes: OrderedXmlNode[]) {
  const definitions = new Map<string, { name: string; abbreviation?: string; midiProgram?: number; percussion: boolean }>();
  const partList = firstNamed(nodes, "part-list");
  if (!partList) return definitions;
  for (const part of namedChildren(childNodes(partList), "score-part")) {
    const children = childNodes(part);
    const id = attribute(part, "id");
    if (!id) continue;
    const midiInstrument = firstNamed(children, "midi-instrument");
    const midiChildren = midiInstrument ? childNodes(midiInstrument) : [];
    const channel = numberText(firstNamed(midiChildren, "midi-channel"));
    definitions.set(id, {
      name: directText(firstNamed(children, "part-name")) || id,
      abbreviation: directText(firstNamed(children, "part-abbreviation")) || undefined,
      midiProgram: numberText(firstNamed(midiChildren, "midi-program")) || undefined,
      percussion: channel === 10 || Boolean(firstNamed(midiChildren, "midi-unpitched")),
    });
  }
  return definitions;
}

function buildSegmentsFromMeasures(partName: string, measures: ImportedScoreMeasure[]): ImportedScoreSegment[] {
  const segments: ImportedScoreSegment[] = [];
  const explicitRepeats = explicitRepeatRanges(measures);
  let uniqueStart = 0;

  function flushUnique(end: number) {
    if (end <= uniqueStart) return;
    const range = measures.slice(uniqueStart, end);
    segments.push(segmentFromMeasureRange(partName, range, 0));
  }

  for (let index = 0; index < measures.length;) {
    const explicit = explicitRepeats.get(index);
    if (explicit) {
      flushUnique(index);
      segments.push(segmentFromMeasureRange(partName, measures.slice(index, explicit.end + 1), explicit.plays - 1));
      index = explicit.end + 1;
      uniqueStart = index;
      continue;
    }
    const repeated = bestRepeatAt(measures, index);
    if (!repeated) {
      index += 1;
      continue;
    }
    flushUnique(index);
    const range = measures.slice(index, index + repeated.blockLength);
    segments.push(segmentFromMeasureRange(partName, range, repeated.plays - 1));
    index += repeated.blockLength * repeated.plays;
    uniqueStart = index;
  }
  flushUnique(measures.length);
  return segments.filter((segment) => segment.notes.length > 0);
}

function explicitRepeatRanges(measures: ImportedScoreMeasure[]) {
  const ranges = new Map<number, { end: number; plays: number }>();
  let start = 0;
  measures.forEach((measure, index) => {
    if (measure.repeatStart) start = index;
    if (measure.repeatEndTimes) {
      ranges.set(start, { end: index, plays: Math.max(2, measure.repeatEndTimes) });
      start = index + 1;
    }
  });
  return ranges;
}

function parseMeasureRepeat(nodes: OrderedXmlNode[]) {
  let start = false;
  let endTimes: number | undefined;
  for (const barline of namedChildren(nodes, "barline")) {
    const repeat = firstNamed(childNodes(barline), "repeat");
    if (!repeat) continue;
    const direction = attribute(repeat, "direction");
    if (direction === "forward") start = true;
    if (direction === "backward") {
      const times = Number(attribute(repeat, "times"));
      endTimes = Number.isFinite(times) && times >= 2 ? Math.round(times) : 2;
    }
  }
  return { start, endTimes };
}

function bestRepeatAt(measures: ImportedScoreMeasure[], start: number) {
  let best: { blockLength: number; plays: number; covered: number } | undefined;
  const maxBlock = Math.min(8, Math.floor((measures.length - start) / 2));
  for (let blockLength = 1; blockLength <= maxBlock; blockLength += 1) {
    let plays = 1;
    while (start + (plays + 1) * blockLength <= measures.length) {
      const left = measures.slice(start, start + blockLength).map((measure) => measure.fingerprint);
      const right = measures.slice(start + plays * blockLength, start + (plays + 1) * blockLength).map((measure) => measure.fingerprint);
      if (left.some((fingerprint, index) => fingerprint !== right[index])) break;
      plays += 1;
    }
    if (plays < 2) continue;
    const covered = blockLength * plays;
    if (!best || covered > best.covered || (covered === best.covered && blockLength < best.blockLength))
      best = { blockLength, plays, covered };
  }
  return best;
}

function segmentFromMeasureRange(partName: string, measures: ImportedScoreMeasure[], repeats: number): ImportedScoreSegment {
  const startBeat = measures[0]?.startBeat ?? 0;
  const lastMeasure = measures[measures.length - 1];
  const lengthBeats = lastMeasure ? lastMeasure.startBeat + lastMeasure.lengthBeats - startBeat : 0;
  return {
    name: repeats > 0 ? `${partName} · loop` : `${partName} · score`,
    startBeat,
    lengthBeats: roundBeat(lengthBeats),
    repeats,
    notes: measures.flatMap((measure) => measure.notes).map((note) => ({ ...note, startBeat: roundBeat(note.startBeat - startBeat) })),
    measureNumbers: measures.map((measure) => measure.number),
  };
}

function fingerprintMeasure(notes: MidiNote[], harmony: ImportedHarmonyEvent[], lengthBeats: number) {
  return `${roundBeat(lengthBeats)}|${notes
    .map((note) => `${roundBeat(note.startBeat)}:${note.pitch}:${roundBeat(note.lengthBeats)}:${Math.round(note.velocity / 8)}`)
    .sort()
    .join("|")}|${harmony.map((event) => `${event.beat}:${event.symbol}`).join("|")}`;
}

function parseHarmony(node: OrderedXmlNode) {
  const children = childNodes(node);
  const root = firstNamed(children, "root");
  const rootChildren = childNodes(root);
  const step = directText(firstNamed(rootChildren, "root-step"));
  if (!step) return "";
  const alter = numberText(firstNamed(rootChildren, "root-alter"));
  const accidental = alter === 1 ? "#" : alter === -1 ? "b" : "";
  const kindNode = firstNamed(children, "kind");
  const kindText = attribute(kindNode, "text") || directText(kindNode);
  const bass = firstNamed(children, "bass");
  const bassChildren = childNodes(bass);
  const bassStep = directText(firstNamed(bassChildren, "bass-step"));
  const bassAlter = numberText(firstNamed(bassChildren, "bass-alter"));
  const bassAccidental = bassAlter === 1 ? "#" : bassAlter === -1 ? "b" : "";
  return `${step}${accidental}${kindText && kindText !== "major" ? kindText : ""}${bassStep ? `/${bassStep}${bassAccidental}` : ""}`;
}

function findTempo(nodes: OrderedXmlNode[]): number | undefined {
  for (const direction of namedChildren(nodes, "direction")) {
    const sound = firstNamed(childNodes(direction), "sound");
    const tempo = sound ? Number(attribute(sound, "tempo")) : 0;
    if (Number.isFinite(tempo) && tempo > 0) return tempo;
    const directionType = firstNamed(childNodes(direction), "direction-type");
    const metronome = directionType ? firstNamed(childNodes(directionType), "metronome") : undefined;
    const metronomeChildren = childNodes(metronome);
    const perMinute = metronome ? numberText(firstNamed(metronomeChildren, "per-minute")) : 0;
    if (perMinute > 0) {
      const beatUnit = directText(firstNamed(metronomeChildren, "beat-unit")).toLowerCase();
      const quarterLength = METRONOME_UNIT_QUARTERS[beatUnit] ?? 1;
      const dots = namedChildren(metronomeChildren, "beat-unit-dot").length;
      let dottedMultiplier = 1;
      let addition = 0.5;
      for (let index = 0; index < dots; index += 1) {
        dottedMultiplier += addition;
        addition /= 2;
      }
      return perMinute * quarterLength * dottedMultiplier;
    }
  }
  return undefined;
}

const METRONOME_UNIT_QUARTERS: Record<string, number> = {
  maxima: 32,
  long: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 0.0625,
  "128th": 0.03125,
  "256th": 0.015625,
};

function parsePitch(node: OrderedXmlNode | undefined): number | undefined {
  if (!node) return undefined;
  const children = childNodes(node);
  const step = directText(firstNamed(children, "step")) || directText(firstNamed(children, "display-step"));
  const octave = numberText(firstNamed(children, "octave")) || numberText(firstNamed(children, "display-octave"));
  if (!(step in STEP_TO_SEMITONE) || !Number.isFinite(octave)) return undefined;
  const alter = numberText(firstNamed(children, "alter"));
  return Math.round((octave + 1) * 12 + STEP_TO_SEMITONE[step] + alter);
}

function parseVelocity(nodes: OrderedXmlNode[]) {
  const explicit = numberText(firstNamed(nodes, "velocity"));
  if (explicit > 0) return Math.max(1, Math.min(127, Math.round(explicit)));
  return 88;
}

function readCreator(nodes: OrderedXmlNode[], type: string) {
  const identification = firstNamed(nodes, "identification");
  if (!identification) return undefined;
  return namedChildren(childNodes(identification), "creator")
    .find((creator) => attribute(creator, "type") === type)
    ? directText(namedChildren(childNodes(identification), "creator").find((creator) => attribute(creator, "type") === type))
    : undefined;
}

function readFirstText(nodes: OrderedXmlNode[], path: string[]): string {
  let current: OrderedXmlNode | undefined;
  let currentNodes = nodes;
  for (const name of path) {
    current = firstNamed(currentNodes, name);
    if (!current) return "";
    currentNodes = childNodes(current);
  }
  return directText(current);
}

function namedChildren(nodes: OrderedXmlNode[], name: string): OrderedXmlNode[] {
  return nodes.filter((node) => Object.prototype.hasOwnProperty.call(node, name));
}

function firstNamed(nodes: OrderedXmlNode[], name: string): OrderedXmlNode | undefined {
  return namedChildren(nodes, name)[0];
}

function nodeName(node: OrderedXmlNode): string {
  return Object.keys(node).find((key) => key !== ":@") || "";
}

function childNodes(node: OrderedXmlNode | undefined): OrderedXmlNode[] {
  if (!node) return [];
  const name = nodeName(node);
  const value = node[name];
  return Array.isArray(value) ? value as OrderedXmlNode[] : [];
}

function directText(node: OrderedXmlNode | undefined): string {
  if (!node) return "";
  const textNode = childNodes(node).find((child) => Object.prototype.hasOwnProperty.call(child, "#text"));
  return textNode == null ? "" : String(textNode["#text"] ?? "").trim();
}

function numberText(node: OrderedXmlNode | undefined): number {
  const value = Number(directText(node));
  return Number.isFinite(value) ? value : 0;
}

function attribute(node: OrderedXmlNode | undefined, name: string): string {
  if (!node) return "";
  const attributes = node[":@"] as Record<string, unknown> | undefined;
  return String(attributes?.[`@_${name}`] ?? "").trim();
}

function stripScoreExtension(name: string) {
  return name.replace(/\.(musicxml|mxl|xml)$/i, "").trim() || "Imported score";
}

function roundBeat(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function ratio(numerator: number, denominator: number) {
  return denominator <= 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 10_000;
}
