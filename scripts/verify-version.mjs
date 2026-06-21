#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const failures = [];

function fail(message) {
  failures.push(message);
}

function rel(path) {
  return relative(repoRoot, path);
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function assertVersion(label, path, actual, expected) {
  if (actual !== expected)
    fail(`${label} version mismatch in ${rel(path)}: expected ${expected}, got ${actual ?? "missing"}`);
}

const versionPath = join(repoRoot, "VERSION");
const version = readText(versionPath).trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))
  fail(`VERSION must be semver-like, got "${version}"`);

const frontendPackagePath = join(repoRoot, "frontend", "package.json");
const frontendPackage = readJson(frontendPackagePath);
assertVersion("frontend/package.json", frontendPackagePath, frontendPackage.version, version);

const frontendLockPath = join(repoRoot, "frontend", "package-lock.json");
const frontendLock = readJson(frontendLockPath);
assertVersion("frontend/package-lock.json root", frontendLockPath, frontendLock.version, version);
assertVersion("frontend/package-lock.json package", frontendLockPath, frontendLock.packages?.[""]?.version, version);

const rootCmakePath = join(repoRoot, "CMakeLists.txt");
const rootCmake = readText(rootCmakePath);
if (!/file\(STRINGS\s+"\$\{CMAKE_SOURCE_DIR\}\/VERSION"\s+BEAT_VERSION/.test(rootCmake))
  fail(`${rel(rootCmakePath)} must read BEAT_VERSION from VERSION`);
if (!/project\(Beat[\s\S]*VERSION\s+\$\{BEAT_VERSION\}/m.test(rootCmake))
  fail(`${rel(rootCmakePath)} project() must use VERSION \${BEAT_VERSION}`);

const backendCmakePath = join(repoRoot, "backend", "CMakeLists.txt");
const backendCmake = readText(backendCmakePath);
if (!/VERSION\s+\$\{BEAT_VERSION\}/.test(backendCmake))
  fail(`${rel(backendCmakePath)} juce_add_gui_app() must use VERSION \${BEAT_VERSION}`);

if (failures.length > 0) {
  console.error("Version verifier failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Version verifier passed for Beat ${version}.`);
