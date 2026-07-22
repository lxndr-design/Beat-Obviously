# Aether + Aurum + Lumus 30-Second Feature Demo

This 128 BPM project is a feature-integration fixture, not only an instrument audition. All three Beat synth engines remain editable in the generated project:

- Aether: mono/legato Reese line with connected notes, pitch curves, and note/segment/track automation.
- Aurum: keys, bass, bell, and a repeating swung percussion sequence.
- Lumus: pad, arpeggio, sub, and lead parts using the Lumus test bank.

## Covered project features

- Nine editable instrument tracks across Aether, Aurum, and Lumus.
- Three audio buses: Music Group, Drum Crush, and Shared Space.
- Track-to-bus routing, track sends, bus-to-bus sends, pre-fader sends, and master outputs.
- Instrument effects, ten track inserts, seven bus inserts, and automated effect parameters.
- MIDI pitch curves, connected legato notes, velocity variation, and note-, segment-, and track-scoped automation using multiple curve shapes.
- A 16-step Aurum drum loop with 58% swing, per-cell velocity, timing lean, a four-beat source length, and repeated arrangement playback.
- Three master-EQ automation frames plus master compression and gain staging.

Generate the project and deterministic preview outside the repository:

```sh
node scripts/create-lumus-aurum-demo.mjs /private/tmp/Lumus_Aurum_30s_Feature_Demo
```

The generator uses only the merged checkout. It writes a `.beat` project, a stereo WAV preview, and `demo-report.json`. The report fails if any engine, routing tier, requested automation scope, effect coverage, drum timing metadata, or master-processing feature is absent. It also rejects non-finite, inaudibly quiet, or clipped preview output.

## Verified reference render

- Duration: 30 seconds / 64 beats
- Sample rate: 48 kHz
- Format: stereo 16-bit PCM WAV
- Tracks: 9
- Audio buses: 3
- Effects across instruments/tracks/buses: 28
- RMS: `0.07475420442909281`
- Peak: `0.3789234459400177`
- Project SHA-256: `512942ded8a8c6d582b2a4fafcc691afa73d2b65ec99cdc6dccfc814619858dd`
- Preview SHA-256: `18709a1467a244e31abce94f219d617c3c03d0b12c1817fb53ac0f981a5e5678`

The generated review files are temporary artifacts and are not committed.
