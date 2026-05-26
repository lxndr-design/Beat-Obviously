import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { Modal, Button } from "../../components";
import { useInstrumentStore, useUiStore } from "../../state/store";
import styles from "./MergeInstrumentModal.module.css";
/**
 * MergeInstrumentModal — pick a second instrument to merge with `sourceId`.
 *
 * The merge action itself lives in the instrument store (averages knobs +
 * envelope, unions samples, credits both as parents). After creation, the
 * editor opens automatically on the new instrument.
 */
export function MergeInstrumentModal({ sourceId, onClose }) {
    const instruments = useInstrumentStore((s) => s.instruments);
    const merge = useInstrumentStore((s) => s.mergeInstruments);
    const openEditor = useUiStore((s) => s.openEditor);
    const [pickedId, setPickedId] = useState(null);
    const source = instruments.find((i) => i.id === sourceId);
    const others = instruments.filter((i) => i.id !== sourceId);
    function confirm() {
        if (!pickedId)
            return;
        const id = merge(sourceId, pickedId);
        if (id)
            openEditor({ kind: "instrument", instrumentId: id });
        onClose();
    }
    return (_jsx(Modal, { open: true, title: `Merge — ${source?.name ?? ""}`, width: "sm", onClose: onClose, footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", onClick: onClose, children: "Cancel" }), _jsx(Button, { variant: "primary", disabled: !pickedId, onClick: confirm, children: "Merge" })] }), children: others.length === 0 ? (_jsx("p", { className: styles.empty, children: "No other instruments to merge with." })) : (_jsx("ul", { className: styles.list, children: others.map((i) => (_jsx("li", { children: _jsxs("button", { type: "button", className: `${styles.option} ${pickedId === i.id ? styles.selected : ""}`, onClick: () => setPickedId(i.id), children: [_jsx("span", { className: styles.optionName, children: i.name }), _jsx("span", { className: styles.optionKind, children: i.kind })] }) }, i.id))) })) }));
}
