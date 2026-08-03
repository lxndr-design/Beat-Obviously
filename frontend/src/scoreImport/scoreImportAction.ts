import { createSignal } from "solid-js";
import { drumLaneDescription, findDrumInstrument } from "../audio/drumInstrumentMapping";
import { isNative, send } from "../ipc/bridge";
import type { ScoreImportResponse, ScoreOcrArtifacts } from "../ipc/schema";
import { createNewDocument } from "../persistence/documentActions";
import { SALAMANDER_COMPACT_GRAND_NAME } from "../state/factoryPiano";
import { factoryScoreSamplerIdForPartName } from "../state/factoryScoreSamplers";
import {
  runProjectHistoryGroup,
  useDocumentStore,
  useInstrumentStore,
  useProjectStore,
  useUiStore,
} from "../state/store";
import type { DrumpadLane, Instrument, MidiNote } from "../state/types";
import { parseAndMergeMusicXmlPages, parseMusicXmlSource, type ImportedScorePart, type ImportedScorePlan, type ScorePageSource, type ScoreSource } from "./musicXmlImport";
import { registerLocalStandard } from "../ai/standardsCorpus";

export interface ScoreImportReviewState {
  plan: ImportedScorePlan;
  selectedPartIds: string[];
  applyScoreTempo: boolean;
  sourceMethod: ScoreSourceMethod;
  addToGenerationLibrary: boolean;
  includeReviewMeasures: boolean;
  ocrArtifacts?: ScoreOcrArtifacts;
  adaptiveRecovery: boolean;
}

const [scoreImportReview, setScoreImportReview] = createSignal<ScoreImportReviewState | null>(null);
const [scoreImportBusy, setScoreImportBusy] = createSignal(false);

export { scoreImportBusy, scoreImportReview };

type ScoreSourceMethod = "musicxml" | "audiveris" | "homr" | "hybrid";

export async function beginScoreImport() {
  if (scoreImportBusy()) return;
  setScoreImportBusy(true);
  try {
    const imported = await chooseScoreSource();
    if (!imported) return;
    const plan = imported.recoveredPages ? parseAndMergeMusicXmlPages(imported.recoveredPages) : parseMusicXmlSource(imported.source!);
    setScoreImportReview({
      plan,
      selectedPartIds: plan.parts.filter((part) => part.pitchRange != null).map((part) => part.id),
      applyScoreTempo: Boolean(plan.bpm),
      sourceMethod: imported.sourceMethod,
      addToGenerationLibrary: false,
      includeReviewMeasures: imported.sourceMethod === "musicxml" || plan.quality.reviewMeasureCount === 0,
      ocrArtifacts: imported.ocrArtifacts,
      adaptiveRecovery: imported.adaptiveRecovery,
    });
  } finally {
    setScoreImportBusy(false);
  }
}

export async function importJazzStandardsLibrary() {
  if (scoreImportBusy()) return null;
  setScoreImportBusy(true);
  try {
    const sources = await chooseStandardsSources();
    if (sources.length === 0) return null;
    const imported: ImportedScorePlan[] = [];
    const skipped: string[] = [];
    for (const source of sources) {
      if (source.error || (!source.score && !source.recoveredPages?.length)) {
        skipped.push(`${source.name || "Score"}: ${source.error || "No readable score was produced."}`);
        continue;
      }
      try {
        const plan = source.recoveredPages ? parseAndMergeMusicXmlPages(source.recoveredPages) : parseMusicXmlSource(source.score!);
        registerLocalStandard(plan, ["all"], source.sourceMethod === "musicxml" ? "verified" : "needs-review");
        imported.push(plan);
      } catch (error) {
        skipped.push(`${source.score?.name || source.recoveredPages?.[0]?.source.name || source.name || "Score"}: ${error instanceof Error ? error.message : "Could not parse MusicXML."}`);
      }
    }
    return { imported, skipped };
  } finally {
    setScoreImportBusy(false);
  }
}

