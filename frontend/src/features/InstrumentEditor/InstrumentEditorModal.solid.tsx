import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { appAlert, useModalStack } from "../../solid-ui";
import { Modal, Button, FloatingSelect, HoverInfo, Icon, Knob, NumberInput, Slider, TextInput } from "../../solid-ui";
import { ai, type GeneratedInstrument } from "../../ai/aiService";
import { maybeRunDueTraining } from "../../ai/trainingRunner";
import { isSupportedAudioFileName, SUPPORTED_AUDIO_IMPORT_LABEL } from "../../audio/audioFormats";
import { browserBlobToAudioFile, importAudioFile } from "../../audio/audioImport";
import {
  listInstrumentGenerationFeedback,
  saveInstrumentGenerationFeedback,
  updateInstrumentGenerationFeedback,
} from "../../persistence/dexie";
import { INSTRUMENT_TAXONOMY_OPTIONS, taxonomyAssignmentForInstrumentId } from "../../state/instrumentTaxonomy";
import { characterizeInstrument, defaultAetherSynthConfig, defaultWavetableConfig, snapshotInstrument, useAudioFileStore, useInstrumentStore, useUiStore } from "../../state/store";
import { INSTRUMENT_ICON_OPTIONS, instrumentIcon, instrumentIconLabel } from "../../state/instrumentIcons";
import type { Instrument, InstrumentSnapshot, WavetableWarpMode } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { WaveformPicker } from "./WaveformPicker.solid";
import { InstrumentWaveformPreview } from "./InstrumentWaveformPreview.solid";
import styles from "./InstrumentEditorModal.module.css";

export interface Props {
  instrumentId: string;
  editorKind?: "instrument" | "samplerInstrument";
}

type LfoWaveform = NonNullable<Instrument["lfoWaveform"]>;

const LFO_WAVEFORMS: Array<{ value: LfoWaveform; icon: string; label: string }> = [
  { value: "sine", icon: "ph:wave-sine", label: "Sine" },
  { value: "triangle", icon: "ph:wave-triangle", label: "Triangle" },
  { value: "saw", icon: "ph:wave-sawtooth", label: "Saw" },
  { value: "square", icon: "ph:wave-square", label: "Square" },
];

