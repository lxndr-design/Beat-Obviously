import type { MidiArpeggiationSequence, MidiNote, TimeSignature } from "../../state/types";

export type MidiRemixKind = "arpeggio" | "melodic-loop" | "bassline" | "chord-progression" | "melody-motif";

export type MidiRemixVariation =
  | "arp-sequence"
  | "arp-inversion"
  | "arp-seventh"
  | "loop-inversion"
  | "loop-harmony"
  | "loop-swing"
  | "bass-harmony"
  | "bass-two-note-arp"
  | "bass-rhythm"
  | "chord-inversion"
  | "chord-seventh"
  | "chord-rhythm"
  | "melody-inversion"
  | "melody-harmony"
  | "melody-multivoice"
  | "melody-swing";

export interface MidiRemixContext {
  segmentName?: string;
  trackName?: string;
  instrumentName?: string;
}

export interface MidiChordObservation {
  startBeat: number;
  endBeat: number;
  label: string;
  rootPitchClass: number;
  quality: ChordQuality;
  pitchClasses: number[];
}

export interface MidiMotifObservation {
  startBeat: number;
  endBeat: number;
  repeated: boolean;
  noteCount: number;
}

export interface MidiRemixAnalysis {
  kind: MidiRemixKind;
  label: string;
  confidence: number;
  summary: string;
  evidence: string[];
  chords: MidiChordObservation[];
  motif?: MidiMotifObservation;
  measureBeats: number;
  noteCount: number;
}

export interface MidiRemixOption {
  value: MidiRemixVariation;
  label: string;
  description: string;
}

export interface MidiRemixResult {
  notes: MidiNote[];
  changedNoteCount: number;
  addedNoteCount: number;
}

type ChordQuality = "root" | "power" | "major" | "minor" | "diminished" | "augmented" | "sus2" | "sus4" | "dominant7" | "major7" | "minor7" | "half-diminished7";

const BEAT_PRECISION = 1_000_000;
const ONSET_PRECISION = 64;
const PITCH_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const CHORD_TEMPLATES: Array<{ quality: Exclude<ChordQuality, "root" | "power">; intervals: number[]; suffix: string }> = [
  { quality: "major7", intervals: [0, 4, 7, 11], suffix: "maj7" },
  { quality: "dominant7", intervals: [0, 4, 7, 10], suffix: "7" },
  { quality: "minor7", intervals: [0, 3, 7, 10], suffix: "m7" },
  { quality: "half-diminished7", intervals: [0, 3, 6, 10], suffix: "m7♭5" },
  { quality: "major", intervals: [0, 4, 7], suffix: "" },
  { quality: "minor", intervals: [0, 3, 7], suffix: "m" },
  { quality: "diminished", intervals: [0, 3, 6], suffix: "dim" },
  { quality: "augmented", intervals: [0, 4, 8], suffix: "aug" },
  { quality: "sus2", intervals: [0, 2, 7], suffix: "sus2" },
  { quality: "sus4", intervals: [0, 5, 7], suffix: "sus4" },
];

const OPTIONS: Record<MidiRemixKind, MidiRemixOption[]> = {
  arpeggio: [
    { value: "arp-sequence", label: "Change sequence", description: "Reorders only the pitches already present in each chord." },
    { value: "arp-inversion", label: "Invert voicing", description: "Moves the lowest chord tone up one octave while keeping the chord identity." },
    { value: "arp-seventh", label: "Add a seventh", description: "Extends each recognized chord with a compatible seventh tone." },
  ],
  "melodic-loop": [
    { value: "loop-inversion", label: "Invert contour", description: "Mirrors the loop contour inside its existing pitch vocabulary." },
    { value: "loop-harmony", label: "Add harmony", description: "Keeps the loop and adds a quieter supporting voice." },
    { value: "loop-swing", label: "Add light swing", description: "Leans offbeats without changing the pitch sequence." },
  ],
  bassline: [
    { value: "bass-harmony", label: "Add harmony", description: "Keeps every bass note and adds a restrained fifth above it." },
    { value: "bass-two-note-arp", label: "Two-note arpeggiation", description: "Alternates each harmonic span between its root and fifth." },
    { value: "bass-rhythm", label: "Vary rhythm", description: "Adds syncopation and articulation while preserving the bass pitches." },
  ],
  "chord-progression": [
    { value: "chord-inversion", label: "Invert voicings", description: "Rotates alternating chord voicings without changing their roots or quality." },
    { value: "chord-seventh", label: "Add sevenths", description: "Adds a compatible seventh to each recognized chord." },
    { value: "chord-rhythm", label: "Rhythmic comp", description: "Turns sustained chords into a related two-hit comping pattern." },
  ],
  "melody-motif": [
    { value: "melody-inversion", label: "Invert motif", description: "Mirrors the detected motif while retaining its rhythm and pitch vocabulary." },
    { value: "melody-harmony", label: "Add harmony", description: "Keeps the melody intact and adds a quieter chord-aware voice." },
    { value: "melody-multivoice", label: "Create multivoice", description: "Adds sparse octave and fifth support on structurally strong notes." },
    { value: "melody-swing", label: "Add light swing", description: "Preserves the melody and gently delays its offbeats." },
  ],
};

