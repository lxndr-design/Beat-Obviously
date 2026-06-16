/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";
import { Button, Icon, Modal } from "../../solid-ui";
import { isNative, send } from "../../ipc/bridge";
import type { BeatProjectAsset, BeatProjectIntegrityIssue, ProjectSidecarCleanupReport } from "../../ipc/schema";
import {
  applyBeatDocument,
  buildCurrentBeatDocument,
  buildCurrentBeatDocumentFingerprint,
  replaceBeatDocumentAssetPath,
} from "../../persistence/beatDocument";
import { useDocumentStore, useUiStore } from "../../state/store";
import { createStoreSelector } from "../../solid-utils/store";
import styles from "./ProjectHealthModal.module.css";

type RepairAction = "rebuildAssetManifest" | "repairSegmentTrackIds";
type MessageTone = "info" | "good" | "error";
type CategoryTone = "good" | "warn" | "bad";
type TrustCategoryId =
  | "fatal-structure"
  | "missing-media"
  | "sidecars"
  | "stale-ids"
  | "recording-input"
  | "export-warnings";

interface StatusMessage {
  tone: MessageTone;
  title: string;
  body?: string;
}

interface TrustCategoryDefinition {
  id: TrustCategoryId;
  title: string;
  detail: string;
  icon: string;
}

interface CleanupPath {
  status: string;
  path: string;
}

interface TrustCategory extends TrustCategoryDefinition {
  issues: BeatProjectIntegrityIssue[];
  assets: BeatProjectAsset[];
  cleanupRows: CleanupPath[];
}

const TRUST_CATEGORIES: TrustCategoryDefinition[] = [
  {
    id: "fatal-structure",
    title: "Fatal Structure",
    detail: "Document shape, schema, track graph, and timeline values that affect hydration.",
    icon: "ph:warning-diamond",
  },
  {
    id: "missing-media",
    title: "Missing Media",
    detail: "Audio, sample, plugin, and instrument references needed for playback.",
    icon: "ph:file-audio",
  },
  {
    id: "sidecars",
    title: "Sidecars",
    detail: "Copied project assets and unused sidecar files next to the .beat document.",
    icon: "ph:archive",
  },
  {
    id: "stale-ids",
    title: "Stale IDs",
    detail: "Duplicate ids, empty ids, segment ownership drift, and group routing references.",
    icon: "ph:git-branch",
  },
  {
    id: "recording-input",
    title: "Recording Input",
    detail: "Input channel, monitoring, and latency calibration metadata.",
    icon: "ph:microphone",
  },
  {
    id: "export-warnings",
    title: "Export Warnings",
    detail: "Audio timing, source trim, fades, and metadata that can affect renders.",
    icon: "ph:waveform",
  },
];

const REPAIR_LABELS: Record<RepairAction, { idle: string; busy: string; complete: string }> = {
  rebuildAssetManifest: {
    idle: "Rebuild Manifest",
    busy: "Rebuilding",
    complete: "Asset manifest repair finished.",
  },
  repairSegmentTrackIds: {
    idle: "Repair Track IDs",
    busy: "Repairing",
    complete: "Segment track ID repair finished.",
  },
};

export interface MountedProjectHealthModalSolid {
  dispose: () => void;
}

export function mountProjectHealthModalSolid(host: HTMLElement): MountedProjectHealthModalSolid {
  const dispose = render(() => <ProjectHealthModalSolid />, host);
  return { dispose };
}

