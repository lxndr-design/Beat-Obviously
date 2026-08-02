import { stopTimelineAudio } from "../audio/timelineAudio";
import { appAlert, appConfirm } from "../solid-ui";
import type { BeatProjectAsset, BeatProjectDocument, ProjectBackupEntry } from "../ipc/schema";
import { isNative, send } from "../ipc/bridge";
import { createEmptyProject, useDocumentStore, useInstrumentStore, useProjectStore, useTransportStore } from "../state/store";
import { saveProject } from "./dexie";
import { applyBeatDocument, beatDocumentFingerprint, buildCurrentBeatDocument, buildCurrentBeatDocumentFingerprint, replaceBeatDocumentAssetPath } from "./beatDocument";

export async function saveCurrentDocument(options: { saveAs?: boolean; force?: boolean } = {}): Promise<"saved" | "cancelled"> {
  const documentState = useDocumentStore.getState();
  if (!documentState.documentOpen) return "cancelled";
  useInstrumentStore.getState().associateProjectInstruments(useProjectStore.getState().project);
  if (!documentState.dirty && !options.saveAs && !options.force && documentState.currentFilePath) {
    return "saved";
  }

  const currentFilePath = documentState.currentFilePath;
  if (isNative()) {
    const document = buildCurrentBeatDocument();
    const result = await send({
      kind: "project.saveFile",
      document,
      pathHint: currentFilePath ?? undefined,
      forcePicker: Boolean(options.saveAs || !currentFilePath),
    });
    if (result.error) throw new Error(result.error);
    if (!result.path) return "cancelled";
    const documentStore = useDocumentStore.getState();
    documentStore.markSaved(result.path, beatDocumentFingerprint(document));
    documentStore.setIntegrityReport(result.integrityReport ?? null);
    documentStore.setCleanupReport(result.cleanupReport ?? null);
    documentStore.setLastBackupPath(result.backupPath ?? null);
    return "saved";
  }

  if (options.saveAs || !currentFilePath) {
    const document = buildCurrentBeatDocument();
    downloadBeatDocument(document);
    useDocumentStore.getState().markSaved(null, beatDocumentFingerprint(document));
    return "saved";
  }

  await saveProject(useProjectStore.getState().project);
  useDocumentStore.getState().markSaved(null, buildCurrentBeatDocumentFingerprint());
  return "saved";
}

export async function openDocumentFromUserChoice(): Promise<"opened" | "cancelled"> {
  if (hasUnsavedOpenDocument()) {
    const shouldOpen = await appConfirm("Open another project? Unsaved changes will remain in local autosave, but this view will switch.");
    if (!shouldOpen) return "cancelled";
  }

  if (isNative()) {
    const result = await send({
      kind: "project.openFile",
      pathHint: useDocumentStore.getState().currentFilePath ?? undefined,
    });
    if (result.error) throw new Error(result.error);
    if (!result.document) return "cancelled";
    const { document, missingAssets } = await relinkMissingAssetsBeforeOpen(result.document, result.missingAssets ?? []);
    stopPlaybackForDocumentSwitch();
    await applyBeatDocument(document, result.path || null, { persistInBackground: true });
    const documentStore = useDocumentStore.getState();
    documentStore.setMissingAssets(missingAssets);
    documentStore.setIntegrityReport(result.integrityReport ?? null);
    documentStore.setCleanupReport(null);
    documentStore.setLastBackupPath(null);
    if (missingAssets.length) {
      await appAlert(formatMissingAssetWarning(missingAssets.map((asset) => asset.path)));
    }
    return "opened";
  }

  const file = await chooseBrowserBeatFile();
  if (!file) return "cancelled";
  let document: BeatProjectDocument;
  try {
    document = JSON.parse(await file.text()) as BeatProjectDocument;
  } catch {
    await appAlert("That file is not a readable .beat project.");
    return "cancelled";
  }
  stopPlaybackForDocumentSwitch();
  await applyBeatDocument(document, null, { persistInBackground: true });
  return "opened";
}

