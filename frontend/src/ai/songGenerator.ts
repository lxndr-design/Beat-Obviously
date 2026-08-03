import type { MidiNote } from "../state/types";
import type { DrumGenre } from "./drumBeatGenerator";
import { selectSongGenerationReference, type StandardGenerationProfile } from "./standardsCorpus";

export type MelodyVariationKind =
  | "statement"
  | "chords"
  | "extrapolation"
  | "inversion"
  | "simplification"
  | "complication";

export type SongFormId = "verse-chorus" | "aaba" | "sectional";

export const SONG_SPEEDS = ["passive", "slow", "medium", "fast", "hyper"] as const;
export const SONG_GENRES = ["pop", "rap", "dnb", "jazz", "reggae", "classical", "electronic"] as const;
export const SONG_RANDOMNESS_LEVELS = ["low", "medium", "high"] as const;

export type SongSpeed = typeof SONG_SPEEDS[number];
export type SongGenre = typeof SONG_GENRES[number];
export type SongRandomness = typeof SONG_RANDOMNESS_LEVELS[number];

export interface GenerateSongOptions {
  style?: string;
  speed?: SongSpeed;
  genre?: SongGenre;
  randomness?: SongRandomness;
  key?: string;
  bpm?: number;
  form?: SongFormId;
  seed?: number;
}

export interface SongSectionPlan {
  id: string;
  label: string;
  material: "A" | "B" | "C";
  variation: MelodyVariationKind;
  lengthBeats: number;
  energy: number;
  rhythmMultiplier: number;
  keyShiftSemitones: number;
  dynamicFunction: "stress" | "release" | "sustain" | "transition" | "breakdown";
}

export type VoiceRole = "lead" | "harmony" | "bass" | "countermelody" | "rhythm";
export type VoiceTexture = "reed" | "sustained-pad" | "rounded-bass" | "plucked" | "percussive";

export interface InstrumentRequirement {
  role: VoiceRole;
  preferredName: string;
  texture: VoiceTexture;
  pitchRange: [number, number];
  libraryQueries: string[];
  fallback: {
    waveform: "sine" | "saw" | "square" | "triangle" | "noise" | "wavetable";
    attackMs: number;
    releaseMs: number;
    cutoff: number;
    resonance: number;
    drive: number;
  };
  acquisition?: {
    provider: "VSCO 2 CE";
    format: "SFZ";
    license: "CC0-1.0";
    url: string;
  };
}

export interface PlannedMidiSegment {
  name: string;
  startBeat: number;
  lengthBeats: number;
  repeats: number;
  notes: MidiNote[];
  sectionIds: string[];
  gainDb: number;
}

export interface SongVoicePlan {
  role: VoiceRole;
  texture: VoiceTexture;
  pitchRange: [number, number];
  instrument: InstrumentRequirement;
  segments: PlannedMidiSegment[];
}

/** A stable bass pitch over a harmonic interval, before rhythmic retriggering. */
export interface BassHarmonicSpan {
  pitch: number;
  startBeat: number;
  lengthBeats: number;
  velocity: number;
}

export interface GeneratedSongPlan {
  name: string;
  style: string;
  speed: SongSpeed;
  genre: SongGenre;
  randomness: SongRandomness;
  key: string;
  bpm: number;
  form: SongFormId;
  lengthBeats: number;
  seedMelody: MidiNote[];
  variations: Record<MelodyVariationKind, MidiNote[]>;
  motifs: Record<"A" | "B" | "C", MidiNote[]>;
  sections: SongSectionPlan[];
  voices: SongVoicePlan[];
  percussion?: {
    name: string;
    genre: DrumGenre;
    complexity: number;
  };
  pitchNicheIssues: string[];
  targetLoudnessLufs: number;
  motifCount: number;
  rhythmShiftCount: number;
  keyShiftCount: number;
  arrangementEvents: Array<{ beat: number; type: "stress" | "release" | "sustain" | "transition" | "key-shift" | "new-motif" | "breakdown" | "rhythm-shift"; label: string }>;
  referenceStandard?: { id: string; title: string; localOnly: boolean };
}

const SECTION_BEATS = 16;
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

const FORMS: Record<SongFormId, Array<Omit<SongSectionPlan, "id" | "lengthBeats" | "rhythmMultiplier" | "keyShiftSemitones" | "dynamicFunction">>> = {
  "verse-chorus": [
    { label: "Intro", material: "A", variation: "simplification", energy: 0.35 },
    { label: "Verse 1", material: "A", variation: "statement", energy: 0.55 },
    { label: "Pre-Chorus", material: "B", variation: "extrapolation", energy: 0.7 },
    { label: "Chorus", material: "A", variation: "complication", energy: 0.92 },
    { label: "Verse 2", material: "A", variation: "statement", energy: 0.62 },
    { label: "Chorus", material: "A", variation: "complication", energy: 0.95 },
    { label: "Bridge", material: "C", variation: "extrapolation", energy: 0.72 },
    { label: "Final Chorus", material: "A", variation: "complication", energy: 1 },
    { label: "Outro", material: "A", variation: "simplification", energy: 0.3 },
  ],
  aaba: [
    { label: "A1", material: "A", variation: "statement", energy: 0.6 },
    { label: "A2", material: "A", variation: "statement", energy: 0.68 },
    { label: "B", material: "B", variation: "inversion", energy: 0.8 },
    { label: "A3", material: "A", variation: "complication", energy: 0.9 },
  ],
  sectional: [
    { label: "A", material: "A", variation: "statement", energy: 0.52 },
    { label: "A′", material: "A", variation: "simplification", energy: 0.62 },
    { label: "B", material: "B", variation: "inversion", energy: 0.76 },
    { label: "C", material: "C", variation: "extrapolation", energy: 0.86 },
    { label: "A″", material: "A", variation: "complication", energy: 1 },
  ],
};

