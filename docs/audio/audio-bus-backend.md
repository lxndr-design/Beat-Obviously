# Audio Bus backend contract

The Audio Bus backend extends the existing Return Bus model without breaking older projects. Legacy returns load as stereo buses routed to Master. The product-facing UI should use “Bus”; the `ReturnBus` type and store method names remain compatibility aliases for existing documents and mixer code.

## Supported routing

- A Track or Bus has one primary output: Master (empty bus ID), another Bus, or explicit no output (`outputEnabled: false`).
- Tracks and Buses can also send to Buses with level, pan, enable, and pre/post-fader state.
- Bus graphs are prepared outside the callback and processed in deterministic source-to-destination order.
- Self-routes and multi-node cycles are rejected by the frontend routing API. Malformed persisted cycles are diagnosed and fail closed in the native graph.
- A missing non-empty destination is preserved, diagnosed, and silent. It never falls back to Master.
- Deleting a Bus removes sends that target it. Primary outputs that targeted it become explicit no-output routes.

## Signal and state

Bus processing is input summing, input trim, inserts, meter, pre/post-fader sends, balance/fader, then primary output. Track and Bus routes share the existing bounded realtime buffers and effect framework. Offline rendering uses the same engine path.

Each Bus persists its stable ID, schema version, name, color, icon, channel layout, primary output, trim, gain, pan, mute, solo, solo-safe state, mixer order, sends, insert chain, and automation. Bus automation targets are:

- `bus.inputTrimDb`, `bus.gainDb`, `bus.pan`, `bus.mute`
- `send.<destinationBusId>.gainDb`, `.pan`, `.enabled`
- `effect.<effectId>.bypass` and `effect.<effectId>.<parameter>`

Solo preparation retains the upstream sources and downstream buses needed to hear the selected Bus, while suppressing unrelated direct-to-Master paths. Solo-safe buses remain available.

Latency compensation is calculated for Track/Bus primary outputs and sends at each Bus summing boundary and at Master. Delay storage is allocated during graph preparation, never in the audio callback.

## Main-editor integration

The bottom main-editor panel exposes an accessible horizontal tab list for Master and every Audio Bus. The create-Bus button sits immediately before the final Bus tab (or after Master when no Buses exist), and the whole ribbon retains a continuous bottom rule. Users can switch tabs by pointer or Left/Right/Home/End keys and inspect the selected Bus in four stable columns: routed inputs, channel parameters, insert cards, and output/send routing. Input rows identify primary Track/Bus routes and send routes. Channel controls reuse the same keyboard-accessible Knob used by Aether. Insert cards expose bypass, reorder, removal, editable parameters, and the shared Aether curve-preview component; these curves are deterministic parameter-response illustrations, not measured spectrum or transfer telemetry. The output column owns rename, mono/stereo mode, cycle-safe primary output, metering, and cycle-safe sends (add, enable, level, pre/post-fader, and remove). Bus deletion remains confirmation-gated. Master uses the same Inputs, Parameters, and Inserts layout, omitting the redundant Output column; its fixed EQ and compressor remain editable, and the EQ automation editor remains available. The former Master EQ preset control is intentionally absent.

The UI can create/delete buses with `addReturnBus` and `removeReturnBus`, update non-routing properties with `updateReturnBus`, and use these cycle-safe routing operations:

- `addAudioBus({ name, trackIds })` creates a Bus and atomically routes the selected valid Tracks to it; `addReturnBus(name)` remains the compatibility alias.
- `setTrackOutputBus`
- `setAudioBusOutput`
- `upsertTrackSend` / `removeTrackSend`
- `upsertAudioBusSend` / `removeAudioBusSend`

New UI-created routes must target an existing Bus. Missing destinations loaded from older or externally edited projects remain preserved and diagnosable, but interactive edits cannot create new dangling routes. Routing fields, stable IDs, and schema versions are intentionally excluded from generic `updateReturnBus` patches so UI code cannot bypass graph validation or break existing references. Bus and send ranges are normalized at the store boundary before native graph preparation.

The integrity verifier diagnoses unsupported Bus schema versions, empty names, unsupported channel layouts, invalid trim/gain/pan values, malformed send collections, missing or duplicate send destinations, and invalid send gain/pan values. Future Bus schema data is rejected as unsupported rather than being silently interpreted as version 1.

## Verification

- `npm run verify:audio-bus` checks atomic selected-track creation, stable-ID protection, value normalization, destination validation, nested routing, cycle rejection, sends, insert-chain operations, channel mode, safe deletion, routed-input presentation, shared synth controls/graphs, and editable insert parameters.
- `npm run verify:design-system` checks that the shared Slider delegates continuous pointer dragging to the native range control and keeps its label on the compact field-label scale.
- `build-native/bin/BeatBackendStress --audio-bus` checks persistence, malformed/future Bus diagnostics, summing, nested routing, missing/cyclic fail-closed behavior, trim automation, solo isolation, offline rendering, and latency-compensated parallel paths.

The full-screen Mixer remains available for detailed Track channel strips. Further visual refinement can build on the main-editor tabs without changing the routing contract.