export async function openRecentDocument(path: string): Promise<"opened" | "cancelled"> {
  if (!isNative()) return "cancelled";
  if (hasUnsavedOpenDocument()) {
    const shouldOpen = await appConfirm("Open another project? Unsaved changes will remain in local autosave, but this view will switch.");
    if (!shouldOpen) return "cancelled";
  }

  const result = await send({ kind: "project.openFile", directPath: path });
  if (result.error) {
    useDocumentStore.getState().removeRecentFilePath(path);
    throw new Error(result.error);
  }
  if (!result.document) return "cancelled";
  const { document, missingAssets } = await relinkMissingAssetsBeforeOpen(result.document, result.missingAssets ?? []);
  stopPlaybackForDocumentSwitch();
  await applyBeatDocument(document, result.path || path, { persistInBackground: true });
  const documentStore = useDocumentStore.getState();
  documentStore.setMissingAssets(missingAssets);
  documentStore.setIntegrityReport(result.integrityReport ?? null);
  documentStore.setCleanupReport(null);
  documentStore.setLastBackupPath(null);
  if (missingAssets.length) {
    await appAlert(formatMissingAssetWarning(missingAssets.map((asset) => asset.path)));
  }
  return "opened";
}

export async function recoverCurrentDocumentFromBackup(): Promise<"restored" | "cancelled"> {
  if (!isNative()) {
    await appAlert("Project backup recovery is only available in the native app.");
    return "cancelled";
  }

  const currentFilePath = useDocumentStore.getState().currentFilePath;
  if (!currentFilePath) {
    await appAlert("Save this project to a .beat file before using backup recovery.");
    return "cancelled";
  }

  const listResult = await send({ kind: "project.listBackups", projectPath: currentFilePath });
  if (listResult.error) throw new Error(listResult.error);
  if (listResult.backups.length === 0) {
    await appAlert("No backups exist for this project yet.");
    return "cancelled";
  }

  const backup = await chooseProjectBackup(listResult.backups);
  if (!backup) return "cancelled";
  if (backup.valid === false) {
    await appAlert(backup.error || "This backup is not safe to restore.");
    return "cancelled";
  }

  const label = backup.projectName || backup.name;
  if (!await appConfirm(`Restore backup "${label}"? The current project file will be backed up first.`)) {
    return "cancelled";
  }

  const restoreResult = await send({
    kind: "project.restoreBackup",
    projectPath: currentFilePath,
    backupPath: backup.path,
  });
  if (restoreResult.error) throw new Error(restoreResult.error);
  if (!restoreResult.document) return "cancelled";

  const { document, missingAssets } = await relinkMissingAssetsBeforeOpen(
    restoreResult.document,
    restoreResult.missingAssets ?? [],
  );
  stopPlaybackForDocumentSwitch();
  await applyBeatDocument(document, restoreResult.path || currentFilePath, { persistInBackground: true });
  const documentStore = useDocumentStore.getState();
  documentStore.setMissingAssets(missingAssets);
  documentStore.setIntegrityReport(restoreResult.integrityReport ?? null);
  documentStore.setCleanupReport(null);
  documentStore.setLastBackupPath(restoreResult.backupPath ?? null);
  if (missingAssets.length) {
    await appAlert(formatMissingAssetWarning(missingAssets.map((asset) => asset.path)));
  }
  return "restored";
}

export async function createNewDocument(): Promise<boolean> {
  if (hasUnsavedOpenDocument()) {
    const shouldCreate = await appConfirm("Create a new project? Unsaved changes will remain in local autosave, but this view will reset.");
    if (!shouldCreate) return false;
  }
  stopPlaybackForDocumentSwitch();
  useProjectStore.getState().loadProject(createEmptyProject());
  useDocumentStore.getState().markUnsavedNewDocument();
  useDocumentStore.getState().setMissingAssets([]);
  useDocumentStore.getState().setIntegrityReport(null);
  useDocumentStore.getState().setCleanupReport(null);
  useDocumentStore.getState().setLastBackupPath(null);
  return true;
}

export async function closeCurrentDocumentForHome(): Promise<boolean> {
  if (hasUnsavedOpenDocument()) {
    const shouldClose = await appConfirm("Close the current project and go Home? Unsaved changes may be lost.");
    if (!shouldClose) return false;
  }
  stopPlaybackForDocumentSwitch();
  useProjectStore.getState().loadProject(createEmptyProject());
  useDocumentStore.getState().closeDocument();
  return true;
}

export function hasUnsavedOpenDocument(): boolean {
  const { documentOpen, dirty } = useDocumentStore.getState();
  return documentOpen && dirty;
}

