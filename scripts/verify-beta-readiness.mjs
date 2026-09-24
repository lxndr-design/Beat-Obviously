#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const version = readFileSync(join(repoRoot, "VERSION"), "utf8").trim();
const scope = process.argv.find((arg) => arg.startsWith("--scope="))?.slice("--scope=".length) ?? "source";
const reportArg = process.argv.find((arg) => arg.startsWith("--report="))?.slice("--report=".length)
  ?? join("/private/tmp", `beat-beta-readiness-${scope}.json`);
const allowedScopes = new Set(["source", "native", "package", "all"]);
const nativeBuildDir = process.env.BEAT_BUILD_DIR
  ?? join(process.env.TMPDIR ?? "/private/tmp", `beat-native-build-${process.getuid?.() ?? "user"}`);
const packagedApp = process.env.BEAT_APP_OUTPUT_PATH
  ?? join(process.env.HOME, "Applications", "Beat.app");

if (!allowedScopes.has(scope)) {
  console.error(`Unknown beta gate scope: ${scope}`);
  process.exit(2);
}

const npmGate = (id, label, script, timeoutMinutes = 5) => ({
  id,
  label,
  group: "source",
  command: "npm",
  args: ["--prefix", "frontend", "run", script],
  timeoutMs: timeoutMinutes * 60_000,
});

const gates = [
  npmGate("version", "Version alignment", "verify:version"),
  npmGate("design", "Design-system conformance", "verify:design-system"),
  npmGate("audio-boundary", "Frontend/native audio boundary", "verify:audio-boundary"),
  npmGate("sampler-zones", "Sampler zone semantics", "verify:sampler-zones"),
  npmGate("typecheck", "TypeScript typecheck", "typecheck"),
  npmGate("synth", "Aether synth round trip", "verify:synth", 10),
  npmGate("aurum", "Aurum engine", "verify:aurum", 10),
  npmGate("lumen", "Lumen engine", "verify:lumen", 10),
  npmGate("instrument-renders", "Factory instrument benchmark renders", "verify:benchmark-instruments", 10),
  npmGate("generation", "Song-generation diversity", "audit:generation", 10),
  npmGate("daw", "DAW core", "verify:daw", 10),
  npmGate("audio-bus", "Audio buses", "verify:audio-bus"),
  npmGate("documents", "Project document round trip", "verify:documents", 10),
  npmGate("instrument-repository", "Instrument repository", "verify:instrument-repository"),
  npmGate("track-interactions", "Track interactions", "verify:track-interactions"),
  npmGate("interactions", "Frontend interactions", "verify:interactions", 10),
  npmGate("node-instrument", "Node instrument editor", "verify:node-instrument"),
  npmGate("drums", "Drum generation and playback", "verify:drums", 10),
  npmGate("audio-to-midi", "Audio-to-MIDI integration", "verify:audio-to-midi", 10),
  npmGate("score-import", "Sheet-music import", "verify:score-import", 10),
  npmGate("frontend-build", "Production frontend build", "build", 10),
  {
    id: "native-configure",
    label: "Native release configuration",
    group: "native",
    command: "cmake",
    args: ["-S", repoRoot, "-B", nativeBuildDir, "-DCMAKE_BUILD_TYPE=Release", "-DBEAT_BUILD_FRONTEND=OFF"],
    timeoutMs: 10 * 60_000,
  },
  {
    id: "native-build",
    label: "Native app and stress harness build",
    group: "native",
    command: "cmake",
    args: ["--build", nativeBuildDir, "--target", "BeatBackendStress", "Beat", "--config", "Release", "-j", "6"],
    timeoutMs: 30 * 60_000,
  },
  {
    id: "native-stress",
    label: "Native audio and persistence stress suite",
    group: "native",
    command: join(nativeBuildDir, "bin", "BeatBackendStress"),
    args: [],
    timeoutMs: 30 * 60_000,
  },
  {
    id: "package",
    label: "Canonical macOS app and tester archive",
    group: "package",
    command: join(repoRoot, "scripts", "package-beta-release.sh"),
    args: [],
    timeoutMs: 30 * 60_000,
  },
  {
    id: "package-contents",
    label: "Distributable contents audit",
    group: "package",
    command: "node",
    args: [join(repoRoot, "scripts", "verify-beta-package.mjs"), packagedApp],
    timeoutMs: 5 * 60_000,
  },
  {
    id: "package-version",
    label: "Packaged version alignment",
    group: "package",
    command: "node",
    args: [join(repoRoot, "scripts", "verify-version.mjs")],
    timeoutMs: 5 * 60_000,
  },
  {
    id: "package-document",
    label: "Packaged Finder document declaration",
    group: "package",
    command: "node",
    args: [join(repoRoot, "scripts", "verify-native-document-registration.mjs"), packagedApp],
    timeoutMs: 5 * 60_000,
  },
  {
    id: "package-signature",
    label: "Deep code-signature integrity",
    group: "package",
    command: "codesign",
    args: ["--verify", "--deep", "--strict", "--verbose=2", packagedApp],
    timeoutMs: 5 * 60_000,
  },
  {
    id: "package-gatekeeper",
    label: "Gatekeeper distribution assessment",
    group: "package",
    command: "spctl",
    args: ["--assess", "--type", "execute", "--verbose=4", packagedApp],
    timeoutMs: 5 * 60_000,
  },
];

