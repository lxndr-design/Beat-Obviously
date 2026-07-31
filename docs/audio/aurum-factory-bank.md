# Aurum Factory Bank v2

## Scope

This is a Beat-authored production bank for Aurum's current v13 contract. It reuses Beat's own diagnostic archetypes as starting topology material, then applies distinct names, stable IDs, production tags, level/filter refinements, listening intent, and ready-to-perform shared modulation routes. It does not copy Sytrus presets, names, assets, or parameter data.

Factory sound records are deeply frozen in memory. Per-user favorites are stored separately by stable preset ID, so starring a factory preset cannot rewrite its sound payload. Applying or auditioning a factory preset clones its normalized sound state onto an existing Aurum destination while preserving that instrument's project/library identity.

## Bank

| Stable ID | Name | Family | Audition | Listening intent |
| --- | --- | --- | --- | --- |
| `factory.aurum.substructure.v2` | Substructure | Bass | C2, velocity 112, 1.8 s | Centered sub fundamental, defined attack, clean glide tail |
| `factory.aurum.glass-current.v2` | Glass Current | Bell | C5, velocity 104, 3.2 s | Separated metallic partials and stable open decay |
| `factory.aurum.tine-circuit.v2` | Tine Circuit | Keys | C4, velocity 96, 2.2 s | Clear tine transient and balanced stereo body |
| `factory.aurum.slow-aurora.v2` | Slow Aurora | Pad | G3, velocity 88, 4.2 s | Slow centered bloom, width, and restrained upper haze |
| `factory.aurum.vector-lead.v2` | Vector Lead | Lead | G4, velocity 108, 2.0 s | Immediate pitch center, controlled feedback edge, clean release |
| `factory.aurum.kinetic-hit.v2` | Kinetic Hit | Percussion | C3, velocity 118, 1.2 s | Single transient, audible pitch drop, short clean tail |
| `factory.aurum.broken-orbit.v2` | Broken Orbit | FX | E3, velocity 100, 3.0 s | Deliberate stereo asymmetry and bounded ring-modulated motion |

Each v2 sound has at least two zero-neutral performance routes across Macro 1, mod wheel, or pressure. The initial regression fingerprint therefore remains stable, while the rebuilt bank exposes master, operator-level, operator-pan, and Filter A/B destinations when those controls are moved.

## Automated regression metrics

The focused Aurum verifier renders 16,384 stereo frames at 48 kHz using each preset's documented note and velocity. These are bounded regression envelopes, not a claim of perceptual quality or parity with another instrument. Slow Aurora's short window intentionally measures its first 341 ms of attack rather than its eventual bloom.

| Preset | Peak range | RMS range |
| --- | ---: | ---: |
| Substructure | 0.460–0.570 | 0.280–0.350 |
| Glass Current | 0.160–0.200 | 0.067–0.083 |
| Tine Circuit | 0.124–0.153 | 0.033–0.041 |
| Slow Aurora | 0.007–0.009 | 0.0023–0.0029 |
| Vector Lead | 0.233–0.285 | 0.107–0.131 |
| Kinetic Hit | 0.540–0.660 | 0.058–0.072 |
| Broken Orbit | 0.105–0.129 | 0.023–0.029 |

Slow Aurora also has a full 4.2-second audition regression. Its measured peak is `0.060565` and RMS is `0.010925`; the accepted envelopes are `0.054–0.067` peak and `0.0098–0.0121` RMS. The verifier requires every sample to remain finite and rejects any sample at or above `0.999`, including during the second half of the audition. The current render has zero clipped samples.

The verifier also requires every preset to remain finite, fall inside its own envelope, and retain a distinct peak/RMS fingerprint. Human listening sign-off and durable audio regression hashes remain release-readiness work.
