import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { appAlert, appConfirm, Block, SectionRibbon } from "./solid-ui";
import { TimelineMidiPlayback } from "./audio/TimelineMidiPlayback.solid";
import { LiveMidiExpressionInput } from "./audio/LiveMidiExpressionInput.solid";
import { startAnalyzerClient } from "./audio/analyzerClient";
import { RenderTimingPanel } from "./features/Debug/RenderTimingPanel.solid";
import { ExportJobPanel } from "./features/Debug/ExportJobPanel.solid";
import { TrainingAutoRunner } from "./features/Training/TrainingAutoRunner.solid";
import { StartupSplash, STARTUP_MINIMUM_VISIBLE_MS, type StartupStage } from "./features/Startup/StartupSplash.solid";
import { runProjectExport } from "./features/ExportReview/exportActions";
import { getTimelineAudioContext, stopTimelineAudio } from "./audio/timelineAudio";
import { importAudioFiles } from "./audio/audioImport";
import { preloadInstrumentSample } from "./audio/synthPreview";
import { installGlobalHotkeys } from "./hotkeys/hotkeys";
import { isNative, onEvent, send } from "./ipc/bridge";
import { redo, undo, useAudioFileStore, useDocumentStore, useInstrumentStore, useProjectStore, useSettingsStore, useTransportStore, useUiStore } from "./state/store";
import { useSynthStore } from "./state/synthStore";
import { useExportStore } from "./state/exportStore";
import { useComponentStore } from "./state/components";
import { listAudioFiles, listComponents, listInstruments, pruneBlankUntitledProjects, saveAudioFiles, saveComponents, saveInstruments } from "./persistence/dexie";
import { closeCurrentDocumentForHome, createNewDocument, openDocumentFromUserChoice, openRecentDocument, recoverCurrentDocumentFromBackup, saveCurrentDocument } from "./persistence/documentActions";
import { buildCurrentBeatDocumentFingerprint } from "./persistence/beatDocument";
import { createStoreSelector } from "./solid-utils/store";
import { Visualizer } from "./features/Visualizer/Visualizer.solid";
import { HomeHub } from "./features/HomeHub/HomeHub.solid";
import { TopBar } from "./features/TopBar/TopBar.solid";
import { Sidebar } from "./features/Sidebar/Sidebar.solid";
import { TrackList } from "./features/Tracks/TrackList.solid";
import { AudioBusPanel } from "./features/AudioBusPanel/AudioBusPanel.solid";
import { EditorHost } from "./features/EditorHost/EditorHost.solid";
import { AppDialogHost } from "./solid-ui/AppDialog";
import { ModalStackOverlay } from "./solid-ui/Modal";
import trackStyles from "./features/Tracks/TrackList.module.css";
import { SolidUiKitCatalog } from "./design/SolidUiKitCatalog.solid";
import { UiKitOnePager } from "./design/UiKitOnePager.solid";

type StartupReadinessKey = "instruments" | "components" | "audio";

function initialStartupReadiness(): Record<StartupReadinessKey, boolean> {
  return {
    instruments: false,
    components: false,
    audio: false,
  };
}

const STARTUP_STAGE_LABELS: Record<StartupReadinessKey, string> = {
  instruments: "Loading instruments",
  components: "Loading components",
  audio: "Loading audio files",
};

function allStartupReady(readiness: Record<StartupReadinessKey, boolean>) {
  return readiness.instruments && readiness.components && readiness.audio;
}

const startupStageOrder: StartupReadinessKey[] = [
  "instruments",
  "components",
  "audio",
];

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  const tagName = element.tagName.toLowerCase();
  return element.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

