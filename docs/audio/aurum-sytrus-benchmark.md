# Aurum / Sytrus Benchmark

## Historical product boundary

Aurum is Beat's six-operator FM, RM, additive, and subtractive instrument. Sytrus is the correct behavior-reference family because its official architecture is also centered on six freely routed operators, FM/RM interaction, additive operator shaping, filter routing, performance articulation, unison, and patch effects. Aurum is not Beat's Serum 2 successor; that role belongs to Lumen, which extends the frozen Aether foundation into a three-slot hybrid engine.

This benchmark uses only Image-Line's official [Sytrus manual](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Sytrus.htm) as a high-level capability reference. No Image-Line source, preset, oscillator data, audio, artwork, executable, service, or branding is copied or adapted. No locally installed Sytrus renderer was found, so this document makes no direct sound-quality, null-test, preset, or CPU claim.

The machine-readable comparison is `docs/audio/aurum-sytrus-capability-matrix.json`.

## Current parity shape

Aurum already matches the central architectural idea rather than merely resembling the interface: six fixed operators can be carriers or modulators, separate bipolar FM and RM matrices include self-feedback, a dedicated output matrix routes every operator to two filters or direct output, and the complete topology persists and renders through browser and native paths. Operator-level additive shaping, wavefold, three ADSR domains, velocity/key response, pan, unison, oversampling, graph diagnostics, edit commands, and algorithm templates make the current foundation materially programmable.

The remaining gap is depth around that core. Sytrus exposes much richer operator waveform construction, multi-segment articulation, programmable unison variation, three filters, integrated EQ/effect routing, broad modulation/performance mapping, and a mature preset workflow. Aurum currently has 16 amplitude-only harmonics rather than 128 amplitude/phase bins; fixed ADSRs and five-point gain curves rather than general articulators; two output filters; and simple detune/spread unison. The schema-v13 shared Beat bridge now routes Envelope 1, tempo-synced LFO 1, two independently editable macros, velocity, keytrack, mod wheel, or pressure to master level/pan, every operator's level/pan, or Filter A/B cutoff, resonance, and drive. Browser audition captures the current expression snapshot and verifies deterministic manual/automation/macro/expression precedence. Additional shared sources and tuning/matrix destinations remain open, as does continuous expression during an already-rendered browser audition.

## Priority order

1. **Preset workflow:** versioned records, migration, search, tags, favorites, reversible audition, identity-safe apply, confirmed delete, and Factory Bank v2 with v13 performance routes are integrated; finish human listening sign-off and durable hashes.
2. **Shared modulation bridge:** keep the verified v13 destination and precedence contract bounded; add streaming browser expression only when continuous mid-audition control is required, before expanding destinations.
3. **Operator articulation depth:** general multi-point curves first; harmonic phase and a larger bounded spectrum only with browser/native and alias-budget evidence.
4. **Unison and routing depth:** phase/volume/envelope variation, then evaluate a third filter or more flexible effect sends against CPU and UI cost.
5. **Release evidence:** browser/native bounded differences, alias and cross-rate thresholds, supported-load tiers, accessibility, and listening hashes.

This ordering preserves the already-correct FM/RM engine and addresses the largest workflow and modulation deficits before expanding oscillator cost.
