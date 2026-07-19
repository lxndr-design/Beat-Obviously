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

1. The dual-mono unison defect is corrected. The final nine-voice Future Bass and seven-voice Progressive House renders measure side/mid ratios of `0.622889` and `0.554533` respectively.
2. The final four-note Future Bass development renderer ran at `0.591x` realtime on the measured machine. Progressive House ran at `0.684x` in the same closeout run. These are deliberately unoptimized browser reference-render timings, not native callback timings; production native evidence is recorded separately below.
3. The 48-to-96 kHz downsample comparison produced residuals of `-12.510 dB` for Future Bass and `-17.262 dB` for Progressive House. Modulation, filter behavior, stereo unison, and the intentionally simple downsampler contribute to this residual, so it is a regression baseline rather than a pure oscillator error figure.
4. At MIDI note 84 and 48 kHz, high-Nyquist-band energy ratios were `0.023780485` and `0.037721045`. At 96 kHz they fell to `0.000071513` and `0.003051646`. This is a risk diagnostic, not a claim that all measured energy is folded aliasing.
5. The scripted reference renderer measures the Aether core preview and does not apply the persisted instrument FX chain. A separate native fixture now maps both exact benchmark descriptions into the production Aether engine and applies every supported authored insert in order. The saturator's descriptive `tone` field remains a schema-to-engine gap because the current saturator has no tone parameter.

The schema-v2 report also includes a deterministic oscillator-isolated reference subtraction. It disables modulation, Filter 1 processing, envelopes, random phase, and FX while retaining each benchmark oscillator stack, then compares the direct 48 kHz MIDI-84 render with a deterministic 192 kHz render decimated 4:1 through a 513-tap Hann-windowed sinc low-pass. The report also records direct/reference RMS, correlation, fitted gain, and gain-fitted residual so an amplitude or alignment defect cannot be mistaken for alias energy.

| Oscillator alias probe | Direct 48 kHz SHA-256 | 192 kHz reference SHA-256 | Residual RMS | Peak residual | Residual / signal | Relative level |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Future Bass | `5bda6d04159a22809ab2f33cf1c19be854cf350fd140a232626f7d5b5b10951d` | `10b899568d45fb855bd147834010847b79191ae1eb105d6ee72d44ec7421ca0b` | 0.002083 | 0.010508 | 0.002402411 | -26.194 dB |
| Progressive House | `ab7a5a5c3f9f937585967072f7a025ecfecbfa94f208198d649b1680de8dc59d` | `9f147091619e6d01cc0517700dc0ddeed9b95be4eac7377ef46ea2ce0d40c338` | 0.001411 | 0.005663 | 0.002326419 | -26.333 dB |

The former `-6.878 / -6.424 dB` result was invalid as an oscillator-only claim: changing `synthPatch.parameters["filter.enabled"]` after the preview object had been constructed did not bypass the runtime filter, and the preview model had no explicit Filter 1 bypass field. The probe therefore compared sample-rate-dependent filter realizations. The fixed preview model carries `filterEnabled`, bypasses Filter 1 and its drive when disabled, and uses a full-band frame normalization shared by every pitch-derived harmonic truncation. A focused test proves that cutoff, resonance, and drive cannot alter a disabled-filter render. Missing `filterEnabled` remains enabled for backward compatibility.

The corrected probe improves by 19.32 dB for Future Bass and 19.91 dB for Progressive House over the invalid filter-contaminated values, with direct/reference correlations of `0.998798418` and `0.998836236` and fitted gains of `1.000832949` and `1.000496997`. The later Future Bass hash changes are wholly attributable to restoring its ninth voice; Progressive House remains exact. The approximately `-26 dB` result is a deterministic band-edge/mip-transition residual, not a pure folded-alias measurement, and the project owner accepted it as the Serum 1 Nyquist-edge policy.

| Residual band | Future Bass residual/signal | Future residual share | Progressive residual/signal | Progressive residual share |
| --- | ---: | ---: | ---: | ---: |
| 0–8 kHz | -61.392 dB | 0.0386% | -68.529 dB | 0.0050% |
| 8–16 kHz | -50.813 dB | 0.0779% | -56.706 dB | 0.0131% |
| 16–24 kHz | -14.711 dB | 99.8834% | -14.468 dB | 99.9819% |

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
| Benchmark - Future Bass Strings | 0.415804 | 1.36333 | 0.253380 | 8.454x | 24.5250% | 0 | 73,728 | 14,336 |
| Benchmark - Progressive House Strings | 0.408087 | 2.55622 | 0.201444 | 9.194x | 24.6250% | 0 | 57,344 | 10,240 |

