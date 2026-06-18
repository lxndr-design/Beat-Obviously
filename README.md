# Beat

A beat sequencing DAW. Hybrid architecture: JUCE 8 (C++20) audio engine + Solid/TypeScript UI in an embedded WKWebView, packaged as a single macOS `.app`.

## Why this architecture

- **JUCE backend** for real-time audio: sample-accurate sequencing, low-latency CoreAudio output, MIDI I/O, DSP (EQ, bitcrush), sample loading, SQLite persistence.
- **Solid/TS frontend** for everything visual: design system, component library, modals, drag-and-drop, visualizer. Lives in `frontend/`, served inside the JUCE app via `juce::WebBrowserComponent`.
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
├── frontend/                   # Solid + Vite + TypeScript
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
cmake -B build-native -G Xcode
cmake --build build-native --config Release

# Package/register the canonical repo-root launcher
./scripts/package-macos.sh
open ./Beat.app

# Or register an already-packaged root app for .beat files
./scripts/register-current-beat-app.sh ./Beat.app
```

`build-native/backend/Beat_artefacts/Release/Beat.app` is the CMake/JUCE build artifact.
Use the repo-root `Beat.app` as the manual launcher and LaunchServices-registered app.

In dev mode, set `BEAT_DEV_FRONTEND_URL=http://localhost:6174` before launching the app to point the embedded webview at the Vite dev server. On startup, the native app checks that the configured port is actually serving the Beat frontend before loading it, adds a launch cache-buster, and refreshes the dev webview once to avoid stale startup documents. If the dev URL is unavailable or occupied by the wrong server, a bundled frontend build is used when present.

In production builds, `frontend/dist/` is copied into `Beat.app/Contents/Resources/frontend` and served by JUCE's `WebBrowserComponent::Options::withResourceProvider()`. The native menu sends commands into the Solid UI through the JUCE native bridge exposed as `window.__BEAT_NATIVE__`.

## Design system

See [frontend/src/design/README.md](frontend/src/design/README.md). Short version: only `#000` and `#fff`, Helvetica Neue, 8px grid, no button outlines, transitions are slides or color inversions, all images dithered B&W.

## Roadmap (post-v1)

- [DAW comprehensiveness roadmap](docs/daw-comprehensiveness-roadmap.md) — focused pass plan for moving Beat from prototype DAW coverage to v1-complete DAW workflows.
- [DAW parallel execution plan](docs/daw-parallel-execution-plan.md) — worker split, file locks, serial contracts, and verification gates for the comprehensiveness pass.
- [DAW + Aether roadmap](docs/serum-style-synth-roadmap.md) — broader product and engine progress tracker.
- VST3/AU plugin hosting via JUCE's plugin host
- Cloud sync (Postgres/Supabase) behind the existing repository interfaces
- Live Anthropic AI integration (interface is already stubbed)
- openFrameworks visualizer backend (plugs into the existing `Visualizer` interface)
- Windows/Linux builds (JUCE is cross-platform; just CI work)