function stopPlaybackForDocumentSwitch() {
  useTransportStore.getState().stop();
  stopTimelineAudio();
  void send({ kind: "transport.stop" });
  void send({ kind: "transport.seek", positionBeat: 0 });
}

async function relinkMissingAssetsBeforeOpen(
  document: BeatProjectDocument,
  missingAssets: BeatProjectAsset[],
): Promise<{ document: BeatProjectDocument; missingAssets: BeatProjectAsset[] }> {
  if (!isNative() || missingAssets.length === 0) return { document, missingAssets };
  const shouldRelink = await appConfirm(formatMissingAssetRelinkPrompt(missingAssets));
  if (!shouldRelink) return { document, missingAssets };

  let nextDocument = document;
  const unresolved: BeatProjectAsset[] = [];
  let lastPathHint: string | undefined;
  for (const asset of missingAssets) {
    const result = await send({
      kind: "project.relinkAsset",
      asset: {
        kind: asset.kind,
        name: asset.name,
        path: asset.path,
      },
      pathHint: lastPathHint ?? asset.path,
    });
    if (result.error) throw new Error(result.error);
    if (!result.path) {
      unresolved.push(asset);
      continue;
    }
    lastPathHint = result.path;
    nextDocument = replaceBeatDocumentAssetPath(nextDocument, asset.path, result.path);
  }

  return { document: nextDocument, missingAssets: unresolved };
}

function formatMissingAssetWarning(paths: string[]): string {
  const unique = Array.from(new Set(paths)).filter(Boolean);
  const shown = unique.slice(0, 8).join("\n");
  const suffix = unique.length > 8 ? `\n...and ${unique.length - 8} more.` : "";
  return `Project opened, but referenced audio/sample assets are missing:\n${shown}${suffix}`;
}

function formatMissingAssetRelinkPrompt(assets: BeatProjectAsset[]): string {
  const shown = assets
    .slice(0, 8)
    .map((asset) => `${asset.name || asset.kind}: ${asset.path}`)
    .join("\n");
  const suffix = assets.length > 8 ? `\n...and ${assets.length - 8} more.` : "";
  return `This project has missing audio/sample assets. Relink them now?\n${shown}${suffix}`;
}

function chooseBrowserBeatFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".beat,application/json";
    input.style.position = "fixed";
    input.style.left = "-10000px";
    input.style.top = "0";
    document.body.append(input);

    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    input.click();
  });
}

