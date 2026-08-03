#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const requireFromFrontend = createRequire(new URL("../frontend/package.json", import.meta.url));
const { buildSync } = requireFromFrontend("esbuild");
const temp = mkdtempSync(join(tmpdir(), "beat-collaboration-foundation-"));

try {
  const entry = join(temp, "entry.ts");
  const output = join(temp, "entry.mjs");
  const source = `
    export * from ${JSON.stringify(join(root, "frontend/src/collaboration/projectOperations.ts"))};
    export * from ${JSON.stringify(join(root, "frontend/src/state/libraryMetadata.ts"))};
    export { useProjectStore } from ${JSON.stringify(join(root, "frontend/src/state/store.ts"))};
  `;
  await import("node:fs/promises").then(({ writeFile }) => writeFile(entry, source));
  buildSync({ entryPoints: [entry], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const api = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

  const duplicate = api.materializeSegmentEditCommand({
    kind: "duplicate",
    segments: [{ id: "s1", trackId: "t1", startBeat: 0, lengthBeats: 4, repeats: 0, layer: 0, payload: { kind: "midi", notes: [] } }],
  });
  assert.equal(duplicate.createdSegmentIds.length, 1, "duplicate IDs must be allocated before mutation");
  const operation = api.createSegmentEditOperation("project-1", duplicate);
  assert.equal(operation.payload.command.createdSegmentIds[0], duplicate.createdSegmentIds[0]);
  assert.ok(operation.actorId && operation.clientId && operation.transactionId && operation.operationId);

  api.resetProjectOperationSession();
  const fixed = (operationId, actorId, lamport) => ({
    schemaVersion: 1,
    operationId,
    projectId: "project-1",
    actorId,
    clientId: `client-${actorId}`,
    transactionId: `tx-${operationId}`,
    lamport,
    createdAt: 1,
    kind: "segment.edit",
    payload: { command: { kind: "delete", segmentIds: [] } },
  });
  const seen = [];
  api.replayProjectOperations([fixed("b", "z", 2), fixed("a", "a", 1), fixed("a", "a", 1)], (item) => {
    seen.push(item.operationId);
    api.markProjectOperationApplied(item);
  });
  assert.deepEqual(seen, ["a", "b"], "replay must sort deterministically and ignore duplicate operations");

  const metadata = api.normalizeLibraryMetadata(undefined, { createdAt: 100, updatedAt: 200, tags: ["Keys", "keys", "Warm"] });
  assert.equal(metadata.createdAt, 100);
  assert.equal(metadata.updatedAt, 200);
  assert.deepEqual(metadata.tags, ["keys", "warm"]);
  assert.equal(metadata.visibility, "private");
  const factory = api.normalizeLibraryMetadata(undefined, { factory: true });
  assert.equal(factory.creator.id, "beat.factory");
  assert.equal(factory.creator.displayName, "Beat");

  api.resetProjectOperationSession();
  api.useProjectStore.getState().loadProject({
    id: "journal-project",
    name: "Journal test",
    bpm: 120,
    timeSignature: { num: 4, denom: 4, boldBeats: [1] },
    lengthBeats: 16,
    tracks: [{
      id: "track-1",
      name: "Track 1",
      kind: "midi",
      gainDb: 0,
      pan: 0,
      mute: false,
      solo: false,
      recordArmed: false,
      inputMonitoring: false,
      inputDeviceId: "",
      inputChannelStart: 0,
      inputChannelCount: 1,
      recordGainDb: 0,
      sends: [],
      effects: { filters: [] },
      segments: [{ id: "segment-1", trackId: "track-1", startBeat: 0, lengthBeats: 4, repeats: 0, layer: 0, payload: { kind: "midi", notes: [] } }],
      rowHeight: "normal",
    }],
    returnBuses: [],
    masterEqAutomation: [],
    masterChain: {},
    recordingInput: {},
  });
  let emitted;
  const unsubscribe = api.subscribeToProjectOperations((item) => { emitted = item; });
  api.useProjectStore.getState().applySegmentEditCommand({
    kind: "move",
    moves: [{ segmentId: "segment-1", toTrackId: "track-1", toStartBeat: 3 }],
  });
  unsubscribe();
  assert.equal(api.useProjectStore.getState().project.tracks[0].segments[0].startBeat, 3);
  assert.equal(emitted?.projectId, "journal-project", "local segment edits must emit a project operation");
  api.useProjectStore.getState().applySegmentEditCommand(emitted.payload.command, emitted);
  assert.equal(api.useProjectStore.getState().project.tracks[0].segments[0].startBeat, 3, "replaying the same operation must be idempotent");

  const read = (relative) => readFileSync(join(root, relative), "utf8");
  assert.match(read("frontend/src/state/store.ts"), /createSegmentEditOperation\(get\(\)\.project\.id/);
  assert.match(read("frontend/src/state/store.ts"), /publishProjectOperation\(operation\)/);
  assert.match(read("frontend/src/persistence/dexie.ts"), /this\.version\(11\)/);
  assert.match(read("frontend/src/persistence/dexie.ts"), /projectOperations: "operationId, projectId/);
  assert.match(read("frontend/src/features/InstrumentEditor/InstrumentEditorModal.solid.tsx"), />Library metadata</);
  assert.match(read("frontend/src/features/ComponentLibrary/ComponentEditorModal.solid.tsx"), /label="Creator"/);
  assert.match(read("frontend/src/persistence/beatDocument.ts"), /ensureSegmentNoteIds/);

  console.log("Collaboration foundation verifier passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
