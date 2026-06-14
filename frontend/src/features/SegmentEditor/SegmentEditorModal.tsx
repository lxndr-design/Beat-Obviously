import { useEffect, useRef, useState } from "react";
import { Modal, Button, FloatingSelect, Icon, NumberInput, TextInput, appAlert, useModalStack } from "../../components";
import { createInstrumentBufferSource, noteFrequency } from "../../audio/synthPreview";
import { DRUM_MAX_STEPS } from "../../ai/drumBeatGenerator";
import { isSupportedAudioFileName, SUPPORTED_AUDIO_IMPORT_LABEL } from "../../audio/audioFormats";
import { importAudioFile } from "../../audio/audioImport";
import type { GeneratedDrumBeat } from "../../ai/drumBeatGenerator";
import { maybeRunDueTraining } from "../../ai/trainingRunner";
import { updateDrumBeatFeedback } from "../../persistence/dexie";
import {
  useAudioFileStore,
  useProjectStore,
  useUiStore,
  useInstrumentStore,
  useTransportStore,
  snapshotInstrument,
} from "../../state/store";
import { selectSegment } from "../../state/selectors";
import { PianoRoll } from "../MidiEditor";
import { MidiTransport } from "../MidiEditor/MidiTransport";
import { DrumSequencer } from "../DrumEditor/DrumSequencer";
import type { DrumRow, DrumSpeed, Instrument, MidiNote, Segment, TimeSignature } from "../../state/types";
import styles from "./SegmentEditorModal.module.css";

interface Props {
  segmentId: string;
}

/**
 * SegmentEditorModal — universal segment editor.
 *
 * MIDI variant:
 *   - Title: "MIDI — <name>"
 *   - Inline controls: Length, Instrument (dropdown)
 *   - In-modal transport: Play / Pause / Restart (auto-loop the segment)
 *   - PianoRoll for note editing
 *
 * Audio variant:
 *   - Stub for now (audio editor lives elsewhere)
 *
 * Removed per spec: Start, Repeats, Layer fields; beats unit suffix.
 */