export function updateScoreImportReview(patch: Partial<Pick<ScoreImportReviewState, "selectedPartIds" | "applyScoreTempo" | "addToGenerationLibrary" | "includeReviewMeasures">>) {
  setScoreImportReview((current) => current ? { ...current, ...patch } : null);
}

export function closeScoreImportReview() {
  setScoreImportReview(null);
}

export async function revealScoreOcrArtifacts() {
  const path = scoreImportReview()?.ocrArtifacts?.artifactDirectoryPath;
  if (!path) throw new Error("No retained Score OCR review folder is available for this import.");
  const response = await send({ kind: "score.revealArtifacts", path });
  if (!response.ok) throw new Error(response.error || "Beat could not reveal the retained Score OCR files.");
}

export async function openScoreOcrReview() {
  const path = scoreImportReview()?.ocrArtifacts?.omrPath;
  if (!path) throw new Error("Audiveris did not produce an editable OMR project for this import.");
  const response = await send({ kind: "score.openOcrReview", path });
  if (!response.ok) throw new Error(response.error || "Beat could not open the retained OMR project.");
}

export async function installScoreImport() {
  const review = scoreImportReview();
  if (!review) return null;
  const selected = new Set(review.selectedPartIds);
  const parts = review.plan.parts.filter((part) => selected.has(part.id)
    && part.pitchRange != null
    && part.segments.some((segment) => includedSegmentNotes(part, segment, review.includeReviewMeasures).length > 0));
  if (parts.length === 0) throw new Error("Choose at least one playable score part.");

  const wasOpen = useDocumentStore.getState().documentOpen;
  if (!wasOpen && !await createNewDocument()) return null;
  const projectStore = useProjectStore.getState();
  const instruments = useInstrumentStore.getState().instruments;
  const createdTrackIds: string[] = [];
  const createdSegmentIds: string[] = [];

  runProjectHistoryGroup(() => {
    const initialBlankTrack = projectStore.project.tracks.length === 1
      && projectStore.project.tracks[0].segments.length === 0
      ? projectStore.project.tracks[0].id
      : null;

    if (!wasOpen) projectStore.rename(review.plan.title);
    if (review.applyScoreTempo && review.plan.bpm) projectStore.setBpm(Math.max(20, Math.min(400, review.plan.bpm)));
    projectStore.setTimeSignature({
      num: review.plan.timeSignature.numerator,
      denom: review.plan.timeSignature.denominator,
      boldBeats: [1],
    });
    projectStore.setLengthBeats(Math.max(projectStore.project.lengthBeats, review.plan.lengthBeats));

    for (const part of parts) {
      const instrument = part.percussion ? undefined : findScoreInstrument(part, instruments);
      const trackId = projectStore.addTrack({
        name: part.name,
        kind: "midi",
        instrumentId: instrument?.id,
      });
      createdTrackIds.push(trackId);
      const percussionSetup = part.percussion ? buildPercussionSetup(part, instruments) : undefined;

      for (const segment of part.segments) {
        const segmentNotes = includedSegmentNotes(part, segment, review.includeReviewMeasures);
        if (segmentNotes.length === 0) continue;
        const payload = percussionSetup
          ? {
              kind: "drumpad" as const,
              keyboardLayout: "mac" as const,
              lanes: percussionSetup.lanes,
              hits: segmentNotes.map((note) => ({
                id: `score-hit-${crypto.randomUUID()}`,
                laneId: percussionSetup.laneIdByPitch.get(note.pitch)!,
                startBeat: note.startBeat,
                lengthBeats: note.lengthBeats,
                velocity: note.velocity,
              })),
              quantizeSeconds: 1 / 64,
              gainDb: 0,
            }
          : { kind: "midi" as const, notes: segmentNotes.map(cloneMidiNote), gainDb: 0 };
        const segmentId = projectStore.addSegment(trackId, {
          name: segment.name,
          startBeat: segment.startBeat,
          lengthBeats: segment.lengthBeats,
          repeats: segment.repeats,
          layer: 0,
          muted: false,
          instrumentId: instrument?.id,
          payload,
        });
        createdSegmentIds.push(segmentId);
      }
    }
    if (initialBlankTrack) projectStore.removeTrack(initialBlankTrack);
  });

  useInstrumentStore.getState().associateProjectInstruments(useProjectStore.getState().project);
  if (review.addToGenerationLibrary) registerLocalStandard(
    review.plan,
    ["all"],
    review.sourceMethod === "musicxml" ? "verified" : "needs-review",
  );
  useUiStore.getState().setSelectedTracks(createdTrackIds.slice(0, 1));
  useUiStore.getState().setSelectedSegments(createdSegmentIds.slice(0, 1));
  closeScoreImportReview();
  return { trackIds: createdTrackIds, segmentIds: createdSegmentIds, plan: review.plan };
}

