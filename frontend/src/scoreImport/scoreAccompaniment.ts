import { generateLocalDrumBeat, type DrumGenre } from "../ai/drumBeatGenerator";
import type { DrumSpeed, DrumStep, Instrument, MidiNote, TimeSignature } from "../state/types";

export type ChordQuality = "major" | "minor" | "diminished";

export interface InferredScoreChord {
  startBeat: number;
  lengthBeats: number;
  rootPitchClass: number;
  quality: ChordQuality;
  label: string;
  pitchClasses: number[];
  confidence: number;
}

export type GeneratedScoreDrumRole = "kick" | "snare" | "cymbal" | "closedHat" | "openHat" | "ride" | "crash" | "lowTom" | "midTom" | "highTom";

export interface GeneratedScoreDrumRow {
  role: GeneratedScoreDrumRole;
  name: string;
  steps: DrumStep[];
}

export interface GeneratedScoreDrumPhrase {
  startBeat: number;
  lengthBeats: number;
  repeats: number;
  sourceLengthBeats: number;
  stepCount: number;
  speed: DrumSpeed;
  swingPercent: number;
  style: "ambient-pulse" | "flowing-orchestral" | "backbeat" | "driving";
  rows: GeneratedScoreDrumRow[];
}

export interface GeneratedScoreBassPhrase {
  startBeat: number;
  lengthBeats: number;
  repeats: number;
  notes: MidiNote[];
}

export interface ScoreAccompaniment {
  key: { tonicPitchClass: number; mode: "major" | "minor"; label: string; pitchClasses: number[] };
  chords: InferredScoreChord[];
  bassNotes: MidiNote[];
  bassPhrases: GeneratedScoreBassPhrase[];
  drumPhrases: GeneratedScoreDrumPhrase[];
}

export interface ScoreAccompanimentOptions {
  notes: MidiNote[];
  lengthBeats: number;
  bpm: number;
  timeSignature: TimeSignature;
  keySignatureFifths?: number;
  drumInstruments?: Partial<Record<GeneratedScoreDrumRole, Instrument>>;
}

const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJOR_TONIC_BY_FIFTHS = new Map([
  [-7, 11], [-6, 6], [-5, 1], [-4, 8], [-3, 3], [-2, 10], [-1, 5],
  [0, 0], [1, 7], [2, 2], [3, 9], [4, 4], [5, 11], [6, 6], [7, 1],
]);
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

export function generateScoreAccompaniment(options: ScoreAccompanimentOptions): ScoreAccompaniment {
  const lengthBeats = Math.max(1, options.lengthBeats);
  const notes = options.notes.filter((note) => note.startBeat < lengthBeats && note.lengthBeats > 0);
  const key = inferKey(notes, options.keySignatureFifths);
  const beatsPerBar = options.timeSignature.num * (4 / options.timeSignature.denom);
  const chordLength = Math.max(1, Math.min(4, beatsPerBar / 2));
  const chords = inferChords(notes, lengthBeats, chordLength, key.pitchClasses);
  const bassNotes = createBassLine(chords, notes, options.bpm);
  return {
    key,
    chords,
    bassNotes,
    bassPhrases: createBassPhrases(bassNotes, lengthBeats, Math.max(beatsPerBar, beatsPerBar * 8)),
    drumPhrases: createDrumPhrases(notes, lengthBeats, options.bpm, beatsPerBar, options.timeSignature, options.drumInstruments),
  };
}

function createBassPhrases(notes: MidiNote[], lengthBeats: number, phraseLength: number): GeneratedScoreBassPhrase[] {
  const phrases: GeneratedScoreBassPhrase[] = [];
  for (let startBeat = 0; startBeat < lengthBeats - 0.0001; startBeat += phraseLength) {
    const length = Math.min(phraseLength, lengthBeats - startBeat);
    const localNotes = notes
      .filter((note) => note.startBeat >= startBeat && note.startBeat < startBeat + length)
      .map((note) => ({ ...note, startBeat: roundBeat(note.startBeat - startBeat) }));
    if (localNotes.length === 0) continue;
    const phrase: GeneratedScoreBassPhrase = {
      startBeat: roundBeat(startBeat),
      lengthBeats: roundBeat(length),
      repeats: 0,
      notes: localNotes,
    };
    const previous = phrases.at(-1);
    const previousEnd = previous ? previous.startBeat + previous.lengthBeats * (previous.repeats + 1) : -1;
    if (previous && Math.abs(previousEnd - phrase.startBeat) < 0.0001 && previous.lengthBeats === phrase.lengthBeats && midiPhrasesEqual(previous.notes, phrase.notes)) {
      previous.repeats += 1;
    } else phrases.push(phrase);
  }
  return phrases;
}

