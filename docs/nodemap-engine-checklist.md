# Nodemap Engine Checklist

This checklist tracks Nodemap as a real modular synth engine surface. The current frontend compiler still bridges Nodemap graphs into the existing instrument patch path so the editor remains playable while the dedicated native graph engine is built. That bridge is temporary implementation scaffolding, not the product definition: Nodemap is its own modular synth, not an Aether skin.

Status legend:

- `[x]` done and covered by verifier, browser smoke, native stress, or document roundtrip evidence.
- `[~]` partially done; usable but not final.
- `[ ]` not done or placeholder-level.

## 1. Graph Contract

- `[x]` New Nodemap instruments enforce exactly one protected `Instrument Out` node.
- `[x]` New user-created Nodemap instruments start with a basic Oscillator routed into `Instrument Out`.
- `[x]` Nodemap editor exposes six proof templates: Basic Oscillator, Filtered Mono, Moving Texture, Snare Hit, Tom Hit, and Crash Hit.
- `[x]` Node browser is grouped by modular synth role: Synth, Effects, Modulation, and Utility.
- `[x]` Users cannot add or delete extra output nodes; normalization collapses duplicate outputs.
- `[x]` Multiple cables may leave one output port and multiple cables may feed one input port.
- `[x]` Invalid cables are pruned: self-cables, wrong-direction cables, missing ports, wrong signal type, duplicate cable edges, and cables connected to removed output nodes.
- `[x]` Cyclic graphs do not hang compile or preview traversal.
- `[x]` Shared graph warnings identify silent output, unconnected nodes, duplicate outputs, nodes not routed to `Instrument Out`, and stacked CV routes.
- `[x]` Add browser-level warning coverage for disconnected nodes, silent output, and protected output behavior.
  - Done: in-app browser smoke created a Nodemap through Instrument > Create Nodemap, verified protected Instrument Out behavior, verified output creation is not exposed, verified the silent-output warning, and verified an added unconnected oscillator shows an unconnected-node warning.

## 2. Audio Source Nodes

- `[x]` Empty output-only graphs compile to silence.
- `[x]` Starter Oscillator-to-Output graphs compile to audible Aether oscillator patches.
- `[x]` Disconnected oscillators compile to silence.
- `[x]` Routed oscillator nodes compile to Aether oscillator A/B.
- `[x]` Routed existing-instrument nodes compile to an audible source path.
- `[x]` Routed noise nodes compile into Aether noise config and keep the graph audible without hidden oscillators.
- `[x]` Mixer nodes pass upstream source discovery and support multi-source graph structure.
- `[x]` Mixer input gain weighting affects routed oscillator/noise source level and can mute isolated mixer inputs.

## 3. Control Nodes

- `[x]` Envelope nodes patched into audible routes update Aether envelope parameters.
- `[x]` LFO nodes patched into audible routes update Aether LFO parameters.
- `[x]` LFO and envelope CV cables compile into deterministic Aether modulation routes for pitch, level, pan, and cutoff targets.
- `[x]` Constant CV cables compile into static Aether parameter offsets for pitch, level, pan, and cutoff targets.
- `[x]` Velocity, Keytrack, Mod Wheel, and Macro CV nodes compile into first-class Aether modulation sources.
- `[x]` Random CV compiles into deterministic bounded static parameter offsets.
- `[x]` Pitch, level, pan, and cutoff CV ports have deterministic compile semantics.
- `[x]` Oscillator position/pan and filter resonance/drive CV ports compile into native Aether modulation targets.
- `[x]` Unison node compiles into Aether voice count, detune, spread, and CV modulation targets.
- `[x]` Add richer CV scaling, attenuation/inversion nodes, and per-port amount controls.
  - Done: CV Scale node supports amount, inversion, offset, and clamp for static Constant CV and dynamic LFO/Envelope routes; target nodes expose per-port CV amount controls for pitch, level, pan, and cutoff.
- `[x]` Add multi-control-route conflict rules and warnings.

## 4. Effect Nodes

- `[x]` Filter nodes compile into the core Aether filter parameters when routed to output.
- `[x]` Volume nodes compile into Aether amp level/pan when routed to output.
- `[x]` Shaper nodes compile into instrument-owned Aether saturator FX.
- `[x]` Distortion nodes compile into instrument-owned Aether distortion FX with drive, shape, trim, and mix parameters.
- `[x]` Delay nodes compile into instrument-owned Aether delay FX.
- `[x]` Chorus nodes compile into instrument-owned Aether chorus FX.
- `[x]` Effect nodes not routed to `Instrument Out` do not silently alter the generated patch.
- `[x]` Reverb, phaser, flanger, compressor, and bitcrush nodes compile into instrument-owned Aether FX when routed to `Instrument Out`.

## 5. Persistence And Migration

