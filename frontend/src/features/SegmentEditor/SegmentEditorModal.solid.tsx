import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { DRUM_MAX_STEPS, type GeneratedDrumBeat } from "../../ai/drumBeatGenerator";
import { maybeRunDueTraining } from "../../ai/trainingRunner";
import { isSupportedAudioFileName, SUPPORTED_AUDIO_IMPORT_LABEL } from "../../audio/audioFormats";
import { importAudioFile } from "../../audio/audioImport";
import { createInstrumentBufferSource, noteFrequency } from "../../audio/synthPreview";
import { appAlert, useModalStack } from "../../solid-ui";
import { updateDrumBeatFeedback } from "../../persistence/dexie";
import { Button, FloatingSelect, Icon, Modal, NumberInput, TextInput } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { selectSegment } from "../../state/selectors";
import {
  snapshotInstrument,
  useAudioFileStore,
  useInstrumentStore,
  useProjectStore,
  useTransportStore,
  useUiStore,
} from "../../state/store";
import type { DrumRow, DrumSpeed, Instrument, MidiNote, Segment, TimeSignature } from "../../state/types";
import { DrumSequencerSolid } from "../DrumEditor/DrumSequencer.solid";
import { PianoRollSolid } from "../MidiEditor/PianoRoll.solid";
import { MidiTransportSolid } from "../MidiEditor/MidiTransport.solid";
import styles from "./SegmentEditorModal.module.css";

export interface SegmentEditorModalProps {
  segmentId: string;
}

type MidiLikePayload = Extract<Segment["payload"], { kind: "midi" | "mixed" }>;
type DrumPayload = Extract<Segment["payload"], { kind: "drum" }>;
type AudioPayload = Extract<Segment["payload"], { kind: "audio" }>;

