import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Button, FloatingSelect, Icon, Knob, NumberInput, Slider, TextInput, Toggle } from "../../solid-ui";
import { startInstrumentPreviewAudition, type InstrumentPreviewAuditionHandle } from "../../audio/synthPreview";
import { AURUM_OPERATOR_COUNT, AURUM_OUTPUT_COLUMN, normalizedAurumConfig } from "../../state/aurum";
import type { AurumOperatorConfig, AurumOperatorWaveform, Instrument } from "../../state/types";
import { aurumTabIndexAfterKey } from "./aurumEditorInteraction";
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
  const [selectedPage, setSelectedPage] = createSignal<"main" | "operator">("operator");
  const [matrixMode, setMatrixMode] = createSignal<"fm" | "rm">("fm");
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
    updateAurum((config) => matrixMode() === "fm" ? ({
      ...config,
      matrix: config.matrix.map((row, rowIndex) => rowIndex === source
        ? row.map((cell, columnIndex) => columnIndex === target ? value : cell)
        : row),
    }) : ({
      ...config,
      rmMatrix: config.rmMatrix.map((row, rowIndex) => rowIndex === source
        ? row.map((cell, columnIndex) => columnIndex === target ? value : cell)
        : row),
    }));
  }

  function selectTab(index: number) {
    if (index <= 0) {
      setSelectedPage("main");
      return;
    }
    setSelectedOperator(Math.min(AURUM_OPERATOR_COUNT - 1, index - 1));
    setSelectedPage("operator");
  }

  function handleTabKeyDown(event: KeyboardEvent, currentIndex: number) {
    const nextIndex = aurumTabIndexAfterKey(currentIndex, event.key);
    if (nextIndex === currentIndex && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    selectTab(nextIndex);
    queueMicrotask(() => document.querySelector<HTMLButtonElement>(`[data-aurum-tab="${nextIndex}"]`)?.focus());
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
            <p>Six-operator frequency and ring modulation</p>
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
            <Button
              size="sm"
              selected={selectedPage() === "main"}
              role="tab"
              aria-selected={selectedPage() === "main"}
              aria-controls="aurum-page-panel"
              tabIndex={selectedPage() === "main" ? 0 : -1}
              data-aurum-tab="0"
              onKeyDown={(event) => handleTabKeyDown(event, 0)}
              onClick={() => setSelectedPage("main")}
            >
              Main
            </Button>
            <For each={aurum().operators}>{(candidate, index) => (
              <Button
                size="sm"
                selected={selectedPage() === "operator" && selectedOperator() === index()}
                role="tab"
                aria-selected={selectedPage() === "operator" && selectedOperator() === index()}
                aria-controls="aurum-page-panel"
                tabIndex={selectedPage() === "operator" && selectedOperator() === index() ? 0 : -1}
                data-aurum-tab={`${index() + 1}`}
                onKeyDown={(event) => handleTabKeyDown(event, index() + 1)}
                className={candidate.enabled ? styles.operatorActive : styles.operatorMuted}
                onClick={() => {
                  setSelectedOperator(index());
                  setSelectedPage("operator");
                }}
              >
                {candidate.name}
              </Button>
            )}</For>
          </div>

          <Show when={selectedPage() === "operator"} fallback={
            <div id="aurum-page-panel" class={styles.mainPanel} role="tabpanel">
              <div class={styles.panelTitle}>
                <div>
                  <h3>Main</h3>
                  <p>Voice, output, and filter controls</p>
                </div>
              </div>
              <div class={styles.controlBlock}>
                <h4>Unison</h4>
                <div class={styles.controlGrid}>
                  <NumberInput label="Voices" layout="inline" min={1} max={8} step={1} value={aurum().unison} onChange={(unison) => updateAurum((config) => ({ ...config, unison: Math.round(unison) }))} />
                  <NumberInput label="Detune" layout="inline" min={0} max={100} step={1} unit="ct" value={aurum().detuneCents} onChange={(detuneCents) => updateAurum((config) => ({ ...config, detuneCents }))} />
                  <Slider label="Spread" layout="inline" min={0} max={1} step={0.01} value={aurum().stereoSpread} readout={<span>{Math.round(aurum().stereoSpread * 100)}%</span>} onChange={(stereoSpread) => updateAurum((config) => ({ ...config, stereoSpread }))} />
                </div>
              </div>
              <div class={styles.controlBlock}>
                <h4>Output filter</h4>
                <div class={styles.controlGrid}>
                  <Slider label="Cutoff" layout="inline" min={0} max={1} step={0.01} value={draft().knobs.cutoff} readout={<span>{Math.round(draft().knobs.cutoff * 100)}%</span>} onChange={(cutoff) => setDraft((current) => ({ ...current, knobs: { ...current.knobs, cutoff } }))} />
                  <Slider label="Resonance" layout="inline" min={0} max={1} step={0.01} value={draft().knobs.resonance} readout={<span>{Math.round(draft().knobs.resonance * 100)}%</span>} onChange={(resonance) => setDraft((current) => ({ ...current, knobs: { ...current.knobs, resonance } }))} />
                  <Slider label="Drive" layout="inline" min={0} max={1} step={0.01} value={draft().knobs.drive} readout={<span>{Math.round(draft().knobs.drive * 100)}%</span>} onChange={(drive) => setDraft((current) => ({ ...current, knobs: { ...current.knobs, drive } }))} />
                </div>
              </div>
            </div>
          }>
            <div id="aurum-page-panel" class={styles.operatorPanel} role="tabpanel">
              <div class={styles.operatorHeading}>
                <div>
                  <h3>{operator().name}</h3>
                  <p>Oscillator and amplitude articulation</p>
                </div>
                <Toggle label="Enabled" checked={operator().enabled} onChange={(enabled) => updateOperator({ enabled })} />
              </div>
              <div class={styles.waveRow}>
                <WaveformScope waveform={operator().waveform} phase={operator().phase} />
                <div class={styles.waveControls}>
                  <FloatingSelect
                    label="Wave"
                    layout="inline"
                    value={operator().waveform}
                    options={WAVEFORM_OPTIONS}
                    open={waveformOpen()}
                    onOpenChange={setWaveformOpen}
                    onChange={(waveform) => updateOperator({ waveform: waveform as AurumOperatorWaveform })}
                  />
                  <Slider label="Phase" layout="inline" min={0} max={1} step={0.01} value={operator().phase} readout={<span>{Math.round(operator().phase * 360)}°</span>} onChange={(phase) => updateOperator({ phase })} />
                </div>
              </div>
              <div class={styles.controlBlock}>
                <h4>Tuning and level</h4>
                <div class={styles.controlGrid}>
                  <NumberInput label="Ratio" layout="inline" min={0.125} max={32} step={0.125} value={operator().ratio} onChange={(ratio) => updateOperator({ ratio })} />
                  <NumberInput label="Coarse" layout="inline" min={-48} max={48} step={1} unit="st" value={operator().coarse} onChange={(coarse) => updateOperator({ coarse })} />
                  <NumberInput label="Fine" layout="inline" min={-100} max={100} step={1} unit="ct" value={operator().fineCents} onChange={(fineCents) => updateOperator({ fineCents })} />
                  <Slider label="Level" layout="inline" min={0} max={1} step={0.01} value={operator().level} readout={<span>{Math.round(operator().level * 100)}%</span>} onChange={(level) => updateOperator({ level })} />
                </div>
              </div>
              <div class={styles.controlBlock}>
                <h4>Amplitude envelope</h4>
                <div class={styles.envelopeGrid}>
                  <NumberInput label="Attack" layout="inline" min={0} max={10000} step={1} unit="ms" value={operator().envelope.attackMs} onChange={(attackMs) => updateEnvelope({ attackMs })} />
                  <NumberInput label="Decay" layout="inline" min={0} max={10000} step={1} unit="ms" value={operator().envelope.decayMs} onChange={(decayMs) => updateEnvelope({ decayMs })} />
                  <Slider label="Sustain" layout="inline" min={0} max={1} step={0.01} value={operator().envelope.sustain} readout={<span>{Math.round(operator().envelope.sustain * 100)}%</span>} onChange={(sustain) => updateEnvelope({ sustain })} />
                  <NumberInput label="Release" layout="inline" min={0} max={10000} step={1} unit="ms" value={operator().envelope.releaseMs} onChange={(releaseMs) => updateEnvelope({ releaseMs })} />
                </div>
              </div>
            </div>
          </Show>
        </section>

        <section class={styles.matrixSection}>
          <div class={styles.sectionTitle}>
            <div>
              <h3>{matrixMode() === "fm" ? "Frequency Matrix" : "Ring / AM Matrix"}</h3>
              <p>{matrixMode() === "fm"
                ? "Rows modulate frequency. Diagonal cells are feedback."
                : "Rows modulate amplitude. Full depth produces ring modulation."}</p>
            </div>
            <div class={styles.matrixMode} role="group" aria-label="Aurum matrix mode">
              <Button size="xs" selected={matrixMode() === "fm"} onClick={() => setMatrixMode("fm")}>FM</Button>
              <Button size="xs" selected={matrixMode() === "rm"} onClick={() => setMatrixMode("rm")}>RM</Button>
            </div>
          </div>
          <div
            class={`${styles.matrix} ${matrixMode() === "rm" ? styles.rmMatrix : ""}`}
            role="group"
            aria-label={`Aurum ${matrixMode() === "fm" ? "frequency" : "ring modulation"} routing matrix`}
          >
            <span />
            <For each={aurum().operators}>{(candidate) => <span class={styles.matrixHeader}>{candidate.name}</span>}</For>
            <Show when={matrixMode() === "fm"}><span class={`${styles.matrixHeader} ${styles.outputHeader}`}>OUT</span></Show>
            <For each={aurum().operators}>{(source, sourceIndex) => (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  selected={selectedOperator() === sourceIndex()}
                  className={styles.matrixRowLabel}
                  onClick={() => {
                    setSelectedOperator(sourceIndex());
                    setSelectedPage("operator");
                  }}
                >
                  {source.name}
                </Button>
                <For each={Array.from({ length: matrixMode() === "fm" ? AURUM_OPERATOR_COUNT + 1 : AURUM_OPERATOR_COUNT })}>{(_, targetIndex) => {
                  const value = () => matrixMode() === "fm"
                    ? aurum().matrix[sourceIndex()][targetIndex()] ?? 0
                    : aurum().rmMatrix[sourceIndex()][targetIndex()] ?? 0;
                  const feedback = () => sourceIndex() === targetIndex();
                  const output = () => matrixMode() === "fm" && targetIndex() === AURUM_OUTPUT_COLUMN;
                  return (
                    <div class={`${styles.matrixCell} ${feedback() ? styles.feedbackCell : ""} ${output() ? styles.outputCell : ""}`} data-active={Math.abs(value()) > 0.001}>
                      <Knob
                        className={styles.matrixKnob}
                        size="sm"
                        min={-1}
                        max={1}
                        step={0.01}
                        bipolar
                        value={value()}
                        label={matrixMode() === "fm"
                          ? `${source.name} ${feedback() ? "feedback" : output() ? "to output" : `to ${aurum().operators[targetIndex()].name}`}`
                          : `${source.name} ${feedback() ? "self ring modulation" : `ring modulation to ${aurum().operators[targetIndex()].name}`}`}
                        formatValue={(next) => `${Math.round(next * 100)}`}
                        defaultValue={0}
                        onChange={(next) => updateMatrix(sourceIndex(), targetIndex(), next)}
                      />
                    </div>
                  );
                }}</For>
              </>
            )}</For>
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

function WaveformScope(props: { waveform: AurumOperatorWaveform; phase: number }) {
  const points = createMemo(() => Array.from({ length: 73 }, (_, index) => {
    const x = index / 72;
    const phase = (x + props.phase) % 1;
    const sample = waveformSample(props.waveform, phase);
    return `${(x * 144).toFixed(1)},${(36 - sample * 27).toFixed(1)}`;
  }).join(" "));

  return (
    <div class={styles.waveformScope} aria-label={`${props.waveform} waveform preview`}>
      <svg viewBox="0 0 144 72" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="36" x2="144" y2="36" />
        <polyline points={points()} />
      </svg>
    </div>
  );
}

function waveformSample(waveform: AurumOperatorWaveform, phase: number) {
  if (waveform === "triangle") return 1 - 4 * Math.abs(phase - 0.5);
  if (waveform === "saw") return phase * 2 - 1;
  if (waveform === "square") return phase < 0.5 ? 1 : -1;
  return Math.sin(phase * Math.PI * 2);
}

function cloneInstrument(instrument: Instrument): Instrument {
  return typeof structuredClone === "function" ? structuredClone(instrument) : JSON.parse(JSON.stringify(instrument));
}
