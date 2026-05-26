import { useEffect } from "react";
import { TopBar } from "./features/TopBar/TopBar";
import { Sidebar } from "./features/Sidebar/Sidebar";
import { TrackList } from "./features/Tracks/TrackList";
import { MasterEqPanel } from "./features/Eq/MasterEqPanel";
import { Visualizer } from "./features/Visualizer/Visualizer";
import { EditorHost } from "./features/EditorHost/EditorHost";
import { ModalStackOverlay } from "./components";
import { TimelineMidiPlayback } from "./audio/TimelineMidiPlayback";
import { getTimelineAudioContext } from "./audio/timelineAudio";
import { preloadInstrumentSample } from "./audio/synthPreview";
import { useGlobalHotkeys } from "./hotkeys/hotkeys";
import { onEvent, send } from "./ipc/bridge";
import { useAudioFileStore, useInstrumentStore, useProjectStore, useTransportStore } from "./state/store";
import { useComponentStore } from "./state/components";
import { saveProject } from "./persistence/dexie";
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

  useEffect(() => {
    useInstrumentStore.getState().seedSystemInstruments();
    useComponentStore.getState().seedDefaultDrumLoops(useInstrumentStore.getState().instruments);
    const ctx = getTimelineAudioContext();
    for (const instrument of useInstrumentStore.getState().instruments) {
      if (!instrument.sampleUrl) continue;
      void preloadInstrumentSample(ctx, instrument).catch(() => {
        // Synth fallback remains available if a bundled sample cannot decode.
      });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const resp = await send({ kind: "audio.list" });
      for (const file of resp.files) useAudioFileStore.getState().addFile(file);
    })();
  }, []);

  // Smooth playhead: while playing, advance positionBeat each animation
  // frame based on elapsed wall-clock and current BPM. The C++ engine
  // (when running) will also emit `transport.positionChanged`; whichever
  // is more recent wins.
  useReactEffect(() => {
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

  useEffect(() => {
    const off = onEvent((event) => {
      switch (event.kind) {
        case "transport.positionChanged":
          useTransportStore.getState().setPosition(event.positionBeat);
          break;
        case "transport.playbackEnded":
          useTransportStore.getState().pause();
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
