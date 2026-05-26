# Beat

A beat sequencing DAW. Hybrid architecture: JUCE 8 (C++20) audio engine + React/TypeScript UI in an embedded WKWebView, packaged as a single macOS `.app`.

## Why this architecture

- **JUCE backend** for real-time audio: sample-accurate sequencing, low-latency CoreAudio output, MIDI I/O, DSP (EQ, bitcrush), sample loading, SQLite persistence.
- **React/TS frontend** for everything visual: design system, component library, modals, drag-and-drop, visualizer. Lives in `frontend/`, served inside the JUCE app via `juce::WebBrowserComponent`.
- **IPC** via JUCE 8's native JS↔C++ message passing — typed schema kept in sync between `backend/Source/Ipc/Schema.h` and `frontend/src/ipc/schema.ts`.

This split lets us keep the strict CSS-driven design system (impossible to reproduce cleanly in C++ UI frameworks) while having a real audio engine underneath.

## Layout

```
beat/
├── CMakeLists.txt              # top-level — drives JUCE + frontend bundling
├── backend/                    # JUCE 8 C++20 audio engine + app shell
│   ├── CMakeLists.txt
│   └── Source/
│       ├── Main.cpp
│       ├── MainComponent.{h,cpp}
│       ├── Audio/              # real-time DSP, sequencer, tracks, instruments
│       ├── Persistence/        # SQLite repositories
│       └── Ipc/                # message bridge to web UI
├── frontend/                   # React + Vite + TypeScript
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── design/             # tokens, reset, typography, animations
│       ├── components/         # primitives (Button, Modal, Knob, ...)
│       ├── features/           # Tracks, Sequencer, InstrumentLibrary, ...
│       ├── state/              # Zustand stores + undo/redo
│       ├── ipc/                # JUCE bridge wrapper + typed schema
│       ├── ai/                 # AiService interface (stubbed for v1)
│       └── hotkeys/
└── memory/                     # project notes (Claude memory)
```

## Build (macOS)

Prerequisites: CMake ≥ 3.22, Xcode 15+, Node ≥ 20, JUCE 8 (fetched automatically by CMake), pnpm or npm.

```bash
# Frontend dev (live-reload while building UI in isolation)
cd frontend && npm install && npm run dev

# Full app build
cmake -B build -G Xcode
cmake --build build --config Release
open build/backend/Beat_artefacts/Release/Beat.app
```

In dev mode, set `BEAT_DEV_FRONTEND_URL=http://localhost:5173` before launching the app to point the embedded webview at the Vite dev server. In production builds, the frontend `dist/` is embedded via JUCE BinaryData and served from `beat://` (custom scheme handler).

## Design system

See [frontend/src/design/README.md](frontend/src/design/README.md). Short version: only `#000` and `#fff`, Helvetica Neue, 8px grid, no button outlines, transitions are slides or color inversions, all images dithered B&W.

## Roadmap (post-v1)

- VST3/AU plugin hosting via JUCE's plugin host
- Cloud sync (Postgres/Supabase) behind the existing repository interfaces
- Live Anthropic AI integration (interface is already stubbed)
- openFrameworks visualizer backend (plugs into the existing `Visualizer` interface)
- Windows/Linux builds (JUCE is cross-platform; just CI work)
