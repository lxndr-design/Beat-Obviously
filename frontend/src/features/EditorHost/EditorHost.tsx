import { Modal } from "../../components";
import { useUiStore } from "../../state/store";
import { InstrumentEditorModal } from "../InstrumentEditor/InstrumentEditorModal";
import { SegmentEditorModal } from "../SegmentEditor/SegmentEditorModal";
import { EqAutomationModal } from "../EqAutomation/EqAutomationModal";
import { TrackEffectsPanel } from "../TrackEffects/TrackEffectsPanel";
import { PreferencesModal } from "../Preferences/PreferencesModal";
import { ComponentEditorModal } from "../ComponentLibrary/ComponentEditorModal";
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

  return (
    <>
      <TrackEffectsPanel />
      {openEditors.map((e) => {
        switch (e.kind) {
          case "instrument":
            return (
              <InstrumentEditorModal
                key={`instr-${e.instrumentId}`}
                instrumentId={e.instrumentId}
              />
            );
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
          case "eq":
            return <EqAutomationModal key="eq" />;
          case "preferences":
            return <PreferencesModal key="preferences" />;
          default:
            return null;
        }
      })}
    </>
  );
}
