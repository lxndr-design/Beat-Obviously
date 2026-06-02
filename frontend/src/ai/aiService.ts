import type { AudioFile, Instrument, MidiNote } from "../state/types";
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

  async generatePattern({ lengthBeats }) {
    const notes: MidiNote[] = [];
    // Simple 4-on-the-floor kick pattern as placeholder.
    for (let beat = 0; beat < lengthBeats; beat++) {
      notes.push({ pitch: 36, velocity: 100, startBeat: beat, lengthBeats: 0.25 });
    }
    return notes;
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
  let state = Math.max(1, Math.floor(seed) % 2147483647);
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
          temperature: 0.85,
          top_p: 0.9,
        },
        messages: [
          {
            role: "system",
            content: [
              "You generate editable instrument settings for a music app.",
              "Return ONLY valid JSON, no markdown.",
              "Stay within provided numeric ranges.",
              "Respect targetInstrumentType unless the user explicitly asks for a different type.",
              "Use variationSeed to produce a meaningfully different patch for repeated prompts.",
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
      aether: "For kind wavetable, return kind wavetable, waveform wavetable, wavetable settings, and optional aether.oscA/oscB/sub/noise settings.",
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
      aether: "optional Aether oscillator stack for kind wavetable",
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

  return {
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
}

function sanitizeWavetable(value: unknown, fallback?: Instrument["wavetable"]): NonNullable<Instrument["wavetable"]> {
  const record = typeof value === "object" && value ? value as Partial<NonNullable<Instrument["wavetable"]>> : {};
  return {
    bank: isWavetableBank(record.bank) ? record.bank : fallback?.bank ?? "aether",
    position: clamp(record.position, 0, 1, fallback?.position ?? 0.35),
    warp: clamp(record.warp, 0, 1, fallback?.warp ?? 0.2),
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
      wavetable: sanitizeWavetable({ bank: "glass", position: 0.25, warp: 0.16, detuneCents: 8, blend: 0.35 }),
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
    wavetable: sanitizeWavetable(record.wavetable, fallback.wavetable),
  };
}

function generateLocalInstrumentPatch(opts: GenerateInstrumentOptions): Partial<Instrument> {
  const lower = opts.prompt.toLowerCase();
  const targetKind = opts.targetKind ?? opts.current.kind;
  const rnd = seededRandom((opts.variationSeed ?? Date.now()) + simpleHash(opts.prompt));
  const wantsSample = /\b(vocal|voice|drum|perc|kick|snare|hat|cymbal|sample|guitar|violin|flute|piano)\b/.test(lower);
  const sample = wantsSample
    ? opts.instruments.find((instrument) => instrument.sampleUrl && lower.split(/\W+/).some((word) => word.length > 2 && instrument.name.toLowerCase().includes(word)))
      ?? opts.instruments.find((instrument) => instrument.sampleUrl)
    : undefined;
  const bright = /\b(bright|sharp|acid|pluck|lead)\b/.test(lower);
  const soft = /\b(soft|pad|warm|mellow|ambient)\b/.test(lower);
  const bowed = /\b(violin|viola|cello|string|strings|bowed)\b/.test(lower);
  const brass = /\b(brass|horn|trumpet|trombone)\b/.test(lower);
  const bell = /\b(bell|glass|mallet|chime)\b/.test(lower);
  const pluck = /\b(pluck|pizzicato|harp|short)\b/.test(lower);
  const kind: Instrument["kind"] = targetKind === "wavetable"
    ? "wavetable"
    : targetKind === "sampler"
    ? "sampler"
    : targetKind === "hybrid"
    ? "hybrid"
    : sample
    ? "sampler"
    : "synth";
  return {
    name: opts.prompt.trim().slice(0, 32) || "AI Instrument",
    kind,
    waveform: kind === "sampler" ? "sample" : kind === "wavetable" ? "wavetable" : sample ? "sample" : bowed || soft ? "sine" : bright ? "saw" : "square",
    envelope: {
      attackMs: Math.round(bowed ? 80 + rnd() * 220 : soft ? 180 + rnd() * 180 : pluck ? 2 + rnd() * 10 : 4 + rnd() * 18),
      decayMs: Math.round(bowed ? 450 + rnd() * 700 : soft ? 520 + rnd() * 420 : pluck ? 70 + rnd() * 130 : 120 + rnd() * 180),
      sustain: bowed ? 0.68 + rnd() * 0.24 : soft ? 0.64 + rnd() * 0.24 : pluck ? 0.18 + rnd() * 0.22 : 0.28 + rnd() * 0.24,
      releaseMs: Math.round(bowed ? 420 + rnd() * 900 : soft ? 700 + rnd() * 800 : pluck ? 90 + rnd() * 180 : 140 + rnd() * 240),
    },
    knobs: {
      cutoff: clamp((bright ? 0.82 : bowed ? 0.54 : soft ? 0.46 : 0.65) + (rnd() - 0.5) * 0.18, 0, 1, 0.6),
      resonance: clamp((bright || brass ? 0.25 : bowed ? 0.16 : 0.12) + rnd() * 0.12, 0, 1, 0.18),
      drive: clamp((/\b(distort|dirty|808|hard)\b/.test(lower) ? 0.38 : brass ? 0.16 : 0.06) + rnd() * 0.12, 0, 1, 0.08),
      color: clamp((bright ? 0.72 : bowed ? 0.38 : soft ? 0.44 : 0.52) + (rnd() - 0.5) * 0.2, 0, 1, 0.5),
    },
    detuneCents: Math.round((soft || bowed ? 6 : 0) + rnd() * 16),
    octave: /\bbass|sub|808\b/.test(lower) ? -1 : 0,
    subOscLevel: clamp((/\bbass|sub|808\b/.test(lower) ? 0.38 : 0.04) + rnd() * 0.12, 0, 1, 0.08),
    glideMs: Math.round(/\bslide|glide|legato\b/.test(lower) || bowed ? 60 + rnd() * 180 : rnd() > 0.82 ? rnd() * 80 : 0),
    lfoWaveform: "sine",
    lfoRateHz: Math.round((bowed ? 4 + rnd() * 3 : 3 + rnd() * 5) * 10) / 10,
    lfoDepth: clamp((bowed ? 0.12 : 0.04) + rnd() * 0.08, 0, 1, 0.08),
    lfoSync: false,
    lfoRetrigger: true,
    lfoToPitch: /\bvibrato|siren\b/.test(lower) || bowed ? Math.round(1 + rnd() * 3) : 0,
    lfoToFilter: /\bwah|pulse|wobble\b/.test(lower) ? 0.35 : 0,
    envToFilter: pluck || brass || /\bsnap\b/.test(lower) ? 0.35 + rnd() * 0.3 : bowed ? 0.08 + rnd() * 0.12 : 0,
    ...(kind === "wavetable" ? {
      wavetable: {
        bank: bell ? "glass" : /\bvocal|choir|voice\b/.test(lower) || bowed ? "vocal" : /\borgan\b/.test(lower) ? "organ" : /\bfm|digital\b/.test(lower) ? "fm" : "aether",
        position: clamp((bright ? 0.62 : bowed ? 0.48 : soft ? 0.28 : 0.42) + (rnd() - 0.5) * 0.28, 0, 1, 0.42),
        warp: clamp((/\bdirty|fold|metal|hard\b/.test(lower) ? 0.5 : bowed ? 0.18 : 0.22) + rnd() * 0.18, 0, 1, 0.22),
        unison: Math.round(soft || bowed || /\bwide|lush|supersaw\b/.test(lower) ? 3 + rnd() * 4 : 1 + rnd() * 2),
        detuneCents: Math.round((soft || bowed || /\bwide|lush|supersaw\b/.test(lower) ? 16 : 6) + rnd() * 22),
        blend: clamp((soft || bowed || /\bwide|lush|supersaw\b/.test(lower) ? 0.68 : 0.44) + rnd() * 0.22, 0, 1, 0.5),
      },
      aether: sanitizeAether({
        oscA: { enabled: true, level: 0.72 + rnd() * 0.18, waveform: "wavetable" },
        oscB: { enabled: rnd() > 0.35, level: 0.22 + rnd() * 0.35, waveform: rnd() > 0.4 ? "wavetable" : bowed ? "sine" : "saw", semitone: bowed ? 7 : rnd() > 0.5 ? 12 : 7, fineCents: Math.round((rnd() - 0.5) * 16) },
        sub: { enabled: /\bbass|sub|808\b/.test(lower), level: 0.12 + rnd() * 0.18, octave: -1, waveform: "sine" },
        noise: { enabled: bright && rnd() > 0.55, level: 0.04 + rnd() * 0.08, color: 0.35 + rnd() * 0.5 },
      }, opts.current.aether),
    } : {}),
    ...(sample?.sampleUrl ? { sampleUrl: sample.sampleUrl, sampleIds: [], source: { kind: "derived", label: sample.name, url: sample.sampleUrl, edited: false } } : {}),
  };
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
    lfoWaveform: instrument.lfoWaveform,
    lfoRateHz: instrument.lfoRateHz,
    lfoDepth: instrument.lfoDepth,
    lfoSync: instrument.lfoSync,
    lfoRetrigger: instrument.lfoRetrigger,
    lfoToPitch: instrument.lfoToPitch,
    lfoToFilter: instrument.lfoToFilter,
    envToFilter: instrument.envToFilter,
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
              "Treat genre as a ruleset, not a fixed loop. Vary within that ruleset using variationSeed.",
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
    instruction: "Treat genreGuideline as the rulebook. Preserve its coreBeat anchors first, then vary around them according to genreGuideline.hatDensity/hatsPerc, swing, kickComplexity, fillRate, humanization, and special. Complexity 50 is the ideal canonical groove for the genre, not a request for lots of instruments. Complexity must not add more instrument rows by itself; it changes density, fills, chops, velocity detail, ghost notes, and rhythmic variation inside the genre's normal instrumentation. Below 50 should simplify/strip down. Above 50 should add tasteful detail within existing roles. Prefer sampled drum instruments, especially uploaded/userCreated instruments whose name, source, sampleMap, or descriptors match the guideline instruments. Make rhythm genre-appropriate, musical, and editable. Speed is grid compression/resolution, not a command to make the beat frantic. Higher speed only makes sense when lengthBeats also increases enough to preserve musical duration. For longer phrases, prefer more lengthBeats and cap speed lower instead of returning a long 16x pattern. Use velocity variation and small leanPercent values like a real drummer. Accentuate the meter: strong beats should anchor kick or main snare/clap, secondary bold beats should support, and filler/texture notes between them should be lower velocity. For 5/4 prefer a 3+2 or 2+3 grouping; for 7/8 prefer 2+2+3 or 3+2+2 grouping.",
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