const GENRE_DEFAULTS: Record<SongGenre, { bpm: number; form: SongFormId; key: string; loudnessLufs: number }> = {
  pop: { bpm: 114, form: "verse-chorus", key: "C major", loudnessLufs: -10 },
  rap: { bpm: 88, form: "verse-chorus", key: "C minor", loudnessLufs: -9 },
  dnb: { bpm: 174, form: "sectional", key: "D minor", loudnessLufs: -8 },
  jazz: { bpm: 126, form: "aaba", key: "Bb major", loudnessLufs: -16 },
  reggae: { bpm: 82, form: "verse-chorus", key: "G major", loudnessLufs: -13 },
  classical: { bpm: 92, form: "sectional", key: "D minor", loudnessLufs: -18 },
  electronic: { bpm: 124, form: "sectional", key: "A minor", loudnessLufs: -9 },
};

export function generateSongPlan(options: GenerateSongOptions): GeneratedSongPlan {
  const speed = options.speed ?? "medium";
  const genre = options.genre ?? inferGenre(options.style ?? "");
  const randomness = options.randomness ?? "medium";
  const style = options.style?.trim() || `${speed} ${genre}`;
  const genreDefaults = GENRE_DEFAULTS[genre];
  const preliminarySeed = options.seed ?? stableHash(`${style}|${speed}|${genre}|${randomness}`);
  const referenceStandard = selectSongGenerationReference(preliminarySeed, genre);
  const key = options.key?.trim() || keyFromText(style) || genreDefaults.key;
  const seed = options.seed ?? stableHash(`${style}|${key}|${speed}|${genre}|${randomness}`);
  const form = options.form ?? (genre === "jazz" ? referenceStandard?.form : undefined) ?? genreDefaults.form;
  const bpmReference = genre === "jazz" ? referenceStandard?.bpm : undefined;
  const bpm = clamp(Math.round(options.bpm ?? bpmForSpeed(bpmReference ?? genreDefaults.bpm, speed)), 48, 220);
  const scale = scaleForKey(key);
  const melody = writeSeedMelody(scale, seed, referenceStandard);
  const variations: Record<MelodyVariationKind, MidiNote[]> = {
    statement: melody,
    chords: harmonizeMelody(melody, scale),
    extrapolation: extrapolateMelody(melody, scale),
    inversion: invertMelody(melody, melody[0]?.pitch ?? scale[0]),
    simplification: simplifyMelody(melody),
    complication: complicateMelody(melody, scale),
  };
  const motifs = buildMotifs(melody, scale, seed, randomness);
  const sections = buildSections(form, randomness, referenceStandard?.phraseLengthsBeats);
  const requirements = instrumentRequirements(genre);
  const voices = requirements.map((requirement, index) => buildVoicePlan(
    requirement,
    sections,
    motifs,
    scale,
    speed,
    randomness,
    seed + index * 101,
  )).filter((voice) => voice.segments.some((segment) => segment.notes.length > 0));
  const lengthBeats = sections.reduce((sum, section) => sum + section.lengthBeats, 0);
  const arrangementEvents = buildArrangementEvents(sections);
  return {
    name: generatedSongName(style, form),
    style,
    speed,
    genre,
    randomness,
    key,
    bpm,
    form,
    lengthBeats,
    seedMelody: melody,
    variations,
    motifs,
    sections,
    voices,
    percussion: percussionPlan(genre, speed, randomness),
    pitchNicheIssues: validatePitchNiches(voices),
    targetLoudnessLufs: genreDefaults.loudnessLufs,
    motifCount: randomness === "low" ? 1 : randomness === "medium" ? 2 : 3,
    rhythmShiftCount: sections.filter((section) => section.rhythmMultiplier !== 1).length,
    keyShiftCount: sections.filter((section) => section.keyShiftSemitones !== 0).length,
    arrangementEvents,
    referenceStandard: referenceStandard ? { id: referenceStandard.id, title: referenceStandard.title, localOnly: referenceStandard.localOnly } : undefined,
  };
}

