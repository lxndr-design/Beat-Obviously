# Lumen v16 Capability Bank

The rebuilt factory bank contains seven Beat-authored Lumen instruments on the current v16 patch contract. New engine data uses the canonical `lumen-hybrid-synth` / `lumen` persistence identity. The existing opaque `factory.lumus-*` record IDs remain unchanged solely to keep project/library foreign-key references valid; labels, engine symbols, parameter IDs, and newly saved engine payloads use Lumen. The instruments use built-in synthesis, independently designed prepared spectral-harmonic warps, and the existing Beat-owned granular benchmark source; no external preset, sample, or wavetable content is included. Stable factory IDs migrate the earlier `_01` instruments to user-facing `Lumen_*_02` names in place, preserving project/library references while replacing their sound payload with the current bank.

In the app, open the **Instruments** panel and expand **Lumen Test**. The seven entries are protected factory instruments with stable IDs. Selecting an entry opens the Lumen editor with the authored patch; the same records remain searchable in the shared preset browser.

| Instrument | Primary coverage | Hands-on test | Expected result |
|---|---|---|---|
| `Lumen_SubBass_02` | Three-source tuning, direct route, mono/legato, glide, compression | Play detached and overlapping C1-G1 notes, then release. | A centered fundamental, short controlled glide only on overlap, correct note lengths, and no stuck bass note. |
| `Lumen_ArpPluck_02` | Arpeggiator, scale constraint, swing, keytracked LFO motion, Filter 2, delay | Hold a C-minor triad around C4; transpose it by octaves; change rate and swing; release all keys. | A repeatable two-octave up/down pattern whose wavetable motion speeds up above C4 and slows below it, plus audible swing and complete stop after the delay tail. |
| `Lumen_WidePad_02` | Polyphony, unison, Spectral Smear, pan, slow envelope, chorus/reverb order | Hold four-note chords from C3-C5, release, then repeat at a different block position. | Smooth spectrally spread swell and tail, stable stereo width, no click, missing voice, or indefinite hold. |
| `Lumen_MonoLead_02` | Harmonic Shift, mono priority, legato, glide, velocity, dual-filter routing, insert order | Play overlapping C4-E4-G4 phrases with varied velocity, then detached notes. | Connected notes glide with a distinct shifted harmonic edge; detached notes retrigger; all note-offs terminate cleanly. |
| `Lumen_DigitalKeys_02` | Spectral Skew, chord polyphony, velocity, ratio tuning, repeated-note lifecycle | Play short chords and repeated notes from C3-C6 in the main editor and piano-roll editor. | Both editors honor identical note lengths and tuning, with an audible skewed harmonic color and no preview/playback substitution. |
| `Lumen_ClipSequence_02` | Eight-step polyphonic clip, chord starts, rests, note velocity/length, swing, trigger transposition | Hold C3, then F3; release and retrigger. | The chordal phrase restarts and transposes deterministically, preserves its rests/accents and independent note-offs, and silences when the trigger is released. |
| `Lumen_GranularTexture_02` | Slot C granular mode, deterministic seed, stereo spread, hybrid layering | Hold a low fifth for several seconds, release, then repeat the same notes. | Finite, audible texture with repeatable motion and a smooth release; it should be clearly distinct from the pad. |

## Save/reopen and routing pass

For each instrument:

1. Add it from the factory library and record a short MIDI phrase.
2. Reorder or bypass one instrument insert where present.
3. Save the project, close it, and reopen it.
4. Confirm the instrument name, Lumen editor identity, Slot A/B/C state, arp/clip state, insert order, and sound remain unchanged.
5. Confirm main-editor playback, piano-roll playback, and live keyboard audition respect the same note starts and lengths.

Automated coverage requires exact factory names and Lumen identity, schema-idempotent roundtrips, finite output, RMS above `0.005`, peak below full scale, and pairwise render-difference RMS above `0.002`. The existing native project lifecycle fixture separately covers native save/reopen and sample-identical routed rendering.