export function SegmentEditorModalSolid(props: SegmentEditorModalProps) {
  const source = createStoreSelector(useProjectStore, () => selectSegment(props.segmentId));
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const positionBeat = createStoreSelector(useTransportStore, (s) => s.positionBeat);
  const playing = createStoreSelector(useTransportStore, (s) => s.playing);
  const timeSignature = createStoreSelector(useProjectStore, (s) => s.project.timeSignature);
  const bpm = createStoreSelector(useProjectStore, (s) => s.project.bpm);
  const updateSegment = useProjectStore.getState().updateSegment;
  const closeEditor = useUiStore.getState().closeEditor;
  const requestDirtyClose = useModalStack.getState().requestDirtyClose;
  const addInstrument = useInstrumentStore.getState().addInstrument;
  const addAudioFile = useAudioFileStore.getState().addFile;
  const scopeId = () => `segment-${props.segmentId}`;
  const [draft, setDraft] = createSignal<Segment | undefined>(source() ? structuredClone(source()) : undefined, { equals: false });
  const [instrumentSelectOpen, setInstrumentSelectOpen] = createSignal(false);
  const [midiTimeSignatureOpen, setMidiTimeSignatureOpen] = createSignal(false);
  const [midiPreviewBeat, setMidiPreviewBeat] = createSignal<number | null>(null);
  const [drumTrainingSessionId, setDrumTrainingSessionId] = createSignal<string | null>(null);
  let previewCtx: AudioContext | null = null;

  createEffect(() => {
    const currentSource = source();
    if (currentSource && !draft()) setDraft(structuredClone(currentSource));
  });

  onCleanup(() => {
    if (previewCtx) void previewCtx.close();
  });

  const dirty = createMemo(() => Boolean(source() && draft() && JSON.stringify(source()) !== JSON.stringify(draft())));
  const isMidi = createMemo(() => draft()?.payload.kind === "midi" || draft()?.payload.kind === "mixed");
  const drumPayload = createMemo<DrumPayload | null>(() => draft()?.payload.kind === "drum" ? draft()!.payload as DrumPayload : null);
  const audioPayload = createMemo<AudioPayload | null>(() => draft()?.payload.kind === "audio" ? draft()!.payload as AudioPayload : null);
  const midiNotes = createMemo<MidiNote[]>(() => isMidi() ? (draft()?.payload as MidiLikePayload).notes : []);
  const transpose = createMemo(() => draft()?.transpose ?? 0);
  const midiGainDb = createMemo(() => draft() ? midiSegmentGainDb(draft()!.payload) : 0);
  const midiVolumePercent = createMemo(() => gainDbToVolumePercent(midiGainDb()));
  const midiTimeSignature = createMemo(() => draft()?.timeSignature ?? timeSignature());
  const previewMidiNotes = createMemo(() => midiNotes().map((note) => ({
    ...note,
    pitch: Math.max(0, Math.min(127, note.pitch + transpose())),
    curve: note.curve?.map((point) => ({ ...point, pitch: Math.max(0, Math.min(127, point.pitch + transpose())) })),
  })));
  const displayName = createMemo(() => draft()?.name?.trim() || `Segment ${props.segmentId.slice(0, 6)}`);
  const ribbonName = createMemo(() => dirty() ? `${displayName()} *` : displayName());
  const globalPlayheadBeat = createMemo(() => {
    const currentDraft = draft();
    if (!currentDraft || !playing()) return null;
    const position = positionBeat();
    return position >= currentDraft.startBeat && position <= currentDraft.startBeat + currentDraft.lengthBeats
      ? position - currentDraft.startBeat
      : null;
  });
  const playheadBeat = createMemo(() => midiPreviewBeat() ?? globalPlayheadBeat());

  function close() {
    closeEditor({ kind: "segment", segmentId: props.segmentId });
  }

  function save() {
    const currentDraft = draft();
    if (!currentDraft) return;
    const sessionId = drumTrainingSessionId();
    if (sessionId && currentDraft.payload.kind === "drum") {
      void updateDrumBeatFeedback(sessionId, {
        acceptedEdit: true,
        finalBeat: drumPayloadFromSegment(currentDraft),
      }).then(() => maybeRunDueTraining("drums"));
    }
    updateSegment(props.segmentId, prepareSegmentForSave(currentDraft));
    close();
  }

  function requestClose() {
    if (dirty()) requestDirtyClose(scopeId(), save, close);
    else close();
  }

  function updateMidi(notes: MidiNote[]) {
    setDraft((current) => {
      if (!current || (current.payload.kind !== "midi" && current.payload.kind !== "mixed")) return current;
      return { ...current, payload: { ...current.payload, notes } };
    });
  }

  function updateMidiVolume(percent: number) {
    const gainDb = volumePercentToGainDb(percent);
    setDraft((current) => {
      if (!current || (current.payload.kind !== "midi" && current.payload.kind !== "mixed")) return current;
      return { ...current, payload: { ...current.payload, gainDb } };
    });
  }

  function updateDrumRows(rows: DrumRow[]) {
    setDraft((current) => current?.payload.kind === "drum"
      ? { ...current, payload: { ...current.payload, rows } }
      : current);
  }

  function resizeDrum(lengthBeats: number, rows: DrumRow[]) {
    setDraft((current) => {
      if (!current || current.payload.kind !== "drum") return current;
      const nextLength = Math.max(1, Math.min(DRUM_MAX_STEPS, Math.round(lengthBeats)));
      return {
        ...current,
        lengthBeats: nextLength,
        payload: {
          ...current.payload,
          stepCount: Math.max(1, Math.min(DRUM_MAX_STEPS, Math.round(lengthBeats))),
          rows,
        },
      };
    });
  }

  function updateDrumSpeed(speed: DrumSpeed) {
    setDraft((current) => current?.payload.kind === "drum" ? { ...current, payload: { ...current.payload, speed } } : current);
  }

  function updateDrumDefaultPitch(defaultPitchHz: number | undefined) {
    setDraft((current) => current?.payload.kind === "drum" ? { ...current, payload: { ...current.payload, defaultPitchHz } } : current);
  }

  function updateDrumSwing(swingPercent: number) {
    setDraft((current) => current?.payload.kind === "drum" ? { ...current, payload: { ...current.payload, swingPercent } } : current);
  }

  function updateDrumTimeSignature(next: TimeSignature) {
    setDraft((current) => current?.payload.kind === "drum" ? { ...current, payload: { ...current.payload, timeSignature: next } } : current);
  }

  function applyGeneratedDrumBeat(beat: GeneratedDrumBeat) {
    setDraft((current) => {
      if (!current || current.payload.kind !== "drum") return current;
      return {
        ...current,
        lengthBeats: beat.lengthBeats,
        payload: {
          ...current.payload,
          rows: beat.rows,
          stepCount: beat.stepCount,
          speed: beat.speed,
          swingPercent: beat.swingPercent,
          defaultPitchHz: beat.defaultPitchHz ?? current.payload.defaultPitchHz,
        },
      };
    });
  }

  async function uploadDrumRow() {
    const currentDraft = draft();
    if (!currentDraft || currentDraft.payload.kind !== "drum") return;
    const file = await importAudioFile();
    if (!file) return;
    if (!isSupportedAudioFileName(file.name) && !isSupportedAudioFileName(file.path)) {
      await appAlert(`Unsupported audio file. Supported formats: ${SUPPORTED_AUDIO_IMPORT_LABEL}.`);
      return;
    }
    addAudioFile(file);
    const name = sampleName(file.name);
    const uploadedInstrument: Partial<Instrument> = {
      name,
      kind: "sampler",
      waveform: "sample",
      sampleIds: [file.id],
      sampleUrl: file.path,
      source: {
        kind: "uploaded",
        label: file.name,
        url: file.path,
        importedAt: Date.now(),
        edited: false,
      },
      userCreated: true,
    };
    const instrumentId = addInstrument({
      ...uploadedInstrument,
      original: snapshotInstrument({
        ...fallbackInstrument,
        ...uploadedInstrument,
        id: "uploaded-preview",
      } as Instrument),
    });
    const nextRow: DrumRow = {
      id: crypto.randomUUID(),
      instrumentId,
      name,
      steps: Array.from({ length: currentDraft.payload.stepCount }, () => false),
    };
    setDraft({
      ...currentDraft,
      payload: { ...currentDraft.payload, rows: [...currentDraft.payload.rows, nextRow] },
    });
  }

  function previewNote(pitch: number, velocity = 100) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!previewCtx) previewCtx = new Ctor();
    const ctx = previewCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const gain = ctx.createGain();
    const currentDraft = draft();
    if (!currentDraft) return;
    const instrument = instruments().find((item) => item.id === currentDraft.instrumentId);
    const now = ctx.currentTime;
    const peak = (applyGainToVelocity(velocity, midiSegmentGainDb(currentDraft.payload)) / 127) * 0.25;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.005);
    gain.gain.linearRampToValueAtTime(0, now + 0.2);
    gain.connect(ctx.destination);

    const synth = instrument ?? fallbackInstrument;
    const sourceNode = createInstrumentBufferSource(ctx, synth, 0.24, noteFrequency(Math.max(0, Math.min(127, pitch + (currentDraft.transpose ?? 0))), synth));
    sourceNode.connect(gain);
    sourceNode.start(now);
    sourceNode.stop(now + 0.24);
  }

  return (
    <Show when={source() && draft()}>
      <Modal
        open
        scopeId={scopeId()}
        title={<><Icon name={segmentIcon(draft()!.payload.kind)} size={14} decorative />{ribbonName()}</>}
        width="lg"
        dirty={dirty()}
        onClose={requestClose}
        onRequestCloseDirty={requestClose}
        footer={
          <>
            <Button variant="ghost" onClick={requestClose}>Cancel</Button>
            <Button variant="primary" disabled={!dirty()} onClick={save}>Save</Button>
          </>
        }
      >
        <Show when={isMidi()}>
          <>
            <div class={styles.controls}>
              <NumberInput
                layout="inline"
                label="Length"
                value={draft()!.lengthBeats}
                min={1}
                step={1}
                onChange={(lengthBeats) => setDraft((current) => current ? { ...current, lengthBeats: Math.max(1, Math.round(lengthBeats)) } : current)}
              />
              <FloatingSelect
                layout="inline"
                label="Instrument"
                value={draft()!.instrumentId ?? ""}
                ariaLabel="Segment instrument"
                options={[
                  { value: "", label: "-- none --" },
                  ...instruments().map((instrument) => ({ value: instrument.id, label: instrument.name })),
                ]}
                open={instrumentSelectOpen()}
                onOpenChange={setInstrumentSelectOpen}
                onChange={(instrumentId) =>
                  setDraft((current) => current ? { ...current, instrumentId: instrumentId || undefined } : current)
                }
              />
              <NumberInput
                layout="inline"
                label="Transpose"
                value={transpose()}
                min={-48}
                max={DRUM_MAX_STEPS}
                step={1}
                onChange={(value) => setDraft((current) => current ? { ...current, transpose: Math.round(value) } : current)}
              />
              <NumberInput
                layout="inline"
                label="Vol"
                value={midiVolumePercent()}
                min={0}
                max={100}
                step={1}
                unit="%"
                maxLength={3}
                commitOnChange
                onChange={(value) => updateMidiVolume(Math.round(value))}
              />
              <FloatingSelect
                layout="inline"
                label="Time"
                value={formatTimeSignature(midiTimeSignature())}
                ariaLabel="MIDI time signature"
                options={TIME_SIGNATURE_OPTIONS.map((signature) => ({ value: signature, label: signature }))}
                open={midiTimeSignatureOpen()}
                onOpenChange={setMidiTimeSignatureOpen}
                onChange={(value) => setDraft((current) => current ? { ...current, timeSignature: parseTimeSignature(value) } : current)}
              />
              <div class={styles.transportSlot}>
                <MidiTransportSolid
                  notes={previewMidiNotes()}
                  gainDb={midiGainDb()}
                  lengthBeats={draft()!.lengthBeats}
                  bpm={bpm()}
                  instrument={instruments().find((instrument) => instrument.id === draft()!.instrumentId)}
                  hotkeyScopeId={scopeId()}
                  onPositionChange={setMidiPreviewBeat}
                />
              </div>
            </div>

            <PianoRollSolid
              notes={midiNotes()}
              lengthBeats={draft()!.lengthBeats}
              playheadBeat={playheadBeat()}
              hotkeyScopeId={scopeId()}
              onLengthChange={(lengthBeats: number) => setDraft((current) => current ? { ...current, lengthBeats: Math.max(1, Math.round(lengthBeats)) } : current)}
              onChange={updateMidi}
              onPreviewNote={previewNote}
            />
          </>
        </Show>

        <Show when={drumPayload()}>
          {(payload) => (
            <DrumSequencerSolid
              rows={payload().rows}
              stepCount={payload().stepCount}
              speed={payload().speed ?? 1}
              defaultPitchHz={payload().defaultPitchHz}
              swingPercent={payload().swingPercent ?? 50}
              lengthBeats={draft()!.lengthBeats}
              bpm={bpm()}
              timeSignature={timeSignature()}
              segmentTimeSignature={payload().timeSignature ?? timeSignature()}
              instruments={instruments()}
              hotkeyScopeId={scopeId()}
              onChange={updateDrumRows}
              onResize={resizeDrum}
              onGenerateBeat={applyGeneratedDrumBeat}
              onTrainingSessionChange={setDrumTrainingSessionId}
              onDefaultPitchChange={updateDrumDefaultPitch}
              onSwingChange={updateDrumSwing}
              onSpeedChange={updateDrumSpeed}
              onTimeSignatureChange={updateDrumTimeSignature}
              onUploadRow={uploadDrumRow}
            />
          )}
        </Show>

        <Show when={audioPayload()}>
          {(payload) => (
          <div class={styles.audioPanel}>
            <TextInput
              label="Name"
              layout="inline"
              value={draft()?.name ?? ""}
              placeholder="Audio segment"
              onInput={(event) => setDraft((current) => current ? { ...current, name: event.currentTarget.value } : current)}
            />
            <div class={styles.audioLabel}>Audio source</div>
            <p class={styles.audioHint}>
              {payload().audioFileId
                ? payload().audioFileId
                : "(no file attached - use 'Import Audio' from the track menu)"}
            </p>
          </div>
          )}
        </Show>
      </Modal>
    </Show>
  );
}

