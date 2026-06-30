import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { previewFrequency, renderedInstrumentBuffer } from "../../../audio/synthPreview";
import { createSynthWorkletPreviewNode } from "../../../audio/synthWorkletPreview";
import { appPrompt, Button, HoverInfo, Icon, Knob, meshTintVariantFor, NumberInput, TextInput, Toggle } from "../../../solid-ui";
import { createStoreSelector } from "../../../solid-utils/store";
import {
  createTrackEffect,
  EFFECT_DEFAULT_PARAMS,
  EFFECT_LABELS,
  EFFECT_OPTIONS,
  EFFECT_PARAM_SPECS,
  formatEffectLatency,
  formatEffectTail,
  normalizeTrackEffectChain,
  type EffectKind,
} from "../../../state/effects";
import { createAetherEffectPresetRecord, type AetherEffectPresetRecord } from "../../../state/effectPresets";
import {
  aetherPresetLibraryCategories,
  buildAetherPresetLibraryEntries,
  filterAetherPresetLibraryEntries,
  type AetherPresetLibraryEntry,
  type AetherPresetLibrarySort,
} from "../../../state/aetherPresetLibrary";
import {
  createDefaultSynthDraft,
  FACTORY_SYNTH_PRESETS,
  MACRO_IDS,
  MODULATION_TARGET_LABELS,
  getEnvelopeCurveParam,
  getNumberParam,
  macroAssignmentsForId,
  macroConflictDetailsForId,
  macroConflictSummaryForId,
  macroDefinitionForId,
  macroLaneStateForId,
  macroOutputValue,
  modulationSourceEditorTarget,
  modulationSummaryForSource,
  modulationSummaryForTarget,
  synthEnvelopeEditorSummary,
  synthExpressionSummary,
  synthDraftFromInstrument,
  synthDraftToInstrumentPatch,
  synthDraftToPreviewInstrument,
  useSynthStore,
  type MacroCurve,
  type MacroId,
  type ModulationSourceId,
  type ModulationTargetId,
  type SynthDraftPatch,
  type SynthModulationSourceEditorTarget,
  type SynthParameterId,
} from "../../../state/synthStore";
import { createSynthPresetRecord, type SynthPresetRecord } from "../../../state/synthPresets";
import {
  deleteAetherEffectPreset,
  deleteSynthPreset,
  listAetherEffectPresets,
  listSynthPresets,
  saveAetherEffectPreset,
  saveSynthPreset,
} from "../../../persistence/dexie";
import { ANALYZER_BAND_COUNT, useAnalyzerStore, type AnalyzerSnapshot } from "../../../state/analyzerStore";
import { useInstrumentStore, useProjectStore, useUiStore } from "../../../state/store";
import { INSTRUMENT_ICON_OPTIONS, instrumentIconLabel } from "../../../state/instrumentIcons";
import type { EnvelopeCurve, TrackEffect } from "../../../state/types";
import { AnalyzerPanel } from "../AnalyzerPanel/AnalyzerPanel.solid";
import { ModulationMatrix } from "../ModulationMatrix/ModulationMatrix.solid";
import { OscillatorPanel } from "../OscillatorPanel/OscillatorPanel.solid";
import styles from "./SynthEditor.module.css";

const AUDITION_SECONDS = 1.4;
const ANALYZER_BANDS = ANALYZER_BAND_COUNT;
const FACTORY_PRESET_PREFIX = "factory:";
const USER_PRESET_PREFIX = "user:";
const USER_INSTRUMENT_PRESET_PREFIX = "instrument:";
const FILTER_TYPES = [
  ["lowpass", "LP", "Lowpass", "ph:wave-sine"],
  ["highpass", "HP", "Highpass", "ph:wave-triangle"],
  ["bandpass", "BP", "Bandpass", "ph:wave-square"],
] as const;
const ENVELOPE_CURVES = [
  ["linear", "Lin", "Linear", "ph:minus"],
  ["exp", "Exp", "Exponential", "ph:trend-up"],
  ["log", "Log", "Logarithmic", "ph:trend-down"],
  ["s-curve", "S", "S-curve", "ph:wave-sine"],
] as const;
const LFO_SHAPES = [
  ["sine", "Sine", "ph:wave-sine"],
  ["triangle", "Triangle", "ph:wave-triangle"],
  ["saw", "Saw", "ph:wave-sawtooth"],
  ["square", "Square", "ph:wave-square"],
] as const;
const LFO_SYNC_RATES = [
  ["1/1", "1/1", "Whole note", "ph:metronome"],
  ["1/2", "1/2", "Half note", "ph:metronome"],
  ["1/4", "1/4", "Quarter note", "ph:metronome"],
  ["1/8", "1/8", "Eighth note", "ph:metronome"],
  ["1/16", "1/16", "Sixteenth note", "ph:metronome"],
  ["1/32", "1/32", "Thirty-second note", "ph:metronome"],
] as const;

interface AuditionHandle {
  node: AudioNode;
  stop: (when?: number) => void;
}

interface PresetLibraryInfo {
  source: string;
  name: string;
  description: string;
  tags: string[];
}

export interface SynthEditorProps {
  instrumentId?: string;
}

