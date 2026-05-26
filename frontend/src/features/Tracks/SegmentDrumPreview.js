import { jsx as _jsx } from "react/jsx-runtime";
import { drumStepOn } from "../../state/drumSteps";
import styles from "./SegmentDrumPreview.module.css";
export function SegmentDrumPreview({ segment }) {
    if (segment.payload.kind !== "drum")
        return null;
    const { rows, stepCount } = segment.payload;
    if (rows.length === 0 || stepCount <= 0)
        return null;
    return (_jsx("svg", { className: styles.svg, viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": true, children: rows.map((row, rowIdx) => {
            const rowY = ((rowIdx + 0.5) / rows.length) * 100;
            return row.steps.slice(0, stepCount).map((step, stepIdx) => {
                if (!drumStepOn(step))
                    return null;
                const cellW = 100 / stepCount;
                return (_jsx("rect", { x: stepIdx * cellW + cellW * 0.24, y: rowY - 2, width: Math.max(1, cellW * 0.52), height: 4, className: styles.hit }, `${row.id}:${stepIdx}`));
            });
        }) }));
}