function findScoreInstrument(part: ImportedScorePart, instruments: Instrument[]) {
  const name = part.name.toLowerCase();
  if (/piano|keyboard|keys/.test(name)) {
    const piano = instruments.find((instrument) => instrument.name === SALAMANDER_COMPACT_GRAND_NAME);
    if (piano) return piano;
  }
  const factorySamplerId = factoryScoreSamplerIdForPartName(part.name);
  if (factorySamplerId) {
    const mapped = instruments.find((instrument) => instrument.id === factorySamplerId);
    if (mapped) return mapped;
  }
  const aliases: Array<[RegExp, string[]]> = [
    [/contrabass|double bass|upright bass/, ["upright bass", "acoustic bass", "bass"]],
    [/bass/, ["bass"]],
    [/violin|viola|cello|string/, ["violin", "cello", "strings", "string"]],
    [/guitar/, ["guitar"]],
    [/sax/, ["sax"]],
    [/flute|piccolo/, ["flute"]],
    [/clarinet/, ["clarinet", "reed"]],
    [/trumpet|cornet/, ["trumpet", "brass"]],
    [/trombone|horn|tuba/, ["brass", "horn"]],
    [/vibraphone|marimba|xylophone/, ["vibraphone", "mallet", "keys"]],
    [/organ/, ["organ", "keys"]],
    [/voice|vocal|choir/, ["voice", "vocal", "choir"]],
  ];
  const terms = aliases.find(([pattern]) => pattern.test(name))?.[1] ?? name.split(/\s+/).filter((term) => term.length > 2);
  return instruments.find((instrument) => {
    const haystack = [instrument.name, ...(instrument.descriptors ?? [])].join(" ").toLowerCase();
    return terms.some((term) => haystack.includes(term));
  }) ?? instruments.find((instrument) => instrument.name.toLowerCase() === "lead saw");
}

function buildPercussionSetup(part: ImportedScorePart, instruments: Instrument[]) {
  const pitches = [...new Set(part.measures.flatMap((measure) => measure.notes.map((note) => note.pitch)))].sort((left, right) => left - right);
  const lanes: DrumpadLane[] = pitches.map((pitch) => ({
    id: `score-lane-${crypto.randomUUID()}`,
    name: drumLaneDescription(pitch).name,
    instrumentId: findDrumInstrument(pitch, instruments)?.id,
    pitch,
  }));
  return { lanes, laneIdByPitch: new Map(pitches.map((pitch, index) => [pitch, lanes[index].id])) };
}

async function chooseScoreSource(): Promise<{ source?: ScoreSource; recoveredPages?: ScorePageSource[]; sourceMethod: ScoreSourceMethod; ocrArtifacts?: ScoreOcrArtifacts; adaptiveRecovery: boolean } | null> {
  if (isNative()) {
    const response = await send({ kind: "score.import" });
    if (response.error) {
      const retained = response.artifactDirectoryPath ? ` Review files were retained at ${response.artifactDirectoryPath}.` : "";
      throw new Error(response.error + retained);
    }
    const recoveredPages = response.pageScores?.map((page) => ({
      source: { name: page.name, bytes: decodeBase64(page.dataBase64) },
      firstPage: page.firstPage,
      lastPage: page.lastPage,
    }));
    if ((!response.name || !response.dataBase64) && !recoveredPages?.length) return null;
    return {
      source: response.name && response.dataBase64 ? { name: response.name, bytes: decodeBase64(response.dataBase64) } : undefined,
      recoveredPages,
      sourceMethod: response.ocrEngine ?? "musicxml",
      ocrArtifacts: scoreOcrArtifactsFromResponse(response),
      adaptiveRecovery: Boolean(response.adaptiveRecovery),
    };
  }
  const file = await chooseBrowserScoreFile();
  if (!file) return null;
  if (!/\.(musicxml|mxl|xml)$/i.test(file.name))
    throw new Error("PDF and image score OCR uses Audiveris in the native Beat app. In the browser, import MusicXML or MXL.");
  return { source: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, sourceMethod: "musicxml", adaptiveRecovery: false };
}