function buildMotifs(
  melody: MidiNote[],
  scale: number[],
  seed: number,
  randomness: SongRandomness,
): Record<"A" | "B" | "C", MidiNote[]> {
  if (randomness === "low") return { A: melody, B: melody, C: melody };
  const motifB = randomness === "high"
    ? writeSeedMelody(scale, seed + 7919)
    : invertMelody(melody, melody[0]?.pitch ?? scale[0]);
  const motifC = randomness === "high"
    ? writeSeedMelody(scale, seed + 15401).map((note) => ({ ...note, startBeat: roundBeat(note.startBeat * 0.75), lengthBeats: roundBeat(note.lengthBeats * 0.75) }))
    : motifB;
  return { A: melody, B: motifB, C: motifC };
}

function buildSections(form: SongFormId, randomness: SongRandomness, referencePhraseLengths?: number[]): SongSectionPlan[] {
  const source = FORMS[form];
  return source.map((section, index) => {
    const material = randomness === "low" ? "A" : randomness === "medium" && section.material === "C" ? "B" : section.material;
    const variation = randomness === "low"
      ? section.label.includes("Intro") || section.label.includes("Outro") ? "simplification" : "statement"
      : section.variation;
    const rhythmShiftIndices = randomness === "high"
      ? source.length <= 4 ? [1, 2] : [2, Math.max(3, source.length - 3)]
      : randomness === "medium" ? [Math.floor(source.length / 2)] : [];
    const rhythmMultiplier = rhythmShiftIndices.includes(index)
      ? rhythmShiftIndices.indexOf(index) % 2 === 0 ? 2 : 0.5
      : 1;
    const keyShiftSemitones = randomness === "high" && index === Math.floor(source.length * 0.55)
      ? 2
      : randomness === "high" && index === source.length - 2 ? -2 : 0;
    const energy = randomness === "low" && !/intro|outro/i.test(section.label) ? 0.64 : section.energy;
    return {
      ...section,
      material,
      variation,
      energy,
      id: `${form}-${index + 1}`,
      lengthBeats: referencePhraseLengths?.[index] && referencePhraseLengths[index] >= 4
        ? roundBeat(referencePhraseLengths[index])
        : sectionLengthBeats(form, section.label),
      rhythmMultiplier,
      keyShiftSemitones,
      dynamicFunction: dynamicFunctionForSection(section.label, energy),
    };
  });
}

function sectionLengthBeats(form: SongFormId, label: string) {
  if (form === "aaba") return label === "B" ? 12 : 16;
  if (form === "sectional") {
    if (label === "A′") return 8;
    if (label === "C") return 12;
    if (label === "A″") return 24;
    return 16;
  }
  if (/intro|outro|pre/i.test(label)) return 8;
  if (/bridge/i.test(label)) return 12;
  if (/final chorus/i.test(label)) return 24;
  return 16;
}

function dynamicFunctionForSection(label: string, energy: number): SongSectionPlan["dynamicFunction"] {
  if (/bridge|break/i.test(label)) return "breakdown";
  if (/pre|intro/i.test(label)) return "transition";
  if (/outro/i.test(label) || energy < 0.45) return "release";
  if (/chorus|final|A3|A″/i.test(label) || energy > 0.88) return "stress";
  return "sustain";
}

function buildArrangementEvents(sections: SongSectionPlan[]): GeneratedSongPlan["arrangementEvents"] {
  const events: GeneratedSongPlan["arrangementEvents"] = [];
  let beat = 0;
  sections.forEach((section) => {
    events.push({ beat, type: section.dynamicFunction, label: `${section.label}: ${section.dynamicFunction}` });
    if (section.material !== "A") events.push({ beat, type: "new-motif", label: `${section.label}: motif ${section.material}` });
    if (section.rhythmMultiplier !== 1) events.push({ beat, type: "rhythm-shift", label: `${section.label}: ${section.rhythmMultiplier}× rhythmic rate` });
    if (section.keyShiftSemitones !== 0) events.push({ beat, type: "key-shift", label: `${section.label}: ${section.keyShiftSemitones > 0 ? "+" : ""}${section.keyShiftSemitones} semitones` });
    beat += section.lengthBeats;
  });
  return events;
}

/** Two short, related phrases: a presentation and a varied continuation. */
export function writeSeedMelody(
  scale: number[],
  seed: number,
  reference?: Pick<StandardGenerationProfile, "melodicDurationPalette" | "melodicIntervalPalette">,
): MidiNote[] {
  const rnd = seededRandom(seed);
  const rhythmCells = [
    [1, 0.5, 0.5, 1, 1, 4],
    [0.5, 0.5, 1, 1, 0.5, 0.5, 4],
    [1.5, 0.5, 1, 0.5, 0.5, 4],
    [0.75, 0.25, 0.5, 0.5, 2, 4],
  ];
  const referenceMoves = [...new Set((reference?.melodicIntervalPalette ?? [])
    .filter((interval) => Number.isFinite(interval) && Math.abs(interval) >= 1)
    .map((interval) => Math.sign(interval) * clamp(Math.round(Math.abs(interval) / 2), 1, 3)))];
  const makeDegrees = (count: number, cadence: number) => {
    const degrees = [Math.floor(rnd() * 3)];
    const moves = referenceMoves.length >= 2 ? [...referenceMoves, -1, 1] : [-2, -1, 1, 1, 2, 3];
    while (degrees.length < count - 2) {
      const move = moves[Math.floor(rnd() * moves.length)] ?? 1;
      degrees.push(clamp(degrees[degrees.length - 1] + move, 0, scale.length - 1));
    }
    degrees.push(cadence === 0 ? 1 : 4, cadence);
    return degrees;
  };
  const chooseDurations = () => rhythmCellFromReference(reference?.melodicDurationPalette, rnd)
    ?? rhythmCells[Math.floor(rnd() * rhythmCells.length)];
  const firstDurations = chooseDurations();
  const secondDurations = chooseDurations();
  const firstDegrees = makeDegrees(firstDurations.length, 4);
  const secondDegrees = makeDegrees(secondDurations.length, 0);
  const phrase = (degrees: number[], durations: number[], offset: number) => {
    let beat = offset;
    return degrees.map((degree, index) => {
      const duration = durations[index] ?? 1;
      const octaveLift = rnd() > 0.9 && index < degrees.length - 2 ? 12 : 0;
      const note = midiNote(scale[degree % scale.length] + octaveLift, 78 + Math.round(rnd() * 28), beat, duration * (index === degrees.length - 1 ? 0.96 : 0.82));
      beat += duration;
      return note;
    });
  };
  return [...phrase(firstDegrees, firstDurations, 0), ...phrase(secondDegrees, secondDurations, 8)];
}

