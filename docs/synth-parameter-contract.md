# Synth Parameter Contract

This document defines stable names for the first Serum-style synth pass. Backend, frontend, IPC, project state, and presets should use these IDs instead of inventing local aliases.

## Version

- Patch schema version: `1`
- Parameter namespace: `synth`
- Initial instrument type: `wavetable-synth`

## Naming Rules

- IDs are lowercase dot-separated strings.
- IDs are stable once serialized.
- Display labels can change; IDs should not.
- Additive changes are preferred over renaming.
- Deprecate old IDs before removing them from loaders.

## Oscillator Parameters

### Oscillator A

| ID | Type | Range | Default | Notes |
| --- | --- | --- | --- | --- |
| `osc.a.enabled` | boolean | off/on | `true` | Main oscillator enable. |
| `osc.a.wavetable` | string | wavetable ID | `basic.saw` | References factory or imported wavetable. |
| `osc.a.position` | normalized | `0..1` | `0` | Frame position within wavetable. |
| `osc.a.warp` | normalized | `0..1` | `0.2` | Table-generation warp amount. |
| `osc.a.warpMode` | enum | `shape`, `fold`, `pinch` | `shape` | Bounded table-generation warp style. |
| `osc.a.octave` | integer | `-4..4` | `0` | Octave transpose. |
| `osc.a.semitone` | integer | `-12..12` | `0` | Semitone transpose. |
| `osc.a.fine` | cents | `-100..100` | `0` | Fine tuning in cents. |
| `osc.a.level` | normalized | `0..1` | `0.8` | Linear level before voice mix. |
| `osc.a.pan` | bipolar | `-1..1` | `0` | Equal-power pan target later. |
| `osc.a.phase` | normalized | `0..1` | `0` | Start phase when random phase is off. |
| `osc.a.randomPhase` | normalized | `0..1` | `0.25` | Amount of note-on phase randomization. |

### Oscillator B

Use the same parameter suffixes as Oscillator A with the `osc.b.*` prefix.

Initial defaults:

- `osc.b.enabled`: `false`
- `osc.b.wavetable`: `basic.square`
- `osc.b.level`: `0.6`

## Unison Parameters

| ID | Type | Range | Default | Notes |
| --- | --- | --- | --- | --- |
| `unison.enabled` | boolean | off/on | `false` | Enables stacked oscillator voices. |
| `unison.voices` | integer | `1..16` | `1` | Rendered per synth voice. |
| `unison.detune` | normalized | `0..1` | `0.12` | Maps to cents in DSP. |
| `unison.blend` | normalized | `0..1` | `0.75` | Center vs side voice balance. |
| `unison.spread` | normalized | `0..1` | `0.5` | Stereo spread. |

## Filter Parameters

| ID | Type | Range | Default | Notes |
| --- | --- | --- | --- | --- |
| `filter.enabled` | boolean | off/on | `true` | Main voice filter enable. |
| `filter.type` | enum | `lowpass`, `highpass`, `bandpass`, `notch` | `lowpass` | First-pass filter modes. |
| `filter.cutoff` | hz | `20..20000` | `18000` | Smooth before DSP. |
| `filter.keytrack` | normalized | `0..1` | `0` | Filter cutoff follows played pitch; `1` tracks one cutoff octave per pitch octave around middle C. |
| `filter.resonance` | normalized | `0..1` | `0.1` | Maps to Q internally. |
| `filter.drive` | normalized | `0..1` | `0` | Optional nonlinear drive. |

## Amp Parameters

| ID | Type | Range | Default | Notes |
| --- | --- | --- | --- | --- |
| `amp.level` | normalized | `0..1` | `0.8` | Final voice level. |
| `amp.pan` | bipolar | `-1..1` | `0` | Final voice pan. |

## Envelope Parameters

Envelope IDs use `env.N.*`, where `N` starts at `1`.

| ID | Type | Range | Default | Notes |
| --- | --- | --- | --- | --- |
| `env.1.attack` | seconds | `0..30` | `0.005` | Amp envelope attack. |
| `env.1.attackCurve` | enum | `linear`, `exp`, `log`, `s-curve` | `linear` | Attack response curve used by browser preview and native render shaping. |
| `env.1.decay` | seconds | `0..30` | `0.15` | Amp envelope decay. |
| `env.1.decayCurve` | enum | `linear`, `exp`, `log`, `s-curve` | `linear` | Decay response curve used by browser preview and native render shaping. |
| `env.1.sustain` | normalized | `0..1` | `0.8` | Amp envelope sustain. |
| `env.1.release` | seconds | `0..30` | `0.25` | Amp envelope release. |
| `env.1.releaseCurve` | enum | `linear`, `exp`, `log`, `s-curve` | `linear` | Release response curve used by browser preview and native render shaping. |
| `env.2.attack` | seconds | `0..30` | `0.01` | Mod envelope default. |
| `env.2.decay` | seconds | `0..30` | `0.3` | Mod envelope default. |
| `env.2.sustain` | normalized | `0..1` | `0` | Mod envelope default. |
| `env.2.release` | seconds | `0..30` | `0.2` | Mod envelope default. |

## LFO Parameters

LFO IDs use `lfo.N.*`, where `N` starts at `1`.

