import { DEFAULT_DRUM_VELOCITY } from "../state/drumSteps";
import type { DrumRow, DrumSpeed, DrumStep, Instrument, TimeSignature } from "../state/types";

export const DRUM_GENRES = [
  "rock",
  "pop",
  "rap",
  "trap",
  "drill",
  "breakcore",
  "dnb",
  "house",
  "reggae",
  "funk",
] as const;

export type DrumGenre = typeof DRUM_GENRES[number];

export interface DrumGenreGuideline {
  bpm: string;
  timeSignature: string;
  instruments: string[];
  kick: string;
  snareClap: string;
  hatsPerc: string;
  hatDensity: string;
  swing: string;
  humanization: string;
  kickComplexity: "very low" | "low" | "medium" | "high" | "very high" | "extreme";
  fillRate: "very low" | "low" | "medium" | "high" | "extreme";
  characteristics: string;
  coreBeat: string;
  special: string;
  references: string[];
}

export const DRUM_GENRE_GUIDELINES: Record<DrumGenre, DrumGenreGuideline> = {
  rock: {
    bpm: "100-160; 110-140 common",
    timeSignature: "4/4",
    instruments: ["Acoustic kick", "Acoustic snare", "Closed hats", "Crash cymbals", "Toms"],
    kick: "1, 3",
    snareClap: "2, 4",
    hatsPerc: "Straight 8ths, occasional 16ths",
    hatDensity: "8ths",
    swing: "Very low",
    humanization: "Moderate real-drummer feel",
    kickComplexity: "medium",
    fillRate: "medium",
    characteristics: "Strong backbeat, acoustic kit, low swing",
    coreBeat: "Kick on 1 and 3, snare on 2 and 4, closed hats on every eighth.",
    special: "Use crash/tom fills sparingly at phrase boundaries.",
    references: ["AC/DC", "Foo Fighters", "Classic rock"],
  },
  pop: {
    bpm: "95-130",
    timeSignature: "4/4",
    instruments: ["Electronic/acoustic hybrid drums", "Layered kick", "Snappy clap", "Electronic hats", "Shakers"],
    kick: "4-6 hits per bar; often an extra kick before beat 3",
    snareClap: "2, 4",
    hatsPerc: "Straight 8ths or light 16ths",
    hatDensity: "8ths",
    swing: "Low",
    humanization: "Low to moderate; polished and predictable",
    kickComplexity: "medium",
    fillRate: "low",
    characteristics: "Predictable, danceable, radio-friendly",
    coreBeat: "Kick on 1, snare/clap on 2 and 4, often an extra kick before beat 3.",
    special: "Prioritize a catchy, easily readable groove over density.",
    references: ["Clean pop drums", "Radio-friendly dance pop"],
  },
  rap: {
    bpm: "70-100",
    timeSignature: "4/4",
    instruments: ["Sampled kick", "Crunchy snare", "Vinyl percussion"],
    kick: "Sparse syncopated",
    snareClap: "2, 4",
    hatsPerc: "Swung 8ths or 16ths",
    hatDensity: "16ths",
    swing: "Medium to high; 55-65%",
    humanization: "High; dusty, late, human feel",
    kickComplexity: "medium",
    fillRate: "low",
    characteristics: "Swing, human feel, space between hits",
    coreBeat: "Sparse kicks around 1 and 3, snare on 2 and 4, leave air between hits.",
    special: "Use sparse vinyl percussion and avoid over-filling the grid.",
    references: ["Nas", "Wu-Tang", "J Dilla"],
  },
  trap: {
    bpm: "130-170, often felt as 65-85 half-time",
    timeSignature: "4/4",
    instruments: ["808 kick", "Trap clap", "Closed hats", "Hat rolls"],
    kick: "Sparse but heavy; follows 808 bass",
    snareClap: "Beat 3 half-time feel",
    hatsPerc: "Constant 16ths with 1/32 rolls, triplets, velocity changes",
    hatDensity: "16ths plus rolls",
    swing: "Low; 0-10%",
    humanization: "Low; grid-tight with velocity-shaped hats",
    kickComplexity: "high",
    fillRate: "medium",
    characteristics: "808-centric, half-time, sparse body with active hats",
    coreBeat: "Kick on 1, snare/clap on beat 3, sub-heavy syncopated extra kicks.",
    special: "Frequent 1/32 and triplet hat fills; keep kick body sparse.",
    references: ["Metro Boomin", "Future", "Travis Scott"],
  },
  drill: {
    bpm: "138-150",
    timeSignature: "4/4",
    instruments: ["Sliding 808", "Punchy kick", "Tight snare", "Triplet hats"],
    kick: "Syncopated",
    snareClap: "Beat 3",
    hatsPerc: "Triplet hats",
    hatDensity: "Triplet 16ths",
    swing: "Medium; 20-40%",
    humanization: "Medium; off-grid but intentional",
    kickComplexity: "very high",
    fillRate: "medium",
    characteristics: "Off-grid feeling, sliding bass, sparse atmosphere",
    coreBeat: "Snare on beat 3, highly syncopated kicks, triplet hat motion.",
    special: "Long 808 slides are essential; hats should feel triplet-heavy.",
    references: ["UK Drill", "Central Cee", "Pop Smoke"],
  },
  breakcore: {
    bpm: "170-240+",
    timeSignature: "4/4",
    instruments: ["Amen Break", "Think Break", "Distorted samples"],
    kick: "Fragmented",
    snareClap: "Fragmented",
    hatsPerc: "Chopped breaks",
    hatDensity: "Break slices",
    swing: "Variable",
    humanization: "Variable; edited break slices rather than drummer timing",
    kickComplexity: "extreme",
    fillRate: "extreme",
    characteristics: "Glitches, reverses, time stretching, constant edits",
    coreBeat: "Kick/snare should be derived from breakbeat slices rather than a clean programmed grid.",
    special: "Heavy slicing, reverses, glitches, retriggers, and distorted Amen/Think-style breaks.",
    references: ["Venetian Snares", "Sewerslvt"],
  },
  dnb: {
    bpm: "165-180",
    timeSignature: "4/4",
    instruments: ["Breakbeats", "Electronic kick/snare", "Reese bass"],
    kick: "1 and syncopation",
    snareClap: "2 & 4 variations",
    hatsPerc: "Continuous 16th-note motion",
    hatDensity: "16ths",
    swing: "Slight; 10-20%",
    humanization: "Medium; shuffled breakbeat layers and ghost notes",
    kickComplexity: "high",
    fillRate: "medium",
    characteristics: "Fast tempo, rolling groove, constant motion",
    coreBeat: "Kick on 1, snare on 2, ghost kick before 3, snare on 4.",
    special: "Ghost notes and shuffled breakbeat layers should create motion.",
    references: ["Amen break", "Classic DnB"],
  },
  house: {
    bpm: "120-128",
    timeSignature: "4/4",
    instruments: ["Deep kick", "Clap", "Closed hat", "Open hat"],
    kick: "Every beat",
    snareClap: "2, 4",
    hatsPerc: "Open hat on the & of every beat",
    hatDensity: "8ths",
    swing: "Low to moderate; 10-20%",
    humanization: "Low; stable dance grid",
    kickComplexity: "very low",
    fillRate: "low",
    characteristics: "Four-on-the-floor, open hats on offbeats",
    coreBeat: "Kick every quarter note, clap on 2 and 4, open hat on offbeats.",
    special: "This is the most recognizable genre pattern; do not over-complicate the kick.",
    references: ["Quintessential house groove"],
  },
  reggae: {
    bpm: "65-95",
    timeSignature: "4/4",
    instruments: ["Rimshot", "Tight kick", "Percussion", "Cross-stick"],
    kick: "Sparse",
    snareClap: "Beat 3 emphasis",
    hatsPerc: "Sparse skank rhythm",
    hatDensity: "Sparse",
    swing: "Moderate; 20-40%",
    humanization: "Moderate; relaxed and behind the beat",
    kickComplexity: "low",
    fillRate: "very low",
    characteristics: "Relaxed, spacey, groove-focused",
    coreBeat: "One-drop: no kick on beat 1, kick plus snare/rim around beat 3.",
    special: "One Drop groove: everything lands around beat 3, with space around it.",
    references: ["Bob Marley"],
  },
  funk: {
    bpm: "90-120",
    timeSignature: "4/4",
    instruments: ["Tight kick", "Snare", "Closed hats", "Ghost notes"],
    kick: "Syncopated",
    snareClap: "2, 4 with ghost notes",
    hatsPerc: "16th-note groove",
    hatDensity: "16ths",
    swing: "Medium; 40-60%",
    humanization: "High; pocket feel",
    kickComplexity: "high",
    fillRate: "medium",
    characteristics: "Pocket and syncopation",
    coreBeat: "Syncopated kick, snare on 2 and 4 with ghost notes, 16th-note hats.",
    special: "Groove comes from ghost notes and kick placement.",
    references: ["Pocket funk", "Syncopated funk"],
  },
};

