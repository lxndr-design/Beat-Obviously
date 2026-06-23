#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("..", import.meta.url).pathname;
const outDir = join(tmpdir(), `beat-frontend-interactions-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

try {
  const esbuild = join(repoRoot, "frontend", "node_modules", ".bin", "esbuild");
  execFileSync(
    esbuild,
    [
      join(repoRoot, "frontend/src/testing/interactionRunner.ts"),
      join(repoRoot, "frontend/src/automation/aetherNoteAutomation.ts"),
      join(repoRoot, "frontend/src/automation/aetherArrangementAutomation.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outdir=${outDir}`,
    ],
    { stdio: "inherit" },
  );

  const runner = await import(pathToFileURL(join(outDir, "testing/interactionRunner.js")));
  const noteAutomation = await import(pathToFileURL(join(outDir, "automation/aetherNoteAutomation.js")));
  const arrangementAutomation = await import(pathToFileURL(join(outDir, "automation/aetherArrangementAutomation.js")));

  assert.equal(runner.snapBeat(1.12, 0.25), 1, "snapBeat should snap to nearest grid");
  assert.equal(runner.snapBeat(1.13, 0.25), 1.25, "snapBeat should round upward past the midpoint");

  assert.ok(
    noteAutomation.AETHER_NOTE_AUTOMATION_TARGETS.some((meta) => meta.target === "macro.1"),
    "Aether note automation catalog should expose macro lanes",
  );
  const automationNotes = [
    { pitch: 60, velocity: 100, startBeat: 2, lengthBeats: 1 },
    { pitch: 64, velocity: 100, startBeat: 4, lengthBeats: 2 },
  ];
  const withMacroLane = noteAutomation.upsertMidiNoteAutomationTarget(automationNotes, [0, 1], "macro.1");
  assert.equal(withMacroLane[0].automation[0].target, "macro.1", "macro lane should be attached to selected notes");
  assert.deepEqual(withMacroLane[0].automation[0].points.map((point) => point.beat), [2, 3]);
  assert.deepEqual(withMacroLane[1].automation[0].points.map((point) => point.beat), [4, 6]);
  assert.equal(noteAutomation.selectedMidiNoteAutomationSummary(withMacroLane, [0, 1], "macro.1"), "2/2 notes");
  const movedMacroLane = noteAutomation.offsetMidiNoteAutomation(withMacroLane[0].automation, 3);
  assert.deepEqual(movedMacroLane[0].points.map((point) => point.beat), [5, 6], "note automation points should move with dragged/copied notes");
  assert.equal(noteAutomation.formatAetherNoteAutomationValue("macro.1", 0.73), "73%", "macro value labels should format as percent");
  assert.equal(noteAutomation.formatAetherNoteAutomationValue("amp.pan", -0.25), "-25", "pan value labels should format as signed bipolar values");
  assert.equal(noteAutomation.normalizeAetherNoteAutomationValue("amp.pan", 0), 0.5, "bipolar lane center should normalize to the rail midpoint");
  assert.equal(noteAutomation.denormalizeAetherNoteAutomationValue("amp.pan", 0), -1, "bipolar lane left edge should denormalize to the minimum");
  assert.equal(noteAutomation.denormalizeAetherNoteAutomationValue("amp.pan", 1), 1, "bipolar lane right edge should denormalize to the maximum");
  assert.equal(noteAutomation.denormalizeAetherNoteAutomationValue("macro.1", 0.375), 0.38, "lane drag values should quantize to the target step");
  assert.deepEqual(
    noteAutomation.selectedMidiNoteAutomationValueRange(withMacroLane, [0, 1], "macro.1"),
    { startValue: 0.5, midValue: 0.5, endValue: 0.5, activeCount: 2, midCount: 0 },
    "selected value ranges should average active note lanes",
  );
  const editedMacroLane = noteAutomation.setMidiNoteAutomationTargetValues(withMacroLane, [0, 1], "macro.1", 0.2, 0.92);
  assert.deepEqual(editedMacroLane[0].automation[0].points.map((point) => point.value), [0.2, 0.92]);
  assert.deepEqual(editedMacroLane[1].automation[0].points.map((point) => point.value), [0.2, 0.92]);
  const midpointMacroLane = noteAutomation.setMidiNoteAutomationTargetValues(withMacroLane, [0, 1], "macro.1", 0.2, 0.92, 0.65);
  assert.deepEqual(midpointMacroLane[0].automation[0].points.map((point) => point.beat), [2, 2.5, 3]);
  assert.deepEqual(midpointMacroLane[1].automation[0].points.map((point) => point.beat), [4, 5, 6]);
  assert.deepEqual(midpointMacroLane[0].automation[0].points.map((point) => point.value), [0.2, 0.65, 0.92]);
  assert.deepEqual(
    noteAutomation.selectedMidiNoteAutomationValueRange(midpointMacroLane, [0, 1], "macro.1"),
    { startValue: 0.2, midValue: 0.65, endValue: 0.92, activeCount: 2, midCount: 2 },
    "midpoint lane values should be reported separately for visible multi-point editing",
  );
  assert.equal(noteAutomation.selectedMidiNoteAutomationCurve(midpointMacroLane, [0, 1], "macro.1"), "linear");
  const curvedMacroLane = noteAutomation.setMidiNoteAutomationTargetCurve(midpointMacroLane, [0, 1], "macro.1", "smoothstep");
  assert.deepEqual(
    curvedMacroLane[0].automation[0].points.map((point) => point.curve),
    ["smoothstep", "smoothstep", "smoothstep"],
    "visible lane curve selection should annotate note automation points",
  );
  assert.equal(noteAutomation.selectedMidiNoteAutomationCurve(curvedMacroLane, [0, 1], "macro.1"), "smoothstep");
  const curvedValueEdit = noteAutomation.setMidiNoteAutomationTargetValues(curvedMacroLane, [0], "macro.1", 0.1, 0.9, 0.5);
  assert.deepEqual(
    curvedValueEdit[0].automation[0].points.map((point) => point.curve),
    ["smoothstep", "smoothstep", "smoothstep"],
    "value editing should preserve selected lane curve metadata",
  );
  const clampedPanLane = noteAutomation.setMidiNoteAutomationTargetValues(automationNotes, [0], "amp.pan", -2, 2);
  assert.deepEqual(clampedPanLane[0].automation[0].points.map((point) => point.value), [-1, 1], "bipolar lane values should clamp to their target range");
  const withPitchLane = noteAutomation.upsertMidiNoteAutomationTarget(automationNotes, [0], "pitch");
  assert.equal(withPitchLane[0].curve.length, 2, "pitch automation should use the note pitch-curve path");
  assert.equal(noteAutomation.setMidiNoteAutomationTargetValues(withPitchLane, [0], "pitch", 0.1, 0.9), withPitchLane, "pitch value editing should stay on curve handles");
  const clearedMacroLane = noteAutomation.clearMidiNoteAutomationTarget(withMacroLane, [0], "macro.1");
  assert.equal(clearedMacroLane[0].automation, undefined, "clearing the only lane should remove note automation clutter");
  assert.equal(clearedMacroLane[1].automation[0].target, "macro.1", "clearing one note should not affect other selected lanes");

  assert.ok(
    arrangementAutomation.AETHER_ARRANGEMENT_AUTOMATION_TARGETS.every((meta) => meta.target !== "pitch"),
    "arrangement automation should expose parameter lanes, not the piano-roll pitch lane",
  );
  const automationSegment = {
    id: "seg-auto",
    trackId: "track-a",
    name: "Automation Segment",
    startBeat: 8,
    lengthBeats: 4,
    repeats: 0,
    layer: 0,
    payload: { kind: "midi", notes: [] },
  };
  const withSegmentLane = arrangementAutomation.upsertSegmentAutomationTarget(automationSegment, "macro.1");
  assert.deepEqual(withSegmentLane.automation[0].points.map((point) => point.beat), [0, 4], "segment automation should use segment-local beats");
  assert.equal(arrangementAutomation.segmentAutomationSummary(withSegmentLane, "macro.1"), "1/1 segment");
  assert.equal(arrangementAutomation.segmentAutomationTargetCount(withSegmentLane), 1);
  const editedSegmentLane = arrangementAutomation.setSegmentAutomationTargetValues(withSegmentLane, "macro.1", 0.2, 0.9, 0.55);
  assert.deepEqual(editedSegmentLane.automation[0].points.map((point) => point.beat), [0, 2, 4]);
  assert.deepEqual(editedSegmentLane.automation[0].points.map((point) => point.value), [0.2, 0.55, 0.9]);
  assert.deepEqual(
    arrangementAutomation.segmentAutomationValueRange(editedSegmentLane, "macro.1"),
    { startValue: 0.2, midValue: 0.55, endValue: 0.9, active: true, midCount: 1 },
    "segment automation should report start/mid/end values for the visible editor",
  );
  const curvedSegmentLane = arrangementAutomation.setSegmentAutomationTargetCurve(editedSegmentLane, "macro.1", "smoothstep");
  assert.deepEqual(
    curvedSegmentLane.automation[0].points.map((point) => point.curve),
    ["smoothstep", "smoothstep", "smoothstep"],
    "segment automation curve selection should annotate points",
  );
  assert.equal(arrangementAutomation.segmentAutomationCurve(curvedSegmentLane, "macro.1"), "smoothstep");
  const clampedSegmentPanLane = arrangementAutomation.setSegmentAutomationTargetValues(automationSegment, "amp.pan", -2, 2);
  assert.deepEqual(clampedSegmentPanLane.automation[0].points.map((point) => point.value), [-1, 1], "segment automation should clamp bipolar targets");
  const unclutteredCurveEdit = arrangementAutomation.setSegmentAutomationTargetCurve(automationSegment, "macro.1", "cubic");
  assert.equal(unclutteredCurveEdit.automation, undefined, "curve edits should not create empty segment automation lanes");
  const clippedSegmentLanes = arrangementAutomation.clipSegmentAutomation(curvedSegmentLane.automation, 3);
  assert.deepEqual(clippedSegmentLanes[0].points.map((point) => point.beat), [0, 2], "segment automation should clip points outside the saved segment length");
  const clearedSegmentLane = arrangementAutomation.clearSegmentAutomationTarget(curvedSegmentLane, "macro.1");
  assert.equal(clearedSegmentLane.automation, undefined, "clearing the only segment lane should remove automation clutter");

  assert.deepEqual(
    runner.previewSegmentDrag({
      originStartBeat: 4,
      originLengthBeats: 2,
      pointerDeltaPx: 54,
      beatsToPx: 24,
      projectLengthBeats: 64,
      gridBeats: 0.25,
    }),
    { startBeat: 6.25, deltaBeats: 2.25 },
    "drag preview should convert pixels to snapped beats",
  );

  assert.deepEqual(
    runner.previewSegmentDrag({
      originStartBeat: 63,
      originLengthBeats: 4,
      pointerDeltaPx: 1000,
      beatsToPx: 24,
      projectLengthBeats: 64,
      gridBeats: 0.25,
    }),
    { startBeat: 60, deltaBeats: -3 },
    "drag preview should clamp against project end",
  );

  assert.deepEqual(
    runner.previewSegmentResize({
      edge: "start",
      originStartBeat: 8,
      originLengthBeats: 4,
      pointerDeltaPx: 90,
      beatsToPx: 24,
      projectLengthBeats: 64,
      gridBeats: 0.25,
    }),
    { startBeat: 11.75, lengthBeats: 0.25 },
    "start resize should preserve a minimum segment length",
  );

  assert.deepEqual(
    runner.previewSegmentResize({
      edge: "end",
      originStartBeat: 60,
      originLengthBeats: 2,
      pointerDeltaPx: 400,
      beatsToPx: 24,
      projectLengthBeats: 64,
      gridBeats: 0.25,
    }),
    { startBeat: 60, lengthBeats: 4 },
    "end resize should clamp against project end",
  );

  assert.deepEqual(
    runner.previewSegmentFade({
      edge: "in",
      originFadeInBeats: 0.25,
      originFadeOutBeats: 0.5,
      originLengthBeats: 4,
      pointerDeltaPx: 42,
      beatsToPx: 24,
      gridBeats: 0.25,
    }),
    { fadeInBeats: 2, fadeOutBeats: 0.5 },
    "fade-in handle should grow from the segment head using snapped pointer travel",
  );

  assert.deepEqual(
    runner.previewSegmentFade({
      edge: "out",
      originFadeInBeats: 0.25,
      originFadeOutBeats: 0.5,
      originLengthBeats: 4,
      pointerDeltaPx: -400,
      beatsToPx: 24,
      gridBeats: 0.25,
    }),
    { fadeInBeats: 0.25, fadeOutBeats: 4 },
    "fade-out handle should grow leftward and clamp to segment length",
  );

  assert.deepEqual(
    runner.previewSegmentFade({
      edge: "out",
      originFadeInBeats: 0.25,
      originFadeOutBeats: 0.5,
      originLengthBeats: 4,
      pointerDeltaPx: 18,
      beatsToPx: 24,
      gridBeats: 1,
    }),
    { fadeInBeats: 0.25, fadeOutBeats: 0 },
    "fade handles should snap down to zero when dragged before the grid midpoint",
  );

  assert.deepEqual(
    runner.previewLoopClampDrag({
      marker: "start",
      startBeat: 4,
      endBeat: 8,
      pointerBeat: 9,
      projectLengthBeats: 64,
    }),
    { startBeat: 7.75, endBeat: 8 },
    "start loop clamp should never pass the end clamp",
  );

  assert.deepEqual(
    runner.previewLoopClampDrag({
      marker: "end",
      startBeat: 4,
      endBeat: 8,
      pointerBeat: 2,
      projectLengthBeats: 64,
    }),
    { startBeat: 4, endBeat: 4.25 },
    "end loop clamp should never pass the start clamp",
  );

  assert.deepEqual(
    runner.previewMarqueeFromPointers({
      startClientX: 240,
      startClientY: 620,
      currentClientX: 120,
      currentClientY: 500,
      containerLeft: 100,
      containerTop: 200,
      timelineBottom: 560,
    }),
    {
      left: 120,
      top: 500,
      right: 240,
      bottom: 560,
      style: { left: 20, top: 300, width: 120, height: 60 },
    },
    "marquee preview should clamp to the editable timeline body",
  );

  let selection = runner.clearArrangementSelection();
  selection = runner.selectArrangementItem({ selection, domain: "track", id: "track-a" });
  assert.deepEqual(
    selection,
    {
      selectedTrackIds: ["track-a"],
      selectedSegmentIds: [],
      selectedTrackEffectAutomationPointKeys: [],
    },
    "track click should select tracks and clear other arrangement domains",
  );
  selection = runner.selectArrangementItem({ selection, domain: "segment", id: "segment-a" });
  selection = runner.selectArrangementItem({ selection, domain: "segment", id: "segment-b", additive: true });
  assert.deepEqual(
    selection,
    {
      selectedTrackIds: [],
      selectedSegmentIds: ["segment-a", "segment-b"],
      selectedTrackEffectAutomationPointKeys: [],
    },
    "additive segment click should keep same-domain selections and clear tracks",
  );
  assert.deepEqual(
    runner.contextMenuArrangementItem({ selection, domain: "segment", id: "segment-a" }),
    selection,
    "segment context menu on a selected item should preserve multi-selection",
  );
  assert.deepEqual(
    runner.contextMenuArrangementItem({ selection, domain: "segment", id: "segment-c" }),
    {
      selectedTrackIds: [],
      selectedSegmentIds: ["segment-c"],
      selectedTrackEffectAutomationPointKeys: [],
    },
    "segment context menu on an unselected item should target that segment",
  );
  assert.deepEqual(
    runner.clearArrangementSelection(),
    {
      selectedTrackIds: [],
      selectedSegmentIds: [],
      selectedTrackEffectAutomationPointKeys: [],
    },
    "empty arrangement click should clear every arrangement selection domain",
  );
  selection = runner.selectArrangementItem({ selection, domain: "effect-point", id: "track-a:effect-a:mix:point-a" });
  assert.deepEqual(
    selection,
    {
      selectedTrackIds: [],
      selectedSegmentIds: [],
      selectedTrackEffectAutomationPointKeys: ["track-a:effect-a:mix:point-a"],
    },
    "effect point click should clear segment selection",
  );
  selection = runner.selectArrangementItem({ selection, domain: "effect-point", id: "track-a:effect-a:mix:point-a", additive: true });
  assert.deepEqual(selection, runner.clearArrangementSelection(), "additive click on a selected item should toggle it off");
  selection = runner.selectArrangementItem({ selection: runner.clearArrangementSelection(), domain: "track", id: "track-a" });
  selection = runner.selectArrangementItem({ selection, domain: "track", id: "track-b", additive: true });
  assert.deepEqual(
    runner.contextMenuArrangementItem({ selection, domain: "track", id: "track-a" }),
    {
      selectedTrackIds: ["track-a", "track-b"],
      selectedSegmentIds: [],
      selectedTrackEffectAutomationPointKeys: [],
    },
    "track context menu on a selected row should preserve multi-track selection",
  );
  assert.deepEqual(
    runner.contextMenuArrangementItem({ selection, domain: "track", id: "track-c" }),
    {
      selectedTrackIds: ["track-c"],
      selectedSegmentIds: [],
      selectedTrackEffectAutomationPointKeys: [],
    },
    "track context menu on an unselected row should target that track",
  );

  const audioSegment = (patch) => ({
    id: patch.id,
    trackId: patch.trackId ?? "track-a",
    name: patch.id,
    startBeat: patch.startBeat,
    lengthBeats: patch.lengthBeats,
    repeats: 0,
    layer: 0,
    payload: patch.payload ?? { kind: "audio", audioFileId: `${patch.id}-file`, gainDb: 0 },
  });
  assert.deepEqual(
    runner.previewSelectedCrossfadeCandidate([
      audioSegment({ id: "right", startBeat: 3, lengthBeats: 2 }),
      audioSegment({ id: "left", startBeat: 0, lengthBeats: 4 }),
    ]),
    { firstSegmentId: "left", secondSegmentId: "right", lengthBeats: 1, kind: "overlap" },
    "selected overlapping audio pair should expose an overlap crossfade action",
  );
  assert.deepEqual(
    runner.previewSelectedCrossfadeCandidate([
      audioSegment({ id: "adjacent-left", startBeat: 8, lengthBeats: 2 }),
      audioSegment({ id: "adjacent-right", startBeat: 10, lengthBeats: 2 }),
    ]),
    { firstSegmentId: "adjacent-left", secondSegmentId: "adjacent-right", lengthBeats: 0.25, kind: "adjacent" },
    "selected adjacent audio pair should expose a default paired-fade crossfade action",
  );
  assert.equal(
    runner.previewSelectedCrossfadeCandidate([
      audioSegment({ id: "gap-left", startBeat: 12, lengthBeats: 2 }),
      audioSegment({ id: "gap-right", startBeat: 14.5, lengthBeats: 2 }),
    ]),
    null,
    "gapped audio selections should not expose crossfade",
  );
  assert.equal(
    runner.previewSelectedCrossfadeCandidate([
      audioSegment({ id: "audio", startBeat: 16, lengthBeats: 2 }),
      audioSegment({ id: "midi", startBeat: 17, lengthBeats: 2, payload: { kind: "midi", notes: [] } }),
    ]),
    null,
    "non-audio segment selections should not expose crossfade",
  );
  assert.equal(
    runner.previewSelectedCrossfadeCandidate([
      audioSegment({ id: "track-a-audio", trackId: "track-a", startBeat: 20, lengthBeats: 2 }),
      audioSegment({ id: "track-b-audio", trackId: "track-b", startBeat: 21, lengthBeats: 2 }),
    ]),
    null,
    "cross-track selections should not expose same-lane crossfade",
  );

  assert.equal(runner.shouldCloseModal({ reason: "backdrop", dirty: true }), false);
  assert.equal(runner.shouldCloseModal({ reason: "backdrop", dirty: false }), false);
  assert.equal(runner.shouldCloseModal({ reason: "escape", dirty: true }), false);
  assert.equal(runner.shouldCloseModal({ reason: "escape", dirty: false }), true);
  assert.equal(runner.shouldCloseModal({ reason: "button", dirty: true }), true);

  const aetherPatch = runner.previewRestoreAetherInit().patch;
  const savedPreset = runner.previewSaveAetherPreset({
    name: "  Interaction Lead  ",
    patch: {
      ...aetherPatch,
      name: "Interaction Lead",
      metadata: {
        ...aetherPatch.metadata,
        tags: ["lead", "lead", "interaction"],
      },
    },
    now: 111,
  });
  assert.equal(savedPreset.record.schemaVersion, 1, "saved Aether presets should carry schema version");
  assert.equal(savedPreset.record.kind, "instrument", "saved Aether presets should be instrument presets");
  assert.equal(savedPreset.record.name, "Interaction Lead", "Save As should trim preset names");
  assert.deepEqual(savedPreset.record.tags, ["lead", "interaction"], "Save As should normalize preset tags");
  assert.equal(savedPreset.selectedPresetId, `user:${savedPreset.record.id}`, "Save As should select the new user preset");
  savedPreset.record.patch.name = "Mutated";
  assert.equal(aetherPatch.name, "Init", "saving a preset should clone the patch payload");
  const mixedEraPreset = runner.previewNormalizeAetherPreset({
    id: "mixed-era-aether",
    name: "Mixed Era Aether",
    patch: {
      ...aetherPatch,
      name: "Mixed Era Aether",
      parameters: {
        ...aetherPatch.parameters,
        "osc.a.wavetable": "user.modern",
        "osc.b.enabled": true,
        "osc.b.wavetable": "user.legacy-only",
      },
      metadata: {
        ...aetherPatch.metadata,
        wavemaps: {
          "user.modern": {
            schemaVersion: 1,
            id: "user.modern",
            name: "Modern Current",
            kind: "harmonic-sketch",
            interpolation: "linear",
            morph: 0.12,
            source: { kind: "generated", label: "Modern wavemap" },
            frames: [{ brightness: 0.42, even: 0.2, fold: 0.12, formant: 0.22, notch: 0.1, skew: 0.1, tilt: 0.2, focus: 0.4, phase: 0.1 }],
          },
        },
        customWavetables: {
          "user.modern": {
            name: "Stale Legacy",
            frames: [{ brightness: 0.01, formant: 0.02 }],
          },
          "user.legacy-only": {
            name: "Legacy Only",
            kind: "resynthesized",
            interpolation: "smooth",
            morph: 0.77,
            source: { kind: "imported-audio", label: "Legacy File", path: "/tmp/legacy.wav" },
            frames: [{ brightness: 0.82, even: 0.21, fold: 0.17, formant: 0.69, notch: 0.27, skew: -0.42, tilt: -0.19, focus: 0.58, phase: -0.31, partials: [0.9, 0.7, 0.5] }],
          },
        },
      },
    },
    updatedAt: 225,
  });
  const loadedMixedEraPreset = runner.previewLoadAetherPreset(mixedEraPreset, { preserveName: "Bound Instrument" });
  assert.equal(loadedMixedEraPreset.selectedPresetId, "user:mixed-era-aether", "loading user preset should select that preset");
  assert.equal(loadedMixedEraPreset.patch.name, "Bound Instrument", "loading user preset should preserve bound instrument name when requested");
  assert.equal(loadedMixedEraPreset.patch.metadata.wavemaps["user.modern"].name, "Modern Current", "modern wavemap should win over stale legacy duplicate on load");
  assert.equal(loadedMixedEraPreset.patch.metadata.wavemaps["user.legacy-only"].frames[0].formant, 0.69, "legacy-only wavemap should survive user preset load");
  assert.deepEqual(
    runner.previewDeleteAetherPreset(mixedEraPreset.id, [savedPreset.record, mixedEraPreset]),
    { selectedPresetId: "", presets: [savedPreset.record] },
    "Delete user preset should clear selection and remove only the deleted preset",
  );
  const migratedPreset = runner.previewNormalizeAetherPreset({
    id: "legacy-aether",
    name: "Legacy Aether",
    patch: aetherPatch,
    updatedAt: 222,
  });
  assert.equal(migratedPreset.schemaVersion, 1, "legacy Aether presets should normalize to the current schema");
  assert.equal(migratedPreset.createdAt, 222, "legacy Aether presets should backfill createdAt from updatedAt");
  const restoredInit = runner.previewRestoreAetherInit({ preserveName: "Existing Instrument" });
  assert.equal(restoredInit.selectedPresetId, "factory:factory.init", "Restore Init should select the factory init preset");
  assert.equal(restoredInit.patch.name, "Existing Instrument", "Restore Init should preserve the bound instrument name");
  assert.equal(restoredInit.patch.effects.filters.length, 0, "Restore Init should clear instrument FX");

  const savedFxPreset = runner.previewSaveAetherEffectPreset({
    name: "  Interaction FX  ",
    chain: {
      filters: [
        { id: "sat", kind: "saturator", params: { drive: 44, mix: 80 } },
        { id: "delay", kind: "delay", bypassed: true, params: { timeMs: 420, feedback: 28, mix: 12 } },
      ],
    },
    now: 333,
  });
  assert.equal(savedFxPreset.record.schemaVersion, 1, "saved FX presets should carry schema version");
  assert.equal(savedFxPreset.record.kind, "instrument-fx-chain", "saved FX presets should be instrument FX chains");
  assert.equal(savedFxPreset.record.name, "Interaction FX", "Save FX should trim names");
  assert.deepEqual(savedFxPreset.record.tags, ["aether", "instrument-fx"], "Save FX should tag effect-chain presets");
  assert.equal(savedFxPreset.selectedEffectPresetId, savedFxPreset.record.id, "Save FX should select the new preset");
  const loadedFxPreset = runner.previewLoadAetherEffectPreset(savedFxPreset.record);
  assert.equal(loadedFxPreset.selectedEffectPresetId, savedFxPreset.record.id, "loading FX preset should select that preset");
  assert.equal(loadedFxPreset.chain.filters.length, 2, "loading FX preset should return the full chain");
  assert.equal(loadedFxPreset.chain.filters[0].params.drive, 44, "loading FX preset should preserve effect params");
  const migratedFxPreset = runner.previewLoadAetherEffectPreset({
    id: "legacy-fx",
    name: "Legacy FX",
    chain: { filters: [{ kind: "reverb", params: { mix: 31 } }] },
    updatedAt: 444,
  });
  assert.equal(migratedFxPreset.chain.filters[0].params.mix, 31, "legacy FX presets should preserve authored params");
  assert.equal(migratedFxPreset.chain.filters[0].params.roomSize, 40, "legacy FX presets should fill default params");
  assert.deepEqual(
    runner.previewDeleteAetherEffectPreset(savedFxPreset.record.id, [savedFxPreset.record]),
    { selectedEffectPresetId: "", presets: [] },
    "Delete FX should clear selection and remove the preset from the list",
  );

  const plugin = (id, patch = {}) => ({
    id,
    name: id,
    vendor: "Beat",
    kind: "renderer",
    format: "decent-sampler",
    status: "installed",
    instrumentMode: "rendered-audio",
    description: id,
    capabilities: [],
    ...patch,
  });

  assert.deepEqual(
    runner.previewPluginHydrationMerge({
      factory: [plugin("factory", { factory: true })],
      persisted: [plugin("ds-lorenzo", { sourcePath: "/packs/Lorenzo.dspreset" })],
      current: [plugin("current-session")],
      project: [plugin("project-local"), plugin("ds-lorenzo", { sourcePath: "/packs/Lorenzo.dspreset" })],
    }),
    ["factory", "ds-lorenzo", "current-session", "project-local"],
    "plugin hydration should preserve global DS adapters and dedupe matching project adapters",
  );

  const hydratedPlugins = runner.previewPluginHydrationAdapters({
    factory: [],
    persisted: [
      plugin("stale-ds", {
        kind: "synth",
        format: "decent-sampler",
        instrumentMode: "fallback-aether",
        capabilities: [{ id: "bad", kind: "instrument", label: "Create Aether", realtime: true, offline: true, fallbackMode: "aether" }],
      }),
    ],
    current: [],
    project: [],
  });
  assert.equal(hydratedPlugins[0].kind, "renderer", "DecentSampler plugins should normalize to renderer packages");
  assert.equal(hydratedPlugins[0].instrumentMode, "live-instrument", "DecentSampler plugins should use Beat sampler instruments, not Aether fallback");
  assert.equal(hydratedPlugins[0].capabilities[0].realtime, true, "DecentSampler packages should advertise realtime Beat sampler compatibility");
  assert.equal(hydratedPlugins[0].capabilities[0].fallbackMode, "pass-through", "DecentSampler capabilities should not retain Aether fallback");

  const migratedStalePlugins = runner.previewPluginHydrationAdapters({
    factory: [],
    persisted: [
      plugin("stale-bridge-ds", {
        name: "Lorenzos Drums DecentSampler",
        vendor: "External",
        kind: "synth",
        format: "bridge",
        sourceFileName: "283049_LorenzosDrums_LorenzoWood_v1_DecentSampler.zip",
        instrumentMode: "fallback-aether",
      }),
    ],
    current: [],
    project: [],
  });
  assert.equal(migratedStalePlugins[0].format, "decent-sampler", "stale DecentSampler bridge records should migrate to DS packages");
  assert.equal(migratedStalePlugins[0].kind, "renderer", "stale DecentSampler bridge records should not remain synths");
  assert.equal(migratedStalePlugins[0].instrumentMode, "live-instrument", "stale DecentSampler bridge records should not open the Aether synth path");
  assert.equal(migratedStalePlugins[0].capabilities[0].realtime, true, "migrated DecentSampler adapters should keep realtime sampler capability");

  const dsEffects = runner.previewDecentSamplerEffects({
    name: "Synthetic DS",
    path: "/packs/synthetic.dspreset",
    uiControlDetails: [
      {
        kind: "labeled-knob",
        label: "Tone",
        value: 18000,
        bindings: [{ type: "effect", level: "instrument", parameter: "FX_FILTER_FREQUENCY", position: 0 }],
      },
      {
        kind: "labeled-knob",
        label: "Space",
        value: 0.42,
        bindings: [{ type: "effect", level: "instrument", parameter: "FX_REVERB_WET_LEVEL", position: 1 }],
      },
    ],
    effects: [
      { type: "lowpass_4pl", position: 0, frequency: 22000, resonance: 0.2 },
      { type: "reverb", position: 1, wetLevel: 0, roomSize: 0.85, damping: 0.2 },
    ],
    sampleUrls: [],
    samples: [],
    audioFiles: [],
  });
  assert.equal(dsEffects.length, 2, "DecentSampler effects should map into native Beat instrument FX");
  assert.equal(dsEffects[0].kind, "lowpass", "DecentSampler lowpass should stay lowpass, not synth fallback");
  assert.equal(dsEffects[0].params.cutoffHz, 18000, "bound DS filter control should override static effect frequency");
  assert.equal(dsEffects[1].kind, "reverb", "DecentSampler reverb should stay reverb");
  assert.equal(dsEffects[1].params.mix, 42, "bound DS reverb wet control should map to Beat mix percent");
  assert.equal(dsEffects[1].params.roomSize, 85, "DS room size should map to Beat room percent");

  const dsInstrument = {
    id: "ds-inst",
    name: "Synthetic DS",
    kind: "sampler",
    envelope: { attackMs: 1, decayMs: 80, sustain: 0, releaseMs: 180 },
    knobs: { cutoff: 1, resonance: 0.2, drive: 0, color: 0.5 },
    waveform: "sample",
    sampleIds: [],
    sampleUrls: [],
    sampleMap: [],
    userCreated: true,
    effects: { filters: dsEffects },
    source: { kind: "plugin", label: "Synthetic DS", pluginId: "ds-plugin" },
  };
  assert.deepEqual(
    runner.previewDecentSamplerInstrumentAffordance(dsInstrument, [
      plugin("plain-plugin", { format: "vst3", associatedInstrumentId: "ds-inst" }),
      plugin("ds-plugin", { associatedInstrumentId: "ds-inst" }),
      plugin("other-ds", { associatedInstrumentId: "other-inst" }),
    ]),
    {
      pluginId: "ds-plugin",
      dragPluginIds: [null, "ds-plugin", "other-ds"],
      canEditDsInstrument: true,
    },
    "DS package rows should drag plugin instantiation requests and DS-backed segments should expose plugin editing",
  );
  const dsInstancePatch = runner.previewDecentSamplerInstancePatch(
    dsInstrument,
    plugin("ds-plugin", { associatedInstrumentId: "ds-inst", sourcePath: "/packs/synthetic.dspreset" }),
    "Synthetic DS 2",
  );
  assert.equal(dsInstancePatch.name, "Synthetic DS 2", "DS instance creation should use the requested instance name");
  assert.equal(dsInstancePatch.source.pluginId, "ds-plugin", "DS instances should stay linked to their source plugin");
  assert.equal(
    dsInstancePatch.setId,
    "temporary-ds-instruments",
    "DS instances should appear in the Instanced Instruments section",
  );
  const releaseControl = {
    kind: "labeled-knob",
    label: "Release",
    minValue: 0,
    maxValue: 2,
    value: 0.18,
    bindings: [{ type: "amp", level: "instrument", parameter: "ENV_RELEASE" }],
  };
  assert.deepEqual(
    runner.previewDecentSamplerControlBinding(releaseControl, dsInstrument),
    { value: 0.18, min: 0, max: 2, step: 0.01, targetLabel: "Envelope Release", valueLabel: "180ms" },
    "DS release controls should read from the Beat sampler envelope",
  );
  assert.equal(
    runner.previewDecentSamplerControlPatch(releaseControl, dsInstrument, 0.9).envelope.releaseMs,
    900,
    "DS release controls should patch Beat sampler release milliseconds",
  );
  const filterControl = {
    kind: "labeled-knob",
    label: "Tone",
    minValue: 20,
    maxValue: 22000,
    value: 18000,
    bindings: [{ type: "effect", level: "instrument", parameter: "FX_FILTER_FREQUENCY", position: 0 }],
  };
  assert.equal(
    runner.previewDecentSamplerControlPatch(filterControl, dsInstrument, 1200).effects.filters[0].params.cutoffHz,
    1200,
    "DS filter frequency controls should patch the imported lowpass effect",
  );
  const wetControl = {
    kind: "labeled-knob",
    label: "Space",
    minValue: 0,
    maxValue: 1,
    value: 0.42,
    bindings: [{ type: "effect", level: "instrument", parameter: "FX_REVERB_WET_LEVEL", position: 1 }],
  };
  assert.deepEqual(
    runner.previewDecentSamplerControlBinding(wetControl, dsInstrument),
    { value: 0.42, min: 0, max: 1, step: 0.01, targetLabel: "Reverb Mix", valueLabel: "42%" },
    "DS reverb controls should read from Beat percent params in DS unit range",
  );
  assert.equal(
    runner.previewDecentSamplerControlPatch(wetControl, dsInstrument, 0.64).effects.filters[1].params.mix,
    64,
    "DS reverb wet controls should patch Beat reverb mix percent",
  );
  const ampControl = {
    kind: "labeled-knob",
    label: "Volume",
    minValue: 0,
    maxValue: 1,
    value: 1,
    bindings: [{ type: "amp", level: "group", parameter: "AMP_VOLUME" }],
  };
  assert.equal(
    runner.previewDecentSamplerControlPatch(ampControl, dsInstrument, 0.72).ampLevel,
    0.72,
    "DS amp volume controls should patch Beat sampler amp level",
  );

  console.log("Frontend interaction runner verifier passed.");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