export function midiRemixOptions(kind: MidiRemixKind): MidiRemixOption[] {
  return OPTIONS[kind].map((option) => ({ ...option }));
}

export function analyzeMidiForRemix(
  notes: MidiNote[],
  segmentLengthBeats: number,
  timeSignature: TimeSignature,
  context: MidiRemixContext = {},
): MidiRemixAnalysis {
  const sorted = validNotes(notes);
  const measureBeats = Math.max(1, timeSignature.num * (4 / timeSignature.denom));
  const groups = onsetGroups(sorted);
  const firstBeat = sorted[0]?.startBeat ?? 0;
  const lastBeat = sorted.reduce((end, note) => Math.max(end, note.startBeat + note.lengthBeats), firstBeat);
  const activeSpan = Math.max(1 / 16, lastBeat - firstBeat);
  const pitches = sorted.map((note) => note.pitch).sort((a, b) => a - b);
  const medianPitch = pitches[Math.floor(pitches.length / 2)] ?? 60;
  const pitchRange = pitches.length > 0 ? pitches[pitches.length - 1] - pitches[0] : 0;
  const polyphonicGroupCount = groups.filter((group) => group.notes.length >= 2).length;
  const polyphonicRatio = groups.length > 0 ? polyphonicGroupCount / groups.length : 0;
  const density = sorted.length / activeSpan;
  const uniquePitchClasses = new Set(sorted.map((note) => pitchClass(note.pitch))).size;
  const repeatedMotif = findRepeatedMotif(sorted);
  const phraseMotif = repeatedMotif ?? findPrimaryPhrase(sorted, measureBeats, segmentLengthBeats);
  const rhythmRegularity = onsetRegularity(groups.map((group) => group.startBeat));
  const hasArpeggiationModifier = sorted.some((note) => Boolean(note.groupId && note.arpeggiation));
  const contextText = `${context.segmentName ?? ""} ${context.trackName ?? ""} ${context.instrumentName ?? ""}`.toLowerCase();
  const chordCoverage = harmonicCoverage(sorted, measureBeats);
  const shortMaterial = segmentLengthBeats <= measureBeats * 2 + 1e-6 || activeSpan <= measureBeats * 2 + 1e-6;

  const scores: Record<MidiRemixKind, number> = {
    arpeggio: (hasArpeggiationModifier ? 8 : 0)
      + (polyphonicRatio < 0.25 ? 1.5 : -1)
      + (density >= 1.25 ? 1.5 : 0)
      + (uniquePitchClasses >= 3 && uniquePitchClasses <= 5 ? 1.25 : 0)
      + (chordCoverage >= 0.65 ? 1.5 : 0)
      + (rhythmRegularity >= 0.65 ? 1 : 0)
      + (/arp|arpegg/.test(contextText) ? 3 : 0),
    "melodic-loop": (shortMaterial ? 1.5 : 0)
      + (repeatedMotif?.repeated ? 3 : 0)
      + (polyphonicRatio < 0.2 ? 1 : 0)
      + (uniquePitchClasses >= 2 ? 0.5 : 0)
      + (/loop|riff|ostinato|sequence/.test(contextText) ? 2.5 : 0),
    bassline: (medianPitch <= 52 ? 3 : medianPitch <= 58 ? 1 : -1)
      + (polyphonicRatio < 0.2 ? 1 : 0)
      + (pitchRange <= 24 ? 0.75 : 0)
      + (/bass|sub|808|cello bass/.test(contextText) ? 3 : 0),
    "chord-progression": (polyphonicRatio >= 0.45 ? 4 : polyphonicRatio >= 0.2 ? 2 : 0)
      + (polyphonicGroupCount >= 2 ? 1.5 : 0)
      + (median(sorted.map((note) => note.lengthBeats)) >= 1 ? 0.75 : 0)
      + (/chord|harmony|pad|keys|progression/.test(contextText) ? 2.5 : 0),
    "melody-motif": 2
      + (pitchRange >= 7 ? 1 : 0)
      + (polyphonicRatio < 0.25 ? 1 : 0)
      + (!shortMaterial ? 1 : 0)
      + (/melody|lead|bridge|theme|motif|vocal/.test(contextText) ? 3 : 0),
  };
  if (hasArpeggiationModifier) scores.arpeggio += 20;
  const ranked = (Object.entries(scores) as Array<[MidiRemixKind, number]>).sort((a, b) => b[1] - a[1]);
  const kind = ranked[0]?.[0] ?? "melody-motif";
  const margin = (ranked[0]?.[1] ?? 0) - (ranked[1]?.[1] ?? 0);
  const confidence = clamp(0.58 + margin * 0.07, 0.58, 0.96);
  const chords = recognizeHarmony(sorted, measureBeats, kind);
  const motif = kind === "melody-motif" || kind === "melodic-loop" ? phraseMotif : undefined;
  const label = remixKindLabel(kind, contextText);
  const evidence = analysisEvidence({
    kind,
    density,
    medianPitch,
    polyphonicRatio,
    shortMaterial,
    rhythmRegularity,
    hasArpeggiationModifier,
    motif,
    measureBeats,
  });
  return {
    kind,
    label,
    confidence,
    summary: analysisSummary(kind, motif, chords),
    evidence,
    chords,
    motif,
    measureBeats,
    noteCount: sorted.length,
  };
}

