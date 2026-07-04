# Plugin-Style Import Adapters

Beat treats third-party instrument packages as import adapters before it treats
them as live plugin hosts. The adapter owns package parsing, asset safety, and
metadata preservation first. A package may later be rendered or converted into
native Beat assets, but import itself should not pretend that a third-party
runtime is already running in the audio callback.

For user-facing plugin help, compatibility status, and adapter-development
guidance, see `docs/plugin-help.html`.

## Compatibility matrix

| Format | Status | Supported behavior | Unsupported behavior |
| --- | --- | --- | --- |
| DecentSampler `.dspreset` | Supported in the native app | XML parsing, sample-zone import, UI metadata preservation, Beat sampler bridge, MIDI/drum editor mode | Official DecentSampler runtime hosting |
| DecentSampler `.zip` | Supported in the native app | Safe extraction, preset discovery, sample registration, package wrapper, associated instrument creation | Browser-only full extraction |
| Beat native Aether | Supported | Wavetable patch editing, modulation, instrument FX, audition, live/export rendering | External binary plugin loading |
| Beat native Nodemap | Supported and maturing | Protected Instrument Out, modular nodes, cables, audition, persistence, live/export path | Public third-party node authoring SDK |
| AU `.component` | Placeholder metadata only | Future intent can be represented in project data | Live execution, scanning, UI hosting, audio callback processing |
| VST3 `.vst3` | Placeholder metadata only | Future intent can be represented in project data | Live execution, scanning, UI hosting, audio callback processing |

## Adapter development checklist

Until Beat has a public plugin SDK, new plugin work should be a safe adapter
around serializable data:

- Choose an adapter `format` and `kind`.
- Parse/import package metadata without executing third-party code.
- Copy or register all referenced assets into Beat-managed storage.
- Create or link an associated Beat instrument when the adapter plays notes.
- Declare capabilities, realtime/offline support, latency, and fallback mode.
- Add project-health checks for missing files, missing associated instruments,
  unsupported runtime modes, and stale references.
- Add verifier or backend stress coverage for import, save/open, live playback,
  and export.

## Decent Sampler baseline

Decent Sampler packs are the first adapter target.

- `.dspreset` files are parsed as XML sample maps.
- `.zip` packs are extracted by the native app into an app-managed Decent
  Sampler import folder.
- Relative sample paths from the preset are resolved against the extracted
  preset location.
- Valid referenced audio files are registered with Beat's audio database.
- The preset UI metadata is preserved when available: background image path,
  declared width/height, visible control labels, control geometry, default/range
  values, and DecentSampler binding metadata.
- Installed packs are registered as `decent-sampler` plugin adapters with a
  package-wrapper surface plus live sampler-compatible capability metadata.
  Opening the package from the DS rail uses the protected package wrapper
  instead of the generic Aether instrument editor.
- Installing or refreshing a package parses/registers the package, prepares a
  Beat-compatible MIDI sampler instrument from the parsed DecentSampler zones,
  and opens the DS wrapper. That compatibility artifact does not create an
  Aether patch, does not set an Aether fallback, and does not open the synth
  editor.
- The package adapter stores the hidden Beat sampler bridge id as
  `associatedInstrumentId` in both frontend and native project documents.
  Project integrity checks warn when that bridge is missing, so a reopened DS
  package cannot silently fall back to a synth placeholder.
- Backend stress includes the Lorenzo DecentSampler drum package as a native
  sampler playback/export fixture, which protects the DS drum-kit flow from
  falling back to a generic synth sound.
- Older persisted adapters that were accidentally stored as generic synth/bridge
  plugins are migrated back into `decent-sampler` renderer adapters when their
  vendor, name, source file, source path, or description identifies them as
  DecentSampler packages.
- Sample-zone start/end offsets are preserved from `.dspreset` metadata,
  saved in `.beat` documents, packaged with sidecar assets, and honored by both
  native playback/export and browser-side preview. This is required for drum
  kits that map slices from longer source WAVs.

The parser lives in `backend/Source/Audio/Sampler/DecentSamplerImporter.*` so
native IPC and backend stress tests exercise the same code path. The current
fixture stress tests import local Pianobook Decent Sampler ZIPs when present:
one builds a sampler-backed MIDI track and verifies live/export audio, and one
asserts package UI metadata including skin, dimensions, controls, and bindings.
Dedicated sampler stress coverage also verifies start/end sample slicing so
zone playback starts at the mapped region rather than the beginning of the
source file.

This keeps package inspection and asset registration safe while avoiding a
half-hosted Decent Sampler runtime in the audio thread. If a future live plugin
bridge is unavailable, Beat can still fall back to rendered audio or a native
sampler conversion while preserving the original source metadata.

## Effect plugin placeholders

Track effect chains can now carry a `plugin` effect node with `pluginId`,
`pluginName`, `pluginFormat`, params, and automation metadata. The native
engine treats these nodes as safe pass-through processors until an actual
plugin host/bridge is installed and registered. This lets project files and
future UI work represent third-party effect intent without risking crashes,
blocking calls, or unbounded DSP inside the audio callback.

## Safety rules

- ZIP entries are rejected if they are absolute paths, contain drive prefixes,
  or contain `.` / `..` path segments.
- Imported packs are copied/extracted outside the original download location so
  reopened projects do not depend on the user's Downloads folder.
- Browser preview can register a lightweight package shell when native file
  system access is unavailable; native app ZIP import is required for full pack
  extraction, metadata parsing, and audio-file registration.
