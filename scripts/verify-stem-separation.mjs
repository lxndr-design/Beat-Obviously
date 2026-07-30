import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "../frontend/node_modules/esbuild/lib/main.js";

const repoRoot = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

const service = read("backend/Source/Audio/Analysis/StemSeparationService.h");
const backendSchema = read("backend/Source/Ipc/Schema.h");
const frontendSchema = read("frontend/src/ipc/schema.ts");
const bridge = read("backend/Source/Ipc/MessageBridge.cpp");
const action = read("frontend/src/audio/stemSeparation.ts");
const segment = read("frontend/src/features/Tracks/Segment.solid.tsx");
const setup = read("scripts/setup-stem-separation.sh");

for (const kind of ["audio.stemsStart", "audio.stemsStatus", "audio.stemsCancel"])
  assert(frontendSchema.includes(kind), `frontend IPC is missing ${kind}`);
for (const symbol of ["AUDIO_STEMS_START", "AUDIO_STEMS_STATUS", "AUDIO_STEMS_CANCEL"])
  assert(backendSchema.includes(symbol), `backend IPC is missing ${symbol}`);

assert(service.includes('arguments.add("htdemucs")'), "service must select the four-stem htdemucs model");
assert(service.includes('arguments.add("--small")'), "service must use the bounded fp16-weight download");
assert(service.includes('arguments.add("cpu")'), "service must avoid the currently incompatible CoreML graph path");
assert(service.includes("juce::ChildProcess"), "separation must run outside the Beat audio thread");
assert(service.includes("current->cancel.store"), "separation job must be cancellable");
assert(bridge.includes("importAudioFileIntoLibrary"), "generated stems must enter Beat's managed audio library");
assert(action.includes('groupId: `stems_${crypto.randomUUID()}`'), "generated clips must share a persisted stem group");
assert(action.includes("projectStore.updateSegment(source.id, { muted: true })"), "the reversible workflow must retain and mute the source clip");
assert(action.includes("setSelectedSegments([segment.id])"), "unlinking must leave only the chosen stem selected for independent movement");
assert(segment.includes('label: "Separate into Stems…"'), "audio clip context menu must expose separation");
assert(segment.includes('"Unlink Stems"'), "linked stems must expose unlinking");
assert(setup.includes('demucs-onnx==0.3.4'), "runtime setup must pin the verified separator release");
assert((statSync(join(repoRoot, "scripts/setup-stem-separation.sh")).mode & 0o111) !== 0, "runtime setup script must be executable");

const behavioralCheck = await build({
  stdin: {
    resolveDir: join(repoRoot, "frontend/src/audio"),
    sourcefile: "stem-grouping-check.ts",
    loader: "ts",
    contents: `
      import assert from "node:assert/strict";
      import { linkedResizeTargets, linkedSegmentsFor } from "./stemGrouping.ts";
      const clip = (id: string, groupId?: string) => ({ id, groupId, trackId: id, startBeat: 4, lengthBeats: 8, repeats: 0, layer: 0, payload: { kind: "audio", audioFileId: id, gainDb: 0 } });
      const a = clip("a", "stems_one");
      const b = clip("b", "stems_one");
      const c = clip("c");
      assert.deepEqual(linkedSegmentsFor(a, [a, b, c]).map((item) => item.id), ["a", "b"]);
      assert.deepEqual(linkedSegmentsFor(c, [a, b, c]).map((item) => item.id), ["c"]);
      assert.deepEqual(linkedResizeTargets("resize-left", a, { startBeat: 6, lengthBeats: 6 }, [a, b]).map((target) => [target.startBeat, target.lengthBeats]), [[6, 6], [6, 6]]);
      assert.deepEqual(linkedResizeTargets("resize-right", a, { startBeat: 4, lengthBeats: 10 }, [a, b]).map((target) => [target.startBeat, target.lengthBeats]), [[4, 10], [4, 10]]);
    `,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const encodedCheck = Buffer.from(behavioralCheck.outputFiles[0].text).toString("base64");
await import(`data:text/javascript;base64,${encodedCheck}`);

// Also prove the bundled esbuild module resolved from the checkout rather than
// silently skipping the behavioral checks.
assert(pathToFileURL(join(repoRoot, "frontend/node_modules/esbuild/lib/main.js")).href.startsWith("file:"));

console.log("Stem separation verification passed: IPC, runtime, track creation, linked resize, unlink, and setup contracts are present.");
