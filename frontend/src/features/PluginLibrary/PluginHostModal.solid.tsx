/** @jsxImportSource solid-js */
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { Button, FloatingSelect, Icon, Modal } from "../../solid-ui";
import {
  decentSamplerControlBindingState,
  decentSamplerControlInstrumentPatch,
  upsertDecentSamplerInstrument,
} from "../InstrumentLibrary/decentSamplerInstrument";
import { isNative, send } from "../../ipc/bridge";
import type { DecentSamplerImport, DecentSamplerUiControl } from "../../ipc/schema";
import { createDefaultSynthDraft, synthDraftToInstrumentPatch, type SynthDraftPatch, useSynthStore } from "../../state/synthStore";
import { useAudioFileStore, useInstrumentStore, usePluginStore, useUiStore } from "../../state/store";
import type { PluginAdapter, PluginEditorKind } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { decentSamplerEditorKind, pluginFromDecentSamplerPreset } from "./decentSamplerPluginAdapter";
import styles from "./PluginHostModal.module.css";

interface PluginHostModalSolidProps {
  pluginId: string;
}

export interface MountedPluginHostModalSolid {
  dispose: () => void;
}

export function mountPluginHostModalSolid(host: HTMLElement, props: PluginHostModalSolidProps): MountedPluginHostModalSolid {
  const dispose = render(() => <PluginHostModalSolid {...props} />, host);
  return { dispose };
}

