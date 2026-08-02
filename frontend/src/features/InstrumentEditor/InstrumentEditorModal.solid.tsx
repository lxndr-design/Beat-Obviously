import { createEffect, createMemo, createSignal, For, Index, onCleanup, Show } from "solid-js";
import { appAlert, useModalStack } from "../../solid-ui";
import { Modal, Button, FieldActionButton, FloatingSelect, HoverInfo, Icon, Knob, NumberInput, Slider, TextInput, Toggle } from "../../solid-ui";
import { ai, type GeneratedInstrument } from "../../ai/aiService";
import { isSupportedAudioFileName, SUPPORTED_AUDIO_IMPORT_LABEL } from "../../audio/audioFormats";
import { importAudioFiles } from "../../audio/audioImport";
import { startInstrumentSampleZoneAudition, type InstrumentPreviewAuditionHandle } from "../../audio/synthPreview";
import {
  listInstrumentGenerationFeedback,
  saveInstrumentGenerationFeedback,
  updateInstrumentGenerationFeedback,
} from "../../persistence/dexie";
import { INSTRUMENT_TAXONOMY_OPTIONS, taxonomyAssignmentForInstrumentId } from "../../state/instrumentTaxonomy";
import { characterizeInstrument, defaultAetherSynthConfig, defaultWavetableConfig, snapshotInstrument, useAudioFileStore, useInstrumentStore, useUiStore } from "../../state/store";
import { INSTRUMENT_ICON_OPTIONS, instrumentIcon, instrumentIconLabel } from "../../state/instrumentIcons";
import { normalizeSampleMap, sampleZoneDisplayName, sampleZoneStableId } from "../../state/sampleZones";
import type { AudioFile, Instrument, InstrumentSampleZone, InstrumentSnapshot, WavetableWarpMode } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { WaveformPicker } from "./WaveformPicker.solid";
import { InstrumentWaveformPreview } from "./InstrumentWaveformPreview.solid";
import { TimelineJumpingSamplerEditor } from "./TimelineJumpingSamplerEditor.solid";
import styles from "./InstrumentEditorModal.module.css";

export interface Props {
  instrumentId: string;
  draftInstrument?: Instrument;
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
  const addInstrument = useInstrumentStore.getState().addInstrument;
  const update = useInstrumentStore.getState().updateInstrument;
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const closeEditor = useUiStore.getState().closeEditor;
  const requestDirtyClose = useModalStack.getState().requestDirtyClose;
  const addAudioFile = useAudioFileStore.getState().addFile;
  const audioFiles = createStoreSelector(useAudioFileStore, (s) => s.files);
  const id = () => `instrument-${props.instrumentId}`;

  const editorSource = () => props.draftInstrument ?? source();
  const [draft, setDraft] = createSignal<Instrument | undefined>(editorSource() ? structuredClone(editorSource()!) : undefined, { equals: false });
  const [typeOpen, setTypeOpen] = createSignal(false);
  const [taxonomyOpen, setTaxonomyOpen] = createSignal(false);
  const [iconOpen, setIconOpen] = createSignal(false);
  const [aiPrompt, setAiPrompt] = createSignal("");
  const [generating, setGenerating] = createSignal(false);
  const [lastGenerated, setLastGenerated] = createSignal<GeneratedInstrument | null>(null, { equals: false });
  const [generationFeedbackId, setGenerationFeedbackId] = createSignal<string | null>(null);
  const [feedbackRating, setFeedbackRating] = createSignal<"up" | "down" | null>(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = createSignal<"up" | "down" | null>(null);

  createEffect(() => {
    const currentSource = editorSource();
    if (currentSource && !draft()) setDraft(structuredClone(currentSource));
  });

  const editorKind = () => props.editorKind ?? "instrument";
  const dirty = createMemo(() => {
    const currentDraft = draft();
    const currentSource = editorSource();
    if (!currentDraft || !currentSource) return false;
    if (props.draftInstrument && !source()) return true;
    return JSON.stringify(currentDraft) !== JSON.stringify(currentSource);
  });
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
    if (source()) update(props.instrumentId, saved);
    else addInstrument(saved);
    closeEditor(closeRequest());
  }
  function close() {
    closeEditor(closeRequest());
  }
  function onClose() {
    if (dirty()) requestDirtyClose(id(), save, close);
    else close();
  }