export function SynthEditor(props: SynthEditorProps) {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const boundInstrumentId = createStoreSelector(useSynthStore, (state) => state.boundInstrumentId);
  const instruments = createStoreSelector(useInstrumentStore, (state) => state.instruments);
  const bindInstrument = useSynthStore.getState().bindInstrument;
  const setDraft = useSynthStore.getState().setDraft;
  const setName = useSynthStore.getState().setName;
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const updateMacroDefinition = useSynthStore.getState().updateMacroDefinition;
  const addInstrument = useInstrumentStore.getState().addInstrument;
  const updateInstrument = useInstrumentStore.getState().updateInstrument;
  const closeEditor = useUiStore.getState().closeEditor;
  const synthInstruments = createMemo(() => instruments().filter((instrument) => instrument.kind === "synth" || instrument.kind === "wavetable"));
  const userInstrumentPresets = createMemo(() => synthInstruments().filter((instrument) => instrument.userCreated && Boolean(instrument.synthPatch)));

  let didAutoBind = false;
  let audioCtx: AudioContext | null = null;
  let audition: AuditionHandle | null = null;
  let gain: GainNode | null = null;
  let analyzerFrame: number | null = null;
  let analyzerSequence = 1;
  let bodyRef: HTMLDivElement | undefined;
  let focusedSourceTimer: number | null = null;

  const [presets, setPresets] = createSignal<SynthPresetRecord[]>([]);
  const [selectedPresetId, setSelectedPresetId] = createSignal("");
  const [presetSearch, setPresetSearch] = createSignal("");
  const [presetCategory, setPresetCategory] = createSignal("");
  const [presetSort, setPresetSort] = createSignal<AetherPresetLibrarySort>("source");
  const [presetFavoritesOnly, setPresetFavoritesOnly] = createSignal(false);
  const presetLibraryEntries = createMemo(() => buildAetherPresetLibraryEntries(presets(), userInstrumentPresets()));
  const presetLibraryCategories = createMemo(() => aetherPresetLibraryCategories(presetLibraryEntries()));
  const visiblePresetLibraryEntries = createMemo(() => filterAetherPresetLibraryEntries(presetLibraryEntries(), {
    search: presetSearch(),
    category: presetCategory(),
    favoritesOnly: presetFavoritesOnly(),
    sort: presetSort(),
  }));
  const selectedUserPreset = createMemo(() => {
    if (!selectedPresetId().startsWith(USER_PRESET_PREFIX)) return null;
    const id = selectedPresetId().slice(USER_PRESET_PREFIX.length);
    return presets().find((candidate) => candidate.id === id) ?? null;
  });
  const visibleFactoryPresetEntries = createMemo(() => visiblePresetLibraryEntries().filter((entry) => entry.source === "factory"));
  const visibleUserPresetEntries = createMemo(() => visiblePresetLibraryEntries().filter((entry) => entry.source === "user-preset"));
  const visibleUserInstrumentEntries = createMemo(() => visiblePresetLibraryEntries().filter((entry) => entry.source === "user-instrument"));
  const selectedPresetInfo = createMemo<PresetLibraryInfo>(() => {
    const id = selectedPresetId();
    if (id.startsWith(FACTORY_PRESET_PREFIX)) {
      const presetId = id.slice(FACTORY_PRESET_PREFIX.length);
      const preset = FACTORY_SYNTH_PRESETS.find((candidate) => candidate.id === presetId);
      if (preset) {
        return {
          source: `Factory / ${preset.category}`,
          name: preset.name,
          description: preset.description,
          tags: preset.tags.filter((tag) => tag !== "factory"),
        };
      }
    }
    if (id.startsWith(USER_PRESET_PREFIX)) {
      const presetId = id.slice(USER_PRESET_PREFIX.length);
      const preset = presets().find((candidate) => candidate.id === presetId);
      if (preset) {
        return {
          source: preset.favorite ? "User preset / Favorite" : "User preset",
          name: preset.name,
          description: `${preset.patch.modulation.length} routes / ${preset.patch.effects?.filters.length ?? 0} instrument FX`,
          tags: preset.tags,
        };
      }
    }
    if (id.startsWith(USER_INSTRUMENT_PRESET_PREFIX)) {
      const instrumentId = id.slice(USER_INSTRUMENT_PRESET_PREFIX.length);
      const instrument = userInstrumentPresets().find((candidate) => candidate.id === instrumentId);
      if (instrument?.synthPatch) {
        return {
          source: "User instrument",
          name: instrument.name,
          description: `${instrument.synthPatch.modulation.length} routes / ${instrument.synthPatch.effects?.filters.length ?? 0} instrument FX`,
          tags: instrument.synthPatch.metadata.tags,
        };
      }
    }
    return {
      source: "Current draft",
      name: draft().name,
      description: `${draft().modulation.length} routes / ${draft().effects.filters.length} instrument FX`,
      tags: draft().metadata.tags,
    };
  });
  const [iconOpen, setIconOpen] = createSignal(false);
  const [auditioning, setAuditioning] = createSignal(false);
  const [auditionSnapshot, setAuditionSnapshot] = createSignal<AnalyzerSnapshot>(createEmptyAnalyzerSnapshot());
  const [focusedSourceTarget, setFocusedSourceTarget] = createSignal<SynthModulationSourceEditorTarget | null>(null);

  createEffect(() => {
    const id = props.instrumentId;
    if (!id) return;
    const instrument = instruments().find((candidate) => candidate.id === id);
    if (!instrument || boundInstrumentId() === id) return;
    didAutoBind = true;
    bindInstrument(instrument.id);
    setDraft(synthDraftFromInstrument(instrument));
  });

  createEffect(() => {
    if (props.instrumentId || didAutoBind || boundInstrumentId() || synthInstruments().length === 0) return;
    const first = synthInstruments()[0];
    didAutoBind = true;
    bindInstrument(first.id);
    setDraft(synthDraftFromInstrument(first));
  });

  onMount(() => {
    void refreshPresets();
  });

  onCleanup(() => {
    if (focusedSourceTimer != null) window.clearTimeout(focusedSourceTimer);
    stopAudition();
    closeAudioContext();
  });

  async function refreshPresets() {
    const nextPresets = await listSynthPresets();
    setPresets(nextPresets);
    return nextPresets;
  }

  function getAudioContext(): AudioContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!audioCtx || audioCtx.state === "closed") audioCtx = new Ctor();
    return audioCtx;
  }

  function closeAudioContext() {
    const ctx = audioCtx;
    audioCtx = null;
    if (!ctx || ctx.state === "closed") return;
    void ctx.close().catch(() => undefined);
  }

  function stopAudition() {
    const currentAudition = audition;
    const currentGain = gain;
    audition = null;
    gain = null;
    stopAuditionAnalyzer();
    setAuditioning(false);
    if (!currentAudition) return;

    try {
      const ctx = currentAudition.node.context;
      if (currentGain) {
        currentGain.gain.cancelScheduledValues(ctx.currentTime);
        currentGain.gain.setValueAtTime(currentGain.gain.value, ctx.currentTime);
        currentGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.025);
      }
      currentAudition.stop(ctx.currentTime + 0.03);
      window.setTimeout(() => {
        try {
          currentAudition.node.disconnect();
          currentGain?.disconnect();
        } catch {
          // Already disconnected.
        }
      }, 80);
    } catch {
      // Already stopped nodes throw in some browsers.
    }
  }

  async function onAudition() {
    if (auditioning()) {
      stopAudition();
      return;
    }

    stopAudition();
    const ctx = getAudioContext();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);

    const instrument = synthDraftToPreviewInstrument(draft());
    const bpm = useProjectStore.getState().project.bpm;
    const frequency = previewFrequency(instrument);
    let handle: AuditionHandle | null = null;
    let seededAnalyzer = false;
    const finishAudition = (node: AudioNode) => {
      if (audition?.node !== node) return;
      const gainNode = gain;
      audition = null;
      gain = null;
      stopAuditionAnalyzer();
      setAuditioning(false);
      try {
        node.disconnect();
        gainNode?.disconnect();
      } catch {
        // Already disconnected.
      }
    };

    const worklet = await createSynthWorkletPreviewNode(ctx, instrument, AUDITION_SECONDS, frequency, () => {
      if (handle) finishAudition(handle.node);
    }, { bpm }).catch(() => null);
    if (worklet) {
      handle = {
        node: worklet.node,
        stop: () => worklet.stop(),
      };
    } else {
      const buffer = renderedInstrumentBuffer(ctx, instrument, AUDITION_SECONDS, frequency, undefined, bpm);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      seedAnalyzerFromSamples(mixStereoToMono(left, right));
      seededAnalyzer = true;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      handle = {
        node: source,
        stop: (when?: number) => source.stop(when),
      };
      source.onended = () => finishAudition(source);
    }

    const nextGain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    nextGain.gain.value = 0;
    nextGain.gain.setValueAtTime(0, ctx.currentTime);
    nextGain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.015);
    nextGain.gain.setTargetAtTime(0, ctx.currentTime + Math.max(0.05, AUDITION_SECONDS - 0.08), 0.03);
    handle.node.connect(nextGain).connect(analyser).connect(ctx.destination);
    audition = handle;
    gain = nextGain;
    startAuditionAnalyzer(analyser);
    setAuditioning(true);
    if (handle.node instanceof AudioBufferSourceNode) {
      handle.node.start();
      handle.node.stop(ctx.currentTime + AUDITION_SECONDS);
    } else if (!seededAnalyzer) {
      publishAnalyzerSnapshot(createEmptyAnalyzerSnapshot());
    }
  }

  function startAuditionAnalyzer(analyser: AnalyserNode) {
    stopAuditionAnalyzer(false);
    const frequency = new Uint8Array(analyser.frequencyBinCount);
    const time = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteFrequencyData(frequency);
      analyser.getByteTimeDomainData(time);

      let sumSquares = 0;
      let peak = 0;
      for (let i = 0; i < time.length; i += 1) {
        const sample = (time[i] - 128) / 128;
        sumSquares += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }

      const bands = makeAnalyzerBands(frequency);
      if (peak > 0.0001 || bands.some((value) => value > 0.001)) {
        publishAnalyzerSnapshot({
          rms: Math.sqrt(sumSquares / Math.max(1, time.length)),
          peak,
          bands,
        });
      }

      analyzerFrame = window.requestAnimationFrame(tick);
    };

    tick();
  }

  function stopAuditionAnalyzer(clear = true) {
    if (analyzerFrame !== null) {
      window.cancelAnimationFrame(analyzerFrame);
      analyzerFrame = null;
    }
    if (clear) {
      setAuditionSnapshot(createEmptyAnalyzerSnapshot());
      useAnalyzerStore.getState().clearSynth();
    }
  }

  function seedAnalyzerFromSamples(samples: Float32Array) {
    const summary = summarizeBuffer(samples);
    if (summary.peak <= 0) return;
    publishAnalyzerSnapshot({
      rms: summary.rms,
      peak: summary.peak,
      bands: makeFftBands(samples),
    });
  }

  function publishAnalyzerSnapshot(snapshot: Pick<AnalyzerSnapshot, "rms" | "peak" | "bands">) {
    const next: AnalyzerSnapshot = {
      sequence: analyzerSequence++,
      rms: snapshot.rms,
      peak: snapshot.peak,
      bands: snapshot.bands.slice(0, ANALYZER_BANDS),
      updatedAt: Date.now(),
    };
    setAuditionSnapshot(next);
    useAnalyzerStore.getState().setSynthSnapshot(next);
  }

  async function saveDraftToInstrument(): Promise<string> {
    const patch = synthDraftToInstrumentPatch(draft());
    let id = boundInstrumentId();
    if (id && instruments().some((instrument) => instrument.id === id)) {
      updateInstrument(id, patch);
    } else {
      id = addInstrument({
        ...patch,
        name: patch.name ?? "Wavetable Synth",
        userCreated: true,
      });
      didAutoBind = true;
      bindInstrument(id);
    }

    if (patch.synthPatch) {
      const presetId = `instrument:${id}`;
      const existingPreset = presets().find((preset) => preset.id === presetId);
      await saveSynthPreset(createSynthPresetRecord({
        id: presetId,
        name: patch.name ?? draft().name,
        patch: patch.synthPatch,
        tags: patch.synthPatch.metadata?.tags ?? [],
        existing: existingPreset,
      }));
      await refreshPresets();
      setSelectedPresetId(`${USER_PRESET_PREFIX}${presetId}`);
    }

    return id;
  }

  async function onApply() {
    await saveDraftToInstrument();
  }

  async function onSaveInstrument() {
    await saveDraftToInstrument();
    if (props.instrumentId) closeEditor({ kind: "synthInstrument", instrumentId: props.instrumentId });
    else closeEditor({ kind: "synth" });
  }

  function onLoadPreset(value: string) {
    setSelectedPresetId(value);
    const factoryId = value.startsWith(FACTORY_PRESET_PREFIX) ? value.slice(FACTORY_PRESET_PREFIX.length) : "";
    const userId = value.startsWith(USER_PRESET_PREFIX) ? value.slice(USER_PRESET_PREFIX.length) : "";
    const userInstrumentId = value.startsWith(USER_INSTRUMENT_PRESET_PREFIX) ? value.slice(USER_INSTRUMENT_PRESET_PREFIX.length) : "";
    const patch = factoryId
      ? FACTORY_SYNTH_PRESETS.find((candidate) => candidate.id === factoryId)?.patch
      : userId
        ? presets().find((candidate) => candidate.id === userId)?.patch
        : userInstrumentId
          ? synthDraftFromInstrument(synthInstruments().find((candidate) => candidate.id === userInstrumentId)!)
          : undefined;
    if (!patch) return;
    didAutoBind = true;
    setDraft({
      ...patch,
      name: boundInstrumentId() ? draft().name : patch.name,
    });
  }

  function presetOptionValue(entry: AetherPresetLibraryEntry): string {
    if (entry.source === "factory") return `${FACTORY_PRESET_PREFIX}${entry.id}`;
    if (entry.source === "user-preset") return `${USER_PRESET_PREFIX}${entry.id}`;
    return `${USER_INSTRUMENT_PRESET_PREFIX}${entry.id}`;
  }

  async function onDeletePreset() {
    if (!selectedPresetId().startsWith(USER_PRESET_PREFIX)) return;
    await deleteSynthPreset(selectedPresetId().slice(USER_PRESET_PREFIX.length));
    setSelectedPresetId("");
    await refreshPresets();
  }

  async function onSaveAsPreset() {
    const name = await appPrompt("Preset name", draft().name || "Aether Preset", "Save Preset");
    if (!name?.trim()) return;
    const record = createSynthPresetRecord({
      name,
      patch: synthDraftToInstrumentPatch(draft()).synthPatch ?? draft(),
      tags: draft().metadata.tags,
    });
    await saveSynthPreset(record);
    await refreshPresets();
    setSelectedPresetId(`${USER_PRESET_PREFIX}${record.id}`);
  }

  async function onTogglePresetFavorite() {
    const preset = selectedUserPreset();
    if (!preset) return;
    const next = { ...preset, favorite: !preset.favorite, updatedAt: Date.now() };
    await saveSynthPreset(next);
    await refreshPresets();
    setSelectedPresetId(`${USER_PRESET_PREFIX}${next.id}`);
  }

  function onRestoreInitPreset() {
    didAutoBind = true;
    const initPreset = FACTORY_SYNTH_PRESETS.find((preset) => preset.id === "factory.init")?.patch ?? createDefaultSynthDraft();
    setDraft({
      ...initPreset,
      name: boundInstrumentId() ? draft().name : initPreset.name,
    });
    setSelectedPresetId(`${FACTORY_PRESET_PREFIX}factory.init`);
  }

  function setInstrumentIcon(icon: string) {
    setDraft({
      ...draft(),
      metadata: {
        ...draft().metadata,
        icon,
      },
    });
    setIconOpen(false);
  }

  function focusModulationSourceEditor(source: ModulationSourceId) {
    const targetId = modulationSourceEditorTarget(source);
    setFocusedSourceTarget(targetId);
    if (focusedSourceTimer != null) window.clearTimeout(focusedSourceTimer);
    focusedSourceTimer = window.setTimeout(() => {
      setFocusedSourceTarget((current) => current === targetId ? null : current);
      focusedSourceTimer = null;
    }, 1800);

    queueMicrotask(() => {
      const target = bodyRef?.querySelector<HTMLElement>(`[data-synth-source-editor="${targetId}"]`);
      if (!target) return;
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const focusTarget = target.querySelector<HTMLElement>("[data-synth-source-focus], input, button, select, [tabindex]");
      focusTarget?.focus({ preventScroll: true });
    });
  }

  return (
    <section class={`ds-editor-shell ds-fill ${styles.shell}`} aria-label="Synth editor">
      <div ref={bodyRef} class={`ds-editor-body ds-scroll ${styles.body}`}>
        <div class={styles.utilityGrid}>
          <section class="ds-panel" aria-label="Synth identity">
            <header class="ds-panel-header">
              <div class="ds-panel-title">Instrument</div>
            </header>
            <div class={`ds-panel-body ${styles.identityBody}`}>
              <div class={styles.nameIconRow}>
                <TextInput
                  className={styles.nameField}
                  label="Name"
                  layout="inline"
                  value={draft().name}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
                <div class={styles.iconPicker}>
                  <HoverInfo content={instrumentIconLabel(draft().metadata.icon)}>
                    <Button
                      iconOnly
                      size="md"
                      className={styles.iconPickerButton}
                      aria-label="Change instrument icon"
                      onClick={() => setIconOpen((open) => !open)}
                    >
                      <Icon name={draft().metadata.icon ?? "ph:cube"} size={16} decorative />
                    </Button>
                  </HoverInfo>
                  <Show when={iconOpen()}>
                    <div class={styles.iconMenu} role="menu" aria-label="Instrument icons">
                      <For each={INSTRUMENT_ICON_OPTIONS}>
                        {(option) => (
                          <button
                            type="button"
                            class={`${styles.iconOption} ${draft().metadata.icon === option.icon ? styles.iconOptionSelected : ""}`}
                            title={`${option.label} - ${option.tags.join(", ")}`}
                            onClick={() => setInstrumentIcon(option.icon)}
                            role="menuitem"
                          >
                            <Icon name={option.icon} size={16} decorative />
                            <span>{option.label}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
              <div class={styles.presetTools}>
                <TextInput
                  label="Search"
                  layout="inline"
                  className={styles.presetSearch}
                  value={presetSearch()}
                  placeholder="Preset name, tag, source"
                  onInput={(event) => setPresetSearch(event.currentTarget.value)}
                />
                <label class={styles.presetCategory}>
                  <span class="ds-field-label">Category</span>
                  <select
                    class="ds-select"
                    value={presetCategory()}
                    onChange={(event) => setPresetCategory(event.currentTarget.value)}
                  >
                    <option value="">All</option>
                    <For each={presetLibraryCategories()}>
                      {(category) => <option value={category}>{category}</option>}
                    </For>
                  </select>
                </label>
                <label class={styles.presetSort}>
                  <span class="ds-field-label">Sort</span>
                  <select
                    class="ds-select"
                    value={presetSort()}
                    onChange={(event) => setPresetSort(event.currentTarget.value as AetherPresetLibrarySort)}
                  >
                    <option value="source">Source</option>
                    <option value="name">Name</option>
                    <option value="category">Category</option>
                    <option value="complexity">Complexity</option>
                    <option value="favorite">Favorites</option>
                  </select>
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  selected={presetFavoritesOnly()}
                  aria-label="Toggle preset favorites filter"
                  onClick={() => setPresetFavoritesOnly((value) => !value)}
                >
                  Favorites
                </Button>
              </div>
              <div class={styles.presetRow}>
                <label class={styles.presetSelect}>
                  <span class="ds-field-label">Preset</span>
                  <select
                    class="ds-select"
                    value={selectedPresetId()}
                    onChange={(event) => onLoadPreset(event.currentTarget.value)}
                  >
                    <option value="">None</option>
                    <Show when={visiblePresetLibraryEntries().length === 0}>
                      <option value="" disabled>No presets match</option>
                    </Show>
                    <Show when={visibleFactoryPresetEntries().length > 0}>
                      <optgroup label="Factory">
                        <For each={visibleFactoryPresetEntries()}>
                          {(entry) => (
                            <option value={presetOptionValue(entry)}>
                              {entry.name}
                            </option>
                          )}
                        </For>
                      </optgroup>
                    </Show>
                    <Show when={visibleUserPresetEntries().length > 0}>
                      <optgroup label="User Presets">
                        <For each={visibleUserPresetEntries()}>
                          {(entry) => (
                            <option value={presetOptionValue(entry)}>
                              {entry.name}
                            </option>
                          )}
                        </For>
                      </optgroup>
                    </Show>
                    <Show when={visibleUserInstrumentEntries().length > 0}>
                      <optgroup label="User Instruments">
                        <For each={visibleUserInstrumentEntries()}>
                          {(entry) => (
                            <option value={presetOptionValue(entry)}>
                              {entry.name}
                            </option>
                          )}
                        </For>
                      </optgroup>
                    </Show>
                  </select>
                </label>
                <Show when={selectedPresetId().startsWith(USER_PRESET_PREFIX)}>
                  <Button
                    size="sm"
                    variant="ghost"
                    selected={selectedUserPreset()?.favorite === true}
                    aria-label="Toggle selected Aether preset favorite"
                    onClick={() => void onTogglePresetFavorite()}
                  >
                    {selectedUserPreset()?.favorite ? "Favorited" : "Favorite"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onDeletePreset}>
                    Delete
                  </Button>
                </Show>
                <Button size="sm" variant="ghost" onClick={() => void onSaveAsPreset()}>
                  Save As
                </Button>
                <Button size="sm" variant="ghost" onClick={onRestoreInitPreset}>
                  Restore Init
                </Button>
              </div>
              <div class={styles.presetInfo} aria-label="Selected Aether preset details">
                <div class={styles.presetInfoHeader}>
                  <span>{selectedPresetInfo().source}</span>
                  <strong>{selectedPresetInfo().name}</strong>
                </div>
                <p>{selectedPresetInfo().description}</p>
                <Show when={selectedPresetInfo().tags.length > 0}>
                  <div class={styles.presetTags}>
                    <For each={selectedPresetInfo().tags}>
                      {(tag) => <span>{tag}</span>}
                    </For>
                  </div>
                </Show>
              </div>
              <div class={styles.expressionSummary} aria-label="Aether expression and performance summary">
                <For each={synthExpressionSummary(draft())}>
                  {(item) => (
                    <div
                      class={styles.expressionSummaryItem}
                      data-active={item.active ? "true" : "false"}
                      data-mesh-variant={meshTintVariantFor(item.id)}
                      title={`${item.label}: ${item.value} - ${item.detail}`}
                    >
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                      <small>{item.detail}</small>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </section>
          <AnalyzerPanel
            state={() => ({
              scope: "synth",
              snapshotOverride: auditionSnapshot(),
              playing: auditioning(),
              onTogglePlayback: () => void onAudition(),
            })}
          />
        </div>

        <OscillatorPanel />

        <div class={styles.sourceGrid}>
          <LfoPanel focusedSourceTarget={focusedSourceTarget()} />
          <section class={`ds-panel ${styles.macroPanel}`} aria-label="Macros">
            <header class="ds-panel-header">
              <div class="ds-panel-title">Macro Controls</div>
            </header>
            <div class={`ds-panel-body ${styles.macros}`}>
              <For each={MACRO_IDS}>
                {(id, index) => {
                  const definition = () => macroDefinitionForId(draft(), id);
                  const assignments = () => macroAssignmentsForId(draft(), id);
                  const conflict = () => macroConflictSummaryForId(draft(), id);
                  const conflictDetails = () => macroConflictDetailsForId(draft(), id);
                  const macroLane = () => macroLaneStateForId(draft(), id);
                  const assignmentLabel = () => assignments().length === 0
                    ? "No assignments"
                    : assignments()
                        .slice(0, 2)
                        .map((route) => MODULATION_TARGET_LABELS[route.target] ?? route.target)
                        .join(", ");
                  const macroLaneStyle = () => {
                    const lane = macroLane();
                    const start = Math.round(lane.rangeStart * 100);
                    const end = Math.round(lane.rangeEnd * 100);
                    const left = Math.min(start, end);
                    const width = Math.max(1, Math.abs(end - start));
                    return `--macro-range-left:${left}%; --macro-range-width:${width}%; --macro-output:${Math.round(lane.outputValue * 100)}%;`;
                  };
                  const macroLaneTargets = () => macroLane().targetLabels.slice(0, 2).join(", ") || "No routed targets";
                  return (
                    <div
                      class={`${styles.macroCard} ${focusedSourceTarget() === id ? styles.sourceFocus : ""}`}
                      data-synth-source-editor={id}
                      aria-label={`${definition().label} macro control`}
                    >
                      <TextInput
                        data-synth-source-focus
                        layout="bare"
                        aria-label={`Macro ${index() + 1} name`}
                        value={definition().label}
                        onInput={(event) => updateMacroDefinition(id, { label: event.currentTarget.value })}
                      />
                      <Knob
                        size="sm"
                        label={`M${index() + 1}`}
                        value={getNumberParam(draft(), id)}
                        min={0}
                        max={1}
                        step={0.01}
                        defaultValue={0}
                        {...modulationPropsForSource(draft(), id)}
                        pickSourceId={id}
                        formatValue={formatPercent}
                        onChange={(value) => setNumericParameter(id, value)}
                      />
                      <div class={styles.macroLane} style={macroLaneStyle()} aria-label={`${definition().label} macro lane`}>
                        <div class={styles.macroLaneTrack} aria-hidden="true">
                          <span class={styles.macroLaneRange} />
                          <span class={styles.macroLaneOutput} />
                        </div>
                        <div class={styles.macroLaneMeta}>
                          <span>{Math.round(macroLane().rangeStart * 100)}-{Math.round(macroLane().rangeEnd * 100)}%</span>
                          <span>{macroLane().curve}</span>
                          <span>{macroLaneTargets()}</span>
                        </div>
                      </div>
                      <div
                        class={styles.macroAssignment}
                        title={assignmentLabel()}
                        aria-label={`${definition().label} macro assignments`}
                      >
                        <span>{assignmentLabel()}</span>
                        <Show when={assignments().length > 2}>
                          <span>+{assignments().length - 2}</span>
                        </Show>
                      </div>
                      <Show when={conflict().count > 0}>
                        <div
                          class={styles.macroConflict}
                          title={conflict().label}
                          aria-label={`${definition().label} macro conflict`}
                        >
                          <span>Conflict</span>
                          <span>{conflict().label}</span>
                          <For each={conflictDetails().slice(0, 2)}>
                            {(detail) => (
                              <div class={styles.macroConflictDetail} aria-label={`${detail.targetLabel} macro conflict detail`}>
                                <span>{detail.targetLabel}</span>
                                <span>{detail.competingSources.slice(0, 2).join(", ")}</span>
                                <span>Summed</span>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                      <div class={styles.macroMetaRow}>
                        <TextInput
                          layout="bare"
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          aria-label={`${definition().label} minimum`}
                          value={definition().min}
                          onInput={(event) => updateMacroDefinition(id, { min: Number(event.currentTarget.value) })}
                        />
                        <TextInput
                          layout="bare"
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          aria-label={`${definition().label} maximum`}
                          value={definition().max}
                          onInput={(event) => updateMacroDefinition(id, { max: Number(event.currentTarget.value) })}
                        />
                      </div>
                      <select
                        class={`ds-select ${styles.macroCurveSelect}`}
                        value={definition().curve}
                        aria-label={`${definition().label} response curve`}
                        onInput={(event) => updateMacroDefinition(id, { curve: event.currentTarget.value as MacroCurve })}
                      >
                        <option value="linear">Linear</option>
                        <option value="ease-in">Ease In</option>
                        <option value="ease-out">Ease Out</option>
                        <option value="s-curve">S-Curve</option>
                      </select>
                      <div class={styles.macroOutput}>{Math.round(macroOutputValue(draft(), id) * 100)}%</div>
                    </div>
                  );
                }}
              </For>
            </div>
          </section>
        </div>

        <InstrumentFxRack />

        <div class={styles.bottomGrid}>
          <PerformancePanel focusedSourceTarget={focusedSourceTarget()} />
          <AmpFilterPanel focusedSourceTarget={focusedSourceTarget()} />
          <ModulationMatrix onFocusSource={focusModulationSourceEditor} />
        </div>
      </div>

      <footer class={`ds-action-footer ${styles.footer}`}>
        <Button className={styles.footerButton} variant="ghost" selected={auditioning()} onClick={() => void onAudition()}>
          <Icon name={auditioning() ? "ph:stop-fill" : "ph:play-fill"} size={12} decorative />
          {auditioning() ? "Stop" : "Play"}
        </Button>
        <Button className={styles.footerButton} onClick={() => void onApply()}>
          Apply
        </Button>
        <Button className={styles.footerButton} variant="primary" onClick={() => void onSaveInstrument()}>
          Save
        </Button>
      </footer>
    </section>
  );
}

function InstrumentFxRack() {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setDraft = useSynthStore.getState().setDraft;
  const effects = createMemo(() => draft().effects.filters);
  const [effectPresets, setEffectPresets] = createSignal<AetherEffectPresetRecord[]>([]);
  const [selectedEffectPresetId, setSelectedEffectPresetId] = createSignal("");
  const selectedEffectPresetInfo = createMemo<PresetLibraryInfo>(() => {
    const preset = effectPresets().find((candidate) => candidate.id === selectedEffectPresetId());
    if (preset) {
      return {
        source: `User FX / ${preset.category}`,
        name: preset.name,
        description: preset.description,
        tags: preset.tags,
      };
    }
    return {
      source: "Current FX chain",
      name: draft().name ? `${draft().name} FX` : "Unsaved FX",
      description: describeEffectChain(effects()),
      tags: effects().length > 0 ? ["draft"] : [],
    };
  });

  onMount(() => {
    void refreshEffectPresets();
  });

  async function refreshEffectPresets() {
    const nextPresets = await listAetherEffectPresets();
    setEffectPresets(nextPresets);
    return nextPresets;
  }

  function updateEffects(filters: TrackEffect[]) {
    setDraft({
      ...draft(),
      effects: normalizeTrackEffectChain({ filters }),
    });
  }

  function addEffect(kind: EffectKind) {
    updateEffects([...effects(), createTrackEffect(kind)]);
  }

  function patchEffect(effectId: string, patch: Partial<TrackEffect>) {
    updateEffects(effects().map((effect) => (
      effect.id === effectId ? { ...effect, ...patch } : effect
    )));
  }

  function patchParam(effect: TrackEffect, key: string, value: number) {
    patchEffect(effect.id, {
      params: {
        ...effect.params,
        [key]: value,
      },
    });
  }

  function moveEffect(effectId: string, direction: -1 | 1) {
    const current = effects();
    const index = current.findIndex((effect) => effect.id === effectId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    const next = current.slice();
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    updateEffects(next);
  }

  function removeEffect(effectId: string) {
    updateEffects(effects().filter((effect) => effect.id !== effectId));
  }

  function loadEffectPreset(id: string) {
    setSelectedEffectPresetId(id);
    const preset = effectPresets().find((candidate) => candidate.id === id);
    if (!preset) return;
    setDraft({
      ...draft(),
      effects: normalizeTrackEffectChain(preset.chain),
    });
  }

  async function saveEffectPreset() {
    const name = await appPrompt("FX preset name", draft().name ? `${draft().name} FX` : "Aether FX", "Save FX Preset");
    if (!name?.trim()) return;
    const record = createAetherEffectPresetRecord({
      name,
      chain: draft().effects,
      tags: ["aether", "instrument-fx"],
    });
    await saveAetherEffectPreset(record);
    await refreshEffectPresets();
    setSelectedEffectPresetId(record.id);
  }

  async function deleteEffectPreset() {
    const id = selectedEffectPresetId();
    if (!id) return;
    await deleteAetherEffectPreset(id);
    setSelectedEffectPresetId("");
    await refreshEffectPresets();
  }

  return (
    <section class={`ds-panel ${styles.fxPanel}`} aria-label="Aether instrument effects">
      <header class="ds-panel-header">
        <div class="ds-panel-title">Instrument FX</div>
        <div class="ds-panel-actions">
          <Show when={effectPresets().length > 0}>
            <select
              class={`ds-select ${styles.fxPresetSelect}`}
              aria-label="Load instrument FX preset"
              value={selectedEffectPresetId()}
              onChange={(event) => loadEffectPreset(event.currentTarget.value)}
            >
              <option value="">FX preset</option>
              <For each={effectPresets()}>
                {(preset) => <option value={preset.id}>{preset.name}</option>}
              </For>
            </select>
          </Show>
          <Button size="xs" variant="ghost" onClick={() => void saveEffectPreset()}>
            Save FX
          </Button>
          <Show when={selectedEffectPresetId()}>
            <Button size="xs" variant="ghost" onClick={() => void deleteEffectPreset()}>
              Delete FX
            </Button>
          </Show>
          <select
            class={`ds-select ${styles.fxAddSelect}`}
            aria-label="Add instrument effect"
            value=""
            onChange={(event) => {
              const value = event.currentTarget.value as EffectKind;
              if (!value) return;
              addEffect(value);
              event.currentTarget.value = "";
            }}
          >
            <option value="">Add effect</option>
            <For each={EFFECT_OPTIONS}>
              {(option) => <option value={option.value}>{option.label}</option>}
            </For>
          </select>
        </div>
      </header>
      <div class={`ds-panel-body ${styles.fxBody}`}>
        <div class={`${styles.presetInfo} ${styles.fxPresetInfo}`} aria-label="Selected Aether FX preset details">
          <div class={styles.presetInfoHeader}>
            <span>{selectedEffectPresetInfo().source}</span>
            <strong>{selectedEffectPresetInfo().name}</strong>
          </div>
          <p>{selectedEffectPresetInfo().description}</p>
          <Show when={selectedEffectPresetInfo().tags.length > 0}>
            <div class={styles.presetTags}>
              <For each={selectedEffectPresetInfo().tags}>
                {(tag) => <span>{tag}</span>}
              </For>
            </div>
          </Show>
        </div>
        <Show when={effects().length > 0} fallback={<div class={styles.fxEmpty}>No instrument FX. Output goes directly to the track chain.</div>}>
          <div class={styles.fxChain}>
            <For each={effects()}>
              {(effect, index) => (
                <article class={`${styles.fxBlock} ${effect.bypassed ? styles.fxBlockBypassed : ""}`}>
                  <div class={styles.fxHeader}>
                    <div class={styles.fxTitleBlock}>
                      <div class={styles.fxTitle}>{EFFECT_LABELS[effect.kind]}</div>
                      <div class={styles.fxBadges}>
                        <span>{formatEffectLatency(effect)}</span>
                        <span>{formatEffectTail(effect)}</span>
                      </div>
                    </div>
                    <div class={styles.fxActions}>
                      <HoverInfo content="Move left">
                        <Button
                          iconOnly
                          size="xs"
                          disabled={index() === 0}
                          aria-label={`Move ${EFFECT_LABELS[effect.kind]} earlier`}
                          onClick={() => moveEffect(effect.id, -1)}
                        >
                          <Icon name="ph:caret-left" size={12} decorative />
                        </Button>
                      </HoverInfo>
                      <HoverInfo content="Move right">
                        <Button
                          iconOnly
                          size="xs"
                          disabled={index() === effects().length - 1}
                          aria-label={`Move ${EFFECT_LABELS[effect.kind]} later`}
                          onClick={() => moveEffect(effect.id, 1)}
                        >
                          <Icon name="ph:caret-right" size={12} decorative />
                        </Button>
                      </HoverInfo>
                      <Toggle
                        checked={!effect.bypassed}
                        onChange={(enabled) => patchEffect(effect.id, { bypassed: !enabled })}
                      />
                      <HoverInfo content="Remove effect">
                        <Button
                          iconOnly
                          size="xs"
                          aria-label={`Remove ${EFFECT_LABELS[effect.kind]}`}
                          onClick={() => removeEffect(effect.id)}
                        >
                          <Icon name="ph:trash" size={12} decorative />
                        </Button>
                      </HoverInfo>
                    </div>
                  </div>
                  <div class={styles.fxParams}>
                    <For each={EFFECT_PARAM_SPECS[effect.kind]}>
                      {(param) => (
                        <NumberInput
                          label={param.label}
                          value={effect.params[param.key] ?? EFFECT_DEFAULT_PARAMS[effect.kind][param.key] ?? param.min}
                          min={param.min}
                          max={param.max}
                          step={param.step}
                          unit={param.unit}
                          layout="inline"
                          onChange={(value) => patchParam(effect, param.key, value)}
                        />
                      )}
                    </For>
                  </div>
                </article>
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  );
}

function describeEffectChain(effects: TrackEffect[]): string {
  if (effects.length === 0) return "Empty instrument FX chain.";
  const labels = effects.map((effect) => {
    const label = EFFECT_LABELS[effect.kind] ?? effect.kind;
    return effect.bypassed ? `${label} bypassed` : label;
  });
  const bypassed = effects.filter((effect) => effect.bypassed).length;
  const suffix = bypassed > 0 ? ` / ${bypassed} bypassed` : "";
  return `${labels.length} ${labels.length === 1 ? "effect" : "effects"}: ${labels.join(" -> ")}${suffix}`;
}

function LfoPanel(props: { focusedSourceTarget?: SynthModulationSourceEditorTarget | null }) {
  return (
    <section class={`ds-panel ${styles.lfoPanel}`} aria-label="LFO">
      <header class="ds-panel-header">
        <div class="ds-panel-title">LFO</div>
      </header>
      <div class={`ds-panel-body ${styles.lfoStack}`}>
        <LfoLane lfo={1} focused={props.focusedSourceTarget === "lfo.1"} />
        <LfoLane lfo={2} focused={props.focusedSourceTarget === "lfo.2"} />
      </div>
    </section>
  );
}

function LfoLane(props: { lfo: 1 | 2; focused?: boolean }) {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const setParameter = useSynthStore.getState().setParameter;
  const prefix = `lfo.${props.lfo}` as const;
  const enabledId = `${prefix}.enabled` as SynthParameterId;
  const shapeId = `${prefix}.shape` as SynthParameterId;
  const rateId = `${prefix}.rate` as SynthParameterId;
  const syncId = `${prefix}.sync` as SynthParameterId;
  const syncedRateId = `${prefix}.syncedRate` as SynthParameterId;
  const smoothingId = `${prefix}.smoothing` as SynthParameterId;
  const randomPhaseId = `${prefix}.randomPhase` as SynthParameterId;
  const phaseId = `${prefix}.phase` as SynthParameterId;
  const retriggerId = `${prefix}.retrigger` as SynthParameterId;
  const oneShotId = `${prefix}.oneShot` as SynthParameterId;
  const enabled = createMemo(() => draft().parameters[enabledId] === true);
  const sync = createMemo(() => draft().parameters[syncId] === true);
  const retrigger = createMemo(() => draft().parameters[retriggerId] !== false);
  const oneShot = createMemo(() => draft().parameters[oneShotId] === true);

  return (
    <div
      class={`${styles.lfoLane} ${enabled() ? "" : styles.disabledPanel} ${props.focused ? styles.sourceFocus : ""}`}
      aria-label={`LFO ${props.lfo}`}
      data-synth-source-editor={`lfo.${props.lfo}`}
    >
      <header class={styles.lfoLaneHeader}>
        <div class={styles.lfoLaneTitle}>LFO {props.lfo}</div>
        <div class="ds-panel-actions">
          <Button
            iconOnly
            size="xs"
            selected={sync()}
            aria-label={`${sync() ? "Disable" : "Enable"} LFO ${props.lfo} tempo sync`}
            onClick={() => setBooleanParameter(syncId, !sync())}
          >
            <Icon name={sync() ? "ph:clock-countdown-fill" : "ph:clock-countdown"} size={12} decorative />
          </Button>
          <Button
            iconOnly
            size="xs"
            selected={oneShot()}
            aria-label={`${oneShot() ? "Disable" : "Enable"} LFO ${props.lfo} one-shot`}
            onClick={() => setBooleanParameter(oneShotId, !oneShot())}
          >
            <Icon name={oneShot() ? "ph:flag-pennant-fill" : "ph:flag-pennant"} size={12} decorative />
          </Button>
          <Button
            iconOnly
            size="xs"
            selected={retrigger()}
            aria-label={`${retrigger() ? "Disable" : "Enable"} LFO ${props.lfo} retrigger`}
            onClick={() => setBooleanParameter(retriggerId, !retrigger())}
          >
            <Icon name={retrigger() ? "ph:arrow-counter-clockwise-fill" : "ph:arrow-counter-clockwise"} size={12} decorative />
          </Button>
          <Button
            iconOnly
            size="xs"
            selected={enabled()}
            aria-label={`${enabled() ? "Disable" : "Enable"} LFO ${props.lfo}`}
            onClick={() => setBooleanParameter(enabledId, !enabled())}
          >
            <Icon name={enabled() ? "ph:power-fill" : "ph:power"} size={12} decorative />
          </Button>
        </div>
      </header>
      <div class={styles.lfoControls}>
        <ShapeButtonSet
          label={`LFO ${props.lfo} Shape`}
          value={String(draft().parameters[shapeId])}
          options={LFO_SHAPES}
          onChange={(value) => setParameter(shapeId, value)}
        />
        <Show
          when={sync()}
          fallback={
            <Knob
              size="sm"
              label="Rate"
              value={getNumberParam(draft(), rateId)}
              min={0.05}
              max={50}
              step={0.01}
              unit="Hz"
              defaultValue={1}
              formatValue={(value) => `${value < 10 ? value.toFixed(2) : value.toFixed(1)}`}
              pickSourceId={`lfo.${props.lfo}` as ModulationSourceId}
              onChange={(value) => setNumericParameter(rateId, value)}
            />
          }
        >
          <ShapeButtonSet
            label={`LFO ${props.lfo} Sync Rate`}
            value={String(draft().parameters[syncedRateId] ?? (props.lfo === 1 ? "1/4" : "1/2"))}
            options={LFO_SYNC_RATES}
            onChange={(value) => setParameter(syncedRateId, value)}
          />
        </Show>
        <Knob
          size="sm"
          label="Phase"
          value={getNumberParam(draft(), phaseId)}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0}
          formatValue={(value) => `${Math.round(value * 360)} deg`}
          onChange={(value) => setNumericParameter(phaseId, value)}
        />
        <Knob
          size="sm"
          label="Smooth"
          value={getNumberParam(draft(), smoothingId)}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0}
          formatValue={formatPercent}
          onChange={(value) => setNumericParameter(smoothingId, value)}
        />
        <Knob
          size="sm"
          label="Random"
          value={getNumberParam(draft(), randomPhaseId)}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0}
          formatValue={formatPercent}
          onChange={(value) => setNumericParameter(randomPhaseId, value)}
        />
      </div>
    </div>
  );
}

function PerformancePanel(props: { focusedSourceTarget?: SynthModulationSourceEditorTarget | null }) {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const summary = createMemo(() => synthExpressionSummary(draft()));
  const routedSummary = createMemo(() => summary().filter((item) => (
    item.id === "pitch-bend" || item.id === "velocity" || item.id === "keytrack" || item.id === "mod-wheel"
  )));
  const mono = createMemo(() => draft().parameters["mono.enabled"] === true);
  const legato = createMemo(() => draft().parameters["legato.enabled"] === true);

  return (
    <section
      class={`ds-panel ${props.focusedSourceTarget === "performance" ? styles.sourceFocus : ""}`}
      aria-label="Performance controls"
      data-synth-source-editor="performance"
    >
      <header class="ds-panel-header">
        <div class="ds-panel-title">Performance</div>
      </header>
      <div class={`ds-panel-body ${styles.performanceBody}`}>
        <div class={styles.performanceControls}>
          <NumberInput
            label="Voices"
            layout="inline"
            value={getNumberParam(draft(), "maxVoices")}
            min={1}
            max={32}
            step={1}
            maxLength={2}
            onChange={(value) => setNumericParameter("maxVoices", value)}
          />
          <NumberInput
            label="Glide"
            layout="inline"
            value={getNumberParam(draft(), "glide.ms")}
            min={0}
            max={5000}
            step={1}
            unit="ms"
            maxLength={4}
            onChange={(value) => setNumericParameter("glide.ms", value)}
          />
          <Toggle
            label="Mono"
            checked={mono()}
            onChange={(value) => setBooleanParameter("mono.enabled", value)}
          />
          <Toggle
            label="Legato"
            checked={legato()}
            onChange={(value) => setBooleanParameter("legato.enabled", value)}
          />
        </div>
        <div class={styles.performanceReadouts} aria-label="Performance source readouts">
          <For each={routedSummary()}>
            {(item) => (
              <div
                class={styles.performanceReadout}
                data-active={item.active ? "true" : "false"}
                data-mesh-variant={meshTintVariantFor(item.id)}
                title={`${item.label}: ${item.value} - ${item.detail}`}
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </div>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}

function AmpFilterPanel(props: { focusedSourceTarget?: SynthModulationSourceEditorTarget | null }) {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const setParameter = useSynthStore.getState().setParameter;
  const filterType = createMemo(() => String(draft().parameters["filter.type"]));
  const filterEnabled = createMemo(() => draft().parameters["filter.enabled"] === true);
  const env1Loop = createMemo(() => draft().parameters["env.1.loop"] === true);
  const env2Loop = createMemo(() => draft().parameters["env.2.loop"] === true);

  return (
    <section
      class={`ds-panel ${filterEnabled() ? "" : styles.disabledPanel} ${props.focusedSourceTarget === "env.1" || props.focusedSourceTarget === "env.2" ? styles.sourceFocus : ""}`}
      aria-label="Amp and filter"
      data-synth-source-editor={props.focusedSourceTarget === "env.1" || props.focusedSourceTarget === "env.2" ? props.focusedSourceTarget : undefined}
    >
      <header class="ds-panel-header">
        <div class="ds-panel-title">Amp / Filter</div>
        <div class="ds-panel-actions">
          <Button
            iconOnly
            size="xs"
            selected={filterEnabled()}
            aria-label={`${filterEnabled() ? "Disable" : "Enable"} filter`}
            onClick={() => setBooleanParameter("filter.enabled", !filterEnabled())}
          >
            <Icon name={filterEnabled() ? "ph:power-fill" : "ph:power"} size={12} decorative />
          </Button>
        </div>
      </header>
      <div class={`ds-panel-body ${styles.controlGrid}`}>
        <div class={styles.envelopeCards}>
          <For each={["env.1", "env.2"] as const}>
            {(source) => {
              const envelope = () => synthEnvelopeEditorSummary(draft(), source);
              return (
                <div
                  class={styles.envelopeCard}
                  data-synth-source-editor={source}
                  data-aether-envelope-editor={source}
                  data-active={props.focusedSourceTarget === source ? "true" : "false"}
                >
                  <div class={styles.envelopeCardHeader}>
                    <strong>{envelope().label}</strong>
                    <span>{envelope().mode}</span>
                  </div>
                  <EnvelopeHandleEditor
                    source={source}
                    onChange={setNumericParameter}
                    onSetCurve={setParameter}
                  />
                  <div class={styles.envelopeCardMeta}>
                    <span>{envelope().timingLabel}</span>
                    <span>{envelope().sustainLabel}</span>
                    <span>{envelope().curveLabel}</span>
                    <span>{envelope().assignmentLabel}</span>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
        <ShapeButtonSet
          label="Filter"
          value={filterType()}
          options={FILTER_TYPES}
          onChange={(value) => setParameter("filter.type", value)}
        />
        <Knob
          size="sm"
          label="Cutoff"
          value={getNumberParam(draft(), "filter.cutoff")}
          min={20}
          max={20000}
          step={10}
          unit="Hz"
          defaultValue={18000}
          {...modulationPropsForTarget(draft(), "filter.cutoff")}
          pickTargetId="filter.cutoff"
          formatValue={(value) => Math.round(value).toString()}
          onChange={(value) => setNumericParameter("filter.cutoff", value)}
        />
        <For each={[
          ["filter.resonance", "Res", 0.1, false],
          ["filter.keytrack", "Key", 0, false],
          ["filter.drive", "Drive", 0, false],
          ["amp.level", "Level", 0.8, false],
          ["amp.pan", "Pan", 0, true],
          ["env.1.attack", "Attack", 0.005, false],
          ["env.1.decay", "Decay", 0.15, false],
          ["env.1.sustain", "Sustain", 0.8, false],
          ["env.1.release", "Release", 0.25, false],
          ["env.2.attack", "Mod Atk", 0.01, false],
          ["env.2.decay", "Mod Dec", 0.3, false],
          ["env.2.sustain", "Mod Sus", 0, false],
          ["env.2.release", "Mod Rel", 0.2, false],
        ] as Array<[SynthParameterId, string, number, boolean]>}>
          {([id, label, defaultValue, bipolar]) => (
            <Knob
              size="sm"
              label={label}
              value={getNumberParam(draft(), id)}
              min={bipolar ? -1 : 0}
              max={id.startsWith("env.") && !id.endsWith("sustain") ? 30 : 1}
              step={id.startsWith("env.") && !id.endsWith("sustain") ? 0.001 : 0.01}
              defaultValue={defaultValue}
              bipolar={bipolar}
              {...modulationPropsForTarget(draft(), id)}
              pickTargetId={MODULATABLE_PARAMETER_IDS.has(id) ? id : undefined}
              formatValue={id.startsWith("env.") && !id.endsWith("sustain") ? formatSeconds : formatPercent}
              onChange={(value) => setNumericParameter(id, value)}
            />
          )}
        </For>
        <For each={[
          ["env.1.attackCurve", "Atk Curve"],
          ["env.1.decayCurve", "Dec Curve"],
          ["env.1.releaseCurve", "Rel Curve"],
          ["env.2.attackCurve", "Mod Atk"],
          ["env.2.decayCurve", "Mod Dec"],
          ["env.2.releaseCurve", "Mod Rel"],
        ] as Array<[SynthParameterId, string]>}>
          {([id, label]) => (
            <ShapeButtonSet
              label={label}
              value={getEnvelopeCurveParam(draft(), id)}
              options={ENVELOPE_CURVES}
              onChange={(value) => setParameter(id, value)}
            />
          )}
        </For>
        <Button
          size="sm"
          selected={env1Loop()}
          onClick={() => setBooleanParameter("env.1.loop", !env1Loop())}
        >
          Env 1 Loop
        </Button>
        <Button
          size="sm"
          selected={env2Loop()}
          onClick={() => setBooleanParameter("env.2.loop", !env2Loop())}
        >
          Env 2 Loop
        </Button>
      </div>
    </section>
  );
}

function EnvelopeHandleEditor(props: {
  source: "env.1" | "env.2";
  onChange: (id: SynthParameterId, value: number) => void;
  onSetCurve: (id: SynthParameterId, value: EnvelopeCurve) => void;
}) {
  let railRef: SVGSVGElement | undefined;
  const [draggedHandle, setDraggedHandle] = createSignal<"attack" | "decay-sustain" | "release" | null>(null);
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const envelope = createMemo(() => synthEnvelopeEditorSummary(draft(), props.source));
  const attack = createMemo(() => getNumberParam(draft(), `${props.source}.attack` as SynthParameterId));
  const decay = createMemo(() => getNumberParam(draft(), `${props.source}.decay` as SynthParameterId));
  const sustain = createMemo(() => getNumberParam(draft(), `${props.source}.sustain` as SynthParameterId));
  const release = createMemo(() => getNumberParam(draft(), `${props.source}.release` as SynthParameterId));
  const attackCurve = createMemo(() => getEnvelopeCurveParam(draft(), `${props.source}.attackCurve` as SynthParameterId));
  const decayCurve = createMemo(() => getEnvelopeCurveParam(draft(), `${props.source}.decayCurve` as SynthParameterId));
  const releaseCurve = createMemo(() => getEnvelopeCurveParam(draft(), `${props.source}.releaseCurve` as SynthParameterId));

  const startPoint = createMemo(() => envelope().points[0] ?? { x: 0, y: 100 });
  const attackPoint = createMemo(() => envelope().points[1] ?? { x: 0, y: 0 });
  const decayPoint = createMemo(() => envelope().points[2] ?? { x: 50, y: 50 });
  const holdPoint = createMemo(() => envelope().points[3] ?? decayPoint());
  const releasePoint = createMemo(() => envelope().points[4] ?? { x: 100, y: 100 });
  const attackCurvePoint = createMemo(() => midpoint(startPoint(), attackPoint()));
  const decayCurvePoint = createMemo(() => midpoint(attackPoint(), decayPoint()));
  const releaseCurvePoint = createMemo(() => midpoint(holdPoint(), releasePoint()));

  function updateHandle(kind: "attack" | "decay-sustain" | "release", event: PointerEvent) {
    const rail = railRef;
    const rect = rail?.getBoundingClientRect();
    if (!rail || !rect || rect.width <= 0 || rect.height <= 0) return;
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    if (kind === "attack") {
      props.onChange(`${props.source}.attack` as SynthParameterId, snapEnvelopeSeconds(x * 5));
    } else if (kind === "decay-sustain") {
      props.onChange(`${props.source}.decay` as SynthParameterId, snapEnvelopeSeconds(x * 5));
      props.onChange(`${props.source}.sustain` as SynthParameterId, snap01(1 - y));
    } else {
      props.onChange(`${props.source}.release` as SynthParameterId, snapEnvelopeSeconds(x * 5));
    }
  }

  function startHandleDrag(kind: "attack" | "decay-sustain" | "release", event: PointerEvent) {
    event.preventDefault();
    if (event.currentTarget instanceof HTMLElement) {
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic fixture events do not always create an active pointer capture.
      }
    }
    setDraggedHandle(kind);
    updateHandle(kind, event);
  }

  function moveHandleDrag(kind: "attack" | "decay-sustain" | "release", event: PointerEvent) {
    if (draggedHandle() !== kind) return;
    updateHandle(kind, event);
  }

  function stopHandleDrag(kind: "attack" | "decay-sustain" | "release", event: PointerEvent) {
    if (draggedHandle() !== kind) return;
    updateHandle(kind, event);
    setDraggedHandle(null);
  }

  function cycleCurve(segment: "attack" | "decay" | "release") {
    const id = `${props.source}.${segment}Curve` as SynthParameterId;
    props.onSetCurve(id, nextEnvelopeCurve(getEnvelopeCurveParam(draft(), id)));
  }

  return (
    <div class={styles.envelopeHandleEditor} aria-label={`${envelope().label} direct envelope editor`}>
      <svg
        ref={railRef}
        class={styles.envelopeHandleRail}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline points={envelopePolyline(envelope().points)} />
      </svg>
      <button
        type="button"
        class={styles.envelopeHandle}
        style={{ left: `${attackPoint().x}%`, top: `${attackPoint().y}%` }}
        data-aether-envelope-handle="attack"
        aria-label={`${envelope().label} attack ${formatSeconds(attack())}`}
        onPointerDown={(event) => startHandleDrag("attack", event)}
        onPointerMove={(event) => moveHandleDrag("attack", event)}
        onPointerUp={(event) => stopHandleDrag("attack", event)}
        onPointerCancel={() => setDraggedHandle(null)}
      />
      <button
        type="button"
        class={styles.envelopeHandle}
        style={{ left: `${decayPoint().x}%`, top: `${decayPoint().y}%` }}
        data-aether-envelope-handle="decay-sustain"
        aria-label={`${envelope().label} decay ${formatSeconds(decay())} sustain ${Math.round(sustain() * 100)}%`}
        onPointerDown={(event) => startHandleDrag("decay-sustain", event)}
        onPointerMove={(event) => moveHandleDrag("decay-sustain", event)}
        onPointerUp={(event) => stopHandleDrag("decay-sustain", event)}
        onPointerCancel={() => setDraggedHandle(null)}
      />
      <button
        type="button"
        class={styles.envelopeHandle}
        style={{ left: `${releasePoint().x}%`, top: `${releasePoint().y}%` }}
        data-aether-envelope-handle="release"
        aria-label={`${envelope().label} release ${formatSeconds(release())}`}
        onPointerDown={(event) => startHandleDrag("release", event)}
        onPointerMove={(event) => moveHandleDrag("release", event)}
        onPointerUp={(event) => stopHandleDrag("release", event)}
        onPointerCancel={() => setDraggedHandle(null)}
      />
      <EnvelopeCurveButton
        segment="attack"
        label={`${envelope().label} attack curve`}
        value={attackCurve()}
        point={attackCurvePoint()}
        onClick={() => cycleCurve("attack")}
      />
      <EnvelopeCurveButton
        segment="decay"
        label={`${envelope().label} decay curve`}
        value={decayCurve()}
        point={decayCurvePoint()}
        onClick={() => cycleCurve("decay")}
      />
      <EnvelopeCurveButton
        segment="release"
        label={`${envelope().label} release curve`}
        value={releaseCurve()}
        point={releaseCurvePoint()}
        onClick={() => cycleCurve("release")}
      />
    </div>
  );
}

function EnvelopeCurveButton(props: {
  segment: "attack" | "decay" | "release";
  label: string;
  value: EnvelopeCurve;
  point: { x: number; y: number };
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class={styles.envelopeCurveButton}
      style={{ left: `${props.point.x}%`, top: `${props.point.y}%` }}
      data-aether-envelope-curve={props.segment}
      aria-label={`${props.label}: ${props.value}`}
      onClick={props.onClick}
    >
      {envelopeCurveShortLabel(props.value)}
    </button>
  );
}

function ShapeButtonSet(props: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string, string] | readonly [string, string, string, string]>;
  onChange: (value: string) => void;
}) {
  const selected = createMemo(() => props.options.find((option) => option[0] === props.value));

  return (
    <div class={styles.shapeControl}>
      <div class={styles.shapeButtons} role="radiogroup" aria-label={props.label}>
        <For each={props.options}>
          {(option) => {
            const [optionValue, shortLabel, fullLabelOrIcon, maybeIcon] = option;
            const fullLabel = maybeIcon ? fullLabelOrIcon : shortLabel;
            const icon = maybeIcon ?? fullLabelOrIcon;
            const active = () => props.value === optionValue;
            return (
              <HoverInfo content={fullLabel}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active()}
                  aria-label={fullLabel}
                  class={`${styles.shapeButton} ${active() ? styles.shapeButtonActive : ""}`}
                  onClick={() => props.onChange(optionValue)}
                >
                  <Icon name={icon} size={14} decorative />
                </button>
              </HoverInfo>
            );
          }}
        </For>
      </div>
      <span class={styles.shapeSelectedLabel}>{selected()?.[1] ?? props.value}</span>
      <span class={styles.shapeControlLabel}>{props.label}</span>
    </div>
  );
}

function makeAnalyzerBands(frequency: Uint8Array): number[] {
  const bands: number[] = [];
  const binCount = frequency.length;
  for (let band = 0; band < ANALYZER_BANDS; band += 1) {
    const start = Math.floor((band / ANALYZER_BANDS) ** 1.7 * binCount);
    const end = Math.max(start + 1, Math.floor(((band + 1) / ANALYZER_BANDS) ** 1.7 * binCount));
    let sum = 0;
    let count = 0;
    for (let i = start; i < Math.min(end, binCount); i += 1) {
      sum += frequency[i] / 255;
      count += 1;
    }
    bands.push(count > 0 ? sum / count : 0);
  }
  return bands;
}

function createEmptyAnalyzerSnapshot(): AnalyzerSnapshot {
  return {
    sequence: 0,
    rms: 0,
    peak: 0,
    bands: Array.from({ length: ANALYZER_BANDS }, () => 0),
    updatedAt: 0,
  };
}

function summarizeBuffer(samples: Float32Array): { rms: number; peak: number } {
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return {
    rms: Math.sqrt(sumSquares / Math.max(1, samples.length)),
    peak,
  };
}

function mixStereoToMono(left: Float32Array, right: Float32Array): Float32Array {
  const length = Math.min(left.length, right.length);
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i += 1) mono[i] = (left[i] + right[i]) * 0.5;
  return mono;
}

function makeFftBands(samples: Float32Array): number[] {
  const fftSize = 2048;
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  const sourceLength = Math.min(samples.length, fftSize);
  for (let i = 0; i < sourceLength; i += 1) {
    const windowValue = 0.5 - 0.5 * Math.cos((Math.PI * 2 * i) / Math.max(1, fftSize - 1));
    real[i] = samples[i] * windowValue;
  }

  fftRadix2(real, imag);

  const magnitudes = new Float32Array(fftSize / 2);
  let maxMagnitude = 0;
  for (let i = 1; i < magnitudes.length; i += 1) {
    const magnitude = Math.hypot(real[i], imag[i]);
    magnitudes[i] = magnitude;
    maxMagnitude = Math.max(maxMagnitude, magnitude);
  }

  if (maxMagnitude <= 0) return Array.from({ length: ANALYZER_BANDS }, () => 0);

  const bands: number[] = [];
  for (let band = 0; band < ANALYZER_BANDS; band += 1) {
    const start = Math.max(1, Math.floor((band / ANALYZER_BANDS) ** 1.7 * magnitudes.length));
    const end = Math.max(start + 1, Math.floor(((band + 1) / ANALYZER_BANDS) ** 1.7 * magnitudes.length));
    let sum = 0;
    let count = 0;
    for (let bin = start; bin < Math.min(end, magnitudes.length); bin += 1) {
      sum += magnitudes[bin] / maxMagnitude;
      count += 1;
    }
    bands.push(count > 0 ? Math.min(1, sum / count) : 0);
  }
  return bands;
}

function fftRadix2(real: Float32Array, imag: Float32Array) {
  const n = real.length;
  let j = 0;
  for (let i = 1; i < n; i += 1) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const realI = real[i];
      const imagI = imag[i];
      real[i] = real[j];
      imag[i] = imag[j];
      real[j] = realI;
      imag[j] = imagI;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wLenReal = Math.cos(angle);
    const wLenImag = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wReal = 1;
      let wImag = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k += 1) {
        const even = i + k;
        const odd = even + half;
        const oddReal = real[odd] * wReal - imag[odd] * wImag;
        const oddImag = real[odd] * wImag + imag[odd] * wReal;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;

        const nextWReal = wReal * wLenReal - wImag * wLenImag;
        wImag = wReal * wLenImag + wImag * wLenReal;
        wReal = nextWReal;
      }
    }
  }
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}`;
}

function formatSeconds(value: number): string {
  return value < 1 ? `${Math.round(value * 1000)}ms` : `${value.toFixed(2)}s`;
}

function envelopePolyline(points: Array<{ x: number; y: number }>): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function snapEnvelopeSeconds(value: number): number {
  return Math.round(clamp(value, 0, 30) * 1000) / 1000;
}

function snap01(value: number): number {
  return Math.round(clamp(value, 0, 1) * 100) / 100;
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function nextEnvelopeCurve(value: EnvelopeCurve): EnvelopeCurve {
  const index = ENVELOPE_CURVE_VALUES.indexOf(value);
  return ENVELOPE_CURVE_VALUES[(index + 1) % ENVELOPE_CURVE_VALUES.length] ?? "linear";
}

function envelopeCurveShortLabel(value: EnvelopeCurve): string {
  if (value === "s-curve") return "S";
  if (value === "linear") return "Lin";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

const ENVELOPE_CURVE_VALUES: EnvelopeCurve[] = ["linear", "exp", "log", "s-curve"];

const MODULATABLE_PARAMETER_IDS = new Set<string>([
  "filter.cutoff",
  "filter.resonance",
  "filter.drive",
  "amp.level",
  "amp.pan",
]);

function modulationPropsForTarget(draft: SynthDraftPatch, id: SynthParameterId) {
  if (!MODULATABLE_PARAMETER_IDS.has(id)) return {};
  const summary = modulationSummaryForTarget(draft, id as ModulationTargetId);
  if (summary.count === 0) return {};
  return {
    modulationAmount: summary.amount,
    modulationLabel: summary.label,
  };
}

function modulationPropsForSource(draft: SynthDraftPatch, id: SynthParameterId) {
  if (!id.startsWith("macro.")) return {};
  const summary = modulationSummaryForSource(draft, id as MacroId);
  if (summary.count === 0) return {};
  return {
    modulationAmount: summary.amount,
    modulationLabel: summary.label,
  };
}
