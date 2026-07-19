export const AETHER_MAX_UNISON_VOICES = 16;

export function clampAetherUnisonVoices(value: number): number {
  return Math.max(1, Math.min(AETHER_MAX_UNISON_VOICES, Math.round(value)));
}