  async function importSamplerAudioFiles() {
    const files = await importAudioFiles();
    if (files.length === 0) return;
    const unsupported = files.find((file) => !isSupportedAudioFileName(file.name) && !isSupportedAudioFileName(file.path));
    if (unsupported) {
      await appAlert(`Unsupported audio file. Supported formats: ${SUPPORTED_AUDIO_IMPORT_LABEL}.`);
      return;
    }
    files.forEach(addAudioFile);
    return files;
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
    window.setTimeout(() => setLastGenerated(null), 700);
  }

  const currentDraft = () => draft()!;

  return (
    <Show when={draft()}>
    <Modal
      open
      scopeId={id()}
      title={<><Icon name={instrumentIcon(currentDraft())} size={18} decorative />{currentDraft().name}</>}
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
                  <FieldActionButton
                    aria-label="Change instrument icon"
                    onClick={() => setIconOpen((open) => !open)}
                  >
                    <Icon name={instrumentIcon(currentDraft())} size={18} decorative />
                  </FieldActionButton>
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
                        <Icon name={option.icon} size={18} decorative />
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
                <FieldActionButton
                  disabled={!aiPrompt().trim() || generating()}
                  onClick={() => void generateInstrument()}
                  aria-label={lastGenerated() ? "Regenerate instrument" : `Generate ${instrumentKindLabel(currentDraft().kind)}`}
                >
                  <Icon name={generating() ? "ph:spinner" : "ph:sparkle"} size={18} decorative />
                </FieldActionButton>
              </HoverInfo>
              <Show when={lastGenerated() && !feedbackSubmitted()}>
                <div class={styles.aiFeedback}>
                  <HoverInfo content="Good instrument">
                    <FieldActionButton
                      active={feedbackRating() === "up"}
                      onClick={() => void rateGeneration("up")}
                      aria-label="Rate generated instrument up"
                    >
                      <Icon name="ph:thumbs-up" size={18} decorative />
                    </FieldActionButton>
                  </HoverInfo>
                  <HoverInfo content="Bad instrument">
                    <FieldActionButton
                      active={feedbackRating() === "down"}
                      onClick={() => void rateGeneration("down")}
                      aria-label="Rate generated instrument down"
                    >
                      <Icon name="ph:thumbs-down" size={18} decorative />
                    </FieldActionButton>
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
            <h3 class={styles.sectionHeading}>Sampler</h3>
            <div class={styles.samplerModeBar}>
              <span>Sampler Mode</span>
              <div>
                <Button
                  size="xs"
                  selected={currentDraft().samplerComplexity !== "timeline-jumping"}
                  onClick={() => setDraft({ ...currentDraft(), samplerComplexity: "mapped" })}
                >
                  Mapped Samples
                </Button>
                <Button
                  size="xs"
                  selected={currentDraft().samplerComplexity === "timeline-jumping"}
                  onClick={() => {
                    const path = currentDraft().sampleUrl ?? currentDraft().sampleMap?.[0]?.path;
                    const compatible = (currentDraft().sampleMap ?? []).filter((zone) => (
                      zone.path === path
                      && zone.rootNote === zone.loNote
                      && zone.rootNote === zone.hiNote
                    ));
                    setDraft({
                      ...currentDraft(),
                      samplerComplexity: "timeline-jumping",
                      sampleMap: compatible,
                      sampleUrl: path,
                      sampleUrls: path ? [path] : [],
                    });
                  }}
                >
                  Timeline Jumping
                </Button>
              </div>
            </div>
            <Show when={currentDraft().samplerComplexity === "timeline-jumping"} fallback={
              <SamplerZoneEditor
                instrument={currentDraft()}
                audioFiles={audioFiles()}
                onImportAudio={importSamplerAudioFiles}
                onRegisterAudioFiles={(files) => files.forEach(addAudioFile)}
                onChange={(sampleMap) => {
                  const paths = uniqueSamplePaths(sampleMap.map((zone) => zone.path));
                  setDraft({
                    ...currentDraft(),
                    sampleMap,
                    sampleUrl: paths[0],
                    sampleUrls: paths,
                  });
                }}
              />
            }>
              <TimelineJumpingSamplerEditor
                instrument={currentDraft()}
                audioFiles={audioFiles()}
                onImportAudio={importSamplerAudioFiles}
                onRegisterAudioFiles={(files) => files.forEach(addAudioFile)}
                onChange={(patch) => setDraft({ ...currentDraft(), ...patch })}
              />
            </Show>
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
                <Button
                  size="xs"
                  variant="ghost"
                  class={styles.revertLink}
                  onClick={() => setDraft(revertInstrument(currentDraft()))}
                >
                  Revert to original
                </Button>
              </Show>
            </div>
          </section>
        </Show>
      </div>
    </Modal>
    </Show>
  );
}

