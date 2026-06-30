import { createMemo, createSignal, For, Show } from "solid-js";
import { importAudioFile } from "../../../audio/audioImport";
import { renderAetherOutputPreviewSamples } from "../../../audio/synthPreview";
import { resynthesizeAudioFileToWavemap } from "../../../audio/wavemapResynthesis";
import { appAlert, Button, HoverInfo, Icon, Knob, NumberInput } from "../../../solid-ui";
import { createStoreSelector } from "../../../solid-utils/store";
import type { CustomWavetableFrame, WavemapDefinition, WavetableWarpMode } from "../../../state/types";
import {
  CUSTOM_WAVETABLE_FRAME_LABELS,
  CUSTOM_WAVETABLE_PARTIAL_COUNT,
  DEFAULT_CUSTOM_WAVETABLE_ID,
  FACTORY_WAVETABLES,
  constrainWavemapFramePosition,
  createDefaultCustomWavetable,
  createHarmonicPartialPreset,
  deriveWavemapFrameFromDrawnWaveform,
  drawHarmonicPartialLine,
  evolveWavemapFrames,
  getBooleanParam,
  getNumberParam,
  getStringParam,
  modulationSummaryForTarget,
  normalizeWavemapManualRange,
  normalizeWavemapFrames,
  smoothHarmonicPartials,
  summarizeWavemapAnalysis,
  synthDraftToPreviewInstrument,
  tiltHarmonicPartials,
  useSynthStore,
  type WavemapAudioSelectionMode,
  type HarmonicPartialPreset,
  type ModulationTargetId,
  type OscillatorKey,
  type SynthDraftPatch,
  type SynthParameterId,
  type WavetableId,
} from "../../../state/synthStore";
import styles from "./OscillatorPanel.module.css";

