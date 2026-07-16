# Milestone C3G hybrid-foundation closeout

Status: C3G non-spectral closeout complete. This document records only verified
Slot 1/2 closeout work. Milestone C and Slot 3 remain incomplete.

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

At the C3G1 checkpoint, the remaining C3G areas were not complete. Accessibility/UI consistency,
migration breadth, benchmark objective-render coverage, documentation
reconciliation, and final baseline maintenance remain separate later slices.
Slot 3 behavior, schema, `SourceSlotIndex::three`, and the C3F review boundary
remain untouched.

## C3G2 — Slot 1/2 accessibility and UI consistency

Verified 2026-07-16 on `codex/aether-c3g1` after C3G1.

The Sample Slot 1 and Granular Slot 2 panels are labelled sections with visible
live source-status text. Each enable switch has a specific accessible name and
references that status as its disabled explanation. Import actions expose busy
state and source-specific names; source removal restores focus to the
corresponding import action; successful imports move focus to the updated live
status; and the benchmark-source action exposes its pressed state.

The shared floating selector now moves focus into its portal menu, supports
Arrow Up/Down, Home, End, and Escape for both searchable and non-searchable
lists, and restores focus to its trigger after selection or cancellation.
Disabled shared switches now have a visible disabled treatment and a
not-allowed cursor while retaining their accessible description.

Focused tests exercise every navigation-key index boundary, including empty
and initially unfocused lists. Source-contract checks require both slot
sections, source descriptions, enable names, disabled descriptions, import
busy states, removal focus restoration, selector focus entry/return, and the
shared switch disabled hook. TypeScript, the interaction verifier, and the
design-system verifier pass. The complete `npm run verify:non-native` aggregate
also passes every verifier and the production frontend build; only the existing
intentional local synth-generation fallback and Vite chunk-size warning are
informational. A source-matched Release `Beat` build with the Solid frontend
embedded also passes; JUCE emits the existing 20 HarfBuzz third-party warnings.

An attempted rendered focus inspection did not reach Beat because the in-app
browser runtime rejected an unrelated workspace root containing a literal
question mark as an invalid filesystem glob. No live-browser claim is made for
this slice. This is recorded as a tooling limitation, not an application
failure or waiver.

No persistence, production DSP, Slot 1/2 schema, factory preset, baseline
artifact, C3F review file, Slot 3 boundary, or `SourceSlotIndex::three` changed.
No render difference is expected; no render hash or frozen artifact was
updated.

## C3G3 — factory benchmark render freeze

The two user-requested factory string benchmarks now have a dedicated
test-only objective render gate in addition to their existing discoverability,
schema-roundtrip, and all-preset audibility checks. The gate resolves each
factory record through the production synth-draft conversion and frontend
render path, renders two seconds at C4 at 44.1, 48, and 96 kHz twice, and checks
finite output, RMS, peak, sustained-tail RMS, DC mean, adjacent-sample
discontinuity, inter-preset distinction, repeat determinism, and an explicit
SHA-256 freeze. It has no record/update mode.

The first capture intentionally failed because the expected-hash table was
empty. Its six outputs were reviewed before being accepted as the initial
freeze. Across the three rates:

- `Benchmark - Future Bass Strings`: RMS 0.11557–0.11884, peak
  0.53273–0.56388, absolute DC mean at most 0.0000335, maximum adjacent change
  0.17653–0.30372, and tail RMS 0.04792–0.04957.
- `Benchmark - Progressive House Strings`: RMS 0.13549–0.13885, peak
  0.61169–0.63981, absolute DC mean at most 0.0000810, maximum adjacent change
  0.31561–0.52140, and tail RMS 0.17457–0.17679.

Accepted SHA-256 values are stored beside the verifier and keyed by stable
preset ID plus sample rate. Any later difference fails with expected and actual
hashes and must be investigated before the freeze changes. The verifier is part
of `verify:non-native`; no production preset, renderer, DSP, project schema, or
baseline artifact changed to establish this test-only freeze.

## C3G4 — final gates and stop state

Release `Beat`, `BeatBackendStress`, and `BeatAetherBaseline` build from the
source-matched branch. Full `verify:non-native` passes, including the new
benchmark freeze. The unwaived native run stops only at the known
`baseline.recent-project-exists` assertion. With that single approved TCC
waiver, every native section passes in 9.41 s wall / 8.23 s user / 0.72 s
system with 203,505,664-byte maximum RSS.

The isolated matrix regenerated exactly 150 WAVs. The explicitly normalized
manifest remains `713ed72937dc82df0a0d845ebff1d48aee8a8d87ab4af877cabc895c6bee5ba5`.
Timing-bearing `baseline.json` SHA-256 is
`7528de1d6f53c89e9c603d652d9365571f05e244610914b508886176022e8d3c`;
render times are 12.74–16.36 ms (13.61 ms mean); process maximum RSS is
15,450,112 bytes and harness-reported RSS is 14,974,976 bytes; deadline
overruns are zero; queue telemetry remains 64 accepted / 16 rejected / 16
overflow. No existing baseline artifact or expected native hash changed.

C3G stops here. Sample Slot 1 and Granular Slot 2 are the completed
hybrid-source foundation, but Milestone C and Slot 3 are not complete. C3F1,
C3F2, and C3F3 remain paused. No C3F review-package file, Slot 3 behavior or
schema, `SourceSlotIndex::three`, or production DSP behavior changed.
