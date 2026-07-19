# Aether Serum-Class Benchmark

## Scope

This benchmark uses two Beat-owned Aether factory instruments translated from the supplied preset descriptions:

- `Benchmark - Future Bass Strings`
- `Benchmark - Progressive House Strings`

It does not use third-party factory presets, audio, binaries, source code, branding, or service integrations. The benchmark is an internal engineering comparison target, not a claim of bit-identical behavior with another product.

Run it from `frontend` with:

```sh
npm run benchmark:aether-serum -- --output-dir=/tmp/beat-aether-serum-benchmark
```

The command writes two deterministic stereo WAV files and a machine-readable JSON report outside the repository. It renders MIDI notes 48, 60, and 84 at velocities 72 and 118, at 44.1, 48, and 96 kHz. It records hashes, RMS, peak, DC mean, maximum adjacent-sample step, stereo side/mid ratio, wall time, realtime factor, a high-Nyquist-band energy diagnostic, and 48-to-96 kHz downsample residuals.

The high-Nyquist-band measurement is an alias-risk proxy, not a direct measurement of all folded alias products. It must not be reported as total alias energy.

## Frozen Initial Result

Measured on the current development machine on 2026-07-19:

| Preset | Float render SHA-256 | WAV SHA-256 | RMS | Peak | DC mean | Max step | Render / realtime |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Benchmark - Future Bass Strings | `df257e579097f5988c06c32201daf796ee9352a8b5c21fdc8bd039520d23c366` | `eaf6aeff4a3d604312d0575e2c8d90555eaa7a89aff1bc65ad57e2db792e437c` | 0.047741 | 0.236129 | 0.000045533 | 0.095131 | 0.972x |
| Benchmark - Progressive House Strings | `a30b0196e0d2d4d153ccd0370cddcd3f54009b5c5581ddcf2ef049033da248f6` | `17a26d0df7702e6525485fd7669757bfee81ef05ed65cdc705368449882f8ea8` | 0.030392 | 0.131780 | -0.000010827 | 0.065759 | 1.036x |

Both repeated audition renders produced identical float hashes. All matrix samples were finite and audible.

The Future Bass hash was intentionally revised after the first listening pass reported excessive oscillation. Its default Pump macro was reduced from 55% to 38%, amplitude pumping from 48% to 24%, filter pumping from 20% to 10%, and vibrato depth from 5.5 to 3 cents. No oscillator, envelope, FX, or engine behavior changed.

Both hashes were intentionally revised again when the confirmed dual-mono unison defect was fixed. Preview and native wavetable stacks now pan each unison voice independently with cached equal-power gains instead of summing the stack to mono before oscillator pan. Focused browser benchmarking requires a side/mid ratio above `0.05`; native stress requires wide centered unison to produce side energy while zero-width unison remains effectively mono.

## Findings

1. The dual-mono unison defect is corrected. The tuned Future Bass and Progressive House renders now measure side/mid ratios of `0.637907` and `0.554533` respectively.
2. The tuned four-note Future Bass reference render ran at `0.972x` realtime on the measured machine. The Progressive House render ran at `1.036x`. These are development-renderer timings, not native callback timings, but the Future Bass result remains too close to the realtime boundary.
3. The 48-to-96 kHz downsample comparison produced residuals of `-12.759 dB` for Future Bass and `-17.262 dB` for Progressive House. Modulation, filter behavior, stereo unison, and the intentionally simple downsampler contribute to this residual, so it is a regression baseline rather than a pure oscillator error figure.
4. At MIDI note 84 and 48 kHz, high-Nyquist-band energy ratios were `0.039255611` and `0.046867417`. At 96 kHz they fell to `0.000100552` and `0.003967191`. This is sufficient evidence to prioritize alias/performance refinement, but not sufficient to label the measured energy as aliasing without a reference-subtraction test.
5. The scripted reference renderer measures the Aether core preview and does not apply the persisted instrument FX chain. A separate native fixture now maps both exact benchmark descriptions into the production Aether engine and applies every supported authored insert in order. The saturator's descriptive `tone` field remains a schema-to-engine gap because the current saturator has no tone parameter.

The schema-v2 report also includes a deterministic oscillator-isolated reference subtraction. It disables modulation, filtering, envelopes, random phase, and FX while retaining each benchmark oscillator stack, then compares the direct 48 kHz MIDI-84 render with a deterministic 192 kHz render decimated 4:1 through a 65-tap Hann-windowed sinc low-pass.