export const DRUM_COMPLEXITY_DEFAULT = 50;
export const DRUM_COMPLEXITY_MIN = 0;
export const DRUM_COMPLEXITY_MAX = 100;
export const DRUM_MAX_STEPS = 128;

export interface GeneratedDrumBeat {
  rows: DrumRow[];
  stepCount: number;
  lengthBeats: number;
  speed: DrumSpeed;
  swingPercent: number;
  defaultPitchHz?: number;
  source?: "ollama" | "local";
  prompt?: string;
  model?: string;
}

export interface GenerateDrumBeatOptions {
  genre: DrumGenre;
  instruments: Instrument[];
  stepCount: number;
  lengthBeats: number;
  speed: DrumSpeed;
  timeSignature: TimeSignature;
  complexity?: number;
  variationSeed?: number;
  feedbackExamples?: DrumBeatFeedbackExample[];
}

export interface DrumBeatFeedbackExample {
  genre: DrumGenre;
  rating: "up" | "down";
  beat: GeneratedDrumBeat;
  userFeedback?: string;
}

type DrumRole =
  | "breakLoop"
  | "kick"
  | "subKick"
  | "snare"
  | "clap"
  | "rim"
  | "closedHat"
  | "openHat"
  | "ride"
  | "crash"
  | "lowTom"
  | "midTom"
  | "highTom"
  | "congaLow"
  | "congaHigh"
  | "cowbell"
  | "tambourine"
  | "guiro"
  | "shaker"
  | "percussion";

interface Hit {
  step: number;
  velocity?: number;
  leanPercent?: number;
  pitchHz?: number;
}

const GENRE_DEFAULTS: Record<DrumGenre, { speed: DrumSpeed; swing: number }> = {
  rock: { speed: 4, swing: 50 },
  pop: { speed: 4, swing: 50 },
  rap: { speed: 4, swing: 60 },
  trap: { speed: 4, swing: 51 },
  drill: { speed: 4, swing: 56 },
  breakcore: { speed: 5, swing: 52 },
  dnb: { speed: 4, swing: 53 },
  house: { speed: 4, swing: 54 },
  reggae: { speed: 4, swing: 58 },
  funk: { speed: 4, swing: 60 },
};

const DRUM_SPEEDS: DrumSpeed[] = [1, 2, 3, 4, 5, 6];

interface ComplexityProfile {
  value: number;
  norm: number;
  targetRows: number;
  density: number;
}

function complexityProfile(value: number | undefined): ComplexityProfile {
  const sanitized = Math.max(DRUM_COMPLEXITY_MIN, Math.min(DRUM_COMPLEXITY_MAX, Math.round(value ?? DRUM_COMPLEXITY_DEFAULT)));
  const norm = sanitized / 100;
  return {
    value: sanitized,
    norm,
    targetRows: sanitized < 22 ? 3 : sanitized > 78 ? 5 : 4,
    density: 0.45 + norm * 1.1,
  };
}

interface DrumArrangementProfile {
  targetRows: number;
  density: number;
  heaviness: number;
  syncopation: number;
  fillRate: number;
  texture: "dry" | "tight" | "wide" | "busy" | "broken";
}

function drumArrangementProfile(genre: DrumGenre, profile: ComplexityProfile, rnd: () => number): DrumArrangementProfile {
  const textureRoll = rnd();
  const texture: DrumArrangementProfile["texture"] = genre === "breakcore"
    ? "broken"
    : textureRoll < 0.18
    ? "dry"
    : textureRoll < 0.42
    ? "tight"
    : textureRoll < 0.67
    ? "wide"
    : "busy";
  const genreRowLift = genre === "breakcore" || genre === "dnb" || genre === "funk" ? 1 : genre === "reggae" || genre === "house" ? 0 : rnd() > 0.64 ? 1 : 0;
  const textureRowLift = texture === "busy" || texture === "wide" ? 1 : texture === "dry" ? -1 : 0;
  const rowSwing = profile.norm < 0.3 && rnd() < 0.22
    ? -1
    : profile.norm > 0.55 && rnd() < 0.18
    ? -1
    : rnd() > 0.68
    ? 1
    : 0;
  return {
    targetRows: Math.max(3, Math.min(7, profile.targetRows + genreRowLift + textureRowLift + rowSwing + (profile.norm > 0.86 && rnd() > 0.35 ? 1 : 0))),
    density: Math.max(0.28, Math.min(1.9, profile.density + (texture === "busy" ? 0.34 : texture === "dry" ? -0.34 : 0) + (rnd() - 0.5) * 0.42)),
    heaviness: Math.max(0, Math.min(1, 0.38 + profile.norm * 0.42 + rnd() * 0.3)),
    syncopation: Math.max(0, Math.min(1, (genre === "funk" || genre === "drill" || genre === "rap" ? 0.45 : 0.2) + profile.norm * 0.28 + rnd() * 0.28)),
    fillRate: Math.max(0, Math.min(1, (genre === "breakcore" ? 0.72 : genre === "house" || genre === "reggae" ? 0.12 : 0.22) + profile.norm * 0.42 + rnd() * 0.22)),
    texture,
  };
}

function speedForComplexity(genre: DrumGenre, requested: DrumSpeed, norm: number, phraseBeats: number): DrumSpeed {
  const defaultSpeed = GENRE_DEFAULTS[genre].speed;
  const base = DRUM_SPEEDS.includes(requested) ? requested : defaultSpeed;
  const phraseCap = speedCapForPhrase(phraseBeats);
  if (norm < 0.22) {
    if (genre === "breakcore" || genre === "dnb") return minDrumSpeed(phraseCap, maxDrumSpeed(4, stepSpeed(base, -1)));
    return stepSpeed(base, -1);
  }
  if (norm < 0.46) {
    const target = genre === "breakcore" ? maxDrumSpeed(5, defaultSpeed) : defaultSpeed;
    return minDrumSpeed(phraseCap, target);
  }
  if (norm < 0.72) {
    const target = maxDrumSpeed(base, genre === "breakcore" || genre === "dnb" ? 5 : genre === "trap" || genre === "drill" ? 4 : defaultSpeed);
    return minDrumSpeed(phraseCap, target);
  }
  if (genre === "breakcore" || genre === "dnb" || genre === "trap" || genre === "drill") return minDrumSpeed(phraseCap, 6);
  return minDrumSpeed(phraseCap, maxDrumSpeed(base, 5));
}

function stepSpeed(speed: DrumSpeed, offset: number): DrumSpeed {
  const index = Math.max(0, Math.min(DRUM_SPEEDS.length - 1, DRUM_SPEEDS.indexOf(speed) + offset));
  return DRUM_SPEEDS[index] ?? speed;
}

function maxDrumSpeed(a: DrumSpeed, b: DrumSpeed): DrumSpeed {
  return a > b ? a : b;
}

function minDrumSpeed(a: DrumSpeed, b: DrumSpeed): DrumSpeed {
  return a < b ? a : b;
}

function speedCapForPhrase(phraseBeats: number): DrumSpeed {
  if (phraseBeats >= 16) return 4;
  if (phraseBeats >= 8) return 5;
  return 6;
}