const fallbackInstrument: Instrument = {
  id: "preview-fallback",
  name: "Preview",
  kind: "synth",
  envelope: { attackMs: 5, decayMs: 100, sustain: 0.7, releaseMs: 200 },
  knobs: { cutoff: 0.75, resonance: 0, drive: 0, color: 0.5 },
  waveform: "saw",
  detuneCents: 0,
  octave: 0,
  subOscLevel: 0,
  glideMs: 0,
  sampleIds: [],
  userCreated: false,
};

function sampleName(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "").trim() || "Sample";
}

function drumPayloadFromSegment(segment: Segment): GeneratedDrumBeat | undefined {
  if (segment.payload.kind !== "drum") return undefined;
  return {
    rows: structuredClone(segment.payload.rows),
    stepCount: segment.payload.stepCount,
    lengthBeats: segment.lengthBeats,
    speed: segment.payload.speed,
    swingPercent: segment.payload.swingPercent ?? 50,
    defaultPitchHz: segment.payload.defaultPitchHz,
    source: "local",
  };
}

function segmentIcon(kind: Segment["payload"]["kind"]): string {
  if (kind === "audio") return "ph:waveform";
  if (kind === "drum") return "ph:drum";
  return "ph:piano-keys";
}

function formatTimeSignature(timeSignature: TimeSignature): string {
  return `${timeSignature.num}/${timeSignature.denom}`;
}