export function ProjectHealthModalSolid() {
  const currentFilePath = createStoreSelector(useDocumentStore, (s) => s.currentFilePath);
  const missingAssets = createStoreSelector(useDocumentStore, (s) => s.missingAssets);
  const integrityReport = createStoreSelector(useDocumentStore, (s) => s.integrityReport);
  const cleanupReport = createStoreSelector(useDocumentStore, (s) => s.cleanupReport);
  const lastBackupPath = createStoreSelector(useDocumentStore, (s) => s.lastBackupPath);
  const [rescanning, setRescanning] = createSignal(false);
  const [cleaning, setCleaning] = createSignal(false);
  const [relinkingPath, setRelinkingPath] = createSignal<string | null>(null);
  const [repairingAction, setRepairingAction] = createSignal<RepairAction | null>(null);
  const [message, setMessage] = createSignal<StatusMessage | null>(null);
  const nativeAvailable = isNative();

  const categories = createMemo(() => buildTrustCategories(integrityReport()?.issues ?? [], missingAssets(), cleanupReport()));
  const categoriesWithFindings = createMemo(() => categories().filter((category) => categoryFindingCount(category) > 0));
  const totalFindingCount = createMemo(() => categories().reduce((sum, category) => sum + categoryFindingCount(category), 0));
  const health = createMemo(() => {
    const errors = integrityReport()?.errorCount ?? 0;
    const warnings = integrityReport()?.warningCount ?? 0;
    if (errors > 0) return { label: "Blocked", tone: "bad" as const };
    if (warnings > 0 || missingAssets().length > 0 || (cleanupReport()?.failedFiles ?? 0) > 0) {
      return { label: "Needs Attention", tone: "warn" as const };
    }
    return { label: "Clean", tone: "good" as const };
  });

  async function cleanAssets() {
    if (!currentFilePath() || !nativeAvailable) return;
    setCleaning(true);
    setMessage(null);
    try {
      const result = await send({
        kind: "project.cleanupAssets",
        projectPath: currentFilePath()!,
        document: buildCurrentBeatDocument(),
      });
      if (result.error) throw new Error(result.error);
      useDocumentStore.getState().setCleanupReport(result.report);
      await rescanHealth({ throwOnError: true });
      setMessage({
        tone: result.report.failedFiles > 0 ? "error" : "good",
        title: result.report.failedFiles > 0 ? "Sidecar cleanup finished with failures." : "Sidecar cleanup finished.",
        body: `${result.report.deletedFiles} deleted / ${result.report.failedFiles} failed`,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        title: "Asset cleanup failed.",
        body: errorMessage(error),
      });
    } finally {
      setCleaning(false);
    }
  }

  async function rescanHealth(options: { throwOnError?: boolean } = {}) {
    setRescanning(true);
    setMessage(null);
    try {
      const result = await send({
        kind: "project.inspectDocument",
        projectPath: currentFilePath() ?? undefined,
        document: buildCurrentBeatDocument(),
      });
      if (result.error) throw new Error(result.error);
      const documentStore = useDocumentStore.getState();
      documentStore.setMissingAssets(result.missingAssets ?? []);
      documentStore.setIntegrityReport(result.integrityReport ?? null);
    } catch (error) {
      setMessage({
        tone: "error",
        title: "Project health scan failed.",
        body: errorMessage(error),
      });
      if (options.throwOnError) throw error;
    } finally {
      setRescanning(false);
    }
  }

  async function relinkAsset(asset: BeatProjectAsset) {
    if (!nativeAvailable) {
      setMessage({
        tone: "error",
        title: "Asset relinking is only available in the native app.",
      });
      return;
    }
    setRelinkingPath(asset.path);
    setMessage(null);
    try {
      const result = await send({
        kind: "project.relinkAsset",
        asset: {
          kind: asset.kind,
          name: asset.name,
          path: asset.path,
        },
        pathHint: asset.path,
      });
      if (result.error) throw new Error(result.error);
      if (!result.path) return;

      const nextDocument = replaceBeatDocumentAssetPath(buildCurrentBeatDocument(), asset.path, result.path);
      await applyBeatDocument(nextDocument, currentFilePath(), { markSaved: false });
      useDocumentStore.getState().markDirty(buildCurrentBeatDocumentFingerprint());
      await rescanHealth();
      setMessage({
        tone: "good",
        title: "Asset relinked.",
        body: `${fileName(asset.path)} -> ${fileName(result.path)}`,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        title: "Asset relink failed.",
        body: errorMessage(error),
      });
    } finally {
      setRelinkingPath(null);
    }
  }

  async function repairDocument(action: RepairAction) {
    if (!nativeAvailable) {
      setMessage({
        tone: "error",
        title: "Project repair is only available in the native app.",
      });
      return;
    }
    setRepairingAction(action);
    setMessage(null);
    try {
      const result = await send({
        kind: "project.repairDocument",
        action,
        projectPath: currentFilePath() ?? undefined,
        document: buildCurrentBeatDocument(),
      });
      if (result.error) throw new Error(result.error);
      const documentStore = useDocumentStore.getState();
      documentStore.setMissingAssets(result.missingAssets ?? []);
      documentStore.setIntegrityReport(result.integrityReport ?? null);
      if (result.changed && result.document) {
        await applyBeatDocument(result.document, currentFilePath(), { markSaved: false });
        documentStore.markDirty(buildCurrentBeatDocumentFingerprint());
      }
      setMessage({
        tone: "good",
        title: REPAIR_LABELS[action].complete,
        body: result.changed ? "The project document was updated and marked unsaved." : "No document changes were needed.",
      });
    } catch (error) {
      setMessage({
        tone: "error",
        title: "Project repair failed.",
        body: errorMessage(error),
      });
    } finally {
      setRepairingAction(null);
    }
  }

  function close() {
    useUiStore.getState().closeEditor({ kind: "projectHealth" });
  }

  return (
    <Modal
      open
      scopeId="project-health"
      title={<><Icon name="ph:shield-check" size={14} decorative />Project Health</>}
      headerActions={<Button size="sm" disabled={rescanning()} onClick={() => void rescanHealth()}>{rescanning() ? "Scanning" : "Rescan"}</Button>}
      width="md"
      onClose={close}
      footer={<Button variant="primary" onClick={close}>Close</Button>}
    >
      <div class={styles.panel}>
        <section class={styles.summary}>
          <div>
            <span class={styles.label}>Status</span>
            <strong class={styles[`tone-${health().tone}`]}>{health().label}</strong>
          </div>
          <div>
            <span class={styles.label}>Findings</span>
            <strong>{integrityReport() ? `${totalFindingCount()} active` : "Not checked"}</strong>
          </div>
          <div>
            <span class={styles.label}>File</span>
            <strong title={currentFilePath() ?? undefined}>{currentFilePath() ? fileName(currentFilePath()!) : "Unsaved"}</strong>
          </div>
          <div>
            <span class={styles.label}>Backup</span>
            <strong title={lastBackupPath() ?? undefined}>{lastBackupPath() ? fileName(lastBackupPath()!) : "None this session"}</strong>
          </div>
        </section>

        <Show when={message()}>
          {(currentMessage) => (
            <StateBanner
              tone={currentMessage().tone}
              icon={currentMessage().tone === "error" ? "ph:warning-circle" : currentMessage().tone === "good" ? "ph:check-circle" : "ph:info"}
              title={currentMessage().title}
              body={currentMessage().body}
            />
          )}
        </Show>

        <Show when={rescanning()}>
          <StateBanner
            tone="info"
            icon="ph:arrows-clockwise"
            title="Scanning project health."
            body="Beat is refreshing the manifest, media, sidecar, and timeline integrity report."
          />
        </Show>

        <Show when={!rescanning() && !integrityReport()}>
          <StateBanner
            tone="info"
            icon="ph:magnifying-glass"
            title="No health scan loaded."
            body={nativeAvailable ? "Run Rescan to classify the current project." : "Native project scanning is unavailable in this browser session."}
          />
        </Show>

        <Show when={!rescanning() && integrityReport() && totalFindingCount() === 0}>
          <StateBanner
            tone="good"
            icon="ph:shield-check"
            title="No active project health findings."
            body="The current report has no integrity issues, missing assets, or sidecar cleanup failures."
          />
        </Show>

        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <h3>DAW Trust Categories</h3>
            <span>{integrityReport() ? `${integrityReport()!.errorCount} errors / ${integrityReport()!.warningCount} warnings` : "Awaiting scan"}</span>
          </div>
          <div class={styles.categoryOverview}>
            <For each={categories()}>
              {(category) => {
                const tone = () => categoryTone(category);
                const count = () => categoryFindingCount(category);
                return (
                  <div class={`${styles.categoryTile} ${styles[`categoryTone-${tone()}`]}`}>
                    <Icon name={category.icon} size={14} decorative />
                    <span>{category.title}</span>
                    <strong>{count() > 0 ? count() : "Clear"}</strong>
                  </div>
                );
              }}
            </For>
          </div>
        </section>

        <Show when={categoriesWithFindings().length > 0}>
          <div class={styles.categoryList}>
            <For each={categoriesWithFindings()}>
              {(category) => (
                <CategorySection
                  category={category}
                  currentFilePath={currentFilePath()}
                  nativeAvailable={nativeAvailable}
                  cleaning={cleaning()}
                  repairingAction={repairingAction()}
                  relinkingPath={relinkingPath()}
                  onCleanAssets={() => void cleanAssets()}
                  onRepair={(action) => void repairDocument(action)}
                  onRelink={(asset) => void relinkAsset(asset)}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </Modal>
  );
}

function StateBanner(props: { tone: MessageTone; icon: string; title: string; body?: string }) {
  return (
    <div class={`${styles.stateBanner} ${styles[`message-${props.tone}`]}`}>
      <Icon name={props.icon} size={16} decorative />
      <div>
        <strong>{props.title}</strong>
        <Show when={props.body}><span>{props.body}</span></Show>
      </div>
    </div>
  );
}

function CategorySection(props: {
  category: TrustCategory;
  currentFilePath: string | null;
  nativeAvailable: boolean;
  cleaning: boolean;
  repairingAction: RepairAction | null;
  relinkingPath: string | null;
  onCleanAssets: () => void;
  onRepair: (action: RepairAction) => void;
  onRelink: (asset: BeatProjectAsset) => void;
}) {
  const count = () => categoryFindingCount(props.category);
  const tone = () => categoryTone(props.category);
  const manifestRepairAvailable = () => props.category.id === "missing-media" && hasManifestRepairTarget(props.category);
  const trackIdRepairAvailable = () => props.category.id === "stale-ids" && props.category.issues.some((issue) => issue.code === "segment.trackId.mismatch");
  const sidecarCleanAvailable = () => props.category.id === "sidecars" && props.category.issues.some((issue) => issue.code === "asset.sidecar.orphan");

  return (
    <section class={styles.categorySection}>
      <div class={styles.categoryHeader}>
        <div class={styles.categoryTitle}>
          <Icon name={props.category.icon} size={16} decorative />
          <div>
            <h3>{props.category.title}</h3>
            <p>{props.category.detail}</p>
          </div>
        </div>
        <div class={styles.headerActions}>
          <span class={styles[`categoryTone-${tone()}`]}>{formatFindings(count())}</span>
          <Show when={manifestRepairAvailable()}>
            <RepairButton
              action="rebuildAssetManifest"
              nativeAvailable={props.nativeAvailable}
              repairingAction={props.repairingAction}
              onRepair={props.onRepair}
            />
          </Show>
          <Show when={trackIdRepairAvailable()}>
            <RepairButton
              action="repairSegmentTrackIds"
              nativeAvailable={props.nativeAvailable}
              repairingAction={props.repairingAction}
              onRepair={props.onRepair}
            />
          </Show>
          <Show when={sidecarCleanAvailable()}>
            <Button
              size="sm"
              disabled={!props.currentFilePath || !props.nativeAvailable || props.cleaning}
              onClick={props.onCleanAssets}
            >
              {props.cleaning ? "Cleaning" : `Clean ${props.category.issues.length}`}
            </Button>
          </Show>
        </div>
      </div>

      <Show when={props.category.id === "sidecars"}>
        <div class={styles.stats}>
          <div><span>Detected</span><strong>{props.category.issues.length}</strong></div>
          <div><span>Deleted</span><strong>{props.category.cleanupRows.filter((row) => row.status === "Deleted").length}</strong></div>
          <div><span>Failed</span><strong>{props.category.cleanupRows.filter((row) => row.status === "Failed").length}</strong></div>
        </div>
      </Show>

      <Show when={props.category.issues.length > 0}>
        <div class={styles.issueList}>
          <For each={props.category.issues}>
            {(issue) => <IssueRow issue={issue} />}
          </For>
        </div>
      </Show>

      <Show when={props.category.assets.length > 0}>
        <div class={styles.issueList}>
          <For each={props.category.assets}>
            {(asset) => (
              <div class={styles.assetRow}>
                <span>{asset.kind}</span>
                <strong title={asset.path}>{asset.name || fileName(asset.path)}</strong>
                <small title={asset.path}>{asset.path}</small>
                <Button
                  size="sm"
                  disabled={props.relinkingPath === asset.path || !props.nativeAvailable}
                  onClick={() => props.onRelink(asset)}
                >
                  {props.relinkingPath === asset.path ? "Relinking" : "Relink"}
                </Button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.category.cleanupRows.length > 0}>
        <div class={styles.issueList}>
          <For each={props.category.cleanupRows}>
            {(row) => <CleanupPathRow status={row.status} path={row.path} />}
          </For>
        </div>
      </Show>

      <Show when={props.category.id === "sidecars" && !props.currentFilePath}>
        <div class={styles.emptyRow}>Save the project to disk before cleaning sidecar assets.</div>
      </Show>
    </section>
  );
}

function RepairButton(props: {
  action: RepairAction;
  nativeAvailable: boolean;
  repairingAction: RepairAction | null;
  onRepair: (action: RepairAction) => void;
}) {
  const label = () => REPAIR_LABELS[props.action];
  return (
    <Button
      size="sm"
      disabled={!props.nativeAvailable || props.repairingAction !== null}
      onClick={() => props.onRepair(props.action)}
    >
      {props.repairingAction === props.action ? label().busy : label().idle}
    </Button>
  );
}

function CleanupPathRow(props: { status: string; path: string }) {
  return (
    <div class={styles.cleanupPathRow}>
      <span>{props.status}</span>
      <strong title={props.path}>{fileName(props.path)}</strong>
      <small title={props.path}>{props.path}</small>
    </div>
  );
}

function IssueRow(props: { issue: BeatProjectIntegrityIssue }) {
  return (
    <div class={styles.issueRow}>
      <span class={styles.severity}>{props.issue.severity}</span>
      <strong>{props.issue.code}</strong>
      <span>{props.issue.message}</span>
      <small title={props.issue.path ?? undefined}>{props.issue.path || "-"}</small>
    </div>
  );
}

function buildTrustCategories(
  issues: BeatProjectIntegrityIssue[],
  missingAssets: BeatProjectAsset[],
  cleanupReport: ProjectSidecarCleanupReport | null,
): TrustCategory[] {
  const categoryMap = new Map<TrustCategoryId, TrustCategory>(
    TRUST_CATEGORIES.map((definition) => [
      definition.id,
      { ...definition, issues: [], assets: [], cleanupRows: [] },
    ]),
  );

  for (const issue of issues) {
    categoryMap.get(classifyIssue(issue))?.issues.push(issue);
  }

  categoryMap.get("missing-media")?.assets.push(...missingAssets);
  categoryMap.get("sidecars")?.cleanupRows.push(
    ...(cleanupReport?.deletedPaths.map((path) => ({ status: "Deleted", path })) ?? []),
    ...(cleanupReport?.failedPaths.map((path) => ({ status: "Failed", path })) ?? []),
  );

  return TRUST_CATEGORIES.map((definition) => categoryMap.get(definition.id)).filter(Boolean) as TrustCategory[];
}

function classifyIssue(issue: BeatProjectIntegrityIssue): TrustCategoryId {
  const code = issue.code;

  if (code === "asset.sidecar.orphan") return "sidecars";
  if (code === "segment.trackId.mismatch" || code.includes(".id.") || code.startsWith("track.parent.")) return "stale-ids";
  if (code.startsWith("recording.") || code.startsWith("track.recording.") || code === "track.monitoring.unarmed") return "recording-input";
  if (
    code === "asset.missing"
    || code === "asset.path.empty"
    || code === "segment.audioFile.missing"
    || code.endsWith(".instrument.missing")
    || code.endsWith(".plugin.missing")
  ) {
    return "missing-media";
  }
  if (
    code.startsWith("audioFile.")
    || code.startsWith("segment.audio.")
    || code.startsWith("segment.fade.")
  ) {
    return "export-warnings";
  }

  return issue.severity === "error" ? "fatal-structure" : "export-warnings";
}

function categoryFindingCount(category: TrustCategory): number {
  return category.issues.length + category.assets.length + category.cleanupRows.filter((row) => row.status === "Failed").length;
}

function categoryTone(category: TrustCategory): CategoryTone {
  if (category.issues.some((issue) => issue.severity === "error")) return "bad";
  if (category.assets.length > 0 || category.issues.length > 0 || category.cleanupRows.some((row) => row.status === "Failed")) return "warn";
  return "good";
}

function hasManifestRepairTarget(category: TrustCategory): boolean {
  return category.assets.length > 0
    || category.issues.some((issue) => issue.code.startsWith("asset.") || issue.code.startsWith("assets."));
}

function formatFindings(count: number): string {
  return count === 1 ? "1 finding" : `${count} findings`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected project health error.";
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
