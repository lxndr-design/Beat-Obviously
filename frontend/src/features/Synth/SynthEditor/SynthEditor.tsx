import { Button, Knob } from "../../../components";
import {
  getNumberParam,
  SYNTH_INSTRUMENT_TYPE,
  SYNTH_PATCH_SCHEMA_VERSION,
  useSynthStore,
  type SynthParameterId,
} from "../../../state/synthStore";
import { AnalyzerPanel } from "../AnalyzerPanel";
import { ModulationMatrix } from "../ModulationMatrix";
import { OscillatorPanel } from "../OscillatorPanel";
import styles from "./SynthEditor.module.css";

const MACRO_IDS = ["macro.1", "macro.2", "macro.3", "macro.4"] as const;

export function SynthEditor() {
  const draft = useSynthStore((state) => state.draft);
  const resetDraft = useSynthStore((state) => state.resetDraft);
  const setNumericParameter = useSynthStore((state) => state.setNumericParameter);

  return (
    <section className={`ds-editor-shell ds-fill ${styles.shell}`} aria-label="Synth editor">
      <header className={`ds-toolbar ds-inset-x-1 ${styles.header}`}>
        <div className={styles.titleGroup}>
          <div className={styles.title}>{draft.name}</div>
          <div className={styles.meta}>
            {SYNTH_INSTRUMENT_TYPE} · schema {SYNTH_PATCH_SCHEMA_VERSION}
          </div>
        </div>
        <div className="ds-toolbar-spacer" />
        <Button size="sm" onClick={resetDraft}>
          Init
        </Button>
      </header>

      <div className={`ds-editor-body ds-scroll ${styles.body}`}>
        <div className={styles.topGrid}>
          <OscillatorPanel />
          <AnalyzerPanel />
        </div>

        <section className={`ds-panel ${styles.macroPanel}`} aria-label="Macros">
          <header className="ds-panel-header">
            <div className="ds-panel-title">Macros</div>
          </header>
          <div className={`ds-panel-body ${styles.macros}`}>
            {MACRO_IDS.map((id, index) => (
              <Knob
                key={id}
                size="sm"
                label={`Macro ${index + 1}`}
                value={getNumberParam(draft, id)}
                min={0}
                max={1}
                step={0.01}
                defaultValue={0}
                formatValue={formatPercent}
                onChange={(value) => setNumericParameter(id, value)}
              />
            ))}
          </div>
        </section>

        <div className={styles.bottomGrid}>
          <AmpFilterPanel />
          <ModulationMatrix />
        </div>
      </div>
    </section>
  );
}

function AmpFilterPanel() {
  const draft = useSynthStore((state) => state.draft);
  const setNumericParameter = useSynthStore((state) => state.setNumericParameter);
  const setBooleanParameter = useSynthStore((state) => state.setBooleanParameter);
  const setParameter = useSynthStore((state) => state.setParameter);

  return (
    <section className="ds-panel" aria-label="Amp and filter">
      <header className="ds-panel-header">
        <div className="ds-panel-title">Amp / Filter</div>
      </header>
      <div className={`ds-panel-body ${styles.controlGrid}`}>
        <label className="ds-field-inline">
          <span className="ds-field-label">Filter</span>
          <select
            className="ds-select"
            value={String(draft.parameters["filter.type"])}
            onChange={(event) => setParameter("filter.type", event.currentTarget.value)}
          >
            <option value="lowpass">Lowpass</option>
            <option value="highpass">Highpass</option>
            <option value="bandpass">Bandpass</option>
            <option value="notch">Notch</option>
          </select>
        </label>
        <Button
          size="sm"
          selected={draft.parameters["filter.enabled"] === true}
          onClick={() => setBooleanParameter("filter.enabled", draft.parameters["filter.enabled"] !== true)}
        >
          Filter On
        </Button>
        <Knob
          size="sm"
          label="Cutoff"
          value={getNumberParam(draft, "filter.cutoff")}
          min={20}
          max={20000}
          step={10}
          unit="Hz"
          defaultValue={18000}
          formatValue={(value) => Math.round(value).toString()}
          onChange={(value) => setNumericParameter("filter.cutoff", value)}
        />
        {(
          [
            ["filter.resonance", "Res", 0.1, false],
            ["filter.drive", "Drive", 0, false],
            ["amp.level", "Level", 0.8, false],
            ["amp.pan", "Pan", 0, true],
            ["env.1.attack", "Attack", 0.005, false],
            ["env.1.decay", "Decay", 0.15, false],
            ["env.1.sustain", "Sustain", 0.8, false],
            ["env.1.release", "Release", 0.25, false],
          ] as Array<[SynthParameterId, string, number, boolean]>
        ).map(([id, label, defaultValue, bipolar]) => (
          <Knob
            key={id}
            size="sm"
            label={label}
            value={getNumberParam(draft, id)}
            min={bipolar ? -1 : 0}
            max={id.includes("env.1") && id !== "env.1.sustain" ? 30 : 1}
            step={id.includes("env.1") && id !== "env.1.sustain" ? 0.001 : 0.01}
            defaultValue={defaultValue}
            bipolar={bipolar}
            formatValue={id.includes("env.1") && id !== "env.1.sustain" ? formatSeconds : formatPercent}
            onChange={(value) => setNumericParameter(id, value)}
          />
        ))}
      </div>
    </section>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}`;
}

function formatSeconds(value: number): string {
  return value < 1 ? `${Math.round(value * 1000)}ms` : `${value.toFixed(2)}s`;
}
