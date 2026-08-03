# Standards generation corpus

Beat learns compact structural profiles from MusicXML/MXL lead sheets: meter, form, phrase lengths, harmonic rhythm, chord-quality vocabulary, melodic duration shapes, and interval shapes. Verified profiles are available to every song-generation genre. They guide abstract phrasing, rhythmic vocabulary, melodic contour, and harmonic vocabulary; genre-specific tempo, instrumentation, density, and arrangement rules remain authoritative, and Beat does not paste an exact reference melody into a generated song.

Imported user-owned fakebooks can be learned locally in the app. Those profiles also retain the recognized, beat-aligned lead line and chord sequence so Beat can analyze the actual chart rather than relying on event totals. They are marked `user-provided-local`, remain in local browser/app storage, and are never eligible for Beat's bundled catalog. Exact reference material is rejected if it appears in a distributable-catalog build.

Use **Import Jazz Standards Library...** in Beat's app menu to select multiple MusicXML/MXL charts. In the native app, PDF and image charts are converted locally by optional, separately installed score-recognition engines. Audiveris is the primary engine; homr is the secondary page/image fallback and can be selected explicitly with `BEAT_HOMR`. Beat may merge page results from both engines, but every OCR result still passes the same MusicXML timing review. This library import does not create tracks, save a project, or copy the source score into Beat's distributable assets.

For a large user-supplied fakebook PDF, first create a local-only source inventory:

```sh
python3 scripts/index-local-fakebook.py /path/to/fakebook.pdf .local-jazzmus/libraries/my-fakebook/manifest.json
```

The inventory records the PDF fingerprint and numbered title index, but deliberately marks the source `needs-review`. Handwritten OMR output is a draft and Beat excludes that status from song generation: a chart becomes a generation reference only after its title/page assignment, written chord symbols, melody pitches and durations, and measure timing match the source. Raw MIDI-note totals are never an acceptance metric.

The distributable catalog accepts only entries with explicit provenance under Public Domain, CC0-1.0, or CC-BY-4.0 terms. A dataset's general description is not enough: each score must have a source URL or public-domain assertion, and entries with a reported license conflict are rejected. For PDMX-derived imports, set `noLicenseConflict` from the dataset's `no_license_conflict` field and import only the conflict-free subset.

Run:

```sh
node scripts/import-standards-corpus.mjs /path/to/musicxml metadata.json
```

The metadata file is an array (or `{ "entries": [] }`) with:

```json
{
  "path": "relative/score.mxl",
  "title": "Optional corrected title",
  "composer": "Optional composer",
  "sourceUrl": "https://source.example/score",
  "license": "Public Domain",
  "licenseUrl": "https://source.example/license",
  "noLicenseConflict": true,
  "generationUses": ["all"]
}
```

Do not add commercial Real Book or copyrighted fakebook scans to the bundled catalog. They may be imported and learned locally only when the user owns or is authorized to use them. Beat does not assume that a file labeled "fakebook" or "public domain dataset" is redistributable; bundled admission is decided per score.
