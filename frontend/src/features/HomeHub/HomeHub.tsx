import { useState } from "react";
import { Button, HoverInfo, Icon } from "../../components";
import { AppMenuButton } from "../TopBar/AppMenuButton";
import { useAudioFileStore, useDocumentStore, useInstrumentStore } from "../../state/store";
import { useComponentStore } from "../../state/components";
import { AudioFilesPage } from "./AudioFilesPage";
import { InstrumentsPage } from "./InstrumentsPage";
import { PatternsPage } from "./PatternsPage";
import styles from "./HomeHub.module.css";
import type { RecentProjectEntry } from "../../ipc/schema";

interface HomeHubProps {
  onHome: () => void;
  onNew: () => void;
  onOpen: () => void;
  onRecent: (path: string) => void;
  onRevealRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onRecover?: () => void;
  onHealth?: () => void;
  onSettings: () => void;
}

export function HomeHub({
  onHome,
  onNew,
  onOpen,
  onRecent,
  onRemoveRecent,
  onSave,
  onSaveAs,
  onExport,
  onRecover,
  onHealth,
  onSettings,
}: HomeHubProps) {
  const [page, setPage] = useState<"home" | "audio" | "instruments" | "patterns" | "training">("home");
  const recentProjects = useDocumentStore((s) => s.recentProjects);
  const audioFileCount = useAudioFileStore((s) => s.files.length);
  const instrumentCount = useInstrumentStore((s) => s.instruments.length);
  const patternCount = useComponentStore((s) => s.components.length);

  function quitBeat() {
    const { documentOpen, dirty } = useDocumentStore.getState();
    if (documentOpen && dirty && !window.confirm("Quit Beat? Unsaved changes may be lost.")) return;
    window.close();
  }

  if (page !== "home") {
    return (
      <section className={styles.home} aria-label={pageTitle(page)}>
        <HomeHeader
          title={pageTitle(page)}
          onHome={() => setPage("home")}
          onNew={onNew}
          onOpen={onOpen}
          onSave={onSave}
          onSaveAs={onSaveAs}
          onExport={onExport}
          onRecover={onRecover}
          onHealth={onHealth}
          onSettings={onSettings}
          onQuit={quitBeat}
          disableHome={false}
        />
        {page === "audio"
          ? <AudioFilesPage />
          : page === "instruments"
            ? <InstrumentsPage />
            : page === "patterns"
              ? <PatternsPage />
              : <div className={styles.blankContent} />}
      </section>
    );
  }

  return (
    <section className={styles.home} aria-label="Home">
      <HomeHeader
        title="Beat"
        onHome={onHome}
        onNew={onNew}
        onOpen={onOpen}
        onSave={onSave}
        onSaveAs={onSaveAs}
        onExport={onExport}
        onRecover={onRecover}
        onHealth={onHealth}
        onSettings={onSettings}
        onQuit={quitBeat}
        disableHome
      />

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.ribbon}>Projects</div>
          <div className={styles.projectActions}>
            <button type="button" className={styles.actionRow} onClick={onNew}>
              <Icon name="ph:plus" size={16} decorative />
              <span>New Project</span>
            </button>
            <button type="button" className={styles.actionRow} onClick={onOpen}>
              <Icon name="ph:folder-open" size={16} decorative />
              <span>Open Project</span>
            </button>
          </div>
          <div className={styles.subRibbon}>Recent</div>
          {recentProjects.length === 0 ? (
            <div className={styles.emptyRow}>No recent projects yet.</div>
          ) : (
            <div className={styles.recentGrid}>
              {recentProjects.map((project) => (
                <RecentProjectCard
                  key={project.path}
                  project={project}
                  onOpen={() => onRecent(project.path)}
                  onRemove={() => onRemoveRecent(project.path)}
                />
              ))}
            </div>
          )}
        </section>

        <div className={styles.panelStack}>
          <section className={styles.panel}>
            <div className={styles.ribbon}>Assets</div>
            <button type="button" className={styles.assetRow} onClick={() => setPage("audio")}>
              <span>
                <Icon name="ph:music-note" size={16} decorative />
                <span>Audio Files</span>
              </span>
              <strong>{audioFileCount}</strong>
            </button>
            <button type="button" className={styles.assetRow} onClick={() => setPage("instruments")}>
              <span>
                <Icon name="ph:piano-keys" size={16} decorative />
                <span>Instruments</span>
              </span>
              <strong>{instrumentCount}</strong>
            </button>
            <button type="button" className={styles.assetRow} onClick={() => setPage("patterns")}>
              <span>
                <Icon name="ph:stack" size={16} decorative />
                <span>Patterns</span>
              </span>
              <strong>{patternCount}</strong>
            </button>
          </section>

          <section className={styles.panel}>
            <div className={styles.ribbon}>AI</div>
            <button type="button" className={styles.trainingRow} onClick={() => setPage("training")}>
              <span>
                <Icon name="ph:sparkle" size={16} decorative />
                <span>AI Training</span>
              </span>
              <Icon name="ph:arrow-right" size={16} decorative />
            </button>
          </section>
        </div>
      </div>
    </section>
  );
}

