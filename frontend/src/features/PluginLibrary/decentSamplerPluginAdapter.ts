import type { DecentSamplerImport } from "../../ipc/schema";
import { snapshotInstrument, TEMPORARY_DS_INSTRUMENT_SET_ID } from "../../state/store";
import type { Instrument, PluginAdapter, PluginEditorKind } from "../../state/types";

export function pluginFromDecentSamplerPreset(
  preset: DecentSamplerImport,
  editorKind: PluginEditorKind = detectDecentSamplerEditorKind(preset),
): Partial<PluginAdapter> {
  return {
    name: preset.name || "DecentSampler Package",
    vendor: "DecentSampler",
    version: "1.0.0",
    kind: "renderer",
    format: "decent-sampler",
    status: "installed",
    instrumentMode: "live-instrument",
    sourceFileName: fileNameFromPath(preset.path),
    sourcePath: preset.path,
    uiImagePath: preset.uiImagePath,
    uiImageDataUrl: preset.uiImageDataUrl,
    uiWidth: preset.uiWidth,
    uiHeight: preset.uiHeight,
    uiControlDetails: preset.uiControlDetails ?? [],
    sampleCount: preset.samples.length,
    uiControlCount: preset.uiControls?.length ?? 0,
    defaultEditorKind: editorKind,
    installedAt: Date.now(),
    description: `DecentSampler sample package with ${preset.samples.length} mapped sample zone${preset.samples.length === 1 ? "" : "s"}. Opens to the package UI and plays through Beat's sampler engine.`,
    capabilities: [
      {
        id: "decent-sampler-package",
        kind: "instrument",
        label: "Play DecentSampler package through Beat sampler",
        realtime: true,
        offline: true,
        latencySamples: 0,
        fallbackMode: "pass-through",
      },
    ],
  };
}

export function decentSamplerPluginForInstrument(
  instrument: Instrument | undefined,
  plugins: PluginAdapter[],
): PluginAdapter | undefined {
  if (!instrument) return undefined;
  return plugins.find((plugin) => (
    plugin.format === "decent-sampler"
    && (plugin.associatedInstrumentId === instrument.id || plugin.id === instrument.source?.pluginId)
  ));
}

export function decentSamplerEditorKind(plugin: PluginAdapter): PluginEditorKind {
  if (plugin.defaultEditorKind === "drum" || plugin.defaultEditorKind === "midi") return plugin.defaultEditorKind;
  const haystack = [
    plugin.name,
    plugin.description,
    plugin.sourceFileName,
    plugin.sourcePath,
  ].filter(Boolean).join(" ").toLowerCase();
  return DRUM_PACKAGE_PATTERN.test(haystack) ? "drum" : "midi";
}

export function detectDecentSamplerEditorKind(preset: DecentSamplerImport): PluginEditorKind {
  const sampleNames = preset.samples.map((sample) => sample.name || fileNameFromPath(sample.path));
  const drumHits = sampleNames.filter((name) => DRUM_PACKAGE_PATTERN.test(name.toLowerCase())).length;
  const drumFamilies = new Set<string>();
  for (const name of sampleNames) {
    const lower = name.toLowerCase();
    for (const [family, pattern] of DRUM_FAMILY_PATTERNS) {
      if (pattern.test(lower)) drumFamilies.add(family);
    }
  }

  if (drumFamilies.size >= 2) return "drum";
  if (drumHits >= Math.min(8, Math.max(3, Math.ceil(sampleNames.length * 0.18)))) return "drum";
  return "midi";
}

export function decentSamplerDragPluginId(plugin: PluginAdapter): string | null {
  return plugin.format === "decent-sampler" && plugin.associatedInstrumentId
    ? plugin.id
    : null;
}

export function decentSamplerInstrumentInstancePatch(
  template: Instrument,
  plugin: PluginAdapter,
  name: string,
): Partial<Instrument> {
  const {
    id,
    original,
    parentIds,
    setId,
    source,
    ...rest
  } = structuredClone(template);
  void id;
  void original;
  void parentIds;
  void setId;
  void source;

  return {
    ...rest,
    name,
    setId: TEMPORARY_DS_INSTRUMENT_SET_ID,
    source: {
      kind: "plugin",
      label: `Instanced from ${plugin.name}`,
      url: plugin.sourcePath,
      importedAt: Date.now(),
      edited: false,
      pluginId: plugin.id,
    },
    original: snapshotInstrument(template),
    parentIds: [template.id],
    userCreated: true,
  };
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

const DRUM_FAMILY_PATTERNS: Array<[string, RegExp]> = [
  ["kick", /\b(kick|bd|bass drum|808)\b/i],
  ["snare", /\b(snare|sd)\b/i],
  ["hat", /\b(hat|hihat|hi[- ]?hat|hh|closed|open hat)\b/i],
  ["tom", /\btom\b/i],
  ["cymbal", /\b(cymbal|crash|ride|splash)\b/i],
  ["clap", /\bclap\b/i],
  ["rim", /\brim\b/i],
  ["perc", /\b(perc|percussion|conga|bongo|cowbell|timbal|tamb|shaker|triangle|guiro)\b/i],
];

const DRUM_PACKAGE_PATTERN = new RegExp(DRUM_FAMILY_PATTERNS.map(([, pattern]) => pattern.source).join("|"), "i");
