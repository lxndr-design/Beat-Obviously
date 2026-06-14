import { Modal } from "../../components";
import { useUiStore } from "../../state/store";
import { useInstrumentStore } from "../../state/store";
import { InstrumentEditorModal } from "../InstrumentEditor/InstrumentEditorModal";
import { SegmentEditorModal } from "../SegmentEditor/SegmentEditorModal";
import { EqAutomationModal } from "../EqAutomation/EqAutomationModal";
import { TrackEffectsPanel } from "../TrackEffects/TrackEffectsPanel";
import { TrackDetailsModal } from "../TrackDetails/TrackDetailsModal";
import { PreferencesModal } from "../Preferences/PreferencesModal";
import { ProjectHealthModal } from "../ProjectHealth/ProjectHealthModal";
import { ComponentEditorModal } from "../ComponentLibrary/ComponentEditorModal";
import { PluginHostModal } from "../PluginLibrary/PluginHostModal";
import { SynthEditor } from "../Synth";

/**
 * EditorHost — renders every currently-open editor modal.
 *
 * Multiple editors can be open at once (per spec). The ModalStackOverlay
 * (mounted near App root) handles the unsaved-check confirmation that
 * shadows everything when needed.
 */
export function EditorHost() {
  const openEditors = useUiStore((s) => s.openEditors);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const instruments = useInstrumentStore((s) => s.instruments);

  return (
    <>
      <TrackEffectsPanel />
      {openEditors.map((e) => {
        switch (e.kind) {
          case "instrument":
          case "samplerInstrument":
            return (
              <InstrumentEditorModal
                key={`sampler-instr-${e.instrumentId}`}
                instrumentId={e.instrumentId}
                editorKind={e.kind === "instrument" ? "instrument" : "samplerInstrument"}
              />
            );
          case "synthInstrument": {
            const instrument = instruments.find((candidate) => candidate.id === e.instrumentId);
            return (
              <Modal
                key={`synth-instr-${e.instrumentId}`}
                open
                title={instrument?.name ?? "Synth"}
                width="full"
                scopeId={`synth-editor-${e.instrumentId}`}
                flushBody
                onClose={() => closeEditor({ kind: "synthInstrument", instrumentId: e.instrumentId })}
              >
                <SynthEditor instrumentId={e.instrumentId} />
              </Modal>
            );
          }
          case "synth":
            return (
              <Modal
                key="synth"
                open
                title="Synth"
                width="full"
                scopeId="synth-editor"
                flushBody
                onClose={() => closeEditor({ kind: "synth" })}
              >
                <SynthEditor />
              </Modal>
            );
          case "track":
            return (
              <TrackDetailsModal
                key={`track-${e.trackId}`}
                trackId={e.trackId}
              />
            );
          case "segment":
            return (
              <SegmentEditorModal
                key={`seg-${e.segmentId}`}
                segmentId={e.segmentId}
              />
            );
          case "component":
            return (
              <ComponentEditorModal
                key={`component-${e.componentId}`}
                componentId={e.componentId}
              />
            );
          case "plugin":
            return (
              <PluginHostModal
                key={`plugin-${e.pluginId}`}
                pluginId={e.pluginId}
              />
            );
          case "eq":
            return <EqAutomationModal key="eq" />;
          case "projectHealth":
            return <ProjectHealthModal key="project-health" />;
          case "preferences":
            return <PreferencesModal key="preferences" />;
          default:
            return null;
        }
      })}
    </>
  );
}
