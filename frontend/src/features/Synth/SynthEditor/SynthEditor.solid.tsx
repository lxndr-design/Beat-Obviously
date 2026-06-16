/** @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import { previewFrequency, renderedInstrumentBuffer } from "../../../audio/synthPreview";
import { createSynthWorkletPreviewNode } from "../../../audio/synthWorkletPreview";
import { Button, HoverInfo, Icon, Knob, TextInput } from "../../../solid-ui";
import { createStoreSelector } from "../../../solid-utils/store";
import {
  FACTORY_SYNTH_PRESETS,
  getNumberParam,
  modulationSummaryForSource,
  modulationSummaryForTarget,
  synthDraftFromInstrument,
  synthDraftToInstrumentPatch,
  synthDraftToPreviewInstrument,
  useSynthStore,
  type ModulationSourceId,
  type ModulationTargetId,
  type SynthDraftPatch,
  type SynthParameterId,
} from "../../../state/synthStore";
import { deleteSynthPreset, listSynthPresets, saveSynthPreset, type SynthPresetRecord } from "../../../persistence/dexie";
import { ANALYZER_BAND_COUNT, useAnalyzerStore, type AnalyzerSnapshot } from "../../../state/analyzerStore";
import { useInstrumentStore, useUiStore } from "../../../state/store";
import { INSTRUMENT_ICON_OPTIONS, instrumentIconLabel } from "../../../state/instrumentIcons";
import { AnalyzerPanelSolid } from "../AnalyzerPanel/AnalyzerPanel.solid";
import { ModulationMatrixSolid } from "../ModulationMatrix/ModulationMatrix.solid";
import { OscillatorPanelSolid } from "../OscillatorPanel/OscillatorPanel.solid";
import styles from "./SynthEditor.module.css";

const MACRO_IDS = ["macro.1", "macro.2", "macro.3", "macro.4"] as const;
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
const LFO_SHAPES = [
  ["sine", "Sine", "ph:wave-sine"],
  ["triangle", "Triangle", "ph:wave-triangle"],
  ["saw", "Saw", "ph:wave-sawtooth"],
  ["square", "Square", "ph:wave-square"],
] as const;

interface AuditionHandle {
  node: AudioNode;
  stop: (when?: number) => void;
}

export interface SynthEditorProps {
  instrumentId?: string;
}

export function SynthEditorSolid(props: SynthEditorProps) {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const boundInstrumentId = createStoreSelector(useSynthStore, (state) => state.boundInstrumentId);
  const instruments = createStoreSelector(useInstrumentStore, (state) => state.instruments);
  const bindInstrument = useSynthStore.getState().bindInstrument;
  const setDraft = useSynthStore.getState().setDraft;
  const setName = useSynthStore.getState().setName;
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
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

  const [presets, setPresets] = createSignal<SynthPresetRecord[]>([]);
  const [selectedPresetId, setSelectedPresetId] = createSignal("");
  const [iconOpen, setIconOpen] = createSignal(false);
  const [auditioning, setAuditioning] = createSignal(false);
  const [auditionSnapshot, setAuditionSnapshot] = createSignal<AnalyzerSnapshot>(createEmptyAnalyzerSnapshot());

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
    stopAudition();
    closeAudioContext();
  });

  async function refreshPresets() {
    setPresets(await listSynthPresets());
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
    }).catch(() => null);
    if (worklet) {
      handle = {
        node: worklet.node,
        stop: () => worklet.stop(),
      };
    } else {
      const buffer = renderedInstrumentBuffer(ctx, instrument, AUDITION_SECONDS, frequency);
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
      const now = Date.now();
      const presetId = `instrument:${id}`;
      const existingPreset = presets().find((preset) => preset.id === presetId);
      await saveSynthPreset({
        id: presetId,
        name: patch.name ?? draft().name,
        patch: patch.synthPatch,
        tags: patch.synthPatch.metadata?.tags ?? [],
        createdAt: existingPreset?.createdAt ?? now,
        updatedAt: now,
      });
      setSelectedPresetId(`${USER_PRESET_PREFIX}${presetId}`);
      await refreshPresets();
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

  async function onDeletePreset() {
    if (!selectedPresetId().startsWith(USER_PRESET_PREFIX)) return;
    await deleteSynthPreset(selectedPresetId().slice(USER_PRESET_PREFIX.length));
    setSelectedPresetId("");
    await refreshPresets();
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

  return (
    <section class={`ds-editor-shell ds-fill ${styles.shell}`} aria-label="Synth editor">
      <div class={`ds-editor-body ds-scroll ${styles.body}`}>
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
              <div class={styles.presetRow}>
                <label class={styles.presetSelect}>
                  <span class="ds-field-label">Preset</span>
                  <select
                    class="ds-select"
                    value={selectedPresetId()}
                    onChange={(event) => onLoadPreset(event.currentTarget.value)}
                  >
                    <option value="">None</option>
                    <optgroup label="Factory">
                      <For each={FACTORY_SYNTH_PRESETS}>
                        {(preset) => (
                          <option value={`${FACTORY_PRESET_PREFIX}${preset.id}`}>
                            {preset.name}
                          </option>
                        )}
                      </For>
                    </optgroup>
                    <Show when={presets().length > 0}>
                      <optgroup label="User Presets">
                        <For each={presets()}>
                          {(preset) => (
                            <option value={`${USER_PRESET_PREFIX}${preset.id}`}>
                              {preset.name}
                            </option>
                          )}
                        </For>
                      </optgroup>
                    </Show>
                    <Show when={userInstrumentPresets().length > 0}>
                      <optgroup label="User Instruments">
                        <For each={userInstrumentPresets()}>
                          {(instrument) => (
                            <option value={`${USER_INSTRUMENT_PRESET_PREFIX}${instrument.id}`}>
                              {instrument.name}
                            </option>
                          )}
                        </For>
                      </optgroup>
                    </Show>
                  </select>
                </label>
                <Show when={selectedPresetId().startsWith(USER_PRESET_PREFIX)}>
                  <Button size="sm" variant="ghost" onClick={onDeletePreset}>
                    Delete
                  </Button>
                </Show>
              </div>
            </div>
          </section>
          <AnalyzerPanelSolid
            state={() => ({
              scope: "synth",
              snapshotOverride: auditionSnapshot(),
              playing: auditioning(),
              onTogglePlayback: () => void onAudition(),
            })}
          />
        </div>

        <OscillatorPanelSolid />

        <div class={styles.sourceGrid}>
          <LfoPanel />
          <section class={`ds-panel ${styles.macroPanel}`} aria-label="Macros">
            <header class="ds-panel-header">
              <div class="ds-panel-title">Macro Controls</div>
            </header>
            <div class={`ds-panel-body ${styles.macros}`}>
              <For each={MACRO_IDS}>
                {(id, index) => (
                  <Knob
                    size="sm"
                    label={`Macro ${index() + 1}`}
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
                )}
              </For>
            </div>
          </section>
        </div>

        <div class={styles.bottomGrid}>
          <AmpFilterPanel />
          <ModulationMatrixSolid />
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

function LfoPanel() {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const setParameter = useSynthStore.getState().setParameter;
  const enabled = createMemo(() => draft().parameters["lfo.1.enabled"] === true);

  return (
    <section class={`ds-panel ${styles.lfoPanel} ${enabled() ? "" : styles.disabledPanel}`} aria-label="LFO">
      <header class="ds-panel-header">
        <div class="ds-panel-title">LFO</div>
        <div class="ds-panel-actions">
          <Button
            iconOnly
            size="xs"
            selected={enabled()}
            aria-label={`${enabled() ? "Disable" : "Enable"} LFO`}
            onClick={() => setBooleanParameter("lfo.1.enabled", !enabled())}
          >
            <Icon name={enabled() ? "ph:power-fill" : "ph:power"} size={12} decorative />
          </Button>
        </div>
      </header>
      <div class={`ds-panel-body ${styles.lfoControls}`}>
        <ShapeButtonSet
          label="LFO Shape"
          value={String(draft().parameters["lfo.1.shape"])}
          options={LFO_SHAPES}
          onChange={(value) => setParameter("lfo.1.shape", value)}
        />
        <Knob
          size="sm"
          label="Rate"
          value={getNumberParam(draft(), "lfo.1.rate")}
          min={0.05}
          max={50}
          step={0.01}
          unit="Hz"
          defaultValue={1}
          formatValue={(value) => `${value < 10 ? value.toFixed(2) : value.toFixed(1)}`}
          pickSourceId="lfo.1"
          onChange={(value) => setNumericParameter("lfo.1.rate", value)}
        />
      </div>
    </section>
  );
}

function AmpFilterPanel() {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const setParameter = useSynthStore.getState().setParameter;
  const filterType = createMemo(() => String(draft().parameters["filter.type"]));
  const filterEnabled = createMemo(() => draft().parameters["filter.enabled"] === true);

  return (
    <section class={`ds-panel ${filterEnabled() ? "" : styles.disabledPanel}`} aria-label="Amp and filter">
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
          ["filter.drive", "Drive", 0, false],
          ["amp.level", "Level", 0.8, false],
          ["amp.pan", "Pan", 0, true],
          ["env.1.attack", "Attack", 0.005, false],
          ["env.1.decay", "Decay", 0.15, false],
          ["env.1.sustain", "Sustain", 0.8, false],
          ["env.1.release", "Release", 0.25, false],
        ] as Array<[SynthParameterId, string, number, boolean]>}>
          {([id, label, defaultValue, bipolar]) => (
            <Knob
              size="sm"
              label={label}
              value={getNumberParam(draft(), id)}
              min={bipolar ? -1 : 0}
              max={id.includes("env.1") && id !== "env.1.sustain" ? 30 : 1}
              step={id.includes("env.1") && id !== "env.1.sustain" ? 0.001 : 0.01}
              defaultValue={defaultValue}
              bipolar={bipolar}
              {...modulationPropsForTarget(draft(), id)}
              pickTargetId={MODULATABLE_PARAMETER_IDS.has(id) ? id : undefined}
              formatValue={id.includes("env.1") && id !== "env.1.sustain" ? formatSeconds : formatPercent}
              onChange={(value) => setNumericParameter(id, value)}
            />
          )}
        </For>
      </div>
    </section>
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
  const summary = modulationSummaryForSource(draft, id as ModulationSourceId);
  if (summary.count === 0) return {};
  return {
    modulationAmount: summary.amount,
    modulationLabel: summary.label,
  };
}

export interface MountedSynthEditorSolid {
  update: (next: SynthEditorProps) => void;
  dispose: () => void;
}

export function mountSynthEditorSolid(host: HTMLElement, initialProps: SynthEditorProps): MountedSynthEditorSolid {
  const [state, setState] = createSignal(initialProps, { equals: false });
  const dispose = render(() => <SynthEditorSolid {...state()} />, host);
  return {
    update: setState,
    dispose,
  };
}
