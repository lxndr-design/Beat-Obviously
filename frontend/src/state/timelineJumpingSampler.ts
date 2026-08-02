import type { AudioFile, Instrument, InstrumentSampleZone } from "./types";

export const TIMELINE_JUMPING_COMPLEXITY = "timeline-jumping" as const;
export const TIMELINE_JUMPING_DEFAULT_PITCH = 48;

export function isTimelineJumpingInstrument(instrument?: Pick<Instrument, "samplerComplexity">): boolean {
  return instrument?.samplerComplexity === TIMELINE_JUMPING_COMPLEXITY;
}

export function midiPitchLabel(pitch: number): string {
  const normalized = Math.max(0, Math.min(127, Math.round(pitch)));
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[normalized % 12]}${Math.floor(normalized / 12) - 1}`;
}

export function nextTimelineJumpingPitch(zones: InstrumentSampleZone[], preferred = TIMELINE_JUMPING_DEFAULT_PITCH): number | null {
  const used = new Set(zones.map((zone) => Math.max(0, Math.min(127, Math.round(zone.rootNote)))));
  const start = Math.max(0, Math.min(127, Math.round(preferred)));
  for (let pitch = start; pitch <= 127; pitch += 1)
    if (!used.has(pitch)) return pitch;
  for (let pitch = start - 1; pitch >= 0; pitch -= 1)
    if (!used.has(pitch)) return pitch;
  return null;
}

export function timelineJumpingZoneSeconds(zone: InstrumentSampleZone, sampleRate: number, sourceDurationSeconds: number) {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44_100;
  const duration = Number.isFinite(sourceDurationSeconds) ? Math.max(0, sourceDurationSeconds) : 0;
  const startSeconds = Math.max(0, Math.min(duration, (zone.startSample ?? 0) / rate));
  const rawEnd = zone.endSample && zone.endSample > (zone.startSample ?? 0)
    ? zone.endSample / rate
    : duration;
  const endSeconds = Math.max(startSeconds, Math.min(duration, rawEnd));
  return { startSeconds, endSeconds };
}

export function createTimelineJumpingZone(options: {
  source: Pick<AudioFile, "path" | "sampleRate" | "durationSeconds">;
  pitch: number;
  startSeconds: number;
  endSeconds?: number;
  name?: string;
  seqPosition?: number;
}): InstrumentSampleZone {
  const pitch = Math.max(0, Math.min(127, Math.round(options.pitch)));
  const sampleRate = options.source.sampleRate > 0 ? options.source.sampleRate : 44_100;
  const duration = Math.max(0, options.source.durationSeconds);
  const startSeconds = Math.max(0, Math.min(duration, options.startSeconds));
  const endSeconds = Math.max(
    startSeconds + 1 / sampleRate,
    Math.min(duration, options.endSeconds ?? duration),
  );
  const startSample = Math.max(0, Math.round(startSeconds * sampleRate));
  const endSample = Math.max(startSample + 1, Math.round(endSeconds * sampleRate));
  return {
    id: `timeline-jump-${crypto.randomUUID()}`,
    path: options.source.path,
    name: options.name?.trim() || `Pad ${midiPitchLabel(pitch)} · ${formatTimelineSeconds(startSeconds)}`,
    rootNote: pitch,
    loNote: pitch,
    hiNote: pitch,
    loVel: 0,
    hiVel: 127,
    volumeDb: 0,
    pan: 0,
    tuning: 0,
    seqPosition: Math.max(0, Math.round(options.seqPosition ?? 0)),
    oneShot: false,
    durationSeconds: Math.max(0, endSeconds - startSeconds),
    startSample,
    endSample,
  };
}

export function normalizeTimelineJumpingZone(
  zone: InstrumentSampleZone,
  source: Pick<AudioFile, "path" | "sampleRate" | "durationSeconds">,
  patch: Partial<Pick<InstrumentSampleZone, "name" | "rootNote" | "startSample" | "endSample" | "volumeDb" | "pan">> = {},
): InstrumentSampleZone {
  const merged = { ...zone, ...patch };
  const pitch = Math.max(0, Math.min(127, Math.round(merged.rootNote)));
  const sampleRate = source.sampleRate > 0 ? source.sampleRate : 44_100;
  const sourceSamples = Math.max(2, Math.round(Math.max(0, source.durationSeconds) * sampleRate));
  const startSample = Math.max(0, Math.min(sourceSamples - 2, Math.round(merged.startSample ?? 0)));
  const endSample = Math.max(startSample + 2, Math.min(sourceSamples, Math.round(merged.endSample ?? sourceSamples)));
  return {
    ...merged,
    path: source.path,
    rootNote: pitch,
    loNote: pitch,
    hiNote: pitch,
    loVel: 0,
    hiVel: 127,
    tuning: 0,
    oneShot: false,
    startSample,
    endSample,
    durationSeconds: (endSample - startSample) / sampleRate,
  };
}

export function formatTimelineSeconds(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(3).padStart(6, "0")}`;
}
