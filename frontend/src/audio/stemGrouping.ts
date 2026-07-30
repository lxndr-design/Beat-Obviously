import type { Segment } from "../state/types";

export function linkedSegmentsFor(segment: Segment, allSegments: Segment[]) {
  if (!segment.groupId) return [segment];
  const linked = allSegments.filter((candidate) => candidate.groupId === segment.groupId);
  return linked.length > 0 ? linked : [segment];
}

export function linkedResizeTargets(
  mode: "resize-left" | "resize-right",
  anchor: Segment,
  next: { startBeat: number; lengthBeats: number },
  linked: Segment[],
) {
  const startDelta = next.startBeat - anchor.startBeat;
  const lengthDelta = next.lengthBeats - anchor.lengthBeats;
  return linked.map((segment) => ({
    segment,
    startBeat: mode === "resize-left" ? segment.startBeat + startDelta : segment.startBeat,
    lengthBeats: mode === "resize-left" ? segment.lengthBeats - startDelta : segment.lengthBeats + lengthDelta,
  }));
}
