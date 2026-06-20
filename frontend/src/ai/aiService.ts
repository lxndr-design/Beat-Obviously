import type { AudioFile, Instrument, MidiNote } from "../state/types";
import { synthDraftFromInstrument } from "../state/synthStore";
import {
  DRUM_GENRE_GUIDELINES,
  generateLocalDrumBeat,
  sanitizeGeneratedDrumBeat,
  type GeneratedDrumBeat,
  type GenerateDrumBeatOptions,
} from "./drumBeatGenerator";

/**
 * AiService — interface for AI-driven generation.
 *
 * v1 ships with a local-first implementation: try Ollama/Qwen on localhost,
 * then fall back to deterministic procedural generation if the model is not
 * installed, not running, or returns invalid JSON.
 */
export interface AiService {
  /** Suggest a name + parameters for a new instrument from a free-text prompt. */
  suggestInstrument: (prompt: string) => Promise<Partial<Instrument>>;

  /** Generate a MIDI pattern for the given length and style hint. */
  generatePattern: (opts: {
    lengthBeats: number;
    style?: string;
    role?: MidiPatternRole;
    key?: string;
    variationSeed?: number;
    seedNotes?: MidiNote[];
  }) => Promise<MidiNote[]>;

  /** Generate a local drum sequence using the app's editable drum-cell format. */
  generateDrumBeat: (opts: GenerateDrumBeatOptions) => Promise<GeneratedDrumBeat>;

  /** Generate editable instrument settings and optionally choose a sample source. */
  generateInstrument: (opts: GenerateInstrumentOptions) => Promise<GeneratedInstrument>;

  /** Suggest a label / description for a project given its track summary. */
  suggestProjectName: (summary: string) => Promise<string>;

  /** Is this service backed by real model calls? */
  isLive: () => boolean;
}

export interface GenerateInstrumentOptions {
  prompt: string;
  current: Instrument;
  targetKind?: Instrument["kind"];
  variationSeed?: number;
  instruments: Instrument[];
  audioFiles: AudioFile[];
  feedbackExamples?: InstrumentFeedbackExample[];
}

export interface GeneratedInstrument {
  patch: Partial<Instrument>;
  source?: "ollama" | "local";
  prompt?: string;
  model?: string;
}

export type MidiPatternRole = "melody" | "bass" | "chords" | "arp" | "countermelody";

export interface InstrumentFeedbackExample {
  prompt: string;
  rating: "up" | "down";
  generated: GeneratedInstrument;
  finalInstrument?: Instrument;
}

/**
 * Mock AI service — deterministic outputs for development.
 * Replace with AnthropicAiService when wiring up real API calls.
 */
export const LocalAiService: AiService = {
  async suggestInstrument(prompt: string) {
    // Hash prompt → deterministic knob positions.
    const seed = simpleHash(prompt);
    const knob = (n: number) => ((seed >> n) & 0xff) / 255;
    return {
      name: prompt.slice(0, 24).trim() || "AI Instrument",
      kind: "synth",
      waveform: ["sine", "saw", "square", "triangle"][seed % 4] as Instrument["waveform"],
      knobs: { cutoff: knob(0), resonance: knob(8), drive: knob(16), color: knob(24) },
      envelope: {
        attackMs: 2 + (seed & 0x3f),
        decayMs: 50 + (seed & 0xff),
        sustain: 0.4 + ((seed >> 4) & 0x3f) / 255,
        releaseMs: 100 + (seed & 0x1ff),
      },
    };
  },

  async generatePattern(opts) {
    return generateLocalMidiPattern(opts);
  },

  async generateDrumBeat(opts) {
    return generateDrumBeatWithOllama(opts);
  },

  async generateInstrument(opts) {
    return generateInstrumentWithOllama(opts);
  },

  async suggestProjectName(summary: string) {
    return `Untitled · ${summary.slice(0, 32)}`;
  },

  isLive() {
    return true;
  },
};

export const MockAiService = LocalAiService;

function simpleHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

