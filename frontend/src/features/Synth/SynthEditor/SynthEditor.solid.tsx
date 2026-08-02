import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { previewFrequency, renderAetherOutputPreviewSamples, renderedInstrumentBuffer } from "../../../audio/synthPreview";
import { createSynthWorkletPreviewNode } from "../../../audio/synthWorkletPreview";
import { registerGlobalAudioStop } from "../../../audio/globalAudioSafety";
import { appAlert, Button, FieldActionButton, FloatingSelect, HoverInfo, Icon, Knob, meshTintVariantFor, NumberInput, Slider, TextInput, Toggle } from "../../../solid-ui";
import { send } from "../../../ipc/bridge";
import { useContextualHotkey } from "../../../solid-utils/contextualHotkeys.solid";
import { createStoreSelector } from "../../../solid-utils/store";
import {
  createTrackEffect,
  EFFECT_DEFAULT_PARAMS,
  EFFECT_LABELS,
  EFFECT_OPTIONS,
  EFFECT_PARAM_SPECS,
  formatEffectLatency,
  formatEffectTail,
  normalizeTrackEffectChain,
  type EffectKind,
  type EffectParamSpec,
} from "../../../state/effects";
import {
  FACTORY_SYNTH_PRESETS,
  MACRO_IDS,
  getEnvelopeCurveParam,
  getNumberParam,
  macroConflictDetailsForId,
  macroConflictSummaryForId,
  macroDefinitionForId,
  modulationSourceEditorTarget,
  modulationSummaryForSource,
  modulationSummaryForTarget,
  synthEnvelopeEditorSummary,
  synthExpressionSummary,
  synthDraftFromInstrument,
  synthDraftToInstrumentPatch,
  synthDraftToPreviewInstrument,
  useSynthStore,
  type MacroCurve,
  type MacroId,
  type ModulationSourceId,
  type ModulationTargetId,
  type SynthDraftPatch,
  type SynthExpressionActivity,
  type SynthFactoryPresetRecord,
  type SynthModulationSourceEditorTarget,
  type SynthParameterId,
} from "../../../state/synthStore";
import { ANALYZER_BAND_COUNT, useAnalyzerStore, type AnalyzerSnapshot } from "../../../state/analyzerStore";
import { useAudioFileStore, useDocumentStore, useInstrumentStore, useProjectStore, useUiStore } from "../../../state/store";
import { useComponentStore } from "../../../state/components";
import {
  firstInstrumentTaxonomyIdForCategory,
  INSTRUMENT_TAXONOMY_CATEGORY_OPTIONS,
  instrumentTaxonomyOptionsForCategory,
  taxonomyAssignmentForInstrumentId,
} from "../../../state/instrumentTaxonomy";
import type { AetherSampleZoneConfig, AudioFile, EnvelopeCurve, Instrument, ManagedGranularAssetConfig, ManagedSfzAssetConfig, TrackEffect } from "../../../state/types";
import { ModulationMatrix } from "../ModulationMatrix/ModulationMatrix.solid";
import { OscillatorPanel } from "../OscillatorPanel/OscillatorPanel.solid";
import { SynthCurvePreview } from "../CurvePreview/SynthCurvePreview.solid";
import { PianoRoll } from "../../MidiEditor/PianoRoll.solid";
import {
  LUMEN_CLIP_BOTTOM_PITCH,
  LUMEN_CLIP_TOP_PITCH,
  lumenClipPitchLabel,
  lumenClipToMidiNotes,
  midiPatternToLumenClip,
  midiNotesToLumenClip,
} from "../lumenClipPianoRoll";
import styles from "./SynthEditor.module.css";

const AUDITION_SECONDS = 1.4;
const MAX_AUDITION_SECONDS = 4.25;
const ANALYZER_BANDS = ANALYZER_BAND_COUNT;
const FILTER_TYPES = [
  ["lowpass", "LP", "Lowpass", "ph:wave-sine"],
  ["highpass", "HP", "Highpass", "ph:wave-triangle"],
  ["bandpass", "BP", "Bandpass", "ph:wave-square"],
] as const;
const ENVELOPE_CURVES = [
  ["linear", "Lin", "Linear", "ph:minus"],
  ["exp", "Exp", "Exponential", "ph:trend-up"],
  ["log", "Log", "Logarithmic", "ph:trend-down"],
  ["s-curve", "S", "S-curve", "ph:wave-sine"],
] as const;
const LFO_SHAPES = [
  ["sine", "Sine", "ph:wave-sine"],
  ["triangle", "Triangle", "ph:wave-triangle"],
  ["saw", "Saw", "ph:wave-sawtooth"],
  ["square", "Square", "ph:wave-square"],
] as const;

function performanceSourceForSummaryId(id: string): ModulationSourceId | undefined {
  if (id === "velocity") return "velocity";
  if (id === "keytrack") return "keytrack";
  if (id === "mod-wheel") return "modWheel";
  if (id === "pressure") return "pressure";
  if (id === "timbre") return "timbre";
  return undefined;
}

function auditionSecondsForInstrument(instrument: Instrument): number {
  const attack = Math.max(0, (instrument.envelope.attackMs ?? 0) / 1000);
  const decay = Math.max(0, (instrument.envelope.decayMs ?? 0) / 1000);
  const sustain = Math.max(0, Math.min(1, instrument.envelope.sustain ?? 0));
  const release = Math.max(0, (instrument.envelope.releaseMs ?? 0) / 1000);
  if (sustain <= 0.04) {
    return Math.max(0.65, Math.min(MAX_AUDITION_SECONDS, attack + decay + release + 0.18));
  }
  if (attack >= 0.65 || release >= 1.5) {
    return Math.min(MAX_AUDITION_SECONDS, Math.max(AUDITION_SECONDS, attack + 1.2));
  }
  return AUDITION_SECONDS;
}
const LFO_SYNC_RATES = [
  ["1/1", "1/1", "Whole note", "ph:metronome"],
  ["1/2", "1/2", "Half note", "ph:metronome"],
  ["1/4", "1/4", "Quarter note", "ph:metronome"],
  ["1/8", "1/8", "Eighth note", "ph:metronome"],
  ["1/16", "1/16", "Sixteenth note", "ph:metronome"],
  ["1/32", "1/32", "Thirty-second note", "ph:metronome"],
] as const;
interface AuditionHandle {
  node: AudioNode;
  stop: (when?: number) => void;
}

export interface SynthEditorProps {
  instrumentId?: string;
  hotkeyScopeId?: string;
}

