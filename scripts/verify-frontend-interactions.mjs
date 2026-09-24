#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
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
      join(repoRoot, "frontend/src/features/MidiEditor/pianoRollInteraction.ts"),
      join(repoRoot, "frontend/src/features/MidiEditor/midiNoteRounding.ts"),
      join(repoRoot, "frontend/src/features/MidiEditor/midiNoteSubdivision.ts"),
      join(repoRoot, "frontend/src/features/MidiEditor/midiPreviewScheduling.ts"),
      join(repoRoot, "frontend/src/state/midiNoteGroups.ts"),
      join(repoRoot, "frontend/src/features/SegmentEditor/midiLiveRecording.ts"),
      join(repoRoot, "frontend/src/state/audioSegmentTuning.ts"),
      join(repoRoot, "frontend/src/features/DrumEditor/drumGridSelection.ts"),
      join(repoRoot, "frontend/src/automation/aetherNoteAutomation.ts"),
      join(repoRoot, "frontend/src/automation/aetherArrangementAutomation.ts"),
      join(repoRoot, "frontend/src/automation/aetherAutomationConflicts.ts"),
      join(repoRoot, "frontend/src/state/components.ts"),
      join(repoRoot, "frontend/src/features/NodeInstrumentEditor/nodeGraph.ts"),
      join(repoRoot, "frontend/src/solid-ui/FloatingSelect/floatingSelectKeyboard.ts"),
      join(repoRoot, "frontend/src/solid-ui/AppDialog/state.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outdir=${outDir}`,
    ],
    { stdio: "inherit" },
  );

  const runner = await import(pathToFileURL(join(outDir, "testing/interactionRunner.js")));
  const midiInteraction = await import(pathToFileURL(join(outDir, "features/MidiEditor/pianoRollInteraction.js")));
  const midiNoteRounding = await import(pathToFileURL(join(outDir, "features/MidiEditor/midiNoteRounding.js")));
  const midiNoteSubdivision = await import(pathToFileURL(join(outDir, "features/MidiEditor/midiNoteSubdivision.js")));
  const midiPreviewScheduling = await import(pathToFileURL(join(outDir, "features/MidiEditor/midiPreviewScheduling.js")));
  const midiNoteGroups = await import(pathToFileURL(join(outDir, "state/midiNoteGroups.js")));
  const midiLiveRecording = await import(pathToFileURL(join(outDir, "features/SegmentEditor/midiLiveRecording.js")));
  const audioSegmentTuning = await import(pathToFileURL(join(outDir, "state/audioSegmentTuning.js")));
  const drumGridSelection = await import(pathToFileURL(join(outDir, "features/DrumEditor/drumGridSelection.js")));
  const noteAutomation = await import(pathToFileURL(join(outDir, "automation/aetherNoteAutomation.js")));
  const arrangementAutomation = await import(pathToFileURL(join(outDir, "automation/aetherArrangementAutomation.js")));
  const automationConflicts = await import(pathToFileURL(join(outDir, "automation/aetherAutomationConflicts.js")));
  const componentState = await import(pathToFileURL(join(outDir, "state/components.js")));
  const nodeGraph = await import(pathToFileURL(join(outDir, "features/NodeInstrumentEditor/nodeGraph.js")));
  const floatingSelectKeyboard = await import(pathToFileURL(join(outDir, "solid-ui/FloatingSelect/floatingSelectKeyboard.js")));
  const appDialogState = await import(pathToFileURL(join(outDir, "solid-ui/AppDialog/state.js")));
  const pianoRollSource = readFileSync(join(repoRoot, "frontend/src/features/MidiEditor/PianoRoll.solid.tsx"), "utf8");
  const pianoRollCss = readFileSync(join(repoRoot, "frontend/src/features/MidiEditor/PianoRoll.module.css"), "utf8");
  const midiTransportSource = readFileSync(join(repoRoot, "frontend/src/features/MidiEditor/MidiTransport.solid.tsx"), "utf8");
  const timelineMidiPlaybackSource = readFileSync(join(repoRoot, "frontend/src/audio/TimelineMidiPlayback.solid.tsx"), "utf8");
  const segmentEventCompilerSource = readFileSync(join(repoRoot, "frontend/src/state/segmentEventCompiler.ts"), "utf8");
  const segmentEditorSource = readFileSync(join(repoRoot, "frontend/src/features/SegmentEditor/SegmentEditorModal.solid.tsx"), "utf8");
  const segmentColorsSource = readFileSync(join(repoRoot, "frontend/src/features/SegmentEditor/segmentColors.ts"), "utf8");
  const segmentSource = readFileSync(join(repoRoot, "frontend/src/features/Tracks/Segment.solid.tsx"), "utf8");
  const segmentCss = readFileSync(join(repoRoot, "frontend/src/features/Tracks/Segment.module.css"), "utf8");
  const trackLaneCss = readFileSync(join(repoRoot, "frontend/src/features/Tracks/TrackLane.module.css"), "utf8");
  const audioSegmentTransportSource = readFileSync(join(repoRoot, "frontend/src/features/SegmentEditor/AudioSegmentTransport.solid.tsx"), "utf8");
  const segmentLoopControlSource = readFileSync(join(repoRoot, "frontend/src/features/SegmentEditor/SegmentLoopControl.solid.tsx"), "utf8");
  const numberInputSource = readFileSync(join(repoRoot, "frontend/src/solid-ui/NumberInput/NumberInput.solid.tsx"), "utf8");
  const drumpadEditorSource = readFileSync(join(repoRoot, "frontend/src/features/DrumpadEditor/DrumpadEditorModal.solid.tsx"), "utf8");
  const drumpadEditorCss = readFileSync(join(repoRoot, "frontend/src/features/DrumpadEditor/DrumpadEditorModal.module.css"), "utf8");
  const preferencesSource = readFileSync(join(repoRoot, "frontend/src/features/Preferences/PreferencesModal.solid.tsx"), "utf8");
  const themeTokensSource = readFileSync(join(repoRoot, "frontend/src/design/tokens.css"), "utf8");
  const frontendIndexSource = readFileSync(join(repoRoot, "frontend/index.html"), "utf8");
  const ipcSchemaSource = readFileSync(join(repoRoot, "frontend/src/ipc/schema.ts"), "utf8");
  const ipcBridgeSource = readFileSync(join(repoRoot, "frontend/src/ipc/bridge.ts"), "utf8");
  const ipcBackendSchemaSource = readFileSync(join(repoRoot, "backend/Source/Ipc/Schema.h"), "utf8");
  const ipcBackendBridgeSource = readFileSync(join(repoRoot, "backend/Source/Ipc/MessageBridge.cpp"), "utf8");
  const nativeMainSource = readFileSync(join(repoRoot, "backend/Source/Main.cpp"), "utf8");
  const mainComponentSource = readFileSync(join(repoRoot, "backend/Source/MainComponent.cpp"), "utf8");
  const audioEngineHeaderSource = readFileSync(join(repoRoot, "backend/Source/Audio/AudioEngine.h"), "utf8");
  const audioEngineSource = readFileSync(join(repoRoot, "backend/Source/Audio/AudioEngine.cpp"), "utf8");
  const trackDetailsSource = readFileSync(join(repoRoot, "frontend/src/features/TrackDetails/TrackDetailsModal.solid.tsx"), "utf8");
  const trackAutomationEditorSource = readFileSync(join(repoRoot, "frontend/src/features/TrackAutomation/TrackAutomationEditor.solid.tsx"), "utf8");
  const trackAutomationEditorCss = readFileSync(join(repoRoot, "frontend/src/features/TrackAutomation/TrackAutomationEditor.module.css"), "utf8");
  const hotkeysSource = readFileSync(join(repoRoot, "frontend/src/hotkeys/hotkeys.ts"), "utf8");
  const trackHeaderSource = readFileSync(join(repoRoot, "frontend/src/features/Tracks/TrackHeader.solid.tsx"), "utf8");
  const homeHubSource = readFileSync(join(repoRoot, "frontend/src/features/HomeHub/HomeHub.solid.tsx"), "utf8");
  const homeHubCss = readFileSync(join(repoRoot, "frontend/src/features/HomeHub/HomeHub.module.css"), "utf8");
  const audioFilesSource = readFileSync(join(repoRoot, "frontend/src/features/HomeHub/AudioFilesPage.solid.tsx"), "utf8");
  const assetReferenceGraphSource = readFileSync(join(repoRoot, "frontend/src/persistence/assetReferenceGraph.ts"), "utf8");
  const documentActionsSource = readFileSync(join(repoRoot, "frontend/src/persistence/documentActions.ts"), "utf8");
  const appDialogSource = readFileSync(join(repoRoot, "frontend/src/solid-ui/AppDialog/AppDialog.solid.tsx"), "utf8");
  const beatDocumentSource = readFileSync(join(repoRoot, "frontend/src/persistence/beatDocument.ts"), "utf8");
  const effectStateSource = readFileSync(join(repoRoot, "frontend/src/state/effects.ts"), "utf8");
  const trackEffectRowsSource = readFileSync(join(repoRoot, "frontend/src/features/Tracks/TrackEffectRows.solid.tsx"), "utf8");
  const timepointLaneSource = readFileSync(join(repoRoot, "frontend/src/features/Tracks/TimepointLane.solid.tsx"), "utf8");
  const appSource = readFileSync(join(repoRoot, "frontend/src/App.solid.tsx"), "utf8");
  const appMenuSource = readFileSync(join(repoRoot, "frontend/src/features/TopBar/AppMenuButton.solid.tsx"), "utf8");
  const sidebarSource = readFileSync(join(repoRoot, "frontend/src/features/Sidebar/Sidebar.solid.tsx"), "utf8");
  const editorHostSource = readFileSync(join(repoRoot, "frontend/src/features/EditorHost/EditorHost.solid.tsx"), "utf8");
  const mixerPanelSource = readFileSync(join(repoRoot, "frontend/src/features/Mixer/MixerPanel.solid.tsx"), "utf8");
  const storeSource = readFileSync(join(repoRoot, "frontend/src/state/store.ts"), "utf8");
  const typesSource = readFileSync(join(repoRoot, "frontend/src/state/types.ts"), "utf8");
  const taxonomySource = readFileSync(join(repoRoot, "frontend/src/state/instrumentTaxonomy.ts"), "utf8");
  const exportReviewSource = readFileSync(join(repoRoot, "frontend/src/features/ExportReview/ExportReviewModal.solid.tsx"), "utf8");
  const exportActionsSource = readFileSync(join(repoRoot, "frontend/src/features/ExportReview/exportActions.ts"), "utf8");
  const exportStoreSource = readFileSync(join(repoRoot, "frontend/src/state/exportStore.ts"), "utf8");
  const exportJobPanelSource = readFileSync(join(repoRoot, "frontend/src/features/Debug/ExportJobPanel.solid.tsx"), "utf8");
  const projectHealthSource = readFileSync(join(repoRoot, "frontend/src/features/ProjectHealth/ProjectHealthModal.solid.tsx"), "utf8");
  const projectIntegritySource = readFileSync(join(repoRoot, "backend/Source/Persistence/ProjectIntegrityVerifier.cpp"), "utf8");
  const nodeEditorSource = readFileSync(join(repoRoot, "frontend/src/features/NodeInstrumentEditor/NodeInstrumentEditor.solid.tsx"), "utf8");
  const nodeCanvasSource = readFileSync(join(repoRoot, "frontend/src/features/NodeInstrumentEditor/NodeCanvas.solid.tsx"), "utf8");
  const nodeEditorCss = readFileSync(join(repoRoot, "frontend/src/features/NodeInstrumentEditor/NodeInstrumentEditor.module.css"), "utf8");
  const nodeGraphSource = readFileSync(join(repoRoot, "frontend/src/features/NodeInstrumentEditor/nodeGraph.ts"), "utf8");
  const synthPreviewSource = readFileSync(join(repoRoot, "frontend/src/audio/synthPreview.ts"), "utf8");
  const synthEditorSource = readFileSync(join(repoRoot, "frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx"), "utf8");
  const floatingSelectSource = readFileSync(join(repoRoot, "frontend/src/solid-ui/FloatingSelect/FloatingSelect.solid.tsx"), "utf8");
  const toggleSource = readFileSync(join(repoRoot, "frontend/src/solid-ui/Toggle/Toggle.solid.tsx"), "utf8");
  const oscillatorPanelSource = readFileSync(join(repoRoot, "frontend/src/features/Synth/OscillatorPanel/OscillatorPanel.solid.tsx"), "utf8");
  const patternsPageSource = readFileSync(join(repoRoot, "frontend/src/features/HomeHub/PatternsPage.solid.tsx"), "utf8");
  const instrumentsPageSource = readFileSync(join(repoRoot, "frontend/src/features/HomeHub/InstrumentsPage.solid.tsx"), "utf8");
  const instrumentsPageCss = readFileSync(join(repoRoot, "frontend/src/features/HomeHub/InstrumentsPage.module.css"), "utf8");
  const instrumentEditorSource = readFileSync(join(repoRoot, "frontend/src/features/InstrumentEditor/InstrumentEditorModal.solid.tsx"), "utf8");
  const componentLibrarySource = readFileSync(join(repoRoot, "frontend/src/features/ComponentLibrary/ComponentLibraryPanel.solid.tsx"), "utf8");
  const audioFileLibrarySource = readFileSync(join(repoRoot, "frontend/src/features/AudioFiles/AudioFileLibraryPanel.solid.tsx"), "utf8");
  const instrumentLibrarySource = readFileSync(join(repoRoot, "frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx"), "utf8");
  const contextMenuSource = readFileSync(join(repoRoot, "frontend/src/solid-ui/ContextMenu/ContextMenu.solid.tsx"), "utf8");
  const instrumentAccessSource = readFileSync(join(repoRoot, "frontend/src/state/instrumentAccess.ts"), "utf8");
  const trackLaneSource = readFileSync(join(repoRoot, "frontend/src/features/Tracks/TrackLane.solid.tsx"), "utf8");
  const trackListSource = readFileSync(join(repoRoot, "frontend/src/features/Tracks/TrackList.solid.tsx"), "utf8");
  const trackListCss = readFileSync(join(repoRoot, "frontend/src/features/Tracks/TrackList.module.css"), "utf8");
  const trackAutomationRowsSource = readFileSync(join(repoRoot, "frontend/src/features/Tracks/TrackAutomationRows.solid.tsx"), "utf8");
  const trackAutomationRowsCss = readFileSync(join(repoRoot, "frontend/src/features/Tracks/TrackAutomationRows.module.css"), "utf8");
  const timelineSource = readFileSync(join(repoRoot, "frontend/src/features/Tracks/Timeline.solid.tsx"), "utf8");
  const knobSource = readFileSync(join(repoRoot, "frontend/src/solid-ui/Knob/Knob.solid.tsx"), "utf8");
  const audioRecordingModalSource = readFileSync(join(repoRoot, "frontend/src/features/Tracks/AudioRecordingModal.solid.tsx"), "utf8");
  const drumSequencerSource = readFileSync(join(repoRoot, "frontend/src/features/DrumEditor/DrumSequencer.solid.tsx"), "utf8");
  const drumSequencerCss = readFileSync(join(repoRoot, "frontend/src/features/DrumEditor/DrumSequencer.module.css"), "utf8");
  const devHooksSource = readFileSync(join(repoRoot, "frontend/src/testing/devHooks.ts"), "utf8");

  assert.equal(runner.snapBeat(1.12, 0.25), 1, "snapBeat should snap to nearest grid");
  const drumRectangle = drumGridSelection.drumSelectionRectangle(
    ["kick", "snare", "hat"], 8,
    { rowId: "kick", step: 2 },
    { rowId: "snare", step: 4 },
  );
  assert.deepEqual([...drumRectangle], ["kick:2", "kick:3", "kick:4", "snare:2", "snare:3", "snare:4"]);
  assert.deepEqual(
    [...drumGridSelection.mergeDrumSelection(new Set(["hat:0"]), drumRectangle, true)],
    ["hat:0", ...drumRectangle],
    "drum marquee should preserve the base set in additive mode",
  );
  assert.deepEqual(
    [...drumGridSelection.mergeDrumSelection(new Set(["hat:0"]), drumRectangle, false)],
    [...drumRectangle],
    "drum marquee should replace the selection outside additive mode",
  );
  assert.equal(floatingSelectKeyboard.nextFloatingSelectOptionIndex("ArrowDown", -1, 3), 0);
  assert.equal(floatingSelectKeyboard.nextFloatingSelectOptionIndex("ArrowDown", 2, 3), 2);
  assert.equal(floatingSelectKeyboard.nextFloatingSelectOptionIndex("ArrowUp", -1, 3), 2);
  assert.equal(floatingSelectKeyboard.nextFloatingSelectOptionIndex("ArrowUp", 0, 3), 0);
  assert.equal(floatingSelectKeyboard.nextFloatingSelectOptionIndex("Home", 2, 3), 0);
  assert.equal(floatingSelectKeyboard.nextFloatingSelectOptionIndex("End", 0, 3), 2);
  assert.equal(floatingSelectKeyboard.nextFloatingSelectOptionIndex("ArrowDown", 0, 0), null);
  const arpeggioSource = [
    {
      pitch: 60,
      velocity: 80,
      startBeat: 0,
      lengthBeats: 2,
      curve: [{ beat: 0, pitch: 60 }, { beat: 2, pitch: 61 }],
      automation: [
        { target: "pitch", points: [{ beat: 0, value: 60 }, { beat: 2, value: 61 }] },
        { target: "filter.cutoff", points: [{ beat: 0, value: 800 }, { beat: 2, value: 1600 }] },
      ],
    },
    { pitch: 64, velocity: 90, startBeat: 0, lengthBeats: 2 },
    { pitch: 67, velocity: 100, startBeat: 0, lengthBeats: 2 },
  ];
  assert.equal(
    midiNoteGroups.midiSelectionCanArpeggiate(arpeggioSource, [0, 1, 2]),
    true,
    "arpeggiation should be available when the selection contains different pitches",
  );
  const repeatedPitchSource = [
    { pitch: 60, velocity: 80, startBeat: 0, lengthBeats: 1 },
    { pitch: 60, velocity: 90, startBeat: 1, lengthBeats: 1 },
  ];
  assert.equal(
    midiNoteGroups.midiSelectionCanArpeggiate(repeatedPitchSource, [0, 1]),
    false,
    "arpeggiation should be disabled when every selected note has the same pitch",
  );
  const rejectedRepeatedPitchArpeggio = midiNoteGroups.setMidiArpeggiation(
    repeatedPitchSource,
    [0, 1],
    { loops: 2, sequence: "up" },
    "rejected-same-pitch-arp",
  );
  assert.strictEqual(
    rejectedRepeatedPitchArpeggio.notes,
    repeatedPitchSource,
    "same-pitch selections should not acquire an arpeggiation modifier",
  );
  const groupedArpeggio = midiNoteGroups.setMidiArpeggiation(
    arpeggioSource,
    [0, 1, 2],
    { loops: 2, sequence: "up" },
    "test-arp-group",
  );
  assert.deepEqual(groupedArpeggio.indices, [0, 1, 2], "arpeggiation should keep the whole source selection linked");
  assert.deepEqual(
    midiNoteGroups.midiGroupIndices(groupedArpeggio.notes, [1]),
    [0, 1, 2],
    "selecting one linked note should expand to its complete group",
  );
  const renderedArpeggio = midiNoteGroups.renderMidiArpeggiations(groupedArpeggio.notes);
  const sourcePitchSet = new Set(arpeggioSource.map((note) => note.pitch));
  assert.ok(
    renderedArpeggio.every((note) => sourcePitchSet.has(note.pitch)),
    "arpeggiation should never generate a MIDI pitch outside the selected group",
  );
  assert.ok(
    renderedArpeggio.every((note) => note.curve == null && note.automation?.every((lane) => lane.target !== "pitch") !== false),
    "arpeggiation should remove pitch curves and pitch automation that could leave the selected pitch set",
  );
  const rateArpeggio = midiNoteGroups.setMidiArpeggiation(
    arpeggioSource,
    [0, 1, 2],
    { loops: 1, sequence: "up", timingType: "notes-per-beat", noteValue: 16 },
    "test-rate-arp-group",
  );
  const renderedRateArpeggio = midiNoteGroups.renderMidiArpeggiations(rateArpeggio.notes);
  assert.deepEqual(
    renderedRateArpeggio.map((note) => [note.pitch, note.startBeat, note.lengthBeats]),
    [
      [60, 0, 0.25],
      [64, 0.25, 0.25],
      [67, 0.5, 0.25],
      [60, 0.75, 0.25],
      [64, 1, 0.25],
      [67, 1.25, 0.25],
      [60, 1.5, 0.25],
      [64, 1.75, 0.25],
    ],
    "1/16 note timing should repeat only group pitches at quarter-beat intervals",
  );
  assert.deepEqual(
    renderedArpeggio.map((note) => note.pitch),
    [60, 64, 67, 60, 64, 67],
    "two upward arpeggiation loops should repeat the selected pitch sequence",
  );
  assert.ok(
    renderedArpeggio.every((note) => note.groupId == null && note.arpeggiation == null),
    "rendered notes should not leak editor-only group modifiers into the audio engine",
  );
  assert.equal(groupedArpeggio.notes[0].startBeat, 0, "rendering should not rewrite source note placement");
  const withoutArpeggiation = midiNoteGroups.removeMidiArpeggiation(groupedArpeggio.notes, [0]);
  assert.ok(withoutArpeggiation.every((note) => note.groupId === "test-arp-group"), "removing arpeggiation should retain the note group");
  assert.ok(withoutArpeggiation.every((note) => note.arpeggiation == null), "removing arpeggiation should clear the modifier from every group member");
  const ungroupedArpeggio = midiNoteGroups.ungroupMidiNotes(groupedArpeggio.notes, [2]);
  assert.ok(
    ungroupedArpeggio.every((note) => note.groupId == null && note.arpeggiation == null),
    "ungrouping any member should dissolve the group and its nondestructive modifier",
  );
  const pastedArpeggio = midiNoteGroups.remapPastedMidiGroups(groupedArpeggio.notes, () => "pasted-group");
  assert.ok(
    pastedArpeggio.every((note) => note.groupId === "pasted-group"),
    "copied linked notes should stay linked to each other with a fresh group id",
  );
  const renderedProject = midiNoteGroups.projectWithRenderedMidiArpeggiations({
    id: "arp-project",
    name: "Arp project",
    bpm: 120,
    timeSignature: { num: 4, denom: 4, boldBeats: [1] },
    lengthBeats: 8,
    tracks: [{
      id: "track",
      name: "Track",
      kind: "midi",
      gainDb: 0,
      pan: 0,
      mute: false,
      solo: false,
      recordArmed: false,
      inputMonitoring: false,
      sends: [],
      effects: [],
      segments: [{
        id: "segment",
        trackId: "track",
        startBeat: 0,
        lengthBeats: 2,
        payload: { kind: "midi", notes: groupedArpeggio.notes },
      }],
    }],
    returnBuses: [],
    masterEqAutomation: [],
    masterChain: {},
  });
  assert.equal(renderedProject.tracks[0].segments[0].payload.notes.length, 6, "engine projects should expand arpeggiation before playback/export");
  assert.equal(groupedArpeggio.notes.length, 3, "engine expansion should leave the editor project nondestructive");
  componentState.useComponentStore.getState().hydrate([], []);
  const componentFolderId = componentState.useComponentStore.getState().addFolder("Sketches");
  const componentId = componentState.useComponentStore.getState().add({
    name: "Verse",
    notes: [],
    lengthBeats: 4,
  });
  const portableMidiId = componentState.useComponentStore.getState().add({
    kind: "midi",
    name: "Portable expression",
    instrumentId: "legacy-bound-instrument",
    lengthBeats: 4,
    notes: [{
      pitch: 64,
      velocity: 101,
      startBeat: 0,
      lengthBeats: 1,
      frequencyHz: 330,
      sampleZoneId: "legacy-zone",
      samplePath: "/tmp/legacy.wav",
      sampleLabel: "Legacy zone",
      curve: [{ beat: 0.5, pitch: 64.5 }],
      automation: [{ target: "pitch", points: [{ beat: 0.5, value: 0.25 }] }],
    }],
  });
  const portableMidi = componentState.useComponentStore.getState().components.find((component) => component.id === portableMidiId);
  assert.equal(portableMidi?.instrumentId, undefined, "MIDI patterns should not retain an instrument binding");
  assert.equal(portableMidi?.kind === "midi" ? portableMidi.notes[0]?.samplePath : "wrong-kind", undefined, "MIDI patterns should remove sampler-specific note paths");
  assert.equal(portableMidi?.kind === "midi" ? portableMidi.notes[0]?.frequencyHz : -1, undefined, "MIDI patterns should retain pitch identity rather than instrument-specific frequency");
  assert.deepEqual(portableMidi?.kind === "midi" ? portableMidi.notes[0]?.curve : null, [{ beat: 0.5, pitch: 64.5 }], "MIDI patterns should preserve bend curves");
  assert.deepEqual(portableMidi?.kind === "midi" ? portableMidi.notes[0]?.automation : null, [{ target: "pitch", points: [{ beat: 0.5, value: 0.25 }] }], "MIDI patterns should preserve expression automation");
  componentState.useComponentStore.getState().moveToFolder(componentId, componentFolderId);
  assert.equal(
    componentState.useComponentStore.getState().components.find((component) => component.id === componentId)?.folderId,
    componentFolderId,
    "component folders should accept moved components",
  );
  componentState.useComponentStore.getState().renameFolder(componentFolderId, "Ideas");
  assert.equal(
    componentState.useComponentStore.getState().componentFolders.find((folder) => folder.id === componentFolderId)?.name,
    "Ideas",
    "component folders should be renameable",
  );
  componentState.useComponentStore.getState().ungroupFolder(componentFolderId);
  assert.equal(
    componentState.useComponentStore.getState().components.find((component) => component.id === componentId)?.folderId,
    componentState.USER_COMPONENT_FOLDER_ID,
    "ungrouping a component folder should move its contents to User",
  );
  assert.ok(
    componentLibrarySource.includes("<LibraryFolder") && instrumentLibrarySource.includes("<LibraryFolder"),
    "instrument and component libraries should share the LibraryFolder UI and interactions",
  );
  assert.ok(
    audioFilesSource.includes("const AUDIO_PAGE_SIZE = 50")
      && audioFilesSource.includes("<For each={pagedFiles()}")
      && audioFilesSource.includes('aria-label="Audio file pages"'),
    "Audio Files should render a maximum of 50 paged rows with explicit navigation",
  );
  assert.ok(
    audioFilesSource.includes('variant="ghost" selected={selectMode()}')
      && audioFilesSource.includes('kind: "audio.previewData"')
      && audioFilesSource.includes("nativeAudioFilePath(file.path)"),
    "Audio Files should use neutral shared controls and native preview data for local files",
  );
  assert.ok(
    audioFilesSource.includes("nextPreviewFileId !== previousPreviewFileId")
      && audioFilesSource.includes("stopPreview();\n      setPreviewDirection(\"forward\");\n      setScrubbing(false);")
      && audioFilesSource.includes("previewRequestId += 1")
      && audioFilesSource.includes("requestId !== previewRequestId"),
    "Audio Files should stop and reset the preview when selection changes and reject stale async decodes",
  );
  assert.ok(
    audioFilesSource.includes("loadPreferredAnalysis")
      && audioFilesSource.includes("withTimeout(loadBrowserAnalysis(), WAVEFORM_PRIMARY_TIMEOUT_MS")
      && audioFilesSource.includes("return loadNativeAnalysis()")
      && audioFilesSource.includes("WAVEFORM_LOAD_TIMEOUT_MS")
      && audioFilesSource.includes('"Waveform Unavailable"')
      && audioFilesSource.includes("normalizeWaveformChannel"),
    "Audio Files should decode normal waveform previews through the playable-audio path, retain native fallback, and terminate loading visibly",
  );
  assert.ok(
    patternsPageSource.includes('componentKind(component) === "midi" ? "Portable"')
      && patternsPageSource.includes("Notes and expression only"),
    "Patterns should identify instrument-independent MIDI note and expression data",
  );
  assert.ok(
    instrumentsPageSource.includes("INSTRUMENT_FILTER_OPTIONS")
      && instrumentsPageSource.includes("INSTRUMENT_GROUP_OPTIONS")
      && instrumentsPageSource.includes('value: "alphabetical"')
      && instrumentsPageSource.includes('value: "edited-desc"')
      && instrumentsPageSource.includes('value: "usage-desc"')
      && instrumentsPageSource.includes("collapseAllGroups")
      && instrumentsPageSource.includes("expandAllGroups")
      && instrumentsPageSource.includes("collapsedGroups"),
    "Instruments should expose search, filtering, alphabetical/engine grouping, useful sorting, and explicit group controls",
  );
  {
    const timelineContextSource = trackLaneSource.slice(
      trackLaneSource.indexOf("const menu = createContextMenu"),
      trackLaneSource.indexOf("function openSegmentEditor"),
    );
    assert.deepEqual(
      [...timelineContextSource.matchAll(/label:\s*"([^"]+)"/g)].map((match) => match[1]),
      ["Create MIDI", "Create Drum Sequencer", "Create Drumpad"],
      "the empty timeline context menu should expose only the three neutral editable segment types",
    );
    assert.ok(
      !timelineContextSource.includes("Aether")
        && !timelineContextSource.includes("Aurum")
        && !timelineContextSource.includes("Lumen")
        && !timelineContextSource.includes("WAV Segment")
        && !timelineContextSource.includes("Live Record")
        && !timelineContextSource.includes("Paste"),
      "timeline creation should not expose engine-specific, audio, recording, or clipboard entries",
    );
  }
  assert.ok(
    instrumentsPageSource.includes("onDblClick={() => void playPreview(instrument)}")
      && instrumentsPageSource.includes("Double-click to audition")
      && !instrumentsPageSource.includes("styles.rowPlay")
      && !instrumentsPageCss.includes(".rowPlay"),
    "instrument repository rows should audition on double-click without a per-row play button",
  );
  assert.ok(
    instrumentsPageSource.includes("previewLoadingId")
      && instrumentsPageSource.includes("styles.previewSpinner")
      && instrumentsPageSource.includes("await preloadInstrumentSampleUrl(ctx, sampleUrl)")
      && !instrumentsPageSource.includes("await preloadInstrumentSample(ctx, instrument)")
      && instrumentsPageSource.includes("normalizeWaveformSummary")
      && instrumentsPageSource.includes("INSTRUMENT_WAVEFORM_TIMEOUT_MS")
      && instrumentsPageCss.includes("@keyframes instrument-preview-spin")
      && synthPreviewSource.includes('kind: "audio.previewData"')
      && synthPreviewSource.includes("INSTRUMENT_SAMPLE_LOAD_TIMEOUT_MS"),
    "instrument auditions should show bounded loading feedback, decode only the selected sample, and render native sample waveforms",
  );
  assert.ok(
    instrumentLibrarySource.includes("LUMEN_TEST_INSTRUMENT_SET_ID")
      && instrumentLibrarySource.includes("set.id === LUMEN_TEST_INSTRUMENT_SET_ID"),
    "the protected Lumen Test factory group should display with its exact product-testing name",
  );
  assert.ok(
    instrumentLibrarySource.includes('label: "Create Lumen"')
      && !instrumentLibrarySource.includes('label: "Create Aether"')
      && instrumentLibrarySource.includes("userAccessibleInstruments(instruments())")
      && instrumentsPageSource.includes("isLegacyAetherInstrument(instrument)")
      && instrumentAccessSource.includes("Aether remains readable by the audio engine")
      && instrumentAccessSource.includes("isLegacyAetherInstrument")
      && instrumentAccessSource.includes("isLumenInstrument"),
    "Aether should remain playback-compatible but be absent from user creation and browsing surfaces",
  );
  assert.ok(
    ['kind: "audio.listDevices"', 'kind: "audio.selectInputDevice"', 'kind: "recording.plan"', 'kind: "recording.prepare"', 'kind: "recording.start"', 'kind: "recording.stop"', 'kind: "recording.commitTake"']
      .every((request) => audioRecordingModalSource.includes(request))
      && audioRecordingModalSource.includes("Recorded Takes")
      && audioRecordingModalSource.includes("props.onToggleTake")
      && audioRecordingModalSource.includes("Bluetooth")
      && audioRecordingModalSource.includes("ensureNativeInputReady")
      && trackLaneSource.includes("segment().recordingGroupId")
      && trackListSource.includes("recordingTakeNumber")
      && trackListSource.includes("muted: !enabled")
      && storeSource.includes("updateRecordingInput")
      && storeSource.includes("recordingGroups")
      && typesSource.includes("recordingGroupId?: Id"),
    "Live Record should use native microphone capture, enumerate connected inputs, and retain reopenable layered takes per segment",
  );
  assert.equal(runner.snapBeat(1.13, 0.25), 1.25, "snapBeat should round upward past the midpoint");
  assert.deepEqual(
    midiInteraction.midiNoteSelectionAfterPointerDown({ selectedIndices: [], noteIndex: 1, additive: false }),
    [1],
    "MIDI note click should select the pressed note",
  );
  assert.deepEqual(
    midiInteraction.midiNoteSelectionAfterPointerDown({ selectedIndices: [0, 2], noteIndex: 2, additive: false }),
    [0, 2],
    "MIDI note click on an already-selected note should preserve multi-selection for dragging",
  );
  assert.deepEqual(
    midiInteraction.midiNoteSelectionAfterPointerDown({ selectedIndices: [0], noteIndex: 2, additive: true }),
    [0, 2],
    "MIDI note additive selection should extend the selection",
  );
  assert.deepEqual(
    midiInteraction.midiNoteSelectionForContextMenu([0, 2], 2),
    [0, 2],
    "MIDI context-click on an already-selected note should preserve the full selection",
  );
  assert.deepEqual(
    midiInteraction.midiNoteSelectionForContextMenu([0, 2], 1),
    [1],
    "MIDI context-click outside the selection should target only the clicked note",
  );
  assert.equal(
    midiInteraction.midiNotePointerRequestsContextMenu({ button: 0, ctrlKey: true }),
    true,
    "macOS control-click should open the MIDI note menu instead of starting a drag",
  );
  assert.equal(
    midiInteraction.midiNotePointerRequestsContextMenu({ button: 2, ctrlKey: false }),
    true,
    "secondary-click should open the MIDI note menu instead of starting a drag",
  );
  assert.equal(
    midiInteraction.midiNotePointerRequestsContextMenu({ button: 0, ctrlKey: false }),
    false,
    "ordinary primary-click should retain MIDI note drag behavior",
  );
  assert.deepEqual(
    midiInteraction.midiNoteDragIndicesForSelection([0, 2], 2),
    [0, 2],
    "MIDI note edits should target the active selection when the pressed note is selected",
  );
  assert.deepEqual(
    midiInteraction.midiNoteDragIndicesForSelection([0, 2], 1),
    [1],
    "MIDI note edits should switch to the pressed note when it is outside the active selection",
  );
  assert.deepEqual(
    midiInteraction.midiNoteSelectionAfterAdditiveClick({ selectedIndices: [0, 2], noteIndex: 2, moved: false }),
    [0],
    "MIDI shift-click should toggle an already-selected note off when no drag occurred",
  );
  assert.deepEqual(
    midiInteraction.midiNoteSelectionAfterAdditiveClick({ selectedIndices: [0, 2], noteIndex: 2, moved: true }),
    [0, 2],
    "MIDI shift-drag should preserve the active multi-selection",
  );
  assert.deepEqual(
    midiInteraction.midiNoteSelectionAfterMarquee({ selectedIndices: [0, 3], marqueeIndices: [1, 3], additive: true }),
    [0, 1, 3],
    "MIDI shift-marquee should add to the existing selection without duplicates",
  );
  assert.equal(
    midiInteraction.midiNotePointerMovedPastThreshold({
      startClientX: 10,
      startClientY: 10,
      currentClientX: 12,
      currentClientY: 10,
      thresholdPx: 3,
    }),
    false,
    "MIDI note pointer jitter below the threshold should not start an edit",
  );
  assert.equal(
    midiInteraction.midiNotePointerMovedPastThreshold({
      startClientX: 10,
      startClientY: 10,
      currentClientX: 13,
      currentClientY: 10,
      thresholdPx: 3,
    }),
    true,
    "MIDI note pointer movement at the threshold should start an edit",
  );
  assert.equal(midiInteraction.midiVisibleGridBeatStep(48), 1, "normal MIDI grid lines should snap shift-drags to whole-beat ticks");
  assert.equal(midiInteraction.midiVisibleGridBeatStep(72), 0.5, "near zoom MIDI grid lines should reveal half-beat ticks");
  assert.equal(midiInteraction.midiVisibleGridBeatStep(120), 0.25, "medium zoom MIDI grid lines should snap shift-drags to quarter-beat ticks");
  assert.equal(midiInteraction.midiVisibleGridBeatStep(180), 0.125, "high zoom MIDI grid lines should reveal eighth-beat ticks");
  assert.equal(midiInteraction.midiVisibleGridBeatStep(240), 0.0625, "close zoom MIDI grid lines should snap shift-drags to sixteenth-beat ticks");
  assert.equal(midiInteraction.midiGridLineKind(0), "bar", "bar boundaries should be strongest");
  assert.equal(midiInteraction.midiGridLineKind(1), "beat", "whole beats should retain a strong divider");
  assert.equal(midiInteraction.midiGridLineKind(0.5), "half", "half beats should retain their own divider weight");
  assert.equal(midiInteraction.midiGridLineKind(0.25), "quarter", "quarter beats should retain their own divider weight");
  assert.equal(midiInteraction.midiGridLineKind(0.125), "eighth", "eighth beats should use a lighter divider");
  assert.equal(midiInteraction.midiGridLineKind(0.0625), "sixteenth", "sixteenth beats should use the lightest divider");
  assert.equal(midiInteraction.snapMidiBeatToVisibleGrid(2.37, 48), 2, "visible-grid snapping should use whole-beat ticks at normal zoom");
  assert.equal(midiInteraction.snapMidiBeatToVisibleGrid(2.37, 120), 2.25, "visible-grid snapping should use quarter-beat ticks at medium zoom");
  assert.equal(midiInteraction.snapMidiBeatToVisibleGrid(2.37, 240), 2.375, "visible-grid snapping should use sixteenth-beat ticks at close zoom");
  assert.ok(
    pianoRollSource.includes("const isSelected = () => selected().includes(i)")
      && pianoRollSource.includes("isSelected() && styles.noteSelected")
      && pianoRollSource.includes("const hoveredSide = () =>")
      && pianoRollSource.includes("const rect = createMemo(() => visibleNoteRect(n))")
      && pianoRollSource.includes("style={noteStyle()}")
      && pianoRollCss.includes("0 0 0 3px var(--color-fg)")
      && pianoRollCss.includes(".noteSelected::after")
      && pianoRollCss.includes("opacity: 0.62")
      && pianoRollSource.includes('const hasAutomation = midiNoteAutomationTargetCount(n) > 0')
      && pianoRollSource.includes('aria-label="Note automation"')
      && pianoRollSource.includes('title="Note automation"')
      && !pianoRollSource.includes("const laneCount = midiNoteAutomationTargetCount(n)")
      && pianoRollCss.includes(".noteAutomationBadge")
      && pianoRollCss.includes("border-radius: 50%")
      && pianoRollCss.includes("background: var(--color-bg)"),
    "piano roll selection should be visibly outlined and automation should use a compact circular note marker",
  );
  assert.ok(
    pianoRollSource.includes('role="listbox"')
      && pianoRollSource.includes('role="option"')
      && pianoRollSource.includes("aria-selected={isSelected()}")
      && pianoRollSource.includes("midiNoteSelectionAfterAdditiveClick")
      && pianoRollSource.includes("midiNoteSelectionAfterMarquee")
      && pianoRollSource.includes('"meta+a"')
      && pianoRollSource.includes('e.key.toLowerCase() === "x"')
      && pianoRollSource.includes("selectPitchRow")
      && pianoRollSource.includes("visibleNoteEntries")
      && pianoRollSource.includes("timelineTicks")
      && pianoRollSource.includes("midiNoteSelectionForContextMenu")
      && pianoRollSource.includes("midiNotePointerRequestsContextMenu"),
    "piano roll selection should expose accessible state, scoped select-all, additive marquee, and selection-preserving context-click behavior",
  );
  assert.ok(
    pianoRollSource.includes("Subdivide notes…")
      && pianoRollSource.includes("subdivideMidiNotes")
      && pianoRollCss.includes(".subdivisionPopover")
      && pianoRollCss.includes(".rowSelected"),
    "MIDI note selections should expose subdivision and full pitch-row selection affordances",
  );
  assert.ok(
    segmentEditorSource.includes("mergePreviewAutomation")
      && segmentEditorSource.includes("localizeAutomation(trackAutomation, -currentDraft.startBeat)")
      && segmentEditorSource.includes("track < segment < note"),
    "isolated MIDI playback should preserve arrangement automation precedence",
  );
  assert.ok(
    segmentEditorSource.includes('aria-label="Instrument segment automation lanes"')
      && segmentEditorSource.includes('ariaLabel="Instrument segment automation curve"')
      && !segmentEditorSource.includes("Aether segment"),
    "segment automation should use engine-neutral wording",
  );
  assert.ok(
    pianoRollSource.includes("const TOP_PITCH = 127")
      && pianoRollSource.includes("const BOTTOM_PITCH = 0")
      && pianoRollSource.includes("highestPitch - lowestPitch + 1 <= visiblePitchCount")
      && pianoRollSource.includes("pitches[Math.floor(pitches.length / 2)]")
      && pianoRollSource.includes("scroll.scrollTop = clamp(noteCenter - VIEW_HEIGHT / 2, 0, maxScrollTop)"),
    "the default piano roll should expose all 128 MIDI pitches and initially center the segment's actual note range",
  );
  assert.ok(
    pianoRollSource.includes('"b",')
      && pianoRollSource.includes('aria-label="Draw notes tool, B"')
      && pianoRollSource.includes('"v",')
      && pianoRollSource.includes('aria-label="Select notes tool, V"')
      && hotkeysSource.includes('const blocksContextualHotkeys = isTextEntryTarget(target) || target?.tagName === "SELECT"')
      && hotkeysSource.includes("!blocksContextualHotkeys && useContextualHotkeyStore.getState().run(combo)"),
    "MIDI editor should map B to draw and V to select with visible tool hints",
  );
  assert.ok(
    pianoRollSource.includes("Create arpeggiation…")
      && pianoRollSource.includes("Remove arpeggiation")
      && pianoRollSource.includes("Ungroup notes")
      && pianoRollSource.includes("midiGroupIndices")
      && pianoRollSource.includes("setMidiArpeggiation")
      && pianoRollSource.includes("midiSelectionCanArpeggiate")
      && pianoRollSource.includes("Select at least two different pitches")
      && pianoRollSource.includes("canGroup={menuSelection.length >= 2}")
      && pianoRollSource.includes("function ArpeggiationPopover(props:")
      && pianoRollSource.includes("open={props.sequenceOpen}")
      && pianoRollSource.includes('label="Type"')
      && pianoRollSource.includes('label="Note value"')
      && pianoRollSource.includes('label="Sequence"')
      && pianoRollSource.includes('label: "Notes per beat"')
      && pianoRollSource.includes("noteAnchoredViewportState")
      && pianoRollSource.includes("target && rollWrapRef.current?.contains(target)")
      && pianoRollSource.includes("rollWrapRef.current?.contains(target)")
      && pianoRollSource.includes("const anchoredNoteMenu = createMemo")
      && pianoRollSource.includes("const anchoredVolumePopover = createMemo")
      && pianoRollSource.includes("const anchoredNoteEditor = createMemo")
      && pianoRollSource.includes("const anchoredArpeggiationPopover = createMemo")
      && pianoRollSource.includes("data-midi-note-group")
      && pianoRollSource.includes("activeArpeggiationPitches")
      && pianoRollSource.includes("renderMidiArpeggiations(props.notes.filter((note) => note.groupId === groupId))")
      && pianoRollSource.includes("activeArpeggiationPitches().get(note.groupId)?.has(note.pitch)")
      && pianoRollSource.includes('aria-label="Arpeggiated note"')
      && pianoRollCss.includes(".noteGroupOutline")
      && pianoRollCss.includes(".noteArpeggiated::before")
      && pianoRollCss.includes("repeating-linear-gradient")
      && pianoRollCss.includes(".noteArpeggiationBadge")
      && pianoRollCss.includes("border: 1px dotted")
      && pianoRollCss.includes("justify-content: flex-start")
      && pianoRollCss.includes("min-height: 24px")
      && pianoRollCss.includes("padding: 0 6px"),
    "piano roll note menus should expose pitch-safe timed arpeggiation, note-anchored popovers, compact left-aligned items, and faint linked-group outlines",
  );
  assert.equal(
    (segmentColorsSource.match(/#[0-9a-f]{6}/gi) ?? []).length,
    24,
    "segment color picker should expose exactly 24 pastel presets",
  );
  assert.ok(
    segmentEditorSource.includes('aria-label="Set segment color"')
      && segmentEditorSource.includes("SEGMENT_PASTEL_COLORS")
      && segmentSource.includes('"--segment-color": liveSeg()?.color')
      && segmentCss.includes(".colored")
      && segmentCss.includes("linear-gradient"),
    "segment editor color presets should persist onto gradient-tinted arrangement segments",
  );
  assert.ok(
    segmentSource.includes("setSegmentLandingGhosts")
      && trackLaneSource.includes("segmentLandingGhosts")
      && trackLaneSource.includes("data-segment-landing-ghost")
      && trackLaneCss.includes(".segmentLandingGhost"),
    "cross-track segment drags should show a target-lane landing ghost from the pending move",
  );
  assert.ok(
    segmentSource.includes('label: "Split Lanes to Tracks"')
      && segmentSource.includes("splitSegmentToLaneTracks(segment.id)"),
    "multi-lane drum and drumpad segments should expose their lane-to-track split command",
  );
  assert.ok(
    trackDetailsSource.includes("<Knob")
      && trackDetailsSource.includes('label="Output bus"')
      && trackDetailsSource.includes("setTrackOutputBus")
      && trackDetailsSource.includes('kind: "audio.listDevices"')
      && trackDetailsSource.includes('label="Input device"')
      && trackDetailsSource.includes('label="Input channels"')
      && !trackDetailsSource.includes('label="Input Device ID"')
      && !trackDetailsSource.includes('label="Channel Start"'),
    "Track Details should provide knob mixing, explicit bus routing, device enumeration, and readable input-channel choices",
  );
  assert.ok(
    floatingSelectSource.includes('"z-index": "calc(var(--z-toast) + 1)"'),
    "floating select option lists should stack above note-editing popovers",
  );
  assert.ok(
    appSource.includes("projectWithCompiledSegmentEvents")
      && midiTransportSource.includes("renderMidiArpeggiations(latest.notes)")
      && timelineMidiPlaybackSource.includes("compileSegmentEvents(seg)")
      && exportActionsSource.includes("projectWithCompiledSegmentEvents"),
    "native playback, browser playback, bounce, and export should consume the shared compiled event list",
  );
  assert.ok(
    pianoRollSource.includes("has: (_target, property) => Reflect.has(props.notes, property)")
      && pianoRollSource.includes("getOwnPropertyDescriptor: (_target, property) => Reflect.getOwnPropertyDescriptor(props.notes, property)"),
    "piano roll note proxy should support array methods such as slice during note drags",
  );
  assert.ok(
    pianoRollSource.includes('window.addEventListener("pointermove", moveDrag, true)')
      && pianoRollSource.includes('window.addEventListener("mousemove", moveDrag, true)')
      && pianoRollSource.includes("function noteMouseDown")
      && pianoRollSource.includes("function noteEditDragHasStarted")
      && pianoRollSource.includes("midiNotePointerMovedPastThreshold")
      && pianoRollSource.includes("snapMidiBeatToVisibleGrid(beat, pxPerBeat())")
      && pianoRollSource.includes("fixedGridStep != null || shiftKey ? snapShiftDrag(beat) : beat")
      && pianoRollSource.includes("const minimumBeatDelta = Math.max")
      && pianoRollSource.includes("const maximumBeatDelta = Math.min")
      && pianoRollSource.includes("const minimumPitchDelta = Math.max")
      && pianoRollSource.includes("const maximumPitchDelta = Math.min")
      && pianoRollSource.includes("const minimumLengthDelta = d.edge")
      && pianoRollSource.includes("const maximumLengthDelta = d.edge")
      && pianoRollSource.includes("data-midi-grid-division={line.kind}")
      && pianoRollCss.includes(".beatLineWhole")
      && pianoRollCss.includes(".beatLineHalf")
      && pianoRollCss.includes(".beatLineQuarter")
      && pianoRollCss.includes(".beatLineEighth")
      && pianoRollCss.includes(".beatLineSixteenth"),
    "piano roll edits should use visible-grid snapping, rigid shared deltas, and retain hierarchical divider weights through sixteenths",
  );
  assert.ok(
    pianoRollSource.includes("e.currentTarget.setPointerCapture(e.pointerId)")
      && pianoRollSource.includes("const valueFromPointer = (slider: HTMLElement, clientX: number)")
      && pianoRollSource.includes("updateValueFromPointer(e.currentTarget, e.clientX)")
      && pianoRollSource.includes('role="slider"')
      && pianoRollSource.includes("onPointerMove={(e) => {")
      && pianoRollSource.includes("e.currentTarget.releasePointerCapture(e.pointerId)")
      && pianoRollSource.includes('window.addEventListener("mousemove", handleMouseMove, true)')
      && pianoRollSource.includes("onMouseDown={handleMouseDown}")
      && pianoRollCss.includes(".volumeSliderThumb")
      && pianoRollCss.includes("grid-template-columns: max-content minmax(108px, 1fr) 36px")
      && pianoRollCss.includes(".volumePopover::before")
      && pianoRollCss.includes(".volumePopover::after")
      && pianoRollCss.includes("background: var(--color-bg)")
      && pianoRollCss.includes("height: 21px")
      && pianoRollCss.includes("width: 9px")
      && pianoRollCss.includes("touch-action: none"),
    "piano roll note volume slider should stay compact while preserving pointer drag handling",
  );
  assert.ok(
    pianoRollSource.includes("function noteAnchoredViewportState<T extends")
      && pianoRollSource.includes("viewportVersion()")
      && pianoRollSource.includes("const x = clientX == null ? rect.width / 2 : clientX - rect.left")
      && pianoRollSource.includes("const anchoredNoteEditor = createMemo")
      && pianoRollSource.includes("state={currentNoteEditor}"),
    "piano roll zoom and scroll should reactively keep note-attached editors anchored to the current note geometry",
  );
  assert.ok(
    pianoRollSource.includes('type="button"')
      && pianoRollSource.includes('data-midi-interactive="true"')
      && pianoRollSource.includes('aria-label={`Drag pitch curve start handle')
      && pianoRollSource.includes('activeEdge={dragActive() && drag.current?.mode === "curve-handle"')
      && pianoRollCss.includes("width: 21px")
      && pianoRollCss.includes(".curveHandle:hover::before")
      && pianoRollCss.includes(".curveHandleActive::before"),
    "piano roll pitch curve handles should be selectable and show hover/active feedback",
  );
  assert.ok(
    segmentEditorSource.indexOf("<MidiTransport") > segmentEditorSource.indexOf('class={styles.midiLiveTransport}')
      && segmentEditorSource.includes("captureSpaceKey")
      && midiTransportSource.includes("function togglePlayback()")
      && midiTransportSource.includes("captureSpaceKey")
      && midiTransportSource.includes('event.key !== " " && event.key !== "Space" && event.key !== "Spacebar"')
      && midiTransportSource.includes("event.stopImmediatePropagation()")
      && !midiTransportSource.includes('register(scopeId, "space", restart'),
    "MIDI segment preview transport should live with record controls and space should only toggle play/pause",
  );
  assert.ok(
    midiTransportSource.includes("function pause()")
      && midiTransportSource.includes("props.state().onPositionChange?.(positionBeat)")
      && !midiTransportSource.includes("function pause() {\n    setPlaying(false);\n    stopPreviewAudio();\n    props.state().onPositionChange?.(null);")
      && midiTransportSource.includes("onCleanup(() => {\n    stopPreviewAudio();\n    props.state().onPositionChange?.(null);"),
    "MIDI preview pause should keep the playhead visible and only clear preview position on cleanup",
  );
  assert.ok(
    midiTransportSource.includes("prepareExclusivePreview()")
      && midiTransportSource.includes("const previewNote = transposeMidiNote(note, transpose)")
      && midiTransportSource.includes("note: previewNote")
      && midiTransportSource.includes("midiPreviewScheduleKey(note, index)")
      && midiTransportSource.includes("stopPreviewAudio();\n        startMs = now"),
    "MIDI editor playback should be exclusive, transpose once, retain duplicate notes, and clean voices at loop boundaries",
  );
  assert.equal(
    midiPreviewScheduling.midiPreviewDelaySeconds(0, 0.01, 0.25, 2),
    0,
    "a beat-zero note should still audition when the first animation frame starts slightly late",
  );
  assert.equal(
    midiPreviewScheduling.midiPreviewDelaySeconds(0, 0.2, 0.25, 2),
    null,
    "the MIDI preview tolerance should not retrigger genuinely old notes",
  );
  assert.equal(
    midiPreviewScheduling.midiPreviewDelaySeconds(0.25, 0, 0.25, 2),
    0.125,
    "notes ahead of the playhead should preserve their exact preview delay",
  );
  assert.ok(
    drumSequencerSource.includes("usesNativePreview()")
      && drumSequencerSource.includes('kind: "engine.previewMidiNote"')
      && drumSequencerSource.includes("prepareExclusivePreview()")
      && drumpadEditorSource.includes("stopPlaybackSession")
      && drumpadEditorSource.includes('kind: "engine.previewMidiNote"'),
    "drum and drumpad segment editors should use exclusive native instrument preview when a project track is available",
  );
  assert.ok(
    drumSequencerSource.includes("isBeatStart(step, props.speed) ? step + 1")
      && drumSequencerSource.includes("drumCellCustomizationSummary(cell)")
      && drumSequencerSource.includes("styles.cellExpressionDot")
      && !drumSequencerSource.includes("styles.cellLean")
      && !drumSequencerSource.includes("styles.cellNote")
      && drumSequencerCss.includes(".cellExpressionDot")
      && drumSequencerCss.includes(".stepCell:hover .cellVolume")
      && !drumSequencerCss.includes("0 0 16px"),
    "drum sequencer cells should keep expression available through one quiet marker instead of persistent pitch, lean, and volume chrome",
  );
  assert.ok(
    segmentEditorSource.includes("<AudioSegmentTransport")
      && segmentEditorSource.includes("file={audioFile()}")
      && audioSegmentTransportSource.includes('kind: "engine.previewAudioSegment"')
      && audioSegmentTransportSource.includes('kind: "engine.stopAudioPreview"')
      && audioSegmentTransportSource.includes('kind: "audio.waveform"')
      && audioSegmentTransportSource.includes("prepareExclusivePreview()")
      && audioSegmentTransportSource.includes("sourceStartBeat() + beat * tuneRate")
      && audioSegmentTransportSource.includes("fadeInBeats")
      && audioSegmentTransportSource.includes("fadeOutBeats")
      && audioSegmentTransportSource.includes("tunePitch: currentPayload.tunePitch")
      && segmentEditorSource.includes('label="Tune to"')
      && segmentEditorSource.includes("AUDIO_TUNE_OPTIONS")
      && segmentSource.includes("audioTunePitchName")
      && segmentSource.includes("styles.tuneMarker")
      && segmentCss.includes(".tuneMarker"),
    "audio segments should expose waveform playback with trim, fades, gain, tune-to pitch, timeline badge, and exclusive native routing",
  );
  assert.equal(audioSegmentTuning.audioTunePitchName(60), "C4", "audio tuning should label MIDI 60 as C4");
  assert.equal(audioSegmentTuning.audioTuneRate(undefined), 1, "untuned audio should preserve original rate");
  assert.equal(audioSegmentTuning.audioTuneRate(60), 1, "C4 should be the explicit neutral tuning reference");
  assert.equal(audioSegmentTuning.audioTuneRate(72), 2, "C5 should tune audio one octave above the C4 reference");
  assert.equal(audioSegmentTuning.audioTuneRate(48), 0.5, "C3 should tune audio one octave below the C4 reference");
  assert.ok(
    drumpadEditorSource.includes("function togglePlayback()")
      && drumpadEditorSource.includes("createInstrumentBufferSource")
      && drumpadEditorSource.includes("auditionLane(lane")
      && drumpadEditorSource.includes("triggerKeyCode(key.code, { record: recording() })")
      && drumpadEditorSource.includes('aria-label={playing() ? "Pause" : "Play"}'),
    "drumpad editor should expose playback and immediate key/hit audition feedback",
  );
  assert.ok(
    drumpadEditorSource.includes("<FloatingSelect")
      && drumpadEditorSource.includes("searchable")
      && drumpadEditorSource.includes('searchPlaceholder="Search instruments"')
      && drumpadEditorSource.includes("onChange={(instrumentId) => changeLaneInstrument(lane.id, instrumentId)}")
      && !drumpadEditorSource.includes("<Select\n                          layout=\"bare\""),
    "drumpad lane instruments should use searchable FloatingSelect controls that update lane instruments",
  );
  assert.ok(
    drumpadEditorSource.includes('"--lane-head-width": `${DRUMPAD_LANE_HEAD_WIDTH_PX}px`')
      && drumpadEditorSource.includes('"--playhead-progress": playheadProgress()')
      && drumpadEditorSource.includes("rect.width - 20 - DRUMPAD_LANE_HEAD_WIDTH_PX")
      && drumpadEditorCss.includes("left: calc(9px + var(--lane-head-width)")
      && drumpadEditorCss.includes("grid-template-columns: var(--lane-head-width) minmax(261px, 1fr)"),
    "drumpad timeline playhead and drag math should start at the end of the lane head column",
  );
  assert.ok(
    drumpadEditorCss.includes("vector-effect: non-scaling-stroke")
      && drumpadEditorCss.includes("color-mix(in srgb, var(--color-fg) 54%, transparent)")
      && drumpadEditorCss.includes("opacity: 0.64"),
    "drumpad keyboard plug links should render as faint non-scaling graph-style connections",
  );
  assert.ok(
    drumpadEditorSource.includes("interface KeyboardLinkFrame")
      && drumpadEditorSource.includes("function measureKeyboardLinks()")
      && drumpadEditorSource.includes("onMount(() => queueMeasureKeyboardLinks())")
      && drumpadEditorSource.includes("pendingNodes = true")
      && drumpadEditorSource.includes('bodyRef.querySelector<HTMLElement>(`[data-drumpad-key="${lane.keyCode}"]`)')
      && drumpadEditorSource.includes('data-drumpad-lane-plug={lane.id}')
      && drumpadEditorSource.includes("<KeyboardLinkLines frame={keyboardLinkFrame()} />")
      && drumpadEditorCss.includes("z-index: 5")
      && drumpadEditorCss.includes("z-index: 7")
      && !drumpadEditorSource.includes("<KeyboardLinkLines laneId="),
    "drumpad keyboard plug links should persistently measure and connect assigned keys to lane plugs",
  );
  assert.ok(
    drumpadEditorSource.includes("keyboardLayoutToggle")
      && drumpadEditorSource.includes('aria-label="Use Apple keyboard layout"')
      && drumpadEditorSource.includes('aria-label="Use Windows keyboard layout"')
      && drumpadEditorCss.includes("width: 39px")
      && drumpadEditorCss.includes("height: 39px")
      && drumpadEditorCss.includes("flex-basis: 45px")
      && drumpadEditorCss.includes("flex-basis: 63px")
      && drumpadEditorCss.includes("flex-basis: 84px")
      && drumpadEditorSource.includes("<MicroButton")
      && drumpadEditorSource.includes("active={lane.muted}")
      && !drumpadEditorSource.includes("Instrument Config")
      && !drumpadEditorSource.includes("Keyboard Setup")
      && !drumpadEditorSource.includes("Change Keyboard"),
    "drumpad keyboard setup chrome should be removed, with compact layout toggles, square alphanumerics, and smaller mute buttons",
  );
  assert.ok(
    drumpadEditorSource.includes("const [trackViewStartBeat, setTrackViewStartBeat]")
      && drumpadEditorSource.includes("const [trackViewLengthBeats, setTrackViewLengthBeats]")
      && drumpadEditorSource.includes("function onTrackWheel(event: WheelEvent)")
      && drumpadEditorSource.includes("event.ctrlKey || event.metaKey")
      && drumpadEditorSource.includes("const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0")
      && drumpadEditorSource.includes("onWheel={onTrackWheel}")
      && drumpadEditorCss.includes("touch-action: pan-x pinch-zoom")
      && !drumpadEditorCss.includes("touch-action: none"),
    "drumpad track should support trackpad pinch zoom and horizontal wheel scrolling instead of blocking gestures",
  );
  assert.ok(
    drumpadEditorSource.includes("DRUMPAD_FINE_TICKS_PER_BEAT = 8")
      && drumpadEditorSource.includes("const trackGridLines = createMemo")
      && drumpadEditorSource.includes('data-kind={line.kind}')
      && drumpadEditorSource.includes("event.shiftKey ? snapBeatToStep(rawPrimaryStart, visibleTickBeatStep()) : rawPrimaryStart")
      && drumpadEditorSource.includes("function alignSelectedHitsToNearestNotch()")
      && drumpadEditorSource.includes("function onTrackKeyDown(event: KeyboardEvent)")
      && drumpadEditorSource.includes("function updateMarqueeSelection(state: MarqueeState)")
      && drumpadEditorCss.includes("clip-path: polygon(0 0, 100% 50%, 0 100%)")
      && drumpadEditorCss.includes(".hit::before")
      && drumpadEditorCss.includes(".hit[data-selected=\"1\"]")
      && drumpadEditorCss.includes(".marquee")
      && drumpadEditorCss.includes(".addInstrumentRow")
      && drumpadEditorCss.includes('.gridLine[data-kind="measure"]')
      && drumpadEditorCss.includes("width: 3px")
      && !drumpadEditorCss.includes("repeating-linear-gradient(\n      to right"),
    "drumpad hits should be fixed stem/triangle handles, with fine tick lines, selected state, marquee selection, align-to-notch, and shift-drag snapping",
  );
  assert.ok(
    preferencesSource.includes('kind: "audio.selectOutputDevice"')
      && preferencesSource.includes('response.ok ? "Output selected"')
      && preferencesSource.includes('"output channel"')
      && preferencesSource.includes('<Show when={dirty()} fallback={<Button variant="primary" onClick={close}>Done</Button>}>')
      && ipcSchemaSource.includes('| { kind: "audio.selectOutputDevice"; typeName?: string; deviceName: string }')
      && ipcSchemaSource.includes('R extends { kind: "audio.selectOutputDevice" } ? { ok: boolean; snapshot: AudioDeviceSnapshot; error?: string }')
      && ipcBridgeSource.includes('case "audio.selectOutputDevice":')
      && ipcBackendSchemaSource.includes('AUDIO_SELECT_OUTPUT_DEVICE = "audio.selectOutputDevice"')
      && ipcBackendBridgeSource.includes("if (kind == AUDIO_SELECT_OUTPUT_DEVICE)")
      && audioEngineHeaderSource.includes("bool selectOutputDevice")
      && audioEngineSource.includes("snapshot.currentOutputName = setup.outputDeviceName")
      && audioEngineSource.includes("setup.outputDeviceName = outputDeviceName")
      && audioEngineSource.includes("setup.useDefaultOutputChannels = true"),
    "preferences output device selection should call native IPC and channel counts should be labeled as channels",
  );
  assert.ok(
    storeSource.includes('export type ThemeMode = "dark" | "light" | "mellow";')
      && storeSource.includes('value === "light" || value === "dark" || value === "mellow"')
      && preferencesSource.includes('ariaLabel="Application color theme"')
      && preferencesSource.includes('{ value: "dark", label: "Dark" }')
      && preferencesSource.includes('{ value: "light", label: "Light" }')
      && preferencesSource.includes('{ value: "mellow", label: "Mellow" }')
      && themeTokensSource.includes('html[data-theme="light"]')
      && themeTokensSource.includes('html[data-theme="mellow"]')
      && themeTokensSource.includes('--color-bg: #4a4a4a;')
      && themeTokensSource.includes('font-family: "Almarai";')
      && themeTokensSource.includes('url("/assets/fonts/almarai-light.ttf")')
      && themeTokensSource.includes('url("/assets/fonts/almarai-regular.ttf")')
      && themeTokensSource.includes('url("/assets/fonts/almarai-bold.ttf")')
      && themeTokensSource.includes('url("/assets/fonts/almarai-extra-bold.ttf")')
      && !themeTokensSource.includes('"Akzidenz Grotesk Next"')
      && frontendIndexSource.includes('storedTheme === "light" || storedTheme === "mellow"')
      && frontendIndexSource.includes('request("app.setTheme", { theme: initialTheme })')
      && frontendIndexSource.includes('font-family: Almarai, Arial, Helvetica, sans-serif;')
      && segmentCss.includes(':global(html[data-theme="light"]) .segment')
      && segmentCss.includes('--segment-neutral-bg: #ffffff;')
      && segmentCss.includes('--segment-neutral-fg: #000000;')
      && ipcSchemaSource.includes('| { kind: "app.setTheme"; theme: "dark" | "light" | "mellow" }')
      && ipcBackendSchemaSource.includes('APP_SET_THEME       = "app.setTheme"')
      && mainComponentSource.includes('if (kind == beat::ipc::kind::APP_SET_THEME)')
      && nativeMainSource.includes('if (normalized == "mellow") return juce::Colour(0xff4a4a4a);')
      && nativeMainSource.includes('g.fillAll(background);')
      && nativeMainSource.includes('persistNativeTheme(normalized);')
      && !pianoRollCss.includes("background: #000"),
    "theme preferences should persist Dark, Light, and Mellow Gray, apply them before render and to native window chrome, and use Almarai for all UI text",
  );
  {
    const sourceNotes = [
      { pitch: 60, startBeat: 0.5, lengthBeats: 0.5, velocity: 100 },
      { pitch: 62, startBeat: 2, lengthBeats: 0.5, velocity: 100 },
    ];
    const committedNotes = [{ pitch: 67, startBeat: 1.25, lengthBeats: 0.25, velocity: 112 }];
    const heldKeys = { a: { pitch: 64, startBeat: 1, startedAtMs: 100 } };
    const liveNotes = midiLiveRecording.composeLiveMidiNotes({
      sourceNotes,
      committedNotes,
      heldKeys,
      currentBeat: 1.75,
    });
    assert.deepEqual(
      liveNotes.map((note) => [note.pitch, note.startBeat, note.lengthBeats]),
      [
        [60, 0.5, 0.5],
        [64, 1, 0.75],
        [67, 1.25, 0.25],
        [62, 2, 0.5],
      ],
      "live MIDI recording should include held-note preview before keyup and extend it to the current beat",
    );
    assert.deepEqual(
      midiLiveRecording.eraseMidiNotesOverlappingSweep(sourceNotes, 0.75, 1.5).map((note) => note.pitch),
      [62],
      "MIDI overwrite sweep should remove only source notes overlapped by the swept playhead interval",
    );
    assert.deepEqual(
      midiLiveRecording.composeLiveMidiNotes({
        sourceNotes: midiLiveRecording.eraseMidiNotesOverlappingSweep(sourceNotes, 0.75, 1.5),
        committedNotes,
        heldKeys: {},
        currentBeat: 1.5,
      }).map((note) => note.pitch),
      [67, 62],
      "MIDI overwrite sweep should preserve notes recorded during the current session",
    );
    assert.ok(
      segmentEditorSource.includes("setMidiLiveSourceNotes(structuredClone(midiNotes()))")
        && segmentEditorSource.includes("sweepMidiLiveOverwriteToBeat(beat)")
        && segmentEditorSource.includes("notes={liveMidiNotes()}")
        && !segmentEditorSource.includes('if (midiLiveMode() === "overwrite") updateMidi([])'),
      "MIDI live recording should preview held notes and avoid whole-clip clearing at overwrite start",
    );
    assert.deepEqual(
      midiLiveRecording.COMPUTER_PIANO_OCTAVES[0].whiteKeys.map((key) => key.label),
      ["Z", "X", "C", "V", "B", "N", "M"],
      "lower computer-piano white keys should use the Z through M row",
    );
    assert.deepEqual(
      midiLiveRecording.COMPUTER_PIANO_OCTAVES[0].blackKeys.filter(Boolean).map((key) => key.label),
      ["S", "D", "G", "H", "J"],
      "lower computer-piano black keys should use S D G H J",
    );
    assert.deepEqual(
      midiLiveRecording.COMPUTER_PIANO_OCTAVES[1].whiteKeys.map((key) => key.label),
      ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
      "upper computer-piano white keys should use the Q through P row",
    );
    assert.deepEqual(
      midiLiveRecording.COMPUTER_PIANO_OCTAVES[1].blackKeys.filter(Boolean).map((key) => key.label),
      ["2", "3", "5", "6", "7", "9", "0"],
      "upper computer-piano black keys should use the number-row accidentals",
    );
    assert.equal(midiLiveRecording.computerPianoPitch("KeyZ"), 60);
    assert.equal(midiLiveRecording.computerPianoPitch("KeyZ", { shiftKey: true }), 72);
    assert.equal(midiLiveRecording.computerPianoPitch("KeyZ", { ctrlKey: true }), 48);
    assert.equal(midiLiveRecording.computerPianoPitch("KeyZ", { shiftKey: true, ctrlKey: true }), 60);
    assert.equal(midiLiveRecording.computerPianoPitch("Digit2"), 73);
    assert.equal(midiLiveRecording.computerPianoPitch("KeyA"), null);
    assert.ok(
      segmentEditorSource.includes("const key = event.code")
        && segmentEditorSource.includes("const pitch = computerPianoPitch(key, event)")
        && segmentEditorSource.includes("const heldKey = midiLiveHeldKeys()[key]"),
      "live MIDI keyup should release the note stored for its physical key regardless of modifier changes",
    );
  }
  {
    const subdivided = midiNoteSubdivision.subdivideMidiNotes([
      {
        pitch: 60,
        startBeat: 1,
        lengthBeats: 2,
        velocity: 96,
        curve: [{ beat: 1, pitch: 60 }, { beat: 3, pitch: 64 }],
        automation: [{ target: "amp.level", points: [{ beat: 1, value: 0.2 }, { beat: 3, value: 0.8 }] }],
        connectToIndex: 1,
      },
      { pitch: 67, startBeat: 3, lengthBeats: 1, velocity: 80 },
    ], [0], 4);
    assert.deepEqual(
      subdivided.notes.slice(0, 4).map((note) => [note.startBeat, note.lengthBeats, note.pitch]),
      [[1, 0.5, 60], [1.5, 0.5, 60], [2, 0.5, 60], [2.5, 0.5, 60]],
      "subdivide should preserve the selected note span as equal consecutive notes",
    );
    assert.equal(subdivided.notes[3].connectToIndex, 4, "the final subdivision should preserve the source note's outgoing connection");
    assert.deepEqual(subdivided.selectedIndices, [0, 1, 2, 3], "all new subdivisions should remain selected");
    assert.equal(subdivided.notes[0].curve[1].pitch, 61, "pitch curves should be interpolated at subdivision boundaries");
  }
  {
    const result = midiNoteRounding.roundMidiNotesToNearest([
      {
        pitch: 60,
        startBeat: 0.06,
        lengthBeats: 0.05,
        velocity: 74,
        curve: [{ beat: 0.06, pitch: 60 }, { beat: 0.11, pitch: 61 }],
        automation: [{ target: "amp.level", points: [{ beat: 0.06, value: 0.2 }, { beat: 0.11, value: 0.8 }] }],
      },
      { pitch: 64, startBeat: 0.19, lengthBeats: 0.5, velocity: 90 },
      { pitch: 67, startBeat: 3.98, lengthBeats: 0.02, velocity: 100 },
    ], 0.125, 4);
    assert.deepEqual(
      result.notes.map((note) => [note.startBeat, note.lengthBeats]),
      [[0, 0.125], [0.25, 0.5], [3.875, 0.125]],
      "round-to-nearest should snap starts, preserve longer notes, and keep the last note inside the segment",
    );
    assert.deepEqual(
      result.notes[0].curve,
      [{ beat: 0, pitch: 60 }, { beat: 0.125, pitch: 61 }],
      "round-to-nearest should keep pitch curves attached to extended notes",
    );
    assert.deepEqual(
      result.notes[0].automation,
      [{ target: "amp.level", points: [{ beat: 0, value: 0.2 }, { beat: 0.05, value: 0.8 }] }],
      "round-to-nearest should shift absolute note automation with its note",
    );
    assert.equal(result.movedNoteCount, 3);
    assert.equal(result.extendedNoteCount, 2);
    assert.ok(
      segmentEditorSource.indexOf("Round to nearest") > segmentEditorSource.indexOf("Additive")
        && segmentEditorSource.includes("Apply to all notes")
        && segmentEditorSource.includes("roundMidiNotesToNearest"),
      "the segment MIDI toolbar should place the round-to-nearest popover action after Additive",
    );
    assert.ok(
      !pianoRollSource.includes("selectionStatus")
        && !pianoRollSource.includes('`${selected().length} selected`')
        && !pianoRollSource.includes('"No selection"')
        && !pianoRollCss.includes(".selectionStatus"),
      "the MIDI editor toolbar should not show an X selected status beside the pointer tool",
    );
    assert.ok(
      pianoRollSource.includes('label="Velocity"')
        && pianoRollSource.includes("maxValue={127}")
        && pianoRollSource.includes('secondaryLabel="Volume"')
        && pianoRollSource.includes("velocityToPercent(Number(currentNoteEditor.value))")
        && pianoRollCss.includes(".volumeSecondaryRow")
        && pianoRollSource.includes("parseVelocityInput"),
      "double-click note editing should expose exact MIDI velocity and its synchronized volume percentage",
    );
  }
  assert.ok(
    trackHeaderSource.includes("leftPeak") && trackHeaderSource.includes("rightPeak"),
    "track headers should render stereo channel meters instead of aggregate-only peak/RMS rows",
  );
  assert.ok(
    taxonomySource.includes("INSTRUMENT_TAXONOMY_OPTIONS")
      && taxonomySource.includes("primary_category_id")
      && taxonomySource.includes("taxonomyAssignmentForInstrumentId")
      && taxonomySource.includes("Unassigned"),
    "instrument taxonomy should expose canonical dropdown options with an unassigned state",
  );
  assert.ok(
    typesSource.includes("InstrumentTaxonomyAssignment")
      && typesSource.includes("taxonomy?: InstrumentTaxonomyAssignment"),
    "instrument types should persist the canonical library taxonomy assignment",
  );
  assert.ok(
    storeSource.includes("normalizeInstrumentTaxonomy")
      && storeSource.includes('instrumentId: "wavetable_synth"')
      && storeSource.includes('instrumentId: "sampler"'),
    "instrument store should normalize taxonomy and seed Aether/sampler defaults",
  );
  assert.ok(
    instrumentsPageSource.includes('label="Category"')
      && instrumentsPageSource.includes('label="Subcategory"')
      && instrumentsPageSource.includes('label="Tags"')
      && instrumentsPageSource.includes("firstInstrumentTaxonomyIdForCategory")
      && instrumentsPageSource.includes("taxonomyAssignmentForInstrumentId")
      && instrumentsPageSource.includes("updateInstrument(activeInstrument()!.id, { taxonomy: instrumentId ? taxonomyAssignmentForInstrumentId(instrumentId) : undefined })")
      && instrumentsPageSource.includes("updateInstrument(activeInstrument()!.id, { taxonomy: value ? taxonomyAssignmentForInstrumentId(value) : undefined })"),
    "instrument organizer preview should expose editable category, subcategory, and tags before advanced details",
  );
  assert.ok(
    instrumentEditorSource.includes('label="Taxonomy Category"')
      && instrumentEditorSource.includes('label="Subcategory"')
      && instrumentEditorSource.includes('label="Tags"')
      && instrumentEditorSource.includes("setDraft({ ...currentDraft(), taxonomy: nextTaxonomy })"),
    "instrument creation/editor modal should expose the same library taxonomy controls",
  );
  assert.ok(
    trackHeaderSource.includes('data-meter-channel="left"') && trackHeaderSource.includes('data-meter-channel="right"'),
    "track header meter lanes should expose stable left/right channel markers",
  );
  assert.ok(
    patternsPageSource.includes("drumPlaybackDurationSeconds(component.lengthBeats, bpm, component.speed, playbackRate)")
      && componentLibrarySource.includes("drumPlaybackDurationBeats(component.lengthBeats, component.speed)")
      && componentLibrarySource.includes("drumPlaybackStepLengthBeats(component.lengthBeats, component.stepCount, component.speed)")
      && drumSequencerSource.includes("drumPlaybackDurationSeconds(props.lengthBeats, props.bpm, props.speed)")
      && drumSequencerSource.includes("drumPlaybackStepLengthBeats(props.lengthBeats, props.stepCount, props.speed)"),
    "beat editor, component preview, and pattern preview should use effective drum playback length",
  );
  assert.ok(
    drumSequencerSource.includes('label="Grid"') && drumSequencerSource.includes('ariaLabel="Drum grid density"'),
    "beat editor should label drum speed as grid density, not playback speed",
  );
  assert.ok(
    drumSequencerSource.includes("drumSelectionRectangle")
      && drumSequencerSource.includes("mergeDrumSelection")
      && drumSequencerSource.includes("onPointerMove={moveCellPointer}")
      && drumSequencerSource.includes("data-drum-cell-row={row.id}")
      && drumSequencerSource.includes("aria-selected={selected}")
      && drumSequencerSource.includes('e.key.toLowerCase() === "a"')
      && drumSequencerSource.includes('e.key === "Escape"'),
    "drum grid should expose rectangular additive selection, pointer tracking, keyboard select-all, and clear-selection",
  );
  assert.ok(
    drumSequencerSource.includes("Math.min(1.5, source.buffer.duration / source.playbackRate.value)")
      && !drumSequencerSource.includes("Math.min(1.5, maxDuration, source.buffer.duration"),
    "beat editor drum samples should be allowed to ring instead of being clipped to the step preview length",
  );
  assert.ok(
    segmentEditorSource.includes("lengthBeats={payload().sourceLengthBeats ?? payload().stepCount}")
      && segmentEditorSource.includes("sourceLengthBeats: nextLength")
      && segmentSource.includes('liveSeg()?.payload.kind === "drum" && newLen < currentDrag.startLen')
      && segmentEventCompilerSource.includes("segment.payload.sourceLengthBeats ?? segment.payload.stepCount")
      && ipcBackendBridgeSource.includes('payload.getProperty("sourceLengthBeats", stepCount)'),
    "drum audition and native playback should preserve source-grid timing while either trim handle clips only the segment end",
  );
  assert.ok(
    drumSequencerSource.includes('aria-label="Remix drum pattern"')
      && drumSequencerSource.includes("remixDrumBeat")
      && !drumSequencerSource.includes('ariaLabel="Generated beat complexity"')
      && !drumSequencerSource.includes('ariaLabel="Generated beat genre"')
      && !drumSequencerSource.includes('aria-label="Rate generated beat'),
    "drum editing should expose one local Remix action without AI generation controls or rating UI",
  );
  assert.ok(
    !instrumentsPageSource.includes('label: "External"')
      && !instrumentsPageSource.includes('label: "Internal"')
      && !instrumentsPageSource.includes("External Sample Reference")
      && instrumentsPageSource.includes('label: "Library"')
      && instrumentsPageSource.includes("renderedFallbackWaveform")
      && instrumentsPageSource.includes("isUsableWaveform(response.waveform)")
      && instrumentsPageSource.includes("waveform.left.upper.length > 0")
      && instrumentsPageSource.includes("wavArrayBufferWaveform")
      && instrumentsPageSource.includes("preloadInstrumentSampleUrl(ctx, sampleUrl)"),
    "Instruments page should use Beat library wording, reject empty native waveform buckets, decode WAV/sample previews, and keep a rendered waveform fallback for sample previews",
  );
  assert.ok(
    sidebarSource.includes('openEditor({ kind: "mixer" })')
      && editorHostSource.includes("MixerPanel")
      && typesSource.includes('{ kind: "mixer" }'),
    "sidebar and editor host should expose the singleton mixer surface",
  );
  assert.ok(
    mixerPanelSource.includes("data-mixer-panel")
      && mixerPanelSource.includes("data-mixer-strip")
      && mixerPanelSource.includes('data-meter-channel="left"')
      && mixerPanelSource.includes('data-meter-channel="right"')
      && mixerPanelSource.includes("updateTrack({ gainDb")
      && mixerPanelSource.includes("updateTrack({ pan")
      && mixerPanelSource.includes("parentTrackId")
      && mixerPanelSource.includes("wouldCreateGroupCycle")
      && mixerPanelSource.includes("openTrackEffects")
      && mixerPanelSource.includes("bounceTrackInPlace")
      && mixerPanelSource.includes("unfreezeBouncedTrack")
      && mixerPanelSource.includes("updateMasterChain")
      && mixerPanelSource.includes("formatRouteLatency"),
    "mixer panel should provide channel strips with stereo meters, fader, pan, cycle-safe output routing, inserts, freeze/unfreeze entrypoints, latency summary, and master gain wiring",
  );
  assert.ok(
    mixerPanelSource.includes("Add Return")
      && mixerPanelSource.includes("data-mixer-return")
      && mixerPanelSource.includes("data-mixer-send")
      && mixerPanelSource.includes("upsertTrackSend")
      && mixerPanelSource.includes("addReturnBusEffect")
      && mixerPanelSource.includes("removeReturnBus"),
    "mixer panel should expose return-bus creation, return strips, send enable/level/pan controls, return inserts, and return removal",
  );
  assert.ok(
    mixerPanelSource.includes("data-mixer-inserts")
      && mixerPanelSource.includes("data-mixer-insert")
      && mixerPanelSource.includes("updateTrackEffect")
      && mixerPanelSource.includes("removeTrackEffect")
      && mixerPanelSource.includes("moveTrackEffect")
      && mixerPanelSource.includes("updateReturnBusEffect")
      && mixerPanelSource.includes("removeReturnBusEffect")
      && mixerPanelSource.includes("moveReturnBusEffect")
      && mixerPanelSource.includes("formatEffectLatency"),
    "mixer panel should expose compact insert bypass, remove, reorder, and latency controls for track and return inserts",
  );
  assert.ok(
    storeSource.includes("updateMasterChain")
      && storeSource.includes("Object.assign(s.project.masterChain, patch)"),
    "project store should expose a focused master-chain patch action for mixer controls",
  );
  assert.ok(
    storeSource.includes("upsertTrackSend")
      && storeSource.includes("removeTrackSend")
      && storeSource.includes("addReturnBus")
      && storeSource.includes("updateReturnBus")
      && storeSource.includes("removeReturnBus")
      && storeSource.includes("addReturnBusEffect"),
    "project store should expose focused return-bus and send editing actions for the mixer",
  );
  assert.ok(
    storeSource.includes("updateTrackEffect")
      && storeSource.includes("removeTrackEffect")
      && storeSource.includes("moveTrackEffect")
      && storeSource.includes("updateReturnBusEffect")
      && storeSource.includes("removeReturnBusEffect")
      && storeSource.includes("moveReturnBusEffect")
      && storeSource.includes("moveArrayItem"),
    "project store should expose focused insert bypass/remove/reorder actions for track and return mixer strips",
  );
  assert.ok(
    !homeHubSource.includes("ProjectAssetsPage") && !homeHubSource.includes("Project Assets"),
    "Home hub should not expose the removed Project Assets one-off page",
  );
  assert.ok(
    homeHubSource.includes('hour: "numeric"')
      && homeHubSource.includes('minute: "2-digit"'),
    "recent project cards should show the actual local last-open date and time",
  );
  assert.ok(
    /\.recentCard\s*\{[^}]*position:\s*relative;/s.test(homeHubCss)
      && /\.recentOpen\s*\{[^}]*width:\s*100%;/s.test(homeHubCss)
      && /\.recentActions\s*\{[^}]*position:\s*absolute;/s.test(homeHubCss)
      && /\.recentRemove\s*\{[^}]*background:\s*transparent;/s.test(homeHubCss),
    "recent project cards should remain a single full-width surface with the remove button overlaid",
  );
  assert.ok(
    homeHubSource.includes("onContextMenu={menu.onContextMenu}")
      && homeHubSource.includes("onMouseDown={menu.onMouseDown}")
      && homeHubSource.includes("onKeyDown={menu.onKeyDown}")
      && contextMenuSource.includes("event.button !== 2")
      && contextMenuSource.includes("event.button === 0 && event.ctrlKey")
      && contextMenuSource.includes('event.key !== "ContextMenu"')
      && contextMenuSource.includes('event.key === "F10" && event.shiftKey')
      && homeHubSource.includes('label: "Reveal in Finder"')
      && homeHubSource.includes('label: "Duplicate Project"')
      && homeHubSource.includes('label: "Remove from Recent"')
      && appSource.includes('kind: "project.duplicateFile"')
      && ipcSchemaSource.includes('kind: "project.duplicateFile"')
      && ipcBackendSchemaSource.includes('PROJECT_DUPLICATE_FILE = "project.duplicateFile"')
      && ipcBackendBridgeSource.includes("if (kind == PROJECT_DUPLICATE_FILE)")
      && ipcBackendBridgeSource.includes('projectObject->setProperty("id", juce::Uuid().toString())')
      && ipcBackendBridgeSource.includes("relocateDocumentSidecarPaths(document, source, destination)")
      && ipcBackendBridgeSource.includes("projectRepo.recordRecentProject(destination, document)"),
    "recent project cards should expose reveal, safe independent duplication, and removal through the shared context menu",
  );
  assert.ok(
    audioFileLibrarySource.includes('label: "New Audio Track"')
      && audioFileLibrarySource.includes('kind: "audio"')
      && audioFileLibrarySource.includes('payload: { kind: "audio", audioFileId: file.id, gainDb: 0 }')
      && componentLibrarySource.includes('label: "New Track"')
      && componentLibrarySource.includes('payload: { kind: "midi", notes: structuredClone(component.notes) }')
      && componentLibrarySource.includes('kind: "drum"')
      && instrumentLibrarySource.includes("onMouseDown={menu.onMouseDown}")
      && trackLaneSource.includes("menu.onMouseDown(event)"),
    "asset rows and timeline targets should expose native-compatible context menus and create correctly typed tracks",
  );
  assert.ok(
    trackEffectRowsSource.includes("Unsupported effect (${kind || \"unknown\"})")
      && trackEffectRowsSource.includes("params: []")
      && effectStateSource.includes(".filter((effect) => effect && typeof effect === \"object\" && isEffectKind")
      && beatDocumentSource.includes("effects: normalizeTrackEffectChain(value.effects)")
      && appSource.includes('writeFrontendDiagnostic("frontend-error"')
      && appSource.includes('window.addEventListener("unhandledrejection", onUnhandledRejection)'),
    "project opening should tolerate unsupported persisted effects and report frontend render failures diagnostically",
  );
  assert.ok(
    trackEffectRowsSource.includes("TimepointHandle")
      && trackEffectRowsSource.includes("effectAutomationBeatFromDrag(point.beat, startClientX, event.clientX")
      && trackEffectRowsSource.includes("window.addEventListener(\"pointermove\"")
      && trackEffectRowsSource.includes("TimepointValuePopover")
      && trackEffectRowsSource.includes("fallbackPoint")
      && trackEffectRowsSource.includes("selectTrackEffectAutomationPoint")
      && timepointLaneSource.includes("onPointerDown={(event) =>")
      && timepointLaneSource.includes("props.onSelect?.(event.shiftKey)")
      && timepointLaneSource.includes("role=\"dialog\"")
      && timepointLaneSource.includes("data-floating-layer"),
    "FX automation points should select on pointer-down, drag by pointer delta, preserve the default anchor, and open an isolated value popover",
  );
  assert.ok(
    trackListSource.includes("[data-track-timepoint-selection-key]")
      && trackListSource.includes("setSelectedTrackEffectAutomationPoints(Array.from(effectPointKeys))")
      && storeSource.includes("setSelectedTrackEffectAutomationPoints"),
    "arrangement marquee should not start from an FX point and should select FX points when drawn across their lane",
  );
  assert.ok(
    segmentLoopControlSource.includes("<Button")
      && segmentLoopControlSource.includes('aria-label="Loop segment"')
      && segmentLoopControlSource.includes("aria-pressed={enabled()}")
      && segmentLoopControlSource.includes('label="Repeats"')
      && segmentLoopControlSource.includes("disabled={!enabled()}")
      && segmentLoopControlSource.includes("enabled() ? 0 : Math.max(1")
      && segmentEditorSource.includes("styles.segmentHeaderRow")
      && segmentEditorSource.indexOf("<SegmentLoopControl") < segmentEditorSource.indexOf('label="Name"')
      && segmentEditorSource.indexOf('label="Name"') < segmentEditorSource.indexOf('label="Instrument"'),
    "the MIDI header should keep Loop, Repeats, Name, color, and Instrument in one compact row",
  );
  assert.ok(
    pianoRollSource.includes("onMount(() => {")
      && pianoRollSource.includes("startLengthBeats: Number(lengthBeats)")
      && pianoRollSource.includes("aria-pressed={toolMode() === \"select\"}")
      && pianoRollCss.includes(':global(html[data-theme="light"]) .noteSelected')
      && pianoRollCss.includes(':global(html[data-theme="light"]) .selectBox')
      && pianoRollCss.includes(':global(html[data-theme="light"]) .toolButtonActive'),
    "MIDI edits should preserve the current viewport, resize from a fixed pointer-down length, and expose unmistakable Light-mode selection",
  );
  assert.ok(
    numberInputSource.indexOf("const raw = event.currentTarget.value")
      < numberInputSource.indexOf("commit(raw)")
      && numberInputSource.indexOf("commit(raw)")
        < numberInputSource.indexOf("setEditing(false)", numberInputSource.indexOf("commit(raw)")),
    "number inputs should capture and commit edited text before releasing their props-sync guard",
  );
  assert.ok(
    trackListSource.indexOf("styles.timelineSpacer") < trackListSource.indexOf("<For each={tracks().map((track) => track.id)}>")
      && trackListSource.includes("styles.timelineDock")
      && trackListSource.includes("<Timeline scrollLeft={horizontalScrollLeft()} />")
      && trackListSource.includes("onScroll={(event) => setHorizontalScrollLeft(event.currentTarget.scrollLeft)}")
      && timelineSource.includes("props.scrollLeft")
      && /\.timelineDock\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s.test(trackListCss)
      && /\.laneWrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-height:\s*100%;/s.test(trackListCss)
      && /\.laneScroll\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;[^}]*flex:\s*1 0 auto;/s.test(trackListCss)
      && /\.zoomFloat\s*\{[^}]*position:\s*absolute;[^}]*top:\s*var\(--space-3\);/s.test(trackListCss),
    "the timeline ruler and zoom controls should remain fixed at the top while the lane viewport fills the track area and keeps its scrollbar at the bottom",
  );
  assert.ok(
    knobSource.includes('activePointerId = event.pointerId')
      && knobSource.includes('window.addEventListener("pointermove", handlePointerMove, true)')
      && knobSource.includes('window.addEventListener("pointercancel", handlePointerEnd, true)')
      && !knobSource.includes("setPointerCapture"),
    "shared knobs should drag through capture-phase window listeners without depending on element pointer capture",
  );
  assert.ok(
    assetReferenceGraphSource.includes("track:${track.id}:segment:${segment.id}:audioFileId")
      && assetReferenceGraphSource.includes("instrument:${instrument.id}:sampleIds:${index}")
      && assetReferenceGraphSource.includes('path.includes("/Assets/sfz/")')
      && assetReferenceGraphSource.includes("buildProjectAssetReferenceRows"),
    "shared asset reference graph should remain available for document repair, packaging, and health flows",
  );
  assert.ok(
    documentActionsSource.includes("force?: boolean")
      && documentActionsSource.includes("!options.force")
      && documentActionsSource.includes("setMissingAssets")
      && documentActionsSource.includes("setIntegrityReport"),
    "document save/open flows should retain forced save support and missing-asset/integrity state updates after removing the one-off page",
  );
  assert.ok(
    documentActionsSource.includes("relinkMissingAssetsBeforeOpen")
      && documentActionsSource.includes("formatMissingAssetRelinkPrompt")
      && documentActionsSource.includes("lastPathHint")
      && documentActionsSource.includes("unresolved.push(asset)")
      && documentActionsSource.includes("replaceBeatDocumentAssetPath(nextDocument, asset.path, result.path)"),
    "document open/recent/restore flows should offer sequential missing-asset relink and preserve unresolved missing assets",
  );
  for (const choice of ["save", "dont-save", "cancel"]) {
    const decision = appDialogState.appSaveConfirm("Save before going Home?");
    const activeDialog = appDialogState.getActiveAppDialog();
    assert.equal(activeDialog?.kind, "save-confirm", "Home save decisions should use the dedicated three-way dialog");
    appDialogState.completeDialog(activeDialog.id, choice);
    assert.equal(await decision, choice, `the Home save dialog should resolve the ${choice} choice`);
  }
  assert.ok(
    documentActionsSource.includes("await appSaveConfirm")
      && documentActionsSource.includes("await saveCurrentDocument() !== \"saved\"")
      && documentActionsSource.includes('if (choice === "cancel") return false')
      && documentActionsSource.includes('if (choice === "save")')
      && appDialogSource.includes("Don't save")
      && appDialogSource.includes('? "Save"'),
    "Home should offer Save, Don't save, and Cancel and only close after a successful save",
  );
  assert.ok(
    appSource.includes('case "native.openProjectFile":')
      && appSource.includes("void openRecentFromHome(event.path)")
      && !appSource.includes("void openRecentDocument(event.path)"),
    "Finder-open events should use the successful Home-open path so a loaded project reveals the arrangement",
  );
  assert.ok(
    audioFilesSource.includes("removeSelectedEntries")
      && audioFilesSource.includes("Delete Files")
      && audioFilesSource.includes("deleteFiles: true")
      && audioFilesSource.includes("Files on disk will not be deleted")
      && audioFilesSource.includes("selectedReferencedAudioFiles")
      && audioFilesSource.includes("audioFileIdUsedByProject")
      && audioFilesSource.includes("audioFileIdUsedByInstrument")
      && audioFilesSource.includes("instrument.sampleIds.includes(fileId)")
      && audioFilesSource.includes("tracks, segments, or instruments")
      && audioFilesSource.includes("Deleting audio files from disk is only available in the native app."),
    "Audio Files page should separate non-destructive library removal from native-only destructive disk deletion and block referenced track/segment/instrument audio IDs",
  );
  assert.ok(
    projectIntegritySource.includes("track.send.bus.missing")
      && projectIntegritySource.includes("track.send.bus.duplicate")
      && projectIntegritySource.includes("track.sends.invalid")
      && projectIntegritySource.includes("returnBuses.invalid")
      && projectIntegritySource.includes("track.freezeSource.source.missing")
      && projectIntegritySource.includes("track.freezeSource.audio.missing")
      && projectHealthSource.includes('code.startsWith("track.send.")')
      && projectHealthSource.includes('code.startsWith("track.freezeSource.")')
      && projectHealthSource.includes('code.startsWith("returnBuses.")'),
    "Project Health should classify backend return-bus/send/freeze routing integrity checks into the routing/stale-id category",
  );
  assert.ok(
    exportReviewSource.includes("exportPresetById")
      && exportReviewSource.includes("runProjectExport")
      && exportReviewSource.includes('label="Use loop range only"')
      && !exportReviewSource.includes("presetGrid"),
    "export review modal should expose one loop-range toggle and launch the shared export runner without scope cards",
  );
  assert.ok(
    appSource.includes('send({ kind: "app.shellReady" })')
      && !appSource.includes('send({ kind: "audio.list"')
      && appSource.includes("useAudioFileStore.getState().hydrateFiles(localFiles)")
      && appSource.includes("engineAudioFilesForProject(sourceProject, useAudioFileStore.getState().files)")
      && appSource.includes("engineInstrumentsForProject(sourceProject, useInstrumentStore.getState().instruments)")
      && appSource.match(/allStartupReady\(startupReadiness\(\)\)\) scheduleCurrentDocumentDirtyState\(\);/g)?.length === 3
      && appSource.includes("}, 10_000);")
      && appSource.includes("}, 1_500);")
      && ipcBackendSchemaSource.includes('APP_SHELL_READY     = "app.shellReady"')
      && ipcBackendBridgeSource.includes("refreshMetadata && audioFileNeedsMetadataRefresh")
      && ipcBackendBridgeSource.includes("for (const auto& file : refreshedFiles)")
      && mainComponentSource.includes("onAppShellReady")
      && nativeMainSource.includes("onFrontendShellReady")
      && nativeMainSource.includes("Preparing audio engine and interface"),
    "startup should hand off from the native splash to visible staged progress and avoid synchronous metadata repair for the full audio library",
  );
  assert.ok(
    exportReviewSource.includes("Project Health")
      && exportReviewSource.includes("showProjectHealth")
      && exportReviewSource.includes('["checking", "warning", "blocked", "failed"]')
      && !exportReviewSource.includes("<span>Required</span>")
      && exportReviewSource.includes("exportValidationBlocksExport"),
    "export review modal should surface Project Health only while checking or when it has an actionable status",
  );
  assert.ok(
    exportActionsSource.includes("validateCurrentProjectBeforeExport")
      && exportActionsSource.includes("project.inspectDocument")
      && exportActionsSource.includes("exportValidationBlocksExport")
      && exportActionsSource.includes("includeTail: true"),
    "shared export runner should validate before export IPC and always include effect tails",
  );
  assert.ok(
    exportStoreSource.includes("job.finished && job.ok && job.path")
      && exportStoreSource.includes("lastCompletedJob: job.finished && job.ok && job.analysis ? job : state.lastCompletedJob")
      && exportReviewSource.includes('job()?.active || validation().state === "checking"')
      && exportReviewSource.includes("Last Successful Export Analysis")
      && exportReviewSource.includes('"Retry Export"'),
    "export review should retain only completed destinations and analysis, prevent duplicate active jobs, and allow stale blocked validation to be retried",
  );
  assert.ok(
    exportJobPanelSource.includes("current.finished && current.cancelled")
      && exportJobPanelSource.includes("Export Cancelled"),
    "export progress UI should distinguish user cancellation from render failure",
  );
  assert.ok(
    exportActionsSource.includes("bounceTrackInPlace")
      && exportActionsSource.includes("project.bounceTrackWav")
      && exportActionsSource.includes("freezeSource")
      && exportActionsSource.includes("nextSource.mute = true")
      && exportActionsSource.includes("result.track")
      && exportActionsSource.includes("result.audioFile")
      && exportActionsSource.includes("setSelectedTracks([bouncedTrack.id])"),
    "shared export actions should expose a freeze/bounce path that mutes the source, appends the returned track/asset, and records freeze metadata",
  );
  assert.ok(
    exportActionsSource.includes("unfreezeBouncedTrack")
      && exportActionsSource.includes("sourceMute")
      && exportActionsSource.includes("sourceSolo")
      && exportActionsSource.includes("removeFile(freezeSource.audioFileId)")
      && exportActionsSource.includes("setSelectedTracks([freezeSource.sourceTrackId])"),
    "shared export actions should expose reversible unfreeze that restores source mute/solo and removes the generated bounce asset",
  );
  assert.ok(
    !exportReviewSource.includes("Recent Destinations")
      && !exportReviewSource.includes("clearRecentDestinations")
      && !exportReviewSource.includes("recentExportFolder")
      && exportReviewSource.includes("chooseDestinationFolder")
      && exportReviewSource.includes("Selected folder")
      && exportReviewSource.includes("Choose Folder"),
    "export review modal should omit recent-destination management and retain the direct folder chooser",
  );
  assert.ok(
    exportStoreSource.includes("EXPORT_PREFERENCES_KEY")
      && exportStoreSource.includes("loadExportPreferences")
      && exportStoreSource.includes("persistExportPreferences")
      && exportStoreSource.includes("validateBeforeExport")
      && exportStoreSource.includes("normalizeRecentDestinations"),
    "export store should persist recent destinations while retaining the mandatory validation migration field",
  );
  assert.ok(
    !exportReviewSource.includes("renderableStemCount")
      && !exportReviewSource.includes("Track Stems")
      && exportStoreSource.includes("Track Stems")
      && exportStoreSource.includes('target: "stems"')
      && exportActionsSource.includes('mode === "stems"')
      && exportActionsSource.includes("project.exportAllTrackWavsAsync"),
    "export review should omit batch-stem UI while preserving the underlying batch-stem export capability",
  );
  assert.ok(
    !exportReviewSource.includes("savePresetAs")
      && !exportReviewSource.includes("deletePreset")
      && !exportReviewSource.includes("Include reverb and delay decay")
      && exportReviewSource.includes('label="Quality"')
      && exportReviewSource.includes("Offline HQ"),
    "export review should keep render quality controls while omitting preset management and the redundant effect-tail toggle",
  );
  assert.ok(
    exportReviewSource.includes("useLoopRangeOnly")
      && exportReviewSource.includes("Export Status")
      && exportReviewSource.lastIndexOf("Export Status") > exportReviewSource.lastIndexOf("Export Destination")
      && exportStoreSource.includes("projectFolderFromFilePath")
      && exportActionsSource.includes("projectFolderFromFilePath(useDocumentStore.getState().currentFilePath)"),
    "export loop scope should be visible, final status should be last, and exports should default to the project folder",
  );
  assert.ok(
    exportReviewSource.includes("Post-Export Analysis")
      && exportReviewSource.includes("True Peak")
      && exportReviewSource.includes("Clipping")
      && exportReviewSource.includes("Correlation"),
    "export review should expose post-export analysis metrics when render analysis is available",
  );
  assert.ok(
    exportActionsSource.includes("revealExportDestination")
      && exportActionsSource.includes("project.revealFile")
      && exportActionsSource.includes("View in Folder is only available in the native app."),
    "export destination reveal should reuse the native project reveal IPC",
  );
  assert.ok(
    appMenuSource.includes("onExportReview")
      && appMenuSource.includes("setSelectedPresetId")
      && appMenuSource.includes("callbacks.onExportTrack?.()")
      && trackHeaderSource.includes('label: "Export as .wav"')
      && trackHeaderSource.includes("exportTrackAsWav")
      && exportActionsSource.includes("exportTrackAsWav"),
    "app and track-header menus should route isolated track WAV export directly to the shared track exporter",
  );
  assert.ok(
    appMenuSource.includes('label: "Import Audio..."')
      && appMenuSource.includes("callbacks.onImportAudio")
      && appSource.includes("async function importAudioFromMenu()")
      && !appMenuSource.includes('label: "Import..."'),
    "the app menu should expose only the supported audio-file import workflow",
  );
  assert.ok(
    !appSource.includes("TrainingAutoRunner")
      && !homeHubSource.includes("AI Training")
      && !preferencesSource.includes("Local AI Training Status")
      && !preferencesSource.includes("training-assisted suggestions"),
    "AI training should remain outside the active product and runtime until it is intentionally reintroduced",
  );
  assert.ok(
    appSource.includes("Local recovery autosave failed")
      && appSource.includes("useSettingsStore.getState().autosaveBackups")
      && appSource.includes("saveProject(project)")
      && preferencesSource.includes('label="Recovery autosave"'),
    "recovery autosave preference should persist project edits locally",
  );
  assert.ok(
    sidebarSource.includes('openEditor({ kind: "exportReview" })') && !sidebarSource.includes("project.exportWav"),
    "sidebar export button should open export review instead of bypassing it with direct IPC",
  );
  assert.ok(
    nodeEditorSource.includes("NODE_BROWSER_GROUPS")
      && nodeEditorSource.includes("NODE_GRAPH_TEMPLATES")
      && nodeGraphSource.includes('nodeKinds: ["oscillator", "noise", "instrument"]')
      && !nodeGraphSource.includes('nodeKinds: ["output"]')
      && nodeEditorSource.includes("auditionGraph")
      && nodeEditorSource.includes("undoGraph")
      && nodeEditorSource.includes("redoGraph")
      && nodeEditorSource.includes("NodeDetails")
      && nodeEditorSource.includes("analyzeInstrumentNodeGraph"),
    "Nodemap editor should expose grouped node browsing, templates, play, undo, details, and warning analysis without output creation",
  );
  assert.ok(
    nodeEditorSource.includes('label="CV Source"')
      && nodeEditorSource.includes('ariaLabel="CV source type"')
      && nodeEditorSource.includes('label="CV Type"')
      && nodeEditorSource.includes("replaceNodeWithCompatibleKind")
      && nodeGraphSource.includes('nodeKinds: ["wavetableLfo"]')
      && nodeGraphSource.includes("CV_SOURCE_NODE_KINDS"),
    "Nodemap should consolidate compatible CV sources behind one add picker and an editable node-type selector",
  );
  const velocityNode = nodeGraph.createInstrumentNode("velocity", 12, 24);
  velocityNode.parameters.amount = 0.72;
  const keytrackNode = nodeGraph.replaceNodeWithCompatibleKind(velocityNode, "keytrack");
  assert.equal(keytrackNode.id, velocityNode.id, "compatible CV conversion should preserve node identity and cables");
  assert.equal(keytrackNode.kind, "keytrack");
  assert.equal(keytrackNode.outputs[0].id, "cv-out");
  assert.equal(keytrackNode.parameters.amount, 0.72, "compatible CV conversion should preserve shared parameters");
  assert.throws(
    () => nodeGraph.replaceNodeWithCompatibleKind(velocityNode, "wavetableLfo"),
    /port contracts differ/,
    "nodes with different input or output contracts must not be consolidated",
  );
  assert.ok(
    nodeCanvasSource.includes("createContextMenu")
      && nodeCanvasSource.includes('node.kind === "output"')
      && nodeCanvasSource.includes("Delete node")
      && nodeCanvasSource.includes("animateMotion")
      && nodeCanvasSource.includes("cableEnd"),
    "Nodemap canvas should protect Instrument Out, support right-click delete, and render visible animated connection endpoints",
  );
  assert.ok(
    nodeCanvasSource.includes("isDirectRun")
      && nodeCanvasSource.includes("L ${x2} ${y2}")
      && !nodeCanvasSource.includes("Math.max(72, Math.abs(x2 - x1)"),
    "Nodemap cable paths should use direct horizontal runs and avoid over-handled cubic folds",
  );
  assert.ok(
    nodeCanvasSource.includes("[data-node-port-dot]")
      && nodeCanvasSource.includes("measuredPortAnchor")
      && nodeCanvasSource.includes("portAnchorKey")
      && nodeCanvasSource.includes("offsetX")
      && nodeCanvasSource.includes("offsetY")
      && nodeCanvasSource.includes("requestAnimationFrame"),
    "Nodemap cable anchors should measure visible port circles after layout instead of relying only on hardcoded row math",
  );
  assert.ok(
    nodeEditorSource.includes("function ParameterControl(props: ParameterControlProps)")
      && !nodeEditorSource.includes("function ParameterControl({"),
    "Nodemap parameter controls should keep Solid props reactive so knob edits update the selected node",
  );
  assert.ok(
    nodeEditorSource.includes("InstrumentOutWaveform")
      && nodeEditorSource.includes("renderInstrumentOutputWaveformPreview")
      && nodeEditorSource.includes("stripNodeGraphLayout")
      && nodeEditorSource.includes("data-output-active")
      && synthPreviewSource.includes("export function renderInstrumentOutputWaveformPreview")
      && synthPreviewSource.includes("renderInstrumentStereoSamples("),
    "Nodemap editor should show a header Instrument Out waveform preview backed by the shared synth preview renderer and avoid rerendering on layout-only node drags",
  );
  assert.ok(
    nodeCanvasSource.includes("customLabel")
      && nodeCanvasSource.includes("definition.label")
      && nodeCanvasSource.includes("nodeCustomName"),
    "Nodemap node cards should keep the canonical node type as the title and show renamed node labels as a second line",
  );
  assert.ok(
    nodeCanvasSource.includes("nodePortRowCount")
      && nodeCanvasSource.includes("nodeMinHeight")
      && nodeCanvasSource.includes("data-port-rows")
      && !nodeEditorCss.includes("min-height: 126px"),
    "Nodemap node cards should reduce height for single-port nodes instead of using the old fixed 126px minimum",
  );
  assert.ok(
    nodeEditorSource.includes("portDetailGroupTitle")
      && nodeEditorSource.includes("portSignalIcon")
      && nodeEditorSource.includes("ph:arrow-square-in")
      && nodeEditorSource.includes("ph:arrow-square-out"),
    "Nodemap inspector input/output sections and port labels should pair text with monochrome icons",
  );
  assert.ok(
    nodeGraphSource.includes('lfo: {\n    label: "LFO",\n    icon: "ph:wave-sine"')
      && nodeGraphSource.includes('envelope: {\n    label: "Envelope",\n    icon: "ph:chart-line"')
      && nodeGraphSource.includes('velocity: {\n    label: "Velocity",\n    icon: "ph:pulse"')
      && nodeGraphSource.includes('random: {\n    label: "Random CV",\n    icon: "ph:shooting-star"')
      && nodeGraphSource.includes('cvScale: {\n    label: "CV Processor",\n    icon: "ph:arrows-in-line-horizontal"')
      && nodeGraphSource.includes('wavetableLfo: {\n    label: "Wavetable LFO",\n    icon: "ph:wave-sine"')
      && nodeGraphSource.includes('panWidth: {\n    label: "Pan / Width",\n    icon: "ph:arrows-in-line-horizontal"')
      && nodeGraphSource.includes('filter: {\n    label: "Filter",\n    icon: "ph:sparkle"')
      && nodeGraphSource.includes('drive: {\n    label: "Drive",\n    icon: "ph:sparkle"')
      && nodeGraphSource.includes('reverb: {\n    label: "Reverb",\n    icon: "ph:sparkle"')
      && nodeGraphSource.includes('bitcrush: {\n    label: "Bitcrush",\n    icon: "ph:sparkle"'),
    "Nodemap modulation nodes should use semantic waveform/control icons while effect nodes share the neutral effect icon",
  );
  assert.ok(
    devHooksSource.includes("exerciseNodeInstrumentEditorFlow")
      && devHooksSource.includes('fixture === "node-interactions"')
      && devHooksSource.includes("dragNodePortCable")
      && devHooksSource.includes("readNodeGraphWarnings")
      && devHooksSource.includes('clickButton("Save")')
      && devHooksSource.includes('clickButton("Play")'),
    "Nodemap dev hooks should exercise node creation, cable dragging, warnings, parameter editing, undo/redo, play, and save",
  );

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
  assert.deepEqual(
    noteAutomation.selectedMidiNoteAutomationEffectiveBadge(withMacroLane, [0, 1], "macro.1"),
    {
      label: "Note lane active",
      detail: "macro.1 direct write",
      tone: "active",
      report: noteAutomation.selectedMidiNoteAutomationEffectiveBadge(withMacroLane, [0, 1], "macro.1").report,
    },
    "selected note automation badges should expose direct-write state for the editor",
  );
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
  const insertedNotePoint = noteAutomation.insertMidiNoteAutomationPoint(curvedMacroLane, [0], "macro.1", 0.75, 0.77);
  assert.deepEqual(
    insertedNotePoint[0].automation[0].points.map((point) => point.beat),
    [2, 2.5, 2.75, 3],
    "note point insertion should use note-local beats and keep points sorted",
  );
  assert.equal(insertedNotePoint[0].automation[0].points[2].curve, "smoothstep", "inserted note points should inherit lane curve metadata");
  const copiedNotePoints = noteAutomation.copyMidiNoteAutomationPoints(insertedNotePoint, 0, "macro.1", [2, 1, 1, 99]);
  assert.deepEqual(
    copiedNotePoints,
    {
      target: "macro.1",
      spanBeats: 0.25,
      points: [
        { beatOffset: 0, value: 0.65, curve: "smoothstep" },
        { beatOffset: 0.25, value: 0.77, curve: "smoothstep" },
      ],
    },
    "note automation point copy should normalize selected point timing and keep curve metadata",
  );
  const pastedNotePoints = noteAutomation.pasteMidiNoteAutomationPoints(insertedNotePoint, [1], copiedNotePoints, 1.25);
  assert.deepEqual(
    pastedNotePoints[1].automation[0].points.map((point) => point.beat),
    [4, 5, 5.25, 5.5, 6],
    "note automation point paste should preserve copied spacing inside each selected note",
  );
  assert.deepEqual(
    pastedNotePoints[1].automation[0].points.map((point) => point.value),
    [0.2, 0.65, 0.65, 0.77, 0.92],
    "note automation point paste should preserve copied values",
  );
  assert.deepEqual(
    pastedNotePoints[1].automation[0].points.map((point) => point.curve),
    ["smoothstep", "smoothstep", "smoothstep", "smoothstep", "smoothstep"],
    "note automation point paste should preserve copied and existing curve metadata",
  );
  assert.equal(
    noteAutomation.copyMidiNoteAutomationPoints(insertedNotePoint, 0, "pitch", [0]),
    null,
    "pitch curve editing should stay out of parameter automation point copy/paste",
  );
  assert.ok(
    pianoRollSource.includes("copyMidiNoteAutomationPoints") && pianoRollSource.includes("pasteMidiNoteAutomationPoints"),
    "piano roll visible automation point toolbar should stay wired to note copy/paste helpers",
  );
  assert.ok(
    pianoRollSource.includes("selectedAutomationPointIndices") && pianoRollSource.includes("Select automation point"),
    "piano roll visible automation point panel should expose selectable point subsets",
  );
  const movedNotePoint = noteAutomation.updateMidiNoteAutomationPoint(insertedNotePoint, [0], "macro.1", 2, 0.9, 0.81);
  assert.deepEqual(
    movedNotePoint[0].automation[0].points.map((point) => point.beat),
    [2, 2.5, 2.9, 3],
    "note point editing should move the addressed point in note-local space",
  );
  assert.equal(movedNotePoint[0].automation[0].points[2].value, 0.81, "note point editing should update the addressed value");
  const unsnappedNotePoint = noteAutomation.updateMidiNoteAutomationPoint(insertedNotePoint, [0], "macro.1", 2, 0.9, 0.813);
  const quantizedNotePoint = noteAutomation.quantizeMidiNoteAutomationPoints(unsnappedNotePoint, [0], "macro.1", 0.25);
  assert.deepEqual(
    quantizedNotePoint[0].automation[0].points.map((point) => point.beat),
    [2, 2.5, 3, 3],
    "note point quantize should snap note-local beats to the grid and preserve note-relative timing",
  );
  assert.deepEqual(
    quantizedNotePoint[0].automation[0].points.map((point) => point.curve),
    ["smoothstep", "smoothstep", "smoothstep", "smoothstep"],
    "note point quantize should preserve curve metadata",
  );
  const snappedNotePointValues = noteAutomation.snapMidiNoteAutomationPointValues(unsnappedNotePoint, [0], "macro.1");
  assert.deepEqual(
    snappedNotePointValues[0].automation[0].points.map((point) => point.value),
    [0.2, 0.65, 0.81, 0.92],
    "note point value snapping should round values to the target step",
  );
  const removedNotePoint = noteAutomation.removeMidiNoteAutomationPoint(movedNotePoint, [0], "macro.1", 2);
  assert.deepEqual(
    removedNotePoint[0].automation[0].points.map((point) => point.beat),
    [2, 2.5, 3],
    "note point removal should leave the rest of the lane intact",
  );
  const clampedPanLane = noteAutomation.setMidiNoteAutomationTargetValues(automationNotes, [0], "amp.pan", -2, 2);
  assert.deepEqual(clampedPanLane[0].automation[0].points.map((point) => point.value), [-1, 1], "bipolar lane values should clamp to their target range");
  const insertedClampedPanPoint = noteAutomation.insertMidiNoteAutomationPoint(clampedPanLane, [0], "amp.pan", 99, 8);
  assert.deepEqual(
    insertedClampedPanPoint[0].automation[0].points.map((point) => point.value),
    [-1, 1, 1],
    "inserted note points should clamp values to the target range",
  );
  assert.deepEqual(
    insertedClampedPanPoint[0].automation[0].points.map((point) => point.beat),
    [2, 3, 3],
    "inserted note points should clamp local beats to the note duration",
  );
  const withPitchLane = noteAutomation.upsertMidiNoteAutomationTarget(automationNotes, [0], "pitch");
  assert.equal(withPitchLane[0].curve.length, 2, "pitch automation should use the note pitch-curve path");
  assert.equal(noteAutomation.setMidiNoteAutomationTargetValues(withPitchLane, [0], "pitch", 0.1, 0.9), withPitchLane, "pitch value editing should stay on curve handles");
  assert.equal(noteAutomation.insertMidiNoteAutomationPoint(withPitchLane, [0], "pitch", 0.5, 0.5), withPitchLane, "pitch point editing should stay on curve handles");
  assert.equal(
    noteAutomation.quantizeMidiNoteAutomationPoints(automationNotes, [0], "macro.1", 0.25)[0].automation,
    undefined,
    "note point quantize should not create empty automation lanes",
  );
  assert.equal(
    noteAutomation.snapMidiNoteAutomationPointValues(automationNotes, [0], "macro.1")[0].automation,
    undefined,
    "note point value snapping should not create empty automation lanes",
  );
  const clearedMacroLane = noteAutomation.clearMidiNoteAutomationTarget(withMacroLane, [0], "macro.1");
  assert.equal(clearedMacroLane[0].automation, undefined, "clearing the only lane should remove note automation clutter");
  assert.equal(clearedMacroLane[1].automation[0].target, "macro.1", "clearing one note should not affect other selected lanes");
  assert.equal(
    noteAutomation.selectedMidiNoteAutomationEffectiveBadge(clearedMacroLane, [0, 1], "macro.1").label,
    "1/2 notes active",
    "partial selected-note automation should identify the active-note count in its badge",
  );

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
  assert.deepEqual(
    arrangementAutomation.segmentAutomationEffectiveBadge(withSegmentLane, "macro.1", [
      { kind: "track", target: "macro.1", label: "Track macro" },
    ]),
    {
      label: "Segment lane wins",
      detail: "Segment lane wins over Track macro",
      tone: "conflict",
      report: arrangementAutomation.segmentAutomationEffectiveBadge(withSegmentLane, "macro.1", [
        { kind: "track", target: "macro.1", label: "Track macro" },
      ]).report,
    },
    "segment automation badges should show inherited track-lane suppression",
  );
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
  const insertedSegmentPoint = arrangementAutomation.insertSegmentAutomationPoint(curvedSegmentLane, "macro.1", 1, 0.61);
  assert.deepEqual(
    insertedSegmentPoint.automation[0].points.map((point) => point.beat),
    [0, 1, 2, 4],
    "segment point insertion should use segment-local beats and sort points",
  );
  assert.equal(insertedSegmentPoint.automation[0].points[1].curve, "smoothstep", "inserted segment points should inherit lane curve metadata");
  const copiedSegmentPoints = arrangementAutomation.copySegmentAutomationPoints(insertedSegmentPoint, "macro.1", [2, 1, 1, 99]);
  assert.deepEqual(
    copiedSegmentPoints,
    {
      target: "macro.1",
      spanBeats: 1,
      points: [
        { beatOffset: 0, value: 0.61, curve: "smoothstep" },
        { beatOffset: 1, value: 0.55, curve: "smoothstep" },
      ],
    },
    "segment automation point copy should use segment-local spacing and keep curve metadata",
  );
  const pastedSegmentPoints = arrangementAutomation.pasteSegmentAutomationPoints(insertedSegmentPoint, copiedSegmentPoints, 2.5);
  assert.deepEqual(
    pastedSegmentPoints.automation[0].points.map((point) => point.beat),
    [0, 1, 2, 2.5, 3.5, 4],
    "segment automation point paste should preserve copied spacing inside the segment",
  );
  assert.deepEqual(
    pastedSegmentPoints.automation[0].points.map((point) => point.value),
    [0.2, 0.61, 0.55, 0.61, 0.55, 0.9],
    "segment automation point paste should preserve copied values",
  );
  assert.deepEqual(
    pastedSegmentPoints.automation[0].points.map((point) => point.curve),
    ["smoothstep", "smoothstep", "smoothstep", "smoothstep", "smoothstep", "smoothstep"],
    "segment automation point paste should preserve copied and existing curve metadata",
  );
  assert.ok(
    segmentEditorSource.includes("copySegmentAutomationPoints") && segmentEditorSource.includes("pasteSegmentAutomationPoints"),
    "segment editor visible automation point toolbar should stay wired to segment copy/paste helpers",
  );
  assert.ok(
    segmentEditorSource.includes("selectedSegmentAutomationPointIndices") && segmentEditorSource.includes("Select segment automation point"),
    "segment editor visible automation point panel should expose selectable point subsets",
  );
  const movedSegmentPoint = arrangementAutomation.updateSegmentAutomationPoint(insertedSegmentPoint, "macro.1", 1, 3.5, 0.73);
  assert.deepEqual(
    movedSegmentPoint.automation[0].points.map((point) => point.beat),
    [0, 2, 3.5, 4],
    "segment point editing should move the addressed point and keep sorting stable",
  );
  assert.equal(movedSegmentPoint.automation[0].points[2].value, 0.73, "segment point editing should update the addressed value");
  const unsnappedSegmentPoint = arrangementAutomation.updateSegmentAutomationPoint(insertedSegmentPoint, "macro.1", 1, 3.37, 0.734);
  const quantizedSegmentPoint = arrangementAutomation.quantizeSegmentAutomationPoints(unsnappedSegmentPoint, "macro.1", 0.25);
  assert.deepEqual(
    quantizedSegmentPoint.automation[0].points.map((point) => point.beat),
    [0, 2, 3.25, 4],
    "segment point quantize should snap segment-local beats to the grid",
  );
  assert.deepEqual(
    quantizedSegmentPoint.automation[0].points.map((point) => point.curve),
    ["smoothstep", "smoothstep", "smoothstep", "smoothstep"],
    "segment point quantize should preserve curve metadata",
  );
  const snappedSegmentPointValues = arrangementAutomation.snapSegmentAutomationPointValues(unsnappedSegmentPoint, "macro.1");
  assert.deepEqual(
    snappedSegmentPointValues.automation[0].points.map((point) => point.value),
    [0.2, 0.55, 0.73, 0.9],
    "segment point value snapping should round values to the target step",
  );
  const removedSegmentPoint = arrangementAutomation.removeSegmentAutomationPoint(movedSegmentPoint, "macro.1", 2);
  assert.deepEqual(
    removedSegmentPoint.automation[0].points.map((point) => point.beat),
    [0, 2, 4],
    "segment point removal should leave the rest of the lane intact",
  );
  const clampedSegmentPanLane = arrangementAutomation.setSegmentAutomationTargetValues(automationSegment, "amp.pan", -2, 2);
  assert.deepEqual(clampedSegmentPanLane.automation[0].points.map((point) => point.value), [-1, 1], "segment automation should clamp bipolar targets");
  const insertedClampedSegmentPoint = arrangementAutomation.insertSegmentAutomationPoint(clampedSegmentPanLane, "amp.pan", 99, 8);
  assert.deepEqual(
    insertedClampedSegmentPoint.automation[0].points.map((point) => point.value),
    [-1, 1, 1],
    "inserted segment points should clamp values to the target range",
  );
  assert.deepEqual(
    insertedClampedSegmentPoint.automation[0].points.map((point) => point.beat),
    [0, 4, 4],
    "inserted segment points should clamp beats to the segment length",
  );
  const unclutteredCurveEdit = arrangementAutomation.setSegmentAutomationTargetCurve(automationSegment, "macro.1", "cubic");
  assert.equal(unclutteredCurveEdit.automation, undefined, "curve edits should not create empty segment automation lanes");
  assert.equal(
    arrangementAutomation.quantizeSegmentAutomationPoints(automationSegment, "macro.1", 0.25).automation,
    undefined,
    "segment point quantize should not create empty automation lanes",
  );
  assert.equal(
    arrangementAutomation.snapSegmentAutomationPointValues(automationSegment, "macro.1").automation,
    undefined,
    "segment point value snapping should not create empty automation lanes",
  );
  const clippedSegmentLanes = arrangementAutomation.clipSegmentAutomation(curvedSegmentLane.automation, 3);
  assert.deepEqual(clippedSegmentLanes[0].points.map((point) => point.beat), [0, 2], "segment automation should clip points outside the saved segment length");
  const clearedSegmentLane = arrangementAutomation.clearSegmentAutomationTarget(curvedSegmentLane, "macro.1");
  assert.equal(clearedSegmentLane.automation, undefined, "clearing the only segment lane should remove automation clutter");

  const automationTrack = {
    id: "track-auto",
    name: "Automation Track",
    kind: "mixed",
    gainDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    recordArmed: false,
    inputMonitoring: false,
    inputDeviceId: "",
    inputChannelStart: 0,
    inputChannelCount: 2,
    recordGainDb: 0,
    effects: { filters: [] },
    segments: [],
    rowHeight: "normal",
  };
  const withTrackLane = arrangementAutomation.upsertTrackAutomationTarget(automationTrack, "filter.cutoff", 64);
  assert.deepEqual(withTrackLane.automation[0].points.map((point) => point.beat), [0, 64], "track automation should use project-timeline beats");
  assert.equal(arrangementAutomation.trackAutomationSummary(withTrackLane, "filter.cutoff"), "1/1 track");
  assert.equal(arrangementAutomation.trackAutomationTargetCount(withTrackLane), 1);
  assert.deepEqual(
    arrangementAutomation.trackAutomationEffectiveBadge(automationTrack, "filter.cutoff"),
    {
      label: "No automation",
      detail: "Default value active",
      tone: "idle",
      report: arrangementAutomation.trackAutomationEffectiveBadge(automationTrack, "filter.cutoff").report,
    },
    "track automation badges should expose idle/default state",
  );
  assert.deepEqual(
    arrangementAutomation.trackAutomationEffectiveBadge(withTrackLane, "filter.cutoff"),
    {
      label: "Track lane active",
      detail: "filter.cutoff direct write",
      tone: "active",
      report: arrangementAutomation.trackAutomationEffectiveBadge(withTrackLane, "filter.cutoff").report,
    },
    "track automation badges should expose direct-write state",
  );
  const editedTrackLane = arrangementAutomation.setTrackAutomationTargetValues(withTrackLane, "filter.cutoff", 64, 0.12, 0.88, 0.44);
  assert.deepEqual(editedTrackLane.automation[0].points.map((point) => point.beat), [0, 32, 64]);
  assert.deepEqual(editedTrackLane.automation[0].points.map((point) => point.value), [0.12, 0.44, 0.88]);
  assert.deepEqual(
    arrangementAutomation.trackAutomationValueRange(editedTrackLane, "filter.cutoff"),
    { startValue: 0.12, midValue: 0.44, endValue: 0.88, active: true, midCount: 1 },
    "track automation should report start/mid/end values for the visible editor",
  );
  const curvedTrackLane = arrangementAutomation.setTrackAutomationTargetCurve(editedTrackLane, "filter.cutoff", "easeIn");
  assert.deepEqual(
    curvedTrackLane.automation[0].points.map((point) => point.curve),
    ["easeIn", "easeIn", "easeIn"],
    "track automation curve selection should annotate points",
  );
  assert.equal(arrangementAutomation.trackAutomationCurve(curvedTrackLane, "filter.cutoff"), "easeIn");
  const insertedTrackPoint = arrangementAutomation.insertTrackAutomationPoint(curvedTrackLane, "filter.cutoff", 64, 12, 0.66);
  assert.deepEqual(
    insertedTrackPoint.automation[0].points.map((point) => point.beat),
    [0, 12, 32, 64],
    "track point insertion should use project-timeline beats and sort points",
  );
  assert.equal(insertedTrackPoint.automation[0].points[1].curve, "easeIn", "inserted track points should inherit lane curve metadata");
  const copiedTrackPoints = arrangementAutomation.copyTrackAutomationPoints(insertedTrackPoint, "filter.cutoff", [2, 1, 1, 99]);
  assert.deepEqual(
    copiedTrackPoints,
    {
      target: "filter.cutoff",
      spanBeats: 20,
      points: [
        { beatOffset: 0, value: 0.66, curve: "easeIn" },
        { beatOffset: 20, value: 0.44, curve: "easeIn" },
      ],
    },
    "track automation point copy should use project-time spacing and keep curve metadata",
  );
  const pastedTrackPoints = arrangementAutomation.pasteTrackAutomationPoints(insertedTrackPoint, copiedTrackPoints, 64, 40);
  assert.deepEqual(
    pastedTrackPoints.automation[0].points.map((point) => point.beat),
    [0, 12, 32, 40, 60, 64],
    "track automation point paste should preserve copied spacing on the project timeline",
  );
  assert.deepEqual(
    pastedTrackPoints.automation[0].points.map((point) => point.value),
    [0.12, 0.66, 0.44, 0.66, 0.44, 0.88],
    "track automation point paste should preserve copied values",
  );
  assert.deepEqual(
    pastedTrackPoints.automation[0].points.map((point) => point.curve),
    ["easeIn", "easeIn", "easeIn", "easeIn", "easeIn", "easeIn"],
    "track automation point paste should preserve copied and existing curve metadata",
  );
  assert.ok(
    trackDetailsSource.includes('header class={styles.sectionHeader}')
      && trackDetailsSource.includes("Instrument automation")
      && trackDetailsSource.includes("Edit automation")
      && trackDetailsSource.includes('kind: "trackAutomation"')
      && !trackDetailsSource.includes("setTrackAutomationTargetValues")
      && !trackDetailsSource.includes("automationHandleRail")
      && !trackDetailsSource.includes("Add point"),
    "Track Details should summarize automation and hand off to the dedicated editor without redundant point controls",
  );
  assert.ok(
    trackAutomationEditorSource.includes('role="application"')
      && trackAutomationEditorSource.includes("onDblClick={addPointAtPointer}")
      && trackAutomationEditorSource.includes("updateTrackAutomationPoint")
      && trackAutomationEditorSource.includes('label="Bar"')
      && trackAutomationEditorSource.includes('label="Beat in bar"')
      && trackAutomationEditorSource.includes("formatAetherArrangementAutomationValue")
      && trackAutomationEditorSource.includes("Double-click to add a point")
      && !trackAutomationEditorSource.includes("setTrackAutomationTargetValues")
      && trackAutomationEditorCss.includes(".automationLine")
      && trackAutomationEditorCss.includes(".pointInspector"),
    "track automation should use one non-destructive time-versus-value graph with musical position and formatted values",
  );
  assert.ok(
    trackListSource.includes("expandedAutomationTrackIds")
      && trackListSource.includes("<TrackAutomationHeaderRows")
      && trackListSource.includes("<TrackAutomationLaneRows")
      && trackHeaderSource.includes('aria-label={props.automationExpanded ? "Hide automation lanes" : "Show automation lanes"}')
      && trackAutomationRowsSource.includes('ariaLabel="Add instrument automation lane"')
      && trackAutomationRowsSource.includes("activeTrackAutomationTargets")
      && trackAutomationRowsSource.includes("upsertTrackAutomationTarget")
      && trackAutomationRowsSource.includes("clearTrackAutomationTarget")
      && trackAutomationRowsSource.includes("onDblClick={addPoint}")
      && trackAutomationRowsSource.includes("updateTrackAutomationPoint")
      && trackAutomationRowsSource.includes("data-track-automation-lane={props.target}")
      && trackAutomationRowsSource.includes("data-track-automation-point")
      && trackAutomationRowsCss.includes("height: 27px")
      && trackAutomationRowsCss.includes("height: 45px")
      && !trackLaneSource.includes("automationPreview")
      && !trackLaneSource.includes("Add ${preview().label} arrangement automation point"),
    "instrument automation should expand into paired multi-parameter timeline rows without the redundant single-lane miniature editor",
  );
  assert.ok(
    devHooksSource.includes('clickPanelButtonByText(pointPanelLabel, "Copy")')
      && devHooksSource.includes('clickPanelButtonByText(pointPanelLabel, "Paste")')
      && devHooksSource.includes("clickLastAutomationPointRemove")
      && devHooksSource.includes("chooseAutomationCurve")
      && devHooksSource.includes("curveBefore")
      && devHooksSource.includes("curveAfter")
      && devHooksSource.includes('clickPanelButtonByText(aetherAutomationLanePanelLabel(editor), "Clear")')
      && devHooksSource.includes("setAutomationPointSelection")
      && devHooksSource.includes("lastSelectablePointIndex")
      && devHooksSource.includes("selectedPointCount")
      && devHooksSource.includes("afterPaste")
      && devHooksSource.includes("afterRemove")
      && devHooksSource.includes("afterClear"),
    "browser fixture automation point editor flow should select curve state, copy/paste/remove points, and clear the visible lane",
  );
  assert.ok(
    devHooksSource.includes("exerciseAetherDirectAutomationPointEditorFlow")
      && devHooksSource.includes('const target: MidiAutomationTarget = "filter.cutoff"')
      && devHooksSource.includes("clickAetherAutomationTarget")
      && devHooksSource.includes("beatAetherDirectAutomationPointExercise")
      && devHooksSource.includes('fixture === "aether-direct-automation-points"'),
    "browser fixture automation point coverage should include non-macro direct Aether target lanes",
  );
  assert.ok(
    devHooksSource.includes("ensureAetherAutomationTargetLane")
      && devHooksSource.includes("filterCutoff")
      && devHooksSource.includes('exerciseAetherNoteAutomationDragLane("filter.cutoff"')
      && devHooksSource.includes('exerciseAetherSegmentAutomationDragLane("filter.cutoff"')
      && devHooksSource.includes('exerciseAetherTrackAutomationDragLane("filter.cutoff"')
      && devHooksSource.includes("beatAetherNoteAutomationDragExercise")
      && devHooksSource.includes("beatAetherSegmentAutomationDragExercise")
      && devHooksSource.includes("beatAetherTrackAutomationDragExercise"),
    "browser fixture automation drag coverage should include non-macro direct Aether target lanes",
  );
  assert.ok(
    !editorHostSource.includes("Instrument - Aether Engine")
      && editorHostSource.includes('case "synth":\n              return null;')
      && editorHostSource.includes("isLegacyAetherInstrument(currentInstrument)")
      && editorHostSource.includes("Instrument - Lumen Engine")
      && synthEditorSource.includes('`${props.instrumentName} output preview`')
      && synthEditorSource.includes('instrumentName={draft().instrumentType === "lumen-hybrid-synth" ? "Lumen" : "Legacy Synth"}')
      && synthEditorSource.includes('label="Name"')
      && synthEditorSource.includes('label="Category"')
      && synthEditorSource.includes('label="Instrument"')
      && synthEditorSource.includes("expressionSummaryInfo")
      && synthEditorSource.includes('aria-label="Instrument expression and performance summary"')
      && !synthEditorSource.includes('aria-label="Change instrument icon"'),
    "Lumen should remain the exposed synth editor while legacy Aether editor routes fail closed",
  );
  assert.ok(
    synthEditorSource.includes('aria-label="LFO"')
      && synthEditorSource.includes('ariaLabel={`LFO ${props.lfo} Shape`}')
      && synthEditorSource.includes('ariaLabel={`LFO ${props.lfo} Sync Rate`}')
      && synthEditorSource.includes('label="Smooth"')
      && synthEditorSource.includes('label="Random"'),
    "Lumen Synth Editor should expose LFO shape, sync-rate, and smoothing/random controls for browser coverage",
  );
  assert.ok(
    devHooksSource.includes("exerciseAetherLfoEditorFlow")
      && devHooksSource.includes("setKnobValueInPanel")
      && devHooksSource.includes("beatAetherLfoExercise")
      && devHooksSource.includes('fixture === "aether-lfo"'),
    "browser fixture coverage should exercise Aether LFO control editing",
  );
  assert.ok(
    oscillatorPanelSource.includes('aria-label="Oscillator"')
      && oscillatorPanelSource.includes('aria-label={`${label()} row`}')
      && oscillatorPanelSource.includes('aria-label="Wavetable"')
      && oscillatorPanelSource.includes('aria-label="Warp mode"')
      && oscillatorPanelSource.includes('aria-label="Voice stack row"'),
    "Aether Oscillator panel should expose row-scoped controls for browser coverage",
  );
  assert.ok(
    devHooksSource.includes("exerciseAetherOscillatorEditorFlow")
      && devHooksSource.includes("setKnobValueInRegion")
      && devHooksSource.includes("beatAetherOscillatorExercise")
      && devHooksSource.includes("afterDisable")
      && devHooksSource.includes("afterReenable")
      && devHooksSource.includes("oscBHasWavetableControls")
      && devHooksSource.includes("Disable Oscillator B")
      && devHooksSource.includes('fixture === "aether-oscillator"'),
    "browser fixture coverage should exercise Aether oscillator, disabled-row, and voice-stack editing",
  );
  assert.ok(
    synthEditorSource.includes('aria-label={`${instrumentName()} instrument effects`}')
      && synthEditorSource.includes('aria-label="Add instrument effect"')
      && synthEditorSource.includes('aria-label={`Current ${instrumentName()} FX chain`}')
      && synthEditorSource.includes("Drag ${EFFECT_LABELS[effect().kind]} to reorder")
      && synthEditorSource.includes("Bypass")
      && synthEditorSource.includes("Remove ${EFFECT_LABELS[effect().kind]}"),
    "Aether Synth Editor should expose Instrument FX controls for browser coverage",
  );
  assert.ok(
    devHooksSource.includes("exerciseAetherFxRackEditorFlow")
      && devHooksSource.includes("setSelectByAriaLabel")
      && devHooksSource.includes("setNumberInputInEffectBlock")
      && devHooksSource.includes("beatAetherFxRackExercise")
      && devHooksSource.includes('fixture === "aether-fx-rack"'),
    "browser fixture coverage should exercise Aether Instrument FX rack editing",
  );
		assert.ok(
			synthEditorSource.includes('aria-label="Amp and filter"')
				&& synthEditorSource.includes('label="Filter"')
				&& synthEditorSource.includes('label="Runtime Warp"')
				&& synthEditorSource.includes('label="Cutoff"')
				&& synthEditorSource.includes("EnvelopeCurveSegmentedControl")
				&& synthEditorSource.includes("envelopeTimingRow")
				&& !synthEditorSource.includes("EnvelopeCurveButton")
				&& synthEditorSource.includes('"aether.runtimeWarp"')
				&& synthEditorSource.includes('"aether.runtimeWarpMode"')
				&& synthEditorSource.includes('["env.1", "env.2"] as const')
      && synthEditorSource.includes('label="Level"')
      && synthEditorSource.includes('label="Pan"'),
    "Aether Synth Editor should expose Amp/Filter controls for browser coverage",
  );
  assert.ok(
    devHooksSource.includes("exerciseAetherAmpFilterEditorFlow")
      && devHooksSource.includes("runtimeWarp")
      && devHooksSource.includes("runtimeWarpMode")
      && devHooksSource.includes('clickRadioInPanel("Amp and filter", "Runtime Warp", "Fold")')
      && devHooksSource.includes('setKnobValueInPanel("Amp and filter", "Warp", "0.64")')
      && devHooksSource.includes("beatAetherAmpFilterExercise")
      && devHooksSource.includes('fixture === "aether-amp-filter"'),
    "browser fixture coverage should exercise Aether Amp/Filter and runtime warp control editing",
  );
  assert.ok(
    devHooksSource.includes("exerciseAetherPerformanceEditorFlow")
      && devHooksSource.includes("setSwitchInPanel")
      && devHooksSource.includes("beatAetherPerformanceExercise")
      && devHooksSource.includes('fixture === "aether-performance"'),
    "browser fixture coverage should exercise Aether Performance control editing",
  );
	  assert.ok(
	    synthEditorSource.includes("Sample Slot 1")
	      && synthEditorSource.includes('sampleParameterId("start")')
	      && synthEditorSource.includes('sampleParameterId("end")')
	      && synthEditorSource.includes('draft().parameters[sampleParameterId("loop.enabled")] === true')
	      && synthEditorSource.includes('sampleParameterId("loop.start")')
	      && synthEditorSource.includes('sampleParameterId("loop.end")')
      && synthEditorSource.includes('aria-label={`${sampleSlotLabel()} mapped zones`}')
      && synthEditorSource.includes("Create Key Map")
      && synthEditorSource.includes('label="Key Low"')
      && synthEditorSource.includes('label="Key High"')
      && synthEditorSource.includes('label="Vel Low"')
      && synthEditorSource.includes('label="Vel High"')
      && synthEditorSource.includes('aria-label={`Sample map zone ${props.index + 1} playback`}')
      && synthEditorSource.includes('label="Zone Level"')
      && synthEditorSource.includes('label="Zone Pan"')
      && synthEditorSource.includes('checked={props.zone.loopEnabled}')
      && synthEditorSource.includes('const loopStartRatio = Math.max(startRatio, props.zone.loopStartRatio)')
      && synthEditorSource.includes('const loopEndRatio = Math.min(endRatio, props.zone.loopEndRatio)')
      && synthEditorSource.includes('sampleParameterId("fxSend1")')
      && synthEditorSource.includes('sampleParameterId("fxSend2")')
      && synthEditorSource.includes("overlaps crossfade")
      && synthEditorSource.includes("zones.slice(0, 8)"),
    "Lumen sample sources should expose bounded mapped-zone selection and per-zone playback controls",
  );
  assert.ok(
    synthEditorSource.includes('aria-labelledby="aether-sample-slot-1-title"')
      && synthEditorSource.includes('id="aether-sample-slot-1-source-status"')
      && synthEditorSource.includes('aria-label={`Enable ${sampleSlotLabel()}`}')
      && synthEditorSource.includes('aria-describedby="aether-sample-slot-1-source-status"')
      && synthEditorSource.includes('aria-labelledby="aether-granular-slot-2-title"')
      && synthEditorSource.includes('id="aether-granular-slot-2-source-status"')
      && synthEditorSource.includes('isLumen() ? `Enable Source ${activeLumenSampleSlot().toUpperCase()} granular` : "Enable legacy granular slot 2"')
      && synthEditorSource.includes('aria-describedby="aether-granular-slot-2-source-status"')
      && synthEditorSource.includes('aria-busy={importingSfz()}')
      && synthEditorSource.includes('aria-busy={importingGranular()}')
      && synthEditorSource.includes('queueMicrotask(() => sampleImportButton?.focus())')
      && synthEditorSource.includes('queueMicrotask(() => granularImportButton?.focus())'),
    "Lumen source controls should expose source state, disabled reasons, busy state, and deterministic focus restoration",
  );
  assert.ok(
    floatingSelectSource.includes('event.key === "Escape"')
      && floatingSelectSource.includes('["ArrowDown", "ArrowUp", "Home", "End"]')
      && floatingSelectSource.includes("closeAndRestoreFocus")
      && floatingSelectSource.includes("searchElement?.focus()")
      && floatingSelectSource.includes("target?.focus()")
      && toggleSource.includes('aria-describedby={props["aria-describedby"]}')
      && toggleSource.includes("props.disabled && styles.disabled"),
    "shared source selectors and switches should preserve keyboard focus and expose disabled context",
  );
  assert.ok(
    synthEditorSource.includes('aria-label="Instrument MPE member zone"')
      && synthEditorSource.includes('aria-label="Enable instrument MPE member zone"')
      && synthEditorSource.includes('ariaLabel="MPE manager channel"')
      && synthEditorSource.includes('ariaLabel="First MPE member channel"')
      && synthEditorSource.includes('ariaLabel="Last MPE member channel"')
      && synthEditorSource.includes('setBooleanParameter("aether.mpe.enabled", false)'),
    "Lumen Synth Editor should expose validated saved MPE zone controls",
  );
  assert.ok(
    oscillatorPanelSource.includes('ariaLabel={`${props.oscillator.toUpperCase()} tuning mode`}')
      && oscillatorPanelSource.includes('ariaLabel={`${props.oscillator.toUpperCase()} phase mode`}')
      && oscillatorPanelSource.includes('osc.${props.oscillator}.tuning.harmonic')
      && oscillatorPanelSource.includes('osc.${props.oscillator}.tuning.numerator')
      && oscillatorPanelSource.includes('osc.${props.oscillator}.tuning.denominator')
      && oscillatorPanelSource.includes('osc.${props.oscillator}.tuning.step')
      && oscillatorPanelSource.includes('osc.${props.oscillator}.tuning.divisions'),
    "Aether oscillator rows should expose every stable tuning mode field and phase memory",
  );
  assert.ok(
    synthEditorSource.includes("Import Preset")
      && editorHostSource.includes("Instrument - Lumen Engine")
      && synthEditorSource.includes("cloneAetherDraftAsLumen(preset.patch, preset.name)")
      && synthEditorSource.includes("onAudition")
      && synthEditorSource.includes("onSaveInstrument"),
    "browser fixture coverage should track current Lumen import, audition, and save controls",
  );
  assert.ok(
    synthEditorSource.includes("Cancel")
      && synthEditorSource.includes("Save")
      && synthEditorSource.includes("className={styles.footerButton}")
      && synthEditorSource.includes("variant=\"primary\""),
    "Lumen Synth Editor should expose current footer cancel/save actions",
  );
  const movedTrackPoint = arrangementAutomation.updateTrackAutomationPoint(insertedTrackPoint, "filter.cutoff", 64, 1, 48, 0.74);
  assert.deepEqual(
    movedTrackPoint.automation[0].points.map((point) => point.beat),
    [0, 32, 48, 64],
    "track point editing should move the addressed point and keep sorting stable",
  );
  assert.equal(movedTrackPoint.automation[0].points[2].value, 0.74, "track point editing should update the addressed value");
  const unsnappedTrackPoint = arrangementAutomation.updateTrackAutomationPoint(insertedTrackPoint, "filter.cutoff", 64, 1, 47.87, 0.744);
  const quantizedTrackPoint = arrangementAutomation.quantizeTrackAutomationPoints(unsnappedTrackPoint, "filter.cutoff", 64, 0.25);
  assert.deepEqual(
    quantizedTrackPoint.automation[0].points.map((point) => point.beat),
    [0, 32, 47.75, 64],
    "track point quantize should snap project-timeline beats to the grid",
  );
  assert.deepEqual(
    quantizedTrackPoint.automation[0].points.map((point) => point.curve),
    ["easeIn", "easeIn", "easeIn", "easeIn"],
    "track point quantize should preserve curve metadata",
  );
  const snappedTrackPointValues = arrangementAutomation.snapTrackAutomationPointValues(unsnappedTrackPoint, "filter.cutoff");
  assert.deepEqual(
    snappedTrackPointValues.automation[0].points.map((point) => point.value),
    [0.12, 0.44, 0.74, 0.88],
    "track point value snapping should round values to the target step",
  );
  const removedTrackPoint = arrangementAutomation.removeTrackAutomationPoint(movedTrackPoint, "filter.cutoff", 2);
  assert.deepEqual(
    removedTrackPoint.automation[0].points.map((point) => point.beat),
    [0, 32, 64],
    "track point removal should leave the rest of the lane intact",
  );
  const clampedTrackPanLane = arrangementAutomation.setTrackAutomationTargetValues(automationTrack, "amp.pan", 64, -2, 2);
  assert.deepEqual(clampedTrackPanLane.automation[0].points.map((point) => point.value), [-1, 1], "track automation should clamp bipolar targets");
  const insertedClampedTrackPoint = arrangementAutomation.insertTrackAutomationPoint(clampedTrackPanLane, "amp.pan", 64, 99, 8);
  assert.deepEqual(
    insertedClampedTrackPoint.automation[0].points.map((point) => point.value),
    [-1, 1, 1],
    "inserted track points should clamp values to the target range",
  );
  assert.deepEqual(
    insertedClampedTrackPoint.automation[0].points.map((point) => point.beat),
    [0, 64, 64],
    "inserted track points should clamp beats to the project length",
  );
  const unclutteredTrackCurveEdit = arrangementAutomation.setTrackAutomationTargetCurve(automationTrack, "macro.1", "cubic");
  assert.equal(unclutteredTrackCurveEdit.automation, undefined, "curve edits should not create empty track automation lanes");
  assert.equal(
    arrangementAutomation.quantizeTrackAutomationPoints(automationTrack, "macro.1", 64, 0.25).automation,
    undefined,
    "track point quantize should not create empty automation lanes",
  );
  assert.equal(
    arrangementAutomation.snapTrackAutomationPointValues(automationTrack, "macro.1").automation,
    undefined,
    "track point value snapping should not create empty automation lanes",
  );
  const clippedTrackLanes = arrangementAutomation.clipTrackAutomation(curvedTrackLane.automation, 40);
  assert.deepEqual(clippedTrackLanes[0].points.map((point) => point.beat), [0, 32], "track automation should clip points outside project length");
  const clearedTrackLane = arrangementAutomation.clearTrackAutomationTarget(curvedTrackLane, "filter.cutoff");
  assert.equal(clearedTrackLane.automation, undefined, "clearing the only track lane should remove automation clutter");

  assert.deepEqual(
    automationConflicts.aetherAutomationPrecedenceOrder(),
    ["live", "project", "track", "segment", "note", "macro"],
    "automation conflict precedence should be explicit and stable",
  );
  const conflictReport = automationConflicts.aetherAutomationConflictReport("filter.cutoff", [
    { kind: "live", target: "filter.cutoff", label: "Cutoff knob", value: 0.42 },
    { kind: "project", target: "filter.cutoff", value: 0.1 },
    { kind: "track", target: "filter.cutoff", value: 0.35 },
    { kind: "segment", target: "filter.cutoff", value: 0.6 },
    { kind: "note", target: "filter.cutoff", value: 0.8 },
    { kind: "macro", target: "filter.cutoff", label: "Brightness", value: 0.14 },
    { kind: "macro", target: "amp.level", label: "Shape", value: 0.2 },
  ]);
  assert.equal(conflictReport.hasConflict, true, "overlapping write and macro sources should be reported as a conflict");
  assert.equal(conflictReport.winner.label, "Note lane", "note-local automation should be the strongest direct write");
  assert.deepEqual(
    conflictReport.suppressed.map((source) => source.label),
    ["Cutoff knob", "Project lane", "Track lane", "Segment lane"],
    "lower-priority direct writes should be identified as suppressed",
  );
  assert.deepEqual(
    conflictReport.additive.map((source) => source.label),
    ["Brightness"],
    "macro routes should be reported as additive modulation, not direct write winners",
  );
  assert.equal(
    conflictReport.summary,
    "filter.cutoff: Note lane wins over Cutoff knob, Project lane, Track lane, Segment lane + 1 macro route",
    "conflict summaries should be compact enough for editor badges",
  );
  assert.deepEqual(
    automationConflicts.aetherAutomationEffectiveBadge(conflictReport),
    {
      label: "Note lane wins",
      detail: "Note lane wins over Cutoff knob, Project lane, Track lane, Segment lane + 1 macro route",
      tone: "conflict",
      report: conflictReport,
    },
    "effective badges should preserve conflict winner and detail text",
  );
  const inactiveConflictReport = automationConflicts.aetherAutomationConflictReport("macro.1", [
    { kind: "project", target: "macro.1", value: 0.2, active: false },
    { kind: "track", target: "macro.1", value: 0.4 },
  ]);
  assert.equal(inactiveConflictReport.winner.label, "Track lane", "inactive sources should be ignored");
  assert.equal(inactiveConflictReport.suppressed.length, 0, "inactive lower lanes should not produce clutter");
  const sameRankReport = automationConflicts.aetherAutomationConflictReport("amp.level", [
    { kind: "track", target: "amp.level", label: "Track A", value: 0.25 },
    { kind: "track", target: "amp.level", label: "Track B", value: 0.5 },
  ]);
  assert.equal(sameRankReport.winner.label, "Track B", "later same-rank sources should win deterministically");
  assert.deepEqual(sameRankReport.suppressed.map((source) => source.label), ["Track A"]);

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
  assert.equal(savedPreset.record.favorite, false, "Save As should default user presets to not favorited");
  const favoritedPreset = runner.previewToggleAetherPresetFavorite(savedPreset.record, 222);
  assert.ok(favoritedPreset, "favorite toggle should return a normalized preset record");
  assert.equal(favoritedPreset.favorite, true, "favorite toggle should mark an unfavorited preset as favorite");
  assert.equal(favoritedPreset.createdAt, 111, "favorite toggle should preserve original creation time");
  assert.equal(favoritedPreset.updatedAt, 222, "favorite toggle should refresh update time");
  const unfavoritedPreset = runner.previewToggleAetherPresetFavorite(favoritedPreset, 333);
  assert.equal(unfavoritedPreset.favorite, false, "favorite toggle should clear an already favorited preset");
  assert.equal(unfavoritedPreset.updatedAt, 333, "favorite clear should refresh update time");
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
  assert.equal(savedFxPreset.record.category, "Color", "Save FX should derive a chain category");
  assert.equal(savedFxPreset.record.description, "2 effects: Saturator -> Delay bypassed / 1 bypassed", "Save FX should derive a readable chain description");
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
  assert.equal(migratedFxPreset.selectedEffectPresetId, "legacy-fx", "legacy FX preset loading should preserve id");
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
        uiControlDetails: [
          { kind: "labeled-knob", label: "Tone", x: 19, y: 80, width: 108, height: 108, bindings: [{ type: "effect", level: "instrument", parameter: "FX_FILTER_FREQUENCY" }] },
        ],
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
  assert.equal(hydratedPlugins[0].uiControlDetails?.[0]?.x, 19, "DecentSampler plugin hydration should preserve authored UI control coordinates");

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
