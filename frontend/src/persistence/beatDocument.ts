import type { BeatProjectAsset, BeatProjectAssetKind, BeatProjectAssetPolicy, BeatProjectDocument } from "../ipc/schema";
import { useAudioFileStore, useDocumentStore, useInstrumentStore, usePluginStore, useProjectStore } from "../state/store";
import { useComponentStore } from "../state/components";
import { saveAudioFiles, saveComponents, saveInstruments, saveProject } from "./dexie";
import type { Project, Track } from "../state/types";

const CURRENT_SCHEMA_VERSION = 1;

export function buildCurrentBeatDocument(): BeatProjectDocument {
  const instruments = useInstrumentStore.getState().instruments.map((instrument) => structuredClone(instrument));
  const audioFiles = useAudioFileStore.getState().files.map((file) => structuredClone(file));
  const plugins = usePluginStore.getState().plugins
    .filter((plugin) => !plugin.factory)
    .map((plugin) => structuredClone(plugin));
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    savedAt: Date.now(),
    project: structuredClone(useProjectStore.getState().project),
    instruments,
    instrumentSets: useInstrumentStore.getState().instrumentSets.map((set) => structuredClone(set)),
    audioFiles,
    components: useComponentStore.getState().components
      .filter((component) => !component.factory)
      .map((component) => structuredClone(component)),
    plugins,
    assets: buildAssetManifest({ instruments, audioFiles, plugins }),
  };
}

export function buildCurrentBeatDocumentFingerprint(): string {
  return beatDocumentFingerprint(buildCurrentBeatDocument());
}

export function beatDocumentFingerprint(document: BeatProjectDocument): string {
  return stableStringify({
    ...document,
    savedAt: 0,
  });
}

export function replaceBeatDocumentAssetPath(document: BeatProjectDocument, fromPath: string, toPath: string): BeatProjectDocument {
  if (!fromPath || !toPath || fromPath === toPath) return document;
  const next = structuredClone(document);
  for (const audioFile of next.audioFiles ?? []) {
    if (audioFile.path === fromPath) audioFile.path = toPath;
  }
  for (const instrument of next.instruments ?? []) {
    if (instrument.sampleUrl === fromPath) instrument.sampleUrl = toPath;
    if (instrument.sampleUrls) instrument.sampleUrls = instrument.sampleUrls.map((path) => path === fromPath ? toPath : path);
    for (const zone of instrument.sampleMap ?? []) {
      if (zone.path === fromPath) zone.path = toPath;
      const zoneWithSampleUrl = zone as typeof zone & { sampleUrl?: string };
      if (zoneWithSampleUrl.sampleUrl === fromPath) zoneWithSampleUrl.sampleUrl = toPath;
    }
  }
  for (const asset of next.assets ?? []) {
    if (asset.path === fromPath) asset.path = toPath;
  }
  next.assets = buildAssetManifest({
    instruments: next.instruments ?? [],
    audioFiles: next.audioFiles ?? [],
    plugins: next.plugins ?? [],
  });
  return next;
}

export function migrateBeatDocument(input: unknown): BeatProjectDocument {
  if (!isObject(input)) throw new Error("Invalid Beat project file.");
  const schemaVersion = Number(input.schemaVersion);
  if (schemaVersion !== CURRENT_SCHEMA_VERSION) throw new Error(`Unsupported Beat project schema: ${schemaVersion || "unknown"}.`);
  const project = sanitizeProject(input.project);
  const instruments = Array.isArray(input.instruments) ? structuredClone(input.instruments) : [];
  const audioFiles = Array.isArray(input.audioFiles) ? structuredClone(input.audioFiles) : [];
  const plugins = Array.isArray(input.plugins) ? structuredClone(input.plugins) : [];
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    savedAt: finiteNumber(input.savedAt, Date.now()),
    project,
    instruments,
    instrumentSets: Array.isArray(input.instrumentSets) ? structuredClone(input.instrumentSets) : undefined,
    audioFiles,
    components: Array.isArray(input.components) ? structuredClone(input.components) : [],
    plugins,
    assets: Array.isArray(input.assets)
      ? sanitizeAssetManifest(input.assets)
      : buildAssetManifest({ instruments, audioFiles, plugins }),
  };
}