const DEFAULT_INSTRUMENT_KNOBS = { cutoff: 0.6, resonance: 0.2, drive: 0.1, color: 0.5 };

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
export function InstrumentEditorModal(props: Props) {
  const source = createStoreSelector(useInstrumentStore, (s) =>
    s.instruments.find((i) => i.id === props.instrumentId),
  );
  const update = useInstrumentStore.getState().updateInstrument;
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const closeEditor = useUiStore.getState().closeEditor;
  const requestDirtyClose = useModalStack.getState().requestDirtyClose;
  const addAudioFile = useAudioFileStore.getState().addFile;
  const audioFiles = createStoreSelector(useAudioFileStore, (s) => s.files);
  const id = () => `instrument-${props.instrumentId}`;

  const [draft, setDraft] = createSignal<Instrument | undefined>(source() ? structuredClone(source()!) : undefined, { equals: false });
  const [typeOpen, setTypeOpen] = createSignal(false);
  const [taxonomyOpen, setTaxonomyOpen] = createSignal(false);
  const [iconOpen, setIconOpen] = createSignal(false);
  const [recording, setRecording] = createSignal(false);
  const [aiPrompt, setAiPrompt] = createSignal("");
  const [generating, setGenerating] = createSignal(false);
  const [lastGenerated, setLastGenerated] = createSignal<GeneratedInstrument | null>(null, { equals: false });
  const [generationFeedbackId, setGenerationFeedbackId] = createSignal<string | null>(null);
  const [feedbackRating, setFeedbackRating] = createSignal<"up" | "down" | null>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = createSignal<"up" | "down" | null>(null);
  let recorderRef: MediaRecorder | null = null;
  let recordChunksRef: Blob[] = [];
  let recordStreamRef: MediaStream | null = null;

  createEffect(() => {
    const currentSource = source();
    if (currentSource && !draft()) setDraft(structuredClone(currentSource));
  });

  onCleanup(() => {
    recordStreamRef?.getTracks().forEach((track) => track.stop());
  });

  const editorKind = () => props.editorKind ?? "instrument";
  const dirty = createMemo(() => Boolean(draft() && source() && JSON.stringify(draft()) !== JSON.stringify(source())));
  const samplerEditorMode = createMemo(() => editorKind() === "samplerInstrument");
  const showOscillator = createMemo(() => Boolean(draft() && !samplerEditorMode() && draft()!.kind === "hybrid"));
  const showWavetable = createMemo(() => Boolean(draft() && !samplerEditorMode() && draft()!.kind === "wavetable"));
  const showModulation = createMemo(() => showOscillator() || showWavetable());
  const showSamples = createMemo(() => Boolean(draft() && (samplerEditorMode() || draft()!.kind === "sampler" || draft()!.kind === "hybrid")));
  const aether = createMemo(() => draft()?.aether ?? defaultAetherSynthConfig());
  const sourceEdited = createMemo(() => {
    const currentDraft = draft();
    return Boolean(
      currentDraft?.source &&
      currentDraft.source.kind !== "created" &&
      currentDraft.original &&
      !snapshotMatchesInstrument(currentDraft.original, currentDraft),
    );
  });
  const canRevert = createMemo(() => Boolean(draft()?.original && sourceEdited()));
  const closeRequest = () => ({ kind: editorKind(), instrumentId: props.instrumentId } as const);

  function setAether(next: NonNullable<Instrument["aether"]>) {
    setDraft((current) => current ? { ...current, aether: next } : current);
  }

  function updateAetherOsc(key: "oscA" | "oscB", patch: Partial<NonNullable<Instrument["aether"]>["oscA"]>) {
    setAether({
      ...aether(),
      [key]: { ...aether()[key], ...patch },
    });
  }

  function updateAetherSub(patch: Partial<NonNullable<Instrument["aether"]>["sub"]>) {
    setAether({ ...aether(), sub: { ...aether().sub, ...patch } });
  }

  function updateAetherNoise(patch: Partial<NonNullable<Instrument["aether"]>["noise"]>) {
    setAether({ ...aether(), noise: { ...aether().noise, ...patch } });
  }

  function applyGlobalWavetablePatch(patch: Partial<NonNullable<Instrument["wavetable"]>>) {
    const currentDraft = draft();
    if (!currentDraft) return;
    const currentWavetable = { ...(currentDraft.wavetable ?? defaultWavetableConfig()), ...patch };
    const nextAether = {
      ...aether(),
      oscA: { ...aether().oscA, wavetable: { ...aether().oscA.wavetable, ...patch } },
      oscB: { ...aether().oscB, wavetable: { ...aether().oscB.wavetable, ...patch } },
    };
    setDraft({ ...currentDraft, wavetable: currentWavetable, aether: nextAether });
  }

  function save() {
    const currentDraft = draft();
    if (!currentDraft) return;
    const saved = markEdited({ ...currentDraft, descriptors: characterizeInstrument(currentDraft) });
    if (generationFeedbackId()) {
      void updateInstrumentGenerationFeedback(generationFeedbackId()!, {
        finalInstrument: saved,
        rating: feedbackRating() ?? "up",
      });
    }
    update(props.instrumentId, saved);
    closeEditor(closeRequest());
  }
  function close() {
    closeEditor(closeRequest());
  }
  function onClose() {
    if (dirty()) requestDirtyClose(id(), save, close);
    else close();
  }

  async function uploadSample() {
    const file = await importAudioFile();
    if (!file) return;
    if (!isSupportedAudioFileName(file.name) && !isSupportedAudioFileName(file.path)) {
      await appAlert(`Unsupported audio file. Supported formats: ${SUPPORTED_AUDIO_IMPORT_LABEL}.`);
      return;
    }
    attachSample(file);
  }

  async function generateInstrument() {
    const currentDraft = draft();
    if (!currentDraft) return;
    const prompt = aiPrompt().trim();
    if (!prompt) return;
    setGenerating(true);
    try {
      const feedback = await listInstrumentGenerationFeedback(24);
      const generated = await ai.generateInstrument({
        prompt,
        current: currentDraft,
        targetKind: currentDraft.kind === "synth" ? "wavetable" : currentDraft.kind,
        variationSeed: Date.now() + Math.floor(Math.random() * 100000),
        instruments: instruments(),
        audioFiles: audioFiles(),
        feedbackExamples: feedback
          .filter((entry): entry is typeof entry & { rating: "up" | "down" } => Boolean(entry.rating))
          .map((entry) => ({
            prompt: entry.prompt,
            rating: entry.rating,
            generated: entry.generated,
            finalInstrument: entry.finalInstrument,
          })),
      });
      const next = applyInstrumentPatch(currentDraft, generated.patch);
      const feedbackId = crypto.randomUUID();
      await saveInstrumentGenerationFeedback({
        id: feedbackId,
        prompt,
        generated,
        context: {
          prompt,
          targetKind: currentDraft.kind,
          currentInstrumentId: props.instrumentId,
          instrumentIds: instruments().map((instrument) => instrument.id),
          audioFileIds: audioFiles().map((file) => file.id),
        },
        createdAt: Date.now(),
      });
      setDraft(next);
      setLastGenerated(generated);
      setGenerationFeedbackId(feedbackId);
      setFeedbackRating(null);
      setFeedbackSubmitted(null);
    } finally {
      setGenerating(false);
    }
  }

  async function rateGeneration(rating: "up" | "down") {
    if (!generationFeedbackId() || !lastGenerated() || feedbackSubmitted()) return;
    setFeedbackRating(rating);
    setFeedbackSubmitted(rating);
    await updateInstrumentGenerationFeedback(generationFeedbackId()!, {
      rating,
      generated: lastGenerated()!,
      finalInstrument: draft(),
    });
    void maybeRunDueTraining("instruments");
    window.setTimeout(() => setLastGenerated(null), 700);
  }

  function attachSample(file: ReturnType<typeof useAudioFileStore.getState>["files"][number]) {
    const currentDraft = draft();
    if (!currentDraft) return;
    addAudioFile(file);
    const uploadedDraft: Instrument = {
      ...currentDraft,
      sampleIds: Array.from(new Set([...currentDraft.sampleIds, file.id])),
      sampleUrl: file.path,
      sampleUrls: Array.from(new Set([...(currentDraft.sampleUrls ?? []), file.path])),
      kind: currentDraft.kind === "synth" ? "hybrid" : currentDraft.kind,
      waveform: currentDraft.waveform === "sample" ? "sample" : currentDraft.waveform,
      source: {
        kind: "uploaded",
        label: file.name,
        url: file.path,
        importedAt: Date.now(),
        edited: false,
      },
    };
    setDraft({
      ...uploadedDraft,
      descriptors: characterizeInstrument(uploadedDraft),
      original: snapshotInstrument(uploadedDraft),
    });
  }

  async function toggleRecording() {
    if (recording()) {
      recorderRef?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      await appAlert("Audio recording is not available in this browser.");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    recordChunksRef = [];
    recordStreamRef = stream;
    recorderRef = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordChunksRef.push(event.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(recordChunksRef, { type: recorder.mimeType || "audio/webm" });
      recordStreamRef?.getTracks().forEach((track) => track.stop());
      recordStreamRef = null;
      recorderRef = null;
      setRecording(false);
      if (blob.size === 0) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = await browserBlobToAudioFile(blob, `Recording ${stamp}.webm`);
      attachSample(file);
    };
    recorder.start();
    setRecording(true);
  }

  const currentDraft = () => draft()!;

  return (
    <Show when={draft() && source()}>
    <Modal
      open
      scopeId={id()}
      title={<><Icon name={instrumentIcon(currentDraft())} size={14} decorative />{currentDraft().name}</>}
      width="lg"
      dirty={dirty()}
      onClose={onClose}
      onRequestCloseDirty={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!dirty()} onClick={save}>Save</Button>
        </>
      }
    >
      <div class={styles.grid}>
        <div class={`${styles.stickyIdentityRow} ${styles.spanFull}`}>
          <InstrumentWaveformPreview instrument={currentDraft()} hotkeyScopeId={id()} spanFull={false} />

          <div class={styles.identityStack}>
            <div class={styles.nameIconRow}>
              <TextInput
                class={styles.nameField}
                label="Name"
                layout="inline"
                value={currentDraft().name}
                onInput={(e) => setDraft({ ...currentDraft(), name: e.currentTarget.value })}
              />
              <div class={styles.iconPicker}>
                <HoverInfo content={instrumentIconLabel(currentDraft().icon ?? instrumentIcon(currentDraft()))}>
                  <Button
                    iconOnly
                    size="md"
                    class={styles.iconPickerButton}
                    aria-label="Change instrument icon"
                    onClick={() => setIconOpen((open) => !open)}
                  >
                    <Icon name={instrumentIcon(currentDraft())} size={16} decorative />
                  </Button>
                </HoverInfo>
                <Show when={iconOpen()}>
                  <div class={styles.iconMenu} role="menu" aria-label="Instrument icons">
                    <For each={INSTRUMENT_ICON_OPTIONS}>{(option) => (
                      <Button
                        size="sm"
                        variant="ghost"
                        selected={instrumentIcon(currentDraft()) === option.icon}
                        className={styles.iconOption}
                        title={`${option.label} - ${option.tags.join(", ")}`}
                        onClick={() => {
                          setDraft({ ...currentDraft(), icon: option.icon });
                          setIconOpen(false);
                        }}
                        role="menuitem"
                      >
                        <Icon name={option.icon} size={16} decorative />
                        <span>{option.label}</span>
                      </Button>
                    )}</For>
                  </div>
                </Show>
              </div>
            </div>
            <FloatingSelect
              label="Type"
              layout="inline"
              value={currentDraft().kind}
              ariaLabel="Instrument type"
              options={samplerEditorMode()
                ? [
                    { value: "sampler", label: "Sampler" },
                    { value: "hybrid", label: "Layered Sample" },
                  ]
                : [
                    { value: "wavetable", label: "Aether WT" },
                  ]}
              open={typeOpen()}
              onOpenChange={setTypeOpen}
              onChange={(kind) => setDraft(instrumentWithKind(currentDraft(), kind as Instrument["kind"]))}
            />
            <FloatingSelect
              label="Structure"
              layout="inline"
              value={currentDraft().taxonomy?.instrumentId ?? ""}
              ariaLabel="Instrument library structure"
              options={INSTRUMENT_TAXONOMY_OPTIONS}
              open={taxonomyOpen()}
              onOpenChange={setTaxonomyOpen}
              onChange={(value) => {
                const nextTaxonomy = taxonomyAssignmentForInstrumentId(value);
                setDraft({ ...currentDraft(), taxonomy: nextTaxonomy });
              }}
            />
            <div class={styles.generateRow}>
              <TextInput
                class={styles.generatePrompt}
                label="Generate"
                layout="inline"
                value={aiPrompt()}
                placeholder={`${currentDraft().kind === "wavetable" ? "evolving glass pad" : currentDraft().kind === "sampler" ? "tight kick sample" : "warm analog"}`}
                onInput={(e) => setAiPrompt(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void generateInstrument();
                }}
              />
              <HoverInfo content={lastGenerated() ? "Regenerate instrument" : `Generate ${instrumentKindLabel(currentDraft().kind)}`}>
                <Button
                  iconOnly
                  size="md"
                  class={styles.squareIconButton}
                  disabled={!aiPrompt().trim() || generating()}
                  onClick={() => void generateInstrument()}
                  aria-label={lastGenerated() ? "Regenerate instrument" : `Generate ${instrumentKindLabel(currentDraft().kind)}`}
                >
                  <Icon name={generating() ? "ph:spinner" : "ph:sparkle"} size={14} decorative />
                </Button>
              </HoverInfo>
              <Show when={lastGenerated() && !feedbackSubmitted()}>
                <div class={styles.aiFeedback}>
                  <HoverInfo content="Good instrument">
                    <Button
                      iconOnly
                      size="md"
                      class={styles.squareIconButton}
                      selected={feedbackRating() === "up"}
                      onClick={() => void rateGeneration("up")}
                      aria-label="Rate generated instrument up"
                    >
                      <Icon name="ph:thumbs-up" size={14} decorative />
                    </Button>
                  </HoverInfo>
                  <HoverInfo content="Bad instrument">
                    <Button
                      iconOnly
                      size="md"
                      class={styles.squareIconButton}
                      selected={feedbackRating() === "down"}
                      onClick={() => void rateGeneration("down")}
                      aria-label="Rate generated instrument down"
                    >
                      <Icon name="ph:thumbs-down" size={14} decorative />
                    </Button>
                  </HoverInfo>
                </div>
              </Show>
              <Show when={feedbackSubmitted()}><span class={styles.aiFeedbackDone}>Saved</span></Show>
            </div>
          </div>
        </div>

        {/* Row 2 — Macros (col 1) + Envelope (col 2). */}
        <section class={styles.section}>
          <h3 class={styles.sectionHeading}>Macros</h3>
          <div class={styles.fourCol}>
            <Knob
              size="sm"
              value={currentDraft().knobs.cutoff}
              defaultValue={DEFAULT_INSTRUMENT_KNOBS.cutoff}
              min={0} max={1} step={0.01}
              unit="%"
              label="Cut"
              formatValue={formatPercent}
              parseValue={parsePercent}
              onChange={(v) => setDraft({ ...currentDraft(), knobs: { ...currentDraft().knobs, cutoff: v } })}
            />
            <Knob
              size="sm"
              value={currentDraft().knobs.resonance}
              defaultValue={DEFAULT_INSTRUMENT_KNOBS.resonance}
              min={0} max={1} step={0.01}
              unit="%"
              label="Res"
              formatValue={formatPercent}
              parseValue={parsePercent}
              onChange={(v) => setDraft({ ...currentDraft(), knobs: { ...currentDraft().knobs, resonance: v } })}
            />
            <Knob
              size="sm"
              value={currentDraft().knobs.drive}
              defaultValue={DEFAULT_INSTRUMENT_KNOBS.drive}
              min={0} max={1} step={0.01}
              unit="%"
              label="Drv"
              formatValue={formatPercent}
              parseValue={parsePercent}
              onChange={(v) => setDraft({ ...currentDraft(), knobs: { ...currentDraft().knobs, drive: v } })}
            />
            <Knob
              size="sm"
              value={currentDraft().knobs.color}
              defaultValue={DEFAULT_INSTRUMENT_KNOBS.color}
              min={0} max={1} step={0.01}
              unit="%"
              label="Shape"
              formatValue={formatPercent}
              parseValue={parsePercent}
              onChange={(v) => setDraft({ ...currentDraft(), knobs: { ...currentDraft().knobs, color: v } })}
            />
          </div>
        </section>

        <section class={styles.section}>
          <h3 class={styles.sectionHeading}>Envelope</h3>
          <div class={styles.fourCol}>
            <NumberInput
              label="Attack" unit="ms"
              value={currentDraft().envelope.attackMs}
              min={0} max={5000} step={1}
              onChange={(v) => setDraft({ ...currentDraft(), envelope: { ...currentDraft().envelope, attackMs: v } })}
            />
            <NumberInput
              label="Decay" unit="ms"
              value={currentDraft().envelope.decayMs}
              min={0} max={5000} step={1}
              onChange={(v) => setDraft({ ...currentDraft(), envelope: { ...currentDraft().envelope, decayMs: v } })}
            />
            <NumberInput
              label="Sustain" unit="%"
              value={Math.round(currentDraft().envelope.sustain * 100)}
              min={0} max={100} step={1}
              onChange={(v) => setDraft({ ...currentDraft(), envelope: { ...currentDraft().envelope, sustain: v / 100 } })}
            />
            <NumberInput
              label="Release" unit="ms"
              value={currentDraft().envelope.releaseMs}
              min={0} max={10000} step={1}
              onChange={(v) => setDraft({ ...currentDraft(), envelope: { ...currentDraft().envelope, releaseMs: v } })}
            />
          </div>
        </section>

        {/* Oscillator — spans both columns. */}
        <Show when={showOscillator()}>
          <section class={`${styles.section} ${styles.spanFull}`}>
            <h3 class={styles.sectionHeading}>Oscillator</h3>
            <div class={styles.oscRow}>
              <WaveformPicker
                value={currentDraft().waveform}
                allowSample={currentDraft().kind === "hybrid"}
                allowWavetable={currentDraft().kind === "wavetable"}
                onChange={(w) => setDraft({ ...currentDraft(), waveform: w })}
              />
              <div class={styles.fourCol}>
                <Knob
                  size="sm"
                  bipolar
                  value={currentDraft().detuneCents ?? 0}
                  defaultValue={0}
                  min={-100} max={100} step={1}
                  unit="ct"
                  label="Detune"
                  formatValue={formatInteger}
                  onChange={(v) => setDraft({ ...currentDraft(), detuneCents: v })}
                />
                <Knob
                  size="sm"
                  bipolar
                  label="Oct"
                  value={currentDraft().octave ?? 0}
                  defaultValue={0}
                  min={-3} max={3} step={1}
                  formatValue={formatInteger}
                  onChange={(v) => setDraft({ ...currentDraft(), octave: v })}
                />
                <Knob
                  size="sm"
                  value={currentDraft().subOscLevel ?? 0}
                  defaultValue={0}
                  min={0} max={1} step={0.01}
                  unit="%"
                  label="Sub"
                  formatValue={formatPercent}
                  parseValue={parsePercent}
                  onChange={(v) => setDraft({ ...currentDraft(), subOscLevel: v })}
                />
                <GlideSlider
                  value={currentDraft().glideMs ?? 0}
                  onChange={(v) => setDraft({ ...currentDraft(), glideMs: v })}
                />
              </div>
            </div>
          </section>
        </Show>

        <Show when={showWavetable()}>
          <section class={`${styles.section} ${styles.spanFull}`}>
            <h3 class={styles.sectionHeading}>Aether Engines</h3>
            <div class={styles.aetherGrid}>
              <AetherOscModule
                label="OSC A"
                value={aether().oscA}
                onChange={(patch) => updateAetherOsc("oscA", patch)}
              />
              <AetherOscModule
                label="OSC B"
                value={aether().oscB}
                onChange={(patch) => updateAetherOsc("oscB", patch)}
              />
              <AetherSubModule
                value={aether().sub}
                onChange={updateAetherSub}
              />
              <AetherNoiseModule
                value={aether().noise}
                onChange={updateAetherNoise}
              />
            </div>
            <h3 class={styles.sectionHeading}>Aether Global</h3>
            <div class={styles.aetherGlobalGrid}>
              <WavetableBankSelect
                value={(currentDraft().wavetable ?? defaultWavetableConfig()).bank}
                onChange={(bank) => applyGlobalWavetablePatch({ bank })}
              />
              <Knob
                size="sm"
                value={(currentDraft().wavetable ?? defaultWavetableConfig()).position}
                defaultValue={defaultWavetableConfig().position}
                min={0} max={1} step={0.01}
                unit="%"
                label="WT Pos"
                formatValue={formatPercent}
                parseValue={parsePercent}
                onChange={(position) => applyGlobalWavetablePatch({ position })}
              />
              <Knob
                size="sm"
                value={(currentDraft().wavetable ?? defaultWavetableConfig()).warp}
                defaultValue={defaultWavetableConfig().warp}
                min={0} max={1} step={0.01}
                unit="%"
                label="Warp"
                formatValue={formatPercent}
                parseValue={parsePercent}
                onChange={(warp) => applyGlobalWavetablePatch({ warp })}
              />
              <WavetableWarpModeSelect
                value={(currentDraft().wavetable ?? defaultWavetableConfig()).warpMode ?? "shape"}
                onChange={(warpMode) => applyGlobalWavetablePatch({ warpMode })}
              />
              <Knob
                size="sm"
                value={(currentDraft().wavetable ?? defaultWavetableConfig()).unison}
                defaultValue={defaultWavetableConfig().unison}
                min={1} max={8} step={1}
                label="Voices"
                formatValue={formatInteger}
                onChange={(unison) => applyGlobalWavetablePatch({ unison: Math.round(unison) })}
              />
              <Knob
                size="sm"
                value={(currentDraft().wavetable ?? defaultWavetableConfig()).detuneCents}
                defaultValue={defaultWavetableConfig().detuneCents}
                min={0} max={100} step={1}
                unit="ct"
                label="Spread"
                formatValue={formatInteger}
                onChange={(detuneCents) => applyGlobalWavetablePatch({ detuneCents })}
              />
              <Knob
                size="sm"
                value={(currentDraft().wavetable ?? defaultWavetableConfig()).blend}
                defaultValue={defaultWavetableConfig().blend}
                min={0} max={1} step={0.01}
                unit="%"
                label="Blend"
                formatValue={formatPercent}
                parseValue={parsePercent}
                onChange={(blend) => applyGlobalWavetablePatch({ blend })}
              />
            </div>
          </section>
        </Show>

        {/* Modulation — spans both columns. */}
        <Show when={showModulation()}>
          <section class={`${styles.section} ${styles.spanFull}`}>
            <h3 class={styles.sectionHeading}>Modulation</h3>
            <div class={styles.modGrid}>
              <LfoShapePicker
                value={currentDraft().lfoWaveform ?? "sine"}
                onChange={(value) => setDraft({ ...currentDraft(), lfoWaveform: value })}
              />
              <VerticalSwitch
                label="Rate"
                top="Sync"
                bottom="Hz"
                checked={currentDraft().lfoSync ?? false}
                onChange={(v) => setDraft({ ...currentDraft(), lfoSync: v })}
              />
              <VerticalSwitch
                label="Trigger"
                top="Retrig"
                bottom="Free"
                checked={currentDraft().lfoRetrigger ?? true}
                onChange={(v) => setDraft({ ...currentDraft(), lfoRetrigger: v })}
              />
              <Knob
                className={styles.modKnob}
                size="sm"
                value={currentDraft().lfoRateHz ?? 4}
                defaultValue={4}
                min={1} max={20} step={1}
                unit="Hz"
                label="LFO Rate"
                formatValue={formatInteger}
                onChange={(v) => setDraft({ ...currentDraft(), lfoRateHz: v })}
              />
              <Knob
                className={styles.modKnob}
                size="sm"
                value={currentDraft().lfoDepth ?? 0}
                defaultValue={0}
                min={0} max={1} step={0.01}
                unit="%"
                label="LFO Depth"
                formatValue={formatPercent}
                parseValue={parsePercent}
                onChange={(v) => setDraft({ ...currentDraft(), lfoDepth: v })}
              />
              <Knob
                className={styles.modKnob}
                size="sm"
                value={currentDraft().lfoToPitch ?? 0}
                defaultValue={0}
                min={0} max={12} step={1}
                unit="st"
                label="LFO Pitch"
                formatValue={formatInteger}
                onChange={(v) => setDraft({ ...currentDraft(), lfoToPitch: v })}
              />
              <Knob
                className={styles.modKnob}
                size="sm"
                value={currentDraft().lfoToFilter ?? 0}
                defaultValue={0}
                min={-1} max={1} step={0.01}
                unit="%"
                bipolar
                label="LFO Filter"
                formatValue={formatPercent}
                parseValue={parsePercent}
                onChange={(v) => setDraft({ ...currentDraft(), lfoToFilter: v })}
              />
              <Knob
                className={styles.modKnob}
                size="sm"
                value={currentDraft().envToFilter ?? 0}
                defaultValue={0}
                min={-1} max={1} step={0.01}
                unit="%"
                bipolar
                label="Env Filter"
                formatValue={formatPercent}
                parseValue={parsePercent}
                onChange={(v) => setDraft({ ...currentDraft(), envToFilter: v })}
              />
            </div>
          </section>
        </Show>

        <Show when={showSamples()}>
          <section class={`${styles.section} ${styles.spanFull}`}>
            <h3 class={styles.sectionHeading}>Sample</h3>
            <div class={styles.samplesRow}>
              {currentDraft().sampleIds.length > 0 && (
                <span class={styles.hint}>
                  {currentDraft().sampleIds.length} sample{currentDraft().sampleIds.length === 1 ? "" : "s"} attached.
                </span>
              )}
              <Button size="sm" onClick={uploadSample}>
                Upload sample…
              </Button>
              <Button
                iconOnly
                size="sm"
                variant={recording() ? "primary" : "default"}
                onClick={toggleRecording}
                aria-label={recording() ? "Stop recording sample" : "Record sample"}
              >
                <Icon name={recording() ? "ph:stop-fill" : "ph:microphone"} size={14} decorative />
              </Button>
            </div>
          </section>
        </Show>

        <Show when={currentDraft().parentIds}>
          {(parentIds) => (
          <section class={`${styles.section} ${styles.spanFull}`}>
            <h3 class={styles.sectionHeading}>Lineage</h3>
            <p class={styles.hint}>
              Derived from {parentIds().length} parent instrument
              {parentIds().length === 1 ? "" : "s"}.
            </p>
          </section>
          )}
        </Show>

        <Show when={currentDraft().source}>
          <section class={`${styles.section} ${styles.spanFull}`}>
            <h3 class={styles.sectionHeading}>Source</h3>
            <div class={styles.sourceRow}>
              <div class={styles.sourceText}>
                <span>{sourceLabel(currentDraft(), sourceEdited())}</span>
                <Show when={currentDraft().source?.license}><span>{currentDraft().source?.license}</span></Show>
                <Show when={currentDraft().source?.url}><span class={styles.sourceUrl}>{currentDraft().source?.url}</span></Show>
                <Show when={(currentDraft().descriptors?.length ?? 0) > 0}>
                  <span>{currentDraft().descriptors?.join(" · ")}</span>
                </Show>
              </div>
              <Show when={canRevert()}>
                <button
                  type="button"
                  class={styles.revertLink}
                  onClick={() => setDraft(revertInstrument(currentDraft()))}
                >
                  Revert to original
                </button>
              </Show>
            </div>
          </section>
        </Show>
      </div>
    </Modal>
    </Show>
  );
}

