import type { Id, Segment, SegmentPayload } from "./types";
import { runProjectHistoryGroup, useProjectStore, useUiStore } from "./store";

export interface SplitSegmentLane {
  sourceLaneId: Id;
  name: string;
  instrumentId?: Id;
  payload: SegmentPayload;
}

/** Return one self-contained payload per editable drum lane, in UI order. */
export function splitSegmentLanePayloads(segment: Segment): SplitSegmentLane[] {
  if (segment.payload.kind === "drum") {
    return segment.payload.rows.map((row) => ({
      sourceLaneId: row.id,
      name: row.name.trim() || "Drum Lane",
      instrumentId: row.instrumentId ?? segment.instrumentId,
      payload: {
        ...structuredClone(segment.payload),
        rows: [structuredClone(row)],
      },
    }));
  }

  if (segment.payload.kind === "drumpad") {
    const payload = segment.payload;
    return payload.lanes.map((lane) => ({
      sourceLaneId: lane.id,
      name: lane.name.trim() || lane.keyLabel?.trim() || "Drumpad Lane",
      instrumentId: lane.instrumentId ?? segment.instrumentId,
      payload: {
        ...structuredClone(payload),
        lanes: [structuredClone(lane)],
        hits: payload.hits
          .filter((hit) => hit.laneId === lane.id)
          .map((hit) => structuredClone(hit)),
      },
    }));
  }

  return [];
}

/**
 * Replace one multi-lane drum segment with aligned child tracks. The child
 * clips share a normal segment edit group, so move/trim/loop stays linked until
 * the user chooses Ungroup.
 */
export function splitSegmentToLaneTracks(segmentId: Id): { trackIds: Id[]; segmentIds: Id[] } | null {
  const projectStore = useProjectStore.getState();
  const before = projectStore.project;
  const segment = before.tracks.flatMap((track) => track.segments).find((candidate) => candidate.id === segmentId);
  if (!segment) return null;
  const lanes = splitSegmentLanePayloads(segment);
  if (lanes.length < 2) return null;
  const sourceTrack = before.tracks.find((track) => track.id === segment.trackId);
  if (!sourceTrack) return null;
  const sourceIndex = before.tracks.findIndex((track) => track.id === sourceTrack.id);
  const childTrackIds: Id[] = [];
  const childSegmentIds: Id[] = [];
  let groupTrackId = sourceTrack.id;

  runProjectHistoryGroup(() => {
    if (sourceTrack.segments.length === 1) {
      projectStore.updateTrack(sourceTrack.id, {
        name: `${sourceTrack.name} Lanes`,
        kind: "group",
        instrumentId: undefined,
        gainDb: 0,
        pan: 0,
      });
    } else {
      groupTrackId = projectStore.addTrack({
        name: `${segment.name?.trim() || sourceTrack.name} Lanes`,
        kind: "group",
        gainDb: 0,
        pan: 0,
        mute: sourceTrack.mute,
        solo: sourceTrack.solo,
        parentTrackId: sourceTrack.parentTrackId,
        outputBusId: sourceTrack.outputBusId,
        outputEnabled: sourceTrack.outputEnabled,
        sends: structuredClone(sourceTrack.sends ?? []),
        effects: structuredClone(sourceTrack.effects),
        automation: structuredClone(sourceTrack.automation ?? []),
      });
    }

    for (const lane of lanes) {
      const instrumentId = lane.instrumentId ?? sourceTrack.instrumentId;
      const segmentTemplate = structuredClone(segment);
      delete (segmentTemplate as Partial<Segment>).id;
      delete (segmentTemplate as Partial<Segment>).trackId;
      const childTrackId = projectStore.addTrack({
        name: lane.name,
        kind: "midi",
        instrumentId,
        parentTrackId: groupTrackId,
        gainDb: sourceTrack.gainDb,
        pan: sourceTrack.pan,
        mute: false,
        solo: sourceTrack.solo,
        outputEnabled: true,
      });
      const childSegmentId = projectStore.addSegment(childTrackId, {
        ...segmentTemplate,
        trackId: childTrackId,
        name: lane.name,
        instrumentId,
        payload: lane.payload,
        groupId: undefined,
        layer: 0,
      });
      childTrackIds.push(childTrackId);
      childSegmentIds.push(childSegmentId);
    }

    projectStore.removeSegment(segment.id);
    projectStore.applySegmentEditCommand({ kind: "group", segmentIds: childSegmentIds });

    const currentIds = projectStore.project.tracks.map((track) => track.id);
    const inserted = new Set([groupTrackId, ...childTrackIds]);
    const remaining = currentIds.filter((id) => !inserted.has(id));
    const insertAt = Math.max(0, Math.min(sourceIndex + (groupTrackId === sourceTrack.id ? 0 : 1), remaining.length));
    const ordered = [...remaining];
    ordered.splice(insertAt, 0, groupTrackId, ...childTrackIds);
    projectStore.reorderTracks(ordered);
  });

  useUiStore.getState().setSelectedSegments(childSegmentIds);
  useUiStore.getState().setSelectedTracks(childTrackIds);
  return { trackIds: childTrackIds, segmentIds: childSegmentIds };
}
