import { lazy, Suspense, useEffect, useState } from "react";
import { TopBar } from "./features/TopBar/TopBar";
import { Sidebar } from "./features/Sidebar/Sidebar";
import { TrackList } from "./features/Tracks/TrackList";
import { MasterEqPanel } from "./features/Eq/MasterEqPanel";
import { HomeHub } from "./features/HomeHub/HomeHub";
import { ModalStackOverlay } from "./components";
import { TimelineMidiPlayback } from "./audio/TimelineMidiPlayback";
import { startAnalyzerClient } from "./audio/analyzerClient";
import { RenderTimingPanel } from "./features/Debug/RenderTimingPanel";
import { ExportJobPanel } from "./features/Debug/ExportJobPanel";
import { TrainingAutoRunner } from "./features/Training/TrainingAutoRunner";
import { getTimelineAudioContext, stopTimelineAudio } from "./audio/timelineAudio";
import { importAudioFiles } from "./audio/audioImport";
import { preloadInstrumentSample } from "./audio/synthPreview";
import { useGlobalHotkeys } from "./hotkeys/hotkeys";
import { isNative, onEvent, send } from "./ipc/bridge";
import { useAudioFileStore, useDocumentStore, useInstrumentStore, useProjectStore, useTransportStore, useUiStore } from "./state/store";
import { useExportStore } from "./state/exportStore";
import { useComponentStore } from "./state/components";
import { listAudioFiles, listComponents, listInstruments, pruneBlankUntitledProjects, saveAudioFiles, saveComponents, saveInstruments } from "./persistence/dexie";
import { closeCurrentDocumentForHome, createNewDocument, openDocumentFromUserChoice, openRecentDocument, recoverCurrentDocumentFromBackup, saveCurrentDocument } from "./persistence/documentActions";
import { buildCurrentBeatDocumentFingerprint } from "./persistence/beatDocument";

const Visualizer = lazy(() => import("./features/Visualizer/Visualizer").then((module) => ({ default: module.Visualizer })));
const EditorHost = lazy(() => import("./features/EditorHost/EditorHost").then((module) => ({ default: module.EditorHost })));

type StartupReadinessKey = "instruments" | "components" | "audio";

const startupReadiness: Record<StartupReadinessKey, boolean> = {
  instruments: false,
  components: false,
  audio: false,
};

let startupReadySent = false;

function markStartupReady(key: StartupReadinessKey) {
  startupReadiness[key] = true;
  if (startupReadySent || !startupReadiness.instruments || !startupReadiness.components || !startupReadiness.audio) return;
  startupReadySent = true;
  void send({ kind: "app.ready" });
}

/**
 * App — root layout.
 *
 *   ┌─ TopBar (full width) ───────────────────────────────────────┐
 *   ├─ Sidebar ─┬─ Main column ─────────────────────────────────┤
 *   │ Library   │ TrackList                                      │
 *   │ (full     │                                                │
 *   │  height)  │ ── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
 *   │           │ MasterEqPanel                                  │
 *   └───────────┴────────────────────────────────────────────────┘
 *
 * Sidebar extends to the bottom edge; nothing spans full-width below TopBar.
 * Auto-save persists the project to Dexie ~800ms after the last change.
 */
