# Aether source-state reconciliation

Date: 2026-07-11

This document records an evidence boundary, not a silent reconciliation. Unknown dirty-tree content must not be merged by inference.

## Revisions and observed states

- Original revision observed at the start of the audit: `aea0434223c54a413bdaff5f8adb8594acaf15ee`, accompanied by a large dirty tree.
- User-pinned intended audit revision: `062413553930fb102a81658063966c34500bf8a9`.
- Immutable audit snapshot: `fcfc59f1`, tagged `aether-audit-snapshot-2026-07-11`.
- Stabilized branch before this correction: `a332044a` on `codex/aether-serum-foundation`.
- This sample-rate freeze is based on that stabilized branch; its final commit is recorded after the report is committed.

The committed difference from `aea04342` to `06241355` is limited to version/product metadata in `VERSION`, native main/message-bridge code, frontend package metadata, and the store adapter. It does not account for the broad modified and untracked source inventory observed at the start of the audit. Therefore `06241355` cannot be certified as a complete materialization of that earlier dirty state.

## Known pre-audit dirty content

The initial status evidence identified tracked modifications across native audio/project code including `AudioEngine`, `DecentSamplerImporter`, `MessageBridge`, schema/main/project-repository code; frontend synth preview, timeline audio/MIDI playback, synth/store/types/selectors, IPC/document-persistence code; and broader UI, documentation, and scripts.

Known untracked paths included the Drumpad editor surface, piano-roll interaction and live MIDI recording modules, Drumpad preview files, shared Solid component folders, sampler-zone code and verifier, and UI specimen/one-pager work. The status inventory proves that paths existed, but it does not prove their exact bytes, hashes, completeness, or intended relationship to one another.

## Content that cannot be proven present

No authoritative archive, stash, commit, or mapped unreachable tree has been found that reconstructs the complete original dirty state. Current reflog evidence only establishes the later move to `06241355`. Consequently the exact content of the earlier modified and untracked files, any binary changes, and whether all intended work was present cannot be proven. The original dirty state is not currently available for byte-for-byte comparison.

## Baseline-stabilization-only differences

Relative to the pinned revision, the isolated branch contains audit/provenance documents and snapshot controls; non-DSP Drumpad grid and browser-preview boundary fixes; production MIDI segment clipping correctness; explicit non-fail-fast/waiver orchestration; the test-only `BeatAetherBaseline` harness; and this narrowly scoped sample-rate coefficient correction plus focused tests. It does not contain a wavetable frame/mipmap redesign or imported upstream code.

## Decision requiring explicit approval

Recommended option: **A — adopt the stabilized branch as the new canonical baseline.** It is the only reproducible, hashed state with complete green-or-explicitly-waived gates and a frozen 150-render matrix. This recommendation is not a selection and grants no permission to discard a later-discovered authoritative snapshot.

Option B remains available if an authoritative recoverable original snapshot is found: reconcile it read-only against the stabilized branch, enumerate every semantic difference, and request approval before merging anything.

No option is selected here. Milestone A remains blocked until the user explicitly approves A or directs recovery and reconciliation under B.
