# Dense project stress report

Run date: 2026-08-02

Hardware: Apple M4 Pro MacBook Pro, 14 CPU cores (10 performance + 4 efficiency), 24 GB RAM, macOS 26.6.

## Scope

The campaign covers project-document construction and migration, dense MIDI editing, nondestructive arpeggiation expansion, round-to-nearest, MIDI remix, per-note velocity/volume/pan/pitch curves and connections, 300 BPM scheduling, large chords, 20+ row drum sequencers, normal and maximal instruments, track/instrument/bus FX, track/bus/master automation, realtime callback load, fixed-capacity event limits, and 24-bit WAV export.

Frontend `.beat` documents retain UI-only drum and nondestructive modifier metadata. Native render companions use the same project names and MIDI-note scale, with modifiers expanded to engine events before rendering. They are constructed directly in the stress binary because the backend receives the expanded IPC model rather than reading frontend `.beat` files.

## Generated project documents

| Project | Tier | BPM | Tracks | Segments | Authored notes | Rendered arp notes | Drum rows across segments | Drum cells | Total FX | Automation points | File |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| dense_1 | normal control | 128 | 5 | 20 | 493 | 493 | 40 | 640 | 92 | 2,200 | 0.91 MB |
| dense_2 | dense MIDI/drums | 300 | 12 | 144 | 11,520 | 21,203 | 480 | 30,720 | 288 | 48,096 | 22.96 MB |
| dense_3 | combined extreme | 300 | 21 | 328 | 37,632 | 73,554 | 1,536 | 98,304 | 600 | 154,800 | 74.23 MB |

`dense_2` uses 20 drum voices per drum segment. `dense_3` uses 24. The maximal chains cover all built-in FX kinds plus the plugin-placeholder path, nested return buses, sends, master compression, and master EQ automation.

## Editing and document-operation latency

| Project | Parse + migrate | Render all arps | Round all notes | Remix all eligible segments | Serialize | Total | RSS increase | 30 s timeout |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| dense_1 | 8.0 ms | 2.4 ms | 0.6 ms | 7.4 ms | 0.4 ms | 21.5 ms | 15.6 MB | no |
| dense_2 | 192.0 ms | 70.4 ms | 7.4 ms | 69.5 ms | 8.1 ms | 406.9 ms | 259.5 MB | no |
| dense_3 | 612.8 ms | 247.3 ms | 27.1 ms | 217.8 ms | 28.2 ms | 1,356.8 ms | 585.2 MB | no |

The `dense_3` operation pass rounded 26,414 note starts, extended 366 undersized notes, and remixed 264 segments / 36,016 notes. No transform crossed the explicit 30-second budget.

The project-store benchmark separately created, nudged, and quantized 36,864 notes over 256 segments. Median total time was 30.36 ms; nudge was 1.39 ms; segment quantization was 1.20 ms; median heap/RSS increase was 6.82/4.16 MB.

## Realtime limit ladder

Configuration: 48 kHz, 256-sample callback, 5.333 ms deadline. Each track uses 24 simultaneous dense Aether voices, per-note + segment + track automation, three serial inserts, two sends, nested two-bus FX, and master compression.

| Tracks | Simultaneous voices | p95 callback load | Peak callback | Deadline overruns | Event / note-off overflows | Result |
|---:|---:|---:|---:|---:|---:|---|
| 1 | 24 | 45.95% | 46.15% | 0 | 0 / 0 | recommended headroom |
| 2 | 48 | 94.57% | 96.78% | 0 | 0 / 0 | deadline met, little headroom |
| 4 | 96 | 148.02% | 148.02% | 8 | 0 / 0 | realtime boundary crossed |
| 16 | 384 | 725.93% | 731.05% | 40 | 128 / 128 | fixed event capacity crossed |
| 72 | 1,552 active | 999% capped | 999% capped | 40 | 1,480 / 1,472 | deliberate destructive limit |

The same boundary was stable at 128-, 256-, and 512-sample buffers: 1 track retained headroom, 2 tracks met the deadline, and 4 tracks missed it. Synth processing, not route FX, dominates this particular test.

## Dense native render/export companions

| Project | BPM | Tracks | Notes | Active FX | Automation points | p95 callback load | Event / note-off overflows | Export time | Audio duration | Export speed | Timed out | Clipping |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| dense_1 | 128 | 5 | 500 | 29 | 2,620 | 142.80% | 0 / 0 | 4.00 s | 3.75 s | 0.94x realtime | no | 0% |
| dense_2 | 300 | 12 | 11,520 | 112 | 58,320 | 527.76% | 291 / 291 | 16.28 s | 4.80 s | 0.29x realtime | no | 0% |
| dense_3 | 300 | 21 | 37,632 | 277 | 189,924 | 881.52% | 1,380 / 1,380 | 34.30 s | 8.35 s | 0.24x realtime | no | 0% |

All three 24-bit WAVs completed within the 120-second hard timeout, produced finite analyzable audio, reported zero clipping, and had zero realtime callback-safety violations. `dense_2` and `dense_3` are not realtime-playable as constructed; their event bursts exceed fixed scheduler capacity, so overload protection and dropped-event telemetry are expected and correctly reported rather than hidden.

## Regression verification

- Full native `BeatBackendStress`: passed.
- Frontend typecheck and production build: passed.
- DAW core, drum generation, MIDI remix/interactions, audio bus, document roundtrip, and synth roundtrip: passed.
- Synth fallback route: passed with 12 routes, RMS 0.0601, peak 0.5653.
- 24-bit dense exports: passed analysis, no timeout, no clipping.

## Findings and next limits to address

1. Realtime headroom is currently one 24-voice fully dense Aether track at 48 kHz / 256 samples. Two such tracks work but leave less than 6% p95 deadline margin.
2. Huge same-block chords overflow event and pending-note-off capacity beginning around 384 simultaneous voices. The queue should be enlarged or excess note events should be deterministically spread/culled with explicit UI feedback.
3. Offline export remains correct under these tests but is slower than realtime for the dense tiers (0.29x and 0.24x). Parallel offline voice rendering or cached modulation/oscillator work is the main optimization opportunity.
4. Document transformations are not the bottleneck: even the 74 MB project completes the whole parse/arpeggiate/round/remix/serialize pass in 1.36 seconds. Memory peaks are material, however; `dense_3` adds about 585 MB RSS during the all-at-once pass.