export function generateLocalDrumBeat({
  genre,
  instruments,
  lengthBeats,
  speed,
  timeSignature,
  complexity,
  variationSeed,
}: GenerateDrumBeatOptions): GeneratedDrumBeat {
  const defaults = GENRE_DEFAULTS[genre];
  const currentLength = Math.max(1, Math.min(DRUM_MAX_STEPS, Math.round(lengthBeats)));
  const currentSpeed = speed || defaults.speed;
  const profile = complexityProfile(complexity);
  const phraseBeats = Math.max(1 / 16, currentLength / Math.max(1, currentSpeed));
  let targetSpeed = speedForComplexity(genre, currentSpeed, profile.norm, phraseBeats);
  const seed = variationSeed ?? Date.now() + Math.floor(Math.random() * 100000);
  const rnd = seededRandom(seed + genre.length * 131 + currentLength * 17);
  targetSpeed = varyDrumSpeed(genre, targetSpeed, profile.norm, phraseBeats, rnd);
  const targetLength = Math.max(1, Math.min(DRUM_MAX_STEPS, Math.round(phraseBeats * targetSpeed)));
  const targetStepCount = Math.max(1, Math.min(DRUM_MAX_STEPS, targetLength));
  const meter = meterProfile(timeSignature, targetStepCount, targetSpeed, rnd);
  const arrangement = drumArrangementProfile(genre, profile, rnd);
  const roles = indexInstruments(instruments);
  const barSteps = meter.barSteps;
  const fourFourBarSteps = Math.max(1, targetSpeed * 4);
  const downbeats = every(barSteps, targetStepCount, 1);
  const phraseCrashes = downbeats.filter((_, index) => index % 2 === 0);
  const rockAccentRoll = rnd();
  const rockAccent = rockAccentRoll > 0.66
    ? roles.crash
    : rockAccentRoll > 0.38
    ? roles.midTom ?? roles.highTom ?? roles.lowTom ?? roles.crash
    : roles.ride ?? roles.openHat ?? roles.lowTom ?? roles.crash;
  const rockHatRoll = rnd();
  const rockHat = rockHatRoll > 0.62
    ? roles.ride ?? roles.openHat ?? roles.closedHat
    : rockHatRoll > 0.46
    ? roles.openHat ?? roles.closedHat
    : roles.closedHat;
  const houseBackbeat = rnd() > 0.72
    ? roles.snare ?? roles.rim ?? roles.clap
    : roles.clap ?? roles.snare;
  const houseTexture = rnd() > 0.5
    ? roles.closedHat
    : roles.shaker ?? roles.tambourine ?? roles.cowbell ?? roles.congaHigh ?? roles.closedHat;
  const reggaeTexture = rnd() > 0.55
    ? roles.percussion ?? roles.tambourine ?? roles.openHat
    : roles.congaLow ?? roles.congaHigh ?? roles.guiro ?? roles.tambourine ?? roles.percussion ?? roles.openHat;
  const rapTexture = rnd() > 0.55
    ? roles.percussion ?? roles.openHat
    : roles.rim ?? roles.shaker ?? roles.cowbell ?? roles.tambourine ?? roles.percussion ?? roles.openHat;
  const drillHat = rnd() > 0.68 ? roles.openHat ?? roles.closedHat : roles.closedHat;
  const drillTexture = drillHat === roles.openHat
    ? roles.lowTom ?? roles.midTom ?? roles.percussion ?? roles.rim ?? roles.openHat
    : rnd() > 0.48
    ? roles.openHat
    : roles.lowTom ?? roles.midTom ?? roles.percussion ?? roles.rim ?? roles.openHat;
  const trapBackbeat = rnd() > 0.5
    ? roles.clap ?? roles.rim ?? roles.snare
    : roles.rim ?? roles.clap ?? roles.snare;
  const trapHat = rnd() > 0.72
    ? roles.shaker ?? roles.tambourine ?? roles.closedHat
    : roles.closedHat;

  switch (genre) {
    case "house":
      return beat(defaults, targetStepCount, targetLength, [
        row(roles.kick, "Kick", repeatPattern([1, 5, 9, 13], 16, targetStepCount, 122)),
        row(houseBackbeat, houseBackbeat?.name ?? "Clap", repeatPattern([5, 13], 16, targetStepCount, 114)),
        row(roles.openHat, "Open Hat", repeatPattern([3, 7, 11, 15], 16, targetStepCount, 92, 8)),
        row(houseTexture, houseTexture?.name ?? "Closed Hat", repeatPattern([1, 3, 5, 7, 9, 11, 13, 15], 16, targetStepCount, 54, 5)),
      ]);
    case "reggae":
      return beat(defaults, targetStepCount, targetLength, [
        row(roles.kick, "Kick", repeatPattern([9], 16, targetStepCount, 116, 6)),
        row(roles.rim ?? roles.snare, "Rim", repeatPattern([9], 16, targetStepCount, 104, 10)),
        row(roles.closedHat, "Hat", repeatPattern([3, 7, 11, 15], 16, targetStepCount, 68, 12)),
        row(reggaeTexture, reggaeTexture?.name ?? "Skank", repeatPattern([5, 13], 16, targetStepCount, 54, 14)),
      ]);
    case "trap":
      return beat(defaults, targetStepCount, targetLength, [
        row(roles.subKick ?? roles.kick, "Sub Kick", repeatScaledPattern([1, 6, 11, 16, 19, 25, 29], 32, fourFourBarSteps, targetStepCount, 112).map(pitch808)),
        row(roles.snare ?? roles.clap, "Snare", repeatScaledPattern([17], 32, fourFourBarSteps, targetStepCount, 124)),
        row(trapHat, trapHat?.name ?? "Hat Roll", repeatScaledPattern([1, 3, 5, 7, 11, 13, 15, 16, 17, 19, 21, 23, 27, 29, 30, 31], 32, fourFourBarSteps, targetStepCount, 52).map(pitchHatRoll)),
        row(trapBackbeat, trapBackbeat?.name ?? "Clap", repeatScaledPattern([17], 32, fourFourBarSteps, targetStepCount, 66)),
      ], 130.81);
    case "drill":
      return beat(defaults, targetStepCount, targetLength, [
        row(roles.subKick ?? roles.kick, "Sub Kick", repeatScaledPattern([1, 4, 10, 15, 19, 22, 28, 31], 32, fourFourBarSteps, targetStepCount, 112).map((hit, i) => ({ ...hit, leanPercent: i % 2 ? 12 : -10, pitchHz: [110, 123.47, 98, 146.83][i % 4] }))),
        row(roles.snare ?? roles.rim, "Snare", repeatScaledPattern([17], 32, fourFourBarSteps, targetStepCount, 122)),
        row(drillHat, drillHat?.name ?? "Triplet Hat", tripletHatRolls(32, fourFourBarSteps, targetStepCount, 54).map(pitchHatRoll)),
        row(drillTexture, drillTexture?.name ?? "Open Hat", repeatScaledPattern([7, 23], 32, fourFourBarSteps, targetStepCount, 60, 14)),
      ], 130.81);
    case "breakcore":
      return beat(defaults, targetStepCount, targetLength, [
        row(roles.kick, "Fragment Kick", fragmentedHits(scalePatternSteps([1, 4, 7, 11, 15, 19, 23, 27, 31], 32, fourFourBarSteps), fourFourBarSteps, targetStepCount, 110, rnd, 0.72)),
        row(roles.snare, "Fragment Snare", fragmentedHits(scalePatternSteps([3, 5, 10, 13, 16, 21, 26, 29, 32], 32, fourFourBarSteps), fourFourBarSteps, targetStepCount, 104, rnd, 0.78).map(pitchSnareCut)),
        row(roles.breakLoop ?? roles.closedHat ?? roles.ride, "Chopped Break", choppedBreakHits(32, fourFourBarSteps, targetStepCount, rnd)),
      ]);
    case "dnb":
      return beat(defaults, targetStepCount, targetLength, [
        row(roles.kick, "Kick", repeatScaledPattern([1, 11, 17, 23], 32, fourFourBarSteps, targetStepCount, 122)),
        row(roles.snare, "Snare", repeatScaledPattern([9, 25, 29], 32, fourFourBarSteps, targetStepCount, 122).map((hit, i) => i % 3 === 2 ? { ...hit, velocity: 74, leanPercent: 8 } : hit)),
        row(roles.closedHat, "Hat", repeatScaledPattern([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31], 32, fourFourBarSteps, targetStepCount, 56, 7)),
        row(roles.ride ?? roles.openHat, "Ride", repeatScaledPattern([5, 13, 21, 29], 32, fourFourBarSteps, targetStepCount, 62, 8)),
      ]);
    case "rap":
      return beat(defaults, targetStepCount, targetLength, [
        row(roles.kick, "Kick", repeatPattern([1, 4, 7, 11, 15], 16, targetStepCount, 112)),
        row(roles.snare ?? roles.clap, "Snare", repeatPattern([5, 13], 16, targetStepCount, 120)),
        row(roles.closedHat, "Hat", repeatPattern([1, 3, 5, 7, 9, 11, 13, 15], 16, targetStepCount, 62, 9)),
        row(rapTexture, rapTexture?.name ?? "Vinyl Perc", repeatPattern([11, 15], 16, targetStepCount, 58, 10)),
      ]);
    case "pop":
      return beat(defaults, targetStepCount, targetLength, [
        row(roles.kick, "Kick", repeatPattern([1, 7, 9, 15], 16, targetStepCount, 116)),
        row(roles.clap ?? roles.snare, "Clap", repeatPattern([5, 13], 16, targetStepCount, 112)),
        row(roles.closedHat, "Hat", repeatPattern([1, 3, 5, 7, 9, 11, 13, 15], 16, targetStepCount, 66, 4)),
        row(roles.shaker ?? roles.tambourine ?? roles.crash, "Shaker", repeatPattern([3, 7, 11, 15], 16, targetStepCount, 58, 5)),
      ]);
    case "funk":
      return beat(defaults, targetStepCount, targetLength, [
        row(roles.kick, "Kick", repeatPattern([1, 4, 7, 11, 15], 16, targetStepCount, 104).map(ghostSome)),
        row(roles.snare, "Snare", repeatPattern([5, 8, 12, 13, 16], 16, targetStepCount, 92).map(ghostSome)),
        row(roles.closedHat, "Hat", repeatPattern([1, 3, 5, 7, 9, 11, 13, 15], 16, targetStepCount, 64, 12)),
        row(roles.openHat, "Open Hat", repeatPattern([15], 16, targetStepCount, 58, 14)),
      ]);
    case "rock":
    default:
      return beat(defaults, targetStepCount, targetLength, [
        row(roles.kick, "Kick", withDownbeatAccents(repeatPattern([1, 9], 16, targetStepCount, 112), downbeats)),
        row(roles.snare, "Snare", repeatPattern([5, 13], 16, targetStepCount, 124)),
        row(rockHat, rockHat?.name ?? "Hat", repeatPattern([1, 3, 5, 7, 9, 11, 13, 15], 16, targetStepCount, 70, 3)),
        row(rockAccent, rockAccent?.name ?? "Crash", phraseCrashes.map((step) => hit(step, 108))),
      ]);
  }

  function beat(
    defaultsForGenre: { speed: DrumSpeed; swing: number },
    nextStepCount: number,
    nextLength: number,
    rows: DrumRow[],
    defaultPitchHz?: number,
  ): GeneratedDrumBeat {
    const enrichedRows = fitRowsToComplexity(rows, {
      genre,
      roles,
      stepCount: nextStepCount,
      targetRows: arrangement.targetRows,
      density: arrangement.density,
      meter,
      rnd,
      arrangement,
    });
    const polishedRows = shapeLikeDrummer(
      humanizeRows(enrichedRows.filter((candidate) => candidate.instrumentId || candidate.steps.some(Boolean)), nextStepCount, meter, rnd),
      nextStepCount,
      meter,
      genre,
      rnd,
    );
    return {
      rows: spaceRowsLikeDrummer(
        polishedRows,
        nextStepCount,
        meter,
        arrangement.density,
        rnd,
      ),
      stepCount: nextStepCount,
      lengthBeats: nextLength,
      speed: targetSpeed,
      swingPercent: dynamicSwing(defaultsForGenre.swing, genre, arrangement, rnd),
      defaultPitchHz,
      source: "local",
    };
  }
}