| ID | Type | Range | Default | Notes |
| --- | --- | --- | --- | --- |
| `lfo.1.enabled` | boolean | off/on | `true` | First modulation LFO. |
| `lfo.1.rate` | hz | `0.01..50` | `1` | Used when sync is off. |
| `lfo.1.sync` | boolean | off/on | `true` | Tempo sync enable. |
| `lfo.1.syncedRate` | enum | note division | `1/4` | Used when sync is on; converted to cycles/sec from the current project BPM at render time. |
| `lfo.1.smoothing` | normalized | `0..1` | `0` | Blends hard LFO shapes toward sine for softer modulation corners. |
| `lfo.1.randomPhase` | normalized | `0..1` | `0` | Amount of deterministic note-on phase randomization applied when retrigger is on. |
| `lfo.1.shape` | enum | `sine`, `triangle`, `saw`, `square`, `sampleHold` | `sine` | First-pass shapes. |
| `lfo.1.phase` | normalized | `0..1` | `0` | Start phase. |
| `lfo.1.retrigger` | boolean | off/on | `true` | Restart phase per note when enabled. |
| `lfo.1.oneShot` | boolean | off/on | `false` | Run one LFO cycle, then hold the terminal phase value. |
| `lfo.1.bipolar` | boolean | off/on | `true` | Output range mode. |

Use the same parameter suffixes as LFO 1 with the `lfo.2.*` prefix.

Initial defaults:

- `lfo.2.enabled`: `false`
- `lfo.2.rate`: `0.5`
- `lfo.2.sync`: `true`
- `lfo.2.syncedRate`: `1/2`
- `lfo.2.smoothing`: `0`
- `lfo.2.randomPhase`: `0`
- `lfo.2.shape`: `triangle`
- `lfo.2.phase`: `0`
- `lfo.2.retrigger`: `true`
- `lfo.2.oneShot`: `false`
- `lfo.2.bipolar`: `true`

## Macro Parameters

| ID | Type | Range | Default | Notes |
| --- | --- | --- | --- | --- |
| `macro.1` | normalized | `0..1` | `0` | User macro. |
| `macro.2` | normalized | `0..1` | `0` | User macro. |
| `macro.3` | normalized | `0..1` | `0` | User macro. |
| `macro.4` | normalized | `0..1` | `0` | User macro. |

Macro identity and response metadata lives in `metadata.macros[macro.N]`:

```json
{
  "id": "macro.1",
  "label": "Brightness",
  "min": 0.2,
  "max": 0.8,
  "curve": "ease-in"
}
```

Rules:

- `label` is user-facing and can change without renaming the stable `macro.N` source ID.
- `min` and `max` clamp to `0..1` and shape the macro output before route amount scaling.
- `curve` is one of `linear`, `ease-in`, `ease-out`, or `s-curve`.
- Frontend preview and native patch parsing both apply the same range/curve math for static macro routes.

## Modulation Sources

| ID | Scope | Output |
| --- | --- | --- |
| `env.1` | per-voice | `0..1` |
| `env.2` | per-voice | `0..1` |
| `lfo.1` | per-voice by default | bipolar or unipolar |
| `lfo.2` | per-voice by default | bipolar or unipolar |
| `velocity` | per-voice | `0..1` |
| `keytrack` | per-voice | `0..1` |
| `modWheel` | global | `0..1` |
| `macro.1` | global | `0..1` |
| `macro.2` | global | `0..1` |
| `macro.3` | global | `0..1` |
| `macro.4` | global | `0..1` |

## Modulation Targets

Initial targets:

- `osc.a.position`
- `osc.a.fine`
- `osc.a.level`
- `osc.a.pan`
- `osc.b.position`
- `osc.b.fine`
- `osc.b.level`
- `osc.b.pan`
- `filter.cutoff`
- `filter.resonance`
- `filter.drive`
- `amp.level`
- `amp.pan`
- `unison.detune`
- `unison.spread`

## Modulation Route Shape

```json
{
  "id": "route_1",
  "source": "lfo.1",
  "target": "osc.a.position",
  "amount": 0.35,
  "bipolar": true,
  "enabled": true
}
```

Rules:

- `amount` is normalized `-1..1`.
- Target-specific scaling happens in DSP/store layers.
- Multiple routes can target the same parameter.
- Disabled routes should be cheap to skip.
- Routes must clamp final target values to the parameter contract.

## Wavetable IDs

Factory tables:

- `basic.sine`
- `basic.saw`
- `basic.square`
- `basic.triangle`
- `basic.pulse`

Imported/user tables:

- Prefix with `user.`
- Store a stable content ID separately from the display name.

## Patch Shape V1

```json
{
  "schemaVersion": 1,
  "instrumentType": "wavetable-synth",
  "name": "Init",
  "parameters": {
    "osc.a.enabled": true,
    "osc.a.wavetable": "basic.saw",
    "osc.a.position": 0,
    "amp.level": 0.8
  },
  "modulation": [],
  "metadata": {
    "createdBy": "Beat",
    "tags": []
  }
}
```

Patch rules:

- Unknown parameters should be preserved when possible.
- Missing known parameters use defaults.
- Loaders must validate ranges and replace NaN/Inf with defaults.
- Schema migrations should be additive until V2.

## Analyzer Event Shape

```json
{
  "kind": "analyzer.spectrum",
  "sequence": 123,
  "rms": 0.12,
  "peak": 0.35,
  "bands": [0.0]
}
```

Rules:

- `bands` is a fixed-length array in frontend state.
- Initial backend band count: `32`.
- Backend should throttle events before IPC.
- Audio thread should publish snapshots without blocking on UI delivery.
