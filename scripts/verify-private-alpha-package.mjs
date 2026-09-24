#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
} from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { userInfo } from "node:os";

const appPath = resolve(process.argv[2] ?? "");
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const version = readFileSync(join(repoRoot, "VERSION"), "utf8").trim();
const resourcesPath = join(appPath, "Contents", "Resources");
const frontendPath = join(resourcesPath, "frontend");
const executablePath = join(appPath, "Contents", "MacOS", "Beat");

assert.ok(process.argv[2], "Pass the private-alpha Beat.app path to verify");
assert.equal(existsSync(appPath), true, `App bundle not found: ${appPath}`);
assert.equal(existsSync(executablePath), true, "Packaged Beat executable is missing");
assert.ok(statSync(executablePath).mode & 0o111, "Packaged Beat executable is not executable");
assert.equal(existsSync(join(frontendPath, "index.html")), true, "Bundled frontend index is missing");

const disallowedDirectories = new Set([
  ".git",
  ".agents",
  ".codex",
  ".venv",
  "__pycache__",
  "generated-tests",
  "node_modules",
  "scripts",
  "src",
  "tests",
]);
const disallowedExtensions = new Set([
  ".beat",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".log",
  ".map",
  ".mid",
  ".midi",
  ".md",
  ".pdf",
  ".py",
  ".pyc",
  ".sh",
  ".ts",
  ".tsx",
]);
const textExtensions = new Set([".css", ".html", ".js", ".json", ".plist", ".py", ".txt", ".xml"]);
const localReferencePatterns = [
  { label: "macOS user directory", pattern: /(?:file:\/\/)?\/Users\/(?!Share(?:d)?(?:\/|\b))[A-Za-z0-9._-]+(?:\/|\b)/ },
  { label: "Linux user directory", pattern: /(?:file:\/\/)?\/home\/[A-Za-z0-9._-]+(?:\/|\b)/ },
  { label: "macOS transient user path", pattern: /\/(?:private\/)?var\/folders\//i },
  { label: "repository path", pattern: new RegExp(escapeRegExp(repoRoot), "i") },
  { label: "developer account name", pattern: new RegExp(`\\b${escapeRegExp(userInfo().username)}\\b`, "i") },
];
const privateOrTestProductPatterns = [
  /\bAurum Test\b/i,
  /\bLumen Test\b/i,
  /\bGenerated_test_\d+\b/i,
  /\bMp3_translation_test_/i,
  /\bsheet_to_song_\d+\b/i,
  /\bdense_[123]\b/i,
  /\bTest_song_\d+\b/i,
];
const violations = [];
const regularFiles = [];
let fileCount = 0;
let totalBytes = 0;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inspectText(path, rel) {
  const text = readFileSync(path, "utf8");
  for (const { label, pattern } of localReferencePatterns) {
    if (pattern.test(text)) violations.push(`${rel}: contains ${label}`);
  }
  if (/__beatTestHooks|beatDevFixture|devHooks-[^.]+\.js/i.test(text)) {
    violations.push(`${rel}: contains development fixture surface`);
  }
  if (/sourceMappingURL=/i.test(text)) violations.push(`${rel}: contains source-map reference`);
  for (const pattern of privateOrTestProductPatterns) {
    if (pattern.test(text)) violations.push(`${rel}: contains private or test product content (${pattern})`);
  }
}

function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    const rel = relative(appPath, entryPath);
    if (entry.isDirectory()) {
      if (disallowedDirectories.has(entry.name.toLowerCase())) violations.push(`${rel}: development directory`);
      else walk(entryPath);
      continue;
    }
    if (entry.isSymbolicLink()) {
      const resolved = resolve(path, readlinkSync(entryPath));
      if (resolved !== appPath && !resolved.startsWith(`${appPath}/`)) violations.push(`${rel}: external symlink`);
      continue;
    }
    fileCount += 1;
    totalBytes += lstatSync(entryPath).size;
    regularFiles.push({ path: entryPath, rel });
    const extension = extname(entry.name).toLowerCase();
    const requiredRuntimeHelper = rel === "Contents/Resources/run-homr-for-beat.py";
    if (disallowedExtensions.has(extension) && !requiredRuntimeHelper) {
      violations.push(`${rel}: source, test, document, or project artifact`);
    }
    if (entry.name === ".DS_Store") violations.push(`${rel}: Finder metadata`);
    if (textExtensions.has(extension)) inspectText(entryPath, rel);
  }
}

walk(appPath);

const executableStrings = execFileSync("strings", ["-a", executablePath], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
for (const { label, pattern } of localReferencePatterns) {
  if (pattern.test(executableStrings)) violations.push(`Contents/MacOS/Beat: binary contains ${label}`);
}

assert.deepEqual(violations, [], `Private alpha contains local or development material:\n${violations.join("\n")}`);

const plistPath = join(appPath, "Contents", "Info.plist");
const plistText = readFileSync(plistPath, "utf8");
assert.match(plistText, new RegExp(`<key>CFBundleShortVersionString</key>\\s*<string>${escapeRegExp(version)}</string>`));
assert.match(plistText, /<key>CFBundleIdentifier<\/key>\s*<string>com\.beat\.app<\/string>/);

const executableDescription = execFileSync("file", [executablePath], { encoding: "utf8" }).trim();
assert.match(executableDescription, /Mach-O/);
assert.match(executableDescription, /arm64|universal binary/);
const buildDescription = execFileSync("vtool", ["-show-build", executablePath], { encoding: "utf8" });
const minimumMacOs = Number(buildDescription.match(/\bminos\s+([0-9.]+)/)?.[1]);
assert.ok(Number.isFinite(minimumMacOs), "Packaged Beat executable does not declare a minimum macOS version");
assert.ok(minimumMacOs <= 13, `Private alpha unexpectedly requires macOS ${minimumMacOs}`);

console.log(
  `Private-alpha audit passed for ${basename(appPath)} ${version}: ${fileCount} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB, no local path references.`,
);