function midiPhrasesEqual(left: MidiNote[], right: MidiNote[]): boolean {
  return left.length === right.length && left.every((note, index) => {
    const other = right[index];
    return other && note.pitch === other.pitch && note.startBeat === other.startBeat
      && note.lengthBeats === other.lengthBeats && note.velocity === other.velocity;
  });
}

function inferKey(notes: MidiNote[], fifths?: number): ScoreAccompaniment["key"] {
  const histogram = pitchClassHistogram(notes);
  const majorTonic = fifths == null ? bestMajorTonic(histogram) : MAJOR_TONIC_BY_FIFTHS.get(clamp(Math.round(fifths), -7, 7)) ?? 0;
  const minorTonic = mod(majorTonic + 9, 12);
  const majorScore = tonicModeScore(histogram, majorTonic, MAJOR_STEPS, notes);
  const minorScore = tonicModeScore(histogram, minorTonic, MINOR_STEPS, notes);
  const mode = minorScore > majorScore * 1.08 ? "minor" : "major";
  const tonicPitchClass = mode === "minor" ? minorTonic : majorTonic;
  const steps = mode === "minor" ? MINOR_STEPS : MAJOR_STEPS;
  return {
    tonicPitchClass,
    mode,
    label: `${PITCH_NAMES[tonicPitchClass]} ${mode}`,
    pitchClasses: steps.map((step) => mod(tonicPitchClass + step, 12)),
  };
}

function inferChords(notes: MidiNote[], lengthBeats: number, windowBeats: number, scale: number[]): InferredScoreChord[] {
  const chords: InferredScoreChord[] = [];
  let previousRoot = scale[0] ?? 0;
  for (let startBeat = 0; startBeat < lengthBeats - 0.0001; startBeat += windowBeats) {
    const length = Math.min(windowBeats, lengthBeats - startBeat);
    const windowNotes = notes.filter((note) => overlaps(note, startBeat, startBeat + length));
    const histogram = pitchClassHistogram(windowNotes, startBeat, startBeat + length);
    const lowHistogram = pitchClassHistogram(windowNotes.filter((note) => note.pitch < 60), startBeat, startBeat + length);
    let best: { root: number; quality: ChordQuality; pcs: number[]; score: number } | undefined;
    for (let degree = 0; degree < scale.length; degree += 1) {
      const root = scale[degree];
      const third = scale[(degree + 2) % scale.length];
      const fifth = scale[(degree + 4) % scale.length];
      const quality = chordQuality(root, third, fifth);
      const pcs = [root, third, fifth];
      const chordWeight = pcs.reduce((sum, pc, index) => sum + histogram[pc] * (index === 0 ? 1.22 : 1), 0);
      const outsideWeight = histogram.reduce((sum, value, pc) => sum + (pcs.includes(pc) ? 0 : value), 0);
      const score = chordWeight - outsideWeight * 0.22 + lowHistogram[root] * 1.45 + (root === previousRoot ? 0.15 : 0);
      if (!best || score > best.score) best = { root, quality, pcs, score };
    }
    const fallbackRoot = previousRoot;
    const selected = best ?? { root: fallbackRoot, quality: "major" as const, pcs: [fallbackRoot, mod(fallbackRoot + 4, 12), mod(fallbackRoot + 7, 12)], score: 0 };
    previousRoot = selected.root;
    const totalWeight = Math.max(0.0001, histogram.reduce((sum, value) => sum + value, 0));
    const chordWeight = selected.pcs.reduce((sum, pc) => sum + histogram[pc], 0);
    chords.push({
      startBeat: roundBeat(startBeat),
      lengthBeats: roundBeat(length),
      rootPitchClass: selected.root,
      quality: selected.quality,
      label: chordLabel(selected.root, selected.quality),
      pitchClasses: selected.pcs,
      confidence: roundBeat(clamp(chordWeight / totalWeight, 0, 1)),
    });
  }
  return coalesceChords(chords);
}

