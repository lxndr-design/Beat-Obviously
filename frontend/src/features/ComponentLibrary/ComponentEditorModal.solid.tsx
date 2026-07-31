import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { DRUM_MAX_STEPS } from "../../ai/drumBeatGenerator";
import { createInstrumentBufferSource, noteFrequency } from "../../audio/synthPreview";
import { useModalStack } from "../../solid-ui";
import { Button, Icon, Modal, NumberInput, TextInput } from "../../solid-ui";
import { useComponentStore, type BeatComponent, type DrumComponent, type MidiComponent } from "../../state/components";
import { useInstrumentStore, useProjectStore, useUiStore } from "../../state/store";
import type { DrumRow, DrumSpeed, MidiNote, TimeSignature } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { DrumSequencer } from "../DrumEditor/DrumSequencer.solid";
import { PianoRoll } from "../MidiEditor/PianoRoll.solid";
import { MidiTransport } from "../MidiEditor/MidiTransport.solid";
import styles from "../SegmentEditor/SegmentEditorModal.module.css";

export interface ComponentEditorModalProps {
  componentId: string;
}

export function ComponentEditorModal(props: ComponentEditorModalProps) {
  const source = createStoreSelector(useComponentStore, (s) => s.components.find((component) => component.id === props.componentId));
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const project = createStoreSelector(useProjectStore, (s) => s.project);
  const updateComponent = useComponentStore.getState().update;
  const closeEditor = useUiStore.getState().closeEditor;
  const requestDirtyClose = useModalStack.getState().requestDirtyClose;
  const scopeId = () => `component-${props.componentId}`;
  const [draft, setDraft] = createSignal<BeatComponent | undefined>(source() ? structuredClone(source()) : undefined, { equals: false });
  let previewCtx: AudioContext | null = null;

  createEffect(() => {
    const currentSource = source();
    if (currentSource && !draft()) setDraft(structuredClone(currentSource));
  });

  onCleanup(() => {
    if (previewCtx) void previewCtx.close();
  });

  const dirty = createMemo(() => Boolean(source() && draft() && JSON.stringify(source()) !== JSON.stringify(draft())));
  const kind = createMemo(() => draft()?.kind ?? "midi");
  const midi = createMemo(() => (draft()?.kind ?? "midi") === "drum" ? null : draft() as MidiComponent | undefined);
  const drum = createMemo(() => draft()?.kind === "drum" ? draft() as DrumComponent : null);

  function close() {
    closeEditor({ kind: "component", componentId: props.componentId });
  }

  function save() {
    const currentDraft = draft();
    if (!currentDraft) return;
    if ((currentDraft.kind ?? "midi") === "drum") {
      const drumDraft = currentDraft as DrumComponent;
      updateComponent(props.componentId, {
        name: drumDraft.name,
        rows: drumDraft.rows,
        stepCount: drumDraft.stepCount,
        speed: drumDraft.speed,
        lengthBeats: drumDraft.lengthBeats,
        defaultPitchHz: drumDraft.defaultPitchHz,
        swingPercent: drumDraft.swingPercent,
        timeSignature: drumDraft.timeSignature,
      });
    } else {
      const midiDraft = currentDraft as MidiComponent;
      updateComponent(props.componentId, {
        name: midiDraft.name,
        notes: midiDraft.notes,
        lengthBeats: midiDraft.lengthBeats,
      });
    }
    close();
  }

  function requestClose() {
    if (dirty()) requestDirtyClose(scopeId(), save, close);
    else close();
  }

  function setMidiPatch(patch: Partial<MidiComponent>) {
    setDraft((current) => current && (current.kind ?? "midi") !== "drum"
      ? { ...(current as MidiComponent), ...patch }
      : current);
  }

  function setDrumPatch(patch: Partial<DrumComponent>) {
    setDraft((current) => current?.kind === "drum"
      ? { ...(current as DrumComponent), ...patch }
      : current);
  }

  function previewMidiNote(pitch: number, velocity = 100) {
    const current = midi();
    if (!current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!previewCtx) previewCtx = new Ctor();
    const ctx = previewCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const instrument = fallbackInstrument;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime((Math.max(0, Math.min(127, velocity)) / 127) * 0.22, now + 0.005);
    gain.gain.linearRampToValueAtTime(0, now + 0.2);
    gain.connect(ctx.destination);
    const sourceNode = createInstrumentBufferSource(
      ctx,
      instrument,
      0.24,
      noteFrequency(Math.max(0, Math.min(127, pitch)), instrument),
      undefined,
      velocity,
      project().bpm,
    );
    sourceNode.connect(gain);
    sourceNode.start(now);
    sourceNode.stop(now + 0.24);
  }

  return (
    <Show when={source() && draft()}>
      <Modal
        open
        scopeId={scopeId()}
        title={<><Icon name={kind() === "drum" ? "ph:music-notes-simple" : "ph:piano-keys"} size={18} decorative />{draft()?.name}</>}
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
        <div class={styles.controls}>
          <TextInput
            label="Name"
            layout="inline"
            value={draft()?.name ?? ""}
            onInput={(event) => {
              const current = draft();
              if (current) setDraft({ ...current, name: event.currentTarget.value });
            }}
          />
          <Show when={midi()}>
            {(midiDraft) => (
              <>
                <NumberInput
                  layout="inline"
                  label="Length"
                  value={midiDraft().lengthBeats}
                  min={0.25}
                  max={128}
                  step={0.25}
                  onChange={(lengthBeats) => setMidiPatch({ lengthBeats: Math.max(0.25, lengthBeats) })}
                />
                <div class={styles.transportSlot}>
                  <MidiTransport
                    notes={midiDraft().notes}
                    lengthBeats={midiDraft().lengthBeats}
                    bpm={project().bpm}
                    hotkeyScopeId={scopeId()}
                  />
                </div>
              </>
            )}
          </Show>
        </div>

        <Show when={midi()}>
          {(midiDraft) => (
            <PianoRoll
              notes={midiDraft().notes}
              lengthBeats={midiDraft().lengthBeats}
              playheadBeat={null}
              onChange={(notes: MidiNote[]) => setMidiPatch({ notes })}
              onPreviewNote={previewMidiNote}
            />
          )}
        </Show>

        <Show when={drum()}>
          {(drumDraft) => (
            <DrumSequencer
              rows={drumDraft().rows}
              stepCount={drumDraft().stepCount}
              speed={drumDraft().speed}
              lengthBeats={drumDraft().lengthBeats}
              defaultPitchHz={drumDraft().defaultPitchHz}
              swingPercent={drumDraft().swingPercent ?? 50}
              bpm={project().bpm}
              timeSignature={project().timeSignature}
              segmentTimeSignature={drumDraft().timeSignature ?? project().timeSignature}
              instruments={instruments()}
              hotkeyScopeId={scopeId()}
              onChange={(rows: DrumRow[]) => setDrumPatch({ rows })}
              onResize={(lengthBeats: number, rows: DrumRow[]) => {
                setDrumPatch({
                  lengthBeats,
                  rows,
                  stepCount: Math.max(1, Math.min(DRUM_MAX_STEPS, Math.round(lengthBeats))),
                });
              }}
              onGenerateBeat={(beat) => setDrumPatch({
                rows: beat.rows,
                stepCount: beat.stepCount,
                speed: beat.speed,
                lengthBeats: beat.lengthBeats,
                defaultPitchHz: beat.defaultPitchHz,
                swingPercent: beat.swingPercent,
              })}
              onDefaultPitchChange={(defaultPitchHz) => setDrumPatch({ defaultPitchHz })}
              onSwingChange={(swingPercent) => setDrumPatch({ swingPercent })}
              onSpeedChange={(speed: DrumSpeed) => setDrumPatch({ speed })}
              onTimeSignatureChange={(timeSignature: TimeSignature) => setDrumPatch({ timeSignature })}
            />
          )}
        </Show>
      </Modal>
    </Show>
  );
}

const fallbackInstrument = {
  id: "component-preview-fallback",
  name: "Preview",
  kind: "synth" as const,
  envelope: { attackMs: 5, decayMs: 100, sustain: 0.7, releaseMs: 200 },
  knobs: { cutoff: 0.75, resonance: 0, drive: 0, color: 0.5 },
  waveform: "saw" as const,
  detuneCents: 0,
  octave: 0,
  subOscLevel: 0,
  glideMs: 0,
  sampleIds: [],
  userCreated: false,
};
