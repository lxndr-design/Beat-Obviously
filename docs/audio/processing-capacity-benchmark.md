# Processing Capacity Benchmark

Measured 2026-08-01 on the current development machine.

## Hardware and run conditions

- MacBook Pro (`Mac16,8`, model `MX2F3LL/A`)
- Apple M4 Pro, 14 CPU cores: 10 performance and 4 efficiency
- 24 GB unified memory
- macOS 26.6 (`25G70`), Darwin 25.6.0, arm64
- AC power, battery charging
- System-wide memory free before final verification: 37%
- Background load averages before final verification: 3.45 / 4.59 / 5.52

Serial numbers, hardware UUIDs, and device identifiers are intentionally omitted.

## Fixture

Every requested track is a deliberately extreme complete playback stack:

- 24 simultaneous sustained Aether voices
- Two wavetable oscillators with dense unison, plus sub and noise sources
- Per-note, segment, track, effect, and bus automation
- Three serial insert effects per track route: one instrument effect and two track effects
- Two sends per track, including pre-fader and post-fader routing
- Two nested return buses with reverb, delay, compression, and saturation
- Master compression, master EQ, DC blocking, and the final limiter

The benchmark runs the native audio callback at 48 kHz. Normal mode enables the realtime deadline/safety behavior. Extreme mode uses offline preparation while still invoking the same audio callback; this intentionally prevents automatic safety muting so the engine can be measured far beyond realtime.

## Realtime boundary at 256 samples

The 256-sample callback deadline is 5.333 ms. Four repeated normal-mode runs produced:

| Complete stacks | Active voices | P95 callback load | Deadline behavior | Interpretation |
| ---: | ---: | ---: | --- | --- |
| 1 | 24 | 46.4-50.0% | Zero misses in every run | Safe with useful headroom |
| 2 | 48 | 91.6-100.0% | Two runs clean; two runs missed one deadline | Absolute edge, not reliably safe |
| 4 | 96 | About 147-150% before protection | Eight consecutive misses triggered one safety mute | Definitely overloaded |

The recommended capacity for this intentionally extreme fixture is one complete stack. Two stacks can work, but leave too little scheduling headroom to be considered reliable.

This does not mean the application is limited to one ordinary track. A typical track uses substantially fewer simultaneous voices, lower unison, fewer automation ramps, and fewer inserts/sends than this fixture.

## Extreme sweep

The controlled extreme sweep continued through 72 requested tracks at three buffer sizes:

| Buffer | Deadline | 1 stack P95 | 2 stacks P95 | 4 stacks P95 | First CPU failure |
| ---: | ---: | ---: | ---: | ---: | --- |
| 128 | 2.667 ms | 49.6% | 96.1% | 188.1% | 2 stacks had two misses |
| 256 | 5.333 ms | 47.3% | 92.3% | 205.7% | 4 stacks |
| 512 | 10.667 ms | 47.8% | 91.6% | 185.5% | 4 stacks |

The fixture remained finite and did not crash through the final tier. At 72 requested tracks and a 512-sample buffer, one callback took 334.1 ms against a 10.667 ms deadline. Reported load saturates at 999%, so elapsed milliseconds are the useful measurement beyond that point.

## Bottlenecks and fixed ceilings

Synthesis is the dominant cost. At the 64-track, 512-sample tier:

- Total callback: 323.894 ms
- Synth phase: 321.357 ms
- All reported route FX: 1.322 ms

The benchmark also reached two fixed-capacity boundaries:

- The pending note-off pool holds 256 events. With 24 sustained notes per track, overflow begins at 16 tracks: 384 pending note-offs requested, 128 rejected.
- The engine renders at most 64 instrument routes. The route count reaches 66 with 64 instruments plus two buses and remains 66 when 72 tracks are requested.

No callback-safety violation was reported at any tier. Extreme mode intentionally does not trigger overload safety mutes; normal realtime mode triggered the expected safety mute after eight consecutive missed deadlines.

## Commands

Quick realtime boundary:

```bash
build-native/bin/BeatBackendStress --processing-capacity
```

Full overload sweep without realtime safety muting:

```bash
build-native/bin/BeatBackendStress --processing-capacity-extreme
```

Results remain hardware-, thermal-, power-, OS-, and background-load-dependent. This harness does not include CoreAudio device/driver overhead or third-party plugin costs, so installed plugins need separate per-plugin measurements.
