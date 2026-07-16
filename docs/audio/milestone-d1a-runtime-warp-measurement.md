# Milestone D1A runtime-warp measurement

> Private personal GPLv3-constrained build only. Do not distribute, publish,
> supply to third parties, sell, or convey source or binaries.

Date: 2026-07-16

Branch: `codex/aether-c3f2-playback`

Status: **measurement gate complete; no production DSP or oversampling policy
change is authorized by this report**

## Boundary

`backend/Tests/AetherRuntimeWarpCorpus.{h,cpp}` is linked only into
`BeatBackendStress`. It independently reproduces Beat's four existing
memoryless warp equations and the current two-times interpolation/downsample
equations for measurement. It does not expose a production symbol, enter
`InstrumentVoice`, alter a preset or schema, or run in Beat.

The corpus contains 135 deterministic scenarios and 540 candidate rows:

- 44.1, 48, 88.2, 96, and 192 kHz;
- 1.76 kHz, 7.04 kHz, and a rate-relative high-note case;
- shape, fold, pinch, and mirror at amounts 0.5 and 1.0;
- shape-to-fold, fold-to-mirror, and pinch-to-mirror serial cases;
- direct one-times, current two-times, idealized two-times, and idealized
  four-times candidates.

The reference is a test-only continuous sine evaluated at 16 times the host
rate, processed by the same memoryless equations, and reduced through a
127-tap Blackman-windowed sinc filter. The primary metric is the
phase-insensitive magnitude-spectrum residual-energy ratio relative to that
reference. It isolates unwanted spectral difference without treating the
current one-pole path's group delay as alias energy. It remains a comparative
engineering metric, not a psychoacoustic audibility score.

Every row also records DC mean, maximum adjacent-sample step, wall time,
nonlinear evaluation count, and SHA-256. Two complete runs produced identical
non-timing JSON with SHA-256
`1653c2e4dd7a7682b70504994f3c3f166b79354be407f8d01f12eae1023ba1be`.

## Results

| Chain | Current 2x worst / mean residual | Ideal 4x worst / mean residual | Current / 4x nonlinear evaluations |
| --- | ---: | ---: | ---: |
| Shape | 0.073190 / 0.026770 | 0.006987 / 0.001965 | 8,704 / 16,518 |
| Fold | 0.232148 / 0.050682 | 0.048874 / 0.012666 | 8,704 / 16,518 |
| Pinch | 0.197672 / 0.059170 | 0.013840 / 0.002122 | 8,704 / 16,518 |
| Mirror | 0.911891 / 0.264961 | 0.390671 / 0.066945 | 8,704 / 16,518 |
| Shape + fold | 0.917332 / 0.455331 | 0.032505 / 0.013243 | 17,408 / 33,036 |
| Fold + mirror | 65.641430 / 28.420225 | 9.377265 / 2.428484 | 17,408 / 33,036 |
| Pinch + mirror | 2.290763 / 1.676917 | 0.205367 / 0.131352 | 17,408 / 33,036 |

Idealized four-times processing improves 133 of 135 scenarios relative to the
current two-times equations. The two regressions are both single-stage mirror:
96 kHz / 7.04 kHz / amount 1.0 (`0.062188` to `0.078241`) and 192 kHz /
16 kHz / amount 0.5 (`0.061344` to `0.063822`). An idealized two-times
candidate improves 126 of 135 scenarios, showing that filter policy—not only
the factor—is material.

The corpus's test-only wall figures are descriptive and include vector
allocation plus a long offline FIR, so they are not callback CPU projections.
Exact nonlinear work is authoritative: four-times requires approximately
twice the nonlinear evaluations of the current two-times path. The highest
observed absolute DC mean is `0.00446417`; the largest adjacent step is
`1.998783` for unfiltered one-times shape and `1.777231` for idealized
four-times shape. These are generated sustained-waveform differences, not
note-boundary click measurements.

## Decision

The evidence rejects both a claim that the present two-times policy is
spectrally closed and a blanket production switch to the measured four-times
candidate:

- four-times is a strong candidate for shape and pinch and materially improves
  fold;
- mirror remains the limiting single mode;
- mirror-containing serial chains remain materially under-resolved at four
  times, especially fold-to-mirror at 44.1/48 kHz;
- the two mirror regressions prove that factor alone is not a safe policy;
- the offline 127-tap filter is not a realtime implementation candidate.

Recommended next approval: **D1B1 candidate design, still test-only**. Measure a
prepared realtime-feasible higher-stop-band decimator and an eight-times
reference candidate for mirror-containing and serial chains, then propose
per-mode/rate admission thresholds and an exact callback-work budget. Do not
modify production DSP until that candidate passes the same 135 scenarios with
no unexplained regression and the owner explicitly approves D1B2 integration.

Alternatives are to retain the current two-times path with the limitation
documented, or limit the product to single-stage/non-mirror combinations. This
report does not silently change existing preset semantics or disable any mode.

## Verification and freeze

- Focused corpus: pass twice; 135 scenarios / 540 rows; deterministic
  non-timing report hash above.
- Full native stress: pass in 23.85 s wall / 21.34 s user / 1.22 s system with
  only `baseline.recent-project-exists` waived.
- Full `npm run verify:non-native`: pass, including benchmark instruments and
  production frontend build.
- Release `Beat`, `BeatBackendStress`, and `BeatAetherBaseline`: build.
- Baseline: 150 WAVs; normalized manifest remains
  `713ed72937dc82df0a0d845ebff1d48aee8a8d87ab4af877cabc895c6bee5ba5`.
- Timing JSON SHA-256:
  `00d2acb3836b5760473b53318c8b755dc5d2030fce2aac0e141aec3205443a06`.
- Render timing: 12.75-20.88 ms, 13.59 ms mean. The isolated 48 kHz /
  64-sample initialization row is the sole 20.88 ms scheduling outlier; no WAV
  hash changed.
- Harness peak RSS: 14,925,824 bytes. Deadline overruns: zero. Queue telemetry:
  64 accepted / 16 rejected / 16 overflow.

The machine-readable focused report was generated outside the repository at
`/private/tmp/beat-aether-d1a-runtime-warp.json`. Reproduce it with:

```sh
AETHER_RUNTIME_WARP_D1A_ONLY=1 \
AETHER_RUNTIME_WARP_REPORT=/private/tmp/beat-aether-d1a-runtime-warp.json \
./build-native/bin/BeatBackendStress
```
