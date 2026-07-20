import { createMemo, createSignal, For, onCleanup } from "solid-js";
import { Button, FloatingSelect, Icon, NumberInput, Slider, TextInput, Toggle } from "../../solid-ui";
import { startInstrumentPreviewAudition, type InstrumentPreviewAuditionHandle } from "../../audio/synthPreview";
import { AURUM_OPERATOR_COUNT, AURUM_OUTPUT_COLUMN, normalizedAurumConfig } from "../../state/aurum";
import type { AurumOperatorConfig, AurumOperatorWaveform, Instrument } from "../../state/types";
import styles from "./AurumEditor.module.css";

const WAVEFORM_OPTIONS = ["sine", "triangle", "saw", "square"].map((value) => ({
  value,
  label: value[0].toUpperCase() + value.slice(1),
}));

export interface AurumEditorProps {
  instrument: Instrument;
  onCommit: (instrument: Instrument) => void;
  onClose: () => void;
}

export function AurumEditor(props: AurumEditorProps) {
  const [draft, setDraft] = createSignal(cloneInstrument(props.instrument), { equals: false });
  const [selectedOperator, setSelectedOperator] = createSignal(0);
  const [waveformOpen, setWaveformOpen] = createSignal(false);
  const [auditioning, setAuditioning] = createSignal(false);
  let audition: InstrumentPreviewAuditionHandle | null = null;

  const aurum = createMemo(() => normalizedAurumConfig(draft().aurum));
  const operator = createMemo(() => aurum().operators[selectedOperator()]);

  onCleanup(stopAudition);

  function updateAurum(mutator: (config: ReturnType<typeof aurum>) => ReturnType<typeof aurum>) {
    setDraft((current) => ({ ...current, aurum: mutator(normalizedAurumConfig(current.aurum)) }));
  }

  function updateOperator(patch: Partial<AurumOperatorConfig>) {
    const index = selectedOperator();
    updateAurum((config) => ({
      ...config,
      operators: config.operators.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...patch } : candidate),
    }));
  }

  function updateEnvelope(patch: Partial<AurumOperatorConfig["envelope"]>) {
    updateOperator({ envelope: { ...operator().envelope, ...patch } });
  }

  function updateMatrix(source: number, target: number, value: number) {
    updateAurum((config) => ({
      ...config,
      matrix: config.matrix.map((row, rowIndex) => rowIndex === source
        ? row.map((cell, columnIndex) => columnIndex === target ? value : cell)
        : row),
    }));
  }

  function toggleAudition() {
    if (audition) {
      stopAudition();
      return;
    }
    setAuditioning(true);
    audition = startInstrumentPreviewAudition(draft(), 2.4, 0.22, 120, 104, () => {
      audition = null;
      setAuditioning(false);
    });
  }

  function stopAudition() {
    audition?.stop();
    audition = null;
    setAuditioning(false);
  }

  function save() {
    stopAudition();
    props.onCommit({ ...draft(), aurum: aurum() });
  }

  return (
    <div class={styles.editor}>
      <header class={styles.header}>
        <div class={styles.identity}>
          <span class={styles.mark}>AU</span>
          <div>
            <h2>Aurum</h2>
            <p>Six-operator frequency modulation</p>
          </div>
        </div>
        <TextInput
          className={styles.nameInput}
          label="Patch"
          layout="inline"
          value={draft().name}
          onInput={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))}
        />
      </header>

      <main class={styles.body}>
        <section class={styles.operatorSection}>
          <div class={styles.operatorTabs} role="tablist" aria-label="Aurum operators">
            <For each={aurum().operators}>{(candidate, index) => (
              <Button
                size="sm"
                selected={selectedOperator() === index()}
                className={candidate.enabled ? styles.operatorActive : styles.operatorMuted}
                onClick={() => setSelectedOperator(index())}
              >
                {candidate.name}
              </Button>
            )}</For>
          </div>

          <div class={styles.operatorPanel}>
            <div class={styles.operatorHeading}>
              <h3>{operator().name}</h3>
              <Toggle label="Enabled" checked={operator().enabled} onChange={(enabled) => updateOperator({ enabled })} />
            </div>
            <div class={styles.controlGrid}>
              <FloatingSelect
                label="Wave"
                layout="inline"
                value={operator().waveform}
                options={WAVEFORM_OPTIONS}
                open={waveformOpen()}
                onOpenChange={setWaveformOpen}
                onChange={(waveform) => updateOperator({ waveform: waveform as AurumOperatorWaveform })}
              />
              <NumberInput label="Ratio" layout="inline" min={0.125} max={32} step={0.125} value={operator().ratio} onChange={(ratio) => updateOperator({ ratio })} />
              <NumberInput label="Coarse" layout="inline" min={-48} max={48} step={1} unit="st" value={operator().coarse} onChange={(coarse) => updateOperator({ coarse })} />
              <NumberInput label="Fine" layout="inline" min={-100} max={100} step={1} unit="ct" value={operator().fineCents} onChange={(fineCents) => updateOperator({ fineCents })} />
              <Slider label="Level" layout="inline" min={0} max={1} step={0.01} value={operator().level} readout={<span>{Math.round(operator().level * 100)}%</span>} onChange={(level) => updateOperator({ level })} />
              <Slider label="Phase" layout="inline" min={0} max={1} step={0.01} value={operator().phase} readout={<span>{Math.round(operator().phase * 360)}°</span>} onChange={(phase) => updateOperator({ phase })} />
            </div>
            <div class={styles.envelopeGrid}>
              <NumberInput label="Attack" layout="inline" min={0} max={10000} step={1} unit="ms" value={operator().envelope.attackMs} onChange={(attackMs) => updateEnvelope({ attackMs })} />
              <NumberInput label="Decay" layout="inline" min={0} max={10000} step={1} unit="ms" value={operator().envelope.decayMs} onChange={(decayMs) => updateEnvelope({ decayMs })} />
              <Slider label="Sustain" layout="inline" min={0} max={1} step={0.01} value={operator().envelope.sustain} readout={<span>{Math.round(operator().envelope.sustain * 100)}%</span>} onChange={(sustain) => updateEnvelope({ sustain })} />
              <NumberInput label="Release" layout="inline" min={0} max={10000} step={1} unit="ms" value={operator().envelope.releaseMs} onChange={(releaseMs) => updateEnvelope({ releaseMs })} />
            </div>
          </div>
        </section>

        <section class={styles.matrixSection}>
          <div class={styles.sectionTitle}>
            <div>
              <h3>Operator Matrix</h3>
              <p>Rows modulate columns. Diagonal cells are feedback.</p>
            </div>
          </div>
          <div class={styles.matrix} role="group" aria-label="Aurum operator routing matrix">
            <span />
            <For each={aurum().operators}>{(candidate) => <span class={styles.matrixHeader}>{candidate.name}</span>}</For>
            <span class={`${styles.matrixHeader} ${styles.outputHeader}`}>OUT</span>
            <For each={aurum().operators}>{(source, sourceIndex) => (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  selected={selectedOperator() === sourceIndex()}
                  className={styles.matrixRowLabel}
                  onClick={() => setSelectedOperator(sourceIndex())}
                >
                  {source.name}
                </Button>
                <For each={Array.from({ length: AURUM_OPERATOR_COUNT + 1 })}>{(_, targetIndex) => {
                  const value = () => aurum().matrix[sourceIndex()][targetIndex()] ?? 0;
                  const feedback = () => sourceIndex() === targetIndex();
                  const output = () => targetIndex() === AURUM_OUTPUT_COLUMN;
                  return (
                    <div class={`${styles.matrixCell} ${feedback() ? styles.feedbackCell : ""} ${output() ? styles.outputCell : ""}`} data-active={value() > 0.001}>
                      <Slider
                        layout="bare"
                        min={0}
                        max={1}
                        step={0.01}
                        value={value()}
                        ariaLabel={`${source.name} ${feedback() ? "feedback" : output() ? "to output" : `to ${aurum().operators[targetIndex()].name}`}`}
                        onChange={(next) => updateMatrix(sourceIndex(), targetIndex(), next)}
                      />
                      <span>{Math.round(value() * 100)}</span>
                    </div>
                  );
                }}</For>
              </>
            )}</For>
          </div>
        </section>

        <section class={styles.globalSection}>
          <h3>Global</h3>
          <div class={styles.globalGrid}>
            <NumberInput label="Voices" layout="inline" min={1} max={8} step={1} value={aurum().unison} onChange={(unison) => updateAurum((config) => ({ ...config, unison: Math.round(unison) }))} />
            <NumberInput label="Detune" layout="inline" min={0} max={100} step={1} unit="ct" value={aurum().detuneCents} onChange={(detuneCents) => updateAurum((config) => ({ ...config, detuneCents }))} />
            <Slider label="Spread" layout="inline" min={0} max={1} step={0.01} value={aurum().stereoSpread} readout={<span>{Math.round(aurum().stereoSpread * 100)}%</span>} onChange={(stereoSpread) => updateAurum((config) => ({ ...config, stereoSpread }))} />
            <Slider label="Cutoff" layout="inline" min={0} max={1} step={0.01} value={draft().knobs.cutoff} readout={<span>{Math.round(draft().knobs.cutoff * 100)}%</span>} onChange={(cutoff) => setDraft((current) => ({ ...current, knobs: { ...current.knobs, cutoff } }))} />
            <Slider label="Resonance" layout="inline" min={0} max={1} step={0.01} value={draft().knobs.resonance} readout={<span>{Math.round(draft().knobs.resonance * 100)}%</span>} onChange={(resonance) => setDraft((current) => ({ ...current, knobs: { ...current.knobs, resonance } }))} />
            <Slider label="Drive" layout="inline" min={0} max={1} step={0.01} value={draft().knobs.drive} readout={<span>{Math.round(draft().knobs.drive * 100)}%</span>} onChange={(drive) => setDraft((current) => ({ ...current, knobs: { ...current.knobs, drive } }))} />
          </div>
        </section>
      </main>

      <footer class={styles.footer}>
        <Button variant="ghost" selected={auditioning()} onClick={toggleAudition}>
          <Icon name={auditioning() ? "ph:stop-fill" : "ph:play-fill"} size={18} decorative />
          {auditioning() ? "Stop" : "Audition"}
        </Button>
        <div class={styles.footerActions}>
          <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </div>
      </footer>
    </div>
  );
}

function cloneInstrument(instrument: Instrument): Instrument {
  return typeof structuredClone === "function" ? structuredClone(instrument) : JSON.parse(JSON.stringify(instrument));
}