function rhythmCellFromReference(palette: number[] | undefined, rnd: () => number): number[] | undefined {
  const durations = [...new Set((palette ?? [])
    .filter((duration) => Number.isFinite(duration) && duration >= 0.25 && duration <= 4)
    .map((duration) => roundBeat(duration)))]
    .sort((left, right) => left - right);
  if (durations.length < 2) return undefined;

  const result: number[] = [];
  let elapsed = 0;
  const finalSustain = durations.filter((duration) => duration >= 2).at(-1) ?? 2;
  const activeTarget = 8 - Math.min(4, finalSustain);
  while (elapsed < activeTarget - 0.001 && result.length < 8) {
    const remaining = activeTarget - elapsed;
    const candidates = durations.filter((duration) => duration <= Math.min(2, remaining + 0.001));
    const duration = candidates[Math.floor(rnd() * candidates.length)] ?? remaining;
    result.push(duration);
    elapsed = roundBeat(elapsed + duration);
  }
  result.push(roundBeat(8 - elapsed));
  return result;
}

export function invertMelody(notes: MidiNote[], axisPitch: number): MidiNote[] {
  return notes.map((note) => ({ ...note, pitch: clampMidi(axisPitch - (note.pitch - axisPitch)) }));
}

export function simplifyMelody(notes: MidiNote[]): MidiNote[] {
  const kept = notes.filter((note, index) => index === 0 || index === notes.length - 1 || note.startBeat % 1 === 0 || note.lengthBeats >= 1);
  return kept.map((note) => ({ ...note, lengthBeats: Math.max(note.lengthBeats, 0.75), velocity: Math.min(note.velocity, 96) }));
}

export function complicateMelody(notes: MidiNote[], scale: number[]): MidiNote[] {
  const result: MidiNote[] = [];
  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const next = notes[index + 1];
    result.push({ ...note, lengthBeats: Math.min(note.lengthBeats, 0.72) });
    const gap = next ? next.startBeat - note.startBeat : 0;
    if (!next || gap < 0.75) continue;
    const passing = nearestScalePitch((note.pitch + next.pitch) / 2, scale);
    result.push(midiNote(passing, Math.max(48, note.velocity - 22), note.startBeat + gap * 0.5, Math.min(0.38, gap * 0.35)));
  }
  return result.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
}

export function extrapolateMelody(notes: MidiNote[], scale: number[]): MidiNote[] {
  const opening = notes.filter((note) => note.startBeat < 8).map((note) => ({ ...note }));
  const model = opening.slice(-4);
  const continuation = model.map((note, index) => ({
    ...note,
    pitch: nearestScalePitch(note.pitch + (index < 2 ? 2 : -2), scale),
    startBeat: note.startBeat + 8,
    velocity: Math.max(56, note.velocity - 8),
  }));
  return [...opening, ...continuation];
}

export function harmonizeMelody(notes: MidiNote[], scale: number[]): MidiNote[] {
  const fallbackRoots = [0, 5, 3, 4];
  return fallbackRoots.flatMap((fallbackDegree, index) => {
    const startBeat = index * 4;
    const anchor = notes.find((note) => note.startBeat >= startBeat && note.startBeat < startBeat + 4);
    const melodyDegree = anchor
      ? scale.findIndex((pitch) => ((pitch - anchor.pitch) % 12 + 12) % 12 === 0)
      : -1;
    // Prefer a diatonic triad whose third is the phrase's first melodic pitch.
    const degree = melodyDegree >= 0 ? (melodyDegree + scale.length - 2) % scale.length : fallbackDegree;
    return [0, 2, 4].map((offset) => midiNote(scale[(degree + offset) % scale.length] - 12, 62 + offset * 3, startBeat, 3.75));
  });
}