export function remixMidiNotes(
  notes: MidiNote[],
  analysis: MidiRemixAnalysis,
  variation: MidiRemixVariation,
  segmentLengthBeats: number,
): MidiRemixResult {
  const source = notes.map((note) => structuredClone(note));
  let next: MidiNote[];
  switch (variation) {
    case "arp-sequence": next = changeArpeggioSequence(source, analysis); break;
    case "arp-inversion": next = invertHarmonicVoicing(source, analysis, false); break;
    case "arp-seventh": next = addChordSevenths(source, analysis, true); break;
    case "loop-inversion":
    case "melody-inversion": next = invertMotifContour(source, analysis); break;
    case "loop-harmony":
    case "melody-harmony": next = addMelodyHarmony(source, analysis); break;
    case "loop-swing":
    case "melody-swing": next = addLightSwing(source); break;
    case "bass-harmony": next = addBassHarmony(source); break;
    case "bass-two-note-arp": next = createTwoNoteBassArpeggiation(source); break;
    case "bass-rhythm": next = varyBassRhythm(source, analysis.measureBeats); break;
    case "chord-inversion": next = invertHarmonicVoicing(source, analysis, true); break;
    case "chord-seventh": next = addChordSevenths(source, analysis, false); break;
    case "chord-rhythm": next = createChordComping(source, analysis); break;
    case "melody-multivoice": next = createMelodyMultivoice(source, analysis); break;
    default: next = source;
  }
  const sanitized = sanitizeResult(next, segmentLengthBeats);
  return {
    notes: sanitized,
    changedNoteCount: countChangedNotes(source, sanitized),
    addedNoteCount: Math.max(0, sanitized.length - source.length),
  };
}

function changeArpeggioSequence(notes: MidiNote[], analysis: MidiRemixAnalysis): MidiNote[] {
  if (notes.some((note) => note.groupId && note.arpeggiation)) {
    const nextSequence: Record<MidiArpeggiationSequence, MidiArpeggiationSequence> = {
      up: "down",
      down: "up-down",
      "up-down": "down-up",
      "down-up": "played",
      played: "up",
    };
    return notes.map((note) => note.arpeggiation
      ? { ...note, arpeggiation: { ...note.arpeggiation, sequence: nextSequence[note.arpeggiation.sequence] } }
      : note);
  }
  const result = notes.map((note) => ({ ...note }));
  for (const chord of analysis.chords) {
    const indices = result
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => note.startBeat >= chord.startBeat - 1e-6 && note.startBeat < chord.endBeat - 1e-6)
      .sort((a, b) => a.note.startBeat - b.note.startBeat || a.note.pitch - b.note.pitch);
    const pitchPool = [...new Set(indices.map(({ note }) => note.pitch))].sort((a, b) => b - a);
    if (pitchPool.length < 2) continue;
    indices.forEach(({ note, index }, sequenceIndex) => {
      result[index] = transposeNote(note, pitchPool[sequenceIndex % pitchPool.length]);
    });
  }
  return result;
}

function invertHarmonicVoicing(notes: MidiNote[], analysis: MidiRemixAnalysis, alternating: boolean): MidiNote[] {
  const result = notes.map((note) => ({ ...note }));
  analysis.chords.forEach((chord, chordIndex) => {
    if (alternating && chordIndex % 2 === 0) return;
    const indices = result
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => note.startBeat >= chord.startBeat - 1e-6 && note.startBeat < chord.endBeat - 1e-6);
    const lowest = indices.reduce((value, item) => Math.min(value, item.note.pitch), 128);
    const lowestClass = pitchClass(lowest);
    for (const { note, index } of indices) {
      if (pitchClass(note.pitch) === lowestClass) result[index] = transposeNote(note, note.pitch + 12);
    }
  });
  return result;
}

