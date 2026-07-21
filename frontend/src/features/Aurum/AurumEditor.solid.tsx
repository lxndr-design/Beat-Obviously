import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Button, FloatingSelect, Icon, Knob, NumberInput, Slider, TextInput, Toggle } from "../../solid-ui";
import { sampleAurumOperatorWaveform, startInstrumentPreviewAudition, type InstrumentPreviewAuditionHandle } from "../../audio/synthPreview";
import { AURUM_DIRECT_BUS, AURUM_FILTER_A_BUS, AURUM_FILTER_B_BUS, AURUM_HARMONIC_COUNT, AURUM_OPERATOR_COUNT, AURUM_OUTPUT_BUS_COUNT, AURUM_RESPONSE_CURVE_POINT_COUNT, drawAurumHarmonicLine, normalizedAurumConfigForInstrument } from "../../state/aurum";
import type { AurumFilterConfig, AurumOperatorConfig, AurumOperatorWaveform, Instrument } from "../../state/types";
import { aurumTabIndexAfterKey } from "./aurumEditorInteraction";
import { applyAurumAlgorithmTemplate, AURUM_ALGORITHM_TEMPLATES, copyAurumOperator, initializeAurumOperator, pasteAurumOperator, resetAurumOperator, swapAurumOperators, type AurumAlgorithmTemplateId } from "./aurumEditing";
import { analyzeAurumSignalFlow, type AurumOperatorSignalState } from "./aurumSignalDiagnostics";
import styles from "./AurumEditor.module.css";

const WAVEFORM_OPTIONS = ["sine", "triangle", "saw", "square", "additive"].map((value) => ({
  value,
  label: value[0].toUpperCase() + value.slice(1),
}));

const FILTER_OPTIONS = ["lowpass", "bandpass", "highpass"].map((value) => ({
  value,
  label: value === "lowpass" ? "Low-pass" : value === "bandpass" ? "Band-pass" : "High-pass",
}));

type EnvelopeMode = "amp" | "pitch" | "phase";

export interface AurumEditorProps {
  instrument: Instrument;
  onCommit: (instrument: Instrument) => void;
  onClose: () => void;
}

