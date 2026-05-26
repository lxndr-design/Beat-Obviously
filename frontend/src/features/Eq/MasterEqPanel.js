import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button, Icon, HoverInfo } from "../../components";
import { useProjectStore, useTransportStore, useUiStore } from "../../state/store";
import { send } from "../../ipc/bridge";
import { EQ_BAND_COUNT } from "../../state/types";
import { EqGraph } from "./EqGraph";
import styles from "./MasterEqPanel.module.css";
/**
 * MasterEqPanel — bottom-of-app 7-band EQ as a graph.
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ MASTER EQ                                              [edit]  │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │  ●─●─●─●─●─●─●                       (drag dots vertically)    │
 *   │  ───── 0 dB reference ─────                                    │
 *   │  80  200  500  1.3k  3k  6k  16k    (micro freq labels)        │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Editing a dot updates the *first* automation point (creates it at beat 0
 * if none exist). The full timeline-automation editor is reachable via the
 * pencil icon in the ribbon.
 */
export function MasterEqPanel() {
    const automation = useProjectStore((s) => s.project.masterEqAutomation);
    const loadProject = useProjectStore((s) => s.loadProject);
    const project = useProjectStore((s) => s.project);
    const position = useTransportStore((s) => s.positionBeat);
    const openEditor = useUiStore((s) => s.openEditor);
    const current = interpolateEq(automation, position);
    function setBand(idx, db) {
        let next = [...automation];
        if (next.length === 0) {
            next = [{ atBeat: 0, bandsDb: new Array(EQ_BAND_COUNT).fill(0) }];
        }
        const first = next[0];
        next[0] = {
            ...first,
            bandsDb: first.bandsDb.map((d, i) => (i === idx ? db : d)),
        };
        loadProject({ ...project, masterEqAutomation: next });
        void send({ kind: "eq.setAutomation", points: next });
    }
    return (_jsxs("section", { className: styles.panel, "aria-label": "Mastering", children: [_jsxs("header", { className: styles.ribbon, children: [_jsx("span", { className: styles.title, children: "Mastering" }), _jsx(HoverInfo, { content: "Open EQ automation editor", children: _jsx(Button, { iconOnly: true, size: "xs", onClick: () => openEditor({ kind: "eq" }), "aria-label": "Edit automation", children: _jsx(Icon, { name: "ph:pencil-simple", size: 16, decorative: true }) }) })] }), _jsx("div", { className: styles.graphHost, children: _jsx(EqGraph, { bandsDb: current, onChange: setBand }) })] }));
}
function interpolateEq(pts, beat) {
    if (pts.length === 0)
        return new Array(EQ_BAND_COUNT).fill(0);
    const sorted = [...pts].sort((a, b) => a.atBeat - b.atBeat);
    if (beat <= sorted[0].atBeat)
        return [...sorted[0].bandsDb];
    if (beat >= sorted[sorted.length - 1].atBeat)
        return [...sorted[sorted.length - 1].bandsDb];
    for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1];
        const b = sorted[i];
        if (beat >= a.atBeat && beat <= b.atBeat) {
            const t = (beat - a.atBeat) / (b.atBeat - a.atBeat);
            return a.bandsDb.map((av, k) => av + ((b.bandsDb[k] ?? 0) - av) * t);
        }
    }
    return [...sorted[0].bandsDb];
}
