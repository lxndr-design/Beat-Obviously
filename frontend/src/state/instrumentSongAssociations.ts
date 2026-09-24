import type { Id, Instrument, InstrumentSongAssociation, Project, SegmentPayload } from "./types";

export interface ProjectInstrumentAssociation extends InstrumentSongAssociation {
  instrumentId: Id;
}

export function projectInstrumentAssociations(project: Project, linkedAt?: number): ProjectInstrumentAssociation[] {
  const byInstrument = new Map<Id, Set<string>>();
  const add = (instrumentId: Id | undefined, trackName: string) => {
    if (!instrumentId?.trim()) return;
    const names = byInstrument.get(instrumentId) ?? new Set<string>();
    if (trackName.trim()) names.add(trackName.trim());
    byInstrument.set(instrumentId, names);
  };

  for (const track of project.tracks) {
    add(track.instrumentId, track.name);
    for (const segment of track.segments) {
      add(segment.instrumentId, track.name);
      for (const nestedId of payloadInstrumentIds(segment.payload)) add(nestedId, track.name);
    }
  }

  const associationTime = linkedAt ?? project.savedAt ?? 1;
  return Array.from(byInstrument, ([instrumentId, trackNames]) => ({
    instrumentId,
    projectId: project.id,
    title: normalizedSongTitle(project.name),
    linkedAt: associationTime,
    trackNames: Array.from(trackNames),
  }));
}

export function projectInstrumentIds(project: Project): Set<Id> {
  return new Set(projectInstrumentAssociations(project).map((association) => association.instrumentId));
}

export function associateInstrumentWithSong(
  instrument: Instrument,
  association: Omit<InstrumentSongAssociation, "linkedAt"> & { linkedAt?: number },
): Instrument {
  return {
    ...instrument,
    songAssociations: mergeInstrumentSongAssociations(instrument.songAssociations, [{
      ...association,
      title: normalizedSongTitle(association.title),
      linkedAt: association.linkedAt ?? Date.now(),
    }]),
  };
}

export function mergeInstrumentSongAssociations(
  ...groups: Array<InstrumentSongAssociation[] | undefined>
): InstrumentSongAssociation[] {
  const byProject = new Map<Id, InstrumentSongAssociation>();
  for (const association of groups.flatMap((group) => group ?? [])) {
    if (!association?.projectId?.trim()) continue;
    const previous = byProject.get(association.projectId);
    const linkedAt = Math.max(
      previous?.linkedAt ?? 0,
      Number.isFinite(association.linkedAt) ? association.linkedAt : 0,
    ) || 1;
    byProject.set(association.projectId, {
      projectId: association.projectId,
      title: normalizedSongTitle(association.title || previous?.title),
      linkedAt,
      trackNames: uniqueStrings([...(previous?.trackNames ?? []), ...(association.trackNames ?? [])]),
    });
  }
  return Array.from(byProject.values()).sort((a, b) => b.linkedAt - a.linkedAt);
}

export function instrumentSongTitles(instrument: Pick<Instrument, "songAssociations">): string[] {
  return uniqueStrings((instrument.songAssociations ?? []).map((association) => association.title));
}

export function instrumentRepositorySearchText(instrument: Instrument, extra: string[] = []): string {
  return uniqueStrings([
    instrument.name,
    instrument.kind,
    instrument.waveform,
    instrument.source?.label ?? "",
    ...(instrument.descriptors ?? []),
    ...(instrument.libraryMetadata?.tags ?? []),
    ...instrumentSongTitles(instrument),
    ...(instrument.songAssociations ?? []).flatMap((association) => association.trackNames ?? []),
    ...extra,
  ]).join(" ").toLowerCase();
}

function payloadInstrumentIds(payload: SegmentPayload): Id[] {
  if (payload.kind === "drum") return payload.rows.flatMap((row) => row.instrumentId ? [row.instrumentId] : []);
  if (payload.kind === "drumpad") return payload.lanes.flatMap((lane) => lane.instrumentId ? [lane.instrumentId] : []);
  return [];
}

function normalizedSongTitle(value: string | undefined): string {
  return value?.trim() || "Untitled";
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
