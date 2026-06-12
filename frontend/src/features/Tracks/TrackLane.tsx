import { useMemo, useRef, useState } from "react";
import { useContextMenu, type ContextMenuItem } from "../../components";
import { isSupportedAudioFileName, SUPPORTED_AUDIO_IMPORT_LABEL } from "../../audio/audioFormats";
import { importAudioFile } from "../../audio/audioImport";
import {
  useAudioFileStore,
  useProjectStore,
  useTransportStore,
  useUiStore,
  useViewStore,
  useInstrumentStore,
  usePluginStore,
} from "../../state/store";
import { pauseTransport } from "../../audio/transportActions";
import { useComponentStore } from "../../state/components";
import { clipboardStore, useClipboard } from "../../state/clipboard";
import { expandTrackSegments } from "../../state/selectors";
import {
  decentSamplerEditorKind,
  decentSamplerInstrumentInstancePatch,
  decentSamplerPluginForInstrument,
} from "../PluginLibrary/decentSamplerPluginAdapter";
import { Segment } from "./Segment";
import styles from "./TrackLane.module.css";
import type { DrumRow, Id, Instrument, Segment as SegmentModel, Track } from "../../state/types";

/**
 * nextSegmentName — auto-numbers default segment names like "Midi 1",
 * "Audio 2", etc., based on existing segments of that kind on the track.
 * Skips numbers already in use so renamed gaps don't collide.
 */
function nextSegmentName(tracks: Track[], kind: "midi" | "audio" | "drum"): string {
  const stem = kind === "midi" ? "Midi" : kind === "audio" ? "Audio" : "Drums";
  const used = new Set<number>();
  for (const track of tracks) {
    for (const s of track.segments) {
      if (s.payload.kind !== kind && (kind === "drum" || s.payload.kind !== "mixed")) continue;
      const m = (s.name ?? "").match(new RegExp(`^${stem}\\s+(\\d+)$`));
      if (m) used.add(parseInt(m[1], 10));
    }
  }
  let n = 1;
  while (used.has(n)) n++;
  return `${stem} ${n}`;
}

interface Props {
  trackId: Id;
  selected?: boolean;
}

/**
 * TrackLane — the right column for one track.
 *
 * Handles:
 *   - Beat gridlines
 *   - Segment rendering (incl. repeats)
 *   - Context menu (Add Audio / MIDI / Mute / Solo / Duplicate / Delete)
 *   - Drag-drop instrument from the Library list → creates a segment
 */