- `[x]` Instrument records store `nodeGraph` alongside the compiled Aether patch.
- `[x]` Document roundtrip fixtures cover empty/silent Nodemap graphs and complex effect-heavy Nodemap graphs.
- `[x]` Document dirty fingerprints include Nodemap node-position and cable edits.
- `[x]` Document roundtrip fixtures cover cyclic graph persistence.
- `[x]` Add migration fixtures for future graph schema versions.
  - Done: document roundtrip now covers a future Nodemap graph schema, preserves known compatible nodes/cables, prunes future-only node kinds/cables, and downgrades the graph to the current schema.
- `[x]` Add repair behavior for missing required output node, unknown node kind, duplicate output nodes, missing ports, stale cable references, self-cables, and duplicate cables.

## 6. Runtime/Stress Gates

- `[x]` JS verifier proves silent graphs stay silent and routed graphs render finite audible preview samples.
- `[x]` JS verifier proves parameter edits materially change rendered output.
- `[x]` JS verifier covers noise source compile, CV route compile, static Constant CV offsets, invalid cable pruning, duplicate output normalization, cycles, routed effects, and unrouted effect bypass.
- `[x]` Add backend stress coverage for persisted Nodemap instruments after native graph import is formalized.
  - Done: `BeatBackendStress` covers native Nodemap project-repository roundtrip, saved `nodeGraph` validation, linked track references to the same Nodemap instrument id, deterministic render parity, and parameter edits that materially change rendered output.
- `[x]` Add browser interaction coverage for node creation, cable dragging, multi-connection ports, parameter editing, undo/redo, warning display, play/audition, and apply.
  - Done: source verifier now requires a Nodemap dev exercise hook covering node creation, cable dragging, warnings, parameter editing, undo/redo, play, and apply.
  - Done: live in-app browser smoke created a Nodemap, verified protected Instrument Out behavior, added an oscillator, verified silent/unconnected warnings, dragged oscillator audio into Instrument Out, verified warnings cleared, and verified rendered cable endpoints.
  - Done: 2026-07-01 in-app browser replay loaded `?beatDevFixture=node-interaction`, verified the local hook marker, added Oscillator through the real palette, routed audio into `Instrument Out`, cleared graph warnings, edited oscillator level from `0.8` to `0.33`, verified undo/redo, verified Play toggled to Stop, applied the graph, and confirmed the saved graph had `2` nodes, `1` cable, and oscillator level `0.33`.
- `[x]` JS benchmark coverage compiles a large graph with 100 nodes, 300 cables, 50 control-route cables, and repeated compile timing.
- `[x]` JS benchmark coverage preview-renders a large compiled Nodemap graph and asserts finite audible output within a timing budget.
- `[x]` Add native preview/render timing for large graphs after native Nodemap import/render is formalized.
  - Done: native stress validates and renders a 100-node/300-cable graph under timing budgets.

## 7. Dedicated Native Engine

- `[x]` Define the native Nodemap graph schema independently from the Aether patch contract.
  - Done: `backend/Source/Audio/Nodemap/NodemapGraph.*` owns native `Graph`, `Node`, `Cable`, port, category, signal, validation, and audition structures.
- `[x]` Add a native graph evaluator with explicit source, utility, modulation, effect, and `Instrument Out` node categories.
  - Done: native node definitions categorize source, utility, modulation, effect, and output nodes.
- `[x]` Preserve the one-output rule, multi-cable ports, strict signal compatibility, and cycle protection in native validation.
  - Done: native validation normalizes duplicate outputs, allows multi-connections, prunes stale/wrong-signal/self/duplicate cables, detects cycles, and warns for silent or unrouted graph areas.
- `[x]` Compile or execute oscillator, noise, mixer, gain, filter, envelope, LFO, constant CV, CV scale, velocity, keytrack, mod wheel, macro, random, shaper, distortion, delay, chorus, reverb, phaser, flanger, compressor, and bitcrush semantics natively.
  - Done: `renderOneNote` executes all supported node kinds without requiring Aether patch state.
- `[x]` Add native one-note audition for Nodemap instruments without routing through Aether-specific patch state.
  - Done: native one-note audition renders finite stereo samples for routed graphs and silence for intentionally empty output-only graphs.
- `[x]` Add native backend stress for saved Nodemap instruments, linked instance edits, render/export parity, silent graphs, cyclic graphs, large graphs, and all proof templates.
  - Done: `BeatBackendStress` covers native graph contract, audition/silence/cycles, all proof templates, large graph timing, repository roundtrip, linked track references, and live/export WAV parity through the DAW engine.

## 8. Release Rule

A Nodemap node is not considered production-ready unless it satisfies all four conditions:

1. It has a clear user-facing description.
2. It has visible inputs/outputs that match its real behavior.
3. It compiles into Aether/audio engine state or is explicitly labeled as metadata-only.
4. It is covered by verifier or browser/runtime proof.

- `[x]` Enforce the release rule in automation.
  - Done: `npm run verify:node-instrument` now audits all `26` Nodemap node kinds for exported definitions, non-placeholder descriptions, visible port contracts, grouped browser exposure, parameter defaults, created-node parity, and declared verifier/runtime coverage.
