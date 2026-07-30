import { createMemo, createSignal, onMount, Show } from "solid-js";
import { appAlert, Button, FloatingSelect, Icon, Modal, Toggle } from "../../solid-ui";
import { isNative, send } from "../../ipc/bridge";
import { createStoreSelector } from "../../solid-utils/store";
import { useDocumentStore, useTransportStore, useUiStore } from "../../state/store";
import {
  exportPresetById,
  exportValidationBlocksExport,
  normalizeExportOptions,
  projectFolderFromFilePath,
  useExportStore,
  type ExportValidationStatus,
} from "../../state/exportStore";
import { runProjectExport } from "./exportActions";
import styles from "./ExportReviewModal.module.css";

export function ExportReviewModal() {
  const [useLoopRangeOnly, setUseLoopRangeOnly] = createSignal(useExportStore.getState().selectedPresetId === "review-range");
  const exportDestinationFolder = createStoreSelector(useExportStore, (state) => state.exportDestinationFolder);
  const job = createStoreSelector(useExportStore, (state) => state.job);
  const lastCompletedJob = createStoreSelector(useExportStore, (state) => state.lastCompletedJob);
  const validation = createStoreSelector(useExportStore, (state) => state.validation);
  const currentFilePath = createStoreSelector(useDocumentStore, (state) => state.currentFilePath);
  const loopRange = createStoreSelector(useTransportStore, (state) => state.loopRange);

  const preset = createMemo(() => useLoopRangeOnly()
    ? exportPresetById("review-range", "range")
    : exportPresetById("full-mix-review", "project"));
  const options = createMemo(() => normalizeExportOptions(preset().options));
  const rangeReady = createMemo(() => loopRange().endBeat > loopRange().startBeat);
  const projectExportFolder = createMemo(() => projectFolderFromFilePath(currentFilePath()));
  const showProjectHealth = createMemo(() => ["checking", "warning", "blocked", "failed"].includes(validation().state));
  const analysisJob = createMemo(() => {
    const current = job();
    if (current?.analysis) return current;
    return current?.active ? null : lastCompletedJob();
  });
  const canExport = createMemo(() => {
    if (job()?.active || validation().state === "checking") return false;
    return !useLoopRangeOnly() || rangeReady();
  });
  const readinessLabel = createMemo(() => {
    if (useLoopRangeOnly() && !rangeReady()) return "Set a loop range before exporting.";
    return "Ready to export.";
  });

  onMount(() => {
    const projectFolder = projectExportFolder();
    if (projectFolder) useExportStore.getState().setExportDestinationFolder(projectFolder);
  });

  function close() {
    useUiStore.getState().closeEditor({ kind: "exportReview" });
  }

  async function exportSelected() {
    try {
      await runProjectExport(useLoopRangeOnly() ? "range" : "project");
    } catch (error) {
      await appAlert(error instanceof Error ? error.message : "Export failed.");
    }
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
        pathHint: exportDestinationFolder() || projectExportFolder() || undefined,
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
          <Button variant="primary" disabled={!canExport()} onClick={() => void exportSelected()}>
            {job()?.active ? "Exporting..." : exportValidationBlocksExport(validation()) ? "Retry Export" : "Export"}
          </Button>
        </>
      )}
    >
      <div class={styles.panel}>
        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <h3>Export Contents</h3>
          </div>
          <div class={styles.scopeToggle}>
            <Toggle
              checked={useLoopRangeOnly()}
              onChange={(enabled) => {
                setUseLoopRangeOnly(enabled);
                useExportStore.getState().setSelectedPresetId(enabled ? "review-range" : "full-mix-review");
              }}
              label="Use loop range only"
            />
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
              options={[44100, 48000, 88200, 96000, 192000].map((value) => ({ value: String(value), label: `${value} Hz` }))}
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
            <FloatingSelect
              label="Quality"
              value={options().quality}
              layout="inline"
              options={[
                { value: "standard", label: "Standard" },
                { value: "high", label: "Offline HQ" },
              ]}
              onChange={(value) => updatePresetOptions({ quality: value === "high" ? "high" : "standard" })}
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
            body={exportDestinationFolder() || projectExportFolder() || "Save the project first, or choose an export folder."}
          />
        </section>

        <Show when={showProjectHealth()}>
          <section class={styles.section}>
            <div class={styles.sectionHeader}>
              <h3>Project Health</h3>
            </div>
            <StateBanner
              icon={validationIcon(validation())}
              title={validationTitle(validation())}
              body={validationBody(validation())}
            />
          </section>
        </Show>

        <Show when={analysisJob()?.analysis}>
          {(analysis) => (
            <section class={styles.section}>
              <div class={styles.sectionHeader}>
                <h3>{analysisJob() === job() ? "Post-Export Analysis" : "Last Successful Export Analysis"}</h3>
                <span>{analysisJob()?.ok ? "Passed" : "Review"}</span>
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
              <Show when={analysisJob()?.path}>
                <StateBanner icon="ph:waveform" title="Rendered file" body={analysisJob()?.path ?? ""} />
              </Show>
            </section>
          )}
        </Show>

        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <h3>Export Status</h3>
          </div>
          <StateBanner
            icon={exportStatusIcon(canExport(), validation())}
            title={exportStatusTitle(readinessLabel(), canExport(), validation())}
            body={exportStatusBody(useLoopRangeOnly(), currentFilePath(), loopRange(), validation())}
          />
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

function validationTitle(status: ExportValidationStatus): string {
  if (status.state === "idle") return "Project Health runs automatically before export.";
  return status.message;
}

function validationBody(status: ExportValidationStatus): string | undefined {
  if (status.state === "idle") return "Document errors and missing media block export; warnings are reported but do not block it.";
  if (status.state === "checking") return "Inspecting document integrity, media references, and export blockers.";
  if (status.checkedAt) {
    const details = `${status.errorCount} errors / ${status.warningCount} warnings / ${status.missingAssetCount} missing assets`;
    return `${details}. Checked ${new Date(status.checkedAt).toLocaleTimeString()}.`;
  }
  return undefined;
}

function exportStatusIcon(canExport: boolean, status: ExportValidationStatus): string {
  if (!canExport || exportValidationBlocksExport(status)) return "ph:warning-circle";
  if (status.state === "checking") return "ph:arrows-clockwise";
  return "ph:check-circle";
}

function exportStatusTitle(readiness: string, canExport: boolean, status: ExportValidationStatus): string {
  if (status.state === "checking") return "Checking project before export...";
  if (exportValidationBlocksExport(status)) return "Export blocked by Project Health.";
  if (!canExport) return readiness;
  if (status.state === "warning") return "Ready to export with warnings.";
  return "Ready to export.";
}

function exportStatusBody(
  useLoopRangeOnly: boolean,
  currentFilePath: string | null,
  range: { startBeat: number; endBeat: number },
  status: ExportValidationStatus,
): string {
  if (exportValidationBlocksExport(status)) return status.message;
  if (useLoopRangeOnly) return `Range ${range.startBeat.toFixed(2)}-${range.endBeat.toFixed(2)} beats.`;
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
