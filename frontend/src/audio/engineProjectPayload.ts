import type { AudioFile, Instrument, Project } from "../state/types";

const TRACK_AUDIBILITY_FIELDS = new Set(["mute", "solo"]);

/**
 * Mute and solo are realtime mixer gestures. They must not take the structural
 * project path, which rebuilds instruments, clips, and routing in the native
 * engine. Immer preserves references for every untouched field, so a shallow
 * walk is enough to distinguish these gestures without serializing a project.
 */
export function projectChangeOnlyAffectsTrackAudibility(previous: Project, next: Project): boolean {
  if (previous === next || previous.tracks.length !== next.tracks.length) return false;

  const previousProject = previous as unknown as Record<string, unknown>;
  const nextProject = next as unknown as Record<string, unknown>;
  const projectKeys = new Set([...Object.keys(previousProject), ...Object.keys(nextProject)]);
  for (const key of projectKeys) {
    if (key !== "tracks" && previousProject[key] !== nextProject[key]) return false;
  }

  let audibilityChanged = false;
  for (let index = 0; index < previous.tracks.length; index += 1) {
    const previousTrack = previous.tracks[index] as unknown as Record<string, unknown>;
    const nextTrack = next.tracks[index] as unknown as Record<string, unknown>;
    if (previousTrack.id !== nextTrack.id) return false;

    const trackKeys = new Set([...Object.keys(previousTrack), ...Object.keys(nextTrack)]);
    for (const key of trackKeys) {
      if (TRACK_AUDIBILITY_FIELDS.has(key)) {
        audibilityChanged ||= previousTrack[key] !== nextTrack[key];
      } else if (previousTrack[key] !== nextTrack[key]) {
        return false;
      }
    }
  }
  return audibilityChanged;
}

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
