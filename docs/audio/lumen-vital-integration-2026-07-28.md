# Lumen / Vital Architecture Integration — 2026-07-28

## Result

The first compatibility-preserving Vital-informed architecture slice is integrated across Aether, Lumen, and Aurum. It removes no instrument type, source, parameter, modulation route, preset field, project field, or playback behavior.

The implementation is independently designed Beat code. No Vital source, algorithm body, data, preset, wavetable, binary, branding, service, or dependency was imported.

## Added

### Prepared sparse modulation

`DynamicModulation::PreparedState` compiles each instrument's existing dynamic-modulation contract when voice parameters are refreshed. Every active target retains only its nonzero source routes, in legacy evaluation order:

- LFO 1/2 routes;
- extra-LFO routes;
- envelopes and expression sources;
- macros.

The audio callback constructs one bounded modulation input frame per voice sample only when dynamic modulation is active. Aether, Lumen Source C, Aurum operator/filter modulation, shared filters, amp level, and amp pan evaluate the cached sparse targets instead of multiplying and summing every possible source field for every target.

There is no allocation, lock, container growth, source lookup, schema conversion, or graph compilation in the audio callback. Disabled modulation returns an empty prepared state and does not construct a per-sample input frame.

### Active warp-lane execution

Runtime Warp 1 and Warp 2 now enter the nonlinear processor only when a route lane contains input or retained oversampling history. Silent Main, Direct, Filter 1, and Filter 2 lanes are skipped, while active tail state continues until the existing denormal-safe state reaches zero.

The dual-warp native fixture has one active main lane. Its nonlinear work accounting changed from the old unconditional four-lane charge of `65,536` work samples to `16,376`: two active stereo warp stages across 2,047 nonzero/history-bearing voice samples. The old implementation already returned early inside a completely silent lane, so this is principally accurate telemetry plus removal of redundant calls/checks; it is not presented as a 75% end-to-end CPU reduction.

## Preserved

- Existing project and instrument schemas.
- Existing Aether, Lumen, and Aurum parameter IDs and modulation amounts.
- Legacy bipolar/unipolar source transforms.
- Legacy source summation order, including the separately accumulated extra-LFO term.
- Runtime-warp shapes, oversampling state, lane routing, and tail behavior.
- Live/offline and Lumen/Aether equivalence contracts.

## Not included yet

These remain separate, potentially audible or schema-bearing milestones:

- arbitrary drawable modulation remap curves beyond the bounded response-curve foundation added on 2026-07-29;
- stereo-split modulation;
- a user-selectable audio-rate modulation route;
- a separate time/frequency spectral source mode;
- new filter models or microtonal file import.

None of those should be folded into this compatibility slice without its own migration, sound, callback-safety, live/export, and performance gate.

## Follow-up: bounded route remapping — 2026-07-29

Lumen and Aurum now share an optional per-route response curve: Linear, Ease In, Ease Out, or S-Curve. Old routes and malformed curve values normalize to Linear. Browser preview and native live/export rendering preserve the sign of bipolar sources and shape only their magnitude.

Native patches compile the curve to a compact prepared-source value when the instrument contract is applied. The audio callback performs no string lookup, allocation, graph rebuild, or schema conversion. Linear takes the legacy value path unchanged. This is the first remap foundation, not a claim of Vital parity: arbitrary user-drawn curves, stereo-split modulation, and user-selectable audio-rate routing remain separate roadmap items.

## Follow-up: prepared spectral-harmonic wavetable warps — 2026-07-29

Lumen schema v15 adds five explicit wavetable modes: Harmonic Shift, Harmonic Stretch, Spectral Smear, Spectral Skew, and Spectral Filter. They deform harmonic amplitudes and bounded phase relationships while immutable mipmapped wavetable frames are generated, then reuse the existing shared table cache during playback. No FFT, allocation, lock, table construction, or new inner oscillator loop was added to the audio callback.

The schema boundary is Lumen-only. Aether normalization rejects the new mode names back to Shape, and Lumen v1-v14 migration does the same; existing four-mode patches keep their original path. The native contract applies numeric modes 4-8 only for a validated v15 Lumen patch, and persistence/cache keys retain those values. The factory Wide Pad, Mono Lead, and Digital Keys now exercise Smear, Harmonic Shift, and Spectral Skew respectively.

This is an independently designed prepared harmonic-domain warp foundation. It is not copied or translated Vital code, not a full time/frequency spectral source, and not evidence of Vital sound, alias, or CPU parity. Direct reference comparison remains blocked without an installed official renderer.

## Verification

- Release `BeatBackendStress` target: built.
- Complete native stress suite: passed with only the established `baseline.recent-project-exists` waiver.
- Focused `--lumen-v2`: passed.
- Focused `--aurum`: passed with zero deadline overruns in both reported realtime cases.
- Release `Beat` and `BeatAetherBaseline` targets: built.
- Lumen/Aether equivalence matrix: 8/8 output-equivalent rows, aggregate median wall ratio `1.080058`, maximum row median ratio `1.104124`.
- Lumen/Vital feature-contract verifier: passed.

The equivalence timing is a compatibility guard, not a before/after performance claim. The next performance gate should measure sparse and dense modulation route counts in the same warmed native harness.

## Follow-up: prepared scalar topology kernels — 2026-07-29

