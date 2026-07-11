#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const root = resolve(process.env.AETHER_REFERENCE_ROOT || "/Users/alexcheng/beat-aether-references-reviewed");
const forbidden = ["/", "/Users/alexcheng/beat", "/Users/alexcheng/beat-aether-foundation"];
if (forbidden.some((path) => root === path || root.startsWith(`${path}${sep}`)))
  throw new Error(`Unsafe AETHER_REFERENCE_ROOT: ${root}`);
if (existsSync(root)) throw new Error(`Reference root already exists: ${root}`);

const repositories = [
  ["vital", "https://github.com/mtytel/vital", "636ca0ef517a4db087a6a08a6a8a5e704e21f836"],
  ["surge", "https://github.com/surge-synthesizer/surge", "c3aa9b00529bb90a597442903a142c2c194a46e6"],
  ["signalsmith-dsp", "https://github.com/Signalsmith-Audio/dsp", "2d20161915e733f117545c6be8cd3275a739a1e3"],
  ["signalsmith-stretch", "https://github.com/Signalsmith-Audio/signalsmith-stretch", "57b93f4e9206a089a45387eaa39bdc9f310d3308"],
  ["DaisySP", "https://github.com/electro-smith/DaisySP", "599511b740f8f3a9b8db72a0642aa45b8a23c3a3"],
  ["chowdsp_wdf", "https://github.com/Chowdhury-DSP/chowdsp_wdf", "43bcd295e8403de913f9966f4fd7ff9d17c9f1a5"],
  ["sfizz", "https://github.com/sfztools/sfizz", "f5c6e29f23b8057867c08e88f5f6ac6738baa30b"],
  ["eurorack", "https://github.com/pichenettes/eurorack", "08460a69a7e1f7a81c5a2abcc7189c9a6b7208d4"],
  ["stk", "https://github.com/thestk/stk", "6aacd357d76250bb7da2b1ddf675651828784bbc"],
  ["rubberband", "https://github.com/breakfastquay/rubberband", "e4296ac80b1170018a110bc326fd0d45a0eb27d6"],
  ["kissfft", "https://github.com/mborgerding/kissfft", "6398d8a1d0c92486b5ece8a456fd5e6a97ad1f08"],
];

mkdirSync(join(root, "repos"), { recursive: true });
mkdirSync(join(root, "reports"), { recursive: true });
const isolatedHome = join(root, "home");
mkdirSync(isolatedHome);
const env = {
  PATH: process.env.PATH,
  HOME: isolatedHome,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "/usr/bin/false",
  GIT_LFS_SKIP_SMUDGE: "1",
  LANG: "C",
};
const commands = [];
const run = (args, cwd) => {
  commands.push({ executable: "git", args, cwd });
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
};
const packages = [];
const inventory = [];
const suspiciousNames = /(?:^|\/)(?:\.gitmodules|\.gitattributes|package(?:-lock)?\.json|Cargo\.(?:toml|lock)|CMakeLists\.txt|.*\.(?:cmake|workflow|yml|yaml|sh|command|bat|exe|dll|dylib|so|a|zip|tar|gz|preset|fxp|fxb))$/i;

for (const [name, url, sha] of repositories) {
  if (!url.startsWith("https://github.com/")) throw new Error(`Rejected non-canonical URL: ${url}`);
  const repo = join(root, "repos", name);
  mkdirSync(repo);
  run(["init", "--quiet"], repo);
  run(["config", "core.hooksPath", "/dev/null"], repo);
  run(["config", "credential.helper", ""], repo);
  run(["config", "maintenance.auto", "false"], repo);
  run(["remote", "add", "origin", url], repo);
  run(["fetch", "--depth=1", "--no-tags", "origin", sha], repo);
  run(["checkout", "--detach", "--quiet", "FETCH_HEAD"], repo);
  const resolved = run(["rev-parse", "HEAD"], repo);
  if (resolved !== sha) throw new Error(`${name}: expected ${sha}, got ${resolved}`);
  const tree = run(["rev-parse", "HEAD^{tree}"], repo);
  const files = run(["ls-files", "-z"], repo).split("\0").filter(Boolean);
  const hashes = [];
  const flagged = [];
  for (const relative of files) {
    const path = join(repo, relative);
    const stat = lstatSync(path);
    const digest = stat.isDirectory()
      ? createHash("sha256").update(run(["rev-parse", `HEAD:${relative}`], repo)).digest("hex")
      : stat.isSymbolicLink()
      ? createHash("sha256").update(readlinkSync(path)).digest("hex")
      : createHash("sha256").update(readFileSync(path)).digest("hex");
    hashes.push({ path: relative, sha256: digest, size: stat.size, mode: stat.mode & 0o777 });
    if (suspiciousNames.test(relative)) flagged.push(relative);
  }
  writeFileSync(join(root, "reports", `${name}-sha256.json`), JSON.stringify(hashes, null, 2));
  inventory.push({ name, url, commit: sha, tree, fileCount: files.length, flaggedFiles: flagged });
  packages.push({ SPDXID: `SPDXRef-Package-${name.replace(/[^A-Za-z0-9.-]/g, "-")}`, name, versionInfo: sha,
    downloadLocation: `${url}@${sha}`, filesAnalyzed: true, licenseConcluded: "NOASSERTION", licenseDeclared: "NOASSERTION",
    checksums: [{ algorithm: "SHA256", checksumValue: createHash("sha256").update(JSON.stringify(hashes)).digest("hex") }] });
}

const spdx = {
  spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT",
  name: "Beat Aether reviewed external references", documentNamespace: `https://beat.invalid/spdx/aether/${Date.now()}`,
  creationInfo: { created: new Date().toISOString(), creators: ["Tool: Beat secure-aether-acquisition.mjs"] }, packages,
};
writeFileSync(join(root, "reports", "acquisition.json"), JSON.stringify({ root, createdAt: new Date().toISOString(), repositories: inventory, commands, environmentNames: Object.keys(env) }, null, 2));
writeFileSync(join(root, "reports", "aether-references.spdx.json"), JSON.stringify(spdx, null, 2));
writeFileSync(join(root, "QUARANTINE-BOUNDARY.txt"), "Static review only. Do not execute or import without human approval.\n");
console.log(JSON.stringify({ ok: true, root, repositories: inventory.length }, null, 2));
