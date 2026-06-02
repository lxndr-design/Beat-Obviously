import { useEffect, useState } from "react";
import { Button, FloatingSelect, Icon, Modal, NumberInput, TextInput, useModalStack } from "../../components";
import { DRUM_MAX_STEPS } from "../../ai/drumBeatGenerator";
import { useComponentStore, type BeatComponent, type DrumComponent, type MidiComponent } from "../../state/components";
import { useInstrumentStore, useProjectStore, useUiStore } from "../../state/store";
import type { DrumRow, DrumSpeed, MidiNote, TimeSignature } from "../../state/types";
import { PianoRoll } from "../MidiEditor";
import { MidiTransport } from "../MidiEditor/MidiTransport";
import { DrumSequencer } from "../DrumEditor/DrumSequencer";
import styles from "../SegmentEditor/SegmentEditorModal.module.css";

interface Props {
  componentId: string;
}

export function ComponentEditorModal({ componentId }: Props) {
  const source = useComponentStore((s) => s.components.find((component) => component.id === componentId));
  const updateComponent = useComponentStore((s) => s.update);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const requestDirtyClose = useModalStack((s) => s.requestDirtyClose);
  const instruments = useInstrumentStore((s) => s.instruments);
  const project = useProjectStore((s) => s.project);
  const scopeId = `component-${componentId}`;
  const [draft, setDraft] = useState<BeatComponent | undefined>(() => source ? structuredClone(source) : undefined);
  const [instrumentSelectOpen, setInstrumentSelectOpen] = useState(false);

  useEffect(() => {
    if (source && !draft) setDraft(structuredClone(source));
  }, [source, draft]);

  if (!source || !draft) return null;

  const dirty = JSON.stringify(source) !== JSON.stringify(draft);
  const kind = draft.kind ?? "midi";
  const title = (
    <>
      <Icon name={kind === "drum" ? "ph:drum" : "ph:piano-keys"} size={14} decorative />
      {draft.name}
    </>
  );

  function close() {
    closeEditor({ kind: "component", componentId });
  }

  function save() {
    if ((draft!.kind ?? "midi") === "drum") {
      const drum = draft! as DrumComponent;
      updateComponent(componentId, {
        name: drum.name,
        rows: drum.rows,
        stepCount: drum.stepCount,
        speed: drum.speed,
        lengthBeats: drum.lengthBeats,
        defaultPitchHz: drum.defaultPitchHz,
        swingPercent: drum.swingPercent,
        timeSignature: drum.timeSignature,
      });
    } else {
      const midi = draft! as MidiComponent;
      updateComponent(componentId, {
        name: midi.name,
        notes: midi.notes,
        lengthBeats: midi.lengthBeats,
        instrumentId: midi.instrumentId,
      });
    }
    close();
  }

  function requestClose() {
    if (dirty) requestDirtyClose(scopeId, save, close);
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

  const midi = (draft.kind ?? "midi") === "drum" ? null : draft as MidiComponent;
  const drum = draft.kind === "drum" ? draft as DrumComponent : null;

  return (
    <Modal
      open
      scopeId={scopeId}
      title={title}
      width="lg"
      dirty={dirty}
      onClose={requestClose}
      onRequestCloseDirty={requestClose}
      footer={
        <>
          <Button variant="ghost" onClick={requestClose}>Cancel</Button>
          <Button variant="primary" disabled={!dirty} onClick={save}>Save</Button>
        </>
      }
    >
      <div className={styles.controls}>
        <TextInput
          label="Name"
          layout="inline"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
        />
        {midi && (
          <>
            <NumberInput
              layout="inline"
              label="Length"
              value={midi.lengthBeats}
              min={0.25}
              max={128}
              step={0.25}
              onChange={(lengthBeats) => setMidiPatch({ lengthBeats: Math.max(0.25, lengthBeats) })}
            />
            <FloatingSelect
              layout="inline"
              label="Instrument"
              value={midi.instrumentId ?? ""}
              ariaLabel="Component instrument"
              options={[
                { value: "", label: "-- none --" },
                ...instruments.map((instrument) => ({ value: instrument.id, label: instrument.name })),
              ]}
              open={instrumentSelectOpen}
              onOpenChange={setInstrumentSelectOpen}
              onChange={(instrumentId) => setMidiPatch({ instrumentId: instrumentId || undefined })}
            />
            <div className={styles.transportSlot}>
              <MidiTransport
                notes={midi.notes}
                lengthBeats={midi.lengthBeats}
                bpm={project.bpm}
                instrument={instruments.find((instrument) => instrument.id === midi.instrumentId)}
                hotkeyScopeId={scopeId}
              />
            </div>
          </>
        )}
      </div>

      {midi && (
        <PianoRoll
          notes={midi.notes}
          lengthBeats={midi.lengthBeats}
          playheadBeat={null}
          onChange={(notes: MidiNote[]) => setMidiPatch({ notes })}
        />
      )}

      {drum && (
        <DrumSequencer
          rows={drum.rows}
          stepCount={drum.stepCount}
          speed={drum.speed}
          lengthBeats={drum.lengthBeats}
          defaultPitchHz={drum.defaultPitchHz}
          swingPercent={drum.swingPercent ?? 50}
          bpm={project.bpm}
          timeSignature={project.timeSignature}
          segmentTimeSignature={drum.timeSignature ?? project.timeSignature}
          instruments={instruments}
          hotkeyScopeId={scopeId}
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
          onSpeedChange={(speed: DrumSpeed) => setDrumPatch({
            speed,
          })}
          onTimeSignatureChange={(timeSignature: TimeSignature) => setDrumPatch({ timeSignature })}
        />
      )}
    </Modal>
  );
}
