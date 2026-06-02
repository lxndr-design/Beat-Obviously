import { useEffect } from "react";
import { TopBar } from "./features/TopBar/TopBar";
import { Sidebar } from "./features/Sidebar/Sidebar";
import { TrackList } from "./features/Tracks/TrackList";
import { MasterEqPanel } from "./features/Eq/MasterEqPanel";
import { Visualizer } from "./features/Visualizer/Visualizer";
import { EditorHost } from "./features/EditorHost/EditorHost";
import { ModalStackOverlay } from "./components";
import { TimelineMidiPlayback } from "./audio/TimelineMidiPlayback";
import { startAnalyzerClient } from "./audio/analyzerClient";
import { RenderTimingPanel } from "./features/Debug/RenderTimingPanel";
import { TrainingAutoRunner } from "./features/Training/TrainingAutoRunner";
import { getTimelineAudioContext, stopTimelineAudio } from "./audio/timelineAudio";
import { importAudioFiles } from "./audio/audioImport";
import { preloadInstrumentSample } from "./audio/synthPreview";
import { useGlobalHotkeys } from "./hotkeys/hotkeys";
import { isNative, onEvent, send } from "./ipc/bridge";
import { createEmptyProject, useAudioFileStore, useInstrumentStore, useProjectStore, useTransportStore, useUiStore } from "./state/store";
import { useComponentStore } from "./state/components";
import { listAudioFiles, listComponents, listInstruments, listProjects, loadProject, saveAudioFiles, saveComponents, saveInstruments, saveProject } from "./persistence/dexie";
import { useEffect as useReactEffect } from "react";

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

  useEffect(() => startAnalyzerClient(), []);

  useEffect(() => {
    let hydrated = false;
    let timer: number | null = null;

    void listInstruments().then(({ instruments, sets }) => {
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
    });

    const unsub = useInstrumentStore.subscribe((state) => {
      if (!hydrated) return;
      if (timer) window.clearTimeout(timer);
      const instruments = state.instruments.map((instrument) => structuredClone(instrument));
      const sets = state.instrumentSets.map((set) => structuredClone(set));
      timer = window.setTimeout(() => {
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

    void listComponents().then((components) => {
      useComponentStore.getState().hydrate(components);
      hydrated = true;
    });

    const unsub = useComponentStore.subscribe((state) => {
      if (!hydrated) return;
      if (timer) window.clearTimeout(timer);
      const snapshot = state.components
        .filter((component) => !component.factory)
        .map((component) => structuredClone(component));
      timer = window.setTimeout(() => {
        void saveComponents(snapshot);
      }, 800);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, []);

  useEffect(() => {
    void (async () => {
      for (const file of await listAudioFiles()) useAudioFileStore.getState().addFile(file);
      const resp = await send({ kind: "audio.list" });
      for (const file of resp.files) useAudioFileStore.getState().addFile(file);
    })();
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    const unsub = useAudioFileStore.subscribe((state) => {
      if (timer) window.clearTimeout(timer);
      const files = state.files.map((file) => structuredClone(file));
      timer = window.setTimeout(() => {
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
  useReactEffect(() => {
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
        const { speed, positionBeat } = useTransportStore.getState();
        const deltaBeats = (dtMs / 1000) * (bpm / 60) * speed;
        const next = positionBeat + deltaBeats;
        // Loop at end of project length.
        const len = useProjectStore.getState().project.lengthBeats;
        const wrapped = len > 0 && next >= len ? 0 : next;
        useTransportStore.getState().setPosition(wrapped);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Debounced auto-save → Dexie on any project change.
  useEffect(() => {
    let timer: number | null = null;
    const unsub = useProjectStore.subscribe((state) => {
      if (timer) window.clearTimeout(timer);
      const snapshot = state.project;
      timer = window.setTimeout(() => {
        void saveProject(snapshot);
      }, 800);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
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
      const project = structuredClone(useProjectStore.getState().project);
      const instruments = useInstrumentStore.getState().instruments.map((instrument) => structuredClone(instrument));
      timer = window.setTimeout(() => {
        void send({ kind: "engine.applyProject", project, instruments });
      }, 120);
    };
    apply();
    const unsubProject = useProjectStore.subscribe(() => apply());
    const unsubInstruments = useInstrumentStore.subscribe(() => apply());
    return () => {
      if (timer) window.clearTimeout(timer);
      unsubProject();
      unsubInstruments();
    };
  }, []);

  useEffect(() => {
    const off = onEvent((event) => {
      switch (event.kind) {
        case "transport.positionChanged":
          useTransportStore.getState().setPosition(event.positionBeat);
          break;
        case "transport.playbackEnded":
          useTransportStore.getState().pause();
          stopTimelineAudio();
          break;
        case "native.menuCommand":
          void handleNativeMenuCommand(event.command);
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

  return (
    <>
      <Visualizer />
      <TimelineMidiPlayback />
      <TrainingAutoRunner />
      <RenderTimingPanel />
      <div className="app-root">
        <TopBar />
        <main className="app-main">
          <Sidebar />
          <div className="main-col">
            <TrackList />
            <MasterEqPanel />
          </div>
        </main>
      </div>
      <EditorHost />
      <ModalStackOverlay />
    </>
  );
}

async function handleNativeMenuCommand(command: "newProject" | "openProject" | "saveProject" | "importAudio" | "exportWav" | "preferences") {
  switch (command) {
    case "newProject": {
      const ok = window.confirm("Create a new project? Unsaved changes are auto-saved locally, but the current workspace view will reset.");
      if (!ok) return;
      useTransportStore.getState().stop();
      useProjectStore.getState().loadProject(createEmptyProject());
      return;
    }
    case "openProject": {
      const localProjects = await listProjects();
      if (localProjects.length === 0) {
        window.alert("No saved projects yet.");
        return;
      }
      const menu = localProjects
        .map((project, index) => `${index + 1}. ${project.name}`)
        .join("\n");
      const choice = window.prompt(`Open project:\n${menu}`, "1");
      const index = Number(choice) - 1;
      if (!Number.isInteger(index) || !localProjects[index]) return;

      const project = await loadProject(localProjects[index].id);
      if (project) {
        useTransportStore.getState().stop();
        useProjectStore.getState().loadProject(project);
      }
      return;
    }
    case "saveProject": {
      const project = useProjectStore.getState().project;
      await Promise.all([
        saveProject(project),
        send({ kind: "project.save", project }),
      ]);
      return;
    }
    case "importAudio": {
      const files = await importAudioFiles();
      for (const file of files) useAudioFileStore.getState().addFile(file);
      return;
    }
    case "exportWav":
      await send({ kind: "project.exportWav" });
      return;
    case "preferences":
      useUiStore.getState().openEditor({ kind: "preferences" });
      return;
  }
}