function createBassLine(chords: InferredScoreChord[], sourceNotes: MidiNote[], bpm: number): MidiNote[] {
  const notes: MidiNote[] = [];
  let previousPitch = 40;
  chords.forEach((chord, index) => {
    const density = onsetDensity(sourceNotes, chord.startBeat, chord.startBeat + chord.lengthBeats);
    const root = nearestPitchForClass(chord.rootPitchClass, previousPitch, 28, 48);
    const nextRootPc = chords[index + 1]?.rootPitchClass ?? chord.rootPitchClass;
    const active = bpm >= 105 || density >= 2.2;
    if (!active || chord.lengthBeats < 1.5) {
      notes.push(midiNote(root, chord.startBeat, Math.max(0.25, chord.lengthBeats * 0.92), 78));
      previousPitch = root;
      return;
    }
    const split = chord.lengthBeats * (bpm < 90 ? 0.72 : 0.58);
    notes.push(midiNote(root, chord.startBeat, Math.max(0.25, split - 0.08), 82));
    const fifthPc = chord.pitchClasses[2] ?? mod(chord.rootPitchClass + 7, 12);
    const nextPc = index % 2 === 0 ? fifthPc : nextRootPc;
    const second = nearestPitchForClass(nextPc, root, 28, 50);
    notes.push(midiNote(second, chord.startBeat + split, Math.max(0.2, chord.lengthBeats - split - 0.08), 68));
    previousPitch = second;
  });
  return notes;
}

const SCORE_DRUM_ROLES: GeneratedScoreDrumRole[] = ["kick", "snare", "cymbal", "closedHat", "openHat", "ride", "crash", "lowTom", "midTom", "highTom"];

function createDrumPhrases(
  notes: MidiNote[],
  lengthBeats: number,
  bpm: number,
  beatsPerBar: number,
  timeSignature: TimeSignature,
  suppliedInstruments?: Partial<Record<GeneratedScoreDrumRole, Instrument>>,
): GeneratedScoreDrumPhrase[] {
  const phraseLength = Math.max(beatsPerBar, beatsPerBar * 4);
  const phraseCount = Math.ceil(lengthBeats / phraseLength);
  const densities = Array.from({ length: phraseCount }, (_, index) => onsetDensity(notes, index * phraseLength, Math.min(lengthBeats, (index + 1) * phraseLength)));
  const syncopations = Array.from({ length: phraseCount }, (_, index) => {
    const start = index * phraseLength;
    const localNotes = notes.filter((note) => overlaps(note, start, Math.min(lengthBeats, start + phraseLength)));
    return localNotes.length === 0 ? 0 : localNotes.filter((note) => Math.abs(note.startBeat * 2 - Math.round(note.startBeat * 2)) > 0.08).length / localNotes.length;
  });
  const maxDensity = Math.max(1, ...densities);
  const drumInstruments = scoreDrumInstruments(suppliedInstruments);
  const instrumentList = SCORE_DRUM_ROLES.map((role) => drumInstruments[role]);
  const roleByInstrumentId = new Map(SCORE_DRUM_ROLES.map((role) => [drumInstruments[role].id, role]));
  const analysisPhrases = densities.map((_, phraseIndex) => {
    const startBeat = phraseIndex * phraseLength;
    const length = Math.min(phraseLength, lengthBeats - startBeat);
    // Hold a groove decision for two four-bar analysis phrases (about eight bars).
    // This creates readable song regions instead of changing loops every few seconds.
    const regionStart = Math.floor(phraseIndex / 2) * 2;
    const regionDensities = densities.slice(regionStart, regionStart + 2);
    const regionSyncopations = syncopations.slice(regionStart, regionStart + 2);
    const regionDensity = regionDensities.reduce((sum, value) => sum + value, 0) / Math.max(1, regionDensities.length);
    const syncopation = regionSyncopations.reduce((sum, value) => sum + value, 0) / Math.max(1, regionSyncopations.length);
    const energy = clamp(regionDensity / maxDensity, 0, 1);
    const style = drumStyle(bpm, regionDensity, syncopation);
    const genre = scoreDrumGenre(style);
    const energyBucket = energy < 0.4 ? 0 : energy < 0.72 ? 1 : 2;
    const gridSpeed: DrumSpeed = 4;
    const completeBar = Math.abs(length / beatsPerBar - Math.round(length / beatsPerBar)) < 0.0001;
    const loopLength = completeBar ? Math.min(beatsPerBar, length) : length;
    const loopPlays = completeBar ? Math.max(1, Math.round(length / loopLength)) : 1;
    const gridLength = Math.max(1, Math.round(loopLength * gridSpeed));
    const beat = generateLocalDrumBeat({
      genre,
      instruments: instrumentList,
      stepCount: gridLength,
      lengthBeats: gridLength,
      speed: gridSpeed,
      timeSignature,
      complexity: Math.round(34 + energy * 22 + syncopation * 12),
      variationSeed: Math.round(bpm * 100) + style.length * 1013 + energyBucket * 7919,
    });
    const rows = beat.rows.map((row): GeneratedScoreDrumRow => {
      const role = roleByInstrumentId.get(row.instrumentId ?? "") ?? scoreDrumRoleFromName(row.name);
      return {
        role,
        // A generated texture name must never claim a different timbre than the
        // sampler that arrangement and editor playback actually resolve.
        name: drumInstruments[role].name,
        steps: resampleDrumSteps(row.steps, gridLength),
      };
    });
    return {
      startBeat: roundBeat(startBeat),
      lengthBeats: roundBeat(loopLength),
      repeats: loopPlays - 1,
      sourceLengthBeats: gridLength,
      stepCount: gridLength,
      speed: gridSpeed,
      swingPercent: beat.swingPercent,
      style,
      rows: rows.filter((row) => row.steps.some(Boolean)),
    };
  });
  return coalesceDrumPhrases(analysisPhrases);
}