function varyDrumSpeed(genre: DrumGenre, speed: DrumSpeed, norm: number, phraseBeats: number, rnd: () => number): DrumSpeed {
  if (norm < 0.55) return speed;
  const phraseCap = speedCapForPhrase(phraseBeats);
  const roll = rnd();
  const wantsFaster = genre === "breakcore" || genre === "dnb" || genre === "trap" || genre === "drill"
    ? roll > 0.42
    : roll > 0.82;
  const wantsSlower = genre === "house" || genre === "reggae" || genre === "rock" || genre === "pop"
    ? roll < 0.18
    : roll < 0.12;
  if (wantsFaster) return minDrumSpeed(phraseCap, stepSpeed(speed, 1));
  if (wantsSlower) return stepSpeed(speed, -1);
  return speed;
}

function dynamicSwing(base: number, genre: DrumGenre, arrangement: DrumArrangementProfile, rnd: () => number): number {
  const genreWindow = genre === "trap" || genre === "house" ? 4 : genre === "rock" || genre === "pop" ? 6 : genre === "breakcore" ? 10 : 14;
  const texturePush = arrangement.texture === "tight" ? -2 : arrangement.texture === "busy" || arrangement.texture === "broken" ? 3 : arrangement.texture === "wide" ? 2 : -1;
  const syncPush = Math.round((arrangement.syncopation - 0.5) * 8);
  return Math.max(0, Math.min(100, Math.round(base + texturePush + syncPush + (rnd() - 0.5) * genreWindow)));
}

export function sanitizeGeneratedDrumBeat(value: unknown, opts: GenerateDrumBeatOptions): GeneratedDrumBeat | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<GeneratedDrumBeat>;
  const profile = complexityProfile(opts.complexity);
  const currentLength = Math.max(1, Math.min(DRUM_MAX_STEPS, Math.round(opts.lengthBeats)));
  const phraseBeats = Math.max(1 / 16, currentLength / Math.max(1, opts.speed));
  const speed = speedForComplexity(opts.genre, isDrumSpeed(record.speed) ? record.speed : opts.speed, profile.norm, phraseBeats);
  const sourceLength = clampInt(record.lengthBeats, 1, DRUM_MAX_STEPS) ?? currentLength;
  const lengthBeats = Math.max(1, Math.min(DRUM_MAX_STEPS, opts.complexity == null ? sourceLength : Math.round(phraseBeats * speed)));
  const stepCount = Math.max(1, Math.min(DRUM_MAX_STEPS, lengthBeats));
  const swingPercent = clampInt(record.swingPercent, 0, 100) ?? 50;
  const defaultPitchHz = typeof record.defaultPitchHz === "number" && Number.isFinite(record.defaultPitchHz)
    ? Math.max(20, Math.min(20000, record.defaultPitchHz))
    : undefined;
  if (!Array.isArray(record.rows)) return null;

  const instrumentsById = new Map(opts.instruments.map((instrument) => [instrument.id, instrument]));
  const rows = record.rows.slice(0, Math.max(3, profile.targetRows + 2)).map((candidate, rowIndex): DrumRow | null => {
    if (!candidate || typeof candidate !== "object") return null;
    const raw = candidate as Partial<DrumRow>;
    const instrument = typeof raw.instrumentId === "string" ? instrumentsById.get(raw.instrumentId) : undefined;
    const name = typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim().slice(0, 48)
      : instrument?.name ?? `Row ${rowIndex + 1}`;
    if (!Array.isArray(raw.steps)) return null;
    const rawSteps = raw.steps;
    const steps = Array.from({ length: stepCount }, (_, index) => sanitizeStep(rawSteps[index]));
    if (!instrument && !steps.some(Boolean)) return null;
    return {
      id: crypto.randomUUID(),
      instrumentId: instrument?.id,
      name,
      steps,
    };
  }).filter((row): row is DrumRow => Boolean(row));

  if (rows.length === 0) return null;
  const rnd = seededRandom((opts.variationSeed ?? Date.now()) + opts.genre.length * 149 + stepCount * 31);
  const meter = meterProfile(opts.timeSignature, stepCount, speed, rnd);
  const arrangement = drumArrangementProfile(opts.genre, profile, rnd);
  const polishedRows = shapeLikeDrummer(
    humanizeRows(
      fitRowsToComplexity(rows, {
        genre: opts.genre,
        roles: indexInstruments(opts.instruments),
        stepCount,
        targetRows: arrangement.targetRows,
        density: arrangement.density,
        meter,
        rnd,
        arrangement,
      }),
      stepCount,
      meter,
      rnd,
    ),
    stepCount,
    meter,
    opts.genre,
    rnd,
  );
  return {
    rows: spaceRowsLikeDrummer(polishedRows, stepCount, meter, arrangement.density, rnd),
    stepCount,
    lengthBeats,
    speed,
    swingPercent,
    defaultPitchHz,
    source: record.source,
    prompt: typeof record.prompt === "string" ? record.prompt : undefined,
    model: typeof record.model === "string" ? record.model : undefined,
  };
}