function SamplerZoneEditor(props: {
  instrument: Instrument;
  audioFiles: AudioFile[];
  onImportAudio: () => Promise<AudioFile[] | void>;
  onRegisterAudioFiles: (files: AudioFile[]) => void;
  onChange: (sampleMap: InstrumentSampleZone[]) => void;
}) {
  const zones = createMemo(() => materializeSamplerZones(props.instrument));
  type SamplerPropertyKind = "hit-variance" | "volume";
  type SamplerProperty = { kind: SamplerPropertyKind; label: string; steps: number };
  const PROPERTY_PRESETS: SamplerProperty[] = [
    { kind: "hit-variance", label: "Hit Variance", steps: 6 },
    { kind: "volume", label: "Volume", steps: 4 },
  ];
  const [auditionZoneId, setAuditionZoneId] = createSignal<string | null>(null);
  const [hoveredPath, setHoveredPath] = createSignal<string | null>(null);
  const [audioPickerOpen, setAudioPickerOpen] = createSignal(false);
  const [selectedAudioIds, setSelectedAudioIds] = createSignal<string[]>([]);
  const [stagedAudioFiles, setStagedAudioFiles] = createSignal<AudioFile[]>([], { equals: false });
  const [properties, setProperties] = createSignal<SamplerProperty[]>([], { equals: false });
  let auditionHandle: InstrumentPreviewAuditionHandle | null = null;

  onCleanup(() => {
    auditionHandle?.stop();
    auditionHandle = null;
  });

  function slotIndexForZone(zone: InstrumentSampleZone): number {
    const layout = assignmentLayout();
    const column = clampInteger(zone.seqPosition ?? 0, 0, layout.columns - 1);
    const velocity = clampInteger(zone.loVel ?? 0, 0, 127);
    const row = clampInteger(Math.floor((velocity / 128) * layout.rows), 0, layout.rows - 1);
    return row * layout.columns + column;
  }

  function zoneIndexForSlot(slotIndex: number): number {
    return zones().findIndex((zone) => slotIndexForZone(zone) === slotIndex);
  }

  function patchSlot(slotIndex: number, patch: Partial<InstrumentSampleZone>) {
    const zoneIndex = zoneIndexForSlot(slotIndex);
    if (zoneIndex < 0) return;
    const next = zones().map((zone, index) => index === zoneIndex ? sanitizeSampleZone({ ...zone, ...patch }, index) : zone);
    props.onChange(normalizeSampleMap(next) ?? next);
  }

  function assignPathToSlot(slotIndex: number, path: string) {
    const existingIndex = zoneIndexForSlot(slotIndex);
    const source = existingIndex >= 0 ? zones()[existingIndex] : undefined;
    const audio = stagedAudioFiles().find((file) => file.path === path)
      ?? props.audioFiles.find((file) => file.path === path);
    const layout = assignmentLayout();
    const column = slotIndex % layout.columns;
    const row = Math.floor(slotIndex / layout.columns);
    const velocitySpan = 127 / layout.rows;
    const next = zones().slice();
    const nextZone = sanitizeSampleZone({
      ...(source ?? defaultSamplerZone(path, slotIndex)),
      id: undefined,
      path,
      name: audio?.name ?? source?.name ?? sampleFilename(path, slotIndex),
      seqPosition: column,
      loVel: Math.max(0, Math.round(row * velocitySpan)),
      hiVel: row === layout.rows - 1 ? 127 : Math.min(127, Math.round((row + 1) * velocitySpan) - 1),
      durationSeconds: audio?.durationSeconds ?? source?.durationSeconds,
    }, existingIndex >= 0 ? existingIndex : next.length);
    if (existingIndex >= 0) next[existingIndex] = nextZone;
    else next.push(nextZone);
    props.onChange(normalizeSampleMap(next) ?? next);
  }

  function deleteSlot(slotIndex: number) {
    const zoneIndex = zoneIndexForSlot(slotIndex);
    if (zoneIndex < 0) return;
    const next = zones()
      .filter((_, index) => index !== zoneIndex)
      .map((zone, index) => sanitizeSampleZone(zone, index));
    props.onChange(normalizeSampleMap(next) ?? next);
  }

  async function auditionZone(zone: InstrumentSampleZone, index: number) {
    const zoneId = sampleZoneStableId(zone, index);
    if (auditionZoneId() === zoneId) {
      auditionHandle?.stop();
      auditionHandle = null;
      setAuditionZoneId(null);
      return;
    }
    auditionHandle?.stop();
    auditionHandle = null;
    setAuditionZoneId(zoneId);
    try {
      auditionHandle = await startInstrumentSampleZoneAudition(
        props.instrument,
        { sampleZoneId: zoneId, samplePath: zone.path },
        Math.min(1.4, Math.max(0.18, zone.durationSeconds ?? 0.9)),
        0.24,
        120,
        Math.max(1, Math.min(127, zone.hiVel ?? 112)),
        () => {
          if (auditionZoneId() === zoneId) setAuditionZoneId(null);
          auditionHandle = null;
        },
      );
    } catch {
      if (auditionZoneId() === zoneId) setAuditionZoneId(null);
      auditionHandle = null;
      void appAlert("Could not audition this sample zone.");
    }
  }

  const audioSources = createMemo(() => stagedAudioFiles().map((file) => ({
    path: file.path,
    name: file.name,
    assignedCount: zones().filter((zone) => zone.path === file.path).length,
    durationSeconds: file.durationSeconds,
    sampleRate: file.sampleRate,
  })).sort((a, b) => a.name.localeCompare(b.name)));

  const hitProperty = createMemo(() => properties().find((property) => property.kind === "hit-variance"));
  const volumeProperty = createMemo(() => properties().find((property) => property.kind === "volume"));
  const assignmentLayout = createMemo(() => ({
    columns: Math.max(1, hitProperty()?.steps ?? (properties().length > 0 ? properties()[0].steps : 0)),
    rows: Math.max(1, volumeProperty()?.steps ?? (properties().length > 1 ? properties()[1].steps : 1)),
  }));
  const slotCount = createMemo(() => properties().length === 0 ? 0 : assignmentLayout().columns * assignmentLayout().rows);
  const assignedSlots = createMemo(() => {
    const slots = Array.from({ length: slotCount() }, () => null as { zone: InstrumentSampleZone; zoneIndex: number } | null);
    for (const [zoneIndex, zone] of zones().entries()) {
      const slotIndex = slotIndexForZone(zone);
      if (slotIndex >= 0 && slotIndex < slots.length && !slots[slotIndex]) slots[slotIndex] = { zone, zoneIndex };
    }
    return slots;
  });
  const hoveredAssignedCount = createMemo(() => {
    const path = hoveredPath();
    if (!path) return 0;
    return zones().filter((zone) => zone.path === path).length;
  });

  function toggleSelectedAudio(id: string) {
    setSelectedAudioIds((current) => current.includes(id)
      ? current.filter((selectedId) => selectedId !== id)
      : [...current, id]);
  }

  function confirmSelectedAudio() {
    const selected = props.audioFiles.filter((file) => selectedAudioIds().includes(file.id));
    if (selected.length > 0) {
      props.onRegisterAudioFiles(selected);
      stageAudioFiles(selected);
    }
    setSelectedAudioIds([]);
    setAudioPickerOpen(false);
  }

  function stageAudioFiles(files: AudioFile[]) {
    setStagedAudioFiles((current) => {
      const byPath = new Map(current.map((file) => [file.path, file]));
      for (const file of files) byPath.set(file.path, file);
      return Array.from(byPath.values());
    });
  }

  async function importAudioIntoStaging() {
    const imported = await props.onImportAudio();
    if (imported?.length) stageAudioFiles(imported);
  }

  function addProperty() {
    const current = properties();
    const next = PROPERTY_PRESETS.find((preset) => !current.some((property) => property.kind === preset.kind));
    if (!next) return;
    setProperties([...current, { ...next }]);
  }

  function updateProperty(kind: SamplerPropertyKind, patch: Partial<SamplerProperty>) {
    setProperties((current) => current.map((property) => property.kind === kind ? { ...property, ...patch } : property));
  }

  function removeProperty(kind: SamplerPropertyKind) {
    const nextProperties = properties().filter((property) => property.kind !== kind);
    setProperties(nextProperties);
    if (nextProperties.length === 0) props.onChange([]);
  }

  function handleSourceDragStart(event: DragEvent, path: string) {
    event.dataTransfer?.setData("application/x-beat-audio-path", path);
    event.dataTransfer?.setData("text/plain", path);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
  }

  function handleSlotDrop(event: DragEvent, slotIndex: number) {
    event.preventDefault();
    const path = event.dataTransfer?.getData("application/x-beat-audio-path")
      || event.dataTransfer?.getData("text/plain");
    if (!path) return;
    assignPathToSlot(slotIndex, path);
  }

  return (
    <div class={styles.sampleZoneEditor}>
      <div class={styles.samplerPropertiesHead}>
        <span>Properties</span>
        <Button size="xs" onClick={addProperty} disabled={properties().length >= PROPERTY_PRESETS.length}>
          New Property
        </Button>
      </div>
      <div class={styles.samplerPropertyGrid}>
        <Show when={properties().length > 0} fallback={<p class={styles.hint}>Add a property to create sampler assignment slots.</p>}>
          <Index each={properties()}>{(property) => (
          <div class={styles.samplerPropertyCard}>
            <Button
              iconOnly
              size="xs"
              aria-label={`Remove ${property().label} property`}
              className={styles.samplerPropertyClose}
              onClick={() => removeProperty(property().kind)}
            >
              <Icon name="ph:x" size={18} decorative />
            </Button>
            <div class={styles.samplerPropertyTitle}>{property().label}</div>
            <Slider
              layout="inline"
              label="Steps"
              min={1}
              max={16}
              step={1}
              value={property().steps}
              readout={`${property().steps} step${property().steps === 1 ? "" : "s"}`}
              onChange={(value) => updateProperty(property().kind, { steps: clampInteger(value, 1, 16) })}
            />
          </div>
          )}</Index>
        </Show>
      </div>

      <div class={styles.sampleZoneHeader}>
        <span>Audio Organization</span>
        <span>{zones().length} assigned</span>
      </div>
      <div class={styles.samplerOrganization} data-linking={hoveredAssignedCount() > 0 ? "true" : "false"}>
        <Show when={hoveredAssignedCount() > 0}><span class={styles.samplerHoverLink} aria-hidden="true" /></Show>
        <div class={styles.samplerAudioPane}>
          <div class={styles.samplerPaneRibbon}>
            <span>Audio Files</span>
            <div class={styles.samplerPaneActions}>
              <Button size="xs" onClick={() => setAudioPickerOpen(true)}>Select Audio</Button>
              <Button size="xs" onClick={() => void importAudioIntoStaging()}>Import Audio</Button>
            </div>
          </div>
          <Show when={audioSources().length > 0} fallback={<p class={styles.hint}>Select or import audio to start mapping sampler slots.</p>}>
            <div class={styles.samplerAudioList}>
              <For each={audioSources()}>{(source) => (
                <div
                  class={styles.samplerAudioSource}
                  data-assigned={source.assignedCount > 0 ? "true" : "false"}
                  data-hovered={hoveredPath() === source.path ? "true" : "false"}
                  draggable
                  title={source.path}
                  onDragStart={(event) => handleSourceDragStart(event, source.path)}
                  onMouseEnter={() => setHoveredPath(source.path)}
                  onMouseLeave={() => setHoveredPath(null)}
                >
                  <Icon name="ph:dots-six-vertical" size={18} decorative />
                  <span>{source.name}</span>
                  <Show when={source.assignedCount > 0}>
                    <span class={styles.samplerAssignedCount}>{source.assignedCount}</span>
                  </Show>
                </div>
              )}</For>
            </div>
          </Show>
        </div>
        <div class={styles.samplerAssignmentPane}>
          <div class={styles.samplerAssignmentTitle}>
            <span>{hitProperty()?.label ?? properties()[0]?.label ?? "Assignments"}</span>
          </div>
          <Show when={properties().length > 0} fallback={<div class={styles.samplerAssignmentEmpty}>Add a property before assigning audio.</div>}>
          <div
            class={styles.samplerAssignmentList}
            style={`--sampler-columns: ${assignmentLayout().columns}; --sampler-rows: ${assignmentLayout().rows};`}
            data-grid={properties().length > 1 ? "two-property" : "single-property"}
          >
            <For each={assignedSlots()}>{(slotEntry, index) => (
              <div
                class={styles.samplerAssignmentSlot}
                data-filled={slotEntry ? "true" : "false"}
                data-linked={slotEntry && hoveredPath() === slotEntry.zone.path ? "true" : "false"}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleSlotDrop(event, index())}
              >
                <Show
                  when={slotEntry}
                  fallback={<span class={styles.samplerEmptySlot}>Drop audio here</span>}
                >
                  {(slot) => (
                    <>
                      <Icon name="ph:dots-six-vertical" size={18} decorative />
                      <TextInput
                        label="Label"
                        layout="inline"
                        value={slot().zone.name ?? sampleZoneDisplayName(slot().zone, slot().zoneIndex)}
                        onInput={(event) => patchSlot(index(), { name: event.currentTarget.value })}
                      />
                      <span class={styles.samplerSlotVelocity}>{Math.round((slot().zone.hiVel / 127) * 100)}%</span>
                      <Button
                        iconOnly
                        size="xs"
                        aria-label={`Audition ${sampleZoneDisplayName(slot().zone, slot().zoneIndex)}`}
                        selected={auditionZoneId() === sampleZoneStableId(slot().zone, slot().zoneIndex)}
                        onClick={() => void auditionZone(slot().zone, slot().zoneIndex)}
                      >
                        <Icon name={auditionZoneId() === sampleZoneStableId(slot().zone, slot().zoneIndex) ? "ph:stop-fill" : "ph:play-fill"} size={18} decorative />
                      </Button>
                      <Button
                        iconOnly
                        size="xs"
                        aria-label={`Remove ${sampleZoneDisplayName(slot().zone, slot().zoneIndex)}`}
                        onClick={() => deleteSlot(index())}
                      >
                        <Icon name="ph:x" size={18} decorative />
                      </Button>
                    </>
                  )}
                </Show>
              </div>
            )}</For>
          </div>
          </Show>
        </div>
      </div>
      <Show when={audioPickerOpen()}>
        <Modal
          open
          title="Audio Files"
          width="md"
          onClose={() => setAudioPickerOpen(false)}
          footer={
            <>
              <Button onClick={() => setAudioPickerOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={confirmSelectedAudio} disabled={selectedAudioIds().length === 0}>Confirm</Button>
            </>
          }
        >
          <div class={styles.samplerAudioPicker}>
            <For each={props.audioFiles}>{(file) => (
              <Button
                variant="ghost"
                fullWidth
                selected={selectedAudioIds().includes(file.id)}
                class={styles.samplerAudioPickerRow}
                data-selected={selectedAudioIds().includes(file.id) ? "true" : "false"}
                onClick={() => toggleSelectedAudio(file.id)}
              >
                <span class={styles.samplerAudioPickerCheck} />
                <span>{file.name}</span>
              </Button>
            )}</For>
          </div>
        </Modal>
      </Show>
    </div>
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
          <Icon name={value.enabled ? "ph:power-fill" : "ph:power"} size={18} decorative />
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
          <Icon name={value.enabled ? "ph:power-fill" : "ph:power"} size={18} decorative />
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
          <Icon name={value.enabled ? "ph:power-fill" : "ph:power"} size={18} decorative />
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

function materializeSamplerZones(instrument: Instrument): InstrumentSampleZone[] {
  const existing = normalizeSampleMap(instrument.sampleMap) ?? [];
  const paths = uniqueSamplePaths([
    instrument.sampleUrl,
    ...(instrument.sampleUrls ?? []),
    ...existing.map((zone) => zone.path),
  ]);
  if (paths.length === 0) return existing.map(sanitizeSampleZone);

  const next = paths.flatMap((path, pathIndex) => {
    const zones = existing.filter((zone) => zone.path === path);
    if (zones.length > 0) return zones.map((zone, zoneIndex) => sanitizeSampleZone(zone, pathIndex + zoneIndex));
    return [defaultSamplerZone(path, pathIndex)];
  });
  return normalizeSampleMap(next) ?? next;
}

function defaultSamplerZone(path: string, index: number): InstrumentSampleZone {
  const zone: InstrumentSampleZone = {
    path,
    name: sampleFilename(path, index),
    rootNote: 60,
    loNote: 0,
    hiNote: 127,
    loVel: 0,
    hiVel: 127,
    volumeDb: 0,
    pan: 0,
    tuning: 0,
    seqPosition: index,
    oneShot: true,
  };
  return { ...zone, id: sampleZoneStableId(zone, index) };
}

function sanitizeSampleZone(zone: InstrumentSampleZone, index = 0): InstrumentSampleZone {
  const loNote = clampInteger(zone.loNote, 0, 127);
  const hiNote = clampInteger(zone.hiNote, 0, 127);
  const loVel = clampInteger(zone.loVel, 0, 127);
  const hiVel = clampInteger(zone.hiVel, 0, 127);
  const next: InstrumentSampleZone = {
    ...zone,
    id: zone.id ?? sampleZoneStableId(zone, index),
    name: zone.name?.trim() || sampleFilename(zone.path, index),
    rootNote: clampInteger(zone.rootNote, 0, 127),
    loNote: Math.min(loNote, hiNote),
    hiNote: Math.max(loNote, hiNote),
    loVel: Math.min(loVel, hiVel),
    hiVel: Math.max(loVel, hiVel),
    volumeDb: clampDecimal(zone.volumeDb, -48, 12),
    pan: clampDecimal(zone.pan, -1, 1),
    tuning: clampInteger(zone.tuning, -1200, 1200),
    seqPosition: Math.max(0, Math.round(zone.seqPosition ?? index)),
  };
  if (next.startSample != null) next.startSample = clampInteger(next.startSample, 0, Number.MAX_SAFE_INTEGER);
  if (next.endSample != null) next.endSample = clampInteger(next.endSample, 0, Number.MAX_SAFE_INTEGER);
  return next;
}

function uniqueSamplePaths(paths: Array<string | undefined>): string[] {
  return paths.filter((path): path is string => Boolean(path?.trim()))
    .filter((path, index, all) => all.indexOf(path) === index);
}

function sampleFilename(path: string, index = 0): string {
  if (path.startsWith("data:")) return `Sample ${index + 1}`;
  const last = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  try {
    return decodeURIComponent(last).replace(/\.[^.]+$/, "") || `Sample ${index + 1}`;
  } catch {
    return last.replace(/\.[^.]+$/, "") || `Sample ${index + 1}`;
  }
}

function clampInteger(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, Math.round(value)));
}

function clampDecimal(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, value));
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
    pitchBendRangeSemitones: snapshot.pitchBendRangeSemitones,
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
    samplerComplexity: snapshot.samplerComplexity,
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
              <Icon name={option.icon} size={18} decorative />
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
      <Toggle
        checked={checked}
        aria-label={label}
        onChange={onChange}
      />
      <span class={`${styles.switchOption} ${!checked ? styles.switchOptionActive : ""}`}>
        {bottom}
      </span>
      <span class={styles.switchLabel}>{label}</span>
    </div>
  );
}
