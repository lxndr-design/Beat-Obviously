# Beat beta readiness

Beat enters beta when the existing product can be trusted for real projects.
This milestone is a stabilization pass, not a feature-count target.

## Automated gate

Run the source-only gate during ordinary development:

```bash
cd frontend
npm run verify:beta
```

Run the complete release-candidate gate before calling a build beta-ready:

```bash
cd frontend
npm run verify:beta:all -- --report=/private/tmp/beat-beta-readiness.json
```

Build only the tester-facing app and versioned ZIP:

```bash
cd frontend
npm run package:beta
```

The archive is written to `~/Downloads/Beat Public Release/Beat-<version>-macOS-arm64.zip`
with an adjacent SHA-256 file. Set `BEAT_RELEASE_DIR` to override that location.
The release command extracts that ZIP into a temporary
directory and reruns the runtime-content and deep-signature audits against the
extracted copy, so the checked artifact is the file a tester receives.

The complete gate runs every source verifier, builds and executes the native
stress harness, packages the installed `~/Applications/Beat.app`, rejects development/source
artifacts inside the bundle, verifies version and Finder declarations, checks
the deep signature, and asks Gatekeeper to assess distribution readiness. It
does not stop at the first failure; the JSON report retains the result and tail
output for every gate.

## Required release properties

- No known project data loss, unrecoverable save failure, or schema migration
  failure.
- Missing assets can be identified and relinked without silently changing the
  project.
- Editor audition, arrangement playback, solo/mute, and offline export agree.
- Overload produces a bounded warning, voice limit, bypass, cancellation, or
  stopped transport rather than a freeze or project corruption.
- The complete automated gate is green with no accepted baseline failures.
- The distributable contains runtime assets and legally required notices, not
  source trees, tests, development environments, or generated test projects.
- Production packages contain no source maps or development-hook bundles.

## Distribution signing

The current local certificate store has no Apple Developer ID identity. An
ad-hoc signature can pass bundle-integrity checks but cannot pass Gatekeeper
distribution assessment or notarization. That remains a distribution blocker
until the app is signed with a Developer ID Application certificate and
notarized; the gate must not be waived or relabeled as passing.

## Manual private-beta gates

- Install and launch on a supported Mac without the repository or developer
  tools; open a `.beat` file from Finder; play, edit, save, reopen, and export.
- Complete representative multi-session work across at least 10 real projects
  without a crash, data-loss event, or unexplained silent output.
- Record the machine, macOS version, audio device, project, action, and attached
  diagnostic report for every blocker.

Passing automation means `automated-pass-manual-pending`. The build becomes a
beta candidate only after both manual gates are signed off.