export function validatePitchNiches(voices: SongVoicePlan[]): string[] {
  const issues: string[] = [];
  for (let pitch = 0; pitch < 128; pitch += 1) {
    const occupants = voices.filter((voice) => pitch >= voice.pitchRange[0] && pitch <= voice.pitchRange[1]);
    if (occupants.length > 2) issues.push(`MIDI ${pitch} is assigned to ${occupants.length} voices.`);
    if (occupants.length === 2 && occupants[0].texture === occupants[1].texture)
      issues.push(`${occupants[0].role} and ${occupants[1].role} overlap at MIDI ${pitch} with the same texture.`);
  }
  return issues;
}

function buildVoicePlan(
  instrument: InstrumentRequirement,
  sections: SongSectionPlan[],
  motifs: Record<"A" | "B" | "C", MidiNote[]>,
  scale: number[],
  speed: SongSpeed,
  randomness: SongRandomness,
  seed: number,
): SongVoicePlan {
  let startBeat = 0;
  const raw = sections.map((section, index): PlannedMidiSegment => {
    const source = notesForRole(instrument.role, section, motifs, scale, speed, randomness, seed + index * 37);
    const segment = {
      name: `${section.label} · ${instrument.role}`,
      startBeat,
      lengthBeats: section.lengthBeats,
      repeats: 0,
      notes: fitNotesToRange(source, instrument.pitchRange),
      sectionIds: [section.id],
      gainDb: roundBeat(-8 + section.energy * 6),
    };
    startBeat += section.lengthBeats;
    return segment;
  });
  return {
    role: instrument.role,
    texture: instrument.texture,
    pitchRange: instrument.pitchRange,
    instrument,
    segments: compactAdjacentIdenticalSections(raw),
  };
}

function notesForRole(
  role: VoiceRole,
  section: SongSectionPlan,
  motifs: Record<"A" | "B" | "C", MidiNote[]>,
  scale: number[],
  speed: SongSpeed,
  randomness: SongRandomness,
  seed: number,
): MidiNote[] {
  const motif = motifs[section.material];
  const varied = variationForMotif(motif, section.variation, scale);
  const shifted = reshapeSectionNotes(varied, section, scale);
  if (role === "lead") return applyLeadExpression(shifted, scale, speed, randomness, seed);
  const harmony = reshapeSectionNotes(harmonizeMelody(motif, scale), section, scale);
  if (role === "harmony") return accompanimentFromHarmony(harmony, speed, section.lengthBeats);
  if (role === "bass") return bassFromHarmony(harmony, speed, section.lengthBeats);
  if (role === "countermelody") {
    if (section.energy < 0.68) return [];
    const counter = simplifyMelody(invertMelody(motif, motif[0]?.pitch ?? scale[0])).map((note) => ({
      ...note,
      startBeat: (note.startBeat + Math.max(2, section.lengthBeats / 2)) % section.lengthBeats,
      lengthBeats: Math.min(note.lengthBeats, speed === "passive" ? 2 : 0.65),
    }));
    return reshapeSectionNotes(counter, section, scale);
  }
  return [];
}

function variationForMotif(notes: MidiNote[], variation: MelodyVariationKind, scale: number[]): MidiNote[] {
  if (variation === "chords") return harmonizeMelody(notes, scale);
  if (variation === "extrapolation") return extrapolateMelody(notes, scale);
  if (variation === "inversion") return invertMelody(notes, notes[0]?.pitch ?? scale[0]);
  if (variation === "simplification") return simplifyMelody(notes);
  if (variation === "complication") return complicateMelody(notes, scale);
  return notes.map((note) => ({ ...note }));
}

function reshapeSectionNotes(notes: MidiNote[], section: SongSectionPlan, scale: number[]): MidiNote[] {
  const shifted = notes.map((note) => ({
    ...note,
    pitch: nearestScalePitch(note.pitch + section.keyShiftSemitones, scale.map((pitch) => pitch + section.keyShiftSemitones)),
    velocity: clamp(Math.round(note.velocity * (0.72 + section.energy * 0.35)), 1, 127),
  }));
  if (section.rhythmMultiplier === 1) return shifted.filter((note) => note.startBeat < section.lengthBeats);
  if (section.rhythmMultiplier < 1) {
    return shifted
      .map((note) => ({ ...note, startBeat: roundBeat(note.startBeat * 2), lengthBeats: roundBeat(note.lengthBeats * 1.7) }))
      .filter((note) => note.startBeat < section.lengthBeats);
  }
  const compressed = shifted.map((note) => ({
    ...note,
    startBeat: roundBeat(note.startBeat / section.rhythmMultiplier),
    lengthBeats: roundBeat(note.lengthBeats / section.rhythmMultiplier),
  }));
  return [0, section.lengthBeats / 2].flatMap((offset) => compressed.map((note) => ({ ...note, startBeat: note.startBeat + offset })))
    .filter((note) => note.startBeat < section.lengthBeats);
}

