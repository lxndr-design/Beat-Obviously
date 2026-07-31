# Test_song_1

`Test_song_1` is the first numbered Beat stress-test composition. It is a 60-second song at 128 BPM with a deliberately non-uniform energy curve rather than a continuous feature audition.

## Form

- Beats 0-16 — **Gentle Dawn:** three-voice Lumen pad voicings expand gradually; keys and a quiet statement of the recurring lead hook enter as isolated answers.
- Beats 16-32 — **Sparse Pulse:** light sampled drums, the two-bar Lumen bass hook, guide-tone motion, and intentional gaps establish the core vocabulary.
- Beats 32-48 — **Disco String Lift:** off-beat fake-string bows, disco-brass stabs, the returning bass hook, an A-prime lead cadence, and restrained four-on-the-floor samples.
- Beats 48-60 — **Accelerating Build:** eighth-note arpeggiation doubles to sixteenths while strings, brass, bass, and Aether automation rise.
- Beats 60-64 — **Pre-Drop Vacuum:** bass and main harmony disappear; only air, a short pickup, and the end of the drum fill remain.
- Beats 64-80 — **First Dubstep Drop:** the complete A/A-prime Anthem hook trades prominence with a Ribbon harmony moving from open fifths into resolving seconds, over the recurring Pulse Bassline, sub, Wobble/Growl calls, chord punches, brass, and half-time sample drums.
- Beats 80-88 — **Breakdown:** density drops to pad, choir, texture, sparse samples, and a half-time fragment of the hook.
- Beats 88-96 — **Rebuild:** bass hook, arp, choir, brass, and drums return progressively.
- Beats 96-120 — **Final Dubstep Peak:** the densest section moves the dual lead through thirds, sixths, and chordal voicings while combining Star Counterlead answers, selective Drop Lead shadows, Pulse Bassline, sub and bass call/response, chord punctuation, strings, choir, arp bursts, brass, and sampled drums.
- Beats 120-128 — **Graceful Resolution:** percussion and bass stop; Bbmaj9 opens into Dm(add9) with both lead voices resolving slowly over air choir and keys.

## New editable Lumen instruments

- **Lumen Dawn Veil** — slow, low-pass three-oscillator pad with restrained unison.
- **Lumen Disco Strings** — fast-envelope saw/pulse fake strings with high-pass filtering and chorus.
- **Lumen Glass Pluck** — short triangle/sine pluck for sparse and accelerating arpeggios.
- **Lumen Wobble Bass** — mono low-register patch with synchronized filter motion.
- **Lumen Growl Bass** — warped pulse/saw response patch with synchronized filter and warp movement.
- **Lumen Neon Drop Lead** — mono three-voice-unison lead with glide and restrained saturation/delay.
- **Lumen Pulse Bassline** — mono low-mid bass dedicated to the recurring syncopated A/B riff.
- **Lumen Anthem Lead** — the primary two-bar A/A-prime hook voice with glide, chorus, and delay.
- **Lumen Ribbon Harmony** — a softer polyphonic partner for fragments, thirds, sixths, open intervals, resolving dissonance, and chordal lead voicings.
- **Lumen Disco Brass** — short-envelope saw/pulse chord stabs for the lift, builds, and peaks.
- **Lumen Star Counterlead** — a bright four-note answer that returns after the main hook cadence.
- **Lumen Air Choir** — a restrained slow-attack layer for breakdown, peak support, and release.

All twelve are persisted inside the project as editable `lumen-hybrid-synth` patches. The drum parts use LM-2 and Pearl samples; `Aurum_Percussion_01` is not included.

## Recurring themes

- **Dual lead:** the Anthem voice carries a fixed two-bar, twelve-note phrase as A and A-prime statements. A-prime preserves the recognizable six-note opening cell and changes only the cadence. Its paired Ribbon voice changes role each time: sparse lower support, thirds, sixths, open intervals, brief seconds resolving to unison, a low-octave fragment, and finally polyphonic chord tones. Note starts, lengths, velocities, stereo position, and subtle pitch motion use deterministic phrase shaping rather than identical quantized values. The Neon shadow appears only on selected peak entrances, while the Star Counterlead remains a separate four-note response.
- **Bass:** a two-bar A/B syncopation follows the Dm9-Bbmaj9-Fmaj9-Cadd9/G progression while retaining the same octave, fifth, and approach-note contour. It returns in 12 arrangement segments and adds one short pickup per bar only at the final peak.

## Verified structure and reference render

- Project name and file: `Test_song_1` / `Test_song_1.beat`
- Duration: 60 seconds / 128 beats
- Sample rate and preview format: 48 kHz stereo 16-bit PCM WAV
- Tracks / named clips / short clips: 21 / 137 / 121
- Distinct track instruments / custom Lumen instruments: 20 / 12
- MIDI notes / distinct lengths: 1,190 / 92
- Primary lead / Ribbon harmony / recurring bass segments: 10 / 10 / 12
- Humanized lead starts / distinct lead velocities: 143 / 51
- Lead harmony clusters / resolving dissonances: 4 / 6
- Drum loops / total loop plays: 13 / 31
- Pitch-curve notes / legato links: 91 / 21
- Note automation lanes / segment automation lanes: 463 / 42
- Peak concurrent arrangement segments: 15
- Effects across instruments, tracks, and buses: 75
- Overall RMS / peak: `0.0713891814056777` / `0.8199999928474426`
- Gentle Dawn RMS: `0.01237389446355474`
- Disco String Lift RMS: `0.07440834380016606`
- Pre-Drop Vacuum RMS: `0.03200219365098424`
- First Dubstep Drop RMS: `0.07794720576596888`
- Breakdown RMS: `0.045311482916268096`
- Final Dubstep Peak RMS: `0.09989771882351145`
- Graceful Resolution RMS: `0.015362104261356035`
- Project SHA-256: `290954dc0847de702f613fd1575f6b3a9ba2fc4e2e76aa7596a3863532e5726e`
- Preview SHA-256: `5ee4d18183155cd1b44638fa85cd687c3a312667c6b9fc88ead2b84b926680a4`

The generator asserts that the final peak is louder than both the disco lift and first drop, the pre-drop vacuum is materially below the build, and the opening and resolution remain below 30% of the final peak RMS.

## Generate

```sh
node scripts/create-lumen-aurum-demo.mjs /private/tmp/Test_song_1
```

The output folder contains `Test_song_1.beat`, `Review/Test_song_1_Preview.wav`, and `Review/demo-report.json`. The generator validates document migration, feature coverage, output safety, the energy arc, and deterministic project/preview hashes.