function addChordSevenths(notes: MidiNote[], analysis: MidiRemixAnalysis, arpeggiated: boolean): MidiNote[] {
  const additions: MidiNote[] = [];
  for (const chord of analysis.chords) {
    const windowNotes = notes.filter((note) => note.startBeat >= chord.startBeat - 1e-6 && note.startBeat < chord.endBeat - 1e-6);
    if (windowNotes.length === 0) continue;
    const seventhClass = pitchClass(chord.rootPitchClass + seventhInterval(chord.quality));
    if (chord.pitchClasses.includes(seventhClass)) continue;
    const reference = windowNotes[windowNotes.length - 1];
    const targetPitch = pitchNear(seventhClass, median(windowNotes.map((note) => note.pitch)) + 3);
    let startBeat = arpeggiated ? reference.startBeat + medianOnsetStep(windowNotes) : windowNotes[0].startBeat;
    startBeat = Math.min(Math.max(chord.startBeat, startBeat), Math.max(chord.startBeat, chord.endBeat - Math.max(1 / 16, reference.lengthBeats)));
    const added = derivedNote(reference, targetPitch, startBeat, Math.min(reference.lengthBeats, chord.endBeat - startBeat), 0.82);
    if (arpeggiated && reference.groupId && reference.arpeggiation) {
      added.groupId = reference.groupId;
      added.arpeggiation = { ...reference.arpeggiation };
    }
    additions.push(added);
  }
  return [...notes, ...additions];
}

function invertMotifContour(notes: MidiNote[], analysis: MidiRemixAnalysis): MidiNote[] {
  const motif = analysis.motif;
  if (!motif) return notes;
  const motifNotes = notes.filter((note) => note.startBeat >= motif.startBeat - 1e-6 && note.startBeat < motif.endBeat - 1e-6);
  const axis = motifNotes[0]?.pitch ?? median(notes.map((note) => note.pitch));
  const vocabulary = [...new Set(notes.map((note) => pitchClass(note.pitch)))];
  return notes.map((note) => {
    if (note.startBeat < motif.startBeat - 1e-6 || note.startBeat >= motif.endBeat - 1e-6) return note;
    const mirrored = axis - (note.pitch - axis);
    return transposeNote(note, nearestVocabularyPitch(mirrored, vocabulary));
  });
}

function addMelodyHarmony(notes: MidiNote[], analysis: MidiRemixAnalysis): MidiNote[] {
  const motif = analysis.motif;
  const vocabulary = [...new Set(notes.map((note) => pitchClass(note.pitch)))];
  const candidates = notes.filter((note) => !motif || (note.startBeat >= motif.startBeat - 1e-6 && note.startBeat < motif.endBeat - 1e-6));
  const additions = candidates.map((note) => {
    const chord = chordAtBeat(analysis.chords, note.startBeat);
    const interval = chord && /minor|diminished/.test(chord.quality) ? -3 : -4;
    return derivedNote(note, nearestVocabularyPitch(note.pitch + interval, vocabulary), note.startBeat, note.lengthBeats * 0.94, 0.68);
  });
  return [...notes, ...additions];
}

function createMelodyMultivoice(notes: MidiNote[], analysis: MidiRemixAnalysis): MidiNote[] {
  const motif = analysis.motif;
  const candidates = notes.filter((note, index) => {
    const inMotif = !motif || (note.startBeat >= motif.startBeat - 1e-6 && note.startBeat < motif.endBeat - 1e-6);
    const structurallyStrong = nearGrid(note.startBeat, analysis.measureBeats / 2) || note.lengthBeats >= 1 || index % 4 === 0;
    return inMotif && structurallyStrong;
  });
  return [
    ...notes,
    ...candidates.map((note, index) => derivedNote(note, note.pitch + (index % 2 === 0 ? -12 : 7), note.startBeat, note.lengthBeats, 0.58)),
  ];
}

function addLightSwing(notes: MidiNote[]): MidiNote[] {
  return notes.map((note) => {
    const eighthIndex = Math.round(note.startBeat * 2);
    if (eighthIndex % 2 === 0 || Math.abs(note.startBeat * 2 - eighthIndex) > 0.04) return note;
    const delay = 1 / 12;
    return {
      ...note,
      startBeat: roundBeat(note.startBeat + delay),
      lengthBeats: Math.max(1 / 64, roundBeat(note.lengthBeats - Math.min(delay, note.lengthBeats * 0.2))),
      curve: shiftCurve(note.curve, delay),
      automation: shiftAutomation(note, delay),
    };
  });
}

