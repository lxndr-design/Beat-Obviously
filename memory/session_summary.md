---
name: session-summary
description: Compressed snapshot of the long Beat-app session. Read this first when resuming.
metadata:
  type: session
---

# Beat — session export (2026-05-23 → 2026-05-24)

## What got built
A near-complete frontend for a beat-sequencing DAW + the C++ JUCE backend skeleton (not yet wired to the running preview). 87 tasks tracked, all completed. The app runs at **http://localhost:6174** via `mcp__Claude_Preview__preview_start "beat-frontend"`.

## Major architectural decisions
- **JUCE 8 C++ audio engine + React/TS UI** in an embedded WKWebView (hybrid native + web). Backend in `backend/`, frontend in `frontend/`.
- **macOS-first**, standalone app only (no plugin variants).
- **SQLite via JUCE** on the C++ side; **Dexie/IndexedDB** as a frontend cache mirror with debounced auto-save.
- **Three.js for visualizer** behind a swappable `Visualizer` interface (background only, low-priority).
- **AI service stubbed** (`MockAiService` in `ai/aiService.ts`); ready to swap for Anthropic API later.

## Final layout
- **TopBar (48px)**: BrandMark (white square + note glyph) → Preferences (32×32) → ⏮ ▶ ⏹ → time `M:SS:cs` (no frame) → 4/4 dropdown → BPM → Speed% → spacer → Save + Export
- **Sidebar (resizable 160–480px, full height)**: Instruments section + Components section, each flex 1
- **Main column**: TrackList block on top, Mastering panel (160px) at bottom
- **TrackList**: split-column grid — sticky header column (drag handle, name, S/M dots) + horizontal-scroll lane column (segments + timeline + floating zoom cluster at bottom-right of viewport)
- **Mastering**: mini ribbon ("Mastering" + edit pencil) + 7-band EQ graph with smooth curve, outline dots, gradient fill, micro Hz labels

## Stores at a glance
| Store | File | Undoable | Purpose |
|---|---|---|---|
| `useProjectStore` | state/store.ts | yes (zundo) | Tracks, segments, EQ automation |
| `useTransportStore` | state/store.ts | no | playing/position/speed/loop |
| `useUiStore` | state/store.ts | no | selection + openEditors |
| `useViewStore` | state/store.ts | no | zoom, sidebar width, last segment length |
| `useSettingsStore` | state/store.ts | no | resize-snap config |
| `useInstrumentStore` | state/store.ts | no | library + merge/duplicate |
| `useComponentStore` | state/components.ts | no | saved MIDI patterns |
| `clipboardStore` | state/clipboard.ts | no | segment copy/paste |

## Files of interest
- **Design**: `frontend/src/design/{tokens.css, reset.css, animations.css, typography.css, global.css, README.md}`
- **Components**: `frontend/src/components/{Button, Modal, Block, Icon, Knob, NumberInput, HoverInfo, Toggle, DitheredImage, ContextMenu}/`
- **Features**:
  - TopBar — `features/TopBar/{TopBar, BrandMark, InlineNumber}.tsx`
  - Sidebar — `features/Sidebar/Sidebar.tsx`
  - Instruments — `features/InstrumentLibrary/InstrumentLibraryPanel.tsx`, `features/InstrumentEditor/{InstrumentEditorModal, WaveformPicker}.tsx`, `features/InstrumentLibrary/MergeInstrumentModal.tsx`
  - Components (saved patterns) — `features/ComponentLibrary/ComponentLibraryPanel.tsx`
  - Tracks — `features/Tracks/{TrackList, TrackHeader, TrackLane, Timeline, Playhead, Segment, SegmentMidiPreview, SegmentWaveform, geometry}.tsx`
  - Transport / TS — `features/Transport/TimeSignatureModal.tsx`
  - Segment editor — `features/SegmentEditor/SegmentEditorModal.tsx`
  - MIDI editor — `features/MidiEditor/{PianoRoll, MidiTransport}.tsx`
  - EQ — `features/Eq/{MasterEqPanel, EqGraph, VerticalSlider}.tsx`, `features/EqAutomation/EqAutomationModal.tsx`
  - Visualizer — `features/Visualizer/{Visualizer, visualizerApi}.ts`
- **Backend**: `backend/Source/{Main, MainComponent}.cpp`, `backend/Source/Audio/{AudioEngine, Sequencer, TrackModel, InstrumentVoice}.cpp`, `backend/Source/Audio/Effects/{Bitcrush, MasterEq}.cpp`, `backend/Source/Persistence/{Database, ProjectRepository, InstrumentRepository}.cpp`, `backend/Source/Ipc/{Schema.h, MessageBridge.cpp}`.

## Most-recently-applied tweaks (recall context for resuming)
- Knob `formatValue` capped at 2 decimals (no more `0.000`).
- Detune knob: `¢` unit removed.
- Knob/NumberInput labels: 13px / line-height 1.1.
- Internal stacks: 4px gap between dial/value/label.
- Instrument editor uses a unified 2-col CSS grid so name/type widths match macros/envelope widths.
- WaveformPicker is a radio-group of icon buttons (no dropdown).
- Synth params extended: `detuneCents, octave, subOscLevel, glideMs, lfoRateHz, lfoDepth`.

## Known follow-ups (when resuming)
- **JUCE bridge wiring**: `backend/Source/Ipc/MessageBridge::install()` is sketched but the actual JS↔C++ native-function hook depends on JUCE 8 specifics. Frontend mock bridge handles all messages in dev.
- **PROJECT_SAVE deserialization**: backend has the JSON encoder, needs the inverse parser. Currently round-trips through a JSON blob without re-applying.
- **Audio segment full editor**: only a stub modal exists for `audio` payload segments.
- **Cross-track segment drag**: only same-track drag works today; cross-row pointer hit-testing is a TODO in `Segment.tsx`.
- **VST3/AU hosting** + **Windows/Linux builds** — explicitly deferred to post-v1 per roadmap in README.
- **Live Anthropic AI integration** — interface is in place; swap `MockAiService` for an `AnthropicAiService` implementation when wiring keys.

## Gotchas (already discovered, don't repeat)
- **Vite CSS Modules**: must use `localsConvention: "camelCase"` (NOT `"camelCaseOnly"`). The latter strips kebab-case keys, breaking dynamic class access like `styles[\`size-${size}\`]`. Symptom: buttons render at 64×64 because `size-md` class doesn't get applied; only `iconOnly` + base does.
- **CSS variable must exist**: e.g. `--button-square-xs` was once missing while CSS referenced it. Symptom: `grid-template-columns: var(--button-square-xs) 1fr auto` collapses to a single 239px column.
- **`input:focus-visible` in reset.css** wins over `.input { outline: 0 }`. Beat it with higher specificity: `.wrap .input:focus-visible { outline: 0 }`.
- **`.dot.dotOn:hover`** needs higher specificity to beat `.dot:hover`. Use compound selector.
- **`Edit` tool requires `Read` first** within the same turn — silently fails otherwise. Pattern: when in doubt, `Read` then `Edit`.

## Quick-start commands
```bash
# Frontend dev preview (uses .claude/launch.json beat-frontend at port 6174)
mcp: preview_start "beat-frontend"

# TypeScript check (always run before declaring done)
cd /Users/alexcheng/beat/frontend && npx tsc -b --noEmit

# Full app build (not yet validated end-to-end)
cd /Users/alexcheng/beat && cmake -B build -G Xcode && cmake --build build --config Release
```

## Pointers
- Design rules: [[feedback-design-system]]
- User collaboration preferences: [[user-profile]]
- Project architecture: [[project-beat]]