export function TrackLane({
  trackId,
  selected = false,
}: Props) {
  const track = useProjectStore((s) => s.project.tracks.find((t) => t.id === trackId));
  const tracks = useProjectStore((s) => s.project.tracks);
  const lengthBeats = useProjectStore((s) => s.project.lengthBeats);
  const bpm = useProjectStore((s) => s.project.bpm);
  const beatsToPx = useViewStore((s) => s.beatsToPx);
  const lastLen = useViewStore((s) => s.lastSegmentLength);
  const setLastLen = useViewStore((s) => s.setLastSegmentLength);
  const addSegment = useProjectStore((s) => s.addSegment);
  const openEditor = useUiStore((s) => s.openEditor);
  const instruments = useInstrumentStore((s) => s.instruments);
  const addInstrument = useInstrumentStore((s) => s.addInstrument);
  const plugins = usePluginStore((s) => s.plugins);
  const audioFiles = useAudioFileStore((s) => s.files);
  const addAudioFile = useAudioFileStore((s) => s.addFile);
  const { pasteMany } = useClipboard();

  const laneRef = useRef<HTMLDivElement>(null);
  const lastClickBeatRef = useRef<number>(0);
  const [dragOver, setDragOver] = useState(false);

  function openSegmentEditor(segmentId: Id) {
    const transport = useTransportStore.getState();
    if (transport.playing) {
      pauseTransport();
    }
    openEditor({ kind: "segment", segmentId });
  }

  const expanded = useMemo(
    () => (track ? expandTrackSegments(track, lengthBeats) : []),
    [track, lengthBeats],
  );

  const { onContextMenu, menu } = useContextMenu((): ContextMenuItem[] => {
    if (!track) return [];
    const canPaste = clipboardStore.getState().segments.length > 0;
    return [
      ...(canPaste
        ? [
            {
              label: "Paste",
              icon: "ph:clipboard-text",
              onSelect: () => pasteSegmentsIntoTrack(trackId, lastClickBeatRef.current, pasteMany()),
            } as ContextMenuItem,
          ]
        : []),
      {
        label: "+ MIDI",
        icon: "ph:piano-keys",
        separatorBefore: canPaste,
        onSelect: () => {
          addSegment(trackId, {
            name: nextSegmentName(tracks, "midi"),
            startBeat: lastClickBeatRef.current,
            lengthBeats: lastLen,
            instrumentId: instruments.find((i) => i.name.toLowerCase() === "lead saw")?.id,
            payload: { kind: "midi", notes: [] },
          });
        },
      },
      {
        label: "+ Drum",
        icon: "ph:squares-four",
        onSelect: () => {
          addSegment(trackId, {
            name: nextSegmentName(tracks, "drum"),
            startBeat: lastClickBeatRef.current,
            lengthBeats: 16,
            payload: {
              kind: "drum",
              stepCount: 16,
              speed: 4,
              defaultPitchHz: 261.63,
              swingPercent: 50,
              rows: makeDefaultDrumRows(instruments),
            },
          });
        },
      },
      {
        label: "+ WAV",
        icon: "ph:upload",
        onSelect: async () => {
          const file = await importAudioFile();
          if (file) {
            if (!isSupportedAudioFileName(file.name) && !isSupportedAudioFileName(file.path)) {
              window.alert(`Unsupported audio file. Supported formats: ${SUPPORTED_AUDIO_IMPORT_LABEL}.`);
              return;
            }
            addAudioFile(file);
          }
          addSegment(trackId, {
            name: nextSegmentName(tracks, "audio"),
            startBeat: lastClickBeatRef.current,
            lengthBeats: lastLen,
            payload: {
              kind: "audio",
              audioFileId: file?.id ?? "",
              gainDb: 0,
            },
          });
        },
      },
      {
        label: "Record Audio",
        icon: "ph:record-fill",
        onSelect: () => {
          addSegment(trackId, {
            name: nextSegmentName(tracks, "audio"),
            startBeat: lastClickBeatRef.current,
            lengthBeats: lastLen,
            payload: { kind: "audio", audioFileId: "", gainDb: 0 },
          });
        },
      },
    ];
  });

  function beatAtX(clientX: number): number {
    const r = laneRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.max(0, Math.round((clientX - r.left) / beatsToPx));
  }

  function handleContextMenu(e: React.MouseEvent<HTMLElement>) {
    lastClickBeatRef.current = beatAtX(e.clientX);
    onContextMenu(e);
  }

  // ----- Drag-and-drop --------------------------------------------------
  // Two accepted mimes:
  //   "application/x-beat-instrument" → empty MIDI segment bound to it
  //   "application/x-beat-component"  → MIDI segment cloned from the saved
  //                                     component's notes / length / instrument
  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    const types = e.dataTransfer.types;
    if (
      types.includes("application/x-beat-decent-sampler-plugin") ||
      types.includes("application/x-beat-instrument") ||
      types.includes("application/x-beat-component") ||
      types.includes("application/x-beat-audio-file")
    ) {
      e.preventDefault();
      setDragOver(true);
    }
  }
  function handleDragLeave() {
    setDragOver(false);
  }
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    setDragOver(false);
    const startBeat = beatAtX(e.clientX);

    const audioFileId = e.dataTransfer.getData("application/x-beat-audio-file");
    if (audioFileId) {
      const file = audioFiles.find((f) => f.id === audioFileId);
      if (!file || !track) return;
      const length = Math.max(0.25, file.durationSeconds * (bpm / 60));
      addSegment(trackId, {
        name: file.name || nextSegmentName(tracks, "audio"),
        startBeat,
        lengthBeats: length,
        payload: { kind: "audio", audioFileId: file.id, gainDb: 0 },
      });
      setLastLen(length);
      return;
    }

    const componentId = e.dataTransfer.getData("application/x-beat-component");
    if (componentId) {
      const comp = useComponentStore
        .getState()
        .components.find((c) => c.id === componentId);
      if (!comp || !track) return;
      if (comp.kind === "drum") {
        addSegment(trackId, {
          name: comp.name || nextSegmentName(tracks, "drum"),
          startBeat,
          lengthBeats: comp.lengthBeats,
          payload: {
            kind: "drum",
            rows: structuredClone(comp.rows),
            stepCount: comp.stepCount,
            speed: comp.speed,
            defaultPitchHz: comp.defaultPitchHz,
            swingPercent: comp.swingPercent,
            timeSignature: comp.timeSignature,
          },
        });
      } else {
        addSegment(trackId, {
          name: comp.name || nextSegmentName(tracks, "midi"),
          startBeat,
          lengthBeats: comp.lengthBeats,
          instrumentId: comp.instrumentId,
          payload: { kind: "midi", notes: structuredClone(comp.notes) },
        });
      }
      setLastLen(comp.lengthBeats);
      return;
    }

    const decentSamplerPluginId = e.dataTransfer.getData("application/x-beat-decent-sampler-plugin");
    if (decentSamplerPluginId) {
      const plugin = plugins.find((candidate) => candidate.id === decentSamplerPluginId && candidate.format === "decent-sampler");
      const template = plugin?.associatedInstrumentId
        ? instruments.find((instrument) => instrument.id === plugin.associatedInstrumentId)
        : undefined;
      if (!plugin || !template || !track) return;
      const instanceName = nextDecentSamplerInstanceName(plugin.name || template.name, plugin.id, template.id, instruments);
      const instanceId = addInstrument(decentSamplerInstrumentInstancePatch(template, plugin, instanceName));
      const editorKind = decentSamplerEditorKind(plugin);
      addSegment(trackId, {
        name: instanceName,
        startBeat,
        lengthBeats: lastLen,
        instrumentId: instanceId,
        payload: editorKind === "drum"
          ? {
              kind: "drum",
              rows: makeDecentSamplerDrumRows(instanceId, template),
              stepCount: 16,
              speed: 4,
              defaultPitchHz: midiToFrequency(defaultDecentSamplerRootNote(template)),
            }
          : { kind: "midi", notes: [] },
      });
      setLastLen(lastLen);
      return;
    }

    const instrumentId = e.dataTransfer.getData("application/x-beat-instrument");
    if (instrumentId) {
      const inst = instruments.find((i) => i.id === instrumentId);
      if (!inst || !track) return;
      const dsPlugin = decentSamplerPluginForInstrument(inst, plugins);
      const editorKind = dsPlugin ? decentSamplerEditorKind(dsPlugin) : "midi";
      addSegment(trackId, {
        name: dsPlugin ? inst.name : nextSegmentName(tracks, "midi"),
        startBeat,
        lengthBeats: lastLen,
        instrumentId: inst.id,
        payload: editorKind === "drum"
          ? {
              kind: "drum",
              rows: makeDecentSamplerDrumRows(inst.id, inst),
              stepCount: 16,
              speed: 4,
              defaultPitchHz: midiToFrequency(defaultDecentSamplerRootNote(inst)),
            }
          : { kind: "midi", notes: [] },
      });
      setLastLen(lastLen);
    }
  }

  if (!track) return null;

  const segById = new Map(track.segments.map((s) => [s.id, s]));

  return (
    <div
      ref={laneRef}
      data-track-lane-id={trackId}
      className={[
        styles.lane,
        dragOver && styles.dragOver,
        selected && styles.selected,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ width: lengthBeats * beatsToPx, height: "var(--height-track-row)" }}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {Array.from({ length: lengthBeats + 1 }, (_, b) => (
        <div
          key={b}
          className={`${styles.gridLine} ${b % 4 === 0 ? styles.gridLineMajor : ""}`}
          style={{ left: b * beatsToPx }}
        />
      ))}

        {expanded.map((occ, idx) => {
          const original = segById.get(occ.segmentId)!;
          return (
            <Segment
              key={`${occ.segmentId}:${occ.repetition}:${idx}`}
              segmentId={occ.segmentId}
              startBeat={occ.startBeat}
              lengthBeats={occ.lengthBeats}
              repetition={occ.repetition}
              layer={original.layer}
              payloadKind={original.payload.kind}
            onEdit={() => openSegmentEditor(occ.segmentId)}
          />
        );
      })}
      {menu}
    </div>
  );
}