## Sample direction and rate pass

For a Lumen instrument with an imported Sample source in each of A, B, and C:

1. Set one slot to Reverse and confirm a new note begins at the bounded end marker and travels toward the start marker without a click or invalid read.
2. Compare 0.5x, 1x, and 2x playback rates on the same note. Confirm duration and pitch motion change predictably and the value remains constrained to 0.25x-4x.
3. Enable a valid loop and repeat both Forward and Reverse playback. Confirm the loop wraps at the configured boundaries and its crossfade remains smooth in both directions.
4. Save, close, and reopen the project. Confirm direction and rate survive independently for A, B, and C.
5. Switch the same slot to Multisample. Confirm the shared mapped renderer uses its established forward/1x policy rather than inheriting the Sample-only controls.

Automated coverage separately checks browser differentiation, native decoded and managed-SFZ rendering, reverse streaming preloads, v11-to-v12 neutral migration, project persistence, and unchanged frozen Aether hashes.

## Sample ping-pong and release-tail pass

For a Lumen slot in Sample mode with a valid enabled loop:

1. Compare Forward and Ping-pong loop modes. Forward wraps through the existing bounded crossfade; Ping-pong reaches the loop boundary, reverses the current voice direction, and traverses back without a wrap.
2. Repeat with initial Direction set to Reverse. The note starts at the bounded end marker, enters the loop from the reverse leg, then alternates at the same loop limits.
3. Set Release Tail to 4 ms, 100 ms, and 1000 ms. On note-off, confirm the active decoded voice continues its current loop traversal while its gain reaches silence over the selected interval rather than stopping abruptly.
4. For managed SFZ assets, confirm Ping-pong applies only to regions that already declare continuous or sustain loops. Sustain loops leave the loop on release while fading; continuous loops keep alternating through the tail; one-shot regions keep their SFZ note-off-independent behavior.
5. Save and reopen the project, then switch the slot to Multisample. Confirm Sample values persist but Multisample playback uses the established Forward/1x, non-ping-pong, 4 ms policy.

Automated coverage checks v12-to-v13 neutral migration, invalid loop-mode rejection, decoded and managed-SFZ ping-pong rendering without callback safety violations, configurable release lifetime, browser proxy differentiation, project persistence, and unchanged frozen Aether hashes.

## Sample slice pass

For a Lumen slot in Sample mode with a loaded decoded sample or managed SFZ asset:

1. Set the Full Region Start and End controls to a useful source range, choose **Add from Full Region**, and confirm a stable numbered slice appears and becomes selected.
2. Edit **Slice Start** and **Slice End** directly. Confirm the selected range remains ordered with a minimum gap and playback begins/ends inside those bounds.
3. Enable Reverse, Ping-pong, and a non-default Release Tail. Confirm all three operate inside the selected region without escaping to the base Full Region.
4. Add several slices, switch between them and **Full Region**, remove one, then save and reopen. Confirm selection, IDs, ranges, and the unselected Full Region survive exactly.
5. Switch the slot to Multisample or open an Aether instrument. Confirm slice selection has no audible effect and does not leak into those policies.

Automated coverage checks v13-to-v14 empty-slice migration, strict 16-slice/unique-ID/finite-range validation, missing-selection rejection, browser selected-versus-Full-Region differentiation, decoded and SFZ selected-region rendering without callback safety violations, native project persistence, and unchanged frozen Aether hashes.

The v16 48 kHz automated audit renders a deterministic one-second audition for every factory patch. All seven pass the factory metadata, macro assignment, finite-output, RMS-above-`0.005`, below-full-scale peak, and pairwise difference-above-`0.002` gates. Repeated auditions are sample-exact. Exact loudness figures are intentionally not frozen as compatibility baselines; the frozen Aether render hashes remain the separate regression oracle.
