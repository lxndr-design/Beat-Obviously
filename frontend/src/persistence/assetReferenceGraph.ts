import type { BeatProjectAsset, BeatProjectAssetKind, BeatProjectAssetPolicy, BeatProjectDocument } from "../ipc/schema";
import type { AudioFile, Project, SegmentPayload } from "../state/types";

export type ProjectAssetState = "bundled" | "external" | "plugin" | "missing";

export interface ProjectAssetReferenceRow extends BeatProjectAsset {
  referenceCount: number;
  state: ProjectAssetState;
  missing: boolean;
  managed: boolean;
  external: boolean;
}

export function buildProjectAssetReferenceRows(
  document: Pick<BeatProjectDocument, "assets" | "instruments" | "audioFiles" | "plugins"> & { project?: Project },
  missingAssets: BeatProjectAsset[] = [],
): ProjectAssetReferenceRow[] {
  const manifest = document.assets?.length
    ? document.assets
    : buildAssetManifest({
      instruments: document.instruments ?? [],
      audioFiles: document.audioFiles ?? [],
      plugins: document.plugins ?? [],
      project: document.project,
    });
  const missingKeys = new Set(missingAssets.map((asset) => assetKey(asset.kind, asset.path)));
  return manifest.map((asset) => {
    const missing = missingKeys.has(assetKey(asset.kind, asset.path));
    const state: ProjectAssetState = missing ? "missing" : asset.policy;
    return {
      ...asset,
      referenceCount: asset.references.length,
      state,
      missing,
      managed: asset.policy === "bundled",
      external: asset.policy === "external",
    };
  }).sort((a, b) => (
    stateSort(a.state) - stateSort(b.state)
    || a.kind.localeCompare(b.kind)
    || a.path.localeCompare(b.path)
  ));
}

export function buildAssetManifest(input: Pick<BeatProjectDocument, "instruments" | "audioFiles" | "plugins"> & { project?: Project }): BeatProjectAsset[] {
  const assets = new Map<string, BeatProjectAsset>();
  const addAsset = (
    kind: BeatProjectAssetKind,
    path: unknown,
    reference: string,
    name?: string,
  ) => {
    if (typeof path !== "string" || !path.trim()) return;
    const normalizedPath = path.trim();
    if (isEphemeralAssetPath(normalizedPath)) return;
    const key = assetKey(kind, normalizedPath);
    const existing = assets.get(key);
    if (existing) {
      if (!existing.references.includes(reference)) existing.references.push(reference);
      return;
    }
    assets.set(key, {
      id: stableAssetId(kind, normalizedPath),
      kind,
      path: normalizedPath,
      name,
      policy: assetPolicy(normalizedPath, kind),
      references: [reference],
    });
  };

  for (const file of input.audioFiles ?? []) {
    addAsset("audio", file.path, `audioFile:${file.id}`, file.name);
  }
  const audioFilesById = new Map((input.audioFiles ?? []).map((file) => [file.id, file]));
  for (const track of input.project?.tracks ?? []) {
    if (track.audioFileId) {
      addAudioReference(audioFilesById, track.audioFileId, `track:${track.id}:audioFileId`, addAsset);
    }
    for (const segment of track.segments ?? []) {
      const segmentAudioFileId = audioFileIdFromSegmentPayload(segment.payload);
      if (segmentAudioFileId) {
        addAudioReference(audioFilesById, segmentAudioFileId, `track:${track.id}:segment:${segment.id}:audioFileId`, addAsset);
      }
    }
  }
  for (const instrument of input.instruments ?? []) {
    instrument.sampleIds?.forEach((audioFileId, index) => {
      addAudioReference(audioFilesById, audioFileId, `instrument:${instrument.id}:sampleIds:${index}`, addAsset);
    });
    addAsset("sample", instrument.sampleUrl, `instrument:${instrument.id}:sampleUrl`, instrument.name);
    instrument.sampleUrls?.forEach((url, index) => {
      addAsset("sample", url, `instrument:${instrument.id}:sampleUrls:${index}`, instrument.name);
    });
    instrument.sampleMap?.forEach((zone, index) => {
      addAsset("sample", zone.path, `instrument:${instrument.id}:sampleMap:${index}`, zone.name ?? instrument.name);
    });
    const managedSfz = instrument.aether?.sampleSlot1?.managedSfz;
    if (managedSfz) {
      addAsset("sample", managedSfz.manifestPath, `instrument:${instrument.id}:managedSfz:manifest`, instrument.name);
      addAsset("sample", managedSfz.sourcePath, `instrument:${instrument.id}:managedSfz:source`, instrument.name);
      managedSfz.samplePaths.forEach((path, index) => {
        addAsset("sample", path, `instrument:${instrument.id}:managedSfz:sample:${index}`, instrument.name);
      });
    }
    const managedGranular = instrument.aether?.granularSlot2?.managedAsset;
    if (managedGranular) {
      addAsset("sample", managedGranular.manifestPath, `instrument:${instrument.id}:managedGranular:manifest`, instrument.name);
      addAsset("sample", managedGranular.audioPath, `instrument:${instrument.id}:managedGranular:audio`, instrument.name);
    }
  }
  for (const plugin of input.plugins ?? []) {
    addAsset("plugin", plugin.sourcePath ?? plugin.sourceFileName, `plugin:${plugin.id}:sourcePath`, plugin.name);
  }

  return Array.from(assets.values()).sort((a, b) => (
    a.kind.localeCompare(b.kind)
    || a.path.localeCompare(b.path)
  ));
}

function addAudioReference(
  audioFilesById: Map<string, AudioFile>,
  audioFileId: string,
  reference: string,
  addAsset: (kind: BeatProjectAssetKind, path: unknown, reference: string, name?: string) => void,
) {
  const file = audioFilesById.get(audioFileId);
  if (!file) return;
  addAsset("audio", file.path, reference, file.name);
}

function audioFileIdFromSegmentPayload(payload: SegmentPayload): string | null {
  if (payload.kind === "audio" || payload.kind === "mixed") return payload.audioFileId;
  return null;
}

export function assetPolicy(path: string, kind: BeatProjectAssetKind): BeatProjectAssetPolicy {
  if (kind === "plugin") return "plugin";
  return path.startsWith("/samples/") || path.includes(" Assets/sfz/")
    ? "bundled" : "external";
}

export function stableAssetId(kind: BeatProjectAssetKind, path: string): string {
  let hash = 2166136261;
  const input = `${kind}:${path}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `asset-${kind}-${(hash >>> 0).toString(36)}`;
}

function assetKey(kind: BeatProjectAssetKind, path: string): string {
  return `${kind}:${path}`;
}

function isEphemeralAssetPath(path: string): boolean {
  return path.startsWith("blob:") || path.startsWith("data:");
}

function stateSort(state: ProjectAssetState): number {
  if (state === "missing") return 0;
  if (state === "external") return 1;
  if (state === "bundled") return 2;
  return 3;
}