export function AurumEditor(props: AurumEditorProps) {
  const [draft, setDraft] = createSignal(cloneInstrument(props.instrument), { equals: false });
  const [selectedOperator, setSelectedOperator] = createSignal(0);
  const [selectedPage, setSelectedPage] = createSignal<"main" | "operator">("operator");
  const [matrixMode, setMatrixMode] = createSignal<"fm" | "rm" | "output">("fm");
  const [envelopeMode, setEnvelopeMode] = createSignal<EnvelopeMode>("amp");
  const [responseMode, setResponseMode] = createSignal<"velocity" | "key">("velocity");
  const [waveformOpen, setWaveformOpen] = createSignal(false);
  const [filterOpen, setFilterOpen] = createSignal<number | null>(null);
  const [swapOpen, setSwapOpen] = createSignal(false);
  const [algorithmOpen, setAlgorithmOpen] = createSignal(false);
  const [algorithmTemplate, setAlgorithmTemplate] = createSignal<AurumAlgorithmTemplateId | "custom">("custom");
  const [operatorClipboard, setOperatorClipboard] = createSignal<{ sourceName: string; operator: AurumOperatorConfig } | null>(null);
  const [auditioning, setAuditioning] = createSignal(false);
  let audition: InstrumentPreviewAuditionHandle | null = null;

  const aurum = createMemo(() => normalizedAurumConfigForInstrument(draft()));
  const operator = createMemo(() => aurum().operators[selectedOperator()]);
  const signalDiagnostics = createMemo(() => analyzeAurumSignalFlow(aurum()));

  onCleanup(stopAudition);

  function updateAurum(mutator: (config: ReturnType<typeof aurum>) => ReturnType<typeof aurum>) {
    setDraft((current) => ({ ...current, aurum: mutator(normalizedAurumConfigForInstrument(current)) }));
  }

  function updateOperator(patch: Partial<AurumOperatorConfig>) {
    const index = selectedOperator();
    updateAurum((config) => ({
      ...config,
      operators: config.operators.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...patch } : candidate),
    }));
  }

  function updateFilter(index: number, patch: Partial<AurumFilterConfig>) {
    updateAurum((config) => ({
      ...config,
      filters: config.filters.map((filter, filterIndex) => filterIndex === index ? { ...filter, ...patch } : filter) as typeof config.filters,
    }));
  }

  function selectedEnvelope() {
    if (envelopeMode() === "pitch") return operator().pitchEnvelope;
    if (envelopeMode() === "phase") return operator().phaseEnvelope;
    return operator().envelope;
  }

  function updateEnvelope(patch: Partial<AurumOperatorConfig["envelope"]>) {
    if (envelopeMode() === "pitch") {
      updateOperator({ pitchEnvelope: { ...operator().pitchEnvelope, ...patch } });
      return;
    }
    if (envelopeMode() === "phase") {
      updateOperator({ phaseEnvelope: { ...operator().phaseEnvelope, ...patch } });
      return;
    }
    updateOperator({ envelope: { ...operator().envelope, ...patch } });
  }

  function updateResponseCurve(values: number[]) {
    if (responseMode() === "velocity") updateOperator({ velocityCurve: values });
    else updateOperator({ keytrackCurve: values });
  }

  function updateMatrix(source: number, target: number, value: number) {
    setAlgorithmTemplate("custom");
    updateAurum((config) => matrixMode() === "fm" ? ({
      ...config,
      matrix: config.matrix.map((row, rowIndex) => rowIndex === source
        ? row.map((cell, columnIndex) => columnIndex === target ? value : cell)
        : row),
    }) : matrixMode() === "rm" ? ({
      ...config,
      rmMatrix: config.rmMatrix.map((row, rowIndex) => rowIndex === source
        ? row.map((cell, columnIndex) => columnIndex === target ? value : cell)
        : row),
    }) : ({
      ...config,
      outputSends: config.outputSends.map((row, rowIndex) => rowIndex === source
        ? row.map((cell, columnIndex) => columnIndex === target ? value : cell)
        : row),
    }));
  }

  function updateOutputSend(bus: number, value: number) {
    setAlgorithmTemplate("custom");
    updateAurum((config) => ({
      ...config,
      outputSends: config.outputSends.map((row, rowIndex) => rowIndex === selectedOperator()
        ? row.map((cell, columnIndex) => columnIndex === bus ? value : cell)
        : row),
    }));
  }

  function copySelectedOperator() {
    setOperatorClipboard({ sourceName: operator().name, operator: copyAurumOperator(operator()) });
  }

  function pasteSelectedOperator() {
    const copied = operatorClipboard();
    if (!copied) return;
    setAlgorithmTemplate("custom");
    updateAurum((config) => pasteAurumOperator(config, selectedOperator(), copied.operator));
  }

  function initializeSelectedOperator() {
    setAlgorithmTemplate("custom");
    updateAurum((config) => initializeAurumOperator(config, selectedOperator()));
  }

  function resetSelectedOperator() {
    setAlgorithmTemplate("custom");
    updateAurum((config) => resetAurumOperator(config, selectedOperator()));
  }

  function swapSelectedOperator(value: string) {
    const target = Number(value);
    if (!Number.isInteger(target)) return;
    setAlgorithmTemplate("custom");
    updateAurum((config) => swapAurumOperators(config, selectedOperator(), target));
    setSelectedOperator(target);
  }

  function selectAlgorithmTemplate(value: string) {
    if (value === "custom") return;
    const id = value as AurumAlgorithmTemplateId;
    updateAurum((config) => applyAurumAlgorithmTemplate(config, id));
    setAlgorithmTemplate(id);
    setMatrixMode("fm");
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
    const config = aurum();
    const primaryFilter = config.filters[0];
    props.onCommit({
      ...draft(),
      filterType: primaryFilter.type,
      knobs: {
        ...draft().knobs,
        cutoff: primaryFilter.cutoff,
        resonance: primaryFilter.resonance,
        drive: primaryFilter.drive,
      },
      aurum: config,
    });
  }

  return (
    <div class={styles.editor}>
      <header class={styles.header}>
        <div class={styles.identity}>
          <span class={styles.mark}>AU</span>
          <div>
            <h2>Aurum</h2>
            <p>Six-operator FM, RM, and additive synthesis</p>
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
                <div class={styles.qualityHeader}>
                  <h4>Operator quality</h4>
                  <div class={styles.qualityMode} role="group" aria-label="Aurum operator quality">
                    <Button size="xs" selected={aurum().oversampling === 1} aria-pressed={aurum().oversampling === 1} onClick={() => updateAurum((config) => ({ ...config, oversampling: 1 }))}>1x</Button>
                    <Button size="xs" selected={aurum().oversampling === 2} aria-pressed={aurum().oversampling === 2} onClick={() => updateAurum((config) => ({ ...config, oversampling: 2 }))}>2x</Button>
                    <Button size="xs" selected={aurum().oversampling === 4} aria-pressed={aurum().oversampling === 4} onClick={() => updateAurum((config) => ({ ...config, oversampling: 4 }))}>4x</Button>
                  </div>
                </div>
              </div>
              <div class={styles.controlBlock}>
                <div class={styles.filterHeader}>
                  <h4>Output filters</h4>
                  <div class={styles.filterRouting} role="group" aria-label="Aurum filter routing">
                    <Button size="xs" selected={aurum().filterRouting === "serial"} aria-pressed={aurum().filterRouting === "serial"} onClick={() => updateAurum((config) => ({ ...config, filterRouting: "serial" }))}>Serial</Button>
                    <Button size="xs" selected={aurum().filterRouting === "parallel"} aria-pressed={aurum().filterRouting === "parallel"} onClick={() => updateAurum((config) => ({ ...config, filterRouting: "parallel" }))}>Parallel</Button>
                  </div>
                </div>
                <div class={styles.filterGrid}>
                  <For each={aurum().filters}>{(filter, index) => (
                    <section class={styles.filterBlock} aria-label={`Filter ${index() === 0 ? "A" : "B"}`}>
                      <div class={styles.filterTitle}>
                        <strong>Filter {index() === 0 ? "A" : "B"}</strong>
                        <Toggle label="Enabled" checked={filter.enabled} onChange={(enabled) => updateFilter(index(), { enabled })} />
                      </div>
                      <FloatingSelect
                        label="Mode"
                        layout="inline"
                        value={filter.type}
                        options={FILTER_OPTIONS}
                        open={filterOpen() === index()}
                        onOpenChange={(open) => setFilterOpen(open ? index() : null)}
                        onChange={(type) => updateFilter(index(), { type: type as AurumFilterConfig["type"] })}
                      />
                      <Slider label="Cutoff" layout="inline" min={0} max={1} step={0.01} value={filter.cutoff} readout={<span>{Math.round(filter.cutoff * 100)}%</span>} onChange={(cutoff) => updateFilter(index(), { cutoff })} />
                      <Slider label="Resonance" layout="inline" min={0} max={1} step={0.01} value={filter.resonance} readout={<span>{Math.round(filter.resonance * 100)}%</span>} onChange={(resonance) => updateFilter(index(), { resonance })} />
                      <Slider label="Drive" layout="inline" min={0} max={1} step={0.01} value={filter.drive} readout={<span>{Math.round(filter.drive * 100)}%</span>} onChange={(drive) => updateFilter(index(), { drive })} />
                    </section>
                  )}</For>
                </div>
              </div>
            </div>
          }>
            <div id="aurum-page-panel" class={styles.operatorPanel} role="tabpanel">
              <div class={styles.operatorHeading}>
                <div>
                  <h3>{operator().name}</h3>
                  <p>Oscillator and per-operator articulation</p>
                </div>
                <Toggle label="Enabled" checked={operator().enabled} onChange={(enabled) => {
                  setAlgorithmTemplate("custom");
                  updateOperator({ enabled });
                }} />
              </div>
              <div class={styles.operatorCommands} aria-label={`${operator().name} editing commands`}>
                <Button size="xs" variant="ghost" onClick={initializeSelectedOperator} title="Restore operator parameters without changing routing">Init</Button>
                <Button size="xs" variant="ghost" onClick={copySelectedOperator}>Copy</Button>
                <Button size="xs" variant="ghost" disabled={!operatorClipboard()} onClick={pasteSelectedOperator} title={operatorClipboard() ? `Paste parameters from ${operatorClipboard()!.sourceName}` : "Copy an operator first"}>Paste</Button>
                <FloatingSelect
                  className={styles.swapSelect}
                  layout="bare"
                  ariaLabel={`Swap ${operator().name} with another operator`}
                  value=""
                  options={[
                    { value: "", label: "Swap", disabled: true },
                    ...aurum().operators.map((candidate, index) => ({ value: `${index}`, label: candidate.name, disabled: index === selectedOperator() })),
                  ]}
                  open={swapOpen()}
                  onOpenChange={setSwapOpen}
                  onChange={swapSelectedOperator}
                />
                <Button size="xs" variant="danger" onClick={resetSelectedOperator} title="Initialize this operator and clear all of its routing">Reset</Button>
                <span class={styles.commandStatus} aria-live="polite">{operatorClipboard() ? `${operatorClipboard()!.sourceName} copied` : ""}</span>
              </div>
              <div class={styles.waveRow}>
                <WaveformScope operator={operator()} />
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
                  <Slider label="Fold" layout="inline" min={0} max={1} step={0.01} value={operator().wavefold} readout={<span>{Math.round(operator().wavefold * 100)}%</span>} onChange={(wavefold) => updateOperator({ wavefold })} />
                </div>
              </div>
              <Show when={operator().waveform === "additive"}>
                <div class={styles.controlBlock}>
                  <div class={styles.harmonicHeader}>
                    <h4>Harmonic spectrum</h4>
                    <div class={styles.harmonicPresets} aria-label="Harmonic presets">
                      <Button size="xs" variant="ghost" onClick={() => updateOperator({ harmonics: harmonicPreset("fundamental") })}>Fund.</Button>
                      <Button size="xs" variant="ghost" onClick={() => updateOperator({ harmonics: harmonicPreset("odd") })}>Odd</Button>
                      <Button size="xs" variant="ghost" onClick={() => updateOperator({ harmonics: harmonicPreset("saw") })}>Saw</Button>
                    </div>
                  </div>
                  <HarmonicEditor values={operator().harmonics} onChange={(harmonics) => updateOperator({ harmonics })} />
                </div>
              </Show>
              <div class={styles.controlBlock}>
                <h4>Tuning and level</h4>
                <div class={styles.controlGrid}>
                  <NumberInput label="Ratio" layout="inline" min={0.125} max={32} step={0.125} value={operator().ratio} onChange={(ratio) => updateOperator({ ratio })} />
                  <NumberInput label="Coarse" layout="inline" min={-48} max={48} step={1} unit="st" value={operator().coarse} onChange={(coarse) => updateOperator({ coarse })} />
                  <NumberInput label="Fine" layout="inline" min={-100} max={100} step={1} unit="ct" value={operator().fineCents} onChange={(fineCents) => updateOperator({ fineCents })} />
                  <Slider label="Level" layout="inline" min={0} max={1} step={0.01} value={operator().level} readout={<span>{Math.round(operator().level * 100)}%</span>} onChange={(level) => updateOperator({ level })} />
                  <Slider label="Pan" layout="inline" min={-1} max={1} step={0.01} value={operator().pan} readout={<span>{formatPan(operator().pan)}</span>} onChange={(pan) => updateOperator({ pan })} />
                </div>
              </div>
              <div class={styles.controlBlock}>
                <h4>Output sends</h4>
                <div class={styles.sendGrid}>
                  <Knob size="sm" min={-1} max={1} step={0.01} bipolar label="Filter A" value={aurum().outputSends[selectedOperator()][AURUM_FILTER_A_BUS]} formatValue={(value) => `${Math.round(value * 100)}`} defaultValue={0} onChange={(value) => updateOutputSend(AURUM_FILTER_A_BUS, value)} />
                  <Knob size="sm" min={-1} max={1} step={0.01} bipolar label="Filter B" value={aurum().outputSends[selectedOperator()][AURUM_FILTER_B_BUS]} formatValue={(value) => `${Math.round(value * 100)}`} defaultValue={0} onChange={(value) => updateOutputSend(AURUM_FILTER_B_BUS, value)} />
                  <Knob size="sm" min={-1} max={1} step={0.01} bipolar label="Direct" value={aurum().outputSends[selectedOperator()][AURUM_DIRECT_BUS]} formatValue={(value) => `${Math.round(value * 100)}`} defaultValue={0} onChange={(value) => updateOutputSend(AURUM_DIRECT_BUS, value)} />
                </div>
              </div>
              <div class={styles.controlBlock}>
                <div class={styles.articulationHeader}>
                  <h4>{envelopeMode() === "amp" ? "Amplitude" : envelopeMode() === "pitch" ? "Pitch" : "Phase"} envelope</h4>
                  <div class={styles.envelopeMode} role="group" aria-label="Operator envelope mode">
                    <Button size="xs" selected={envelopeMode() === "amp"} onClick={() => setEnvelopeMode("amp")}>Amp</Button>
                    <Button size="xs" selected={envelopeMode() === "pitch"} onClick={() => setEnvelopeMode("pitch")}>Pitch</Button>
                    <Button size="xs" selected={envelopeMode() === "phase"} onClick={() => setEnvelopeMode("phase")}>Phase</Button>
                  </div>
                </div>
                <div class={styles.envelopeGrid}>
                  <Show when={envelopeMode() === "pitch"}>
                    <NumberInput label="Depth" layout="inline" min={-48} max={48} step={1} unit="st" value={operator().pitchEnvelopeSemitones} onChange={(pitchEnvelopeSemitones) => updateOperator({ pitchEnvelopeSemitones })} />
                  </Show>
                  <Show when={envelopeMode() === "phase"}>
                    <NumberInput label="Depth" layout="inline" min={-180} max={180} step={1} unit="deg" value={operator().phaseEnvelopeDegrees} onChange={(phaseEnvelopeDegrees) => updateOperator({ phaseEnvelopeDegrees })} />
                  </Show>
                  <NumberInput label="Attack" layout="inline" min={0} max={10000} step={1} unit="ms" value={selectedEnvelope().attackMs} onChange={(attackMs) => updateEnvelope({ attackMs })} />
                  <NumberInput label="Decay" layout="inline" min={0} max={10000} step={1} unit="ms" value={selectedEnvelope().decayMs} onChange={(decayMs) => updateEnvelope({ decayMs })} />
                  <Slider label="Sustain" layout="inline" min={0} max={1} step={0.01} value={selectedEnvelope().sustain} readout={<span>{Math.round(selectedEnvelope().sustain * 100)}%</span>} onChange={(sustain) => updateEnvelope({ sustain })} />
                  <NumberInput label="Release" layout="inline" min={0} max={10000} step={1} unit="ms" value={selectedEnvelope().releaseMs} onChange={(releaseMs) => updateEnvelope({ releaseMs })} />
                </div>
              </div>
              <div class={styles.controlBlock}>
                <div class={styles.responseHeader}>
                  <h4>{responseMode() === "velocity" ? "Velocity" : "Keyboard"} response</h4>
                  <div class={styles.responseMode} role="group" aria-label="Operator response curve mode">
                    <Button size="xs" selected={responseMode() === "velocity"} onClick={() => setResponseMode("velocity")}>Vel</Button>
                    <Button size="xs" selected={responseMode() === "key"} onClick={() => setResponseMode("key")}>Key</Button>
                  </div>
                </div>
                <ResponseCurveEditor
                  mode={responseMode()}
                  values={responseMode() === "velocity" ? operator().velocityCurve : operator().keytrackCurve}
                  onChange={updateResponseCurve}
                />
                <div class={styles.responsePresets} aria-label="Response curve presets">
                  <Button size="xs" variant="ghost" onClick={() => updateResponseCurve(Array(AURUM_RESPONSE_CURVE_POINT_COUNT).fill(1))}>Flat</Button>
                  <Button size="xs" variant="ghost" onClick={() => updateResponseCurve([0, 0.25, 0.5, 0.75, 1])}>Rise</Button>
                  <Button size="xs" variant="ghost" onClick={() => updateResponseCurve([1, 0.75, 0.5, 0.25, 0])}>Fall</Button>
                </div>
              </div>
            </div>
          </Show>
        </section>

        <section class={styles.matrixSection}>
          <div class={styles.sectionTitle}>
            <div>
              <h3>{matrixMode() === "fm" ? "Frequency Matrix" : matrixMode() === "rm" ? "Ring / AM Matrix" : "Output Routing"}</h3>
              <p>{matrixMode() === "fm"
                ? "Rows modulate frequency. Diagonal cells are feedback."
                : matrixMode() === "rm"
                  ? "Rows modulate amplitude. Full depth produces ring modulation."
                  : "Rows send bipolar signal to filters or direct output."}</p>
            </div>
            <div class={styles.sectionActions}>
              <FloatingSelect
                className={styles.algorithmSelect}
                layout="bare"
                ariaLabel="Aurum algorithm template"
                value={algorithmTemplate()}
                options={[
                  { value: "custom", label: "Custom algorithm", disabled: true },
                  ...AURUM_ALGORITHM_TEMPLATES.map((template) => ({ value: template.id, label: template.label })),
                ]}
                open={algorithmOpen()}
                onOpenChange={setAlgorithmOpen}
                onChange={selectAlgorithmTemplate}
              />
              <div class={styles.matrixMode} role="group" aria-label="Aurum matrix mode">
                <Button size="xs" selected={matrixMode() === "fm"} onClick={() => setMatrixMode("fm")}>FM</Button>
                <Button size="xs" selected={matrixMode() === "rm"} onClick={() => setMatrixMode("rm")}>RM</Button>
                <Button size="xs" selected={matrixMode() === "output"} onClick={() => setMatrixMode("output")}>OUT</Button>
              </div>
            </div>
          </div>
          <div class={styles.signalDiagnostics} data-silent={signalDiagnostics().silent} aria-live="polite">
            <div class={styles.signalSummary}>
              <Icon name={signalDiagnostics().silent ? "ph:warning" : "ph:activity"} size={18} decorative />
              <strong>{signalDiagnostics().silent ? "Silent patch" : "Output connected"}</strong>
              <span>{signalDiagnostics().silent
                ? "No enabled operator reaches an output bus."
                : `${signalDiagnostics().activeOperatorCount} active ${signalDiagnostics().activeOperatorCount === 1 ? "operator" : "operators"}${signalDiagnostics().disconnectedOperatorCount > 0 ? ` · ${signalDiagnostics().disconnectedOperatorCount} disconnected` : ""}`}</span>
            </div>
            <div class={styles.signalFlow} aria-label="Aurum signal-flow status">
              <div class={styles.signalOperators}>
                <For each={aurum().operators}>{(candidate, index) => {
                  const diagnostic = () => signalDiagnostics().operators[index()];
                  return (
                    <button
                      type="button"
                      class={styles.signalNode}
                      data-state={diagnostic().state}
                      aria-label={`${candidate.name}: ${operatorSignalLabel(diagnostic().state)}`}
                      onClick={() => {
                        setSelectedOperator(index());
                        setSelectedPage("operator");
                      }}
                    >
                      <strong>{candidate.name}</strong>
                      <span>{operatorSignalLabel(diagnostic().state)}</span>
                    </button>
                  );
                }}</For>
              </div>
              <span class={styles.signalArrow} aria-hidden="true">→</span>
              <div class={styles.signalBuses}>
                <For each={["FILTER A", "FILTER B", "DIRECT"]}>{(label, index) => (
                  <div class={styles.signalBus} data-active={signalDiagnostics().activeBuses[index()]}>
                    <strong>{label}</strong>
                    <span>{signalDiagnostics().activeBuses[index()] ? "ACTIVE" : "IDLE"}</span>
                  </div>
                )}</For>
              </div>
            </div>
          </div>
          <div
            class={`${styles.matrix} ${matrixMode() === "output" ? styles.outputMatrix : styles.fmMatrix}`}
            role="group"
            aria-label={`Aurum ${matrixMode() === "fm" ? "frequency" : matrixMode() === "rm" ? "ring modulation" : "output"} routing matrix`}
          >
            <span />
            <For each={matrixMode() === "output" ? ["FILTER A", "FILTER B", "DIRECT"] : aurum().operators.map((candidate) => candidate.name)}>{(label, index) => <span class={`${styles.matrixHeader} ${matrixMode() === "output" ? styles.outputHeader : ""}`} data-active={matrixMode() === "output" ? signalDiagnostics().activeBuses[index()] : undefined}>{label}</span>}</For>
            <For each={aurum().operators}>{(source, sourceIndex) => (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  selected={selectedOperator() === sourceIndex()}
                  className={styles.matrixRowLabel}
                  data-signal-state={signalDiagnostics().operators[sourceIndex()].state}
                  onClick={() => {
                    setSelectedOperator(sourceIndex());
                    setSelectedPage("operator");
                  }}
                >
                  {source.name}
                </Button>
                <For each={Array.from({ length: matrixMode() === "output" ? AURUM_OUTPUT_BUS_COUNT : AURUM_OPERATOR_COUNT })}>{(_, targetIndex) => {
                  const value = () => matrixMode() === "fm"
                    ? aurum().matrix[sourceIndex()][targetIndex()] ?? 0
                    : matrixMode() === "rm"
                      ? aurum().rmMatrix[sourceIndex()][targetIndex()] ?? 0
                      : aurum().outputSends[sourceIndex()][targetIndex()] ?? 0;
                  const feedback = () => matrixMode() !== "output" && sourceIndex() === targetIndex();
                  const output = () => matrixMode() === "output";
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
                          ? `${source.name} ${feedback() ? "feedback" : `to ${aurum().operators[targetIndex()].name}`}`
                          : matrixMode() === "rm"
                            ? `${source.name} ${feedback() ? "self ring modulation" : `ring modulation to ${aurum().operators[targetIndex()].name}`}`
                            : `${source.name} to ${targetIndex() === AURUM_FILTER_A_BUS ? "Filter A" : targetIndex() === AURUM_FILTER_B_BUS ? "Filter B" : "Direct"}`}
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

function operatorSignalLabel(state: AurumOperatorSignalState) {
  if (state === "carrier") return "OUTPUT";
  if (state === "modulator") return "MOD";
  if (state === "disconnected") return "NO PATH";
  if (state === "silent") return "0 LEVEL";
  return "OFF";
}

function formatPan(value: number) {
  const amount = Math.round(Math.abs(value) * 100);
  return amount === 0 ? "C" : `${value < 0 ? "L" : "R"}${amount}`;
}

function WaveformScope(props: { operator: AurumOperatorConfig }) {
  const points = createMemo(() => Array.from({ length: 73 }, (_, index) => {
    const x = index / 72;
    const phase = (x + props.operator.phase) % 1;
    const sample = sampleAurumOperatorWaveform(props.operator, phase, 1 / 144);
    return `${(x * 144).toFixed(1)},${(36 - sample * 27).toFixed(1)}`;
  }).join(" "));

  return (
    <div class={styles.waveformScope} aria-label={`${props.operator.waveform} waveform preview at ${Math.round(props.operator.wavefold * 100)} percent fold`}>
      <svg viewBox="0 0 144 72" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="36" x2="144" y2="36" />
        <polyline points={points()} />
      </svg>
    </div>
  );
}

function HarmonicEditor(props: { values: number[]; onChange: (values: number[]) => void }) {
  const [lastPoint, setLastPoint] = createSignal<{ index: number; value: number } | null>(null);
  const values = createMemo(() => Array.from({ length: AURUM_HARMONIC_COUNT }, (_, index) => Math.max(0, Math.min(1, props.values[index] ?? 0))));

  function pointerPoint(event: PointerEvent & { currentTarget: HTMLDivElement }) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width - 0.001, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    return {
      index: Math.max(0, Math.min(AURUM_HARMONIC_COUNT - 1, Math.floor((x / Math.max(1, rect.width)) * AURUM_HARMONIC_COUNT))),
      value: Math.max(0, Math.min(1, 1 - y / Math.max(1, rect.height))),
    };
  }

  function updateFromPointer(event: PointerEvent & { currentTarget: HTMLDivElement }) {
    const point = pointerPoint(event);
    const previous = lastPoint() ?? point;
    props.onChange(drawAurumHarmonicLine(values(), previous.index, previous.value, point.index, point.value));
    setLastPoint(point);
  }

  function updateBin(index: number, value: number) {
    const next = [...values()];
    next[index] = Math.max(0, Math.min(1, value));
    props.onChange(next);
  }

  return (
    <div
      class={styles.harmonicEditor}
      aria-label="Additive harmonic spectrum"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setLastPoint(null);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => { if (event.buttons === 1) updateFromPointer(event); }}
      onPointerUp={() => setLastPoint(null)}
      onPointerCancel={() => setLastPoint(null)}
    >
      <For each={values()}>{(value, index) => (
        <div
          class={styles.harmonicBin}
          role="slider"
          tabIndex={0}
          aria-label={`Harmonic ${index() + 1}`}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(value * 100)}
          title={`H${index() + 1} ${Math.round(value * 100)}%`}
          onKeyDown={(event) => {
            const steps: Record<string, number> = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05, PageUp: 0.1, PageDown: -0.1 };
            if (event.key === "Home" || event.key === "End" || event.key in steps) {
              event.preventDefault();
              updateBin(index(), event.key === "Home" ? 0 : event.key === "End" ? 1 : value + steps[event.key]);
            }
          }}
        >
          <span style={{ height: `${Math.max(1, value * 100)}%` }} />
          <small>{index() + 1}</small>
        </div>
      )}</For>
    </div>
  );
}

