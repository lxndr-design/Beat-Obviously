import type { DecentSamplerImport, DecentSamplerUiBinding, DecentSamplerUiControl } from "../../ipc/schema";
import { snapshotInstrument, TEMPORARY_DS_INSTRUMENT_SET_ID, useInstrumentStore } from "../../state/store";
import type { Instrument, TrackEffect } from "../../state/types";

type InstrumentStore = ReturnType<typeof useInstrumentStore.getState>;

interface CreateDecentSamplerInstrumentOptions {
  pluginId?: string;
  sourceLabel?: string;
}

export interface DecentSamplerControlBindingState {
  value: number;
  min: number;
  max: number;
  step: number;
  targetLabel: string;
  valueLabel: string;
}

function decentSamplerInstrumentPatch(
  preset: DecentSamplerImport,
  options: CreateDecentSamplerInstrumentOptions = {},
): Partial<Instrument> {
  const attackSamples = decentSamplerAttackSamples(preset);
  const sampleUrls = Array.from(new Set(attackSamples.map((sample) => sample.path)));
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
    sampleMap: attackSamples.map((sample) => ({
      path: sample.path,
      name: sample.name,
      trigger: sample.trigger ?? "attack",
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
    setId: TEMPORARY_DS_INSTRUMENT_SET_ID,
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

function decentSamplerAttackSamples(preset: DecentSamplerImport) {
  const attackSamples = (preset.samples ?? []).filter((sample) => !isReleaseTrigger(sample.trigger));
  return attackSamples.length > 0 ? attackSamples : (preset.samples ?? []);
}

function isReleaseTrigger(trigger: string | undefined) {
  const normalized = (trigger ?? "attack").trim().toLowerCase();
  return normalized === "release" || normalized === "note_off" || normalized === "note-off" || normalized === "noteoff";
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

export function decentSamplerControlBindingState(
  control: DecentSamplerUiControl,
  instrument: Instrument,
): DecentSamplerControlBindingState | null {
  const target = firstSupportedControlTarget(control);
  if (!target) return null;
  const range = controlRange(control, target);
  const value = controlValueForTarget(target, instrument, control);
  if (value == null) return null;
  const clamped = clampNumber(value, range.min, range.max);
  return {
    value: clamped,
    min: range.min,
    max: range.max,
    step: range.step,
    targetLabel: controlTargetLabel(target),
    valueLabel: formatControlValue(clamped, target, control),
  };
}

export function decentSamplerControlInstrumentPatch(
  control: DecentSamplerUiControl,
  instrument: Instrument,
  value: number,
): Partial<Instrument> | null {
  const target = firstSupportedControlTarget(control);
  if (!target) return null;
  const range = controlRange(control, target);
  const nextValue = clampNumber(value, range.min, range.max);

  if (target.parameter === "ENV_RELEASE") {
    return {
      envelope: {
        ...instrument.envelope,
        releaseMs: Math.round(nextValue * 1000),
      },
    };
  }

  if (target.parameter === "AMP_VOLUME") {
    return { ampLevel: clampNumber(nextValue, 0, 2) };
  }

  if (target.parameter === "FX_FILTER_FREQUENCY") {
    const effectPatch = patchInstrumentEffectParam(instrument, "lowpass", target.position, "cutoffHz", nextValue);
    if (effectPatch) return effectPatch;
    return {
      filterType: "lowpass",
      knobs: {
        ...instrument.knobs,
        cutoff: frequencyHzToKnob(nextValue),
      },
    };
  }

  if (target.parameter === "FX_FILTER_RESONANCE") {
    const resonancePercent = controlIsUnitRange(control) ? nextValue * 100 : nextValue;
    const effectPatch = patchInstrumentEffectParam(instrument, "lowpass", target.position, "resonance", resonancePercent);
    if (effectPatch) return effectPatch;
    return {
      filterType: "lowpass",
      knobs: {
        ...instrument.knobs,
        resonance: controlIsUnitRange(control) ? nextValue : nextValue / 100,
      },
    };
  }

  if (target.parameter === "FX_REVERB_WET_LEVEL") {
    return patchInstrumentEffectParam(instrument, "reverb", target.position, "mix", controlIsUnitRange(control) ? nextValue * 100 : nextValue);
  }

  if (target.parameter === "FX_REVERB_ROOM_SIZE") {
    return patchInstrumentEffectParam(instrument, "reverb", target.position, "roomSize", controlIsUnitRange(control) ? nextValue * 100 : nextValue);
  }

  if (target.parameter === "FX_REVERB_DAMPING") {
    return patchInstrumentEffectParam(instrument, "reverb", target.position, "damping", controlIsUnitRange(control) ? nextValue * 100 : nextValue);
  }

  return null;
}

type SupportedControlParameter =
  | "ENV_RELEASE"
  | "AMP_VOLUME"
  | "FX_FILTER_FREQUENCY"
  | "FX_FILTER_RESONANCE"
  | "FX_REVERB_WET_LEVEL"
  | "FX_REVERB_ROOM_SIZE"
  | "FX_REVERB_DAMPING";

interface SupportedControlTarget {
  parameter: SupportedControlParameter;
  position: number;
}

function firstSupportedControlTarget(control: DecentSamplerUiControl): SupportedControlTarget | null {
  for (const binding of control.bindings ?? []) {
    const target = supportedControlTarget(binding);
    if (target) return target;
  }
  return null;
}

function supportedControlTarget(binding: DecentSamplerUiBinding): SupportedControlTarget | null {
  const parameter = (binding.parameter ?? "").toUpperCase();
  if (!isSupportedControlParameter(parameter)) return null;
  return {
    parameter,
    position: typeof binding.position === "number" && Number.isFinite(binding.position) ? binding.position : 0,
  };
}

function isSupportedControlParameter(parameter: string): parameter is SupportedControlParameter {
  return parameter === "ENV_RELEASE"
    || parameter === "AMP_VOLUME"
    || parameter === "FX_FILTER_FREQUENCY"
    || parameter === "FX_FILTER_RESONANCE"
    || parameter === "FX_REVERB_WET_LEVEL"
    || parameter === "FX_REVERB_ROOM_SIZE"
    || parameter === "FX_REVERB_DAMPING";
}

function controlRange(control: DecentSamplerUiControl, target: SupportedControlTarget) {
  const min = Number.isFinite(control.minValue) ? control.minValue as number : defaultControlMin(target);
  const max = Number.isFinite(control.maxValue) ? control.maxValue as number : defaultControlMax(target);
  const orderedMin = Math.min(min, max);
  const orderedMax = Math.max(min, max);
  const span = Math.max(0.000001, orderedMax - orderedMin);
  return {
    min: orderedMin,
    max: orderedMax,
    step: controlStep(target, span),
  };
}

function controlStep(target: SupportedControlTarget, span: number) {
  if (target.parameter === "FX_FILTER_FREQUENCY") return 1;
  if (target.parameter === "ENV_RELEASE" || target.parameter === "AMP_VOLUME") return 0.01;
  return span <= 1 ? 0.01 : 1;
}

function defaultControlMin(target: SupportedControlTarget) {
  if (target.parameter === "FX_FILTER_FREQUENCY") return 20;
  return 0;
}

function defaultControlMax(target: SupportedControlTarget) {
  if (target.parameter === "ENV_RELEASE") return 10;
  if (target.parameter === "FX_FILTER_FREQUENCY") return 22000;
  if (target.parameter === "AMP_VOLUME") return 2;
  return 1;
}

function controlValueForTarget(
  target: SupportedControlTarget,
  instrument: Instrument,
  control: DecentSamplerUiControl,
): number | null {
  if (target.parameter === "ENV_RELEASE") return (instrument.envelope.releaseMs ?? 0) / 1000;
  if (target.parameter === "AMP_VOLUME") return instrument.ampLevel ?? 1;
  if (target.parameter === "FX_FILTER_FREQUENCY") {
    const effect = findInstrumentEffect(instrument, "lowpass", target.position);
    return effect?.params.cutoffHz ?? knobToFrequencyHz(instrument.knobs.cutoff);
  }
  if (target.parameter === "FX_FILTER_RESONANCE") {
    const effect = findInstrumentEffect(instrument, "lowpass", target.position);
    const value = effect?.params.resonance ?? (instrument.knobs.resonance * 100);
    return controlIsUnitRange(control) ? value / 100 : value;
  }
  if (target.parameter === "FX_REVERB_WET_LEVEL") {
    return effectPercentValue(instrument, "reverb", target.position, "mix", control);
  }
  if (target.parameter === "FX_REVERB_ROOM_SIZE") {
    return effectPercentValue(instrument, "reverb", target.position, "roomSize", control);
  }
  if (target.parameter === "FX_REVERB_DAMPING") {
    return effectPercentValue(instrument, "reverb", target.position, "damping", control);
  }
  return null;
}

function effectPercentValue(
  instrument: Instrument,
  kind: TrackEffect["kind"],
  position: number,
  param: string,
  control: DecentSamplerUiControl,
) {
  const effect = findInstrumentEffect(instrument, kind, position);
  if (!effect) return null;
  const value = effect.params[param] ?? 0;
  return controlIsUnitRange(control) ? value / 100 : value;
}

function findInstrumentEffect(instrument: Instrument, kind: TrackEffect["kind"], position: number) {
  const filters = instrument.effects?.filters ?? [];
  return filters.find((effect) => effect.kind === kind && effect.id.includes(`ds-effect-${position}-`))
    ?? filters.find((effect) => effect.kind === kind);
}

function patchInstrumentEffectParam(
  instrument: Instrument,
  kind: TrackEffect["kind"],
  position: number,
  param: string,
  value: number,
): Partial<Instrument> | null {
  const effects = structuredClone(instrument.effects);
  const index = effects?.filters.findIndex((effect) => effect.kind === kind && effect.id.includes(`ds-effect-${position}-`)) ?? -1;
  const fallbackIndex = index >= 0 ? index : effects?.filters.findIndex((effect) => effect.kind === kind) ?? -1;
  if (!effects || fallbackIndex < 0) return null;
  effects.filters[fallbackIndex].params = {
    ...effects.filters[fallbackIndex].params,
    [param]: value,
  };
  return { effects };
}

function controlTargetLabel(target: SupportedControlTarget) {
  switch (target.parameter) {
    case "ENV_RELEASE":
      return "Envelope Release";
    case "AMP_VOLUME":
      return "Amp Volume";
    case "FX_FILTER_FREQUENCY":
      return "Filter Frequency";
    case "FX_FILTER_RESONANCE":
      return "Filter Resonance";
    case "FX_REVERB_WET_LEVEL":
      return "Reverb Mix";
    case "FX_REVERB_ROOM_SIZE":
      return "Reverb Room";
    case "FX_REVERB_DAMPING":
      return "Reverb Damping";
  }
}

function formatControlValue(value: number, target: SupportedControlTarget, control: DecentSamplerUiControl) {
  if (target.parameter === "ENV_RELEASE") return `${Math.round(value * 1000)}ms`;
  if (target.parameter === "FX_FILTER_FREQUENCY") return `${Math.round(value)}Hz`;
  if (target.parameter === "AMP_VOLUME") return `${Math.round(value * 100)}%`;
  const percent = controlIsUnitRange(control) ? value * 100 : value;
  return `${Math.round(percent)}%`;
}

function controlIsUnitRange(control: DecentSamplerUiControl) {
  const max = Number.isFinite(control.maxValue) ? control.maxValue as number : 1;
  return max <= 1;
}

function knobToFrequencyHz(value: number) {
  const minHz = 20;
  const maxHz = 22000;
  return minHz * Math.pow(maxHz / minHz, clampNumber(value, 0, 1));
}

function frequencyHzToKnob(value: number) {
  const minHz = 20;
  const maxHz = 22000;
  return clampNumber(Math.log(clampNumber(value, minHz, maxHz) / minHz) / Math.log(maxHz / minHz), 0, 1);
}
