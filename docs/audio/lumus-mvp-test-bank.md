# Lumus MVP Test Bank

The factory test bank contains seven Beat-authored Lumus instruments. They use built-in synthesis and the existing Beat-owned granular benchmark source; no external preset, sample, or wavetable content is included.

| Instrument | Primary coverage | Hands-on test | Expected result |
|---|---|---|---|
| `Lumus_SubBass_01` | Three-source tuning, direct route, mono/legato, glide, compression | Play detached and overlapping C1-G1 notes, then release. | A centered fundamental, short controlled glide only on overlap, correct note lengths, and no stuck bass note. |
| `Lumus_ArpPluck_01` | Arpeggiator, scale constraint, swing, Filter 2, delay | Hold a C-minor triad around C4; change rate and swing; release all keys. | A repeatable two-octave up/down pattern, audible rate/swing changes, and complete stop after the delay tail. |
| `Lumus_WidePad_01` | Polyphony, unison, pan, slow envelope, chorus/reverb order | Hold four-note chords from C3-C5, release, then repeat at a different block position. | Smooth swell and tail, stable stereo width, no click, missing voice, or indefinite hold. |
| `Lumus_MonoLead_01` | Mono priority, legato, glide, velocity, dual-filter routing, insert order | Play overlapping C4-E4-G4 phrases with varied velocity, then detached notes. | Connected notes glide; detached notes retrigger; velocity remains audible; all note-offs terminate cleanly. |
| `Lumus_DigitalKeys_01` | Chord polyphony, velocity, ratio tuning, repeated-note lifecycle | Play short chords and repeated notes from C3-C6 in the main editor and piano-roll editor. | Both editors honor identical note lengths and tuning, with even attacks and no preview/playback substitution. |
| `Lumus_ClipSequence_01` | Eight-step clip, rests, step velocity/length, swing, trigger transposition | Hold C3, then F3; release and retrigger. | The phrase restarts and transposes deterministically, preserves its rests/accents, and silences when the trigger is released. |
| `Lumus_GranularTexture_01` | Slot C granular mode, deterministic seed, stereo spread, hybrid layering | Hold a low fifth for several seconds, release, then repeat the same notes. | Finite, audible texture with repeatable motion and a smooth release; it should be clearly distinct from the pad. |

## Save/reopen and routing pass

For each instrument:

1. Add it from the factory library and record a short MIDI phrase.
2. Reorder or bypass one instrument insert where present.
3. Save the project, close it, and reopen it.
4. Confirm the instrument name, Lumus editor identity, Slot A/B/C state, arp/clip state, insert order, and sound remain unchanged.
5. Confirm main-editor playback, piano-roll playback, and live keyboard audition respect the same note starts and lengths.

Automated coverage requires exact factory names and Lumus identity, schema-idempotent roundtrips, finite output, RMS above `0.005`, peak below full scale, and pairwise render-difference RMS above `0.002`. The existing native project lifecycle fixture separately covers native save/reopen and sample-identical routed rendering.

The 48 kHz factory audit measured:

| Instrument | RMS | Peak | Macro routes | Inserts |
|---|---:|---:|---:|---:|
| `Lumus_SubBass_01` | 0.11481 | 0.37731 | 4 | 1 |
| `Lumus_ArpPluck_01` | 0.01473 | 0.17413 | 4 | 1 |
| `Lumus_WidePad_01` | 0.07166 | 0.34037 | 4 | 2 |
| `Lumus_MonoLead_01` | 0.16172 | 0.75295 | 4 | 2 |
| `Lumus_DigitalKeys_01` | 0.07720 | 0.43125 | 4 | 1 |
| `Lumus_ClipSequence_01` | 0.04030 | 0.46365 | 4 | 1 |
| `Lumus_GranularTexture_01` | 0.02718 | 0.13968 | 4 | 1 |

All seven passed the factory metadata, macro assignment, finite-output, minimum-level, and below-clipping gates. Repeated auditions are sample-exact and every pair passes the material-difference threshold.