export function SegmentEditorModal({ segmentId }: Props) {
  const source = useProjectStore(() => selectSegment(segmentId));
  const updateSegment = useProjectStore((s) => s.updateSegment);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const requestDirtyClose = useModalStack((s) => s.requestDirtyClose);
  const instruments = useInstrumentStore((s) => s.instruments);
  const addInstrument = useInstrumentStore((s) => s.addInstrument);
  const addAudioFile = useAudioFileStore((s) => s.addFile);
  const positionBeat = useTransportStore((s) => s.positionBeat);
  const playing = useTransportStore((s) => s.playing);
  const timeSignature = useProjectStore((s) => s.project.timeSignature);
  const id = `segment-${segmentId}`;

  const [draft, setDraft] = useState<Segment | undefined>(source);
  const [instrumentSelectOpen, setInstrumentSelectOpen] = useState(false);
  const [midiTimeSignatureOpen, setMidiTimeSignatureOpen] = useState(false);
  const [midiPreviewBeat, setMidiPreviewBeat] = useState<number | null>(null);
  const [drumTrainingSessionId, setDrumTrainingSessionId] = useState<string | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (source && !draft) setDraft(structuredClone(source));
  }, [source, draft]);

  useEffect(
    () => () => {
      if (previewCtxRef.current) void previewCtxRef.current.close();
    },
    [],
  );

  if (!draft || !source) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(source);

  function save() {
    if (drumTrainingSessionId && draft!.payload.kind === "drum") {
      void updateDrumBeatFeedback(drumTrainingSessionId, {
        acceptedEdit: true,
        finalBeat: drumPayloadFromSegment(draft!),
      }).then(() => maybeRunDueTraining("drums"));
    }
    updateSegment(segmentId, prepareSegmentForSave(draft!));
    close();
  }
  function close() {
    closeEditor({ kind: "segment", segmentId });
  }
  function onClose() {
    if (dirty) requestDirtyClose(id, save, close);
    else close();
  }

  const midiNotes: MidiNote[] =
    draft.payload.kind === "midi" || draft.payload.kind === "mixed"
      ? draft.payload.notes
      : [];

  function updateMidi(notes: MidiNote[]) {
    if (draft!.payload.kind === "midi") {
      setDraft({ ...draft!, payload: { ...draft!.payload, notes } });
    } else if (draft!.payload.kind === "mixed") {
      setDraft({ ...draft!, payload: { ...draft!.payload, notes } });
    }
  }

  function updateMidiVolume(percent: number) {
    const gainDb = volumePercentToGainDb(percent);
    if (draft!.payload.kind === "midi") {
      setDraft({ ...draft!, payload: { ...draft!.payload, gainDb } });
    } else if (draft!.payload.kind === "mixed") {
      setDraft({ ...draft!, payload: { ...draft!.payload, gainDb } });
    }
  }

  function updateDrumRows(rows: DrumRow[]) {
    if (draft!.payload.kind !== "drum") return;
    setDraft({ ...draft!, payload: { ...draft!.payload, rows } });
  }

  function resizeDrum(lengthBeats: number, rows: DrumRow[]) {
    if (draft!.payload.kind !== "drum") return;
    const stepCount = Math.max(1, Math.min(DRUM_MAX_STEPS, Math.round(lengthBeats)));
    setDraft({
      ...draft!,
      lengthBeats: Math.max(1, Math.min(DRUM_MAX_STEPS, Math.round(lengthBeats))),
      payload: { ...draft!.payload, stepCount, rows },
    });
  }

  function updateDrumSpeed(speed: DrumSpeed) {
    if (draft!.payload.kind !== "drum") return;
    setDraft({
      ...draft!,
      payload: {
        ...draft!.payload,
        speed,
      },
    });
  }

  function updateDrumDefaultPitch(frequencyHz: number | undefined) {
    if (draft!.payload.kind !== "drum") return;
    setDraft({ ...draft!, payload: { ...draft!.payload, defaultPitchHz: frequencyHz } });
  }

  function updateDrumSwing(swingPercent: number) {
    if (draft!.payload.kind !== "drum") return;
    setDraft({ ...draft!, payload: { ...draft!.payload, swingPercent } });
  }

  function updateDrumTimeSignature(next: TimeSignature) {
    if (draft!.payload.kind !== "drum") return;
    setDraft({ ...draft!, payload: { ...draft!.payload, timeSignature: next } });
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
    if (draft!.payload.kind !== "drum") return;
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
      steps: Array.from({ length: draft!.payload.stepCount }, () => false),
    };
    setDraft({
      ...draft!,
      payload: { ...draft!.payload, rows: [...draft!.payload.rows, nextRow] },
    });
  }

  function previewNote(pitch: number, velocity = 100) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!previewCtxRef.current) previewCtxRef.current = new Ctor();
    const ctx = previewCtxRef.current;
    if (ctx.state === "suspended") void ctx.resume();
    const gain = ctx.createGain();
    const instrument = instruments.find((i) => i.id === draft?.instrumentId);
    const now = ctx.currentTime;
    const peak = (applyGainToVelocity(velocity, midiSegmentGainDb(draft!.payload)) / 127) * 0.25;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.005);
    gain.gain.linearRampToValueAtTime(0, now + 0.2);
    gain.connect(ctx.destination);

    const synth = instrument ?? fallbackInstrument;
    const source = createInstrumentBufferSource(ctx, synth, 0.24, noteFrequency(Math.max(0, Math.min(127, pitch + (draft?.transpose ?? 0))), synth));
    source.connect(gain);
    source.start(now);
    source.stop(now + 0.24);
  }

  const isMidi = draft.payload.kind === "midi" || draft.payload.kind === "mixed";
  const drumPayload = draft.payload.kind === "drum" ? draft.payload : null;
  const transpose = draft.transpose ?? 0;
  const midiGainDb = midiSegmentGainDb(draft.payload);
  const midiVolumePercent = gainDbToVolumePercent(midiGainDb);
  const midiTimeSignature = draft.timeSignature ?? timeSignature;
  const previewMidiNotes = midiNotes.map((note) => ({
    ...note,
    pitch: Math.max(0, Math.min(127, note.pitch + transpose)),
    curve: note.curve?.map((point) => ({ ...point, pitch: Math.max(0, Math.min(127, point.pitch + transpose)) })),
  }));
  const displayName = draft.name?.trim() || `Segment ${segmentId.slice(0, 6)}`;
  const ribbonName = dirty ? `${displayName} *` : displayName;
  const globalPlayheadBeat =
    playing &&
    positionBeat >= draft.startBeat &&
    positionBeat <= draft.startBeat + draft.lengthBeats
      ? positionBeat - draft.startBeat
      : null;
  const playheadBeat = midiPreviewBeat ?? globalPlayheadBeat;

  return (
    <Modal
      open
      scopeId={id}
      title={<><Icon name={segmentIcon(draft.payload.kind)} size={14} decorative />{ribbonName}</>}
      width="lg"
      dirty={dirty}
      onClose={onClose}
      onRequestCloseDirty={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!dirty} onClick={save}>Save</Button>
        </>
      }
    >
      {isMidi && (
        <>
          <div className={styles.controls}>
            <NumberInput
              layout="inline"
              label="Length"
              value={draft.lengthBeats}
              min={1}
              step={1}
              onChange={(v) => setDraft({ ...draft, lengthBeats: Math.max(1, Math.round(v)) })}
            />
            <FloatingSelect
              layout="inline"
              label="Instrument"
              value={draft.instrumentId ?? ""}
              ariaLabel="Segment instrument"
              options={[
                { value: "", label: "-- none --" },
                ...instruments.map((i) => ({ value: i.id, label: i.name })),
              ]}
              open={instrumentSelectOpen}
              onOpenChange={setInstrumentSelectOpen}
              onChange={(instrumentId) =>
                setDraft({
                  ...draft,
                  instrumentId: instrumentId || undefined,
                })
              }
            />
            <NumberInput
              layout="inline"
              label="Transpose"
              value={transpose}
              min={-48}
              max={DRUM_MAX_STEPS}
              step={1}
              onChange={(v) => setDraft({ ...draft, transpose: Math.round(v) })}
            />
            <NumberInput
              layout="inline"
              label="Vol"
              value={midiVolumePercent}
              min={0}
              max={100}
              step={1}
              unit="%"
              maxLength={3}
              commitOnChange
              onChange={(v) => updateMidiVolume(Math.round(v))}
            />
            <FloatingSelect
              layout="inline"
              label="Time"
              value={formatTimeSignature(midiTimeSignature)}
              ariaLabel="MIDI time signature"
              options={TIME_SIGNATURE_OPTIONS.map((signature) => ({ value: signature, label: signature }))}
              open={midiTimeSignatureOpen}
              onOpenChange={setMidiTimeSignatureOpen}
              onChange={(value) => setDraft({ ...draft, timeSignature: parseTimeSignature(value) })}
            />
            <div className={styles.transportSlot}>
              <MidiTransport
                notes={previewMidiNotes}
                gainDb={midiGainDb}
                lengthBeats={draft.lengthBeats}
                bpm={useProjectStore.getState().project.bpm}
                instrument={instruments.find((i) => i.id === draft.instrumentId)}
                hotkeyScopeId={id}
                onPositionChange={setMidiPreviewBeat}
              />
            </div>
          </div>

          <PianoRoll
            notes={midiNotes}
            lengthBeats={draft.lengthBeats}
            playheadBeat={playheadBeat}
            hotkeyScopeId={id}
            onLengthChange={(lengthBeats) => setDraft({ ...draft, lengthBeats: Math.max(1, Math.round(lengthBeats)) })}
            onChange={updateMidi}
            onPreviewNote={previewNote}
          />
        </>
      )}

      {drumPayload && (
        <>
          <DrumSequencer
            rows={drumPayload.rows}
            stepCount={drumPayload.stepCount}
            speed={drumPayload.speed ?? 1}
            defaultPitchHz={drumPayload.defaultPitchHz}
            swingPercent={drumPayload.swingPercent ?? 50}
            lengthBeats={draft.lengthBeats}
            bpm={useProjectStore.getState().project.bpm}
            timeSignature={timeSignature}
            segmentTimeSignature={drumPayload.timeSignature ?? timeSignature}
            instruments={instruments}
            hotkeyScopeId={id}
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
        </>
      )}

      {draft.payload.kind === "audio" && (
        <div className={styles.audioPanel}>
          <TextInput
            label="Name"
            layout="inline"
            value={draft.name ?? ""}
            placeholder="Audio segment"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div className={styles.audioLabel}>Audio source</div>
          <p className={styles.audioHint}>
            {draft.payload.audioFileId
              ? draft.payload.audioFileId
              : "(no file attached — use ‘Import Audio’ from the track menu)"}
          </p>
        </div>
      )}
    </Modal>
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
