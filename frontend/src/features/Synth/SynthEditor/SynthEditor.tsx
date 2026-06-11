import { useEffect, useRef, useState } from "react";
import { previewFrequency, renderedInstrumentBuffer } from "../../../audio/synthPreview";
import { createSynthWorkletPreviewNode } from "../../../audio/synthWorkletPreview";
import { ActionFooter, Button, HoverInfo, Icon, Knob, TextInput } from "../../../components";
import {
  FACTORY_SYNTH_PRESETS,
  getNumberParam,
  modulationSummaryForSource,
  modulationSummaryForTarget,
  synthDraftFromInstrument,
  synthDraftToInstrumentPatch,
  synthDraftToPreviewInstrument,
  useSynthStore,
  type ModulationSourceId,
  type ModulationTargetId,
  type SynthDraftPatch,
  type SynthParameterId,
} from "../../../state/synthStore";
import { deleteSynthPreset, listSynthPresets, saveSynthPreset, type SynthPresetRecord } from "../../../persistence/dexie";
import { ANALYZER_BAND_COUNT, useAnalyzerStore, type AnalyzerSnapshot } from "../../../state/analyzerStore";
import { useInstrumentStore, useUiStore } from "../../../state/store";
import { INSTRUMENT_ICON_OPTIONS, instrumentIconLabel } from "../../../state/instrumentIcons";
import { AnalyzerPanel } from "../AnalyzerPanel";
import { ModulationMatrix } from "../ModulationMatrix";
import { OscillatorPanel } from "../OscillatorPanel";
import styles from "./SynthEditor.module.css";

const MACRO_IDS = ["macro.1", "macro.2", "macro.3", "macro.4"] as const;
const AUDITION_SECONDS = 1.4;
const ANALYZER_BANDS = ANALYZER_BAND_COUNT;
const FACTORY_PRESET_PREFIX = "factory:";
const USER_PRESET_PREFIX = "user:";
const USER_INSTRUMENT_PRESET_PREFIX = "instrument:";
const FILTER_TYPES = [
  ["lowpass", "LP", "Lowpass", "ph:wave-sine"],
  ["highpass", "HP", "Highpass", "ph:wave-triangle"],
  ["bandpass", "BP", "Bandpass", "ph:wave-square"],
] as const;
const LFO_SHAPES = [
  ["sine", "Sine", "ph:wave-sine"],
  ["triangle", "Triangle", "ph:wave-triangle"],
  ["saw", "Saw", "ph:wave-sawtooth"],
  ["square", "Square", "ph:wave-square"],
] as const;

interface AuditionHandle {
  node: AudioNode;
  stop: (when?: number) => void;
}

