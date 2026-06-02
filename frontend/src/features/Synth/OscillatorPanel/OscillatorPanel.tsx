import { Button, Knob } from "../../../components";
import {
  FACTORY_WAVETABLES,
  getBooleanParam,
  getNumberParam,
  getStringParam,
  useSynthStore,
  type OscillatorKey,
  type SynthParameterId,
  type WavetableId,
} from "../../../state/synthStore";
import styles from "./OscillatorPanel.module.css";

const OSC_PARAMS: Array<{
  suffix: "position" | "level" | "pan" | "octave" | "semitone" | "fine" | "phase" | "randomPhase";
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
  { suffix: "phase", label: "Phase", min: 0, max: 1, step: 0.01, defaultValue: 0 },
  { suffix: "randomPhase", label: "Random", min: 0, max: 1, step: 0.01, defaultValue: 0.25 },
];

export function OscillatorPanel() {
  const draft = useSynthStore((state) => state.draft);
  const selected = useSynthStore((state) => state.selectedOscillator);
  const setSelected = useSynthStore((state) => state.setSelectedOscillator);
  const setParameter = useSynthStore((state) => state.setParameter);
  const setNumericParameter = useSynthStore((state) => state.setNumericParameter);
  const setBooleanParameter = useSynthStore((state) => state.setBooleanParameter);

  const enabledId = oscParam(selected, "enabled");
  const wavetableId = oscParam(selected, "wavetable");

  return (
    <section className="ds-panel" aria-label="Oscillator">
      <header className="ds-panel-header">
        <div className="ds-panel-title">Oscillator</div>
        <div className="ds-panel-actions">
          {(["a", "b"] as OscillatorKey[]).map((id) => (
            <Button key={id} size="xs" selected={selected === id} onClick={() => setSelected(id)}>
              OSC {id.toUpperCase()}
            </Button>
          ))}
        </div>
      </header>
      <div className={`ds-panel-body ${styles.body}`}>
        <div className={styles.strip}>
          <Button
            size="sm"
            selected={getBooleanParam(draft, enabledId)}
            onClick={() => setBooleanParameter(enabledId, !getBooleanParam(draft, enabledId))}
          >
            Enabled
          </Button>
          <label className="ds-field-inline">
            <span className="ds-field-label">Wavetable</span>
            <select
              className="ds-select"
              value={getStringParam(draft, wavetableId)}
              onChange={(event) => setParameter(wavetableId, event.currentTarget.value as WavetableId)}
            >
              {FACTORY_WAVETABLES.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.knobs}>
          {OSC_PARAMS.map((param) => {
            const id = oscParam(selected, param.suffix);
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
                formatValue={formatValue(param.suffix)}
                onChange={(value) => setNumericParameter(id, value)}
              />
            );
          })}
        </div>

        <div className={styles.unison}>
          <div className="ds-section-header">
            <div className="ds-section-title">Unison</div>
          </div>
          <div className={styles.knobs}>
            <Button
              size="sm"
              selected={getBooleanParam(draft, "unison.enabled")}
              onClick={() => setBooleanParameter("unison.enabled", !getBooleanParam(draft, "unison.enabled"))}
            >
              Enabled
            </Button>
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
                formatValue={id === "unison.voices" ? (value) => Math.round(value).toString() : formatPercent}
                onChange={(value) => setNumericParameter(id, value)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
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
