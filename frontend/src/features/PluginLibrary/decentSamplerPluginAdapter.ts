import type { DecentSamplerImport } from "../../ipc/schema";
import { snapshotInstrument, TEMPORARY_DS_INSTRUMENT_SET_ID } from "../../state/store";
import type { Instrument, PluginAdapter } from "../../state/types";

export function pluginFromDecentSamplerPreset(preset: DecentSamplerImport): Partial<PluginAdapter> {
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
    sampleCount: preset.samples.length,
    uiControlCount: preset.uiControls?.length ?? 0,
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
