import { useMemo } from "react";
import { renderAetherOutputPreviewSamples } from "../../../audio/synthPreview";
import { Button, HoverInfo, Icon, Knob } from "../../../components";
import type { CustomWavetableFrame } from "../../../state/types";
import {
  FACTORY_WAVETABLES,
  CUSTOM_WAVETABLE_FRAME_LABELS,
  DEFAULT_CUSTOM_WAVETABLE_ID,
  createDefaultCustomWavetable,
  getBooleanParam,
  getNumberParam,
  getStringParam,
  modulationSummaryForTarget,
  synthDraftToPreviewInstrument,
  useSynthStore,
  type ModulationTargetId,
  type OscillatorKey,
  type SynthParameterId,
  type SynthDraftPatch,
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

export function OscillatorPanel() {
  const draft = useSynthStore((state) => state.draft);
  const setNumericParameter = useSynthStore((state) => state.setNumericParameter);
  const setBooleanParameter = useSynthStore((state) => state.setBooleanParameter);
  const previewInstrument = useMemo(() => synthDraftToPreviewInstrument(draft), [draft]);

  const unisonEnabled = getBooleanParam(draft, "unison.enabled");
  const unisonWaveform = useMemo(
    () => renderAetherOutputPreviewSamples(previewInstrument, 160, "mix"),
    [previewInstrument],
  );

  return (
    <section className={styles.panel} aria-label="Oscillator">
      <div className={styles.body}>
        <OscillatorRow oscillator="a" previewInstrument={previewInstrument} />
        <OscillatorRow oscillator="b" previewInstrument={previewInstrument} />
        <div className={`${styles.row} ${unisonEnabled ? "" : styles.disabledRow}`} aria-label="Voice stack row">
          <div className="ds-section-header">
            <div className="ds-section-title">Voice Stack</div>
            <div className={styles.sectionActions}>
              <Button
                iconOnly
                size="xs"
                selected={unisonEnabled}
                aria-label={`${unisonEnabled ? "Disable" : "Enable"} voice stack`}
                onClick={() => setBooleanParameter("unison.enabled", !unisonEnabled)}
              >
                <Icon name={unisonEnabled ? "ph:power-fill" : "ph:power"} size={12} decorative />
              </Button>
            </div>
          </div>
          <div className={styles.rowMain}>
            <div className={`${styles.settingsPane} ${styles.unisonSettingsPane}`}>
              <div className={styles.unisonBody}>
                <div className={`${styles.rowKnobs} ${styles.unisonKnobs}`}>
                  {(
                    [
                      ["unison.voices", "Voices", 1, 16, 1, 1],
                      ["unison.detune", "Detune", 0, 1, 0.01, 0.12],
                      ["unison.blend", "Blend", 0, 1, 0.01, 0.75],
                      ["unison.spread", "Spread", 0, 1, 0.01, 0.5],
                    ] as Array<[SynthParameterId, string, number, number, number, number]>
                  ).map(([id, label, min, max, step, defaultValue]) => (
                    <Knob
                      key={id}
                      size="sm"
                      label={label}
                      value={getNumberParam(draft, id)}
                      min={min}
                      max={max}
                      step={step}
                      defaultValue={defaultValue}
                      {...modulationPropsForTarget(draft, id)}
                      pickTargetId={MODULATABLE_TARGETS.has(id) ? id : undefined}
                      formatValue={id === "unison.voices" ? (value) => Math.round(value).toString() : formatPercent}
                      parseValue={id === "unison.voices" ? undefined : parsePercent}
                      onChange={(value) => setNumericParameter(id, value)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <WaveformPreview
              label="Voice stack waveform"
              samples={unisonWaveform}
              disabled={!unisonEnabled}
              voices={Math.round(getNumberParam(draft, "unison.voices"))}
              spread={getNumberParam(draft, "unison.spread")}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function OscillatorRow({
  oscillator,
  previewInstrument,
}: {
  oscillator: OscillatorKey;
  previewInstrument: ReturnType<typeof synthDraftToPreviewInstrument>;
}) {
  const draft = useSynthStore((state) => state.draft);
  const setParameter = useSynthStore((state) => state.setParameter);
  const setNumericParameter = useSynthStore((state) => state.setNumericParameter);
  const setBooleanParameter = useSynthStore((state) => state.setBooleanParameter);
  const updateCustomWavetableFrame = useSynthStore((state) => state.updateCustomWavetableFrame);
  const enabledId = oscParam(oscillator, "enabled");
  const enabled = getBooleanParam(draft, enabledId);
  const wavetableId = oscParam(oscillator, "wavetable");
  const selectedWavetable = getStringParam(draft, wavetableId) as WavetableId;
  const customTableId = selectedWavetable.startsWith("user.") ? selectedWavetable : DEFAULT_CUSTOM_WAVETABLE_ID;
  const customTable = draft.metadata.customWavetables?.[customTableId] ?? createDefaultCustomWavetable(customTableId);
  const label = `Oscillator ${oscillator.toUpperCase()}`;
  const waveform = useMemo(
    () => renderAetherOutputPreviewSamples(previewInstrument, 160, oscillator),
    [oscillator, previewInstrument],
  );

  return (
    <div className={`${styles.row} ${enabled ? "" : styles.disabledRow}`} aria-label={`${label} row`}>
      <div className="ds-section-header">
        <div className="ds-section-title">{label}</div>
        <div className={styles.sectionActions}>
          <Button
            iconOnly
            size="xs"
            selected={enabled}
            aria-label={`${enabled ? "Disable" : "Enable"} ${label}`}
            onClick={() => setBooleanParameter(enabledId, !enabled)}
          >
            <Icon name={enabled ? "ph:power-fill" : "ph:power"} size={12} decorative />
          </Button>
        </div>
      </div>
      {enabled && (
        <div className={styles.rowMain}>
          <div className={styles.settingsPane}>
            <div className={styles.rowBody}>
              <WavetableShapeButtons
                value={selectedWavetable}
                onChange={(value) => setParameter(wavetableId, value)}
              />
              <div className={styles.rowKnobs}>
                {OSC_PARAMS.map((param) => {
                  const id = oscParam(oscillator, param.suffix);
                  return (
                    <Knob
                      key={id}
                      size="sm"
                      label={param.label}
                      value={getNumberParam(draft, id)}
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      defaultValue={param.defaultValue}
                      bipolar={param.bipolar}
                      {...modulationPropsForTarget(draft, id)}
                      pickTargetId={MODULATABLE_TARGETS.has(id) ? id : undefined}
                      formatValue={formatValue(param.suffix)}
                      parseValue={param.suffix === "position" || param.suffix === "level" || param.suffix === "pan" ? parsePercent : undefined}
                      onChange={(value) => setNumericParameter(id, value)}
                    />
                  );
                })}
              </div>
            </div>
            {selectedWavetable.startsWith("user.") && (
              <div className={styles.customEditor} aria-label={`${label} custom wavetable frames`}>
                <div className="ds-section-header">
                  <div className="ds-section-title">{customTable.name} Frame Editor</div>
                </div>
                <div className={styles.customFrames}>
                  {customTable.frames.map((frame, index) => (
                    <div key={`${customTable.id}-${index}`} className={styles.customFrame}>
                      <div className={styles.frameLabel}>{CUSTOM_WAVETABLE_FRAME_LABELS[index] ?? index + 1}</div>
                      <MiniWaveform samples={renderCustomFramePreview(frame)} />
                      <Knob
                        size="sm"
                        label="Bright"
                        value={frame.brightness}
                        min={0}
                        max={1}
                        step={0.01}
                        defaultValue={createDefaultCustomWavetable(customTable.id).frames[index]?.brightness ?? 0.5}
                        formatValue={formatPercent}
                        parseValue={parsePercent}
                        onChange={(brightness) => updateCustomWavetableFrame(customTable.id, index, { brightness })}
                      />
                      <Knob
                        size="sm"
                        label="Even"
                        value={frame.even}
                        min={0}
                        max={1}
                        step={0.01}
                        defaultValue={createDefaultCustomWavetable(customTable.id).frames[index]?.even ?? 0.2}
                        formatValue={formatPercent}
                        parseValue={parsePercent}
                        onChange={(even) => updateCustomWavetableFrame(customTable.id, index, { even })}
                      />
                      <Knob
                        size="sm"
                        label="Fold"
                        value={frame.fold}
                        min={0}
                        max={1}
                        step={0.01}
                        defaultValue={createDefaultCustomWavetable(customTable.id).frames[index]?.fold ?? 0.1}
                        formatValue={formatPercent}
                        parseValue={parsePercent}
                        onChange={(fold) => updateCustomWavetableFrame(customTable.id, index, { fold })}
                      />
                      <Knob
                        size="sm"
                        label="Phase"
                        value={frame.phase}
                        min={-1}
                        max={1}
                        step={0.01}
                        defaultValue={createDefaultCustomWavetable(customTable.id).frames[index]?.phase ?? 0}
                        bipolar
                        formatValue={(value) => `${Math.round(value * 100)}`}
                        parseValue={parsePercent}
                        onChange={(phase) => updateCustomWavetableFrame(customTable.id, index, { phase })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <WaveformPreview label={`${label} Waveform`} samples={waveform} disabled={!enabled} />
        </div>
      )}
    </div>
  );
}

function MiniWaveform({ samples }: { samples: number[] }) {
  const path = makeWaveformPath(samples);
  return (
    <svg className={styles.frameWaveform} viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
      <line className={styles.zeroLine} x1="0" y1="24" x2="100" y2="24" />
      {path && <path className={styles.frameWaveformPath} d={path} />}
    </svg>
  );
}

function WaveformPreview({
  label,
  samples,
  disabled = false,
  voices = 1,
  spread = 0,
}: {
  label: string;
  samples: number[];
  disabled?: boolean;
  voices?: number;
  spread?: number;
}) {
  const path = makeWaveformPath(samples);
  const secondaryPath = voices > 1 ? makeWaveformPath(samples, Math.min(8, Math.max(2, voices)) * 0.16 * spread) : "";
  const tertiaryPath = voices > 2 ? makeWaveformPath(samples, -Math.min(8, Math.max(2, voices)) * 0.12 * spread) : "";

  return (
    <div className={`${styles.previewPane} ${disabled ? styles.previewPaneDisabled : ""}`} aria-label={label}>
      <svg className={styles.previewSvg} viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
        <line className={styles.zeroLine} x1="0" y1="24" x2="100" y2="24" />
        {tertiaryPath && <path className={styles.previewGhostPath} d={tertiaryPath} />}
        {secondaryPath && <path className={styles.previewGhostPath} d={secondaryPath} />}
        {path && <path className={styles.previewPath} d={path} />}
      </svg>
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

function WavetableShapeButtons({ value, onChange }: { value: WavetableId; onChange: (value: WavetableId) => void }) {
  const selected = FACTORY_WAVETABLES.find((table) => table.id === value);

  return (
    <div className={styles.wavetableControl}>
      <div className={styles.wavetableButtons} role="radiogroup" aria-label="Wavetable">
        {FACTORY_WAVETABLES.map((table) => {
          const active = table.id === value;
          return (
            <HoverInfo content={table.label} key={table.id}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={table.label}
                className={`${styles.wavetableButton} ${active ? styles.wavetableButtonActive : ""}`}
                onClick={() => onChange(table.id)}
              >
                <Icon name={WAVETABLE_ICONS[table.id] ?? "ph:waveform"} size={12} decorative />
              </button>
            </HoverInfo>
          );
        })}
      </div>
      <span className={styles.wavetableSelectedLabel}>{selected?.label ?? value}</span>
      <span className={styles.wavetableControlLabel}>Wavetable</span>
    </div>
  );
}

function renderCustomFramePreview(frame: CustomWavetableFrame, sampleCount = 96): number[] {
  const samples: number[] = [];
  let peak = 0;
  for (let index = 0; index < sampleCount; index++) {
    const phase = index / sampleCount;
    let sample = 0;
    for (let harmonic = 1; harmonic <= 32; harmonic++) {
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
