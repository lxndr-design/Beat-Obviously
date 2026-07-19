# Aether Factory Preset Audition Log

This log closes the factory Aether preset audition pass for the current v1 preset set. It pairs render-audit evidence with the intended subjective listening target for each preset.

Audit command:

```sh
npm run audit:aether-presets
```

The dedicated string benchmark additionally runs with `npm run benchmark:aether-serum`; its complete measurement boundary and frozen hashes are recorded in `docs/audio/aether-serum-benchmark.md`.

Audit thresholds:

- Minimum RMS: `0.005`
- Minimum peak: `0.02`
- Maximum peak before clipping concern: `0.99`
- Required families: Poly Keys, Arp Pluck, Pad, Bass, Lead, Bell, Lo-Fi Pad, Chord Stab, Sub Bass, Atmosphere, Bass / Crunch, Crunch Lead, Vocal Pad, Vocal Pluck, Synth String, Keys / Synth Piano, and Mallet.
- Non-init factory presets must use family-specific macro labels and at least four macro routes.

## Preset Review

| Preset | Family | Role | RMS | Peak | Audition target |
| --- | --- | --- | ---: | ---: | --- |
| Carbon Poly | Poly Keys | poly keys | 0.15851 | 0.70143 | Warm, playable chords with light wavetable animation. |
| Glass Runner | Arp Pluck | arp pluck | 0.08498 | 0.59673 | Fast arpeggios with a crisp, controlled transient. |
| Velvet Choir Pad | Pad | pad | 0.07522 | 0.51860 | Slow chords with a smooth, non-brittle swell. |
| Factory Reese | Bass | bass | 0.18305 | 0.69841 | Sustained low notes with movement and a stable center. |
| Laser Brass Lead | Lead | lead | 0.21585 | 0.69799 | Expressive upper-register phrases without harsh clipping. |
| Frozen Bell Stack | Bell | bell | 0.04676 | 0.33776 | Clear bell attack followed by a natural decay. |
| Analog Dust Pad | Lo-Fi Pad | lo-fi pad | 0.18866 | 0.64896 | Wide, aged motion without unstable level changes. |
| Neon Chord Stab | Chord Stab | chord stab | 0.06393 | 0.50680 | Short chord accents with controlled pumping and delay. |
| Sub Anchor | Sub Bass | sub bass | 0.27172 | 0.78624 | Strong fundamental with controlled overtones. |
| Scanner Drone | Atmosphere | atmosphere | 0.04655 | 0.48853 | Slow spectral motion without masking the fundamental. |
| Concrete Reese | Bass / Crunch | bass / crunch | 0.16009 | 0.67856 | Distorted mid-bass movement with a stable low center. |
| Bit Jaw | Crunch Lead | crunch lead | 0.18111 | 0.71216 | Aggressive digital articulation without broadband breakup. |
| Vowel Choir | Vocal Pad | vocal pad | 0.07789 | 0.59031 | Sustained vowel motion with smooth frame transitions. |
| Talk Pluck | Vocal Pluck | vocal pluck | 0.10369 | 0.73057 | Short vocal-like articulation without clicks. |
| Resin Violin Lead | Synth String | synth string | 0.17265 | 0.57782 | Bowed attack and stable vibrato across the lead register. |
| Block Felt Piano | Keys / Synth Piano | keys / synth piano | 0.16731 | 0.79411 | A soft keyed attack that decays rather than sustaining like a pad. |
| Toy Xylophone | Mallet | mallet | 0.11156 | 0.60127 | Bright wooden attack with a bounded short decay. |
| Benchmark - Future Bass Strings | Benchmark Strings | rhythmic future-bass string stack | 0.19521 | 0.71141 | Syncopated chords from C3-C5; pumping motion should remain clear without brittle upper notes. |
| Benchmark - Progressive House Strings | Benchmark Strings | sustained progressive-house string pad | 0.13698 | 0.61884 | Held triads and overlapping chord changes; the swell should remain warm, coherent, and click-free. |

## Closeout Notes

- All current factory presets render finite, non-silent output within the audit thresholds.
- All required Aether families are represented.
- All non-init factory presets use family-specific macro labels and macro route assignments.
- New factory presets must update this log and pass `npm run audit:aether-presets`.
