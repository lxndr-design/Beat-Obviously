import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { DRUM_MAX_STEPS } from "../../ai/drumBeatGenerator";
import { useModalStack } from "../../solid-ui";
import { Button, FloatingSelect, Icon, Modal, NumberInput, TextInput } from "../../solid-ui";
import { useComponentStore, type BeatComponent, type DrumComponent, type MidiComponent } from "../../state/components";
import { useInstrumentStore, useProjectStore, useUiStore } from "../../state/store";
import type { DrumRow, DrumSpeed, MidiNote, TimeSignature } from "../../state/types";
import { createStoreSelector } from "../../solid-utils/store";
import { DrumSequencerSolid } from "../DrumEditor/DrumSequencer.solid";
import { PianoRollSolid } from "../MidiEditor/PianoRoll.solid";
import { MidiTransportSolid } from "../MidiEditor/MidiTransport.solid";
import styles from "../SegmentEditor/SegmentEditorModal.module.css";

export interface ComponentEditorModalProps {
  componentId: string;
}

export function ComponentEditorModalSolid(props: ComponentEditorModalProps) {
  const source = createStoreSelector(useComponentStore, (s) => s.components.find((component) => component.id === props.componentId));
  const instruments = createStoreSelector(useInstrumentStore, (s) => s.instruments);
  const project = createStoreSelector(useProjectStore, (s) => s.project);
  const updateComponent = useComponentStore.getState().update;
  const closeEditor = useUiStore.getState().closeEditor;
  const requestDirtyClose = useModalStack.getState().requestDirtyClose;
  const scopeId = () => `component-${props.componentId}`;
  const [draft, setDraft] = createSignal<BeatComponent | undefined>(source() ? structuredClone(source()) : undefined, { equals: false });
  const [instrumentSelectOpen, setInstrumentSelectOpen] = createSignal(false);

  createEffect(() => {
    const currentSource = source();
    if (currentSource && !draft()) setDraft(structuredClone(currentSource));
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
        instrumentId: midiDraft.instrumentId,
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

  return (
    <Show when={source() && draft()}>
      <Modal
        open
        scopeId={scopeId()}
        title={<><Icon name={kind() === "drum" ? "ph:drum" : "ph:piano-keys"} size={14} decorative />{draft()?.name}</>}
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
                <FloatingSelect
                  layout="inline"
                  label="Instrument"
                  value={midiDraft().instrumentId ?? ""}
                  ariaLabel="Component instrument"
                  options={[
                    { value: "", label: "-- none --" },
                    ...instruments().map((instrument) => ({ value: instrument.id, label: instrument.name })),
                  ]}
                  open={instrumentSelectOpen()}
                  onOpenChange={setInstrumentSelectOpen}
                  onChange={(instrumentId) => setMidiPatch({ instrumentId: instrumentId || undefined })}
                />
                <div class={styles.transportSlot}>
                  <MidiTransportSolid
                    notes={midiDraft().notes}
                    lengthBeats={midiDraft().lengthBeats}
                    bpm={project().bpm}
                    instrument={instruments().find((instrument) => instrument.id === midiDraft().instrumentId)}
                    hotkeyScopeId={scopeId()}
                  />
                </div>
              </>
            )}
          </Show>
        </div>

        <Show when={midi()}>
          {(midiDraft) => (
            <PianoRollSolid
              notes={midiDraft().notes}
              lengthBeats={midiDraft().lengthBeats}
              playheadBeat={null}
              onChange={(notes: MidiNote[]) => setMidiPatch({ notes })}
            />
          )}
        </Show>

        <Show when={drum()}>
          {(drumDraft) => (
            <DrumSequencerSolid
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