function AetherOscModule({
  label,
  value,
  onChange,
}: {
  label: string;
  value: NonNullable<Instrument["aether"]>["oscA"];
  onChange: (patch: Partial<NonNullable<Instrument["aether"]>["oscA"]>) => void;
}) {
  const waveform = value.waveform ?? "wavetable";
  const usesWavetable = waveform === "wavetable";
  const defaults = label === "OSC B"
    ? defaultAetherSynthConfig().oscB
    : defaultAetherSynthConfig().oscA;

  return (
    <div class={`${styles.aetherModule} ${value.enabled ? styles.aetherModuleOn : styles.aetherModuleOff}`}>
      <div class={styles.aetherModuleHead}>
        <span>{label}</span>
        <Button
          iconOnly
          size="xs"
          selected={value.enabled}
          aria-label={`${value.enabled ? "Disable" : "Enable"} ${label}`}
          onClick={() => onChange({ enabled: !value.enabled })}
        >
          <Icon name={value.enabled ? "ph:power-fill" : "ph:power"} size={12} decorative />
        </Button>
      </div>
      <div class={styles.aetherSource}>
        <WaveformPicker
          value={waveform}
          allowWavetable
          onChange={(next) => {
            if (next !== "sample") onChange({ waveform: next });
          }}
        />
      </div>
      {usesWavetable && (
        <WavetableBankSelect
          value={value.wavetable.bank}
          onChange={(bank) => onChange({ wavetable: { ...value.wavetable, bank } })}
        />
      )}
      <div class={styles.aetherKnobs}>
        <Knob
          size="sm"
          value={value.level}
          defaultValue={defaults.level}
          min={0} max={1} step={0.01}
          unit="%"
          label="Level"
          formatValue={formatPercent}
          parseValue={parsePercent}
          onChange={(level) => onChange({ level })}
        />
        {usesWavetable && (
          <>
            <Knob
              size="sm"
              value={value.wavetable.position}
              defaultValue={defaults.wavetable.position}
              min={0} max={1} step={0.01}
              unit="%"
              label="WT"
              formatValue={formatPercent}
              parseValue={parsePercent}
              onChange={(position) => onChange({ wavetable: { ...value.wavetable, position } })}
            />
            <Knob
              size="sm"
              value={value.wavetable.warp}
              defaultValue={defaults.wavetable.warp}
              min={0} max={1} step={0.01}
              unit="%"
              label="Warp"
              formatValue={formatPercent}
              parseValue={parsePercent}
              onChange={(warp) => onChange({ wavetable: { ...value.wavetable, warp } })}
            />
            <WavetableWarpModeSelect
              value={value.wavetable.warpMode ?? "shape"}
              onChange={(warpMode) => onChange({ wavetable: { ...value.wavetable, warpMode } })}
            />
            <Knob
              size="sm"
              value={value.wavetable.unison}
              defaultValue={defaults.wavetable.unison}
              min={1} max={8} step={1}
              label="Voices"
              formatValue={formatInteger}
              onChange={(unison) => onChange({ wavetable: { ...value.wavetable, unison: Math.round(unison) } })}
            />
            <Knob
              size="sm"
              value={value.wavetable.detuneCents}
              defaultValue={defaults.wavetable.detuneCents}
              min={0} max={100} step={1}
              unit="ct"
              label="Spread"
              formatValue={formatInteger}
              onChange={(detuneCents) => onChange({ wavetable: { ...value.wavetable, detuneCents } })}
            />
          </>
        )}
        <Knob
          size="sm"
          bipolar
          value={value.octave}
          defaultValue={defaults.octave}
          min={-3} max={3} step={1}
          label="Oct"
          formatValue={formatInteger}
          onChange={(octave) => onChange({ octave })}
        />
        <Knob
          size="sm"
          bipolar
          value={value.semitone}
          defaultValue={defaults.semitone}
          min={-12} max={12} step={1}
          unit="st"
          label="Semi"
          formatValue={formatInteger}
          onChange={(semitone) => onChange({ semitone })}
        />
        <Knob
          size="sm"
          bipolar
          value={value.fineCents}
          defaultValue={defaults.fineCents}
          min={-100} max={100} step={1}
          unit="ct"
          label="Fine"
          formatValue={formatInteger}
          onChange={(fineCents) => onChange({ fineCents })}
        />
      </div>
    </div>
  );
}