export async function applyBeatDocument(
  document: BeatProjectDocument,
  path?: string | null,
  options: { markSaved?: boolean } = {},
) {
  const migrated = migrateBeatDocument(document);

  const instruments = migrated.instruments ?? [];
  const instrumentSets = migrated.instrumentSets;
  const audioFiles = migrated.audioFiles ?? [];
  const components = migrated.components ?? [];
  const plugins = migrated.plugins ?? [];

  useProjectStore.getState().loadProject(migrated.project);
  if (instruments.length > 0 || instrumentSets) {
    useInstrumentStore.getState().hydrateInstruments(instruments, instrumentSets);
    useInstrumentStore.getState().seedSystemInstruments();
  }
  useAudioFileStore.getState().hydrateFiles(audioFiles);
  useComponentStore.getState().hydrate(components);
  useComponentStore.getState().seedDefaultDrumLoops(useInstrumentStore.getState().instruments);
  usePluginStore.getState().hydratePlugins(plugins);

  await Promise.all([
    saveProject(migrated.project),
    saveInstruments(useInstrumentStore.getState().instruments, useInstrumentStore.getState().instrumentSets),
    saveAudioFiles(audioFiles),
    saveComponents(components),
  ]);
  if (options.markSaved ?? true) {
    useDocumentStore.getState().markSaved(path ?? null, buildCurrentBeatDocumentFingerprint());
  }
}

export function buildAssetManifest(input: Pick<BeatProjectDocument, "instruments" | "audioFiles" | "plugins">): BeatProjectAsset[] {
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
    const key = `${kind}:${normalizedPath}`;
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
  for (const instrument of input.instruments ?? []) {
    addAsset("sample", instrument.sampleUrl, `instrument:${instrument.id}:sampleUrl`, instrument.name);
    instrument.sampleUrls?.forEach((url, index) => {
      addAsset("sample", url, `instrument:${instrument.id}:sampleUrls:${index}`, instrument.name);
    });
    instrument.sampleMap?.forEach((zone, index) => {
      addAsset("sample", zone.path, `instrument:${instrument.id}:sampleMap:${index}`, zone.name ?? instrument.name);
    });
  }
  for (const plugin of input.plugins ?? []) {
    addAsset("plugin", plugin.sourcePath ?? plugin.sourceFileName, `plugin:${plugin.id}:sourcePath`, plugin.name);
  }

  return Array.from(assets.values()).sort((a, b) => (
    a.kind.localeCompare(b.kind)
    || a.path.localeCompare(b.path)
  ));
}

function sanitizeProject(value: unknown): Project {
  if (!isObject(value)) throw new Error("Beat project is missing project data.");
  const tracks = Array.isArray(value.tracks)
    ? value.tracks.map(sanitizeTrack).filter((track): track is Track => Boolean(track))
    : [];
  if (tracks.length === 0) throw new Error("Beat project does not contain any tracks.");
  return {
    ...(structuredClone(value) as unknown as Project),
    id: nonEmptyString(value.id, "project"),
    name: nonEmptyString(value.name, "Untitled"),
    bpm: clamp(finiteNumber(value.bpm, 120), 20, 300),
    timeSignature: sanitizeTimeSignature(value.timeSignature),
    lengthBeats: clamp(finiteNumber(value.lengthBeats, 64), 1, 4096),
    tracks,
    returnBuses: Array.isArray(value.returnBuses) ? structuredClone(value.returnBuses) : [],
    masterEqAutomation: Array.isArray(value.masterEqAutomation) ? structuredClone(value.masterEqAutomation) : [],
    masterChain: sanitizeMasterChain(value.masterChain),
    recordingInput: sanitizeRecordingInputProfile(value.recordingInput),
  };
}

function sanitizeMasterChain(value: unknown): Project["masterChain"] {
  const source = isObject(value) ? value : {};
  return {
    inputGainDb: clamp(finiteNumber(source.inputGainDb, 0), -48, 24),
    compressorEnabled: Boolean(source.compressorEnabled),
    compressorThresholdDb: clamp(finiteNumber(source.compressorThresholdDb, -18), -60, 0),
    compressorRatio: clamp(finiteNumber(source.compressorRatio, 2), 1, 40),
    compressorAttackMs: clamp(finiteNumber(source.compressorAttackMs, 20), 0.1, 200),
    compressorReleaseMs: clamp(finiteNumber(source.compressorReleaseMs, 160), 1, 3000),
    compressorMakeupDb: clamp(finiteNumber(source.compressorMakeupDb, 0), -24, 24),
    compressorMix: clamp(finiteNumber(source.compressorMix, 100), 0, 100),
    outputGainDb: clamp(finiteNumber(source.outputGainDb, 0), -48, 24),
  };
}

