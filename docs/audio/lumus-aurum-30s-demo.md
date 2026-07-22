# Lumus + Aurum 30-Second Demo

This preliminary 128 BPM demo combines four live, editable Lumus MIDI tracks
with four Aurum audio stems:

- `Aurum_Bass_01`
- `Aurum_Keys_01`
- `Aurum_Bell_01`
- `Aurum_Percussion_01`
- `Lumus_WidePad_01`
- `Lumus_ArpPluck_01`
- `Lumus_SubBass_01`
- `Lumus_MonoLead_01`

The Aurum engine currently lives in its own development worktree, so the demo
renders its parts to local stems rather than merging the two synth branches.
The Lumus parts remain native instrument tracks in the generated Beat project.

Generate the project and preview outside the repository:

```sh
node scripts/create-lumus-aurum-demo.mjs /private/tmp/Lumus_Aurum_30s_Demo
```

The generator writes a `.beat` project, four Aurum stem WAVs, a stereo mix
preview, and `demo-report.json`. The report rejects non-finite, inaudibly quiet,
or clipped output. A repeated render must produce byte-identical WAV files.

Reference render properties:

- Duration: 30 seconds / 64 beats
- Sample rate: 48 kHz
- Format: stereo 16-bit PCM WAV
- RMS: `0.07449731756293455`
- Peak: `0.3824692368507385`
- Preview SHA-256: `fb48708ab317fc8d5234a16cd94824c0dcf66bf43fa882f3623008cdc063f442`

The rendered files are temporary review artifacts and are not committed.
