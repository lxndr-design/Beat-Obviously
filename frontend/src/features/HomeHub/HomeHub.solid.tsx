import { createSignal, For, Show } from "solid-js";
import type { RecentProjectEntry } from "../../ipc/schema";
import { appConfirm } from "../../solid-ui";
import { AppLogo, Button, HoverInfo, Icon } from "../../solid-ui";
import { useComponentStore } from "../../state/components";
import { useAudioFileStore, useDocumentStore, useInstrumentStore } from "../../state/store";
import { createStoreSelector } from "../../solid-utils/store";
import { AppMenuButton } from "../TopBar/AppMenuButton.solid";
import { AudioFilesPage } from "./AudioFilesPage.solid";
import { InstrumentsPage } from "./InstrumentsPage.solid";
import { PatternsPage } from "./PatternsPage.solid";
import styles from "./HomeHub.module.css";

type HomePage = "home" | "audio" | "instruments" | "patterns" | "training";

export interface HomeHubProps {
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
  onUserGuide: () => void;
  onSettings: () => void;
}

export function HomeHub(props: HomeHubProps) {
  const [page, setPage] = createSignal<HomePage>("home");
  const recentProjects = createStoreSelector(useDocumentStore, (s) => s.recentProjects);
  const audioFileCount = createStoreSelector(useAudioFileStore, (s) => s.files.length);
  const instrumentCount = createStoreSelector(useInstrumentStore, (s) => s.instruments.length);
  const patternCount = createStoreSelector(useComponentStore, (s) => s.components.length);

  async function quitBeat() {
    const { documentOpen, dirty } = useDocumentStore.getState();
    if (documentOpen && dirty && !await appConfirm("Quit Beat? Unsaved changes may be lost.")) return;
    window.close();
  }

  return (
    <Show
      when={page() === "home"}
      fallback={
        <section class={styles.home} aria-label={pageTitle(page())}>
          <HomeHeader
            title={pageTitle(page())}
            onHome={() => setPage("home")}
            onNew={props.onNew}
            onOpen={props.onOpen}
            onSave={props.onSave}
            onSaveAs={props.onSaveAs}
            onExport={props.onExport}
            onRecover={props.onRecover}
            onHealth={props.onHealth}
            onUserGuide={props.onUserGuide}
            onSettings={props.onSettings}
            onQuit={() => void quitBeat()}
            disableHome={false}
          />
          <Show when={page() === "audio"}>
            <AudioFilesPage />
          </Show>
          <Show when={page() === "instruments"}>
            <InstrumentsPage />
          </Show>
          <Show when={page() === "patterns"}>
            <PatternsPage />
          </Show>
          <Show when={page() === "training"}>
            <div class={styles.blankContent} />
          </Show>
        </section>
      }
    >
      <section class={styles.home} aria-label="Home">
        <HomeHeader
          title="Beat"
          onHome={props.onHome}
          onNew={props.onNew}
          onOpen={props.onOpen}
          onSave={props.onSave}
          onSaveAs={props.onSaveAs}
          onExport={props.onExport}
          onRecover={props.onRecover}
          onHealth={props.onHealth}
          onUserGuide={props.onUserGuide}
          onSettings={props.onSettings}
          onQuit={() => void quitBeat()}
          disableHome
        />

        <div class={styles.grid}>
          <section class={styles.panel}>
            <div class={styles.ribbon}>Projects</div>
            <div class={styles.projectActions}>
              <button type="button" class={styles.actionRow} onClick={props.onNew}>
                <Icon name="ph:plus" size={16} decorative />
                <span>New Project</span>
              </button>
              <button type="button" class={styles.actionRow} onClick={props.onOpen}>
                <Icon name="ph:folder-open" size={16} decorative />
                <span>Open Project</span>
              </button>
            </div>
            <div class={styles.subRibbon}>Recent</div>
            <Show
              when={recentProjects().length > 0}
              fallback={<div class={styles.emptyRow}>No recent projects yet.</div>}
            >
              <div class={styles.recentGrid}>
                <For each={recentProjects()}>
                  {(project) => (
                    <RecentProjectCard
                      project={project}
                      onOpen={() => props.onRecent(project.path)}
                      onRemove={() => props.onRemoveRecent(project.path)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </section>

          <div class={styles.panelStack}>
            <section class={styles.panel}>
              <div class={styles.ribbon}>Assets</div>
              <button type="button" class={styles.assetRow} onClick={() => setPage("audio")}>
                <span>
                  <Icon name="ph:music-note" size={16} decorative />
                  <span>Audio Files</span>
                </span>
                <strong>{audioFileCount()}</strong>
              </button>
              <button type="button" class={styles.assetRow} onClick={() => setPage("instruments")}>
                <span>
                  <Icon name="ph:piano-keys" size={16} decorative />
                  <span>Instruments</span>
                </span>
                <strong>{instrumentCount()}</strong>
              </button>
              <button type="button" class={styles.assetRow} onClick={() => setPage("patterns")}>
                <span>
                  <Icon name="ph:stack" size={16} decorative />
                  <span>Patterns</span>
                </span>
                <strong>{patternCount()}</strong>
              </button>
            </section>

            <section class={styles.panel}>
              <div class={styles.ribbon}>AI</div>
              <button type="button" class={styles.trainingRow} onClick={() => setPage("training")}>
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
    </Show>
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
  onUserGuide: () => void;
  onSettings: () => void;
  onQuit: () => void;
  disableHome?: boolean;
}

function HomeHeader(props: HomeHeaderProps) {
  return (
    <div class={styles.header}>
      <div class={styles.brand}>
        <AppMenuButton
          props={() => ({
            onHome: props.onHome,
            onNew: props.onNew,
            onOpen: props.onOpen,
            onSave: props.onSave,
            onSaveAs: props.onSaveAs,
            onExport: props.onExport,
            onRecover: props.onRecover,
            onHealth: props.onHealth,
            onUserGuide: props.onUserGuide,
            onSettings: props.onSettings,
            disableHome: props.disableHome,
            disableFileStateActions: true,
          })}
        />
        <h1 class={styles.breadcrumb}>
          <Show
            when={!props.disableHome}
            fallback={<span>Beat</span>}
          >
            <button type="button" class={styles.breadcrumbHome} onClick={props.onHome}>Beat</button>
            <span class={styles.breadcrumbSlash}>/</span>
            <span>{props.title}</span>
          </Show>
        </h1>
      </div>
      <HoverInfo content="Quit" placement="left">
        <Button iconOnly size="md" onClick={props.onQuit} aria-label="Quit">
          <Icon name="ph:power" size={16} decorative />
        </Button>
      </HoverInfo>
    </div>
  );
}

function RecentProjectCard(props: {
  project: RecentProjectEntry;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const name = () => props.project.name || fileName(props.project.path);
  return (
    <button type="button" class={styles.recentCard} onClick={props.onOpen} title={props.project.path}>
      <span class={styles.recentArt}>
        <AppLogo class={styles.recentLogo} />
        <HoverInfo content="Remove from recent">
          <span
            role="button"
            tabIndex={0}
            class={styles.recentRemove}
            aria-label={`Remove ${name()} from recent projects`}
            onClick={(event) => {
              event.stopPropagation();
              props.onRemove();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              props.onRemove();
            }}
          >
            <Icon name="ph:x" size={14} decorative />
          </span>
        </HoverInfo>
      </span>
      <span class={styles.recentMeta}>
        <span class={styles.recentName}>{name()}</span>
        <span class={styles.recentDate}>{formatRecentDate(props.project.openedAt)}</span>
      </span>
    </button>
  );
}

function pageTitle(page: HomePage): string {
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
  if (!Number.isFinite(openedAt) || openedAt < Date.UTC(2024, 0, 1)) return "Last opened unknown";
  return `Last opened ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(openedAt))}`;
}
