import { useEffect, useState, type CSSProperties } from "react";
import { Button, Icon, Modal } from "../../components";
import {
  decentSamplerControlBindingState,
  decentSamplerControlInstrumentPatch,
  upsertDecentSamplerInstrument,
} from "../InstrumentLibrary/decentSamplerInstrument";
import { isNative, send } from "../../ipc/bridge";
import type { DecentSamplerImport, DecentSamplerUiControl } from "../../ipc/schema";
import { createDefaultSynthDraft, synthDraftToInstrumentPatch, type SynthDraftPatch, useSynthStore } from "../../state/synthStore";
import { useAudioFileStore, useInstrumentStore, usePluginStore, useUiStore } from "../../state/store";
import type { PluginAdapter } from "../../state/types";
import { pluginFromDecentSamplerPreset } from "./DecentSamplerLibraryModal";
import styles from "./PluginHostModal.module.css";

interface PluginHostModalProps {
  pluginId: string;
}

export function PluginHostModal({ pluginId }: PluginHostModalProps) {
  const plugin = usePluginStore((s) => s.plugins.find((candidate) => candidate.id === pluginId));
  const closeEditor = useUiStore((s) => s.closeEditor);
  const openEditor = useUiStore((s) => s.openEditor);
  const addInstrument = useInstrumentStore((s) => s.addInstrument);
  const bindSynthInstrument = useSynthStore((s) => s.bindInstrument);
  const setSynthDraft = useSynthStore((s) => s.setDraft);

  if (!plugin) return null;
  const isDecentSampler = plugin.format === "decent-sampler";

  function close() {
    closeEditor({ kind: "plugin", pluginId });
  }

  function createInstrument() {
    if (!plugin) return;
    const draft: SynthDraftPatch = {
      ...structuredClone(createDefaultSynthDraft()),
      name: `${plugin.name} Instrument`,
      metadata: {
        ...structuredClone(createDefaultSynthDraft().metadata),
        icon: "ph:puzzle-piece",
        tags: ["plugin", plugin.name],
      },
    };
    const id = addInstrument({
      ...synthDraftToInstrumentPatch(draft),
      name: draft.name,
      icon: "ph:puzzle-piece",
      source: {
        kind: "plugin",
        label: plugin.status === "installed" ? plugin.name : `${plugin.name} via Aether`,
        pluginId: plugin.id,
        fallbackEngine: plugin.status === "installed" ? undefined : "aether",
        importedAt: Date.now(),
      },
      userCreated: true,
    });
    bindSynthInstrument(id);
    setSynthDraft(draft);
    close();
    openEditor({ kind: "synth" });
  }

  return (
    <Modal
      open
      scopeId={`plugin-${pluginId}`}
      title={<ModalTitle plugin={plugin} />}
      width={isDecentSampler ? "full" : "lg"}
      flushBody={isDecentSampler}
      onClose={close}
      footer={!isDecentSampler ? (
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          {plugin.kind === "synth" ? (
            <Button variant="primary" onClick={createInstrument}>
              <Icon name="ph:plus" size={14} decorative />
              Create Instrument
            </Button>
          ) : (
            <Button variant="primary" disabled>
              <Icon name="ph:file-audio" size={14} decorative />
              Render WAV
            </Button>
          )}
        </>
      ) : undefined}
    >
      <div className={styles.host}>
        {isDecentSampler ? (
          <DecentSamplerHost plugin={plugin} />
        ) : (
          <>
            <div className={styles.statusGrid}>
              <InfoCell label="Kind" value={plugin.kind} />
              <InfoCell label="Format" value={plugin.format} />
              <InfoCell label="Status" value={plugin.status} />
              <InfoCell label="Mode" value={plugin.instrumentMode} />
            </div>
            <section className={styles.shell} aria-label="Plugin shell">
              <div className={styles.shellHeader}>
                <span>HOST</span>
                <span>{plugin.vendor}</span>
              </div>
              <div className={styles.shellBody}>
                <Icon name="ph:puzzle-piece" size={32} decorative />
                <div>
                  <h3>{plugin.name}</h3>
                  <p>{plugin.description}</p>
                </div>
              </div>
            </section>

            <div className={styles.routes}>
              <RouteCard
                icon="ph:wave-sine"
                title="Instrument"
                value={plugin.kind === "synth" ? "Plugin-backed when installed, Aether fallback when missing." : "Unavailable for this plugin type."}
              />
              <RouteCard
                icon="ph:file-audio"
                title="Audio"
                value="Non-synth plugins will enter the project as rendered WAV assets."
              />
              <RouteCard
                icon="ph:shield-check"
                title="Boundary"
                value="Plugin UI and backend calls stay inside this modal host."
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ModalTitle({ plugin }: { plugin: PluginAdapter }) {
  if (plugin.format === "decent-sampler") {
    return (
      <>
        <img className={styles.titleLogo} src={decentSamplerVisualSrc(plugin)} alt="" aria-hidden="true" />
        {plugin.name}
      </>
    );
  }

  return (
    <>
      <Icon name={plugin.kind === "synth" ? "ph:wave-sine" : "ph:puzzle-piece"} size={14} decorative />
      {plugin.name}
    </>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.infoCell}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RouteCard({ icon, title, value }: { icon: string; title: string; value: string }) {
  return (
    <div className={styles.routeCard}>
      <Icon name={icon} size={16} decorative />
      <span>{title}</span>
      <p>{value}</p>
    </div>
  );
}

function DecentSamplerHost({ plugin }: { plugin: PluginAdapter }) {
  const addAudioFile = useAudioFileStore((s) => s.addFile);
  const associatedInstrument = useInstrumentStore((s) =>
    plugin.associatedInstrumentId
      ? s.instruments.find((instrument) => instrument.id === plugin.associatedInstrumentId)
      : undefined,
  );
  const updateInstrument = useInstrumentStore((s) => s.updateInstrument);
  const updatePlugin = usePluginStore((s) => s.updatePlugin);
  const [preset, setPreset] = useState<DecentSamplerImport | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [packageStatus, setPackageStatus] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [activeControlIndex, setActiveControlIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!isNative() || !plugin.sourcePath) return;
    let cancelled = false;
    void refreshPackage(plugin.sourcePath)
      .then((result) => {
        if (cancelled) return;
        if (!result) return;
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Preset metadata could not be refreshed.");
      });
    return () => {
      cancelled = true;
    };
  }, [plugin.sourcePath]);

  const uiControlDetails = preset?.uiControlDetails ?? [];
  const uiControls = uiControlDetails.length > 0
    ? uiControlDetails.map((control) => control.label)
    : (preset?.uiControls ?? []);
  const sampleCount = preset?.samples.length ?? plugin.sampleCount ?? 0;
  const uiControlCount = uiControls.length || plugin.uiControlCount || 0;
  const uiWidth = preset?.uiWidth ?? plugin.uiWidth ?? 0;
  const uiHeight = preset?.uiHeight ?? plugin.uiHeight ?? 0;
  const uiImageDataUrl = preset?.uiImageDataUrl ?? plugin.uiImageDataUrl ?? "";
  const samplePreview = (preset?.samples ?? []).slice(0, 8);
  const hasParsedSamples = Boolean(preset && preset.samples.length > 0);
  const packageHasMetadata = hasParsedSamples || sampleCount > 0;
  const canvasFrameStyle: CSSProperties | undefined = uiImageDataUrl
    ? {
        aspectRatio: uiWidth && uiHeight ? `${uiWidth} / ${uiHeight}` : undefined,
        backgroundImage: `url("${uiImageDataUrl}")`,
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "100% 100%",
      }
    : undefined;
  const hotspotControls = uiControlDetails.filter((control) => hasControlHotspot(control, uiWidth, uiHeight)).slice(0, 64);
  const listedControls: DecentSamplerUiControl[] = uiControlDetails.length > 0
    ? uiControlDetails
    : uiControls.map((label) => ({ kind: "control", label }));
  const nativeAvailable = isNative();
  const activeControl = activeControlIndex == null ? null : hotspotControls[activeControlIndex] ?? null;
  const activeControlBinding = activeControl && associatedInstrument
    ? decentSamplerControlBindingState(activeControl, associatedInstrument)
    : null;

  async function refreshPackage(pathHint?: string) {
    if (!nativeAvailable) {
      setLoadError("DecentSampler ZIP and preset parsing runs in the native Beat app. Browser mode can only show package shells.");
      return null;
    }

    setLoading(true);
    setLoadError("");
    try {
      const result = await send({ kind: "instrument.importDecent", pathHint });
      if (!result.preset) {
        setLoadError(pathHint ? "Preset metadata could not be refreshed." : "Install cancelled.");
        return null;
      }

      const nextPreset = result.preset;
      nextPreset.audioFiles.forEach(addAudioFile);
      const instrumentId = upsertDecentSamplerInstrument(nextPreset, {
        pluginId: plugin.id,
        sourceLabel: `DecentSampler compatibility: ${nextPreset.name}`,
      });
      updatePlugin(plugin.id, {
        ...pluginFromDecentSamplerPreset(nextPreset),
        associatedInstrumentId: instrumentId,
      });
      setPreset(nextPreset);
      setPackageStatus(`Package parsed and MIDI-ready: ${nextPreset.name || plugin.name}.`);
      return nextPreset;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "DecentSampler package could not be parsed.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  function updateActiveControl(value: number) {
    if (!activeControl || !associatedInstrument) return;
    const patch = decentSamplerControlInstrumentPatch(activeControl, associatedInstrument, value);
    if (!patch) return;
    updateInstrument(associatedInstrument.id, patch);
  }

  return (
    <section className={styles.decentSkinHost} aria-label="DecentSampler skin host">
      <div className={styles.decentSkinToolbar}>
        <div className={styles.decentSkinStatus}>
          <span>{plugin.status === "installed" ? "Package Ready" : "Package Shell"}</span>
          <strong>{uiImageDataUrl ? "Skin" : "Awaiting Skin"}</strong>
          {loading && <em>Refreshing</em>}
          {loadError && <em>{loadError}</em>}
          {packageStatus && <em>{packageStatus}</em>}
        </div>
        <div className={styles.decentSkinActions}>
          <Button size="sm" variant={showDetails ? "default" : "primary"} onClick={() => setShowDetails(false)}>
            <Icon name="ph:sliders" size={14} decorative />
            Skin
          </Button>
          <Button size="sm" variant={showDetails ? "primary" : "default"} onClick={() => setShowDetails(true)}>
            <Icon name="ph:list-magnifying-glass" size={14} decorative />
            Details
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void refreshPackage(plugin.sourcePath)} disabled={loading || !nativeAvailable}>
            <Icon name={packageHasMetadata ? "ph:arrows-clockwise" : "ph:download-simple"} size={14} decorative />
            {packageHasMetadata ? "Refresh" : "Install"}
          </Button>
        </div>
      </div>

      <div className={`${styles.decentSkinWorkspace} ${showDetails ? styles.decentSkinWorkspaceWithDetails : ""}`}>
        <div className={styles.decentSkinCanvas} aria-label={`${plugin.name} DecentSampler skin`}>
          {uiImageDataUrl ? (
            <div className={styles.decentSkinFrame} style={canvasFrameStyle}>
              {hotspotControls.map((control, index) => (
                <button
                  key={`${control.label}-${control.x}-${control.y}-${index}`}
                  type="button"
                  className={`${styles.decentSkinHotspot} ${activeControlIndex === index ? styles.decentSkinHotspotActive : ""}`}
                  style={controlHotspotStyle(control, uiWidth, uiHeight)}
                  title={`${control.label} ${describeControlBinding(control)}`.trim()}
                  aria-label={`${control.label} ${describeControlBinding(control)}`.trim()}
                  onClick={() => setActiveControlIndex(activeControlIndex === index ? null : index)}
                >
                  <span>{control.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.decentSkinEmpty}>
              <img className={styles.decentCanvasLogo} src="/assets/decent-sampler.png" alt="" aria-hidden="true" />
              <strong>{plugin.name}</strong>
              <span>{nativeAvailable ? "Install or refresh the package to load the DS skin." : "Open Beat.app to parse package skin metadata."}</span>
            </div>
          )}
          <div className={styles.decentSkinOverlay}>
            <strong>{plugin.name}</strong>
            <span>{uiWidth && uiHeight ? `${uiWidth} x ${uiHeight}` : "DS UI"}</span>
          </div>
          {activeControl && (
            <div className={styles.decentControlInspector}>
              <strong>{activeControl.label}</strong>
              <span>{activeControlBinding?.targetLabel ?? (describeControlBinding(activeControl) || formatControlRange(activeControl))}</span>
              {activeControlBinding ? (
                <label className={styles.decentControlSlider}>
                  <input
                    type="range"
                    min={activeControlBinding.min}
                    max={activeControlBinding.max}
                    step={activeControlBinding.step}
                    value={activeControlBinding.value}
                    onChange={(event) => updateActiveControl(event.currentTarget.valueAsNumber)}
                  />
                  <em>{activeControlBinding.valueLabel}</em>
                </label>
              ) : (
                <em>{associatedInstrument ? "Inspect only" : "Install package to enable control"}</em>
              )}
            </div>
          )}
        </div>

        {showDetails && (
          <aside className={styles.decentDetails} aria-label="DecentSampler package details">
            <div className={styles.decentSummary}>
              <h3>{plugin.name}</h3>
              <p>{plugin.description}</p>
              {plugin.associatedInstrumentId ? (
                <p>Beat sampler bridge is ready for MIDI tracks.</p>
              ) : packageHasMetadata ? (
                <p>Beat will repair the sampler bridge automatically from this package metadata.</p>
              ) : null}
            </div>
            <div className={styles.decentCells}>
              <InfoCell label="Package" value={plugin.sourceFileName ?? plugin.name} />
              <InfoCell label="Zones" value={sampleCount ? `${sampleCount}` : "Pending parse"} />
              <InfoCell label="Controls" value={uiControlCount ? `${uiControlCount}` : "-"} />
              <InfoCell label="Mode" value="Sample package" />
            </div>
            {listedControls.length > 0 && (
              <div className={styles.decentControls} aria-label="DecentSampler UI controls">
                {listedControls.slice(0, 12).map((control, index) => (
                  <span key={`${control.label}-${index}`}>
                    <strong>{control.label}</strong>
                    <em>{describeControlBinding(control) || formatControlRange(control)}</em>
                  </span>
                ))}
              </div>
            )}
            <div className={styles.decentMap} aria-label="DecentSampler sample map">
              {samplePreview.length > 0 ? (
                samplePreview.map((sample) => (
                  <div key={`${sample.path}-${sample.loNote}-${sample.hiNote}-${sample.loVel}-${sample.hiVel}`} className={styles.decentZone}>
                    <span>{sample.name}</span>
                    <strong>
                      {noteRange(sample.loNote, sample.hiNote)} / vel {sample.loVel}-{sample.hiVel}
                    </strong>
                  </div>
                ))
              ) : (
                <div className={styles.decentZone}>
                  <span>{nativeAvailable ? "Install or parse this package to load zones" : "Open Beat.app to parse zones"}</span>
                  <strong>{nativeAvailable ? "Parse" : "Native"}</strong>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
function decentSamplerVisualSrc(plugin: PluginAdapter) {
  return plugin.uiImageDataUrl || "/assets/decent-sampler.png";
}

function hasControlHotspot(control: DecentSamplerUiControl, uiWidth: number, uiHeight: number) {
  return uiWidth > 0
    && uiHeight > 0
    && Number.isFinite(control.x)
    && Number.isFinite(control.y)
    && (control.width ?? 0) > 0
    && (control.height ?? 0) > 0;
}

function controlHotspotStyle(control: DecentSamplerUiControl, uiWidth: number, uiHeight: number): CSSProperties {
  const x = Math.max(0, Math.min(uiWidth, control.x ?? 0));
  const y = Math.max(0, Math.min(uiHeight, control.y ?? 0));
  const width = Math.max(4, Math.min(uiWidth - x, control.width ?? 0));
  const height = Math.max(4, Math.min(uiHeight - y, control.height ?? 0));
  return {
    left: `${(x / uiWidth) * 100}%`,
    top: `${(y / uiHeight) * 100}%`,
    width: `${(width / uiWidth) * 100}%`,
    height: `${(height / uiHeight) * 100}%`,
  };
}

function describeControlBinding(control: DecentSamplerUiControl) {
  const binding = control.bindings?.find((candidate) => candidate.parameter || candidate.type || candidate.level);
  if (!binding) return "";
  const parts = [binding.level, binding.type, binding.parameter]
    .filter(Boolean)
    .map((part) => String(part).replace(/^FX_/, "").replaceAll("_", " ").toLowerCase());
  return parts.join(" / ");
}

function formatControlRange(control: DecentSamplerUiControl) {
  if (control.minValue === undefined && control.maxValue === undefined) return control.kind;
  const min = formatControlNumber(control.minValue ?? 0);
  const max = formatControlNumber(control.maxValue ?? 1);
  return `${control.kind} ${min}-${max}`;
}

function formatControlNumber(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function noteRange(lo: number, hi: number) {
  return lo === hi ? midiNoteName(lo) : `${midiNoteName(lo)}-${midiNoteName(hi)}`;
}

function midiNoteName(note: number) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const bounded = Math.max(0, Math.min(127, Math.round(note)));
  return `${names[bounded % 12]}${Math.floor(bounded / 12) - 1}`;
}