export function App() {
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const devFixture = new URLSearchParams(window.location.search).get("beatDevFixture");
    if (devFixture === "ui-elements") return <SolidUiKitCatalog />;
    if (devFixture === "ui-one-pager") return <UiKitOnePager />;
  }

  const shouldMountEditorHost = createStoreSelector(useUiStore, (s) => s.openEditors.length > 0 || Boolean(s.trackEffectsEditorTrackId));
  const themeContrastLevel = createStoreSelector(useSettingsStore, (s) => s.themeContrastLevel);
  const themeMode = createStoreSelector(useSettingsStore, (s) => s.themeMode);
  const [showHome, setShowHome] = createSignal(true);
  const [startupReadiness, setStartupReadiness] = createSignal<Record<StartupReadinessKey, boolean>>(initialStartupReadiness(), { equals: false });
  const [startupMinimumElapsed, setStartupMinimumElapsed] = createSignal(false);
  let startupReadySent = false;
  const startupStages = createMemo<StartupStage[]>(() => startupStageOrder.map((id) => ({
    id,
    label: STARTUP_STAGE_LABELS[id],
    ready: startupReadiness()[id],
  })));

  function markStartupReady(key: StartupReadinessKey) {
    setStartupReadiness((current) => ({ ...current, [key]: true }));
  }

  onMount(() => {
    const cleanupHotkeys = installGlobalHotkeys();
    const timer = window.setTimeout(() => setStartupMinimumElapsed(true), STARTUP_MINIMUM_VISIBLE_MS);
    onCleanup(() => {
      cleanupHotkeys();
      window.clearTimeout(timer);
    });
  });

  onMount(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableKeyboardTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        if (useInstrumentStore.getState().undoLastInstrumentDelete()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));
  });

  createEffect(() => {
    if (startupReadySent || !startupMinimumElapsed() || !allStartupReady(startupReadiness())) return;
    startupReadySent = true;
    void send({ kind: "app.ready" });
  });

  createEffect(() => {
    document.documentElement.dataset.themeContrast = themeContrastLevel();
    document.documentElement.dataset.theme = themeMode();
  });

  onMount(() => {
    if (!import.meta.env.DEV) return;
    void import("./testing/devHooks")
      .then(({ installBeatDevHooks }) => installBeatDevHooks())
      .catch((error) => {
        console.error("[Beat dev hooks] install failed", error);
      });
  });

  onMount(() => {
    if (!import.meta.env.DEV) return;
    const openArrangement = () => setShowHome(false);
    document.addEventListener("beat:dev-open-arrangement", openArrangement);
    onCleanup(() => document.removeEventListener("beat:dev-open-arrangement", openArrangement));
  });

  function closeHome() {
    setShowHome(false);
  }

  async function openHome() {
    if (await closeCurrentDocumentForHome()) setShowHome(true);
  }

  function openUserGuide() {
    const url = new URL("docs/user-guide.html", window.location.href);
    window.open(url.href, "_blank", "noopener");
  }

  async function createFromHome() {
    if (await createNewDocument()) closeHome();
  }

  async function openFromHome() {
    const result = await openDocumentFromUserChoice();
    if (result === "opened") closeHome();
  }

  async function openRecentFromHome(path: string) {
    const result = await openRecentDocument(path);
    if (result === "opened") closeHome();
  }

  async function removeRecentFromHome(path: string) {
    useDocumentStore.getState().removeRecentFilePath(path);
    if (!isNative()) return;
    const result = await send({ kind: "project.recentRemove", path });
    if (!result.ok) {
      throw new Error("Could not remove recent project.");
    }
  }

  async function revealRecentFromHome(path: string) {
    if (!isNative()) {
      await appAlert("View in Folder is only available in the native app.");
      return;
    }
    const result = await send({ kind: "project.revealFile", path });
    if (result.ok) return;
    if (result.missing) {
      const shouldRemove = await appConfirm("This project file could not be found. Remove it from Recent?");
      if (shouldRemove) await removeRecentFromHome(path);
      return;
    }
    throw new Error(result.error || "Could not reveal this project file.");
  }

  onMount(() => {
    void pruneBlankUntitledProjects().catch((error) => {
      // eslint-disable-next-line no-console
      console.warn("[Beat] Could not prune blank local project clutter", error);
    });
  });

  onMount(() => {
    if (!isNative()) return;
    void send({ kind: "project.recentList" })
      .then((result) => {
        const existingPaths = result.projects
          .filter((project) => project.exists !== false && Boolean(project.path))
          .map((project) => project.path);
        const documentStore = useDocumentStore.getState();
        for (const path of documentStore.recentFilePaths) {
          if (!existingPaths.includes(path)) documentStore.removeRecentFilePath(path);
        }
        for (const project of result.projects) {
          if (project.exists === false || !project.path) continue;
          useDocumentStore.getState().addRecentProject(project);
        }
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.warn("[Beat] Could not load recent projects", error);
      });
  });

  onMount(() => startAnalyzerClient());

  onMount(() => {
    let hydrated = false;
    let timer: number | null = null;

    void listInstruments()
      .then(({ instruments, sets }) => {
        if (instruments.length > 0 || sets.length > 0) {
          useInstrumentStore.getState().hydrateInstruments(instruments, sets);
        }
        useInstrumentStore.getState().seedSystemInstruments();
        useComponentStore.getState().seedDefaultDrumLoops(useInstrumentStore.getState().instruments);
        if (!isNative()) {
          const ctx = getTimelineAudioContext();
          for (const instrument of useInstrumentStore.getState().instruments) {
            if (!instrument.sampleUrl) continue;
            void preloadInstrumentSample(ctx, instrument).catch(() => {
              // Synth fallback remains available if a bundled sample cannot decode.
            });
          }
        }
        hydrated = true;
        markStartupReady("instruments");
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("[Beat] Instrument library hydration failed", error);
        useInstrumentStore.getState().setLoading(false);
        markStartupReady("instruments");
      });

    const unsub = useInstrumentStore.subscribe((state) => {
      if (!hydrated) return;
      scheduleCurrentDocumentDirtyState();
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const instruments = state.instruments.map((instrument) => structuredClone(instrument));
        const sets = state.instrumentSets.map((set) => structuredClone(set));
        void saveInstruments(instruments, sets);
      }, 800);
    });
    onCleanup(() => {
      if (timer) window.clearTimeout(timer);
      unsub();
    });
  });

  onMount(() => {
    let hydrated = false;
    let timer: number | null = null;

    void listComponents()
      .then(({ components, folders }) => {
        useComponentStore.getState().hydrate(components, folders);
        hydrated = true;
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("[Beat] Component library hydration failed", error);
      })
      .finally(() => markStartupReady("components"));

    const unsub = useComponentStore.subscribe((state) => {
      if (!hydrated) return;
      scheduleCurrentDocumentDirtyState();
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const snapshot = state.components
          .filter((component) => !component.factory)
          .map((component) => structuredClone(component));
        const folders = state.componentFolders
          .filter((folder) => !folder.factory)
          .map((folder) => structuredClone(folder));
        void saveComponents(snapshot, folders);
      }, 800);
    });
    onCleanup(() => {
      if (timer) window.clearTimeout(timer);
      unsub();
    });
  });

  onMount(() => {
    let hydrated = false;
    void (async () => {
      try {
        for (const file of await listAudioFiles()) useAudioFileStore.getState().addFile(file);
        const resp = await send({ kind: "audio.list" });
        for (const file of resp.files) useAudioFileStore.getState().addFile(file);
        hydrated = true;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[Beat] Audio library hydration failed", error);
      } finally {
        markStartupReady("audio");
      }
    })();
    let timer: number | null = null;
    const unsub = useAudioFileStore.subscribe((state) => {
      if (!hydrated) return;
      scheduleCurrentDocumentDirtyState();
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const files = state.files.map((file) => structuredClone(file));
        void saveAudioFiles(files);
      }, 800);
    });
    onCleanup(() => {
      if (timer) window.clearTimeout(timer);
      unsub();
    });
  });

  onMount(() => {
    if (isNative()) return;

    let raf: number | null = null;
    let lastTs: number | null = null;
    function tick(ts: number) {
      const playing = useTransportStore.getState().playing;
      if (!playing) {
        lastTs = null;
        raf = requestAnimationFrame(tick);
        return;
      }
      if (lastTs == null) {
        lastTs = ts;
      } else {
        const dtMs = ts - lastTs;
        lastTs = ts;
        const { bpm } = useProjectStore.getState().project;
        const { speed, positionBeat, loopEnabled, loopRange, repeatTrackEnabled } = useTransportStore.getState();
        const deltaBeats = (dtMs / 1000) * (bpm / 60) * speed;
        const next = positionBeat + deltaBeats;
        if (
          loopEnabled &&
          loopRange.endBeat > loopRange.startBeat &&
          positionBeat < loopRange.endBeat &&
          next >= loopRange.endBeat
        ) {
          const loopLength = loopRange.endBeat - loopRange.startBeat;
          const overflow = Math.max(0, next - loopRange.endBeat);
          useTransportStore.getState().setPosition(loopRange.startBeat + (overflow % loopLength));
          raf = requestAnimationFrame(tick);
          return;
        }
        const len = useProjectStore.getState().project.lengthBeats;
        if (len > 0 && next >= len) {
          if (repeatTrackEnabled) {
            useTransportStore.getState().setPosition(0);
          } else {
            useTransportStore.getState().setPosition(len);
            useTransportStore.getState().pause();
            stopTimelineAudio();
          }
          raf = requestAnimationFrame(tick);
          return;
        }
        useTransportStore.getState().setPosition(next);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    onCleanup(() => {
      if (raf) cancelAnimationFrame(raf);
    });
  });

  onMount(() => {
    const unsub = useProjectStore.subscribe(() => {
      scheduleCurrentDocumentDirtyState();
    });
    onCleanup(unsub);
  });

  onMount(() => {
    let timer: number | null = null;
    const apply = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const project = structuredClone(useProjectStore.getState().project);
        const instruments = useInstrumentStore.getState().instruments.map((instrument) => structuredClone(instrument));
        const audioFiles = useAudioFileStore.getState().files.map((file) => structuredClone(file));
        void send({ kind: "engine.applyProject", project, instruments, audioFiles });
      }, 120);
    };
    apply();
    const unsubProject = useProjectStore.subscribe(() => apply());
    const unsubInstruments = useInstrumentStore.subscribe(() => apply());
    const unsubAudioFiles = useAudioFileStore.subscribe(() => apply());
    onCleanup(() => {
      if (timer) window.clearTimeout(timer);
      unsubProject();
      unsubInstruments();
      unsubAudioFiles();
    });
  });

  onMount(() => {
    const off = onEvent((event) => {
      switch (event.kind) {
        case "transport.positionChanged":
          useTransportStore.getState().setPosition(event.positionBeat);
          break;
        case "transport.playbackEnded":
          if (useTransportStore.getState().repeatTrackEnabled) {
            useTransportStore.getState().setPosition(0);
            useTransportStore.getState().play();
            void send({ kind: "transport.restart" });
          } else {
            useTransportStore.getState().pause();
            stopTimelineAudio();
          }
          break;
        case "engine.segmentTrigger":
          useUiStore.getState().triggerSegmentPlayback(event.segmentId);
          break;
        case "native.menuCommand":
          void (async () => {
            switch (event.command) {
              case "home":
                await openHome();
                return;
              case "whatsNew":
                await appAlert("What's New is coming soon.");
                return;
              case "userGuide":
                openUserGuide();
                return;
              case "undo":
                undo();
                return;
              case "redo":
                redo();
                return;
              case "songInfo":
                await appAlert("Song Info is coming soon.");
                return;
              default:
                await handleNativeMenuCommand(event.command);
            }
          })().catch((error) => {
            void appAlert(error instanceof Error ? error.message : "Project command failed.");
          });
          break;
        case "native.openProjectFile":
          void openRecentDocument(event.path).catch((error) => {
            void appAlert(error instanceof Error ? error.message : "Open project failed.");
          });
          break;
        case "synth.expressionActivity":
          if (event.active) {
            useSynthStore.getState().setInstrumentExpressionActivity(event.instrumentId, {
              source: event.source,
              activeNotes: event.activeNotes,
              pitchBendSemitones: event.pitchBendSemitones,
              velocity: event.velocity,
              keytrack: event.keytrack,
              modWheel: event.modWheel,
            });
          } else {
            useSynthStore.getState().clearInstrumentExpressionActivity(event.instrumentId);
          }
          break;
        case "project.exportProgress":
          useExportStore.getState().setJob(event);
          break;
        case "log":
          // eslint-disable-next-line no-console
          console[event.level === "error" ? "error" : event.level === "warn" ? "warn" : "log"](
            "[backend]",
            event.message,
          );
          break;
      }
    });
    onCleanup(off);
  });

  const homeProps = () => ({
    onHome: () => undefined,
    onNew: () => void createFromHome(),
    onOpen: () => void openFromHome().catch((error) => appAlert(error instanceof Error ? error.message : "Open failed.")),
    onRecent: (path: string) => void openRecentFromHome(path).catch((error) => appAlert(error instanceof Error ? error.message : "Open recent failed.")),
    onRevealRecent: (path: string) => void revealRecentFromHome(path).catch((error) => appAlert(error instanceof Error ? error.message : "View in Folder failed.")),
    onRemoveRecent: (path: string) => void removeRecentFromHome(path).catch((error) => appAlert(error instanceof Error ? error.message : "Remove recent failed.")),
    onSave: () => void saveFromMenu(false),
    onSaveAs: () => void saveFromMenu(true),
    onExport: () => useUiStore.getState().openEditor({ kind: "exportReview" }),
    onRecover: () => undefined,
    onHealth: () => useUiStore.getState().openEditor({ kind: "projectHealth" }),
    onUserGuide: openUserGuide,
    onSettings: () => useUiStore.getState().openEditor({ kind: "preferences" }),
  });

  const topBarProps = () => ({
    onHome: () => void openHome(),
    onNew: () => void createFromHome(),
    onOpen: () => void openFromHome().catch((error) => appAlert(error instanceof Error ? error.message : "Open failed.")),
    onSave: () => void saveFromMenu(false),
    onSaveAs: () => void saveFromMenu(true),
    onExport: () => void runProjectExport().catch((error) => appAlert(error instanceof Error ? error.message : "Export failed.")),
    onExportReview: () => useUiStore.getState().openEditor({ kind: "exportReview" }),
    onExportRange: () => void runProjectExport("range").catch((error) => appAlert(error instanceof Error ? error.message : "Range export failed.")),
    onExportTrack: () => void runProjectExport("track").catch((error) => appAlert(error instanceof Error ? error.message : "Track export failed.")),
    onRecover: () => void recoverFromMenu(),
    onHealth: () => useUiStore.getState().openEditor({ kind: "projectHealth" }),
    onUserGuide: openUserGuide,
    onSettings: () => useUiStore.getState().openEditor({ kind: "preferences" }),
  });

  return (
    <>
      <Show
        when={!showHome()}
        fallback={(
          <>
            <HomeHub {...homeProps()} />
            <Show when={shouldMountEditorHost()}>
              <EditorHost />
            </Show>
            <ModalStackOverlay />
            <AppDialogHost />
            <StartupSplash props={() => ({ stages: startupStages() })} />
          </>
        )}
      >
        <Visualizer />
        <TimelineMidiPlayback />
        <LiveMidiExpressionInput />
        <TrainingAutoRunner />
        <RenderTimingPanel />
        <ExportJobPanel />
        <div class="app-root">
          <TopBar props={topBarProps} />
          <main class="app-main">
            <Sidebar />
            <div class="main-col">
              <TrackBlock />
              <AudioBusPanel />
            </div>
          </main>
        </div>
        <Show when={shouldMountEditorHost()}>
          <EditorHost />
        </Show>
        <ModalStackOverlay />
        <AppDialogHost />
        <StartupSplash props={() => ({ stages: startupStages() })} />
      </Show>
    </>
  );
}

