#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-daw-core-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/state/store.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outfile=${join(outDir, "store.js")}`,
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/features/Tracks/geometry.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outfile=${join(outDir, "geometry.js")}`,
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/automation/trackEffects.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outfile=${join(outDir, "trackEffects.js")}`,
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/automation/curves.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outfile=${join(outDir, "curves.js")}`,
    ],
    { stdio: "inherit" },
  );

  const store = await import(pathToFileURL(join(outDir, "store.js")));
  const geometry = await import(pathToFileURL(join(outDir, "geometry.js")));
  const trackEffects = await import(pathToFileURL(join(outDir, "trackEffects.js")));
  const curves = await import(pathToFileURL(join(outDir, "curves.js")));
  const projectStore = store.useProjectStore.getState();
  projectStore.loadProject(store.createEmptyProject());

  const trackA = store.useProjectStore.getState().project.tracks[0].id;
  const trackB = projectStore.addTrack({ name: "Target" });
  const first = projectStore.addSegment(trackA, {
    name: "First",
    startBeat: 1,
    lengthBeats: 4,
    payload: { kind: "midi", notes: [{ pitch: 60, velocity: 100, startBeat: 0, lengthBeats: 1 }] },
  });
  const second = projectStore.addSegment(trackA, {
    name: "Second",
    startBeat: 3,
    lengthBeats: 2,
    payload: { kind: "midi", notes: [{ pitch: 64, velocity: 100, startBeat: 0, lengthBeats: 1 }] },
  });

  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "move",
    moves: [
      { segmentId: first, toTrackId: trackB, toStartBeat: 8 },
      { segmentId: second, toTrackId: trackB, toStartBeat: 10 },
    ],
  });
  let project = store.useProjectStore.getState().project;
  assert.equal(project.tracks[0].segments.length, 0, "multi-move should remove moved segments from source track");
  assert.deepEqual(
    project.tracks[1].segments.map((segment) => [segment.id, segment.trackId, segment.startBeat]),
    [
      [first, trackB, 8],
      [second, trackB, 10],
    ],
    "multi-move should land all selected segments in one command",
  );

  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "resize",
    segmentId: first,
    startBeat: -4,
    lengthBeats: 999,
  });
  project = store.useProjectStore.getState().project;
  const resized = project.tracks[1].segments.find((segment) => segment.id === first);
  assert.ok(resized, "resize target should still exist");
  assert.equal(resized.startBeat, 0, "resize should clamp negative starts");
  assert.equal(resized.lengthBeats, project.lengthBeats, "resize should clamp to project length");

  const duplicateIds = store.useProjectStore.getState().applySegmentEditCommand({
    kind: "duplicate",
    segments: [resized],
    offsetBeats: 4,
  });
  assert.equal(duplicateIds.length, 1, "duplicate command should return created ids");
  project = store.useProjectStore.getState().project;
  const duplicate = project.tracks[1].segments.find((segment) => segment.id === duplicateIds[0]);
  assert.ok(duplicate, "duplicate should be inserted");
  assert.notEqual(duplicate.id, resized.id, "duplicate must have a fresh id");
  assert.equal(duplicate.trackId, resized.trackId, "duplicate should stay on source track by default");
  assert.equal(duplicate.startBeat, resized.startBeat + 4, "duplicate should honor offset");

  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "nudge",
    segmentIds: [duplicate.id],
    deltaBeats: -99,
  });
  project = store.useProjectStore.getState().project;
  const nudged = project.tracks[1].segments.find((segment) => segment.id === duplicate.id);
  assert.ok(nudged, "nudged segment should still exist");
  assert.equal(nudged.startBeat, 0, "nudge should clamp at project start");

  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "nudge",
    segmentIds: [duplicate.id],
    deltaBeats: 3.37,
  });
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "quantize",
    segmentIds: [duplicate.id],
    gridBeats: 0.5,
  });
  project = store.useProjectStore.getState().project;
  const quantized = project.tracks[1].segments.find((segment) => segment.id === duplicate.id);
  assert.ok(quantized, "quantized segment should still exist");
  assert.equal(quantized.startBeat, 3.5, "quantize should snap to the nearest grid");

  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "delete",
    segmentIds: [first, second, duplicate.id],
  });
  project = store.useProjectStore.getState().project;
  assert.equal(
    project.tracks.flatMap((track) => track.segments).length,
    0,
    "delete command should remove every requested segment",
  );

  const pasteSourceAId = projectStore.addSegment(trackA, {
    name: "Paste Source A",
    startBeat: 2,
    lengthBeats: 1,
    payload: { kind: "midi", notes: [{ pitch: 65, velocity: 96, startBeat: 0, lengthBeats: 0.5 }] },
  });
  const pasteSourceBId = projectStore.addSegment(trackA, {
    name: "Paste Source B",
    startBeat: 4.5,
    lengthBeats: 1.5,
    payload: { kind: "midi", notes: [{ pitch: 69, velocity: 88, startBeat: 0.25, lengthBeats: 0.75 }] },
  });
  project = store.useProjectStore.getState().project;
  const pasteSourceA = project.tracks[0].segments.find((segment) => segment.id === pasteSourceAId);
  const pasteSourceB = project.tracks[0].segments.find((segment) => segment.id === pasteSourceBId);
  assert.ok(pasteSourceA && pasteSourceB, "paste sources should exist");
  const pastedToTargetIds = store.useProjectStore.getState().applySegmentEditCommand({
    kind: "paste",
    segments: [pasteSourceA, pasteSourceB],
    targetTrackId: trackB,
    startBeat: 12,
  });
  assert.equal(pastedToTargetIds.length, 2, "paste command should return created ids");
  project = store.useProjectStore.getState().project;
  const pastedToTarget = pastedToTargetIds.map((id) => project.tracks[1].segments.find((segment) => segment.id === id));
  assert.ok(pastedToTarget.every(Boolean), "target-track paste should insert every clone into the requested track");
  assert.deepEqual(
    pastedToTarget.map((segment) => [segment.id, segment.trackId, segment.startBeat, segment.lengthBeats]),
    [
      [pastedToTargetIds[0], trackB, 12, 1],
      [pastedToTargetIds[1], trackB, 14.5, 1.5],
    ],
    "paste should anchor the earliest copied segment and preserve relative offsets",
  );
  assert.notEqual(pastedToTargetIds[0], pasteSourceAId, "paste clones should have fresh ids");
  assert.deepEqual(
    pastedToTarget[0].payload.notes,
    pasteSourceA.payload.notes,
    "paste should clone source payload content",
  );

  const pastedPreservedTrackIds = store.useProjectStore.getState().applySegmentEditCommand({
    kind: "paste",
    segments: [
      pasteSourceA,
      { ...pasteSourceB, trackId: trackB },
    ],
    startBeat: 20,
  });
  project = store.useProjectStore.getState().project;
  const preservedTrackA = project.tracks[0].segments.find((segment) => segment.id === pastedPreservedTrackIds[0]);
  const preservedTrackB = project.tracks[1].segments.find((segment) => segment.id === pastedPreservedTrackIds[1]);
  assert.ok(preservedTrackA && preservedTrackB, "paste without target override should preserve per-segment tracks");
  assert.equal(preservedTrackA.startBeat, 20, "preserved-track paste should anchor first segment");
  assert.equal(preservedTrackB.startBeat, 22.5, "preserved-track paste should preserve second segment offset");

  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "delete",
    segmentIds: [pasteSourceAId, pasteSourceBId, ...pastedToTargetIds, ...pastedPreservedTrackIds],
  });
  project = store.useProjectStore.getState().project;
  assert.equal(
    project.tracks.flatMap((track) => track.segments).length,
    0,
    "paste verifier cleanup should remove sources and clones",
  );

  const metadataSegmentId = projectStore.addSegment(trackA, {
    name: "Metadata Source",
    startBeat: 1,
    lengthBeats: 2,
    payload: { kind: "midi", notes: [] },
  });
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "metadata",
    segmentIds: [metadataSegmentId],
    name: "  Renamed Segment  ",
    color: "  #f5f5f5  ",
    icon: "  ph:waveform  ",
  });
  project = store.useProjectStore.getState().project;
  let metadataSegment = project.tracks[0].segments.find((segment) => segment.id === metadataSegmentId);
  assert.ok(metadataSegment, "metadata target should exist");
  assert.equal(metadataSegment.name, "Renamed Segment", "metadata command should trim segment names");
  assert.equal(metadataSegment.color, "#f5f5f5", "metadata command should store trimmed color metadata");
  assert.equal(metadataSegment.icon, "ph:waveform", "metadata command should store trimmed icon metadata");
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "metadata",
    segmentIds: [metadataSegmentId],
    name: "",
    color: null,
    icon: "",
  });
  project = store.useProjectStore.getState().project;
  metadataSegment = project.tracks[0].segments.find((segment) => segment.id === metadataSegmentId);
  assert.ok(metadataSegment, "metadata clear target should exist");
  assert.equal(metadataSegment.name, undefined, "empty metadata name should clear the optional name");
  assert.equal(metadataSegment.color, undefined, "null metadata color should clear the optional color");
  assert.equal(metadataSegment.icon, undefined, "empty metadata icon should clear the optional icon");
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "delete",
    segmentIds: [metadataSegmentId],
  });
  project = store.useProjectStore.getState().project;
  assert.equal(
    project.tracks.flatMap((track) => track.segments).length,
    0,
    "metadata verifier cleanup should remove its segment",
  );

  const groupSourceAId = projectStore.addSegment(trackA, {
    name: "Group Source A",
    startBeat: 1,
    lengthBeats: 2,
    payload: { kind: "midi", notes: [] },
  });
  const groupSourceBId = projectStore.addSegment(trackA, {
    name: "Group Source B",
    startBeat: 4,
    lengthBeats: 2,
    payload: { kind: "midi", notes: [] },
  });
  const [createdGroupId] = store.useProjectStore.getState().applySegmentEditCommand({
    kind: "group",
    segmentIds: [groupSourceAId, groupSourceBId],
  });
  assert.ok(createdGroupId, "group command should return a created group id");
  project = store.useProjectStore.getState().project;
  let groupSourceA = project.tracks[0].segments.find((segment) => segment.id === groupSourceAId);
  let groupSourceB = project.tracks[0].segments.find((segment) => segment.id === groupSourceBId);
  assert.ok(groupSourceA && groupSourceB, "group targets should exist");
  assert.equal(groupSourceA.groupId, createdGroupId, "group command should assign the created group id");
  assert.equal(groupSourceB.groupId, createdGroupId, "group command should assign the same id to all selected segments");
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "ungroup",
    segmentIds: [groupSourceAId],
  });
  project = store.useProjectStore.getState().project;
  groupSourceA = project.tracks[0].segments.find((segment) => segment.id === groupSourceAId);
  groupSourceB = project.tracks[0].segments.find((segment) => segment.id === groupSourceBId);
  assert.ok(groupSourceA && groupSourceB, "partial ungroup targets should exist");
  assert.equal(groupSourceA.groupId, undefined, "ungroup by segment id should clear only the requested segment");
  assert.equal(groupSourceB.groupId, createdGroupId, "ungroup by segment id should leave other group members intact");
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "ungroup",
    groupIds: [createdGroupId],
  });
  project = store.useProjectStore.getState().project;
  groupSourceB = project.tracks[0].segments.find((segment) => segment.id === groupSourceBId);
  assert.ok(groupSourceB, "group-id ungroup target should exist");
  assert.equal(groupSourceB.groupId, undefined, "ungroup by group id should clear remaining members");
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "group",
    segmentIds: [groupSourceAId, groupSourceBId],
    groupId: "manual-group",
  });
  project = store.useProjectStore.getState().project;
  groupSourceA = project.tracks[0].segments.find((segment) => segment.id === groupSourceAId);
  groupSourceB = project.tracks[0].segments.find((segment) => segment.id === groupSourceBId);
  assert.equal(groupSourceA.groupId, "manual-group", "group command should accept a caller-provided group id");
  assert.equal(groupSourceB.groupId, "manual-group", "provided group id should apply to all selected segments");
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "delete",
    segmentIds: [groupSourceAId, groupSourceBId],
  });
  project = store.useProjectStore.getState().project;
  assert.equal(
    project.tracks.flatMap((track) => track.segments).length,
    0,
    "group verifier cleanup should remove its segments",
  );

  const splitSource = projectStore.addSegment(trackA, {
    name: "Split MIDI",
    startBeat: 4,
    lengthBeats: 4,
    payload: {
      kind: "midi",
      notes: [
        { pitch: 60, velocity: 100, startBeat: 0.5, lengthBeats: 1 },
        { pitch: 62, velocity: 100, startBeat: 1.5, lengthBeats: 2 },
        { pitch: 64, velocity: 100, startBeat: 3.25, lengthBeats: 0.5 },
      ],
    },
  });
  const [rightSplitId] = store.useProjectStore.getState().applySegmentEditCommand({
    kind: "split",
    segmentId: splitSource,
    splitBeat: 6,
  });
  project = store.useProjectStore.getState().project;
  const leftSplit = project.tracks[0].segments.find((segment) => segment.id === splitSource);
  const rightSplit = project.tracks[0].segments.find((segment) => segment.id === rightSplitId);
  assert.ok(leftSplit && rightSplit, "split should keep left and create right");
  assert.equal(leftSplit.lengthBeats, 2);
  assert.equal(rightSplit.startBeat, 6);
  assert.equal(rightSplit.lengthBeats, 2);
  assert.deepEqual(
    leftSplit.payload.notes.map((note) => [note.pitch, note.startBeat, note.lengthBeats]),
    [
      [60, 0.5, 1],
      [62, 1.5, 0.5],
    ],
    "left split should clip crossing MIDI notes",
  );
  assert.deepEqual(
    rightSplit.payload.notes.map((note) => [note.pitch, note.startBeat, note.lengthBeats]),
    [
      [62, 0, 1.5],
      [64, 1.25, 0.5],
    ],
    "right split should shift note starts into right segment space",
  );

  const audioSegment = projectStore.addSegment(trackA, {
    name: "Audio Trim",
    startBeat: 12,
    lengthBeats: 8,
    sourceStartBeat: 1,
    payload: { kind: "audio", audioFileId: "clip", gainDb: 0 },
  });
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "trim",
    segmentId: audioSegment,
    edge: "start",
    beat: 14,
  });
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "fade",
    segmentId: audioSegment,
    fadeInBeats: 1.25,
    fadeOutBeats: 99,
  });
  project = store.useProjectStore.getState().project;
  const trimmedAudio = project.tracks[0].segments.find((segment) => segment.id === audioSegment);
  assert.ok(trimmedAudio, "trimmed audio should still exist");
  assert.equal(trimmedAudio.startBeat, 14);
  assert.equal(trimmedAudio.lengthBeats, 6);
  assert.equal(trimmedAudio.sourceStartBeat, 3, "trim start should advance audio source offset");
  assert.equal(trimmedAudio.fadeInBeats, 1.25);
  assert.equal(trimmedAudio.fadeOutBeats, 6, "fade should clamp to segment length");

  const dragResize = projectStore.addSegment(trackA, {
    name: "Origin Resize",
    startBeat: 24,
    lengthBeats: 4,
    sourceStartBeat: 2,
    payload: {
      kind: "midi",
      notes: [
        { pitch: 67, velocity: 100, startBeat: 0.25, lengthBeats: 1 },
        { pitch: 69, velocity: 100, startBeat: 2, lengthBeats: 1 },
      ],
    },
  });
  const originPayload = structuredClone(
    store.useProjectStore.getState().project.tracks[0].segments.find((segment) => segment.id === dragResize).payload,
  );
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "resize",
    segmentId: dragResize,
    startBeat: 25,
    lengthBeats: 3,
    originStartBeat: 24,
    originLengthBeats: 4,
    originSourceStartBeat: 2,
    originPayload,
  });
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "resize",
    segmentId: dragResize,
    startBeat: 25,
    lengthBeats: 3,
    originStartBeat: 24,
    originLengthBeats: 4,
    originSourceStartBeat: 2,
    originPayload,
  });
  project = store.useProjectStore.getState().project;
  const stableResize = project.tracks[0].segments.find((segment) => segment.id === dragResize);
  assert.ok(stableResize, "origin-aware resize target should exist");
  assert.equal(stableResize.sourceStartBeat, 3, "origin-aware resize should not compound source offset");
  assert.deepEqual(
    stableResize.payload.notes.map((note) => [note.pitch, note.startBeat, note.lengthBeats]),
    [
      [67, 0, 0.25],
      [69, 1, 1],
    ],
    "origin-aware resize should trim from the original payload snapshot",
  );

  const crossfadeLeft = projectStore.addSegment(trackA, {
    name: "Crossfade Left",
    startBeat: 30,
    lengthBeats: 4,
    payload: { kind: "audio", audioFileId: "clip-a", gainDb: 0 },
  });
  const crossfadeRight = projectStore.addSegment(trackA, {
    name: "Crossfade Right",
    startBeat: 32.5,
    lengthBeats: 4,
    payload: { kind: "audio", audioFileId: "clip-b", gainDb: 0 },
  });
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "crossfade",
    firstSegmentId: crossfadeLeft,
    secondSegmentId: crossfadeRight,
  });
  project = store.useProjectStore.getState().project;
  const overlappedLeft = project.tracks[0].segments.find((segment) => segment.id === crossfadeLeft);
  const overlappedRight = project.tracks[0].segments.find((segment) => segment.id === crossfadeRight);
  assert.ok(overlappedLeft && overlappedRight, "crossfade targets should exist");
  assert.equal(overlappedLeft.fadeOutBeats, 1.5, "overlap crossfade should use overlap duration");
  assert.equal(overlappedRight.fadeInBeats, 1.5, "overlap crossfade should mirror incoming fade");

  const adjacentLeft = projectStore.addSegment(trackA, {
    name: "Adjacent Left",
    startBeat: 38,
    lengthBeats: 2,
    payload: { kind: "audio", audioFileId: "clip-c", gainDb: 0 },
  });
  const adjacentRight = projectStore.addSegment(trackA, {
    name: "Adjacent Right",
    startBeat: 40,
    lengthBeats: 2,
    payload: { kind: "audio", audioFileId: "clip-d", gainDb: 0 },
  });
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "crossfade",
    firstSegmentId: adjacentRight,
    secondSegmentId: adjacentLeft,
    lengthBeats: 0.75,
  });
  project = store.useProjectStore.getState().project;
  const abuttedLeft = project.tracks[0].segments.find((segment) => segment.id === adjacentLeft);
  const abuttedRight = project.tracks[0].segments.find((segment) => segment.id === adjacentRight);
  assert.ok(abuttedLeft && abuttedRight, "adjacent crossfade targets should exist");
  assert.equal(abuttedLeft.fadeOutBeats, 0.75, "adjacent crossfade should honor requested outgoing duration");
  assert.equal(abuttedRight.fadeInBeats, 0.75, "adjacent crossfade should honor requested incoming duration");
  assert.equal(abuttedLeft.startBeat, 38, "adjacent crossfade should not move the outgoing segment");
  assert.equal(abuttedRight.startBeat, 40, "adjacent crossfade should not move the incoming segment");
  assert.equal(abuttedLeft.lengthBeats, 2, "adjacent crossfade should not resize the outgoing segment");
  assert.equal(abuttedRight.lengthBeats, 2, "adjacent crossfade should not resize the incoming segment");
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "fade",
    segmentId: adjacentLeft,
    fadeInBeats: -1,
    fadeOutBeats: 0,
  });
  project = store.useProjectStore.getState().project;
  const clearedAdjacentLeft = project.tracks[0].segments.find((segment) => segment.id === adjacentLeft);
  assert.ok(clearedAdjacentLeft, "fade clear target should exist");
  assert.equal(clearedAdjacentLeft.fadeInBeats, 0, "fade command should clamp negative fade-in to zero");
  assert.equal(clearedAdjacentLeft.fadeOutBeats, 0, "fade command should clear fade-out to zero");

  const effectTrack = store.useProjectStore.getState().project.tracks[0].id;
  const effectId = store.useProjectStore.getState().addTrackEffect(effectTrack);
  project = store.useProjectStore.getState().project;
  let effect = project.tracks[0].effects.filters.find((candidate) => candidate.id === effectId);
  assert.ok(effect, "add effect should create a track-owned effect row");
  assert.equal(effect.kind, "reverb", "add effect should default to reverb");
  assert.deepEqual(effect.params, { roomSize: 40, damping: 35, mix: 20 }, "reverb defaults should live in the data layer");

  const pointA = store.useProjectStore.getState().upsertTrackEffectAutomationPoint(effectTrack, effectId, "mix", {
    beat: 12,
    value: 10,
    curve: "quadratic",
  });
  const pointB = store.useProjectStore.getState().upsertTrackEffectAutomationPoint(effectTrack, effectId, "mix", {
    beat: 8,
    value: 40,
  });
  project = store.useProjectStore.getState().project;
  effect = project.tracks[0].effects.filters.find((candidate) => candidate.id === effectId);
  assert.deepEqual(
    effect.automation.find((lane) => lane.param === "mix").points.map((point) => [point.id, point.beat, point.value, point.curve]),
    [
      [pointB, 8, 40, "linear"],
      [pointA, 12, 10, "quadratic"],
    ],
    "effect automation points should be stable-id, sorted timeline data",
  );
  store.useProjectStore.getState().upsertTrackEffectAutomationPoint(effectTrack, effectId, "mix", {
    id: pointB,
    beat: 8,
    value: 40,
    curve: "smoothstep",
  });
  project = store.useProjectStore.getState().project;
  effect = project.tracks[0].effects.filters.find((candidate) => candidate.id === effectId);
  assert.equal(
    effect.automation.find((lane) => lane.param === "mix").points[0].curve,
    "smoothstep",
    "effect automation point updates should preserve stable ids while changing curve families",
  );

  store.useProjectStore.getState().setTrackEffectKind(effectTrack, effectId, "delay");
  project = store.useProjectStore.getState().project;
  effect = project.tracks[0].effects.filters.find((candidate) => candidate.id === effectId);
  assert.equal(effect.kind, "delay", "changing effect kind should update the effect row");
  assert.deepEqual(effect.params, { timeMs: 250, feedback: 25, mix: 18 }, "changing effect kind should reset subrow values");
  assert.deepEqual(effect.automation, [], "changing effect kind should clear stale subrow automation");

  store.useProjectStore.getState().loadProject(store.createEmptyProject());
  const historyTrack = store.useProjectStore.getState().project.tracks[0].id;
  const historyFirst = store.useProjectStore.getState().addSegment(historyTrack, {
    name: "Grouped First",
    startBeat: 2,
    lengthBeats: 4,
    payload: { kind: "midi", notes: [{ pitch: 60, velocity: 100, startBeat: 0, lengthBeats: 1 }] },
  });
  const historySecond = store.useProjectStore.getState().addSegment(historyTrack, {
    name: "Grouped Second",
    startBeat: 8,
    lengthBeats: 2,
    payload: { kind: "midi", notes: [{ pitch: 64, velocity: 100, startBeat: 0, lengthBeats: 1 }] },
  });
  store.useProjectStore.temporal.getState().clear();
  store.runProjectHistoryGroup(() => {
    store.useProjectStore.getState().applySegmentEditCommand({
      kind: "move",
      moves: [
        { segmentId: historyFirst, toTrackId: historyTrack, toStartBeat: 4 },
        { segmentId: historySecond, toTrackId: historyTrack, toStartBeat: 10 },
      ],
    });
    store.useProjectStore.getState().applySegmentEditCommand({
      kind: "fade",
      segmentId: historyFirst,
      fadeInBeats: 1,
      fadeOutBeats: 1,
    });
  });
  assert.equal(
    store.useProjectStore.temporal.getState().pastStates.length,
    1,
    "grouped project history should record one undo step for multiple writes",
  );
  store.undo();
  project = store.useProjectStore.getState().project;
  let groupedFirst = project.tracks[0].segments.find((segment) => segment.id === historyFirst);
  let groupedSecond = project.tracks[0].segments.find((segment) => segment.id === historySecond);
  assert.ok(groupedFirst && groupedSecond, "grouped undo targets should still exist");
  assert.equal(groupedFirst.startBeat, 2, "grouped undo should restore first segment start");
  assert.equal(groupedSecond.startBeat, 8, "grouped undo should restore second segment start");
  assert.equal(groupedFirst.fadeInBeats, undefined, "grouped undo should restore pre-group fade state");
  store.redo();
  project = store.useProjectStore.getState().project;
  groupedFirst = project.tracks[0].segments.find((segment) => segment.id === historyFirst);
  groupedSecond = project.tracks[0].segments.find((segment) => segment.id === historySecond);
  assert.ok(groupedFirst && groupedSecond, "grouped redo targets should still exist");
  assert.equal(groupedFirst.startBeat, 4, "grouped redo should restore first segment move");
  assert.equal(groupedSecond.startBeat, 10, "grouped redo should restore second segment move");
  assert.equal(groupedFirst.fadeInBeats, 1, "grouped redo should restore grouped fade edit");

  store.useProjectStore.getState().loadProject(store.createEmptyProject());
  store.useProjectStore.temporal.getState().clear();
  const destructiveTrack = store.useProjectStore.getState().project.tracks[0].id;
  const destructiveSegment = store.useProjectStore.getState().addSegment(destructiveTrack, {
    name: "Destructive Undo Guard",
    startBeat: 2,
    lengthBeats: 2,
    payload: { kind: "midi", notes: [{ pitch: 72, velocity: 100, startBeat: 0, lengthBeats: 1 }] },
  });
  assert.equal(store.nextUndoRequiresConfirmation(), true, "undo that removes newly created content should require confirmation");
  assert.equal(store.undo(), false, "plain undo should refuse destructive removal");
  project = store.useProjectStore.getState().project;
  assert.ok(
    project.tracks[0].segments.some((segment) => segment.id === destructiveSegment),
    "refused destructive undo should keep new content",
  );
  assert.equal(store.undo({ allowDestructive: true }), true, "confirmed undo should allow destructive removal");
  project = store.useProjectStore.getState().project;
  assert.equal(
    project.tracks[0].segments.some((segment) => segment.id === destructiveSegment),
    false,
    "confirmed destructive undo should remove newly created content",
  );

  assert.equal(geometry.beatToTimelineX(12.5, 48), 600, "beat-to-pixel timeline conversion should honor zoom");
  assert.equal(geometry.timelineXToBeat(600, 48), 12.5, "pixel-to-beat timeline conversion should round-trip");
  assert.equal(geometry.timelineContentWidth(64, 32), 2048, "timeline content width should derive from project length");
  assert.deepEqual(
    geometry.normalizedTimelineRect(80, 200, 20, 100),
    { left: 20, top: 100, right: 80, bottom: 200 },
    "marquee rect normalization should be direction-independent",
  );
  assert.ok(
    geometry.rectsOverlap(
      { left: 20, top: 10, right: 100, bottom: 40 },
      { left: 100, top: 20, right: 120, bottom: 50 },
    ),
    "marquee selection should include edge-touching segments",
  );
  assert.equal(geometry.clampClientYToTimeline(700, 480), 480, "marquee should stop at the timeline ruler zone");
  assert.deepEqual(
    geometry.marqueeStyleFromClientPoints(240, 500, 120, 620, 100, 200, 560),
    { left: 20, top: 300, width: 120, height: 60 },
    "marquee style should account for scroll-container offsets and timeline clamp",
  );
  assert.equal(trackEffects.EFFECT_META.compressor.params.length, 6, "shared effect metadata should include compressor controls");
  assert.equal(
    trackEffects.defaultEffectPointBeat(120, 64),
    2,
    "default effect timepoint should land one second into a 120bpm project",
  );
  assert.equal(
    trackEffects.formatEffectParamValue(1234.4, trackEffects.EFFECT_META.delay.params[0]),
    "1234ms",
    "shared effect formatting should respect parameter units",
  );
  assert.ok(
    trackEffects.normalizeEffectParamValue(200, trackEffects.EFFECT_META.delay.params[0])
      < trackEffects.normalizeEffectParamValue(1000, trackEffects.EFFECT_META.delay.params[0]),
    "log-scaled effect parameters should normalize monotonically",
  );
  assert.deepEqual(
    trackEffects.effectAutomationSelectionKey("track", "effect", "mix", "point"),
    "track:effect:mix:point",
    "effect point selection keys should be stable and domain-specific",
  );
  assert.equal(curves.automationCurveLabel("smoothstep"), "Smoothstep", "curve labels should cover the expanded curve family");
  assert.equal(curves.evaluateAutomationCurve("hold", 0, 1, 0.75), 0, "hold curve should stay at the previous value");
  assert.ok(curves.evaluateAutomationCurve("easeOut", 0, 1, 0.5) > 0.5, "ease-out should move faster than linear at midpoint");
  assert.equal(curves.evaluateAutomationCurve("smoothstep", 0, 1, 0.5), 0.5, "smoothstep midpoint should be centered");

  const uiStore = store.useUiStore.getState();
  uiStore.clearSelection();
  uiStore.selectTrack("track-a");
  assert.deepEqual(store.useUiStore.getState().selectedTrackIds, ["track-a"], "track selection should select the requested track");
  assert.deepEqual(store.useUiStore.getState().selectedSegmentIds, [], "track selection should clear segment selection");
  uiStore.selectTrack("track-b", true);
  assert.deepEqual(
    store.useUiStore.getState().selectedTrackIds,
    ["track-a", "track-b"],
    "additive track selection should keep same-type selections",
  );
  uiStore.selectSegment("segment-a");
  assert.deepEqual(store.useUiStore.getState().selectedTrackIds, [], "segment selection should clear track selection");
  assert.deepEqual(store.useUiStore.getState().selectedSegmentIds, ["segment-a"], "segment selection should select one segment");
  uiStore.selectSegment("segment-b", true);
  assert.deepEqual(
    store.useUiStore.getState().selectedSegmentIds,
    ["segment-a", "segment-b"],
    "additive segment selection should keep same-type selections",
  );
  uiStore.selectTrackEffectAutomationPoint("track-a:effect-a:mix:point-a");
  assert.deepEqual(store.useUiStore.getState().selectedSegmentIds, [], "effect point selection should clear segment selection");
  assert.deepEqual(
    store.useUiStore.getState().selectedTrackEffectAutomationPointKeys,
    ["track-a:effect-a:mix:point-a"],
    "effect point selection should select one point",
  );
  uiStore.selectTrackEffectAutomationPoint("track-a:effect-a:mix:point-b", true);
  assert.deepEqual(
    store.useUiStore.getState().selectedTrackEffectAutomationPointKeys,
    ["track-a:effect-a:mix:point-a", "track-a:effect-a:mix:point-b"],
    "additive effect point selection should keep same-type selections",
  );
  uiStore.clearSelection();
  assert.deepEqual(
    [
      store.useUiStore.getState().selectedTrackIds,
      store.useUiStore.getState().selectedSegmentIds,
      store.useUiStore.getState().selectedTrackEffectAutomationPointKeys,
    ],
    [[], [], []],
    "clear selection should empty every selection domain",
  );

  store.useProjectStore.getState().loadProject(store.createEmptyProject());
  store.useProjectStore.getState().setLengthBeats(256);
  store.useProjectStore.temporal.getState().clear();
  const stressTrackIds = [store.useProjectStore.getState().project.tracks[0].id];
  for (let trackIndex = 1; trackIndex < 10; trackIndex++) {
    stressTrackIds.push(store.useProjectStore.getState().addTrack({
      name: `Dense MIDI ${trackIndex + 1}`,
      kind: "midi",
    }));
  }
  const stressSegmentIds = [];
  const notesPerSegment = 100;
  const segmentsPerTrack = 50;
  for (const [trackIndex, trackId] of stressTrackIds.entries()) {
    for (let segmentIndex = 0; segmentIndex < segmentsPerTrack; segmentIndex++) {
      const notes = Array.from({ length: notesPerSegment }, (_, noteIndex) => ({
        pitch: 48 + ((trackIndex * 7 + noteIndex) % 36),
        velocity: 64 + ((segmentIndex + noteIndex) % 48),
        startBeat: (noteIndex % 25) * 0.16,
        lengthBeats: 0.08 + ((noteIndex % 4) * 0.04),
      }));
      stressSegmentIds.push(store.useProjectStore.getState().addSegment(trackId, {
        name: `Dense ${trackIndex + 1}-${segmentIndex + 1}`,
        startBeat: segmentIndex * 4,
        lengthBeats: 4,
        payload: { kind: "midi", notes },
      }));
    }
  }
  project = store.useProjectStore.getState().project;
  assert.equal(project.tracks.length, 10, "dense MIDI stress should create ten tracks");
  assert.equal(
    project.tracks.flatMap((track) => track.segments).length,
    500,
    "dense MIDI stress should create 500 segments",
  );
  assert.equal(
    project.tracks.flatMap((track) =>
      track.segments.flatMap((segment) => segment.payload.kind === "midi" ? segment.payload.notes : []),
    ).length,
    50000,
    "dense MIDI stress should create 50,000 notes",
  );
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "nudge",
    segmentIds: stressSegmentIds,
    deltaBeats: 0.25,
  });
  store.useProjectStore.getState().applySegmentEditCommand({
    kind: "quantize",
    segmentIds: stressSegmentIds,
    gridBeats: 0.25,
  });
  project = store.useProjectStore.getState().project;
  assert.equal(
    project.tracks.flatMap((track) => track.segments).every((segment) =>
      Number.isFinite(segment.startBeat) && segment.startBeat >= 0 && segment.startBeat + segment.lengthBeats <= project.lengthBeats,
    ),
    true,
    "dense MIDI stress edits should keep every segment in finite project bounds",
  );
  assert.equal(
    project.tracks.flatMap((track) =>
      track.segments.flatMap((segment) => segment.payload.kind === "midi" ? segment.payload.notes : []),
    ).length,
    50000,
    "dense MIDI stress edits should preserve note count",
  );
  store.useProjectStore.getState().loadProject(store.createEmptyProject());

  console.log("DAW core edit-command verifier passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
