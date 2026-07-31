# Beat Overview

Beat is a desktop digital audio workstation for writing, arranging, recording,
designing, mixing, and exporting music in one project. The current application
combines a JUCE/C++ real-time audio engine with a Solid/TypeScript interface and
is packaged as a native macOS app.

Beat is currently a pre-1.0 product. Its main workflows and native instrument
engines are functional and extensively verified, while release hardening,
content refinement, and several advanced synthesis and hosting features remain
active work.

## What Beat Does

- Creates project-contained arrangements with MIDI, drum, audio, live-record,
  automation, and group tracks.
- Edits MIDI in a piano roll and percussion in a step-oriented drum editor.
- Records audio from available macOS input devices and keeps layered takes with
  their live-record segment.
- Reuses instrument-independent MIDI patterns and audio assets from searchable
  project libraries.
- Routes instruments and tracks through inserts, buses, sends, returns, master
  processing, metering, and render diagnostics.
- Exports full mixes, ranges, individual stems, or all renderable stems after a
  project-health check.
- Stores a project as a `.beat` document with project-local assets, backups,
  recovery data, and exports grouped under its project folder.

## Instrument Engines

Beat's instruments are complementary sound-design systems rather than alternate
skins over one generic synthesizer.

| Engine | Specialization | Best suited for |
| --- | --- | --- |
| **Aether** | Focused wavetable synthesis and the stable foundation for Beat's synth rendering. | General-purpose pads, basses, leads, keys, bells, and designed electronic tones. |
| **Lumen** | Three-source hybrid synthesis combining wavetable, sample, multisample/SFZ, and granular material. | Layered and evolving pads, modern basses and leads, plucks, atmospheres, granular textures, and sample-synthesis hybrids. |
| **Aurum** | Six-operator FM, ring modulation, additive synthesis, feedback, and matrix-based output routing. | Digital keys, organs, bells, metallic or inharmonic tones, animated basses, feedback leads, additive pads, and experimental timbres. |
| **Nodemap** | Visual modular synthesis assembled from audio, control, utility, modulation, and effect nodes. | Custom signal paths, modular experiments, reusable graph instruments, and unusual control relationships. |
| **Sampler** | One-shot, sliced, looped, and mapped sample playback, including managed sample zones. | Drums, recorded material, multisampled acoustic instruments, imported audio, and sample libraries. |
| **DecentSampler bridge** | Safe import of compatible DecentSampler packages into Beat-managed sampler instruments. | Playing supported `.dspreset` and packaged sample libraries without claiming to host the official DecentSampler runtime. |

### Aether

Aether is Beat's established wavetable synthesizer and compatibility reference.
It provides two principal oscillators, wavetable creation and scanning, stereo
unison, modulation, filters, macros, expression, and instrument effects. Its
sound and persistence contracts are intentionally stable so newer engines can
reuse proven primitives without silently changing existing Aether patches.

### Lumen

Lumen is Beat's broad hybrid sound-design engine and the separately versioned
successor to Aether. Each of its fixed A/B/C source slots can independently use
Wavetable, Sample, Multisample/SFZ, or Granular mode. The slots have individual
routing, sends, tuning, playback state, and source assets.

Lumen adds prepared spectral-harmonic wavetable warps, bounded sample slicing,
direction/rate and ping-pong loop behavior, release tails, dual-filter routing,
per-route modulation curves, keytracked LFO rates, an arpeggiator, and a
polyphonic relative-note clip. Its defining strength is combining different
sound materials inside one playable patch.

In short: **Lumen specializes in choosing, layering, and transforming sound
sources.**

### Aurum

Aurum is Beat's deep operator-based engine. Six independently configured
operators can act as audible carriers or as modulators through separate bipolar
FM and ring/amplitude-modulation matrices. A dedicated output matrix routes each
operator to Filter A, Filter B, or Direct.

Each operator supports conventional waveforms or a sixteen-partial additive
spectrum, ratio/coarse/fine tuning, wavefold, phase, pan, velocity and keyboard
response, and independent amplitude, pitch, and phase envelopes. Aurum also
provides unison, bounded feedback, selectable operator-network quality,
algorithm templates, performance modulation, and live signal-flow diagnostics.