function makeDecentSamplerDrumRows(instrumentId: Id, instrument: Instrument): DrumRow[] {
  const zones = instrument.sampleMap ?? [];
  const rowCandidates = zones
    .filter((zone) => isLikelyDrumZoneName(zone.name ?? zone.path))
    .slice(0, 16);
  const uniqueRows = new Map<string, DrumRow>();
  for (const zone of (rowCandidates.length ? rowCandidates : zones).slice(0, 16)) {
    const rootNote = Math.max(0, Math.min(127, Math.round(zone.rootNote)));
    const name = conciseZoneName(zone.name ?? zone.path, rootNote);
    const key = `${name.toLowerCase()}:${rootNote}`;
    if (uniqueRows.has(key)) continue;
    uniqueRows.set(key, {
      id: nano(),
      instrumentId,
      name,
      steps: Array.from({ length: 16 }, () => ({
        on: false,
        pitchHz: midiToFrequency(rootNote),
        velocity: Math.max(1, Math.min(127, Math.round((zone.loVel + zone.hiVel) / 2) || 110)),
      })),
    });
  }

  if (uniqueRows.size > 0) return Array.from(uniqueRows.values());
  return [{
    id: nano(),
    instrumentId,
    name: instrument.name,
    steps: Array.from({ length: 16 }, () => ({ on: false, pitchHz: midiToFrequency(60), velocity: 110 })),
  }];
}

