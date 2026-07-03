import { For } from "solid-js";
import { Modal } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { useInstrumentStore, useUiStore } from "../../state/store";
import { ComponentEditorModal } from "../ComponentLibrary/ComponentEditorModal.solid";
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

export function EditorHost() {
  const openEditors = createStoreSelector(useUiStore, (state) => state.openEditors);
  const instruments = createStoreSelector(useInstrumentStore, (state) => state.instruments);
  const closeEditor = useUiStore.getState().closeEditor;
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
                  editorKind={editor.kind === "instrument" ? "instrument" : "samplerInstrument"}
                />
              );
            case "synthInstrument": {
              const instrument = () => instruments().find((candidate) => candidate.id === editor.instrumentId) ?? null;
              return (
                <Modal
                  open
                  title={instrument()?.name ?? "Synth"}
                  width="editor"
                  scopeId={`synth-editor-${editor.instrumentId}`}
                  flushBody
                  onClose={() => closeEditor({ kind: "synthInstrument", instrumentId: editor.instrumentId })}
                >
                  {instrument()?.nodeGraph ? (
                    <NodeInstrumentEditor instrument={instrument()} updateInstrument={updateInstrument} />
                  ) : (
                    <SynthEditor instrumentId={editor.instrumentId} />
                  )}
                </Modal>
              );
            }
            case "synth":
              return (
                <Modal
                  open
                  title="Synth"
                  width="editor"
                  scopeId="synth-editor"
                  flushBody
                  onClose={() => closeEditor({ kind: "synth" })}
                >
                  <SynthEditor />
                </Modal>
              );
            case "track":
              return <TrackDetailsModal trackId={editor.trackId} />;
            case "segment":
              return <SegmentEditorModal segmentId={editor.segmentId} />;
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