| Oscillator alias probe | Direct 48 kHz SHA-256 | 192 kHz reference SHA-256 | Residual RMS | Peak residual | Residual / signal | Relative level |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Future Bass | `4bb8e26dc22acbd949aac7cc74e431bd410f2a3b6e14178fb5f16149ef7a69f3` | `ff333418f149fcdd60a6643d9e3c16bc375cb5666984dbc496011d27c496ea1d` | 0.022749 | 0.128207 | 0.205231425 | -6.878 dB |
| Progressive House | `a93f3e8a747e58684ef55a1c19089a069dda9e25b3985706d66e6411676cd085` | `32952c4c597be9a80f0c67c672927ba57c9daa54395b150032ac4a42254d62df` | 0.015447 | 0.075477 | 0.227818576 | -6.424 dB |

This is a substantial deterministic cross-rate mismatch, not an acceptable alias closeout result. It includes amplitude/mip-selection differences as well as folded content and therefore must be treated as a broad oscillator sample-rate error measurement, not a pure alias-energy percentage.

## Native Full-Chain Gate

`BeatBackendStress` now includes exact, independently named native projects for both benchmark instruments. Each fixture covers the authored oscillator sources and tuning, amp and modulation envelopes, LFO 1/2 routes, velocity and macro routes, stereo unison, filter, and full supported insert chain. It requires:

- finite, non-silent stereo output with limiter headroom;
- material side energy from centered stereo unison;
- a measurable difference between the dry and full effects chains;
- bit-stable repeated live renders;
- 32-bit live/export parity;
- successful 44.1, 48, and 96 kHz renders at block sizes 64, 256, and 1024;
- captured callback load, deadline, wavetable work, route-effect work, and cache counters.

Measured on 2026-07-19:

| Native fixture | Side/mid energy | Wet/dry residual ratio | Peak | Slowest render / realtime | Maximum callback load | Deadline overruns | Max wavetable voice samples/block | Max route-effect samples/block |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Benchmark - Future Bass Strings | 0.442078 | 1.19029 | 0.230468 | 14.168x | 22.8813% | 0 | 65,536 | 14,336 |
| Benchmark - Progressive House Strings | 0.408128 | 2.55696 | 0.201706 | 14.757x | 15.4000% | 0 | 57,344 | 10,240 |

The run ended with 1,550 cache hits / 9 misses / 9 entries after Future Bass and 2,221 hits / 10 misses / 10 entries after Progressive House. These cache values are process-cumulative observations, while the per-block work values are maxima across the benchmark matrix.

The Future Bass description requests nine unison voices. The current browser and native playback contracts both cap unison at eight, so this fixture explicitly records and renders eight. Raising that limit is a remaining Serum 1.0 compatibility and performance decision; the benchmark does not relabel eight-voice output as nine-voice output.

## Branch Reconciliation Blocker

The benchmark work currently sits on `codex/audio-bus-backend`. Git ancestry inspection on 2026-07-19 confirmed that this branch and `codex/aether-serum-foundation` diverge at `062413553930fb102a81658063966c34500bf8a9`. The current branch does not contain commit `505672e3` (`feat: add immutable wavetable mip foundation`) or the later Aether milestones. Its native `WavetableOscillator::updateFrameCache()` still constrains playback position using the pitch-derived harmonic limit.

The Serum 1.0 results above are valid for the current audio-bus branch, but they are not a valid freeze of the newer Aether foundation. Do not reimplement the missing foundation here or declare the cross-rate result final. Reconcile the branches on a dedicated integration branch, preserve both histories, rerun the benchmark against the integrated engine, and explain every changed hash.

## Acceptance Boundary

The factory-instrument, repeatable preview render, and exact native full-chain harnesses are implemented and green on the current branch. The Serum 1.0 benchmark remains open because the reference-subtracted oscillator result is not acceptable, the authored nine-voice Future Bass stack exceeds the current cap, and the audio-bus/Aether branch histories must be reconciled before a canonical freeze. Serum 2 feature comparisons begin only after the integrated Serum 1.0 boundary is measured and frozen.

Changed hashes must be explained in this document before the frozen values are updated.
