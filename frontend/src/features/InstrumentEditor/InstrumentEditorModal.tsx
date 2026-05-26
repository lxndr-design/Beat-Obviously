import { useEffect, useState } from "react";
import { Modal, Button, FloatingSelect, HoverInfo, Icon, Knob, NumberInput, TextInput, useModalStack } from "../../components";
import { useAudioFileStore, useInstrumentStore, useUiStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import type { Instrument } from "../../state/types";
import { WaveformPicker } from "./WaveformPicker";
import { InstrumentWaveformPreview } from "./InstrumentWaveformPreview";
import styles from "./InstrumentEditorModal.module.css";

interface Props {
  instrumentId: string;
}

type LfoWaveform = NonNullable<Instrument["lfoWaveform"]>;

const LFO_WAVEFORMS: Array<{ value: LfoWaveform; icon: string; label: string }> = [
  { value: "sine", icon: "ph:wave-sine", label: "Sine" },
  { value: "triangle", icon: "ph:wave-triangle", label: "Triangle" },
  { value: "saw", icon: "ph:wave-sawtooth", label: "Saw" },
  { value: "square", icon: "ph:wave-square", label: "Square" },
];

/**
 * InstrumentEditorModal — edit a single instrument.
 *
 * Layout uses a unified 2-column CSS grid so every row aligns:
 *
 *   ┌──── Name ────┬──── Type ────┐
 *   │ inline field │ inline field │
 *   ├──── Macros ──┼─── Envelope ─┤
 *   │   4 knobs    │   A·D·S·R    │
 *   ├──── Oscillator (span 2) ────┤
 *   │ Waveform radios + knobs     │
 *   ├──── Modulation  (span 2) ───┤
 *   │ LFO rate / depth + glide    │
 *   ├──── Samples (sampler/hybrid)┤
 *   ├──── Lineage (if merged) ────┤
 *   └─────────────────────────────┘
 */
export function InstrumentEditorModal({ instrumentId }: Props) {
  const source = useInstrumentStore((s) =>
    s.instruments.find((i) => i.id === instrumentId),
  );
  const update = useInstrumentStore((s) => s.updateInstrument);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const requestDirtyClose = useModalStack((s) => s.requestDirtyClose);
  const addAudioFile = useAudioFileStore((s) => s.addFile);
  const id = `instrument-${instrumentId}`;

  const [draft, setDraft] = useState<Instrument | undefined>(source);
  const [typeOpen, setTypeOpen] = useState(false);

  useEffect(() => {
    if (source && !draft) setDraft(structuredClone(source));
  }, [source, draft]);

  if (!draft || !source) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(source);
  const showOscillator = draft.kind === "synth" || draft.kind === "hybrid";
  const showSamples = draft.kind === "sampler" || draft.kind === "hybrid";

  function save() {
    update(instrumentId, draft!);
    closeEditor({ kind: "instrument", instrumentId });
  }
  function close() {
    closeEditor({ kind: "instrument", instrumentId });
  }
  function onClose() {
    if (dirty) requestDirtyClose(id, save, close);
    else close();
  }

  async function uploadSample() {
    const resp = await send({ kind: "audio.import" });
    if (!resp.file) return;
    addAudioFile(resp.file);
    setDraft({
      ...draft!,
      sampleIds: Array.from(new Set([...draft!.sampleIds, resp.file.id])),
      kind: draft!.kind === "synth" ? "hybrid" : draft!.kind,
      waveform: draft!.waveform === "sample" ? "sample" : draft!.waveform,
    });
  }

  return (
    <Modal
      open
      scopeId={id}
      title={`Edit instrument · ${draft.name}`}
      width="lg"
      dirty={dirty}
      onClose={onClose}
      onRequestCloseDirty={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!dirty} onClick={save}>Save</Button>
        </>
      }
    >
      <div className={styles.grid}>
        <InstrumentWaveformPreview instrument={draft} hotkeyScopeId={id} />

        {/* Row 1 — inline Name + Type fields, each one column. */}
        <TextInput
          label="Name"
          layout="inline"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <FloatingSelect
          label="Type"
          layout="inline"
          value={draft.kind}
          ariaLabel="Instrument type"
          options={[
            { value: "synth", label: "Synth" },
            { value: "sampler", label: "Sampler" },
            { value: "hybrid", label: "Hybrid" },
          ]}
          open={typeOpen}
          onOpenChange={setTypeOpen}
          onChange={(kind) => setDraft({ ...draft, kind: kind as Instrument["kind"] })}
        />

        {/* Row 2 — Macros (col 1) + Envelope (col 2). */}
        <section className={styles.section}>
          <h3 className={styles.sectionHeading}>Macros</h3>
          <div className={styles.fourCol}>
            <Knob
              size="sm"
              value={draft.knobs.cutoff}
              min={0} max={1} step={0.01}
              unit="%"
              label="Cut"
              formatValue={formatPercent}
              parseValue={parsePercent}
              onChange={(v) => setDraft({ ...draft, knobs: { ...draft.knobs, cutoff: v } })}
            />
            <Knob
              size="sm"
              value={draft.knobs.resonance}
              min={0} max={1} step={0.01}
              unit="%"
              label="Res"
              formatValue={formatPercent}
              parseValue={parsePercent}
              onChange={(v) => setDraft({ ...draft, knobs: { ...draft.knobs, resonance: v } })}
            />
            <Knob
              size="sm"
              value={draft.knobs.drive}
              min={0} max={1} step={0.01}
              unit="%"
              label="Drv"
              formatValue={formatPercent}
              parseValue={parsePercent}
              onChange={(v) => setDraft({ ...draft, knobs: { ...draft.knobs, drive: v } })}
            />
            <Knob
              size="sm"
              value={draft.knobs.color}
              min={0} max={1} step={0.01}
              unit="%"
              label="Shape"
              formatValue={formatPercent}
              parseValue={parsePercent}
              onChange={(v) => setDraft({ ...draft, knobs: { ...draft.knobs, color: v } })}
            />
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionHeading}>Envelope</h3>
          <div className={styles.fourCol}>
            <NumberInput
              label="Attack" unit="ms"
              value={draft.envelope.attackMs}
              min={0} max={5000} step={1}
              onChange={(v) => setDraft({ ...draft, envelope: { ...draft.envelope, attackMs: v } })}
            />
            <NumberInput
              label="Decay" unit="ms"
              value={draft.envelope.decayMs}
              min={0} max={5000} step={1}
              onChange={(v) => setDraft({ ...draft, envelope: { ...draft.envelope, decayMs: v } })}
            />
            <NumberInput
              label="Sustain" unit="%"
              value={Math.round(draft.envelope.sustain * 100)}
              min={0} max={100} step={1}
              onChange={(v) => setDraft({ ...draft, envelope: { ...draft.envelope, sustain: v / 100 } })}
            />
            <NumberInput
              label="Release" unit="ms"
              value={draft.envelope.releaseMs}
              min={0} max={10000} step={1}
              onChange={(v) => setDraft({ ...draft, envelope: { ...draft.envelope, releaseMs: v } })}
            />
          </div>
        </section>

        {/* Oscillator — spans both columns. */}
        {showOscillator && (
          <section className={`${styles.section} ${styles.spanFull}`}>
            <h3 className={styles.sectionHeading}>Oscillator</h3>
            <div className={styles.oscRow}>
              <WaveformPicker
                value={draft.waveform}
                allowSample={draft.kind === "hybrid"}
                onChange={(w) => setDraft({ ...draft, waveform: w })}
              />
              <div className={styles.fourCol}>
                <Knob
                  size="sm"
                  bipolar
                  value={draft.detuneCents ?? 0}
                  min={-100} max={100} step={1}
                  unit="ct"
                  label="Detune"
                  formatValue={formatInteger}
                  onChange={(v) => setDraft({ ...draft, detuneCents: v })}
                />
                <Knob
                  size="sm"
                  bipolar
                  label="Oct"
                  value={draft.octave ?? 0}
                  min={-3} max={3} step={1}
                  formatValue={formatInteger}
                  onChange={(v) => setDraft({ ...draft, octave: v })}
                />
                <Knob
                  size="sm"
                  value={draft.subOscLevel ?? 0}
                  min={0} max={1} step={0.01}
                  unit="%"
                  label="Sub"
                  formatValue={formatPercent}
                  parseValue={parsePercent}
                  onChange={(v) => setDraft({ ...draft, subOscLevel: v })}
                />
                <GlideSlider
                  value={draft.glideMs ?? 0}
                  onChange={(v) => setDraft({ ...draft, glideMs: v })}
                />
              </div>
            </div>
          </section>
        )}

        {/* Modulation — spans both columns. */}
        {showOscillator && (
          <section className={`${styles.section} ${styles.spanFull}`}>
            <h3 className={styles.sectionHeading}>Modulation</h3>
            <div className={styles.modGrid}>
              <LfoShapePicker
                value={draft.lfoWaveform ?? "sine"}
                onChange={(value) => setDraft({ ...draft, lfoWaveform: value })}
              />
              <VerticalSwitch
                label="Rate"
                top="Sync"
                bottom="Hz"
                checked={draft.lfoSync ?? false}
                onChange={(v) => setDraft({ ...draft, lfoSync: v })}
              />
              <VerticalSwitch
                label="Trigger"
                top="Retrig"
                bottom="Free"
                checked={draft.lfoRetrigger ?? true}
                onChange={(v) => setDraft({ ...draft, lfoRetrigger: v })}
              />
              <Knob
                className={styles.modKnob}
                size="sm"
                value={draft.lfoRateHz ?? 4}
                min={1} max={20} step={1}
                unit="Hz"
                label="LFO Rate"
                formatValue={formatInteger}
                onChange={(v) => setDraft({ ...draft, lfoRateHz: v })}
              />
              <Knob
                className={styles.modKnob}
                size="sm"
                value={draft.lfoDepth ?? 0}
                min={0} max={1} step={0.01}
                unit="%"
                label="LFO Depth"
                formatValue={formatPercent}
                parseValue={parsePercent}
                onChange={(v) => setDraft({ ...draft, lfoDepth: v })}
              />
              <Knob
                className={styles.modKnob}
                size="sm"
                value={draft.lfoToPitch ?? 0}
                min={0} max={12} step={1}
                unit="st"
                label="LFO Pitch"
                formatValue={formatInteger}
                onChange={(v) => setDraft({ ...draft, lfoToPitch: v })}
              />
              <Knob
                className={styles.modKnob}
                size="sm"
                value={draft.lfoToFilter ?? 0}
                min={-1} max={1} step={0.01}
                unit="%"
                bipolar
                label="LFO Filter"
                formatValue={formatPercent}
                parseValue={parsePercent}
                onChange={(v) => setDraft({ ...draft, lfoToFilter: v })}
              />
              <Knob
                className={styles.modKnob}
                size="sm"
                value={draft.envToFilter ?? 0}
                min={-1} max={1} step={0.01}
                unit="%"
                bipolar
                label="Env Filter"
                formatValue={formatPercent}
                parseValue={parsePercent}
                onChange={(v) => setDraft({ ...draft, envToFilter: v })}
              />
            </div>
          </section>
        )}

        {showSamples && (
          <section className={`${styles.section} ${styles.spanFull}`}>
            <h3 className={styles.sectionHeading}>Samples</h3>
            <div className={styles.samplesRow}>
              <span className={styles.hint}>
                {draft.sampleIds.length} sample{draft.sampleIds.length === 1 ? "" : "s"} attached.
              </span>
              <Button size="sm" onClick={uploadSample}>
                Upload sample…
              </Button>
            </div>
          </section>
        )}

        {draft.parentIds && (
          <section className={`${styles.section} ${styles.spanFull}`}>
            <h3 className={styles.sectionHeading}>Lineage</h3>
            <p className={styles.hint}>
              Derived from {draft.parentIds.length} parent instrument
              {draft.parentIds.length === 1 ? "" : "s"}.
            </p>
          </section>
        )}
      </div>
    </Modal>
  );
}