function resampleDrumSteps(steps: DrumStep[], targetLength: number): DrumStep[] {
  if (steps.length === targetLength) return steps.slice();
  const target = Array.from({ length: targetLength }, () => false as DrumStep);
  steps.forEach((step, index) => {
    if (!step) return;
    const targetIndex = Math.min(targetLength - 1, Math.max(0, Math.round((index / Math.max(1, steps.length)) * targetLength)));
    const existing = target[targetIndex];
    if (!existing || typeof existing !== "object" || typeof step !== "object") {
      target[targetIndex] = step;
      return;
    }
    target[targetIndex] = (step.velocity ?? 0) >= (existing.velocity ?? 0) ? step : existing;
  });
  return target;
}

function scoreDrumGenre(style: GeneratedScoreDrumPhrase["style"]): DrumGenre {
  if (style === "driving") return "dnb";
  if (style === "backbeat") return "pop";
  return "orchestral";
}

function scoreDrumRoleFromName(name: string): GeneratedScoreDrumRole {
  const lower = name.toLowerCase();
  if (/closed|foot/.test(lower) && /hat/.test(lower)) return "closedHat";
  if (/open/.test(lower) && /hat/.test(lower)) return "openHat";
  if (/ride/.test(lower)) return "ride";
  if (/crash/.test(lower)) return "crash";
  if (/low tom/.test(lower)) return "lowTom";
  if (/high tom/.test(lower)) return "highTom";
  if (/tom/.test(lower)) return "midTom";
  if (/snare|brush|rim|clap/.test(lower)) return "snare";
  if (/tambourine|shaker/.test(lower)) return "closedHat";
  if (/cymbal/.test(lower)) return "cymbal";
  return "kick";
}

function scoreDrumInstruments(supplied?: Partial<Record<GeneratedScoreDrumRole, Instrument>>): Record<GeneratedScoreDrumRole, Instrument> {
  const names: Record<GeneratedScoreDrumRole, string> = {
    kick: "Concert Bass Drum",
    snare: "Orchestral Snare",
    cymbal: "Suspended Cymbal",
    closedHat: "Closed Hi-Hat",
    openHat: "Open Hi-Hat",
    ride: "Ride Cymbal",
    crash: "Crash Cymbal",
    lowTom: "Low Tom",
    midTom: "Mid Tom",
    highTom: "High Tom",
  };
  return Object.fromEntries(SCORE_DRUM_ROLES.map((role) => [role, supplied?.[role] ?? {
    id: `score-drum-${role}`,
    name: names[role],
    kind: "sampler",
    envelope: { attackMs: 1, decayMs: 500, sustain: 0, releaseMs: 240 },
    knobs: { cutoff: 1, resonance: 0, drive: 0, color: 0.5 },
    waveform: "sample",
    sampleIds: [],
    descriptors: [role, names[role], "drum"],
    userCreated: false,
  } as Instrument])) as Record<GeneratedScoreDrumRole, Instrument>;
}

function coalesceDrumPhrases(phrases: GeneratedScoreDrumPhrase[]): GeneratedScoreDrumPhrase[] {
  const result: GeneratedScoreDrumPhrase[] = [];
  for (const phrase of phrases) {
    const previous = result.at(-1);
    const contiguous = previous && Math.abs(previous.startBeat + previous.lengthBeats * (previous.repeats + 1) - phrase.startBeat) < 0.0001;
    if (!previous || !contiguous || !drumPhrasesEqual(previous, phrase)) {
      result.push({
        ...phrase,
        rows: phrase.rows.map((row) => ({ ...row, steps: [...row.steps] })),
      });
      continue;
    }
    previous.repeats += phrase.repeats + 1;
  }
  return result;
}

