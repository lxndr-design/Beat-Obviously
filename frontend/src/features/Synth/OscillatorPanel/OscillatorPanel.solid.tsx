import { createMemo, createSignal, For, Show } from "solid-js";
import { renderAetherOutputPreviewSamples } from "../../../audio/synthPreview";
import { AETHER_MAX_UNISON_VOICES } from "../../../audio/aetherLimits";
import { Button, FloatingSelect, HoverInfo, Icon, Knob, NumberInput, TextInput } from "../../../solid-ui";
import { createStoreSelector } from "../../../solid-utils/store";
import type { CustomWavetableFrame, WavemapDefinition, WavetableWarpMode } from "../../../state/types";
import {
  CUSTOM_WAVETABLE_FRAME_LABELS,
  CUSTOM_WAVETABLE_PARTIAL_COUNT,
  DEFAULT_CUSTOM_WAVETABLE_ID,
  FACTORY_WAVETABLES,
  constrainWavemapFramePosition,
  createDefaultCustomWavetable,
  deriveWavemapFrameFromDrawnWaveform,
  drawHarmonicPartialLine,
  evolveWavemapFrames,
  getBooleanParam,
  getNumberParam,
  getStringParam,
  modulationSummaryForTarget,
  normalizeWavemapFrames,
  summarizeWavemapAnalysis,
  synthDraftToPreviewInstrument,
  useSynthStore,
  type WavemapAudioSelectionMode,
  type ModulationTargetId,
  type OscillatorKey,
  type OscillatorTuningParameterId,
  type SynthDraftPatch,
  type SynthParameterId,
  type WavetableId,
} from "../../../state/synthStore";
import styles from "./OscillatorPanel.module.css";

type OscParamSuffix = "position" | "warp" | "level" | "pan" | "octave" | "semitone" | "fine" | "phase" | "randomPhase" | "fxSend1" | "fxSend2";

interface OscParamDefinition {
  suffix: OscParamSuffix;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  bipolar?: boolean;
}

