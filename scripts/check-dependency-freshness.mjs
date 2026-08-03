import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = join(repoRoot, "frontend");
const failures = [];
const notices = [];

function parseVersion(value) {
  const match = String(value).match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Beat-dependency-audit" },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function auditJuce() {
  const cmake = await readFile(join(repoRoot, "CMakeLists.txt"), "utf8");
  const currentTag = cmake.match(/GIT_TAG\s+([0-9]+\.[0-9]+\.[0-9]+)/)?.[1];
  if (!currentTag) throw new Error("Could not read Beat's JUCE GIT_TAG");
  const current = parseVersion(currentTag);
  const releases = await fetchJson("https://api.github.com/repos/juce-framework/JUCE/releases?per_page=100");
  const stable = releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => ({ tag: release.tag_name, version: parseVersion(release.tag_name) }))
    .filter((release) => release.version);
  const sameMajor = stable
    .filter((release) => release.version[0] === current[0])
    .sort((left, right) => compareVersions(right.version, left.version));
  if (sameMajor[0] && compareVersions(sameMajor[0].version, current) > 0)
    failures.push(`JUCE ${currentTag} is behind maintained ${sameMajor[0].tag}`);
  const newest = [...stable].sort((left, right) => compareVersions(right.version, left.version))[0];
  if (newest && newest.version[0] > current[0])
    notices.push(`JUCE ${newest.tag} is a major migration candidate; Beat remains on maintained ${currentTag}`);
}

const pythonPackages = [
  ["audio-to-midi-macos-py311.lock", "basic-pitch"],
  ["audio-to-midi-macos-py311.lock", "coremltools"],
  ["piano-transcription-macos-py311.lock", "transkun"],
  ["piano-transcription-macos-py311.lock", "torch"],
  ["piano-transcription-macos-py311.lock", "torchaudio"],
  ["stem-separation-macos-py313.lock", "demucs-onnx"],
  ["score-recognition-macos-py311.lock", "homr"],
  ["multi-instrument-transcription-macos-py311.lock", "muscriptor"],
];

async function lockedVersion(fileName, packageName) {
  const source = await readFile(join(repoRoot, "scripts", "requirements", fileName), "utf8");
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^${escaped}==([^\\s]+)$`, "im"));
  if (!match) throw new Error(`${packageName} is missing from ${fileName}`);
  return match[1];
}

async function auditPythonEngines() {
  for (const [fileName, packageName] of pythonPackages) {
    const installed = await lockedVersion(fileName, packageName);
    const metadata = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`);
    const latest = metadata.info.version;
    if (installed !== latest)
      failures.push(`${packageName} ${installed} is behind PyPI ${latest} in ${fileName}`);
  }
  const scoreLock = "score-recognition-macos-py311.lock";
  const full = await lockedVersion(scoreLock, "opencv-python");
  const headless = await lockedVersion(scoreLock, "opencv-python-headless");
  if (full !== headless || Number(full.split(".")[0]) >= 5)
    failures.push(`homr OpenCV distributions must match on the supported pre-5 line; found ${full} and ${headless}`);
}

function parseCommandJson(result, label) {
  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    throw new Error(`${label} returned invalid JSON: ${result.stderr || result.stdout}`);
  }
}

function auditFrontend() {
  const audit = spawnSync("npm", ["audit", "--json"], { cwd: frontendRoot, encoding: "utf8" });
  const auditResult = parseCommandJson(audit, "npm audit");
  const vulnerabilityCount = auditResult.metadata?.vulnerabilities?.total ?? 0;
  if (audit.status !== 0 || vulnerabilityCount > 0)
    failures.push(`npm audit reports ${vulnerabilityCount} vulnerabilities`);

  const outdated = spawnSync("npm", ["outdated", "--json", "--depth=0"], { cwd: frontendRoot, encoding: "utf8" });
  const outdatedResult = parseCommandJson(outdated, "npm outdated");
  for (const [name, state] of Object.entries(outdatedResult)) {
    if (state.current !== state.wanted)
      failures.push(`${name} lock ${state.current} is behind compatible ${state.wanted}`);
    else if (state.current !== state.latest)
      notices.push(`${name} ${state.current} has deferred migration ${state.latest}`);
  }
}

try {
  await auditJuce();
  await auditPythonEngines();
  auditFrontend();
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

for (const notice of notices) console.log(`NOTICE: ${notice}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Dependency freshness passed: maintained JUCE line, core Python engines, OpenCV pairing, npm lock, and npm advisories are current.");
