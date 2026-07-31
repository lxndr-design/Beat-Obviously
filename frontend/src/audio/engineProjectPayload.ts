import type { AudioFile, Instrument, Project } from "../state/types";

/**
 * The realtime engine needs project-owned clip assets, not the entire global
 * audio-file library. Keeping this payload scoped avoids serializing thousands
 * of unrelated library rows on every project or instrument update.
 */
export function engineAudioFilesForProject(project: Project, audioFiles: AudioFile[]): AudioFile[] {
  const requiredIds = new Set<string>();
  for (const track of project.tracks) {
    if (track.audioFileId) requiredIds.add(track.audioFileId);
    if (track.freezeSource?.audioFileId) requiredIds.add(track.freezeSource.audioFileId);
    for (const segment of track.segments) {
      if (segment.payload.kind === "audio" || segment.payload.kind === "mixed") {
        requiredIds.add(segment.payload.audioFileId);
      }
    }
  }
  return requiredIds.size === 0 ? [] : audioFiles.filter((file) => requiredIds.has(file.id));
}

export function engineInstrumentsForProject(project: Project, instruments: Instrument[]): Instrument[] {
  const requiredIds = new Set<string>();
  for (const track of project.tracks) {
    if (track.instrumentId) requiredIds.add(track.instrumentId);
    for (const segment of track.segments) {
      if (segment.instrumentId) requiredIds.add(segment.instrumentId);
      if (segment.payload.kind === "drum") {
        for (const row of segment.payload.rows) {
          if (row.instrumentId) requiredIds.add(row.instrumentId);
        }
      } else if (segment.payload.kind === "drumpad") {
        for (const lane of segment.payload.lanes) {
          if (lane.instrumentId) requiredIds.add(lane.instrumentId);
        }
      }
    }
  }
  return requiredIds.size === 0 ? [] : instruments.filter((instrument) => requiredIds.has(instrument.id));
}
