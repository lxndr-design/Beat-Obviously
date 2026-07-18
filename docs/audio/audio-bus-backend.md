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

## UI integration API

The future tabbed main-editor UI can create/delete buses with `addReturnBus` and `removeReturnBus`, update non-routing properties with `updateReturnBus`, and use these cycle-safe routing operations:

- `setTrackOutputBus`
- `setAudioBusOutput`
- `upsertTrackSend` / `removeTrackSend`
- `upsertAudioBusSend` / `removeAudioBusSend`

Routing fields are intentionally excluded from generic `updateReturnBus` patches so UI code cannot bypass graph validation.

## Verification

- `npm run verify:audio-bus` checks creation, nested routing, cycle rejection, sends, and safe deletion.
- `build-native/bin/BeatBackendStress --audio-bus` checks persistence, integrity diagnostics, summing, nested routing, missing/cyclic fail-closed behavior, trim automation, solo isolation, offline rendering, and latency-compensated parallel paths.

The tab UI is intentionally not part of this backend slice.
