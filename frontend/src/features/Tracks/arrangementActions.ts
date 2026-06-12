import type { Id, Segment } from "../../state/types";

export interface CrossfadeCandidate {
  firstSegmentId: Id;
  secondSegmentId: Id;
  lengthBeats: number;
  kind: "overlap" | "adjacent";
}

const DEFAULT_ADJACENT_CROSSFADE_BEATS = 0.25;
const EDGE_EPSILON_BEATS = 0.001;

export function selectedCrossfadeCandidate(
  segments: Segment[],
  adjacentLengthBeats = DEFAULT_ADJACENT_CROSSFADE_BEATS,
): CrossfadeCandidate | null {
  if (segments.length !== 2) return null;
  const [a, b] = segments;
  if (!isAudioBearingSegment(a) || !isAudioBearingSegment(b)) return null;
  if (a.trackId !== b.trackId || a.id === b.id) return null;

  const [left, right] = a.startBeat <= b.startBeat ? [a, b] : [b, a];
  const leftEnd = left.startBeat + left.lengthBeats;
  const rightEnd = right.startBeat + right.lengthBeats;
  const overlap = Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(left.startBeat, right.startBeat));
  if (overlap > EDGE_EPSILON_BEATS) {
    return {
      firstSegmentId: left.id,
      secondSegmentId: right.id,
      lengthBeats: Math.min(overlap, left.lengthBeats, right.lengthBeats),
      kind: "overlap",
    };
  }

  const gap = right.startBeat - leftEnd;
  if (Math.abs(gap) > EDGE_EPSILON_BEATS) return null;
  return {
    firstSegmentId: left.id,
    secondSegmentId: right.id,
    lengthBeats: Math.min(Math.max(0, adjacentLengthBeats), left.lengthBeats, right.lengthBeats),
    kind: "adjacent",
  };
}

function isAudioBearingSegment(segment: Segment): boolean {
  return segment.payload.kind === "audio" || segment.payload.kind === "mixed";
}