function stepsPerBar(timeSignature: TimeSignature, speed: DrumSpeed): number {
  const subdivision = timeSignature.denom === 8 ? Math.max(1, Math.round(speed / 2)) : speed;
  return Math.max(1, timeSignature.num * subdivision);
}

interface MeterProfile {
  barSteps: number;
  beatUnitSteps: number;
  strongSteps: Set<number>;
  secondarySteps: Set<number>;
  fillerSteps: Set<number>;
}

function meterProfile(timeSignature: TimeSignature, stepCount: number, speed: DrumSpeed, rnd: () => number): MeterProfile {
  const beatUnitSteps = timeSignature.denom === 8 ? Math.max(1, Math.round(speed / 2)) : speed;
  const barSteps = stepsPerBar(timeSignature, speed);
  const boldBeats = timeSignature.boldBeats?.length
    ? timeSignature.boldBeats
    : inferredBoldBeats(timeSignature.num, rnd);
  const strongSteps = new Set<number>();
  const secondarySteps = new Set<number>();
  const fillerSteps = new Set<number>();

  for (let step = 0; step < stepCount; step++) {
    const inBar = step % barSteps;
    const beat = Math.floor(inBar / beatUnitSteps) + 1;
    const beatOffset = inBar % beatUnitSteps;
    if (inBar === 0) strongSteps.add(step);
    if (boldBeats.includes(beat) && beatOffset === 0) {
      if (beat === 1) strongSteps.add(step);
      else secondarySteps.add(step);
    }
    if (beatOffset !== 0 || (!strongSteps.has(step) && !secondarySteps.has(step))) {
      fillerSteps.add(step);
    }
  }

  return { barSteps, beatUnitSteps, strongSteps, secondarySteps, fillerSteps };
}

function inferredBoldBeats(num: number, rnd: () => number): number[] {
  if (num === 5) return rnd() > 0.5 ? [1, 4] : [1, 3];
  if (num === 7) return rnd() > 0.5 ? [1, 3, 5] : [1, 4, 6];
  if (num === 6) return [1, 4];
  if (num === 9) return [1, 4, 7];
  return [1];
}

function isDrumSpeed(value: unknown): value is DrumSpeed {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6;
}

function clampInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function sanitizeStep(value: unknown): DrumStep {
  if (value === true || value === false) return value;
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!record.on) return false;
  return {
    on: true,
    ...(typeof record.velocity === "number" && Number.isFinite(record.velocity)
      ? { velocity: Math.max(0, Math.min(127, Math.round(record.velocity))) }
      : {}),
    ...(typeof record.leanPercent === "number" && Number.isFinite(record.leanPercent)
      ? { leanPercent: Math.max(-50, Math.min(50, Math.round(record.leanPercent))) }
      : {}),
    ...(typeof record.pitchHz === "number" && Number.isFinite(record.pitchHz)
      ? { pitchHz: Math.max(20, Math.min(20000, record.pitchHz)) }
      : {}),
  };
}