function AetherSubModule({
  value,
  onChange,
}: {
  value: NonNullable<Instrument["aether"]>["sub"];
  onChange: (patch: Partial<NonNullable<Instrument["aether"]>["sub"]>) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const defaults = defaultAetherSynthConfig().sub;
  return (
    <div class={`${styles.aetherModule} ${value.enabled ? styles.aetherModuleOn : ""}`}>
      <div class={styles.aetherModuleHead}>
        <span>SUB</span>
        <Button
          iconOnly
          size="xs"
          selected={value.enabled}
          aria-label={`${value.enabled ? "Disable" : "Enable"} Sub`}
          onClick={() => onChange({ enabled: !value.enabled })}
        >
          <Icon name={value.enabled ? "ph:power-fill" : "ph:power"} size={12} decorative />
        </Button>
      </div>
      <FloatingSelect
        label="Wave"
        layout="inline"
        value={value.waveform}
        ariaLabel="Sub waveform"
        options={[
          { value: "sine", label: "Sine" },
          { value: "square", label: "Square" },
          { value: "triangle", label: "Triangle" },
        ]}
        open={open()}
        onOpenChange={setOpen}
        onChange={(waveform) => onChange({ waveform: waveform as NonNullable<Instrument["aether"]>["sub"]["waveform"] })}
      />
      <div class={styles.aetherKnobsCompact}>
        <Knob
          size="sm"
          value={value.level}
          defaultValue={defaults.level}
          min={0} max={1} step={0.01}
          unit="%"
          label="Level"
          formatValue={formatPercent}
          parseValue={parsePercent}
          onChange={(level) => onChange({ level })}
        />
        <Knob
          size="sm"
          bipolar
          value={value.octave}
          defaultValue={defaults.octave}
          min={-4} max={0} step={1}
          label="Oct"
          formatValue={formatInteger}
          onChange={(octave) => onChange({ octave })}
        />
      </div>
    </div>
  );
}

function AetherNoiseModule({
  value,
  onChange,
}: {
  value: NonNullable<Instrument["aether"]>["noise"];
  onChange: (patch: Partial<NonNullable<Instrument["aether"]>["noise"]>) => void;
}) {
  const defaults = defaultAetherSynthConfig().noise;
  return (
    <div class={`${styles.aetherModule} ${value.enabled ? styles.aetherModuleOn : ""}`}>
      <div class={styles.aetherModuleHead}>
        <span>NOISE</span>
        <Button
          iconOnly
          size="xs"
          selected={value.enabled}
          aria-label={`${value.enabled ? "Disable" : "Enable"} Noise`}
          onClick={() => onChange({ enabled: !value.enabled })}
        >
          <Icon name={value.enabled ? "ph:power-fill" : "ph:power"} size={12} decorative />
        </Button>
      </div>
      <div class={styles.aetherKnobsCompact}>
        <Knob
          size="sm"
          value={value.level}
          defaultValue={defaults.level}
          min={0} max={1} step={0.01}
          unit="%"
          label="Level"
          formatValue={formatPercent}
          parseValue={parsePercent}
          onChange={(level) => onChange({ level })}
        />
        <Knob
          size="sm"
          value={value.color}
          defaultValue={defaults.color}
          min={0} max={1} step={0.01}
          unit="%"
          label="Color"
          formatValue={formatPercent}
          parseValue={parsePercent}
          onChange={(color) => onChange({ color })}
        />
      </div>
    </div>
  );
}

function sourceLabel(instrument: Instrument, edited = false): string {
  const label = instrument.source?.label ?? "Unknown";
  return edited || instrument.source?.edited ? `${label} Edited` : label;
}

function instrumentWithKind(instrument: Instrument, kind: Instrument["kind"]): Instrument {
  if (kind === "wavetable" || kind === "synth") {
    const next = {
      ...instrument,
      kind: "wavetable" as const,
      waveform: "wavetable" as const,
      wavetable: instrument.wavetable ?? defaultWavetableConfig(),
      aether: instrument.aether ?? defaultAetherSynthConfig(),
    };
    return { ...next, descriptors: characterizeInstrument(next) };
  }
  if (kind === "sampler") {
    const next = { ...instrument, kind, waveform: "sample" as const };
    return { ...next, descriptors: characterizeInstrument(next) };
  }
  if (kind === "hybrid") {
    const next = { ...instrument, kind, waveform: instrument.waveform === "wavetable" ? "saw" as const : instrument.waveform };
    return { ...next, descriptors: characterizeInstrument(next) };
  }
  const next = { ...instrument, kind, waveform: instrument.waveform === "sample" || instrument.waveform === "wavetable" ? "saw" as const : instrument.waveform };
  return { ...next, descriptors: characterizeInstrument(next) };
}

function instrumentKindLabel(kind: Instrument["kind"]): string {
  switch (kind) {
    case "wavetable":
      return "Aether WT";
    case "sampler":
      return "sampler";
    case "hybrid":
      return "hybrid";
    case "synth":
    default:
      return "synth";
  }
}

function markEdited(instrument: Instrument): Instrument {
  if (!instrument.source || !instrument.original || instrument.source.kind === "created") return instrument;
  return {
    ...instrument,
    source: {
      ...instrument.source,
      edited: !snapshotMatchesInstrument(instrument.original, instrument),
    },
  };
}

function applyInstrumentPatch(instrument: Instrument, patch: Partial<Instrument>): Instrument {
  const next = {
    ...instrument,
    ...patch,
    envelope: patch.envelope ? { ...instrument.envelope, ...patch.envelope } : instrument.envelope,
    knobs: patch.knobs ? { ...instrument.knobs, ...patch.knobs } : instrument.knobs,
    sampleIds: patch.sampleIds ?? instrument.sampleIds,
    sampleUrls: patch.sampleUrls ?? instrument.sampleUrls,
    wavetable: patch.wavetable ? { ...(instrument.wavetable ?? defaultWavetableConfig()), ...patch.wavetable } : instrument.wavetable,
    aether: patch.aether ?? instrument.aether,
    source: patch.source ?? instrument.source,
    descriptors: characterizeInstrument({ ...instrument, ...patch, knobs: patch.knobs ? { ...instrument.knobs, ...patch.knobs } : instrument.knobs }),
  };
  if (next.kind === "synth" && next.waveform !== "sample") return instrumentWithKind(next, "wavetable");
  return next;
}

function revertInstrument(instrument: Instrument): Instrument {
  if (!instrument.original) return instrument;
  return {
    ...instrument,
    ...restoreSnapshot(instrument.original),
    source: instrument.source ? { ...instrument.source, edited: false } : instrument.source,
  };
}

function restoreSnapshot(snapshot: InstrumentSnapshot): Partial<Instrument> {
  return {
    name: snapshot.name,
    icon: snapshot.icon,
    kind: snapshot.kind,
    envelope: structuredClone(snapshot.envelope),
    knobs: structuredClone(snapshot.knobs),
    filterType: snapshot.filterType,
    waveform: snapshot.waveform,
    detuneCents: snapshot.detuneCents,
    octave: snapshot.octave,
    subOscLevel: snapshot.subOscLevel,
    glideMs: snapshot.glideMs,
    maxVoices: snapshot.maxVoices,
    mono: snapshot.mono,
    legato: snapshot.legato,
    ampLevel: snapshot.ampLevel,
    ampPan: snapshot.ampPan,
    wavetable: snapshot.wavetable ? structuredClone(snapshot.wavetable) : undefined,
    aether: snapshot.aether ? structuredClone(snapshot.aether) : undefined,
    synthPatch: snapshot.synthPatch ? structuredClone(snapshot.synthPatch) : undefined,
    lfoWaveform: snapshot.lfoWaveform,
    lfoRateHz: snapshot.lfoRateHz,
    lfoDepth: snapshot.lfoDepth,
    lfoSync: snapshot.lfoSync,
    lfoSyncedRate: snapshot.lfoSyncedRate,
    lfoSmoothing: snapshot.lfoSmoothing,
    lfoRandomPhase: snapshot.lfoRandomPhase,
    lfoPhase: snapshot.lfoPhase,
    lfoRetrigger: snapshot.lfoRetrigger,
    lfoOneShot: snapshot.lfoOneShot,
    lfo2Waveform: snapshot.lfo2Waveform,
    lfo2RateHz: snapshot.lfo2RateHz,
    lfo2Sync: snapshot.lfo2Sync,
    lfo2SyncedRate: snapshot.lfo2SyncedRate,
    lfo2Smoothing: snapshot.lfo2Smoothing,
    lfo2RandomPhase: snapshot.lfo2RandomPhase,
    lfo2Enabled: snapshot.lfo2Enabled,
    lfo2Phase: snapshot.lfo2Phase,
    lfo2Retrigger: snapshot.lfo2Retrigger,
    lfo2OneShot: snapshot.lfo2OneShot,
    lfoPositionBipolar: snapshot.lfoPositionBipolar,
    lfoPitchBipolar: snapshot.lfoPitchBipolar,
    lfoFilterBipolar: snapshot.lfoFilterBipolar,
    lfoToPitch: snapshot.lfoToPitch,
    lfoToFilter: snapshot.lfoToFilter,
    envToFilter: snapshot.envToFilter,
    effects: snapshot.effects ? structuredClone(snapshot.effects) : undefined,
    sampleIds: [...snapshot.sampleIds],
    sampleUrl: snapshot.sampleUrl,
    sampleUrls: snapshot.sampleUrls ? [...snapshot.sampleUrls] : undefined,
    sampleMap: snapshot.sampleMap ? structuredClone(snapshot.sampleMap) : undefined,
    parentIds: snapshot.parentIds ? [...snapshot.parentIds] : undefined,
    descriptors: snapshot.descriptors ? [...snapshot.descriptors] : undefined,
  };
}

function snapshotMatchesInstrument(snapshot: InstrumentSnapshot, instrument: Instrument): boolean {
  return JSON.stringify(snapshot) === JSON.stringify(snapshotInstrument(instrument));
}

function formatInteger(value: number): string {
  return String(Math.round(value));
}

function WavetableBankSelect({
  value,
  onChange,
}: {
  value: NonNullable<Instrument["wavetable"]>["bank"];
  onChange: (value: NonNullable<Instrument["wavetable"]>["bank"]) => void;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <FloatingSelect
      label="Bank"
      value={value}
      ariaLabel="Wavetable bank"
      options={[
        { value: "aether", label: "Aether" },
        { value: "glass", label: "Glass" },
        { value: "vocal", label: "Vocal" },
        { value: "organ", label: "Organ" },
        { value: "fm", label: "FM" },
      ]}
      open={open()}
      onOpenChange={setOpen}
      onChange={(next) => onChange(next as NonNullable<Instrument["wavetable"]>["bank"])}
    />
  );
}

function WavetableWarpModeSelect({
  value,
  onChange,
}: {
  value: WavetableWarpMode;
  onChange: (value: WavetableWarpMode) => void;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <FloatingSelect
      label="Warp"
      value={value}
      ariaLabel="Wavetable warp mode"
      options={[
        { value: "shape", label: "Shape" },
        { value: "fold", label: "Fold" },
        { value: "pinch", label: "Pinch" },
      ]}
      open={open()}
      onOpenChange={setOpen}
      onChange={(next) => onChange((next === "fold" || next === "pinch" ? next : "shape") as WavetableWarpMode)}
    />
  );
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
    <Slider
      className={styles.glideSlider}
      inputClassName={styles.glideRange}
      readoutClassName={styles.glideValue}
      label="Glide"
      value={clamped}
      min={0}
      max={500}
      step={1}
      readout={`${Math.round(clamped)} ms`}
      onChange={onChange}
    />
  );
}

