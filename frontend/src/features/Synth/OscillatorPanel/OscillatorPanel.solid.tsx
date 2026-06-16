/** @jsxImportSource solid-js */
import { createMemo, For, Show } from "solid-js";
import { render } from "solid-js/web";
import { renderAetherOutputPreviewSamples } from "../../../audio/synthPreview";
import { Button, HoverInfo, Icon, Knob } from "../../../solid-ui";
import { createStoreSelector } from "../../../solid-utils/store";
import type { CustomWavetableFrame } from "../../../state/types";
import {
  CUSTOM_WAVETABLE_FRAME_LABELS,
  DEFAULT_CUSTOM_WAVETABLE_ID,
  FACTORY_WAVETABLES,
  createDefaultCustomWavetable,
  getBooleanParam,
  getNumberParam,
  getStringParam,
  modulationSummaryForTarget,
  synthDraftToPreviewInstrument,
  useSynthStore,
  type ModulationTargetId,
  type OscillatorKey,
  type SynthDraftPatch,
  type SynthParameterId,
  type WavetableId,
} from "../../../state/synthStore";
import styles from "./OscillatorPanel.module.css";

const OSC_PARAMS: Array<{
  suffix: "position" | "level" | "pan" | "octave" | "semitone" | "fine";
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  bipolar?: boolean;
}> = [
  { suffix: "position", label: "Position", min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { suffix: "level", label: "Level", min: 0, max: 1, step: 0.01, defaultValue: 0.8 },
  { suffix: "pan", label: "Pan", min: -1, max: 1, step: 0.01, defaultValue: 0, bipolar: true },
  { suffix: "octave", label: "Oct", min: -4, max: 4, step: 1, defaultValue: 0, bipolar: true },
  { suffix: "semitone", label: "Semi", min: -12, max: 12, step: 1, defaultValue: 0, bipolar: true },
  { suffix: "fine", label: "Fine", min: -100, max: 100, step: 1, defaultValue: 0, bipolar: true },
];

const WAVETABLE_ICONS: Record<WavetableId, string> = {
  "basic.sine": "ph:wave-sine",
  "basic.saw": "ph:wave-sawtooth",
  "basic.square": "ph:wave-square",
  "basic.triangle": "ph:wave-triangle",
  "basic.pulse": "ph:waveform",
  [DEFAULT_CUSTOM_WAVETABLE_ID]: "ph:sliders-horizontal",
};

export function OscillatorPanelSolid() {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const previewInstrument = createMemo(() => synthDraftToPreviewInstrument(draft()));
  const unisonEnabled = createMemo(() => getBooleanParam(draft(), "unison.enabled"));
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
                        formatValue={id === "unison.voices" ? (value) => Math.round(value).toString() : formatPercent}
                        parseValue={id === "unison.voices" ? undefined : parsePercent}
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
  const updateCustomWavetableFrame = useSynthStore.getState().updateCustomWavetableFrame;
  const enabledId = createMemo(() => oscParam(props.oscillator, "enabled"));
  const enabled = createMemo(() => getBooleanParam(draft(), enabledId()));
  const wavetableId = createMemo(() => oscParam(props.oscillator, "wavetable"));
  const selectedWavetable = createMemo(() => getStringParam(draft(), wavetableId()) as WavetableId);
  const customTableId = createMemo(() => selectedWavetable().startsWith("user.") ? selectedWavetable() : DEFAULT_CUSTOM_WAVETABLE_ID);
  const customTable = createMemo(() => draft().metadata.customWavetables?.[customTableId()] ?? createDefaultCustomWavetable(customTableId()));
  const label = createMemo(() => `Oscillator ${props.oscillator.toUpperCase()}`);
  const waveform = createMemo(() => renderAetherOutputPreviewSamples(props.previewInstrument, 160, props.oscillator));

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
                        parseValue={param.suffix === "position" || param.suffix === "level" || param.suffix === "pan" ? parsePercent : undefined}
                        onChange={(value) => setNumericParameter(id, value)}
                      />
                    );
                  }}
                </For>
              </div>
            </div>
            <Show when={selectedWavetable().startsWith("user.")}>
              <div class={styles.customEditor} aria-label={`${label()} custom wavetable frames`}>
                <div class="ds-section-header">
                  <div class="ds-section-title">{customTable().name} Frame Editor</div>
                </div>
                <div class={styles.customFrames}>
                  <For each={customTable().frames}>
                    {(frame, index) => (
                      <div class={styles.customFrame}>
                        <div class={styles.frameLabel}>{CUSTOM_WAVETABLE_FRAME_LABELS[index()] ?? index() + 1}</div>
                        <MiniWaveform samples={renderCustomFramePreview(frame)} />
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

function MiniWaveform(props: { samples: number[] }) {
  const path = createMemo(() => makeWaveformPath(props.samples));
  return (
    <svg class={styles.frameWaveform} viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
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

function customFrameAmplitude(frame: CustomWavetableFrame, harmonic: number): number {
  const brightness = clamp01(frame.brightness);
  const even = clamp01(frame.even);
  const fold = clamp01(frame.fold);
  const parity = harmonic % 2 === 1 ? 1 : even;
  const rolloff = Math.exp(-harmonic * (0.016 + (1 - brightness) * 0.085));
  const foldPeak = Math.exp(-Math.pow((harmonic - (3 + brightness * 20)) / (1.6 + fold * 8), 2));
  const motion = 1 + Math.sin(harmonic * 1.7 + frame.phase * Math.PI) * fold * 0.28;
  return Math.max(0, parity * rolloff * motion / Math.sqrt(harmonic) + foldPeak * fold * 0.35);
}

function customFramePhase(frame: CustomWavetableFrame, harmonic: number): number {
  const fold = clamp01(frame.fold);
  const phase = Math.max(-1, Math.min(1, frame.phase));
  return phase * harmonic * 0.28 + Math.sin(harmonic * 0.41) * fold * 0.55;
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

export interface MountedOscillatorPanelSolid {
  dispose: () => void;
}

export function mountOscillatorPanelSolid(host: HTMLElement): MountedOscillatorPanelSolid {
  const dispose = render(() => <OscillatorPanelSolid />, host);
  return { dispose };
}