function addBassHarmony(notes: MidiNote[]): MidiNote[] {
  return [...notes, ...notes.map((note) => derivedNote(note, note.pitch + 7, note.startBeat, note.lengthBeats * 0.92, 0.58))];
}

function createTwoNoteBassArpeggiation(notes: MidiNote[]): MidiNote[] {
  return notes.flatMap((note, index) => {
    if (note.lengthBeats < 0.5) return [transposeNote(note, note.pitch + (index % 2 === 0 ? 0 : 7))];
    const half = Math.max(1 / 16, roundBeat(note.lengthBeats / 2));
    return [
      { ...note, lengthBeats: half, connectToIndex: undefined },
      derivedNote(note, note.pitch + 7, note.startBeat + half, Math.max(1 / 16, note.lengthBeats - half), 0.86),
    ];
  });
}

function varyBassRhythm(notes: MidiNote[], measureBeats: number): MidiNote[] {
  return notes.flatMap((note, index) => {
    if (note.lengthBeats >= 1.5) {
      const firstLength = roundBeat(note.lengthBeats * 0.58);
      const secondStart = roundBeat(note.startBeat + note.lengthBeats * 0.7);
      return [
        { ...note, lengthBeats: firstLength, connectToIndex: undefined },
        derivedNote(note, note.pitch, secondStart, Math.max(1 / 16, note.startBeat + note.lengthBeats - secondStart), 0.78),
      ];
    }
    if (index % 2 === 1 && !nearGrid(note.startBeat, measureBeats)) {
      const shift = Math.min(0.125, note.lengthBeats * 0.2);
      return [{ ...note, startBeat: roundBeat(note.startBeat + shift), curve: shiftCurve(note.curve, shift), automation: shiftAutomation(note, shift) }];
    }
    return [note];
  });
}

function createChordComping(notes: MidiNote[], analysis: MidiRemixAnalysis): MidiNote[] {
  const result: MidiNote[] = [];
  for (const chord of analysis.chords) {
    const windowNotes = notes.filter((note) => note.startBeat >= chord.startBeat - 1e-6 && note.startBeat < chord.endBeat - 1e-6);
    if (windowNotes.length === 0) continue;
    const onset = Math.min(...windowNotes.map((note) => note.startBeat));
    const windowLength = Math.max(1 / 4, chord.endBeat - onset);
    const hitLength = Math.max(1 / 16, roundBeat(windowLength * 0.36));
    for (const note of windowNotes) {
      result.push({ ...note, lengthBeats: Math.min(note.lengthBeats, hitLength), connectToIndex: undefined });
      result.push(derivedNote(note, note.pitch, onset + windowLength * 0.58, Math.min(hitLength, windowLength * 0.34), 0.76));
    }
  }
  return result.length > 0 ? result : notes;
}

function recognizeHarmony(notes: MidiNote[], measureBeats: number, kind: MidiRemixKind): MidiChordObservation[] {
  const groups = onsetGroups(notes);
  const chordGroups = groups.filter((group) => group.notes.length >= 2);
  const windows = kind === "chord-progression" && chordGroups.length >= 2
    ? chordGroups.map((group, index) => ({
      startBeat: group.startBeat,
      endBeat: chordGroups[index + 1]?.startBeat ?? Math.max(group.startBeat + measureBeats, ...group.notes.map((note) => note.startBeat + note.lengthBeats)),
      notes: notes.filter((note) => note.startBeat >= group.startBeat - 1e-6 && note.startBeat < (chordGroups[index + 1]?.startBeat ?? group.startBeat + measureBeats) - 1e-6),
    }))
    : harmonicWindows(notes, measureBeats);
  return windows.map((window) => ({
    ...recognizeChord(window.notes.map((note) => note.pitch)),
    startBeat: window.startBeat,
    endBeat: window.endBeat,
  }));
}