function sanitizeTrack(value: unknown): Track | null {
  if (!isObject(value)) return null;
  const id = nonEmptyString(value.id, "");
  if (!id) return null;
  return {
    ...(structuredClone(value) as unknown as Track),
    id,
    name: nonEmptyString(value.name, "Track"),
    kind: value.kind === "audio" || value.kind === "midi" || value.kind === "mixed" || value.kind === "group" ? value.kind : "mixed",
    parentTrackId: nonEmptyString(value.parentTrackId, ""),
    gainDb: clamp(finiteNumber(value.gainDb, 0), -96, 24),
    pan: clamp(finiteNumber(value.pan, 0), -1, 1),
    mute: Boolean(value.mute),
    solo: Boolean(value.solo),
    recordArmed: Boolean(value.recordArmed),
    inputMonitoring: Boolean(value.inputMonitoring),
    inputDeviceId: nonEmptyString(value.inputDeviceId, ""),
    inputChannelStart: Math.round(clamp(finiteNumber(value.inputChannelStart, 0), 0, 1024)),
    inputChannelCount: Math.round(clamp(finiteNumber(value.inputChannelCount, 1), 1, 1024)),
    recordGainDb: clamp(finiteNumber(value.recordGainDb, 0), -48, 24),
    sends: Array.isArray(value.sends) ? structuredClone(value.sends) : [],
    effects: isObject(value.effects) && Array.isArray(value.effects.filters)
      ? { filters: structuredClone(value.effects.filters) as Track["effects"]["filters"] }
      : { filters: [] },
    segments: Array.isArray(value.segments) ? structuredClone(value.segments) : [],
    rowHeight: value.rowHeight === "compact" ? "compact" : "normal",
  };
}

function sanitizeRecordingInputProfile(value: unknown): Project["recordingInput"] {
  const source = isObject(value) ? value : {};
  return {
    inputDeviceId: nonEmptyString(source.inputDeviceId, ""),
    inputDeviceName: nonEmptyString(source.inputDeviceName, ""),
    inputChannelStart: Math.round(clamp(finiteNumber(source.inputChannelStart, 0), 0, 1024)),
    inputChannelCount: Math.round(clamp(finiteNumber(source.inputChannelCount, 2), 1, 1024)),
    calibrationSampleRate: clamp(finiteNumber(source.calibrationSampleRate, 0), 0, 768000),
    measuredRoundTripSamples: Math.round(clamp(finiteNumber(source.measuredRoundTripSamples, 0), 0, 1920000)),
    reportedInputLatencySamples: Math.round(clamp(finiteNumber(source.reportedInputLatencySamples, 0), 0, 1920000)),
    reportedOutputLatencySamples: Math.round(clamp(finiteNumber(source.reportedOutputLatencySamples, 0), 0, 1920000)),
    userLatencyAdjustmentSamples: Math.round(clamp(finiteNumber(source.userLatencyAdjustmentSamples, 0), -1920000, 1920000)),
  };
}

function sanitizeTimeSignature(value: unknown): Project["timeSignature"] {
  if (!isObject(value)) return { num: 4, denom: 4, boldBeats: [1] };
  const num = Math.round(clamp(finiteNumber(value.num, 4), 1, 16));
  const denomValue = Math.round(finiteNumber(value.denom, 4));
  const denom = [2, 4, 8, 16].includes(denomValue) ? denomValue : 4;
  const boldBeats = Array.isArray(value.boldBeats)
    ? value.boldBeats.map((beat) => Math.round(finiteNumber(beat, 1))).filter((beat) => beat >= 1 && beat <= num)
    : [1];
  return { num, denom, boldBeats: Array.from(new Set(boldBeats)) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeAssetManifest(value: unknown[]): BeatProjectAsset[] {
  const assets: BeatProjectAsset[] = [];
  for (const asset of value) {
    if (!isObject(asset)) continue;
    const kind = sanitizeAssetKind(asset.kind);
    const path = nonEmptyString(asset.path, "");
    if (!kind || !path) continue;
    assets.push({
      id: nonEmptyString(asset.id, stableAssetId(kind, path)),
      kind,
      path,
      name: typeof asset.name === "string" && asset.name.trim() ? asset.name.trim() : undefined,
      policy: sanitizeAssetPolicy(asset.policy) ?? assetPolicy(path, kind),
      references: Array.isArray(asset.references)
        ? asset.references.filter((reference): reference is string => typeof reference === "string" && reference.trim().length > 0)
        : [],
    });
  }
  return assets;
}

function sanitizeAssetKind(value: unknown): BeatProjectAssetKind | null {
  return value === "audio" || value === "sample" || value === "plugin" ? value : null;
}

function sanitizeAssetPolicy(value: unknown): BeatProjectAssetPolicy | null {
  return value === "bundled" || value === "external" || value === "plugin" ? value : null;
}

function assetPolicy(path: string, kind: BeatProjectAssetKind): BeatProjectAssetPolicy {
  if (kind === "plugin") return "plugin";
  return path.startsWith("/samples/") ? "bundled" : "external";
}

function isEphemeralAssetPath(path: string): boolean {
  return path.startsWith("blob:") || path.startsWith("data:");
}

function stableAssetId(kind: BeatProjectAssetKind, path: string): string {
  let hash = 2166136261;
  const input = `${kind}:${path}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `asset-${kind}-${(hash >>> 0).toString(36)}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableStringify);
  if (!isObject(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const next = value[key];
      if (next !== undefined) acc[key] = sortForStableStringify(next);
      return acc;
    }, {});
}