export function SynthEditor(props: SynthEditorProps & { editorKind?: "synth" | "lumen" }) {
  onCleanup(registerGlobalAudioStop(stopAudition));
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const boundInstrumentId = createStoreSelector(useSynthStore, (state) => state.boundInstrumentId);
  const liveExpressionActivities = createStoreSelector(useSynthStore, (state) => state.expressionActivityByInstrument);
  const instruments = createStoreSelector(useInstrumentStore, (state) => state.instruments);
  const bindInstrument = useSynthStore.getState().bindInstrument;
  const setDraft = useSynthStore.getState().setDraft;
  const setName = useSynthStore.getState().setName;
  const addInstrument = useInstrumentStore.getState().addInstrument;
  const updateInstrument = useInstrumentStore.getState().updateInstrument;
  const closeEditor = useUiStore.getState().closeEditor;
  const synthInstruments = createMemo(() => instruments().filter((instrument) => instrument.kind === "synth" || instrument.kind === "wavetable"));

  let didAutoBind = false;
  let audioCtx: AudioContext | null = null;
  let audition: AuditionHandle | null = null;
  let gain: GainNode | null = null;
  let analyzerFrame: number | null = null;
  let analyzerSequence = 1;
  let bodyRef: HTMLDivElement | undefined;
  let focusedSourceTimer: number | null = null;

  const [taxonomyTypeOpen, setTaxonomyTypeOpen] = createSignal(false);
  const [taxonomyNameOpen, setTaxonomyNameOpen] = createSignal(false);
  const [importPresetOpen, setImportPresetOpen] = createSignal(false);
  const [auditioning, setAuditioning] = createSignal(false);
  const [focusedSourceTarget, setFocusedSourceTarget] = createSignal<SynthModulationSourceEditorTarget | null>(null);
  const [expressionActivity, setExpressionActivity] = createSignal<SynthExpressionActivity | null>(null);
  const effectiveExpressionActivity = createMemo(() => {
    const localActivity = expressionActivity();
    if (localActivity) return localActivity;
    const id = boundInstrumentId();
    return id ? liveExpressionActivities()[id] ?? null : null;
  });
  const analyzerWaveform = createMemo(() => renderAetherOutputPreviewSamples(synthDraftToPreviewInstrument(draft()), 320, "mix"));
  const importPresetOptions = createMemo(() => FACTORY_SYNTH_PRESETS);
  const hotkeyScopeId = () => props.hotkeyScopeId ?? (props.instrumentId ? `synth-editor-${props.instrumentId}` : "synth-editor");

  useContextualHotkey(hotkeyScopeId, "space", () => {
    const target = document.activeElement as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "BUTTON" ||
        target.tagName === "SELECT" ||
        target.isContentEditable ||
        target.closest("button, select, [role='button'], [role='menuitem'], [data-native-keyboard-control]"))
    ) {
      return false;
    }
    void onAudition();
    return true;
  });

  createEffect(() => {
    const id = props.instrumentId;
    if (!id) return;
    const instrument = instruments().find((candidate) => candidate.id === id);
    if (!instrument || boundInstrumentId() === id) return;
    didAutoBind = true;
    bindInstrument(instrument.id);
    setDraft(synthDraftFromInstrument(instrument));
  });

  createEffect(() => {
    if (props.instrumentId || didAutoBind || boundInstrumentId() || synthInstruments().length === 0) return;
    const first = synthInstruments()[0];
    didAutoBind = true;
    bindInstrument(first.id);
    setDraft(synthDraftFromInstrument(first));
  });

  onCleanup(() => {
    if (focusedSourceTimer != null) window.clearTimeout(focusedSourceTimer);
    stopAudition();
    closeAudioContext();
  });

  function getAudioContext(): AudioContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!audioCtx || audioCtx.state === "closed") audioCtx = new Ctor();
    return audioCtx;
  }

  function closeAudioContext() {
    const ctx = audioCtx;
    audioCtx = null;
    if (!ctx || ctx.state === "closed") return;
    void ctx.close().catch(() => undefined);
  }

  function stopAudition() {
    const currentAudition = audition;
    const currentGain = gain;
    audition = null;
    gain = null;
    stopAuditionAnalyzer();
    setAuditioning(false);
    setExpressionActivity(null);
    if (!currentAudition) return;

    try {
      const ctx = currentAudition.node.context;
      if (currentGain) {
        currentGain.gain.cancelScheduledValues(ctx.currentTime);
        currentGain.gain.setValueAtTime(currentGain.gain.value, ctx.currentTime);
        currentGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.025);
      }
      currentAudition.stop(ctx.currentTime + 0.03);
      window.setTimeout(() => {
        try {
          currentAudition.node.disconnect();
          currentGain?.disconnect();
        } catch {
          // Already disconnected.
        }
      }, 80);
    } catch {
      // Already stopped nodes throw in some browsers.
    }
  }

  async function onAudition(options: { patch?: SynthDraftPatch | null; restart?: boolean } = {}) {
    if (auditioning()) {
      stopAudition();
      if (!options.restart) return;
    }

    stopAudition();
    const ctx = getAudioContext();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);

    const instrument = synthDraftToPreviewInstrument(options.patch ?? draft());
    const auditionSeconds = auditionSecondsForInstrument(instrument);
    const bpm = useProjectStore.getState().project.bpm;
    const frequency = previewFrequency(instrument);
    setExpressionActivity({
      source: "preview",
      activeNotes: 1,
      pitchBendSemitones: 0,
      velocity: 1,
      keytrack: keytrackFromFrequency(frequency),
      modWheel: 0,
      pressure: 0,
      timbre: 0,
    });
    let handle: AuditionHandle | null = null;
    let seededAnalyzer = false;
    const finishAudition = (node: AudioNode) => {
      if (audition?.node !== node) return;
      const gainNode = gain;
      audition = null;
      gain = null;
      stopAuditionAnalyzer();
      setAuditioning(false);
      setExpressionActivity(null);
      try {
        node.disconnect();
        gainNode?.disconnect();
      } catch {
        // Already disconnected.
      }
    };

    const worklet = await createSynthWorkletPreviewNode(ctx, instrument, auditionSeconds, frequency, () => {
      if (handle) finishAudition(handle.node);
    }, { bpm }).catch(() => null);
    if (worklet) {
      handle = {
        node: worklet.node,
        stop: () => worklet.stop(),
      };
    } else {
      const buffer = renderedInstrumentBuffer(ctx, instrument, auditionSeconds, frequency, undefined, bpm);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      seedAnalyzerFromSamples(mixStereoToMono(left, right));
      seededAnalyzer = true;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      handle = {
        node: source,
        stop: (when?: number) => source.stop(when),
      };
      source.onended = () => finishAudition(source);
    }

    const nextGain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    nextGain.gain.value = 0;
    nextGain.gain.setValueAtTime(0, ctx.currentTime);
    nextGain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.015);
    nextGain.gain.setTargetAtTime(0, ctx.currentTime + Math.max(0.05, auditionSeconds - 0.08), 0.03);
    handle.node.connect(nextGain).connect(analyser).connect(ctx.destination);
    audition = handle;
    gain = nextGain;
    startAuditionAnalyzer(analyser);
    setAuditioning(true);
    if (handle.node instanceof AudioBufferSourceNode) {
      handle.node.start();
      handle.node.stop(ctx.currentTime + auditionSeconds);
    } else if (!seededAnalyzer) {
      publishAnalyzerSnapshot(createEmptyAnalyzerSnapshot());
    }
  }

  function startAuditionAnalyzer(analyser: AnalyserNode) {
    stopAuditionAnalyzer(false);
    const frequency = new Uint8Array(analyser.frequencyBinCount);
    const time = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteFrequencyData(frequency);
      analyser.getByteTimeDomainData(time);

      let sumSquares = 0;
      let peak = 0;
      for (let i = 0; i < time.length; i += 1) {
        const sample = (time[i] - 128) / 128;
        sumSquares += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }

      const bands = makeAnalyzerBands(frequency);
      if (peak > 0.0001 || bands.some((value) => value > 0.001)) {
        publishAnalyzerSnapshot({
          rms: Math.sqrt(sumSquares / Math.max(1, time.length)),
          peak,
          bands,
        });
      }

      analyzerFrame = window.requestAnimationFrame(tick);
    };

    tick();
  }

  function stopAuditionAnalyzer(clear = true) {
    if (analyzerFrame !== null) {
      window.cancelAnimationFrame(analyzerFrame);
      analyzerFrame = null;
    }
    if (clear) {
      useAnalyzerStore.getState().clearSynth();
    }
  }

  function seedAnalyzerFromSamples(samples: Float32Array) {
    const summary = summarizeBuffer(samples);
    if (summary.peak <= 0) return;
    publishAnalyzerSnapshot({
      rms: summary.rms,
      peak: summary.peak,
      bands: makeFftBands(samples),
    });
  }

  function publishAnalyzerSnapshot(snapshot: Pick<AnalyzerSnapshot, "rms" | "peak" | "bands">) {
    const next: AnalyzerSnapshot = {
      sequence: analyzerSequence++,
      rms: snapshot.rms,
      peak: snapshot.peak,
      bands: snapshot.bands.slice(0, ANALYZER_BANDS),
      updatedAt: Date.now(),
    };
    useAnalyzerStore.getState().setSynthSnapshot(next);
  }

  async function saveDraftToInstrument(): Promise<string> {
    const patch = synthDraftToInstrumentPatch(draft());
    let id = boundInstrumentId();
    if (id && instruments().some((instrument) => instrument.id === id)) {
      updateInstrument(id, patch);
    } else {
      id = addInstrument({
        ...patch,
        name: patch.name ?? "Wavetable Synth",
        userCreated: true,
      });
      didAutoBind = true;
      bindInstrument(id);
    }

    return id;
  }

  async function onApply() {
    await saveDraftToInstrument();
  }

  async function onSaveInstrument() {
    await saveDraftToInstrument();
    if (props.instrumentId) closeEditor({ kind: "synthInstrument", instrumentId: props.instrumentId });
    else closeEditor({ kind: props.editorKind ?? "synth" });
  }

  function onCancelInstrument() {
    if (props.instrumentId) closeEditor({ kind: "synthInstrument", instrumentId: props.instrumentId });
    else closeEditor({ kind: props.editorKind ?? "synth" });
  }

  function setInstrumentTaxonomyById(instrumentId: string) {
    const taxonomy = taxonomyAssignmentForInstrumentId(instrumentId);
    if (!taxonomy) return;
    setDraft({
      ...draft(),
      taxonomy,
      metadata: {
        ...draft().metadata,
        icon: iconForInstrumentTaxonomy(taxonomy.categoryId),
      },
    });
  }

  function setInstrumentTaxonomyType(categoryId: string) {
    const firstInstrumentId = firstInstrumentTaxonomyIdForCategory(categoryId);
    if (!firstInstrumentId) return;
    setInstrumentTaxonomyById(firstInstrumentId);
  }

  function importFactoryPreset(preset: SynthFactoryPresetRecord) {
    setDraft(preset.patch);
    setImportPresetOpen(false);
    setTaxonomyTypeOpen(false);
    setTaxonomyNameOpen(false);
  }

  function focusModulationSourceEditor(source: ModulationSourceId) {
    const targetId = modulationSourceEditorTarget(source);
    setFocusedSourceTarget(targetId);
    if (focusedSourceTimer != null) window.clearTimeout(focusedSourceTimer);
    focusedSourceTimer = window.setTimeout(() => {
      setFocusedSourceTarget((current) => current === targetId ? null : current);
      focusedSourceTimer = null;
    }, 1800);

    queueMicrotask(() => {
      const target = bodyRef?.querySelector<HTMLElement>(`[data-synth-source-editor="${targetId}"]`);
      if (!target) return;
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const focusTarget = target.querySelector<HTMLElement>("[data-synth-source-focus], input, button, select, [tabindex]");
      focusTarget?.focus({ preventScroll: true });
    });
  }

  return (
    <div
      class={`ds-editor-shell ds-fill ${styles.shell}`}
      role="region"
      aria-label={draft().instrumentType === "lumen-hybrid-synth" ? "Lumen engine" : "Aether engine"}
    >
      <div ref={bodyRef} class={`ds-editor-body ds-scroll ${styles.body}`}>
        <section
          class={`${styles.majorSection} ${styles.identitySection} ${focusedSourceTarget() === "performance" ? styles.sourceFocus : ""}`}
          aria-label="Synth identity"
          data-synth-source-editor="performance"
        >
          <div class={styles.identityBody}>
            <InstrumentOutputPreview
              samples={analyzerWaveform()}
              playing={auditioning()}
              onToggle={() => void onAudition()}
              instrumentName={draft().instrumentType === "lumen-hybrid-synth" ? "Lumen" : "Aether"}
            />
            <div class={styles.identityFields}>
              <div class={styles.nameRow}>
                <TextInput
                  className={styles.nameField}
                  label="Name"
                  layout="inline"
                  value={draft().name}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              </div>
              <div class={styles.importPresetWrap}>
                <Button
                  size="xs"
                  variant="ghost"
                  className={styles.importPresetButton}
                  aria-expanded={importPresetOpen() ? "true" : "false"}
                  onClick={() => setImportPresetOpen((open) => !open)}
                >
                  Import Preset
                </Button>
                <Show when={importPresetOpen()}>
                  <div class={styles.importPresetMenu} role="menu" aria-label="Factory Aether presets">
                    <For each={importPresetOptions()}>
                      {(preset) => (
                        <Button
                          variant="ghost"
                          fullWidth
                          class={styles.importPresetItem}
                          role="menuitem"
                          onClick={() => importFactoryPreset(preset)}
                        >
                          <span class={styles.importPresetName}>{preset.name}</span>
                          <span class={styles.importPresetMeta}>{preset.family} / {preset.role}</span>
                        </Button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <div class={styles.taxonomyControls}>
                <FloatingSelect
                  label="Category"
                  layout="inline"
                  className={styles.taxonomySelect}
                  value={draft().taxonomy?.categoryId ?? "synth_electronic"}
                  ariaLabel="Category"
                  options={INSTRUMENT_TAXONOMY_CATEGORY_OPTIONS}
                  open={taxonomyTypeOpen()}
                  onOpenChange={setTaxonomyTypeOpen}
                  onChange={setInstrumentTaxonomyType}
                />
                <FloatingSelect
                  label="Instrument"
                  layout="inline"
                  className={styles.taxonomySelect}
                  value={draft().taxonomy?.instrumentId ?? "wavetable_synth"}
                  ariaLabel="Instrument"
                  options={instrumentTaxonomyOptionsForCategory(draft().taxonomy?.categoryId ?? "synth_electronic")}
                  open={taxonomyNameOpen()}
                  onOpenChange={setTaxonomyNameOpen}
                  onChange={setInstrumentTaxonomyById}
                />
              </div>
              <MpeZoneControls />
              <div class={styles.expressionSummary} aria-label="Aether expression and performance summary">
                <For each={synthExpressionSummary(draft(), effectiveExpressionActivity())}>
                  {(item) => (
                    <div
                      class={styles.expressionSummaryItem}
                      data-active={item.active ? "true" : "false"}
                      data-live={item.live ? "true" : "false"}
                      data-synth-source-id={performanceSourceForSummaryId(item.id)}
                      data-mesh-variant={meshTintVariantFor(item.id)}
                      title={`${item.label}: ${item.value} - ${item.detail}`}
                    >
                      <Show when={performanceSourceForSummaryId(item.id)}>
                        <span class={styles.sourcePickAnchor} data-synth-pick-anchor aria-hidden="true">
                          <Icon name="ph:plug" size={18} decorative />
                        </span>
                      </Show>
                      <span class={styles.expressionSummaryLabel}>
                        {item.label}
                        <HoverInfo content={item.detail}>
                          <span
                            class={styles.expressionSummaryInfo}
                            aria-label={`${item.label} description`}
                            role="img"
                            tabIndex={0}
                          >
                            i
                          </span>
                        </HoverInfo>
                      </span>
                      <strong>{item.value}</strong>
                      <small>{item.detail}</small>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </section>

        <OscillatorPanel />

        <LfoPanel focusedSourceTarget={focusedSourceTarget()} />

        <Show when={draft().instrumentType === "lumen-hybrid-synth"}>
          <LumenArpeggiatorPanel />
          <LumenClipPanel />
        </Show>

        <InstrumentFxRack />

        <AmpFilterPanel focusedSourceTarget={focusedSourceTarget()} />

        <div class={styles.macroModGrid}>
          <MacroControlsPanel focusedSourceTarget={focusedSourceTarget()} />
          <ModulationMatrix onFocusSource={focusModulationSourceEditor} />
        </div>
      </div>

      <footer class={`ds-action-footer ${styles.footer}`}>
        <div class={styles.footerLeft}>
          <Button className={styles.footerButton} variant="ghost" selected={auditioning()} onClick={() => void onAudition()}>
            <Icon name={auditioning() ? "ph:stop-fill" : "ph:play-fill"} size={18} decorative />
            {auditioning() ? "Stop" : "Audition"}
          </Button>
        </div>
        <div class={styles.footerRight}>
          <Button className={styles.footerButton} variant="ghost" onClick={onCancelInstrument}>
            Cancel
          </Button>
          <Button className={styles.footerButton} onClick={() => void onApply()}>
            Apply
          </Button>
          <Button className={styles.footerButton} variant="primary" onClick={() => void onSaveInstrument()}>
            Save
          </Button>
        </div>
      </footer>
    </div>
  );
}

function LumenArpeggiatorPanel() {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const setParameter = useSynthStore.getState().setParameter;
  const setDraft = useSynthStore.getState().setDraft;
  const enabled = createMemo(() => draft().parameters["lumen.arp.enabled"] === true);

  return (
    <section class={`${styles.majorSection} ${enabled() ? "" : styles.disabledPanel}`} aria-label="Lumen arpeggiator">
      <div class={styles.ampFilterRibbon}>
        <Button
          iconOnly
          size="xs"
          selected={enabled()}
          className={styles.ampFilterPowerButton}
          aria-label={`${enabled() ? "Disable" : "Enable"} Lumen arpeggiator`}
          onClick={() => {
            if (!enabled()) {
              const current = draft();
              setDraft({
                ...current,
                parameters: { ...current.parameters, "lumen.arp.enabled": true, "lumen.clip.enabled": false },
              });
            } else setBooleanParameter("lumen.arp.enabled", false);
          }}
        >
          <Icon name={enabled() ? "ph:power-fill" : "ph:power"} size={18} decorative />
        </Button>
        <div class={styles.ampFilterRibbonTitle}>Arpeggiator</div>
      </div>
      <div class={styles.ampFilterBody}>
        <div class={`${styles.ampFilterGroup} ${styles.ampFilterWideGroup}`}>
          <div class={styles.ampFilterGroupTitle}>Pattern</div>
          <div class={styles.ampFilterShapeRow}>
            <ShapeButtonSet
              label="Arpeggiator mode"
              value={String(draft().parameters["lumen.arp.mode"] ?? "up")}
              options={[
                ["up", "Up", "Ascending", "ph:trend-up"],
                ["down", "Down", "Descending", "ph:trend-down"],
                ["upDown", "Up/Down", "Ascending and descending", "ph:wave-sine"],
                ["random", "Random", "Deterministic random", "ph:wave-square"],
              ]}
              onChange={(value) => setParameter("lumen.arp.mode", value)}
            />
          </div>
        </div>
        <div class={`${styles.ampFilterGroup} ${styles.ampFilterWideGroup}`}>
          <div class={styles.ampFilterGroupTitle}>Timing</div>
          <div class={styles.ampFilterShapeRow}>
            <ShapeButtonSet
              label="Arpeggiator rate"
              value={String(draft().parameters["lumen.arp.rate"] ?? "1/16")}
              options={[
                ["1/4", "1/4", "Quarter notes", "ph:music-note"],
                ["1/8", "1/8", "Eighth notes", "ph:music-note"],
                ["1/16", "1/16", "Sixteenth notes", "ph:music-notes"],
                ["1/32", "1/32", "Thirty-second notes", "ph:music-notes"],
              ]}
              onChange={(value) => setParameter("lumen.arp.rate", value)}
            />
          </div>
          <div class={styles.knobCluster}>
            <SynthParameterKnob id="lumen.arp.gate" label="Gate" defaultValue={0.75} onChange={setNumericParameter} />
            <SynthParameterKnob id="lumen.arp.swing" label="Swing" defaultValue={0} max={0.75} onChange={setNumericParameter} />
            <NumberInput
              label="Octaves"
              layout="inline"
              value={getNumberParam(draft(), "lumen.arp.octaves")}
              min={1}
              max={4}
              step={1}
              ariaLabel="Arpeggiator octave range"
              onChange={(value) => setNumericParameter("lumen.arp.octaves", value)}
            />
          </div>
        </div>
        <div class={`${styles.ampFilterGroup} ${styles.ampFilterAmpGroup}`}>
          <div class={styles.ampFilterGroupTitle}>Key &amp; Scale</div>
          <div class={styles.taxonomyControls}>
            <FloatingSelect
              label="Key"
              layout="inline"
              className={styles.taxonomySelect}
              value={String(draft().parameters["lumen.arp.key"] ?? "c")}
              ariaLabel="Arpeggiator key"
              options={[
                { value: "c", label: "C" }, { value: "cSharp", label: "C♯ / D♭" },
                { value: "d", label: "D" }, { value: "dSharp", label: "D♯ / E♭" },
                { value: "e", label: "E" }, { value: "f", label: "F" },
                { value: "fSharp", label: "F♯ / G♭" }, { value: "g", label: "G" },
                { value: "gSharp", label: "G♯ / A♭" }, { value: "a", label: "A" },
                { value: "aSharp", label: "A♯ / B♭" }, { value: "b", label: "B" },
              ]}
              onChange={(value) => setParameter("lumen.arp.key", value)}
            />
            <FloatingSelect
              label="Scale"
              layout="inline"
              className={styles.taxonomySelect}
              value={String(draft().parameters["lumen.arp.scale"] ?? "chromatic")}
              ariaLabel="Arpeggiator scale"
              options={[
                { value: "chromatic", label: "Chromatic" },
                { value: "major", label: "Major" },
                { value: "naturalMinor", label: "Natural Minor" },
                { value: "majorPentatonic", label: "Major Pentatonic" },
                { value: "blues", label: "Blues" },
              ]}
              onChange={(value) => setParameter("lumen.arp.scale", value)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function LumenClipPanel() {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setDraft = useSynthStore.getState().setDraft;
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setParameter = useSynthStore.getState().setParameter;
  const clip = createMemo(() => draft().metadata.lumenClip!);
  const notes = createMemo(() => lumenClipToMidiNotes(clip()));
  const enabled = createMemo(() => draft().parameters["lumen.clip.enabled"] === true);
  const midiPatterns = createStoreSelector(useComponentStore, (state) => state.components.filter((component) => (component.kind ?? "midi") === "midi"));
  const [patternSelectOpen, setPatternSelectOpen] = createSignal(false);
  const [selectedPatternId, setSelectedPatternId] = createSignal("");

  function updateNotes(nextNotes: Parameters<typeof midiNotesToLumenClip>[1]) {
    const current = draft();
    const nextClip = midiNotesToLumenClip(current.metadata.lumenClip!, nextNotes);
    setDraft({ ...current, metadata: { ...current.metadata, lumenClip: nextClip } });
  }

  function updateLength(nextLengthSteps: number) {
    const current = draft();
    const nextClip = midiNotesToLumenClip(current.metadata.lumenClip!, notes(), nextLengthSteps);
    setDraft({ ...current, metadata: { ...current.metadata, lumenClip: nextClip } });
  }

  function toggleEnabled() {
    const current = draft();
    setDraft({
      ...current,
      parameters: {
        ...current.parameters,
        "lumen.clip.enabled": !enabled(),
        ...(!enabled() ? { "lumen.arp.enabled": false } : {}),
      },
    });
  }

  function importSelectedPattern() {
    const pattern = midiPatterns().find((component) => component.id === selectedPatternId());
    if (!pattern || pattern.kind === "drum") return;
    const current = draft();
    const nextClip = midiPatternToLumenClip(pattern.notes, pattern.lengthBeats);
    setDraft({ ...current, metadata: { ...current.metadata, lumenClip: nextClip } });
  }

  return (
    <section class={`${styles.majorSection} ${enabled() ? "" : styles.disabledPanel}`} aria-label="Lumen clip sequencer">
      <div class={styles.ampFilterRibbon}>
        <Button
          iconOnly
          size="xs"
          selected={enabled()}
          className={styles.ampFilterPowerButton}
          aria-label={`${enabled() ? "Disable" : "Enable"} Lumen clip sequencer`}
          onClick={toggleEnabled}
        >
          <Icon name={enabled() ? "ph:power-fill" : "ph:power"} size={18} decorative />
        </Button>
        <div class={styles.ampFilterRibbonTitle}>Clip</div>
      </div>
      <div class={`${styles.ampFilterBody} ${styles.clipBody}`}>
        <div class={styles.ampFilterGroup}>
          <div class={styles.ampFilterGroupTitle}>Timing</div>
          <div class={styles.ampFilterShapeRow}>
            <FloatingSelect
              label="Rate"
              layout="inline"
              value={String(draft().parameters["lumen.clip.rate"] ?? "1/16")}
              ariaLabel="Clip step rate"
              options={[
                { value: "1/4", label: "1/4" },
                { value: "1/8", label: "1/8" },
                { value: "1/16", label: "1/16" },
                { value: "1/32", label: "1/32" },
              ]}
              onChange={(value) => setParameter("lumen.clip.rate", value)}
            />
            <SynthParameterKnob id="lumen.clip.swing" label="Swing" defaultValue={0} max={0.75} onChange={setNumericParameter} />
          </div>
        </div>
        <div class={`${styles.ampFilterGroup} ${styles.clipSummary}`}>
          <div class={styles.ampFilterGroupTitle}>Single Clip</div>
          <span>{clip().lengthSteps} steps</span>
          <span>{clip().notes.length} / 64 notes</span>
          <span>Trigger note transposes the pattern</span>
        </div>
        <div class={`${styles.ampFilterGroup} ${styles.clipPatternImport}`}>
          <div class={styles.ampFilterGroupTitle}>Pattern import</div>
          <FloatingSelect
            label="Pattern"
            layout="inline"
            value={selectedPatternId()}
            ariaLabel="Reusable MIDI pattern"
            options={[
              { value: "", label: midiPatterns().length > 0 ? "Choose pattern" : "No MIDI patterns" },
              ...midiPatterns().map((pattern) => ({ value: pattern.id, label: pattern.name })),
            ]}
            searchable
            searchPlaceholder="Search MIDI patterns"
            open={patternSelectOpen()}
            onOpenChange={setPatternSelectOpen}
            onChange={setSelectedPatternId}
          />
          <Button size="xs" disabled={!selectedPatternId()} onClick={importSelectedPattern}>
            <Icon name="ph:download-simple" size={18} decorative />
            Import notes
          </Button>
          <span>Uses notes, timing, length, and velocity; the first note becomes the trigger root.</span>
        </div>
        <div class={styles.clipPianoRoll} aria-label="Lumen clip piano roll">
          <PianoRoll
            notes={notes()}
            lengthBeats={clip().lengthSteps}
            onLengthChange={updateLength}
            onChange={updateNotes}
            bottomPitch={LUMEN_CLIP_BOTTOM_PITCH}
            topPitch={LUMEN_CLIP_TOP_PITCH}
            pitchLabel={lumenClipPitchLabel}
            fixedGridStepBeats={1}
            defaultNoteLengthBeats={1}
            minimumNoteLengthBeats={1}
            maxNotes={64}
          />
        </div>
      </div>
    </section>
  );
}

function MpeZoneControls() {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const enabled = createMemo(() => draft().parameters["aether.mpe.enabled"] === true);
  const master = createMemo(() => Math.round(getNumberParam(draft(), "aether.mpe.masterChannel")));
  const firstMember = createMemo(() => Math.round(getNumberParam(draft(), "aether.mpe.firstMemberChannel")));
  const lastMember = createMemo(() => Math.round(getNumberParam(draft(), "aether.mpe.lastMemberChannel")));
  const valid = createMemo(() => master() < firstMember() || master() > lastMember());

  function setChannel(id: "aether.mpe.masterChannel" | "aether.mpe.firstMemberChannel" | "aether.mpe.lastMemberChannel", value: number) {
    const channel = Math.max(1, Math.min(16, Math.round(value)));
    const nextMaster = id === "aether.mpe.masterChannel" ? channel : master();
    const nextFirst = id === "aether.mpe.firstMemberChannel" ? channel : firstMember();
    const nextLast = id === "aether.mpe.lastMemberChannel" ? channel : lastMember();
    setNumericParameter(id, channel);
    if (nextMaster >= nextFirst && nextMaster <= nextLast)
      setBooleanParameter("aether.mpe.enabled", false);
  }

  return (
    <div class={styles.mpeZoneControls} aria-label="Aether MPE member zone">
      <Toggle
        className={styles.mpeZoneToggle}
        label="MPE zone"
        checked={enabled()}
        aria-label="Enable Aether MPE member zone"
        onChange={(next) => setBooleanParameter("aether.mpe.enabled", next && valid())}
      />
      <NumberInput
        label="Manager"
        layout="inline"
        value={master()}
        min={1}
        max={16}
        step={1}
        ariaLabel="MPE manager channel"
        className={styles.mpeChannelInput}
        onChange={(value) => setChannel("aether.mpe.masterChannel", value)}
      />
      <NumberInput
        label="First"
        layout="inline"
        value={firstMember()}
        min={1}
        max={lastMember()}
        step={1}
        ariaLabel="First MPE member channel"
        className={styles.mpeChannelInput}
        onChange={(value) => setChannel("aether.mpe.firstMemberChannel", value)}
      />
      <NumberInput
        label="Last"
        layout="inline"
        value={lastMember()}
        min={firstMember()}
        max={16}
        step={1}
        ariaLabel="Last MPE member channel"
        className={styles.mpeChannelInput}
        onChange={(value) => setChannel("aether.mpe.lastMemberChannel", value)}
      />
      <span class={styles.mpeZoneStatus} data-valid={valid() ? "true" : "false"}>
        {valid()
          ? enabled() ? `Ch ${master()} -> ${firstMember()}-${lastMember()}` : "Saved zone off; RPN 6 may enable at runtime"
          : "Manager must be outside the member range"}
      </span>
    </div>
  );
}

function InstrumentOutputPreview(props: {
  samples: number[];
  playing: boolean;
  onToggle: () => void;
  instrumentName: "Aether" | "Lumen";
}) {
  return (
    <div class={styles.identityPreview} aria-label={`${props.instrumentName} output preview`}>
      <SynthCurvePreview samples={props.samples} label={`${props.instrumentName} output waveform`} />
      <div class={styles.identityPreviewActions}>
        <Button size="xs" variant="ghost" selected={props.playing} onClick={props.onToggle}>
          <Icon name={props.playing ? "ph:pause-fill" : "ph:play-fill"} size={18} decorative />
          {props.playing ? "Pause" : "Play"}
        </Button>
        <Button size="xs" variant="ghost">
          Loop
        </Button>
      </div>
    </div>
  );
}

function InstrumentFxRack() {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setDraft = useSynthStore.getState().setDraft;
  const effects = createMemo(() => draft().effects.filters);
  const instrumentName = createMemo(() => draft().instrumentType === "lumen-hybrid-synth" ? "Lumen" : "Aether");
  const [draggedEffectId, setDraggedEffectId] = createSignal<string | null>(null);
  const [dragOverEffectId, setDragOverEffectId] = createSignal<string | null>(null);

  function updateEffects(filters: TrackEffect[]) {
    setDraft({
      ...draft(),
      effects: normalizeTrackEffectChain({ filters }),
    });
  }

  function addEffect(kind: EffectKind) {
    updateEffects([...effects(), createTrackEffect(kind)]);
  }

  function patchEffect(effectId: string, patch: Partial<TrackEffect>) {
    updateEffects(effects().map((effect) => (
      effect.id === effectId ? { ...effect, ...patch } : effect
    )));
  }

  function patchParam(effect: TrackEffect, key: string, value: number) {
    patchEffect(effect.id, {
      params: {
        ...effect.params,
        [key]: value,
      },
    });
  }

  function reorderEffect(dragId: string, targetId: string, insertAfter: boolean) {
    if (dragId === targetId) return;
    const current = effects();
    const dragIndex = current.findIndex((effect) => effect.id === dragId);
    const targetIndex = current.findIndex((effect) => effect.id === targetId);
    if (dragIndex < 0 || targetIndex < 0) return;
    const next = current.slice();
    const [item] = next.splice(dragIndex, 1);
    let insertIndex = targetIndex + (insertAfter ? 1 : 0);
    if (dragIndex < insertIndex) insertIndex -= 1;
    next.splice(Math.max(0, Math.min(next.length, insertIndex)), 0, item);
    updateEffects(next);
  }

  function startEffectDrag(effectId: string, event: DragEvent) {
    setDraggedEffectId(effectId);
    event.dataTransfer?.setData("text/plain", effectId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function effectDropTargetFromPoint(x: number, y: number): string | null {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-effect-id]");
    return target?.dataset.effectId ?? null;
  }

  function startEffectPointerDrag(effectId: string, event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    setDraggedEffectId(effectId);
    const move = (moveEvent: PointerEvent) => {
      const targetId = effectDropTargetFromPoint(moveEvent.clientX, moveEvent.clientY);
      setDragOverEffectId(targetId && targetId !== effectId ? targetId : null);
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const targetId = effectDropTargetFromPoint(upEvent.clientX, upEvent.clientY);
      setDraggedEffectId(null);
      setDragOverEffectId(null);
      if (!targetId || targetId === effectId) return;
      const target = document.querySelector<HTMLElement>(`[data-effect-id="${targetId}"]`);
      const rect = target?.getBoundingClientRect();
      reorderEffect(effectId, targetId, rect ? upEvent.clientX > rect.left + rect.width / 2 : false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }

  function dropEffectOn(effectId: string, event: DragEvent) {
    event.preventDefault();
    const dragId = draggedEffectId() ?? event.dataTransfer?.getData("text/plain");
    setDraggedEffectId(null);
    setDragOverEffectId(null);
    if (!dragId) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    reorderEffect(dragId, effectId, event.clientX > rect.left + rect.width / 2);
  }

  function removeEffect(effectId: string) {
    updateEffects(effects().filter((effect) => effect.id !== effectId));
  }

  return (
    <section class={`ds-panel ${styles.fxPanel}`} aria-label={instrumentName() === "Lumen" ? "Lumen instrument effects" : "Aether instrument effects"}>
      <header class="ds-panel-header">
        <div class="ds-panel-title">Instrument FX</div>
      </header>
      <div class={`ds-panel-body ${styles.fxBody}`}>
        <div class={styles.fxChainSummary} aria-label={instrumentName() === "Lumen" ? "Current Lumen FX chain" : "Current Aether FX chain"}>
          <span>Current chain: {describeEffectChain(effects())}</span>
          <FloatingSelect
            layout="bare"
            triggerClassName={styles.fxAddSelect}
            aria-label="Add instrument effect"
            value=""
            options={[
              { value: "", label: "Add FX" },
              ...EFFECT_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
            ]}
            onChange={(nextValue) => {
              const value = nextValue as EffectKind;
              if (!value) return;
              addEffect(value);
            }}
          />
        </div>
        <Show when={effects().length > 0} fallback={<div class={styles.fxEmpty}>No instrument FX. Output goes directly to the track chain.</div>}>
          <div class={styles.fxChain}>
            <For each={effects().map((effect) => effect.id)}>
              {(effectId) => {
                const effect = () => effects().find((candidate) => candidate.id === effectId)!;
                return (
                <article
                  class={`${styles.fxBlock} ${effect().bypassed ? styles.fxBlockBypassed : ""}`}
                  data-effect-id={effectId}
                  data-dragging={draggedEffectId() === effectId ? "true" : "false"}
                  data-drag-over={dragOverEffectId() === effectId ? "true" : "false"}
                  onDragOver={(event) => {
                    if (!draggedEffectId() || draggedEffectId() === effectId) return;
                    event.preventDefault();
                    setDragOverEffectId(effectId);
                    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
                  }}
                  onDragLeave={() => {
                    if (dragOverEffectId() === effectId) setDragOverEffectId(null);
                  }}
                  onDrop={(event) => dropEffectOn(effectId, event)}
                >
                  <div class={styles.fxHeader}>
                    <button
                      type="button"
                      class={styles.fxDragHandle}
                      draggable
                      aria-label={`Drag ${EFFECT_LABELS[effect().kind]} to reorder`}
                      title="Drag to reorder"
                      onPointerDown={(event) => startEffectPointerDrag(effectId, event)}
                      onDragStart={(event) => startEffectDrag(effectId, event)}
                      onDragEnd={() => {
                        setDraggedEffectId(null);
                        setDragOverEffectId(null);
                      }}
                    >
                      <Icon name="ph:dots-six-vertical" size={18} decorative />
                    </button>
                    <Toggle
                      className={styles.fxToggle}
                      checked={!effect().bypassed}
                      aria-label={`${effect().bypassed ? "Enable" : "Bypass"} ${EFFECT_LABELS[effect().kind]}`}
                      onChange={(enabled) => patchEffect(effectId, { bypassed: !enabled })}
                    />
                    <div class={styles.fxTitleBlock}>
                      <div class={styles.fxTitleLine}>
                        <span class={styles.fxTitle}>{EFFECT_LABELS[effect().kind]}</span>
                        <span class={styles.fxBadges}>
                          <span>{formatEffectLatency(effect())}</span>
                          <span>{formatEffectTail(effect())}</span>
                        </span>
                      </div>
                    </div>
                    <div class={styles.fxActions}>
                      <HoverInfo content="Remove effect">
                        <FieldActionButton
                          className={styles.fxRemoveButton}
                          aria-label={`Remove ${EFFECT_LABELS[effect().kind]}`}
                          onClick={() => removeEffect(effectId)}
                        >
                          <Icon name="ph:trash" size={18} decorative />
                        </FieldActionButton>
                      </HoverInfo>
                    </div>
                  </div>
                  <div class={styles.fxParams}>
                    <For each={EFFECT_PARAM_SPECS[effect().kind]}>
                      {(param) => (
                        <EffectParamControl
                          param={param}
                          value={effect().params[param.key] ?? EFFECT_DEFAULT_PARAMS[effect().kind][param.key] ?? param.min}
                          onChange={(value) => patchParam(effect(), param.key, value)}
                        />
                      )}
                    </For>
                  </div>
                </article>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </section>
  );
}

function MacroControlsPanel(props: { focusedSourceTarget?: SynthModulationSourceEditorTarget | null }) {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const updateMacroDefinition = useSynthStore.getState().updateMacroDefinition;

  return (
    <section class={`ds-panel ${styles.macroPanel}`} aria-label="Macros">
      <header class="ds-panel-header">
        <div class="ds-panel-title">Macro Controls</div>
      </header>
      <div class={`ds-panel-body ${styles.macros}`}>
        <For each={MACRO_IDS}>
          {(id, index) => {
            const definition = () => macroDefinitionForId(draft(), id);
            const conflict = () => macroConflictSummaryForId(draft(), id);
            const conflictDetails = () => macroConflictDetailsForId(draft(), id);
            return (
              <div
                class={`${styles.macroCard} ${props.focusedSourceTarget === id ? styles.sourceFocus : ""}`}
                data-synth-source-editor={id}
                aria-label={`${definition().label} macro control`}
              >
                <TextInput
                  data-synth-source-focus
                  layout="bare"
                  aria-label={`Macro ${index() + 1} name`}
                  value={definition().label}
                  onInput={(event) => updateMacroDefinition(id, { label: event.currentTarget.value })}
                />
                <Knob
                  className={styles.macroKnob}
                  size="sm"
                  label={`M${index() + 1}`}
                  value={getNumberParam(draft(), id)}
                  min={0}
                  max={1}
                  step={0.01}
                  defaultValue={0}
                  {...modulationPropsForSource(draft(), id)}
                  pickSourceId={id}
                  formatValue={formatPercent}
                  onChange={(value) => setNumericParameter(id, value)}
                />
                <Show when={conflict().count > 0}>
                  <div
                    class={styles.macroConflict}
                    title={conflict().label}
                    aria-label={`${definition().label} macro conflict`}
                  >
                    <span>Conflict</span>
                    <span>{conflict().label}</span>
                    <For each={conflictDetails().slice(0, 2)}>
                      {(detail) => (
                        <div class={styles.macroConflictDetail} aria-label={`${detail.targetLabel} macro conflict detail`}>
                          <span>{detail.targetLabel}</span>
                          <span>{detail.competingSources.slice(0, 2).join(", ")}</span>
                          <span>Summed</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <FloatingSelect
                  layout="bare"
                  triggerClassName={styles.macroCurveSelect}
                  value={definition().curve}
                  aria-label={`${definition().label} response curve`}
                  options={[
                    { value: "linear", label: "Linear" },
                    { value: "ease-in", label: "Ease In" },
                    { value: "ease-out", label: "Ease Out" },
                    { value: "s-curve", label: "S-Curve" },
                  ]}
                  onChange={(value) => updateMacroDefinition(id, { curve: value as MacroCurve })}
                />
              </div>
            );
          }}
        </For>
      </div>
    </section>
  );
}

function EffectParamControl(props: {
  param: EffectParamSpec;
  value: number;
  onChange: (value: number) => void;
}) {
  const param = () => props.param;
  const value = () => props.value;
  const readout = () => formatEffectParamReadout(value(), param());

  return (
    <Show
      when={effectParamUsesSlider(param())}
      fallback={(
        <NumberInput
          label={param().label}
          value={value()}
          min={param().min}
          max={param().max}
          step={param().step}
          unit={param().unit}
          layout="inline"
          className={styles.fxNumberInput}
          onChange={props.onChange}
        />
      )}
    >
      <Slider
        className={styles.fxSlider}
        label={param().label}
        value={value()}
        min={param().min}
        max={param().max}
        step={param().step}
        layout="inline"
        inputClassName={styles.fxSliderInput}
        readoutClassName={styles.fxSliderReadout}
        readout={<span>{readout()}</span>}
        onChange={props.onChange}
      />
    </Show>
  );
}

function effectParamUsesSlider(param: EffectParamSpec): boolean {
  if (param.unit === "%") return true;
  if (param.key === "depthMs" && param.max <= 25) return true;
  if (param.key === "delayMs" && param.max <= 35) return true;
  if (param.key === "depthOct") return true;
  if (param.key === "makeupDb" || param.key === "trimDb") return true;
  return false;
}

function formatEffectParamReadout(value: number, param: EffectParamSpec): string {
  const rounded = Math.abs(param.step) >= 1 ? Math.round(value) : Number(value.toFixed(2));
  return param.unit ? `${rounded} ${param.unit}` : `${rounded}`;
}

function describeEffectChain(effects: TrackEffect[]): string {
  if (effects.length === 0) return "Empty instrument FX chain.";
  const labels = effects.map((effect) => {
    const label = EFFECT_LABELS[effect.kind] ?? effect.kind;
    return effect.bypassed ? `${label} bypassed` : label;
  });
  const bypassed = effects.filter((effect) => effect.bypassed).length;
  const suffix = bypassed > 0 ? ` / ${bypassed} bypassed` : "";
  return `${labels.length} ${labels.length === 1 ? "effect" : "effects"}: ${labels.join(" -> ")}${suffix}`;
}

function LfoPanel(props: { focusedSourceTarget?: SynthModulationSourceEditorTarget | null }) {
  return (
    <section class={`${styles.majorSection} ${styles.lfoPanel}`} aria-label="LFO">
      <div class={styles.majorSectionTitle}>LFO</div>
      <div class={styles.lfoStack}>
        <LfoLane lfo={1} focused={props.focusedSourceTarget === "lfo.1"} />
        <LfoLane lfo={2} focused={props.focusedSourceTarget === "lfo.2"} />
      </div>
    </section>
  );
}

function LfoLane(props: { lfo: 1 | 2; focused?: boolean }) {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const setParameter = useSynthStore.getState().setParameter;
  const prefix = `lfo.${props.lfo}` as const;
  const enabledId = `${prefix}.enabled` as SynthParameterId;
  const shapeId = `${prefix}.shape` as SynthParameterId;
  const rateId = `${prefix}.rate` as SynthParameterId;
  const syncId = `${prefix}.sync` as SynthParameterId;
  const syncedRateId = `${prefix}.syncedRate` as SynthParameterId;
  const smoothingId = `${prefix}.smoothing` as SynthParameterId;
  const randomPhaseId = `${prefix}.randomPhase` as SynthParameterId;
  const phaseId = `${prefix}.phase` as SynthParameterId;
  const retriggerId = `${prefix}.retrigger` as SynthParameterId;
  const oneShotId = `${prefix}.oneShot` as SynthParameterId;
  const keytrackRateId = `${prefix}.keytrackRate` as SynthParameterId;
  const enabled = createMemo(() => draft().parameters[enabledId] === true);
  const sync = createMemo(() => draft().parameters[syncId] === true);
  const retrigger = createMemo(() => draft().parameters[retriggerId] !== false);
  const oneShot = createMemo(() => draft().parameters[oneShotId] === true);
  const isLumen = createMemo(() => draft().instrumentType === "lumen-hybrid-synth");

  return (
    <div
      class={`${styles.lfoLane} ${enabled() ? "" : styles.disabledPanel} ${props.focused ? styles.sourceFocus : ""}`}
      aria-label={`LFO ${props.lfo}`}
      data-synth-source-editor={`lfo.${props.lfo}`}
      data-synth-source-id={`lfo.${props.lfo}`}
    >
      <header class={styles.lfoLaneHeader}>
        <div class={styles.lfoHeaderLeft}>
          <Button
            iconOnly
            size="xs"
            className={styles.lfoHeaderButton}
            selected={enabled()}
            aria-label={`${enabled() ? "Disable" : "Enable"} LFO ${props.lfo}`}
            onClick={() => setBooleanParameter(enabledId, !enabled())}
          >
            <Icon name={enabled() ? "ph:power-fill" : "ph:power"} size={18} decorative />
          </Button>
          <span class={styles.sourcePickAnchor} data-synth-pick-anchor aria-hidden="true">
            <Icon name="ph:plug" size={18} decorative />
          </span>
          <div class={styles.lfoLaneTitle}>LFO {props.lfo}</div>
          <SegmentedIconStrip
            ariaLabel={`LFO ${props.lfo} Shape`}
            value={String(draft().parameters[shapeId])}
            options={LFO_SHAPES}
            onChange={(value) => setParameter(shapeId, value)}
          />
          <span class={styles.lfoHeaderValue}>{selectedOptionLabel(LFO_SHAPES, String(draft().parameters[shapeId]))}</span>
        </div>
        <div class={styles.lfoHeaderActions}>
          <Button
            size="xs"
            className={styles.lfoHeaderTextButton}
            selected={oneShot()}
            aria-label={`${oneShot() ? "Disable" : "Enable"} LFO ${props.lfo} one-shot`}
            onClick={() => setBooleanParameter(oneShotId, !oneShot())}
          >
            <Icon name={oneShot() ? "ph:power-fill" : "ph:power"} size={18} decorative />
            <span>One Shot</span>
          </Button>
          <Button
            size="xs"
            className={styles.lfoHeaderTextButton}
            selected={retrigger()}
            aria-label={`${retrigger() ? "Disable" : "Enable"} LFO ${props.lfo} retrigger`}
            onClick={() => setBooleanParameter(retriggerId, !retrigger())}
          >
            <Icon name={retrigger() ? "ph:power-fill" : "ph:power"} size={18} decorative />
            <span>Retrigger</span>
          </Button>
        </div>
      </header>
      <div class={styles.lfoControls}>
        <div class={styles.lfoSyncBlock}>
          <Button
            size="xs"
            className={styles.lfoSyncButton}
            selected={sync()}
            aria-label={`${sync() ? "Disable" : "Enable"} LFO ${props.lfo} tempo sync`}
            onClick={() => setBooleanParameter(syncId, !sync())}
          >
            Sync
          </Button>
          <Show
            when={sync()}
            fallback={
              <Knob
                size="sm"
                label="Rate"
                value={getNumberParam(draft(), rateId)}
                min={0.05}
                max={50}
                step={0.01}
                unit="Hz"
                defaultValue={1}
                formatValue={(value) => `${value < 10 ? value.toFixed(2) : value.toFixed(1)}`}
                pickSourceId={`lfo.${props.lfo}` as ModulationSourceId}
                onChange={(value) => setNumericParameter(rateId, value)}
              />
            }
          >
            <SegmentedTextStrip
              ariaLabel={`LFO ${props.lfo} Sync Rate`}
              value={String(draft().parameters[syncedRateId] ?? (props.lfo === 1 ? "1/4" : "1/2"))}
              options={LFO_SYNC_RATES}
              onChange={(value) => setParameter(syncedRateId, value)}
            />
          </Show>
        </div>
        <div class={styles.lfoKnobBlock}>
          <Show when={isLumen()}>
            <HoverInfo content="Rate tracking around C4. At +100%, each octave doubles the LFO rate; negative values invert the relationship.">
              <Knob
                size="sm"
                label="Key Rate"
                value={getNumberParam(draft(), keytrackRateId)}
                min={-1}
                max={1}
                step={0.01}
                defaultValue={0}
                formatValue={(value) => `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`}
                onChange={(value) => setNumericParameter(keytrackRateId, value)}
              />
            </HoverInfo>
          </Show>
          <Knob
            size="sm"
            label="Phase"
            value={getNumberParam(draft(), phaseId)}
            min={0}
            max={1}
            step={0.01}
            defaultValue={0}
            formatValue={(value) => `${Math.round(value * 360)} deg`}
            onChange={(value) => setNumericParameter(phaseId, value)}
          />
          <Knob
            size="sm"
            label="Smooth"
            value={getNumberParam(draft(), smoothingId)}
            min={0}
            max={1}
            step={0.01}
            defaultValue={0}
            formatValue={formatPercent}
            onChange={(value) => setNumericParameter(smoothingId, value)}
          />
          <Knob
            size="sm"
            label="Random"
            value={getNumberParam(draft(), randomPhaseId)}
            min={0}
            max={1}
            step={0.01}
            defaultValue={0}
            formatValue={formatPercent}
            onChange={(value) => setNumericParameter(randomPhaseId, value)}
          />
        </div>
      </div>
    </div>
  );
}

function SegmentedIconStrip(props: {
  ariaLabel: string;
  value: string;
  options: ReadonlyArray<readonly [string, string, string] | readonly [string, string, string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div class={styles.segmentedIconStrip} role="radiogroup" aria-label={props.ariaLabel}>
      <For each={props.options}>
        {(option) => {
          const [optionValue, shortLabel, fullLabelOrIcon, maybeIcon] = option;
          const fullLabel = maybeIcon ? fullLabelOrIcon : shortLabel;
          const icon = maybeIcon ?? fullLabelOrIcon;
          const active = () => props.value === optionValue;
          return (
            <HoverInfo content={fullLabel}>
              <Button
                iconOnly
                size="xs"
                variant="ghost"
                selected={active()}
                role="radio"
                aria-checked={active()}
                aria-label={fullLabel}
                className={styles.segmentedIconButton}
                onClick={() => props.onChange(optionValue)}
              >
                <Icon name={icon} size={18} decorative />
              </Button>
            </HoverInfo>
          );
        }}
      </For>
    </div>
  );
}

function SegmentedTextStrip(props: {
  ariaLabel: string;
  value: string;
  options: ReadonlyArray<readonly [string, string, string] | readonly [string, string, string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div class={styles.segmentedTextStrip} role="radiogroup" aria-label={props.ariaLabel}>
      <For each={props.options}>
        {(option) => {
          const [optionValue, shortLabel, fullLabelOrIcon, maybeIcon] = option;
          const fullLabel = maybeIcon ? fullLabelOrIcon : shortLabel;
          const active = () => props.value === optionValue;
          return (
            <HoverInfo content={fullLabel}>
              <Button
                size="xs"
                variant="ghost"
                selected={active()}
                role="radio"
                aria-checked={active()}
                aria-label={fullLabel}
                className={styles.segmentedTextButton}
                onClick={() => props.onChange(optionValue)}
              >
                {shortLabel}
              </Button>
            </HoverInfo>
          );
        }}
      </For>
    </div>
  );
}

function selectedOptionLabel(
  options: ReadonlyArray<readonly [string, string, string] | readonly [string, string, string, string]>,
  value: string,
): string {
  return options.find((option) => option[0] === value)?.[1] ?? value;
}

function AmpFilterPanel(props: { focusedSourceTarget?: SynthModulationSourceEditorTarget | null }) {
  let sampleImportButton: HTMLButtonElement | undefined;
  let sampleSourceStatus: HTMLParagraphElement | undefined;
  let granularImportButton: HTMLButtonElement | undefined;
  let granularSourceStatus: HTMLParagraphElement | undefined;
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const returnBuses = createStoreSelector(useProjectStore, (state) => state.project.returnBuses);
  const audioFiles = createStoreSelector(useAudioFileStore, (state) => state.files);
  const setNumericParameter = useSynthStore.getState().setNumericParameter;
  const setBooleanParameter = useSynthStore.getState().setBooleanParameter;
  const setParameter = useSynthStore.getState().setParameter;
  const setDraft = useSynthStore.getState().setDraft;
  const filterType = createMemo(() => String(draft().parameters["filter.type"]));
  const filterEnabled = createMemo(() => draft().parameters["filter.enabled"] === true);
  const [fxBus1Open, setFxBus1Open] = createSignal(false);
  const [fxBus2Open, setFxBus2Open] = createSignal(false);
  const [sampleAssetOpen, setSampleAssetOpen] = createSignal(false);
  const [sampleRouteOpen, setSampleRouteOpen] = createSignal(false);
  const [sampleDirectionOpen, setSampleDirectionOpen] = createSignal(false);
  const [sampleLoopModeOpen, setSampleLoopModeOpen] = createSignal(false);
  const [sampleSliceOpen, setSampleSliceOpen] = createSignal(false);
  const [activeLumenSampleSlot, setActiveLumenSampleSlot] = createSignal<"a" | "b" | "c">("c");
  const [importingSfz, setImportingSfz] = createSignal(false);
  const [importingGranular, setImportingGranular] = createSignal(false);
  const [granularRouteOpen, setGranularRouteOpen] = createSignal(false);
  const fxBusOptions = createMemo(() => [
    { value: "", label: "Off" },
    ...returnBuses().filter((bus) => !bus.mute).map((bus) => ({ value: bus.id, label: bus.name || bus.id })),
  ]);
  const isLumen = createMemo(() => draft().instrumentType === "lumen-hybrid-synth");
  const activeLumenSourceMode = createMemo(() => isLumen()
    ? draft().metadata.lumenSourceRack?.slots.find((slot) => slot.id === activeLumenSampleSlot())?.mode ?? "wavetable"
    : null);
  const sampleParameterId = (suffix: string) => `${isLumen() ? `lumen.source.${activeLumenSampleSlot()}.sample` : "aether.sample.1"}.${suffix}` as SynthParameterId;
  const granularParameterId = (suffix: string) => `${isLumen() ? `lumen.source.${activeLumenSampleSlot()}.granular` : "aether.granular.2"}.${suffix}` as SynthParameterId;
  const mappedZones = createMemo(() => isLumen()
    ? draft().metadata.lumenSampleSlots?.[activeLumenSampleSlot()]?.zones ?? []
    : draft().metadata.sampleSlot1Zones ?? []);
  const sampleSlices = createMemo(() => isLumen()
    ? draft().metadata.lumenSampleSlots?.[activeLumenSampleSlot()]?.slices ?? []
    : []);
  const selectedSliceId = createMemo(() => String(
    draft().parameters[sampleParameterId("selectedSliceId")] ?? ""));
  const selectedSlice = createMemo(() => sampleSlices().find(
    (slice) => slice.id === selectedSliceId()));
  const managedSfz = createMemo(() => isLumen()
    ? draft().metadata.lumenSampleSlots?.[activeLumenSampleSlot()]?.managedSfz
    : draft().metadata.managedSfz);
  const managedGranular = createMemo(() => isLumen()
    ? draft().metadata.lumenGranularSlots?.[activeLumenSampleSlot()]?.managedAsset
    : draft().metadata.managedGranular);
  const sampleSourceAvailable = createMemo(() => Boolean(String(draft().parameters[sampleParameterId("audioFileId")] ?? "") || managedSfz()));
  const sampleSlotLabel = createMemo(() => draft().instrumentType === "lumen-hybrid-synth"
    ? `Source ${activeLumenSampleSlot().toUpperCase()} Sample`
    : "Sample Slot 1");
  const granularSourceAvailable = createMemo(() => Boolean(managedGranular() || draft().parameters[granularParameterId("builtinSource")] === "benchmark"));
  const sampleSourceDescription = createMemo(() => managedSfz()
    ? `Managed SFZ source: ${managedSfz()!.displayName}.`
    : String(draft().parameters[sampleParameterId("audioFileId")] ?? "")
      ? "Project audio source selected."
      : "No source selected. Choose a project audio asset or import an SFZ before enabling this slot.");
  const granularSourceDescription = createMemo(() => managedGranular()
    ? `Managed granular source: ${managedGranular()!.displayName}.`
    : draft().parameters[granularParameterId("builtinSource")] === "benchmark"
      ? "Built-in benchmark source selected."
      : "No source selected. Import audio or choose the benchmark source before enabling this slot.");
  const sampleMetadataPatch = (
    zones: AetherSampleZoneConfig[],
    nextManagedSfz: ManagedSfzAssetConfig | null | undefined = managedSfz(),
  ) => isLumen()
    ? { ...draft().metadata, lumenSampleSlots: {
        ...draft().metadata.lumenSampleSlots,
        [activeLumenSampleSlot()]: {
          ...draft().metadata.lumenSampleSlots?.[activeLumenSampleSlot()],
          schemaVersion: 2 as const,
          zones: zones.slice(0, 8),
          slices: sampleSlices().slice(0, 16),
          managedSfz: nextManagedSfz ?? undefined,
        },
      } }
    : { ...draft().metadata, sampleSlot1Zones: zones.slice(0, 8), managedSfz: nextManagedSfz ?? undefined };
  const commitMappedZones = (zones: AetherSampleZoneConfig[]) => setDraft({
    ...draft(), metadata: sampleMetadataPatch(zones),
  });
  const commitSampleSlices = (slices: Array<{ id: string; startRatio: number; endRatio: number }>, selected = selectedSliceId()) => setDraft({
    ...draft(),
    parameters: { ...draft().parameters, [sampleParameterId("selectedSliceId")]: selected },
    metadata: {
      ...draft().metadata,
      lumenSampleSlots: {
        ...draft().metadata.lumenSampleSlots,
        [activeLumenSampleSlot()]: {
          ...draft().metadata.lumenSampleSlots?.[activeLumenSampleSlot()],
          schemaVersion: 2 as const,
          zones: mappedZones().slice(0, 8),
          slices: slices.slice(0, 16),
          ...(managedSfz() ? { managedSfz: managedSfz() } : {}),
        },
      },
    },
  });
  const addSampleSlice = () => {
    if (sampleSlices().length >= 16) return;
    const startRatio = Math.max(0, Math.min(1, getNumberParam(draft(), sampleParameterId("start"))));
    const endRatio = Math.max(0, Math.min(1, getNumberParam(draft(), sampleParameterId("end"))));
    if (endRatio <= startRatio) return;
    const used = new Set(sampleSlices().map((slice) => slice.id));
    let number = 1;
    while (used.has(`slice-${number}`)) number += 1;
    const slice = { id: `slice-${number}`, startRatio, endRatio };
    commitSampleSlices([...sampleSlices(), slice], slice.id);
  };
  const patchSelectedSlice = (patch: Partial<{ startRatio: number; endRatio: number }>) => {
    const selected = selectedSlice();
    if (!selected) return;
    const startRatio = Math.max(0, Math.min(patch.startRatio ?? selected.startRatio,
      (patch.endRatio ?? selected.endRatio) - 0.001));
    const endRatio = Math.min(1, Math.max(patch.endRatio ?? selected.endRatio,
      startRatio + 0.001));
    commitSampleSlices(sampleSlices().map((slice) => slice.id === selected.id
      ? { ...slice, startRatio, endRatio } : slice), selected.id);
  };
  const removeSelectedSlice = () => {
    const selected = selectedSliceId();
    if (!selected) return;
    commitSampleSlices(sampleSlices().filter((slice) => slice.id !== selected), "");
  };
  const granularMetadataPatch = (nextManaged: ManagedGranularAssetConfig | null | undefined) => isLumen()
    ? { ...draft().metadata, lumenGranularSlots: {
        ...draft().metadata.lumenGranularSlots,
        [activeLumenSampleSlot()]: { schemaVersion: 1 as const, ...(nextManaged ? { managedAsset: nextManaged } : {}) },
      } }
    : { ...draft().metadata, managedGranular: nextManaged ?? undefined };
  const importSfz = async () => {
    const projectPath = useDocumentStore.getState().currentFilePath;
    if (!projectPath) {
      await appAlert("Save this project to a .beat file before importing an SFZ instrument.");
      return;
    }
    setImportingSfz(true);
    try {
      const result = await send({ kind: "instrument.importSfz", projectPath });
      if (result.error) throw new Error(result.error);
      if (!result.managedSfz) return;
      setDraft({
        ...draft(),
        parameters: {
          ...draft().parameters,
          [sampleParameterId("enabled")]: true,
          [sampleParameterId("audioFileId")]: "",
        },
        metadata: sampleMetadataPatch([], result.managedSfz),
      });
      queueMicrotask(() => sampleSourceStatus?.focus());
    } catch (error) {
      await appAlert(error instanceof Error ? error.message : "SFZ import failed.");
    } finally {
      setImportingSfz(false);
    }
  };
  const importGranular = async () => {
    const projectPath = useDocumentStore.getState().currentFilePath;
    if (!projectPath) {
      await appAlert("Save this project to a .beat file before importing granular audio.");
      return;
    }
    setImportingGranular(true);
    try {
      const result = await send({ kind: "instrument.importGranular", projectPath });
      if (result.error) throw new Error(result.error);
      if (!result.managedGranular) return;
      setDraft({
        ...draft(),
        parameters: {
          ...draft().parameters,
          [granularParameterId("enabled")]: true,
          [granularParameterId("builtinSource")]: "",
        },
        metadata: granularMetadataPatch(result.managedGranular),
      });
      queueMicrotask(() => granularSourceStatus?.focus());
    } catch (error) {
      await appAlert(error instanceof Error ? error.message : "Granular audio import failed.");
    } finally {
      setImportingGranular(false);
    }
  };
  const baseZone = (): AetherSampleZoneConfig => ({
    audioFileId: String(draft().parameters[sampleParameterId("audioFileId")] ?? ""),
    rootNote: getNumberParam(draft(), sampleParameterId("rootNote")),
    loNote: 0,
    hiNote: 127,
    loVelocity: 0,
    hiVelocity: 127,
    level: getNumberParam(draft(), sampleParameterId("level")),
    pan: getNumberParam(draft(), sampleParameterId("pan")),
    startRatio: getNumberParam(draft(), sampleParameterId("start")),
    endRatio: getNumberParam(draft(), sampleParameterId("end")),
    loopEnabled: draft().parameters[sampleParameterId("loop.enabled")] === true,
    loopStartRatio: getNumberParam(draft(), sampleParameterId("loop.start")),
    loopEndRatio: getNumberParam(draft(), sampleParameterId("loop.end")),
  });
  const addMappedZone = () => {
    const current = mappedZones();
    if (current.length >= 8 || (!current.length && !baseZone().audioFileId)) return;
    if (!current.length) {
      const low = { ...baseZone(), hiNote: 63 };
      commitMappedZones([low, { ...baseZone(), loNote: 64 }]);
      return;
    }
    commitMappedZones([...current, { ...baseZone() }]);
  };

  return (
    <section
      class={`${styles.majorSection} ${filterEnabled() ? "" : styles.disabledPanel} ${props.focusedSourceTarget === "env.1" || props.focusedSourceTarget === "env.2" ? styles.sourceFocus : ""}`}
      aria-label="Amp and filter"
      data-synth-source-editor={props.focusedSourceTarget === "env.1" || props.focusedSourceTarget === "env.2" ? props.focusedSourceTarget : undefined}
    >
      <div class={styles.ampFilterRibbon}>
        <Button
          iconOnly
          size="xs"
          selected={filterEnabled()}
          className={styles.ampFilterPowerButton}
          aria-label={`${filterEnabled() ? "Disable" : "Enable"} AMP/Filter`}
          onClick={() => setBooleanParameter("filter.enabled", !filterEnabled())}
        >
          <Icon name={filterEnabled() ? "ph:power-fill" : "ph:power"} size={18} decorative />
        </Button>
        <div class={styles.ampFilterRibbonTitle}>AMP/Filter</div>
      </div>
      <div class={styles.ampFilterBody}>
        <div class={styles.envelopeCards}>
          <For each={["env.1", "env.2"] as const}>
            {(source) => (
              <EnvelopeEditorCard
                source={source}
                active={props.focusedSourceTarget === source}
                onChange={setNumericParameter}
                onSetCurve={setParameter}
              />
            )}
          </For>
        </div>
        <div class={`${styles.ampFilterGroup} ${styles.ampFilterWideGroup}`}>
          <div class={styles.ampFilterGroupTitle}>Filter</div>
          <div class={styles.ampFilterShapeRow}>
            <ShapeButtonSet
              label="Filter"
              value={filterType()}
              options={FILTER_TYPES}
              onChange={(value) => setParameter("filter.type", value)}
            />
          </div>
          <div class={styles.knobCluster}>
            <Knob
              size="sm"
              label="Cutoff"
              value={getNumberParam(draft(), "filter.cutoff")}
              min={20}
              max={20000}
              step={10}
              unit="Hz"
              defaultValue={18000}
              {...modulationPropsForTarget(draft(), "filter.cutoff")}
              pickTargetId="filter.cutoff"
              formatValue={(value) => Math.round(value).toString()}
              onChange={(value) => setNumericParameter("filter.cutoff", value)}
            />
            <For each={[
              ["filter.resonance", "Res", 0.1, false],
              ["filter.keytrack", "Key", 0, false],
              ["filter.drive", "Drive", 0, false],
            ] as Array<[SynthParameterId, string, number, boolean]>}>
              {([id, label, defaultValue, bipolar]) => (
                <SynthParameterKnob
                  id={id}
                  label={label}
                  defaultValue={defaultValue}
                  bipolar={bipolar}
                  onChange={setNumericParameter}
                />
              )}
            </For>
          </div>
        </div>
        <div class={`${styles.ampFilterGroup} ${styles.ampFilterWideGroup}`}>
          <div class={styles.ampFilterGroupTitle}>Warp</div>
          <div class={styles.ampFilterShapeRow}>
            <ShapeButtonSet
              label="Runtime Warp"
              value={String(draft().parameters["aether.runtimeWarpMode"] ?? "shape")}
              options={AETHER_RUNTIME_WARP_MODES}
              onChange={(value) => setParameter("aether.runtimeWarpMode", value)}
            />
          </div>
          <div class={styles.knobCluster}>
            <SynthParameterKnob
              id="aether.runtimeWarp"
              label="Warp"
              defaultValue={0}
              onChange={setNumericParameter}
            />
          </div>
        </div>
        <div class={`${styles.ampFilterGroup} ${styles.ampFilterAmpGroup}`}>
          <div class={styles.ampFilterGroupTitle}>Amp</div>
          <div class={styles.knobCluster}>
            <SynthParameterKnob
              id="amp.level"
              label="Level"
              defaultValue={0.8}
              onChange={setNumericParameter}
            />
            <SynthParameterKnob
              id="amp.pan"
              label="Pan"
              defaultValue={0}
              bipolar
              onChange={setNumericParameter}
            />
          </div>
        </div>
        <section class={`${styles.ampFilterGroup} ${styles.ampFilterWideGroup} ${styles.sourceSlotGroup}`} aria-labelledby="aether-sample-slot-1-title">
          <h3 id="aether-sample-slot-1-title" class={styles.ampFilterGroupTitle}>{sampleSlotLabel()}</h3>
          <Show when={isLumen()}>
            <div class={styles.ampFilterShapeRow} role="tablist" aria-label="Lumen sample source settings">
              <For each={["a", "b", "c"] as const}>{(slot) => (
                <Button
                  size="xs"
                  selected={activeLumenSampleSlot() === slot}
                  role="tab"
                  aria-selected={activeLumenSampleSlot() === slot}
                  onClick={() => setActiveLumenSampleSlot(slot)}
                >Source {slot.toUpperCase()}</Button>
              )}</For>
            </div>
          </Show>
          <p
            ref={sampleSourceStatus}
            id="aether-sample-slot-1-source-status"
            class={styles.sourceSlotStatus}
            role="status"
            aria-live="polite"
            tabindex="-1"
          >{sampleSourceDescription()}</p>
          <div class={styles.ampFilterShapeRow}>
            <Toggle
              label="Enabled"
              aria-label={`Enable ${sampleSlotLabel()}`}
              aria-describedby="aether-sample-slot-1-source-status"
              checked={draft().parameters[sampleParameterId("enabled")] === true}
              disabled={!sampleSourceAvailable()}
              onChange={(value) => setBooleanParameter(sampleParameterId("enabled"), value)}
            />
            <FloatingSelect
              label="Asset"
              layout="inline"
              value={String(draft().parameters[sampleParameterId("audioFileId")] ?? "")}
              ariaLabel={`${sampleSlotLabel()} audio asset`}
              ariaDescribedBy="aether-sample-slot-1-source-status"
              options={[
                { value: "", label: "No sample" },
                ...audioFiles().map((file) => ({ value: file.id, label: file.name || file.id })),
              ]}
              open={sampleAssetOpen()}
              onOpenChange={setSampleAssetOpen}
              onChange={(value) => {
                setParameter(sampleParameterId("audioFileId"), value);
                setBooleanParameter(sampleParameterId("enabled"), Boolean(value));
                if (value && managedSfz()) setDraft({
                  ...useSynthStore.getState().draft,
                  metadata: sampleMetadataPatch(mappedZones(), null),
                });
              }}
            />
            <FloatingSelect
              label="Route"
              layout="inline"
              value={String(draft().parameters[sampleParameterId("route")] ?? "filter")}
              ariaLabel={`${sampleSlotLabel()} route`}
              options={[
                { value: "filter", label: "Filter" },
                { value: "filter1", label: "Filter 1" },
                { value: "filter2", label: "Filter 2" },
                { value: "direct", label: "Direct" },
                { value: "none", label: "None" },
              ]}
              open={sampleRouteOpen()}
              onOpenChange={setSampleRouteOpen}
              onChange={(value) => setParameter(sampleParameterId("route"), value)}
            />
            <Show when={activeLumenSourceMode() === "sample"}>
              <FloatingSelect
                label="Direction"
                layout="inline"
                value={String(draft().parameters[sampleParameterId("direction")] ?? "forward")}
                ariaLabel={`${sampleSlotLabel()} playback direction`}
                options={[
                  { value: "forward", label: "Forward" },
                  { value: "reverse", label: "Reverse" },
                ]}
                open={sampleDirectionOpen()}
                onOpenChange={setSampleDirectionOpen}
                onChange={(value) => setParameter(sampleParameterId("direction"), value)}
              />
            </Show>
            <Button
              ref={sampleImportButton}
              size="xs"
              aria-label={managedSfz() ? `Replace managed SFZ ${managedSfz()!.displayName}` : "Import SFZ for Sample Slot 1"}
              aria-busy={importingSfz()}
              onClick={() => void importSfz()}
              disabled={importingSfz()}
            >
              {importingSfz() ? "Importing…" : managedSfz() ? `SFZ · ${managedSfz()!.displayName}` : "Import SFZ"}
            </Button>
            <Show when={managedSfz()}>
              <Button size="xs" variant="ghost" aria-label={`Remove managed SFZ ${managedSfz()!.displayName}`} onClick={() => {
                setDraft({
                  ...draft(),
                  parameters: { ...draft().parameters, [sampleParameterId("enabled")]: false },
                  metadata: sampleMetadataPatch(mappedZones(), null),
                });
                queueMicrotask(() => sampleImportButton?.focus());
              }}>Remove SFZ</Button>
            </Show>
          </div>
          <div class={`${styles.knobCluster} ${styles.sampleControlGrid}`}>
            <NumberInput
              label="Root"
              layout="inline"
              value={getNumberParam(draft(), sampleParameterId("rootNote"))}
              min={0}
              max={127}
              step={1}
              ariaLabel="Aether sample slot 1 root MIDI note"
              onChange={(value) => setNumericParameter(sampleParameterId("rootNote"), value)}
            />
            <SynthParameterKnob id={sampleParameterId("level")} label="Level" defaultValue={0.8} onChange={setNumericParameter} />
            <SynthParameterKnob id={sampleParameterId("pan")} label="Pan" defaultValue={0} bipolar onChange={setNumericParameter} />
            <Show when={activeLumenSourceMode() === "sample"}>
              <Knob
                size="sm"
                label="Rate"
                value={getNumberParam(draft(), sampleParameterId("playbackRate"))}
                min={0.25}
                max={4}
                step={0.01}
                defaultValue={1}
                formatValue={(value) => `${value.toFixed(2)}x`}
                onChange={(value) => setNumericParameter(sampleParameterId("playbackRate"), value)}
              />
              <Knob
                size="sm"
                label="Release Tail"
                value={getNumberParam(draft(), sampleParameterId("releaseTailMs"))}
                min={1}
                max={2000}
                step={1}
                defaultValue={4}
                formatValue={(value) => `${Math.round(value)} ms`}
                onChange={(value) => setNumericParameter(sampleParameterId("releaseTailMs"), value)}
              />
            </Show>
          </div>
          <div class={`${styles.knobCluster} ${styles.sampleControlGrid}`}>
            <Show when={activeLumenSourceMode() !== "sample" || !selectedSlice()} fallback={
              <>
                <Knob size="sm" label="Slice Start" value={selectedSlice()!.startRatio}
                  min={0} max={Math.max(0, selectedSlice()!.endRatio - 0.001)} step={0.001}
                  defaultValue={0} formatValue={(value) => `${(value * 100).toFixed(1)}%`}
                  onChange={(value) => patchSelectedSlice({ startRatio: value })} />
                <Knob size="sm" label="Slice End" value={selectedSlice()!.endRatio}
                  min={Math.min(1, selectedSlice()!.startRatio + 0.001)} max={1} step={0.001}
                  defaultValue={1} formatValue={(value) => `${(value * 100).toFixed(1)}%`}
                  onChange={(value) => patchSelectedSlice({ endRatio: value })} />
              </>
            }>
              <SynthParameterKnob id={sampleParameterId("start")} label="Start" defaultValue={0} onChange={setNumericParameter} />
              <SynthParameterKnob id={sampleParameterId("end")} label="End" defaultValue={1} onChange={setNumericParameter} />
            </Show>
            <Show when={activeLumenSourceMode() === "sample"}>
              <FloatingSelect
                label="Slice"
                layout="inline"
                value={selectedSliceId()}
                ariaLabel={`${sampleSlotLabel()} selected slice`}
                options={[
                  { value: "", label: "Full Region" },
                  ...sampleSlices().map((slice, index) => ({
                    value: slice.id,
                    label: `Slice ${index + 1} · ${(slice.startRatio * 100).toFixed(1)}–${(slice.endRatio * 100).toFixed(1)}%`,
                  })),
                ]}
                open={sampleSliceOpen()}
                onOpenChange={setSampleSliceOpen}
                onChange={(value) => setParameter(sampleParameterId("selectedSliceId"), value)}
              />
              <Button size="xs" onClick={addSampleSlice} disabled={sampleSlices().length >= 16}>Add from Full Region</Button>
              <Button size="xs" variant="ghost" onClick={removeSelectedSlice} disabled={!selectedSliceId()}>Remove Slice</Button>
            </Show>
            <Toggle
              label="Loop"
              checked={draft().parameters[sampleParameterId("loop.enabled")] === true}
              onChange={(value) => setBooleanParameter(sampleParameterId("loop.enabled"), value)}
            />
            <Show when={activeLumenSourceMode() === "sample"}>
              <FloatingSelect
                label="Loop Mode"
                layout="inline"
                value={String(draft().parameters[sampleParameterId("loopMode")] ?? "forward")}
                ariaLabel={`${sampleSlotLabel()} loop mode`}
                options={[
                  { value: "forward", label: "Forward" },
                  { value: "pingPong", label: "Ping-pong" },
                ]}
                open={sampleLoopModeOpen()}
                onOpenChange={setSampleLoopModeOpen}
                onChange={(value) => setParameter(sampleParameterId("loopMode"), value)}
              />
            </Show>
            <SynthParameterKnob id={sampleParameterId("loop.start")} label="Loop Start" defaultValue={0} onChange={setNumericParameter} />
            <SynthParameterKnob id={sampleParameterId("loop.end")} label="Loop End" defaultValue={1} onChange={setNumericParameter} />
          </div>
          <div class={styles.ampFilterShapeRow} aria-label="Aether Sample Slot 1 mapped zones">
            <Button size="xs" onClick={addMappedZone} disabled={mappedZones().length >= 8 || (!mappedZones().length && !baseZone().audioFileId)}>
              {mappedZones().length ? "Add Zone" : "Create Key Map"}
            </Button>
            <Show when={mappedZones().length > 0}>
              <Button size="xs" variant="ghost" onClick={() => commitMappedZones([])}>Use Single Zone</Button>
              <span>{mappedZones().length}/8 zones · overlaps crossfade · single controls seed new zones</span>
            </Show>
          </div>
          <For each={mappedZones()}>{(zone, index) => (
            <MappedSampleZoneRow
              zone={zone}
              index={index()}
              audioFiles={audioFiles()}
              onPatch={(patch) => commitMappedZones(mappedZones().map((entry, zoneIndex) => zoneIndex === index() ? { ...entry, ...patch } : entry))}
              onRemove={() => commitMappedZones(mappedZones().filter((_, zoneIndex) => zoneIndex !== index()))}
            />
          )}</For>
        </section>
        <section class={`${styles.ampFilterGroup} ${styles.ampFilterWideGroup} ${styles.sourceSlotGroup}`} aria-labelledby="aether-granular-slot-2-title">
          <h3 id="aether-granular-slot-2-title" class={styles.ampFilterGroupTitle}>{isLumen() ? `Source ${activeLumenSampleSlot().toUpperCase()} Granular` : "Granular Slot 2"}</h3>
          <Show when={isLumen()}>
            <div class={styles.ampFilterShapeRow} role="tablist" aria-label="Lumen granular source settings">
              <For each={["a", "b", "c"] as const}>{(slot) => (
                <Button size="xs" selected={activeLumenSampleSlot() === slot} role="tab"
                  aria-selected={activeLumenSampleSlot() === slot}
                  onClick={() => setActiveLumenSampleSlot(slot)}>Source {slot.toUpperCase()}</Button>
              )}</For>
            </div>
          </Show>
          <p
            ref={granularSourceStatus}
            id="aether-granular-slot-2-source-status"
            class={styles.sourceSlotStatus}
            role="status"
            aria-live="polite"
            tabindex="-1"
          >{granularSourceDescription()}</p>
          <div class={styles.ampFilterShapeRow}>
            <Toggle
              label="Enabled"
              aria-label={isLumen() ? `Enable Source ${activeLumenSampleSlot().toUpperCase()} granular` : "Enable Aether granular slot 2"}
              aria-describedby="aether-granular-slot-2-source-status"
              checked={draft().parameters[granularParameterId("enabled")] === true}
              disabled={!granularSourceAvailable()}
              onChange={(value) => setBooleanParameter(granularParameterId("enabled"), value)}
            />
            <FloatingSelect
              label="Route"
              layout="inline"
              value={String(draft().parameters[granularParameterId("route")] ?? "filter")}
              ariaLabel="Aether granular slot 2 route"
              ariaDescribedBy="aether-granular-slot-2-source-status"
              options={[
                { value: "filter", label: "Filter" },
                { value: "filter1", label: "Filter 1" },
                { value: "filter2", label: "Filter 2" },
                { value: "direct", label: "Direct" },
                { value: "none", label: "None" },
              ]}
              open={granularRouteOpen()}
              onOpenChange={setGranularRouteOpen}
              onChange={(value) => setParameter(granularParameterId("route"), value)}
            />
            <Button
              ref={granularImportButton}
              size="xs"
              aria-label={managedGranular() ? `Replace granular audio ${managedGranular()!.displayName}` : "Import audio for Granular Slot 2"}
              aria-busy={importingGranular()}
              onClick={() => void importGranular()}
              disabled={importingGranular()}
            >
              {importingGranular() ? "Importing…" : managedGranular() ? `Audio · ${managedGranular()!.displayName}` : "Import Audio"}
            </Button>
            <Button size="xs" variant="ghost" aria-pressed={draft().parameters[granularParameterId("builtinSource")] === "benchmark"} onClick={() => setDraft({
              ...draft(),
              parameters: {
                ...draft().parameters,
                [granularParameterId("enabled")]: true,
                [granularParameterId("builtinSource")]: "benchmark",
              },
              metadata: granularMetadataPatch(null),
            })}>Benchmark Source</Button>
            <Show when={managedGranular() || draft().parameters[granularParameterId("builtinSource")] === "benchmark"}>
              <Button size="xs" variant="ghost" aria-label="Remove Granular Slot 2 source" onClick={() => {
                setDraft({
                  ...draft(),
                  parameters: {
                    ...draft().parameters,
                    [granularParameterId("enabled")]: false,
                    [granularParameterId("builtinSource")]: "",
                  },
                  metadata: granularMetadataPatch(null),
                });
                queueMicrotask(() => granularImportButton?.focus());
              }}>Remove</Button>
            </Show>
          </div>
          <div class={styles.knobCluster}>
            <NumberInput label="Root" layout="inline" value={getNumberParam(draft(), granularParameterId("rootNote"))} min={0} max={127} step={1} ariaLabel="Granular root MIDI note" onChange={(value) => setNumericParameter(granularParameterId("rootNote"), value)} />
            <SynthParameterKnob id={granularParameterId("level")} label="Level" defaultValue={0.7} onChange={setNumericParameter} />
            <SynthParameterKnob id={granularParameterId("position")} label="Position" defaultValue={0.5} onChange={setNumericParameter} />
            <SynthParameterKnob id={granularParameterId("positionSpread")} label="Position Spread" defaultValue={0.1} onChange={setNumericParameter} />
            <SynthParameterKnob id={granularParameterId("stereoSpread")} label="Stereo" defaultValue={0.5} onChange={setNumericParameter} />
          </div>
          <div class={styles.ampFilterShapeRow}>
            <NumberInput label="Grain ms" layout="inline" value={getNumberParam(draft(), granularParameterId("grainMilliseconds"))} min={2} max={1000} step={1} ariaLabel="Granular grain duration milliseconds" onChange={(value) => setNumericParameter(granularParameterId("grainMilliseconds"), value)} />
            <NumberInput label="Density" layout="inline" value={getNumberParam(draft(), granularParameterId("densityHz"))} min={0.1} max={200} step={0.1} ariaLabel="Granular density hertz" onChange={(value) => setNumericParameter(granularParameterId("densityHz"), value)} />
            <NumberInput label="Pitch" layout="inline" value={getNumberParam(draft(), granularParameterId("pitchSemitones"))} min={-48} max={48} step={0.1} ariaLabel="Granular pitch semitones" onChange={(value) => setNumericParameter(granularParameterId("pitchSemitones"), value)} />
            <NumberInput label="Seed" layout="inline" value={getNumberParam(draft(), granularParameterId("randomSeed"))} min={1} max={4294967295} step={1} ariaLabel="Granular deterministic seed" onChange={(value) => setNumericParameter(granularParameterId("randomSeed"), value)} />
          </div>
        </section>
        <div class={`${styles.ampFilterGroup} ${styles.ampFilterWideGroup}`} aria-label={`${isLumen() ? "Lumen" : "Aether"} source FX buses`}>
          <div class={styles.ampFilterGroupTitle}>Source FX</div>
          <div class={styles.ampFilterShapeRow}>
            <FloatingSelect
              label="Bus 1"
              layout="inline"
              value={String(draft().parameters["aether.fxBus1Id"] ?? "")}
              ariaLabel={`${isLumen() ? "Lumen" : "Aether"} FX bus 1 target`}
              options={fxBusOptions()}
              open={fxBus1Open()}
              onOpenChange={setFxBus1Open}
              onChange={(value) => setParameter("aether.fxBus1Id", value)}
            />
            <FloatingSelect
              label="Bus 2"
              layout="inline"
              value={String(draft().parameters["aether.fxBus2Id"] ?? "")}
              ariaLabel={`${isLumen() ? "Lumen" : "Aether"} FX bus 2 target`}
              options={fxBusOptions()}
              open={fxBus2Open()}
              onOpenChange={setFxBus2Open}
              onChange={(value) => setParameter("aether.fxBus2Id", value)}
            />
          </div>
          <div class={styles.knobCluster}>
            <SynthParameterKnob id="aether.sub.fxSend1" label="Sub 1" defaultValue={0} onChange={setNumericParameter} />
            <SynthParameterKnob id="aether.sub.fxSend2" label="Sub 2" defaultValue={0} onChange={setNumericParameter} />
            <SynthParameterKnob id="aether.noise.fxSend1" label="Noise 1" defaultValue={0} onChange={setNumericParameter} />
            <SynthParameterKnob id="aether.noise.fxSend2" label="Noise 2" defaultValue={0} onChange={setNumericParameter} />
            <SynthParameterKnob id={sampleParameterId("fxSend1")} label="Sample 1" defaultValue={0} onChange={setNumericParameter} />
            <SynthParameterKnob id={sampleParameterId("fxSend2")} label="Sample 2" defaultValue={0} onChange={setNumericParameter} />
          </div>
        </div>
      </div>
    </section>
  );
}

function MappedSampleZoneRow(props: {
  zone: AetherSampleZoneConfig;
  index: number;
  audioFiles: AudioFile[];
  onPatch: (patch: Partial<AetherSampleZoneConfig>) => void;
  onRemove: () => void;
}) {
  const [assetOpen, setAssetOpen] = createSignal(false);
  const patchStartRatio = (startRatio: number) => {
    const loopStartRatio = Math.max(startRatio, props.zone.loopStartRatio);
    props.onPatch({
      startRatio,
      loopStartRatio,
      loopEndRatio: Math.max(loopStartRatio, props.zone.loopEndRatio),
    });
  };
  const patchEndRatio = (endRatio: number) => {
    const loopEndRatio = Math.min(endRatio, props.zone.loopEndRatio);
    props.onPatch({
      endRatio,
      loopStartRatio: Math.min(props.zone.loopStartRatio, loopEndRatio),
      loopEndRatio,
    });
  };
  return (
    <div class={styles.mappedSampleZone} aria-label={`Sample map zone ${props.index + 1}`}>
      <div class={styles.ampFilterShapeRow}>
        <FloatingSelect
          label={`Zone ${props.index + 1}`}
          layout="inline"
          value={props.zone.audioFileId}
          ariaLabel={`Sample map zone ${props.index + 1} audio asset`}
          options={props.audioFiles.map((file) => ({ value: file.id, label: file.name || file.id }))}
          open={assetOpen()}
          onOpenChange={setAssetOpen}
          onChange={(audioFileId) => props.onPatch({ audioFileId })}
        />
        <NumberInput label="Root" layout="inline" value={props.zone.rootNote} min={0} max={127} step={1} onChange={(rootNote) => props.onPatch({ rootNote })} />
        <NumberInput label="Key Low" layout="inline" value={props.zone.loNote} min={0} max={props.zone.hiNote} step={1} onChange={(loNote) => props.onPatch({ loNote })} />
        <NumberInput label="Key High" layout="inline" value={props.zone.hiNote} min={props.zone.loNote} max={127} step={1} onChange={(hiNote) => props.onPatch({ hiNote })} />
        <NumberInput label="Vel Low" layout="inline" value={props.zone.loVelocity} min={0} max={props.zone.hiVelocity} step={1} onChange={(loVelocity) => props.onPatch({ loVelocity })} />
        <NumberInput label="Vel High" layout="inline" value={props.zone.hiVelocity} min={props.zone.loVelocity} max={127} step={1} onChange={(hiVelocity) => props.onPatch({ hiVelocity })} />
        <Button iconOnly size="xs" variant="ghost" aria-label={`Remove sample map zone ${props.index + 1}`} onClick={props.onRemove}>
          <Icon name="ph:trash" size={18} decorative />
        </Button>
      </div>
      <div class={styles.mappedSamplePlaybackRow} aria-label={`Sample map zone ${props.index + 1} playback`}>
        <NumberInput label="Zone Level" value={props.zone.level} min={0} max={1} step={0.01} onChange={(level) => props.onPatch({ level })} />
        <NumberInput label="Zone Pan" value={props.zone.pan} min={-1} max={1} step={0.01} onChange={(pan) => props.onPatch({ pan })} />
        <NumberInput label="Start" value={props.zone.startRatio} min={0} max={props.zone.endRatio} step={0.001} onChange={patchStartRatio} />
        <NumberInput label="End" value={props.zone.endRatio} min={props.zone.startRatio} max={1} step={0.001} onChange={patchEndRatio} />
        <Toggle label="Loop" checked={props.zone.loopEnabled} onChange={(loopEnabled) => props.onPatch({ loopEnabled })} />
        <NumberInput
          label="Loop Start"
          value={props.zone.loopStartRatio}
          min={props.zone.startRatio}
          max={props.zone.loopEndRatio}
          step={0.001}
          disabled={!props.zone.loopEnabled}
          onChange={(loopStartRatio) => props.onPatch({ loopStartRatio })}
        />
        <NumberInput
          label="Loop End"
          value={props.zone.loopEndRatio}
          min={props.zone.loopStartRatio}
          max={props.zone.endRatio}
          step={0.001}
          disabled={!props.zone.loopEnabled}
          onChange={(loopEndRatio) => props.onPatch({ loopEndRatio })}
        />
      </div>
    </div>
  );
}

function SynthParameterKnob(props: {
  id: SynthParameterId;
  label: string;
  defaultValue: number;
  max?: number;
  bipolar?: boolean;
  onChange: (id: SynthParameterId, value: number) => void;
}) {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const isEnvelopeTime = createMemo(() => props.id.startsWith("env.") && !props.id.endsWith("sustain"));
  return (
    <Knob
      size="sm"
      label={props.label}
      value={getNumberParam(draft(), props.id)}
      min={props.bipolar ? -1 : 0}
      max={props.max ?? (isEnvelopeTime() ? 30 : 1)}
      step={isEnvelopeTime() ? 0.001 : 0.01}
      defaultValue={props.defaultValue}
      bipolar={props.bipolar}
      {...modulationPropsForTarget(draft(), props.id)}
      pickTargetId={MODULATABLE_PARAMETER_IDS.has(props.id) ? props.id : undefined}
      formatValue={isEnvelopeTime() ? formatSeconds : formatPercent}
      onChange={(value) => props.onChange(props.id, value)}
    />
  );
}

function EnvelopeEditorCard(props: {
  source: "env.1" | "env.2";
  active: boolean;
  onChange: (id: SynthParameterId, value: number) => void;
  onSetCurve: (id: SynthParameterId, value: EnvelopeCurve) => void;
}) {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const envelope = createMemo(() => synthEnvelopeEditorSummary(draft(), props.source));
  const updateModulationRoute = useSynthStore.getState().updateModulationRoute;
  const addModulationRoute = useSynthStore.getState().addModulationRoute;
  const envelopeTargetAmount = (target: ModulationTargetId) =>
    draft()
      .modulation
      .filter((route) => route.enabled && route.source === props.source && route.target === target)
      .reduce((sum, route) => sum + route.amount, 0);
  const setEnvelopeTargetAmount = (target: ModulationTargetId, amount: number) => {
    const nextAmount = snap01(amount);
    const route = draft().modulation.find((candidate) => candidate.source === props.source && candidate.target === target);
    if (route) {
      updateModulationRoute(route.id, {
        amount: nextAmount,
        enabled: nextAmount > 0,
        bipolar: false,
      });
      return;
    }
    addModulationRoute({
      source: props.source,
      target,
      amount: nextAmount,
      bipolar: false,
      enabled: nextAmount > 0,
    });
  };

  return (
    <div
      class={styles.envelopeCard}
      data-synth-source-editor={props.source}
      data-synth-source-id={props.source}
      data-aether-envelope-editor={props.source}
      data-active={props.active ? "true" : "false"}
    >
      <div class={styles.envelopeCardHeader}>
        <span class={styles.sourcePickAnchor} data-synth-pick-anchor aria-hidden="true">
          <Icon name="ph:plug" size={18} decorative />
        </span>
        <strong>{envelope().label}</strong>
      </div>
      <EnvelopeHandleEditor
        source={props.source}
        onChange={props.onChange}
      />
      <div class={styles.envelopeTimingRow}>
        <EnvelopeTimingInput source={props.source} parameter="attack" label="Atk" unit="ms" onChange={props.onChange} />
        <EnvelopeTimingInput source={props.source} parameter="decay" label="Dec" unit="ms" onChange={props.onChange} />
        <EnvelopeTimingInput source={props.source} parameter="release" label="Rel" unit="ms" onChange={props.onChange} />
        <EnvelopeTimingInput source={props.source} parameter="sustain" label="S" unit="" onChange={props.onChange} />
      </div>
      <div class={styles.envelopeEditorControls}>
        <div class={styles.envelopeKnobs}>
          <For each={[
            ["filter.cutoff", "Cut Amt"],
            ["filter.resonance", "Res Amt"],
            ["filter.drive", "Drive Amt"],
          ] as Array<[ModulationTargetId, string]>}>
            {([target, label]) => (
              <Knob
                size="sm"
                label={label}
                value={envelopeTargetAmount(target)}
                min={0}
                max={1}
                step={0.01}
                defaultValue={0}
                formatValue={formatPercent}
                onChange={(value) => setEnvelopeTargetAmount(target, value)}
              />
            )}
          </For>
        </div>
        <div class={styles.envelopeCurves}>
          <For each={[
            [`${props.source}.attackCurve` as SynthParameterId, "Atk"],
            [`${props.source}.decayCurve` as SynthParameterId, "Dec"],
            [`${props.source}.releaseCurve` as SynthParameterId, "Rel"],
          ] as Array<[SynthParameterId, string]>}>
            {([id, label]) => (
              <EnvelopeCurveSegmentedControl
                label={label}
                value={getEnvelopeCurveParam(draft(), id)}
                onChange={(value) => props.onSetCurve(id, value as EnvelopeCurve)}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

function EnvelopeTimingInput(props: {
  source: "env.1" | "env.2";
  parameter: "attack" | "decay" | "release" | "sustain";
  label: string;
  unit: "ms" | "";
  onChange: (id: SynthParameterId, value: number) => void;
}) {
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const id = createMemo(() => `${props.source}.${props.parameter}` as SynthParameterId);
  const isSustain = createMemo(() => props.parameter === "sustain");
  const displayValue = createMemo(() => {
    const value = getNumberParam(draft(), id());
    return isSustain() ? Math.round(value * 100) : Math.round(value * 1000);
  });
  const handleChange = (value: number) => {
    props.onChange(id(), isSustain() ? value / 100 : value / 1000);
  };

  return (
    <span class={styles.envelopeTimingField}>
      <span class={styles.envelopeTimingLabel}>{props.label}</span>
      <NumberInput
        layout="bare"
        value={displayValue()}
        min={0}
        max={isSustain() ? 100 : 30000}
        step={isSustain() ? 1 : 1}
        unit={props.unit}
        maxLength={isSustain() ? 3 : 5}
        ariaLabel={`${props.source === "env.1" ? "Amp envelope" : "Mod envelope"} ${props.label}`}
        className={styles.envelopeTimingNumber}
        inputClassName={styles.envelopeTimingInput}
        onChange={handleChange}
      />
    </span>
  );
}

function EnvelopeHandleEditor(props: {
  source: "env.1" | "env.2";
  onChange: (id: SynthParameterId, value: number) => void;
}) {
  let railRef: SVGSVGElement | undefined;
  type EnvelopeDragHandle = "attack" | "decay-sustain" | "release";
  const [draggedHandle, setDraggedHandle] = createSignal<EnvelopeDragHandle | null>(null);
  const draft = createStoreSelector(useSynthStore, (state) => state.draft);
  const envelope = createMemo(() => synthEnvelopeEditorSummary(draft(), props.source));
  const attack = createMemo(() => getNumberParam(draft(), `${props.source}.attack` as SynthParameterId));
  const decay = createMemo(() => getNumberParam(draft(), `${props.source}.decay` as SynthParameterId));
  const sustain = createMemo(() => getNumberParam(draft(), `${props.source}.sustain` as SynthParameterId));
  const release = createMemo(() => getNumberParam(draft(), `${props.source}.release` as SynthParameterId));
  const attackCurve = createMemo(() => getEnvelopeCurveParam(draft(), `${props.source}.attackCurve` as SynthParameterId));
  const decayCurve = createMemo(() => getEnvelopeCurveParam(draft(), `${props.source}.decayCurve` as SynthParameterId));
  const releaseCurve = createMemo(() => getEnvelopeCurveParam(draft(), `${props.source}.releaseCurve` as SynthParameterId));

  const attackPoint = createMemo(() => envelope().points[1] ?? { x: 0, y: 0 });
  const decayPoint = createMemo(() => envelope().points[2] ?? { x: 50, y: 50 });
  const holdPoint = createMemo(() => envelope().points[3] ?? decayPoint());
  function updateHandle(kind: EnvelopeDragHandle, event: PointerEvent) {
    const rail = railRef;
    const rect = rail?.getBoundingClientRect();
    if (!rail || !rect || rect.width <= 0 || rect.height <= 0) return;
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const attackRatio = clamp(attackPoint().x / 100, 0.01, 0.92);
    const decayRatio = clamp(decayPoint().x / 100, attackRatio + 0.01, 0.96);
    const holdSeconds = 0.22;
    if (kind === "attack") {
      const fixedTail = Math.max(0.03, decay()) + holdSeconds + Math.max(0.03, release());
      const nextX = clamp(x, 0.01, decayRatio - 0.01);
      props.onChange(`${props.source}.attack` as SynthParameterId, snapEnvelopeSeconds((nextX / Math.max(0.03, 1 - nextX)) * fixedTail));
    } else if (kind === "decay-sustain") {
      const fixedTail = holdSeconds + Math.max(0.03, release());
      const nextX = clamp(x, attackRatio + 0.01, 0.96);
      props.onChange(`${props.source}.decay` as SynthParameterId, snapEnvelopeSeconds(Math.max(0.001, (nextX / Math.max(0.03, 1 - nextX)) * fixedTail - Math.max(0.03, attack()))));
      props.onChange(`${props.source}.sustain` as SynthParameterId, snap01(1 - y));
    } else if (kind === "release") {
      const fixedHead = Math.max(0.03, attack()) + Math.max(0.03, decay()) + holdSeconds;
      const nextX = clamp(x, decayRatio + 0.01, 0.99);
      props.onChange(`${props.source}.release` as SynthParameterId, snapEnvelopeSeconds(Math.max(0.001, fixedHead * ((1 - nextX) / Math.max(0.03, nextX)))));
    }
  }

  function startHandleDrag(kind: EnvelopeDragHandle, event: PointerEvent) {
    event.preventDefault();
    if (event.currentTarget instanceof HTMLElement) {
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic fixture events do not always create an active pointer capture.
      }
    }
    setDraggedHandle(kind);
    updateHandle(kind, event);
  }

  function moveHandleDrag(kind: EnvelopeDragHandle, event: PointerEvent) {
    if (draggedHandle() !== kind) return;
    updateHandle(kind, event);
  }

  function stopHandleDrag(kind: EnvelopeDragHandle, event: PointerEvent) {
    if (draggedHandle() !== kind) return;
    updateHandle(kind, event);
    setDraggedHandle(null);
  }

  return (
    <div class={styles.envelopeHandleEditor} aria-label={`${envelope().label} direct envelope editor`}>
      <svg
        ref={railRef}
        class={styles.envelopeHandleRail}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={envelopeCurvePath(envelope().points, {
          attack: attackCurve(),
          decay: decayCurve(),
          release: releaseCurve(),
        })} />
      </svg>
      <button
        type="button"
        class={styles.envelopeHandle}
        style={{ left: `${attackPoint().x}%`, top: `${attackPoint().y}%` }}
        data-aether-envelope-handle="attack"
        aria-label={`${envelope().label} attack ${formatSeconds(attack())}`}
        onPointerDown={(event) => startHandleDrag("attack", event)}
        onPointerMove={(event) => moveHandleDrag("attack", event)}
        onPointerUp={(event) => stopHandleDrag("attack", event)}
        onPointerCancel={() => setDraggedHandle(null)}
      />
      <button
        type="button"
        class={styles.envelopeHandle}
        style={{ left: `${decayPoint().x}%`, top: `${decayPoint().y}%` }}
        data-aether-envelope-handle="decay-sustain"
        aria-label={`${envelope().label} decay ${formatSeconds(decay())} sustain ${Math.round(sustain() * 100)}%`}
        onPointerDown={(event) => startHandleDrag("decay-sustain", event)}
        onPointerMove={(event) => moveHandleDrag("decay-sustain", event)}
        onPointerUp={(event) => stopHandleDrag("decay-sustain", event)}
        onPointerCancel={() => setDraggedHandle(null)}
      />
      <button
        type="button"
        class={styles.envelopeHandle}
        style={{ left: `${holdPoint().x}%`, top: `${holdPoint().y}%` }}
        data-aether-envelope-handle="release"
        aria-label={`${envelope().label} release ${formatSeconds(release())}`}
        onPointerDown={(event) => startHandleDrag("release", event)}
        onPointerMove={(event) => moveHandleDrag("release", event)}
        onPointerUp={(event) => stopHandleDrag("release", event)}
        onPointerCancel={() => setDraggedHandle(null)}
      />
    </div>
  );
}

function EnvelopeCurveSegmentedControl(props: {
  label: string;
  value: EnvelopeCurve;
  onChange: (value: EnvelopeCurve) => void;
}) {
  return (
    <div class={styles.envelopeCurveControl}>
      <span class={styles.envelopeCurveLabel}>{props.label}</span>
      <div class={styles.shapeButtons} role="radiogroup" aria-label={`${props.label} curve`}>
        <For each={ENVELOPE_CURVES}>
          {(option) => {
            const [value, , fullLabel, icon] = option;
            const active = () => props.value === value;
            return (
              <HoverInfo content={fullLabel}>
                <Button
                  iconOnly
                  size="xs"
                  variant="ghost"
                  selected={active()}
                  role="radio"
                  aria-checked={active()}
                  aria-label={fullLabel}
                  className={styles.shapeButton}
                  onClick={() => props.onChange(value)}
                >
                  <Icon name={icon} size={18} decorative />
                </Button>
              </HoverInfo>
            );
          }}
        </For>
      </div>
      <span class={styles.envelopeCurveValue}>{envelopeCurveDisplayLabel(props.value)}</span>
    </div>
  );
}

function ShapeButtonSet(props: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string, string] | readonly [string, string, string, string]>;
  onChange: (value: string) => void;
}) {
  const selected = createMemo(() => props.options.find((option) => option[0] === props.value));

  return (
    <div class={styles.shapeControl}>
      <div class={styles.shapeButtons} role="radiogroup" aria-label={props.label}>
        <For each={props.options}>
          {(option) => {
            const [optionValue, shortLabel, fullLabelOrIcon, maybeIcon] = option;
            const fullLabel = maybeIcon ? fullLabelOrIcon : shortLabel;
            const icon = maybeIcon ?? fullLabelOrIcon;
            const active = () => props.value === optionValue;
            return (
              <HoverInfo content={fullLabel}>
                <Button
                  iconOnly
                  size="xs"
                  variant="ghost"
                  selected={active()}
                  role="radio"
                  aria-checked={active()}
                  aria-label={fullLabel}
                  className={styles.shapeButton}
                  onClick={() => props.onChange(optionValue)}
                >
                  <Icon name={icon} size={18} decorative />
                </Button>
              </HoverInfo>
            );
          }}
        </For>
      </div>
      <span class={styles.shapeSelectedLabel}>{selected()?.[1] ?? props.value}</span>
      <span class={styles.shapeControlLabel}>{props.label}</span>
    </div>
  );
}

function makeAnalyzerBands(frequency: Uint8Array): number[] {
  const bands: number[] = [];
  const binCount = frequency.length;
  for (let band = 0; band < ANALYZER_BANDS; band += 1) {
    const start = Math.floor((band / ANALYZER_BANDS) ** 1.7 * binCount);
    const end = Math.max(start + 1, Math.floor(((band + 1) / ANALYZER_BANDS) ** 1.7 * binCount));
    let sum = 0;
    let count = 0;
    for (let i = start; i < Math.min(end, binCount); i += 1) {
      sum += frequency[i] / 255;
      count += 1;
    }
    bands.push(count > 0 ? sum / count : 0);
  }
  return bands;
}

function createEmptyAnalyzerSnapshot(): AnalyzerSnapshot {
  return {
    sequence: 0,
    rms: 0,
    peak: 0,
    bands: Array.from({ length: ANALYZER_BANDS }, () => 0),
    updatedAt: 0,
  };
}

function summarizeBuffer(samples: Float32Array): { rms: number; peak: number } {
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return {
    rms: Math.sqrt(sumSquares / Math.max(1, samples.length)),
    peak,
  };
}

function mixStereoToMono(left: Float32Array, right: Float32Array): Float32Array {
  const length = Math.min(left.length, right.length);
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i += 1) mono[i] = (left[i] + right[i]) * 0.5;
  return mono;
}

function makeFftBands(samples: Float32Array): number[] {
  const fftSize = 2048;
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  const sourceLength = Math.min(samples.length, fftSize);
  for (let i = 0; i < sourceLength; i += 1) {
    const windowValue = 0.5 - 0.5 * Math.cos((Math.PI * 2 * i) / Math.max(1, fftSize - 1));
    real[i] = samples[i] * windowValue;
  }

  fftRadix2(real, imag);

  const magnitudes = new Float32Array(fftSize / 2);
  let maxMagnitude = 0;
  for (let i = 1; i < magnitudes.length; i += 1) {
    const magnitude = Math.hypot(real[i], imag[i]);
    magnitudes[i] = magnitude;
    maxMagnitude = Math.max(maxMagnitude, magnitude);
  }

  if (maxMagnitude <= 0) return Array.from({ length: ANALYZER_BANDS }, () => 0);

  const bands: number[] = [];
  for (let band = 0; band < ANALYZER_BANDS; band += 1) {
    const start = Math.max(1, Math.floor((band / ANALYZER_BANDS) ** 1.7 * magnitudes.length));
    const end = Math.max(start + 1, Math.floor(((band + 1) / ANALYZER_BANDS) ** 1.7 * magnitudes.length));
    let sum = 0;
    let count = 0;
    for (let bin = start; bin < Math.min(end, magnitudes.length); bin += 1) {
      sum += magnitudes[bin] / maxMagnitude;
      count += 1;
    }
    bands.push(count > 0 ? Math.min(1, sum / count) : 0);
  }
  return bands;
}

function fftRadix2(real: Float32Array, imag: Float32Array) {
  const n = real.length;
  let j = 0;
  for (let i = 1; i < n; i += 1) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const realI = real[i];
      const imagI = imag[i];
      real[i] = real[j];
      imag[i] = imag[j];
      real[j] = realI;
      imag[j] = imagI;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wLenReal = Math.cos(angle);
    const wLenImag = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wReal = 1;
      let wImag = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k += 1) {
        const even = i + k;
        const odd = even + half;
        const oddReal = real[odd] * wReal - imag[odd] * wImag;
        const oddImag = real[odd] * wImag + imag[odd] * wReal;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;

        const nextWReal = wReal * wLenReal - wImag * wLenImag;
        wImag = wReal * wLenImag + wImag * wLenReal;
        wReal = nextWReal;
      }
    }
  }
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}`;
}

function formatSeconds(value: number): string {
  return value < 1 ? `${Math.round(value * 1000)}ms` : `${value.toFixed(2)}s`;
}

function envelopeCurvePath(
  points: Array<{ x: number; y: number }>,
  curves: { attack: EnvelopeCurve; decay: EnvelopeCurve; release: EnvelopeCurve },
): string {
  const start = points[0] ?? { x: 0, y: 100 };
  const attack = points[1] ?? { x: 0, y: 0 };
  const decay = points[2] ?? { x: 50, y: 50 };
  const hold = points[3] ?? decay;
  const release = points[4] ?? { x: 100, y: 100 };
  const path: string[] = [`M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`];

  appendEnvelopeSegment(path, start, attack, curves.attack);
  appendEnvelopeSegment(path, attack, decay, curves.decay);
  appendEnvelopeSegment(path, decay, hold, "linear");
  appendEnvelopeSegment(path, hold, release, curves.release);
  return path.join(" ");
}

function appendEnvelopeSegment(
  path: string[],
  from: { x: number; y: number },
  to: { x: number; y: number },
  curve: EnvelopeCurve,
) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(2, Math.min(18, Math.ceil(distance / 5)));
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const shaped = applyEnvelopeCurve(progress, curve);
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * shaped;
    path.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
}

function applyEnvelopeCurve(value: number, curve: EnvelopeCurve): number {
  const x = clamp(value, 0, 1);
  if (curve === "exp") return x * x;
  if (curve === "log") return 1 - (1 - x) * (1 - x);
  if (curve === "s-curve") return x * x * (3 - 2 * x);
  return x;
}

function snapEnvelopeSeconds(value: number): number {
  return Math.round(clamp(value, 0, 30) * 1000) / 1000;
}

function snap01(value: number): number {
  return Math.round(clamp(value, 0, 1) * 100) / 100;
}

function keytrackFromFrequency(frequency: number): number {
  if (!Number.isFinite(frequency) || frequency <= 0) return 0;
  const midiNote = 69 + 12 * Math.log2(frequency / 440);
  return clamp(midiNote / 127, 0, 1);
}

function iconForInstrumentTaxonomy(categoryId: string): string {
  switch (categoryId) {
    case "strings":
      return "ph:music-notes";
    case "brass":
      return "ph:speaker-high";
    case "woodwinds":
      return "ph:wind";
    case "percussion":
    case "drum_machines_grooveboxes":
      return "ph:music-notes";
    case "keyboards":
      return "ph:piano-keys";
    case "guitars_fretted":
      return "ph:guitar";
    case "bass":
      return "ph:wave-sine";
    case "voice":
    case "choir":
      return "ph:microphone";
    case "samplers":
      return "ph:piano-keys";
    case "sound_design_foley":
    case "hybrid_processed":
      return "ph:waveform";
    default:
      return "ph:cube";
  }
}

function envelopeCurveDisplayLabel(value: EnvelopeCurve): string {
  if (value === "s-curve") return "S";
  if (value === "linear") return "Line";
  if (value === "exp") return "Exp";
  return "Log";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

const MODULATABLE_PARAMETER_IDS = new Set<string>([
  "filter.cutoff",
  "filter.resonance",
  "filter.drive",
  "amp.level",
  "amp.pan",
]);

const AETHER_RUNTIME_WARP_MODES = [
  ["shape", "Shape", "Shape", "ph:waveform"],
  ["fold", "Fold", "Fold", "ph:intersect-three"],
  ["pinch", "Pinch", "Pinch", "ph:arrows-in-line-horizontal"],
  ["mirror", "Mirror", "Mirror", "ph:diamonds-four"],
] as const;

function modulationPropsForTarget(draft: SynthDraftPatch, id: SynthParameterId) {
  if (!MODULATABLE_PARAMETER_IDS.has(id)) return {};
  const summary = modulationSummaryForTarget(draft, id as ModulationTargetId);
  if (summary.count === 0) return {};
  return {
    modulationAmount: summary.amount,
    modulationLabel: summary.label,
  };
}

function modulationPropsForSource(draft: SynthDraftPatch, id: SynthParameterId) {
  if (!id.startsWith("macro.")) return {};
  const summary = modulationSummaryForSource(draft, id as MacroId);
  if (summary.count === 0) return {};
  return {
    modulationAmount: summary.amount,
    modulationLabel: summary.label,
  };
}