function recognizeChord(pitches: number[]): Omit<MidiChordObservation, "startBeat" | "endBeat"> {
  const pitchClasses = [...new Set(pitches.map(pitchClass))].sort((a, b) => a - b);
  if (pitchClasses.length === 0) return { label: "No chord", rootPitchClass: 0, quality: "root", pitchClasses };
  if (pitchClasses.length === 1) {
    return { label: `${PITCH_NAMES[pitchClasses[0]]} root`, rootPitchClass: pitchClasses[0], quality: "root", pitchClasses };
  }
  if (pitchClasses.length === 2) {
    const root = pitchClasses.find((candidate) => pitchClasses.includes(pitchClass(candidate + 7))) ?? pitchClasses[0];
    const quality: ChordQuality = pitchClasses.includes(pitchClass(root + 7)) ? "power" : "root";
    return { label: quality === "power" ? `${PITCH_NAMES[root]}5` : `${PITCH_NAMES[root]} center`, rootPitchClass: root, quality, pitchClasses };
  }
  let best = { root: pitchClasses[0], template: CHORD_TEMPLATES[4], score: -Infinity };
  for (const root of pitchClasses) {
    for (const template of CHORD_TEMPLATES) {
      const expected = template.intervals.map((interval) => pitchClass(root + interval));
      const present = expected.filter((pitch) => pitchClasses.includes(pitch)).length;
      const extras = pitchClasses.filter((pitch) => !expected.includes(pitch)).length;
      const missing = expected.length - present;
      const score = present * 2 - extras * 0.65 - missing * 0.8 + (expected.length === pitchClasses.length ? 0.5 : 0);
      if (score > best.score) best = { root, template, score };
    }
  }
  return {
    label: `${PITCH_NAMES[best.root]}${best.template.suffix}`,
    rootPitchClass: best.root,
    quality: best.template.quality,
    pitchClasses,
  };
}

function harmonicWindows(notes: MidiNote[], measureBeats: number) {
  if (notes.length === 0) return [];
  const first = Math.floor(Math.min(...notes.map((note) => note.startBeat)) / measureBeats) * measureBeats;
  const last = Math.max(...notes.map((note) => note.startBeat + note.lengthBeats));
  const windows: Array<{ startBeat: number; endBeat: number; notes: MidiNote[] }> = [];
  for (let start = first; start < last - 1e-6; start += measureBeats) {
    const end = start + measureBeats;
    const members = notes.filter((note) => note.startBeat >= start - 1e-6 && note.startBeat < end - 1e-6);
    if (members.length > 0) windows.push({ startBeat: roundBeat(start), endBeat: roundBeat(end), notes: members });
  }
  return windows;
}

function findRepeatedMotif(notes: MidiNote[]): MidiMotifObservation | undefined {
  const melodic = onsetGroups(notes).map((group) => group.notes.slice().sort((a, b) => b.pitch - a.pitch)[0]).filter(Boolean);
  for (let length = Math.min(8, Math.floor(melodic.length / 2)); length >= 3; length -= 1) {
    for (let first = 0; first + length <= melodic.length; first += 1) {
      const signature = phraseSignature(melodic.slice(first, first + length));
      for (let second = first + length; second + length <= melodic.length; second += 1) {
        if (signature !== phraseSignature(melodic.slice(second, second + length))) continue;
        const startBeat = melodic[first].startBeat;
        const last = melodic[first + length - 1];
        return { startBeat, endBeat: roundBeat(last.startBeat + last.lengthBeats), repeated: true, noteCount: length };
      }
    }
  }
  return undefined;
}

function findPrimaryPhrase(notes: MidiNote[], measureBeats: number, segmentLengthBeats: number): MidiMotifObservation | undefined {
  if (notes.length === 0) return undefined;
  const melodic = onsetGroups(notes).map((group) => group.notes.slice().sort((a, b) => b.pitch - a.pitch)[0]).filter(Boolean);
  const phrases: MidiNote[][] = [];
  let current: MidiNote[] = [];
  for (const note of melodic) {
    const previous = current[current.length - 1];
    const gap = previous ? note.startBeat - (previous.startBeat + previous.lengthBeats) : 0;
    if (current.length >= 3 && gap >= Math.max(0.75, measureBeats / 4)) {
      phrases.push(current);
      current = [];
    }
    current.push(note);
  }
  if (current.length > 0) phrases.push(current);
  const phrase = phrases.sort((a, b) => b.length - a.length || a[0].startBeat - b[0].startBeat)[0] ?? melodic;
  const first = phrase[0];
  const last = phrase[phrase.length - 1];
  let startBeat = Math.floor(first.startBeat * 4 + 1e-6) / 4;
  if (Math.abs(startBeat % measureBeats) <= 0.25) startBeat = Math.floor(startBeat / measureBeats) * measureBeats;
  const endBeat = Math.min(segmentLengthBeats, Math.ceil((last.startBeat + last.lengthBeats) * 4 - 1e-6) / 4);
  return { startBeat: roundBeat(startBeat), endBeat: roundBeat(endBeat), repeated: false, noteCount: phrase.length };
}

function phraseSignature(notes: MidiNote[]): string {
  if (notes.length === 0) return "";
  const rootPitch = notes[0].pitch;
  const rootBeat = notes[0].startBeat;
  return notes.map((note) => `${note.pitch - rootPitch}:${quantize(note.startBeat - rootBeat, 1 / 16)}:${quantize(note.lengthBeats, 1 / 16)}`).join("|");
}