function formatInteger(value: number): string {
  return String(Math.round(value));
}

function formatPercent(value: number): string {
  return String(Math.round(value * 100));
}

function parsePercent(raw: string): number {
  const parsed = parseFloat(raw.replace("%", ""));
  if (Number.isNaN(parsed)) return NaN;
  return raw.includes(".") && Math.abs(parsed) <= 1 ? parsed : parsed / 100;
}

interface GlideSliderProps {
  value: number;
  onChange: (value: number) => void;
}

function GlideSlider({ value, onChange }: GlideSliderProps) {
  const clamped = Math.max(0, Math.min(500, value));

  return (
    <label className={styles.glideSlider}>
      <span className={styles.glideHeader}>
        <span className={styles.glideLabel}>Glide</span>
        <span className={styles.glideValue}>{Math.round(clamped)} ms</span>
      </span>
      <input
        className={styles.glideRange}
        type="range"
        min={0}
        max={500}
        step={1}
        value={clamped}
        aria-label="Glide"
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </label>
  );
}

interface LfoShapePickerProps {
  value: LfoWaveform;
  onChange: (value: LfoWaveform) => void;
}

function LfoShapePicker({ value, onChange }: LfoShapePickerProps) {
  const selected = LFO_WAVEFORMS.find((option) => option.value === value);

  return (
    <div className={styles.lfoShapeControl}>
      <div className={styles.lfoShapeButtons} role="radiogroup" aria-label="LFO shape">
        {LFO_WAVEFORMS.map((option) => (
          <HoverInfo content={option.label} key={option.value}>
            <button
              type="button"
              role="radio"
              aria-checked={value === option.value}
              aria-label={option.label}
              className={`${styles.lfoShapeButton} ${
                value === option.value ? styles.lfoShapeButtonActive : ""
              }`}
              onClick={() => onChange(option.value)}
            >
              <Icon name={option.icon} size={16} decorative />
            </button>
          </HoverInfo>
        ))}
      </div>
      <span className={styles.lfoShapeLabel}>{selected?.label ?? value}</span>
      <span className={styles.switchLabel}>LFO Shape</span>
    </div>
  );
}

interface VerticalSwitchProps {
  label: string;
  top: string;
  bottom: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function VerticalSwitch({ label, top, bottom, checked, onChange }: VerticalSwitchProps) {
  return (
    <div className={styles.switchControl}>
      <span className={`${styles.switchOption} ${checked ? styles.switchOptionActive : ""}`}>
        {top}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`${styles.verticalSwitch} ${checked ? styles.verticalSwitchOn : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.switchBall} />
      </button>
      <span className={`${styles.switchOption} ${!checked ? styles.switchOptionActive : ""}`}>
        {bottom}
      </span>
      <span className={styles.switchLabel}>{label}</span>
    </div>
  );
}
