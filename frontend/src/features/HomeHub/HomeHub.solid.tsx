import { createSignal, For, Show } from "solid-js";
import type { RecentProjectEntry } from "../../ipc/schema";
import { appConfirm } from "../../solid-ui";
import { AppLogo, Button, createContextMenu, HoverInfo, Icon, type ContextMenuItem } from "../../solid-ui";
import { useComponentStore } from "../../state/components";
import { useAudioFileStore, useDocumentStore, useInstrumentStore } from "../../state/store";
import { createStoreSelector } from "../../solid-utils/store";
import { AudioFilesPage } from "./AudioFilesPage.solid";
import { InstrumentsPage } from "./InstrumentsPage.solid";
import { PatternsPage } from "./PatternsPage.solid";
import styles from "./HomeHub.module.css";
import type { GenerateSongOptions } from "../../ai/songGenerator";
import { StartFromSomethingModal } from "./StartFromSomethingModal.solid";

type HomePage = "home" | "audio" | "instruments" | "patterns";

export interface HomeHubProps {
  onHome: () => void;
  onNew: () => void;
  onStartFromSomething: (options: GenerateSongOptions) => void;
  onOpen: () => void;
  onRecent: (path: string) => void;
  onRevealRecent: (path: string) => void;
  onDuplicateRecent: (path: string) => void;
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
  const [startModalOpen, setStartModalOpen] = createSignal(false);
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
    <>
    <Show
      when={page() === "home"}
      fallback={
        <section class={styles.home} aria-label={pageTitle(page())} data-beat-surface="home">
          <HomeHeader
            title={pageTitle(page())}
            onHome={() => setPage("home")}
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
        </section>
      }
    >
      <section class={styles.home} aria-label="Home" data-beat-surface="home">
        <HomeHeader
          title="Beat"
          onHome={props.onHome}
          onSettings={props.onSettings}
          onQuit={() => void quitBeat()}
          disableHome
        />

        <div class={styles.grid}>
          <section class={styles.panel}>
            <div class={styles.ribbon}>Projects</div>
            <div class={styles.projectActions}>
              <Button variant="ghost" class={styles.actionRow} onClick={props.onNew}>
                <Icon name="ph:plus" size={18} decorative />
                <span>New Project</span>
              </Button>
              <Button variant="ghost" class={styles.actionRow} onClick={() => setStartModalOpen(true)}>
                <Icon name="ph:sparkle" size={18} decorative />
                <span>Start from Something</span>
              </Button>
              <Button variant="ghost" class={styles.actionRow} onClick={props.onOpen}>
                <Icon name="ph:folder-open" size={18} decorative />
                <span>Open Project</span>
              </Button>
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
                      onReveal={() => props.onRevealRecent(project.path)}
                      onDuplicate={() => props.onDuplicateRecent(project.path)}
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
              <Button variant="ghost" class={styles.assetRow} onClick={() => setPage("audio")}>
                <span>
                  <Icon name="ph:music-note" size={18} decorative />
                  <span>Audio Files</span>
                </span>
                <strong>{audioFileCount()}</strong>
              </Button>
              <Button variant="ghost" class={styles.assetRow} onClick={() => setPage("instruments")}>
                <span>
                  <Icon name="ph:piano-keys" size={18} decorative />
                  <span>Instruments</span>
                </span>
                <strong>{instrumentCount()}</strong>
              </Button>
              <Button variant="ghost" class={styles.assetRow} onClick={() => setPage("patterns")}>
                <span>
                  <Icon name="ph:stack" size={18} decorative />
                  <span>Patterns</span>
                </span>
                <strong>{patternCount()}</strong>
              </Button>
            </section>

          </div>
        </div>
      </section>
    </Show>
    <StartFromSomethingModal
      open={startModalOpen()}
      onClose={() => setStartModalOpen(false)}
      onStart={props.onStartFromSomething}
    />
    </>
  );
}

interface HomeHeaderProps {
  title: string;
  onHome: () => void;
  onSettings?: () => void;
  onQuit: () => void;
  disableHome?: boolean;
}

function HomeHeader(props: HomeHeaderProps) {
  return (
    <div class={styles.header}>
      <Show
        when={!props.disableHome}
        fallback={(
          <HoverInfo content="Settings" placement="right">
            <Button iconOnly size="md" onClick={props.onSettings} aria-label="Settings">
              <Icon name="ph:gear" size={18} decorative />
            </Button>
          </HoverInfo>
        )}
      >
        <h1 class={styles.breadcrumb}>
          <Button variant="ghost" class={styles.breadcrumbHome} onClick={props.onHome}>Beat</Button>
          <span class={styles.breadcrumbSlash}>/</span>
          <span>{props.title}</span>
        </h1>
      </Show>
      <HoverInfo content="Quit" placement="left">
        <Button iconOnly size="md" onClick={props.onQuit} aria-label="Quit">
          <Icon name="ph:power" size={18} decorative />
        </Button>
      </HoverInfo>
    </div>
  );
}

function RecentProjectCard(props: {
  project: RecentProjectEntry;
  onOpen: () => void;
  onReveal: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const name = () => props.project.name || fileName(props.project.path);
  const menu = createContextMenu((): ContextMenuItem[] => [
    {
      label: "Reveal in Finder",
      icon: "ph:folder-open",
      onSelect: props.onReveal,
    },
    {
      label: "Duplicate Project",
      icon: "ph:copy",
      onSelect: props.onDuplicate,
    },
    {
      label: "Remove from Recent",
      icon: "ph:x",
      onSelect: props.onRemove,
      separatorBefore: true,
    },
  ]);

  function openMenuFromSecondaryMouseDown(event: MouseEvent) {
    if (event.button !== 2 && !(event.button === 0 && event.ctrlKey)) return;
    event.preventDefault();
    event.stopPropagation();
    const { clientX, clientY } = event;
    // WKWebView can consume the later `contextmenu` event for a secondary click.
    // Open after the current mousedown finishes so the menu's outside-click
    // listener cannot immediately close the menu it just mounted.
    window.setTimeout(() => menu.openAt(clientX, clientY), 0);
  }

  return (
    <div
      class={styles.recentCard}
      data-recent-project-path={props.project.path}
      onMouseDown={openMenuFromSecondaryMouseDown}
      onContextMenu={menu.onContextMenu}
    >
      <Button variant="ghost" class={styles.recentOpen} onClick={props.onOpen} title={props.project.path}>
        <span class={styles.recentLogoFrame} aria-hidden="true">
          <AppLogo class={styles.recentLogo} />
        </span>
        <span class={styles.recentMeta}>
          <span class={styles.recentName}>{name()}</span>
          <span class={styles.recentDate}>{formatRecentDate(props.project.openedAt)}</span>
        </span>
      </Button>
      <span class={styles.recentActions}>
        <HoverInfo content="Remove from recent">
          <Button
            variant="ghost"
            iconOnly
            size="xs"
            class={styles.recentRemove}
            aria-label={`Remove ${name()} from recent projects`}
            onClick={props.onRemove}
          >
            <Icon name="ph:x" size={18} decorative />
          </Button>
        </HoverInfo>
      </span>
      {menu.menu()}
    </div>
  );
}

function pageTitle(page: HomePage): string {
  if (page === "audio") return "Audio Files";
  if (page === "instruments") return "Instruments";
  if (page === "patterns") return "Patterns";
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