function TrackBlock() {
  return (
    <Block framed fill padding="none" className={trackStyles.tracksBlock}>
      <SectionRibbon title="Tracks" expanded showToggle={false} onToggle={() => undefined} />
      <TrackList />
    </Block>
  );
}

let dirtyFingerprintTimer: number | null = null;

function scheduleCurrentDocumentDirtyState() {
  if (dirtyFingerprintTimer) window.clearTimeout(dirtyFingerprintTimer);
  dirtyFingerprintTimer = window.setTimeout(() => {
    dirtyFingerprintTimer = null;
    useDocumentStore.getState().markDirty(buildCurrentBeatDocumentFingerprint());
  }, 120);
}

async function handleNativeMenuCommand(command: "newProject" | "openProject" | "saveProject" | "importAudio" | "exportWav" | "preferences") {
  switch (command) {
    case "newProject": {
      await createNewDocument();
      return;
    }
    case "openProject": {
      await openDocumentFromUserChoice();
      return;
    }
    case "saveProject": {
      await saveFromMenu(false);
      return;
    }
    case "importAudio": {
      const files = await importAudioFiles();
      for (const file of files) useAudioFileStore.getState().addFile(file);
      return;
    }
    case "exportWav":
      await runProjectExport();
      return;
    case "preferences":
      useUiStore.getState().openEditor({ kind: "preferences" });
      return;
  }
}

async function saveFromMenu(saveAs: boolean) {
  try {
    await saveCurrentDocument({ saveAs });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[Beat] Save failed", error);
    await appAlert("Save failed.");
  }
}

async function recoverFromMenu() {
  try {
    await recoverCurrentDocumentFromBackup();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[Beat] Backup recovery failed", error);
    await appAlert(error instanceof Error ? error.message : "Backup recovery failed.");
  }
}
