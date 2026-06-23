import { createMemo, createSignal, For, Show } from "solid-js";
import { nanoid as nano } from "nanoid";
import { createStoreSelector } from "../../solid-utils/store";
import { appAlert } from "../../solid-ui";
import { isSupportedAudioFileName, SUPPORTED_AUDIO_IMPORT_LABEL } from "../../audio/audioFormats";
import { importAudioFile } from "../../audio/audioImport";
import {
  useAudioFileStore,
  useInstrumentStore,
  usePluginStore,
  useProjectStore,
  useTransportStore,
  useUiStore,
  useViewStore,
} from "../../state/store";
import { pauseTransport } from "../../audio/transportActions";
import { useComponentStore } from "../../state/components";
import { clipboardStore } from "../../state/clipboard";
import { expandTrackSegments } from "../../state/selectors";
import {
  AETHER_ARRANGEMENT_AUTOMATION_TARGETS,
  aetherArrangementAutomationTargetLabel,
  aetherArrangementAutomationTargetMeta,
  formatAetherArrangementAutomationValue,
  trackAutomationTargetCount,
  type AetherArrangementAutomationTarget,
} from "../../automation/aetherArrangementAutomation";
import {
  decentSamplerEditorKind,
  decentSamplerInstrumentInstancePatch,
  decentSamplerPluginForInstrument,
} from "../PluginLibrary/decentSamplerPluginAdapter";
import { createContextMenu, type ContextMenuItem } from "../../solid-ui";
import { Segment } from "./Segment.solid";
import styles from "./TrackLane.module.css";
import type { DrumRow, Id, Instrument, MidiAutomationLane, Segment as SegmentModel, Track } from "../../state/types";

interface Props {
  trackId: Id;
  selected?: boolean;
}

