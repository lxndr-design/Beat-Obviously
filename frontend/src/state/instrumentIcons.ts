import type { Instrument } from "./types";

export interface InstrumentIconOption {
  icon: string;
  label: string;
  tags: string[];
}

export const INSTRUMENT_ICON_OPTIONS: InstrumentIconOption[] = [
  { icon: "ph:piano-keys", label: "Keys", tags: ["synth", "piano", "keyboard", "organ"] },
  { icon: "ph:waveform", label: "Waveform", tags: ["wavetable", "synth", "oscillator"] },
  { icon: "ph:music-notes", label: "Notes", tags: ["sampler", "melody", "general"] },
  { icon: "ph:drum", label: "Drum", tags: ["drum", "kit", "percussion"] },
  { icon: "ph:disc", label: "Kick", tags: ["kick", "bass drum", "808"] },
  { icon: "ph:circle", label: "Snare", tags: ["snare", "clap", "rim"] },
  { icon: "ph:triangle", label: "Hat", tags: ["hat", "hihat", "cymbal", "triangle"] },
  { icon: "ph:bell", label: "Bell", tags: ["bell", "chime", "mallet"] },
  { icon: "ph:guitar", label: "Guitar", tags: ["guitar", "string", "pluck"] },
  { icon: "ph:violin", label: "Strings", tags: ["violin", "viola", "cello", "strings"] },
  { icon: "ph:microphone-stage", label: "Vocal", tags: ["vocal", "voice", "choir"] },
  { icon: "ph:microphone", label: "Mic", tags: ["recording", "sample", "voice"] },
  { icon: "ph:speaker-high", label: "Audio", tags: ["audio", "sample", "field"] },
  { icon: "ph:radio", label: "Radio", tags: ["radio", "lofi", "noise"] },
  { icon: "ph:wind", label: "Wind", tags: ["flute", "woodwind", "breath"] },
  { icon: "ph:horn", label: "Horn", tags: ["brass", "trumpet", "horn"] },
  { icon: "ph:shooting-star", label: "FX", tags: ["fx", "impact", "riser"] },
  { icon: "ph:planet", label: "Pad", tags: ["pad", "ambient", "space"] },
  { icon: "ph:lightning", label: "Lead", tags: ["lead", "acid", "bright"] },
  { icon: "ph:spiral", label: "Texture", tags: ["texture", "noise", "granular"] },
  { icon: "ph:wave-sine", label: "Sine", tags: ["sine", "pure", "sub"] },
  { icon: "ph:wave-sawtooth", label: "Saw", tags: ["saw", "supersaw", "lead"] },
  { icon: "ph:wave-square", label: "Square", tags: ["square", "pulse", "chip"] },
  { icon: "ph:wave-triangle", label: "Triangle", tags: ["triangle", "soft", "perc"] },
  { icon: "ph:stack", label: "Layer", tags: ["hybrid", "layer", "stack"] },
  { icon: "ph:cube", label: "Aether", tags: ["aether", "wavetable", "3d"] },
  { icon: "ph:diamonds-four", label: "Perc", tags: ["percussion", "shaker", "conga"] },
  { icon: "ph:metronome", label: "Rhythm", tags: ["rhythm", "sequence", "loop"] },
  { icon: "ph:vinyl-record", label: "Record", tags: ["vinyl", "sample", "loop"] },
  { icon: "ph:sparkle", label: "Magic", tags: ["ai", "generated", "special"] },
];

export function instrumentIcon(instrument: Pick<Instrument, "icon" | "kind" | "name" | "waveform" | "sampleUrl" | "descriptors">): string {
  if (instrument.icon) return instrument.icon;
  const haystack = [
    instrument.name,
    instrument.kind,
    instrument.waveform,
    instrument.sampleUrl,
    ...(instrument.descriptors ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  const match = INSTRUMENT_ICON_OPTIONS.find((option) =>
    option.tags.some((tag) => haystack.includes(tag.toLowerCase())),
  );
  if (match) return match.icon;
  if (instrument.kind === "synth") return "ph:piano-keys";
  if (instrument.kind === "sampler") return "ph:music-notes";
  return "ph:waveform";
}

export function instrumentIconLabel(icon: string | undefined): string {
  return INSTRUMENT_ICON_OPTIONS.find((option) => option.icon === icon)?.label ?? "Instrument icon";
}
