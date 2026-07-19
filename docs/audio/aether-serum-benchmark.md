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

The schema-v2 report also includes a deterministic oscillator-isolated reference subtraction. It disables modulation, Filter 1 processing, envelopes, random phase, and FX while retaining each benchmark oscillator stack, then compares the direct 48 kHz MIDI-84 render with a deterministic 192 kHz render decimated 4:1 through a 513-tap Hann-windowed sinc low-pass. The report also records direct/reference RMS, correlation, fitted gain, and gain-fitted residual so an amplitude or alignment defect cannot be mistaken for alias energy.

| Oscillator alias probe | Direct 48 kHz SHA-256 | 192 kHz reference SHA-256 | Residual RMS | Peak residual | Residual / signal | Relative level |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Future Bass | `56fa06dcda363aaf8a655b726d7a548020de656a6521c5ba70fe0ace2d2cc753` | `76a5d490e2ac23460acaf36a4b44ec0aa144a0f4a099a8d7231f4f29f33fe91f` | 0.002317 | 0.009656 | 0.002409913 | -26.180 dB |
| Progressive House | `ab7a5a5c3f9f937585967072f7a025ecfecbfa94f208198d649b1680de8dc59d` | `9f147091619e6d01cc0517700dc0ddeed9b95be4eac7377ef46ea2ce0d40c338` | 0.001411 | 0.005663 | 0.002326419 | -26.333 dB |

The former `-6.878 / -6.424 dB` result was invalid as an oscillator-only claim: changing `synthPatch.parameters["filter.enabled"]` after the preview object had been constructed did not bypass the runtime filter, and the preview model had no explicit Filter 1 bypass field. The probe therefore compared sample-rate-dependent filter realizations. The fixed preview model carries `filterEnabled`, bypasses Filter 1 and its drive when disabled, and uses a full-band frame normalization shared by every pitch-derived harmonic truncation. A focused test proves that cutoff, resonance, and drive cannot alter a disabled-filter render. Missing `filterEnabled` remains enabled for backward compatibility.

The corrected probe improves by 19.30 dB for Future Bass and 19.91 dB for Progressive House, with direct/reference correlations of `0.998794650` and `0.998836236` and fitted gains of `1.000817972` and `1.000496997`. The frozen audition hashes and all six C4 hashes remain unchanged because those renders use enabled filters and do not cross the affected high-note harmonic boundary. The remaining approximately `-26 dB` result is a deterministic band-edge/mip-transition residual and is not yet a pure folded-alias measurement or a Serum 1 closeout threshold.

| Residual band | Future Bass residual/signal | Future residual share | Progressive residual/signal | Progressive residual share |
| --- | ---: | ---: | ---: | ---: |
| 0–8 kHz | -60.497 dB | 0.0261% | -68.529 dB | 0.0050% |
| 8–16 kHz | -51.190 dB | 0.0483% | -56.706 dB | 0.0131% |
| 16–24 kHz | -13.979 dB | 99.9256% | -14.468 dB | 99.9819% |

The residual is therefore not a broad lower-band alias failure: more than 99.9% is confined to the 16–24 kHz transition band where the direct pitch-derived harmonic cutoff and reference low-pass have intentionally different edge responses. Changing that edge now would intentionally alter high-note brightness and requires a reviewed timbral policy, not a silent baseline update.

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
| Benchmark - Future Bass Strings | 0.442070 | 1.19003 | 0.231432 | 8.488x | 26.4688% | 0 | 65,536 | 14,336 |
| Benchmark - Progressive House Strings | 0.408087 | 2.55622 | 0.201444 | 9.194x | 24.6250% | 0 | 57,344 | 10,240 |

The integrated Release run ended with 2,004 cache hits / 9 misses / 9 entries after Future Bass and 2,675 hits / 10 misses / 10 entries after Progressive House. These cache values are process-cumulative observations, while the per-block work values are maxima across the benchmark matrix. The complete Release stress suite passed in 15.10 s wall / 13.30 s user / 0.90 s system with zero benchmark deadline overruns.

The Future Bass description requests nine unison voices. The current browser and native playback contracts both cap unison at eight, so this fixture explicitly records and renders eight. Raising that limit is a remaining Serum 1.0 compatibility and performance decision; the benchmark does not relabel eight-voice output as nine-voice output.

## Integrated factory-render freeze

The Aether foundation previously froze a separate, older adaptation of the same two supplied presets. Integration correctly failed all six legacy C4 render hashes after the newer factory-guide records became authoritative. The changed output is attributable to reviewed preset-data differences: the tuned Future Bass motion/vibrato defaults, explicit amp level, runtime warp, updated macro labels/routes, and the corresponding current Progressive House guide record. Renderer code did not change during this hash decision, and the standalone Serum benchmark audition hashes above remained exact.

The accepted integrated C4 float hashes are:

| Preset | 44.1 kHz | 48 kHz | 96 kHz |
| --- | --- | --- | --- |
| Benchmark - Future Bass Strings | `3b7a16c8a03c69167501836515a5e12a47eb049f1fb95c6c056a4a9dab5762dc` | `6acf60e7ceb29c4090fe02de05f2e9ff9a8bca50d041d0f41e76b5a2a8aa0392` | `abdfc817fe31489e70ab5ba5bf0cfe064f6ac650f93c711f43d5bf2de38d00c7` |
| Benchmark - Progressive House Strings | `1397453a4578c86211206e4230a5a351ec467f14d459edc70ec63e1e407964a9` | `ad36495fa5321471891136df4e4485c8613368fb653f2518c4639746816fc000` | `d287fd1128f43f4c3b3b3ad11eb47203e8580be07277007bd229c881b4694bf8` |

The Future Bass guide now stores eight voices, matching the renderer's fixed capacity and making repeated preset normalization idempotent. Rendering already clamped the prior value of nine to eight, so the standalone float/WAV hashes did not change.

## Branch reconciliation — complete

The divergent `codex/audio-bus-backend` and `codex/aether-serum-foundation` histories were reconciled on `codex/serum1-integration`. Merge commit `7edcb310` preserves the Aether foundation and audio-bus history; `d18a6112` applies the Serum 1 benchmark gate on top. The integrated engine includes the immutable wavetable mip foundation and the later Aether milestones.

The full non-native gate, production targets, focused streaming callback test, and complete Release native stress suite are green on the integration branch with only the existing `baseline.recent-project-exists` platform waiver. Integration exposed and fixed a route-automation callback allocation: JUCE substring construction was replaced by bounded in-place region comparison, with no parameter or DSP semantic change.

## Acceptance Boundary

The factory-instrument, repeatable preview render, exact native full-chain harnesses, branch reconciliation, deterministic preset normalization, and integrated render freeze are implemented and green. Serum 1.0 remains open only for the corrected `-26.180 / -26.333 dB` band-edge/mip-transition residual and the explicit decision whether to raise the fixed eight-voice unison capacity. Serum 2 feature comparisons should begin only after those Serum 1 boundaries are either corrected or explicitly accepted.

Changed hashes must be explained in this document before the frozen values are updated.