interface LfoShapePickerProps {
  value: LfoWaveform;
  onChange: (value: LfoWaveform) => void;
}

function LfoShapePicker({ value, onChange }: LfoShapePickerProps) {
  const selected = LFO_WAVEFORMS.find((option) => option.value === value);

  return (
    <div class={styles.lfoShapeControl}>
      <div class={styles.lfoShapeButtons} role="radiogroup" aria-label="LFO shape">
        <For each={LFO_WAVEFORMS}>{(option) => (
          <HoverInfo content={option.label}>
            <Button
              iconOnly
              size="md"
              variant="ghost"
              selected={value === option.value}
              role="radio"
              aria-checked={value === option.value}
              aria-label={option.label}
              className={styles.lfoShapeButton}
              onClick={() => onChange(option.value)}
            >
              <Icon name={option.icon} size={16} decorative />
            </Button>
          </HoverInfo>
        )}</For>
      </div>
      <span class={styles.lfoShapeLabel}>{selected?.label ?? value}</span>
      <span class={styles.switchLabel}>LFO Shape</span>
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
    <div class={styles.switchControl}>
      <span class={`${styles.switchOption} ${checked ? styles.switchOptionActive : ""}`}>
        {top}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        class={`${styles.verticalSwitch} ${checked ? styles.verticalSwitchOn : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span class={styles.switchBall} />
      </button>
      <span class={`${styles.switchOption} ${!checked ? styles.switchOptionActive : ""}`}>
        {bottom}
      </span>
      <span class={styles.switchLabel}>{label}</span>
    </div>
  );
}