export function PluginHostModalSolid(props: PluginHostModalSolidProps) {
  const plugins = createStoreSelector(usePluginStore, (s) => s.plugins);
  const plugin = createMemo(() => plugins().find((candidate) => candidate.id === props.pluginId));
  const isDecentSampler = createMemo(() => plugin()?.format === "decent-sampler");
  const useFullDecentSamplerWindow = createMemo(() => {
    const current = plugin();
    return Boolean(current?.format === "decent-sampler" && ((current.uiWidth ?? 0) > 920 || (current.uiHeight ?? 0) > 620));
  });

  function close() {
    useUiStore.getState().closeEditor({ kind: "plugin", pluginId: props.pluginId });
  }

  function createInstrument() {
    const current = plugin();
    if (!current) return;
    const defaultDraft = createDefaultSynthDraft();
    const draft: SynthDraftPatch = {
      ...structuredClone(defaultDraft),
      name: `${current.name} Instrument`,
      metadata: {
        ...structuredClone(defaultDraft.metadata),
        icon: "ph:puzzle-piece",
        tags: ["plugin", current.name],
      },
    };
    const id = useInstrumentStore.getState().addInstrument({
      ...synthDraftToInstrumentPatch(draft),
      name: draft.name,
      icon: "ph:puzzle-piece",
      source: {
        kind: "plugin",
        label: current.status === "installed" ? current.name : `${current.name} via Aether`,
        pluginId: current.id,
        fallbackEngine: current.status === "installed" ? undefined : "aether",
        importedAt: Date.now(),
      },
      userCreated: true,
    });
    useSynthStore.getState().bindInstrument(id);
    useSynthStore.getState().setDraft(draft);
    close();
    useUiStore.getState().openEditor({ kind: "synth" });
  }

  return (
    <Show when={plugin()}>
      {(currentPlugin) => (
        <Modal
          open
          scopeId={`plugin-${props.pluginId}`}
          title={<ModalTitle plugin={currentPlugin()} />}
          width={useFullDecentSamplerWindow() ? "full" : "lg"}
          flushBody={isDecentSampler()}
          onClose={close}
          footer={!isDecentSampler() ? (
            <>
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Show
                when={currentPlugin().kind === "synth"}
                fallback={(
                  <Button variant="primary" disabled>
                    <Icon name="ph:file-audio" size={14} decorative />
                    Render WAV
                  </Button>
                )}
              >
                <Button variant="primary" onClick={createInstrument}>
                  <Icon name="ph:plus" size={14} decorative />
                  Create Instrument
                </Button>
              </Show>
            </>
          ) : undefined}
        >
          <div class={styles.host}>
            <Show
              when={isDecentSampler()}
              fallback={(
                <>
                  <div class={styles.statusGrid}>
                    <InfoCell label="Kind" value={currentPlugin().kind} />
                    <InfoCell label="Format" value={currentPlugin().format} />
                    <InfoCell label="Status" value={currentPlugin().status} />
                    <InfoCell label="Mode" value={currentPlugin().instrumentMode} />
                  </div>
                  <section class={styles.shell} aria-label="Plugin shell">
                    <div class={styles.shellHeader}>
                      <span>HOST</span>
                      <span>{currentPlugin().vendor}</span>
                    </div>
                    <div class={styles.shellBody}>
                      <Icon name="ph:puzzle-piece" size={32} decorative />
                      <div>
                        <h3>{currentPlugin().name}</h3>
                        <p>{currentPlugin().description}</p>
                      </div>
                    </div>
                  </section>

                  <div class={styles.routes}>
                    <RouteCard
                      icon="ph:wave-sine"
                      title="Instrument"
                      value={currentPlugin().kind === "synth" ? "Plugin-backed when installed, Aether fallback when missing." : "Unavailable for this plugin type."}
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
            >
              <DecentSamplerHost plugin={currentPlugin()} />
            </Show>
          </div>
        </Modal>
      )}
    </Show>
  );
}

function ModalTitle(props: { plugin: PluginAdapter }) {
  if (props.plugin.format === "decent-sampler") {
    return (
      <>
        <img class={styles.titleLogo} src={decentSamplerVisualSrc(props.plugin)} alt="" aria-hidden="true" />
        {props.plugin.name}
      </>
    );
  }

  return (
    <>
      <Icon name={props.plugin.kind === "synth" ? "ph:wave-sine" : "ph:puzzle-piece"} size={14} decorative />
      {props.plugin.name}
    </>
  );
}

function InfoCell(props: { label: string; value: string }) {
  return (
    <div class={styles.infoCell}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function RouteCard(props: { icon: string; title: string; value: string }) {
  return (
    <div class={styles.routeCard}>
      <Icon name={props.icon} size={16} decorative />
      <span>{props.title}</span>
      <p>{props.value}</p>
    </div>
  );
}

function DecentSamplerHost(props: { plugin: PluginAdapter }) {
  const audioFiles = createStoreSelector(useAudioFileStore, (s) => s.files);
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const plugins = createStoreSelector(usePluginStore, (s) => s.plugins);
  const plugin = createMemo(() => plugins().find((candidate) => candidate.id === props.plugin.id) ?? props.plugin);
  const associatedInstrument = createMemo(() => {
    const current = plugin();
    return current.associatedInstrumentId
      ? instruments().find((instrument) => instrument.id === current.associatedInstrumentId)
      : undefined;
  });
  const [preset, setPreset] = createSignal<DecentSamplerImport | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal("");
  const [activeControlIndex, setActiveControlIndex] = createSignal<number | null>(null);
  const [editorKindOpen, setEditorKindOpen] = createSignal(false);
  const sourcePath = createMemo(() => plugin().sourcePath);

  createEffect(() => {
    const path = sourcePath();
    if (!isNative() || !path) return;
    let cancelled = false;
    void refreshPackage(path)
      .then((result) => {
        if (cancelled || !result) return;
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Preset metadata could not be refreshed.");
      });
    onCleanup(() => {
      cancelled = true;
    });
  });

  const pluginUiControlDetails = createMemo(() => (plugin() as PluginAdapter & { uiControlDetails?: DecentSamplerUiControl[] }).uiControlDetails ?? []);
  const uiControlDetails = createMemo(() => preset()?.uiControlDetails ?? pluginUiControlDetails());
  const uiWidth = createMemo(() => preset()?.uiWidth ?? plugin().uiWidth ?? 0);
  const uiHeight = createMemo(() => preset()?.uiHeight ?? plugin().uiHeight ?? 0);
  const uiImageDataUrl = createMemo(() => preset()?.uiImageDataUrl ?? plugin().uiImageDataUrl ?? "");
  const canvasFrameStyle = createMemo<JSX.CSSProperties | undefined>(() => {
    const imageUrl = uiImageDataUrl();
    if (!imageUrl) return undefined;
    const width = uiWidth();
    const height = uiHeight();
    return {
      "--decent-ui-aspect": width && height ? `${width / height}` : "1",
      "aspect-ratio": width && height ? `${width} / ${height}` : undefined,
      "background-image": `url("${imageUrl}")`,
      "background-position": "center",
      "background-repeat": "no-repeat",
      "background-size": "100% 100%",
    };
  });
  const hotspotControls = createMemo(() => uiControlDetails().filter((control) => hasControlHotspot(control, uiWidth(), uiHeight())).slice(0, 64));
  const nativeAvailable = isNative();
  const activeControl = createMemo(() => {
    const index = activeControlIndex();
    return index == null ? null : hotspotControls()[index] ?? null;
  });
  const activeControlBinding = createMemo(() => {
    const control = activeControl();
    const instrument = associatedInstrument();
    return control && instrument ? decentSamplerControlBindingState(control, instrument) : null;
  });

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
      const existingAudioIds = new Set(audioFiles().map((file) => file.id));
      nextPreset.audioFiles.forEach((file) => {
        if (!existingAudioIds.has(file.id)) useAudioFileStore.getState().addFile(file);
      });
      const instrumentId = upsertDecentSamplerInstrument(nextPreset, {
        pluginId: plugin().id,
        sourceLabel: `DecentSampler compatibility: ${nextPreset.name}`,
      });
      usePluginStore.getState().updatePlugin(plugin().id, {
        ...pluginFromDecentSamplerPreset(nextPreset, decentSamplerEditorKind(plugin())),
        associatedInstrumentId: instrumentId,
      });
      setPreset(nextPreset);
      return nextPreset;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "DecentSampler package could not be parsed.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  function updateActiveControl(value: number) {
    const control = activeControl();
    const instrument = associatedInstrument();
    if (!control || !instrument) return;
    const patch = decentSamplerControlInstrumentPatch(control, instrument, value);
    if (!patch) return;
    useInstrumentStore.getState().updateInstrument(instrument.id, patch);
  }

  return (
    <section class={styles.decentSkinHost} aria-label="DecentSampler package UI">
      <div class={styles.decentSkinToolbar}>
        <FloatingSelect
          className={styles.decentEditorSelect}
          label="Editor"
          layout="inline"
          value={decentSamplerEditorKind(plugin())}
          ariaLabel="Default DecentSampler segment editor"
          options={DECENT_SAMPLER_EDITOR_OPTIONS}
          open={editorKindOpen()}
          onOpenChange={setEditorKindOpen}
          onChange={(value) => usePluginStore.getState().updatePlugin(plugin().id, { defaultEditorKind: value as PluginEditorKind })}
        />
        <span>{decentSamplerEditorKind(plugin()) === "drum" ? "New drops open in Drum editor." : "New drops open in MIDI editor."}</span>
      </div>
      <Show when={loading() || loadError()}>
        <div class={styles.decentSkinNotice} role={loadError() ? "alert" : "status"}>
          {loading() ? "Refreshing package UI" : loadError()}
        </div>
      </Show>

      <div class={styles.decentSkinWorkspace}>
        <div class={styles.decentSkinCanvas} aria-label={`${plugin().name} DecentSampler skin`}>
          <Show
            when={uiImageDataUrl()}
            fallback={(
              <div class={styles.decentSkinEmpty}>
                <img class={styles.decentCanvasLogo} src="/assets/decent-sampler.svg" alt="" aria-hidden="true" />
                <strong>{plugin().name}</strong>
                <span>{nativeAvailable ? "Install or refresh the package to load the DS skin." : "Open Beat.app to parse package skin metadata."}</span>
              </div>
            )}
          >
            <div class={styles.decentSkinFrame} style={canvasFrameStyle()}>
              <For each={hotspotControls()}>
                {(control, index) => (
                  <DecentSamplerHotspot
                    control={control}
                    uiWidth={uiWidth()}
                    uiHeight={uiHeight()}
                    active={activeControlIndex() === index()}
                    binding={associatedInstrument() ? decentSamplerControlBindingState(control, associatedInstrument()!) : null}
                    onClick={() => setActiveControlIndex(activeControlIndex() === index() ? null : index())}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
        <Show when={activeControl()}>
          {(control) => (
            <div class={styles.decentControlInspector}>
              <strong>{controlDisplayLabel(control())}</strong>
              <span>{activeControlBinding()?.targetLabel ?? (describeControlBinding(control()) || formatControlRange(control()))}</span>
              <Show
                when={activeControlBinding()}
                fallback={<em>{associatedInstrument() ? "Inspect only" : "Install package to enable control"}</em>}
              >
                {(binding) => (
                  <label class={styles.decentControlSlider}>
                    <input
                      type="range"
                      min={binding().min}
                      max={binding().max}
                      step={binding().step}
                      value={binding().value}
                      onInput={(event) => updateActiveControl(event.currentTarget.valueAsNumber)}
                    />
                    <em>{binding().valueLabel}</em>
                  </label>
                )}
              </Show>
            </div>
          )}
        </Show>
      </div>
    </section>
  );
}

const DECENT_SAMPLER_EDITOR_OPTIONS: Array<{ value: PluginEditorKind; label: string }> = [
  { value: "drum", label: "Drum" },
  { value: "midi", label: "MIDI" },
];

function DecentSamplerHotspot(props: {
  control: DecentSamplerUiControl;
  uiWidth: number;
  uiHeight: number;
  active: boolean;
  binding: ReturnType<typeof decentSamplerControlBindingState>;
  onClick: () => void;
}) {
  const label = () => controlDisplayLabel(props.control);
  const description = () => describeControlBinding(props.control);
  return (
    <button
      type="button"
      class={`${styles.decentSkinHotspot} ${props.active ? styles.decentSkinHotspotActive : ""}`}
      style={controlHotspotStyle(props.control, props.uiWidth, props.uiHeight)}
      title={`${label()} ${description()}`.trim()}
      aria-label={`${label()} ${description()}`.trim()}
      onClick={props.onClick}
    >
      <DecentSamplerControlGlyph control={props.control} binding={props.binding} />
    </button>
  );
}

function DecentSamplerControlGlyph(props: {
  control: DecentSamplerUiControl;
  binding: ReturnType<typeof decentSamplerControlBindingState>;
}) {
  const displayKind = () => controlDisplayKind(props.control);
  const percent = () => controlValuePercent(props.control, props.binding);
  return (
    <Show
      when={displayKind() !== "slider"}
      fallback={(
        <span class={styles.decentSkinSlider} aria-hidden="true">
          <span style={{ width: `${percent() * 100}%` }} />
        </span>
      )}
    >
      <Show
        when={displayKind() === "button" || displayKind() === "menu"}
        fallback={(
          <span class={styles.decentSkinKnob} aria-hidden="true">
            <span style={{ transform: `rotate(${-135 + percent() * 270}deg)` }} />
          </span>
        )}
      >
        <span class={styles.decentSkinButton} aria-hidden="true" />
      </Show>
    </Show>
  );
}

function decentSamplerVisualSrc(plugin: PluginAdapter) {
  return plugin.uiImageDataUrl || "/assets/decent-sampler.svg";
}

function hasControlHotspot(control: DecentSamplerUiControl, uiWidth: number, uiHeight: number) {
  return uiWidth > 0
    && uiHeight > 0
    && Number.isFinite(control.x)
    && Number.isFinite(control.y)
    && (control.width ?? 0) > 0
    && (control.height ?? 0) > 0;
}

function controlHotspotStyle(control: DecentSamplerUiControl, uiWidth: number, uiHeight: number): JSX.CSSProperties {
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

function controlDisplayLabel(control: DecentSamplerUiControl) {
  const rawLabel = String(control.label || "").trim();
  const rawKind = String(control.kind || "").trim();
  if (rawLabel && rawLabel.toLowerCase() !== rawKind.toLowerCase()) return humanizeDecentControlText(rawLabel);
  const binding = control.bindings?.find((candidate) => candidate.parameter || candidate.type || candidate.level);
  const fallback = binding?.parameter || binding?.type || binding?.level || rawKind || "control";
  return humanizeDecentControlText(fallback);
}

function controlDisplayKind(control: DecentSamplerUiControl) {
  const kind = String(control.kind || "").toLowerCase();
  if (kind.includes("slider")) return "slider";
  if (kind.includes("button")) return "button";
  if (kind.includes("menu")) return "menu";
  return "knob";
}

function controlValuePercent(control: DecentSamplerUiControl, binding: ReturnType<typeof decentSamplerControlBindingState>) {
  const min = binding?.min ?? control.minValue ?? 0;
  const max = binding?.max ?? control.maxValue ?? 1;
  const value = binding?.value ?? control.value ?? min;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function humanizeDecentControlText(value: string) {
  const text = value
    .replace(/^FX_/, "")
    .replace(/[-_]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
  return text || "Control";
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