const selectedGroups = scope === "all" ? new Set(["source", "native", "package"]) : new Set([scope]);
const selectedGates = gates.filter((gate) => selectedGroups.has(gate.group));
const results = [];

function appendTail(current, chunk, limit = 16_000) {
  const next = current + chunk;
  return next.length > limit ? next.slice(next.length - limit) : next;
}

function runGate(gate) {
  return new Promise((resolveGate) => {
    const startedAt = Date.now();
    let outputTail = "";
    let timedOut = false;
    console.log(`\n[beta:${gate.group}] ${gate.label}`);
    const child = spawn(gate.command, gate.args, {
      cwd: repoRoot,
      env: { ...process.env, CI: process.env.CI ?? "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const forward = (stream, chunk) => {
      const text = chunk.toString();
      outputTail = appendTail(outputTail, text);
      stream.write(text);
    };
    child.stdout.on("data", (chunk) => forward(process.stdout, chunk));
    child.stderr.on("data", (chunk) => forward(process.stderr, chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, gate.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      outputTail = appendTail(outputTail, `${error.stack ?? error.message}\n`);
      resolveGate({
        id: gate.id,
        label: gate.label,
        group: gate.group,
        status: "failed",
        exitCode: null,
        timedOut,
        durationMs: Date.now() - startedAt,
        outputTail,
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      const status = exitCode === 0 && !timedOut ? "passed" : "failed";
      console.log(`[beta:${gate.group}] ${status.toUpperCase()} ${gate.id} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
      resolveGate({
        id: gate.id,
        label: gate.label,
        group: gate.group,
        status,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        outputTail,
      });
    });
  });
}

for (const gate of selectedGates) results.push(await runGate(gate));

const manualGates = [
  {
    id: "clean-machine",
    label: "Install, launch, open .beat, playback, save, and export on a supported Mac without the repository or developer tools",
    status: "pending",
  },
  {
    id: "private-soak",
    label: "Complete representative multi-session project creation, reopen, editing, and export without crash, data loss, or unexplained silence",
    status: "pending",
  },
];
const failures = results.filter((result) => result.status === "failed");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  version,
  scope,
  automatedStatus: failures.length === 0 ? "passed" : "failed",
  releaseStatus: failures.length === 0 ? "automated-pass-manual-pending" : "blocked",
  results,
  manualGates,
};

const reportPath = isAbsolute(reportArg) ? reportArg : join(repoRoot, reportArg);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nBeta report: ${reportPath}`);

console.log(`\nBeta automated gates: ${results.length - failures.length}/${results.length} passed.`);
for (const failure of failures) console.log(`- BLOCKED ${failure.group}/${failure.id}: ${failure.label}`);
for (const manual of manualGates) console.log(`- MANUAL ${manual.id}: ${manual.label}`);
process.exit(failures.length === 0 ? 0 : 1);
