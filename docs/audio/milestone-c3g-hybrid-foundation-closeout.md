# Milestone C3G hybrid-foundation closeout

Status: in progress. This document records only verified non-spectral closeout
work. Milestone C and Slot 3 remain incomplete.

## C3G1 — Slot 1/2 migration and managed-asset integrity

Verified 2026-07-16 on `codex/aether-c3g1` from baseline revision
`5add6e98`.

The Slot 1/2 persistence boundary now validates unknown versions and malformed
container shapes before normalization. Native repository callers can use
`loadWithDiagnostics()` to receive stable code, path, and message records. A
document with an unsafe hybrid-source boundary is rejected instead of being
loaded with the affected source silently disabled or removed. Frontend synth
hydration applies the same fail-visible policy through
`HybridSourceMigrationError`.

Sidecar cleanup validates the same boundary before enumerating deletions. If
validation fails, cleanup is marked blocked, deletes zero files, and returns
the diagnostics through IPC and Project Health. A referenced managed manifest
also protects every materialized file in its managed bundle directory. This is
deliberately conservative: cleanup may retain an unlisted file inside a live
bundle, but cannot split a bundle whose manifest is still referenced.

Focused native coverage verifies:

- a referenced SFZ bundle retains its manifest, source, and sample even when
  the document contains only the manifest/source references;
- an unrelated orphan is still deleted;
- a future Slot 1 version blocks cleanup before any deletion;
- the blocked result contains a stable diagnostic and leaves the orphan in
  place;
- a future Slot 1 repository row is rejected with diagnostics; and
- a future Slot 2 version is reported deterministically.

Focused frontend coverage verifies future managed-SFZ, managed-granular, and
Slot 1 versions plus over-capacity zone data fail with stable diagnostics. The
Project Health surface identifies blocked cleanup as an error and displays the
first code/path/message rather than reporting a successful zero-deletion run.

Verification results:

- Release `Beat` and `BeatBackendStress`: built successfully. JUCE emitted the
  existing 20 HarfBuzz third-party warnings.
- `AETHER_BASELINE_WAIVE_RECENT_PROJECT_EXISTS=1 build-native/bin/BeatBackendStress`:
  all sections passed. The only waiver was the existing narrowly scoped
  `baseline.recent-project-exists` macOS TCC waiver.
- `npm run verify:non-native`: passed every verifier, TypeScript check, and
  production frontend build. The existing intentional local synth-generation
  fallback and Vite chunk-size warning remained informational.

Compatibility is unchanged for valid current data and supported legacy Slot
versions. Data that previously depended on silent truncation, silent source
disablement, or silent removal of malformed/future managed metadata now fails
with a diagnostic so it can be preserved and handled explicitly. No persisted
field or version was added or changed.

No production audio-rendering source, callback edge, factory preset, baseline
artifact, or C3F review file changed. No render difference was expected or
observed by the native live/export coverage. The frozen 150-render baseline was
not regenerated because this slice has no DSP path; no hash was updated.

The remaining C3G areas are not complete. Accessibility/UI consistency,
migration breadth, benchmark objective-render coverage, documentation
reconciliation, and final baseline maintenance remain separate later slices.
Slot 3 behavior, schema, `SourceSlotIndex::three`, and the C3F review boundary
remain untouched.
