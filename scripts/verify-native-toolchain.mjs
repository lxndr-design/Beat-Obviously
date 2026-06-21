#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const checks = [];

function runCheck(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail });
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

function commandOutput(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

runCheck("xcode-select", () => {
  const path = commandOutput("xcode-select", ["-p"]);
  if (!path) throw new Error("xcode-select returned an empty developer directory.");
  if (!existsSync(path)) throw new Error(`developer directory does not exist: ${path}`);
  return path;
});

runCheck("macOS SDK", () => {
  const sdkCandidates = [
    "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
    "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
  ];
  const sdk = sdkCandidates.find((candidate) => existsSync(candidate));
  if (!sdk) throw new Error(`missing SDK; checked ${sdkCandidates.join(", ")}`);
  const sqliteTbd = `${sdk}/usr/lib/libsqlite3.tbd`;
  if (!existsSync(sqliteTbd)) throw new Error(`SDK found but sqlite import library is missing: ${sqliteTbd}`);
  return sdk;
});

runCheck("git", () => commandOutput("git", ["--version"]));
runCheck("cmake", () => commandOutput("cmake", ["--version"]).split("\n")[0]);

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.error("Native toolchain verifier failed:");
  for (const check of checks) {
    console.error(`- ${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}`);
  }
  console.error("");
  console.error("Install Command Line Tools or Xcode, then set the active developer directory.");
  console.error("Typical fixes:");
  console.error("- xcode-select --install");
  console.error("- sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer");
  process.exit(1);
}

console.log("Native toolchain verifier passed:");
for (const check of checks) console.log(`- ${check.name}: ${check.detail}`);
