import { For } from "solid-js";
import { render } from "solid-js/web";
import { Modal } from "../../solid-ui";
import { createStoreSelector } from "../../solid-utils/store";
import { useInstrumentStore, useUiStore } from "../../state/store";
import { ComponentEditorModalSolid } from "../ComponentLibrary/ComponentEditorModal.solid";
import { EqAutomationModalSolid } from "../EqAutomation/EqAutomationModal.solid";
import { InstrumentEditorModalSolid } from "../InstrumentEditor/InstrumentEditorModal.solid";
import { NodeInstrumentEditorSolid } from "../NodeInstrumentEditor/NodeInstrumentEditorSolid.solid";
import { PluginHostModalSolid } from "../PluginLibrary/PluginHostModal.solid";
import { PreferencesModalSolid } from "../Preferences/PreferencesModal.solid";
import { ProjectHealthModalSolid } from "../ProjectHealth/ProjectHealthModal.solid";
import { SegmentEditorModalSolid } from "../SegmentEditor/SegmentEditorModal.solid";
import { SynthEditorSolid } from "../Synth/SynthEditor/SynthEditor.solid";
import { TrackDetailsModalSolid } from "../TrackDetails/TrackDetailsModal.solid";
import { TrackEffectsPanelSolid } from "../TrackEffects/TrackEffectsPanel.solid";

export interface MountedEditorHostSolid {
  dispose: () => void;
}

export function mountEditorHostSolid(host: HTMLElement): MountedEditorHostSolid {
  const dispose = render(() => <EditorHostSolid />, host);
  return { dispose };
}

export function EditorHostSolid() {
  const openEditors = createStoreSelector(useUiStore, (state) => state.openEditors);
  const instruments = createStoreSelector(useInstrumentStore, (state) => state.instruments);
  const closeEditor = useUiStore.getState().closeEditor;
  const updateInstrument = useInstrumentStore.getState().updateInstrument;

  return (
    <>
      <TrackEffectsPanelSolid />
      <For each={openEditors()}>
        {(editor) => {
          switch (editor.kind) {
            case "instrument":
            case "samplerInstrument":
              return (
                <InstrumentEditorModalSolid
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
                  width="full"
                  scopeId={`synth-editor-${editor.instrumentId}`}
                  flushBody
                  onClose={() => closeEditor({ kind: "synthInstrument", instrumentId: editor.instrumentId })}
                >
                  {instrument()?.nodeGraph ? (
                    <NodeInstrumentEditorSolid instrument={instrument()} updateInstrument={updateInstrument} />
                  ) : (
                    <SynthEditorSolid instrumentId={editor.instrumentId} />
                  )}
                </Modal>
              );
            }
            case "synth":
              return (
                <Modal
                  open
                  title="Synth"
                  width="full"
                  scopeId="synth-editor"
                  flushBody
                  onClose={() => closeEditor({ kind: "synth" })}
                >
                  <SynthEditorSolid />
                </Modal>
              );
            case "track":
              return <TrackDetailsModalSolid trackId={editor.trackId} />;
            case "segment":
              return <SegmentEditorModalSolid segmentId={editor.segmentId} />;
            case "component":
              return <ComponentEditorModalSolid componentId={editor.componentId} />;
            case "plugin":
              return <PluginHostModalSolid pluginId={editor.pluginId} />;
            case "eq":
              return <EqAutomationModalSolid />;
            case "projectHealth":
              return <ProjectHealthModalSolid />;
            case "preferences":
              return <PreferencesModalSolid />;
            default:
              return null;
          }
        }}
      </For>
    </>
  );
}
