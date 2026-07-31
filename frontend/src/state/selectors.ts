import type { Beats, Id, Segment, Track } from "./types";
import { useProjectStore } from "./store";

/** Any track currently soloed? Used to derive effective mute. */
export function isAnySoloActive(): boolean {
  return useProjectStore.getState().project.tracks.some((t) => t.solo);
}

/** A track is audible if (no solo) || (this is soloed), AND not muted. */
export function isTrackAudible(track: Track): boolean {
  if (track.mute) return false;
  const soloMode = isAnySoloActive();
  if (soloMode && !track.solo) return false;
  return true;
}

export const selectTracks = () => useProjectStore.getState().project.tracks;

export const selectTrack = (id: Id) =>
  useProjectStore.getState().project.tracks.find((t) => t.id === id);

export const selectSegment = (id: Id): Segment | undefined => {
  for (const t of useProjectStore.getState().project.tracks) {
    const seg = t.segments.find((s) => s.id === id);
    if (seg) return seg;
  }
  return undefined;
};

/**
 * Expand a track's segments into a played sequence using the segment's
 * explicit additional-repeat count.
 */
export function expandTrackSegments(
  track: Track,
  trackLengthBeats: Beats,
): Array<{ segmentId: Id; startBeat: Beats; lengthBeats: Beats; repetition: number }> {
  const out: Array<{
    segmentId: Id;
    startBeat: Beats;
    lengthBeats: Beats;
    repetition: number;
  }> = [];
  const sorted = [...track.segments].sort((a, b) => a.startBeat - b.startBeat);
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    out.push({
      segmentId: seg.id,
      startBeat: seg.startBeat,
      lengthBeats: effectiveSegmentLength(seg),
      repetition: 0,
    });
    if (seg.repeats > 0) {
      const effectiveLength = effectiveSegmentLength(seg);
      let cursor = seg.startBeat + effectiveLength;
      let rep = 1;
      while (cursor < trackLengthBeats && rep <= seg.repeats) {
        const lengthBeats = Math.min(effectiveLength, trackLengthBeats - cursor);
        out.push({
          segmentId: seg.id,
          startBeat: cursor,
          lengthBeats,
          repetition: rep,
        });
        cursor += effectiveLength;
        rep++;
      }
    }
  }
  return out;
}

function effectiveSegmentLength(seg: Segment): Beats {
  return seg.lengthBeats;
}
