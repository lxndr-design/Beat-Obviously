import { createEffect, createSignal, For } from "solid-js";
import { Modal } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { selectSegment } from "../../state/selectors";
import { useInstrumentStore, useProjectStore, useUiStore } from "../../state/store";
import type { Instrument } from "../../state/types";
import { ComponentEditorModal } from "../ComponentLibrary/ComponentEditorModal.solid";
import { DrumpadEditorModal } from "../DrumpadEditor/DrumpadEditorModal.solid";
import { EqAutomationModal } from "../EqAutomation/EqAutomationModal.solid";
import { ExportReviewModal } from "../ExportReview/ExportReviewModal.solid";
import { InstrumentEditorModal } from "../InstrumentEditor/InstrumentEditorModal.solid";
import { MixerPanel } from "../Mixer/MixerPanel.solid";
import { NodeInstrumentEditor } from "../NodeInstrumentEditor/NodeInstrumentEditor.solid";
import { PluginHostModal } from "../PluginLibrary/PluginHostModal.solid";
import { PreferencesModal } from "../Preferences/PreferencesModal.solid";
import { ProjectHealthModal } from "../ProjectHealth/ProjectHealthModal.solid";
import { SegmentEditorModal } from "../SegmentEditor/SegmentEditorModal.solid";
import { SynthEditor } from "../Synth/SynthEditor/SynthEditor.solid";
import { TrackDetailsModal } from "../TrackDetails/TrackDetailsModal.solid";
import { TrackEffectsPanel } from "../TrackEffects/TrackEffectsPanel.solid";
import { AurumEditor } from "../Aurum/AurumEditor.solid";

export function EditorHost() {
  const openEditors = createStoreSelector(useUiStore, (state) => state.openEditors);
  const instruments = createStoreSelector(useInstrumentStore, (state) => state.instruments);
  const closeEditor = useUiStore.getState().closeEditor;
  const addInstrument = useInstrumentStore.getState().addInstrument;
  const updateInstrument = useInstrumentStore.getState().updateInstrument;

  return (
    <>
      <TrackEffectsPanel />
      <For each={openEditors()}>
        {(editor) => {
          switch (editor.kind) {
            case "instrument":
            case "samplerInstrument":
              return (
                <InstrumentEditorModal
                  instrumentId={editor.instrumentId}
                  draftInstrument={editor.draftInstrument}
                  editorKind={editor.kind === "instrument" ? "instrument" : "samplerInstrument"}
                />
              );
            case "synthInstrument": {
              const instrument = () => editor.draftInstrument ?? instruments().find((candidate) => candidate.id === editor.instrumentId) ?? null;
              const scopeId = `synth-editor-${editor.instrumentId}`;
              return (
                <Modal
                  open
                  title={instrument()?.nodeGraph ? instrument()?.name ?? "Nodemap" : instrument()?.aurum ? "Instrument - Aurum Engine" : "Instrument - Aether Engine"}
                  width="editor"
                  scopeId={scopeId}
                  flushBody
                  onClose={() => closeEditor({ kind: "synthInstrument", instrumentId: editor.instrumentId })}
                >
                  {instrument()?.nodeGraph ? (
                    <DraftNodeInstrumentEditor
                      instrument={instrument()!}
                      onCommit={(saved) => {
                        if (instruments().some((candidate) => candidate.id === saved.id)) updateInstrument(saved.id, saved);
                        else addInstrument(saved);
                        closeEditor({ kind: "synthInstrument", instrumentId: editor.instrumentId });
                      }}
                    />
                  ) : instrument()?.aurum ? (
                    <AurumEditor
                      instrument={instrument()!}
                      onCommit={(saved) => {
                        if (instruments().some((candidate) => candidate.id === saved.id)) updateInstrument(saved.id, saved);
                        else addInstrument(saved);
                        closeEditor({ kind: "synthInstrument", instrumentId: editor.instrumentId });
                      }}
                      onClose={() => closeEditor({ kind: "synthInstrument", instrumentId: editor.instrumentId })}
                    />
                  ) : (
                    <SynthEditor instrumentId={editor.instrumentId} hotkeyScopeId={scopeId} />
                  )}
                </Modal>
              );
            }
            case "synth":
              return (
                <Modal
                  open
                  title="Instrument - Aether Engine"
                  width="editor"
                  scopeId="synth-editor"
                  flushBody
                  onClose={() => closeEditor({ kind: "synth" })}
                >
                  <SynthEditor hotkeyScopeId="synth-editor" />
                </Modal>
              );
            case "track":
              return <TrackDetailsModal trackId={editor.trackId} />;
            case "segment":
              return <SegmentEditorSwitch segmentId={editor.segmentId} discardIfUntouched={editor.discardIfUntouched} />;
            case "component":
              return <ComponentEditorModal componentId={editor.componentId} />;
            case "plugin":
              return <PluginHostModal pluginId={editor.pluginId} />;
            case "eq":
              return <EqAutomationModal />;
            case "mixer":
              return (
                <Modal
                  open
                  title="Mixer"
                  width="full"
                  scopeId="mixer"
                  flushBody
                  onClose={() => closeEditor({ kind: "mixer" })}
                >
                  <MixerPanel />
                </Modal>
              );
            case "exportReview":
              return <ExportReviewModal />;
            case "projectHealth":
              return <ProjectHealthModal />;
            case "preferences":
              return <PreferencesModal />;
            default:
              return null;
          }
        }}
      </For>
    </>
  );
}

function cloneInstrument(instrument: Instrument): Instrument {
  return typeof structuredClone === "function"
    ? structuredClone(instrument)
    : JSON.parse(JSON.stringify(instrument));
}

function DraftNodeInstrumentEditor(props: {
  instrument: Instrument;
  onCommit: (instrument: Instrument) => void;
}) {
  const [draft, setDraft] = createSignal<Instrument>(cloneInstrument(props.instrument), { equals: false });
  const [sourceId, setSourceId] = createSignal(props.instrument.id);

  createEffect(() => {
    const next = props.instrument;
    if (next.id === sourceId()) return;
    setSourceId(next.id);
    setDraft(cloneInstrument(next));
  });

  function updateDraft(id: string, patch: Partial<Instrument>) {
    setDraft((current) => current.id === id ? { ...current, ...patch } : current);
  }

  return (
    <NodeInstrumentEditor
      instrument={draft()}
      updateInstrument={updateDraft}
      onSaveInstrument={props.onCommit}
    />
  );
}

function SegmentEditorSwitch(props: { segmentId: string; discardIfUntouched?: boolean }) {
  const segment = createStoreSelector(useProjectStore, () => selectSegment(props.segmentId));
  return segment()?.payload.kind === "drumpad"
    ? <DrumpadEditorModal segmentId={props.segmentId} discardIfUntouched={props.discardIfUntouched} />
    : <SegmentEditorModal segmentId={props.segmentId} discardIfUntouched={props.discardIfUntouched} />;
}
