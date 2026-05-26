import { useUiStore } from "../../state/store";
import { InstrumentEditorModal } from "../InstrumentEditor/InstrumentEditorModal";
import { SegmentEditorModal } from "../SegmentEditor/SegmentEditorModal";
import { EqAutomationModal } from "../EqAutomation/EqAutomationModal";

/**
 * EditorHost — renders every currently-open editor modal.
 *
 * Multiple editors can be open at once (per spec). The ModalStackOverlay
 * (mounted near App root) handles the unsaved-check confirmation that
 * shadows everything when needed.
 */
export function EditorHost() {
  const openEditors = useUiStore((s) => s.openEditors);

  return (
    <>
      {openEditors.map((e) => {
        switch (e.kind) {
          case "instrument":
            return (
              <InstrumentEditorModal
                key={`instr-${e.instrumentId}`}
                instrumentId={e.instrumentId}
              />
            );
          case "segment":
            return (
              <SegmentEditorModal
                key={`seg-${e.segmentId}`}
                segmentId={e.segmentId}
              />
            );
          case "eq":
            return <EqAutomationModal key="eq" />;
          case "preferences":
            // Placeholder until preferences modal is built.
            return null;
          default:
            return null;
        }
      })}
    </>
  );
}