function ResponseCurveEditor(props: { mode: "velocity" | "key"; values: number[]; onChange: (values: number[]) => void }) {
  const values = createMemo(() => Array.from(
    { length: AURUM_RESPONSE_CURVE_POINT_COUNT },
    (_, index) => Math.max(0, Math.min(1, props.values[index] ?? 1)),
  ));
  const points = createMemo(() => values().map((value, index) => `${(index / (AURUM_RESPONSE_CURVE_POINT_COUNT - 1)) * 100},${(1 - value) * 100}`).join(" "));

  function updatePoint(index: number, value: number) {
    const next = [...values()];
    next[index] = Math.max(0, Math.min(1, value));
    props.onChange(next);
  }

  function updateFromPointer(event: PointerEvent & { currentTarget: HTMLDivElement }) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
    updatePoint(Math.round(x * (AURUM_RESPONSE_CURVE_POINT_COUNT - 1)), 1 - y);
  }

  const inputLabel = (index: number) => props.mode === "velocity"
    ? Math.round((index / (AURUM_RESPONSE_CURVE_POINT_COUNT - 1)) * 127)
    : Math.round((index / (AURUM_RESPONSE_CURVE_POINT_COUNT - 1)) * 127);

  return (
    <div class={styles.responseEditor} aria-label={`${props.mode === "velocity" ? "Velocity" : "Keyboard"} response curve`}>
      <div
        class={styles.responseCanvas}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => { if (event.buttons === 1) updateFromPointer(event); }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="50" x2="100" y2="50" />
          <line x1="50" y1="0" x2="50" y2="100" />
          <polyline points={points()} />
        </svg>
        <For each={values()}>{(value, index) => (
          <div
            class={styles.responsePoint}
            style={{ left: `${(index() / (AURUM_RESPONSE_CURVE_POINT_COUNT - 1)) * 100}%`, top: `${(1 - value) * 100}%` }}
            role="slider"
            tabIndex={0}
            aria-label={`${props.mode === "velocity" ? "Velocity" : "Key"} ${inputLabel(index())}`}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(value * 100)}
            aria-valuetext={`${Math.round(value * 100)} percent gain`}
            title={`${inputLabel(index())}: ${Math.round(value * 100)}%`}
            onKeyDown={(event) => {
              const steps: Record<string, number> = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05, PageUp: 0.1, PageDown: -0.1 };
              if (event.key === "Home" || event.key === "End" || event.key in steps) {
                event.preventDefault();
                updatePoint(index(), event.key === "Home" ? 0 : event.key === "End" ? 1 : value + steps[event.key]);
              }
            }}
          />
        )}</For>
      </div>
      <div class={styles.responseLabels} aria-hidden="true">
        <For each={values()}>{(_, index) => <span>{inputLabel(index())}</span>}</For>
      </div>
    </div>
  );
}

function harmonicPreset(preset: "fundamental" | "odd" | "saw") {
  return Array.from({ length: AURUM_HARMONIC_COUNT }, (_, index) => {
    const harmonic = index + 1;
    if (preset === "fundamental") return harmonic === 1 ? 1 : 0;
    if (preset === "odd") return harmonic % 2 === 1 ? 1 / harmonic : 0;
    return 1 / harmonic;
  });
}

function cloneInstrument(instrument: Instrument): Instrument {
  return typeof structuredClone === "function" ? structuredClone(instrument) : JSON.parse(JSON.stringify(instrument));
}
