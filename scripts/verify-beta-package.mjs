#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { homedir } from "node:os";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const appPath = resolve(process.argv[2] ?? process.env.BEAT_APP_OUTPUT_PATH ?? join(homedir(), "Applications", "Beat.app"));
const resourcesPath = join(appPath, "Contents", "Resources");
const frontendPath = join(resourcesPath, "frontend");
const executablePath = join(appPath, "Contents", "MacOS", "Beat");
const version = readFileSync(join(repoRoot, "VERSION"), "utf8").trim();

assert.equal(existsSync(appPath), true, `App bundle not found: ${appPath}`);
assert.equal(existsSync(executablePath), true, "Packaged Beat executable is missing");
assert.ok(statSync(executablePath).mode & 0o111, "Packaged Beat executable is not executable");
assert.equal(existsSync(join(frontendPath, "index.html")), true, "Bundled frontend index is missing");

for (const file of [
  "almarai-light.ttf",
  "almarai-regular.ttf",
  "almarai-bold.ttf",
  "almarai-extra-bold.ttf",
  "almarai-OFL.txt",
]) {
  assert.equal(existsSync(join(frontendPath, "assets", "fonts", file)), true, `Bundled font resource is missing: ${file}`);
}

const disallowedDirectories = new Set([".git", ".venv", "node_modules", "generated-tests", "__pycache__"]);
const disallowedExtensions = new Set([".cpp", ".h", ".hpp", ".ts", ".tsx", ".map", ".pyc"]);
const violations = [];
let fileCount = 0;
let totalBytes = 0;

function extensionOf(name) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    const rel = relative(appPath, entryPath);
    if (entry.isDirectory()) {
      if (disallowedDirectories.has(entry.name)) violations.push(`${rel}: development directory`);
      else walk(entryPath);
      continue;
    }
    if (entry.isSymbolicLink()) {
      const resolved = resolve(path, readlinkSync(entryPath));
      if (!resolved.startsWith(`${appPath}/`)) violations.push(`${rel}: external symlink`);
      continue;
    }
    fileCount += 1;
    totalBytes += lstatSync(entryPath).size;
    if (disallowedExtensions.has(extensionOf(entry.name))) violations.push(`${rel}: development/source artifact`);
    if (/^devHooks-[^.]+\.js$/i.test(entry.name)) violations.push(`${rel}: development fixture bundle`);
    if (entry.name === ".DS_Store") violations.push(`${rel}: Finder metadata`);
  }
}

walk(appPath);
assert.deepEqual(violations, [], `Distributable contains non-runtime files:\n${violations.join("\n")}`);

const plistText = readFileSync(join(appPath, "Contents", "Info.plist"), "utf8");
assert.match(plistText, new RegExp(`<key>CFBundleShortVersionString</key>\\s*<string>${version.replaceAll(".", "\\.")}</string>`));

const executableDescription = execFileSync("file", [executablePath], { encoding: "utf8" }).trim();
assert.match(executableDescription, /Mach-O/);
assert.match(executableDescription, /arm64|universal binary/);

console.log(`Beta package audit passed for ${basename(appPath)} ${version}: ${fileCount} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB.`);