function applySpeedToMelody(notes: MidiNote[], scale: number[], speed: SongSpeed): MidiNote[] {
  if (speed === "passive") return simplifyMelody(notes).map((note) => ({ ...note, lengthBeats: Math.min(6, note.lengthBeats * 2.2) }));
  if (speed === "slow") return notes.map((note) => ({ ...note, lengthBeats: Math.min(3, note.lengthBeats * 1.35) }));
  if (speed === "medium") return notes;
  const complicated = complicateMelody(notes, scale);
  if (speed === "fast") return complicated;
  return complicated.flatMap((note, index) => {
    if (note.lengthBeats < 0.25 || index % 3 !== 0) return [note];
    const half = Math.max(1 / 32, roundBeat(note.lengthBeats / 2));
    return [
      { ...note, lengthBeats: half },
      { ...note, pitch: nearestScalePitch(note.pitch + (index % 2 ? -2 : 2), scale), startBeat: roundBeat(note.startBeat + half), lengthBeats: half, velocity: Math.max(42, note.velocity - 12) },
    ];
  });
}

function applyLeadExpression(
  notes: MidiNote[],
  scale: number[],
  speed: SongSpeed,
  randomness: SongRandomness,
  seed: number,
): MidiNote[] {
  const speedShaped = applySpeedToMelody(notes, scale, speed);
  if (randomness === "low") return speedShaped;
  const rnd = seededRandom(seed + 3571);
  const durationShapes = randomness === "high" ? [0.52, 0.68, 0.84, 1, 1.18, 1.36] : [0.72, 0.88, 1, 1.16];
  return speedShaped.map((note, index) => {
    const shape = durationShapes[Math.floor(rnd() * durationShapes.length)] ?? 1;
    const movePitch = randomness === "high" ? rnd() < 0.24 : rnd() < 0.1;
    const pitchDirection = index % 2 === 0 ? 2 : -2;
    return {
      ...note,
      pitch: movePitch ? nearestScalePitch(note.pitch + pitchDirection, scale) : note.pitch,
      lengthBeats: Math.max(1 / 64, roundBeat(note.lengthBeats * shape)),
      velocity: clamp(note.velocity + Math.round((rnd() - 0.5) * (randomness === "high" ? 18 : 10)), 1, 127),
    };
  });
}

