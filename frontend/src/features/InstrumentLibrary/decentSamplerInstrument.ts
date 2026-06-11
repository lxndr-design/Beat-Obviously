import type { DecentSamplerImport } from "../../ipc/schema";
import { snapshotInstrument, useInstrumentStore, USER_INSTRUMENT_SET_ID } from "../../state/store";
import type { Instrument, TrackEffect } from "../../state/types";

type InstrumentStore = ReturnType<typeof useInstrumentStore.getState>;

interface CreateDecentSamplerInstrumentOptions {
  pluginId?: string;
  sourceLabel?: string;
}

function decentSamplerInstrumentPatch(
  preset: DecentSamplerImport,
  options: CreateDecentSamplerInstrumentOptions = {},
): Partial<Instrument> {
  const sampleUrls = Array.from(new Set(preset.sampleUrls));
  const audioIds = new Map(preset.audioFiles.map((file) => [file.path, file.id]));
  const releaseMs = decentSamplerReleaseMs(preset);
  const effects = decentSamplerEffects(preset);
  return {
    name: preset.name || "Decent Sampler instrument",
    kind: "sampler",
    waveform: "sample",
    ...(releaseMs !== undefined ? { releaseMs } : {}),
    ...(effects.length ? { effects: { filters: effects } } : {}),
    sampleIds: sampleUrls.map((url) => audioIds.get(url)).filter(Boolean) as string[],
    sampleUrl: sampleUrls[0],
    sampleUrls,
    sampleMap: preset.samples.map((sample) => ({
      path: sample.path,
      name: sample.name,
      rootNote: sample.rootNote,
      loNote: sample.loNote,
      hiNote: sample.hiNote,
      loVel: sample.loVel,
      hiVel: sample.hiVel,
      volumeDb: sample.volumeDb,
      pan: sample.pan,
      tuning: sample.tuning,
      seqPosition: sample.seqPosition,
      chokeGroup: sample.chokeGroup,
      loopEnabled: sample.loopEnabled,
      loopStart: sample.loopStart,
      loopEnd: sample.loopEnd,
      oneShot: sample.oneShot,
      durationSeconds: sample.durationSeconds,
      loLengthSeconds: sample.loLengthSeconds,
      hiLengthSeconds: sample.hiLengthSeconds,
      startSample: sample.startSample,
      endSample: sample.endSample,
    })),
    setId: USER_INSTRUMENT_SET_ID,
    source: {
      kind: "plugin",
      label: options.sourceLabel ?? `DecentSampler compatibility: ${preset.name}`,
      url: preset.path,
      importedAt: Date.now(),
      edited: false,
      pluginId: options.pluginId ?? preset.pluginId ?? "decent-sampler",
    },
    descriptors: describeDecentPreset(preset),
    userCreated: true,
  };
}

function decentSamplerReleaseMs(preset: DecentSamplerImport) {
  for (const control of preset.uiControlDetails ?? []) {
    const hasReleaseBinding = (control.bindings ?? []).some((binding) =>
      (binding.parameter ?? "").toUpperCase() === "ENV_RELEASE"
      && (binding.level ?? "").toLowerCase() === "instrument",
    );
    if (!hasReleaseBinding || typeof control.value !== "number" || !Number.isFinite(control.value)) continue;

    return Math.min(10000, Math.max(0, control.value * 1000));
  }
  return undefined;
}

export function decentSamplerEffects(preset: DecentSamplerImport): TrackEffect[] {
  return (preset.effects ?? [])
    .map((effect, index): TrackEffect | null => {
      const type = (effect.type ?? "").toLowerCase();
      const position = typeof effect.position === "number" ? effect.position : index;

      if (type.includes("lowpass") || type.includes("lp")) {
        const cutoff = boundControlValue(preset, "FX_FILTER_FREQUENCY", position) ?? effect.frequency ?? 22000;
        return {
          id: `ds-effect-${index}-lowpass`,
          kind: "lowpass",
          bypassed: false,
          params: {
            cutoffHz: clampNumber(cutoff, 20, 22000),
            resonance: clampNumber(effect.resonance ?? 0, 0, 100),
          },
        };
      }

      if (type.includes("reverb")) {
        const wet = boundControlValue(preset, "FX_REVERB_WET_LEVEL", position) ?? effect.wetLevel ?? 0;
        return {
          id: `ds-effect-${index}-reverb`,
          kind: "reverb",
          bypassed: false,
          params: {
            roomSize: clampNumber((effect.roomSize ?? 0.4) * 100, 0, 100),
            damping: clampNumber((effect.damping ?? 0.35) * 100, 0, 100),
            mix: clampNumber(wet * 100, 0, 100),
          },
        };
      }

      return null;
    })
    .filter((effect): effect is TrackEffect => Boolean(effect));
}

function boundControlValue(preset: DecentSamplerImport, parameter: string, position: number) {
  const normalizedParameter = parameter.toUpperCase();
  for (const control of preset.uiControlDetails ?? []) {
    if (typeof control.value !== "number" || !Number.isFinite(control.value)) continue;

    const hasBinding = (control.bindings ?? []).some((binding) => {
      const bindingParameter = (binding.parameter ?? "").toUpperCase();
      const bindingPosition = typeof binding.position === "number" ? binding.position : position;
      return bindingParameter === normalizedParameter && bindingPosition === position;
    });
    if (hasBinding) return control.value;
  }
  return undefined;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function createDecentSamplerInstrument(
  preset: DecentSamplerImport,
  addInstrument: InstrumentStore["addInstrument"],
  updateInstrument: InstrumentStore["updateInstrument"],
  options: CreateDecentSamplerInstrumentOptions = {},
) {
  const patch = decentSamplerInstrumentPatch(preset, options);
  const id = addInstrument(patch);
  const instrument = useInstrumentStore.getState().instruments.find((item) => item.id === id);
  if (instrument) updateInstrument(id, { original: snapshotInstrument(instrument) });
  return id;
}

export function upsertDecentSamplerInstrument(
  preset: DecentSamplerImport,
  options: CreateDecentSamplerInstrumentOptions = {},
) {
  const store = useInstrumentStore.getState();
  const pluginId = options.pluginId ?? preset.pluginId ?? "decent-sampler";
  const existing = store.instruments.find((instrument) =>
    instrument.source?.kind === "plugin"
    && ((pluginId && instrument.source.pluginId === pluginId)
      || (preset.path && instrument.source.url === preset.path)),
  );
  if (!existing) {
    return createDecentSamplerInstrument(preset, store.addInstrument, store.updateInstrument, options);
  }

  const patch = decentSamplerInstrumentPatch(preset, { ...options, pluginId });
  store.updateInstrument(existing.id, patch);
  const instrument = useInstrumentStore.getState().instruments.find((item) => item.id === existing.id);
  if (instrument) store.updateInstrument(existing.id, { original: snapshotInstrument(instrument) });
  return existing.id;
}

export function describeDecentPreset(preset: DecentSamplerImport): string[] {
  const words = new Set(["sampler", "decent-sampler", "multisample"]);
  for (const sample of preset.samples.slice(0, 24)) {
    for (const token of sample.name.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length > 2) words.add(token);
    }
  }
  if (preset.samples.some((sample) => sample.loNote !== 0 || sample.hiNote !== 127)) words.add("key-zoned");
  if (preset.samples.some((sample) => sample.loVel !== 0 || sample.hiVel !== 127)) words.add("velocity-zoned");
  return Array.from(words).slice(0, 18);
}