interface HomeHeaderProps {
  title: string;
  onHome: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onRecover?: () => void;
  onHealth?: () => void;
  onSettings: () => void;
  onQuit: () => void;
  disableHome?: boolean;
}

function HomeHeader({
  title,
  onHome,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onExport,
  onRecover,
  onHealth,
  onSettings,
  onQuit,
  disableHome = false,
}: HomeHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.brand}>
        <AppMenuButton
          onHome={onHome}
          onNew={onNew}
          onOpen={onOpen}
          onSave={onSave}
          onSaveAs={onSaveAs}
          onExport={onExport}
          onRecover={onRecover}
          onHealth={onHealth}
          onSettings={onSettings}
          disableHome={disableHome}
          disableFileStateActions
        />
        <h1 className={styles.breadcrumb}>
          {disableHome ? (
            <span>Beat</span>
          ) : (
            <>
              <button type="button" className={styles.breadcrumbHome} onClick={onHome}>Beat</button>
              <span className={styles.breadcrumbSlash}>/</span>
              <span>{title}</span>
            </>
          )}
        </h1>
      </div>
      <HoverInfo content="Quit" placement="left">
        <Button iconOnly size="md" onClick={onQuit} aria-label="Quit">
          <Icon name="ph:power" size={16} decorative />
        </Button>
      </HoverInfo>
    </div>
  );
}

function RecentProjectCard({
  project,
  onOpen,
  onRemove,
}: {
  project: RecentProjectEntry;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const name = project.name || fileName(project.path);
  return (
    <button type="button" className={styles.recentCard} onClick={onOpen} title={project.path}>
      <span className={styles.recentArt}>
        <Icon name="ph:music-note" size={40} decorative />
        <HoverInfo content="Remove from recent">
          <span
            role="button"
            tabIndex={0}
            className={styles.recentRemove}
            aria-label={`Remove ${name} from recent projects`}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }}
          >
            <Icon name="ph:x" size={14} decorative />
          </span>
        </HoverInfo>
      </span>
      <span className={styles.recentMeta}>
        <span className={styles.recentName}>{name}</span>
        <span className={styles.recentDate}>{formatRecentDate(project.openedAt)}</span>
      </span>
    </button>
  );
}

function pageTitle(page: "audio" | "instruments" | "patterns" | "training" | "home"): string {
  if (page === "audio") return "Audio Files";
  if (page === "instruments") return "Instruments";
  if (page === "patterns") return "Patterns";
  if (page === "training") return "AI Training";
  return "Beat";
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function formatRecentDate(openedAt: number): string {
  if (!Number.isFinite(openedAt) || openedAt <= 0) return "Last opened unknown";
  return `Last opened ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(openedAt))}`;
}
