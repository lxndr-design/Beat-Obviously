import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { nanoid } from "nanoid";
export const useComponentStore = create()(immer((set) => ({
    components: [],
    add: (c) => {
        const id = nanoid();
        set((s) => {
            s.components.unshift({
                id,
                createdAt: Date.now(),
                ...c,
                ...(c.kind === "drum"
                    ? { rows: structuredClone(c.rows) }
                    : { notes: structuredClone(c.notes) }),
            });
        });
        return id;
    },
    seedDefaultDrumLoops: (instruments) => set((s) => {
        if (s.components.some((component) => component.factory && component.kind === "drum"))
            return;
        s.components.push(...makeFactoryDrumLoops(instruments));
    }),
    remove: (id) => set((s) => {
        s.components = s.components.filter((c) => c.id !== id);
    }),
    rename: (id, name) => set((s) => {
        const c = s.components.find((x) => x.id === id);
        if (c)
            c.name = name;
    }),
})));
function makeFactoryDrumLoops(instruments) {
    const pick = (...names) => names
        .map((name) => instruments.find((instrument) => instrument.name.toLowerCase() === name.toLowerCase()))
        .find(Boolean) ?? instruments[0];
    const kick = pick("Basic Kick", "808 Bass Kick");
    const snare = pick("Snap Snare");
    const hat = pick("Closed Hat");
    const openHat = pick("Open Hat");
    const rim = pick("TR-505 Rim");
    const clap = pick("TR-505 Clap", "Snap Snare");
    const loop = (name, rows, speed = 1) => ({
        id: nanoid(),
        kind: "drum",
        name,
        lengthBeats: 16,
        stepCount: 16,
        speed,
        createdAt: Date.now(),
        factory: true,
        rows: rows.map((row) => ({
            id: nanoid(),
            instrumentId: row.instrument?.id,
            name: row.instrument?.name ?? row.name,
            steps: steps(row.steps),
        })),
    });
    return [
        loop("Basic Rock", [
            { instrument: kick, name: "Kick", steps: [1, 9] },
            { instrument: snare, name: "Snare", steps: [5, 13] },
            { instrument: hat, name: "Hat", steps: [1, 3, 5, 7, 9, 11, 13, 15] },
        ]),
        loop("Four on the Floor", [
            { instrument: kick, name: "Kick", steps: [1, 5, 9, 13] },
            { instrument: snare, name: "Snare", steps: [5, 13] },
            { instrument: openHat, name: "Open Hat", steps: [3, 7, 11, 15] },
        ]),
        loop("Reggae One Drop", [
            { instrument: kick, name: "Kick", steps: [9] },
            { instrument: rim ?? snare, name: "Rim", steps: [5, 9, 13] },
            { instrument: hat, name: "Hat", steps: [3, 7, 11, 15] },
        ]),
        loop("Breakbeat", [
            { instrument: kick, name: "Kick", steps: [1, 4, 7, 11] },
            { instrument: snare, name: "Snare", steps: [5, 10, 13, 16] },
            { instrument: hat, name: "Hat", steps: [1, 3, 4, 5, 7, 9, 11, 12, 13, 15] },
        ]),
        loop("Breakcore Break", [
            { instrument: kick, name: "Kick", steps: [1, 4, 7, 8, 11, 15] },
            { instrument: snare, name: "Snare", steps: [3, 5, 10, 13, 16] },
            { instrument: hat, name: "Hat", steps: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15] },
        ], 2),
        loop("Dembow", [
            { instrument: kick, name: "Kick", steps: [1, 4, 7, 11] },
            { instrument: rim ?? snare, name: "Rim", steps: [5, 9, 13] },
            { instrument: clap, name: "Clap", steps: [5, 13] },
        ]),
    ];
}
function steps(active) {
    const on = new Set(active.map((step) => step - 1));
    return Array.from({ length: 16 }, (_, index) => on.has(index));
}
