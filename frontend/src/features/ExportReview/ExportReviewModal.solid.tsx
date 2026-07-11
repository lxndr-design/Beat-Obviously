import { createMemo, For, Show } from "solid-js";
import { appAlert, appPrompt, Button, FloatingSelect, Icon, Modal, Toggle } from "../../solid-ui";
import { isNative, send } from "../../ipc/bridge";
import { createStoreSelector } from "../../solid-utils/store";
import { useDocumentStore, useProjectStore, useTransportStore, useUiStore } from "../../state/store";
import {
  FACTORY_EXPORT_PRESETS,
  applyExportPresetOverride,
  allExportPresets,
  exportValidationBlocksExport,
  normalizeExportOptions,
  recentExportFolder,
  useExportStore,
  type ExportPreset,
  type ExportValidationStatus,
} from "../../state/exportStore";
import { revealExportDestination, runProjectExport } from "./exportActions";
import styles from "./ExportReviewModal.module.css";

export function ExportReviewModal() {
  const selectedPresetId = createStoreSelector(useExportStore, (state) => state.selectedPresetId);
  const userPresets = createStoreSelector(useExportStore, (state) => state.userPresets);
  const presetOverrides = createStoreSelector(useExportStore, (state) => state.presetOverrides);
  const recentDestinations = createStoreSelector(useExportStore, (state) => state.recentDestinations);
  const exportDestinationFolder = createStoreSelector(useExportStore, (state) => state.exportDestinationFolder);
  const job = createStoreSelector(useExportStore, (state) => state.job);
  const validation = createStoreSelector(useExportStore, (state) => state.validation);
  const validateBeforeExport = createStoreSelector(useExportStore, (state) => state.validateBeforeExport);
  const currentFilePath = createStoreSelector(useDocumentStore, (state) => state.currentFilePath);
  const tracks = createStoreSelector(useProjectStore, (state) => state.project.tracks);
  const selectedTrackIds = createStoreSelector(useUiStore, (state) => state.selectedTrackIds);
  const loopRange = createStoreSelector(useTransportStore, (state) => state.loopRange);

  const presets = createMemo(() => allExportPresets(userPresets()));
  const preset = createMemo(() => applyExportPresetOverride(
    presets().find((candidate) => candidate.id === selectedPresetId()) ?? FACTORY_EXPORT_PRESETS[0],
    presetOverrides(),
  ));
  const editablePreset = createMemo(() => Boolean(preset().userCreated));
  const options = createMemo(() => normalizeExportOptions(preset().options));
  const rangeReady = createMemo(() => loopRange().endBeat > loopRange().startBeat);
  const trackReady = createMemo(() => selectedTrackIds().length === 1);
  const renderableStemCount = createMemo(() => tracks().filter((track) => track.kind !== "group").length);
  const defaultExportFolder = createMemo(() => recentExportFolder(recentDestinations()));
  const canExport = createMemo(() => {
    const target = preset().target;
    if (validation().state === "checking" || exportValidationBlocksExport(validation())) return false;
    if (target === "range") return rangeReady();
    if (target === "track") return trackReady();
    if (target === "stems") return renderableStemCount() > 0;
    return true;
  });
  const readinessLabel = createMemo(() => {
    const target = preset().target;
    if (target === "range" && !rangeReady()) return "Set a review loop range before exporting.";
    if (target === "track" && !trackReady()) return "Select exactly one track before exporting a stem.";
    if (target === "stems" && renderableStemCount() === 0) return "Add at least one renderable track before exporting all stems.";
    return "Ready to export.";
  });

  function close() {
    useUiStore.getState().closeEditor({ kind: "exportReview" });
  }

  async function exportSelected() {
    try {
      await runProjectExport(preset().target);
    } catch (error) {
      await appAlert(error instanceof Error ? error.message : "Export failed.");
    }
  }

  async function revealDestination(path: string) {
    try {
      await revealExportDestination(path);
    } catch (error) {
      await appAlert(error instanceof Error ? error.message : "View in Folder failed.");
    }
  }

  async function savePresetAs() {
    const name = await appPrompt("Export preset name", preset().userCreated ? preset().name : `${preset().name} Custom`, "Save Export Preset");
    if (!name?.trim()) return;
    useExportStore.getState().saveUserPreset(name, preset());
  }

  function deletePreset() {
    if (!preset().userCreated) return;
    useExportStore.getState().deleteUserPreset(preset().id);
  }

  function updatePresetOptions(patch: Partial<ReturnType<typeof normalizeExportOptions>>) {
    useExportStore.getState().updatePresetRenderSettings(preset().id, {
      options: { ...options(), ...patch },
    });
  }

  async function chooseDestinationFolder() {
    if (!isNative()) {
      await appAlert("Export folder selection is available in the native app.");
      return;
    }
    try {
      const result = await send({
        kind: "project.chooseExportFolder",
        pathHint: exportDestinationFolder() || defaultExportFolder() || undefined,
      });
      if (result.error) throw new Error(result.error);
      if (result.path?.trim()) useExportStore.getState().setExportDestinationFolder(result.path);
    } catch (error) {
      await appAlert(error instanceof Error ? error.message : "Could not choose export folder.");
    }
  }

  return (
    <Modal
      open
      scopeId="export-review"
      title={<><Icon name="ph:export" size={18} decorative />Export Review</>}
      width="md"
      onClose={close}
      footer={(
        <>
          <Button onClick={close}>Close</Button>
          <Button variant="primary" disabled={!canExport()} onClick={() => void exportSelected()}>Export</Button>
        </>
      )}
    >
      <div class={styles.panel}>
        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <h3>Export Mode</h3>
            <div class={styles.headerActions}>
              <Button size="sm" onClick={() => void savePresetAs()}>Save As</Button>
              <Show when={editablePreset()}>
                <Button size="sm" onClick={deletePreset}>Delete</Button>
              </Show>
            </div>
          </div>
          <div class={styles.presetGrid}>
            <For each={presets()}>
              {(candidate) => (
                <Button
                  variant="ghost"
                  selected={candidate.id === selectedPresetId()}
                  class={styles.presetButton}
                  onClick={() => useExportStore.getState().setSelectedPresetId(candidate.id)}
                >
                  <Icon name={iconForTarget(candidate.target)} size={18} decorative />
                  <strong>{candidate.name}</strong>
                  <span>{candidate.description}</span>
                </Button>
              )}
            </For>
          </div>
        </section>

        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <h3>Render Settings</h3>
          </div>
          <div class={styles.controls}>
            <FloatingSelect
              label="Sample Rate"
              value={String(options().sampleRate)}
              layout="inline"
              options={[44100, 48000, 88200, 96000].map((value) => ({ value: String(value), label: `${value} Hz` }))}
              onChange={(value) => updatePresetOptions({ sampleRate: Number(value) })}
            />
            <FloatingSelect
              label="Bit Depth"
              value={String(options().bitDepth)}
              layout="inline"
              options={[16, 24, 32].map((value) => ({ value: String(value), label: `${value}-bit PCM` }))}
              onChange={(value) => updatePresetOptions({ bitDepth: Number(value) as 16 | 24 | 32 })}
            />
            <FloatingSelect
              label="Channels"
              value={String(options().channels)}
              layout="inline"
              options={[{ value: "1", label: "Mono" }, { value: "2", label: "Stereo" }]}
              onChange={(value) => updatePresetOptions({ channels: Number(value) as 1 | 2 })}
            />
            <FloatingSelect
              label="Block"
              value={String(options().blockSize)}
              layout="inline"
              options={[128, 256, 512, 1024, 2048].map((value) => ({ value: String(value), label: `${value} samples` }))}
              onChange={(value) => updatePresetOptions({ blockSize: Number(value) })}
            />
          </div>
          <div class={styles.tailControl}>
            <Toggle
              checked={preset().includeTail}
              onChange={(includeTail) => useExportStore.getState().updatePresetRenderSettings(preset().id, { includeTail })}
              label="Include effect tail"
            />
          </div>
        </section>

        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <h3>Export Destination</h3>
            <Button size="sm" onClick={() => void chooseDestinationFolder()}>
              <Icon name="ph:folder-open" size={18} decorative />
              Choose Folder
            </Button>
          </div>
          <StateBanner
            icon="ph:folder-open"
            title={exportDestinationFolder() ? "Selected folder" : "No export folder selected"}
            body={exportDestinationFolder() || "Export will ask for a destination."}
          />
        </section>

        <StateBanner
          icon={canExport() ? "ph:check-circle" : "ph:warning-circle"}
          title={readinessLabel()}
          body={exportContextLabel(preset(), currentFilePath(), loopRange(), selectedTrackIds(), renderableStemCount())}
        />

        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <h3>Project Health</h3>
            <Button className={styles.outlineButton} size="sm" onClick={() => useExportStore.getState().setValidateBeforeExport(!validateBeforeExport())}>
              {validateBeforeExport() ? "Validate on" : "Validate off"}
            </Button>
          </div>
          <StateBanner
            icon={validationIcon(validation())}
            title={validationTitle(validation(), validateBeforeExport())}
            body={validationBody(validation(), validateBeforeExport())}
          />
        </section>

        <Show when={job()?.analysis}>
          {(analysis) => (
            <section class={styles.section}>
              <div class={styles.sectionHeader}>
                <h3>Post-Export Analysis</h3>
                <span>{job()?.ok ? "Passed" : "Review"}</span>
              </div>
              <div class={styles.analysisGrid}>
                <Metric label="Duration" value={formatDuration(analysis().durationSeconds)} />
                <Metric label="Format" value={`${analysis().sampleRate} Hz / ${analysis().bitDepth ?? options().bitDepth}-bit / ${analysis().channelCount} ch`} />
                <Metric label="Peak" value={formatPeak(maxPeakDb(analysis().leftPeakDbFS, analysis().rightPeakDbFS))} />
                <Metric label="True Peak" value={formatPeak(analysis().truePeakDbTP)} />
                <Metric label="RMS" value={formatPeak(analysis().rmsDbFS)} />
                <Metric label="LUFS" value={formatPeak(analysis().integratedLufs)} />
                <Metric label="Clipping" value={formatCount(analysis().clippingCount)} />
                <Metric label="DC Offset" value={formatRatio(analysis().dcOffset)} />
                <Metric label="Correlation" value={formatRatio(analysis().stereoCorrelation)} />
              </div>
              <Show when={job()?.path}>
                <StateBanner icon="ph:waveform" title="Rendered file" body={job()?.path ?? ""} />
              </Show>
            </section>
          )}
        </Show>

        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <h3>Recent Destinations</h3>
            <Show
              when={recentDestinations().length > 0}
              fallback={<span>None yet</span>}
            >
              <Button size="sm" onClick={() => useExportStore.getState().clearRecentDestinations()}>Clear</Button>
            </Show>
          </div>
          <Show
            when={recentDestinations().length > 0}
            fallback={<StateBanner icon="ph:folder-open" title="No export destination history yet." body="Completed exports will appear here for review." />}
          >
            <div class={styles.pathList}>
              <For each={recentDestinations().slice(0, 4)}>
                {(path) => (
                  <div class={styles.pathRow}>
                    <div class={styles.pathText}>
                      <span class={styles.label}>Destination</span>
                      <strong title={path}>{path}</strong>
                    </div>
                    <div class={styles.pathActions}>
                      <Button size="sm" onClick={() => void revealDestination(path)}>Reveal</Button>
                      <Button size="sm" onClick={() => useExportStore.getState().removeRecentDestination(path)}>Remove</Button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>
      </div>
    </Modal>
  );
}

function StateBanner(props: { icon: string; title: string; body?: string }) {
  return (
    <div class={styles.stateBanner}>
      <Icon name={props.icon} size={18} decorative />
      <div>
        <strong>{props.title}</strong>
        <Show when={props.body}><span>{props.body}</span></Show>
      </div>
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div class={styles.metric}>
      <span class={styles.label}>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function validationIcon(status: ExportValidationStatus): string {
  if (status.state === "blocked" || status.state === "failed") return "ph:warning-circle";
  if (status.state === "checking") return "ph:arrows-clockwise";
  if (status.state === "warning") return "ph:info";
  if (status.state === "passed") return "ph:check-circle";
  return "ph:shield-check";
}

function validationTitle(status: ExportValidationStatus, enabled: boolean): string {
  if (!enabled) return "Pre-export validation disabled.";
  if (status.state === "idle") return "Project Health will run before export.";
  return status.message;
}

function validationBody(status: ExportValidationStatus, enabled: boolean): string | undefined {
  if (!enabled) return "Export will skip the Project Health preflight for this session.";
  if (status.state === "idle") return "Errors and missing media will block export. Warnings will be shown but will not block.";
  if (status.state === "checking") return "Inspecting document integrity, media references, and export blockers.";
  if (status.checkedAt) {
    const details = `${status.errorCount} errors / ${status.warningCount} warnings / ${status.missingAssetCount} missing assets`;
    return `${details}. Checked ${new Date(status.checkedAt).toLocaleTimeString()}.`;
  }
  return undefined;
}

function iconForTarget(target: ExportPreset["target"]): string {
  if (target === "range") return "ph:arrows-in-line-horizontal";
  if (target === "track") return "ph:git-branch";
  if (target === "stems") return "ph:stack";
  return "ph:waveform";
}

function exportContextLabel(
  preset: ExportPreset,
  currentFilePath: string | null,
  range: { startBeat: number; endBeat: number },
  selectedTrackIds: string[],
  renderableStemCount: number,
): string {
  if (preset.target === "range") return `Range ${range.startBeat.toFixed(2)}-${range.endBeat.toFixed(2)} beats.`;
  if (preset.target === "track") return selectedTrackIds.length === 1 ? `Track ${selectedTrackIds[0]} selected.` : `${selectedTrackIds.length} tracks selected.`;
  if (preset.target === "stems") return `${renderableStemCount} renderable ${renderableStemCount === 1 ? "track" : "tracks"} will be exported as stems.`;
  return currentFilePath ? `Project file: ${currentFilePath}` : "Unsaved project; choose a destination during export.";
}

function formatPeak(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(1)} dB`;
}

function formatDuration(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (value < 60) return `${value.toFixed(2)} sec`;
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function formatCount(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return String(Math.max(0, Math.round(value)));
}

function formatRatio(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toFixed(3);
}

function maxPeakDb(left: number | undefined, right: number | undefined): number | undefined {
  if (typeof left === "number" && Number.isFinite(left) && typeof right === "number" && Number.isFinite(right)) return Math.max(left, right);
  if (typeof left === "number" && Number.isFinite(left)) return left;
  if (typeof right === "number" && Number.isFinite(right)) return right;
  return undefined;
}