export function App() {
  useGlobalHotkeys();
  const shouldMountEditorHost = useUiStore((s) => s.openEditors.length > 0 || Boolean(s.trackEffectsEditorTrackId));
  const [showHome, setShowHome] = useState(true);

  function closeHome() {
    setShowHome(false);
  }

  function openHome() {
    if (closeCurrentDocumentForHome()) setShowHome(true);
  }

  async function createFromHome() {
    if (createNewDocument()) closeHome();
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
      window.alert("View in Folder is only available in the native app.");
      return;
    }
    const result = await send({ kind: "project.revealFile", path });
    if (result.ok) return;
    if (result.missing) {
      const shouldRemove = window.confirm("This project file could not be found. Remove it from Recent?");
      if (shouldRemove) await removeRecentFromHome(path);
      return;
    }
    throw new Error(result.error || "Could not reveal this project file.");
  }

  useEffect(() => {
    void pruneBlankUntitledProjects().catch((error) => {
      // eslint-disable-next-line no-console
      console.warn("[Beat] Could not prune blank local project clutter", error);
    });
  }, []);

  useEffect(() => {
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
  }, []);

  useEffect(() => startAnalyzerClient(), []);

  useEffect(() => {
    let hydrated = false;
    let timer: number | null = null;

    void listInstruments()
      .then(({ instruments, sets }) => {
        if (instruments.length > 0 || sets.length > 0) {
          useInstrumentStore.getState().hydrateInstruments(instruments, sets);
        }
        useInstrumentStore.getState().seedSystemInstruments();
        useComponentStore.getState().seedDefaultDrumLoops(useInstrumentStore.getState().instruments);
        const ctx = getTimelineAudioContext();
        for (const instrument of useInstrumentStore.getState().instruments) {
          if (!instrument.sampleUrl) continue;
          void preloadInstrumentSample(ctx, instrument).catch(() => {
            // Synth fallback remains available if a bundled sample cannot decode.
          });
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
    return () => {
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, []);

  useEffect(() => {
    let hydrated = false;
    let timer: number | null = null;

    void listComponents()
      .then((components) => {
        useComponentStore.getState().hydrate(components);
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
        void saveComponents(snapshot);
      }, 800);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, []);

  useEffect(() => {
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
    return () => {
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, []);

  // Browser preview advances its own playhead. In the native app, C++ is the
  // only source of timeline position updates.
  useEffect(() => {
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
          positionBeat <= loopRange.endBeat &&
          next >= loopRange.endBeat
        ) {
          useTransportStore.getState().setPosition(loopRange.startBeat);
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
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Track dirty state on project changes. Explicit Save is the only path that
  // creates or updates a user-visible project document.
  useEffect(() => {
    const unsub = useProjectStore.subscribe(() => {
      scheduleCurrentDocumentDirtyState();
    });
    return () => {
      unsub();
    };
  }, []);

  // Keep the native JUCE engine in step with the React project model. The
  // browser preview mock ignores this, while the standalone app uses it for
  // transport/export playback.
  useEffect(() => {
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
    return () => {
      if (timer) window.clearTimeout(timer);
      unsubProject();
      unsubInstruments();
      unsubAudioFiles();
    };
  }, []);

  useEffect(() => {
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
        case "native.menuCommand":
          void handleNativeMenuCommand(event.command).catch((error) => {
            window.alert(error instanceof Error ? error.message : "Project command failed.");
          });
          break;
        case "native.openProjectFile":
          void openRecentDocument(event.path).catch((error) => {
            window.alert(error instanceof Error ? error.message : "Open project failed.");
          });
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
    return off;
  }, []);

  if (showHome) {
    return (
      <>
        <HomeHub
          onHome={() => undefined}
          onNew={() => void createFromHome()}
          onOpen={() => void openFromHome().catch((error) => window.alert(error instanceof Error ? error.message : "Open failed."))}
          onRecent={(path) => void openRecentFromHome(path).catch((error) => window.alert(error instanceof Error ? error.message : "Open recent failed."))}
          onRevealRecent={(path) => void revealRecentFromHome(path).catch((error) => window.alert(error instanceof Error ? error.message : "View in Folder failed."))}
          onRemoveRecent={(path) => void removeRecentFromHome(path).catch((error) => window.alert(error instanceof Error ? error.message : "Remove recent failed."))}
          onSave={() => void saveFromMenu(false)}
          onSaveAs={() => void saveFromMenu(true)}
          onExport={() => void exportCurrentWav().catch((error) => window.alert(error instanceof Error ? error.message : "Export failed."))}
          onRecover={() => undefined}
          onHealth={() => useUiStore.getState().openEditor({ kind: "projectHealth" })}
          onSettings={() => useUiStore.getState().openEditor({ kind: "preferences" })}
        />
        <ModalStackOverlay />
      </>
    );
  }

  return (
    <>
      <Suspense fallback={null}>
        <Visualizer />
      </Suspense>
      <TimelineMidiPlayback />
      <TrainingAutoRunner />
      <RenderTimingPanel />
      <ExportJobPanel />
      <div className="app-root">
        <TopBar
          onHome={openHome}
          onNew={() => void createFromHome()}
          onOpen={() => void openFromHome().catch((error) => window.alert(error instanceof Error ? error.message : "Open failed."))}
          onSave={() => void saveFromMenu(false)}
          onSaveAs={() => void saveFromMenu(true)}
          onExport={() => void exportCurrentWav().catch((error) => window.alert(error instanceof Error ? error.message : "Export failed."))}
          onExportRange={() => void exportCurrentWav("range").catch((error) => window.alert(error instanceof Error ? error.message : "Range export failed."))}
          onExportTrack={() => void exportCurrentWav("track").catch((error) => window.alert(error instanceof Error ? error.message : "Track export failed."))}
          onRecover={() => void recoverFromMenu()}
          onHealth={() => useUiStore.getState().openEditor({ kind: "projectHealth" })}
          onSettings={() => useUiStore.getState().openEditor({ kind: "preferences" })}
        />
        <main className="app-main">
          <Sidebar />
          <div className="main-col">
            <TrackList />
            <MasterEqPanel />
          </div>
        </main>
      </div>
      {shouldMountEditorHost && (
        <Suspense fallback={null}>
          <EditorHost />
        </Suspense>
      )}
      <ModalStackOverlay />
    </>
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
      createNewDocument();
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
      await exportCurrentWav();
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
    window.alert("Save failed.");
  }
}

async function recoverFromMenu() {
  try {
    await recoverCurrentDocumentFromBackup();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[Beat] Backup recovery failed", error);
    window.alert(error instanceof Error ? error.message : "Backup recovery failed.");
  }
}

type ExportMode = "project" | "range" | "track";

async function exportCurrentWav(mode: ExportMode = "project") {
  const request = {
    project: useProjectStore.getState().project,
    instruments: useInstrumentStore.getState().instruments,
    audioFiles: useAudioFileStore.getState().files,
  };
  const range = useTransportStore.getState().loopRange;
  const selectedTrackIds = useUiStore.getState().selectedTrackIds;
  if (isNative()) {
    if (mode === "range") {
      if (range.endBeat <= range.startBeat) throw new Error("Set a review loop range before exporting a range.");
      const result = await send({
        kind: "project.exportRangeWavAsync",
        ...request,
        startBeat: range.startBeat,
        endBeat: range.endBeat,
        includeTail: true,
      });
      useExportStore.getState().setJob(result.job);
      if (result.error) throw new Error(result.error);
      return;
    }
    if (mode === "track") {
      if (selectedTrackIds.length !== 1) throw new Error("Select exactly one track before exporting a stem.");
      const result = await send({
        kind: "project.exportTrackWavAsync",
        ...request,
        trackId: selectedTrackIds[0],
      });
      useExportStore.getState().setJob(result.job);
      if (result.error) throw new Error(result.error);
      return;
    }
    const result = await send({
      kind: "project.exportWavAsync",
      ...request,
    });
    useExportStore.getState().setJob(result.job);
    if (result.error) throw new Error(result.error);
    return;
  }

  if (mode === "range") {
    if (range.endBeat <= range.startBeat) throw new Error("Set a review loop range before exporting a range.");
    const result = await send({
      kind: "project.exportRangeWav",
      ...request,
      startBeat: range.startBeat,
      endBeat: range.endBeat,
      includeTail: true,
    });
    if (result.error) throw new Error(result.error);
    return;
  }
  if (mode === "track") {
    if (selectedTrackIds.length !== 1) throw new Error("Select exactly one track before exporting a stem.");
    const result = await send({
      kind: "project.exportTrackWav",
      ...request,
      trackId: selectedTrackIds[0],
    });
    if (result.error) throw new Error(result.error);
    return;
  }

  const result = await send({
    kind: "project.exportWav",
    ...request,
  });
  if (result.error) throw new Error(result.error);
}