function scoreOcrArtifactsFromResponse(response: ScoreImportResponse): ScoreOcrArtifacts | undefined {
  if (!response.artifactDirectoryPath) return undefined;
  return {
    artifactDirectoryPath: response.artifactDirectoryPath,
    musicXmlPath: response.musicXmlPath,
    omrPath: response.omrPath,
    ocrLogPath: response.ocrLogPath,
    warningCount: response.ocrWarningCount ?? 0,
    errorCount: response.ocrErrorCount ?? 0,
    exceptionCount: response.ocrExceptionCount ?? 0,
  };
}

function includedSegmentNotes(part: ImportedScorePart, segment: ImportedScorePart["segments"][number], includeReviewMeasures: boolean) {
  if (includeReviewMeasures) return segment.notes;
  const reviewRanges = part.measures
    .filter((measure) => measure.timingStatus === "review")
    .map((measure) => ({ start: measure.startBeat, end: measure.startBeat + measure.lengthBeats }));
  if (reviewRanges.length === 0) return segment.notes;
  return segment.notes.filter((note) => {
    const absoluteStart = segment.startBeat + note.startBeat;
    return !reviewRanges.some((range) => absoluteStart >= range.start - 0.000001 && absoluteStart < range.end - 0.000001);
  });
}

function chooseBrowserScoreFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".musicxml,.mxl,.xml,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp";
    input.style.display = "none";
    document.body.append(input);
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    }, { once: true });
    input.click();
  });
}

async function chooseStandardsSources(): Promise<Array<{ name?: string; score?: ScoreSource; recoveredPages?: ScorePageSource[]; sourceMethod: ScoreSourceMethod; error?: string }>> {
  if (isNative()) {
    const response = await send({ kind: "score.importLibrary" });
    return response.scores.map((item) => ({
      name: item.name,
      score: item.name && item.dataBase64 ? { name: item.name, bytes: decodeBase64(item.dataBase64) } : undefined,
      recoveredPages: item.pageScores?.map((page) => ({
        source: { name: page.name, bytes: decodeBase64(page.dataBase64) },
        firstPage: page.firstPage,
        lastPage: page.lastPage,
      })),
      sourceMethod: item.ocrEngine ?? "musicxml",
      error: item.error,
    }));
  }
  const files = await chooseBrowserScoreFiles();
  return Promise.all(files.map(async (file) => /\.(musicxml|mxl|xml)$/i.test(file.name)
    ? { name: file.name, score: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, sourceMethod: "musicxml" as const }
    : { name: file.name, sourceMethod: "audiveris" as const, error: "PDF/image OCR requires the native Beat app with an installed score-recognition engine." }));
}

function chooseBrowserScoreFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".musicxml,.mxl,.xml,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp";
    input.style.display = "none";
    document.body.append(input);
    input.addEventListener("change", () => {
      const files = [...(input.files ?? [])];
      input.remove();
      resolve(files);
    }, { once: true });
    input.click();
  });
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function cloneMidiNote(note: MidiNote): MidiNote {
  return {
    ...note,
    curve: note.curve?.map((point) => ({ ...point })),
    automation: note.automation?.map((lane) => ({ ...lane, points: lane.points.map((point) => ({ ...point })) })),
  };
}
