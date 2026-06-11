import { useMemo, useState } from "react";
import { Button, Icon, Modal } from "../../components";
import { isNative, send } from "../../ipc/bridge";
import type { BeatProjectAsset, BeatProjectIntegrityIssue } from "../../ipc/schema";
import {
  applyBeatDocument,
  buildCurrentBeatDocument,
  buildCurrentBeatDocumentFingerprint,
  replaceBeatDocumentAssetPath,
} from "../../persistence/beatDocument";
import { useDocumentStore, useUiStore } from "../../state/store";
import styles from "./ProjectHealthModal.module.css";

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
  const [repairing, setRepairing] = useState(false);

  const orphanSidecarIssues = useMemo(
    () => integrityReport?.issues.filter((issue) => issue.code === "asset.sidecar.orphan") ?? [],
    [integrityReport?.issues],
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
    if (!currentFilePath || !isNative()) return;
    setCleaning(true);
    try {
      const result = await send({
        kind: "project.cleanupAssets",
        projectPath: currentFilePath,
        document: buildCurrentBeatDocument(),
      });
      if (result.error) throw new Error(result.error);
      useDocumentStore.getState().setCleanupReport(result.report);
      await rescanHealth();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Asset cleanup failed.");
    } finally {
      setCleaning(false);
    }
  }

  async function rescanHealth() {
    setRescanning(true);
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
      window.alert(error instanceof Error ? error.message : "Project health scan failed.");
    } finally {
      setRescanning(false);
    }
  }

  async function relinkAsset(asset: BeatProjectAsset) {
    if (!isNative()) {
      window.alert("Asset relinking is only available in the native app.");
      return;
    }
    setRelinkingPath(asset.path);
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
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Asset relink failed.");
    } finally {
      setRelinkingPath(null);
    }
  }

  async function repairManifest() {
    if (!isNative()) {
      window.alert("Project repair is only available in the native app.");
      return;
    }
    setRepairing(true);
    try {
      const result = await send({
        kind: "project.repairDocument",
        action: "rebuildAssetManifest",
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
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Project repair failed.");
    } finally {
      setRepairing(false);
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
      headerActions={<Button size="sm" disabled={rescanning} onClick={rescanHealth}>{rescanning ? "Scanning" : "Rescan"}</Button>}
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
            <span className={styles.label}>File</span>
            <strong title={currentFilePath ?? undefined}>{currentFilePath ? fileName(currentFilePath) : "Unsaved"}</strong>
          </div>
          <div>
            <span className={styles.label}>Backup</span>
            <strong title={lastBackupPath ?? undefined}>{lastBackupPath ? fileName(lastBackupPath) : "None this session"}</strong>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3>Integrity</h3>
            <div className={styles.headerActions}>
              <span>{integrityReport ? `${integrityReport.errorCount} errors / ${integrityReport.warningCount} warnings` : "Not checked yet"}</span>
              <Button size="sm" disabled={!isNative() || repairing} onClick={repairManifest}>
                {repairing ? "Repairing" : "Repair Manifest"}
              </Button>
            </div>
          </div>
          {integrityReport?.issues.length ? (
            <div className={styles.issueList}>
              {integrityReport.issues.map((issue, index) => <IssueRow key={`${issue.code}-${issue.path ?? ""}-${index}`} issue={issue} />)}
            </div>
          ) : (
            <div className={styles.emptyRow}>No integrity issues reported.</div>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3>Missing Assets</h3>
            <span>{missingAssets.length}</span>
          </div>
          {missingAssets.length ? (
            <div className={styles.issueList}>
              {missingAssets.map((asset) => (
                <div key={`${asset.kind}:${asset.path}`} className={styles.assetRow}>
                  <span>{asset.kind}</span>
                  <strong title={asset.path}>{asset.name || fileName(asset.path)}</strong>
                  <small title={asset.path}>{asset.path}</small>
                  <Button
                    size="sm"
                    disabled={relinkingPath === asset.path || !isNative()}
                    onClick={() => void relinkAsset(asset)}
                  >
                    {relinkingPath === asset.path ? "Relinking" : "Relink"}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyRow}>No missing assets reported.</div>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3>Sidecar Cleanup</h3>
            <div className={styles.headerActions}>
              <span>{orphanSidecarIssues.length} copied orphans</span>
              <Button
                size="sm"
                disabled={!currentFilePath || !isNative() || cleaning || orphanSidecarIssues.length === 0}
                onClick={cleanAssets}
              >
                {cleaning ? "Cleaning" : orphanSidecarIssues.length > 0 ? `Clean ${orphanSidecarIssues.length}` : "Clean Assets"}
              </Button>
            </div>
          </div>
          <div className={styles.stats}>
            <div><span>Detected</span><strong>{orphanSidecarIssues.length}</strong></div>
            <div><span>Deleted</span><strong>{cleanupReport?.deletedFiles ?? 0}</strong></div>
            <div><span>Failed</span><strong>{cleanupReport?.failedFiles ?? 0}</strong></div>
          </div>
          {orphanSidecarIssues.length > 0 ? (
            <div className={styles.issueList}>
              {orphanSidecarIssues.map((issue, index) => (
                <CleanupPathRow
                  key={`${issue.path ?? issue.message}-${index}`}
                  status="Orphan"
                  path={issue.path ?? issue.message}
                />
              ))}
            </div>
          ) : currentFilePath ? (
            <div className={styles.emptyRow}>No copied sidecar orphans detected.</div>
          ) : null}
          {(cleanupReport?.deletedPaths.length ?? 0) > 0 && (
            <div className={styles.issueList}>
              {cleanupReport?.deletedPaths.map((path) => (
                <CleanupPathRow key={`deleted-${path}`} status="Deleted" path={path} />
              ))}
            </div>
          )}
          {(cleanupReport?.failedPaths.length ?? 0) > 0 && (
            <div className={styles.issueList}>
              {cleanupReport?.failedPaths.map((path) => (
                <CleanupPathRow key={`failed-${path}`} status="Failed" path={path} />
              ))}
            </div>
          )}
          {!currentFilePath && <div className={styles.emptyRow}>Save the project to disk before cleaning sidecar assets.</div>}
        </section>
      </div>
    </Modal>
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
      {issue.path && <small title={issue.path}>{issue.path}</small>}
    </div>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