function drumPhrasesEqual(left: GeneratedScoreDrumPhrase, right: GeneratedScoreDrumPhrase): boolean {
  if (left.style !== right.style || left.lengthBeats !== right.lengthBeats || left.speed !== right.speed
    || left.swingPercent !== right.swingPercent || left.rows.length !== right.rows.length) return false;
  return left.rows.every((row, index) => {
    const other = right.rows[index];
    return other && row.role === other.role && row.steps.length === other.steps.length
      && row.steps.every((step, stepIndex) => JSON.stringify(step) === JSON.stringify(other.steps[stepIndex]));
  });
}

function drumStyle(bpm: number, density: number, syncopation: number): GeneratedScoreDrumPhrase["style"] {
  if (bpm < 82 && density < 1.1) return "ambient-pulse";
  if (bpm < 100 && (density >= 1.1 || syncopation > 0.2)) return "flowing-orchestral";
  if (bpm >= 145 || (bpm >= 118 && density > 3.2)) return "driving";
  return "backbeat";
}

function coalesceChords(chords: InferredScoreChord[]) {
  const result: InferredScoreChord[] = [];
  for (const chord of chords) {
    const previous = result.at(-1);
    if (previous && previous.rootPitchClass === chord.rootPitchClass && previous.quality === chord.quality) {
      previous.lengthBeats = roundBeat(previous.lengthBeats + chord.lengthBeats);
      previous.confidence = roundBeat((previous.confidence + chord.confidence) / 2);
    } else result.push({ ...chord });
  }
  return result;
}

function chordQuality(root: number, third: number, fifth: number): ChordQuality {
  const thirdInterval = mod(third - root, 12);
  const fifthInterval = mod(fifth - root, 12);
  if (thirdInterval === 3 && fifthInterval === 6) return "diminished";
  return thirdInterval === 3 ? "minor" : "major";
}

function chordLabel(root: number, quality: ChordQuality) {
  return `${PITCH_NAMES[root]}${quality === "minor" ? "m" : quality === "diminished" ? "dim" : ""}`;
}

function bestMajorTonic(histogram: number[]) {
  let best = 0;
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const score = tonicModeScore(histogram, tonic, MAJOR_STEPS, []);
    if (score > bestScore) {
      best = tonic;
      bestScore = score;
    }
  }
  return best;
}

function tonicModeScore(histogram: number[], tonic: number, steps: number[], notes: MidiNote[]) {
  const scale = steps.map((step) => mod(tonic + step, 12));
  const scaleWeight = scale.reduce((sum, pc) => sum + histogram[pc], 0);
  const tonicWeight = histogram[tonic] * 1.4;
  const finalNotes = [...notes].sort((left, right) => right.startBeat - left.startBeat).slice(0, 12);
  const finalWeight = finalNotes.reduce((sum, note) => sum + (mod(note.pitch, 12) === tonic ? 0.8 : 0), 0);
  return scaleWeight + tonicWeight + finalWeight;
}

function pitchClassHistogram(notes: MidiNote[], start = -Infinity, end = Infinity) {
  const histogram = Array(12).fill(0) as number[];
  for (const note of notes) {
    const overlap = Math.max(0, Math.min(end, note.startBeat + note.lengthBeats) - Math.max(start, note.startBeat));
    if (overlap <= 0) continue;
    const registerWeight = note.pitch < 60 ? 1.35 : note.pitch > 84 ? 0.72 : 1;
    histogram[mod(note.pitch, 12)] += Math.min(2, overlap) * registerWeight * (0.65 + note.velocity / 254);
  }
  return histogram;
}

function onsetDensity(notes: MidiNote[], start: number, end: number) {
  const duration = Math.max(0.25, end - start);
  return notes.filter((note) => note.startBeat >= start && note.startBeat < end).length / duration;
}

function overlaps(note: MidiNote, start: number, end: number) {
  return note.startBeat < end && note.startBeat + note.lengthBeats > start;
}

function nearestPitchForClass(pitchClass: number, near: number, minimum: number, maximum: number) {
  const candidates = Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index)
    .filter((pitch) => pitch <= maximum && mod(pitch, 12) === pitchClass);
  return candidates.sort((left, right) => Math.abs(left - near) - Math.abs(right - near))[0] ?? minimum;
}

function midiNote(pitch: number, startBeat: number, lengthBeats: number, velocity: number): MidiNote {
  return { pitch, startBeat: roundBeat(startBeat), lengthBeats: roundBeat(lengthBeats), velocity: clamp(Math.round(velocity), 1, 127) };
}

function mod(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundBeat(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