function defaultDecentSamplerRootNote(instrument: Instrument): number {
  const firstZone = instrument.sampleMap?.find((zone) => Number.isFinite(zone.rootNote));
  return firstZone ? Math.max(0, Math.min(127, Math.round(firstZone.rootNote))) : 60;
}

function midiToFrequency(note: number) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function conciseZoneName(name: string, rootNote: number) {
  const fileName = name.split(/[\\/]/).pop()?.replace(/\.[a-z0-9]+$/i, "") ?? name;
  return (fileName.trim() || `DS ${rootNote}`).slice(0, 42);
}

function isLikelyDrumZoneName(name: string) {
  return /\b(kick|bd|bass drum|808|snare|sd|hat|hihat|hi[- ]?hat|hh|tom|cymbal|crash|ride|splash|clap|rim|perc|conga|bongo|cowbell|timbal|tamb|shaker|triangle|guiro)\b/i.test(name);
}

/**
 * Duplicate-track helper. Inlined here so TrackLane doesn't need to import
 * the same hook from TrackHeader (would cause circular imports).
 */
function pasteSegmentsIntoTrack(trackId: Id, startBeat: number, segments: SegmentModel[]) {
  if (segments.length === 0) return;
  const { project, applySegmentEditCommand } = useProjectStore.getState();
  const targetTrackIndex = Math.max(0, project.tracks.findIndex((track) => track.id === trackId));
  const trackIndexById = new Map(project.tracks.map((track, index) => [track.id, index]));
  const sourceIndexes = segments.map((segment) => trackIndexById.get(segment.trackId) ?? targetTrackIndex);
  const sourceAnchorIndex = Math.min(...sourceIndexes);
  const startAnchor = Math.min(...segments.map((segment) => segment.startBeat));

  const commandSegments = segments.flatMap((segment, index) => {
    const destIndex = Math.max(
      0,
      Math.min(project.tracks.length - 1, targetTrackIndex + sourceIndexes[index] - sourceAnchorIndex),
    );
    const destinationTrack = project.tracks[destIndex];
    if (!destinationTrack) return [];
    return [{
      ...structuredClone(segment),
      trackId: destinationTrack.id,
      startBeat: Math.max(0, startBeat + segment.startBeat - startAnchor),
      name: segment.name?.trim() ? `${segment.name} copy` : segment.name,
    }];
  });
  applySegmentEditCommand({ kind: "duplicate", segments: commandSegments, offsetBeats: 0 });
}

function nextDecentSamplerInstanceName(baseName: string, pluginId: Id, templateInstrumentId: Id, instruments: Instrument[]): string {
  const base = baseName.trim() || "DecentSampler Instrument";
  const existing = instruments.filter((instrument) => (
    instrument.id !== templateInstrumentId
    && instrument.source?.pluginId === pluginId
  ));
  const index = existing.length + 1;
  return index === 1 ? base : `${base} ${index}`;
}

import { nanoid as nano } from "nanoid";

function makeDefaultDrumRows(instruments: Instrument[]) {
  const pick = (name: string) => instruments.find((i) => i.name.toLowerCase() === name.toLowerCase());
  const kick = pick("Basic Kick") ?? instruments[0];
  const snare = pick("Snap Snare") ?? instruments[1] ?? instruments[0];
  const hat = pick("Closed Hat") ?? pick("Lead Saw") ?? instruments[2] ?? instruments[0];
  return [
    {
      id: nano(),
      instrumentId: kick?.id,
      name: kick?.name ?? "Kick",
      steps: Array.from({ length: 16 }, () => false),
    },
    {
      id: nano(),
      instrumentId: snare?.id,
      name: snare?.name ?? "Snare",
      steps: Array.from({ length: 16 }, () => false),
    },
    {
      id: nano(),
      instrumentId: hat?.id,
      name: hat?.name ?? "Hat",
      steps: Array.from({ length: 16 }, () => false),
    },
  ];
}