const OSC_PARAMS: Array<{
  suffix: "position" | "warp" | "level" | "pan" | "octave" | "semitone" | "fine" | "phase" | "randomPhase";
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  bipolar?: boolean;
}> = [
  { suffix: "position", label: "Position", min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { suffix: "warp", label: "Warp", min: 0, max: 1, step: 0.01, defaultValue: 0.2 },
  { suffix: "level", label: "Level", min: 0, max: 1, step: 0.01, defaultValue: 0.8 },
  { suffix: "pan", label: "Pan", min: -1, max: 1, step: 0.01, defaultValue: 0, bipolar: true },
  { suffix: "octave", label: "Oct", min: -4, max: 4, step: 1, defaultValue: 0, bipolar: true },
  { suffix: "semitone", label: "Semi", min: -12, max: 12, step: 1, defaultValue: 0, bipolar: true },
  { suffix: "fine", label: "Fine", min: -100, max: 100, step: 1, defaultValue: 0, bipolar: true },
  { suffix: "phase", label: "Phase", min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { suffix: "randomPhase", label: "Random", min: 0, max: 1, step: 0.01, defaultValue: 0.25 },
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

type WavemapAnalysisView = "compact" | "details";
type WavemapEditMode = "freehand" | "additive";

const WAVEMAP_ANALYSIS_VIEW_OPTIONS: Array<{ value: WavemapAnalysisView; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "details", label: "Details" },
];

const WAVEMAP_EDIT_MODE_OPTIONS: Array<{ value: WavemapEditMode; label: string }> = [
  { value: "freehand", label: "Freehand" },
  { value: "additive", label: "Additive" },
];

export function OscillatorPanel() {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const previewInstrument = createMemo(() => synthDraftToPreviewInstrument(draft()));
  const unisonEnabled = createMemo(() => getBooleanParam(draft(), "unison.enabled"));
  const monoEnabled = createMemo(() => getBooleanParam(draft(), "mono.enabled"));
  const legatoEnabled = createMemo(() => getBooleanParam(draft(), "legato.enabled"));
  const unisonWaveform = createMemo(() => renderAetherOutputPreviewSamples(previewInstrument(), 160, "mix"));

  return (
    <section class={styles.panel} aria-label="Oscillator">
      <div class={styles.body}>
        <OscillatorRow oscillator="a" previewInstrument={previewInstrument()} />
        <OscillatorRow oscillator="b" previewInstrument={previewInstrument()} />
        <div class={`${styles.row} ${unisonEnabled() ? "" : styles.disabledRow}`} aria-label="Voice stack row">
          <div class="ds-section-header">
            <div class="ds-section-title">Voice Stack</div>
            <div class={styles.sectionActions}>
              <Button
                size="xs"
                selected={monoEnabled()}
                aria-label={`${monoEnabled() ? "Disable" : "Enable"} mono voice mode`}
                onClick={() => setBooleanParameter("mono.enabled", !monoEnabled())}
              >
                Mono
              </Button>
              <Button
                size="xs"
                selected={legatoEnabled()}
                disabled={!monoEnabled()}
                aria-label={`${legatoEnabled() ? "Disable" : "Enable"} legato retune mode`}
                onClick={() => setBooleanParameter("legato.enabled", !legatoEnabled())}
              >
                Legato
              </Button>
              <Button
                iconOnly
                size="xs"
                selected={unisonEnabled()}
                aria-label={`${unisonEnabled() ? "Disable" : "Enable"} voice stack`}
                onClick={() => setBooleanParameter("unison.enabled", !unisonEnabled())}
              >
                <Icon name={unisonEnabled() ? "ph:power-fill" : "ph:power"} size={12} decorative />
              </Button>
            </div>
          </div>
          <div class={styles.rowMain}>
            <div class={`${styles.settingsPane} ${styles.unisonSettingsPane}`}>
              <div class={styles.unisonBody}>
                <div class={`${styles.rowKnobs} ${styles.unisonKnobs}`}>
                  <For each={[
                    ["unison.voices", "Voices", 1, 16, 1, 1],
                    ["unison.detune", "Detune", 0, 1, 0.01, 0.12],
                    ["unison.blend", "Blend", 0, 1, 0.01, 0.75],
                    ["unison.spread", "Spread", 0, 1, 0.01, 0.5],
                    ["maxVoices", "Max", 1, 32, 1, 16],
                  ] as Array<[SynthParameterId, string, number, number, number, number]>}>
                    {([id, label, min, max, step, defaultValue]) => (
                      <Knob
                        size="sm"
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
            <WaveformPreview
              label="Voice stack waveform"
              samples={unisonWaveform()}
              disabled={!unisonEnabled()}
              voices={Math.round(getNumberParam(draft(), "unison.voices"))}
              spread={getNumberParam(draft(), "unison.spread")}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function OscillatorRow(props: {
  oscillator: OscillatorKey;
  previewInstrument: ReturnType<typeof synthDraftToPreviewInstrument>;
}) {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setParameter = useSynthStore.getState().setParameter;
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const setWavemap = useSynthStore.getState().setWavemap;
  const updateCustomWavetableFrame = useSynthStore.getState().updateCustomWavetableFrame;
  const updateWavemapMetadata = useSynthStore.getState().updateWavemapMetadata;
  const [resynthesizing, setResynthesizing] = createSignal(false);
  const [resynthesisMode, setResynthesisMode] = createSignal<WavemapAudioSelectionMode>("full");
  const [analysisView, setAnalysisView] = createSignal<WavemapAnalysisView>("compact");
  const [editMode, setEditMode] = createSignal<WavemapEditMode>("freehand");
  const [manualStartPercent, setManualStartPercent] = createSignal(0);
  const [manualEndPercent, setManualEndPercent] = createSignal(100);
  const enabledId = createMemo(() => oscParam(props.oscillator, "enabled"));
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
  const manualRange = createMemo(() => normalizeWavemapManualRange(manualStartPercent(), manualEndPercent()));
  const label = createMemo(() => `Oscillator ${props.oscillator.toUpperCase()}`);
  const waveform = createMemo(() => renderAetherOutputPreviewSamples(props.previewInstrument, 160, props.oscillator));

  async function importAudioWavemap() {
    if (resynthesizing()) return;
    setResynthesizing(true);
    try {
      const audioFile = await importAudioFile();
      if (!audioFile) return;
      const range = manualRange();
      const wavemap = await resynthesizeAudioFileToWavemap(audioFile, customTableId(), undefined, {
        mode: resynthesisMode(),
        ...(resynthesisMode() === "manual" ? { startRatio: range.startRatio, endRatio: range.endRatio } : {}),
      });
      setWavemap(wavemap);
      setParameter(wavetableId(), wavemap.id as WavetableId);
    } catch (error) {
      await appAlert(error instanceof Error ? error.message : "Audio wavemap import failed.");
    } finally {
      setResynthesizing(false);
    }
  }

  function replaceCurrentWavemap(next: WavemapDefinition) {
    setWavemap(next);
    setParameter(wavetableId(), next.id as WavetableId);
  }

  return (
    <div class={`${styles.row} ${enabled() ? "" : styles.disabledRow}`} aria-label={`${label()} row`}>
      <div class="ds-section-header">
        <div class="ds-section-title">{label()}</div>
        <div class={styles.sectionActions}>
          <Button
            iconOnly
            size="xs"
            selected={enabled()}
            aria-label={`${enabled() ? "Disable" : "Enable"} ${label()}`}
            onClick={() => setBooleanParameter(enabledId(), !enabled())}
          >
            <Icon name={enabled() ? "ph:power-fill" : "ph:power"} size={12} decorative />
          </Button>
        </div>
      </div>
      <Show when={enabled()}>
        <div class={styles.rowMain}>
          <div class={styles.settingsPane}>
            <div class={styles.rowBody}>
              <WavetableShapeButtons
                value={selectedWavetable()}
                onChange={(value) => setParameter(wavetableId(), value)}
              />
              <WarpModeButtons
                value={selectedWarpMode()}
                onChange={(value) => setParameter(warpModeId(), value)}
              />
              <div class={styles.rowKnobs}>
                <For each={OSC_PARAMS}>
                  {(param) => {
                    const id = oscParam(props.oscillator, param.suffix);
                    return (
                      <Knob
                        size="sm"
                        label={param.label}
                        value={getNumberParam(draft(), id)}
                        min={param.min}
                        max={param.max}
                        step={param.step}
                        defaultValue={param.defaultValue}
                        bipolar={param.bipolar}
                        {...modulationPropsForTarget(draft(), id)}
                        pickTargetId={MODULATABLE_TARGETS.has(id) ? id : undefined}
                        formatValue={formatValue(param.suffix)}
                        parseValue={param.suffix === "position" || param.suffix === "warp" || param.suffix === "level" || param.suffix === "pan" ? parsePercent : undefined}
                        onChange={(value) => setNumericParameter(id, value)}
                      />
                    );
                  }}
                </For>
              </div>
            </div>
            <Show when={selectedWavetable().startsWith("user.")}>
              <div class={styles.customEditor} aria-label={`${label()} wavemap frames`}>
                <div class="ds-section-header">
                  <div class="ds-section-title">{customTable().name} Wavemap</div>
                  <div class={styles.wavemapMeta}>
                    <span>{customTable().source.label ?? sourceLabel(customTable().source.kind)}</span>
                    <span class={styles.wavemapMetaWide}>{sourceAnalysisLabel(customTable())}</span>
                    <Knob
                      size="sm"
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
                    <div class={styles.analysisModes} role="radiogroup" aria-label="Wavemap analysis display">
                      <For each={WAVEMAP_ANALYSIS_VIEW_OPTIONS}>
                        {(option) => (
                          <Button
                            size="xs"
                            selected={analysisView() === option.value}
                            aria-label={`${option.label} wavemap analysis`}
                            onClick={() => setAnalysisView(option.value)}
                          >
                            {option.label}
                          </Button>
                        )}
                      </For>
                    </div>
                    <div class={styles.editModes} role="radiogroup" aria-label="Wavemap edit mode">
                      <For each={WAVEMAP_EDIT_MODE_OPTIONS}>
                        {(option) => (
                          <Button
                            size="xs"
                            selected={editMode() === option.value}
                            aria-label={`${option.label} wavemap editing`}
                            onClick={() => setEditMode(option.value)}
                          >
                            {option.label}
                          </Button>
                        )}
                      </For>
                    </div>
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
                    <Show when={resynthesisMode() === "manual"}>
                      <div class={styles.manualRangeControl} aria-label="Manual audio resynthesis range">
                        <div class={styles.manualRangeStrip} aria-hidden="true">
                          <span
                            style={{
                              left: `${manualRange().startPercent}%`,
                              width: `${Math.max(1, manualRange().endPercent - manualRange().startPercent)}%`,
                            }}
                          />
                        </div>
                        <NumberInput
                          label="Start"
                          value={manualStartPercent()}
                          min={0}
                          max={100}
                          step={1}
                          unit="%"
                          layout="inline"
                          commitOnChange
                          onChange={setManualStartPercent}
                        />
                        <NumberInput
                          label="End"
                          value={manualEndPercent()}
                          min={0}
                          max={100}
                          step={1}
                          unit="%"
                          layout="inline"
                          commitOnChange
                          onChange={setManualEndPercent}
                        />
                        <span class={styles.manualRangeReadout}>
                          {manualRange().startPercent}-{manualRange().endPercent}%
                        </span>
                      </div>
                    </Show>
                    <Button
                      size="xs"
                      disabled={resynthesizing()}
                      onClick={() => void importAudioWavemap()}
                    >
                      {resynthesizing() ? "Analyzing" : "Import Audio"}
                    </Button>
                    <Button
                      size="xs"
                      onClick={() => replaceCurrentWavemap(normalizeWavemapFrames(customTable()))}
                    >
                      Normalize
                    </Button>
                    <Button
                      size="xs"
                      onClick={() => replaceCurrentWavemap(evolveWavemapFrames(customTable()))}
                    >
                      Evolve
                    </Button>
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
                  </div>
                </div>
                <Show when={analysisView() === "details"}>
                  <WavemapAnalysisDetails table={customTable()} />
                </Show>
                <div class={styles.customFrames}>
                  <For each={customTable().frames}>
                    {(frame, index) => (
                      <div class={styles.customFrame}>
                        <div class={styles.frameLabel}>
                          {frame.label ?? CUSTOM_WAVETABLE_FRAME_LABELS[index()] ?? index() + 1}
                          <span>{Math.round((frame.position ?? index() / 3) * 100)}</span>
                        </div>
                        <div class={styles.frameConstraint}>
                          {scanConstraintLabel(customTable(), index())}
                        </div>
                        <MiniWaveform
                          samples={renderCustomFramePreview(frame)}
                          disabled={editMode() !== "freehand"}
                          onDrawSamples={(samples) =>
                            updateCustomWavetableFrame(customTable().id, index(), deriveWavemapFrameFromDrawnWaveform(frame, samples))
                          }
                        />
                        <div class={styles.frameAnalysis}>{frameAnalysisLabel(frame)}</div>
                        <Knob
                          size="sm"
                          label="Scan"
                          value={frame.position ?? index() / Math.max(1, customTable().frames.length - 1)}
                          min={0}
                          max={1}
                          step={0.01}
                          defaultValue={index() / Math.max(1, customTable().frames.length - 1)}
                          formatValue={formatPercent}
                          parseValue={parsePercent}
                          onChange={(position) => updateCustomWavetableFrame(customTable().id, index(), {
                            position: constrainWavemapFramePosition(customTable(), index(), position),
                          })}
                        />
                        <HarmonicDraw
                          partials={frame.partials}
                          mode={editMode()}
                          onChange={(partials) => updateCustomWavetableFrame(customTable().id, index(), { partials })}
                        />
                        <Knob
                          size="sm"
                          label="Bright"
                          value={frame.brightness}
                          min={0}
                          max={1}
                          step={0.01}
                          defaultValue={createDefaultCustomWavetable(customTable().id).frames[index()]?.brightness ?? 0.5}
                          formatValue={formatPercent}
                          parseValue={parsePercent}
                          onChange={(brightness) => updateCustomWavetableFrame(customTable().id, index(), { brightness })}
                        />
                        <Knob
                          size="sm"
                          label="Even"
                          value={frame.even}
                          min={0}
                          max={1}
                          step={0.01}
                          defaultValue={createDefaultCustomWavetable(customTable().id).frames[index()]?.even ?? 0.2}
                          formatValue={formatPercent}
                          parseValue={parsePercent}
                          onChange={(even) => updateCustomWavetableFrame(customTable().id, index(), { even })}
                        />
                        <Knob
                          size="sm"
                          label="Fold"
                          value={frame.fold}
                          min={0}
                          max={1}
                          step={0.01}
                          defaultValue={createDefaultCustomWavetable(customTable().id).frames[index()]?.fold ?? 0.1}
                          formatValue={formatPercent}
                          parseValue={parsePercent}
                          onChange={(fold) => updateCustomWavetableFrame(customTable().id, index(), { fold })}
                        />
                        <Knob
                          size="sm"
                          label="Formant"
                          value={frame.formant}
                          min={0}
                          max={1}
                          step={0.01}
                          defaultValue={createDefaultCustomWavetable(customTable().id).frames[index()]?.formant ?? 0.12}
                          formatValue={formatPercent}
                          parseValue={parsePercent}
                          onChange={(formant) => updateCustomWavetableFrame(customTable().id, index(), { formant })}
                        />
                        <Knob
                          size="sm"
                          label="Notch"
                          value={frame.notch}
                          min={0}
                          max={1}
                          step={0.01}
                          defaultValue={createDefaultCustomWavetable(customTable().id).frames[index()]?.notch ?? 0.08}
                          formatValue={formatPercent}
                          parseValue={parsePercent}
                          onChange={(notch) => updateCustomWavetableFrame(customTable().id, index(), { notch })}
                        />
                        <Knob
                          size="sm"
                          label="Skew"
                          value={frame.skew}
                          min={-1}
                          max={1}
                          step={0.01}
                          defaultValue={createDefaultCustomWavetable(customTable().id).frames[index()]?.skew ?? 0}
                          bipolar
                          formatValue={(value) => `${Math.round(value * 100)}`}
                          parseValue={parsePercent}
                          onChange={(skew) => updateCustomWavetableFrame(customTable().id, index(), { skew })}
                        />
                        <Knob
                          size="sm"
                          label="Tilt"
                          value={frame.tilt}
                          min={-1}
                          max={1}
                          step={0.01}
                          defaultValue={createDefaultCustomWavetable(customTable().id).frames[index()]?.tilt ?? 0}
                          bipolar
                          formatValue={(value) => `${Math.round(value * 100)}`}
                          parseValue={parsePercent}
                          onChange={(tilt) => updateCustomWavetableFrame(customTable().id, index(), { tilt })}
                        />
                        <Knob
                          size="sm"
                          label="Focus"
                          value={frame.focus}
                          min={0}
                          max={1}
                          step={0.01}
                          defaultValue={createDefaultCustomWavetable(customTable().id).frames[index()]?.focus ?? 0.35}
                          formatValue={formatPercent}
                          parseValue={parsePercent}
                          onChange={(focus) => updateCustomWavetableFrame(customTable().id, index(), { focus })}
                        />
                        <Knob
                          size="sm"
                          label="Phase"
                          value={frame.phase}
                          min={-1}
                          max={1}
                          step={0.01}
                          defaultValue={createDefaultCustomWavetable(customTable().id).frames[index()]?.phase ?? 0}
                          bipolar
                          formatValue={(value) => `${Math.round(value * 100)}`}
                          parseValue={parsePercent}
                          onChange={(phase) => updateCustomWavetableFrame(customTable().id, index(), { phase })}
                        />
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
          <WaveformPreview label={`${label()} Waveform`} samples={waveform()} disabled={!enabled()} />
        </div>
      </Show>
    </div>
  );
}

function WavemapAnalysisDetails(props: { table: WavemapDefinition }) {
  const summary = createMemo(() => summarizeWavemapAnalysis(props.table));

  return (
    <div class={styles.analysisDetails} aria-label="Wavemap analysis details">
      <div class={styles.analysisHeader}>
        <strong>Analysis Details</strong>
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

function WaveformPreview(props: {
  label: string;
  samples: number[];
  disabled?: boolean;
  voices?: number;
  spread?: number;
}) {
  const path = createMemo(() => makeWaveformPath(props.samples));
  const secondaryPath = createMemo(() => (props.voices ?? 1) > 1
    ? makeWaveformPath(props.samples, Math.min(8, Math.max(2, props.voices ?? 1)) * 0.16 * (props.spread ?? 0))
    : "");
  const tertiaryPath = createMemo(() => (props.voices ?? 1) > 2
    ? makeWaveformPath(props.samples, -Math.min(8, Math.max(2, props.voices ?? 1)) * 0.12 * (props.spread ?? 0))
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

function WavetableShapeButtons(props: { value: WavetableId; onChange: (value: WavetableId) => void }) {
  const selected = createMemo(() => FACTORY_WAVETABLES.find((table) => table.id === props.value));

  return (
    <div class={styles.wavetableControl}>
      <div class={styles.wavetableButtons} role="radiogroup" aria-label="Wavetable">
        <For each={FACTORY_WAVETABLES}>
          {(table) => {
            const active = () => table.id === props.value;
            return (
              <HoverInfo content={table.label}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active()}
                  aria-label={table.label}
                  class={`${styles.wavetableButton} ${active() ? styles.wavetableButtonActive : ""}`}
                  onClick={() => props.onChange(table.id)}
                >
                  <Icon name={WAVETABLE_ICONS[table.id] ?? "ph:waveform"} size={12} decorative />
                </button>
              </HoverInfo>
            );
          }}
        </For>
      </div>
      <span class={styles.wavetableSelectedLabel}>{selected()?.label ?? props.value}</span>
      <span class={styles.wavetableControlLabel}>Wavetable</span>
    </div>
  );
}

function WarpModeButtons(props: { value: WavetableWarpMode; onChange: (value: WavetableWarpMode) => void }) {
  const selected = createMemo(() => WARP_MODE_OPTIONS.find((option) => option.value === props.value) ?? WARP_MODE_OPTIONS[0]);
  return (
    <div class={styles.wavetableControl}>
      <div class={styles.wavetableButtons} role="radiogroup" aria-label="Warp mode">
        <For each={WARP_MODE_OPTIONS}>
          {(option) => {
            const active = () => option.value === props.value;
            return (
              <HoverInfo content={option.label}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active()}
                  aria-label={`${option.label} warp mode`}
                  class={`${styles.wavetableButton} ${active() ? styles.wavetableButtonActive : ""}`}
                  onClick={() => props.onChange(option.value)}
                >
                  <Icon name={option.icon} size={12} decorative />
                </button>
              </HoverInfo>
            );
          }}
        </For>
      </div>
      <span class={styles.wavetableSelectedLabel}>{selected().label}</span>
      <span class={styles.wavetableControlLabel}>Warp Mode</span>
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

function frameAnalysisLabel(frame: CustomWavetableFrame): string {
  const analysis = frame.analysis;
  if (!analysis) return "Analysis pending";
  const harmonic = analysis.dominantHarmonic > 0 ? `H${Math.round(analysis.dominantHarmonic)}` : "H-";
  const rms = Math.round(analysis.rms * 100);
  const peak = Math.round(analysis.peak * 100);
  const centroid = analysis.spectralCentroid > 0 ? `C${analysis.spectralCentroid.toFixed(1)}` : "C-";
  return `${harmonic} · ${centroid} · RMS ${rms} · PK ${peak}`;
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
    <>
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
    <div class={styles.harmonicTools} aria-label="Harmonic partial tools">
      <For each={[
        ["fundamental", "Fund"],
        ["odd", "Odd"],
        ["even", "Even"],
      ] as Array<[HarmonicPartialPreset, string]>}>
        {([preset, label]) => (
          <Button size="xs" onClick={() => props.onChange(createHarmonicPartialPreset(preset))}>
            {label}
          </Button>
        )}
      </For>
      <Button size="xs" onClick={() => props.onChange(tiltHarmonicPartials(bins(), -0.42))}>
        Low
      </Button>
      <Button size="xs" onClick={() => props.onChange(tiltHarmonicPartials(bins(), 0.42))}>
        High
      </Button>
      <Button size="xs" onClick={() => props.onChange(smoothHarmonicPartials(bins(), 0.85))}>
        Smooth
      </Button>
      <Button size="xs" onClick={() => props.onChange(Array.from({ length: CUSTOM_WAVETABLE_PARTIAL_COUNT }, () => 0))}>
        Clear
      </Button>
    </div>
    </>
  );
}

function scanConstraintLabel(table: WavemapDefinition, index: number): string {
  if (index === 0) return "Anchor 0%";
  if (index === table.frames.length - 1) return "Anchor 100%";
  const minimum = Math.round(constrainWavemapFramePosition(table, index, 0) * 100);
  const maximum = Math.round(constrainWavemapFramePosition(table, index, 1) * 100);
  return `Scan ${minimum}-${maximum}%`;
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
