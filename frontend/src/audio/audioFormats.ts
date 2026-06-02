export const SUPPORTED_AUDIO_IMPORT_EXTENSIONS = [
  ".wav",
  ".aif",
  ".aiff",
  ".mp3",
  ".flac",
  ".ogg",
  ".m4a",
  ".webm",
] as const;

export const SUPPORTED_AUDIO_IMPORT_LABEL = "WAV, AIFF, MP3, FLAC, OGG, M4A, WebM";

export function isSupportedAudioFileName(nameOrPath: string | undefined): boolean {
  if (!nameOrPath) return false;
  const lower = nameOrPath.toLowerCase();
  return SUPPORTED_AUDIO_IMPORT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
