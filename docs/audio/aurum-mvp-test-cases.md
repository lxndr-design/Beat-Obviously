# Aurum MVP Test Cases

## Test bank

The system-owned Aurum Test group contains eight diagnostic patches. They are intentionally named as test assets rather than release presets.

| Patch | Primary coverage |
| --- | --- |
| `Aurum_Bass_01` | Sub-ratio carrier, three-operator FM stack, feedback, low-pass drive, mono/legato/glide |
| `Aurum_Bell_01` | Inharmonic ratios, long independent releases, velocity response, 4x quality |
| `Aurum_Keys_01` | Dual carrier branches, opposing operator pan, parallel dual filters |
| `Aurum_Pad_01` | Additive spectra, long envelopes, five-way unison, stereo spread |
| `Aurum_Lead_01` | Saw source, wavefold, feedback, serial filters, mono/legato/glide |
| `Aurum_Percussion_01` | Pitch-envelope transient, short envelopes, high-ratio additive modulator |
| `Aurum_Organ_01` | Six simultaneous carriers, drawbar-like ratios, per-operator pan |
| `Aurum_FX_01` | Bipolar FM, positive/negative RM, phase-inverted output send, feedback, parallel filters |

## Automated gate

`npm run verify:aurum` performs these checks:

1. The bank exposes all eight canonical names with unique stable ids in the Aurum Test group.
2. Each patch retains the structural trait that defines its archetype.
3. Every patch renders stereo at 44.1, 48, and 96 kHz.
4. Every rendered sample is finite and every render is audible with peak amplitude no greater than 1.
5. Each archetype produces a waveform fingerprint distinct from `Aurum_Bass_01`.
6. Keys, Pad, Organ, and FX produce measurable left/right separation.

## Functional cases

### ATM-001: Factory-bank discovery

1. Start Beat with an existing instrument library.
2. Open Instruments > Aurum Test and search for `Aurum_`.
3. Restart Beat and repeat the search.

Expected: all eight patches appear exactly once after both starts. They use the Aurum editor and cannot be deleted as user instruments.

### ATM-002: Bass performance behavior

1. Load `Aurum_Bass_01` on a track.
2. Play separated notes, then overlapping legato notes across C1-C3.
3. Toggle mono, legato, and glide in the instrument data when those controls become available in the Aurum editor.

Expected: the patch stays monophonic, overlapping notes retune without an envelope restart, and pitch transition is smooth. No click or stuck voice occurs.

### ATM-003: Bell decay and register

1. Play `Aurum_Bell_01` at C2, C4, and C6 with low and high velocity.
2. Release each note after 100 ms and allow the tail to finish.

Expected: higher velocity is brighter/louder, inharmonic partials remain clear, each release decays without truncation, and high notes remain bounded at 4x quality.

### ATM-004: Keys stereo branches

1. Play sustained chords through `Aurum_Keys_01`.
2. Solo Filter A, then Filter B, then restore both in Parallel mode.
3. Monitor left, right, and mono-folded output.

Expected: both branches are audible, left/right content differs, mono fold remains present, and neither filter changes the other branch in Parallel mode.

### ATM-005: Pad additive and unison load

1. Hold a six-note chord with `Aurum_Pad_01` through its attack and release.
2. Repeat at 1x, 2x, and 4x quality.
3. Watch callback load and listen for clicks during note start, sustain, and release.

Expected: the additive spectrum and stereo width remain audible, release is not cut short, quality changes remain bounded, and no callback dropout occurs at the supported voice load.

### ATM-006: Lead nonlinear stability

1. Play `Aurum_Lead_01` from C2 to C7, including rapid legato runs.
2. Sweep wavefold from 0 to 1 and OP 2 feedback from -1 to 1.
3. Repeat at 1x and 4x quality.

Expected: timbre changes continuously, output remains finite and bounded, feedback does not latch after note-off, and no invalid value reaches the meters or export.

### ATM-007: Percussion transient

1. Trigger `Aurum_Percussion_01` at low, medium, and high velocity.
2. Repeat at 44.1, 48, and 96 kHz projects.

Expected: the pitch drop is immediate and audible, the body ends cleanly, no voice remains active after the short release, and the overall character remains recognizable at every rate.

### ATM-008: Six-carrier organ

1. Hold single notes and eight-note chords with `Aurum_Organ_01`.
2. Mute and restore each operator in sequence.
3. Pan each operator through its full range.

Expected: every operator contributes a distinct drawbar harmonic, summed level stays bounded, pan reaches both endpoints, and muting one operator does not alter unrelated operator routing.

### ATM-009: RM and bipolar routing

1. Audition `Aurum_FX_01` and inspect FM, RM, and OUT matrices.
2. Invert each nonzero bipolar route individually.
3. Disable Filter A, Filter B, and Direct in turn.

Expected: route inversion changes phase/timbre rather than muting unexpectedly, RM remains bounded, disabled filters bypass assigned signal, and Direct remains independent of both filters.

### ATM-010: Operator commands

1. Copy OP 1 and paste into OP 3.
2. Initialize OP 3.
3. Swap OP 2 and OP 3.
4. Reset OP 3.

Expected: Paste preserves OP 3 id/name; Init preserves routing; Swap moves parameters plus FM/RM rows, target columns, and output row; Reset initializes parameters and clears every inbound/outbound route for OP 3.

### ATM-011: Algorithm templates

Apply each of the seven templates and inspect signal diagnostics plus FM, RM, and OUT matrices.

Expected: only required operators are enabled, exact template routes are installed, stale RM/output routes are cleared, oscillator/envelope parameters remain unchanged, and manual routing returns the selector to Custom algorithm.

### ATM-012: Save, reopen, and export

1. Modify one parameter and one route in each test patch, then save as a user instrument.
2. Save and reopen the project.
3. Export the same MIDI phrase at 44.1, 48, and 96 kHz.

Expected: all schema-v10 fields survive, reopened playback matches the saved patch, exported WAV metadata matches the request, and live/export output remains bounded without a silent render.

### ATM-013: Shared effects path

Add instrument Chorus, track Delay, and a Reverb send to each archetype, then bypass them one at a time.

Expected: Aurum output traverses each shared Beat stage in order, bypass removes only that stage, and no Aurum-specific duplicate effect path appears.

### ATM-014: Dense-engine stress

Use `Aurum_FX_01`, enable all six operators, fill FM and RM matrices with alternating full bipolar depths, select eight-way unison and 4x quality, then render with block sizes from 1 to 4096.

Expected: output remains finite and bounded, work counters scale deterministically, note-off clears all voices, and live/export paths do not diverge beyond the documented threshold.

## MVP exit recommendation

Treat ATM-001, ATM-002, ATM-005, ATM-006, ATM-009, ATM-010, ATM-011, and ATM-012 as blocking product-MVP cases. The automated gate is necessary but does not replace listening, native-app persistence, or export review.