The final Release run ended with 2,004 cache hits / 9 misses / 9 entries after Future Bass and 2,675 hits / 10 misses / 10 entries after Progressive House. These cache values are process-cumulative observations, while the per-block work values are maxima across the benchmark matrix. The complete Release stress suite passed in 14.86 s wall / 12.93 s user / 0.89 s system with zero benchmark deadline overruns.

### Reviewed 16-voice capacity change

The project owner accepted the measured Nyquist-edge residual as the Serum 1 timbral boundary and approved replacing the mismatched eight-voice caps with one fixed 16-voice contract. Native live/offline rendering, patch conversion, IPC, persistence, browser preview, worklet preview, AI sanitization, and editor normalization now use that bound. The factory Future Bass description therefore stores and renders its authored nine voices rather than relabelling an eight-voice approximation.

This intentionally changes only Future Bass benchmark output; Progressive House remains at seven voices. Before any frozen expectation was changed, the repeated C4 renders proved that all three Progressive House hashes remained byte-identical and that all three Future Bass renders changed deterministically. The nine-voice Future Bass output remained finite and audible, with peak below `0.709`, absolute DC mean below `0.000087`, and maximum adjacent-sample discontinuity below `0.534` across 44.1/48/96 kHz. The reviewed new C4 hashes are listed below; the former values remain in Git history and in the preceding integration record.

The final standalone audition hashes are float `4ea7b303e5c13ea958f305b8a8a3f6f05d3a2a6e7535fe802f6926022d436260` and WAV `332214986ae9652812529ad0a038d4bd8f96526db86f13f4f364a18d7ed2a3fa` for Future Bass. Progressive House remains float `a30b0196e0d2d4d153ccd0370cddcd3f54009b5c5581ddcf2ef049033da248f6` and WAV `17a26d0df7702e6525485fd7669757bfee81ef05ed65cdc705368449882f8ea8`.

## Integrated factory-render freeze

The Aether foundation previously froze a separate, older adaptation of the same two supplied presets. Integration correctly failed all six legacy C4 render hashes after the newer factory-guide records became authoritative. The changed output is attributable to reviewed preset-data differences: the tuned Future Bass motion/vibrato defaults, explicit amp level, runtime warp, updated macro labels/routes, and the corresponding current Progressive House guide record. Renderer code did not change during this hash decision, and the standalone Serum benchmark audition hashes above remained exact.

The accepted integrated C4 float hashes are:

| Preset | 44.1 kHz | 48 kHz | 96 kHz |
| --- | --- | --- | --- |
| Benchmark - Future Bass Strings | `a5bfd0d3f47dd2b6368042fb649f3c3f55933ce4e9aa507be8c3cf3e9a5ec752` | `ba0c2e4cbd3730f8e7bb785f99cdf13376539505b1d091284753564473a08af5` | `1e8e8add621ef4f7438847603b3853bb58c6c7214a4131b670df64a7a6d01ef9` |
| Benchmark - Progressive House Strings | `1397453a4578c86211206e4230a5a351ec467f14d459edc70ec63e1e407964a9` | `ad36495fa5321471891136df4e4485c8613368fb653f2518c4639746816fc000` | `d287fd1128f43f4c3b3b3ad11eb47203e8580be07277007bd229c881b4694bf8` |

The Future Bass guide now stores nine voices, within the renderer's fixed 16-voice capacity, and repeated preset normalization remains idempotent. Its former eight-voice C4 hashes changed for this explained reason only; the seven-voice Progressive House output did not change.

## Branch reconciliation — complete

The divergent `codex/audio-bus-backend` and `codex/aether-serum-foundation` histories were reconciled on `codex/serum1-integration`. Merge commit `7edcb310` preserves the Aether foundation and audio-bus history; `d18a6112` applies the Serum 1 benchmark gate on top. The integrated engine includes the immutable wavetable mip foundation and the later Aether milestones.

The full non-native gate, production targets, focused streaming callback test, and complete Release native stress suite are green on the integration branch with only the existing `baseline.recent-project-exists` platform waiver. Integration exposed and fixed a route-automation callback allocation: JUCE substring construction was replaced by bounded in-place region comparison, with no parameter or DSP semantic change.

## Acceptance Boundary

The project owner accepted the corrected `-26.180 / -26.333 dB` band-edge/mip-transition residual as the Serum 1 Nyquist-edge policy and selected the fixed 16-voice capacity. Serum 1 closeout is pending only the complete post-change native/non-native verification and final recorded metrics; Serum 2 work has not begun.

Changed hashes must be explained in this document before the frozen values are updated.