In short: **Aurum specializes in constructing how oscillators influence one
another.**

### Nodemap and Sample Instruments

Nodemap offers a graph-first alternative to fixed synthesizer panels. Its
protected `Instrument Out` endpoint makes audible routing explicit, while its
nodes cover sources, CV, envelopes, LFOs, utilities, filters, dynamics, and
effects. Saved graphs are validated and rendered by Beat's native Nodemap path.

Sampler instruments turn audio files and mapped zones into playable instruments.
They underpin factory drums, imported samples, multisample/SFZ playback, and the
DecentSampler compatibility bridge. Imported package support is an adapter into
Beat's sampler; Beat does not currently execute third-party AU or VST3 binaries.

## Arrangement, Mixing, and Export

The arrangement timeline coordinates segments, looping, automation timepoints,
track state, tempo, meter, and playback. MIDI-editor playback and arrangement
playback share the native instrument path. Audio tracks and live-record segments
use the same project asset and routing model as imported files.

The mixer provides track and bus input, gain, pan, inserts, sends, return paths,
and master processing. Beat's render-timing and diagnostic-log overlays expose
callback load, voice work, routing work, missed deadlines, safety mutes, and
project/runtime events without requiring a separate debug build.

Export uses the native playback graph so live and offline paths retain the same
instrument, routing, and effect order. Project Health checks structure and asset
availability before a render; errors block export while warnings remain visible
for review.

## Project and Recovery Model

A saved project is centered on one `.beat` document inside a folder named for
the project. Related assets, backups, recovery state, recordings, and exports
belong under that project folder rather than being placed beside it as unrelated
top-level items.

Beat maintains recent-project metadata, validated backups, project-local
recovery snapshots, and structural health checks. Finder document opening,
Recent Projects, native document delivery, and LaunchServices registration are
separate parts of the macOS file-open workflow and are verified independently.

## Application Architecture

- **Native shell and audio:** JUCE 8 with C++20 owns devices, MIDI, scheduling,
  voices, DSP, recording, persistence, analysis, and offline rendering.
- **Interface:** Solid and TypeScript own the Home Hub, arrangement, editors,
  libraries, dialogs, preferences, diagnostics, and the shared monochrome UI
  kit.
- **Bridge:** typed JUCE IPC connects frontend commands and native state without
  moving real-time DSP into the web interface.
- **Persistence:** versioned project and instrument schemas preserve older
  documents through explicit migrations rather than implicit reinterpretation.
- **Verification:** source verifiers, browser fixtures, deterministic render
  comparisons, native stress tests, and packaged-app checks cover different
  layers and are reported separately.

See [README.md](README.md) for build instructions and
[the current architecture](docs/app-architecture-current.md) for the detailed
component map.

## Current Direction

Near-term work emphasizes release reliability, project/file workflows, UI
hardening, measured audio performance, and deeper verification of the existing
engines. Lumen continues toward richer hybrid and modulation workflows; Aurum
continues toward broader articulation, modulation, spectral evidence, and
factory-patch listening sign-off. Third-party binary plug-in hosting remains a
future protected-host feature rather than a current capability.

Detailed plans live in the
[DAW comprehensiveness roadmap](docs/daw-comprehensiveness-roadmap.md),
[remaining-work checklist](docs/remaining-work-checklist.md),
[Lumen architecture and benchmarks](docs/audio/lumen-architecture.md), and
[Aurum roadmap](docs/audio/aurum-roadmap.md).

## Documentation Map

- [User guide](docs/user-guide.html)
- [Changelog](CHANGELOG.md)
- [Application architecture](docs/app-architecture-current.md)
- [Project structure](docs/project-structure.md)
- [Aether benchmark](docs/audio/aether-serum-benchmark.md)
- [Lumen architecture](docs/audio/lumen-architecture.md)
- [Lumen hybrid-engine benchmark](docs/audio/lumen-serum2-benchmark.md)
- [Aurum synth reference](docs/audio/aurum-synth.md)
- [Aurum roadmap](docs/audio/aurum-roadmap.md)
- [Nodemap engine checklist](docs/nodemap-engine-checklist.md)
- [Export audit](docs/audio/export-audit-2026-07-27.md)
