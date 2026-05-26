import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
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
    return (_jsx(_Fragment, { children: openEditors.map((e) => {
            switch (e.kind) {
                case "instrument":
                    return (_jsx(InstrumentEditorModal, { instrumentId: e.instrumentId }, `instr-${e.instrumentId}`));
                case "segment":
                    return (_jsx(SegmentEditorModal, { segmentId: e.segmentId }, `seg-${e.segmentId}`));
                case "eq":
                    return _jsx(EqAutomationModal, {}, "eq");
                case "preferences":
                    // Placeholder until preferences modal is built.
                    return null;
                default:
                    return null;
            }
        }) }));
}