function parseTimeSignature(value: string): TimeSignature {
  const [numRaw, denomRaw] = value.split("/");
  return {
    num: Math.max(1, Math.min(16, Number(numRaw) || 4)),
    denom: Number(denomRaw) === 8 ? 8 : 4,
    boldBeats: [1],
  };
}

const TIME_SIGNATURE_OPTIONS = ["4/4", "3/4", "6/8", "5/4", "7/8", "12/8"] as const;

function prepareSegmentForSave(segment: Segment): Segment {
  if (segment.payload.kind !== "midi" && segment.payload.kind !== "mixed") return segment;
  const lengthBeats = Math.max(1, Math.round(segment.lengthBeats));
  const payload = {
    ...segment.payload,
    notes: clipMidiNotesToLength(segment.payload.notes, lengthBeats),
  };
  return { ...segment, lengthBeats, payload };
}

function clipMidiNotesToLength(notes: MidiNote[], lengthBeats: number): MidiNote[] {
  return notes.flatMap((note) => {
    const startBeat = Math.max(0, note.startBeat);
    const endBeat = Math.min(lengthBeats, note.startBeat + note.lengthBeats);
    if (startBeat >= lengthBeats || endBeat - startBeat <= 0.000001) return [];
    const clipped: MidiNote = {
      ...note,
      startBeat,
      lengthBeats: Math.max(0.03125, endBeat - startBeat),
      curve: clipNoteCurve(note, startBeat, endBeat),
      automation: note.automation?.map((lane) => ({
        ...lane,
        points: lane.points
          .filter((point) => point.beat >= startBeat && point.beat <= endBeat)
          .map((point) => ({ ...point })),
      })),
    };
    return [clipped];
  });
}