function indexInstruments(instruments: Instrument[]): Record<DrumRole, Instrument | undefined> {
  const pick = (...patterns: RegExp[]) => {
    const scored = instruments
      .map((instrument) => ({
        instrument,
        score: roleScore(instrument, patterns),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored[0]?.instrument;
  };
  return {
    breakLoop: pick(/\bamen\b/i, /\bthink\b/i, /\bbreakbeat\b/i, /\bbreak\b/i, /\bloop\b/i),
    kick: pick(/\bkick\b/i),
    subKick: pick(/\bsub kick\b/i, /\b808\b/i),
    snare: pick(/\bsnare\b/i),
    clap: pick(/\bclap\b/i),
    rim: pick(/\brim\b/i),
    closedHat: pick(/\bclosed hat\b/i, /\bhat\b/i),
    openHat: pick(/\bopen hat\b/i),
    ride: pick(/\bride\b/i),
    crash: pick(/\bcrash\b/i),
    lowTom: pick(/\blow tom\b/i, /\btom-l\b/i),
    midTom: pick(/\bmid tom\b/i, /\btom-m\b/i),
    highTom: pick(/\bhigh tom\b/i, /\btom-h\b/i),
    congaLow: pick(/\blow conga\b/i),
    congaHigh: pick(/\bhigh conga\b/i),
    cowbell: pick(/\bcowbell\b/i),
    tambourine: pick(/\btambourine\b/i, /\btamb\b/i),
    guiro: pick(/\bguiro\b/i),
    shaker: pick(/\bshaker\b/i, /\bshake\b/i),
    percussion: pick(/\bperc\b/i, /\bpercussion\b/i, /\bvinyl\b/i, /\bfoley\b/i, /\bcross[- ]?stick\b/i),
  };
}

function roleScore(instrument: Instrument, patterns: RegExp[]): number {
  const haystack = [
    instrument.name,
    instrument.kind,
    instrument.waveform,
    instrument.source?.label,
    instrument.source?.kind,
    ...(instrument.descriptors ?? []),
    ...(instrument.sampleMap ?? []).map((zone) => zone.name ?? zone.path),
  ].filter(Boolean).join(" ");
  const matchCount = patterns.reduce((count, pattern) => count + (pattern.test(haystack) ? 1 : 0), 0);
  if (matchCount === 0) return 0;
  const sourceBoost = instrument.sampleUrl || instrument.sampleUrls?.length || instrument.sampleMap?.length ? 3 : 0;
  const kindBoost = instrument.kind === "sampler" ? 3 : instrument.kind === "hybrid" ? 2 : 0;
  const userBoost = instrument.userCreated ? 1 : 0;
  return matchCount * 10 + sourceBoost + kindBoost + userBoost;
}

function row(instrument: Instrument | undefined, fallbackName: string, hits: Hit[]): DrumRow {
  const count = Math.max(1, hits.reduce((max, candidate) => Math.max(max, candidate.step), 0));
  return {
    id: crypto.randomUUID(),
    instrumentId: instrument?.id,
    name: instrument?.name ?? fallbackName,
    steps: cells(hits, count),
  };
}

interface FitRowsOptions {
  genre: DrumGenre;
  roles: Record<DrumRole, Instrument | undefined>;
  stepCount: number;
  targetRows: number;
  density: number;
  meter: MeterProfile;
  rnd: () => number;
  arrangement: DrumArrangementProfile;
}

function fitRowsToComplexity(rows: DrumRow[], opts: FitRowsOptions): DrumRow[] {
  const arrangedRows = addArrangementRows(rows, opts);
  const baseRows = arrangedRows.map((candidate) => ({
    ...candidate,
    steps: tuneRowDensity(
      {
        ...candidate,
        steps: mutateRowPattern(candidate, opts.stepCount, opts.meter, opts.arrangement, opts.rnd),
      },
      opts.stepCount,
      opts.density,
      opts.meter,
      opts.rnd,
    ),
  }));
  return limitRows(baseRows, opts.targetRows).map((candidate) => ({
    ...candidate,
    steps: normalizeSteps(candidate.steps, opts.stepCount),
  }));
}

function addArrangementRows(rows: DrumRow[], opts: FitRowsOptions): DrumRow[] {
  const next = [...rows];
  const hasNamed = (pattern: RegExp) => next.some((row) => pattern.test(row.name));
  const maybeAdd = (instrument: Instrument | undefined, fallbackName: string, hits: Hit[], chance: number) => {
    if (next.length >= opts.targetRows + 2 || opts.rnd() > chance) return;
    if (!instrument && hits.length === 0) return;
    next.push(row(instrument, fallbackName, hits));
  };

  const phraseEnd = Math.max(1, opts.stepCount - Math.max(1, Math.round(opts.meter.beatUnitSteps / 2)));
  if (!hasNamed(/crash/i)) {
    maybeAdd(opts.roles.crash, "Crash", [hit(1, 96), hit(phraseEnd, 72)], opts.arrangement.texture === "wide" ? 0.72 : 0.28 + opts.arrangement.fillRate * 0.32);
  }
  if (!hasNamed(/shaker|tamb/i)) {
    maybeAdd(
      opts.roles.shaker ?? opts.roles.tambourine,
      opts.roles.shaker ? "Shaker" : "Tambourine",
      repeatPattern([3, 7, 11, 15], 16, opts.stepCount, 46 + Math.round(opts.rnd() * 24), Math.round(opts.rnd() * 12)),
      opts.arrangement.texture === "busy" ? 0.76 : 0.18 + opts.arrangement.density * 0.24,
    );
  }
  if (!hasNamed(/tom/i) && opts.genre !== "house" && opts.genre !== "reggae" && opts.genre !== "breakcore") {
    maybeAdd(
      opts.roles.midTom ?? opts.roles.lowTom ?? opts.roles.highTom,
      "Tom Fill",
      fillHits(opts.stepCount, opts.meter, opts.rnd, 66 + Math.round(opts.rnd() * 28)),
      opts.arrangement.fillRate * 0.58,
    );
  }
  if (!hasNamed(/cowbell|perc|guiro/i) && opts.genre !== "trap" && opts.genre !== "drill") {
    maybeAdd(
      opts.roles.cowbell ?? opts.roles.guiro ?? opts.roles.percussion,
      opts.roles.cowbell ? "Cowbell" : "Percussion",
      sparseTextureHits(opts.stepCount, opts.meter, opts.rnd),
      opts.arrangement.texture === "dry" ? 0.08 : 0.16 + opts.arrangement.syncopation * 0.35,
    );
  }
  if (!hasNamed(/conga|tambourine|guiro/i) && (opts.genre === "reggae" || opts.genre === "house" || opts.genre === "funk")) {
    const textureInstrument = opts.roles.congaLow
      ?? opts.roles.congaHigh
      ?? opts.roles.tambourine
      ?? opts.roles.guiro
      ?? opts.roles.cowbell;
    maybeAdd(
      textureInstrument,
      textureInstrument?.name ?? "Percussion",
      sparseTextureHits(opts.stepCount, opts.meter, opts.rnd),
      0.2 + opts.arrangement.syncopation * 0.44,
    );
  }
  if (!hasNamed(/foley|perc|rim|tom/i) && (opts.genre === "trap" || opts.genre === "drill" || opts.genre === "breakcore")) {
    const textureInstrument = opts.roles.percussion
      ?? opts.roles.rim
      ?? opts.roles.lowTom
      ?? opts.roles.midTom
      ?? opts.roles.shaker;
    maybeAdd(
      textureInstrument,
      textureInstrument?.name ?? "Texture",
      sparseTextureHits(opts.stepCount, opts.meter, opts.rnd),
      0.16 + opts.arrangement.fillRate * 0.46,
    );
  }
  while (next.length < opts.targetRows) {
    const usedNames = new Set(next.map((candidate) => candidate.name.toLowerCase()));
    const fallback = [
      opts.roles.shaker,
      opts.roles.tambourine,
      opts.roles.rim,
      opts.roles.openHat,
      opts.roles.ride,
      opts.roles.crash,
      opts.roles.lowTom,
      opts.roles.midTom,
      opts.roles.highTom,
      opts.roles.cowbell,
      opts.roles.percussion,
    ].find((instrument) => instrument && !usedNames.has(instrument.name.toLowerCase()));
    const name = fallback?.name ?? `Texture ${next.length + 1}`;
    next.push(row(fallback, name, sparseTextureHits(opts.stepCount, opts.meter, opts.rnd)));
  }
  return next;
}

function mutateRowPattern(row: DrumRow, stepCount: number, meter: MeterProfile, arrangement: DrumArrangementProfile, rnd: () => number): DrumStep[] {
  const lower = row.name.toLowerCase();
  const steps = normalizeSteps(row.steps, stepCount);
  const isKick = lower.includes("kick");
  const isBackbeat = lower.includes("snare") || lower.includes("clap") || lower.includes("rim");
  const isHat = lower.includes("hat") || lower.includes("ride") || lower.includes("shaker") || lower.includes("tambourine");
  const isFill = lower.includes("tom") || lower.includes("crash") || lower.includes("perc") || lower.includes("cowbell") || lower.includes("guiro");

  for (let index = 0; index < stepCount; index++) {
    const current = steps[index];
    if (current && typeof current === "object") {
      const lift = isKick ? arrangement.heaviness * 18 : isBackbeat ? arrangement.heaviness * 12 : isHat ? -8 + arrangement.density * 4 : 0;
      steps[index] = {
        ...current,
        velocity: Math.max(8, Math.min(127, Math.round((current.velocity ?? DEFAULT_DRUM_VELOCITY) + lift + (rnd() - 0.5) * 14))),
      };
    }

    if (steps[index]) continue;
    if (!meter.fillerSteps.has(index) && rnd() > 0.18) continue;
    const addChance = isKick
      ? arrangement.syncopation * 0.08
      : isBackbeat
      ? arrangement.fillRate * 0.055
      : isHat
      ? arrangement.density * 0.085
      : isFill
      ? arrangement.fillRate * 0.08
      : 0.045;
    if (rnd() > addChance) continue;
    steps[index] = {
      on: true,
      velocity: Math.round(isHat ? 24 + rnd() * 38 : isFill ? 34 + rnd() * 42 : 44 + rnd() * 46),
      leanPercent: Math.round((rnd() - 0.5) * (arrangement.texture === "tight" ? 8 : 22)),
    };
  }

  if (arrangement.texture === "dry" && (isHat || isFill)) {
    for (let index = 0; index < stepCount; index++) {
      if (isProtectedRowAnchor(row, index, meter)) continue;
      if (!meter.fillerSteps.has(index) || !steps[index] || rnd() > 0.28) continue;
      steps[index] = false;
    }
  }
  return steps;
}

function fillHits(stepCount: number, meter: MeterProfile, rnd: () => number, velocity: number): Hit[] {
  const out: Hit[] = [];
  const start = Math.max(1, stepCount - Math.max(2, meter.beatUnitSteps * 2));
  for (let step = start; step <= stepCount; step += Math.max(1, Math.floor(meter.beatUnitSteps / 2))) {
    if (rnd() < 0.22) continue;
    out.push(hit(step, Math.max(36, velocity - Math.round(rnd() * 24)), Math.round((rnd() - 0.5) * 18)));
  }
  return out;
}

function sparseTextureHits(stepCount: number, meter: MeterProfile, rnd: () => number): Hit[] {
  const out: Hit[] = [];
  for (let step = 1; step <= stepCount; step++) {
    const index = step - 1;
    if (!meter.fillerSteps.has(index) || rnd() > 0.11) continue;
    out.push(hit(step, 34 + Math.round(rnd() * 32), Math.round((rnd() - 0.5) * 24)));
  }
  return out;
}

function tuneRowDensity(row: DrumRow, stepCount: number, density: number, meter: MeterProfile, rnd: () => number): DrumStep[] {
  const lower = row.name.toLowerCase();
  const steps = normalizeSteps(row.steps, stepCount);
  const isKick = lower.includes("kick");
  const isBackbeat = lower.includes("snare") || lower.includes("clap") || lower.includes("rim");
  const isHat = lower.includes("hat") || lower.includes("ride") || lower.includes("tambourine");
  const isTexture = lower.includes("tom") || lower.includes("cowbell") || lower.includes("guiro") || lower.includes("crash");

  if (density < 0.82) {
    const removeChance = Math.min(0.42, (0.82 - density) * (isHat ? 0.75 : isTexture ? 0.55 : 0.32));
    return steps.map((step, index) => {
      if (!step || meter.strongSteps.has(index) || meter.secondarySteps.has(index)) return step;
      if (isProtectedRowAnchor(row, index, meter)) return step;
      if (!meter.fillerSteps.has(index)) return step;
      return rnd() < removeChance ? false : step;
    });
  }

  const addChance = Math.max(0, density - 0.9) * (isHat ? 0.46 : isTexture ? 0.34 : isKick ? 0.16 : isBackbeat ? 0.13 : 0.18);
  for (let index = 0; index < stepCount; index++) {
    if (steps[index]) continue;
    if (!meter.fillerSteps.has(index) && rnd() > 0.3) continue;
    if (rnd() > addChance) continue;
    steps[index] = {
      on: true,
      velocity: isHat
        ? 22 + Math.round(rnd() * 42)
        : isTexture
          ? 28 + Math.round(rnd() * 48)
          : 34 + Math.round(rnd() * 42),
      leanPercent: Math.round((rnd() - 0.5) * (isHat ? 22 : 16)),
    };
  }
  return steps;
}

function limitRows(rows: DrumRow[], targetRows: number): DrumRow[] {
  if (rows.length <= targetRows) return rows;
  const ranked = rows
    .map((candidate, index) => ({ candidate, index, priority: rowPriority(candidate) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, targetRows);
  const keep = new Set(ranked.map((entry) => entry.index));
  return rows.filter((_, index) => keep.has(index));
}

function rowPriority(row: DrumRow): number {
  const lower = row.name.toLowerCase();
  if (lower.includes("kick")) return 100;
  if (lower.includes("snare") || lower.includes("clap") || lower.includes("rim")) return 92;
  if (lower.includes("hat")) return 82;
  if (lower.includes("ride")) return 66;
  if (lower.includes("tom")) return 58;
  if (lower.includes("crash")) return 48;
  return 42;
}

function humanizeRows(rows: DrumRow[], stepCount: number, meter: MeterProfile, rnd: () => number): DrumRow[] {
  return rows.map((row) => {
    const lower = row.name.toLowerCase();
    const steps = row.steps.map((step, index) => {
      if (!step || typeof step !== "object") return step;
      const baseVelocity = typeof step.velocity === "number" ? step.velocity : DEFAULT_DRUM_VELOCITY;
      const isStrong = meter.strongSteps.has(index);
      const isSecondary = meter.secondarySteps.has(index);
      const velocityDrift = Math.round((rnd() - 0.5) * (isStrong ? 8 : isSecondary ? 12 : 20));
      const meterLift = isStrong ? 12 : isSecondary ? 6 : meter.fillerSteps.has(index) ? -8 : 0;
      return {
        ...step,
        velocity: Math.max(8, Math.min(127, baseVelocity + meterLift + velocityDrift)),
        leanPercent: step.leanPercent ?? (rnd() > 0.72 ? Math.round((rnd() - 0.5) * 14) : undefined),
      };
    });

    const chance = lower.includes("kick") ? 0.22 : lower.includes("snare") || lower.includes("rim") ? 0.12 : lower.includes("hat") ? 0.18 : 0.06;
    const additions = Math.max(1, Math.floor(stepCount / 16));
    for (let i = 0; i < additions; i++) {
      if (rnd() > chance) continue;
      const index = Math.floor(rnd() * stepCount);
      if (steps[index]) continue;
      steps[index] = {
        on: true,
        velocity: Math.max(22, Math.min(86, Math.round(DEFAULT_DRUM_VELOCITY * (0.32 + rnd() * 0.35)))),
        leanPercent: Math.round((rnd() - 0.5) * 18),
      };
    }

    return { ...row, steps };
  });
}

function shapeLikeDrummer(rows: DrumRow[], stepCount: number, meter: MeterProfile, genre: DrumGenre, rnd: () => number): DrumRow[] {
  return rows.map((row) => {
    const lower = row.name.toLowerCase();
    const steps = normalizeSteps(row.steps, stepCount);
    const isKick = lower.includes("kick");
    const isBackbeat = lower.includes("snare") || lower.includes("clap") || lower.includes("rim");
    const isHat = lower.includes("hat") || lower.includes("ride") || lower.includes("tambourine");
    const isTexture = lower.includes("tom") || lower.includes("cowbell") || lower.includes("guiro");

    meter.strongSteps.forEach((index) => {
      if (isKick && genre !== "reggae" && !steps[index] && rnd() > 0.25) {
        steps[index] = { on: true, velocity: 112 + Math.round(rnd() * 12) };
      } else if (steps[index] && typeof steps[index] === "object") {
        steps[index] = { ...steps[index], velocity: Math.min(127, (steps[index].velocity ?? DEFAULT_DRUM_VELOCITY) + 10) };
      }
    });

    meter.secondarySteps.forEach((index) => {
      if (isBackbeat && !steps[index] && rnd() > 0.18) {
        steps[index] = { on: true, velocity: 96 + Math.round(rnd() * 18), leanPercent: Math.round((rnd() - 0.5) * 8) };
      } else if (isKick && !steps[index] && rnd() > 0.65) {
        steps[index] = { on: true, velocity: 82 + Math.round(rnd() * 18) };
      } else if (steps[index] && typeof steps[index] === "object") {
        steps[index] = { ...steps[index], velocity: Math.min(127, (steps[index].velocity ?? DEFAULT_DRUM_VELOCITY) + 5) };
      }
    });

    if (isHat || isTexture) {
      for (let index = 0; index < stepCount; index++) {
        const current = steps[index];
        if (current && typeof current === "object" && meter.fillerSteps.has(index)) {
          steps[index] = {
            ...current,
            velocity: Math.max(18, Math.round((current.velocity ?? DEFAULT_DRUM_VELOCITY) * (isHat ? 0.74 : 0.62))),
          };
        }
      }
    }

    if (isHat) {
      const removeChance = genre === "trap" || genre === "drill"
        ? 0.02
        : 0.08 + (meter.secondarySteps.size > 1 ? 0.04 : 0);
      for (let index = 0; index < stepCount; index++) {
        if (isProtectedRowAnchor(row, index, meter)) continue;
        if (!meter.fillerSteps.has(index) || !steps[index] || rnd() > removeChance) continue;
        steps[index] = false;
      }
    }

    if ((genre === "trap" || genre === "drill") && isBackbeat) {
      for (let index = 0; index < stepCount; index++) {
        if (steps[index] && !isHalfTimeBackbeat(index, meter)) steps[index] = false;
      }
    }

    return { ...row, steps };
  });
}

function isHalfTimeBackbeat(index: number, meter: MeterProfile): boolean {
  return (index % meter.barSteps) === meter.beatUnitSteps * 2;
}

function spaceRowsLikeDrummer(rows: DrumRow[], stepCount: number, meter: MeterProfile, density: number, rnd: () => number): DrumRow[] {
  return rows.map((row) => {
    const steps = normalizeSteps(row.steps, stepCount);
    const cap = rowHitCap(row, stepCount, density);
    const active = steps.reduce((count, step) => count + (step ? 1 : 0), 0);
    if (active <= cap) return { ...row, steps };

    const removable = steps
      .map((step, index) => ({ step, index, score: removalScore(row, index, meter, rnd) }))
      .filter(({ step, index }) => step && !meter.strongSteps.has(index) && !meter.secondarySteps.has(index) && !isProtectedRowAnchor(row, index, meter))
      .sort((a, b) => b.score - a.score);

    let remaining = active;
    for (const candidate of removable) {
      if (remaining <= cap) break;
      steps[candidate.index] = false;
      remaining--;
    }

    return { ...row, steps };
  });
}

function isProtectedRowAnchor(row: DrumRow, index: number, meter: MeterProfile): boolean {
  const lower = row.name.toLowerCase();
  const inBar = index % meter.barSteps;
  const beat2 = meter.beatUnitSteps;
  const beat3 = meter.beatUnitSteps * 2;
  const beat4 = meter.beatUnitSteps * 3;
  if (lower.includes("kick")) return inBar === 0 || inBar === beat3;
  if (lower.includes("snare") || lower.includes("clap") || lower.includes("rim")) {
    return inBar === beat2 || inBar === beat3 || inBar === beat4;
  }
  if (lower.includes("open hat")) {
    return inBar === Math.floor(meter.beatUnitSteps / 2)
      || inBar === beat2 + Math.floor(meter.beatUnitSteps / 2)
      || inBar === beat3 + Math.floor(meter.beatUnitSteps / 2)
      || inBar === beat4 + Math.floor(meter.beatUnitSteps / 2);
  }
  return false;
}

function rowHitCap(row: DrumRow, stepCount: number, density: number): number {
  const lower = row.name.toLowerCase();
  const scale = Math.max(0, Math.min(1, (density - 0.55) / 1.2));
  const ratio = lower.includes("kick")
    ? 0.26 + scale * 0.04
    : lower.includes("snare") || lower.includes("clap") || lower.includes("rim")
      ? 0.16 + scale * 0.04
      : lower.includes("hat")
        ? 0.48 + scale * 0.12
        : lower.includes("ride") || lower.includes("tambourine")
          ? 0.14 + scale * 0.12
          : lower.includes("tom")
            ? 0.08 + scale * 0.10
            : lower.includes("crash")
              ? 0.04 + scale * 0.05
              : 0.08 + scale * 0.08;
  return Math.max(1, Math.min(stepCount, Math.round(stepCount * ratio)));
}

function removalScore(row: DrumRow, index: number, meter: MeterProfile, rnd: () => number): number {
  const lower = row.name.toLowerCase();
  const isHat = lower.includes("hat") || lower.includes("ride") || lower.includes("tambourine");
  const isTexture = lower.includes("tom") || lower.includes("cowbell") || lower.includes("guiro") || lower.includes("crash");
  let score = rnd();
  if (meter.fillerSteps.has(index)) score += isHat ? 2.2 : isTexture ? 1.8 : 1.2;
  if (meter.secondarySteps.has(index)) score -= 2.4;
  if (index % 2 === 1) score += isHat ? 0.7 : 0.25;
  if (index % 4 === 0) score -= 0.9;
  return score;
}

function normalizeSteps(steps: DrumStep[], count: number): DrumStep[] {
  return Array.from({ length: count }, (_, index) => steps[index] ?? false);
}

function seededRandom(seed: number): () => number {
  let mixed = Math.floor(seed) >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  let state = ((mixed >>> 0) % 2147483646) + 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function cells(hits: Hit[], count: number): DrumStep[] {
  const out: DrumStep[] = Array.from({ length: count }, () => false);
  for (const candidate of hits) {
    const index = candidate.step - 1;
    if (index < 0 || index >= count) continue;
    out[index] = {
      on: true,
      velocity: candidate.velocity ?? DEFAULT_DRUM_VELOCITY,
      ...(candidate.leanPercent != null ? { leanPercent: candidate.leanPercent } : {}),
      ...(candidate.pitchHz != null ? { pitchHz: candidate.pitchHz } : {}),
    };
  }
  return out;
}

function repeatPattern(pattern: number[], patternLength: number, count: number, velocity: number, lean = 0): Hit[] {
  const out: Hit[] = [];
  for (let offset = 0; offset < count; offset += patternLength) {
    pattern.forEach((step, index) => {
      const nextStep = offset + step;
      if (nextStep > count) return;
      out.push(hit(nextStep, index % 2 === 0 ? velocity : Math.max(32, velocity - 14), index % 2 === 0 ? 0 : lean));
    });
  }
  return out;
}

function repeatScaledPattern(pattern: number[], sourceLength: number, patternLength: number, count: number, velocity: number, lean = 0): Hit[] {
  return repeatPattern(scalePatternSteps(pattern, sourceLength, patternLength), patternLength, count, velocity, lean);
}

function scalePatternSteps(pattern: number[], sourceLength: number, targetLength: number): number[] {
  const safeSource = Math.max(1, sourceLength);
  const safeTarget = Math.max(1, targetLength);
  const scaled = pattern.map((step) => {
    const zeroBased = Math.max(0, step - 1);
    return Math.max(1, Math.min(safeTarget, Math.round((zeroBased / safeSource) * safeTarget) + 1));
  });
  return Array.from(new Set(scaled)).sort((a, b) => a - b);
}

function fragmentedHits(pattern: number[], patternLength: number, count: number, velocity: number, rnd: () => number, keepChance: number): Hit[] {
  const out: Hit[] = [];
  for (let offset = 0; offset < count; offset += patternLength) {
    const cutStart = 1 + Math.floor(rnd() * Math.max(1, patternLength - 4));
    const cutLength = 2 + Math.floor(rnd() * 4);
    pattern.forEach((step, index) => {
      const nextStep = offset + step;
      if (nextStep > count) return;
      if (step >= cutStart && step < cutStart + cutLength) return;
      if (rnd() > keepChance) return;
      out.push(hit(
        nextStep,
        Math.max(32, velocity - Math.round(rnd() * (index % 2 ? 26 : 12))),
        Math.round((rnd() - 0.5) * 24),
      ));
    });
  }
  return out;
}

function choppedBreakHits(sourceLength: number, patternLength: number, count: number, rnd: () => number): Hit[] {
  const chunks = [
    [1, 2, 3],
    [6, 7],
    [9, 10, 11],
    [14, 15],
    [18, 19, 20],
    [23, 24],
    [27, 29, 31],
  ];
  const out: Hit[] = [];
  for (let offset = 0; offset < count; offset += patternLength) {
    chunks.forEach((chunk, chunkIndex) => {
      if (rnd() < 0.2) return;
      scalePatternSteps(chunk, sourceLength, patternLength).forEach((step, stepIndex) => {
        if (rnd() < 0.28) return;
        const nextStep = offset + step;
        if (nextStep > count) return;
        out.push(hit(
          nextStep,
          34 + Math.round(rnd() * (chunkIndex % 2 ? 28 : 42)),
          stepIndex % 2 ? 10 : Math.round((rnd() - 0.5) * 18),
          chunkIndex % 3 === 2 ? [493.88, 523.25, 587.33][stepIndex % 3] : undefined,
        ));
      });
    });
  }
  return out;
}

function tripletHatRolls(sourceLength: number, patternLength: number, count: number, velocity: number): Hit[] {
  const out: Hit[] = [];
  const tripletSteps = scalePatternSteps([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31], sourceLength, patternLength);
  const fillSteps = scalePatternSteps([15, 16, 17, 29, 30, 31], sourceLength, patternLength);
  for (let offset = 0; offset < count; offset += patternLength) {
    tripletSteps.forEach((step, index) => {
      const nextStep = offset + step;
      if (nextStep > count) return;
      out.push(hit(nextStep, index % 3 === 0 ? velocity + 10 : velocity, index % 3 === 2 ? 12 : -6));
    });
    fillSteps.forEach((step, index) => {
      const nextStep = offset + step;
      if (nextStep > count) return;
      out.push(hit(nextStep, Math.max(28, velocity - 10 + index * 2), -10 + index * 4));
    });
  }
  return out;
}

function every(interval: number, count: number, first = 1): number[] {
  const out: number[] = [];
  for (let step = first; step <= count; step += interval) out.push(step);
  return out;
}

function hit(step: number, velocity?: number, leanPercent?: number, pitchHz?: number): Hit {
  return { step, velocity, leanPercent, pitchHz };
}

function withDownbeatAccents(hits: Hit[], downbeats: number[]): Hit[] {
  const downbeatSet = new Set(downbeats);
  return hits.map((candidate) => downbeatSet.has(candidate.step)
    ? { ...candidate, velocity: Math.min(127, (candidate.velocity ?? DEFAULT_DRUM_VELOCITY) + 12) }
    : candidate);
}

function pitch808(candidate: Hit, index: number): Hit {
  const pitches = [130.81, 123.47, 146.83, 110, 98];
  return { ...candidate, pitchHz: pitches[index % pitches.length], leanPercent: index % 2 ? 10 : candidate.leanPercent };
}

function pitchHatRoll(candidate: Hit, index: number): Hit {
  if (index % 7 !== 0 && index % 11 !== 0) return candidate;
  const pitches = [493.88, 523.25, 587.33, 659.25];
  return { ...candidate, pitchHz: pitches[index % pitches.length], velocity: Math.max(30, (candidate.velocity ?? 52) - 12), leanPercent: -10 };
}

function pitchSnareCut(candidate: Hit, index: number): Hit {
  if (index % 3 !== 0) return candidate;
  return { ...candidate, pitchHz: [220, 246.94, 261.63][index % 3], leanPercent: index % 2 ? 8 : -8 };
}

function ghostSome(candidate: Hit, index: number): Hit {
  return index % 2
    ? { ...candidate, velocity: Math.max(38, (candidate.velocity ?? 90) - 48), leanPercent: 10 }
    : candidate;
}