const OSC_PARAMS: OscParamDefinition[] = [
  { suffix: "position", label: "Position", min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { suffix: "warp", label: "Warp", min: 0, max: 1, step: 0.01, defaultValue: 0.2 },
  { suffix: "level", label: "Level", min: 0, max: 1, step: 0.01, defaultValue: 0.8 },
  { suffix: "pan", label: "Pan", min: -1, max: 1, step: 0.01, defaultValue: 0, bipolar: true },
  { suffix: "octave", label: "Oct", min: -4, max: 4, step: 1, defaultValue: 0, bipolar: true },
  { suffix: "semitone", label: "Semi", min: -12, max: 12, step: 1, defaultValue: 0, bipolar: true },
  { suffix: "fine", label: "Fine", min: -100, max: 100, step: 1, defaultValue: 0, bipolar: true },
  { suffix: "phase", label: "Phase", min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { suffix: "randomPhase", label: "Random", min: 0, max: 1, step: 0.01, defaultValue: 0.25 },
  { suffix: "fxSend1", label: "FX 1", min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { suffix: "fxSend2", label: "FX 2", min: 0, max: 1, step: 0.01, defaultValue: 0 },
];

const OSC_PARAM_BY_SUFFIX = Object.fromEntries(OSC_PARAMS.map((param) => [param.suffix, param])) as Record<OscParamSuffix, OscParamDefinition>;

const OSC_PARAM_GROUPS: Array<{ label: string; suffixes: OscParamSuffix[] }> = [
  { label: "Warp Mode", suffixes: ["position", "warp"] },
  { label: "Pitch", suffixes: ["octave", "semitone", "fine"] },
  { label: "Phase", suffixes: ["phase", "randomPhase"] },
  { label: "Mix", suffixes: ["pan", "level"] },
  { label: "FX Sends", suffixes: ["fxSend1", "fxSend2"] },
];

const WAVETABLE_ICONS: Record<WavetableId, string> = {
  "basic.sine": "ph:wave-sine",
  "basic.saw": "ph:wave-sawtooth",
  "basic.square": "ph:wave-square",
  "basic.triangle": "ph:wave-triangle",
  "basic.pulse": "ph:waveform",
  [DEFAULT_CUSTOM_WAVETABLE_ID]: "ph:sliders-horizontal",
};

const WARP_MODE_OPTIONS: Array<{ value: WavetableWarpMode; label: string; icon: string }> = [
  { value: "shape", label: "Shape", icon: "ph:waveform" },
  { value: "fold", label: "Fold", icon: "ph:intersect-three" },
  { value: "pinch", label: "Pinch", icon: "ph:arrows-in-line-horizontal" },
  { value: "mirror", label: "Mirror", icon: "ph:diamonds-four" },
];

const RESYNTHESIS_MODE_OPTIONS: Array<{ value: WavemapAudioSelectionMode; label: string }> = [
  { value: "full", label: "Full" },
  { value: "transient", label: "Transient" },
  { value: "sustain", label: "Sustain" },
  { value: "manual", label: "Manual" },
];

const TUNING_MODE_OPTIONS = [
  { value: "semitone", label: "Semitone" },
  { value: "harmonic", label: "Harmonic" },
  { value: "ratio", label: "Ratio" },
  { value: "step", label: "Equal division" },
];

const PHASE_MODE_OPTIONS = [
  { value: "retrigger", label: "Retrigger" },
  { value: "memory", label: "Memory" },
];

const OSCILLATOR_ROUTE_OPTIONS = [
  { value: "filter", label: "Filters" },
  { value: "filter1", label: "Filter 1" },
  { value: "filter2", label: "Filter 2" },
  { value: "direct", label: "Direct" },
  { value: "none", label: "None" },
];

type WavemapEditMode = "freehand" | "additive";
type WavemapAnalysisView = "compact" | "details";

export function OscillatorPanel() {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const addOscillator = useSynthStore.getState().addOscillator;
  const previewInstrument = createMemo(() => synthDraftToPreviewInstrument(draft()));

  return (
    <section class={`${styles.panel} ${styles.majorSection}`} aria-label="Oscillator">
      <div class={styles.majorSectionTitleRow}>
        <div class={styles.majorSectionTitle}>Oscillators</div>
        <Show when={draft().instrumentType !== "lumus-hybrid-synth"}>
          <Button size="xs" onClick={addOscillator} aria-label="Add oscillator">
            <Icon name="ph:plus" size={18} decorative /> Add Oscillator
          </Button>
        </Show>
      </div>
      <div class={styles.body}>
        <For each={draft().metadata.oscillators}>
          {(oscillator) => <OscillatorRow oscillator={oscillator.id} name={oscillator.name} previewInstrument={previewInstrument()} />}
        </For>
        <div class={styles.row} aria-label="Voice stack row">
          <div class="ds-section-header">
            <div class="ds-section-title">Voice Stack</div>
          </div>
          <div class={`${styles.rowMain} ${styles.voiceStackMain}`}>
            <div class={`${styles.settingsPane} ${styles.unisonSettingsPane}`}>
              <div class={styles.unisonBody}>
                <div class={styles.voiceStackControls}>
                  <div class={styles.voiceStackToggleGroup}>
                    <Button
                      size="xs"
                      className={styles.voiceStackToggleButton}
                      selected={getBooleanParam(draft(), "mono.enabled")}
                      aria-pressed={getBooleanParam(draft(), "mono.enabled")}
                      onClick={() => setBooleanParameter("mono.enabled", !getBooleanParam(draft(), "mono.enabled"))}
                    >
                      Mono
                    </Button>
                    <Button
                      size="xs"
                      className={styles.voiceStackToggleButton}
                      selected={getBooleanParam(draft(), "legato.enabled")}
                      aria-pressed={getBooleanParam(draft(), "legato.enabled")}
                      onClick={() => setBooleanParameter("legato.enabled", !getBooleanParam(draft(), "legato.enabled"))}
                    >
                      Legato
                    </Button>
                  </div>
                  <div class={styles.voiceStackKnobGroup}>
                  <For each={[
                    ["unison.voices", "Voices", 1, 16, 1, 1],
                    ["unison.detune", "Detune", 0, 1, 0.01, 0.12],
                    ["unison.blend", "Blend", 0, 1, 0.01, 0.75],
                  ] as Array<[SynthParameterId, string, number, number, number, number]>}>
                    {([id, label, min, max, step, defaultValue]) => (
                      <Knob
                        size="sm"
                        className={styles.voiceStackKnob}
                        label={label}
                        value={getNumberParam(draft(), id)}
                        min={min}
                        max={max}
                        step={step}
                        defaultValue={defaultValue}
                        {...modulationPropsForTarget(draft(), id)}
                        pickTargetId={MODULATABLE_TARGETS.has(id) ? id : undefined}
                        formatValue={id === "unison.voices" || id === "maxVoices" ? (value) => Math.round(value).toString() : formatPercent}
                        parseValue={id === "unison.voices" || id === "maxVoices" ? undefined : parsePercent}
                        onChange={(value) => setNumericParameter(id, value)}
                      />
                    )}
                  </For>
                  </div>
                  <div class={styles.voiceStackKnobGroup}>
                  <For each={[
                    ["unison.spread", "Spread", 0, 1, 0.01, 0.5],
                    ["maxVoices", "Max", 1, 32, 1, 16],
                  ] as Array<[SynthParameterId, string, number, number, number, number]>}>
                    {([id, label, min, max, step, defaultValue]) => (
                      <Knob
                        size="sm"
                        className={styles.voiceStackKnob}
                        label={label}
                        value={getNumberParam(draft(), id)}
                        min={min}
                        max={max}
                        step={step}
                        defaultValue={defaultValue}
                        {...modulationPropsForTarget(draft(), id)}
                        pickTargetId={MODULATABLE_TARGETS.has(id) ? id : undefined}
                        formatValue={id === "unison.voices" || id === "maxVoices" ? (value) => Math.round(value).toString() : formatPercent}
                        parseValue={id === "unison.voices" || id === "maxVoices" ? undefined : parsePercent}
                        onChange={(value) => setNumericParameter(id, value)}
                      />
                    )}
                  </For>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function OscillatorRow(props: {
  oscillator: OscillatorKey;
  name: string;
  previewInstrument: ReturnType<typeof synthDraftToPreviewInstrument>;
}) {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setParameter = useSynthStore.getState().setParameter;
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const setDraft = useSynthStore.getState().setDraft;
  const setWavemap = useSynthStore.getState().setWavemap;
  const updateCustomWavetableFrame = useSynthStore.getState().updateCustomWavetableFrame;
  const updateWavemapMetadata = useSynthStore.getState().updateWavemapMetadata;
  const removeOscillator = useSynthStore.getState().removeOscillator;
  const renameOscillator = useSynthStore.getState().renameOscillator;
  const [resynthesisMode, setResynthesisMode] = createSignal<WavemapAudioSelectionMode>("full");
  const [analysisView, setAnalysisView] = createSignal<WavemapAnalysisView>("details");
  const [customEditorOpen, setCustomEditorOpen] = createSignal(true);
  const editMode = () => "additive" as WavemapEditMode;
  const lumusSlotIndex = createMemo(() => draft().instrumentType === "lumus-hybrid-synth"
    ? ({ a: 0, b: 1, c: 2 } as const)[props.oscillator as "a" | "b" | "c"] ?? -1
    : -1);
  const lumusSlot = createMemo(() => lumusSlotIndex() >= 0);
  const sourceMode = createMemo(() => {
    const index = lumusSlotIndex();
    return index >= 0
      ? draft().metadata.lumusSourceRack?.slots[index as 0 | 1 | 2]?.mode ?? "wavetable"
      : "wavetable";
  });
  const sampleMode = createMemo(() => sourceMode() === "sample");
  const granularMode = createMemo(() => sourceMode() === "granular");
  const samplePrefix = createMemo(() => `lumus.source.${props.oscillator}.sample`);
  const sampleAvailable = createMemo(() => Boolean(
    getStringParam(draft(), `${samplePrefix()}.audioFileId` as SynthParameterId)
      || draft().metadata.lumusSampleSlots?.[props.oscillator as "a" | "b" | "c"]?.managedSfz,
  ));
  const granularPrefix = createMemo(() => `lumus.source.${props.oscillator}.granular`);
  const granularAvailable = createMemo(() => Boolean(
    getStringParam(draft(), `${granularPrefix()}.builtinSource` as SynthParameterId) === "benchmark"
      || draft().metadata.lumusGranularSlots?.[props.oscillator as "a" | "b" | "c"]?.managedAsset,
  ));
  const sourceAvailable = createMemo(() => sampleMode() ? sampleAvailable() : granularMode() ? granularAvailable() : true);
  const enabledId = createMemo(() => sampleMode()
    ? `${samplePrefix()}.enabled` as SynthParameterId
    : granularMode()
      ? `${granularPrefix()}.enabled` as SynthParameterId
      : oscParam(props.oscillator, "enabled"));
  const enabled = createMemo(() => getBooleanParam(draft(), enabledId()));
  const wavetableId = createMemo(() => oscParam(props.oscillator, "wavetable"));
  const warpModeId = createMemo(() => oscParam(props.oscillator, "warpMode"));
  const selectedWavetable = createMemo(() => getStringParam(draft(), wavetableId()) as WavetableId);
  const selectedWarpMode = createMemo(() => {
    const mode = getStringParam(draft(), warpModeId());
    return mode === "fold" || mode === "pinch" || mode === "mirror" ? mode : "shape";
  });
  const customTableId = createMemo(() => selectedWavetable().startsWith("user.") ? selectedWavetable() : DEFAULT_CUSTOM_WAVETABLE_ID);
  const customTable = createMemo(() => draft().metadata.wavemaps?.[customTableId()] ?? draft().metadata.customWavetables?.[customTableId()] ?? createDefaultCustomWavetable(customTableId()));
  const label = createMemo(() => props.name);
  const waveform = createMemo(() => renderAetherOutputPreviewSamples(props.previewInstrument, 160, props.oscillator));

  function replaceCurrentWavemap(next: WavemapDefinition) {
    setWavemap(next);
    setParameter(wavetableId(), next.id as WavetableId);
  }

  function setSourceMode(mode: "wavetable" | "sample" | "granular") {
    if (!lumusSlot()) return;
    const current = draft();
    const slots = current.metadata.lumusSourceRack?.slots.map((slot, index) =>
      index === lumusSlotIndex() ? { ...slot, mode } : slot,
    ) ?? [];
    setDraft({
      ...current,
      parameters: {
        ...current.parameters,
        ...(mode === "sample"
          ? { [`${samplePrefix()}.enabled`]: sampleAvailable() }
          : { [`${samplePrefix()}.enabled`]: false }),
        ...(mode === "granular"
          ? { [`${granularPrefix()}.enabled`]: granularAvailable() }
          : { [`${granularPrefix()}.enabled`]: false }),
      },
      metadata: {
        ...current.metadata,
        lumusSourceRack: {
          schemaVersion: 2,
          slots: slots as [{ id: "a"; mode: "wavetable" | "sample" | "granular" }, { id: "b"; mode: "wavetable" | "sample" | "granular" }, { id: "c"; mode: "wavetable" | "sample" | "granular" }],
        },
      },
    });
  }

  return (
    <div class={`${styles.row} ${enabled() ? "" : styles.disabledRow}`} aria-label={`${label()} row`}>
      <div class={`ds-section-header ${styles.oscillatorHeader}`}>
        <Button
          iconOnly
          size="xs"
          className={styles.oscillatorPowerButton}
          selected={enabled()}
          disabled={!sourceAvailable()}
          aria-label={`${enabled() ? "Disable" : "Enable"} ${label()}`}
          onClick={() => setBooleanParameter(enabledId(), !enabled())}
        >
          <Icon name={enabled() ? "ph:power-fill" : "ph:power"} size={18} decorative />
        </Button>
        <TextInput
          layout="bare"
          className={styles.oscillatorName}
          aria-label={`Rename ${label()}`}
          value={props.name}
          onChange={(event) => renameOscillator(props.oscillator, event.currentTarget.value)}
        />
        <Show when={lumusSlot()}>
          <FloatingSelect
            layout="inline"
            label="Source"
            ariaLabel={`${label()} source mode`}
            value={sourceMode()}
            options={[{ value: "wavetable", label: "Wavetable" }, { value: "sample", label: "Sample" }, { value: "granular", label: "Granular" }]}
            onChange={(value) => setSourceMode(value as "wavetable" | "sample" | "granular")}
          />
        </Show>
        <Show when={!sampleMode() && !granularMode()}>
          <div class={styles.headerWavetable}>
            <WavetableShapeButtons
              compact
              value={selectedWavetable()}
              onChange={(value) => setParameter(wavetableId(), value)}
            />
            <span>{selectedWavetableLabel(selectedWavetable())}</span>
          </div>
        </Show>
        <Show when={draft().instrumentType !== "lumus-hybrid-synth" && props.oscillator !== "a"}>
          <Button iconOnly size="xs" className={styles.removeOscillatorButton} aria-label={`Remove ${label()}`} onClick={() => removeOscillator(props.oscillator)}>
            <Icon name="ph:trash" size={18} decorative />
          </Button>
        </Show>
      </div>
      <Show when={!sampleMode() && !granularMode()} fallback={<div class={styles.rowMain}><span class={styles.tuningModeHint}>{granularMode() ? "Granular controls are available in the source granular section below." : "Sample controls are available in the source sample section below."}</span></div>}>
      <div class={styles.rowMain}>
          <WaveformPreview label={`${label()} local oscillator preview`} samples={waveform()} disabled={!enabled()} />
          <div class={styles.settingsPane}>
            <div class={styles.rowBody}>
              <div class={styles.oscillatorControlGroups}>
                <For each={OSC_PARAM_GROUPS}>
                  {(group) => (
                    <OscillatorParamGroup
                      label={group.label}
                      suffixes={group.suffixes}
                      oscillator={props.oscillator}
                      draft={draft()}
                      warpModeValue={group.label === "Warp Mode" ? selectedWarpMode() : undefined}
                      onWarpModeChange={group.label === "Warp Mode" ? (value) => setParameter(warpModeId(), value) : undefined}
                      onChange={setNumericParameter}
                    />
                  )}
                </For>
              </div>
              <AdvancedOscillatorControls
                oscillator={props.oscillator}
                draft={draft()}
                onNumericChange={setNumericParameter}
                onStringChange={setParameter}
              />
            </div>
          </div>
          <Show when={selectedWavetable().startsWith("user.")}>
            <div class={styles.customEditor} aria-label={`${label()} wavemap frames`}>
              <div class={`ds-section-header ${styles.customEditorHeader}`}>
                <div class="ds-section-title">{label()} - Custom Waveform Settings</div>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-expanded={customEditorOpen()}
                  onClick={() => setCustomEditorOpen((open) => !open)}
                >
                  {customEditorOpen() ? "Hide Wave Settings" : "Show Wave Settings"}
                </Button>
              </div>
              <Show when={customEditorOpen()}>
                <div class={styles.wavemapToolbar}>
                  <div class={styles.resynthesisModes} role="radiogroup" aria-label="Audio resynthesis window">
                    <For each={RESYNTHESIS_MODE_OPTIONS}>
                      {(option) => (
                        <Button
                          size="xs"
                          selected={resynthesisMode() === option.value}
                          aria-label={`${option.label} audio resynthesis window`}
                          onClick={() => setResynthesisMode(option.value)}
                        >
                          {option.label}
                        </Button>
                      )}
                    </For>
                  </div>
                  <div class={styles.interpolationModes} role="radiogroup" aria-label="Wavemap interpolation">
                    <Button
                      size="xs"
                      selected={customTable().interpolation === "linear"}
                      onClick={() => updateWavemapMetadata(customTable().id, { interpolation: "linear" })}
                    >
                      Linear
                    </Button>
                    <Button
                      size="xs"
                      selected={customTable().interpolation === "smooth"}
                      onClick={() => updateWavemapMetadata(customTable().id, { interpolation: "smooth" })}
                    >
                      Smooth
                    </Button>
                    <Knob
                      size="sm"
                      className={styles.toolbarMorphKnob}
                      label="Morph"
                      value={customTable().morph}
                      min={0}
                      max={1}
                      step={0.01}
                      defaultValue={0}
                      formatValue={formatPercent}
                      parseValue={parsePercent}
                      onChange={(morph) => updateWavemapMetadata(customTable().id, { morph })}
                    />
                  </div>
                  <div class={styles.wavemapActionGroup}>
                    <Button
                      size="xs"
                      onClick={() => replaceCurrentWavemap(normalizeWavemapFrames(customTable()))}
                    >
                      Normalize Audio
                    </Button>
                    <Button
                      size="xs"
                      onClick={() => replaceCurrentWavemap(evolveWavemapFrames(customTable()))}
                    >
                      Evolve
                    </Button>
                  </div>
                  <Button
                    size="xs"
                    className={styles.analysisToggleButton}
                    selected={analysisView() === "details"}
                    aria-label={`${analysisView() === "details" ? "Hide" : "Show"} wavemap analysis`}
                    onClick={() => setAnalysisView(analysisView() === "details" ? "compact" : "details")}
                  >
                    {analysisView() === "details" ? "Hide Analysis" : "Show Analysis"}
                  </Button>
                </div>
                <Show when={analysisView() === "details"}>
                  <WavemapAnalysisDetails table={customTable()} />
                </Show>
                <div class={styles.customFrames}>
                  <For each={customTable().frames}>
                    {(frame, index) => (
                      <CustomWavetableFrameCard
                        table={customTable()}
                        frame={frame}
                        index={index()}
                        editMode={editMode()}
                        onDrawSamples={(samples) =>
                          updateCustomWavetableFrame(customTable().id, index(), deriveWavemapFrameFromDrawnWaveform(frame, samples))
                        }
                        onUpdate={(patch) => updateCustomWavetableFrame(customTable().id, index(), patch)}
                      />
                    )}
                  </For>
                </div>
                <div class={styles.wavemapSourceRow}>
                  <span>{sourceLabel(customTable().source.kind)}: {customTable().source.label ?? "Custom wavemap"}</span>
                  <span>{sourceAnalysisLabel(customTable())}</span>
                </div>
              </Show>
            </div>
          </Show>
      </div>
      </Show>
    </div>
  );
}

function AdvancedOscillatorControls(props: {
  oscillator: OscillatorKey;
  draft: SynthDraftPatch;
  onNumericChange: (id: SynthParameterId, value: number) => void;
  onStringChange: (id: SynthParameterId, value: string) => void;
}) {
  const tuningModeId = `osc.${props.oscillator}.tuning.mode` as OscillatorTuningParameterId;
  const harmonicId = `osc.${props.oscillator}.tuning.harmonic` as OscillatorTuningParameterId;
  const numeratorId = `osc.${props.oscillator}.tuning.numerator` as OscillatorTuningParameterId;
  const denominatorId = `osc.${props.oscillator}.tuning.denominator` as OscillatorTuningParameterId;
  const stepId = `osc.${props.oscillator}.tuning.step` as OscillatorTuningParameterId;
  const divisionsId = `osc.${props.oscillator}.tuning.divisions` as OscillatorTuningParameterId;
  const phaseModeId = `osc.${props.oscillator}.phaseMode` as SynthParameterId;
  const routeId = `osc.${props.oscillator}.route` as SynthParameterId;
  const tuningMode = () => getStringParam(props.draft, tuningModeId);

  return (
    <div class={styles.advancedOscillatorControls} aria-label={`${props.oscillator.toUpperCase()} advanced tuning and phase`}>
      <FloatingSelect
        layout="inline"
        label="Tuning"
        ariaLabel={`${props.oscillator.toUpperCase()} tuning mode`}
        value={tuningMode()}
        options={TUNING_MODE_OPTIONS}
        onChange={(value) => props.onStringChange(tuningModeId, value)}
      />
      <div class={styles.tuningDetailControls}>
        <Show when={tuningMode() === "semitone"}>
          <span class={styles.tuningModeHint}>Octave, semitone, and fine controls remain active</span>
        </Show>
        <Show when={tuningMode() === "harmonic"}>
          <NumberInput
            layout="inline"
            label="Harmonic"
            ariaLabel={`${props.oscillator.toUpperCase()} harmonic number`}
            value={getNumberParam(props.draft, harmonicId)}
            min={1}
            max={64}
            step={1}
            onChange={(value) => props.onNumericChange(harmonicId, value)}
          />
        </Show>
        <Show when={tuningMode() === "ratio"}>
          <NumberInput
            layout="inline"
            label="Numerator"
            ariaLabel={`${props.oscillator.toUpperCase()} tuning ratio numerator`}
            value={getNumberParam(props.draft, numeratorId)}
            min={0.001}
            max={64}
            step={0.01}
            onChange={(value) => props.onNumericChange(numeratorId, value)}
          />
          <NumberInput
            layout="inline"
            label="Denominator"
            ariaLabel={`${props.oscillator.toUpperCase()} tuning ratio denominator`}
            value={getNumberParam(props.draft, denominatorId)}
            min={0.001}
            max={64}
            step={0.01}
            onChange={(value) => props.onNumericChange(denominatorId, value)}
          />
        </Show>
        <Show when={tuningMode() === "step"}>
          <NumberInput
            layout="inline"
            label="Step"
            ariaLabel={`${props.oscillator.toUpperCase()} equal-division step`}
            value={getNumberParam(props.draft, stepId)}
            min={-96}
            max={96}
            step={1}
            onChange={(value) => props.onNumericChange(stepId, value)}
          />
          <NumberInput
            layout="inline"
            label="Divisions"
            ariaLabel={`${props.oscillator.toUpperCase()} octave divisions`}
            value={getNumberParam(props.draft, divisionsId)}
            min={1}
            max={96}
            step={1}
            onChange={(value) => props.onNumericChange(divisionsId, value)}
          />
        </Show>
      </div>
      <FloatingSelect
        layout="inline"
        label="Phase"
        ariaLabel={`${props.oscillator.toUpperCase()} phase mode`}
        value={getStringParam(props.draft, phaseModeId)}
        options={PHASE_MODE_OPTIONS}
        onChange={(value) => props.onStringChange(phaseModeId, value)}
      />
      <FloatingSelect
        layout="inline"
        label="Route"
        ariaLabel={`${props.oscillator.toUpperCase()} output route`}
        value={getStringParam(props.draft, routeId)}
        options={OSCILLATOR_ROUTE_OPTIONS}
        onChange={(value) => props.onStringChange(routeId, value)}
      />
    </div>
  );
}

function WavemapAnalysisDetails(props: { table: WavemapDefinition }) {
  const summary = createMemo(() => summarizeWavemapAnalysis(props.table));

  return (
    <div class={styles.analysisDetails} aria-label="Wavemap analysis details">
      <div class={styles.analysisHeader}>
        <span>Frames {summary().analyzedFrameCount}/{summary().frameCount}</span>
        <span>RMS {formatAnalysisPercent(summary().averageRms)}</span>
        <span>Peak {formatAnalysisPercent(summary().peak)}</span>
        <span>ZC {formatAnalysisPercent(summary().averageZeroCrossRate)}</span>
        <span>Rough {formatAnalysisPercent(summary().averageRoughness)}</span>
        <span>Asym {formatAnalysisSignedPercent(summary().averageAsymmetry)}</span>
        <span>C{formatAnalysisDecimal(summary().averageSpectralCentroid)}</span>
        <span>{summary().dominantHarmonic > 0 ? `H${Math.round(summary().dominantHarmonic)}` : "H-"}</span>
        <span>{formatSampleSpan(summary().sourceStartSample, summary().sourceEndSample)}</span>
      </div>
      <div class={styles.analysisFrameRows}>
        <For each={props.table.frames}>
          {(frame, index) => (
            <div class={styles.analysisFrameRow}>
              <strong>{frame.label ?? CUSTOM_WAVETABLE_FRAME_LABELS[index()] ?? index() + 1}</strong>
              <Show
                when={frame.analysis}
                fallback={<span class={styles.analysisPending}>Analysis pending</span>}
              >
                {(analysis) => (
                  <>
                    <span>RMS {formatAnalysisPercent(analysis().rms)}</span>
                    <span>Peak {formatAnalysisPercent(analysis().peak)}</span>
                    <span>ZC {formatAnalysisPercent(analysis().zeroCrossRate)}</span>
                    <span>Rough {formatAnalysisPercent(analysis().roughness)}</span>
                    <span>Asym {formatAnalysisSignedPercent(analysis().asymmetry)}</span>
                    <span>C{formatAnalysisDecimal(analysis().spectralCentroid)}</span>
                    <span>{analysis().dominantHarmonic > 0 ? `H${Math.round(analysis().dominantHarmonic)}` : "H-"}</span>
                    <span>{formatSampleSpan(analysis().sourceStartSample, analysis().sourceEndSample)}</span>
                  </>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function MiniWaveform(props: { samples: number[]; disabled?: boolean; onDrawSamples?: (samples: number[]) => void }) {
  const [workingSamples, setWorkingSamples] = createSignal<number[] | null>(null);
  const [lastDrawPoint, setLastDrawPoint] = createSignal<{ index: number; value: number } | null>(null);
  const visibleSamples = createMemo(() => workingSamples() ?? props.samples);
  const path = createMemo(() => makeWaveformPath(visibleSamples()));

  const pointFromPointer = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width - 0.001, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const count = Math.max(2, visibleSamples().length || props.samples.length || 96);
    const index = Math.max(0, Math.min(count - 1, Math.floor((x / Math.max(1, rect.width)) * count)));
    return { index, value: Math.max(-1, Math.min(1, 1 - (y / Math.max(1, rect.height)) * 2)) };
  };

  const updateFromPointer = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    if (!props.onDrawSamples || props.disabled) return;
    const point = pointFromPointer(event);
    const previous = lastDrawPoint() ?? point;
    const next = drawWaveformSampleLine(visibleSamples(), previous.index, previous.value, point.index, point.value);
    setWorkingSamples(next);
    setLastDrawPoint(point);
    props.onDrawSamples(next);
  };

  return (
    <svg
      class={`${styles.frameWaveform} ${props.disabled ? styles.frameWaveformLocked : ""}`}
      viewBox="0 0 100 48"
      preserveAspectRatio="none"
      aria-hidden={props.onDrawSamples && !props.disabled ? undefined : "true"}
      aria-label={props.onDrawSamples && !props.disabled ? "Draw waveform" : undefined}
      onPointerDown={(event) => {
        if (!props.onDrawSamples || props.disabled) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic verifier events may not create an active browser pointer capture.
        }
        setWorkingSamples(props.samples.slice());
        setLastDrawPoint(null);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (!props.onDrawSamples || props.disabled || event.buttons !== 1) return;
        updateFromPointer(event);
      }}
      onPointerUp={() => {
        setLastDrawPoint(null);
        setWorkingSamples(null);
      }}
      onPointerCancel={() => {
        setLastDrawPoint(null);
        setWorkingSamples(null);
      }}
    >
      <line class={styles.zeroLine} x1="0" y1="24" x2="100" y2="24" />
      <Show when={path()}>
        <path class={styles.frameWaveformPath} d={path()} />
      </Show>
    </svg>
  );
}

function OscillatorParamGroup(props: {
  label: string;
  suffixes: OscParamSuffix[];
  oscillator: OscillatorKey;
  draft: SynthDraftPatch;
  warpModeValue?: WavetableWarpMode;
  onWarpModeChange?: (value: WavetableWarpMode) => void;
  onChange: (id: SynthParameterId, value: number) => void;
}) {
  return (
    <div class={`${styles.oscillatorControlGroup} ${props.warpModeValue ? styles.warpControlGroup : ""}`} aria-label={`${props.label} controls`}>
      <Show
        when={props.warpModeValue && props.onWarpModeChange ? true : false}
        fallback={<div class={styles.oscillatorControlGroupTitle}>{props.label}</div>}
      >
        <div class={styles.warpModeStack}>
          <div class={styles.oscillatorControlGroupTitle}>{props.label}</div>
          <WarpModeButtons
            value={props.warpModeValue ?? "shape"}
            onChange={props.onWarpModeChange ?? (() => undefined)}
          />
        </div>
      </Show>
      <div class={styles.oscillatorControlGroupKnobs}>
        <For each={props.suffixes}>
          {(suffix) => (
            <OscillatorParamKnob
              param={OSC_PARAM_BY_SUFFIX[suffix]}
              oscillator={props.oscillator}
              draft={props.draft}
              showModulation={!props.warpModeValue}
              onChange={props.onChange}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function OscillatorParamKnob(props: {
  param: OscParamDefinition;
  oscillator: OscillatorKey;
  draft: SynthDraftPatch;
  showModulation?: boolean;
  onChange: (id: SynthParameterId, value: number) => void;
}) {
  const id = createMemo(() => oscParam(props.oscillator, props.param.suffix));
  const acceptsPercentParse = () => (
    props.param.suffix === "position"
    || props.param.suffix === "warp"
    || props.param.suffix === "level"
    || props.param.suffix === "pan"
  );

  return (
    <Knob
      size="sm"
      label={props.param.label}
      value={getNumberParam(props.draft, id())}
      min={props.param.min}
      max={props.param.max}
      step={props.param.step}
      defaultValue={props.param.defaultValue}
      bipolar={props.param.bipolar}
      {...(props.showModulation === false ? {} : modulationPropsForTarget(props.draft, id()))}
      pickTargetId={props.showModulation === false ? undefined : (MODULATABLE_TARGETS.has(id()) ? id() : undefined)}
      formatValue={formatValue(props.param.suffix)}
      parseValue={acceptsPercentParse() ? parsePercent : undefined}
      onChange={(value) => props.onChange(id(), value)}
    />
  );
}

function CustomWavetableFrameCard(props: {
  table: WavemapDefinition;
  frame: CustomWavetableFrame;
  index: number;
  editMode: WavemapEditMode;
  onDrawSamples: (samples: number[]) => void;
  onUpdate: (patch: Partial<CustomWavetableFrame>) => void;
}) {
  const defaultFrame = createMemo(() => createDefaultCustomWavetable(props.table.id).frames[props.index]);
  const defaultPosition = () => props.index / Math.max(1, props.table.frames.length - 1);
  const frameLabel = () => props.frame.label ?? CUSTOM_WAVETABLE_FRAME_LABELS[props.index] ?? props.index + 1;
  const framePosition = () => props.frame.position ?? defaultPosition();
  const scanMin = createMemo(() => constrainWavemapFramePosition(props.table, props.index, 0));
  const scanMax = createMemo(() => constrainWavemapFramePosition(props.table, props.index, 1));
  const scanLocked = createMemo(() => props.index === 0 || props.index === props.table.frames.length - 1 || scanMin() >= scanMax());

  return (
    <div class={styles.customFrame}>
      <div class={styles.frameLabel}>
        {frameLabel()}
      </div>
        <div class={styles.frameBody}>
        <div class={styles.frameScanBlock} aria-label={`${frameLabel()} frame scan controls`}>
          <MiniWaveform
            samples={renderCustomFramePreview(props.frame)}
            disabled={props.editMode !== "freehand"}
            onDrawSamples={props.onDrawSamples}
          />
        </div>
        <div class={styles.harmonicsBlock} aria-label={`${frameLabel()} harmonic controls`}>
          <HarmonicDraw
            partials={props.frame.partials}
            mode={props.editMode}
            onChange={(partials) => props.onUpdate({ partials })}
          />
          <div class={styles.frameKnobRowThree}>
            <FrameKnob
              label="Scan"
              value={framePosition()}
              min={scanMin()}
              max={scanMax()}
              defaultValue={defaultPosition()}
              disabled={scanLocked()}
              formatValue={() => scanKnobLabel(props.table, props.index, framePosition())}
              onChange={(position) => props.onUpdate({
                position: constrainWavemapFramePosition(props.table, props.index, position),
              })}
            />
            <FrameKnob
              label="Bright"
              value={props.frame.brightness}
              defaultValue={defaultFrame()?.brightness ?? 0.5}
              onChange={(brightness) => props.onUpdate({ brightness })}
            />
            <FrameKnob
              label="Even"
              value={props.frame.even}
              defaultValue={defaultFrame()?.even ?? 0.2}
              onChange={(even) => props.onUpdate({ even })}
            />
          </div>
        </div>
        <div class={styles.frameKnobBox} aria-label={`${frameLabel()} spectral shape controls`}>
          <div class={styles.frameKnobRowFour}>
            <FrameKnob
              label="Fold"
              value={props.frame.fold}
              defaultValue={defaultFrame()?.fold ?? 0.1}
              onChange={(fold) => props.onUpdate({ fold })}
            />
            <FrameKnob
              label="Formant"
              value={props.frame.formant}
              defaultValue={defaultFrame()?.formant ?? 0.12}
              onChange={(formant) => props.onUpdate({ formant })}
            />
            <FrameKnob
              label="Notch"
              value={props.frame.notch}
              defaultValue={defaultFrame()?.notch ?? 0.08}
              onChange={(notch) => props.onUpdate({ notch })}
            />
            <FrameKnob
              label="Focus"
              value={props.frame.focus}
              defaultValue={defaultFrame()?.focus ?? 0.35}
              onChange={(focus) => props.onUpdate({ focus })}
            />
          </div>
        </div>
        <div class={styles.frameKnobRowThree} aria-label={`${frameLabel()} phase balance controls`}>
            <FrameKnob
              label="Skew"
              value={props.frame.skew}
              defaultValue={defaultFrame()?.skew ?? 0}
              bipolar
              onChange={(skew) => props.onUpdate({ skew })}
            />
            <FrameKnob
              label="Tilt"
              value={props.frame.tilt}
              defaultValue={defaultFrame()?.tilt ?? 0}
              bipolar
              onChange={(tilt) => props.onUpdate({ tilt })}
            />
            <FrameKnob
              label="Phase"
              value={props.frame.phase}
              defaultValue={defaultFrame()?.phase ?? 0}
              bipolar
              onChange={(phase) => props.onUpdate({ phase })}
            />
        </div>
      </div>
    </div>
  );
}

function FrameKnob(props: {
  label: string;
  value: number;
  defaultValue: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  bipolar?: boolean;
  formatValue?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <Knob
      size="sm"
      className={styles.frameKnob}
      label={props.label}
      value={props.value}
      min={props.min ?? (props.bipolar ? -1 : 0)}
      max={props.max ?? 1}
      step={0.01}
      defaultValue={props.defaultValue}
      bipolar={props.bipolar}
      disabled={props.disabled}
      formatValue={props.formatValue ?? ((value) => `${Math.round(value * 100)}`)}
      parseValue={parsePercent}
      onChange={props.onChange}
    />
  );
}

function WaveformPreview(props: {
  label: string;
  samples: number[];
  disabled?: boolean;
  voices?: number;
  spread?: number;
}) {
  const path = createMemo(() => makeWaveformPath(props.samples));
  const secondaryPath = createMemo(() => (props.voices ?? 1) > 1
    ? makeWaveformPath(props.samples, Math.min(AETHER_MAX_UNISON_VOICES, Math.max(2, props.voices ?? 1)) * 0.08 * (props.spread ?? 0))
    : "");
  const tertiaryPath = createMemo(() => (props.voices ?? 1) > 2
    ? makeWaveformPath(props.samples, -Math.min(AETHER_MAX_UNISON_VOICES, Math.max(2, props.voices ?? 1)) * 0.06 * (props.spread ?? 0))
    : "");

  return (
    <div class={`${styles.previewPane} ${props.disabled ? styles.previewPaneDisabled : ""}`} aria-label={props.label}>
      <svg class={styles.previewSvg} viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
        <line class={styles.zeroLine} x1="0" y1="24" x2="100" y2="24" />
        <Show when={tertiaryPath()}>
          <path class={styles.previewGhostPath} d={tertiaryPath()} />
        </Show>
        <Show when={secondaryPath()}>
          <path class={styles.previewGhostPath} d={secondaryPath()} />
        </Show>
        <Show when={path()}>
          <path class={styles.previewPath} d={path()} />
        </Show>
      </svg>
    </div>
  );
}

function selectedWavetableLabel(value: WavetableId): string {
  if (isCustomWavetableId(value)) return "Custom";
  return FACTORY_WAVETABLES.find((table) => table.id === value)?.label ?? value;
}

function WavetableShapeButtons(props: { value: WavetableId; onChange: (value: WavetableId) => void; compact?: boolean }) {
  const selected = createMemo(() => FACTORY_WAVETABLES.find((table) => wavetableButtonSelected(table.id, props.value)));

  return (
    <div class={styles.wavetableControl} data-compact={props.compact ? "true" : "false"}>
      <div class={styles.wavetableButtons} role="radiogroup" aria-label="Wavetable">
        <For each={FACTORY_WAVETABLES}>
          {(table) => {
            const active = () => wavetableButtonSelected(table.id, props.value);
            return (
              <HoverInfo content={table.label}>
                <Button
                  iconOnly
                  size="xs"
                  variant="ghost"
                  selected={active()}
                  role="radio"
                  aria-checked={active()}
                  aria-label={table.label}
                  className={styles.wavetableButton}
                  onClick={() => props.onChange(table.id)}
                >
                  <Icon name={WAVETABLE_ICONS[table.id] ?? "ph:waveform"} size={18} decorative />
                </Button>
              </HoverInfo>
            );
          }}
        </For>
      </div>
      <Show when={!props.compact}>
        <span class={styles.wavetableSelectedLabel}>{selected()?.label ?? props.value}</span>
        <span class={styles.wavetableControlLabel}>Wavetable</span>
      </Show>
    </div>
  );
}

function isCustomWavetableId(value: WavetableId): boolean {
  return value.startsWith("user.");
}

function wavetableButtonSelected(buttonId: WavetableId, value: WavetableId): boolean {
  return buttonId === value || (buttonId === DEFAULT_CUSTOM_WAVETABLE_ID && isCustomWavetableId(value));
}

function WarpModeButtons(props: { value: WavetableWarpMode; onChange: (value: WavetableWarpMode) => void }) {
  return (
    <div class={styles.wavetableControl} data-compact="true">
      <div class={styles.wavetableButtons} role="radiogroup" aria-label="Warp mode">
        <For each={WARP_MODE_OPTIONS}>
          {(option) => {
            const active = () => option.value === props.value;
            return (
              <HoverInfo content={option.label}>
                <Button
                  iconOnly
                  size="xs"
                  variant="ghost"
                  selected={active()}
                  role="radio"
                  aria-checked={active()}
                  aria-label={`${option.label} warp mode`}
                  className={styles.wavetableButton}
                  onClick={() => props.onChange(option.value)}
                >
                  <Icon name={option.icon} size={18} decorative />
                </Button>
              </HoverInfo>
            );
          }}
        </For>
      </div>
    </div>
  );
}

function oscParam(id: OscillatorKey, suffix: string): SynthParameterId {
  return `osc.${id}.${suffix}` as SynthParameterId;
}

function formatValue(suffix: string): (value: number) => string {
  if (suffix === "octave" || suffix === "semitone") return (value) => Math.round(value).toString();
  if (suffix === "fine") return (value) => `${Math.round(value)}c`;
  return formatPercent;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}`;
}

function parsePercent(raw: string): number {
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.abs(value) > 1 ? value / 100 : value;
}

function sourceLabel(kind: string): string {
  if (kind === "resynthesized") return "Resynthesized";
  if (kind === "imported-audio") return "Audio import";
  if (kind === "generated") return "Generated";
  return "Drawn";
}

function sourceAnalysisLabel(table: WavemapDefinition): string {
  const source = table.source;
  const parts = [
    source.sampleRate ? `${Math.round(source.sampleRate / 100) / 10} kHz` : "",
    source.channelCount ? `${source.channelCount} ch` : "",
    source.bitDepth ? `${source.bitDepth} bit` : "",
    formatSamples(source.analyzedSampleCount ?? source.sourceSampleCount),
    source.frameCount ? `${source.frameCount} frames` : `${table.frames.length} frames`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : sourceLabel(source.kind);
}

function scanKnobLabel(table: WavemapDefinition, index: number, position: number): string {
  if (index === 0) return "Start";
  if (index === table.frames.length - 1) return "End";
  return `${Math.round(position * 100)}%`;
}

function formatSamples(count?: number): string {
  if (!Number.isFinite(count) || !count) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M smp`;
  if (count >= 1_000) return `${Math.round(count / 100) / 10}k smp`;
  return `${Math.round(count)} smp`;
}

function formatAnalysisPercent(value: number): string {
  return `${Math.round((Number.isFinite(value) ? value : 0) * 100)}`;
}

function formatAnalysisSignedPercent(value: number): string {
  const percent = Math.round((Number.isFinite(value) ? value : 0) * 100);
  return percent > 0 ? `+${percent}` : `${percent}`;
}

function formatAnalysisDecimal(value: number): string {
  return Number.isFinite(value) && value > 0 ? value.toFixed(1) : "-";
}

function formatSampleSpan(start?: number, end?: number): string {
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) return "No span";
  return `${Math.round(start)}-${Math.round(end)} smp`;
}

function renderCustomFramePreview(frame: CustomWavetableFrame, sampleCount = 96): number[] {
  const samples: number[] = [];
  let peak = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const phase = index / sampleCount;
    let sample = 0;
    for (let harmonic = 1; harmonic <= 32; harmonic += 1) {
      const amplitude = customFrameAmplitude(frame, harmonic);
      if (amplitude <= 0.0001) continue;
      sample += Math.sin(Math.PI * 2 * phase * harmonic + customFramePhase(frame, harmonic)) * amplitude;
    }
    samples.push(sample);
    peak = Math.max(peak, Math.abs(sample));
  }
  return peak > 0 ? samples.map((sample) => sample / peak) : samples;
}

function HarmonicDraw(props: { partials?: number[]; mode: WavemapEditMode; onChange: (partials: number[]) => void }) {
  const [lastDrawPoint, setLastDrawPoint] = createSignal<{ index: number; value: number } | null>(null);
  const bins = createMemo(() =>
    Array.from({ length: CUSTOM_WAVETABLE_PARTIAL_COUNT }, (_, index) => clamp01(props.partials?.[index] ?? 0)),
  );

  const pointFromPointer = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width - 0.001, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const index = Math.max(0, Math.min(CUSTOM_WAVETABLE_PARTIAL_COUNT - 1, Math.floor((x / Math.max(1, rect.width)) * CUSTOM_WAVETABLE_PARTIAL_COUNT)));
    return { index, value: clamp01(1 - y / Math.max(1, rect.height)) };
  };

  const updateFromPointer = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (props.mode !== "additive") return;
    const point = pointFromPointer(event);
    const previous = lastDrawPoint() ?? point;
    props.onChange(drawHarmonicPartialLine(bins(), previous.index, previous.value, point.index, point.value));
    setLastDrawPoint(point);
  };

  return (
    <div
      class={`${styles.harmonicDraw} ${props.mode === "additive" ? "" : styles.harmonicDrawLocked}`}
      aria-label="Harmonic partials"
      onPointerDown={(event) => {
        if (props.mode !== "additive") return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setLastDrawPoint(null);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (props.mode !== "additive" || event.buttons !== 1) return;
        updateFromPointer(event);
      }}
      onPointerUp={() => setLastDrawPoint(null)}
      onPointerCancel={() => setLastDrawPoint(null)}
    >
      <For each={bins()}>
        {(value, index) => (
          <div class={styles.harmonicDrawBin} title={`H${index() + 1} ${Math.round(value * 100)}`}>
            <span style={{ height: `${Math.max(1, value * 100)}%` }} />
          </div>
        )}
      </For>
    </div>
  );
}

function customFrameAmplitude(frame: CustomWavetableFrame, harmonic: number): number {
  const brightness = clamp01(frame.brightness);
  const even = clamp01(frame.even);
  const fold = clamp01(frame.fold);
  const formant = clamp01(frame.formant);
  const notch = clamp01(frame.notch);
  const skew = Math.max(-1, Math.min(1, frame.skew));
  const tilt = Number.isFinite(frame.tilt) ? Math.max(-1, Math.min(1, frame.tilt)) : 0;
  const focus = clamp01(frame.focus);
  const parity = harmonic % 2 === 1 ? 1 : even;
  const rolloff = Math.exp(-harmonic * (0.016 + (1 - brightness) * 0.085));
  const skewBias = Math.max(0.18, 1 + skew * ((harmonic - 8) / 18));
  const tiltBias = Math.max(0.12, Math.exp(tilt * ((harmonic - 8) / 9)));
  const foldPeak = Math.exp(-Math.pow((harmonic - (3 + brightness * 20)) / (1.6 + fold * 8), 2));
  const formantCenter = 4 + brightness * 24 + skew * 4;
  const focusNarrow = 1 - focus * 0.72;
  const formantWidth = (1.1 + fold * 4.4) * focusNarrow;
  const formantPeak = Math.exp(-Math.pow((harmonic - formantCenter) / formantWidth, 2));
  const notchCenter = 6 + (1 - brightness) * 18 - skew * 4;
  const notchWidth = (1.2 + fold * 4.8 + formant * 1.8) * focusNarrow;
  const notchPeak = Math.exp(-Math.pow((harmonic - notchCenter) / notchWidth, 2));
  const notchCut = Math.max(0.08, 1 - notchPeak * notch * (0.58 + focus * 0.28));
  const drawnPartial = harmonic <= CUSTOM_WAVETABLE_PARTIAL_COUNT ? clamp01(frame.partials?.[harmonic - 1] ?? 0) : 0;
  const motion = 1 + Math.sin(harmonic * 1.7 + frame.phase * Math.PI) * fold * 0.28;
  return Math.max(0, (parity * rolloff * motion * skewBias * tiltBias / Math.sqrt(harmonic) + foldPeak * fold * 0.35 + formantPeak * formant * (0.42 + focus * 0.28) + drawnPartial * (0.08 + brightness * 0.34)) * notchCut);
}

function customFramePhase(frame: CustomWavetableFrame, harmonic: number): number {
  const fold = clamp01(frame.fold);
  const formant = clamp01(frame.formant);
  const notch = clamp01(frame.notch);
  const phase = Math.max(-1, Math.min(1, frame.phase));
  const skew = Math.max(-1, Math.min(1, frame.skew));
  return phase * harmonic * 0.28
    + Math.sin(harmonic * 0.41 + skew * 0.55) * fold * 0.55
    + skew * Math.log2(harmonic + 1) * 0.09
    + Math.sin(harmonic * 0.23 + phase) * formant * 0.12
    + Math.cos(harmonic * 0.31 + skew) * notch * 0.08;
}

function makeWaveformPath(samples: number[], verticalOffset = 0): string {
  if (samples.length <= 1) return "";
  const last = samples.length - 1;
  return samples.map((sample, index) => {
    const x = (index / last) * 100;
    const y = 24 - Math.max(-1, Math.min(1, sample)) * 18 + verticalOffset;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function drawWaveformSampleLine(
  samples: number[],
  fromIndex: number,
  fromValue: number,
  toIndex: number,
  toValue: number,
): number[] {
  const count = Math.max(2, samples.length || 96);
  const next = samples.length === count ? samples.slice() : Array.from({ length: count }, (_, index) => samples[index] ?? 0);
  const startIndex = Math.max(0, Math.min(count - 1, Math.round(fromIndex)));
  const endIndex = Math.max(0, Math.min(count - 1, Math.round(toIndex)));
  const startValue = Math.max(-1, Math.min(1, fromValue));
  const endValue = Math.max(-1, Math.min(1, toValue));
  const direction = startIndex <= endIndex ? 1 : -1;
  const distance = Math.max(1, Math.abs(endIndex - startIndex));
  for (let index = startIndex; direction > 0 ? index <= endIndex : index >= endIndex; index += direction) {
    const t = Math.abs(index - startIndex) / distance;
    next[index] = Math.max(-1, Math.min(1, startValue + (endValue - startValue) * t));
  }
  return next;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

const MODULATABLE_TARGETS = new Set<string>([
  "osc.a.position",
  "osc.a.fine",
  "osc.a.level",
  "osc.a.pan",
  "osc.b.position",
  "osc.b.fine",
  "osc.b.level",
  "osc.b.pan",
  "osc.c.position",
  "osc.c.fine",
  "osc.c.level",
  "osc.c.pan",
  "osc.a.unison.detune",
  "osc.a.unison.spread",
  "osc.b.unison.detune",
  "osc.b.unison.spread",
  "osc.c.unison.detune",
  "osc.c.unison.spread",
  "unison.detune",
  "unison.spread",
]);

function modulationPropsForTarget(draft: SynthDraftPatch, id: SynthParameterId) {
  if (!MODULATABLE_TARGETS.has(id)) return {};
  const summary = modulationSummaryForTarget(draft, id as ModulationTargetId);
  if (summary.count === 0) return {};
  return {
    modulationAmount: summary.amount,
    modulationLabel: summary.label,
  };
}