export function TrackLane(props: Props) {
  let laneElement: HTMLDivElement | undefined;
  let lastClickBeat = 0;
  const [dragOver, setDragOver] = createSignal(false);
  const track = createStoreSelector(useProjectStore, (state) => state.project.tracks.find((candidate) => candidate.id === props.trackId));
  const tracks = createStoreSelector(useProjectStore, (state) => state.project.tracks);
  const lengthBeats = createStoreSelector(useProjectStore, (state) => state.project.lengthBeats);
  const bpm = createStoreSelector(useProjectStore, (state) => state.project.bpm);
  const beatsToPx = createStoreSelector(useViewStore, (state) => state.beatsToPx);
  const lastLen = createStoreSelector(useViewStore, (state) => state.lastSegmentLength);
  const instruments = createStoreSelector(useInstrumentStore, (state) => state.instruments);
  const plugins = createStoreSelector(usePluginStore, (state) => state.plugins);
  const audioFiles = createStoreSelector(useAudioFileStore, (state) => state.files);

  const expanded = createMemo(() => {
    const currentTrack = track();
    return currentTrack ? expandTrackSegments(currentTrack, lengthBeats()) : [];
  });
  const visibleAutomation = createMemo(() => arrangementAutomationPreview(track(), lengthBeats(), beatsToPx()));

  const menu = createContextMenu((): ContextMenuItem[] => {
    if (!track()) return [];
    const canPaste = clipboardStore.getState().segments.length > 0;
    const projectStore = useProjectStore.getState();
    const viewStore = useViewStore.getState();
    return [
      ...(canPaste
        ? [{
            label: "Paste",
            icon: "ph:clipboard-text",
            onSelect: () => pasteSegmentsIntoTrack(props.trackId, lastClickBeat, clipboardStore.getState().pasteMany()),
          } as ContextMenuItem]
        : []),
      {
        label: "+ MIDI",
        icon: "ph:piano-keys",
        separatorBefore: canPaste,
        onSelect: () => {
          projectStore.addSegment(props.trackId, {
            name: nextSegmentName(tracks(), "midi"),
            startBeat: lastClickBeat,
            lengthBeats: lastLen(),
            instrumentId: instruments().find((instrument) => instrument.name.toLowerCase() === "lead saw")?.id,
            payload: { kind: "midi", notes: [] },
          });
        },
      },
      {
        label: "+ Drum",
        icon: "ph:squares-four",
        onSelect: () => {
          projectStore.addSegment(props.trackId, {
            name: nextSegmentName(tracks(), "drum"),
            startBeat: lastClickBeat,
            lengthBeats: 16,
            payload: {
              kind: "drum",
              stepCount: 16,
              speed: 4,
              defaultPitchHz: 261.63,
              swingPercent: 50,
              rows: makeDefaultDrumRows(instruments()),
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
              await appAlert(`Unsupported audio file. Supported formats: ${SUPPORTED_AUDIO_IMPORT_LABEL}.`);
              return;
            }
            useAudioFileStore.getState().addFile(file);
          }
          projectStore.addSegment(props.trackId, {
            name: nextSegmentName(tracks(), "audio"),
            startBeat: lastClickBeat,
            lengthBeats: lastLen(),
            payload: { kind: "audio", audioFileId: file?.id ?? "", gainDb: 0 },
          });
        },
      },
      {
        label: "Record Audio",
        icon: "ph:record-fill",
        onSelect: () => {
          projectStore.addSegment(props.trackId, {
            name: nextSegmentName(tracks(), "audio"),
            startBeat: lastClickBeat,
            lengthBeats: lastLen(),
            payload: { kind: "audio", audioFileId: "", gainDb: 0 },
          });
          viewStore.setLastSegmentLength(lastLen());
        },
      },
    ];
  });

  function openSegmentEditor(segmentId: Id) {
    const transport = useTransportStore.getState();
    if (transport.playing) pauseTransport();
    useUiStore.getState().openEditor({ kind: "segment", segmentId });
  }

  function beatAtX(clientX: number): number {
    const rect = laneElement?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.round((clientX - rect.left) / beatsToPx()));
  }

  function handleContextMenu(event: MouseEvent) {
    lastClickBeat = beatAtX(event.clientX);
    menu.onContextMenu(event);
  }

  function handleDragOver(event: DragEvent) {
    const types = event.dataTransfer?.types;
    if (!types) return;
    if (
      types.includes("application/x-beat-decent-sampler-plugin")
      || types.includes("application/x-beat-instrument")
      || types.includes("application/x-beat-component")
      || types.includes("application/x-beat-audio-file")
    ) {
      event.preventDefault();
      setDragOver(true);
    }
  }

  function handleDrop(event: DragEvent) {
    setDragOver(false);
    const currentTrack = track();
    const data = event.dataTransfer;
    if (!data || !currentTrack) return;
    const startBeat = beatAtX(event.clientX);
    const projectStore = useProjectStore.getState();
    const viewStore = useViewStore.getState();

    const audioFileId = data.getData("application/x-beat-audio-file");
    if (audioFileId) {
      const file = audioFiles().find((candidate) => candidate.id === audioFileId);
      if (!file) return;
      const length = Math.max(0.25, file.durationSeconds * (bpm() / 60));
      projectStore.addSegment(props.trackId, {
        name: file.name || nextSegmentName(tracks(), "audio"),
        startBeat,
        lengthBeats: length,
        payload: { kind: "audio", audioFileId: file.id, gainDb: 0 },
      });
      viewStore.setLastSegmentLength(length);
      return;
    }

    const componentId = data.getData("application/x-beat-component");
    if (componentId) {
      const component = useComponentStore.getState().components.find((candidate) => candidate.id === componentId);
      if (!component) return;
      if (component.kind === "drum") {
        projectStore.addSegment(props.trackId, {
          name: component.name || nextSegmentName(tracks(), "drum"),
          startBeat,
          lengthBeats: component.lengthBeats,
          payload: {
            kind: "drum",
            rows: structuredClone(component.rows),
            stepCount: component.stepCount,
            speed: component.speed,
            defaultPitchHz: component.defaultPitchHz,
            swingPercent: component.swingPercent,
            timeSignature: component.timeSignature,
          },
        });
      } else {
        projectStore.addSegment(props.trackId, {
          name: component.name || nextSegmentName(tracks(), "midi"),
          startBeat,
          lengthBeats: component.lengthBeats,
          instrumentId: component.instrumentId,
          payload: { kind: "midi", notes: structuredClone(component.notes) },
        });
      }
      viewStore.setLastSegmentLength(component.lengthBeats);
      return;
    }

    const decentSamplerPluginId = data.getData("application/x-beat-decent-sampler-plugin");
    if (decentSamplerPluginId) {
      const plugin = plugins().find((candidate) => candidate.id === decentSamplerPluginId && candidate.format === "decent-sampler");
      const template = plugin?.associatedInstrumentId
        ? instruments().find((instrument) => instrument.id === plugin.associatedInstrumentId)
        : undefined;
      if (!plugin || !template) return;
      const instanceName = nextDecentSamplerInstanceName(plugin.name || template.name, plugin.id, template.id, instruments());
      const instanceId = useInstrumentStore.getState().addInstrument(decentSamplerInstrumentInstancePatch(template, plugin, instanceName));
      const editorKind = decentSamplerEditorKind(plugin);
      projectStore.addSegment(props.trackId, {
        name: instanceName,
        startBeat,
        lengthBeats: lastLen(),
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
      viewStore.setLastSegmentLength(lastLen());
      return;
    }

    const instrumentId = data.getData("application/x-beat-instrument");
    if (instrumentId) {
      const instrument = instruments().find((candidate) => candidate.id === instrumentId);
      if (!instrument) return;
      const dsPlugin = decentSamplerPluginForInstrument(instrument, plugins());
      const editorKind = dsPlugin ? decentSamplerEditorKind(dsPlugin) : "midi";
      projectStore.addSegment(props.trackId, {
        name: dsPlugin ? instrument.name : nextSegmentName(tracks(), "midi"),
        startBeat,
        lengthBeats: lastLen(),
        instrumentId: instrument.id,
        payload: editorKind === "drum"
          ? {
              kind: "drum",
              rows: makeDecentSamplerDrumRows(instrument.id, instrument),
              stepCount: 16,
              speed: 4,
              defaultPitchHz: midiToFrequency(defaultDecentSamplerRootNote(instrument)),
            }
          : { kind: "midi", notes: [] },
      });
      viewStore.setLastSegmentLength(lastLen());
    }
  }

  const segById = createMemo(() => new Map((track()?.segments ?? []).map((segment) => [segment.id, segment])));

  return (
    <Show when={track()}>
      <div
        ref={laneElement}
        data-track-lane-id={props.trackId}
        class={[
          styles.lane,
          dragOver() && styles.dragOver,
          props.selected && styles.selected,
        ].filter(Boolean).join(" ")}
        style={{ width: `${lengthBeats() * beatsToPx()}px`, height: "var(--height-track-row)" }}
        onContextMenu={handleContextMenu}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <For each={Array.from({ length: lengthBeats() + 1 }, (_, beat) => beat)}>
          {(beat) => (
            <div
              class={`${styles.gridLine} ${beat % 4 === 0 ? styles.gridLineMajor : ""}`}
              style={{ left: `${beat * beatsToPx()}px` }}
            />
          )}
        </For>

        <Show when={visibleAutomation()}>
          {(preview) => (
            <div
              class={styles.automationPreview}
              data-aether-arrangement-automation={preview().target}
              aria-label={`${track()?.name ?? "Track"} Aether arrangement automation lane`}
            >
              <div class={styles.automationLabel}>
                <span>{preview().label}</span>
                <Show when={preview().count > 1}>
                  <span class={styles.automationCount}>{preview().count}</span>
                </Show>
              </div>
              <svg
                class={styles.automationCurve}
                viewBox={`0 0 ${preview().width} ${preview().height}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polyline class={styles.automationCurveLine} points={preview().polyline} />
              </svg>
              <For each={preview().points}>
                {(point) => (
                  <div
                    class={styles.automationPoint}
                    title={point.title}
                    style={{ left: `${point.x}px`, top: `${point.y}px` }}
                  />
                )}
              </For>
            </div>
          )}
        </Show>

        <For each={expanded()}>
          {(occurrence) => {
            const original = () => segById().get(occurrence.segmentId);
            return (
              <Show when={original()}>
                {(segment) => (
                  <Segment
                    segmentId={occurrence.segmentId}
                    startBeat={occurrence.startBeat}
                    lengthBeats={occurrence.lengthBeats}
                    repetition={occurrence.repetition}
                    layer={segment().layer}
                    payloadKind={segment().payload.kind}
                    onEdit={() => openSegmentEditor(occurrence.segmentId)}
                  />
                )}
              </Show>
            );
          }}
        </For>
        {menu.menu()}
      </div>
    </Show>
  );
}

interface ArrangementAutomationPreview {
  count: number;
  height: number;
  label: string;
  points: Array<{ title: string; x: number; y: number }>;
  polyline: string;
  target: AetherArrangementAutomationTarget;
  width: number;
}

const ARRANGEMENT_AUTOMATION_TARGETS = new Set<AetherArrangementAutomationTarget>(
  AETHER_ARRANGEMENT_AUTOMATION_TARGETS.map((target) => target.target),
);
const ARRANGEMENT_AUTOMATION_HEIGHT = 22;

function arrangementAutomationPreview(
  track: Track | undefined,
  projectLengthBeats: number,
  beatsToPx: number,
): ArrangementAutomationPreview | null {
  const lane = firstVisibleArrangementAutomationLane(track?.automation);
  if (!lane) return null;
  const target = lane.target as AetherArrangementAutomationTarget;
  const meta = aetherArrangementAutomationTargetMeta(target);
  const width = Math.max(1, projectLengthBeats * beatsToPx);
  const height = ARRANGEMENT_AUTOMATION_HEIGHT;
  const points = lane.points
    .filter((point) => Number.isFinite(point.beat) && Number.isFinite(point.value))
    .map((point) => {
      const beat = clamp(point.beat, 0, Math.max(0.001, projectLengthBeats));
      const normalized = meta.max === meta.min ? 0.5 : (clamp(point.value, meta.min, meta.max) - meta.min) / (meta.max - meta.min);
      const x = beat * beatsToPx;
      const y = height - 4 - normalized * (height - 8);
      return {
        title: `${aetherArrangementAutomationTargetLabel(target)} ${formatAetherArrangementAutomationValue(target, point.value)} @ ${beat.toFixed(2)}`,
        x,
        y,
      };
    });
  if (points.length === 0) return null;
  return {
    count: trackAutomationTargetCount(track),
    height,
    label: aetherArrangementAutomationTargetLabel(target),
    points,
    polyline: points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
    target,
    width,
  };
}

function firstVisibleArrangementAutomationLane(
  automation: MidiAutomationLane[] | undefined,
): MidiAutomationLane | undefined {
  return automation?.find((lane) =>
    ARRANGEMENT_AUTOMATION_TARGETS.has(lane.target as AetherArrangementAutomationTarget)
    && lane.points.length > 0
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nextSegmentName(tracks: Track[], kind: "midi" | "audio" | "drum"): string {
  const stem = kind === "midi" ? "Midi" : kind === "audio" ? "Audio" : "Drums";
  const used = new Set<number>();
  for (const track of tracks) {
    for (const segment of track.segments) {
      if (segment.payload.kind !== kind && (kind === "drum" || segment.payload.kind !== "mixed")) continue;
      const match = (segment.name ?? "").match(new RegExp(`^${stem}\\s+(\\d+)$`));
      if (match) used.add(parseInt(match[1], 10));
    }
  }
  let next = 1;
  while (used.has(next)) next++;
  return `${stem} ${next}`;
}

function makeDecentSamplerDrumRows(instrumentId: Id, instrument: Instrument): DrumRow[] {
  const zones = instrument.sampleMap ?? [];
  const rowCandidates = zones.filter((zone) => isLikelyDrumZoneName(zone.name ?? zone.path)).slice(0, 16);
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

function pasteSegmentsIntoTrack(trackId: Id, startBeat: number, segments: SegmentModel[]) {
  if (segments.length === 0) return;
  const { project, applySegmentEditCommand } = useProjectStore.getState();
  const targetTrackIndex = Math.max(0, project.tracks.findIndex((track) => track.id === trackId));
  const trackIndexById = new Map(project.tracks.map((track, index) => [track.id, index]));
  const sourceIndexes = segments.map((segment) => trackIndexById.get(segment.trackId) ?? targetTrackIndex);
  const sourceAnchorIndex = Math.min(...sourceIndexes);
  const commandSegments = segments.flatMap((segment, index) => {
    const destinationIndex = Math.max(0, Math.min(project.tracks.length - 1, targetTrackIndex + sourceIndexes[index] - sourceAnchorIndex));
    const destinationTrack = project.tracks[destinationIndex];
    if (!destinationTrack) return [];
    return [{
      ...structuredClone(segment),
      trackId: destinationTrack.id,
      name: segment.name?.trim() ? `${segment.name} copy` : segment.name,
    }];
  });
  applySegmentEditCommand({ kind: "paste", segments: commandSegments, startBeat });
}

function nextDecentSamplerInstanceName(baseName: string, pluginId: Id, templateInstrumentId: Id, instruments: Instrument[]): string {
  const base = baseName.trim() || "DecentSampler Instrument";
  const existing = instruments.filter((instrument) => instrument.id !== templateInstrumentId && instrument.source?.pluginId === pluginId);
  const index = existing.length + 1;
  return index === 1 ? base : `${base} ${index}`;
}

function makeDefaultDrumRows(instruments: Instrument[]) {
  const pick = (name: string) => instruments.find((instrument) => instrument.name.toLowerCase() === name.toLowerCase());
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