function downloadBeatDocument(beatDocument: BeatProjectDocument) {
  const blob = new Blob([JSON.stringify(beatDocument, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = documentElement("a");
  link.href = url;
  link.download = `${safeFileBaseName(beatDocument.project?.name || "NewSong")}.beat`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function documentElement<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K] {
  return document.createElement(tagName);
}

function safeFileBaseName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ") || "NewSong";
}

function chooseProjectBackup(backups: ProjectBackupEntry[]): Promise<ProjectBackupEntry | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "6000";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.background = "rgba(0, 0, 0, 0.62)";

    const panel = document.createElement("div");
    panel.style.width = "min(720px, calc(100vw - 48px))";
    panel.style.maxHeight = "min(560px, calc(100vh - 48px))";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.background = "var(--color-bg)";
    panel.style.color = "var(--color-fg)";
    panel.style.border = "var(--border-fg)";
    panel.style.fontFamily = "var(--font-family-base)";
    panel.style.fontSize = "var(--font-size-ui)";

    const title = document.createElement("div");
    title.textContent = "Recover Backup";
    title.style.height = "var(--modal-header-height)";
    title.style.minHeight = "var(--modal-header-height)";
    title.style.display = "flex";
    title.style.alignItems = "center";
    title.style.padding = "0 6px";
    title.style.borderBottom = "var(--border-fg)";
    title.style.fontWeight = "var(--font-weight-bold)";
    title.style.textTransform = "uppercase";
    title.style.fontSize = "var(--font-size-ui)";
    title.style.lineHeight = "1";
    panel.append(title);

    const list = document.createElement("div");
    list.style.overflow = "auto";
    list.style.minHeight = "0";
    for (const backup of backups) {
      const row = document.createElement("button");
      row.type = "button";
      row.disabled = backup.valid === false;
      row.style.minHeight = "50px";
      row.style.display = "grid";
      row.style.gridTemplateColumns = "minmax(0, 1fr) auto";
      row.style.alignItems = "center";
      row.style.gap = "6px";
      row.style.width = "100%";
      row.style.padding = "6px";
      row.style.border = "0";
      row.style.borderBottom = "var(--border-fg)";
      row.style.background = "transparent";
      row.style.color = backup.valid === false ? "var(--color-fg-hover)" : "var(--color-fg)";
      row.style.font = "inherit";
      row.style.fontSize = "var(--font-size-ui)";
      row.style.textAlign = "left";
      row.style.cursor = backup.valid === false ? "not-allowed" : "pointer";
      row.style.boxSizing = "border-box";

      const main = document.createElement("span");
      main.style.display = "grid";
      main.style.gap = "4px";
      main.style.minWidth = "0";
      const name = document.createElement("span");
      name.textContent = backup.projectName || backup.name;
      name.style.overflow = "hidden";
      name.style.textOverflow = "ellipsis";
      name.style.whiteSpace = "nowrap";
      const details = document.createElement("span");
      details.textContent = backupDetails(backup);
      details.style.overflow = "hidden";
      details.style.textOverflow = "ellipsis";
      details.style.whiteSpace = "nowrap";
      details.style.color = "var(--color-fg-hover)";
      details.style.fontSize = "var(--font-size-ui)";
      main.append(name, details);

      const status = document.createElement("span");
      status.textContent = backup.valid === false ? "Invalid" : backup.latest ? "Latest" : "Backup";
      status.style.textTransform = "uppercase";
      status.style.color = "var(--color-fg-hover)";
      row.append(main, status);
      row.addEventListener("mouseenter", () => {
        if (backup.valid === false) return;
        row.style.background = "var(--surface-hover)";
        details.style.color = "var(--color-fg)";
        status.style.color = "var(--color-fg)";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "transparent";
        details.style.color = "var(--color-fg-hover)";
        status.style.color = "var(--color-fg-hover)";
      });
      row.addEventListener("click", () => {
        if (backup.valid === false) return;
        finish(backup);
      });
      list.append(row);
    }
    panel.append(list);

    const footer = document.createElement("div");
    footer.style.height = "var(--modal-footer-height)";
    footer.style.minHeight = "var(--modal-footer-height)";
    footer.style.display = "flex";
    footer.style.alignItems = "stretch";
    footer.style.justifyContent = "flex-end";
    footer.style.borderTop = "var(--border-fg)";
    footer.style.background = "var(--color-bg)";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.style.minWidth = "96px";
    cancel.style.height = "var(--modal-footer-height)";
    cancel.style.border = "0";
    cancel.style.borderLeft = "var(--border-fg)";
    cancel.style.background = "transparent";
    cancel.style.color = "var(--color-fg)";
    cancel.style.font = "inherit";
    cancel.style.fontSize = "var(--font-size-ui)";
    cancel.style.textTransform = "uppercase";
    cancel.style.cursor = "pointer";
    cancel.style.padding = "0 12px";
    cancel.style.transition = "var(--interaction-transition)";
    cancel.addEventListener("mouseenter", () => {
      cancel.style.background = "var(--interaction-hover-bg)";
      cancel.style.color = "var(--color-fg)";
    });
    cancel.addEventListener("mouseleave", () => {
      cancel.style.background = "transparent";
      cancel.style.color = "var(--color-fg)";
    });
    cancel.addEventListener("click", () => finish(null));
    footer.append(cancel);
    panel.append(footer);

    overlay.append(panel);
    document.body.append(overlay);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") finish(null);
    }
    window.addEventListener("keydown", onKeyDown);

    function finish(backup: ProjectBackupEntry | null) {
      window.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(backup);
    }
  });
}

function backupDetails(backup: ProjectBackupEntry): string {
  const modified = backup.modifiedAt ? `Modified ${formatProjectDate(Date.parse(backup.modifiedAt))}` : "Modified unknown";
  const saved = Number.isFinite(backup.savedAt) && backup.savedAt ? `Saved ${formatProjectDate(backup.savedAt)}` : "Saved unknown";
  const size = formatBytes(backup.sizeBytes);
  const status = backup.valid === false ? (backup.error || "Invalid backup") : `${backup.integrityReport?.warningCount ?? 0} warnings`;
  return `${modified} · ${saved} · ${size} · ${status}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
}

function formatProjectDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