`InstrumentVoice` now chooses one prepared Legacy, Aether, Lumen, or Aurum scalar renderer once per block rather than testing the engine identity inside every sample. C++ compile-time specialization removes inactive engine bodies from each kernel while retaining the same shared state, envelopes, routing order, filter order, transitions, and work accounting.

The prepared topology also records a four-bit Main/Direct/Filter 1/Filter 2 possibility mask and compact fixed-capacity indices for active Lumen sample and granular sources. Playback traverses only those active indices, while routed warp/filter lanes retain the existing stateful-tail checks. The topology is rebuilt when voice parameters are published, never in the audio callback, and adds no schema or UI field.

Focused native topology fixtures cover all four engine kernels, route-mask construction, and sparse Lumen slot counts. The focused Lumen V2 suite passes, and the isolated 8-row Lumen/Aether matrix remains 8/8 output-equivalent with a `1.081938` aggregate median wall ratio and `1.099481` maximum row ratio. This establishes a stable scalar boundary for a future separately gated SIMD wavetable-unison kernel; it does not itself claim an end-to-end speedup.

The complete backend stress suite also passes with zero deadline overruns. Its two dense fixture families reported maximum callback loads of `19.7938%` and `17.4%` in the first pass, with `17.3813%` and `16.15%` in the deterministic rerun. These are post-change run records only; without a controlled binary-to-binary baseline they are not attributed solely to the topology refactor.

## Follow-up: bounded full-unison SIMD accumulation — 2026-07-29

Lumen now uses native-width SIMD only to accumulate the prepared lanes of a full 16-voice wavetable-unison bank. Oscillator table reads, interpolation, phase advancement, and the state machine remain on the established scalar implementation. Prepacked weights and stereo gains are refreshed outside the stable sample loop. Aether remains on its scalar renderer, and Lumen widths below 16 use that same scalar path exactly.

The focused native gate renders 16,384 scalar/SIMD stereo frames and requires finite deterministic output, exact oscillator phases, maximum sample error below `2e-6`, and relative residual below `-120 dB`. The measured result was `5.96046e-08` maximum error and `-138.164 dB`. A warmed seven-repetition 262,144-frame median measured `21.9052 ms` scalar and `20.5384 ms` SIMD, a `0.937601` ratio (`6.2%` faster) in the isolated kernel. A separate nine-voice fixture proves bit-exact scalar fallback. This intentionally narrow result is not a claim that complete Lumen patches or songs are 6.2% faster.

The same scalar/SIMD tolerance and deterministic-repeat limits pass through the real Aether-versus-Lumen `InstrumentVoice` dispatch at full unison. The final complete native stress rerun passes with zero deadline overruns; the dense reference fixtures reported `23.7625%` and `13.2063%` maximum callback load on their first runs, and `23.95%` and `25.225%` on deterministic repeats. Those fixtures use seven- and nine-unison Aether reference patches, so they verify system stability but do not measure the new 16-unison Lumen SIMD path. The final SIMD microbenchmark rerun measured `21.9474 ms` scalar and `20.4907 ms` SIMD (`0.933631`, or `6.6%` faster), consistent with the earlier gate. The post-change Lumen/Aether compatibility matrix remains 8/8 output-equivalent (`1.092344` aggregate wall ratio, `1.106513` maximum row ratio); that matrix is likewise a compatibility guard, not this kernel's speed measurement.

## Follow-up: Lumen keytracked LFO rate — 2026-07-29

Lumen schema v16 adds a signed Key Rate amount to each of its ten LFO slots. At `0%`, free and tempo-synced LFOs retain their prior rate exactly. At `+100%`, each octave above C4 doubles the effective rate and each octave below halves it; negative values invert that relationship. Effective rates remain bounded to `0.01-50 Hz`.

The exponent is evaluated once per active LFO at voice-block scope, after the existing free/synced base-rate calculation. There is no new per-sample `exp2`, allocation, lookup, schema conversion, or graph rebuild. Browser preview also takes an exact zero fast path instead of evaluating `Math.pow(2, 0)`. Aether ignores the field, and Lumen v1-v15 migration sets it to zero. Browser preview, native patch application, project persistence, factory-patch audition, exact center/octave behavior, and a direct native callback-safety render are covered independently.

The final isolated eight-row equivalent-patch gate retained 8/8 sample-exact Aether/Lumen output with a `1.086237` aggregate wall ratio and `1.094587` maximum row ratio. An earlier run executed after other long browser gates measured `1.135719`/`1.244279` and failed; two immediate isolated reruns passed (`1.084984`/`1.097408` before the preview zero fast path and the final result above). The failure is retained as contention evidence rather than waived or relabeled.

## Follow-up: product audio-to-wavemap resynthesis — 2026-07-29

Each Lumen A/B/C wavetable slot now exposes the existing Beat-owned resynthesis engine through the product oscillator surface. The user selects an asset already managed by the audio library, chooses Full, Transient, Sustain, or a bounded Manual percentage window, and imports the result as a new stable `user.*` wavemap selected in that slot. The generated frames continue through the existing normalization, editing, analysis, persistence, browser rendering, and native patch paths.

The frontend awaits resynthesis and reports failures without mutating the current slot. In the packaged app, analysis still runs synchronously inside the native IPC handler; moving that work to an explicit native worker remains the release blocker. This UI closure does not claim that worker isolation is complete.
