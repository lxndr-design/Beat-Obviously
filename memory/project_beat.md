---
name: project-beat
description: Beat is a beat sequencing DAW the user is building from scratch in /Users/alexcheng/beat. Hybrid architecture chosen after deliberation.
metadata:
  type: project
---

Beat is a from-scratch beat sequencing app being built at `/Users/alexcheng/beat`.

**Architecture (decided 2026-05-23):**
- Backend: JUCE 8 / C++20, CMake, macOS-first (CoreAudio + Metal)
- Frontend: React + TypeScript + Vite, served inside JUCE's embedded WKWebView
- IPC: JUCE 8 native message passing (`WebBrowserComponent::evaluateJavascript` + JS→C++ message handlers)
- Persistence: SQLite (via JUCE) on the backend, Dexie/IndexedDB as a frontend cache mirror
- Visualizer: Three.js / WebGL behind a `Visualizer` interface so openFrameworks could plug in later
- AI: stubbed `AiService` interface, no live Anthropic calls in v1

**Scope decisions:**
- macOS only for v1; cross-platform later via JUCE
- Standalone app only, no VST3/AU hosting or plugin builds in v1
- Single .app bundle output (frontend built into JUCE BinaryData)

**Why:** User explicitly chose JUCE/C++ + web UI hybrid over Tauri or pure web because they want a serious DAW-grade audio engine while keeping the CSS-based design system they specified. They want long-term expandable architecture.

**How to apply:** New features should respect the boundary — audio/timing/DSP/MIDI/file IO live in C++, all UI lives in React. Cross-cutting changes need both sides updated and the IPC schema (`backend/Source/Ipc/Schema.h` + `frontend/src/ipc/schema.ts`) kept in sync. See also [[feedback-design-system]].