function analysisEvidence(input: {
  kind: MidiRemixKind;
  density: number;
  medianPitch: number;
  polyphonicRatio: number;
  shortMaterial: boolean;
  rhythmRegularity: number;
  hasArpeggiationModifier: boolean;
  motif?: MidiMotifObservation;
  measureBeats: number;
}): string[] {
  if (input.kind === "arpeggio") return [
    input.hasArpeggiationModifier ? "Existing arpeggiation modifier" : "Sequential chord tones",
    `${input.density.toFixed(1)} notes per beat`,
    input.rhythmRegularity >= 0.65 ? "Regular pulse" : "Variable pulse",
  ];
  if (input.kind === "bassline") return [`Median pitch MIDI ${Math.round(input.medianPitch)}`, input.polyphonicRatio < 0.2 ? "Mostly single-note" : "Layered bass voice"];
  if (input.kind === "chord-progression") return [`${Math.round(input.polyphonicRatio * 100)}% polyphonic onsets`, "Harmonic changes tracked by onset"];
  if (input.kind === "melodic-loop") return [input.motif?.repeated ? "Repeated interval and rhythm pattern" : "Short melodic phrase", "Compact phrase identity"];
  return [
    input.motif?.repeated ? "Repeated motif found" : "Primary phrase boundary found",
    `Phrase aligned against ${formatBeat(input.measureBeats)}-beat measures`,
  ];
}

function analysisSummary(kind: MidiRemixKind, motif: MidiMotifObservation | undefined, chords: MidiChordObservation[]): string {
  const chordLabels = chords.reduce<string[]>((labels, chord) => {
    if (labels[labels.length - 1] !== chord.label) labels.push(chord.label);
    return labels;
  }, []);
  const visibleChordLabels = chordLabels.slice(0, 8);
  const harmony = visibleChordLabels.length > 0
    ? ` Harmony: ${visibleChordLabels.join(" → ")}${chordLabels.length > visibleChordLabels.length ? " → …" : ""}.`
    : "";
  if (kind === "melody-motif" || kind === "melodic-loop") {
    const phrase = motif ? ` Core phrase: beats ${formatBeat(motif.startBeat)}–${formatBeat(motif.endBeat)}${motif.repeated ? " (repeats)" : ""}.` : "";
    return `${phrase}${harmony}`.trim();
  }
  return harmony.trim() || "Pitch and rhythm structure recognized.";
}

function remixKindLabel(kind: MidiRemixKind, contextText: string): string {
  if (kind === "melody-motif" && /bridge/.test(contextText)) return "Bridge motif";
  return {
    arpeggio: "Arpeggiation",
    "melodic-loop": "Melodic loop",
    bassline: "Bassline",
    "chord-progression": "Chord progression",
    "melody-motif": "Main melody / motif",
  }[kind];
}

function harmonicCoverage(notes: MidiNote[], measureBeats: number): number {
  const windows = harmonicWindows(notes, measureBeats);
  if (windows.length === 0) return 0;
  const covered = windows.filter((window) => recognizeChord(window.notes.map((note) => note.pitch)).quality !== "root").length;
  return covered / windows.length;
}

function onsetGroups(notes: MidiNote[]) {
  const groups = new Map<number, MidiNote[]>();
  for (const note of notes) {
    const startBeat = quantize(note.startBeat, 1 / ONSET_PRECISION);
    groups.set(startBeat, [...(groups.get(startBeat) ?? []), note]);
  }
  return Array.from(groups, ([startBeat, groupedNotes]) => ({ startBeat, notes: groupedNotes }))
    .sort((a, b) => a.startBeat - b.startBeat);
}

function onsetRegularity(onsets: number[]): number {
  if (onsets.length < 3) return 0.5;
  const intervals = onsets.slice(1).map((beat, index) => quantize(beat - onsets[index], 1 / 16)).filter((value) => value > 0);
  const counts = new Map<number, number>();
  intervals.forEach((interval) => counts.set(interval, (counts.get(interval) ?? 0) + 1));
  return Math.max(...counts.values(), 0) / Math.max(1, intervals.length);
}

function validNotes(notes: MidiNote[]): MidiNote[] {
  return notes
    .filter((note) => Number.isFinite(note.pitch) && Number.isFinite(note.startBeat) && Number.isFinite(note.lengthBeats) && note.lengthBeats > 0)
    .map((note) => ({ ...note }))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
}

