import type { DecentSamplerImport } from "../../ipc/schema";
import type { PluginAdapter } from "../../state/types";

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

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || path;
}