function clipNoteCurve(note: MidiNote, startBeat: number, endBeat: number): MidiNote["curve"] {
  if (!note.curve || note.curve.length < 2) return note.curve;
  const points = note.curve
    .filter((point) => point.beat >= startBeat && point.beat <= endBeat)
    .map((point) => ({ ...point }));
  if (points.length >= 2) return points;
  return [
    { beat: startBeat, pitch: note.pitch },
    { beat: endBeat, pitch: note.pitch },
  ];
}

function midiSegmentGainDb(payload: Segment["payload"]): number {
  if (payload.kind === "midi" || payload.kind === "mixed") return payload.gainDb ?? 0;
  return 0;
}

function gainDbToVolumePercent(gainDb: number): number {
  const gain = Math.pow(10, Math.max(-96, Math.min(24, gainDb)) / 20);
  return Math.max(0, Math.min(100, Math.round(gain * 100)));
}

function volumePercentToGainDb(percent: number): number {
  const gain = Math.max(0, Math.min(100, percent)) / 100;
  if (gain <= 0) return -96;
  return Math.max(-96, Math.min(0, 20 * Math.log10(gain)));
}

function applyGainToVelocity(velocity: number, gainDb: number): number {
  const gain = Math.pow(10, Math.max(-96, Math.min(24, gainDb)) / 20);
  return Math.max(0, Math.min(127, velocity * gain));
}