function sanitizeResult(notes: MidiNote[], segmentLengthBeats: number): MidiNote[] {
  const length = Math.max(1 / 16, segmentLengthBeats);
  return notes
    .map((note) => {
      const startBeat = clamp(roundBeat(note.startBeat), 0, Math.max(0, length - 1 / 64));
      return {
        ...note,
        pitch: clamp(Math.round(note.pitch), 0, 127),
        startBeat,
        lengthBeats: Math.max(1 / 64, Math.min(roundBeat(note.lengthBeats), length - startBeat)),
        velocity: clamp(Math.round(note.velocity), 1, 127),
      };
    })
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
}

function transposeNote(note: MidiNote, pitch: number): MidiNote {
  const nextPitch = clamp(Math.round(pitch), 0, 127);
  const delta = nextPitch - note.pitch;
  return {
    ...note,
    pitch: nextPitch,
    frequencyHz: undefined,
    curve: note.curve?.map((point) => ({ ...point, pitch: clamp(point.pitch + delta, 0, 127) })),
  };
}

function derivedNote(source: MidiNote, pitch: number, startBeat: number, lengthBeats: number, velocityScale: number): MidiNote {
  return {
    pitch: clamp(Math.round(pitch), 0, 127),
    velocity: clamp(Math.round(source.velocity * velocityScale), 1, 127),
    startBeat: roundBeat(startBeat),
    lengthBeats: Math.max(1 / 64, roundBeat(lengthBeats)),
    sampleZoneId: source.sampleZoneId,
    samplePath: source.samplePath,
    sampleLabel: source.sampleLabel,
  };
}

function shiftCurve(curve: MidiNote["curve"], beatDelta: number): MidiNote["curve"] {
  return curve?.map((point) => ({ ...point, beat: roundBeat(point.beat + beatDelta) }));
}

function shiftAutomation(note: MidiNote, beatDelta: number): MidiNote["automation"] {
  return note.automation?.map((lane) => ({
    ...lane,
    points: lane.points.map((point) => ({ ...point, beat: roundBeat(point.beat + beatDelta) })),
  }));
}

function chordAtBeat(chords: MidiChordObservation[], beat: number): MidiChordObservation | undefined {
  return chords.find((chord) => beat >= chord.startBeat - 1e-6 && beat < chord.endBeat - 1e-6);
}

function medianOnsetStep(notes: MidiNote[]): number {
  const starts = [...new Set(notes.map((note) => note.startBeat))].sort((a, b) => a - b);
  return Math.max(1 / 16, median(starts.slice(1).map((start, index) => start - starts[index])) || 0.25);
}

function seventhInterval(quality: ChordQuality): number {
  return quality === "major" || quality === "major7" || quality === "augmented" ? 11 : 10;
}

function pitchNear(pitchClassValue: number, target: number): number {
  let best = pitchClassValue;
  let distance = Infinity;
  for (let octave = -1; octave <= 10; octave += 1) {
    const candidate = octave * 12 + pitchClassValue;
    if (candidate < 0 || candidate > 127) continue;
    const nextDistance = Math.abs(candidate - target);
    if (nextDistance < distance) {
      best = candidate;
      distance = nextDistance;
    }
  }
  return best;
}

function nearestVocabularyPitch(target: number, pitchClasses: number[]): number {
  if (pitchClasses.length === 0) return clamp(Math.round(target), 0, 127);
  let best = clamp(Math.round(target), 0, 127);
  let distance = Infinity;
  for (let pitch = Math.max(0, Math.floor(target) - 12); pitch <= Math.min(127, Math.ceil(target) + 12); pitch += 1) {
    if (!pitchClasses.includes(pitchClass(pitch))) continue;
    const nextDistance = Math.abs(pitch - target);
    if (nextDistance < distance) {
      best = pitch;
      distance = nextDistance;
    }
  }
  return best;
}

function countChangedNotes(before: MidiNote[], after: MidiNote[]): number {
  const shared = Math.min(before.length, after.length);
  let changed = Math.abs(after.length - before.length);
  for (let index = 0; index < shared; index += 1) {
    const a = before[index];
    const b = after[index];
    if (a.pitch !== b.pitch || Math.abs(a.startBeat - b.startBeat) > 1e-6 || Math.abs(a.lengthBeats - b.lengthBeats) > 1e-6 || a.velocity !== b.velocity || a.arpeggiation?.sequence !== b.arpeggiation?.sequence) changed += 1;
  }
  return changed;
}

function nearGrid(beat: number, step: number): boolean {
  if (step <= 0) return false;
  return Math.abs(beat / step - Math.round(beat / step)) < 0.04;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function pitchClass(pitch: number): number {
  return ((Math.round(pitch) % 12) + 12) % 12;
}

function quantize(value: number, step: number): number {
  return roundBeat(Math.round(value / step) * step);
}

function formatBeat(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function roundBeat(value: number): number {
  return Math.round(value * BEAT_PRECISION) / BEAT_PRECISION;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