export function SynthEditor() {
  const draft = useSynthStore((state) => state.draft);
  const boundInstrumentId = useSynthStore((state) => state.boundInstrumentId);
  const bindInstrument = useSynthStore((state) => state.bindInstrument);
  const setDraft = useSynthStore((state) => state.setDraft);
  const setName = useSynthStore((state) => state.setName);
  const setNumericParameter = useSynthStore((state) => state.setNumericParameter);
  const instruments = useInstrumentStore((state) => state.instruments);
  const addInstrument = useInstrumentStore((state) => state.addInstrument);
  const updateInstrument = useInstrumentStore((state) => state.updateInstrument);
  const closeEditor = useUiStore((state) => state.closeEditor);
  const synthInstruments = instruments.filter((instrument) => instrument.kind === "synth" || instrument.kind === "wavetable");
  const userInstrumentPresets = synthInstruments.filter((instrument) => instrument.userCreated && Boolean(instrument.synthPatch));
  const didAutoBind = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const auditionRef = useRef<AuditionHandle | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyzerFrameRef = useRef<number | null>(null);
  const analyzerSequenceRef = useRef(1);
  const [presets, setPresets] = useState<SynthPresetRecord[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [iconOpen, setIconOpen] = useState(false);
  const [auditioning, setAuditioning] = useState(false);
  const [auditionSnapshot, setAuditionSnapshot] = useState<AnalyzerSnapshot>(() => createEmptyAnalyzerSnapshot());

  useEffect(() => {
    if (didAutoBind.current || boundInstrumentId || synthInstruments.length === 0) return;
    const first = synthInstruments[0];
    didAutoBind.current = true;
    bindInstrument(first.id);
    setDraft(synthDraftFromInstrument(first));
  }, [bindInstrument, boundInstrumentId, setDraft, synthInstruments]);

  useEffect(() => {
    void refreshPresets();
  }, []);

  useEffect(
    () => () => {
      stopAudition();
      closeAudioContext();
    },
    [],
  );

  async function refreshPresets() {
    setPresets(await listSynthPresets());
  }

  function getAudioContext(): AudioContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") audioCtxRef.current = new Ctor();
    return audioCtxRef.current;
  }

  function closeAudioContext() {
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (!ctx || ctx.state === "closed") return;
    void ctx.close().catch(() => undefined);
  }

  function stopAudition() {
    const audition = auditionRef.current;
    const gain = gainRef.current;
    auditionRef.current = null;
    gainRef.current = null;
    stopAuditionAnalyzer();
    setAuditioning(false);
    if (!audition) return;

    try {
      const ctx = audition.node.context;
      if (gain) {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.025);
      }
      audition.stop(ctx.currentTime + 0.03);
      window.setTimeout(() => {
        try {
          audition.node.disconnect();
          gain?.disconnect();
        } catch {
          // Already disconnected.
        }
      }, 80);
    } catch {
      // Already stopped nodes throw in some browsers.
    }
  }

  async function onAudition() {
    if (auditioning) {
      stopAudition();
      return;
    }

    stopAudition();
    const ctx = getAudioContext();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);

    const instrument = synthDraftToPreviewInstrument(draft);
    const frequency = previewFrequency(instrument);
    let handle: AuditionHandle | null = null;
    let seededAnalyzer = false;
    const finishAudition = (node: AudioNode) => {
      if (auditionRef.current?.node !== node) return;
      const gainNode = gainRef.current;
      auditionRef.current = null;
      gainRef.current = null;
      stopAuditionAnalyzer();
      setAuditioning(false);
      try {
        node.disconnect();
        gainNode?.disconnect();
      } catch {
        // Already disconnected.
      }
    };

    const worklet = await createSynthWorkletPreviewNode(ctx, instrument, AUDITION_SECONDS, frequency, () => {
      if (handle) finishAudition(handle.node);
    }).catch(() => null);
    if (worklet) {
      handle = {
        node: worklet.node,
        stop: () => worklet.stop(),
      };
    } else {
      const buffer = renderedInstrumentBuffer(ctx, instrument, AUDITION_SECONDS, frequency);
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

    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.015);
    gain.gain.setTargetAtTime(0, ctx.currentTime + Math.max(0.05, AUDITION_SECONDS - 0.08), 0.03);
    handle.node.connect(gain).connect(analyser).connect(ctx.destination);
    auditionRef.current = handle;
    gainRef.current = gain;
    startAuditionAnalyzer(analyser);
    setAuditioning(true);
    if (handle.node instanceof AudioBufferSourceNode) {
      handle.node.start();
      handle.node.stop(ctx.currentTime + AUDITION_SECONDS);
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
      for (let i = 0; i < time.length; i++) {
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

      analyzerFrameRef.current = window.requestAnimationFrame(tick);
    };

    tick();
  }

  function stopAuditionAnalyzer(clear = true) {
    if (analyzerFrameRef.current !== null) {
      window.cancelAnimationFrame(analyzerFrameRef.current);
      analyzerFrameRef.current = null;
    }
    if (clear) {
      setAuditionSnapshot(createEmptyAnalyzerSnapshot());
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
      sequence: analyzerSequenceRef.current++,
      rms: snapshot.rms,
      peak: snapshot.peak,
      bands: snapshot.bands.slice(0, ANALYZER_BANDS),
      updatedAt: Date.now(),
    };
    setAuditionSnapshot(next);
    useAnalyzerStore.getState().setSynthSnapshot(next);
  }

  async function saveDraftToInstrument(): Promise<string> {
    const patch = synthDraftToInstrumentPatch(draft);
    let instrumentId = boundInstrumentId;
    if (instrumentId && instruments.some((instrument) => instrument.id === instrumentId)) {
      updateInstrument(instrumentId, patch);
    } else {
      instrumentId = addInstrument({
        ...patch,
        name: patch.name ?? "Wavetable Synth",
        userCreated: true,
      });
      didAutoBind.current = true;
      bindInstrument(instrumentId);
    }

    if (patch.synthPatch) {
      const now = Date.now();
      const presetId = `instrument:${instrumentId}`;
      const existingPreset = presets.find((preset) => preset.id === presetId);
      await saveSynthPreset({
        id: presetId,
        name: patch.name ?? draft.name,
        patch: patch.synthPatch,
        tags: patch.synthPatch.metadata?.tags ?? [],
        createdAt: existingPreset?.createdAt ?? now,
        updatedAt: now,
      });
      setSelectedPresetId(`${USER_PRESET_PREFIX}${presetId}`);
      await refreshPresets();
    }

    return instrumentId;
  }

  async function onApply() {
    await saveDraftToInstrument();
  }

  async function onSaveInstrument() {
    await saveDraftToInstrument();
    closeEditor({ kind: "synth" });
  }

  function onLoadPreset(value: string) {
    setSelectedPresetId(value);
    const factoryId = value.startsWith(FACTORY_PRESET_PREFIX) ? value.slice(FACTORY_PRESET_PREFIX.length) : "";
    const userId = value.startsWith(USER_PRESET_PREFIX) ? value.slice(USER_PRESET_PREFIX.length) : "";
    const userInstrumentId = value.startsWith(USER_INSTRUMENT_PRESET_PREFIX) ? value.slice(USER_INSTRUMENT_PRESET_PREFIX.length) : "";
    const patch = factoryId
      ? FACTORY_SYNTH_PRESETS.find((candidate) => candidate.id === factoryId)?.patch
      : userId
        ? presets.find((candidate) => candidate.id === userId)?.patch
        : userInstrumentId
          ? synthDraftFromInstrument(synthInstruments.find((candidate) => candidate.id === userInstrumentId)!)
          : undefined;
    if (!patch) return;
    didAutoBind.current = true;
    setDraft({
      ...patch,
      name: boundInstrumentId ? draft.name : patch.name,
    });
  }

  async function onDeletePreset() {
    if (!selectedPresetId.startsWith(USER_PRESET_PREFIX)) return;
    await deleteSynthPreset(selectedPresetId.slice(USER_PRESET_PREFIX.length));
    setSelectedPresetId("");
    await refreshPresets();
  }

  function setInstrumentIcon(icon: string) {
    setDraft({
      ...draft,
      metadata: {
        ...draft.metadata,
        icon,
      },
    });
    setIconOpen(false);
  }

  return (
    <section className={`ds-editor-shell ds-fill ${styles.shell}`} aria-label="Synth editor">
      <div className={`ds-editor-body ds-scroll ${styles.body}`}>
        <div className={styles.utilityGrid}>
          <section className="ds-panel" aria-label="Synth identity">
            <header className="ds-panel-header">
              <div className="ds-panel-title">Instrument</div>
            </header>
            <div className={`ds-panel-body ${styles.identityBody}`}>
              <div className={styles.nameIconRow}>
                <TextInput
                  className={styles.nameField}
                  label="Name"
                  layout="inline"
                  value={draft.name}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
                <div className={styles.iconPicker}>
                  <HoverInfo content={instrumentIconLabel(draft.metadata.icon)}>
                    <Button
                      iconOnly
                      size="md"
                      className={styles.iconPickerButton}
                      aria-label="Change instrument icon"
                      onClick={() => setIconOpen((open) => !open)}
                    >
                      <Icon name={draft.metadata.icon ?? "ph:cube"} size={16} decorative />
                    </Button>
                  </HoverInfo>
                  {iconOpen && (
                    <div className={styles.iconMenu} role="menu" aria-label="Instrument icons">
                      {INSTRUMENT_ICON_OPTIONS.map((option) => (
                        <button
                          key={option.icon}
                          type="button"
                          className={`${styles.iconOption} ${draft.metadata.icon === option.icon ? styles.iconOptionSelected : ""}`}
                          title={`${option.label} - ${option.tags.join(", ")}`}
                          onClick={() => setInstrumentIcon(option.icon)}
                          role="menuitem"
                        >
                          <Icon name={option.icon} size={16} decorative />
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className={styles.presetRow}>
                <label className={styles.presetSelect}>
                  <span className="ds-field-label">Preset</span>
                  <select
                    className="ds-select"
                    value={selectedPresetId}
                    onChange={(event) => onLoadPreset(event.currentTarget.value)}
                  >
                    <option value="">None</option>
                    <optgroup label="Factory">
                      {FACTORY_SYNTH_PRESETS.map((preset) => (
                        <option key={preset.id} value={`${FACTORY_PRESET_PREFIX}${preset.id}`}>
                          {preset.name}
                        </option>
                      ))}
                    </optgroup>
                    {presets.length > 0 && (
                      <optgroup label="User Presets">
                        {presets.map((preset) => (
                          <option key={preset.id} value={`${USER_PRESET_PREFIX}${preset.id}`}>
                            {preset.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {userInstrumentPresets.length > 0 && (
                      <optgroup label="User Instruments">
                        {userInstrumentPresets.map((instrument) => (
                          <option key={instrument.id} value={`${USER_INSTRUMENT_PRESET_PREFIX}${instrument.id}`}>
                            {instrument.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
                {selectedPresetId.startsWith(USER_PRESET_PREFIX) && (
                  <Button size="sm" variant="ghost" onClick={onDeletePreset}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
          </section>
          <AnalyzerPanel
            scope="synth"
            snapshotOverride={auditionSnapshot}
            playing={auditioning}
            onTogglePlayback={() => void onAudition()}
          />
        </div>

        <OscillatorPanel />

        <div className={styles.sourceGrid}>
          <LfoPanel />
          <section className={`ds-panel ${styles.macroPanel}`} aria-label="Macros">
            <header className="ds-panel-header">
              <div className="ds-panel-title">Macro Controls</div>
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
                  {...modulationPropsForSource(draft, id)}
                  pickSourceId={id}
                  formatValue={formatPercent}
                  onChange={(value) => setNumericParameter(id, value)}
                />
              ))}
            </div>
          </section>
        </div>

        <div className={styles.bottomGrid}>
          <AmpFilterPanel />
          <ModulationMatrix />
        </div>
      </div>

      <ActionFooter className={styles.footer}>
        <Button className={styles.footerButton} variant="ghost" selected={auditioning} onClick={() => void onAudition()}>
          <Icon name={auditioning ? "ph:stop-fill" : "ph:play-fill"} size={12} decorative />
          {auditioning ? "Stop" : "Play"}
        </Button>
        <Button className={styles.footerButton} onClick={() => void onApply()}>
          Apply
        </Button>
        <Button className={styles.footerButton} variant="primary" onClick={() => void onSaveInstrument()}>
          Save
        </Button>
      </ActionFooter>
    </section>
  );
}

function LfoPanel() {
  const draft = useSynthStore((state) => state.draft);
  const setNumericParameter = useSynthStore((state) => state.setNumericParameter);
  const setBooleanParameter = useSynthStore((state) => state.setBooleanParameter);
  const setParameter = useSynthStore((state) => state.setParameter);

  const enabled = draft.parameters["lfo.1.enabled"] === true;

  return (
    <section className={`ds-panel ${styles.lfoPanel} ${enabled ? "" : styles.disabledPanel}`} aria-label="LFO">
      <header className="ds-panel-header">
        <div className="ds-panel-title">LFO</div>
        <div className="ds-panel-actions">
          <Button
            iconOnly
            size="xs"
            selected={enabled}
            aria-label={`${enabled ? "Disable" : "Enable"} LFO`}
            onClick={() => setBooleanParameter("lfo.1.enabled", !enabled)}
          >
            <Icon name={enabled ? "ph:power-fill" : "ph:power"} size={12} decorative />
          </Button>
        </div>
      </header>
      <div className={`ds-panel-body ${styles.lfoControls}`}>
        <ShapeButtonSet
          label="LFO Shape"
          value={String(draft.parameters["lfo.1.shape"])}
          options={LFO_SHAPES}
          onChange={(value) => setParameter("lfo.1.shape", value)}
        />
        <Knob
          size="sm"
          label="Rate"
          value={getNumberParam(draft, "lfo.1.rate")}
          min={0.05}
          max={50}
          step={0.01}
          unit="Hz"
          defaultValue={1}
          formatValue={(value) => `${value < 10 ? value.toFixed(2) : value.toFixed(1)}`}
          pickSourceId="lfo.1"
          onChange={(value) => setNumericParameter("lfo.1.rate", value)}
        />
      </div>
    </section>
  );
}

function makeAnalyzerBands(frequency: Uint8Array): number[] {
  const bands: number[] = [];
  const binCount = frequency.length;
  for (let band = 0; band < ANALYZER_BANDS; band++) {
    const start = Math.floor((band / ANALYZER_BANDS) ** 1.7 * binCount);
    const end = Math.max(start + 1, Math.floor(((band + 1) / ANALYZER_BANDS) ** 1.7 * binCount));
    let sum = 0;
    let count = 0;
    for (let i = start; i < Math.min(end, binCount); i++) {
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
  for (let i = 0; i < samples.length; i++) {
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
  for (let i = 0; i < length; i++) mono[i] = (left[i] + right[i]) * 0.5;
  return mono;
}

function makeFftBands(samples: Float32Array): number[] {
  const fftSize = 2048;
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  const sourceLength = Math.min(samples.length, fftSize);
  for (let i = 0; i < sourceLength; i++) {
    const window = 0.5 - 0.5 * Math.cos((Math.PI * 2 * i) / Math.max(1, fftSize - 1));
    real[i] = samples[i] * window;
  }

  fftRadix2(real, imag);

  const magnitudes = new Float32Array(fftSize / 2);
  let maxMagnitude = 0;
  for (let i = 1; i < magnitudes.length; i++) {
    const magnitude = Math.hypot(real[i], imag[i]);
    magnitudes[i] = magnitude;
    maxMagnitude = Math.max(maxMagnitude, magnitude);
  }

  if (maxMagnitude <= 0) return Array.from({ length: ANALYZER_BANDS }, () => 0);

  const bands: number[] = [];
  for (let band = 0; band < ANALYZER_BANDS; band++) {
    const start = Math.max(1, Math.floor((band / ANALYZER_BANDS) ** 1.7 * magnitudes.length));
    const end = Math.max(start + 1, Math.floor(((band + 1) / ANALYZER_BANDS) ** 1.7 * magnitudes.length));
    let sum = 0;
    let count = 0;
    for (let bin = start; bin < Math.min(end, magnitudes.length); bin++) {
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
  for (let i = 1; i < n; i++) {
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
      for (let k = 0; k < half; k++) {
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

function AmpFilterPanel() {
  const draft = useSynthStore((state) => state.draft);
  const setNumericParameter = useSynthStore((state) => state.setNumericParameter);
  const setBooleanParameter = useSynthStore((state) => state.setBooleanParameter);
  const setParameter = useSynthStore((state) => state.setParameter);
  const filterType = String(draft.parameters["filter.type"]);
  const filterEnabled = draft.parameters["filter.enabled"] === true;

  return (
    <section className={`ds-panel ${filterEnabled ? "" : styles.disabledPanel}`} aria-label="Amp and filter">
      <header className="ds-panel-header">
        <div className="ds-panel-title">Amp / Filter</div>
        <div className="ds-panel-actions">
          <Button
            iconOnly
            size="xs"
            selected={filterEnabled}
            aria-label={`${filterEnabled ? "Disable" : "Enable"} filter`}
            onClick={() => setBooleanParameter("filter.enabled", !filterEnabled)}
          >
            <Icon name={filterEnabled ? "ph:power-fill" : "ph:power"} size={12} decorative />
          </Button>
        </div>
      </header>
      <div className={`ds-panel-body ${styles.controlGrid}`}>
        <ShapeButtonSet
          label="Filter"
          value={filterType}
          options={FILTER_TYPES}
          onChange={(value) => setParameter("filter.type", value)}
        />
        <Knob
          size="sm"
          label="Cutoff"
          value={getNumberParam(draft, "filter.cutoff")}
          min={20}
          max={20000}
          step={10}
          unit="Hz"
          defaultValue={18000}
          {...modulationPropsForTarget(draft, "filter.cutoff")}
          pickTargetId="filter.cutoff"
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
            {...modulationPropsForTarget(draft, id)}
            pickTargetId={MODULATABLE_PARAMETER_IDS.has(id) ? id : undefined}
            formatValue={id.includes("env.1") && id !== "env.1.sustain" ? formatSeconds : formatPercent}
            onChange={(value) => setNumericParameter(id, value)}
          />
        ))}
      </div>
    </section>
  );
}

function ShapeButtonSet({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string, string] | readonly [string, string, string, string]>;
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option[0] === value);

  return (
    <div className={styles.shapeControl}>
      <div className={styles.shapeButtons} role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const [optionValue, shortLabel, fullLabelOrIcon, maybeIcon] = option;
          const fullLabel = maybeIcon ? fullLabelOrIcon : shortLabel;
          const icon = maybeIcon ?? fullLabelOrIcon;
          const active = value === optionValue;
          return (
            <HoverInfo content={fullLabel} key={optionValue}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={fullLabel}
                className={`${styles.shapeButton} ${active ? styles.shapeButtonActive : ""}`}
                onClick={() => onChange(optionValue)}
              >
                <Icon name={icon} size={14} decorative />
              </button>
            </HoverInfo>
          );
        })}
      </div>
      <span className={styles.shapeSelectedLabel}>{selected?.[1] ?? value}</span>
      <span className={styles.shapeControlLabel}>{label}</span>
    </div>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}`;
}

function formatSeconds(value: number): string {
  return value < 1 ? `${Math.round(value * 1000)}ms` : `${value.toFixed(2)}s`;
}

const MODULATABLE_PARAMETER_IDS = new Set<string>([
  "filter.cutoff",
  "filter.resonance",
  "filter.drive",
  "amp.level",
  "amp.pan",
]);

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
  const summary = modulationSummaryForSource(draft, id as ModulationSourceId);
  if (summary.count === 0) return {};
  return {
    modulationAmount: summary.amount,
    modulationLabel: summary.label,
  };
}