async function generateInstrumentWithOllama(opts: GenerateInstrumentOptions): Promise<GeneratedInstrument> {
  const prompt = buildInstrumentPrompt(opts);
  const model = getOllamaModel();
  try {
    const res = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: {
          temperature: 0.95,
          top_p: 0.94,
        },
        messages: [
          {
            role: "system",
            content: [
              "You generate editable instrument settings for a music app.",
              "Return ONLY valid JSON, no markdown.",
              "Stay within provided numeric ranges.",
              "Respect targetInstrumentType unless the user explicitly asks for a different type.",
              "For wavetable instruments, use Aether multi-oscillator settings instead of legacy single-oscillator synth settings.",
              "Do not hand-author synthPatch; Beat derives the canonical synthPatch from normalized Aether settings.",
              "Use variationSeed to produce a meaningfully different patch for repeated prompts.",
              "Repeated generations for the same text must diverge in oscillator topology, envelope contour, modulation routing, wavetable bank/position, and sample choice where available.",
              "Do not merely rename the current patch or nudge macro values. Make the sound-design architecture noticeably different.",
              "Only use sampleUrl values from availableSamples.",
            ].join(" "),
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const json = await res.json() as { message?: { content?: string }; model?: string };
    const parsed = JSON.parse(json.message?.content ?? "{}");
    return {
      patch: sanitizeInstrumentPatch(parsed, opts),
      source: "ollama",
      prompt,
      model: json.model ?? model,
    };
  } catch (error) {
    console.info("Ollama instrument generation unavailable; using local fallback.", error);
    return {
      patch: generateLocalInstrumentPatch(opts),
      source: "local",
      prompt,
    };
  }
}

function buildInstrumentPrompt(opts: GenerateInstrumentOptions): string {
  const seed = opts.variationSeed ?? Date.now();
  const lane = instrumentDivergenceLane(seed, opts.prompt);
  const availableSamples = [
    ...opts.instruments
      .filter((instrument) => instrument.sampleUrl)
      .map((instrument) => ({
        name: instrument.name,
        kind: instrument.kind,
        waveform: instrument.waveform,
        sampleUrl: instrument.sampleUrl,
        source: instrument.source?.label,
        descriptors: instrument.descriptors,
      })),
    ...opts.audioFiles.map((file) => ({
      name: file.name,
      kind: "uploaded-audio",
      sampleUrl: file.path,
      durationSeconds: file.durationSeconds,
    })),
  ];
  const positive = opts.feedbackExamples
    ?.filter((example) => example.rating === "up")
    .slice(0, 3)
    .map((example) => ({
      prompt: example.prompt,
      generated: example.generated.patch,
      finalInstrument: example.finalInstrument ? summarizeInstrument(example.finalInstrument) : undefined,
    }));
  const negative = opts.feedbackExamples
    ?.filter((example) => example.rating === "down")
    .slice(0, 3)
    .map((example) => ({ prompt: example.prompt, generated: example.generated.patch }));

  return JSON.stringify({
    task: "Generate one editable instrument patch.",
    userPrompt: opts.prompt,
    targetInstrumentType: opts.targetKind ?? opts.current.kind,
    variationSeed: opts.variationSeed,
    divergenceLane: lane,
    diversityInstruction: "This is a single new instrument, not an edit pass. For every generation, choose a different macro identity, oscillator stack, modulation behavior, envelope contour, and spectral balance than previous or current examples unless the prompt forbids it.",
    currentInstrument: summarizeInstrument(opts.current),
    availableSamples,
    likedExamples: positive ?? [],
    dislikedExamples: negative ?? [],
    ranges: {
      kind: ["synth", "wavetable", "sampler", "hybrid"],
      waveform: ["sine", "saw", "square", "triangle", "noise", "sample", "wavetable"],
      envelope: {
        attackMs: "0..5000",
        decayMs: "0..5000",
        sustain: "0..1",
        releaseMs: "0..10000",
      },
      knobs: {
        cutoff: "0..1",
        resonance: "0..1",
        drive: "0..1",
        color: "0..1",
      },
      oscillator: {
        detuneCents: "-100..100",
        octave: "-3..3 integer",
        subOscLevel: "0..1",
        glideMs: "0..500",
        maxVoices: "1..32 integer",
      },
      modulation: {
        lfoWaveform: ["sine", "triangle", "saw", "square"],
        lfoRateHz: "1..20",
        lfoDepth: "0..1",
        lfoSync: "boolean",
        lfoRetrigger: "boolean",
        lfoToPitch: "0..12",
        lfoToFilter: "-1..1",
        envToFilter: "-1..1",
      },
      wavetable: {
        bank: ["aether", "glass", "vocal", "organ", "fm"],
        position: "0..1",
        warp: "0..1",
        unison: "1..8 integer",
        detuneCents: "0..100",
        blend: "0..1",
      },
      aether: {
        rule: "For kind wavetable, always return aether.oscA and use oscB/sub/noise when musically useful.",
        oscA: {
          enabled: "true",
          waveform: ["wavetable", "sine", "saw", "square", "triangle", "noise"],
          level: "0..1",
          pan: "-1..1",
          octave: "-4..4 integer",
          semitone: "-24..24 integer",
          fineCents: "-100..100",
          wavetable: "same object shape as wavetable",
        },
        oscB: "same shape as oscA; set enabled false when not needed",
        sub: { enabled: "boolean", level: "0..1", octave: "-4..0 integer", waveform: ["sine", "square", "triangle"] },
        noise: { enabled: "boolean", level: "0..1", color: "0..1" },
      },
    },
    outputSchema: {
      name: "string",
      kind: "synth | wavetable | sampler | hybrid",
      waveform: "sine | saw | square | triangle | noise | sample | wavetable",
      envelope: "object",
      knobs: "object",
      detuneCents: "number",
      octave: "integer",
      subOscLevel: "number",
      glideMs: "number",
      maxVoices: "number",
      lfoWaveform: "string",
      lfoRateHz: "number",
      lfoDepth: "number",
      lfoSync: "boolean",
      lfoRetrigger: "boolean",
      lfoToPitch: "number",
      lfoToFilter: "number",
      envToFilter: "number",
      sampleUrl: "optional exact sampleUrl from availableSamples",
      wavetable: "optional object for kind wavetable",
      aether: "Aether oscillator stack for kind wavetable; Beat derives synthPatch from this",
    },
  });
}

function sanitizeInstrumentPatch(value: unknown, opts: GenerateInstrumentOptions): Partial<Instrument> {
  if (!value || typeof value !== "object") return generateLocalInstrumentPatch(opts);
  const record = value as Partial<Instrument>;
  const allowedSamples = new Set([
    ...opts.instruments.map((instrument) => instrument.sampleUrl).filter(Boolean),
    ...opts.audioFiles.map((file) => file.path),
  ]);
  const sampleUrl = typeof record.sampleUrl === "string" && allowedSamples.has(record.sampleUrl)
    ? record.sampleUrl
    : undefined;
  const targetKind = opts.targetKind ?? opts.current.kind;
  const kind = isInstrumentKind(record.kind) ? record.kind : sampleUrl ? "sampler" : targetKind;
  const waveform = isWaveform(record.waveform)
    ? record.waveform
    : kind === "sampler" ? "sample" : kind === "wavetable" ? "wavetable" : opts.current.waveform;

  const patch: Partial<Instrument> = {
    name: typeof record.name === "string" && record.name.trim()
      ? record.name.trim().slice(0, 48)
      : opts.current.name,
    kind,
    waveform,
    envelope: {
      attackMs: clamp(record.envelope?.attackMs, 0, 5000, opts.current.envelope.attackMs),
      decayMs: clamp(record.envelope?.decayMs, 0, 5000, opts.current.envelope.decayMs),
      sustain: clamp(record.envelope?.sustain, 0, 1, opts.current.envelope.sustain),
      releaseMs: clamp(record.envelope?.releaseMs, 0, 10000, opts.current.envelope.releaseMs),
    },
    knobs: {
      cutoff: clamp(record.knobs?.cutoff, 0, 1, opts.current.knobs.cutoff),
      resonance: clamp(record.knobs?.resonance, 0, 1, opts.current.knobs.resonance),
      drive: clamp(record.knobs?.drive, 0, 1, opts.current.knobs.drive),
      color: clamp(record.knobs?.color, 0, 1, opts.current.knobs.color),
    },
    detuneCents: clamp(record.detuneCents, -100, 100, opts.current.detuneCents ?? 0),
    octave: Math.round(clamp(record.octave, -3, 3, opts.current.octave ?? 0)),
    subOscLevel: clamp(record.subOscLevel, 0, 1, opts.current.subOscLevel ?? 0),
    glideMs: clamp(record.glideMs, 0, 500, opts.current.glideMs ?? 0),
    maxVoices: Math.round(clamp(record.maxVoices, 1, 32, opts.current.maxVoices ?? 16)),
    lfoWaveform: isLfoWaveform(record.lfoWaveform) ? record.lfoWaveform : opts.current.lfoWaveform ?? "sine",
    lfoRateHz: clamp(record.lfoRateHz, 1, 20, opts.current.lfoRateHz ?? 4),
    lfoDepth: clamp(record.lfoDepth, 0, 1, opts.current.lfoDepth ?? 0),
    lfoSync: typeof record.lfoSync === "boolean" ? record.lfoSync : opts.current.lfoSync ?? false,
    lfoRetrigger: typeof record.lfoRetrigger === "boolean" ? record.lfoRetrigger : opts.current.lfoRetrigger ?? true,
    lfoToPitch: clamp(record.lfoToPitch, 0, 12, opts.current.lfoToPitch ?? 0),
    lfoToFilter: clamp(record.lfoToFilter, -1, 1, opts.current.lfoToFilter ?? 0),
    envToFilter: clamp(record.envToFilter, -1, 1, opts.current.envToFilter ?? 0),
    wavetable: kind === "wavetable" ? sanitizeWavetable(record.wavetable, opts.current.wavetable) : record.wavetable,
    aether: kind === "wavetable" ? sanitizeAether(record.aether, opts.current.aether) : record.aether,
    ...(sampleUrl ? { sampleUrl, sampleIds: [], source: { kind: "derived", label: "AI sample selection", url: sampleUrl, edited: false } } : {}),
  };
  return withAetherSynthPatch(patch, opts);
}

function sanitizeWavetable(value: unknown, fallback?: Instrument["wavetable"]): NonNullable<Instrument["wavetable"]> {
  const record = typeof value === "object" && value ? value as Partial<NonNullable<Instrument["wavetable"]>> : {};
  return {
    bank: isWavetableBank(record.bank) ? record.bank : fallback?.bank ?? "aether",
    position: clamp(record.position, 0, 1, fallback?.position ?? 0.35),
    warp: clamp(record.warp, 0, 1, fallback?.warp ?? 0.2),
    warpMode: record.warpMode === "fold" || record.warpMode === "pinch" ? record.warpMode : fallback?.warpMode ?? "shape",
    unison: Math.round(clamp(record.unison, 1, 8, fallback?.unison ?? 1)),
    detuneCents: clamp(record.detuneCents, 0, 100, fallback?.detuneCents ?? 12),
    blend: clamp(record.blend, 0, 1, fallback?.blend ?? 0.5),
  };
}

function sanitizeAether(value: unknown, fallback?: Instrument["aether"]): Instrument["aether"] {
  const record = typeof value === "object" && value ? value as Partial<NonNullable<Instrument["aether"]>> : {};
  const base = fallback ?? {
    oscA: {
      enabled: true,
      level: 0.78,
      pan: 0,
      waveform: "wavetable" as const,
      octave: 0,
      semitone: 0,
      fineCents: 0,
      phase: 0,
      randomPhase: 0.25,
      wavetable: sanitizeWavetable(undefined),
    },
    oscB: {
      enabled: false,
      level: 0.42,
      pan: 0,
      waveform: "wavetable" as const,
      octave: 0,
      semitone: 7,
      fineCents: -4,
      phase: 0,
      randomPhase: 0.25,
      wavetable: sanitizeWavetable({ bank: "glass", position: 0.25, warp: 0.16, warpMode: "shape", detuneCents: 8, blend: 0.35 }),
    },
    sub: { enabled: true, level: 0.18, octave: -1, waveform: "sine" as const },
    noise: { enabled: false, level: 0.08, color: 0.45 },
  };
  return {
    oscA: sanitizeAetherOsc(record.oscA, base.oscA),
    oscB: sanitizeAetherOsc(record.oscB, base.oscB),
    sub: {
      enabled: typeof record.sub?.enabled === "boolean" ? record.sub.enabled : base.sub.enabled,
      level: clamp(record.sub?.level, 0, 1, base.sub.level),
      octave: Math.round(clamp(record.sub?.octave, -4, 0, base.sub.octave)),
      waveform: record.sub?.waveform === "square" || record.sub?.waveform === "triangle" ? record.sub.waveform : "sine",
    },
    noise: {
      enabled: typeof record.noise?.enabled === "boolean" ? record.noise.enabled : base.noise.enabled,
      level: clamp(record.noise?.level, 0, 1, base.noise.level),
      color: clamp(record.noise?.color, 0, 1, base.noise.color),
    },
  };
}

function sanitizeAetherOsc(value: unknown, fallback: NonNullable<Instrument["aether"]>["oscA"]): NonNullable<Instrument["aether"]>["oscA"] {
  const record = typeof value === "object" && value ? value as Partial<NonNullable<Instrument["aether"]>["oscA"]> : {};
  const waveform = isAetherOscWaveform(record.waveform) ? record.waveform : fallback.waveform ?? "wavetable";
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    level: clamp(record.level, 0, 1, fallback.level),
    pan: clamp(record.pan, -1, 1, fallback.pan ?? 0),
    waveform,
    octave: Math.round(clamp(record.octave, -4, 4, fallback.octave)),
    semitone: Math.round(clamp(record.semitone, -24, 24, fallback.semitone)),
    fineCents: clamp(record.fineCents, -100, 100, fallback.fineCents),
    phase: clamp(record.phase, 0, 1, fallback.phase ?? 0),
    randomPhase: clamp(record.randomPhase, 0, 1, fallback.randomPhase ?? 0.25),
    wavetable: sanitizeWavetable(record.wavetable, fallback.wavetable),
  };
}

function generateLocalInstrumentPatch(opts: GenerateInstrumentOptions): Partial<Instrument> {
  const lower = opts.prompt.toLowerCase();
  const targetKind = opts.targetKind ?? opts.current.kind;
  const seed = (opts.variationSeed ?? Date.now()) + simpleHash(opts.prompt);
  const rnd = seededRandom(seed);
  const lane = instrumentDivergenceLane(seed, opts.prompt);
  const wantsSample = /\b(vocal|voice|drum|perc|kick|snare|hat|cymbal|sample|guitar|violin|flute|piano)\b/.test(lower);
  const samplePool = [
    ...opts.instruments
      .filter((instrument) => instrument.sampleUrl)
      .map((instrument) => ({ name: instrument.name, sampleUrl: instrument.sampleUrl, sourceLabel: instrument.source?.label ?? instrument.name })),
    ...opts.audioFiles.map((file) => ({ name: file.name, sampleUrl: file.path, sourceLabel: file.name })),
  ];
  const promptWords = lower.split(/\W+/).filter((word) => word.length > 2);
  const matchingSamples = samplePool.filter((sampleCandidate) =>
    promptWords.some((word) => sampleCandidate.name.toLowerCase().includes(word)),
  );
  const sample = wantsSample || lane.sampleBias > 0.72
    ? (matchingSamples.length > 0 ? matchingSamples : samplePool)[Math.floor(rnd() * Math.max(1, (matchingSamples.length > 0 ? matchingSamples : samplePool).length))]
    : undefined;
  const bright = /\b(bright|sharp|acid|pluck|lead)\b/.test(lower);
  const soft = /\b(soft|pad|warm|mellow|ambient)\b/.test(lower);
  const bowed = /\b(violin|viola|cello|string|strings|bowed)\b/.test(lower);
  const brass = /\b(brass|horn|trumpet|trombone)\b/.test(lower);
  const bell = /\b(bell|glass|mallet|chime)\b/.test(lower);
  const pluck = /\b(pluck|pizzicato|harp|short)\b/.test(lower);
  const kind: Instrument["kind"] = sample && lane.sampleBias > 0.45
    ? "sampler"
    : targetKind === "wavetable"
    ? "wavetable"
    : targetKind === "sampler"
    ? "sampler"
    : targetKind === "hybrid"
    ? "hybrid"
    : lane.kind === "wavetable"
    ? "wavetable"
    : lane.kind === "hybrid"
    ? "hybrid"
    : sample
    ? "sampler"
    : "synth";
  const longMotion = lane.motion === "evolving" || lane.motion === "swarm";
  const percussive = lane.motion === "pluck" || lane.motion === "strike";
  const noisy = lane.color === "noise" || lane.color === "metal";
  const envelopeStretch = 0.38 + rnd() * 2.28;
  const macroTilt = (rnd() - 0.5) * 0.58;
  const modulationLift = rnd() * 0.44;
  const sampleWarp = kind === "sampler" || kind === "hybrid" ? rnd() : 0;
  const sampleMotion = kind === "sampler" ? 0.72 + rnd() * 0.88 : 1;
  const patch: Partial<Instrument> = {
    name: `${lane.namePrefix} ${opts.prompt.trim() || "Instrument"}`.slice(0, 48),
    kind,
    waveform: kind === "sampler" ? "sample" : kind === "wavetable" ? "wavetable" : sample ? "sample" : lane.waveform ?? (bowed || soft ? "sine" : bright ? "saw" : "square"),
    envelope: {
      attackMs: Math.round((sampleWarp > 0.72 ? 1 + rnd() * 18 : longMotion ? 220 + rnd() * 2200 : bowed ? 60 + rnd() * 420 : soft ? 120 + rnd() * 420 : percussive || pluck ? 1 + rnd() * 32 : 2 + rnd() * 120) * envelopeStretch * sampleMotion),
      decayMs: Math.round((sampleWarp > 0.66 ? 42 + rnd() * 520 : longMotion ? 520 + rnd() * 2400 : bowed ? 300 + rnd() * 1200 : soft ? 360 + rnd() * 900 : percussive || pluck ? 32 + rnd() * 320 : 80 + rnd() * 620) * envelopeStretch * sampleMotion),
      sustain: clamp(longMotion ? 0.32 + rnd() * 0.62 : bowed ? 0.54 + rnd() * 0.38 : soft ? 0.46 + rnd() * 0.42 : percussive || pluck ? 0.02 + rnd() * 0.42 : 0.12 + rnd() * 0.68, 0, 1, 0.5),
      releaseMs: Math.round((sampleWarp > 0.58 ? 36 + rnd() * 2200 : longMotion ? 650 + rnd() * 5200 : bowed ? 260 + rnd() * 1500 : soft ? 420 + rnd() * 1700 : percussive || pluck ? 32 + rnd() * 420 : 80 + rnd() * 1050) * envelopeStretch * sampleMotion),
    },
    knobs: {
      cutoff: clamp((bright ? 0.82 : noisy ? 0.7 : bowed ? 0.54 : soft ? 0.46 : 0.65) + lane.cutoffOffset + macroTilt + (rnd() - 0.5) * 0.46, 0, 1, 0.6),
      resonance: clamp((bright || brass || lane.motion === "acid" || sampleWarp > 0.52 ? 0.3 : bowed ? 0.16 : 0.12) + rnd() * 0.52, 0, 1, 0.18),
      drive: clamp((/\b(distort|dirty|808|hard)\b/.test(lower) || noisy ? 0.32 : brass ? 0.16 : 0.04) + lane.driveOffset - macroTilt * 0.35 + rnd() * 0.38, 0, 1, 0.08),
      color: clamp((bright ? 0.72 : noisy ? 0.84 : bowed ? 0.38 : soft ? 0.44 : 0.52) - macroTilt * 0.45 + (rnd() - 0.5) * 0.58, 0, 1, 0.5),
    },
    detuneCents: Math.round((soft || bowed || longMotion ? 7 : 0) + rnd() * (kind === "sampler" ? 96 : lane.motion === "swarm" || sampleWarp > 0.6 ? 72 : 28)),
    octave: /\bbass|sub|808\b/.test(lower) ? -1 - Math.floor(rnd() * 2) : kind === "sampler" && sampleWarp > 0.62 ? [-2, -1, 0, 1][Math.floor(rnd() * 4)] ?? 0 : lane.octave,
    subOscLevel: clamp((/\bbass|sub|808\b/.test(lower) ? 0.34 : kind === "hybrid" ? 0.24 : lane.kind === "hybrid" ? 0.18 : kind === "sampler" ? 0.01 + sampleWarp * 0.12 : 0.03) + rnd() * (kind === "hybrid" ? 0.42 : kind === "sampler" ? 0.42 : 0.28), 0, 1, 0.08),
    glideMs: Math.round(/\bslide|glide|legato\b/.test(lower) || bowed || lane.motion === "glide" || sampleWarp > 0.7 ? 32 + rnd() * 360 : rnd() > 0.64 ? rnd() * 180 : 0),
    maxVoices: Math.max(1, Math.min(32, Math.round(/\bmono|lead|legato|slide|glide\b/.test(lower) ? 1 + rnd() * 5 : longMotion || soft ? 10 + rnd() * 14 : 6 + rnd() * 18))),
    lfoWaveform: lane.lfoWaveform,
    lfoRateHz: Math.round((lane.motion === "swarm" ? 7 + rnd() * 10 : bowed ? 4 + rnd() * 3 : 1.2 + rnd() * 7) * 10) / 10,
    lfoDepth: clamp((longMotion ? 0.18 : bowed ? 0.12 : lane.motion === "acid" ? 0.24 : 0.04) + modulationLift + rnd() * 0.34, 0, 1, 0.08),
    lfoSync: rnd() > 0.45,
    lfoRetrigger: true,
    lfoToPitch: /\bvibrato|siren\b/.test(lower) || bowed || lane.motion === "swarm" || sampleWarp > 0.64 ? Math.round(1 + rnd() * (kind === "sampler" ? 11 : 7)) : rnd() > 0.82 ? Math.round(rnd() * 4) : 0,
    lfoToFilter: /\bwah|pulse|wobble\b/.test(lower) || longMotion || lane.motion === "acid" || sampleWarp > 0.46 || rnd() > 0.62 ? clamp(-0.38 + rnd() * 1.48, -1, 1, 0.35) : 0,
    envToFilter: percussive || pluck || brass || /\bsnap\b/.test(lower) || sampleWarp > 0.36 || rnd() > 0.56 ? clamp(-0.22 + rnd() * 1.22, -1, 1, 0.25) : bowed || longMotion ? 0.08 + rnd() * 0.36 : 0,
    ...(kind === "wavetable" ? {
      wavetable: {
        bank: lane.bank ?? (bell ? "glass" : /\bvocal|choir|voice\b/.test(lower) || bowed ? "vocal" : /\borgan\b/.test(lower) ? "organ" : /\bfm|digital\b/.test(lower) ? "fm" : "aether"),
        position: clamp((bright ? 0.62 : bowed ? 0.48 : soft ? 0.28 : 0.42) + lane.positionOffset + (rnd() - 0.5) * 0.38, 0, 1, 0.42),
        warp: clamp((/\bdirty|fold|metal|hard\b/.test(lower) || noisy ? 0.52 : bowed ? 0.18 : 0.22) + rnd() * 0.32, 0, 1, 0.22),
        warpMode: /\bfold|hard|metal|dirty\b/.test(lower) || noisy ? "fold" : /\bpinch|tight|pluck|nasal\b/.test(lower) ? "pinch" : "shape",
        unison: Math.round(soft || bowed || longMotion || /\bwide|lush|supersaw\b/.test(lower) ? 3 + rnd() * 5 : 1 + rnd() * 4),
        detuneCents: Math.round((soft || bowed || longMotion || /\bwide|lush|supersaw\b/.test(lower) ? 16 : 6) + rnd() * 38),
        blend: clamp((soft || bowed || longMotion || /\bwide|lush|supersaw\b/.test(lower) ? 0.68 : 0.44) + rnd() * 0.28, 0, 1, 0.5),
      },
      aether: sanitizeAether({
        oscA: { enabled: true, level: 0.58 + rnd() * 0.36, waveform: lane.oscAWaveform },
        oscB: { enabled: lane.oscBEnabled, level: 0.16 + rnd() * 0.5, waveform: lane.oscBWaveform, octave: lane.oscBOctave, semitone: lane.oscBSemitone, fineCents: Math.round((rnd() - 0.5) * 42), pan: (rnd() - 0.5) * 0.7 },
        sub: { enabled: /\bbass|sub|808\b/.test(lower) || lane.subEnabled, level: 0.1 + rnd() * 0.32, octave: lane.subOctave, waveform: lane.subWaveform },
        noise: { enabled: noisy || bright && rnd() > 0.42, level: 0.035 + rnd() * 0.18, color: 0.2 + rnd() * 0.75 },
      }, opts.current.aether),
    } : {}),
    ...(sample?.sampleUrl ? { sampleUrl: sample.sampleUrl, sampleIds: [], source: { kind: "derived", label: sample.sourceLabel, url: sample.sampleUrl, edited: false } } : {}),
  };

  return withAetherSynthPatch(patch, opts);
}

interface InstrumentDivergenceLane {
  namePrefix: string;
  kind: "synth" | "wavetable" | "hybrid";
  motion: "evolving" | "pluck" | "strike" | "acid" | "glide" | "swarm";
  color: "warm" | "glass" | "metal" | "noise" | "vocal" | "analog";
  waveform?: Instrument["waveform"];
  bank?: NonNullable<Instrument["wavetable"]>["bank"];
  lfoWaveform: NonNullable<Instrument["lfoWaveform"]>;
  octave: number;
  sampleBias: number;
  cutoffOffset: number;
  driveOffset: number;
  positionOffset: number;
  oscAWaveform: NonNullable<Instrument["aether"]>["oscA"]["waveform"];
  oscBEnabled: boolean;
  oscBWaveform: NonNullable<Instrument["aether"]>["oscA"]["waveform"];
  oscBOctave: number;
  oscBSemitone: number;
  subEnabled: boolean;
  subOctave: number;
  subWaveform: NonNullable<Instrument["aether"]>["sub"]["waveform"];
}

function instrumentDivergenceLane(seed: number, prompt: string): InstrumentDivergenceLane {
  const rnd = seededRandom(seed + simpleHash(prompt) * 3 + 911);
  const pick = <T,>(items: T[]): T => items[Math.floor(rnd() * items.length)] ?? items[0];
  const motion = pick(["evolving", "pluck", "strike", "acid", "glide", "swarm"] as const);
  const color = pick(["warm", "glass", "metal", "noise", "vocal", "analog"] as const);
  const bankByColor: Record<InstrumentDivergenceLane["color"], NonNullable<Instrument["wavetable"]>["bank"]> = {
    warm: "aether",
    glass: "glass",
    metal: "fm",
    noise: "fm",
    vocal: "vocal",
    analog: "organ",
  };
  const kind = pick(["synth", "wavetable", "wavetable", "hybrid"] as const);
  const waveform = pick(["sine", "saw", "square", "triangle", "noise"] as const);
  return {
    namePrefix: pick(["Prism", "Bent", "Wide", "Dust", "Glass", "Phase", "Volt", "Bloom", "Rift", "Flux"]),
    kind,
    motion,
    color,
    waveform,
    bank: bankByColor[color],
    lfoWaveform: pick(["sine", "triangle", "saw", "square"] as const),
    octave: pick([-2, -1, 0, 0, 1]),
    sampleBias: rnd(),
    cutoffOffset: (rnd() - 0.5) * 0.28,
    driveOffset: (rnd() - 0.35) * 0.24,
    positionOffset: (rnd() - 0.5) * 0.42,
    oscAWaveform: pick(["wavetable", "saw", "square", "triangle", "sine", "noise"] as const),
    oscBEnabled: rnd() > 0.22,
    oscBWaveform: pick(["wavetable", "saw", "square", "triangle", "sine", "noise"] as const),
    oscBOctave: pick([-1, 0, 0, 1]),
    oscBSemitone: pick([-12, -7, -5, 3, 5, 7, 12]),
    subEnabled: rnd() > 0.48,
    subOctave: pick([-2, -1, -1, 0]),
    subWaveform: pick(["sine", "square", "triangle"] as const),
  };
}

interface MidiPhraseProfile {
  rhythmStep: number;
  restChance: number;
  leapChance: number;
  octaveBias: number;
  density: number;
  gate: number;
  inversion: number;
  direction: -1 | 1;
  contour: "rise" | "fall" | "arch" | "dip" | "wander";
}

function generateLocalMidiPattern({
  lengthBeats,
  style = "",
  role,
  key = "C minor",
  variationSeed,
  seedNotes = [],
}: {
  lengthBeats: number;
  style?: string;
  role?: MidiPatternRole;
  key?: string;
  variationSeed?: number;
  seedNotes?: MidiNote[];
}): MidiNote[] {
  const safeLength = Math.max(1, Math.min(32, Math.round(lengthBeats || 8)));
  const seed = (variationSeed ?? Date.now()) + simpleHash(style) + simpleHash(key) + seedNotes.length * 97;
  const rnd = seededRandom(seed);
  const chosenRole = role ?? inferMidiRole(style, rnd);
  const scale = scaleForKey(key);
  const profile = midiPhraseProfile(chosenRole, style, rnd);
  const progression = chordProgression(style, rnd);
  if (chosenRole === "chords") return generateChordLoop(safeLength, scale, progression, profile, rnd);
  if (chosenRole === "bass") return generateBassLoop(safeLength, scale, progression, profile, rnd);
  if (chosenRole === "arp") return generateArpLoop(safeLength, scale, progression, profile, rnd);
  return generateMelodyLoop(safeLength, scale, progression, chosenRole, profile, rnd);
}

function inferMidiRole(style: string, rnd: () => number): MidiPatternRole {
  const lower = style.toLowerCase();
  if (/\bbass|808|sub\b/.test(lower)) return "bass";
  if (/\bchord|pad|harmony|progression\b/.test(lower)) return "chords";
  if (/\barp|pluck|sequence\b/.test(lower)) return "arp";
  if (/\bcounter|response\b/.test(lower)) return "countermelody";
  return rnd() > 0.58 ? "melody" : rnd() > 0.5 ? "bass" : "chords";
}

function scaleForKey(key: string): number[] {
  const match = key.match(/\b([A-G](?:#|b)?)(?:\s+(minor|major|dorian|phrygian))?/i);
  const rootName = match?.[1] ?? "C";
  const mode = (match?.[2] ?? "minor").toLowerCase();
  const root = noteNameToMidi(rootName);
  const intervals = mode === "major"
    ? [0, 2, 4, 5, 7, 9, 11]
    : mode === "dorian"
    ? [0, 2, 3, 5, 7, 9, 10]
    : mode === "phrygian"
    ? [0, 1, 3, 5, 7, 8, 10]
    : [0, 2, 3, 5, 7, 8, 10];
  return intervals.map((interval) => root + interval);
}

function noteNameToMidi(name: string): number {
  const raw = name.trim();
  const normalized = raw.length > 1
    ? `${raw[0]?.toUpperCase() ?? "C"}${raw.slice(1).replace("♭", "b")}`
    : raw.toUpperCase();
  const roots: Record<string, number> = { C: 60, "C#": 61, Db: 61, D: 62, "D#": 63, Eb: 63, E: 64, F: 65, "F#": 66, Gb: 66, G: 67, "G#": 68, Ab: 68, A: 69, "A#": 70, Bb: 70, B: 71 };
  return roots[normalized] ?? 60;
}

function chordProgression(style: string, rnd: () => number): number[] {
  const lower = style.toLowerCase();
  const progressions = /\bjazz|neo|soul\b/.test(lower)
    ? [[0, 5, 3, 4], [0, 3, 6, 2], [0, 4, 5, 3], [1, 5, 0, 4], [0, 2, 5, 3]]
    : /\bpop|anthem|chorus\b/.test(lower)
    ? [[0, 5, 3, 4], [0, 3, 5, 4], [5, 3, 0, 4], [0, 4, 5, 3], [3, 5, 0, 4]]
    : [[0, 6, 5, 4], [0, 3, 4, 0], [0, 5, 6, 4], [0, 4, 3, 5], [0, 2, 6, 5], [5, 4, 0, 3]];
  return progressions[Math.floor(rnd() * progressions.length)] ?? progressions[0];
}

function midiPhraseProfile(role: MidiPatternRole, style: string, rnd: () => number): MidiPhraseProfile {
  const lower = style.toLowerCase();
  const dense = /\bfast|busy|run|arp|dance|drill|dnb\b/.test(lower);
  const sparse = /\bsparse|simple|minimal|space\b/.test(lower);
  const rhythmStep = role === "arp"
    ? (rnd() > 0.52 ? 0.25 : 0.5)
    : role === "bass"
    ? [0.5, 0.75, 1][Math.floor(rnd() * 3)] ?? 0.5
    : [0.25, 0.5, 0.75, 1][Math.floor(rnd() * 4)] ?? 0.5;
  return {
    rhythmStep,
    restChance: sparse ? 0.34 : dense ? 0.08 : 0.16 + rnd() * 0.18,
    leapChance: role === "bass" ? 0.18 + rnd() * 0.28 : role === "chords" ? 0.08 : 0.2 + rnd() * 0.38,
    octaveBias: role === "bass" ? -24 : role === "countermelody" ? 12 : rnd() > 0.74 ? 12 : 0,
    density: sparse ? 0.55 : dense ? 1.28 : 0.78 + rnd() * 0.62,
    gate: 0.48 + rnd() * 0.46,
    inversion: Math.floor(rnd() * 3),
    direction: rnd() > 0.5 ? 1 : -1,
    contour: (["rise", "fall", "arch", "dip", "wander"] as const)[Math.floor(rnd() * 5)] ?? "wander",
  };
}

function generateBassLoop(lengthBeats: number, scale: number[], progression: number[], profile: MidiPhraseProfile, rnd: () => number): MidiNote[] {
  const notes: MidiNote[] = [];
  const chordBeats = Math.max(1, lengthBeats / progression.length);
  progression.forEach((degree, chordIndex) => {
    const root = scale[degree % scale.length] - 24;
    const start = chordIndex * chordBeats;
    const mainLength = chordBeats * (0.34 + profile.gate * 0.48);
    notes.push(note(root + (rnd() < profile.leapChance ? 12 : 0), 90 + Math.round(rnd() * 28), start, mainLength));
    const subdivisions = Math.max(1, Math.floor(chordBeats / profile.rhythmStep));
    for (let i = 1; i < subdivisions; i += 1) {
      if (rnd() < profile.restChance) continue;
      const stepStart = start + i * profile.rhythmStep;
      if (stepStart >= start + chordBeats) continue;
      const degreeOffset = rnd() < profile.leapChance ? [2, 4, 5][Math.floor(rnd() * 3)] ?? 4 : [0, 1, 2][Math.floor(rnd() * 3)] ?? 0;
      const octave = rnd() > 0.72 ? 12 : 0;
      notes.push(note(scale[(degree + degreeOffset) % scale.length] - 24 + octave, 62 + Math.round(rnd() * 36), stepStart, profile.rhythmStep * profile.gate));
    }
  });
  return clipMidi(notes, lengthBeats);
}

function generateChordLoop(lengthBeats: number, scale: number[], progression: number[], profile: MidiPhraseProfile, rnd: () => number): MidiNote[] {
  const notes: MidiNote[] = [];
  const chordBeats = Math.max(1, lengthBeats / progression.length);
  progression.forEach((degree, index) => {
    const start = index * chordBeats;
    const split = profile.density > 1.06 && rnd() > 0.45;
    const chordStarts = split ? [start, start + chordBeats * (rnd() > 0.5 ? 0.5 : 0.625)] : [start];
    for (const chordStart of chordStarts) {
      const length = Math.min(chordBeats * profile.gate, start + chordBeats - chordStart);
      const voicing = [0, 2, 4, rnd() > 0.58 ? 6 : 7].slice(0, rnd() > 0.62 ? 4 : 3);
      for (const offset of voicing) {
        const inversionShift = offset < profile.inversion * 2 ? 12 : 0;
        notes.push(note(scale[(degree + offset) % scale.length] + inversionShift + (rnd() > 0.84 ? 12 : 0), 58 + Math.round(rnd() * 28), chordStart, length));
      }
    }
  });
  return clipMidi(notes, lengthBeats);
}

function generateArpLoop(lengthBeats: number, scale: number[], progression: number[], profile: MidiPhraseProfile, rnd: () => number): MidiNote[] {
  const notes: MidiNote[] = [];
  const step = profile.rhythmStep;
  const patterns = profile.direction > 0
    ? [[0, 2, 4, 7], [0, 4, 7, 2], [0, 2, 5, 4], [0, 1, 4, 6], [2, 4, 6, 9]]
    : [[7, 4, 2, 0], [4, 2, 7, 0], [5, 4, 2, 0], [6, 4, 1, 0], [9, 6, 4, 2]];
  const pattern = patterns[Math.floor(rnd() * patterns.length)] ?? patterns[0];
  const transposeDegree = rnd() > 0.58 ? [-2, -1, 1, 2][Math.floor(rnd() * 4)] ?? 0 : 0;
  for (let beat = 0; beat < lengthBeats; beat += step) {
    const chord = progression[Math.floor((beat / lengthBeats) * progression.length)] ?? 0;
    if (rnd() < profile.restChance * 0.45) continue;
    const patternIndex = Math.floor((beat / step + (rnd() > 0.66 ? 1 : 0)) % pattern.length);
    const degree = (pattern[patternIndex] ?? 0) + transposeDegree + (rnd() < profile.leapChance * 0.24 ? 7 : 0);
    const octave = 12 + (rnd() > 0.68 ? 12 : 0) + (rnd() > 0.9 ? -12 : 0);
    const scaleIndex = ((chord + degree) % scale.length + scale.length) % scale.length;
    notes.push(note(scale[scaleIndex] + octave, 52 + Math.round(rnd() * 42), beat, step * profile.gate));
  }
  return clipMidi(notes, lengthBeats);
}

function generateMelodyLoop(lengthBeats: number, scale: number[], progression: number[], role: MidiPatternRole, profile: MidiPhraseProfile, rnd: () => number): MidiNote[] {
  const notes: MidiNote[] = [];
  let beat = 0;
  let lastDegree = role === "countermelody" ? 4 : 2;
  while (beat < lengthBeats - 0.01) {
    const dur = profile.rhythmStep * ([1, 1, 1.5, 2, 3][Math.floor(rnd() * 5)] ?? 1);
    if (rnd() > profile.restChance) {
      const chord = progression[Math.floor((beat / lengthBeats) * progression.length)] ?? 0;
      const contourPush = profile.contour === "rise"
        ? 1
        : profile.contour === "fall"
        ? -1
        : profile.contour === "arch"
        ? beat < lengthBeats / 2 ? 1 : -1
        : profile.contour === "dip"
        ? beat < lengthBeats / 2 ? -1 : 1
        : 0;
      const leap = rnd() < profile.leapChance ? [-3, -2, 2, 3, 4][Math.floor(rnd() * 5)] ?? 2 : [-1, 0, 1][Math.floor(rnd() * 3)] ?? 0;
      lastDegree = Math.max(0, Math.min(scale.length - 1, lastDegree + leap + contourPush));
      const pitch = scale[(chord + lastDegree) % scale.length] + profile.octaveBias + (rnd() > 0.82 ? 12 : 0);
      notes.push(note(pitch, 66 + Math.round(rnd() * 46), beat, Math.min(dur * profile.gate, lengthBeats - beat)));
    }
    beat += dur;
  }
  return clipMidi(notes, lengthBeats);
}

function note(pitch: number, velocity: number, startBeat: number, lengthBeats: number): MidiNote {
  return {
    pitch: Math.max(0, Math.min(127, Math.round(pitch))),
    velocity: Math.max(1, Math.min(127, Math.round(velocity))),
    startBeat: Math.round(startBeat * 1000) / 1000,
    lengthBeats: Math.max(0.0625, Math.round(lengthBeats * 1000) / 1000),
  };
}

function clipMidi(notes: MidiNote[], lengthBeats: number): MidiNote[] {
  return notes
    .filter((candidate) => candidate.startBeat < lengthBeats)
    .map((candidate) => ({
      ...candidate,
      lengthBeats: Math.min(candidate.lengthBeats, Math.max(0.0625, lengthBeats - candidate.startBeat)),
    }));
}

function summarizeInstrument(instrument: Instrument) {
  return {
    name: instrument.name,
    kind: instrument.kind,
    waveform: instrument.waveform,
    envelope: instrument.envelope,
    knobs: instrument.knobs,
    sampleUrl: instrument.sampleUrl,
    descriptors: instrument.descriptors,
    detuneCents: instrument.detuneCents,
    octave: instrument.octave,
    subOscLevel: instrument.subOscLevel,
    glideMs: instrument.glideMs,
    maxVoices: instrument.maxVoices,
    lfoWaveform: instrument.lfoWaveform,
    lfoRateHz: instrument.lfoRateHz,
    lfoDepth: instrument.lfoDepth,
    lfoSync: instrument.lfoSync,
    lfoRetrigger: instrument.lfoRetrigger,
    lfoToPitch: instrument.lfoToPitch,
    lfoToFilter: instrument.lfoToFilter,
    envToFilter: instrument.envToFilter,
    wavetable: instrument.wavetable,
    aether: instrument.aether,
    synthPatch: instrument.synthPatch
      ? {
          name: instrument.synthPatch.name,
          tags: instrument.synthPatch.metadata.tags,
          parameters: instrument.synthPatch.parameters,
          modulation: instrument.synthPatch.modulation,
        }
      : undefined,
  };
}

function withAetherSynthPatch(patch: Partial<Instrument>, opts: GenerateInstrumentOptions): Partial<Instrument> {
  if (patch.kind !== "wavetable") return patch;

  const merged: Instrument = {
    ...opts.current,
    ...patch,
    kind: "wavetable",
    waveform: "wavetable",
    envelope: patch.envelope ? { ...opts.current.envelope, ...patch.envelope } : opts.current.envelope,
    knobs: patch.knobs ? { ...opts.current.knobs, ...patch.knobs } : opts.current.knobs,
    wavetable: patch.wavetable ? sanitizeWavetable(patch.wavetable, opts.current.wavetable) : sanitizeWavetable(undefined, opts.current.wavetable),
    aether: sanitizeAether(patch.aether, opts.current.aether),
    sampleIds: patch.sampleIds ?? opts.current.sampleIds ?? [],
    userCreated: opts.current.userCreated,
  };

  const synthPatch = synthDraftFromInstrument(merged);
  synthPatch.name = merged.name;
  synthPatch.metadata.tags = Array.from(new Set([...(merged.descriptors ?? []), "generated", "aether"])).slice(0, 16);
  synthPatch.metadata.icon = merged.icon ?? synthPatch.metadata.icon;

  return {
    ...patch,
    kind: "wavetable",
    waveform: "wavetable",
    wavetable: merged.wavetable,
    aether: merged.aether,
    synthPatch,
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function isInstrumentKind(value: unknown): value is Instrument["kind"] {
  return value === "synth" || value === "wavetable" || value === "sampler" || value === "hybrid";
}

function isWaveform(value: unknown): value is Instrument["waveform"] {
  return value === "sine" || value === "saw" || value === "square" || value === "triangle" || value === "noise" || value === "sample" || value === "wavetable";
}

function isWavetableBank(value: unknown): value is NonNullable<Instrument["wavetable"]>["bank"] {
  return value === "aether" || value === "glass" || value === "vocal" || value === "organ" || value === "fm";
}

function isAetherOscWaveform(value: unknown): value is NonNullable<Instrument["aether"]>["oscA"]["waveform"] {
  return value === "sine" || value === "saw" || value === "square" || value === "triangle" || value === "noise" || value === "wavetable";
}

function isLfoWaveform(value: unknown): value is NonNullable<Instrument["lfoWaveform"]> {
  return value === "sine" || value === "triangle" || value === "saw" || value === "square";
}

async function generateDrumBeatWithOllama(opts: GenerateDrumBeatOptions): Promise<GeneratedDrumBeat> {
  const prompt = buildDrumPrompt(opts);
  const model = getOllamaModel();
  try {
    const res = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: {
          temperature: 0.85,
          top_p: 0.9,
        },
        messages: [
          {
            role: "system",
            content: [
              "You generate drum sequencer JSON for a music app.",
              "Return ONLY valid JSON, no markdown.",
              "Use the provided instrument IDs only.",
              "Prefer uploaded or user-created instruments when they clearly match the requested drum role.",
              "Cells may include on, velocity 0-127, leanPercent -50..50, pitchHz 20..20000.",
              "Think like a drummer: central meter beats should be louder, supporting filler and texture hits should be lighter.",
              "Respect timeSignature and boldBeats; odd meters such as 5/4 or 7/8 must feel grouped differently from 4/4.",
              "Treat genre as a ruleset, not a fixed loop.",
              "Assemble the beat from modular choices: heaviness, row count, core anchors, syncopation, hat density, texture layer, fills, and velocity/humanization.",
              "Use variationSeed to change those choices materially while preserving the genre identity.",
            ].join(" "),
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const json = await res.json() as { message?: { content?: string }; model?: string };
    const parsed = JSON.parse(json.message?.content ?? "{}");
    const generated = sanitizeGeneratedDrumBeat(parsed, opts);
    if (!generated) throw new Error("Ollama returned invalid drum beat JSON");
    return {
      ...generated,
      source: "ollama",
      prompt,
      model: json.model ?? model,
    };
  } catch (error) {
    console.info("Ollama drum generation unavailable; using local fallback.", error);
    return {
      ...generateLocalDrumBeat(opts),
      source: "local",
      prompt,
    };
  }
}

function buildDrumPrompt(opts: GenerateDrumBeatOptions): string {
  const instruments = opts.instruments.map((instrument) => ({
    id: instrument.id,
    name: instrument.name,
    kind: instrument.kind,
    waveform: instrument.waveform,
    userCreated: instrument.userCreated,
    source: instrument.source,
    sampleUrl: instrument.sampleUrl,
    sampleUrls: instrument.sampleUrls,
    sampleMap: instrument.sampleMap?.slice(0, 8).map((zone) => ({
      name: zone.name,
      path: zone.path,
      rootNote: zone.rootNote,
      loNote: zone.loNote,
      hiNote: zone.hiNote,
    })),
    descriptors: instrument.descriptors,
  }));
  const positive = opts.feedbackExamples
    ?.filter((example) => example.rating === "up" && example.genre === opts.genre)
    .slice(0, 3)
    .map((example) => ({
      genre: example.genre,
      swingPercent: example.beat.swingPercent,
      speed: example.beat.speed,
      rows: summarizeRows(example.beat.rows),
    }));
  const negative = opts.feedbackExamples
    ?.filter((example) => example.rating === "down" && example.genre === opts.genre)
    .slice(0, 3)
    .map((example) => ({
      genre: example.genre,
      userFeedback: example.userFeedback,
      rows: summarizeRows(example.beat.rows),
    }));

  return JSON.stringify({
    task: "Generate one editable drum beat for the current drum sequencer.",
    genre: opts.genre,
    genreGuideline: DRUM_GENRE_GUIDELINES[opts.genre],
    variationSeed: opts.variationSeed,
    sequencer: {
      currentStepCount: opts.stepCount,
      currentLengthBeats: opts.lengthBeats,
      currentSpeed: opts.speed,
      timeSignature: opts.timeSignature,
      complexity: opts.complexity ?? 50,
    },
    nonAiFallbackContract: {
      description: "Beat's local generator is a modular groove rules engine, not one monolithic example loop.",
      knobs: ["heaviness", "syncopation", "fillRate", "texture", "targetRows", "density"],
      expectation: "Model output should look like an assembled groove with choices, not a copied genre template.",
    },
    availableInstruments: instruments,
    likedExamples: positive ?? [],
    dislikedExamples: negative ?? [],
    outputSchema: {
      stepCount: "integer 1..128",
      lengthBeats: "integer 1..128; this is the visible/grid length. Musical duration is lengthBeats / speed",
      speed: "one of 1,2,3,4,5,6",
      swingPercent: "integer 0..100; 50 is straight, above 50 delays offbeats for swing, below 50 pushes offbeats earlier",
      defaultPitchHz: "optional number",
      rows: [{
        instrumentId: "one id from availableInstruments",
        name: "short row name",
        steps: ["false or { on:true, velocity?:0..127, leanPercent?:-50..50, pitchHz?:20..20000 }"],
      }],
    },
    instruction: "Treat genreGuideline as the rulebook. Preserve its coreBeat anchors first, then vary around them according to genreGuideline.hatDensity/hatsPerc, swing, kickComplexity, fillRate, humanization, and special. Complexity 50 is the ideal canonical groove for the genre, not a request for maximum density. Below 50 should simplify/strip down. Above 50 should add tasteful detail through fills, chops, velocity detail, ghost notes, rhythmic variation, and sometimes one extra texture/instrument row. Pick a beat heaviness profile: light, balanced, heavy, or broken. Pick an instrumentation profile: minimal core kit, core plus hats, core plus texture, or core plus phrase fill. Prefer sampled drum instruments, especially uploaded/userCreated instruments whose name, source, sampleMap, or descriptors match the guideline instruments. Make rhythm genre-appropriate, musical, and editable. Speed is grid compression/resolution, not a command to make the beat frantic. Higher speed only makes sense when lengthBeats also increases enough to preserve musical duration. For longer phrases, prefer more lengthBeats and cap speed lower instead of returning a long 16x pattern. Use velocity variation and small leanPercent values like a real drummer. Accentuate the meter: strong beats should anchor kick or main snare/clap, secondary bold beats should support, and filler/texture notes between them should be lower velocity. For 5/4 prefer a 3+2 or 2+3 grouping; for 7/8 prefer 2+2+3 or 3+2+2 grouping.",
  });
}

function summarizeRows(rows: GeneratedDrumBeat["rows"]) {
  return rows.slice(0, 6).map((row) => ({
    name: row.name,
    instrumentId: row.instrumentId,
    hits: row.steps
      .map((step, index) => {
        if (!step) return null;
        if (typeof step === "object") {
          return {
            step: index + 1,
            velocity: step.velocity,
            leanPercent: step.leanPercent,
            pitchHz: step.pitchHz,
          };
        }
        return { step: index + 1 };
      })
      .filter(Boolean),
  }));
}

const DEFAULT_OLLAMA_MODEL = "qwen3:4b";
const OLLAMA_MODEL_STORAGE_KEY = "beat.ollama.model";

export function getOllamaModel(): string {
  return localStorage.getItem(OLLAMA_MODEL_STORAGE_KEY) || DEFAULT_OLLAMA_MODEL;
}

export function setOllamaModel(model: string) {
  const trimmed = model.trim();
  if (!trimmed) {
    localStorage.removeItem(OLLAMA_MODEL_STORAGE_KEY);
    return;
  }
  localStorage.setItem(OLLAMA_MODEL_STORAGE_KEY, trimmed);
}

// Global singleton.
export const ai: AiService = LocalAiService;