/** Repeats one articulation cell for every chord instead of inventing a second melody. */
function accompanimentFromHarmony(chords: MidiNote[], speed: SongSpeed, sectionLengthBeats = SECTION_BEATS): MidiNote[] {
  const groups = groupNotesByStart(chords);
  const ratios = speed === "passive" || speed === "slow"
    ? [0]
    : speed === "medium" ? [0, 0.5]
      : speed === "fast" ? [0, 0.25, 0.5, 0.75]
        : [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
  const durationRatio = speed === "passive" ? 0.92 : speed === "slow" ? 0.8 : speed === "medium" ? 0.34 : speed === "fast" ? 0.17 : 0.075;
  return groups.flatMap((group, index) => {
    const nextStart = groups[index + 1]?.startBeat ?? sectionLengthBeats;
    const window = Math.max(1 / 16, nextStart - group.startBeat);
    return ratios.flatMap((ratio, articulationIndex) => group.notes.map((note) => ({
      ...note,
      startBeat: roundBeat(group.startBeat + window * ratio),
      lengthBeats: Math.max(1 / 64, roundBeat(window * durationRatio)),
      velocity: clamp(note.velocity + (articulationIndex === 0 ? 4 : -8), 1, 127),
    })));
  });
}

function compactAdjacentIdenticalSections(segments: PlannedMidiSegment[]): PlannedMidiSegment[] {
  const result: PlannedMidiSegment[] = [];
  for (const segment of segments) {
    const previous = result[result.length - 1];
    if (previous && notesEqual(previous.notes, segment.notes) && previous.startBeat + previous.lengthBeats * (previous.repeats + 1) === segment.startBeat) {
      previous.repeats += 1;
      previous.sectionIds.push(...segment.sectionIds);
      continue;
    }
    result.push({ ...segment, notes: segment.notes.map((note) => ({ ...note })), sectionIds: [...segment.sectionIds] });
  }
  return result;
}

function notesEqual(a: MidiNote[], b: MidiNote[]) {
  if (a.length !== b.length) return false;
  return a.every((note, index) => {
    const other = b[index];
    return other && note.pitch === other.pitch && note.velocity === other.velocity
      && note.startBeat === other.startBeat && note.lengthBeats === other.lengthBeats;
  });
}

/** Coalesces repeated chord roots before articulation so repeated attacks remain one harmonic pitch span. */
export function deriveBassHarmonicSpans(chords: MidiNote[], sectionLengthBeats = SECTION_BEATS): BassHarmonicSpan[] {
  const groups = groupNotesByStart(chords);
  const spans: BassHarmonicSpan[] = [];
  groups.forEach((group, index) => {
    const root = group.notes.reduce((lowest, note) => note.pitch < lowest.pitch ? note : lowest);
    const endBeat = groups[index + 1]?.startBeat ?? sectionLengthBeats;
    const previous = spans[spans.length - 1];
    if (previous && previous.pitch === root.pitch && Math.abs(previous.startBeat + previous.lengthBeats - group.startBeat) < 1e-6) {
      previous.lengthBeats = roundBeat(endBeat - previous.startBeat);
      previous.velocity = Math.max(previous.velocity, root.velocity);
      return;
    }
    spans.push({ pitch: root.pitch, startBeat: group.startBeat, lengthBeats: roundBeat(endBeat - group.startBeat), velocity: root.velocity });
  });
  return spans;
}

function bassFromHarmony(chords: MidiNote[], speed: SongSpeed, sectionLengthBeats: number): MidiNote[] {
  return articulateBassHarmonicSpans(deriveBassHarmonicSpans(chords, sectionLengthBeats), speed);
}

/** Applies a fixed repeating rhythm without changing the underlying harmonic pitch choice. */
export function articulateBassHarmonicSpans(spans: BassHarmonicSpan[], speed: SongSpeed): MidiNote[] {
  if (speed === "passive") return spans.map((span) => midiNote(
    span.pitch - 12,
    Math.max(82, span.velocity + 8),
    span.startBeat,
    span.lengthBeats * 0.94,
  ));
  const offsets = speed === "slow" ? [0]
    : speed === "medium" ? [0, 2.5]
      : speed === "fast" ? [0, 1, 2, 3]
        : [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
  const noteLength = speed === "slow" ? 3.35 : speed === "medium" ? 1.55 : speed === "fast" ? 0.74 : 0.34;
  return spans.flatMap((span) => {
    const notes: MidiNote[] = [];
    const spanEnd = span.startBeat + span.lengthBeats;
    for (let cellStart = span.startBeat; cellStart < spanEnd; cellStart += 4) {
      offsets.forEach((offset, index) => {
        const startBeat = cellStart + offset;
        if (startBeat >= spanEnd) return;
        notes.push(midiNote(
          span.pitch - 12,
          index === 0 ? Math.max(88, span.velocity + 14) : Math.max(62, span.velocity - 6),
          startBeat,
          Math.min(noteLength, spanEnd - startBeat),
        ));
      });
    }
    return notes;
  });
}

function groupNotesByStart(notes: MidiNote[]) {
  const grouped = new Map<number, MidiNote[]>();
  for (const note of notes) grouped.set(note.startBeat, [...(grouped.get(note.startBeat) ?? []), note]);
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([startBeat, groupedNotes]) => ({ startBeat, notes: groupedNotes }));
}

function fitNotesToRange(notes: MidiNote[], range: [number, number]): MidiNote[] {
  return notes.map((note) => {
    let pitch = note.pitch;
    while (pitch < range[0]) pitch += 12;
    while (pitch > range[1]) pitch -= 12;
    return { ...note, pitch: clampMidi(clamp(pitch, range[0], range[1])) };
  });
}

function instrumentRequirements(genre: SongGenre): InstrumentRequirement[] {
  const identities: Record<SongGenre, { bass: string; harmony: string; lead: string; counter: string }> = {
    pop: { bass: "Elastic Pop Bass", harmony: "Wide Pop Keys", lead: "Bright Vocal Lead", counter: "Glass Hook Pluck" },
    rap: { bass: "Sliding 808 Bass", harmony: "Dark Rap Keys", lead: "Sparse Rap Lead", counter: "Bell Countermotif" },
    dnb: { bass: "Reese Bass", harmony: "Air Pad", lead: "DNB Signal Lead", counter: "Rapid Glass Arp" },
    jazz: { bass: "Upright Bass", harmony: "Warm Jazz Keys", lead: "Tenor Sax", counter: "Vibraphone Countervoice" },
    reggae: { bass: "Deep Reggae Bass", harmony: "Bubble Organ", lead: "Reggae Horn Lead", counter: "Skank Guitar" },
    classical: { bass: "Cello Bass Voice", harmony: "String Ensemble", lead: "Solo Violin", counter: "Pizzicato Countervoice" },
    electronic: { bass: "Electronic Sub Bass", harmony: "Motion Pad", lead: "Aether Synth Lead", counter: "Sequenced Pluck" },
  };
  const names = identities[genre];
  const acoustic = genre === "jazz" || genre === "classical";
  return [
    {
      role: "bass", preferredName: names.bass, texture: "rounded-bass", pitchRange: [36, 51],
      libraryQueries: [names.bass, "bass", "sub"],
      fallback: { waveform: genre === "dnb" ? "saw" : "sine", attackMs: 8, releaseMs: genre === "classical" ? 440 : 180, cutoff: genre === "dnb" ? 0.58 : 0.38, resonance: 0.12, drive: genre === "rap" || genre === "dnb" ? 0.18 : 0.08 },
    },
    {
      role: "harmony", preferredName: names.harmony, texture: "sustained-pad", pitchRange: [48, 65],
      libraryQueries: [names.harmony, "pad", "keys", "chords"],
      fallback: { waveform: "wavetable", attackMs: acoustic ? 18 : 42, releaseMs: genre === "classical" ? 980 : 620, cutoff: 0.55, resonance: 0.18, drive: 0.05 },
    },
    {
      role: "lead", preferredName: names.lead, texture: "reed", pitchRange: [60, 77],
      libraryQueries: [names.lead, "lead", "voice", "reed"],
      fallback: { waveform: genre === "classical" ? "triangle" : "saw", attackMs: acoustic ? 18 : 6, releaseMs: genre === "reggae" ? 160 : 240, cutoff: 0.47, resonance: 0.28, drive: genre === "electronic" ? 0.2 : 0.12 },
      ...(acoustic ? { acquisition: { provider: "VSCO 2 CE" as const, format: "SFZ" as const, license: "CC0-1.0" as const, url: "https://github.com/sgossner/VSCO-2-CE/releases/tag/1.1.0" } } : {}),
    },
    {
      role: "countermelody", preferredName: names.counter, texture: "plucked", pitchRange: [72, 89],
      libraryQueries: [names.counter, "pluck", "mallet", "pizzicato"],
      fallback: { waveform: "triangle", attackMs: 2, releaseMs: genre === "classical" ? 180 : 115, cutoff: 0.68, resonance: 0.22, drive: 0.04 },
    },
  ];
}

function percussionPlan(genre: SongGenre, speed: SongSpeed, randomness: SongRandomness): GeneratedSongPlan["percussion"] {
  if (speed === "passive" || genre === "classical") return undefined;
  const mapping: Record<Exclude<SongGenre, "classical">, NonNullable<GeneratedSongPlan["percussion"]>["genre"]> = {
    pop: "pop",
    rap: "rap",
    dnb: "dnb",
    jazz: "jazz",
    reggae: "reggae",
    electronic: "house",
  };
  return {
    name: genre === "jazz" ? "Jazz Ride and Brush Groove" : genre === "dnb" ? "Chopped Break Groove" : `${genre[0].toUpperCase()}${genre.slice(1)} Drum Groove`,
    genre: mapping[genre as Exclude<SongGenre, "classical">],
    complexity: randomness === "low" ? 34 : randomness === "medium" ? 52 : 72,
  };
}

function scaleForKey(key: string) {
  const match = key.match(/\b([A-G](?:#|b)?)(?:\s+(minor|major))?/i);
  const root = noteNameToMidi(match?.[1] ?? "C");
  const intervals = (match?.[2] ?? "minor").toLowerCase() === "major" ? MAJOR_SCALE : MINOR_SCALE;
  return intervals.map((interval) => root + interval);
}

function nearestScalePitch(pitch: number, scale: number[]) {
  let best = scale[0];
  let distance = Number.POSITIVE_INFINITY;
  for (let octave = -3; octave <= 3; octave += 1) {
    for (const scalePitch of scale) {
      const candidate = scalePitch + octave * 12;
      const nextDistance = Math.abs(candidate - pitch);
      if (nextDistance < distance) {
        best = candidate;
        distance = nextDistance;
      }
    }
  }
  return clampMidi(best);
}

function noteNameToMidi(name: string) {
  const normalized = name.length > 1 ? `${name[0].toUpperCase()}${name.slice(1)}` : name.toUpperCase();
  const roots: Record<string, number> = { C: 60, "C#": 61, Db: 61, D: 62, "D#": 63, Eb: 63, E: 64, F: 65, "F#": 66, Gb: 66, G: 67, "G#": 68, Ab: 68, A: 69, "A#": 70, Bb: 70, B: 71 };
  return roots[normalized] ?? 60;
}

function keyFromText(text: string) {
  return text.match(/\b([A-G](?:#|b)?\s+(?:major|minor))\b/i)?.[1];
}

function inferGenre(style: string): SongGenre {
  const lower = style.toLowerCase();
  if (/\brap|hip.?hop|trap\b/.test(lower)) return "rap";
  if (/\bdnb|drum and bass|jungle\b/.test(lower)) return "dnb";
  if (/\bjazz|swing|bebop\b/.test(lower)) return "jazz";
  if (/\breggae|dub|one.drop\b/.test(lower)) return "reggae";
  if (/\bclassical|orchestra|chamber|symph/.test(lower)) return "classical";
  if (/\belectronic|house|techno|ambient|synth/.test(lower)) return "electronic";
  return "pop";
}

function bpmForSpeed(baseBpm: number, speed: SongSpeed) {
  if (speed === "passive") return 62;
  if (speed === "slow") return baseBpm * 0.76;
  if (speed === "medium") return baseBpm;
  if (speed === "fast") return baseBpm * 1.18;
  return Math.max(184, baseBpm * 1.42);
}

function generatedSongName(style: string, form: SongFormId) {
  const title = style.split(/\s+/).filter(Boolean).slice(0, 4).map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
  return `${title || "Generated"} · ${form.toUpperCase()}`;
}

function midiNote(pitch: number, velocity: number, startBeat: number, lengthBeats: number): MidiNote {
  return { pitch: clampMidi(pitch), velocity: clamp(Math.round(velocity), 1, 127), startBeat: roundBeat(startBeat), lengthBeats: Math.max(1 / 64, roundBeat(lengthBeats)) };
}

function roundBeat(value: number) {
  return Math.round(value * 192) / 192;
}

function clampMidi(value: number) {
  return clamp(Math.round(value), 0, 127);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = Math.max(1, seed % 2147483647);
  return () => {
    state = state * 48271 % 2147483647;
    return state / 2147483647;
  };
}
