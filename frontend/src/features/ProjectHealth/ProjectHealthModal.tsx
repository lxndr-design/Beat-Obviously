import { useMemo, useState } from "react";
import { Button, Icon, Modal } from "../../components";
import { isNative, send } from "../../ipc/bridge";
import type { BeatProjectAsset, BeatProjectIntegrityIssue, ProjectSidecarCleanupReport } from "../../ipc/schema";
import {
  applyBeatDocument,
  buildCurrentBeatDocument,
  buildCurrentBeatDocumentFingerprint,
  replaceBeatDocumentAssetPath,
} from "../../persistence/beatDocument";
import { useDocumentStore, useUiStore } from "../../state/store";
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

export function ProjectHealthModal() {
  const closeEditor = useUiStore((s) => s.closeEditor);
  const currentFilePath = useDocumentStore((s) => s.currentFilePath);
  const missingAssets = useDocumentStore((s) => s.missingAssets);
  const integrityReport = useDocumentStore((s) => s.integrityReport);
  const cleanupReport = useDocumentStore((s) => s.cleanupReport);
  const lastBackupPath = useDocumentStore((s) => s.lastBackupPath);
  const [rescanning, setRescanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [relinkingPath, setRelinkingPath] = useState<string | null>(null);
  const [repairingAction, setRepairingAction] = useState<RepairAction | null>(null);
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const nativeAvailable = isNative();

  const categories = useMemo(
    () => buildTrustCategories(integrityReport?.issues ?? [], missingAssets, cleanupReport),
    [cleanupReport, integrityReport?.issues, missingAssets],
  );

  const categoriesWithFindings = useMemo(
    () => categories.filter((category) => categoryFindingCount(category) > 0),
    [categories],
  );

  const totalFindingCount = useMemo(
    () => categories.reduce((sum, category) => sum + categoryFindingCount(category), 0),
    [categories],
  );

  const health = useMemo(() => {
    const errors = integrityReport?.errorCount ?? 0;
    const warnings = integrityReport?.warningCount ?? 0;
    if (errors > 0) return { label: "Blocked", tone: "bad" as const };
    if (warnings > 0 || missingAssets.length > 0 || (cleanupReport?.failedFiles ?? 0) > 0) {
      return { label: "Needs Attention", tone: "warn" as const };
    }
    return { label: "Clean", tone: "good" as const };
  }, [cleanupReport?.failedFiles, integrityReport?.errorCount, integrityReport?.warningCount, missingAssets.length]);

  async function cleanAssets() {
    if (!currentFilePath || !nativeAvailable) return;
    setCleaning(true);
    setMessage(null);
    try {
      const result = await send({
        kind: "project.cleanupAssets",
        projectPath: currentFilePath,
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
        projectPath: currentFilePath ?? undefined,
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
      await applyBeatDocument(nextDocument, currentFilePath, { markSaved: false });
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
        projectPath: currentFilePath ?? undefined,
        document: buildCurrentBeatDocument(),
      });
      if (result.error) throw new Error(result.error);
      const documentStore = useDocumentStore.getState();
      documentStore.setMissingAssets(result.missingAssets ?? []);
      documentStore.setIntegrityReport(result.integrityReport ?? null);
      if (result.changed && result.document) {
        await applyBeatDocument(result.document, currentFilePath, { markSaved: false });
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
    closeEditor({ kind: "projectHealth" });
  }

  return (
    <Modal
      open
      scopeId="project-health"
      title={<><Icon name="ph:shield-check" size={14} decorative />Project Health</>}
      headerActions={<Button size="sm" disabled={rescanning} onClick={() => void rescanHealth()}>{rescanning ? "Scanning" : "Rescan"}</Button>}
      width="md"
      onClose={close}
      footer={<Button variant="primary" onClick={close}>Close</Button>}
    >
      <div className={styles.panel}>
        <section className={styles.summary}>
          <div>
            <span className={styles.label}>Status</span>
            <strong className={styles[`tone-${health.tone}`]}>{health.label}</strong>
          </div>
          <div>
            <span className={styles.label}>Findings</span>
            <strong>{integrityReport ? `${totalFindingCount} active` : "Not checked"}</strong>
          </div>
          <div>
            <span className={styles.label}>File</span>
            <strong title={currentFilePath ?? undefined}>{currentFilePath ? fileName(currentFilePath) : "Unsaved"}</strong>
          </div>
          <div>
            <span className={styles.label}>Backup</span>
            <strong title={lastBackupPath ?? undefined}>{lastBackupPath ? fileName(lastBackupPath) : "None this session"}</strong>
          </div>
        </section>

        {message && (
          <StateBanner
            tone={message.tone}
            icon={message.tone === "error" ? "ph:warning-circle" : message.tone === "good" ? "ph:check-circle" : "ph:info"}
            title={message.title}
            body={message.body}
          />
        )}

        {rescanning && (
          <StateBanner
            tone="info"
            icon="ph:arrows-clockwise"
            title="Scanning project health."
            body="Beat is refreshing the manifest, media, sidecar, and timeline integrity report."
          />
        )}

        {!rescanning && !integrityReport && (
          <StateBanner
            tone="info"
            icon="ph:magnifying-glass"
            title="No health scan loaded."
            body={nativeAvailable ? "Run Rescan to classify the current project." : "Native project scanning is unavailable in this browser session."}
          />
        )}

        {!rescanning && integrityReport && totalFindingCount === 0 && (
          <StateBanner
            tone="good"
            icon="ph:shield-check"
            title="No active project health findings."
            body="The current report has no integrity issues, missing assets, or sidecar cleanup failures."
          />
        )}

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3>DAW Trust Categories</h3>
            <span>{integrityReport ? `${integrityReport.errorCount} errors / ${integrityReport.warningCount} warnings` : "Awaiting scan"}</span>
          </div>
          <div className={styles.categoryOverview}>
            {categories.map((category) => {
              const tone = categoryTone(category);
              const count = categoryFindingCount(category);
              return (
                <div key={category.id} className={`${styles.categoryTile} ${styles[`categoryTone-${tone}`]}`}>
                  <Icon name={category.icon} size={14} decorative />
                  <span>{category.title}</span>
                  <strong>{count > 0 ? count : "Clear"}</strong>
                </div>
              );
            })}
          </div>
        </section>

        {categoriesWithFindings.length > 0 && (
          <div className={styles.categoryList}>
            {categoriesWithFindings.map((category) => (
              <CategorySection
                key={category.id}
                category={category}
                currentFilePath={currentFilePath}
                nativeAvailable={nativeAvailable}
                cleaning={cleaning}
                repairingAction={repairingAction}
                relinkingPath={relinkingPath}
                onCleanAssets={() => void cleanAssets()}
                onRepair={(action) => void repairDocument(action)}
                onRelink={(asset) => void relinkAsset(asset)}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function StateBanner({ tone, icon, title, body }: { tone: MessageTone; icon: string; title: string; body?: string }) {
  return (
    <div className={`${styles.stateBanner} ${styles[`message-${tone}`]}`}>
      <Icon name={icon} size={16} decorative />
      <div>
        <strong>{title}</strong>
        {body && <span>{body}</span>}
      </div>
    </div>
  );
}

function CategorySection({
  category,
  currentFilePath,
  nativeAvailable,
  cleaning,
  repairingAction,
  relinkingPath,
  onCleanAssets,
  onRepair,
  onRelink,
}: {
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
  const count = categoryFindingCount(category);
  const tone = categoryTone(category);
  const manifestRepairAvailable = category.id === "missing-media" && hasManifestRepairTarget(category);
  const trackIdRepairAvailable = category.id === "stale-ids" && category.issues.some((issue) => issue.code === "segment.trackId.mismatch");
  const sidecarCleanAvailable = category.id === "sidecars" && category.issues.some((issue) => issue.code === "asset.sidecar.orphan");

  return (
    <section className={styles.categorySection}>
      <div className={styles.categoryHeader}>
        <div className={styles.categoryTitle}>
          <Icon name={category.icon} size={16} decorative />
          <div>
            <h3>{category.title}</h3>
            <p>{category.detail}</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles[`categoryTone-${tone}`]}>{formatFindings(count)}</span>
          {manifestRepairAvailable && (
            <RepairButton
              action="rebuildAssetManifest"
              nativeAvailable={nativeAvailable}
              repairingAction={repairingAction}
              onRepair={onRepair}
            />
          )}
          {trackIdRepairAvailable && (
            <RepairButton
              action="repairSegmentTrackIds"
              nativeAvailable={nativeAvailable}
              repairingAction={repairingAction}
              onRepair={onRepair}
            />
          )}
          {sidecarCleanAvailable && (
            <Button
              size="sm"
              disabled={!currentFilePath || !nativeAvailable || cleaning}
              onClick={onCleanAssets}
            >
              {cleaning ? "Cleaning" : `Clean ${category.issues.length}`}
            </Button>
          )}
        </div>
      </div>

      {category.id === "sidecars" && (
        <div className={styles.stats}>
          <div><span>Detected</span><strong>{category.issues.length}</strong></div>
          <div><span>Deleted</span><strong>{category.cleanupRows.filter((row) => row.status === "Deleted").length}</strong></div>
          <div><span>Failed</span><strong>{category.cleanupRows.filter((row) => row.status === "Failed").length}</strong></div>
        </div>
      )}

      {category.issues.length > 0 && (
        <div className={styles.issueList}>
          {category.issues.map((issue, index) => (
            <IssueRow key={`${issue.code}-${issue.path ?? ""}-${index}`} issue={issue} />
          ))}
        </div>
      )}

      {category.assets.length > 0 && (
        <div className={styles.issueList}>
          {category.assets.map((asset) => (
            <div key={`${asset.kind}:${asset.path}`} className={styles.assetRow}>
              <span>{asset.kind}</span>
              <strong title={asset.path}>{asset.name || fileName(asset.path)}</strong>
              <small title={asset.path}>{asset.path}</small>
              <Button
                size="sm"
                disabled={relinkingPath === asset.path || !nativeAvailable}
                onClick={() => onRelink(asset)}
              >
                {relinkingPath === asset.path ? "Relinking" : "Relink"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {category.cleanupRows.length > 0 && (
        <div className={styles.issueList}>
          {category.cleanupRows.map((row) => (
            <CleanupPathRow key={`${row.status}-${row.path}`} status={row.status} path={row.path} />
          ))}
        </div>
      )}

      {category.id === "sidecars" && !currentFilePath && (
        <div className={styles.emptyRow}>Save the project to disk before cleaning sidecar assets.</div>
      )}
    </section>
  );
}

function RepairButton({
  action,
  nativeAvailable,
  repairingAction,
  onRepair,
}: {
  action: RepairAction;
  nativeAvailable: boolean;
  repairingAction: RepairAction | null;
  onRepair: (action: RepairAction) => void;
}) {
  const label = REPAIR_LABELS[action];
  return (
    <Button
      size="sm"
      disabled={!nativeAvailable || repairingAction !== null}
      onClick={() => onRepair(action)}
    >
      {repairingAction === action ? label.busy : label.idle}
    </Button>
  );
}

function CleanupPathRow({ status, path }: { status: string; path: string }) {
  return (
    <div className={styles.cleanupPathRow}>
      <span>{status}</span>
      <strong title={path}>{fileName(path)}</strong>
      <small title={path}>{path}</small>
    </div>
  );
}

function IssueRow({ issue }: { issue: BeatProjectIntegrityIssue }) {
  return (
    <div className={styles.issueRow}>
      <span className={styles.severity}>{issue.severity}</span>
      <strong>{issue.code}</strong>
      <span>{issue.message}</span>
      <small title={issue.path ?? undefined}>{issue.path || "-"}</small>
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
