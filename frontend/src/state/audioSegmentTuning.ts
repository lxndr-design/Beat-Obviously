export const AUDIO_TUNE_REFERENCE_PITCH = 60;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export function audioTunePitchName(pitch: number): string {
  const clamped = Math.max(0, Math.min(127, Math.round(pitch)));
  return `${NOTE_NAMES[clamped % 12]}${Math.floor(clamped / 12) - 1}`;
}

export function audioTuneRate(pitch?: number): number {
  if (pitch == null || !Number.isFinite(pitch)) return 1;
  const clamped = Math.max(0, Math.min(127, Math.round(pitch)));
  return 2 ** ((clamped - AUDIO_TUNE_REFERENCE_PITCH) / 12);
}

export const AUDIO_TUNE_OPTIONS = [
  { value: "", label: "Original" },
  ...Array.from({ length: 128 }, (_, pitch) => ({
    value: String(pitch),
    label: audioTunePitchName(pitch),
  })),
];
