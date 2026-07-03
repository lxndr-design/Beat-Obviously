# Aether Factory Preset Audition Log

This log closes the factory Aether preset audition pass for the current v1 preset set. It pairs render-audit evidence with the intended subjective listening target for each preset.

Audit command:

```sh
npm run audit:aether-presets
```

Audit thresholds:

- Minimum RMS: `0.005`
- Minimum peak: `0.02`
- Maximum peak before clipping concern: `0.99`
- Required families: Bass, Drum, FX, Keys, Lead, Pad, Percussion, Pluck, Template, Texture, Wavetable
- Non-init factory presets must use family-specific macro labels and at least four macro routes.

## Preset Review

| Preset | Family | Role | RMS | Peak | Audition target |
| --- | --- | --- | ---: | ---: | --- |
| Init | Template | init patch | 0.15873 | 0.52123 | Neutral-design baseline for building a patch, not a finished musical preset. |
| Custom Wavetable | Wavetable | animated wavemap bed | 0.17290 | 0.57809 | Mid-register sustained chord; wavemap drift should read without pitch wobble. |
| WT Lead | Lead | bright mono/poly lead | 0.08829 | 0.39701 | C4-C5 short melodic phrases; should cut through without harsh clipping. |
| Glass Pad | Pad | wide sustained pad | 0.02865 | 0.13639 | Slow three-note chords; attack and release should feel smooth without vanishing. |
| Sub Bass | Bass | sub bass | 0.29088 | 0.95787 | C1-C2 bass notes; fundamental should stay strong while drive remains controlled. |
| Digital Pluck | Pluck | short digital pluck | 0.10157 | 0.56647 | C3-C5 arpeggios; transient should speak clearly without excessive click. |
| Velvet Keys | Keys | warm chord keys | 0.15958 | 0.70742 | Compact seventh chords around C3-C4; should feel playable and not pad-like. |
| Carbon Texture | Texture | cinematic motion bed | 0.14830 | 0.54202 | Held notes and slow automation; should create motion without masking the mix. |
| Razor Perc | Percussion | metallic synthetic hit | 0.08879 | 0.52738 | Sixteenth-note accents and one-shot hits; should be sharp without becoming broadband noise. |
| Aether Kick | Drum | synthetic kick | 0.22562 | 0.81484 | C1-C2 quarter-note and break patterns; should punch without a long tail. |
| Aether Snare | Drum | synthetic snare | 0.08397 | 0.76126 | Beats 2 and 4 plus ghost notes; body should stay audible under fast hats. |
| Aether Closed Hat | Drum | closed hat | 0.03130 | 0.49611 | Sixteenth-note hats at 120-180 BPM; transient should read without a ringing pitch. |
| Reese Bass | Bass | detuned bass | 0.34807 | 0.72835 | C1-C2 sustained basslines; movement should be audible while low end stays centered. |
| Acid Line | Bass | acid mono line | 0.20226 | 0.76247 | C2-C4 slide patterns; filter should bite without masking pitch. |
| Hollow Lead | Lead | melodic lead | 0.06982 | 0.39264 | Single-note hooks around C4-C5; tone should feel animated while staying stable. |
| Warm String Pad | Pad | warm string pad | 0.01975 | 0.07512 | Sustained chords around C3-C5; should support harmony without a sharp attack. |
| Noise Riser | FX | transition riser | 0.01353 | 0.14465 | Held notes and one-bar transitions; should add motion without becoming full-volume noise. |

## Closeout Notes

- All current factory presets render finite, non-silent output within the audit thresholds.
- All required Aether families are represented.
- All non-init factory presets use family-specific macro labels and macro route assignments.
- New factory presets must update this log and pass `npm run audit:aether-presets`.
